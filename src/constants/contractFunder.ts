import { DOCUSIGN_EMAIL_LENDER_NAME } from "@/components/application/contractdata/docusignTemplateConfig";

export const DEFAULT_FUNDER_NAME = DOCUSIGN_EMAIL_LENDER_NAME;

/** Default funder options shown in Contract Information. */
export const DEFAULT_FUNDER_OPTIONS: readonly string[] = [DEFAULT_FUNDER_NAME];

/** Coerce stored funder values to Woodmere Financial (platform uses one lender brand). */
export function normalizeLegacyFunderName(value: unknown): string {
    const v = String(value ?? "").trim();
    if (!v) return "";
    if (v.toLowerCase() === DEFAULT_FUNDER_NAME.toLowerCase()) return DEFAULT_FUNDER_NAME;
    return DEFAULT_FUNDER_NAME;
}

export function pickFunderForSelect(
    value: unknown,
    options: readonly string[] = DEFAULT_FUNDER_OPTIONS,
): string {
    const v = normalizeLegacyFunderName(value);
    if (!v) return "";
    const exact = options.find((s) => s === v);
    if (exact) return exact;
    return options.find((s) => s.toLowerCase() === v.toLowerCase()) ?? "";
}
