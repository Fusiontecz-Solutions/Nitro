import type { ContractPrefillField } from "./Contract";
import { formatUSD } from "@/utils/formatCurrency";
import { FLEX_ADDENDUM_SCOPE } from "./documentPrefillScope";

/** Tab ids for payment schedule money cells — formatted as USD on PDF output. */
export const FLEX_ADDENDUM_MONEY_TAB_IDS = new Set([
    `${FLEX_ADDENDUM_SCOPE}daily_payment_1`,
    `${FLEX_ADDENDUM_SCOPE}receivable_purchase_1`,
    `${FLEX_ADDENDUM_SCOPE}daily_payment_2`,
    `${FLEX_ADDENDUM_SCOPE}receivable_purchase_2`,
]);

/** Format flex addendum payment / receivable values as $X,XXX.XX (empty when not numeric). */
export function formatFlexAddendumMoneyDisplay(value: string): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return "";
    return formatUSD(trimmed, { fallback: "" });
}

/**
 * Flex Addendum — CRM-editable fields only (page 1).
 * Payment schedule: two installments (Day 1 / Day 16), each with payment amount + receivables purchased.
 * Owner print names and signatures on page 2 are filled at signing, not in this editor.
 */
export interface KatanFlexAddendumContractPrefillFields {
    addendumDate?: string;
    agreementDate?: string;
    merchantName?: string;
    clientName?: string;
    /** Second merchant / owner print name (page 2) when two signers. */
    businessName2?: string;
    /** Day of month — first installment (default Day 1). */
    installmentDay1?: string;
    /** Day of month — second installment (default Day 16). */
    installmentDay2?: string;
    /** Payment amount — first installment (Day 1). */
    dailyPayment1?: string;
    /** Receivables purchased — first installment (Day 1). */
    receivablePurchase1?: string;
    /** Payment amount — second installment (Day 16). */
    dailyPayment2?: string;
    /** Receivables purchased — second installment (Day 16). */
    receivablePurchase2?: string;
}

const EDITOR_FIELD_DEFS: Array<{ id: keyof KatanFlexAddendumContractPrefillFields; label: string }> =
    [
        { id: "addendumDate", label: "Addendum date" },
        { id: "agreementDate", label: "Agreement date" },
        { id: "merchantName", label: "Merchant legal name" },
        { id: "clientName", label: "Client name" },
        { id: "businessName2", label: "Merchant 2 / owner 2 name" },
        { id: "installmentDay1", label: "Installment day — 1st payment" },
        { id: "installmentDay2", label: "Installment day — 2nd payment" },
        { id: "dailyPayment1", label: "Payment amount — 1st installment (Day 1)" },
        { id: "receivablePurchase1", label: "Receivables purchased — 1st installment (Day 1)" },
        { id: "dailyPayment2", label: "Payment amount — 2nd installment (Day 16)" },
        { id: "receivablePurchase2", label: "Receivables purchased — 2nd installment (Day 16)" },
    ];

export const FLEX_ADDENDUM_TAB_LABEL_BY_KEY: Record<
    keyof KatanFlexAddendumContractPrefillFields,
    string
> = {
    addendumDate: `${FLEX_ADDENDUM_SCOPE}addendum_date`,
    agreementDate: `${FLEX_ADDENDUM_SCOPE}agreement_date`,
    merchantName: `${FLEX_ADDENDUM_SCOPE}merchant_legal_name`,
    clientName: `${FLEX_ADDENDUM_SCOPE}client_name`,
    businessName2: `${FLEX_ADDENDUM_SCOPE}business_name_2`,
    installmentDay1: `${FLEX_ADDENDUM_SCOPE}installment_day_1`,
    installmentDay2: `${FLEX_ADDENDUM_SCOPE}installment_day_2`,
    dailyPayment1: `${FLEX_ADDENDUM_SCOPE}daily_payment_1`,
    receivablePurchase1: `${FLEX_ADDENDUM_SCOPE}receivable_purchase_1`,
    dailyPayment2: `${FLEX_ADDENDUM_SCOPE}daily_payment_2`,
    receivablePurchase2: `${FLEX_ADDENDUM_SCOPE}receivable_purchase_2`,
};

export function buildKatanFlexAddendumContractPrefillFields(
    values: KatanFlexAddendumContractPrefillFields = {},
): ContractPrefillField[] {
    const resolved: KatanFlexAddendumContractPrefillFields = {
        installmentDay1: "1",
        installmentDay2: "16",
        ...values,
    };
    const out: ContractPrefillField[] = [];
    for (const { id, label } of EDITOR_FIELD_DEFS) {
        const raw = String(resolved[id] ?? "").trim();
        const tabId = FLEX_ADDENDUM_TAB_LABEL_BY_KEY[id];
        const value = FLEX_ADDENDUM_MONEY_TAB_IDS.has(tabId)
            ? formatFlexAddendumMoneyDisplay(raw)
            : raw;
        out.push({ id: tabId, label, value });
    }
    return out;
}
