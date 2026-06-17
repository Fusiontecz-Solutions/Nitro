import type { ContractPrefillField } from "./Contract";

const FIELD_IDS = {
    totalAmountOfFundProvided: ["total_amount_of_fund_provided"],
    totalAmountFundDisbursed: ["total_amount_fund_disbursed"],
    totalOfPayments: ["total_of_payments"],
    totalDollarCostOfFrinancing: ["total_dollar_cost_of_frinancing"],
    estimatedPayment: ["estimated_payment"],
    signatureDate: ["signature_date"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

/** BoldSign prefill source values for the Daily Kansas state disclosure template. */
export interface DailyKansasContractPrefillFields {
    totalAmountOfFundProvided?: string;
    totalAmountFundDisbursed?: string;
    totalOfPayments?: string;
    totalDollarCostOfFrinancing?: string;
    estimatedPayment?: string;
    signatureDate?: string;
}

/**
 * Maps Daily Kansas disclosure inputs to BoldSign `ContractPrefillField` rows
 * (same output shape as `buildContractPrefillFields` in `Contract.ts`).
 */
export function buildDailyKansasContractPrefillFields({
    totalAmountOfFundProvided = "",
    totalAmountFundDisbursed = "",
    totalOfPayments = "",
    totalDollarCostOfFrinancing = "",
    estimatedPayment = "",
    signatureDate = "",
}: DailyKansasContractPrefillFields = {}): ContractPrefillField[] {
    return [
        ...mapIds(
            FIELD_IDS.totalAmountOfFundProvided,
            "Total Amount Of Fund Provided",
            totalAmountOfFundProvided,
        ),
        ...mapIds(
            FIELD_IDS.totalAmountFundDisbursed,
            "Total Amount Fund Disbursed",
            totalAmountFundDisbursed,
        ),
        ...mapIds(FIELD_IDS.totalOfPayments, "Total Of Payments", totalOfPayments),
        ...mapIds(
            FIELD_IDS.totalDollarCostOfFrinancing,
            "Total Dollar Cost Of Frinancing",
            totalDollarCostOfFrinancing,
        ),
        ...mapIds(FIELD_IDS.estimatedPayment, "Estimated Payment", estimatedPayment),
        ...mapIds(FIELD_IDS.signatureDate, "Signature Date", signatureDate),
    ];
}
