import type { ContractPrefillField } from "./Contract";

/** Virginia disclosure address: street + city on line 1, state + ZIP on line 2. */
export function formatVirginiaDisclosureRecipientAddress(parts: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
}): string {
    const street = String(parts.street ?? "").trim();
    const city = String(parts.city ?? "").trim();
    const state = String(parts.state ?? "").trim();
    const zip = String(parts.zip ?? "").trim();
    const line1 = [street, city].filter(Boolean).join(", ");
    const line2 = [state, zip].filter(Boolean).join(", ");
    if (line1 && line2) return `${line1},\n${line2}`;
    return [line1, line2].filter(Boolean).join("\n");
}

const FIELD_IDS = {
    totalAmountSalesBasedFinancing: ["total_amount_sales_based_financing"],
    feesDeducted: ["fees_deducted"],
    disbursementAmount: ["disbursement_amount"],
    financeCharge: ["finance_charge"],
    totalRepaymentAmount: ["total_repayment_amount"],
    estimatedNumberOfPayement: ["estimated_number_of_payement"],
    disclosureDate: ["disclosure_date", "agreement_date"],
    disclosureName: ["disclosure_name"],
    recipientAddress: ["recipient_address"],
    signatureDate: ["signature_date"],
    recipientName2: ["recipient_name2"],
    disclosureDate2: ["disclosure_date2"],
    recipientAddress1: ["recipient_address1"],
    fordailypayments: ["fordailypayments"],
    weeklyPayments: ["weekly_payments"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

/** BoldSign prefill source values for the Daily Virginia state disclosure template. */
export interface DailyVirginiaContractPrefillFields {
    totalAmountSalesBasedFinancing?: string;
    feesDeducted?: string;
    disbursementAmount?: string;
    financeCharge?: string;
    totalRepaymentAmount?: string;
    estimatedNumberOfPayement?: string;
    disclosureDate?: string;
    disclosureName?: string;
    recipientAddress?: string;
    signatureDate?: string;
    recipientName2?: string;
    disclosureDate2?: string;
    recipientAddress1?: string;
    fordailypayments?: string;
    weeklyPayments?: string;
}

export function buildDailyVirginiaContractPrefillFields({
    totalAmountSalesBasedFinancing = "",
    feesDeducted = "",
    disbursementAmount = "",
    financeCharge = "",
    totalRepaymentAmount = "",
    estimatedNumberOfPayement = "",
    disclosureDate = "",
    disclosureName = "",
    recipientAddress = "",
    signatureDate = "",
    recipientName2 = "",
    disclosureDate2 = "",
    recipientAddress1 = "",
    fordailypayments = "",
    weeklyPayments = "",
}: DailyVirginiaContractPrefillFields = {}): ContractPrefillField[] {
    return [
        ...mapIds(
            FIELD_IDS.totalAmountSalesBasedFinancing,
            "Total Amount Sales Based Financing",
            totalAmountSalesBasedFinancing,
        ),
        ...mapIds(FIELD_IDS.feesDeducted, "Fees Deducted", feesDeducted),
        ...mapIds(FIELD_IDS.disbursementAmount, "Disbursement Amount", disbursementAmount),
        ...mapIds(FIELD_IDS.financeCharge, "Finance Charge", financeCharge),
        ...mapIds(FIELD_IDS.totalRepaymentAmount, "Total Repayment Amount", totalRepaymentAmount),
        ...mapIds(
            FIELD_IDS.estimatedNumberOfPayement,
            "Estimated Number Of Payement",
            estimatedNumberOfPayement,
        ),
        ...mapIds(FIELD_IDS.disclosureDate, "Disclosure Date", disclosureDate),
        ...mapIds(FIELD_IDS.disclosureName, "Disclosure Name", disclosureName),
        ...mapIds(FIELD_IDS.recipientAddress, "Recipient Address", recipientAddress),
        ...mapIds(FIELD_IDS.signatureDate, "Signature Date", signatureDate),
        ...mapIds(FIELD_IDS.recipientName2, "Recipient Name 2", recipientName2),
        ...mapIds(FIELD_IDS.disclosureDate2, "Disclosure Date 2", disclosureDate2),
        ...mapIds(FIELD_IDS.recipientAddress1, "Recipient Address 1", recipientAddress1),
        ...mapIds(FIELD_IDS.fordailypayments, "For Daily Payments", fordailypayments),
        ...mapIds(FIELD_IDS.weeklyPayments, "Weekly Payments", weeklyPayments),
    ];
}
