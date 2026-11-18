import { decryptSensitiveField } from './fieldEncryption';

/**
 * Prefill override keys that hold the same logical value on different contract
 * stages. Mirrors the CRM editor's "Sync to all" groups (`PREFILL_SYNC_GROUPS`).
 *
 * Different documents read different copies — the ACH account-holder page reads
 * `achAuthorizationAccountHolderBank*`, the funding page `authorizationClientBank*` —
 * so a value edited on only one stage printed the old value on the other pages.
 *
 * Deliberately absent: the ACH account-holder name and address against the
 * business (see the editor's comments), and every Exhibit C entity, which is its own
 * business and lives outside these flat keys.
 */
export const SHARED_PREFILL_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['federalTaxIdEin', 'securityTaxEin', 'authorizationClientTaxId'],
  ['doingBusinessAs', 'achAuthorizationAccountHolderDba'],
  ['authorizationClientBankRouting', 'achAuthorizationAccountHolderBankRoutingNumber'],
  ['authorizationClientBankAccount', 'achAuthorizationAccountHolderBankAccountNumber'],
  ['authorizationClientBankName', 'achAuthorizationAccountHolderBankName'],
  ['legalName', 'authorizationClientName'],
  ['clientEmail', 'guarantorEmail'],
  ['clientPhone', 'guarantorPhone', 'authorizedBusinessPhone', 'achAuthorizationAccountHolderPhone'],
  ['businessAddressContract', 'guarantorAddress', 'achAuthorizationAccountHolderAddress'],
  ['businessAddressContractCity', 'guarantorAddressCity', 'achAuthorizationAccountHolderCity'],
  ['businessAddressContractState', 'guarantorAddressState', 'achAuthorizationAccountHolderState'],
  ['businessAddressContractZip', 'guarantorAddressZip', 'achAuthorizationAccountHolderZip'],
];

function plain(value: unknown): string {
  if (value == null || typeof value === 'object') return '';
  const raw = String(value).trim();
  if (!raw) return '';
  return String(decryptSensitiveField(raw) ?? raw).trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Carry a shared value changed on one stage into its other copies.
 *
 * Only copies the save did not change themselves follow, and only when every
 * changed copy agrees — two copies deliberately set to different values in the
 * same save are left as saved. A group nobody touched is left alone too, so this
 * never guesses which of two long-standing values is right.
 */
export function levelChangedSharedPrefillAliases(
  previous: unknown,
  next: unknown,
): Record<string, unknown> | null {
  const incoming = asRecord(next);
  if (!incoming) return null;
  const before = asRecord(previous) ?? {};
  const out: Record<string, unknown> = { ...incoming };
  for (const group of SHARED_PREFILL_ALIAS_GROUPS) {
    const changed = group.filter((key) => {
      const value = plain(incoming[key]);
      return value !== '' && value !== plain(before[key]);
    });
    if (!changed.length) continue;
    const values = new Set(changed.map((key) => plain(incoming[key])));
    if (values.size !== 1) continue;
    const [value] = [...values];
    for (const key of group) {
      if (!changed.includes(key)) out[key] = value;
    }
  }
  return out;
}
