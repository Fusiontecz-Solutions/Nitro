import prisma from '../config/prismaClient';
import { ContractStatus, type Prisma } from '@prisma/client';
import {
    archiveMainContractEnvelopeToHistory,
    buildContractSendHistoryTermsSnapshot,
    isCompletedEnvelopeStatus,
    resolveArchivedMainContractEnvelopeStatus,
} from './docusign/utils/contract-send-history';
import {
    recordContractWorkflowActivityLog,
    type ContractWorkflowLogContext,
} from './contractWorkflowActivityLog';
import { invalidateAllApplicationStatsCache } from './applicationStatsCache';
import { syncContractValuesFromOfferDecision } from './contractOfferValueSync';

const REINITIATION_ELIGIBLE_QUEUE_TOKENS = new Set([
    'finalapproval',
    'approvalsent',
    'isoapproved',
    'contractpending',
    'contractgenerated',
    'contractsent',
    'contractout',
    'contractsout',
    'underwriterapproved',
    'approved',
]);

export function normalizeApplicationQueueToken(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');
}

export function isQueueEligibleForContractReinitiation(
    queue: string | null | undefined,
): boolean {
    return REINITIATION_ELIGIBLE_QUEUE_TOKENS.has(normalizeApplicationQueueToken(queue));
}

export async function flagNeedsContractReinitiation(applicationId: string): Promise<void> {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    await prisma.application.update({
        where: { id: appId },
        data: {
            needsContractReinitiation: true,
            isoUpdatedOfferApproved: false,
        },
    });
}

export async function clearNeedsContractReinitiation(applicationId: string): Promise<void> {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    await prisma.application.update({
        where: { id: appId },
        data: {
            needsContractReinitiation: false,
            isoUpdatedOfferApproved: false,
        },
    });
}

/** Queue labels indicating contract workflow moved past the reinitiation bucket. */
const POST_REINITIATION_CONTRACT_QUEUES = [
    'Contract Generated',
    'Contract_Generated',
    'ContractGenerated',
    'Contract Sent',
    'Contract_Sent',
    'Contract Out',
    'Contract_Out',
    'Contracts Out',
    'Contracts_Out',
    'ContractOut',
    'Contract Signed',
    'Contract_Signed',
    'Signed Contracts',
    'Signed_Contracts',
    'SignedContracts',
] as const;

/** State tokens indicating contract workflow moved past the reinitiation bucket. */
const POST_REINITIATION_CONTRACT_STATES = [
    'CONTRACT_GENERATED',
    'Contract Generated',
    'Contract_Generated',
    'CONTRACT_SENT',
    'Contract Sent',
    'Contract_Sent',
    'CONTRACTS_OUT',
    'Contract Out',
    'Contract_Out',
    'Contracts Out',
    'Contracts_Out',
    'SIGNED_CONTRACTS',
    'Contract Signed',
    'Contract_Signed',
    'Signed Contracts',
    'Signed_Contracts',
] as const;

const POST_REINITIATION_CONTRACT_STATUSES: ContractStatus[] = [
    ContractStatus.SENT,
    ContractStatus.VIEWED,
    ContractStatus.SIGNED,
    ContractStatus.COMPLETED,
    ContractStatus.DECLINED,
    ContractStatus.REVOKED,
    ContractStatus.EXPIRED,
];

/**
 * Rows that still carry `needsContractReinitiation` but already progressed in the contract
 * workflow (stale flag from before regeneration / send completed).
 */
export function staleContractReinitiationProgressWhere(): Prisma.ApplicationWhereInput {
    return {
        OR: [
            { document: { isNot: null } },
            {
                contract: {
                    status: { in: POST_REINITIATION_CONTRACT_STATUSES },
                },
            },
            { currentQueue: { in: [...POST_REINITIATION_CONTRACT_QUEUES] } },
            { currentState: { in: [...POST_REINITIATION_CONTRACT_STATES] } },
        ],
    };
}

