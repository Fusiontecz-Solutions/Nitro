import type { ContractPrefillField } from "./Contract";

/**
 * Flex Addendum — CRM-editable fields only (page 1).
 * Owner print names and signatures on page 2 are filled at signing, not in this editor.
 */
export interface KatanFlexAddendumContractPrefillFields {
    addendumDate?: string;
    agreementDate?: string;
    merchantName?: string;
    dailyPayment?: string;
}

const EDITOR_FIELD_DEFS: Array<{ id: keyof KatanFlexAddendumContractPrefillFields; label: string }> =
    [
        { id: "addendumDate", label: "Addendum date" },
        { id: "agreementDate", label: "Agreement date" },
        { id: "merchantName", label: "Merchant name" },
        { id: "dailyPayment", label: "Latest estimated payment" },
    ];

export const FLEX_ADDENDUM_TAB_LABEL_BY_KEY: Record<
    keyof KatanFlexAddendumContractPrefillFields,
    string
> = {
    addendumDate: "addendum_date",
    agreementDate: "agreement_date",
    merchantName: "client_legal_name",
    dailyPayment: "daily_payment",
};

export function buildKatanFlexAddendumContractPrefillFields(
    values: KatanFlexAddendumContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label } of EDITOR_FIELD_DEFS) {
        const v = String(values[id] ?? "").trim();
        out.push({ id: FLEX_ADDENDUM_TAB_LABEL_BY_KEY[id], label, value: v });
    }
    return out;
}
