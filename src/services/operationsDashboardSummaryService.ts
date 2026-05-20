import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import {
    mergeApplicationVisibilityWhere,
    type AuthenticatedUser,
} from './applicationService';
import {
    buildOperationsStatusFilterWhere,
    contractsOutStrictMatchWhere,
    signedContractsStrictMatchWhere,
    resolveOperationsListFilterMode,
    type OperationsStatusFilterMode,
} from './operationsStatusFilter';

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
 * Parallel counts for the operations dashboard.
 * - OPERATIONS: most summary cards use `currentState` only; **contracts out** uses
 *   `contractsOutStrictMatchWhere`; **contract signed** uses `signedContractsStrictMatchWhere`.
 * - SUPER_ADMIN: pipeline cards and chart use `currentQueue` only.
 */
export async function aggregateOperationsDashboardSummary(
    authUser: AuthenticatedUser | null,
): Promise<OperationsDashboardSummaryPayload> {
    const roleBase = buildRoleDefaultWhere(authUser);
    const visibilityBase = mergeApplicationVisibilityWhere(roleBase, authUser);
    const mode = viewerMode(authUser);

    const summaryMode: OperationsStatusFilterMode =
        mode === 'queue' ? 'queue' : mode === 'state' ? 'state' : 'legacy';
    const chartMode: OperationsStatusFilterMode =
        mode === 'queue' ? 'queue' : 'legacy';

    const filter = (raw: string, m: OperationsStatusFilterMode) =>
        buildOperationsStatusFilterWhere(raw, m);

    const sq = (raw: string) => combineWhere(visibilityBase, filter(raw, summaryMode));
    const cq = (raw: string) => combineWhere(visibilityBase, filter(raw, chartMode));

    const countQueries = [
        prisma.application.count({ where: visibilityBase }),
        prisma.application.count({ where: sq('Contract_Pending') }),
        prisma.application.count({
            where: combineWhere(visibilityBase, contractsOutStrictMatchWhere()),
        }),
        prisma.application.count({
            where: combineWhere(visibilityBase, signedContractsStrictMatchWhere()),
        }),
        prisma.application.count({ where: sq('Funding Call') }),
        prisma.application.count({ where: sq('Disbursment') }),
        prisma.application.count({ where: sq('Funded') }),
        prisma.application.count({ where: cq('Agent') }),
        prisma.application.count({ where: cq('Underwriter') }),
        prisma.application.count({ where: cq('Final Underwriter') }),
        prisma.application.count({ where: cq('Contracted') }),
        prisma.application.count({ where: cq('Final') }),
        prisma.application.count({ where: cq('Funding Call') }),
    ];

    const sumLoanAmount = (where: Prisma.ApplicationWhereInput) =>
        prisma.application.aggregate({
            where,
            _sum: { loanAmount: true },
        });

    const amountQueries = [
        sumLoanAmount(sq('Contract_Pending')),
        sumLoanAmount(combineWhere(visibilityBase, contractsOutStrictMatchWhere())),
        sumLoanAmount(combineWhere(visibilityBase, signedContractsStrictMatchWhere())),
        sumLoanAmount(sq('Funding Call')),
        sumLoanAmount(sq('Disbursment')),
        sumLoanAmount(sq('Funded')),
    ];

    const [
        totalCases,
        contractPending,
        contractsOut,
        signedContracts,
        fundingCall,
        disbursment,
        funded,
        agentCases,
        underwriterCases,
        finalUnderwriterCases,
        contractedStageCases,
        finalCases,
        fundingCallStageCases,
    ] = await Promise.all(countQueries);

    const [
        contractPendingAmountAgg,
        contractsOutAmountAgg,
        signedContractsAmountAgg,
        fundingCallAmountAgg,
        disbursmentAmountAgg,
        fundedAmountAgg,
    ] = await Promise.all(amountQueries);

    return {
        summaryCounts: {
            totalCases,
            contractPending,
            contractsOut,
            signedContracts,
            fundingCall,
            disbursment,
            funded,
        },
        summaryAmounts: {
            contractPending: Number(contractPendingAmountAgg._sum.loanAmount ?? 0),
            contractsOut: Number(contractsOutAmountAgg._sum.loanAmount ?? 0),
            signedContracts: Number(signedContractsAmountAgg._sum.loanAmount ?? 0),
            fundingCall: Number(fundingCallAmountAgg._sum.loanAmount ?? 0),
            disbursment: Number(disbursmentAmountAgg._sum.loanAmount ?? 0),
            funded: Number(fundedAmountAgg._sum.loanAmount ?? 0),
        },
        caseStageCounts: {
            Agent: agentCases,
            Underwriter: underwriterCases,
            'Final Underwriter': finalUnderwriterCases,
            Contracted: contractedStageCases,
            Final: finalCases,
            'Funding Call': fundingCallStageCases,
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
    const recentDealsWhere = isSuperAdmin
        ? {
              OR: [
                  buildOperationsStatusFilterWhere('Funded', filterMode),
                  buildOperationsStatusFilterWhere('Disbursment', filterMode),
              ],
          }
        : isOperations
          ? buildOperationsStatusFilterWhere('Contract_Signed', filterMode)
          : buildOperationsStatusFilterWhere('Contracted', filterMode);
    const where = combineWhere(visibilityBase, recentDealsWhere);
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