/**
 * Deals flagged for contract reinitiation that still need a fresh contract generated/sent.
 * Excludes stale rows whose queue/state or contract status already advanced.
 */
export function awaitingNewContractReinitiationWhere(): Prisma.ApplicationWhereInput {
    return {
        AND: [
            { needsContractReinitiation: true },
            { document: { is: null } },
            { NOT: staleContractReinitiationProgressWhere() },
        ],
    };
}

/** Clear stale `needsContractReinitiation` flags for deals that already left the bucket. */
export async function reconcileStaleContractReinitiationFlags(): Promise<number> {
    const result = await prisma.application.updateMany({
        where: {
            AND: [{ needsContractReinitiation: true }, staleContractReinitiationProgressWhere()],
        },
        data: {
            needsContractReinitiation: false,
            isoUpdatedOfferApproved: false,
        },
    });
    return result.count;
}

/**
 * Archive the current main-contract envelope, reset CRM contract/document rows,
 * and mark the deal as needing a fresh contract after ISO re-approves updated terms.
 */
export type ContractReinitiationOptions = {
    /**
     * Drop every saved prefill field override so the replacement package re-derives each
     * value from the live offer / application / owner records. Used by the Contract tab's
     * "Resend New Contract", where the whole point is that edited deal data must win.
     */
    clearFieldOverrides?: boolean;
    /**
     * Leave `needsContractReinitiation` set (default) so the deal sits in the ISO
     * re-approval bucket until someone regenerates. A user-driven resend passes false:
     * it regenerates immediately, so the flag would only be raised and cleared again.
     */
    flagForReinitiation?: boolean;
};

