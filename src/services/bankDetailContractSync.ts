import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { encryptField } from '../utils/fieldEncryption';

export type PlainBankFromRequest = {
  bankName?: string;
  accountNumber?: string;
  routingNumber?: string | null;
};

/**
 * After BankDetail create/update, sync plaintext bank fields to Contract + ACH rows
 * so DocuSign prefill reads current values (BankDetail stays encrypted at rest).
 */
export async function syncBankDetailToContractPrefill(
  applicationId: string,
  plainBank: PlainBankFromRequest,
  options?: { bankDetailId?: string },
): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { applicationId },
    select: {
      id: true,
      contractPrefillOverrides: true,
    },
  });
  if (!contract) return;

  const bankName = String(plainBank.bankName ?? '').trim();
  const accountNumber = String(plainBank.accountNumber ?? '').trim();
  const routingNumber =
    plainBank.routingNumber != null ? String(plainBank.routingNumber).trim() : '';

  const overrides =
    contract.contractPrefillOverrides != null &&
    typeof contract.contractPrefillOverrides === 'object' &&
    !Array.isArray(contract.contractPrefillOverrides)
      ? { ...(contract.contractPrefillOverrides as Record<string, unknown>) }
      : {};

  if (bankName) {
    overrides.authorizationClientBankName = bankName;
    overrides.achAuthorizationAccountHolderBankName = bankName;
  }
  if (accountNumber) {
    overrides.authorizationClientBankAccount = accountNumber;
    overrides.achAuthorizationAccountHolderBankAccountNumber = accountNumber;
  }
  if (routingNumber) {
    overrides.authorizationClientBankRouting = routingNumber;
    overrides.achAuthorizationAccountHolderBankRoutingNumber = routingNumber;
  }

  const updateData: Prisma.ContractUpdateInput = {
    authorizationClientBankName: bankName || null,
    authorizationClientBankAccount: accountNumber || null,
    authorizationClientBankRouting: routingNumber || null,
    contractPrefillOverrides: overrides as Prisma.InputJsonValue,
  };

  if (options?.bankDetailId) {
    updateData.paymentBank = { connect: { id: options.bankDetailId } };
  }

  await prisma.contract.update({
    where: { id: contract.id },
    data: updateData,
  });

  await prisma.aCH.updateMany({
    where: { contractId: contract.id },
    data: {
      bankName: bankName || null,
      accountNumber: accountNumber || null,
      routingNumber: routingNumber || null,
    },
  });
}

/**
 * After Contract prefill/column update, sync plaintext bank fields back to BankDetail
 * so CRM bank details stay in sync with contract flow edits (inverse of syncBankDetailToContractPrefill).
 */
export async function syncContractPrefillToBankDetail(
  applicationId: string,
  plainBank: PlainBankFromRequest,
  options?: { bankDetailId?: string },
): Promise<void> {
  const bankName = String(plainBank.bankName ?? '').trim();
  const accountNumber = String(plainBank.accountNumber ?? '').trim();
  const routingNumber =
    plainBank.routingNumber != null ? String(plainBank.routingNumber).trim() : '';

  if (!bankName && !accountNumber && !routingNumber) return;

  let bankDetailId = options?.bankDetailId;
  if (!bankDetailId) {
    const contract = await prisma.contract.findUnique({
      where: { applicationId },
      select: { paymentBankId: true },
    });
    bankDetailId = contract?.paymentBankId ?? undefined;
  }
  if (!bankDetailId) {
    const latest = await prisma.bankDetail.findFirst({
      where: { applicationId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    bankDetailId = latest?.id;
  }
  if (!bankDetailId) return;

  const data: Prisma.BankDetailUpdateInput = {};
  if (bankName) data.bankName = bankName;
  if (accountNumber) data.accountNumber = encryptField(accountNumber);
  if (routingNumber) data.routingNumber = encryptField(routingNumber);

  if (Object.keys(data).length === 0) return;

  await prisma.bankDetail.update({
    where: { id: bankDetailId },
    data,
  });
}
