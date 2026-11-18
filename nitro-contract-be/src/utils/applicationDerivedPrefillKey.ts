/**
 * Words that mark a prefill key as a copy of application / client / owner data.
 * Matched against the key split into words (`businessAddressCity` → business, address,
 * city; `owner_1_email` → owner, 1, email), so offer and document values such as
 * `disclosure_avg_monthly_revenue` or `installment_day_1_p1` never match.
 *
 * Shared by contract regeneration (which drops such flat keys so an edited address
 * reaches the new package) and the SignNow prefill (which lets the live CRM value
 * outrank a stale copy saved on an addendum / disclosure tab).
 */
const APPLICATION_DERIVED_KEY_TOKENS = new Set([
    'address',
    'street',
    'city',
    'state',
    'zip',
    'zipcode',
    'postal',
    'email',
    'phone',
    'mobile',
    'fax',
    'name',
    'ein',
    'ssn',
    'dob',
    'birth',
    'tax',
    'guarantor',
    'legal',
    'dba',
    'doing',
    'entity',
    'bank',
    'routing',
    'account',
]);

function prefillKeyTokens(key: string): string[] {
    return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Za-z])([0-9])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

export function isApplicationDerivedPrefillKey(key: string): boolean {
    return prefillKeyTokens(key).some((token) => APPLICATION_DERIVED_KEY_TOKENS.has(token));
}
