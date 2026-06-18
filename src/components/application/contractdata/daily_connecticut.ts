import type { ContractPrefillField } from "./Contract";

const FIELD_IDS = {
    totalCommericalFinancing: ["total_commerical_financing"],
    deductedAtDisbursement: ["deducted_at_disbursement"],
    totalAmountCommercialFinancing: ["total_amount_commercial_financing"],
    financeCharge: ["finance_charge"],
    totalRepaymentAmount: ["total_repayment_amount"],
    estimatedTimePeriodicPaymement: ["estimated_time_periodic_paymement"],
    disclosureDate: ["disclosure_date"],
    recipientName: ["recipient_name"],
    recipientAddress: ["recipient_address"],
    amountTriggerPrepayment: ["amount_trigger_prepayment"],
    dateWhichAmountReceived: ["date_which_amount_received"],
    recipientName2: ["recipient_name2"],
    disclosureDate2: ["disclosure_date2"],
    recipientAddress2: ["recipient_address2"],
    theestimatedpayment: ["theestimatedpayment"],
    paymentExceedPercent: ["payment_exceed_percent"],
    signature1Date: ["signature1_date"],
    signature2Date: ["signature2_date"],
    connecticutReviewField1: ["connecticut_review_field_1"],
    connecticutReviewField2: ["connecticut_review_field_2"],
    connecticutReviewField3: ["connecticut_review_field_3"],
    connecticutReviewField4: ["connecticut_review_field_4"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

/** BoldSign prefill source values for the Daily Connecticut state disclosure template. */
export interface DailyConnecticutContractPrefillFields {
    totalCommericalFinancing?: string;
    deductedAtDisbursement?: string;
    totalAmountCommercialFinancing?: string;
    financeCharge?: string;
    totalRepaymentAmount?: string;
    estimatedTimePeriodicPaymement?: string;
    disclosureDate?: string;
    recipientName?: string;
    recipientAddress?: string;
    amountTriggerPrepayment?: string;
    dateWhichAmountReceived?: string;
    recipientName2?: string;
    disclosureDate2?: string;
    recipientAddress2?: string;
    theestimatedpayment?: string;
    paymentExceedPercent?: string;
    signature1Date?: string;
    signature2Date?: string;
    connecticutReviewField1?: string;
    connecticutReviewField2?: string;
    connecticutReviewField3?: string;
    connecticutReviewField4?: string;
}

export function buildDailyConnecticutContractPrefillFields({
    totalCommericalFinancing = "",
    deductedAtDisbursement = "",
    totalAmountCommercialFinancing = "",
    financeCharge = "",
    totalRepaymentAmount = "",
    estimatedTimePeriodicPaymement = "",
    disclosureDate = "",
    recipientName = "",
    recipientAddress = "",
    amountTriggerPrepayment = "",
    dateWhichAmountReceived = "",
    recipientName2 = "",
    disclosureDate2 = "",
    recipientAddress2 = "",
    theestimatedpayment = "",
    paymentExceedPercent = "",
    signature1Date = "",
    signature2Date = "",
    connecticutReviewField1 = "",
    connecticutReviewField2 = "",
    connecticutReviewField3 = "",
    connecticutReviewField4 = "",
}: DailyConnecticutContractPrefillFields = {}): ContractPrefillField[] {
    return [
        ...mapIds(FIELD_IDS.totalCommericalFinancing, "Total Commerical Financing", totalCommericalFinancing),
        ...mapIds(FIELD_IDS.deductedAtDisbursement, "Deducted At Disbursement", deductedAtDisbursement),
        ...mapIds(
            FIELD_IDS.totalAmountCommercialFinancing,
            "Total Amount Commercial Financing",
            totalAmountCommercialFinancing,
        ),
        ...mapIds(FIELD_IDS.financeCharge, "Finance Charge", financeCharge),
        ...mapIds(FIELD_IDS.totalRepaymentAmount, "Total Repayment Amount", totalRepaymentAmount),
        ...mapIds(
            FIELD_IDS.estimatedTimePeriodicPaymement,
            "Estimated Time Periodic Paymement",
            estimatedTimePeriodicPaymement,
        ),
        ...mapIds(FIELD_IDS.disclosureDate, "Disclosure Date", disclosureDate),
        ...mapIds(FIELD_IDS.recipientName, "Recipient Name", recipientName),
        ...mapIds(FIELD_IDS.recipientAddress, "Recipient Address", recipientAddress),
        ...mapIds(FIELD_IDS.amountTriggerPrepayment, "Amount Trigger Prepayment", amountTriggerPrepayment),
        ...mapIds(FIELD_IDS.dateWhichAmountReceived, "Date Which Amount Received", dateWhichAmountReceived),
        ...mapIds(FIELD_IDS.recipientName2, "Recipient Name 2", recipientName2),
        ...mapIds(FIELD_IDS.disclosureDate2, "Disclosure Date 2", disclosureDate2),
        ...mapIds(FIELD_IDS.recipientAddress2, "Recipient Address 2", recipientAddress2),
        ...mapIds(FIELD_IDS.theestimatedpayment, "The Estimated Payment", theestimatedpayment),
        ...mapIds(FIELD_IDS.paymentExceedPercent, "Payment Exceed Percent", paymentExceedPercent),
        ...mapIds(FIELD_IDS.signature1Date, "Signature1 Date", signature1Date),
        ...mapIds(FIELD_IDS.signature2Date, "Signature2 Date", signature2Date),
        ...mapIds(
            FIELD_IDS.connecticutReviewField1,
            "Outstanding loan balance paid from disbursement (optional)",
            connecticutReviewField1,
        ),
        ...mapIds(
            FIELD_IDS.connecticutReviewField2,
            "New financing for prepayment charges & unpaid interest (optional)",
            connecticutReviewField2,
        ),
        ...mapIds(
            FIELD_IDS.connecticutReviewField3,
            "Prepayment charges payable to provider (optional)",
            connecticutReviewField3,
        ),
        ...mapIds(
            FIELD_IDS.connecticutReviewField4,
            "Unpaid interest payable to provider (optional)",
            connecticutReviewField4,
        ),
    ];
}

/** Editor slot definitions for optional Connecticut review fields (empty by default). */
export function buildConnecticutOptionalReviewFieldDefinitions(): ContractPrefillField[] {
    return [
        {
            id: "connecticut_review_field_1",
            label: "Outstanding loan balance paid from disbursement (optional)",
            value: "",
        },
        {
            id: "connecticut_review_field_2",
            label: "New financing for prepayment charges & unpaid interest (optional)",
            value: "",
        },
        {
            id: "connecticut_review_field_3",
            label: "Prepayment charges payable to provider (optional)",
            value: "",
        },
        {
            id: "connecticut_review_field_4",
            label: "Unpaid interest payable to provider (optional)",
            value: "",
        },
    ];
}