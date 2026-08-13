import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import {
    mergeApplicationVisibilityWhere,
    type AuthenticatedUser,
} from './applicationService';
import {
    buildOperationsStatusFilterWhere,
    contractGeneratedStrictMatchWhere,
    contractPendingStrictMatchWhere,
    contractSentStrictMatchWhere,
    excludeSoftDeletedWhere,
    normalizeOperationsStatusKey,
    resolveOperationsListFilterMode,
    signedContractsStrictMatchWhere,
    type OperationsStatusFilterMode,
} from './operationsStatusFilter';
import { aggregateQueueMetricsByCurrentQueue } from './operationsDashboardQueueMetricsService';
import { reconcileStaleContractReinitiationFlags } from './contractReinitiationService';

function buildRoleDefaultWhere(authUser: AuthenticatedUser | null): Prisma.ApplicationWhereInput {
    if (!authUser) {
        return { id: '00000000-0000-0000-0000-000000000000' };
    }
    return {};
}

function combineWhere(
    base: Prisma.ApplicationWhereInput,
    extra?: Prisma.ApplicationWhereInput,
): Prisma.ApplicationWhereInput {
    if (!extra) return base;
    return { AND: [base, extra] };
}

async function countApplicationsForPipelineStage(
    authUser: AuthenticatedUser | null,
    operationsStatus: string,
): Promise<number> {
    const visibilityBase = mergeApplicationVisibilityWhere(
        authUser ? {} : { id: '00000000-0000-0000-0000-000000000000' },
        authUser,
    );
    const mode = resolveOperationsListFilterMode(authUser?.role ?? null);
    const stageWhere = buildOperationsStatusFilterWhere(operationsStatus, mode);
    const canonical = normalizeOperationsStatusKey(operationsStatus);
    const excludeDeleted =
        canonical === 'Recently_Deleted' ? undefined : excludeSoftDeletedWhere();
    return prisma.application.count({
        where: combineWhere(combineWhere(visibilityBase, stageWhere), excludeDeleted),
    });
}

function viewerMode(authUser: AuthenticatedUser | null): OperationsStatusFilterMode {
    return resolveOperationsListFilterMode(authUser?.role ?? null);
}

function isSuperAdminRole(role: string | null | undefined): boolean {
    const normalized = String(role ?? '')
        .trim()
        .toUpperCase()
        .replace(/-/g, '_');
    return normalized === 'SUPER_ADMIN' || normalized === 'SUPERADMIN';
}

export type OperationsDashboardSummaryPayload = {
    summaryCounts: {
        totalCases: number;
        contractPending: number;
        contractGenerated: number;
        contractsOut: number;
        signedContracts: number;
        fundingCall: number;
        disbursment: number;
        funded: number;
    };
    summaryAmounts: {
        contractPending: number;
        contractsOut: number;
        signedContracts: number;
        fundingCall: number;
        disbursment: number;
        funded: number;
    };
    caseStageCounts: Record<string, number>;
    caseStageAmounts: Record<string, number>;
    /** How pipeline filters were applied (for debugging / future UI). */
    operationsMetricsMode: OperationsStatusFilterMode;
};

export type OperationsDashboardRecentCasePayload = Array<{
    _id: string;
    applicationId: number | null;
    client: {
        _id: string;
        clientId: number | null;
        business: { name: string; email: string };
        owner: { firstName: string; lastName: string; email: string };
    } | null;
    loanAmount: number | null;
    currentQueue: string | null;
    currentState: string | null;
    createdAt: Date;
    updatedAt: Date;
}>;

/**
 * Operations dashboard totals: counts and funded amounts grouped by `Application.currentQueue`.
 * Amounts use `Position.fundedAmount` (sum per application), with `loanAmount` fallback.
 */
