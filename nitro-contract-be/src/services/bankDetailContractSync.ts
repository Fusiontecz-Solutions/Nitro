import { syncBankFieldsEverywhere } from './bankFieldSync';

/** Plaintext bank fields copied into Contract / ACH for DocuSign prefill (not re-encrypted). */
export type PlainBankFields = {
  bankName: string;
  accountNumber: string;
  routingNumber: string | null;
};

/**
 * After BankDetail create/update, mirror plaintext into Contract authorization fields, the
 * prefill overrides (including the primary Exhibit C entity) and the ACH rows so every
 * editor reflects the latest application bank details.
 */
export async function syncBankDetailToContractPrefill(
  applicationId: string,
  bank: PlainBankFields,
  options?: { bankDetailId?: string },
): Promise<void> {
  await syncBankFieldsEverywhere(
    { applicationId },
    {
      bankName: bank.bankName,
      accountNumber: bank.accountNumber,
      routingNumber: bank.routingNumber,
    },
    { bankDetailId: options?.bankDetailId, updateBankDetail: false, achMode: 'overwrite' },
  );
}
