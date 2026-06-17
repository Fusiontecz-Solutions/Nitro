import type { ContractPrefillField } from "./Contract";

/** Every editable Florida disclosure field (matches DocuSign data labels on the PDF). */
export const FLORIDA_DISCLOSURE_FIELD_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
    {
        id: "total_amount_business_fund",
        label: "Total amount of funds provided (offer amount − fees)",
    },
    {
        id: "total_amount_of_fund_disbursed",
        label: "Total amount of funds disbursed to you",
    },
    {
        id: "total_amount_tobe_paid_to_provider",
        label: "Total amount to be paid to the provider",
    },
    {
        id: "total_dollar_cost",
        label: "Total dollar cost of the financing",
    },
    {
        id: "estimated_payment_amount",
        label: "Estimated amount of initial payments",
    },
    {
        id: "percent_of_business_income",
        label: "Payment Terms (% of merchant daily income purchased)",
    },
    {
        id: "payment_fallen_below_percent",
        label: "Prepayment — if payment has fallen below (%)",
    },
    {
        id: "consistent_with_percent",
        label: "Prepayment — consistent with (%)",
    },
    {
        id: "payment_exceeded_percent",
        label: "Prepayment — if payment exceeded (%)",
    },
    {
        id: "amount_required_to_trigger_prepayment_discount",
        label: "Amount required to trigger prepayment discount ($)",
    },
    {
        id: "client_name",
        label: "Merchant / recipient name",
    },
    {
        id: "funder_name",
        label: "Funder / provider name",
    },
    {
        id: "Signature_date",
        label: "Signature / disclosure date",
    },
];

const FIELD_IDS = {
    clientName: ["client_name"],
    funderName: ["funder_name"],
    totalAmountBusinessFund: ["total_amount_business_fund"],
    totalAmountOfFundDisbursed: ["total_amount_of_fund_disbursed"],
    totalAmountTobePaidToProvider: ["total_amount_tobe_paid_to_provider"],
    totalDollarCost: ["total_dollar_cost"],
    estimatedPaymentAmount: ["estimated_payment_amount"],
    paymentExceededPercent: ["payment_exceeded_percent"],
    percentOfBusinessIncome: ["percent_of_business_income"],
    paymentFallenBelowPercent: ["payment_fallen_below_percent"],
    consistentWithPercent: ["consistent_with_percent"],
    amountRequiredToTriggerPrepaymentDiscount: ["amount_required_to_trigger_prepayment_discount"],
    signatureDate: ["Signature_date"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

/** All Florida disclosure rows for the prefill editor (includes empty-value fields). */
export function buildFloridaDisclosureEditorFieldDefinitions(): ContractPrefillField[] {
    return FLORIDA_DISCLOSURE_FIELD_CATALOG.map((field) => ({
        id: field.id,
        label: field.label,
        value: ".",
    }));
}

/** BoldSign prefill source values for the Daily Florida state disclosure template. */
export interface DailyFloridaContractPrefillFields {
    clientName?: string;
    funderName?: string;
    totalAmountBusinessFund?: string;
    totalAmountOfFundDisbursed?: string;
    totalAmountTobePaidToProvider?: string;
    totalDollarCost?: string;
    estimatedPaymentAmount?: string;
    paymentExceededPercent?: string;
    percentOfBusinessIncome?: string;
    paymentFallenBelowPercent?: string;
    consistentWithPercent?: string;
    amountRequiredToTriggerPrepaymentDiscount?: string;
    signatureDate?: string;
}

export function buildDailyFloridaContractPrefillFields({
    clientName = "",
    funderName = "",
    totalAmountBusinessFund = "",
    totalAmountOfFundDisbursed = "",
    totalAmountTobePaidToProvider = "",
    totalDollarCost = "",
    estimatedPaymentAmount = "",
    paymentExceededPercent = "",
    percentOfBusinessIncome = "",
    paymentFallenBelowPercent = "",
    consistentWithPercent = "",
    amountRequiredToTriggerPrepaymentDiscount = "",
    signatureDate = "",
}: DailyFloridaContractPrefillFields = {}): ContractPrefillField[] {
    return [
        ...mapIds(FIELD_IDS.clientName, "Merchant / recipient name", clientName),
        ...mapIds(FIELD_IDS.funderName, "Funder / provider name", funderName),
        ...mapIds(FIELD_IDS.totalAmountBusinessFund, "Total Amount Business Fund", totalAmountBusinessFund),
        ...mapIds(
            FIELD_IDS.totalAmountOfFundDisbursed,
            "Total Amount Of Fund Disbursed",
            totalAmountOfFundDisbursed,
        ),
        ...mapIds(
            FIELD_IDS.totalAmountTobePaidToProvider,
            "Total Amount To Be Paid To Provider",
            totalAmountTobePaidToProvider,
        ),
        ...mapIds(FIELD_IDS.totalDollarCost, "Total Dollar Cost", totalDollarCost),
        ...mapIds(FIELD_IDS.estimatedPaymentAmount, "Estimated Payment Amount", estimatedPaymentAmount),
        ...mapIds(FIELD_IDS.paymentExceededPercent, "Payment Exceeded Percent", paymentExceededPercent),
        ...mapIds(
            FIELD_IDS.percentOfBusinessIncome,
            "Payment Terms (% of merchant daily income purchased)",
            percentOfBusinessIncome,
        ),
        ...mapIds(
            FIELD_IDS.paymentFallenBelowPercent,
            "Payment Fallen Below Percent",
            paymentFallenBelowPercent,
        ),
        ...mapIds(FIELD_IDS.consistentWithPercent, "Consistent With Percent", consistentWithPercent),
        ...mapIds(
            FIELD_IDS.amountRequiredToTriggerPrepaymentDiscount,
            "Amount Required To Trigger Prepayment Discount",
            amountRequiredToTriggerPrepaymentDiscount,
        ),
        ...mapIds(FIELD_IDS.signatureDate, "Signature Date", signatureDate),
    ];
}
