import prisma from '../config/prismaClient';
import { ContractStatus, type Prisma } from '@prisma/client';
import {
    archiveMainContractEnvelopeToHistory,
    buildContractOfferFingerprint,
    buildContractSendHistoryTermsSnapshot,
    contractOfferFingerprintsDiffer,
    isCompletedEnvelopeStatus,
    parseContractOfferFingerprint,
    resolveArchivedMainContractEnvelopeStatus,
    resolveTermsSnapshotFromContractPrefill,
    type ContractOfferFingerprint,
} from './docusign/utils/contract-send-history';
import {
    recordContractWorkflowActivityLog,
    type ContractWorkflowLogContext,
} from './contractWorkflowActivityLog';
import { invalidateAllApplicationStatsCache } from './applicationStatsCache';
import { syncContractValuesFromOfferDecision } from './contractOfferValueSync';
import { isApplicationDerivedPrefillKey } from '../utils/applicationDerivedPrefillKey';

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
     * Refresh saved prefill field overrides so the replacement package picks up edited
     * deal data. Used by the Contract tab's "Resend New Contract". How much goes depends
     * on whether the offer changed since the last contract
     * (see {@link resolveRegenerationPrefillMode}): a changed offer drops every cached
     * value; an unchanged one keeps the addendum / disclosure values and drops only the
     * values that mirror application records (address, email, names…).
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
        select: { currentQueue: true, currentState: true, needsContractReinitiation: true },
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
                    frequency: true,
                    fees: true,
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

    /**
     * Decide before archiving: the archive writes a history entry whose snapshot is built
     * from the live (possibly already updated) offer, so only the pre-archive blob still
     * says which offer the previous package was built from.
     */
    const liveOfferFingerprint = buildContractOfferFingerprint(
        contract.offer as unknown as Record<string, unknown> | null,
    );
    const offerChangedSinceLastContract = detectOfferChangeSinceLastContract(
        contract.contractPrefillOverrides,
        priorEnvelopeId,
        liveOfferFingerprint,
        {
            status: contract.status,
            approvedAmount: contract.approvedAmount,
            totalAmount: contract.totalAmount,
        },
    );
    const prefillMode = resolveRegenerationPrefillMode({
        offerChanged: offerChangedSinceLastContract,
        clearFieldOverrides,
        flaggedForReinitiation: applicationBefore?.needsContractReinitiation === true,
    });

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
    const clearedPrefillOverrides = resetPrefillOverridesForRegeneration(
        prefillAfterArchive,
        prefillMode,
        liveOfferFingerprint,
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

    // Refresh every offer-derived contract column from the live offer. Saved offer-derived
    // prefill overrides are dropped only when the offer actually changed — otherwise they
    // were entered against this same offer and must survive the regeneration.
    try {
        await syncContractValuesFromOfferDecision(appId, {
            stripOfferOverrides: prefillMode === 'clear-all',
        });
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
                offerChangedSinceLastContract,
                prefillMode,
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
 * nowhere else — re-deriving it from the application is not possible. Likewise
 * `disclosureMonthlyRevenues`: the months typed into the disclosure calculator, which
 * would otherwise fall back to the raw bank analysis on every regeneration.
 */
const PRESERVED_SCALAR_PREFILL_KEYS = new Set([
    'includeWireFee',
    'exhibitCEntities',
    'disclosureMonthlyRevenues',
]);

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

/** Offer terms the regenerated package is built from — the next regeneration's baseline. */
export const CONTRACT_OFFER_SNAPSHOT_KEY = 'contractOfferSnapshot';

/**
 * How a regeneration treats the saved prefill values:
 * - `clear-all`: the offer changed, so every cached document value (Flex addendum
 *   installments, disclosure figures, per-document tabs…) goes and is re-derived from
 *   the new offer.
 * - `refresh-application`: the offer is the same; addendum / disclosure values are kept
 *   and only values mirroring application records are dropped so edits there flow in.
 * - `pointers-only`: nothing but the live envelope pointers is cleared.
 */
export type RegenerationPrefillMode = 'clear-all' | 'refresh-application' | 'pointers-only';

/**
 * Whether the live offer differs from the one the previous contract package was built
 * from. Baseline, most specific first: the send-time snapshot of the envelope being
 * archived, then the snapshot stamped by the last regeneration. `null` when neither
 * exists (nothing to compare against).
 */
export function detectOfferChangeSinceLastContract(
    overrides: unknown,
    priorEnvelopeId: string | null | undefined,
    liveOffer: ContractOfferFingerprint | null,
    /**
     * The contract row's own amount columns, used when no snapshot exists (a package sent
     * before snapshots carried offer terms). Only past DRAFT: an offer save re-syncs a
     * DRAFT row's columns, so there they no longer say what the package was built from.
     */
    contractColumns?: {
        status?: string | null;
        approvedAmount?: number | null;
        totalAmount?: number | null;
    } | null,
): boolean | null {
    if (!liveOffer) return null;
    const envelopeSnapshot = priorEnvelopeId
        ? resolveTermsSnapshotFromContractPrefill(overrides, priorEnvelopeId)
        : null;
    if (envelopeSnapshot?.offerValues) {
        return contractOfferFingerprintsDiffer(envelopeSnapshot.offerValues, liveOffer);
    }
    const stamped =
        overrides && typeof overrides === 'object' && !Array.isArray(overrides)
            ? parseContractOfferFingerprint(
                  (overrides as Record<string, unknown>)[CONTRACT_OFFER_SNAPSHOT_KEY],
              )
            : null;
    if (stamped) return contractOfferFingerprintsDiffer(stamped, liveOffer);
    if (envelopeSnapshot) {
        const legacy = legacyTermsSnapshotDiffers(envelopeSnapshot, liveOffer);
        if (legacy != null) return legacy;
    }
    const status = String(contractColumns?.status ?? '').trim().toUpperCase();
    if (contractColumns && status && status !== 'DRAFT') {
        return legacyTermsSnapshotDiffers(
            {
                approvedAmount: contractColumns.approvedAmount,
                totalAmount: contractColumns.totalAmount,
            },
            liveOffer,
        );
    }
    return null;
}

/** Snapshots written before `offerValues` existed only carry amount / payback / term. */
function legacyTermsSnapshotDiffers(
    snapshot: { approvedAmount?: number | null; totalAmount?: number | null; term?: string | null },
    liveOffer: ContractOfferFingerprint,
): boolean | null {
    const cents = (v: number | null | undefined) =>
        v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100);
    const text = (v: unknown) =>
        String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase() || null;
    let compared = false;
    const pairs: Array<[number | null, number | null]> = [
        [cents(snapshot.approvedAmount), cents(liveOffer.offer)],
        [cents(snapshot.totalAmount), cents(liveOffer.totalRemit)],
    ];
    for (const [prior, next] of pairs) {
        if (prior == null || next == null) continue;
        compared = true;
        if (prior !== next) return true;
    }
    const priorTerm = text(snapshot.term);
    const nextTerm = text(liveOffer.term);
    if (priorTerm && nextTerm) {
        compared = true;
        if (priorTerm !== nextTerm) return true;
    }
    return compared ? false : null;
}

/**
 * Pick the prefill reset for a regeneration. With no baseline to compare against, a
 * deal flagged for reinitiation (UW changed the offer after the contract) and a
 * user-driven resend fall back to a full clear, as before.
 */
export function resolveRegenerationPrefillMode(input: {
    offerChanged: boolean | null;
    clearFieldOverrides: boolean;
    flaggedForReinitiation: boolean;
}): RegenerationPrefillMode {
    const offerChanged =
        input.offerChanged ?? (input.clearFieldOverrides || input.flaggedForReinitiation);
    if (offerChanged) return 'clear-all';
    return input.clearFieldOverrides ? 'refresh-application' : 'pointers-only';
}

export { isApplicationDerivedPrefillKey };

/**
 * Same-offer regeneration: keep every addendum / disclosure value (per-document tabs,
 * offer amounts, disclosure figures) and drop only the flat values that mirror
 * application records plus the signer roster, so an edited address or email reaches
 * the new package. Send history and the preserved keys are untouched.
 */
export function refreshApplicationDerivedPrefillOverrides(
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
        if (
            key === 'contractSignerOverrides' ||
            (!isContainer && isApplicationDerivedPrefillKey(key))
        ) {
            changed = true;
            continue;
        }
        next[key] = value;
    }
    return changed ? next : undefined;
}

/**
 * The prefill blob a regenerated contract starts from, per {@link RegenerationPrefillMode},
 * stamped with the offer it is built from so the next regeneration has a baseline.
 */
export function resetPrefillOverridesForRegeneration(
    overrides: unknown,
    mode: RegenerationPrefillMode,
    liveOffer: ContractOfferFingerprint | null,
): Prisma.InputJsonValue | undefined {
    let next: unknown =
        mode === 'clear-all'
            ? resetPrefillOverridesForReinitiation(overrides, { clearFieldOverrides: true })
            : clearLiveEnvelopePointers(overrides);
    if (mode === 'refresh-application') {
        next = refreshApplicationDerivedPrefillOverrides(next ?? overrides) ?? next;
    }
    if (!liveOffer) return next as Prisma.InputJsonValue | undefined;
    const base = next ?? overrides;
    const blob =
        base && typeof base === 'object' && !Array.isArray(base)
            ? { ...(base as Record<string, unknown>) }
            : {};
    blob[CONTRACT_OFFER_SNAPSHOT_KEY] = liveOffer;
    return blob as Prisma.InputJsonValue;
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
