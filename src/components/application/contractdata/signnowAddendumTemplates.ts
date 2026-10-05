import type { SupplementalDocumentOption } from "./platformDocumentConfig";

/** SignNow document-group addenda merged with PCM_CONTRACT on send. */
export const SIGNNOW_ACH_DAILY_LAYOUT_KEY = "ach_daily";
export const SIGNNOW_ACH_DAILY_TEMPLATE_ID =
    "5741b00ce3aa425bb96415ff89b67aa7b8b3daa6";
export const SIGNNOW_ACH_WEEKLY_LAYOUT_KEY = "ach_weekly";
export const SIGNNOW_ACH_WEEKLY_TEMPLATE_ID =
    "37c76f0cae974ca085d0acf64bdf054686cb2815";
export const SIGNNOW_EXHIBIT_C_LAYOUT_KEY = "exhibit_c";
export const SIGNNOW_EXHIBIT_C_TEMPLATE_ID =
    "00fcf8fd543d4c4a8323633190a9066959f081a8";
export const SIGNNOW_EXHIBIT_A_LAYOUT_KEY = "exhibit_a";
export const SIGNNOW_EXHIBIT_A_TEMPLATE_ID =
    "a3f7578942f44c15b392c5cee48ee720c53c8c03";
export const SIGNNOW_FLEX_ADDENDUM_LAYOUT_KEY = "flex_addendum";
export const SIGNNOW_FLEX_ADDENDUM_TEMPLATE_ID =
    "b5c267f0f50e4fd9a7f901c840106984402824f8";
export const SIGNNOW_PAYOFF_ADDENDUM_LAYOUT_KEY = "payoff_addendum";
export const SIGNNOW_PAYOFF_ADDENDUM_TEMPLATE_ID =
    "f43506d2bed645099045b75bd9abc6f5825e7bf6";
/**
 * Tiberian Funding's own copy of the PayOff Addendum (Settings -> Funders names
 * it "Payoff Addendum"). Like every funder copy it is stored under its own
 * 40-char SignNow id, so a ref-only caller — one holding the id but no display
 * name — cannot tell it is a payoff addendum from the id alone. Naming it here
 * is what lets `resolveAddendumKind` reach the payoff prefill for this funder.
 */
export const SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID =
    "1a242e0fb07c41d08fd0f3d25662d61a86642a36";
/**
 * Tiberian Funding's own copy of the Flex Addendum (document group "FLEX
 * TIBERIAN FUNDING", document ebff2427d00e46fc8b3cac79be9689dd0bf59fc6). Its
 * installment table has an extra "Net Funds Provided" column and 24 rows, and
 * every widget is named differently from the Nitro copy, so it gets its own
 * field map (see `buildTiberianFlexAddendumContractPrefillFields`).
 */
export const SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID =
    "18be4342d4514c3b96b0d9f4852f0af1790fd04d";
export const SIGNNOW_EPA_LAYOUT_KEY = "epa";
export const SIGNNOW_EPA_TEMPLATE_ID =
    "084719dbcd1142c4b5ce8bcde5e253193fc47a4b";
export const SIGNNOW_MONTHLY_FEE_LAYOUT_KEY = "monthly_fee";
export const SIGNNOW_MONTHLY_FEE_TEMPLATE_ID =
    "d28e14071cc743d699d5ed70dafb5d43256c3fa2";
export const SIGNNOW_DISCLOSURE_LAYOUT_KEY = "signnow_disclosure";
export const SIGNNOW_DISCLOSURE_TEMPLATE_ID =
    "ce1229f11a6942118bded3e3cb8715434dc3f8af";

/**
 * Funder-specific SignNow disclosure templates, by template id.
 *
 * Each funder uploads its own copy of the state disclosure (Obsidian Capital
 * Group, Tiberian Funding, …) and Settings -> Funders stores it under that
 * copy's own 40-char SignNow id rather than the shared `signnow_disclosure`
 * key, so two funders' copies never overwrite each other's mapping. Those ids
 * are not knowable up front, so `mapFunderSignNowTemplates` registers each one
 * here as the funder profiles load; a ref-only caller (which has the id but no
 * document type in hand) can then still tell a disclosure from an addendum.
 *
 * Seeded with Tiberian Funding's id so a disclosure-only send is recognized
 * before any funder profile has been fetched.
 */
export const SIGNNOW_TIBERIAN_DISCLOSURE_TEMPLATE_ID =
    "46bffdc5ef0c4eef80a05e627fa34d999c216502";

const signNowDisclosureTemplateIds = new Set<string>([
    SIGNNOW_DISCLOSURE_TEMPLATE_ID,
    SIGNNOW_TIBERIAN_DISCLOSURE_TEMPLATE_ID,
]);

