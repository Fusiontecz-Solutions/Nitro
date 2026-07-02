/** Prefix for disclosure PDF tab values in the shared DocuSign prefill map (isolated from contract). */
export const DISCLOSURE_PDF_FIELD_PREFIX = "disclosure_pdf:";

export function toDisclosureScopedPrefillId(pdfFieldId: string): string {
    return `${DISCLOSURE_PDF_FIELD_PREFIX}${String(pdfFieldId || "").trim()}`;
}

export function fromDisclosureScopedPrefillId(id: string): string | null {
    const token = String(id || "").trim();
    if (!token.startsWith(DISCLOSURE_PDF_FIELD_PREFIX)) return null;
    return token.slice(DISCLOSURE_PDF_FIELD_PREFIX.length) || null;
}

export const FLEX_ADDENDUM_SCOPE = "flex_addendum_";
export const BALANCE_TRANSFER_SCOPE = "balance_transfer_";

/** Map funder-specific layout keys to platform coordinate layouts. */
export function resolveCanonicalSupplementalLayoutKey(layoutKey?: string | null): string | null {
    const k = String(layoutKey ?? "").trim().toLowerCase();
    if (!k) return null;
    if (k === "flex_addendum" || k.endsWith("_flex_addendum")) return "flex_addendum";
    if (k === "balance_transfer" || k.endsWith("_balance_transfer")) return "balance_transfer";
    return null;
}

const FLEX_LEGACY_TO_SCOPED: Record<string, string> = {
    addendum_date: `${FLEX_ADDENDUM_SCOPE}addendum_date`,
    agreement_date: `${FLEX_ADDENDUM_SCOPE}agreement_date`,
    client_legal_name: `${FLEX_ADDENDUM_SCOPE}merchant_legal_name`,
    client_name: `${FLEX_ADDENDUM_SCOPE}client_name`,
    business_name_2: `${FLEX_ADDENDUM_SCOPE}business_name_2`,
    daily_payment_1: `${FLEX_ADDENDUM_SCOPE}daily_payment_1`,
    daily_payment_2: `${FLEX_ADDENDUM_SCOPE}daily_payment_2`,
    receivable_purchase_1: `${FLEX_ADDENDUM_SCOPE}receivable_purchase_1`,
    receivable_purchase_2: `${FLEX_ADDENDUM_SCOPE}receivable_purchase_2`,
    installment_day_1: `${FLEX_ADDENDUM_SCOPE}installment_day_1`,
    installment_day_2: `${FLEX_ADDENDUM_SCOPE}installment_day_2`,
};

const BALANCE_TRANSFER_LEGACY_TO_SCOPED: Record<string, string> = {
    date_of_new_secured_agreement: `${BALANCE_TRANSFER_SCOPE}date_of_new_secured_agreement`,
    date_of_previous_secured_agreement: `${BALANCE_TRANSFER_SCOPE}date_of_previous_secured_agreement`,
    remaining_rtr_balance: `${BALANCE_TRANSFER_SCOPE}remaining_rtr_balance`,
    merchant_legal_name: `${BALANCE_TRANSFER_SCOPE}merchant_legal_name`,
    business_legal_name: `${BALANCE_TRANSFER_SCOPE}business_legal_name`,
    dba: `${BALANCE_TRANSFER_SCOPE}dba`,
    client_name_by: `${BALANCE_TRANSFER_SCOPE}client_name_by`,
    client_legal_name: `${BALANCE_TRANSFER_SCOPE}client_legal_name`,
    business_address: `${BALANCE_TRANSFER_SCOPE}business_address`,
    business_address_city: `${BALANCE_TRANSFER_SCOPE}business_address_city`,
    business_address_state: `${BALANCE_TRANSFER_SCOPE}business_address_state`,
    business_address_zip: `${BALANCE_TRANSFER_SCOPE}business_address_zip`,
};

export function normalizeFlexAddendumSavedOverrides(
    savedForRow: Record<string, string> | null | undefined,
): Record<string, string> {
    const saved = { ...(savedForRow ?? {}) };
    for (const [legacy, scoped] of Object.entries(FLEX_LEGACY_TO_SCOPED)) {
        const legacyVal = String(saved[legacy] ?? "").trim();
        if (legacyVal && !String(saved[scoped] ?? "").trim()) {
            saved[scoped] = legacyVal;
        }
        if (legacy in saved) delete saved[legacy];
    }
    return saved;
}

export function normalizeBalanceTransferScopedSavedOverrides(
    savedForRow: Record<string, string> | null | undefined,
): Record<string, string> {
    const saved = { ...(savedForRow ?? {}) };
    for (const [legacy, scoped] of Object.entries(BALANCE_TRANSFER_LEGACY_TO_SCOPED)) {
        const legacyVal = String(saved[legacy] ?? "").trim();
        if (legacyVal && !String(saved[scoped] ?? "").trim()) {
            if (
                legacy === "client_legal_name" &&
                scoped === `${BALANCE_TRANSFER_SCOPE}client_legal_name`
            ) {
                const businessLegal = String(
                    saved[`${BALANCE_TRANSFER_SCOPE}business_legal_name`] ??
                        saved.business_legal_name ??
                        "",
                ).trim();
                if (businessLegal && legacyVal.toLowerCase() === businessLegal.toLowerCase()) {
                    delete saved[legacy];
                    continue;
                }
            }
            saved[scoped] = legacyVal;
        }
        if (legacy in saved) delete saved[legacy];
    }
    // Contract page 1 shares the PDF data label `client_legal_name` — never keep unscoped.
    delete saved.client_legal_name;
    return saved;
}

/** Remove legacy unscoped keys after normalization so merges cannot overwrite contract fields. */
export function stripUnscopedAddendumOverrideKeys(
    fields: Record<string, string>,
    kind: "katan_flex" | "balance_transfer_sheet",
): Record<string, string> {
    const out = { ...fields };
    const legacyKeys =
        kind === "katan_flex"
            ? Object.keys(FLEX_LEGACY_TO_SCOPED)
            : [...Object.keys(BALANCE_TRANSFER_LEGACY_TO_SCOPED), "client_legal_name"];
    for (const key of legacyKeys) {
        delete out[key];
    }
    return out;
}
