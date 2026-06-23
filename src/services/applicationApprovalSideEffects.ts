import prisma from '../config/prismaClient';
import { randomUUID } from 'crypto';
import {
    sendApplicationApprovalEmail,
    buildApplicationApprovalEmailHtml,
    APPROVAL_EMAIL_PDF_FILENAME,
} from './emailService';
import {
    buildPublicApprovalPortalUrl,
    resolveCrmFrontendBaseUrl,
} from '../utils/crmFrontendUrl';
import { createPublicPortalToken } from './publicPortalTokenService';
import { emitToUser } from '../socket';
import { recordCommunicationAudit } from './systemActivityLogService';
import { storeSgMessageIdOnOutbound } from './outboundCommunicationService';
import {
    APPLICATION_QUEUE_CONTRACT_PENDING,
    APPLICATION_STATE_CONTRACT_PENDING,
} from './contractApplicationWorkflowSync';
// Type-only to avoid a runtime cycle (applicationApprovalService -> queue -> worker -> here).
import type { ApprovalSideEffectPayload } from './business/applicationApprovalService';

/* ============================================================================
 * Application approval side-effects
 * ----------------------------------------------------------------------------
 * Runs OUT-OF-BAND from the HTTP request that triggered the approval. May be
 * invoked by:
 *   1. The BullMQ approval worker (preferred — durable, retried, scalable).
 *   2. `setImmediate(...)` fallback inside `applicationApprovalService` when
 *      Redis is not configured.
 *
 * Keep this module:
 *   - Idempotent: re-running on retry must not flood users with duplicate
 *     emails. We skip if the application is no longer Approved (rolled back)
 *     or if the actor matches a recipient (no self-notify).
 *   - Self-contained: every external call is wrapped — a single failing email
 *     never breaks the whole fan-out.
 *   - Observable: every branch logs context so production triage works.
 * ==========================================================================*/

const CRM_INTERNAL_NOTIFY_ROLES = [
    'ADMIN',
    'SUPER_ADMIN',
    'OPERATIONS',
    'UNDERWRITER',
    'FINAL_UNDERWRITER',
    'ACCOUNTANT',
    'ACCOUNTS',
] as const;

interface RecipientUser {
    id: string;
    email: string | null;
    name: string;
}

const dedupeById = (rows: RecipientUser[]): RecipientUser[] => {
    const seen = new Set<string>();
    const out: RecipientUser[] = [];
    for (const row of rows) {
        if (!row.id) continue;
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
    }
    return out;
};

const normalizeStageToken = (value: unknown): string =>
    String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

const ISO_APPROVAL_NOTIFICATION_TITLE_PREFIX = 'ISO approved application #';
const ISO_APPROVAL_NOTIFICATION_MESSAGE =
    'ISO approved the application. The deal has been moved to the Contract Pending stage. Now you can proceed to generate contract.';

/** Roles that own contract generation after an ISO approval. */
const ISO_CONTRACT_NOTIFY_ROLES = ['OPERATIONS', 'ADMIN', 'SUPER_ADMIN'] as const;

