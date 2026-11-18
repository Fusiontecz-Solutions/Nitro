import prisma from '../config/prismaClient';
import {
  decryptEncryptedStringsInJson,
  decryptSensitiveField,
  encryptField,
} from '../utils/fieldEncryption';

/**
 * Bank values are entered in several CRM places (application Bank Details, the ACH form,
 * the contract prefill editor and its Exhibit C entity modal). They are the same logical
 * values, so a save in any one of them is mirrored into all the others here — nobody has
 * to retype the bank block twice.
 */
export type BankSyncFields = {
  bankName?: string | null;
  accountNumber?: string | null;
  routingNumber?: string | null;
  bankPortal?: string | null;
  bankUsername?: string | null;
};

type BankSyncField = keyof BankSyncFields;

const BANK_SYNC_FIELDS: BankSyncField[] = [
  'bankName',
  'accountNumber',
  'routingNumber',
  'bankPortal',
  'bankUsername',
];

/** Prefill override keys holding each logical value (all aliases are kept in step). */
const PREFILL_KEYS: Record<BankSyncField, string[]> = {
  bankName: ['authorizationClientBankName', 'achAuthorizationAccountHolderBankName'],
  accountNumber: [
    'authorizationClientBankAccount',
    'achAuthorizationAccountHolderBankAccountNumber',
  ],
  routingNumber: [
    'authorizationClientBankRouting',
    'achAuthorizationAccountHolderBankRoutingNumber',
  ],
  bankPortal: ['achAuthorizationBankPortalWebsite'],
  bankUsername: ['achAuthorizationUsername'],
};

/** Field names on an Exhibit C entity slot (`contractPrefillOverrides.exhibitCEntities`). */
const ENTITY_KEYS: Record<BankSyncField, string> = {
  bankName: 'bankName',
  accountNumber: 'bankAccount',
  routingNumber: 'bankRouting',
  bankPortal: 'bankPortal',
  bankUsername: 'bankUsername',
};

/** Contract columns mirroring the bank block (portal/username have no column). */
const CONTRACT_COLUMNS: Partial<Record<BankSyncField, string>> = {
  bankName: 'authorizationClientBankName',
  accountNumber: 'authorizationClientBankAccount',
  routingNumber: 'authorizationClientBankRouting',
};

/** Plaintext + trimmed; encrypted-at-rest values are decrypted so prefill never shows ciphertext. */
function plain(value: unknown): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return String(decryptSensitiveField(raw) ?? raw).trim();
}

