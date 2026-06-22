import type { ContractPrefillField } from "./Contract";
import type {
    DisclosureCalculatorInputs,
    DisclosureCalculatorResult,
} from "./disclosureAprCalculator";
import {
    formatDisclosurePercent,
    formatDisclosureUsd,
    formatDisclosureUsDate,
} from "./disclosureAprCalculator";
import {
    isUtahDisclosureState,
    mapUtahDisclosureCalculatorToPdfFields,
} from "./daily_utah";
import { PLATFORM_DISCLOSURE_FUNDER_NAME } from "./platformDocumentConfig";
import type { StateDisclosureContext } from "./stateDisclosurePrefill";

/**
 * Canonical disclosure fields for Edit Prefilled Values — aligned with the
 * disclosure calculator (one input per value). PDF / DocuSign tab labels are
 * expanded at envelope build time via `expandDisclosureEditorValuesToPdfFields`.
 */
export const DISCLOSURE_EDITOR_FIELD_CATALOG: ReadonlyArray<{ id: string; label: string }> = [
    {
        id: "disclosure_avg_monthly_revenue",
        label: "Estimated merchant average monthly revenue",
    },
    { id: "disclosure_amount_financed", label: "Amount financed" },
    { id: "disclosure_recipient_funds", label: "Recipient funds" },
    { id: "disclosure_apr", label: "Estimated annual percentage rate (APR)" },
    { id: "disclosure_finance_charge", label: "Finance charge" },
    { id: "disclosure_total_payment", label: "Estimated total payment amount" },
    { id: "disclosure_estimated_payment", label: "Estimated payment" },
    { id: "disclosure_monthly_cost", label: "Estimated monthly cost" },
    {
        id: "disclosure_payment_terms",
        label: "Payment terms (% of merchant daily income purchased)",
    },
    { id: "disclosure_term_days", label: "Estimated term (days)" },
    { id: "disclosure_broker_fee", label: "Broker fee (paid to broker)" },
    { id: "disclosure_page1_line_1", label: "Page 1 line 1 amount" },
    { id: "disclosure_page3_line_1", label: "Page 3 line 1 amount" },
    { id: "disclosure_page3_line_2", label: "Page 3 line 2 amount" },
    { id: "disclosure_page3_subtotal", label: "Page 3 subtotal amount" },
    { id: "disclosure_page3_net", label: "Page 3 net amount" },
    { id: "client_name", label: "Merchant / recipient name" },
    { id: "funder_name", label: "Funder / provider name" },
    { id: "disclosure_date", label: "Disclosure date" },
];

/** PDF / legacy prefill field ids written for each canonical editor field. */
const EDITOR_TO_PDF_FIELD_IDS: Record<string, readonly string[]> = {
    disclosure_avg_monthly_revenue: [
        "disclosure_avg_monthly_revenue",
        "monthly_income",
        "avarage_monthly_income",
        "etimated_average_income",
    ],
    disclosure_amount_financed: [
        "disclosure_amount_financed",
        "total_amount_business_fund",
        "funding_provided",
        "purchase_amount",
        "total_amount_commercial_financing",
        "amountFinanced",
        "total_amount_of_fund_provided",
        "total_amount_sales_based_financing",
    ],
    disclosure_recipient_funds: [
        "disclosure_recipient_funds",
        "total_amount_of_fund_disbursed",
        "total_amount_fund_disbursed",
        "disbursement_amount",
        "net_to_merchant",
    ],
    disclosure_apr: ["disclosure_apr", "estimated_annual_percentage_rate"],
    disclosure_finance_charge: [
        "disclosure_finance_charge",
        "total_dollar_cost",
        "finance_charge",
        "financeCharge",
        "total_dollar_cost_of_frinancing",
    ],
    disclosure_total_payment: [
        "disclosure_total_payment",
        "total_amount_tobe_paid_to_provider",
        "total_amount_to_be_paid",
        "amount_required_to_trigger_prepayment_discount",
        "total_repayment_amount",
        "total_commerical_financing",
        "total_of_payments",
        "purchase_price",
        "purchasePrice",
        "estimatedTotalPaymentAmount",
        "total_repayment_amount",
        "payment_total",
    ],
    disclosure_estimated_payment: [
        "disclosure_estimated_payment",
        "estimated_payment_amount",
        "estimated_payment",
        "daily_payment",
        "remittance",
        "estimatedPayment",
    ],
    disclosure_monthly_cost: ["disclosure_monthly_cost", "estimated_monthly_cost"],
    disclosure_payment_terms: [
        "disclosure_payment_terms",
        "percent_of_business_income",
        "payment_exceeded_percent",
        "payment_fallen_below_percent",
        "consistent_with_percent",
        "estimated_percent",
        "payement_exceeded_percent",
        "exceeded_percent",
        "consistent_with",
        "payments_fallen_below_percent",
        "exceeded_payment",
        "payment_fallen",
        "consistent_with_business",
        "payment_exceeded",
        "out_estimated_percent",
        "paymentTerms",
    ],
    disclosure_term_days: ["disclosure_term_days", "estimated_term", "estimated_number_of_payement", "estimated_time_periodic_paymement"],
    disclosure_broker_fee: ["disclosure_broker_fee", "appendix_underwriting_fees"],
    disclosure_page1_line_1: ["disclosure_page1_line_1"],
    disclosure_page3_line_1: ["disclosure_page3_line_1"],
    disclosure_page3_line_2: ["disclosure_page3_line_2"],
    disclosure_page3_subtotal: ["disclosure_page3_subtotal"],
    disclosure_page3_net: ["disclosure_page3_net"],
    client_name: ["client_name", "recipient_name", "disclosure_name", "disclosure_merchant_name"],
    funder_name: ["funder_name"],
    disclosure_date: [
        "disclosure_date",
        "agreement_date",
        "disclosure_date2",
        "Signature_date",
        "signature_date",
        "signature1_date",
    ],
};