/** Record a funder's disclosure template ids / layout keys (never cleared — ids are stable). */
export function registerSignNowDisclosureTemplateRefs(
    refs: ReadonlyArray<string | null | undefined>,
): void {
    for (const ref of refs) {
        const key = String(ref ?? "")
            .trim()
            .toLowerCase();
        if (key) signNowDisclosureTemplateIds.add(key);
    }
}

export const SIGNNOW_ADDENDUM_TEMPLATE_OPTIONS: SupplementalDocumentOption[] = [
    { layoutKey: SIGNNOW_ACH_DAILY_LAYOUT_KEY, label: "ACH Daily" },
    { layoutKey: SIGNNOW_ACH_WEEKLY_LAYOUT_KEY, label: "ACH Weekly" },
    { layoutKey: SIGNNOW_EXHIBIT_A_LAYOUT_KEY, label: "Exhibit A" },
    { layoutKey: SIGNNOW_EXHIBIT_C_LAYOUT_KEY, label: "Exhibit C" },
    { layoutKey: SIGNNOW_FLEX_ADDENDUM_LAYOUT_KEY, label: "Flex Addendum" },
    { layoutKey: SIGNNOW_PAYOFF_ADDENDUM_LAYOUT_KEY, label: "PayOff Addendum (Refi)" },
    { layoutKey: SIGNNOW_EPA_LAYOUT_KEY, label: "EPA Nitro Advance" },
    { layoutKey: SIGNNOW_MONTHLY_FEE_LAYOUT_KEY, label: "Monthly Fee" },
];

export function isSignNowAddendumLayoutKey(value: unknown): boolean {
    const key = String(value ?? "")
        .trim()
        .toLowerCase();
    if (!key) return false;
    if (SIGNNOW_ADDENDUM_TEMPLATE_OPTIONS.some((opt) => opt.layoutKey === key)) {
        return true;
    }
    if (key === SIGNNOW_ACH_DAILY_TEMPLATE_ID) return true;
    if (key === SIGNNOW_ACH_WEEKLY_TEMPLATE_ID) return true;
    if (key === SIGNNOW_EXHIBIT_C_TEMPLATE_ID) return true;
    if (key === SIGNNOW_EXHIBIT_A_TEMPLATE_ID) return true;
    if (key === SIGNNOW_FLEX_ADDENDUM_TEMPLATE_ID) return true;
    if (key === SIGNNOW_PAYOFF_ADDENDUM_TEMPLATE_ID) return true;
    if (key === SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID) return true;
    if (key === SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID) return true;
    if (key === SIGNNOW_EPA_TEMPLATE_ID) return true;
    if (key === SIGNNOW_MONTHLY_FEE_TEMPLATE_ID) return true;
    // Settings → Funders may store a raw SignNow template id as the option key.
    // A funder's disclosure copy is stored the same way, so exclude the ids
    // registered as disclosures — they are not addenda.
    if (/^[a-f0-9]{40}$/i.test(key)) return !signNowDisclosureTemplateIds.has(key);
    return (
        key.endsWith("_ach_daily") ||
        key.endsWith("_ach_weekly") ||
        key.endsWith("_exhibit_a") ||
        key.endsWith("_exhibit_c") ||
        key.endsWith("_payoff_addendum") ||
        key.endsWith("_monthly_fee") ||
        key === SIGNNOW_FLEX_ADDENDUM_LAYOUT_KEY ||
        key === SIGNNOW_EPA_LAYOUT_KEY ||
        key.endsWith("_epa")
    );
}

export function isSignNowDisclosureLayoutKey(value: unknown): boolean {
    const key = String(value ?? "")
        .trim()
        .toLowerCase();
    if (!key) return false;
    return (
        key === SIGNNOW_DISCLOSURE_LAYOUT_KEY ||
        signNowDisclosureTemplateIds.has(key) ||
        key.endsWith("_signnow_disclosure")
    );
}

/** True for Tiberian Funding's PayOff Addendum copy (its own SignNow template id). */
export function isTiberianPayoffAddendumRef(
    ...refs: ReadonlyArray<string | null | undefined>
): boolean {
    return refs.some(
        (ref) =>
            String(ref ?? "")
                .trim()
                .toLowerCase()
                .replace(/^bs:/i, "") === SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID,
    );
}

/** True for Tiberian Funding's Flex Addendum copy (its own SignNow template id). */
export function isTiberianFlexAddendumRef(
    ...refs: ReadonlyArray<string | null | undefined>
): boolean {
    return refs.some(
        (ref) =>
            String(ref ?? "")
                .trim()
                .toLowerCase()
                .replace(/^bs:/i, "") === SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID,
    );
}