function asObject(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/** Only non-empty values travel: a blank field never wipes a value saved elsewhere. */
export function normalizeBankSyncFields(bank: BankSyncFields): BankSyncFields {
  const out: BankSyncFields = {};
  for (const field of BANK_SYNC_FIELDS) {
    const value = plain(bank[field]);
    if (value) out[field] = value;
  }
  return out;
}

export function hasBankSyncValues(bank: BankSyncFields): boolean {
  return BANK_SYNC_FIELDS.some((field) => plain(bank[field]) !== '');
}

/**
 * Read the bank block out of prefill overrides. Exhibit C entities are never read:
 * every Exhibit C (the first included) is its own account, not the deal's bank.
 */
export function readBankFieldsFromPrefill(overrides: unknown): BankSyncFields {
  const source = asObject(overrides);
  const out: BankSyncFields = {};

  for (const field of BANK_SYNC_FIELDS) {
    let value = '';
    for (const key of PREFILL_KEYS[field]) {
      value = plain(source[key]);
      if (value) break;
    }
    if (value) out[field] = value;
  }
  return out;
}

/** Read the bank block out of an Exhibit C entity slot (as the entity modal saves it). */
export function readBankFieldsFromExhibitCEntity(entity: unknown): BankSyncFields {
  const source = asObject(entity);
  const out: BankSyncFields = {};
  for (const field of BANK_SYNC_FIELDS) {
    const value = plain(source[ENTITY_KEYS[field]]);
    if (value) out[field] = value;
  }
  return out;
}

/**
 * Write the bank block into every prefill alias. Exhibit C entities are left alone —
 * each Exhibit C, the first one included, is an independent account.
 */
export function applyBankFieldsToPrefill(
  overrides: unknown,
  bank: BankSyncFields,
): Record<string, unknown> {
  const next = asObject(overrides);
  const values = normalizeBankSyncFields(bank);

  for (const field of BANK_SYNC_FIELDS) {
    const value = values[field];
    if (!value) continue;
    for (const key of PREFILL_KEYS[field]) next[key] = value;
  }

  return decryptEncryptedStringsInJson(next) as Record<string, unknown>;
}

type ContractLocator = {
  contractId?: number | null;
  applicationId?: string | null;
  /** Used when the save carries no contract/application (e.g. a client-level ACH row). */
  clientId?: string | null;
};

async function findContractForSync(locator: ContractLocator) {
  const select = {
    id: true,
    applicationId: true,
    clientId: true,
    paymentBankId: true,
    contractPrefillOverrides: true,
    authorizationClientBankName: true,
    authorizationClientBankAccount: true,
    authorizationClientBankRouting: true,
  } as const;

  if (locator.contractId != null && Number.isFinite(Number(locator.contractId))) {
    return prisma.contract.findUnique({ where: { id: Number(locator.contractId) }, select });
  }
  if (locator.applicationId) {
    return prisma.contract.findUnique({ where: { applicationId: locator.applicationId }, select });
  }
  if (locator.clientId) {
    return prisma.contract.findFirst({
      where: { clientId: locator.clientId },
      orderBy: { createdAt: 'desc' },
      select,
    });
  }
  return null;
}

/** Keep the application's BankDetail row (what the Bank Details list shows) in step. */
async function syncBankDetailRow(
  applicationId: string,
  bank: BankSyncFields,
  options: { bankDetailId?: string; paymentBankId?: string | null },
): Promise<string | null> {
  const bankName = bank.bankName ?? '';
  const accountNumber = bank.accountNumber ?? '';
  const routingNumber = bank.routingNumber ?? '';
  if (!accountNumber && !routingNumber && !bankName) return null;

  const target =
    (options.bankDetailId
      ? await prisma.bankDetail.findUnique({ where: { id: options.bankDetailId } })
      : null) ??
    (options.paymentBankId
      ? await prisma.bankDetail.findUnique({ where: { id: options.paymentBankId } })
      : null) ??
    (await prisma.bankDetail.findFirst({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    }));

  if (target) {
    const data: Record<string, unknown> = {};
    if (bankName && String(target.bankName ?? '').trim() !== bankName) data.bankName = bankName;
    if (accountNumber && plain(target.accountNumber) !== accountNumber) {
      data.accountNumber = encryptField(accountNumber);
    }
    if (routingNumber && plain(target.routingNumber) !== routingNumber) {
      data.routingNumber = encryptField(routingNumber);
    }
    if (Object.keys(data).length > 0) {
      await prisma.bankDetail.update({ where: { id: target.id }, data: data as any });
    }
    return target.id;
  }

  // No bank row yet for this application — create one so the Bank Details tab is prefilled too.
  if (!accountNumber) return null;
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, createdById: true, salesRepresentativeId: true },
  });
  const createdById = application?.createdById ?? application?.salesRepresentativeId;
  if (!application || !createdById) return null;

  const created = await prisma.bankDetail.create({
    data: {
      bankName,
      accountNumber: encryptField(accountNumber),
      routingNumber: routingNumber ? encryptField(routingNumber) : null,
      applicationId: application.id,
      createdById,
    } as any,
  });
  return created.id;
}

/** ACH columns holding each logical value. */
const ACH_COLUMNS: Record<BankSyncField, string> = {
  bankName: 'bankName',
  accountNumber: 'accountNumber',
  routingNumber: 'routingNumber',
  bankPortal: 'ach_authorization_bank_portal_website',
  bankUsername: 'ach_authorization_username',
};

