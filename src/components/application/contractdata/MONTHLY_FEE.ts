import type { ContractPrefillField } from "./Contract";

/** SignNow Monthly Fee unique names. */

export interface MonthlyFeeContractPrefillFields {
    businessName?: string;
    businessPhone?: string;
    businessAddress?: string;
    holderName?: string;
    holderDba?: string;
    holderAddress?: string;
    bankName?: string;
    bankRouting?: string;
    bankAccount?: string;
    programFee?: string;
    paymentDate?: string;
    firstPaymentDate?: string;
    numberOfPayments?: string;
    printName?: string;
}

const FIELD_DEFS: Array<{
    id: keyof MonthlyFeeContractPrefillFields;
    label: string;
    tab: string;
}> = [
    {
        id: "businessName",
        label: "Authorized Business Name",
        tab: "authorization_client_name_p1",
    },
    {
        id: "businessPhone",
        label: "Authorized Business Phone",
        tab: "authorized_business_phone_p1",
    },
    { id: "businessAddress", label: "Business Address", tab: "business_address_p1" },
    { id: "holderName", label: "Account Holder Name", tab: "ach_account_holder_name_p1" },
    { id: "holderDba", label: "Account Holder Business Name", tab: "ach_account_holder_dba_p1" },
    {
        id: "holderAddress",
        label: "Account Holder Address",
        tab: "ach_account_holder_address_p1",
    },
    { id: "bankName", label: "Bank Name", tab: "authorization_client_bank_name_p1" },
    {
        id: "bankRouting",
        label: "Bank Routing Number",
        tab: "authorization_client_bank_routing_p1",
    },
    {
        id: "bankAccount",
        label: "Bank Account Number",
        tab: "authorization_client_bank_account_p1",
    },
    { id: "programFee", label: "Amount of Payment", tab: "ach_program_fee_p1" },
    { id: "paymentDate", label: "Payment Date", tab: "remittance_start_date_p1" },
    { id: "firstPaymentDate", label: "First Payment Date", tab: "remittance_start_date_p1_s1" },
    {
        id: "numberOfPayments",
        label: "Number of Payments",
        tab: "estimated_number_of_payments_p1",
    },
    { id: "printName", label: "Print Name", tab: "authorization_client_name_print_p1" },
];

export function buildMonthlyFeeContractPrefillFields(
    values: MonthlyFeeContractPrefillFields = {},
): ContractPrefillField[] {
    return FIELD_DEFS.map(({ id, label, tab }) => ({
        id: tab,
        label,
        value: String(values[id] ?? "").trim(),
    }));
}
