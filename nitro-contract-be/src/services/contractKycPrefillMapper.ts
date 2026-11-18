export type KycDocumentType = 'driverLicense' | 'voidedCheck';
export type KycUploadSlot = 'voidedCheck' | 'driverLicense' | 'driverLicenseOwner2';
export type KycOwnerIndex = 1 | 2;

export interface KycPanelOwnerPatch {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface KycPanelGuarantorPatch {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  driverLicenseNumber: string;
}

export interface KycPanelAchPatch {
  bankName: string;
  fullNameOnAccount: string;
  accountNumber: string;
  routingNumber: string;
  dba: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export interface KycExtractionMapped {
  documentType: KycDocumentType;
  ownerIndex: KycOwnerIndex;
  slot: KycUploadSlot;
  keyData: Record<string, string>;
  contractPrefill: Record<string, string>;
  panels: {
    owner?: KycPanelOwnerPatch;
    guarantor?: KycPanelGuarantorPatch;
    ach?: KycPanelAchPatch;
  };
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function digitsOnly(v: string): string {
  return String(v || '').replace(/\D/g, '');
}

function routingDigits(v: string): string {
  const d = digitsOnly(v);
  return d.length >= 9 ? d.slice(0, 9) : d;
}

function titleCaseNamePart(part: string): string {
  const s = str(part);
  if (!s) return '';
  return s
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

function parseLegalNameAndDba(raw: string): { legalName: string; dba: string } {
  const s = str(raw);
  if (!s) return { legalName: '', dba: '' };
  const match = s.match(/^(.+?)\s+dba\s+(.+)$/i);
  if (match) {
    return { legalName: match[1].trim(), dba: match[2].trim() };
  }
  return { legalName: s, dba: '' };
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = str(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function buildStreetAddress(line1: string, line2: string): string {
  const a = str(line1);
  const b = str(line2);
  if (a && b) return `${a}, ${b}`;
  return a || b;
}

export function mapDriverLicenseKeyDataToPrefill(
  keyData: Record<string, string>,
  ownerIndex: KycOwnerIndex = 1,
): KycExtractionMapped {
  const firstName =
    str(keyData.first_name) || str(keyData.given_name) || str(keyData.owner_first_name);
  const lastName =
    str(keyData.last_name) || str(keyData.family_name) || str(keyData.owner_last_name);
  const fullName =
    str(keyData.full_name) ||
    str(keyData.applicant_name) ||
    [firstName, lastName].filter(Boolean).join(' ').trim();
  const dlNumber = str(keyData.driver_license_number) || str(keyData.license_number);
  const addressLine1 =
    str(keyData.address_line1) || str(keyData.street_address) || str(keyData.home_address);
  const addressLine2 = str(keyData.address_line2);
  const city = str(keyData.owner_city) || str(keyData.city);
  const state = (str(keyData.owner_state) || str(keyData.state)).toUpperCase().slice(0, 2);
  const zip = digitsOnly(str(keyData.owner_zip) || str(keyData.zip)).slice(0, 10);
  const street = buildStreetAddress(addressLine1, addressLine2);

  const displayName = fullName || [firstName, lastName].filter(Boolean).join(' ');
  const { firstName: fn, lastName: ln } = splitFullName(displayName);

  const contractPrefill: Record<string, string> = {};
  const set = (key: string, val: string) => {
    if (str(val)) contractPrefill[key] = val;
  };

  if (ownerIndex === 2) {
    set('owner2GuarantorName', displayName);
    set('guarantyOwner2Name', displayName);
    set('guarantyGuarantor2Name', displayName);
    if (dlNumber) {
      set('guarantyOwner2DriverLicense', dlNumber);
      set('guarantyGuarantor2DriverLicense', dlNumber);
    }
  } else {
    set('customerName', displayName);
    set('clientName', displayName);
    set('owner1GuarantorName', displayName);
    set('guarantyOwner1Name', displayName);
    set('guarantyGuarantor1Name', displayName);
    set('securityGuarantor', displayName);
    set('achAuthorizationAccountHolderName', displayName);
    set('achAuthorizationConcentAccountHolderName', displayName);

    if (dlNumber) {
      set('guarantyOwner1DriverLicense', dlNumber);
      set('guarantyGuarantor1DriverLicense', dlNumber);
      set('guarantySsDriverLicense', dlNumber);
    }

    if (street) {
      set('guarantorAddress', street);
      set('businessAddressContract', street);
      set('achAuthorizationAccountHolderAddress', street);
    }
    if (city) {
      set('guarantorAddressCity', city);
      set('businessAddressContractCity', city);
      set('achAuthorizationAccountHolderCity', city);
    }
    if (state) {
      set('guarantorAddressState', state);
      set('businessAddressContractState', state);
      set('achAuthorizationAccountHolderState', state);
    }
    if (zip) {
      set('guarantorAddressZip', zip);
      set('businessAddressContractZip', zip);
      set('achAuthorizationAccountHolderZip', zip);
    }
  }

  return {
    documentType: 'driverLicense',
    ownerIndex,
    slot: ownerIndex === 2 ? 'driverLicenseOwner2' : 'driverLicense',
    keyData,
    contractPrefill,
    panels: {
      owner: {
        firstName: titleCaseNamePart(fn),
        lastName: titleCaseNamePart(ln),
        address: street,
        city,
        state,
        zipCode: zip,
      },
      guarantor: {
        firstName: titleCaseNamePart(fn),
        lastName: titleCaseNamePart(ln),
        address: street,
        city,
        state,
        zipCode: zip,
        driverLicenseNumber: dlNumber,
      },
    },
  };
}

/** Prefill key for JSON-serialized multi-entity Exhibit C rows (must match FE). */
export const EXHIBIT_C_ENTITIES_PREFILL_KEY = 'exhibitCEntities';

function normalizeBusinessNameKey(v: unknown): string {
  return str(v)
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ');
}

export function voidCheckAccountHolderDiffersFromBusiness(
  accountHolderName: unknown,
  businessLegalName: unknown,
): boolean {
  const holder = str(accountHolderName);
  if (!holder) return false;
  const business = str(businessLegalName);
  if (!business) return true;
  return normalizeBusinessNameKey(holder) !== normalizeBusinessNameKey(business);
}

/**
 * Void-check OCR must never overwrite merchant `legalName`.
 * Bank / ACH fields still update; a different account-holder name becomes an Exhibit C entity
 * (merged in `persistKycExtractionToContract` when the business name is known).
 */
export function mapVoidedCheckKeyDataToPrefill(
  keyData: Record<string, string>,
): KycExtractionMapped {
  const accountHolder =
    str(keyData.account_holder_name) ||
    str(keyData.member_name) ||
    str(keyData.payee_name);
  const { legalName, dba } = parseLegalNameAndDba(
    str(keyData.legal_business_name) || accountHolder,
  );
  const holderOnCheck = legalName || accountHolder;
  const dbaName = str(keyData.dba_name) || dba;
  const bankName = str(keyData.bank_name);
  const routing = routingDigits(
    str(keyData.routing_number) || str(keyData.aba_routing_number),
  );
  const account = digitsOnly(
    str(keyData.account_number) || str(keyData.checking_account_number),
  );
  const addressLine1 =
    str(keyData.account_holder_address_line1) || str(keyData.address_line1);
  const addressLine2 = str(keyData.account_holder_address_line2) || str(keyData.address_line2);
  const city = str(keyData.city) || str(keyData.owner_city) || str(keyData.bank_city);
  const state = (str(keyData.state) || str(keyData.owner_state) || str(keyData.bank_state))
    .toUpperCase()
    .slice(0, 2);
  const zip = digitsOnly(str(keyData.zip) || str(keyData.owner_zip) || str(keyData.bank_zip)).slice(
    0,
    10,
  );
  const street = buildStreetAddress(addressLine1, addressLine2);

  const contractPrefill: Record<string, string> = {};
  const set = (key: string, val: string) => {
    if (str(val)) contractPrefill[key] = val;
  };

  // Bank + ACH holder only — do NOT write legalName / securityBusinessName / authorizationClientName.
  if (holderOnCheck) {
    set('achAuthorizationAccountHolderName', holderOnCheck);
  }
  if (dbaName) {
    set('achAuthorizationAccountHolderDba', dbaName);
  }
  if (bankName) {
    set('authorizationClientBankName', bankName);
    set('achAuthorizationAccountHolderBankName', bankName);
  }
  if (routing) {
    set('authorizationClientBankRouting', routing);
    set('achAuthorizationAccountHolderBankRoutingNumber', routing);
  }
  if (account) {
    set('authorizationClientBankAccount', account);
    set('achAuthorizationAccountHolderBankAccountNumber', account);
  }
  if (street) {
    set('achAuthorizationAccountHolderAddress', street);
  }
  if (city) {
    set('achAuthorizationAccountHolderCity', city);
  }
  if (state) {
    set('achAuthorizationAccountHolderState', state);
    set('achAuthorizationAccountHolderBankState', state);
  }
  if (zip) {
    set('achAuthorizationAccountHolderZip', zip);
    set('achAuthorizationAccountHolderBankZip', zip);
  }

  const bankCity = str(keyData.bank_city);
  const bankState = str(keyData.bank_state).toUpperCase().slice(0, 2);
  const bankZip = digitsOnly(str(keyData.bank_zip)).slice(0, 10);
  if (bankCity) set('achAuthorizationAccountHolderBankBranchCity', bankCity);
  if (bankState) set('achAuthorizationAccountHolderBankState', bankState);
  if (bankZip) set('achAuthorizationAccountHolderBankZip', bankZip);

  return {
    documentType: 'voidedCheck',
    ownerIndex: 1,
    slot: 'voidedCheck',
    keyData,
    contractPrefill,
    panels: {
      ach: {
        bankName,
        fullNameOnAccount: holderOnCheck,
        accountNumber: account,
        routingNumber: routing,
        dba: dbaName,
        address: street,
        city,
        state,
        zip,
      },
    },
  };
}

export function mapKycKeyDataToPrefill(
  documentType: KycDocumentType,
  keyData: Record<string, string>,
  ownerIndex: KycOwnerIndex = 1,
): KycExtractionMapped {
  if (documentType === 'driverLicense') {
    return mapDriverLicenseKeyDataToPrefill(keyData, ownerIndex);
  }
  return mapVoidedCheckKeyDataToPrefill(keyData);
}

export function resolveKycUploadSlot(raw: unknown): {
  slot: KycUploadSlot;
  documentType: KycDocumentType;
  ownerIndex: KycOwnerIndex;
} | null {
  const key = String(raw ?? '')
    .replace(/[\s_-]+/g, '')
    .toLowerCase();
  if (
    key === 'voidedcheck' ||
    key === 'voidcheck' ||
    key === 'voidedcheque'
  ) {
    return { slot: 'voidedCheck', documentType: 'voidedCheck', ownerIndex: 1 };
  }
  if (
    key === 'driverlicenseowner2' ||
    key === 'driverlicense2' ||
    key === 'owner2driverlicense' ||
    key === 'owner2dl'
  ) {
    return { slot: 'driverLicenseOwner2', documentType: 'driverLicense', ownerIndex: 2 };
  }
  if (
    key === 'driverlicense' ||
    key === 'driverlicenseowner1' ||
    key === 'driverlicense1' ||
    key === 'owner1driverlicense' ||
    key === 'owner1dl' ||
    key === 'drivinglicense' ||
    key === 'driverslicense'
  ) {
    return { slot: 'driverLicense', documentType: 'driverLicense', ownerIndex: 1 };
  }
  return null;
}

export function slugFromKycSlot(slot: KycUploadSlot): string {
  if (slot === 'voidedCheck') return 'voided-check';
  if (slot === 'driverLicenseOwner2') return 'driver-license-owner-2';
  return 'driver-license';
}

export function mergeContractPrefillPatch(
  existing: unknown,
  patch: Record<string, string>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [key, val] of Object.entries(patch)) {
    if (str(val)) {
      base[key] = val;
    }
  }
  return base;
}

type ExhibitCEntityRow = {
  id: string;
  clientLegalName: string;
  clientName: string;
  accountHolderName: string;
  accountHolderDba: string;
  accountHolderAddress: string;
  accountHolderCity: string;
  accountHolderState: string;
  accountHolderZip: string;
  bankName: string;
  bankAccount: string;
  bankRouting: string;
  bankPortal: string;
  bankUsername: string;
  bankPassword: string;
  securityQa1: string;
  securityQa2: string;
  agreementDate: string;
};

const EXHIBIT_C_ENTITY_MAX = 10;

function parseExhibitCEntitiesRaw(raw: unknown): ExhibitCEntityRow[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      parsed = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id:
          str(r.id) ||
          `exhibit-c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        clientLegalName: str(r.clientLegalName),
        clientName: str(r.clientName),
        accountHolderName: str(r.accountHolderName),
        accountHolderDba: str(r.accountHolderDba),
        accountHolderAddress: str(r.accountHolderAddress),
        accountHolderCity: str(r.accountHolderCity),
        accountHolderState: str(r.accountHolderState),
        accountHolderZip: str(r.accountHolderZip),
        bankName: str(r.bankName),
        bankAccount: str(r.bankAccount),
        bankRouting: str(r.bankRouting),
        bankPortal: str(r.bankPortal),
        bankUsername: str(r.bankUsername),
        bankPassword: str(r.bankPassword),
        securityQa1: str(r.securityQa1),
        securityQa2: str(r.securityQa2),
        agreementDate: str(r.agreementDate),
      };
    })
    .slice(0, EXHIBIT_C_ENTITY_MAX);
}

/** Merge void-check ACH into exhibitCEntities JSON; returns serialized list or ''. */
export function upsertExhibitCEntitiesJson(
  existingRaw: unknown,
  source: {
    accountHolderName?: string;
    dba?: string;
    bankName?: string;
    accountNumber?: string;
    routingNumber?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  },
): string {
  const holder = str(source.accountHolderName);
  const account = str(source.accountNumber);
  if (!holder && !account && !str(source.routingNumber)) {
    const existing = parseExhibitCEntitiesRaw(existingRaw);
    return existing.length ? JSON.stringify(existing) : '';
  }

  const next: ExhibitCEntityRow = {
    id: `exhibit-c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    clientLegalName: holder,
    clientName: '',
    accountHolderName: holder,
    accountHolderDba: str(source.dba),
    accountHolderAddress: str(source.address),
    accountHolderCity: str(source.city),
    accountHolderState: str(source.state),
    accountHolderZip: str(source.zip),
    bankName: str(source.bankName),
    bankAccount: account,
    bankRouting: str(source.routingNumber),
    bankPortal: '',
    bankUsername: '',
    bankPassword: '',
    securityQa1: '',
    securityQa2: '',
    agreementDate: '',
  };

  const existing = parseExhibitCEntitiesRaw(existingRaw);
  const matchIdx = existing.findIndex((row) => {
    if (account && str(row.bankAccount) === account) return true;
    if (holder && normalizeBusinessNameKey(row.accountHolderName) === normalizeBusinessNameKey(holder)) {
      return true;
    }
    if (holder && normalizeBusinessNameKey(row.clientLegalName) === normalizeBusinessNameKey(holder)) {
      return true;
    }
    return false;
  });

  let merged: ExhibitCEntityRow[];
  if (matchIdx >= 0) {
    const prev = existing[matchIdx];
    merged = existing.map((row, i) =>
      i === matchIdx
        ? {
            ...prev,
            clientLegalName: next.clientLegalName || prev.clientLegalName,
            accountHolderName: next.accountHolderName || prev.accountHolderName,
            accountHolderDba: next.accountHolderDba || prev.accountHolderDba,
            accountHolderAddress: next.accountHolderAddress || prev.accountHolderAddress,
            accountHolderCity: next.accountHolderCity || prev.accountHolderCity,
            accountHolderState: next.accountHolderState || prev.accountHolderState,
            accountHolderZip: next.accountHolderZip || prev.accountHolderZip,
            bankName: next.bankName || prev.bankName,
            bankAccount: next.bankAccount || prev.bankAccount,
            bankRouting: next.bankRouting || prev.bankRouting,
          }
        : row,
    );
  } else if (existing.length >= EXHIBIT_C_ENTITY_MAX) {
    merged = existing;
  } else {
    merged = [...existing, next];
  }

  return merged.length ? JSON.stringify(merged) : '';
}

function exhibitCEntityRowHasData(row: ExhibitCEntityRow | undefined): boolean {
  if (!row) return false;
  return Boolean(
    row.clientLegalName ||
      row.clientName ||
      row.accountHolderName ||
      row.accountHolderDba ||
      row.accountHolderAddress ||
      row.bankName ||
      row.bankAccount ||
      row.bankRouting,
  );
}

/**
 * Which Exhibit C slot a void-check scan fills, or null when the scan is the
 * deal's own ACH / funding bank.
 *
 * Every Exhibit C addendum (the first one included) is an independent record
 * that starts blank. The deal's first check is its funding bank and never
 * reaches an Exhibit C. Once the deal has its bank, a check for another account
 * fills the first Exhibit C still blank; re-scanning a check already on an
 * Exhibit C goes back to that slot.
 */
export function pickExhibitCCopySlotForVoidCheck(args: {
  existingRaw: unknown;
  /** Exhibit C documents on the contract. */
  copyCount: number;
  /** The deal's own ACH / funding bank account, if any. */
  mainBankAccount?: string | null;
  accountNumber?: string | null;
}): number | null {
  const copyCount = Math.min(EXHIBIT_C_ENTITY_MAX, Math.floor(args.copyCount || 0));
  if (copyCount < 1) return null;
  const account = digitsOnly(str(args.accountNumber));
  const mainAccount = digitsOnly(str(args.mainBankAccount));
  // No funding bank yet: this check is it.
  if (!mainAccount || !account || account === mainAccount) return null;
  const entities = parseExhibitCEntitiesRaw(args.existingRaw);
  const matchIdx = entities.findIndex((row) => digitsOnly(row.bankAccount) === account);
  if (matchIdx >= 0) return matchIdx;
  for (let i = 0; i < copyCount; i += 1) {
    if (!exhibitCEntityRowHasData(entities[i])) return i;
  }
  return null;
}

/** Write a void-check scan into Exhibit C entity slot `index` only; returns serialized list. */
export function setExhibitCEntitySlotFromVoidCheckJson(
  existingRaw: unknown,
  index: number,
  source: Parameters<typeof upsertExhibitCEntitiesJson>[1],
): string {
  const idx = Math.max(0, Math.min(EXHIBIT_C_ENTITY_MAX - 1, Math.floor(index)));
  const existing = parseExhibitCEntitiesRaw(existingRaw);
  const empty = (): ExhibitCEntityRow => ({
    id: `exhibit-c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    clientLegalName: '',
    clientName: '',
    accountHolderName: '',
    accountHolderDba: '',
    accountHolderAddress: '',
    accountHolderCity: '',
    accountHolderState: '',
    accountHolderZip: '',
    bankName: '',
    bankAccount: '',
    bankRouting: '',
    bankPortal: '',
    bankUsername: '',
    bankPassword: '',
    securityQa1: '',
    securityQa2: '',
    agreementDate: '',
  });
  const next = [...existing];
  while (next.length <= idx) next.push(empty());
  const prev = next[idx];
  const holder = str(source.accountHolderName);
  next[idx] = {
    ...prev,
    clientLegalName: holder || prev.clientLegalName,
    accountHolderName: holder || prev.accountHolderName,
    accountHolderDba: str(source.dba) || prev.accountHolderDba,
    accountHolderAddress: str(source.address) || prev.accountHolderAddress,
    accountHolderCity: str(source.city) || prev.accountHolderCity,
    accountHolderState: str(source.state) || prev.accountHolderState,
    accountHolderZip: str(source.zip) || prev.accountHolderZip,
    bankName: str(source.bankName) || prev.bankName,
    bankAccount: str(source.accountNumber) || prev.bankAccount,
    bankRouting: str(source.routingNumber) || prev.bankRouting,
  };
  return JSON.stringify(next);
}

export function normalizeKycDocumentType(raw: unknown): KycDocumentType | null {
  return resolveKycUploadSlot(raw)?.documentType ?? null;
}

export function isKycDocumentType(raw: unknown): boolean {
  return resolveKycUploadSlot(raw) != null;
}
