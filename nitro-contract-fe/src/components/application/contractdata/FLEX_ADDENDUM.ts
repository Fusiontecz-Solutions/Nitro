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

/**
 * Tiberian Funding's Flex Addendum (template 18be4342…, document ebff2427…,
 * "FLEX TIBERIAN FUNDING"). Read off the live SignNow template, not assumed:
 * the installment table has 24 rows and four columns, left to right
 * `payment_date_N` | `net_funds_provided_N` | `payment_amount_N` |
 * `receivables_purchased_N` (no `_p1` suffix), and the owner block is
 * `owner_guarantor_{1,2}_name` / `owner_guarantor_{1,2}_ssn`. The two
 * `owner_guarantor_{1,2}_signature` widgets belong to the signers.
 *
 * The PDF's printed headers read Date | Payment Amount | Net Funds Provided |
 * Receivables Purchased, i.e. the template's widget names are swapped against
 * its own headers: `net_funds_provided_N` (x=188) is printed under "Payment
 * Amount" and `payment_amount_N` (x=323) under "Net Funds Provided". Values
 * are routed by where they print, not by the widget's name.
 */
export interface TiberianFlexAddendumContractPrefillFields {
    paymentDates?: string[];
    netFundsProvided?: string[];
    paymentAmounts?: string[];
    receivablesPurchased?: string[];
    owner1Name?: string;
    owner1Ssn?: string;
    owner2Name?: string;
    owner2Ssn?: string;
}

export const TIBERIAN_FLEX_INSTALLMENT_ROWS = 24;

export function buildTiberianFlexAddendumContractPrefillFields(
    values: TiberianFlexAddendumContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (let i = 1; i <= TIBERIAN_FLEX_INSTALLMENT_ROWS; i += 1) {
        const idx = i - 1;
        out.push({
            id: `payment_date_${i}`,
            label: `Installment ${i} — Date`,
            value: String(values.paymentDates?.[idx] ?? "").trim(),
        });
        // Printed under the "Payment Amount" header.
        out.push({
            id: `net_funds_provided_${i}`,
            label: `Installment ${i} — Payment Amount`,
            value: String(values.paymentAmounts?.[idx] ?? "").trim(),
        });
        // Printed under the "Net Funds Provided" header.
        out.push({
            id: `payment_amount_${i}`,
            label: `Installment ${i} — Net Funds Provided`,
            value: String(values.netFundsProvided?.[idx] ?? "").trim(),
        });
        out.push({
            id: `receivables_purchased_${i}`,
            label: `Installment ${i} — Receivables Purchased`,
            value: String(values.receivablesPurchased?.[idx] ?? "").trim(),
        });
    }
    out.push({
        id: "owner_guarantor_1_name",
        label: "Owner / Guarantor #1 Name",
        value: String(values.owner1Name ?? "").trim(),
    });
    out.push({
        id: "owner_guarantor_1_ssn",
        label: "Owner / Guarantor #1 SSN",
        value: String(values.owner1Ssn ?? "").trim(),
    });
    out.push({
        id: "owner_guarantor_2_name",
        label: "Owner / Guarantor #2 Name",
        value: String(values.owner2Name ?? "").trim(),
    });
    out.push({
        id: "owner_guarantor_2_ssn",
        label: "Owner / Guarantor #2 SSN",
        value: String(values.owner2Ssn ?? "").trim(),
    });
    return out;
}
