/**
 * In-app + realtime notifications for application lifecycle stages — from creation
 * through every queue / state transition (underwriting, contracts, funding, etc.).
 */
import prisma from '../config/prismaClient';
import { emitToUser } from '../socket';
import {
    deriveActionUrl,
    deriveCategory,
    notificationTriageDefaults,
} from './notificationCategory';

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

interface RecipientUser {
    id: string;
    email: string | null;
    name: string;
}

export interface ApplicationNotificationRecord {
    id: string;
    applicationId?: number | null;
    currentQueue?: string | null;
    currentState?: string | null;
    referringAgentId?: string | null;
    salesRepresentativeId?: string | null;
    createdById?: string | null;
    assignedUnderwriterId?: string | null;
    approvedByUnderwriterId?: string | null;
    client?: {
        businessName?: string | null;
        ownerFirstName?: string | null;
        ownerLastName?: string | null;
    } | null;
}

export type StageTransitionAction =
    | 'SEND_TO_UNDERWRITER'
    | 'SEND_TO_FINAL_UNDERWRITER'
    | 'SEND_FOR_FINAL_APPROVAL'
    | 'APPROVED'
    | 'QUEUE_CHANGED'
    | 'CREATED';

export interface StageNotificationContext {
    application: ApplicationNotificationRecord;
    previousQueue?: string | null;
    previousState?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    actorRole?: string | null;
    transitionAction?: StageTransitionAction;
    /** Override default copy (e.g. rejection reason). */
    titleOverride?: string;
    messageOverride?: string;
    type?: string;
    importance?: 'low' | 'normal' | 'high' | 'urgent';
}

/**
 * Roles with full CRM oversight (see `hasContractsLogAccess`). Every application
 * notification is mirrored to them so the Super Admin inbox carries all deal activity.
 */
export const SUPER_ADMIN_NOTIFY_ROLES = ['SUPER_ADMIN', 'CONTRACTS_LOG'] as const;

/** Copy shown to Super Admins when the direct copy is addressed to someone else ("ready for your approval"). */
export interface OversightCopy {
    title?: string;
    message?: string;
}

const normalizeToken = (value: unknown): string =>
    String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

