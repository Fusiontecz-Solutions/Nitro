import type { ContractPrefillField } from "./Contract";

/** BoldSign merge `roles[].formFields` row (camelCase; server normalizes to PascalCase). */
export type WeeklyCaliforniaMergeRoleFormField = {
    id: string;
    name?: string;
    fieldType: string;
    pageNumber: number;
    bounds: { x: number; y: number; width: number; height: number };
    value?: string;
    /** When set, BoldSign ties the field to that merged signer `roleIndex` (secondary template = 2). */
    roleIndex?: number;
};

const dummyText = (
    id: string,
    pageNumber: number,
    x: number,
    y: number,
    value: string,
): WeeklyCaliforniaMergeRoleFormField => ({
    id,
    name: id,
    fieldType: "TextBox",
    pageNumber,
    bounds: { x, y, width: 160, height: 24 },
    value,
});

/**
 * Placeholder `formFields` for the Client role on the **second** merged template (Weekly CA disclosure).
 * BoldSign rejects merge when `FormFields` is null/empty for a template role that expects signer fields.
 * Replace with real coordinates/values from your BoldSign template when ready.
 */
export const weeklyCaliforniaMergeRoleDummyFormFields: WeeklyCaliforniaMergeRoleFormField[] = [
    dummyText("funding_provided", 1, 100, 96, "0"),
    dummyText("estimated_annual_percentage_rate", 1, 100, 264, "0%"),
    dummyText("estimated_payment", 1, 100, 618, "0"),
    dummyText("present_weekly_payment", 1, 280, 618, "0"),
    dummyText("out_estimated_percent", 1, 100, 340, "0%"),
    dummyText("average_monthly_income", 1, 280, 320, "0"),
    dummyText("payment_exceeded_percent", 1, 100, 400, "0%"),
    dummyText("estimated_term", 1, 100, 128, "0"),
    dummyText("prepayment", 1, 280, 128, "N/A"),
    {
        id: "Date",
        name: "Date",
        fieldType: "TextBox",
        pageNumber: 2,
        bounds: { x: 200, y: 495, width: 120, height: 22 },
        value: "01/01/2026",
    },
    {
        id: "Signature1",
        name: "Signature1",
        fieldType: "Signature",
        pageNumber: 2,
        bounds: { x: 78, y: 475, width: 200, height: 34 },
    },
];

/** Same dummy fields as {@link weeklyCaliforniaMergeRoleDummyFormFields}, each stamped with `roleIndex`. */
export function weeklyCaliforniaMergeRoleDummyFormFieldsForRole(
    roleIndex: number,
): Array<WeeklyCaliforniaMergeRoleFormField & { roleIndex: number }> {
    return weeklyCaliforniaMergeRoleDummyFormFields.map((f) => ({
        ...f,
        roleIndex,
    }));
}

const FIELD_IDS = {
    fundingProvided: ["funding_provided"],
    estimatedAnnualPercentageRate: ["estimated_annual_percentage_rate"],
    estimatedPayment: ["estimated_payment"],
    presentWeeklyPayment: ["present_weekly_payment"],
    outEstimatedPercent: ["out_estimated_percent"],
    averageMonthlyIncome: ["average_monthly_income"],
    paymentExceededPercent: ["payment_exceeded_percent"],
    estimatedTerm: ["estimated_term"],
    prepayment: ["prepayment"],
    date: ["Date"],
    signature1: ["Signature1"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

/** BoldSign prefill source values for the Weekly California state disclosure template. */
export interface WeeklyCaliforniaContractPrefillFields {
    fundingProvided?: string;
    estimatedAnnualPercentageRate?: string;
    estimatedPayment?: string;
    presentWeeklyPayment?: string;
    outEstimatedPercent?: string;
    averageMonthlyIncome?: string;
    paymentExceededPercent?: string;
    estimatedTerm?: string;
    prepayment?: string;
    /** Maps to BoldSign field id `Date`. */
    date?: string;
    /** Maps to BoldSign field id `Signature1`. */
    signature1?: string;
}

/**
 * Maps Weekly California disclosure inputs to BoldSign `ContractPrefillField` rows
 * (same shape as `buildContractPrefillFields` in `Contract.ts`).
 */

export function buildWeeklyCaliforniaContractPrefillFields({
    fundingProvided = "",
    estimatedAnnualPercentageRate = "",
    estimatedPayment = "",
    presentWeeklyPayment = "",
    outEstimatedPercent = "",
    averageMonthlyIncome = "",
    paymentExceededPercent = "",
    estimatedTerm = "",
    prepayment = "",
    date = "",
    signature1 = "",
}: WeeklyCaliforniaContractPrefillFields = {}): ContractPrefillField[] {
    return [
        ...mapIds(FIELD_IDS.fundingProvided, "Funding Provided", fundingProvided),
        ...mapIds(
            FIELD_IDS.estimatedAnnualPercentageRate,
            "Estimated Annual Percentage Rate",
            estimatedAnnualPercentageRate,
        ),
        ...mapIds(FIELD_IDS.estimatedPayment, "Estimated Payment", estimatedPayment),
        ...mapIds(FIELD_IDS.presentWeeklyPayment, "Present Weekly Payment", presentWeeklyPayment),
        ...mapIds(FIELD_IDS.outEstimatedPercent, "Out Estimated Percent", outEstimatedPercent),
        ...mapIds(FIELD_IDS.averageMonthlyIncome, "Average Monthly Income", averageMonthlyIncome),
        ...mapIds(
            FIELD_IDS.paymentExceededPercent,
            "Payment Exceeded Percent",
            paymentExceededPercent,
        ),
        ...mapIds(FIELD_IDS.estimatedTerm, "Estimated Term", estimatedTerm),
        ...mapIds(FIELD_IDS.prepayment, "Prepayment", prepayment),
        ...mapIds(FIELD_IDS.date, "Date", date),
        ...mapIds(FIELD_IDS.signature1, "Signature 1", signature1),
    ];
}