export async function reinitiateContractForApplication(
    applicationId: string,
    logContext?: ContractWorkflowLogContext,
    options?: ContractReinitiationOptions,
): Promise<boolean> {
    const appId = String(applicationId || '').trim();
    if (!appId) return false;
    const flagForReinitiation = options?.flagForReinitiation !== false;
    const clearFieldOverrides = options?.clearFieldOverrides === true;

    const applicationBefore = await prisma.application.findUnique({
        where: { id: appId },
        select: { currentQueue: true, currentState: true },
    });
    const previousStatus = applicationBefore
        ? `${applicationBefore.currentQueue ?? ''} / ${applicationBefore.currentState ?? ''}`.trim()
        : null;

    const contract = await prisma.contract.findUnique({
        where: { applicationId: appId },
        select: {
            id: true,
            status: true,
            approvedAmount: true,
            totalAmount: true,
            contractLenght: true,
            contractPrefillOverrides: true,
            offer: {
                select: {
                    offer: true,
                    term: true,
                    rate: true,
                    repayPerPeriod: true,
                    totalRemit: true,
                },
            },
            termsOffers: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                    approvedAmount: true,
                    position: true,
                    buyRate: true,
                    factorRate: true,
                    paymentAmount: true,
                    paybackAmount: true,
                    percentOfGross: true,
                    termLength: true,
                },
            },
            application: {
                select: {
                    document: {
                        select: {
                            envelopeId: true,
                            status: true,
                            sentAt: true,
                            completedAt: true,
                        },
                    },
                },
            },
        },
    });

    if (!contract) {
        if (flagForReinitiation) {
            await flagNeedsContractReinitiation(appId);
        } else {
            await clearNeedsContractReinitiation(appId);
        }
        await prisma.application.update({
            where: { id: appId },
            data: {
                currentQueue: 'Contract Pending',
                currentState: 'Contract_Pending',
            },
        });
        invalidateAllApplicationStatsCache();
        await recordContractWorkflowActivityLog(
            appId,
            'REINITIATED',
            logContext ?? {},
            {
                previousStatus,
                currentStatus: previousStatus,
                metadata: {
                    hadContractRow: false,
                    priorEnvelopeId: null,
                },
            },
        );
        return true;
    }

    const doc = contract.application?.document;
    const priorEnvelopeId = String(doc?.envelopeId ?? '').trim();
    let archivedEnvelopeStatus: string | null = null;

    if (priorEnvelopeId) {
        const archiveStatus = resolveArchivedMainContractEnvelopeStatus(
            doc?.status,
            contract.status,
        );
        archivedEnvelopeStatus = archiveStatus;
        const priorWasCompleted = isCompletedEnvelopeStatus(doc?.status, contract.status);

        await archiveMainContractEnvelopeToHistory(appId, {
            envelopeId: priorEnvelopeId,
            status: archiveStatus,
            sentAt: doc?.sentAt,
            completedAt:
                doc?.completedAt ?? (priorWasCompleted ? new Date() : null),
            termsSnapshot: buildContractSendHistoryTermsSnapshot(contract),
        });

        await prisma.document.deleteMany({ where: { applicationId: appId } });
    }

    /**
     * Re-read the prefill blob: `archiveMainContractEnvelopeToHistory` has just written the
     * archived send onto it, and resetting from the pre-archive snapshot read above would
     * drop that entry — the prior send would vanish from Contracts Generated.
     */
    const contractAfterArchive = await prisma.contract.findUnique({
        where: { id: contract.id },
        select: { contractPrefillOverrides: true },
    });
    const prefillAfterArchive =
        contractAfterArchive?.contractPrefillOverrides ?? contract.contractPrefillOverrides;

    /**
     * Pointers at the package that was just archived. The send HISTORY is deliberately
     * kept, but these name the live envelope for the main contract and for each document
     * mapping — left in place, the regenerated package would attach the superseded
     * documents instead of building fresh ones.
     */
    const clearedPrefillOverrides = resetPrefillOverridesForReinitiation(
        prefillAfterArchive,
        { clearFieldOverrides },
    );

    await prisma.contract.update({
        where: { id: contract.id },
        data: {
            status: 'DRAFT',
            ...(clearedPrefillOverrides !== undefined
                ? { contractPrefillOverrides: clearedPrefillOverrides }
                : {}),
        },
    });

    // The archived envelope carried the old terms; refresh every offer-derived value
    // (and clear stale prefill overrides) so the regenerated ACH / disclosure documents
    // prefill the re-approved offer rather than the superseded one.
    try {
        await syncContractValuesFromOfferDecision(appId);
    } catch (syncErr) {
        console.error('reinitiateContractForApplication: offer value sync failed', syncErr);
    }

    if (flagForReinitiation) {
        await flagNeedsContractReinitiation(appId);
    } else {
        await clearNeedsContractReinitiation(appId);
    }

    await prisma.application.update({
        where: { id: appId },
        data: {
            currentQueue: 'Contract Pending',
            currentState: 'Contract_Pending',
        },
    });

    invalidateAllApplicationStatsCache();

    const applicationAfter = await prisma.application.findUnique({
        where: { id: appId },
        select: { currentQueue: true, currentState: true },
    });
    const currentStatus = applicationAfter
        ? `${applicationAfter.currentQueue ?? ''} / ${applicationAfter.currentState ?? ''}`.trim()
        : previousStatus;

    await recordContractWorkflowActivityLog(
        appId,
        'REINITIATED',
        logContext ?? {},
        {
            previousStatus,
            currentStatus,
            metadata: {
                contractId: contract.id,
                hadContractRow: true,
                priorEnvelopeId: priorEnvelopeId || null,
                archivedEnvelopeStatus,
                priorContractStatus: String(contract.status ?? ''),
            },
        },
    );

    return true;
}

/**
 * Keys on `Contract.contractPrefillOverrides` that point at the CURRENT envelope rather
 * than recording history. Cleared when a deal is re-initiated so the next send builds a
 * new package; `documentSendHistory` / `contractSendHistory` are left untouched.
 */
