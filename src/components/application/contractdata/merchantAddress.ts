/**
 * Merchant / business address as one printed line.
 *
 * Every funder's addendums — ACH Daily, ACH Weekly, Exhibit C, Monthly Fee —
 * carry the merchant (or account holder) address as a SINGLE SignNow widget,
 * with no City / State / Zip boxes beside it, unlike the application form and
 * the main agreement where the four parts each have their own field. Sending
 * only `business_address` there printed a bare street on the signed PDF, so the
 * street is composed with the city/state/zip the CRM already holds before it is
 * handed to the addendum builders.
 */

/**
 * Street ids to read for the Monthly Fee's "Account Holder Address" widget.
 *
 * That holder block sits under the business address the form already prints,
 * so its address is the GUARANTOR's — owner 1's home address — and
 * `guarantor_address` comes before the business ids. An address explicitly
 * saved on the deal's ACH record still wins, and the business address stays
 * only as a last resort so the widget is never blank.
 */
export const ACCOUNT_HOLDER_ADDRESS_STREET_IDS = [
    "ach_authorization_account_holder_address",
    "guarantor_address",
    "business_address_contract",
    "business_address",
];

/**
 * Street ids for the "Account Holder Business Address" line — Exhibit C and the
 * ACH authorization on every funder. That line is the business's physical
 * address, so only the business ids are read: the ACH holder key and the
 * guarantor ids carry Owner 1's home address (the driver's-licence KYC fills
 * them), which is exactly what used to be printed there.
 */
export const ACCOUNT_HOLDER_BUSINESS_ADDRESS_STREET_IDS = [
    "business_address",
    "security_business_address",
];

/** Builds `street, city, state zip`, skipping whatever part is missing. */
export function composeMerchantFullAddress(
    street?: string | null,
    city?: string | null,
    state?: string | null,
    zip?: string | null,
): string {
    const streetPart = String(street ?? "").trim();
    const cityPart = String(city ?? "").trim();
    const statePart = String(state ?? "").trim();
    const zipPart = String(zip ?? "").trim();
    const cityStateZip = [cityPart, [statePart, zipPart].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
    if (!streetPart) return cityStateZip;
    if (!cityStateZip) return streetPart;
    return `${streetPart}, ${cityStateZip}`;
}

/**
 * True when a value is already a whole address line, i.e. it ends in a zip
 * (`… GA 31088`, `… 31088-1234`). A comma alone is not enough — a suite typed
 * into address line 2 puts one in a street that still needs its city.
 */
export function addressAlreadyHasCityStateZip(value?: string | null): boolean {
    return /\d{5}(?:-\d{4})?$/.test(String(value ?? "").trim());
}

/** City/state/zip prefill ids to read when the street's own siblings are empty. */
const FALLBACK_ADDRESS_PREFIXES = [
    "business_address",
    "business_address_contract",
    "ach_authorization_account_holder",
];

/**
 * Resolves one full address line from a prefill getter: the first of
 * `streetIds` that has a value, composed with the city/state/zip found under
 * that same id, then under the shared business/owner ids.
 *
 * The parts are taken from ONE prefix at a time so an addendum can never pair
 * one address's street with another address's city.
 */
export function resolveMerchantFullAddress(
    get: (...ids: string[]) => string,
    streetIds: string[],
    fallbackStreet = "",
): string {
    const street = get(...streetIds) || String(fallbackStreet ?? "").trim();
    if (!street) return "";
    if (addressAlreadyHasCityStateZip(street)) return street;
    const prefixes = [
        ...streetIds,
        // `ach_authorization_account_holder_address` keeps its city under
        // `ach_authorization_account_holder_city`, without the `_address`.
        ...streetIds.map((id) => id.replace(/_address$/, "")),
        ...FALLBACK_ADDRESS_PREFIXES,
    ];
    const seen = new Set<string>();
    for (const prefix of prefixes) {
        if (!prefix || seen.has(prefix)) continue;
        seen.add(prefix);
        const city = get(`${prefix}_city`);
        const state = get(`${prefix}_state`);
        const zip = get(`${prefix}_zip`);
        if (!city && !state && !zip) continue;
        return composeMerchantFullAddress(street, city, state, zip);
    }
    return street;
}
