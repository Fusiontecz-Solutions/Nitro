import type { ContractPrefillField } from "./Contract";
import type {
    DisclosureCalculatorInputs,
    DisclosureCalculatorResult,
} from "./disclosureAprCalculator";
import {
    applyDisclosurePlatformFee,
    formatDisclosurePercent,
    formatDisclosureUsd,
} from "./disclosureAprCalculator";

const FIELD_IDS = {
    purchasePrice: ["purchase_price"],
    purchaseAmount: ["purchase_amount"],
    netToMerchant: ["net_to_merchant"],
    financeCharge: ["finance_charge"],
    remittance: ["remittance"],
    appendixUnderwritingFees: ["appendix_underwriting_fees"],
    paymentTermsPercent: ["payment_terms_percent", "disclosure_payment_terms", "payment_exceed_percent"],
    monthlyIncome: ["monthly_income"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim().toUpperCase();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

export interface DailyUtahContractPrefillFields {
    purchasePrice?: string;
    purchaseAmount?: string;
    netToMerchant?: string;
    financeCharge?: string;
    remittance?: string;
    appendixUnderwritingFees?: string;
    paymentTermsPercent?: string;
    monthlyIncome?: string;
}

export function buildDailyUtahContractPrefillFields({
    purchasePrice = "",
    purchaseAmount = "",
    netToMerchant = "",
    financeCharge = "",
    remittance = "",
    appendixUnderwritingFees = "",
    paymentTermsPercent = "",
    monthlyIncome = "",
}: DailyUtahContractPrefillFields = {}): ContractPrefillField[] {
    return [
        ...mapIds(FIELD_IDS.purchaseAmount, "Total Amount of Funds Provided", purchaseAmount),
        ...mapIds(FIELD_IDS.netToMerchant, "Total Amount of Funds Disbursed", netToMerchant),
        ...mapIds(
            FIELD_IDS.purchasePrice,
            "Total Amount to be Paid to Provider",
            purchasePrice,
        ),
        ...mapIds(
            FIELD_IDS.financeCharge,
            "Total Dollar Cost of the Commercial Financing Transaction",
            financeCharge,
        ),
        ...mapIds(
            FIELD_IDS.remittance,
            "Estimated Amount of the Initial Payment",
            remittance,
        ),
        ...mapIds(
            FIELD_IDS.monthlyIncome,
            "Average Monthly Revenue (Variable Payment)",
            monthlyIncome,
        ),
        ...mapIds(
            FIELD_IDS.appendixUnderwritingFees,
            "Amount of Funds Provided Paid to a Broker",
            appendixUnderwritingFees,
        ),
        ...mapIds(
            FIELD_IDS.paymentTermsPercent,
            "Payment Terms (% of daily revenue)",
            paymentTermsPercent,
        ),
    ];
}

/** Map disclosure calculator output → Utah DocuSign tab ids (`state-document-config.ts`). */
export function mapUtahDisclosureCalculatorToPdfFields(
    metrics: DisclosureCalculatorResult,
    inputs: Pick<
        DisclosureCalculatorInputs,
        "purchasePrice" | "brokerFeePaidByFunder" | "brokerFeePaidByMerchant"
    >,
): Record<string, string> {
    const brokerFeePaidToBroker =
        Math.max(0, inputs.brokerFeePaidByFunder ?? 0) +
        Math.max(0, inputs.brokerFeePaidByMerchant ?? 0);
    return {
        purchase_amount: formatDisclosureUsd(inputs.purchasePrice),
        /** Purchase Price on disclosure = funding amount (not payback). */
        purchase_price: formatDisclosureUsd(inputs.purchasePrice),
        /** Receivables / repayment amount merchant must repay. */
        receivables: formatDisclosureUsd(metrics.estimatedTotalPayment),
        revenue_purchased: formatDisclosureUsd(metrics.estimatedTotalPayment),
        total_of_payments: formatDisclosureUsd(metrics.estimatedTotalPayment),
        payment_total: formatDisclosureUsd(metrics.estimatedTotalPayment),
        net_to_merchant: formatDisclosureUsd(metrics.recipientFunds),
        NetFundProvided: formatDisclosureUsd(metrics.recipientFunds),
        finance_charge: formatDisclosureUsd(metrics.financeCharge),
        remittance: formatDisclosureUsd(metrics.estimatedPayment),
        monthly_income: formatDisclosureUsd(metrics.estimatedMerchantAverageMonthlyRevenue),
        appendix_underwriting_fees: formatDisclosureUsd(
            applyDisclosurePlatformFee(brokerFeePaidToBroker),
        ),
        payment_terms_percent: formatDisclosurePercent(metrics.percentOfDailyIncomePurchased),
        disclosure_payment_terms: formatDisclosurePercent(metrics.percentOfDailyIncomePurchased),
        payment_exceed_percent: formatDisclosurePercent(metrics.percentOfDailyIncomePurchased),
        // Never write percent into bare `frequency` — that label is cadence (DAY / WEEK).
    };
}

export function isUtahDisclosureState(state?: string | null): boolean {
    const key = String(state ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
    return key === "utah" || key === "ut";
}

/** All Utah disclosure slots for the editor (labels only; values may be empty). */
export function dailyUtahDisclosureFieldDefinitions(): ContractPrefillField[] {
    return buildDailyUtahContractPrefillFields({
        purchasePrice: ".",
        purchaseAmount: ".",
        netToMerchant: ".",
        financeCharge: ".",
        remittance: ".",
        appendixUnderwritingFees: ".",
        paymentTermsPercent: ".",
        monthlyIncome: ".",
    });
}