const LIVE_ENVELOPE_POINTER_KEYS = [
    'mainContractSendPackage',
    'documentTemplateEnvelopeByMappingId',
    'achAuthorizationDocuSign',
    'standalonePackageDocuSign',
] as const;

/**
 * Prefill keys that survive a "start from scratch" resend even though they look like
 * ordinary overrides. `includeWireFee` is a deal-level toggle rather than a document value,
 * and `exhibitCEntities` is a JSON string of hand-entered extra account holders that exists
 * nowhere else — re-deriving it from the application is not possible.
 */
const PRESERVED_SCALAR_PREFILL_KEYS = new Set(['includeWireFee', 'exhibitCEntities']);

/**
 * Object-valued prefill keys that ARE snapshots of deal data rather than history, so a
 * resend must drop them: per-document prefill captured at the last send, and the signer
 * roster chosen for it. Left behind, a renamed owner or a corrected email would keep
 * sending under the superseded identity.
 */
const RESEND_CLEARED_SNAPSHOT_KEYS = [
    'documentTemplatePrefillByMappingId',
    'contractSignerOverrides',
] as const;

/**
 * Drop every saved prefill field override so the replacement package re-derives from live
 * data. Send history and the preserved keys above are kept; everything scalar is a cached
 * document value and goes.
 */
export function clearPrefillFieldOverrides(
    overrides: unknown,
): Record<string, unknown> | undefined {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        return undefined;
    }
    const source = overrides as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    let changed = false;
    for (const [key, value] of Object.entries(source)) {
        if (PRESERVED_SCALAR_PREFILL_KEYS.has(key)) {
            next[key] = value;
            continue;
        }
        const isContainer = value !== null && typeof value === 'object';
        if (!isContainer || (RESEND_CLEARED_SNAPSHOT_KEYS as readonly string[]).includes(key)) {
            changed = true;
            continue;
        }
        next[key] = value;
    }
    return changed ? next : undefined;
}

/**
 * The prefill blob a re-initiated contract starts from: live envelope pointers always go,
 * and a resend additionally discards every cached field value.
 */
export function resetPrefillOverridesForReinitiation(
    overrides: unknown,
    options?: { clearFieldOverrides?: boolean },
): Prisma.InputJsonValue | undefined {
    const withoutPointers = clearLiveEnvelopePointers(overrides);
    if (options?.clearFieldOverrides !== true) return withoutPointers;
    const base = withoutPointers ?? overrides;
    const withoutFields = clearPrefillFieldOverrides(base);
    if (withoutFields !== undefined) return withoutFields as Prisma.InputJsonValue;
    return withoutPointers;
}

export function clearLiveEnvelopePointers(
    overrides: unknown,
): Prisma.InputJsonValue | undefined {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        return undefined;
    }
    const next = { ...(overrides as Record<string, unknown>) };
    let changed = false;
    for (const key of LIVE_ENVELOPE_POINTER_KEYS) {
        if (key in next) {
            delete next[key];
            changed = true;
        }
    }
    return changed ? (next as Prisma.InputJsonValue) : undefined;
}

export function offerDecisionValuesChanged(
    prior: {
        offer?: number | null;
        rate?: number | null;
        totalRemit?: number | null;
        term?: string | null;
        frequency?: string | null;
    } | null,
    next: {
        offer?: number | null;
        rate?: number | null;
        totalRemit?: number | null;
        term?: string | null;
        frequency?: string | null;
    },
): boolean {
    const normNum = (v: unknown) => {
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    const normStr = (v: unknown) => {
        const s = String(v ?? '').trim();
        return s || null;
    };

    if (!prior) return true;

    return (
        normNum(prior.offer) !== normNum(next.offer) ||
        normNum(prior.rate) !== normNum(next.rate) ||
        normNum(prior.totalRemit) !== normNum(next.totalRemit) ||
        normStr(prior.term) !== normStr(next.term) ||
        normStr(prior.frequency) !== normStr(next.frequency)
    );
}