const PDF_TO_EDITOR_FIELD_ID = (() => {
    const map = new Map<string, string>();
    for (const [editorId, pdfIds] of Object.entries(EDITOR_TO_PDF_FIELD_IDS)) {
        for (const pdfId of pdfIds) {
            if (!map.has(pdfId)) map.set(pdfId, editorId);
        }
    }
    return map;
})();

export function buildDisclosureCalculatorEditorFieldDefinitions(): ContractPrefillField[] {
    return DISCLOSURE_EDITOR_FIELD_CATALOG.map((field) => ({
        id: field.id,
        label: field.label,
        value: "",
    }));
}

function parseDisclosurePrefillMoney(value: unknown): number | undefined {
    const raw = String(value ?? "").trim();
    if (!raw) return undefined;
    const n = Number.parseFloat(raw.replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
}

/** Collapse legacy PDF-key blobs into canonical editor keys for the form UI. */
export function collapsePdfFieldsToDisclosureEditorValues(
    saved: Record<string, string> | null | undefined,
): Record<string, string> {
    const raw = saved ?? {};
    const out: Record<string, string> = {};

    // Canonical calculator / editor keys always win over legacy PDF tab ids.
    for (const field of DISCLOSURE_EDITOR_FIELD_CATALOG) {
        const v = String(raw[field.id] ?? "").trim();
        if (v) out[field.id] = v;
    }

    for (const [key, value] of Object.entries(raw)) {
        const v = String(value ?? "").trim();
        if (!v) continue;
        const editorId = PDF_TO_EDITOR_FIELD_ID.get(key) ?? key;
        // Utah broker fee: never let legacy `appendix_underwriting_fees` (origination) clobber explicit broker fee.
        if (
            editorId === "disclosure_broker_fee" &&
            key === "appendix_underwriting_fees" &&
            Object.prototype.hasOwnProperty.call(raw, "disclosure_broker_fee")
        ) {
            continue;
        }
        const existing = out[editorId];
        if (!existing) {
            out[editorId] = v;
            continue;
        }
        // Prefer a non-zero amount over a stale "0.00" on a duplicate PDF alias key.
        const existingNum = parseDisclosurePrefillMoney(existing);
        const incomingNum = parseDisclosurePrefillMoney(v);
        if (
            existingNum === 0 &&
            incomingNum !== undefined &&
            incomingNum > 0
        ) {
            out[editorId] = v;
        }
    }

    if (!out.funder_name) {
        out.funder_name = PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase();
    }

    return out;
}

/** Expand canonical editor values to every PDF tab label needed for DocuSign. */
export function expandDisclosureEditorValuesToPdfFields(
    editorValues: Record<string, string>,
): Record<string, string> {
    const out: Record<string, string> = {};

    for (const [editorId, rawValue] of Object.entries(editorValues)) {
        const value = String(rawValue ?? "").trim();
        if (!value) continue;
        const pdfIds = EDITOR_TO_PDF_FIELD_IDS[editorId] ?? [editorId];
        for (const pdfId of pdfIds) {
            out[pdfId] = value;
        }
    }

    out.funder_name = PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase();
    const merchant = String(editorValues.client_name ?? out.client_name ?? "").trim();
    if (merchant) {
        for (const pdfId of EDITOR_TO_PDF_FIELD_IDS.client_name ?? ["client_name"]) {
            out[pdfId] = merchant;
        }
    }

    return out;
}

export function buildDisclosureEditorFieldsFromContext(
    ctx: StateDisclosureContext,
): ContractPrefillField[] {
    const disclosureDate = formatDisclosureUsDate(ctx.signatureDate) || "";

    const values: Record<string, string> = {
        disclosure_avg_monthly_revenue: ctx.averageMonthlyIncome ?? "",
        disclosure_amount_financed: ctx.amountBusinessFund || ctx.fundingProvided || "",
        disclosure_recipient_funds: ctx.fundingDisbursed || "",
        disclosure_apr: ctx.estimatedAnnualPercentageRate ?? "",
        disclosure_finance_charge: ctx.financeCharge || ctx.totalDollarCost || "",
        disclosure_total_payment: ctx.totalRepayment ?? "",
        disclosure_estimated_payment: ctx.estimatedPayment ?? "",
        disclosure_monthly_cost: ctx.estimatedMonthlyCost ?? "",
        disclosure_payment_terms: ctx.percentOfBusinessIncome || ctx.paymentExceededPercent || "",
        disclosure_term_days: ctx.estimatedTermDays || ctx.estimatedTerm || "",
        disclosure_broker_fee: ctx.brokerFeePaidToBroker ?? "0.00",
        disclosure_page1_line_1: "0.00",
        disclosure_page3_line_1: "0.00",
        disclosure_page3_line_2: "0.00",
        client_name: String(ctx.recipientName ?? "").trim().toUpperCase(),
        funder_name: PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        disclosure_date: disclosureDate,
    };

    return DISCLOSURE_EDITOR_FIELD_CATALOG.map((field) => ({
        id: field.id,
        label: field.label,
        value: values[field.id] ?? "",
    }));
}

export function mapDisclosureMetricsToEditorFieldOverrides(
    metrics: DisclosureCalculatorResult,
    options?: {
        merchantName?: string;
        signatureDate?: string;
        state?: string | null;
        inputs?: Pick<
            DisclosureCalculatorInputs,
            | "purchasePrice"
            | "frequency"
            | "brokerFeePaidByFunder"
            | "brokerFeePaidByMerchant"
            | "state"
        >;
    },
): Record<string, string> {
    const merchant = String(options?.merchantName ?? "")
        .trim()
        .toUpperCase();
    const disclosureDate = formatDisclosureUsDate(options?.signatureDate ?? "");
    const isUtah = isUtahDisclosureState(options?.state ?? options?.inputs?.state);
    const fundsProvided =
        options?.inputs?.purchasePrice != null && options.inputs.purchasePrice > 0
            ? options.inputs.purchasePrice
            : metrics.amountFinanced;

    const editorFields: Record<string, string> = {
        disclosure_avg_monthly_revenue: formatDisclosureUsd(
            metrics.estimatedMerchantAverageMonthlyRevenue,
        ),
        disclosure_amount_financed: formatDisclosureUsd(
            isUtah ? fundsProvided : metrics.amountFinanced,
        ),
        disclosure_recipient_funds: formatDisclosureUsd(metrics.recipientFunds),
        disclosure_apr: formatDisclosurePercent(metrics.estimatedAnnualPercentageRate),
        disclosure_finance_charge: formatDisclosureUsd(metrics.financeCharge),
        disclosure_total_payment: formatDisclosureUsd(metrics.estimatedTotalPayment),
        disclosure_estimated_payment: formatDisclosureUsd(metrics.estimatedPayment),
        disclosure_monthly_cost: formatDisclosureUsd(metrics.estimatedMonthlyCost),
        disclosure_payment_terms: formatDisclosurePercent(metrics.percentOfDailyIncomePurchased),
        disclosure_term_days: String(metrics.estimatedTermDays),
        disclosure_broker_fee: formatDisclosureUsd(
            (options?.inputs?.brokerFeePaidByFunder ?? 0) +
                (options?.inputs?.brokerFeePaidByMerchant ?? 0),
        ),
        ...(merchant ? { client_name: merchant } : {}),
        funder_name: PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        ...(disclosureDate ? { disclosure_date: disclosureDate } : {}),
    };

    if (isUtah && options?.inputs) {
        return {
            ...editorFields,
            ...mapUtahDisclosureCalculatorToPdfFields(metrics, options.inputs),
        };
    }

    return editorFields;
}
