import type { ContractPrefillField } from "./Contract";

const FIELD_IDS = {
    fundingProvided: ["funding_provided"],
    estimatedAnnualPercentageRate: ["estimated_annual_percentage_rate"],
    estimatedPayment: ["estimated_payment"],
    dailyPayment: ["daily_payment"],
    estimatedPercent: ["estimated_percent"],
    avarageMonthlyIncome: ["avarage_monthly_income"],
    payementExceededPercent: ["payement_exceeded_percent"],
    monthlyIncome: ["monthly_income"],
    financeCharge: ["finance_charge"],
    signatureDate: ["signature_date"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

/** BoldSign prefill source values for the Daily California state disclosure template. */
export interface DailyCaliforniaContractPrefillFields {
    fundingProvided?: string;
    estimatedAnnualPercentageRate?: string;
    estimatedPayment?: string;
    dailyPayment?: string;
    estimatedPercent?: string;
    avarageMonthlyIncome?: string;
    payementExceededPercent?: string;
    monthlyIncome?: string;
    financeCharge?: string;
    signatureDate?: string;
}

export function buildDailyCaliforniaContractPrefillFields({
    fundingProvided = "",
    estimatedAnnualPercentageRate = "",
    estimatedPayment = "",
    dailyPayment = "",
    estimatedPercent = "",
    avarageMonthlyIncome = "",
    payementExceededPercent = "",
    monthlyIncome = "",
    financeCharge = "",
    signatureDate = "",
}: DailyCaliforniaContractPrefillFields = {}): ContractPrefillField[] {
    return [
        ...mapIds(FIELD_IDS.fundingProvided, "Funding Provided", fundingProvided),
        ...mapIds(
            FIELD_IDS.estimatedAnnualPercentageRate,
            "Estimated Annual Percentage Rate",
            estimatedAnnualPercentageRate,
        ),
        ...mapIds(FIELD_IDS.estimatedPayment, "Estimated Payment", estimatedPayment),
        ...mapIds(FIELD_IDS.dailyPayment, "Daily Payment", dailyPayment),
        ...mapIds(FIELD_IDS.estimatedPercent, "Estimated Percent", estimatedPercent),
        ...mapIds(FIELD_IDS.avarageMonthlyIncome, "Avarage Monthly Income", avarageMonthlyIncome),
        ...mapIds(
            FIELD_IDS.payementExceededPercent,
            "Payement Exceeded Percent",
            payementExceededPercent,
        ),
        ...mapIds(FIELD_IDS.monthlyIncome, "Monthly Income", monthlyIncome),
        ...mapIds(FIELD_IDS.financeCharge, "Finance Charge", financeCharge),
        ...mapIds(FIELD_IDS.signatureDate, "Signature Date", signatureDate),
    ];
}