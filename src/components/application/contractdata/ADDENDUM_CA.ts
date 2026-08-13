import type { ContractPrefillField } from "./Contract";

export const ADDENDUM_CA_SCOPE = "addendum_ca_";

/** Prefill fields for California Addendum CA (include with CA REFI disclosures). */
export interface AddendumCaContractPrefillFields {
    agreementDated?: string;
    agreementDated2?: string;
    funderAndBusinessName?: string;
    agreementAprPercent?: string;
    printName?: string;
    printTitle?: string;
    agreementDatedPage3?: string;
    agreementDatedPage3b?: string;
    funderAndBusinessNamePage3?: string;
    printNamePage3?: string;
    printTitlePage3?: string;
}

const FIELD_DEFS: Array<{
    id: keyof AddendumCaContractPrefillFields;
    label: string;
}> = [
    { id: "agreementDated", label: "Agreement Dated" },
    { id: "agreementDated2", label: "Agreement Dated (2)" },
    { id: "funderAndBusinessName", label: "Funder And Business Name" },
    { id: "agreementAprPercent", label: "This Agreement Is APR %" },
    { id: "printName", label: "Print Name" },
    { id: "printTitle", label: "Print Title" },
    { id: "agreementDatedPage3", label: "Agreement Dated (Page 3)" },
    { id: "agreementDatedPage3b", label: "Agreement Dated (Page 3b)" },
    { id: "funderAndBusinessNamePage3", label: "Funder And Business Name (Page 3)" },
    { id: "printNamePage3", label: "Print Name (Page 3)" },
    { id: "printTitlePage3", label: "Print Title (Page 3)" },
];

export const ADDENDUM_CA_TAB_LABEL_BY_KEY: Record<
    keyof AddendumCaContractPrefillFields,
    string
> = {
    agreementDated: `${ADDENDUM_CA_SCOPE}agreement_dated`,
    agreementDated2: `${ADDENDUM_CA_SCOPE}agreement_dated_2`,
    funderAndBusinessName: `${ADDENDUM_CA_SCOPE}funder_and_business_name`,
    agreementAprPercent: `${ADDENDUM_CA_SCOPE}agreement_apr_percent`,
    printName: `${ADDENDUM_CA_SCOPE}print_name`,
    printTitle: `${ADDENDUM_CA_SCOPE}print_title`,
    agreementDatedPage3: `${ADDENDUM_CA_SCOPE}agreement_dated_page3`,
    agreementDatedPage3b: `${ADDENDUM_CA_SCOPE}agreement_dated_page3b`,
    funderAndBusinessNamePage3: `${ADDENDUM_CA_SCOPE}funder_and_business_name_page3`,
    printNamePage3: `${ADDENDUM_CA_SCOPE}print_name_page3`,
    printTitlePage3: `${ADDENDUM_CA_SCOPE}print_title_page3`,
};

export function buildAddendumCaContractPrefillFields(
    values: AddendumCaContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label } of FIELD_DEFS) {
        const v = String(values[id] ?? "").trim().toUpperCase();
        out.push({
            id: ADDENDUM_CA_TAB_LABEL_BY_KEY[id],
            label,
            value: v,
        });
    }
    return out;
}