export async function aggregateOperationsDashboardSummary(
    authUser: AuthenticatedUser | null,
): Promise<OperationsDashboardSummaryPayload> {
    const mode = viewerMode(authUser);
    try {
        await reconcileStaleContractReinitiationFlags();
    } catch (reconcileErr) {
        console.error('[operationsDashboard] reconcile stale reinitiation flags failed:', reconcileErr);
    }
    const queueMetrics = await aggregateQueueMetricsByCurrentQueue(authUser);
    const { counts, amounts, totalCases } = queueMetrics;

    const [
        agentCount,
        scrubbingCount,
        underwriterCount,
        approvedByUwCount,
        approvalSentCount,
        approvedByIsoCount,
        finalApprovalCount,
        finalCount,
        reinitiateContractCount,
        contractPendingCount,
        contractSentCount,
        signedContractCount,
        onHoldCount,
        recentlyDeletedCount,
    ] = await Promise.all([
        countApplicationsForPipelineStage(authUser, 'Agent'),
        countApplicationsForPipelineStage(authUser, 'Scrubbing'),
        countApplicationsForPipelineStage(authUser, 'Underwriter'),
        countApplicationsForPipelineStage(authUser, 'Approved_By_UW'),
        countApplicationsForPipelineStage(authUser, 'Approval_Sent'),
        countApplicationsForPipelineStage(authUser, 'Approved_By_ISO'),
        countApplicationsForPipelineStage(authUser, 'Final_Approval'),
        countApplicationsForPipelineStage(authUser, 'Final'),
        countApplicationsForPipelineStage(authUser, 'Reinitiate_Contract'),
        countApplicationsForPipelineStage(authUser, 'Contract_Pending'),
        countApplicationsForPipelineStage(authUser, 'Contract_Sent'),
        countApplicationsForPipelineStage(authUser, 'Contract_Signed'),
        countApplicationsForPipelineStage(authUser, 'On_Hold'),
        countApplicationsForPipelineStage(authUser, 'Recently_Deleted'),
    ]);

    // Use the same strict pipeline matchers as GET /applications?operationsStatus=…
    // so sidebar badges match the filtered list (queue-only metrics can over-count).
    const contractPending = contractPendingCount;
    const contractsOut = contractSentCount;
    const signedContracts = signedContractCount;
    const fundingCall = counts['Funding Call'];
    const disbursment = counts.Disbursment;
    const funded = counts.Funded;

    return {
        summaryCounts: {
            totalCases,
            contractPending,
            contractGenerated: 0,
            contractsOut,
            signedContracts,
            fundingCall,
            disbursment,
            funded,
        },
        summaryAmounts: {
            contractPending: amounts.Contract_Pending,
            contractsOut: amounts.Contract_Sent,
            signedContracts: amounts.Contract_Signed,
            fundingCall: amounts['Funding Call'],
            disbursment: amounts.Disbursment,
            funded: amounts.Funded,
        },
        caseStageCounts: {
            Agent: agentCount,
            Scrubbing: scrubbingCount,
            'Underwriter': underwriterCount,
            Approved_By_UW: approvedByUwCount,
            Approval_Sent: approvalSentCount,
            Approved_By_ISO: approvedByIsoCount,
            Final_Approval: finalApprovalCount,
            Contracted: signedContracts,
            'Contract_Pending': contractPending,
            Contract_Sent: contractsOut,
            Contract_Signed: signedContracts,
            Reinitiate_Contract: reinitiateContractCount,
            Final: finalCount,
            'Funding Call': fundingCall,
            On_Hold: onHoldCount,
            Disbursment: disbursment,
            Funded: funded,
            Declined: counts.Declined,
            Recently_Deleted: recentlyDeletedCount,
        },
        caseStageAmounts: {
            Agent: amounts.Agent,
            Scrubbing: amounts.Scrubbing,
            'Underwriter': amounts['Underwriter'],
            Contracted: amounts.Contract_Signed,
            'Contract_Pending': amounts.Contract_Pending,
            Contract_Sent: amounts.Contract_Sent,
            Contract_Signed: amounts.Contract_Signed,
            Final: amounts.Final,
            'Funding Call': amounts['Funding Call'],
            Disbursment: amounts.Disbursment,
            Funded: amounts.Funded,
            Declined: amounts.Declined,
        },
        operationsMetricsMode: mode,
    };
}

export async function listOperationsDashboardRecentCases(
    authUser: AuthenticatedUser | null,
    limit = 200,
): Promise<OperationsDashboardRecentCasePayload> {
    const roleBase = buildRoleDefaultWhere(authUser);
    const visibilityBase = mergeApplicationVisibilityWhere(roleBase, authUser);
    const mode = viewerMode(authUser);
    const filterMode: OperationsStatusFilterMode = mode === 'queue' ? 'queue' : 'legacy';
    const isSuperAdmin = isSuperAdminRole(authUser?.role);
    const roleUpper = String(authUser?.role ?? '')
        .trim()
        .toUpperCase()
        .replace(/-/g, '_');
    const isOperations = roleUpper === 'OPERATIONS';
    // SUPER_ADMIN and OPERATIONS: latest Contract Signed applications.
    const recentDealsWhere =
        isSuperAdmin || isOperations
            ? buildOperationsStatusFilterWhere('Contract_Signed', filterMode)
            : buildOperationsStatusFilterWhere('Contracted', filterMode);
    const where = combineWhere(
        combineWhere(visibilityBase, recentDealsWhere),
        excludeSoftDeletedWhere(),
    );
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 500) : 200;

    const rows = await prisma.application.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: safeLimit,
        select: {
            id: true,
            applicationId: true,
            loanAmount: true,
            currentQueue: true,
            currentState: true,
            createdAt: true,
            updatedAt: true,
            client: {
                select: {
                    id: true,
                    clientId: true,
                    businessName: true,
                    businessEmail: true,
                    ownerFirstName: true,
                    ownerLastName: true,
                    ownerEmail: true,
                },
            },
        },
    });

    return rows.map((row) => ({
        _id: row.id,
        applicationId: row.applicationId ?? null,
        client: row.client
            ? {
                _id: row.client.id,
                clientId: row.client.clientId ?? null,
                business: {
                    name: row.client.businessName || '-',
                    email: row.client.businessEmail || '-',
                },
                owner: {
                    firstName: row.client.ownerFirstName || '',
                    lastName: row.client.ownerLastName || '',
                    email: row.client.ownerEmail || '',
                },
            }
            : null,
        loanAmount: row.loanAmount ?? null,
        currentQueue: row.currentQueue ?? null,
        currentState: row.currentState ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }));
}

