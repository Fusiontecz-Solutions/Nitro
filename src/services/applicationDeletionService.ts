import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';

const DELETE_TX_OPTIONS = {
    maxWait: 15_000,
    timeout: 120_000,
} as const;

async function deleteApplicationCascade(
    tx: Prisma.TransactionClient,
    id: string,
): Promise<void> {
    const application = await tx.application.findUnique({
        where: { id },
        select: { id: true, applicationId: true },
    });
    if (!application) return;

    const months = await tx.month.findMany({
        where: { applicationId: id },
        select: { id: true },
    });
    const monthIds = months.map((m) => m.id);
    if (monthIds.length > 0) {
        await tx.monthlyTransaction.deleteMany({
            where: { monthId: { in: monthIds } },
        });
    }
    await tx.month.deleteMany({ where: { applicationId: id } });

    const analyses = await tx.bankAnalysis.findMany({
        where: { applicationId: id },
        select: { id: true },
    });
    const analysisIds = analyses.map((a) => a.id);
    if (analysisIds.length > 0) {
        await tx.bankAnalysisRow.deleteMany({
            where: { bankAnalysisId: { in: analysisIds } },
        });
    }
    await tx.bankAnalysis.deleteMany({ where: { applicationId: id } });

    await tx.applicationFile.deleteMany({ where: { applicationId: id } });
    await tx.comment.deleteMany({ where: { applicationId: id } });
    await tx.complianceCheck.deleteMany({ where: { applicationId: id } });
    await tx.note.deleteMany({ where: { applicationId: id } });
    await tx.position.deleteMany({ where: { applicationId: id } });
    await tx.applicationQuestionResponse.deleteMany({
        where: { applicationId: id },
    });

    await tx.document.deleteMany({ where: { applicationId: id } });
    await tx.fundingInfo.deleteMany({ where: { applicationId: id } });

    await tx.docuSignEnvelope.deleteMany({
        where: {
            OR: [
                { termsOffer: { applicationId: id } },
                { contract: { applicationId: id } },
            ],
        },
    });

    await tx.paymentTerms.deleteMany({
        where: { contract: { applicationId: id } },
    });

    await tx.termsOffer.deleteMany({ where: { applicationId: id } });

    await tx.termsOffer.updateMany({
        where: { contracts: { applicationId: id } },
        data: { contractId: null },
    });
    await tx.aCH.updateMany({
        where: { contract: { applicationId: id } },
        data: { contractId: null },
    });
    await tx.ePO.updateMany({
        where: { contract: { applicationId: id } },
        data: { contractId: null },
    });
    await tx.addendum.updateMany({
        where: { contract: { applicationId: id } },
        data: { contractId: null },
    });

    await tx.aCH.updateMany({
        where: { businessInfo: { applicationId: id } },
        data: { businessInfoId: null },
    });
    await tx.ePO.updateMany({
        where: { businessInfo: { applicationId: id } },
        data: { businessInfoId: null },
    });
    await tx.addendum.updateMany({
        where: { businessInfo: { applicationId: id } },
        data: { businessInfoId: null },
    });

    await tx.disclosure.deleteMany({ where: { applicationId: id } });
    await tx.contract.deleteMany({ where: { applicationId: id } });
    await tx.offerDecision.deleteMany({ where: { applicationId: id } });
    await tx.businessInfo.deleteMany({ where: { applicationId: id } });

    await tx.bankDetail.deleteMany({ where: { applicationId: id } });

    await tx.documentRequest.deleteMany({ where: { applicationId: id } });

    await tx.clientBankInfo.updateMany({
        where: { applicationId: id },
        data: { applicationId: null },
    });

    await tx.notification.updateMany({
        where: { applicationId: id },
        data: { applicationId: null },
    });

    await tx.outbound_communications.deleteMany({ where: { applicationId: id } });
    await tx.applicationActivityLog.deleteMany({ where: { applicationId: id } });
    await tx.finalAnswer.deleteMany({ where: { applicationId: id } });
    await tx.publicApprovalToken.deleteMany({ where: { applicationId: id } });
    await tx.skippedActumTransactions.deleteMany({ where: { applicationId: id } });
    await tx.applicationTransaction.deleteMany({
        where: { applicationId: application.applicationId },
    });
    await tx.applicationBalanceHistory.deleteMany({
        where: { applicationId: application.applicationId },
    });

    await tx.application.delete({ where: { id } });
}

async function deleteLeftoverContractsForClient(
    tx: Prisma.TransactionClient,
    clientId: string,
): Promise<void> {
    const contracts = await tx.contract.findMany({
        where: { clientId },
        select: { id: true },
    });
    const contractIds = contracts.map((c) => c.id);
    if (contractIds.length === 0) return;

    await tx.docuSignEnvelope.deleteMany({
        where: { contractId: { in: contractIds } },
    });
    await tx.paymentTerms.deleteMany({
        where: { contractId: { in: contractIds } },
    });
    await tx.termsOffer.updateMany({
        where: { contractId: { in: contractIds } },
        data: { contractId: null },
    });
    await tx.disclosure.deleteMany({
        where: { contractId: { in: contractIds } },
    });
    await tx.fileMetadata.deleteMany({
        where: { contractId: { in: contractIds } },
    });
    await tx.contract.deleteMany({ where: { id: { in: contractIds } } });
}

export async function executePermanentApplicationDelete(id: string): Promise<void> {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await deleteApplicationCascade(tx, id);
    }, DELETE_TX_OPTIONS);
}

export async function executePermanentClientDelete(id: string): Promise<boolean> {
    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const client = await tx.client.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!client) return false;

        const applications = await tx.application.findMany({
            where: { clientId: id },
            select: { id: true },
        });
        for (const application of applications) {
            await deleteApplicationCascade(tx, application.id);
        }

        await tx.aCH.deleteMany({ where: { clientId: id } });
        await tx.ePO.deleteMany({ where: { clientId: id } });
        await tx.addendum.deleteMany({ where: { clientId: id } });
        await tx.fileMetadata.deleteMany({ where: { clientId: id } });

        await deleteLeftoverContractsForClient(tx, id);

        await tx.client.delete({ where: { id } });
        return true;
    }, DELETE_TX_OPTIONS);
}
