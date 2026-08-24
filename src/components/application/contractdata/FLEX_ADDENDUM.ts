import type { ContractPrefillField } from "./Contract";

/** SignNow Flex Addendum unique names — installment table + owner lines. */

export interface FlexAddendumContractPrefillFields {
    installmentDays?: string[];
    dailyPayments?: string[];
    receivablePurchases?: string[];
    owner1Name?: string;
    owner1Ssn?: string;
    owner2Name?: string;
    owner2Ssn?: string;
}

const INSTALLMENT_ROWS = 10;

export function buildFlexAddendumContractPrefillFields(
    values: FlexAddendumContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (let i = 1; i <= INSTALLMENT_ROWS; i += 1) {
        const idx = i - 1;
        out.push({
            id: `installment_day_${i}_p1`,
            label: `Installment ${i} — Date`,
            value: String(values.installmentDays?.[idx] ?? "").trim(),
        });
        out.push({
            id: `daily_payment_${i}_p1`,
            label: `Installment ${i} — Payment Amount`,
            value: String(values.dailyPayments?.[idx] ?? "").trim(),
        });
        out.push({
            id: `receivable_purchase_${i}_p1`,
            label: `Installment ${i} — Receivables Purchased`,
            value: String(values.receivablePurchases?.[idx] ?? "").trim(),
        });
    }
    out.push({
        id: "owner1_guarantor_name_p1",
        label: "Owner / Guarantor #1 Name",
        value: String(values.owner1Name ?? "").trim(),
    });
    out.push({
        id: "guaranty_ss_p1",
        label: "Owner / Guarantor #1 SSN",
        value: String(values.owner1Ssn ?? "").trim(),
    });
    out.push({
        id: "owner2_guarantor_name_p1",
        label: "Owner / Guarantor #2 Name",
        value: String(values.owner2Name ?? "").trim(),
    });
    out.push({
        id: "guaranty_owner2_ss_p1",
        label: "Owner / Guarantor #2 SSN",
        value: String(values.owner2Ssn ?? "").trim(),
    });
    return out;
}
