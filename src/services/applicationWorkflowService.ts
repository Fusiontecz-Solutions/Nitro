/**
 * Agent / Underwriter workflow: role-scoped queues, dashboards and stage
 * transitions (see constants/applicationWorkflow.ts for the full flow).
 *
 * Every transition is a conditional `updateMany` keyed on the current queue, so
 * two users acting at once cannot both win (same pattern as the Underwriter claim).
 */
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import prisma from '../config/prismaClient';
import {
    AGENT_BUCKETS,
    AGENT_REVIEW_QUEUES,
    CONTRACT_STAGE_QUEUES,
    UNDERWRITER_ACTION_SENT_TO_AGENT,
    UNDERWRITER_BUCKETS,
    WORKFLOW_QUEUE,
    WORKFLOW_STATE,
    isAgentReviewQueue,
    isQueue,
    type AgentBucket,
    type UnderwriterBucket,
} from '../constants/applicationWorkflow';
import { hasContractsLogAccess, normalizeRoleValue } from '../constants/roles';
import { createApplicationActivityLog } from './applicationActivityLogService';
import type { AuthenticatedUser } from './applicationService';
import { scheduleWorkflowNotification } from './applicationStageNotificationService';
import { invalidateAllApplicationStatsCache } from './applicationStatsCache';

export class WorkflowError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly code?: string,
    ) {
        super(message);
    }
}

export type WorkflowScope = 'agent' | 'underwriter';

const queueIn = (queues: readonly string[]): Prisma.ApplicationWhereInput => ({
    OR: queues.map((q) => ({ currentQueue: { equals: q, mode: 'insensitive' as const } })),
});

const LIVE: Prisma.ApplicationWhereInput = { deletedAt: null };

const needsReReviewWhere: Prisma.ApplicationWhereInput = {
    currentState: { equals: WORKFLOW_STATE.NEEDS_RE_REVIEW, mode: 'insensitive' },
};

const agentOwnershipWhere = (userId: string): Prisma.ApplicationWhereInput => ({
    OR: [{ referringAgentId: userId }, { createdById: userId }],
});

const underwriterTouchedWhere = (userId: string): Prisma.ApplicationWhereInput => ({
    OR: [{ assignedUnderwriterId: userId }, { approvedByUnderwriterId: userId }],
});

/** `userId` null = Super Admin oversight (no ownership filter). */
export function buildAgentBucketWhere(bucket: AgentBucket, userId: string | null): Prisma.ApplicationWhereInput {
    const and: Prisma.ApplicationWhereInput[] = [LIVE];
    if (userId) and.push(agentOwnershipWhere(userId));
    else and.push({ OR: [{ referringAgent: { role: 'AGENT' } }, { createdBy: { role: 'AGENT' } }] });
    switch (bucket) {
        case 'drafts':
            and.push(queueIn([WORKFLOW_QUEUE.AGENT_DRAFT, 'New']));
            break;
        case 'in_underwriting':
            and.push(queueIn([WORKFLOW_QUEUE.UNDERWRITER]));
            break;
        case 'awaiting_my_approval':
            and.push(queueIn(AGENT_REVIEW_QUEUES));
            break;
        case 'sent_to_iso':
            and.push(queueIn([WORKFLOW_QUEUE.APPROVAL_SENT]));
            break;
        case 'contract_pending':
            and.push(queueIn(CONTRACT_STAGE_QUEUES));
            break;
        default:
            break;
    }
    return { AND: and };
}