async function syncAchRows(
  contractId: number,
  bank: BankSyncFields,
  options: BankSyncOptions,
): Promise<void> {
  const rows = await prisma.aCH.findMany({ where: { contractId } });
  for (const row of rows) {
    if (options.sourceAchId != null && row.id === options.sourceAchId) continue;
    const data: Record<string, unknown> = {};
    for (const field of BANK_SYNC_FIELDS) {
      const value = bank[field];
      if (!value) continue;
      const column = ACH_COLUMNS[field];
      const current = plain((row as Record<string, unknown>)[column]);
      if (current === value) continue;
      if (current && options.achMode !== 'overwrite') continue;
      data[column] = value;
    }
    if (Object.keys(data).length > 0) {
      await prisma.aCH.update({ where: { id: row.id }, data: data as any });
    }
  }
}

export type BankSyncOptions = {
  /** Bank row the values came from (skips the lookup and links it to the contract). */
  bankDetailId?: string;
  /** Skip mirroring into ACH rows entirely. */
  updateAchRows?: boolean;
  /**
   * 'fillBlanks' (default) only fills empty ACH columns, so an ACH row kept for another
   * Exhibit C entity keeps its own bank. 'overwrite' is used when the user edited the
   * application's bank row itself and every ACH row should follow it.
   */
  achMode?: 'fillBlanks' | 'overwrite';
  /** Skip writing the application BankDetail row. */
  updateBankDetail?: boolean;
  /** ACH row that triggered the sync; left untouched when mirroring to siblings. */
  sourceAchId?: number;
};

/**
 * Mirror a saved bank block into the contract columns, the prefill overrides (including the
 * primary Exhibit C entity), the ACH rows and the application BankDetail row.
 */
export async function syncBankFieldsEverywhere(
  locator: ContractLocator,
  rawBank: BankSyncFields,
  options: BankSyncOptions = {},
): Promise<void> {
  const bank = normalizeBankSyncFields(rawBank);
  if (!hasBankSyncValues(bank)) return;

  const contract = await findContractForSync(locator);

  if (contract) {
    const contractUpdate: Record<string, unknown> = {};
    for (const field of BANK_SYNC_FIELDS) {
      const column = CONTRACT_COLUMNS[field];
      const value = bank[field];
      if (!column || !value) continue;
      const current = plain((contract as Record<string, unknown>)[column]);
      if (current !== value) contractUpdate[column] = value;
    }

    const nextOverrides = applyBankFieldsToPrefill(contract.contractPrefillOverrides, bank);
    if (
      JSON.stringify(nextOverrides) !== JSON.stringify(contract.contractPrefillOverrides ?? {})
    ) {
      contractUpdate.contractPrefillOverrides = nextOverrides;
    }
    if (options.bankDetailId && contract.paymentBankId !== options.bankDetailId) {
      contractUpdate.paymentBankId = options.bankDetailId;
    }

    if (Object.keys(contractUpdate).length > 0) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: contractUpdate as any,
      });
    }

    if (options.updateAchRows !== false) {
      await syncAchRows(contract.id, bank, options);
    }
  }

  const applicationId = locator.applicationId ?? contract?.applicationId ?? null;
  if (applicationId && options.updateBankDetail !== false) {
    const bankDetailId = await syncBankDetailRow(applicationId, bank, {
      bankDetailId: options.bankDetailId,
      paymentBankId: contract?.paymentBankId ?? null,
    });
    if (contract && bankDetailId && contract.paymentBankId !== bankDetailId) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { paymentBankId: bankDetailId } as any,
      });
    }
  }
}

/** Never let a mirror failure fail the save the user actually made. */
export async function syncBankFieldsEverywhereSafe(
  locator: ContractLocator,
  bank: BankSyncFields,
  options: BankSyncOptions = {},
): Promise<void> {
  try {
    await syncBankFieldsEverywhere(locator, bank, options);
  } catch (err) {
    console.error('syncBankFieldsEverywhere failed:', err);
  }
}
