import type { ContractPrefillField } from "./Contract";

export const ADDENDUM_NY_SCOPE = "addendum_ny_";

/** Prefill fields for New York Addendum NY (include with NY REFI disclosures). */
export interface AddendumNyContractPrefillFields {
    agreementDated?: string;
    agreementDated2?: string;
    funderAndBusinessName?: string;
    printName?: string;
    printTitle?: string;
}

const FIELD_DEFS: Array<{
    id: keyof AddendumNyContractPrefillFields;
    label: string;
}> = [
    { id: "agreementDated", label: "Agreement Dated" },
    { id: "agreementDated2", label: "Agreement Dated (2)" },
    { id: "funderAndBusinessName", label: "Funder And Business Name" },
    { id: "printName", label: "Print Name" },
    { id: "printTitle", label: "Print Title" },
];

export const ADDENDUM_NY_TAB_LABEL_BY_KEY: Record<
    keyof AddendumNyContractPrefillFields,
    string
> = {
    agreementDated: `${ADDENDUM_NY_SCOPE}agreement_dated`,
    agreementDated2: `${ADDENDUM_NY_SCOPE}agreement_dated_2`,
    funderAndBusinessName: `${ADDENDUM_NY_SCOPE}funder_and_business_name`,
    printName: `${ADDENDUM_NY_SCOPE}print_name`,
    printTitle: `${ADDENDUM_NY_SCOPE}print_title`,
};

export function buildAddendumNyContractPrefillFields(
    values: AddendumNyContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label } of FIELD_DEFS) {
        const v = String(values[id] ?? "").trim().toUpperCase();
        out.push({
            id: ADDENDUM_NY_TAB_LABEL_BY_KEY[id],
            label,
            value: v,
        });
    }
    return out;
}
