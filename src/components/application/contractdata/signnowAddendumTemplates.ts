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
export const SIGNNOW_EPA_LAYOUT_KEY = "epa";
export const SIGNNOW_EPA_TEMPLATE_ID =
    "084719dbcd1142c4b5ce8bcde5e253193fc47a4b";
export const SIGNNOW_MONTHLY_FEE_LAYOUT_KEY = "monthly_fee";
export const SIGNNOW_MONTHLY_FEE_TEMPLATE_ID =
    "d28e14071cc743d699d5ed70dafb5d43256c3fa2";
export const SIGNNOW_DISCLOSURE_LAYOUT_KEY = "signnow_disclosure";
export const SIGNNOW_DISCLOSURE_TEMPLATE_ID =
    "ce1229f11a6942118bded3e3cb8715434dc3f8af";

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
    if (key === SIGNNOW_EPA_TEMPLATE_ID) return true;
    if (key === SIGNNOW_MONTHLY_FEE_TEMPLATE_ID) return true;
    // Settings → Funders may store a raw SignNow template id as the option key.
    if (/^[a-f0-9]{40}$/i.test(key)) return true;
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
        key === SIGNNOW_DISCLOSURE_TEMPLATE_ID.toLowerCase() ||
        key.endsWith("_signnow_disclosure")
    );
}
