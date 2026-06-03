import prisma from '../config/prismaClient';
import { sendApplicationApprovalEmail } from './emailService';
import { resolveCrmFrontendBaseUrl } from '../utils/crmFrontendUrl';
import { createPublicPortalToken } from './publicPortalTokenService';
import { emitToUser } from '../socket';
// Type-only to avoid a runtime cycle (applicationApprovalService -> queue -> worker -> here).
import type { ApprovalSideEffectPayload } from './applicationApprovalService';

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
    meta: RealtimeMeta = {}
): Promise<void> {
    if (!recipients.length) return;

    const created = await Promise.allSettled(
        recipients.map((r) =>
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
        const recipient = recipients[i];
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

    const currentQueue = String(application.currentQueue ?? '').trim().toLowerCase();
    const currentState = String(application.currentState ?? '').trim().toLowerCase();
    if (currentQueue !== 'approved' && currentState !== 'approved') {
        console.warn('[approvalSideEffects] application no longer Approved — skipping fan-out:', {
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
    const applicationNumber =
        application.applicationId != null && String(application.applicationId).trim() !== ''
            ? String(application.applicationId)
            : applicationId;

    /* ----------------------------- Notifications ----------------------------- */
    try {
        const internalUsers = await prisma.user.findMany({
            where: {
                role: { in: CRM_INTERNAL_NOTIFY_ROLES as unknown as any },
                isActive: true,
            },
            select: { id: true, email: true, firstName: true, lastName: true, role: true },
        });

        const operationsRecipients: RecipientUser[] = internalUsers
            .filter((u) => String(u.role || '').toUpperCase() === 'OPERATIONS')
            .map((u) => ({
                id: String(u.id),
                email: u.email ? String(u.email) : null,
                name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
            }));

        const nonOperationsInternalRecipients: RecipientUser[] = internalUsers
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
         * ISO-approved branch: ONLY notify Operations users.
         *   - No fan-out to Final Underwriter / Underwriter / Admin / Accountant.
         *   - No fan-out to referring agent / sales rep / createdBy.
         * This is the strict requirement when an ISO performs the approval action.
         */
        if (isIsoActor) {
            const operationNotifications = dedupeById(operationsRecipients).filter(
                (r) => r.id !== payload.actorId
            );

            if (operationNotifications.length > 0) {
                await createAndPushNotifications(
                    operationNotifications,
                    {
                        title: `ISO approved application #${applicationNumber}`,
                        message: `ISO approved application #${applicationNumber}. Now you can proceed to generate contract.`,
                        type: 'application_update',
                        applicationId: application.id,
                        createdById: payload.actorId,
                    },
                    { realtimeKind: 'iso_approval_for_operations' }
                );
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
        const viewApplicationUrl = baseUrl
            ? `${baseUrl.replace(/\/$/, '')}/applications/${applicationNumber}`
            : undefined;

        let calculateApprovalUrl: string | undefined;
        try {
            const token = await createPublicPortalToken(application.id, { expiresInDays: 90 });
            if (token && baseUrl) {
                calculateApprovalUrl = `${baseUrl.replace(/\/$/, '')}/public/application/approval/${token}`;
            }
        } catch (tokenErr) {
            console.error('[approvalSideEffects] portal token generation failed:', tokenErr);
        }

        const isoEmail = String(iso?.email ?? '').trim();
        const isoName = String(iso?.name ?? '').trim();

        /*
         * Email: only the linked ISO mailbox receives the branded approval template.
         * No step/workflow mail to agent, underwriter, final underwriter, operations, or admin.
         * (Manual "Send approval email" from the CRM uses the same ISO-only templates.)
         */
        if (isoEmail) {
            const result = await sendApplicationApprovalEmail({
                to: isoEmail,
                clientName: isoName || isoEmail,
                companyName: businessName || clientName,
                viewApplicationUrl,
                calculateApprovalUrl,
            });
            if (!result) {
                console.warn(
                    '[approvalSideEffects] ISO approval email was not delivered for application',
                    applicationNumber
                );
            }
        } else {
            console.warn(
                '[approvalSideEffects] skipped ISO approval email — no linked ISO email on application',
                applicationNumber
            );
        }
    } catch (emailErr) {
        console.error('[approvalSideEffects] email fan-out failed:', emailErr);
    }
}
