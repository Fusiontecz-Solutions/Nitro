import prisma from '../config/prismaClient';
import { decryptEncryptedStringsInJson } from '../utils/fieldEncryption';

/** Plaintext bank fields copied into Contract / ACH for DocuSign prefill (not re-encrypted). */
export type PlainBankFields = {
  bankName: string;
  accountNumber: string;
  routingNumber: string | null;
};

const PREFILL_BANK_OVERRIDE_KEYS = [
  'authorizationClientBankName',
  'authorizationClientBankAccount',
  'authorizationClientBankRouting',
  'achAuthorizationAccountHolderBankName',
  'achAuthorizationAccountHolderBankAccountNumber',
  'achAuthorizationAccountHolderBankRoutingNumber',
] as const;

function patchContractPrefillOverridesBankFields(
  existing: unknown,
  bank: PlainBankFields,
): Record<string, unknown> {
  const base =
    existing != null && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const next: Record<string, unknown> = {
    authorizationClientBankName: bank.bankName || null,
    authorizationClientBankAccount: bank.accountNumber || null,
    authorizationClientBankRouting: bank.routingNumber || null,
    achAuthorizationAccountHolderBankName: bank.bankName || null,
    achAuthorizationAccountHolderBankAccountNumber: bank.accountNumber || null,
    achAuthorizationAccountHolderBankRoutingNumber: bank.routingNumber || null,
  };
  for (const key of PREFILL_BANK_OVERRIDE_KEYS) {
    base[key] = next[key];
  }
  return decryptEncryptedStringsInJson(base) as Record<string, unknown>;
}

/**
 * After BankDetail create/update, mirror plaintext into Contract authorization fields and ACH rows
 * so the prefill editor reflects the latest application bank details.
 */
export async function syncBankDetailToContractPrefill(
  applicationId: string,
  bank: PlainBankFields,
  options?: { bankDetailId?: string },
): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { applicationId },
    select: { id: true, clientId: true, contractPrefillOverrides: true },
  });
  if (!contract) return;

  const contractUpdate: Record<string, unknown> = {
    authorizationClientBankName: bank.bankName || null,
    authorizationClientBankAccount: bank.accountNumber || null,
    authorizationClientBankRouting: bank.routingNumber || null,
    contractPrefillOverrides: patchContractPrefillOverridesBankFields(
      contract.contractPrefillOverrides,
      bank,
    ),
  };
  if (options?.bankDetailId) {
    contractUpdate.paymentBankId = options.bankDetailId;
  }

  await prisma.contract.update({
    where: { id: contract.id },
    data: contractUpdate as any,
  });

  const achUpdate = {
    bankName: bank.bankName || null,
    accountNumber: bank.accountNumber || null,
    routingNumber: bank.routingNumber || null,
  };

  const achCount = await prisma.aCH.count({ where: { contractId: contract.id } });
  if (achCount > 0) {
    await prisma.aCH.updateMany({
      where: { contractId: contract.id },
      data: achUpdate,
    });
  }
}
