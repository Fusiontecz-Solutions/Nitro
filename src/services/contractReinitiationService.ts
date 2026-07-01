import prisma from '../config/prismaClient';
import {
    archiveMainContractEnvelopeToHistory,
    isCompletedEnvelopeStatus,
    resolveArchivedMainContractEnvelopeStatus,
} from './docusign/utils/contract-send-history';

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
        data: { needsContractReinitiation: true },
    });
}

export async function clearNeedsContractReinitiation(applicationId: string): Promise<void> {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    await prisma.application.update({
        where: { id: appId },
        data: { needsContractReinitiation: false },
    });
}

/**
 * Archive the current main-contract envelope, reset CRM contract/document rows,
 * and mark the deal as needing a fresh contract after ISO re-approves updated terms.
 */
export async function reinitiateContractForApplication(applicationId: string): Promise<boolean> {
    const appId = String(applicationId || '').trim();
    if (!appId) return false;

    const contract = await prisma.contract.findUnique({
        where: { applicationId: appId },
        select: {
            id: true,
            status: true,
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
        return true;
    }

    const doc = contract.application?.document;
    const priorEnvelopeId = String(doc?.envelopeId ?? '').trim();

    if (priorEnvelopeId) {
        const archiveStatus = resolveArchivedMainContractEnvelopeStatus(
            doc?.status,
            contract.status,
        );
        const priorWasCompleted = isCompletedEnvelopeStatus(doc?.status, contract.status);

        await archiveMainContractEnvelopeToHistory(appId, {
            envelopeId: priorEnvelopeId,
            status: archiveStatus,
            sentAt: doc?.sentAt,
            completedAt:
                doc?.completedAt ?? (priorWasCompleted ? new Date() : null),
        });

        await prisma.document.deleteMany({ where: { applicationId: appId } });
    }

    await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'DRAFT' },
    });

    await flagNeedsContractReinitiation(appId);
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
