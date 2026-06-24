import prisma from '../config/prismaClient';
import {
    mergeApplicationVisibilityWhere,
    type AuthenticatedUser,
} from './applicationService';

/** Canonical pipeline buckets keyed by `Application.currentQueue` (human-readable labels). */
export type QueueMetricsBucketKey =
    | 'Agent'
    | 'Underwriter'
    | 'Final Underwriter'
    | 'Contract_Pending'
    | 'Contract_Sent'
    | 'Contract_Signed'
    | 'Final'
    | 'Funding Call'
    | 'Disbursment'
    | 'Funded'
    | 'Declined';

export const QUEUE_METRICS_BUCKET_KEYS: QueueMetricsBucketKey[] = [
    'Agent',
    'Underwriter',
    'Final Underwriter',
    'Contract_Pending',
    'Contract_Sent',
    'Contract_Signed',
    'Final',
    'Funding Call',
    'Disbursment',
    'Funded',
    'Declined',
];

const CONTRACT_PENDING_QUEUES = new Set([
    'Contract Pending',
    'Contract_Pending',
    'ContractPending',
]);

const CONTRACT_SENT_QUEUES = new Set([
    'Contract Sent',
    'Contract_Sent',
    'Contract Out',
    'Contract_Out',
    'Contracts Out',
    'Contracts_Out',
    'ContractOut',
]);

const CONTRACT_SIGNED_QUEUES = new Set([
    'Contract Signed',
    'Contract_Signed',
    'Signed Contracts',
    'Signed_Contracts',
    'SignedContracts',
]);

function emptyBucketRecord(): Record<QueueMetricsBucketKey, number> {
    return {
        Agent: 0,
        Underwriter: 0,
        'Final Underwriter': 0,
        Contract_Pending: 0,
        Contract_Sent: 0,
        Contract_Signed: 0,
        Final: 0,
        'Funding Call': 0,
        Disbursment: 0,
        Funded: 0,
        Declined: 0,
    };
}

/**
 * Map a stored `currentQueue` label to a dashboard bucket.
 * Uses `currentQueue` only (no `currentState` fallback).
 */
export function classifyApplicationCurrentQueue(
    currentQueue: string | null | undefined,
): QueueMetricsBucketKey | null {
    const q = String(currentQueue ?? '').trim();
    if (!q) return null;

    if (q === 'Declined') return 'Declined';
    if (q === 'Funded' || q === 'Completed') return 'Funded';
    if (q === 'Disbursment' || q === 'Disbursement') return 'Disbursment';
    if (q === 'Final' || q === 'FINAL') return 'Final';
    if (q === 'Funding Call' || q === 'Funding_Call') return 'Funding Call';
    if (CONTRACT_SIGNED_QUEUES.has(q)) return 'Contract_Signed';
    if (CONTRACT_SENT_QUEUES.has(q)) return 'Contract_Sent';
    if (CONTRACT_PENDING_QUEUES.has(q)) return 'Contract_Pending';
    if (q === 'Final Underwriter') return 'Final Underwriter';
    if (q === 'Underwriter') return 'Underwriter';
    if (q === 'Agent') return 'Agent';

    return null;
}

export type QueueMetricsAggregate = {
    counts: Record<QueueMetricsBucketKey, number>;
    amounts: Record<QueueMetricsBucketKey, number>;
    totalCases: number;
};

/**
 * Count applications per `currentQueue` bucket and sum funded amounts from `Position.fundedAmount`
 * (falls back to `Application.loanAmount` when no position rows exist).
 */
export async function aggregateQueueMetricsByCurrentQueue(
    authUser: AuthenticatedUser | null,
): Promise<QueueMetricsAggregate> {
    const visibilityBase = mergeApplicationVisibilityWhere(
        authUser ? {} : { id: '00000000-0000-0000-0000-000000000000' },
        authUser,
    );

    const apps = await prisma.application.findMany({
        where: visibilityBase,
        select: { id: true, currentQueue: true, loanAmount: true },
    });

    const counts = emptyBucketRecord();
    const amounts = emptyBucketRecord();

    if (apps.length === 0) {
        return { counts, amounts, totalCases: 0 };
    }

    const appIds = apps.map((app) => app.id);
    const positionAgg = await prisma.position.groupBy({
        by: ['applicationId'],
        where: { applicationId: { in: appIds } },
        _sum: { fundedAmount: true },
    });

    const fundedByAppId = new Map(
        positionAgg.map((row) => [row.applicationId, Number(row._sum.fundedAmount ?? 0)]),
    );

    for (const app of apps) {
        const bucket = classifyApplicationCurrentQueue(app.currentQueue);
        if (!bucket) continue;

        counts[bucket] += 1;

        const positionFunded = fundedByAppId.get(app.id) ?? 0;
        const amount =
            positionFunded > 0 ? positionFunded : Number(app.loanAmount ?? 0);
        amounts[bucket] += amount;
    }

    return { counts, amounts, totalCases: apps.length };
}