export type OperationsPaymentPerformancePeriod = 'daily' | 'weekly' | 'monthly';

export type OperationsPaymentPerformancePoint = {
    label: string;
    /** Contract Pending offer/approved amounts. */
    pending: number;
    /** Contract Signed offer/approved amounts. */
    approved: number;
};

function toFiniteAmount(value: unknown): number | null {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'object' && value !== null) {
        const decimalLike = value as { toNumber?: () => number; toFixed?: (digits?: number) => string };
        if (typeof decimalLike.toNumber === 'function') {
            const n = Number(decimalLike.toNumber());
            return Number.isFinite(n) ? n : null;
        }
        if (typeof decimalLike.toFixed === 'function') {
            const n = Number(decimalLike.toFixed(20));
            return Number.isFinite(n) ? n : null;
        }
    }
    const s = String(value).replace(/[$,\s]/g, '').trim();
    if (!s) return null;
    const num = Number(s);
    return Number.isFinite(num) ? num : null;
}

function firstPositiveAmount(...values: Array<number | null | undefined>): number {
    for (const value of values) {
        if (value != null && value > 0) return value;
    }
    return 0;
}

function startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addLocalDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function formatDayLabel(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMonthLabel(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short' });
}

function compactWorkflowToken(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
}

const SIGNED_CONTRACT_TOKENS = new Set([
    'contractsigned',
    'signedcontracts',
    'signedcontract',
]);

const PENDING_CONTRACT_TOKENS = new Set([
    'contractpending',
    'contractgenerated',
    'contractsent',
    'contractout',
    'contractsout',
]);

function classifyContractMoneyStage(
    currentQueue: string | null | undefined,
    currentState: string | null | undefined,
): 'pending' | 'approved' | null {
    const queueToken = compactWorkflowToken(currentQueue);
    const stateToken = compactWorkflowToken(currentState);

    if (SIGNED_CONTRACT_TOKENS.has(queueToken) || SIGNED_CONTRACT_TOKENS.has(stateToken)) {
        return 'approved';
    }

    if (PENDING_CONTRACT_TOKENS.has(queueToken) || PENDING_CONTRACT_TOKENS.has(stateToken)) {
        return 'pending';
    }

    return null;
}

function buildPaymentPerformanceBuckets(
    period: OperationsPaymentPerformancePeriod,
    now = new Date(),
): Array<{ key: string; label: string; start: Date; end: Date }> {
    if (period === 'daily') {
        const today = startOfLocalDay(now);
        return Array.from({ length: 14 }, (_, index) => {
            const day = addLocalDays(today, index - 13);
            const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
            return {
                key,
                label: formatDayLabel(day),
                start: day,
                end: endOfLocalDay(day),
            };
        });
    }

    if (period === 'weekly') {
        const today = startOfLocalDay(now);
        const dayOfWeek = today.getDay(); // 0 = Sunday
        const thisWeekStart = addLocalDays(today, -dayOfWeek);
        return Array.from({ length: 8 }, (_, index) => {
            const weekStart = addLocalDays(thisWeekStart, (index - 7) * 7);
            const weekEnd = endOfLocalDay(addLocalDays(weekStart, 6));
            const key = `${weekStart.getFullYear()}-W${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
            return {
                key,
                label: `${formatDayLabel(weekStart)}–${formatDayLabel(weekEnd)}`,
                start: weekStart,
                end: weekEnd > now ? endOfLocalDay(now) : weekEnd,
            };
        });
    }

    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return Array.from({ length: 6 }, (_, index) => {
        const monthStart = new Date(
            thisMonthStart.getFullYear(),
            thisMonthStart.getMonth() - (5 - index),
            1,
            0,
            0,
            0,
            0,
        );
        const monthEnd = endOfLocalDay(
            new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0),
        );
        const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
        return {
            key,
            label: formatMonthLabel(monthStart),
            start: monthStart,
            end: monthEnd > now ? endOfLocalDay(now) : monthEnd,
        };
    });
}

/**
 * Payment Performance chart: Contract Pending vs Contract Signed money,
 * bucketed by daily / weekly / monthly windows.
 */
export async function aggregateOperationsPaymentPerformanceTrend(
    authUser: AuthenticatedUser | null,
    period: OperationsPaymentPerformancePeriod,
): Promise<OperationsPaymentPerformancePoint[]> {
    const buckets = buildPaymentPerformanceBuckets(period);
    const rangeStart = buckets[0]?.start;
    const rangeEnd = buckets[buckets.length - 1]?.end;
    if (!rangeStart || !rangeEnd) {
        return [];
    }

    const visibilityBase = mergeApplicationVisibilityWhere(
        authUser ? {} : { id: '00000000-0000-0000-0000-000000000000' },
        authUser,
    );
    const stageWhere: Prisma.ApplicationWhereInput = {
        OR: [
            contractPendingStrictMatchWhere(),
            contractGeneratedStrictMatchWhere(),
            contractSentStrictMatchWhere(),
            signedContractsStrictMatchWhere(),
        ],
    };
    const where = combineWhere(
        combineWhere(visibilityBase, stageWhere),
        excludeSoftDeletedWhere(),
    );

    const apps = await prisma.application.findMany({
        where,
        select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            loanAmount: true,
            currentQueue: true,
            currentState: true,
        },
    });

    const totals = new Map<string, { pending: number; approved: number }>(
        buckets.map((bucket) => [bucket.key, { pending: 0, approved: 0 }]),
    );

    if (apps.length === 0) {
        return buckets.map((bucket) => ({
            label: bucket.label,
            pending: 0,
            approved: 0,
        }));
    }

    const appIds = apps.map((app) => app.id);
    const [offerDecisions, termsOffers, contracts] = await Promise.all([
        prisma.offerDecision.findMany({
            where: { applicationId: { in: appIds } },
            select: { applicationId: true, offer: true, decision: true },
        }),
        prisma.termsOffer.findMany({
            where: { applicationId: { in: appIds } },
            select: { applicationId: true, approvedAmount: true },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.contract.findMany({
            where: { applicationId: { in: appIds } },
            select: { applicationId: true, approvedAmount: true },
        }),
    ]);

    const offerDecisionByApp = new Map(
        offerDecisions.map((row) => [row.applicationId, row]),
    );
    const latestTermsByApp = new Map<string, number | null>();
    for (const row of termsOffers) {
        if (!latestTermsByApp.has(row.applicationId)) {
            latestTermsByApp.set(row.applicationId, toFiniteAmount(row.approvedAmount));
        }
    }
    const contractByApp = new Map<string, number | null>();
    for (const row of contracts) {
        if (row.applicationId && !contractByApp.has(row.applicationId)) {
            contractByApp.set(row.applicationId, toFiniteAmount(row.approvedAmount));
        }
    }

    const findBucket = (stamp: number) =>
        buckets.find(
            (item) => stamp >= item.start.getTime() && stamp <= item.end.getTime(),
        );

    for (const app of apps) {
        const updatedStamp = app.updatedAt.getTime();
        const createdStamp = app.createdAt.getTime();
        const bucket =
            findBucket(createdStamp) ??
            findBucket(updatedStamp) ??
            buckets[buckets.length - 1];
        if (!bucket) continue;

        const stage = classifyContractMoneyStage(app.currentQueue, app.currentState);
        if (!stage) continue;

        const od = offerDecisionByApp.get(app.id);
        const odOffer =
            od && String(od.decision ?? '').toLowerCase() !== 'declined'
                ? toFiniteAmount(od.offer)
                : null;
        const amount = firstPositiveAmount(
            odOffer,
            latestTermsByApp.get(app.id),
            contractByApp.get(app.id),
            toFiniteAmount(app.loanAmount),
        );
        if (!(amount > 0)) continue;

        const entry = totals.get(bucket.key);
        if (!entry) continue;

        if (stage === 'approved') {
            entry.approved += amount;
        } else {
            entry.pending += amount;
        }
    }

    return buckets.map((bucket) => {
        const entry = totals.get(bucket.key);
        return {
            label: bucket.label,
            pending: entry?.pending ?? 0,
            approved: entry?.approved ?? 0,
        };
    });
}
