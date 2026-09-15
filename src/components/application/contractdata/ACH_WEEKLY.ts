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
    /** The bottom "Date:" box (template widget `Text Field 1`). */
    signatureDate?: string;
}

/**
 * Verified against the live SignNow template (document 136150ac…, "ACH weekly")
 * with `npx ts-node --transpile-only src/scripts/inspectSignNowAchTemplates.ts`
 * in nitro-contract-be. Only widgets that actually exist on the PDF are listed.
 *
 * Two bottom widgets are misnamed on the template relative to their position:
 *   `Text Field 1`          sits on the "Date:" line
 *   `signature_date_p1_ach` sits on the "Printed Names:" line
 * They are routed by position in signnow-field-map.ts
 * (ACH_WEEKLY_POSITIONAL_FIELD_CRM_IDS). Renaming them in SignNow would let that
 * table be deleted.
 */
const FIELD_DEFS: Array<{
    id: keyof AchWeeklyContractPrefillFields;
    label: string;
    tab: string;
}> = [
    { id: "clientName", label: "Customer Name", tab: "client_name_p1_ach" },
    { id: "remittance", label: "Weekly Amount", tab: "remittance_p1_ach" },
    { id: "remittanceStartDate", label: "Starting On", tab: "remittance_start_date_p1_ach" },
    { id: "purchaseAmount", label: "Advance Amount", tab: "purchase_amount_p1_ach" },
    { id: "billingAddress", label: "Billing Address", tab: "business_address_p1_ach" },
    { id: "billingPhone", label: "Billing Phone", tab: "merchant_contact_phone_p1_ach" },
    { id: "billingEmail", label: "Billing Email", tab: "merchant_contact_email_p1_ach" },
    { id: "billingName", label: "Account Holder Name", tab: "ach_account_holder_name_p1_ach" },
    { id: "bankName", label: "Bank Name", tab: "ach_bank_name_p1_ach" },
    { id: "routingNumber", label: "Routing Number", tab: "ach_bank_routing_p1_ach" },
    { id: "accountNumber", label: "Account Number", tab: "ach_bank_account_p1_ach" },
    // Bottom section — tab names are the template's, positions are as documented above.
    { id: "signatureDate", label: "Date", tab: "Text Field 1" },
    { id: "printName", label: "Printed Names", tab: "signature_date_p1_ach" },
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
