import type { ContractPrefillField } from "./Contract";

export const ADDENDUM_P_SCOPE = "addendum_p_";

/** Prefill fields for Addendum P (required on REFI deals). */
export interface AddendumPContractPrefillFields {
    addendumDated?: string;
    agreementDated?: string;
    funderAndBusinessName?: string;
    payUpToAmount?: string;
    agreementToLabelName?: string;
    printName?: string;
    printTitle?: string;
}

const FIELD_DEFS: Array<{
    id: keyof AddendumPContractPrefillFields;
    label: string;
}> = [
    { id: "addendumDated", label: "Addendum Dated" },
    { id: "agreementDated", label: "Agreement Dated" },
    { id: "funderAndBusinessName", label: "Funder And Business Name" },
    { id: "payUpToAmount", label: "To Pay Up To Amount" },
    { id: "agreementToLabelName", label: "In The Agreement To Label" },
    { id: "printName", label: "Print Name" },
    { id: "printTitle", label: "Print Title" },
];

export const ADDENDUM_P_TAB_LABEL_BY_KEY: Record<
    keyof AddendumPContractPrefillFields,
    string
> = {
    addendumDated: `${ADDENDUM_P_SCOPE}addendum_dated`,
    agreementDated: `${ADDENDUM_P_SCOPE}agreement_dated`,
    funderAndBusinessName: `${ADDENDUM_P_SCOPE}funder_and_business_name`,
    payUpToAmount: `${ADDENDUM_P_SCOPE}pay_up_to_amount`,
    agreementToLabelName: `${ADDENDUM_P_SCOPE}agreement_to_label_name`,
    printName: `${ADDENDUM_P_SCOPE}print_name`,
    printTitle: `${ADDENDUM_P_SCOPE}print_title`,
};

export function buildAddendumPContractPrefillFields(
    values: AddendumPContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label } of FIELD_DEFS) {
        const v = String(values[id] ?? "").trim().toUpperCase();
        out.push({
            id: ADDENDUM_P_TAB_LABEL_BY_KEY[id],
            label,
            value: v,
        });
    }
    return out;
}