export function buildUnderwriterBucketWhere(
    bucket: UnderwriterBucket,
    userId: string | null,
): Prisma.ApplicationWhereInput {
    const and: Prisma.ApplicationWhereInput[] = [LIVE];
    switch (bucket) {
        case 'incoming':
            and.push(queueIn([WORKFLOW_QUEUE.UNDERWRITER]), { assignedUnderwriterId: null }, { NOT: needsReReviewWhere });
            break;
        case 'my_claimed':
            and.push(queueIn([WORKFLOW_QUEUE.UNDERWRITER]), { NOT: needsReReviewWhere });
            and.push(userId ? { assignedUnderwriterId: userId } : { NOT: { assignedUnderwriterId: null } });
            break;
        case 'needs_re_review':
            and.push(queueIn([WORKFLOW_QUEUE.UNDERWRITER]), needsReReviewWhere);
            if (userId) and.push({ OR: [{ assignedUnderwriterId: null }, underwriterTouchedWhere(userId)] });
            break;
        case 'sent_to_agent':
            and.push(queueIn(AGENT_REVIEW_QUEUES));
            if (userId) and.push(underwriterTouchedWhere(userId));
            break;
        case 'completed':
            and.push({ NOT: queueIn([WORKFLOW_QUEUE.UNDERWRITER, ...AGENT_REVIEW_QUEUES]) });
            and.push(userId ? underwriterTouchedWhere(userId) : { NOT: { approvedByUnderwriterId: null } });
            break;
        default:
            break;
    }
    return { AND: and };
}

/** Which scope a user may query. Super Admin may pick either (oversight). */
export function resolveWorkflowScope(user: AuthenticatedUser, requested?: unknown): WorkflowScope {
    const role = normalizeRoleValue(user.role);
    if (role === 'AGENT') return 'agent';
    if (role === 'UNDERWRITER') return 'underwriter';
    if (hasContractsLogAccess(role) || role === 'ADMIN') {
        return String(requested ?? '').toLowerCase() === 'underwriter' ? 'underwriter' : 'agent';
    }
    throw new WorkflowError(403, 'Your role has no workflow queue');
}

const isOversightRole = (user: AuthenticatedUser) => {
    const role = normalizeRoleValue(user.role);
    return hasContractsLogAccess(role) || role === 'ADMIN';
};

const LIST_SELECT = {
    id: true,
    applicationId: true,
    dealId: true,
    loanAmount: true,
    currentQueue: true,
    currentState: true,
    underwriterAction: true,
    createdAt: true,
    updatedAt: true,
    claimedAt: true,
    approvedAt: true,
    isoId: true,
    client: { select: { id: true, businessName: true, ownerFirstName: true, ownerLastName: true } },
    iso: { select: { id: true, name: true, email: true } },
    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
    assignedUnderwriter: { select: { id: true, firstName: true, lastName: true, email: true } },
    approvedByUnderwriter: { select: { id: true, firstName: true, lastName: true } },
    OfferDecision: { select: { offer: true, rate: true, term: true, frequency: true } },
} satisfies Prisma.ApplicationSelect;

type ListRow = Prisma.ApplicationGetPayload<{ select: typeof LIST_SELECT }>;

const personName = (p: { firstName?: string | null; lastName?: string | null } | null | undefined) =>
    p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || null : null;

