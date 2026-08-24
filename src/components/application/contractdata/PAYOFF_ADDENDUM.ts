import type { ContractPrefillField } from "./Contract";

/** SignNow PayOff Addendum (Refi) unique names. */

export interface PayoffAddendumContractPrefillFields {
    addendumDated?: string;
    funderAndBusinessName?: string;
    merchantDba?: string;
    agreementToLabelName?: string;
    payUpToAmount?: string;
    netToMerchant?: string;
    printName?: string;
    printTitle?: string;
}

const FIELD_DEFS: Array<{
    id: keyof PayoffAddendumContractPrefillFields;
    label: string;
    tab: string;
}> = [
    { id: "addendumDated", label: "Addendum Dated", tab: "addendum_p_addendum_dated_p1" },
    {
        id: "funderAndBusinessName",
        label: "Merchant Name",
        tab: "addendum_p_funder_and_business_namefull_p1",
    },
    {
        id: "merchantDba",
        label: "Merchant DBA",
        tab: "addendum_p_funder_and_business_namehalf_p1",
    },
    {
        id: "agreementToLabelName",
        label: "Creditor / Funding Company",
        tab: "addendum_p_agreement_to_label_name_p1",
    },
    {
        id: "payUpToAmount",
        label: "Authorized Payoff Amount",
        tab: "addendum_p_pay_up_to_amount_p1",
    },
    { id: "netToMerchant", label: "Net Amount to Merchant", tab: "net_to_merchant_p1" },
    { id: "printName", label: "Print Name", tab: "addendum_p_print_name_p1" },
    { id: "printTitle", label: "Print Title", tab: "addendum_p_print_title_p1" },
];

export function buildPayoffAddendumContractPrefillFields(
    values: PayoffAddendumContractPrefillFields = {},
): ContractPrefillField[] {
    return FIELD_DEFS.map(({ id, label, tab }) => ({
        id: tab,
        label,
        value: String(values[id] ?? "").trim(),
    }));
}
