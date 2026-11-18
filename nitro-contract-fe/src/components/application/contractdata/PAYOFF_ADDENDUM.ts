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

/**
 * Tiberian Funding's SignNow copy of the PayOff Addendum
 * (`1a242e0fb07c41d08fd0f3d25662d61a86642a36`, "PAYOFF ADDENDUM TIBERIAN
 * FUNDING.docx"). Its widget names were read off the live template, not
 * assumed, and they differ from the Nitro / Obsidian copy above in three ways:
 *
 *  - no `addendum_p_agreement_to_label_name_p1` — Tiberian's creditor name is
 *    printed into the document text instead of a fillable widget;
 *  - no `addendum_p_funder_and_business_namehalf_p1` — the merchant DBA line
 *    is likewise not a widget on this copy;
 *  - the print-name widget carries SignNow's trailing-space name
 *    `addendum_p_print_name_p1 T`, and the signature line has its own
 *    `signature_date_p1` date widget.
 *
 * Every other widget name is byte-identical to the Nitro copy, so those ids are
 * repeated here rather than aliased — this list is the template's inventory.
 */
export interface TiberianPayoffAddendumContractPrefillFields {
    addendumDated?: string;
    funderAndBusinessName?: string;
    payUpToAmount?: string;
    netToMerchant?: string;
    printName?: string;
    printTitle?: string;
    signatureDate?: string;
}

const TIBERIAN_FIELD_DEFS: Array<{
    id: keyof TiberianPayoffAddendumContractPrefillFields;
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
        id: "payUpToAmount",
        label: "Authorized Payoff Amount",
        tab: "addendum_p_pay_up_to_amount_p1",
    },
    { id: "netToMerchant", label: "Net Amount to Merchant", tab: "net_to_merchant_p1" },
    // SignNow's own widget name on this copy — the trailing " T" is part of it.
    { id: "printName", label: "Print Name", tab: "addendum_p_print_name_p1 T" },
    { id: "printTitle", label: "Print Title", tab: "addendum_p_print_title_p1" },
    { id: "signatureDate", label: "Signature Date", tab: "signature_date_p1" },
];

export function buildTiberianPayoffAddendumContractPrefillFields(
    values: TiberianPayoffAddendumContractPrefillFields = {},
): ContractPrefillField[] {
    return TIBERIAN_FIELD_DEFS.map(({ id, label, tab }) => ({
        id: tab,
        label,
        value: String(values[id] ?? "").trim(),
    }));
}