const toListItem = (row: ListRow) => ({
    _id: row.id,
    id: row.id,
    applicationId: row.applicationId,
    dealId: row.dealId,
    businessName: row.client?.businessName ?? null,
    ownerName: personName({ firstName: row.client?.ownerFirstName, lastName: row.client?.ownerLastName }),
    loanAmount: row.loanAmount,
    offerAmount: row.OfferDecision?.offer ?? null,
    currentQueue: row.currentQueue,
    currentState: row.currentState,
    underwriterAction: row.underwriterAction,
    iso: row.iso,
    agent: row.referringAgent ? { id: row.referringAgent.id, name: personName(row.referringAgent), email: row.referringAgent.email } : null,
    underwriter: row.assignedUnderwriter
        ? { id: row.assignedUnderwriter.id, name: personName(row.assignedUnderwriter), email: row.assignedUnderwriter.email }
        : null,
    approvedBy: row.approvedByUnderwriter ? { id: row.approvedByUnderwriter.id, name: personName(row.approvedByUnderwriter) } : null,
    claimedAt: row.claimedAt,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const searchWhere = (search: string): Prisma.ApplicationWhereInput | null => {
    const q = search.trim();
    if (!q) return null;
    const or: Prisma.ApplicationWhereInput[] = [
        { dealId: { contains: q, mode: 'insensitive' } },
        { client: { businessName: { contains: q, mode: 'insensitive' } } },
        { client: { ownerFirstName: { contains: q, mode: 'insensitive' } } },
        { client: { ownerLastName: { contains: q, mode: 'insensitive' } } },
        { iso: { name: { contains: q, mode: 'insensitive' } } },
    ];
    if (/^\d+$/.test(q)) or.push({ applicationId: Number(q) });
    return { OR: or };
};

export async function listWorkflowQueue(
    user: AuthenticatedUser,
    params: { scope?: unknown; bucket?: unknown; page?: unknown; limit?: unknown; search?: unknown },
) {
    const scope = resolveWorkflowScope(user, params.scope);
    const ownerId = isOversightRole(user) ? null : user.id;
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));

    let where: Prisma.ApplicationWhereInput;
    let bucket: string;
    if (scope === 'agent') {
        const requested = String(params.bucket ?? 'all') as AgentBucket;
        bucket = (AGENT_BUCKETS as readonly string[]).includes(requested) ? requested : 'all';
        where = buildAgentBucketWhere(bucket as AgentBucket, ownerId);
    } else {
        const requested = String(params.bucket ?? 'incoming') as UnderwriterBucket;
        bucket = (UNDERWRITER_BUCKETS as readonly string[]).includes(requested) ? requested : 'incoming';
        where = buildUnderwriterBucketWhere(bucket as UnderwriterBucket, ownerId);
    }
    const search = searchWhere(String(params.search ?? ''));
    if (search) where = { AND: [where, search] };

    const [rows, total] = await Promise.all([
        prisma.application.findMany({
            where,
            select: LIST_SELECT,
            orderBy: { updatedAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.application.count({ where }),
    ]);

    return {
        scope,
        bucket,
        items: rows.map(toListItem),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
}

/** Optional `createdAt` window (YYYY-MM-DD, inclusive) for the dashboard date filter. */
function createdAtRangeWhere(range?: { startDate?: unknown; endDate?: unknown }): Prisma.ApplicationWhereInput | null {
    const parse = (v: unknown, endOfDay: boolean) => {
        const raw = String(v ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
        const d = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
        return Number.isNaN(d.getTime()) ? null : d;
    };
    const gte = parse(range?.startDate, false);
    const lte = parse(range?.endDate, true);
    if (!gte && !lte) return null;
    return { createdAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } };
}

const withRange = (where: Prisma.ApplicationWhereInput, range: Prisma.ApplicationWhereInput | null) =>
    range ? { AND: [where, range] } : where;

export async function getWorkflowSummary(
    user: AuthenticatedUser,
    requestedScope?: unknown,
    range?: { startDate?: unknown; endDate?: unknown },
) {
    const scope = resolveWorkflowScope(user, requestedScope);
    const ownerId = isOversightRole(user) ? null : user.id;
    const buckets: readonly string[] = scope === 'agent' ? AGENT_BUCKETS : UNDERWRITER_BUCKETS;
    const rangeWhere = createdAtRangeWhere(range);
    const bucketWhere = (b: string) =>
        withRange(
            scope === 'agent'
                ? buildAgentBucketWhere(b as AgentBucket, ownerId)
                : buildUnderwriterBucketWhere(b as UnderwriterBucket, ownerId),
            rangeWhere,
        );

    const aggregates = await Promise.all(
        buckets.map((b) =>
            prisma.application.aggregate({ where: bucketWhere(b), _count: { _all: true }, _sum: { loanAmount: true } }),
        ),
    );

    const recentWhere = withRange(
        scope === 'agent'
            ? buildAgentBucketWhere('all', ownerId)
            : ownerId
              ? { AND: [LIVE, { OR: [buildUnderwriterBucketWhere('incoming', null), underwriterTouchedWhere(ownerId)] }] }
              : buildUnderwriterBucketWhere('incoming', null),
        rangeWhere,
    );

    const [recent, trendRows] = await Promise.all([
        prisma.application.findMany({
            where: recentWhere,
            select: LIST_SELECT,
            orderBy: { updatedAt: 'desc' },
            take: 8,
        }),
        prisma.application.findMany({
            where: recentWhere,
            select: { createdAt: true, loanAmount: true, approvedAt: true },
            orderBy: { createdAt: 'asc' },
            take: 5000,
        }),
    ]);

    // Monthly trend: submitted vs underwriter-approved loan amounts (UTC month buckets).
    const trendMap = new Map<string, { submitted: number; approved: number }>();
    const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    for (const row of trendRows) {
        const amount = Number(row.loanAmount ?? 0) || 0;
        const k = monthKey(row.createdAt);
        const entry = trendMap.get(k) ?? { submitted: 0, approved: 0 };
        entry.submitted += amount;
        if (row.approvedAt) entry.approved += amount;
        trendMap.set(k, entry);
    }
    const trend = Array.from(trendMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dateKey, v]) => ({ dateKey, ...v }));

    return {
        scope,
        counts: Object.fromEntries(buckets.map((b, i) => [b, aggregates[i]._count._all])),
        amounts: Object.fromEntries(buckets.map((b, i) => [b, Number(aggregates[i]._sum.loanAmount ?? 0) || 0])),
        recent: recent.map(toListItem),
        trend,
    };
}

/* ------------------------------ Transitions ------------------------------ */

type TransitionApp = {
    id: string;
    applicationId: number;
    currentQueue: string;
    currentState: string;
    isoId: string | null;
    referringAgentId: string | null;
    createdById: string | null;
    salesRepresentativeId: string;
    assignedUnderwriterId: string | null;
    approvedByUnderwriterId: string | null;
    client: { businessName: string | null; ownerFirstName: string | null; ownerLastName: string | null } | null;
};

const TRANSITION_SELECT = {
    id: true,
    applicationId: true,
    currentQueue: true,
    currentState: true,
    isoId: true,
    referringAgentId: true,
    createdById: true,
    salesRepresentativeId: true,
    assignedUnderwriterId: true,
    approvedByUnderwriterId: true,
    deletedAt: true,
    client: { select: { businessName: true, ownerFirstName: true, ownerLastName: true } },
} satisfies Prisma.ApplicationSelect;

async function loadTransitionApp(applicationRef: string): Promise<TransitionApp> {
    const ref = String(applicationRef ?? '').trim();
    const where: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(ref) ? { applicationId: Number(ref) } : { id: ref };
    const app = await prisma.application.findUnique({ where, select: TRANSITION_SELECT }).catch(() => null);
    if (!app || app.deletedAt) throw new WorkflowError(404, 'Application not found');
    return app;
}

const isAgentOwner = (app: TransitionApp, userId: string) =>
    app.referringAgentId === userId || app.createdById === userId;

const agentRecipientId = (app: TransitionApp) => app.referringAgentId || app.createdById;

const businessLabel = (app: TransitionApp) => app.client?.businessName || `application #${app.applicationId}`;

async function logTransition(args: {
    app: TransitionApp;
    user: AuthenticatedUser;
    req?: Request;
    actionType: 'SUBMITTED_TO_UNDERWRITING' | 'SENT_TO_AGENT_APPROVAL' | 'RETURNED_TO_UNDERWRITER';
    description: string;
    nextQueue: string;
    nextState: string;
    metadata?: Record<string, unknown>;
}) {
    try {
        await createApplicationActivityLog({
            applicationId: args.app.id,
            user: args.user,
            req: args.req ?? null,
            actionType: args.actionType,
            actionDescription: args.description,
            previousStatus: `${args.app.currentQueue} / ${args.app.currentState}`,
            currentStatus: `${args.nextQueue} / ${args.nextState}`,
            metadata: { queue: args.nextQueue, state: args.nextState, ...(args.metadata ?? {}) },
        });
    } catch (err) {
        console.error(`Failed to log ${args.actionType}:`, err);
    }
}

async function underwriterIds(): Promise<string[]> {
    const rows = await prisma.user.findMany({ where: { role: 'UNDERWRITER', isActive: true }, select: { id: true } });
    return rows.map((r) => r.id);
}

async function conditionalMove(
    app: TransitionApp,
    expectedQueues: string[],
    data: Prisma.ApplicationUncheckedUpdateManyInput,
    extraWhere: Prisma.ApplicationWhereInput = {},
) {
    const result = await prisma.application.updateMany({
        where: { AND: [{ id: app.id }, queueIn(expectedQueues), extraWhere] },
        data,
    });
    if (result.count === 0) {
        throw new WorkflowError(409, 'This application was updated by someone else. Refresh and try again.');
    }
    invalidateAllApplicationStatsCache();
}

/** Agent (or Super Admin) moves a draft into the Underwriter pool. */
export async function submitToUnderwriting(applicationRef: string, user: AuthenticatedUser, actorName: string, req?: Request) {
    const app = await loadTransitionApp(applicationRef);
    const role = normalizeRoleValue(user.role);
    if (role === 'AGENT' && !isAgentOwner(app, user.id)) throw new WorkflowError(403, 'Forbidden');
    if (!isQueue(app.currentQueue, WORKFLOW_QUEUE.AGENT_DRAFT) && !isQueue(app.currentQueue, 'New')) {
        throw new WorkflowError(400, 'Only draft applications can be submitted to underwriting.');
    }
    if (!app.isoId) {
        throw new WorkflowError(400, 'Link an ISO to this application before submitting it to underwriting.', 'ISO_REQUIRED');
    }

    await conditionalMove(app, [WORKFLOW_QUEUE.AGENT_DRAFT, 'New'], {
        currentQueue: WORKFLOW_QUEUE.UNDERWRITER,
        currentState: WORKFLOW_STATE.IN_PROGRESS,
        assignedUnderwriterId: null,
    });

    await logTransition({
        app,
        user,
        req,
        actionType: 'SUBMITTED_TO_UNDERWRITING',
        description: `${actorName || 'Agent'} submitted the application to underwriting.`,
        nextQueue: WORKFLOW_QUEUE.UNDERWRITER,
        nextState: WORKFLOW_STATE.IN_PROGRESS,
    });
    notifyNewInUnderwriterPool(app, user.id);
}

/** In-app alert to every active Underwriter that a new deal is waiting to be claimed. */
export function notifyNewInUnderwriterPool(
    app: Pick<TransitionApp, 'id' | 'applicationId' | 'client'>,
    actorId: string | null,
) {
    void underwriterIds()
        .then((ids) =>
            scheduleWorkflowNotification({
                application: { id: app.id, applicationId: app.applicationId, client: app.client },
                recipientIds: ids,
                title: 'New application ready for underwriting',
                message: `${app.client?.businessName || `Application #${app.applicationId}`} is waiting to be claimed.`,
                actorId,
                importance: 'high',
            }),
        )
        .catch((err) => console.error('Failed to notify underwriters:', err));
}

async function assertUnderwritingComplete(applicationId: string) {
    const [offerDecision, termsOffers] = await Promise.all([
        prisma.offerDecision.findUnique({ where: { applicationId }, select: { id: true } }).catch(() => null),
        prisma.termsOffer.count({ where: { applicationId } }),
    ]);
    if (!offerDecision && termsOffers === 0) {
        throw new WorkflowError(
            400,
            'Create the offer (Create Offer tab) before sending the application to the Agent.',
            'OFFER_REQUIRED',
        );
    }
}

/** Underwriter hands the underwritten deal back to the Agent for approval. */
export async function sendToAgentApproval(
    applicationRef: string,
    user: AuthenticatedUser,
    actorName: string,
    note: string,
    req?: Request,
) {
    const app = await loadTransitionApp(applicationRef);
    const role = normalizeRoleValue(user.role);
    if (!isQueue(app.currentQueue, WORKFLOW_QUEUE.UNDERWRITER)) {
        throw new WorkflowError(400, 'Only applications in the Underwriter stage can be sent to the Agent.');
    }
    if (role === 'UNDERWRITER' && app.assignedUnderwriterId !== user.id) {
        throw new WorkflowError(403, 'Claim this application before sending it to the Agent.', 'CLAIM_REQUIRED');
    }
    if (!agentRecipientId(app)) {
        throw new WorkflowError(400, 'This application has no Agent to send it to.');
    }
    await assertUnderwritingComplete(app.id);

    const approverId = role === 'UNDERWRITER' ? user.id : app.assignedUnderwriterId;
    await conditionalMove(
        app,
        [WORKFLOW_QUEUE.UNDERWRITER],
        {
            currentQueue: WORKFLOW_QUEUE.AGENT_APPROVAL,
            currentState: WORKFLOW_STATE.AGENT_APPROVAL,
            approvedAt: new Date(),
            underwriterAction: UNDERWRITER_ACTION_SENT_TO_AGENT,
            ...(approverId ? { approvedByUnderwriterId: approverId } : {}),
        },
        role === 'UNDERWRITER' ? { assignedUnderwriterId: user.id } : {},
    );

    await logTransition({
        app,
        user,
        req,
        actionType: 'SENT_TO_AGENT_APPROVAL',
        description: `${actorName || 'Underwriter'} completed underwriting and sent the application to the Agent for approval.`,
        nextQueue: WORKFLOW_QUEUE.AGENT_APPROVAL,
        nextState: WORKFLOW_STATE.AGENT_APPROVAL,
        metadata: note ? { note } : undefined,
    });

    scheduleWorkflowNotification({
        application: { id: app.id, applicationId: app.applicationId, client: app.client },
        recipientIds: [agentRecipientId(app)],
        title: 'Application ready for your approval',
        message: `Underwriting is complete for ${businessLabel(app)}. Review it and send it to the ISO for approval.${note ? ` Note: ${note}` : ''}`,
        actorId: user.id,
        importance: 'high',
    });
}

/** Agent sends the deal back to the same Underwriter with requested changes. */
export async function returnToUnderwriter(
    applicationRef: string,
    user: AuthenticatedUser,
    actorName: string,
    note: string,
    req?: Request,
) {
    const app = await loadTransitionApp(applicationRef);
    const role = normalizeRoleValue(user.role);
    if (role === 'AGENT' && !isAgentOwner(app, user.id)) throw new WorkflowError(403, 'Forbidden');
    if (!isAgentReviewQueue(app.currentQueue)) {
        throw new WorkflowError(400, 'Only applications awaiting Agent approval can be returned to underwriting.');
    }
    if (!note.trim()) throw new WorkflowError(400, 'Describe what the Underwriter needs to change.');

    // Hand it back to the Underwriter who did the work, already claimed, so it lands in their Needs Re-Review list.
    const recipient = app.assignedUnderwriterId || app.approvedByUnderwriterId;
    await conditionalMove(app, [...AGENT_REVIEW_QUEUES], {
        currentQueue: WORKFLOW_QUEUE.UNDERWRITER,
        currentState: WORKFLOW_STATE.NEEDS_RE_REVIEW,
        ...(recipient ? { assignedUnderwriterId: recipient } : {}),
    });

    await logTransition({
        app,
        user,
        req,
        actionType: 'RETURNED_TO_UNDERWRITER',
        description: `${actorName || 'Agent'} returned the application to underwriting: ${note.trim()}`,
        nextQueue: WORKFLOW_QUEUE.UNDERWRITER,
        nextState: WORKFLOW_STATE.NEEDS_RE_REVIEW,
        metadata: { note: note.trim() },
    });

    if (recipient) {
        scheduleWorkflowNotification({
            application: { id: app.id, applicationId: app.applicationId, client: app.client },
            recipientIds: [recipient],
            title: 'Agent requested changes',
            message: `${businessLabel(app)} was returned to underwriting: ${note.trim()}`,
            actorId: user.id,
            importance: 'high',
        });
    } else {
        notifyNewInUnderwriterPool(app, user.id);
    }
}
