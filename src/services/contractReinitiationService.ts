import prisma from '../config/prismaClient';
import type { Prisma } from '@prisma/client';
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

/**
 * Deals flagged for contract reinitiation that have not yet received a new DocuSign envelope.
 * Once a contract is generated or sent to the client, the linked `Document` row exists and
 * the deal leaves the Reinitiate Contract pipeline bucket.
 */
export function awaitingNewContractReinitiationWhere(): Prisma.ApplicationWhereInput {
    return {
        AND: [{ needsContractReinitiation: true }, { document: { is: null } }],
    };
}

/**
 * Archive the current main-contract envelope, reset CRM contract/document rows,
 * and mark the deal as needing a fresh contract after ISO re-approves updated terms.
 */
export async function reinitiateContractForApplication(
    applicationId: string,
    logContext?: ContractWorkflowLogContext,
): Promise<boolean> {
    const appId = String(applicationId || '').trim();
    if (!appId) return false;

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
        await flagNeedsContractReinitiation(appId);
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

    await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'DRAFT' },
    });

    await flagNeedsContractReinitiation(appId);

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