async function findIsoContractNotifyRecipients(): Promise<RecipientUser[]> {
    const users = await prisma.user.findMany({
        where: {
            role: { in: [...ISO_CONTRACT_NOTIFY_ROLES] },
            isActive: true,
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });

    return users.map((u) => ({
        id: String(u.id),
        email: u.email ? String(u.email) : null,
        name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
    }));
}

function isContractPendingStage(
    queue: string | null | undefined,
    state: string | null | undefined
): boolean {
    const queueToken = normalizeStageToken(queue);
    const stateToken = normalizeStageToken(state);
    return (
        queueToken === normalizeStageToken(APPLICATION_QUEUE_CONTRACT_PENDING) ||
        stateToken === normalizeStageToken(APPLICATION_STATE_CONTRACT_PENDING) ||
        queueToken === 'contractpending' ||
        stateToken === 'contractpending'
    );
}

/**
 * Notification include shape matching {@link mapNotificationToApi} in the
 * notification controller — keeps the realtime payload identical to what the
 * REST inbox returns so the frontend reducer can prepend without divergence.
 */
const NOTIFICATION_INCLUDE = {
    recipient: { select: { id: true, firstName: true, lastName: true, email: true } },
    application: {
        select: {
            id: true,
            applicationId: true,
            priority: true,
            type: true,
            currentQueue: true,
            currentState: true,
        },
    },
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

/** Mirror of the API shape returned by GET /notifications (see notificationController.mapNotificationToApi). */
const toApiNotification = (notification: any) => {
    if (!notification) return notification;
    const recipient = notification.recipient;
    const application = notification.application;
    const createdBy = notification.createdBy;
    return {
        _id: notification.id,
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        recipient: recipient
            ? {
                  _id: recipient.id,
                  id: recipient.id,
                  firstName: recipient.firstName,
                  lastName: recipient.lastName,
                  email: recipient.email,
              }
            : notification.recipientId,
        application: application
            ? {
                  _id: application.id,
                  id: application.id,
                  applicationId: application.applicationId,
                  priority: application.priority,
                  type: application.type,
                  currentQueue: application.currentQueue,
                  currentState: application.currentState,
              }
            : notification.applicationId,
        documentRequestDetails:
            notification.documentRequestedDocuments ||
            notification.documentRequestAdditional !== undefined
                ? {
                      requestedDocuments: notification.documentRequestedDocuments || [],
                      requestAdditional: !!notification.documentRequestAdditional,
                  }
                : undefined,
        isRead: notification.isRead,
        readAt: notification.readAt,
        createdBy: createdBy
            ? {
                  _id: createdBy.id,
                  id: createdBy.id,
                  firstName: createdBy.firstName,
                  lastName: createdBy.lastName,
                  email: createdBy.email,
              }
            : notification.createdById ?? null,
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt,
    };
};

interface RealtimeMeta {
    /** Tag emitted alongside the notification so clients can render an in-app toast / CTA. */
    realtimeKind?: 'iso_approval_for_operations' | 'application_approved';
    /** Optional deep-link the frontend can use as a click-through. */
    actionUrl?: string;
}

/**
 * Persist a notification per recipient and immediately push it down the
 * recipient's socket room so the bell / inbox updates with zero latency.
 *
 * Uses N parallel `create({ include })` calls instead of `createMany` so the
 * full populated record (with relations) comes back ready to emit. N is tiny
 * (active operations / underwriters / etc.) so the extra round-trips are
 * negligible — and this whole function runs out of band in the BullMQ worker.
 */
async function createAndPushNotifications(
    recipients: RecipientUser[],
    base: {
        title: string;
        message: string;
        type: string;
        applicationId: string;
        createdById: string | null;
    },
    meta: RealtimeMeta = {},
    options: { skipIfTitleExists?: boolean } = {}
): Promise<void> {
    if (!recipients.length) return;

    let recipientsToCreate = recipients;
    if (options.skipIfTitleExists) {
        const existing = await prisma.notification.findMany({
            where: {
                applicationId: base.applicationId,
                title: base.title,
                recipientId: { in: recipients.map((r) => r.id) },
            },
            select: { recipientId: true },
        });
        const alreadyNotified = new Set(existing.map((row) => String(row.recipientId)));
        recipientsToCreate = recipients.filter((r) => !alreadyNotified.has(r.id));
        if (!recipientsToCreate.length) {
            console.log('[approvalSideEffects] notifications already exist — skipping duplicate fan-out:', {
                applicationId: base.applicationId,
                title: base.title,
            });
            return;
        }
    }

    const created = await Promise.allSettled(
        recipientsToCreate.map((r) =>
            prisma.notification.create({
                data: {
                    title: base.title,
                    message: base.message,
                    type: base.type,
                    recipientId: r.id,
                    applicationId: base.applicationId,
                    createdById: base.createdById,
                },
                include: NOTIFICATION_INCLUDE,
            })
        )
    );

    for (let i = 0; i < created.length; i += 1) {
        const result = created[i];
        const recipient = recipientsToCreate[i];
        if (result.status === 'rejected') {
            console.error('[approvalSideEffects] notification create failed:', {
                recipientId: recipient?.id,
                error: (result as PromiseRejectedResult).reason,
            });
            continue;
        }

        const apiPayload = toApiNotification(result.value);
        emitToUser(recipient.id, 'notification:new', {
            notification: apiPayload,
            meta,
        });
        console.log('[approvalSideEffects] notification pushed:', {
            recipientId: recipient.id,
            notificationId: apiPayload.id,
            title: base.title,
        });
    }
}

export async function processApplicationApprovalSideEffects(
    payload: ApprovalSideEffectPayload
): Promise<void> {
    const { applicationId } = payload;

    const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: {
            client: true,
            iso: true,
            referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
            salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
    });

    if (!application) {
        console.warn('[approvalSideEffects] application missing — skipping fan-out:', applicationId);
        return;
    }

    /*
     * Idempotency guard: only fan out while the deal is still at (or just past)
     * the approval transition. ISO approvals land on "Contract Pending"; internal
     * approvals on "Approved". If a webhook retries after the deal already moved
     * deep into the contract workflow we still proceed (notifications were the
     * point), but if it was rolled back to a pre-approval stage we skip.
     */
    const APPROVAL_STAGE_TOKENS = new Set<string>([
        'approved',
        'completed',
        'contractpending',
        'contractgenerated',
        'contractsent',
        'contractout',
        'contractsout',
        'contractcancelled',
        'contractsigned',
        'signedcontracts',
        'fundingcall',
        'disbursment',
        'disbursement',
        'funded',
        'final',
    ]);
    const currentQueueToken = normalizeStageToken(application.currentQueue);
    const currentStateToken = normalizeStageToken(application.currentState);
    if (
        !APPROVAL_STAGE_TOKENS.has(currentQueueToken) &&
        !APPROVAL_STAGE_TOKENS.has(currentStateToken)
    ) {
        console.warn('[approvalSideEffects] application no longer at approval stage — skipping fan-out:', {
            applicationId,
            currentQueue: application.currentQueue,
            currentState: application.currentState,
        });
        return;
    }

    const client = (application as any).client;
    const iso = (application as any).iso;

    const businessName = String(client?.businessName ?? '').trim();
    const ownerName = `${client?.ownerFirstName ?? ''} ${client?.ownerLastName ?? ''}`.trim();
    const clientName = businessName || ownerName || 'Client';
    const actorType = String(payload.actorType ?? '').trim().toUpperCase();
    const isIsoActor = actorType === 'ISO';
    const movedToContractPending =
        isContractPendingStage(application.currentQueue, application.currentState) ||
        isContractPendingStage(payload.targetQueue, payload.targetState);
    const shouldNotifyContractGenerationTeam = isIsoActor;
    const applicationNumber =
        application.applicationId != null && String(application.applicationId).trim() !== ''
            ? String(application.applicationId)
            : applicationId;

    console.log('[approvalSideEffects] fan-out context:', {
        applicationId,
        applicationNumber,
        actorType,
        isIsoActor,
        movedToContractPending,
        shouldNotifyContractGenerationTeam,
        currentQueue: application.currentQueue,
        currentState: application.currentState,
    });

    /* ----------------------------- Notifications ----------------------------- */
    try {
        const contractNotifyRecipients = await findIsoContractNotifyRecipients();

        const nonOperationsInternalRecipients: RecipientUser[] = (
            await prisma.user.findMany({
                where: {
                    role: { in: CRM_INTERNAL_NOTIFY_ROLES as unknown as any },
                    isActive: true,
                },
                select: { id: true, email: true, firstName: true, lastName: true, role: true },
            })
        )
            .filter((u) => String(u.role || '').toUpperCase() !== 'OPERATIONS')
            .map((u) => ({
                id: String(u.id),
                email: u.email ? String(u.email) : null,
                name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
            }));

        const directRecipients: RecipientUser[] = [
            (application as any).referringAgent,
            (application as any).salesRepresentative,
            (application as any).createdBy,
        ]
            .filter(Boolean)
            .map((u: any) => ({
                id: String(u.id),
                email: u.email ? String(u.email) : null,
                name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
            }));

        /*
         * ISO / Contract-Pending branch: notify Operations + Admin + Super Admin
         * so they can generate the contract. Triggered when the actor is ISO OR
         * the deal landed on the Contract Pending stage (belt-and-suspenders).
         */
        if (shouldNotifyContractGenerationTeam) {
            const operationNotifications = dedupeById(contractNotifyRecipients).filter(
                (r) => r.id !== payload.actorId
            );

            console.log('[approvalSideEffects] contract-generation notify targets:', {
                applicationId,
                recipientCount: operationNotifications.length,
                recipientIds: operationNotifications.map((r) => r.id),
            });

            if (operationNotifications.length > 0) {
                const title = `${ISO_APPROVAL_NOTIFICATION_TITLE_PREFIX}${applicationNumber}`;
                const message = ISO_APPROVAL_NOTIFICATION_MESSAGE;
                const baseUrl = resolveCrmFrontendBaseUrl() || '';
                const actionUrl = baseUrl
                    ? `${baseUrl.replace(/\/$/, '')}/application-details/${applicationNumber}`
                    : `/application-details/${applicationNumber}`;

                await createAndPushNotifications(
                    operationNotifications,
                    {
                        title,
                        message,
                        type: 'application_update',
                        applicationId: application.id,
                        createdById: payload.actorId,
                    },
                    { realtimeKind: 'iso_approval_for_operations', actionUrl },
                    { skipIfTitleExists: true }
                );
            } else {
                console.warn('[approvalSideEffects] no Operations/Admin/Super Admin recipients to notify:', {
                    applicationId,
                    activeContractNotifyUsers: contractNotifyRecipients.length,
                });
            }
        } else {
            /*
             * Non-ISO actor (Final Underwriter / Admin / etc. approving manually):
             * keep the existing broader fan-out so other internal staff and the
             * deal’s direct contacts still see the approval.
             */
            const allRecipients = dedupeById([
                ...directRecipients,
                ...nonOperationsInternalRecipients,
            ]).filter((r) => r.id !== payload.actorId);

            if (allRecipients.length > 0) {
                const actorLabel = (() => {
                    const t = String(payload.actorType ?? '').trim().toUpperCase();
                    if (t === 'CLIENT') return 'Client';
                    if (payload.actorRole) return String(payload.actorRole).toUpperCase().replace(/_/g, ' ');
                    return 'User';
                })();

                const title = `Application #${applicationNumber} approved`;
                const message = `${actorLabel}${
                    payload.actorName ? ` (${payload.actorName})` : ''
                } approved application #${applicationNumber} for ${clientName}.`;

                await createAndPushNotifications(
                    allRecipients,
                    {
                        title,
                        message,
                        type: 'application_update',
                        applicationId: application.id,
                        createdById: payload.actorId,
                    },
                    { realtimeKind: 'application_approved' }
                );
            }
        }
    } catch (notifyErr) {
        console.error('[approvalSideEffects] notification fan-out failed:', notifyErr);
    }

    /* -------------------------------- Email ---------------------------------- */
    try {
        const baseUrl = resolveCrmFrontendBaseUrl() || '';

        let publicApprovalUrl: string | undefined;
        try {
            const token = await createPublicPortalToken(application.id, { expiresInDays: 90 });
            if (token && baseUrl) {
                publicApprovalUrl = buildPublicApprovalPortalUrl(baseUrl, token);
            }
        } catch (tokenErr) {
            console.error('[approvalSideEffects] portal token generation failed:', tokenErr);
        }

        const viewApplicationUrl = publicApprovalUrl;
        const calculateApprovalUrl = publicApprovalUrl;

        const isoEmail = String(iso?.email ?? '').trim();
        const isoName = String(iso?.name ?? '').trim();

        /*
         * When the ISO approves from the public portal, they already acted — do not
         * send them another branded approval email. Operations/Super Admin alerts
         * are handled in the notification branch above.
         *
         * For internal CRM approvals, the linked ISO still receives the branded
         * approval template. (Manual "Send approval email" uses the same templates.)
         */
        if (!isIsoActor) {
            if (isoEmail) {
                const isoRecipientName = isoName || isoEmail;
                const emailSubject = 'Your Application Has Been Approved';
                const emailHtml = buildApplicationApprovalEmailHtml({
                    clientName: isoRecipientName,
                    companyName: businessName || clientName,
                    viewApplicationUrl,
                    calculateApprovalUrl,
                });
                const trackingId = randomUUID();
                const actorRoleLabel = payload.actorRole
                    ? String(payload.actorRole).toUpperCase().replace(/_/g, ' ')
                    : 'User';
                const actorLabel = `${actorRoleLabel} ${payload.actorName || ''}`.trim();

                try {
                    await recordCommunicationAudit(null, {
                        outboundCommunicationId: trackingId,
                        applicationId: application.id,
                        channel: 'EMAIL',
                        recipientType: 'ISO',
                        recipient: isoEmail,
                        subject: emailSubject,
                        body: emailHtml,
                        templateName: 'Application approved template',
                        actionType: 'APPROVED',
                        user: payload.actorId
                            ? {
                                  id: payload.actorId,
                                  role: payload.actorRole || 'USER',
                              }
                            : null,
                        actionDescription: `${actorLabel} sent approval email to the linked ISO.`,
                        currentStatus: `${application.currentQueue} / ${application.currentState}`,
                        metadata: {
                            emailSentTo: [isoEmail],
                            sentToLinkedIsoOnly: true,
                            autoSentOnApproval: true,
                            template: 'approval',
                            status: 'sent',
                            hasLetterPdf: true,
                            attachments: [APPROVAL_EMAIL_PDF_FILENAME],
                            delivery: {
                                status: 'sent',
                                sentAt: new Date().toISOString(),
                            },
                        },
                    });
                } catch (auditErr) {
                    console.error(
                        '[approvalSideEffects] failed to log approval email audit:',
                        auditErr,
                    );
                }

                const result = await sendApplicationApprovalEmail({
                    to: isoEmail,
                    clientName: isoRecipientName,
                    companyName: businessName || clientName,
                    viewApplicationUrl,
                    calculateApprovalUrl,
                    html: emailHtml,
                    subject: emailSubject,
                    trackingId,
                });
                if (!result.sent) {
                    console.warn(
                        '[approvalSideEffects] ISO approval email was not delivered for application',
                        applicationNumber
                    );
                } else if (result.sgMessageId) {
                    try {
                        await storeSgMessageIdOnOutbound(trackingId, result.sgMessageId);
                    } catch (metaErr) {
                        console.error(
                            '[approvalSideEffects] failed to store SendGrid message id:',
                            metaErr,
                        );
                    }
                }
            } else {
                console.warn(
                    '[approvalSideEffects] skipped ISO approval email — no linked ISO email on application',
                    applicationNumber
                );
            }
        }
    } catch (emailErr) {
        console.error('[approvalSideEffects] email fan-out failed:', emailErr);
    }
}