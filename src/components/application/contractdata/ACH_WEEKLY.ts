import type { ContractPrefillField } from "./Contract";

/** Unique SignNow names (`_p1_ach`) so ACH Weekly does not collide with PCM_CONTRACT. */

export interface AchWeeklyContractPrefillFields {
    clientName?: string;
    remittance?: string;
    remittanceStartDate?: string;
    purchaseAmount?: string;
    billingName?: string;
    billingAddress?: string;
    billingCity?: string;
    billingState?: string;
    billingZip?: string;
    billingPhone?: string;
    billingEmail?: string;
    bankName?: string;
    routingNumber?: string;
    accountNumber?: string;
    printName?: string;
    printTitle?: string;
}

const FIELD_DEFS: Array<{
    id: keyof AchWeeklyContractPrefillFields;
    label: string;
    tab: string;
}> = [
    { id: "clientName", label: "Customer Name", tab: "client_name_p1_ach" },
    { id: "remittance", label: "Weekly Amount", tab: "remittance_p1_ach" },
    { id: "remittanceStartDate", label: "Starting On", tab: "remittance_start_date_p1_ach" },
    { id: "purchaseAmount", label: "Advance Amount", tab: "purchase_amount_p1_ach" },
    { id: "billingName", label: "Billing Name", tab: "billing_name_p1_ach" },
    { id: "billingAddress", label: "Billing Address", tab: "billing_address_p1_ach" },
    { id: "billingCity", label: "Billing City", tab: "billing_city_p1_ach" },
    { id: "billingState", label: "Billing State", tab: "billing_state_p1_ach" },
    { id: "billingZip", label: "Billing Zip", tab: "billing_zip_p1_ach" },
    { id: "billingPhone", label: "Billing Phone", tab: "merchant_contact_phone_p1_ach" },
    { id: "billingEmail", label: "Billing Email", tab: "merchant_contact_email_p1_ach" },
    { id: "bankName", label: "Bank Name", tab: "ach_bank_name_p1_ach" },
    { id: "routingNumber", label: "Routing Number", tab: "ach_bank_routing_p1_ach" },
    { id: "accountNumber", label: "Account Number", tab: "ach_bank_account_p1_ach" },
    { id: "printName", label: "Print Name", tab: "print_name_p1_ach" },
    { id: "printTitle", label: "Print Title", tab: "print_title_p1_ach" },
];

export const ACH_WEEKLY_TAB_LABEL_BY_KEY: Record<
    keyof AchWeeklyContractPrefillFields,
    string
> = Object.fromEntries(FIELD_DEFS.map((row) => [row.id, row.tab])) as Record<
    keyof AchWeeklyContractPrefillFields,
    string
>;

export function buildAchWeeklyContractPrefillFields(
    values: AchWeeklyContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label, tab } of FIELD_DEFS) {
        const v = String(values[id] ?? "").trim();
        out.push({
            id: tab,
            label,
            value: v,
        });
    }
    return out;
}