const dedupeById = (rows: RecipientUser[]): RecipientUser[] => {
    const seen = new Set<string>();
    const out: RecipientUser[] = [];
    for (const row of rows) {
        if (!row.id || seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
    }
    return out;
};

const STAGE_LABELS: Record<string, string> = {
    new: 'New',
    agent: 'Agent',
    review: 'Review',
    onhold: 'On Hold',
    scrubbing: 'Scrubbing',
    underwriting: 'Underwriting',
    finalreview: 'Final Review',
    underwriter: 'Underwriter',
    approved: 'Approved',
    declined: 'Declined',
    contracted: 'Contracted',
    contractout: 'Contract Out',
    contractsout: 'Contracts Out',
    contractsigned: 'Contract Signed',
    signedcontracts: 'Signed Contracts',
    final: 'Final',
    fundingcall: 'Funding Call',
    disbursment: 'Disbursement',
    disbursement: 'Disbursement',
    funded: 'Funded',
};

function friendlyStageLabel(queue: string | null | undefined, state?: string | null): string {
    const q = normalizeToken(queue);
    if (STAGE_LABELS[q]) return STAGE_LABELS[q];
    const s = normalizeToken(state);
    if (STAGE_LABELS[s]) return STAGE_LABELS[s];
    const raw = String(queue ?? state ?? '').trim();
    return raw || 'Updated';
}

function clientNameOf(app: ApplicationNotificationRecord): string {
    const c = app.client;
    if (!c) return 'Client';
    return (
        c.businessName ||
        `${c.ownerFirstName || ''} ${c.ownerLastName || ''}`.trim() ||
        'Client'
    );
}

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
        category: notification.category ?? deriveCategory(notification.type, application),
        bucket: notification.bucket ?? 'inbox',
        importance: notification.importance ?? 'normal',
        snoozedUntil: notification.snoozedUntil ?? null,
        isArchived: notification.isArchived ?? false,
        actionUrl:
            notification.actionUrl ??
            deriveActionUrl({
                type: notification.type,
                applicationNumber: application?.applicationId,
                applicationUuid: notification.applicationId ?? application?.id,
            }),
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

async function findActiveUsersByRoles(roles: string[]): Promise<RecipientUser[]> {
    if (!roles.length) return [];
    const users = await prisma.user.findMany({
        where: { role: { in: roles as any }, isActive: true },
        select: { id: true, email: true, firstName: true, lastName: true },
    });
    return users.map((u) => ({
        id: String(u.id),
        email: u.email,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
    }));
}

async function resolveStageRecipients(
    app: ApplicationNotificationRecord,
    newQueue: string,
    newState: string | null | undefined,
    transitionAction?: StageTransitionAction,
): Promise<RecipientUser[]> {
    const recipients: RecipientUser[] = [];
    const q = normalizeToken(newQueue);

    const pushStakeholders = () => {
        const ids = [
            app.referringAgentId,
            app.salesRepresentativeId,
            app.createdById,
            app.assignedUnderwriterId,
            app.approvedByUnderwriterId,
        ].filter(Boolean);
        for (const id of ids) {
            recipients.push({ id: String(id), email: null, name: '' });
        }
    };

    if (transitionAction === 'CREATED') {
        // Only notify the application's own stakeholders (referring agent, sales rep,
        // creator). Do NOT broadcast creation to ADMIN / CONTRACTS_LOG / OPERATIONS /
        // SCRUBBING — they should not receive a "New application created" toast.
        pushStakeholders();
        return recipients;
    }

    if (transitionAction === 'SEND_TO_UNDERWRITER' || q === 'scrubbing' || q === 'underwriting') {
        recipients.push(...(await findActiveUsersByRoles(['SCRUBBING'])));
        return recipients;
    }

    if (
        transitionAction === 'SEND_TO_FINAL_UNDERWRITER' ||
        q === 'underwriter' ||
        q === 'finalreview'
    ) {
        recipients.push(...(await findActiveUsersByRoles(['UNDERWRITER'])));
        return recipients;
    }

    if (transitionAction === 'APPROVED') {
        return [];
    }

    const opsStageTokens = new Set([
        'approved',
        'contracted',
        'contractout',
        'contractsout',
        'contractsigned',
        'signedcontracts',
        'final',
        'fundingcall',
        'disbursment',
        'disbursement',
        'funded',
    ]);

    if (opsStageTokens.has(q)) {
        recipients.push(
            ...(await findActiveUsersByRoles(['OPERATIONS', 'ADMIN'])),
        );
    }

    if (q === 'declined') {
        recipients.push(...(await findActiveUsersByRoles(['SCRUBBING', 'UNDERWRITER'])));
        pushStakeholders();
        return recipients;
    }

    if (q === 'funded') {
        recipients.push(...(await findActiveUsersByRoles(['ACCOUNTANT', 'ACCOUNTS'])));
    }

    if (q === 'agent' || q === 'new' || q === 'onhold' || q === 'review') {
        pushStakeholders();
        return recipients;
    }

    // Generic stage move: stakeholders + internal ops visibility.
    pushStakeholders();
    recipients.push(
        ...(await findActiveUsersByRoles(['OPERATIONS', 'ADMIN'])),
    );
    return recipients;
}

async function createAndPushNotifications(
    recipients: RecipientUser[],
    base: {
        title: string;
        message: string;
        type: string;
        applicationId: string;
        createdById: string | null;
        importance?: 'low' | 'normal' | 'high' | 'urgent';
    },
    application?: ApplicationNotificationRecord | null,
    options?: {
        includeActor?: boolean;
        /** Mirror to Super Admins (default true). */
        includeSuperAdmins?: boolean;
        oversight?: OversightCopy;
    },
): Promise<void> {
    const actorId = base.createdById ? String(base.createdById) : '';
    const direct = dedupeById(recipients).filter(
        (r) => r.id && (options?.includeActor || r.id !== actorId),
    );
    const directIds = new Set(direct.map((r) => r.id));
    const oversightRecipients =
        options?.includeSuperAdmins === false
            ? []
            : (await findActiveUsersByRoles([...SUPER_ADMIN_NOTIFY_ROLES])).filter(
                  (r) => r.id && r.id !== actorId && !directIds.has(r.id),
              );
    const filtered = [...direct, ...oversightRecipients];
    if (!filtered.length) return;
    const isOversight = (index: number) => index >= direct.length;

    // Notification.createdById is optional — never write Super Admin proxy / orphan UUIDs.
    let safeCreatedById: string | null = null;
    if (actorId) {
        const actor = await prisma.user.findUnique({
            where: { id: actorId },
            select: { id: true },
        });
        safeCreatedById = actor?.id ?? null;
    }

    const triage = notificationTriageDefaults(base.type, application ?? undefined);

    const created = await Promise.allSettled(
        filtered.map((r, index) =>
            prisma.notification.create({
                data: {
                    title: (isOversight(index) && options?.oversight?.title) || base.title,
                    message: (isOversight(index) && options?.oversight?.message) || base.message,
                    type: base.type,
                    recipientId: r.id,
                    applicationId: base.applicationId,
                    createdById: safeCreatedById,
                    category: triage.category,
                    bucket: triage.bucket,
                    importance: base.importance ?? triage.importance,
                    actionUrl: deriveActionUrl({
                        type: base.type,
                        category: triage.category as any,
                        applicationNumber: application?.applicationId,
                        applicationUuid: base.applicationId,
                    }),
                },
                include: NOTIFICATION_INCLUDE,
            }),
        ),
    );

    for (let i = 0; i < created.length; i += 1) {
        const result = created[i];
        const recipient = filtered[i];
        if (result.status === 'rejected') {
            console.error('[stageNotification] create failed:', {
                recipientId: recipient?.id,
                error: (result as PromiseRejectedResult).reason,
            });
            continue;
        }
        emitToUser(recipient.id, 'notification:new', {
            notification: toApiNotification(result.value),
        });
    }
}

function buildDefaultCopy(ctx: StageNotificationContext): { title: string; message: string; type: string; importance: 'low' | 'normal' | 'high' | 'urgent' } {
    const app = ctx.application;
    const appNum = app.applicationId ?? '';
    const client = clientNameOf(app);
    const actor = String(ctx.actorName || '').trim();
    const stage = friendlyStageLabel(app.currentQueue, app.currentState);
    const appRef = appNum ? ` #${appNum}` : '';

    if (ctx.transitionAction === 'CREATED') {
        const selfCreated = actor && ctx.actorId;
        return {
            title: selfCreated ? `You created application${appRef}` : actor ? `${actor} created a new application` : 'New application created',
            message: `New application${appRef} for ${client} is in the ${stage} stage.`,
            type: 'application_created',
            importance: 'high',
        };
    }

    if (ctx.transitionAction === 'SEND_TO_UNDERWRITER') {
        return {
            title: actor ? `${actor} sent a new application` : 'Application sent to Scrubbing',
            message: `Application${appRef} for ${client} is ready for Scrubbing.`,
            type: 'application_update',
            importance: 'high',
        };
    }

    if (ctx.transitionAction === 'SEND_TO_FINAL_UNDERWRITER') {
        const actorRoleNorm = String(ctx.actorRole ?? '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '_');
        const isScrubberRecommend = actorRoleNorm === 'SCRUBBING';
        if (isScrubberRecommend) {
            return {
                title: 'Scrubber Sent Recommend Request for Approval',
                message: `Application${appRef} for ${client} has been recommended for approval and is ready for Underwriter review.`,
                type: 'application_update',
                importance: 'high',
            };
        }
        return {
            title: actor
                ? `${actor} forwarded an application for final review`
                : 'Application sent to Underwriter',
            message: `Application${appRef} for ${client} is ready for Underwriter review.`,
            type: 'application_update',
            importance: 'high',
        };
    }

    const prevQ = normalizeToken(ctx.previousQueue);
    const newQ = normalizeToken(app.currentQueue);
    const declined = newQ === 'declined';
    const funded = newQ === 'funded';

    return {
        title: declined
            ? `Application${appRef} declined`
            : funded
              ? `Application${appRef} funded`
              : `Application${appRef} — ${stage}`,
        message: declined
            ? `Application${appRef} for ${client} was declined.${actor ? ` Updated by ${actor}.` : ''}`
            : funded
              ? `Application${appRef} for ${client} has been marked as Funded.${actor ? ` Updated by ${actor}.` : ''}`
              : `Application${appRef} for ${client} moved to ${stage}${prevQ && prevQ !== newQ ? ` (from ${friendlyStageLabel(ctx.previousQueue, ctx.previousState)})` : ''}.${actor ? ` Updated by ${actor}.` : ''}`,
        type: declined ? 'application_rejected' : 'application_update',
        importance: declined ? 'urgent' : funded ? 'high' : 'normal',
    };
}

/** Super Admin assigned an application to a specific Underwriter — single-recipient in-app alert. */
export async function notifyAdminAssignedApplicationToUnderwriter(args: {
    application: ApplicationNotificationRecord;
    recipientId: string;
    actorId?: string | null;
    actorName?: string | null;
}): Promise<void> {
    const app = args.application;
    const recipientId = String(args.recipientId || '').trim();
    if (!app?.id || !recipientId) return;

    const appNum = app.applicationId ?? '';
    const client = clientNameOf(app);
    const appRef = appNum ? ` #${appNum}` : '';
    const actor = String(args.actorName || '').trim();

    await createAndPushNotifications(
        [{ id: recipientId, email: null, name: '' }],
        {
            title: 'Admin Sent a Application To you',
            message: actor
                ? `${actor} assigned application${appRef} for ${client} to you.`
                : `An admin assigned application${appRef} for ${client} to you.`,
            type: 'application_update',
            applicationId: app.id,
            createdById: args.actorId ? String(args.actorId) : null,
            importance: 'high',
        },
        app,
        {
            oversight: {
                title: `Application${appRef} assigned to an Underwriter`,
                message: `${actor || 'An admin'} assigned application${appRef} for ${client} to an Underwriter.`,
            },
        },
    );
}

/**
 * Agent / Underwriter workflow alerts (new deal in the pool, sent to agent, returned to
 * underwriter, ISO approved). Fire-and-forget — never throws to callers.
 */
export function scheduleWorkflowNotification(args: {
    application: ApplicationNotificationRecord;
    recipientIds: Array<string | null | undefined>;
    title: string;
    message: string;
    actorId?: string | null;
    importance?: 'low' | 'normal' | 'high' | 'urgent';
    /** Super Admin wording when the direct copy is addressed to the recipient ("your approval"). */
    oversight?: OversightCopy;
}): void {
    const recipients = [...new Set(args.recipientIds.map((id) => String(id ?? '').trim()).filter(Boolean))].map(
        (id) => ({ id, email: null, name: '' }),
    );
    // No direct recipients is fine — Super Admins still receive the oversight copy.
    if (!args.application?.id) return;
    setImmediate(() => {
        void createAndPushNotifications(
            recipients,
            {
                title: args.title,
                message: args.message,
                type: 'application_update',
                applicationId: args.application.id,
                createdById: args.actorId ? String(args.actorId) : null,
                importance: args.importance ?? 'normal',
            },
            args.application,
            { oversight: args.oversight },
        ).catch((err) => console.error('[workflowNotification] failed:', err));
    });
}

/** Fire-and-forget wrapper — never throws to callers. */
export function scheduleApplicationStageNotification(ctx: StageNotificationContext): void {
    setImmediate(() => {
        void notifyApplicationStageChange(ctx).catch((err) => {
            console.error('[stageNotification] failed:', err);
        });
    });
}

export async function notifyApplicationStageChange(ctx: StageNotificationContext): Promise<void> {
    const app = ctx.application;
    if (!app?.id) return;

    if (ctx.transitionAction === 'APPROVED') return;

    const newQueue = String(app.currentQueue ?? '').trim();
    const newState = app.currentState ?? null;
    const prevQueue = ctx.previousQueue ?? null;
    const prevState = ctx.previousState ?? null;

    if (
        ctx.transitionAction !== 'CREATED' &&
        normalizeToken(prevQueue) === normalizeToken(newQueue) &&
        normalizeToken(prevState) === normalizeToken(newState)
    ) {
        return;
    }

    const copy = buildDefaultCopy(ctx);
    const title = ctx.titleOverride ?? copy.title;
    const message = ctx.messageOverride ?? copy.message;
    const type = ctx.type ?? copy.type;
    const importance = ctx.importance ?? copy.importance;

    const recipients = await resolveStageRecipients(
        app,
        newQueue,
        newState,
        ctx.transitionAction,
    );

    await createAndPushNotifications(
        recipients,
        {
            title,
            message,
            type,
            applicationId: app.id,
            createdById: ctx.actorId ? String(ctx.actorId) : null,
            importance,
        },
        app,
        {
            includeActor: ctx.transitionAction === 'CREATED',
            oversight: buildOversightCopy(ctx, title),
        },
    );
}

/** Third-person wording for Super Admins when the direct copy is first-person ("You created..."). */
function buildOversightCopy(ctx: StageNotificationContext, directTitle: string): OversightCopy | undefined {
    if (ctx.transitionAction !== 'CREATED' || !directTitle.startsWith('You ')) return undefined;
    const appNum = ctx.application.applicationId;
    const actor = String(ctx.actorName || '').trim() || 'A user';
    return { title: `${actor} created application${appNum ? ` #${appNum}` : ''}` };
}

export async function notifyApplicationRejected(args: {
    application: ApplicationNotificationRecord;
    actorId?: string | null;
    reason: string;
    extraRecipientIds?: string[];
}): Promise<void> {
    const app = args.application;
    const appNum = app.applicationId ?? 'N/A';
    const client = clientNameOf(app);
    const title = `Application #${appNum} rejected`;
    const message = `Application #${appNum} for ${client} has been rejected. Reason: ${args.reason}`;

    const roleRecipients = await resolveStageRecipients(
        app,
        String(app.currentQueue ?? 'Declined'),
        app.currentState,
    );
    const extra: RecipientUser[] = (args.extraRecipientIds ?? []).map((id) => ({
        id: String(id),
        email: null,
        name: '',
    }));

    await createAndPushNotifications(
        [...roleRecipients, ...extra],
        {
            title,
            message,
            type: 'application_rejected',
            applicationId: app.id,
            createdById: args.actorId ? String(args.actorId) : null,
            importance: 'urgent',
        },
        app,
    );
}

/** Super Admin completed final funding-call approval — alert Operations to proceed with disbursement. */
export async function notifyOperationsFundingCallApprovedForDisbursement(args: {
    application: ApplicationNotificationRecord;
    actorId?: string | null;
    actorName?: string | null;
}): Promise<void> {
    const app = args.application;
    if (!app?.id) return;

    const appNum = app.applicationId ?? '';
    const client = clientNameOf(app);
    const appRef = appNum ? ` #${appNum}` : '';
    const actor = String(args.actorName || '').trim();

    const opsUsers = await findActiveUsersByRoles(['OPERATIONS']);

    await createAndPushNotifications(
        opsUsers,
        {
            title: 'Funding call approved — ready for disbursement',
            message: actor
                ? `${actor} completed the final funding call approval for application${appRef} (${client}). You can continue with disbursement.`
                : `Super Admin completed the final funding call approval for application${appRef} (${client}). You can continue with disbursement.`,
            type: 'application_update',
            applicationId: app.id,
            createdById: args.actorId ? String(args.actorId) : null,
            importance: 'high',
        },
        app,
    );
}

const formatMoney = (value: unknown): string => {
    const n = Number(value);
    if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return '-';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
};

/** Users who work this deal: its Agent / creator, sales rep and the Underwriter(s) on it. */
export function dealTeamRecipientIds(app: ApplicationNotificationRecord): string[] {
    return [
        app.referringAgentId,
        app.createdById,
        app.salesRepresentativeId,
        app.assignedUnderwriterId,
        app.approvedByUnderwriterId,
    ]
        .map((id) => String(id ?? '').trim())
        .filter(Boolean);
}

export interface AmountChangeContext {
    application: ApplicationNotificationRecord;
    /** Human label, e.g. "Requested amount", "Offer amount". */
    label: string;
    previousAmount: unknown;
    newAmount: unknown;
    actorId?: string | null;
    actorName?: string | null;
}

const toAmount = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/**
 * A deal amount changed (requested amount, offer / funded amount, terms offer).
 * Goes to the deal team (Agent + Underwriter) and every Super Admin; the actor is skipped.
 */
export async function notifyApplicationAmountChanged(ctx: AmountChangeContext): Promise<void> {
    const app = ctx.application;
    if (!app?.id) return;
    const prev = toAmount(ctx.previousAmount);
    const next = toAmount(ctx.newAmount);
    if (next === null || prev === next) return;

    const appRef = app.applicationId ? ` #${app.applicationId}` : '';
    const actor = String(ctx.actorName || '').trim();
    const by = actor ? ` Updated by ${actor}.` : '';

    await createAndPushNotifications(
        dealTeamRecipientIds(app).map((id) => ({ id, email: null, name: '' })),
        {
            title: `${ctx.label} ${prev === null ? 'set' : 'updated'} on application${appRef}`,
            message:
                prev === null
                    ? `${ctx.label} for ${clientNameOf(app)} set to ${formatMoney(next)}.${by}`
                    : `${ctx.label} for ${clientNameOf(app)} changed from ${formatMoney(prev)} to ${formatMoney(next)}.${by}`,
            type: 'application_amount_update',
            applicationId: app.id,
            createdById: ctx.actorId ? String(ctx.actorId) : null,
            importance: 'high',
        },
        app,
    );
}

/** Fire-and-forget wrapper — never throws to callers. */
export function scheduleApplicationAmountNotification(ctx: AmountChangeContext): void {
    setImmediate(() => {
        void notifyApplicationAmountChanged(ctx).catch((err) => {
            console.error('[amountNotification] failed:', err);
        });
    });
}

/** Load the fields notification recipients / copy need, by application UUID. */
export async function loadApplicationNotificationRecord(
    applicationUuid: string,
): Promise<ApplicationNotificationRecord | null> {
    if (!applicationUuid) return null;
    return prisma.application
        .findUnique({
            where: { id: applicationUuid },
            select: {
                id: true,
                applicationId: true,
                currentQueue: true,
                currentState: true,
                referringAgentId: true,
                salesRepresentativeId: true,
                createdById: true,
                assignedUnderwriterId: true,
                approvedByUnderwriterId: true,
                client: { select: { businessName: true, ownerFirstName: true, ownerLastName: true } },
            },
        })
        .catch(() => null);
}
