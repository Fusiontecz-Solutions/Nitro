import type { ContractPrefillField } from "./Contract";

export const ADDENDUM_VA_SCOPE = "addendum_va_";

/** Prefill fields for Virginia Addendum VA (include with VA disclosures). */
export interface AddendumVaContractPrefillFields {
    agreementDated?: string;
    agreementDated2?: string;
    funderAndBusinessName?: string;
    printName?: string;
    printTitle?: string;
    agreementDatedPage2?: string;
    agreementDatedPage2b?: string;
    funderAndBusinessNamePage2?: string;
    printNamePage2?: string;
    printTitlePage2?: string;
}

const FIELD_DEFS: Array<{
    id: keyof AddendumVaContractPrefillFields;
    label: string;
}> = [
    { id: "agreementDated", label: "Agreement Dated" },
    { id: "agreementDated2", label: "Agreement Dated (2)" },
    { id: "funderAndBusinessName", label: "Funder And Business Name" },
    { id: "printName", label: "Print Name" },
    { id: "printTitle", label: "Print Title" },
    { id: "agreementDatedPage2", label: "Agreement Dated (Page 2)" },
    { id: "agreementDatedPage2b", label: "Agreement Dated (Page 2b)" },
    { id: "funderAndBusinessNamePage2", label: "Funder And Business Name (Page 2)" },
    { id: "printNamePage2", label: "Print Name (Page 2)" },
    { id: "printTitlePage2", label: "Print Title (Page 2)" },
];

export const ADDENDUM_VA_TAB_LABEL_BY_KEY: Record<
    keyof AddendumVaContractPrefillFields,
    string
> = {
    agreementDated: `${ADDENDUM_VA_SCOPE}agreement_dated`,
    agreementDated2: `${ADDENDUM_VA_SCOPE}agreement_dated_2`,
    funderAndBusinessName: `${ADDENDUM_VA_SCOPE}funder_and_business_name`,
    printName: `${ADDENDUM_VA_SCOPE}print_name`,
    printTitle: `${ADDENDUM_VA_SCOPE}print_title`,
    agreementDatedPage2: `${ADDENDUM_VA_SCOPE}agreement_dated_page2`,
    agreementDatedPage2b: `${ADDENDUM_VA_SCOPE}agreement_dated_page2b`,
    funderAndBusinessNamePage2: `${ADDENDUM_VA_SCOPE}funder_and_business_name_page2`,
    printNamePage2: `${ADDENDUM_VA_SCOPE}print_name_page2`,
    printTitlePage2: `${ADDENDUM_VA_SCOPE}print_title_page2`,
};

export function buildAddendumVaContractPrefillFields(
    values: AddendumVaContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label } of FIELD_DEFS) {
        const v = String(values[id] ?? "").trim().toUpperCase();
        out.push({
            id: ADDENDUM_VA_TAB_LABEL_BY_KEY[id],
            label,
            value: v,
        });
    }
    return out;
}
