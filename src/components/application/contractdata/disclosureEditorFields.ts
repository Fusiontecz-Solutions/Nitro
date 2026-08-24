import type { ContractPrefillField } from "./Contract";
import type {
    DisclosureCalculatorInputs,
    DisclosureCalculatorResult,
} from "./disclosureAprCalculator";
import {
    applyDisclosurePlatformFee,
    formatDisclosurePaymentFrequencyLabel,
    formatDisclosurePercent,
    formatDisclosureUsd,
    formatDisclosureUsDate,
} from "./disclosureAprCalculator";
import {
    isUtahDisclosureState,
    mapUtahDisclosureCalculatorToPdfFields,
} from "./daily_utah";
import { buildNewYorkDisclosurePage3Amounts } from "./new_york_disclosure";
import {
    buildCaliforniaDisclosurePage3Amounts,
    buildCaliforniaRefinancePage3Amounts,
} from "./california_disclosure";
import {
    DISCLOSURE_PLATFORM_FEE_USD,
    PLATFORM_DISCLOSURE_FUNDER_NAME,
} from "./platformDocumentConfig";
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
    { id: "disclosure_page3_line_1", label: "Page 3 line 1 amount" },
    { id: "disclosure_page3_line_2", label: "Page 3 line 2 amount" },
    { id: "disclosure_page3_subtotal", label: "Page 3 subtotal" },
    { id: "disclosure_page3_net", label: "Page 3 net amount" },
    { id: "disclosure_page3_third_parties", label: "Page 3 item 3 total (third parties)" },
    { id: "disclosure_page3_3a", label: "Page 3 item 3a" },
    { id: "disclosure_page3_3b", label: "Page 3 item 3b" },
    { id: "disclosure_page3_3c", label: "Page 3 item 3c" },
    { id: "previous_lender_name", label: "Advance # / previous lender" },
    { id: "funding_provided", label: "Funding provided" },
    { id: "funding_provided_direct", label: "Funds provided directly" },
    { id: "disclosure_payment_frequency", label: "Payment frequency" },
    { id: "client_name", label: "Business / merchant name" },
    { id: "funder_name", label: "Funder / provider name" },
    { id: "funder_address", label: "Funder address" },
    { id: "funder_phone", label: "Funder phone" },
    { id: "funder_email", label: "Funder email" },
    { id: "deal_id_prefix", label: "Deal ID prefix" },
    { id: "disclosure_date", label: "Disclosure date" },
];

/** PDF / legacy prefill field ids written for each canonical editor field. */
const EDITOR_TO_PDF_FIELD_IDS: Record<string, readonly string[]> = {
    disclosure_avg_monthly_revenue: [
        "disclosure_avg_monthly_revenue",
        "monthly_income",
        "avarage_monthly_income",
        "etimated_average_income",
        "Text Field 4",
    ],
    disclosure_amount_financed: [
        "disclosure_amount_financed",
        "total_amount_business_fund",
        "funding_provided",
        "amountFinanced",
        "total_amount_of_fund_provided",
        "total_amount_sales_based_financing",
    ],
    funding_provided: ["funding_provided", "Text Field 1"],
    funding_provided_direct: ["funding_provided_direct", "Text Field 2"],
    disclosure_recipient_funds: [
        "disclosure_recipient_funds",
        "total_amount_of_fund_disbursed",
        "total_amount_fund_disbursed",
        "disbursement_amount",
        "funding_provided_direct",
    ],
    /** Connecticut / Virginia page-1 fees deducted from amount financed. */
    disclosure_fees_deducted: [
        "disclosure_fees_deducted",
        "deducted_at_disbursement",
        "fees_deducted",
        "disclosure_origination_fee",
    ],
    disclosure_apr: ["disclosure_apr", "estimated_annual_percentage_rate", "Text Field 3"],
    disclosure_finance_charge: [
        "disclosure_finance_charge",
        "total_dollar_cost",
        "finance_charge",
        "financeCharge",
        "total_dollar_cost_of_frinancing",
        "Text Field 5",
    ],
    disclosure_total_payment: [
        "disclosure_total_payment",
        "total_amount_tobe_paid_to_provider",
        "total_amount_to_be_paid",
        "amount_required_to_trigger_prepayment_discount",
        "total_repayment_amount",
        // Connecticut total_commerical_financing = amount financed (forced in expand), not payback.
        "total_of_payments",
        // Do NOT alias onto main RPA `purchase_price` / payback — disclosure calculator
        // was overwriting Final Calculation values on Review & open DocuSign.
        "estimatedTotalPaymentAmount",
        "payment_total",
        "Text Field 6",
    ],
    disclosure_estimated_payment: [
        "disclosure_estimated_payment",
        "estimated_payment_amount",
        "estimated_payment",
        "daily_payment",
        // Do NOT alias onto main RPA `remittance`.
        "estimatedPayment",
        "Text Field 8",
    ],
    disclosure_monthly_cost: [
        "disclosure_monthly_cost",
        "estimated_monthly_cost",
        "Text Field 7",
    ],
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
        // Utah disclosure % tabs — never use bare `frequency` / `paymentTerms`
        // (those IDs are Daily/Weekly cadence on the main contract).
        "payment_terms_percent",
        "payment_exceed_percent",
    ],
    disclosure_term_days: ["disclosure_term_days", "estimated_term", "estimated_number_of_payement", "estimated_time_periodic_paymement"],
    disclosure_broker_fee: ["disclosure_broker_fee", "appendix_underwriting_fees"],
    disclosure_page3_line_1: ["disclosure_page3_line_1"],
    disclosure_page3_line_2: ["disclosure_page3_line_2"],
    disclosure_page3_subtotal: ["disclosure_page3_subtotal"],
    disclosure_page3_net: ["disclosure_page3_net"],
    disclosure_page3_third_parties: ["disclosure_page3_third_parties"],
    disclosure_page3_3a: ["disclosure_page3_3a"],
    disclosure_page3_3b: ["disclosure_page3_3b"],
    disclosure_page3_3c: ["disclosure_page3_3c"],
    previous_lender_name: ["previous_lender_name"],
    disclosure_payment_frequency: [
        "disclosure_payment_frequency",
        "payment_frequency",
        "Text Field 9",
    ],
    client_name: [
        "client_name",
        "recipient_name",
        "recipient_name2",
        "disclosure_name",
        "disclosure_merchant_name",
    ],
    funder_name: ["funder_name"],
    funder_address: ["funder_address"],
    funder_phone: ["funder_phone"],
    funder_email: ["funder_email"],
    deal_id_prefix: ["deal_id_prefix"],
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


/** Connecticut page-1: purchase price / fee / amount financed. */
function applyConnecticutPage1AmountFields(
    editorValues: Record<string, string>,
    out: Record<string, string>,
): void {
    const hasSeparatePurchase = Boolean(
        String(editorValues.funding_provided ?? "").trim() ||
            String(editorValues.disclosure_purchase_price ?? "").trim(),
    );
    const purchase = String(
        editorValues.funding_provided ??
            editorValues.disclosure_purchase_price ??
            out.funding_provided ??
            out.purchase_amount ??
            "",
    ).trim();
    const amountFinancedRaw = String(editorValues.disclosure_amount_financed ?? "").trim();
    const recipientRaw = String(
        editorValues.disclosure_recipient_funds ?? out.disclosure_recipient_funds ?? "",
    ).trim();
    let fees = String(
        editorValues.disclosure_fees_deducted ??
            out.deducted_at_disbursement ??
            out.fees_deducted ??
            "",
    ).trim();

    const purchaseFinal = purchase || (!hasSeparatePurchase ? amountFinancedRaw : "");
    const purchaseN = parseDisclosurePrefillMoney(purchaseFinal);
    const amountN = parseDisclosurePrefillMoney(amountFinancedRaw);
    const recipientN = parseDisclosurePrefillMoney(recipientRaw);
    let feesN = parseDisclosurePrefillMoney(fees);

    if (
        !fees &&
        purchaseN !== undefined &&
        amountN !== undefined &&
        amountN < purchaseN - 0.009
    ) {
        fees = formatDisclosureUsd(Math.max(0, purchaseN - amountN));
        feesN = parseDisclosurePrefillMoney(fees);
    }

    let amountFinanced = "";
    if (purchaseN !== undefined && amountN !== undefined && amountN < purchaseN - 0.009) {
        amountFinanced = formatDisclosureUsd(amountN);
    } else if (
        purchaseN !== undefined &&
        recipientN !== undefined &&
        recipientN < purchaseN - 0.009
    ) {
        amountFinanced = formatDisclosureUsd(recipientN);
    } else if (purchaseN !== undefined && feesN !== undefined) {
        amountFinanced = formatDisclosureUsd(Math.max(0, purchaseN - feesN));
    } else if (hasSeparatePurchase && amountN !== undefined) {
        amountFinanced = formatDisclosureUsd(amountN);
    } else if (recipientN !== undefined) {
        amountFinanced = formatDisclosureUsd(recipientN);
    } else if (amountN !== undefined && feesN !== undefined) {
        amountFinanced = formatDisclosureUsd(Math.max(0, amountN - feesN));
    }

    if (purchaseFinal) out.total_amount_commercial_financing = purchaseFinal;
    if (fees) {
        out.deducted_at_disbursement = fees;
        if (!String(out.fees_deducted ?? "").trim()) out.fees_deducted = fees;
    }
    if (amountFinanced) out.total_commerical_financing = amountFinanced;
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
            if (pdfId !== editorId && String(editorValues[pdfId] ?? "").trim()) continue;
            out[pdfId] = value;
        }
    }

    out.funder_name = String(
        editorValues.funder_name || PLATFORM_DISCLOSURE_FUNDER_NAME,
    )
        .trim()
        .toUpperCase();
    const merchant = String(editorValues.client_name ?? out.client_name ?? "").trim();
    if (merchant) {
        for (const pdfId of EDITOR_TO_PDF_FIELD_IDS.client_name ?? ["client_name"]) {
            out[pdfId] = merchant;
        }
    }

    // Connecticut / Virginia page-1 "fees deducted" = amount financed − recipient funds
    // when not already set explicitly (editor may omit this derived slot).
    const explicitFees = String(editorValues.disclosure_fees_deducted ?? "").trim();
    const financed = parseDisclosurePrefillMoney(
        editorValues.disclosure_amount_financed ?? out.disclosure_amount_financed,
    );
    const recipient = parseDisclosurePrefillMoney(
        editorValues.disclosure_recipient_funds ?? out.disclosure_recipient_funds,
    );
    const derivedFees =
        explicitFees ||
        (financed !== undefined && recipient !== undefined
            ? formatDisclosureUsd(Math.max(0, financed - recipient))
            : "");
    if (derivedFees) {
        for (const pdfId of EDITOR_TO_PDF_FIELD_IDS.disclosure_fees_deducted ?? []) {
            if (!String(out[pdfId] ?? "").trim()) out[pdfId] = derivedFees;
        }
    }

    applyConnecticutPage1AmountFields(editorValues, out);

    if (!String(out.disclosure_page3_third_parties ?? "").trim()) {
        out.disclosure_page3_third_parties = "0.00";
    }
    if (!String(out.disclosure_page3_3a ?? "").trim()) out.disclosure_page3_3a = "N/A";
    if (!String(out.disclosure_page3_3b ?? "").trim()) out.disclosure_page3_3b = "N/A";
    if (!String(out.disclosure_page3_3c ?? "").trim()) out.disclosure_page3_3c = "N/A";
    if (!String(out.previous_lender_name ?? "").trim()) {
        const refiLine = parseDisclosurePrefillMoney(
            editorValues.disclosure_page3_line_2 ?? out.disclosure_page3_line_2,
        );
        out.previous_lender_name =
            refiLine && refiLine > 0
                ? String(editorValues.funder_name || PLATFORM_DISCLOSURE_FUNDER_NAME).trim() ||
                  "N/A"
                : "N/A";
    }

    const INLINE_PERCENT_TAB_IDS = new Set([
        "payement_exceeded_percent",
        "payment_exceeded_percent",
        "payment_exceed_percent",
        "percent_of_business_income",
        "disclosure_payment_terms",
        "payment_terms_percent",
        "payment_fallen_below_percent",
        "consistent_with_percent",
        "exceeded_percent",
        "payments_fallen_below_percent",
        "exceeded_payment",
        "payment_fallen",
        "estimated_percent",
        "out_estimated_percent",
        "payment_exceeded",
    ]);
    for (const id of INLINE_PERCENT_TAB_IDS) {
        const raw = String(out[id] ?? "").trim();
        if (raw.endsWith("%")) out[id] = raw.replace(/%+\s*$/, "").trim();
    }

    // Disclosure PDF text: ALL CAPS; payment cadence as DAY / WEEK (not DAILY / WEEKLY).
    for (const [id, raw] of Object.entries(out)) {
        let value = String(raw ?? "").trim();
        if (!value) continue;
        const idNorm = id.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
            idNorm === "paymentfrequency" ||
            idNorm === "disclosurepaymentfrequency" ||
            idNorm === "frequency" ||
            idNorm === "paymentterms"
        ) {
            const freq = formatDisclosurePaymentFrequencyLabel(value);
            value = freq || value;
        }
        out[id] = value.toUpperCase();
    }

    return out;
}

export function buildDisclosureEditorFieldsFromContext(
    ctx: StateDisclosureContext,
): ContractPrefillField[] {
    const disclosureDate = formatDisclosureUsDate(ctx.signatureDate) || "";
    const netFunding =
        ctx.netContractedFunding || ctx.fundingDisbursed || ctx.fundingProvided || "";
    const page3TopLine = ctx.isRefinance
        ? ctx.actualDisbursement || netFunding
        : netFunding;
    const originationFee =
        ctx.feesDeducted?.trim() ||
        (coercePositiveMoney(ctx.brokerFeePaidToBroker)
            ? String(ctx.brokerFeePaidToBroker).trim()
            : "");
    const page3 = buildCaliforniaDisclosurePage3Amounts({
        recipientFunds: page3TopLine,
        page3Line1: originationFee || ctx.page3Line1,
        page3Line2: ctx.isRefinance ? ctx.previousRefiBalance || ctx.page3Line2 : ctx.page3Line2,
        brokerFee: originationFee || ctx.brokerFeePaidToBroker,
    });
    const nyLines = buildNewYorkDisclosurePage3Amounts({
        recipientFunds: page3TopLine,
        page3Line1: originationFee || ctx.page3Line1,
        page3Line2: ctx.page3Line2,
        brokerFee: originationFee || ctx.brokerFeePaidToBroker,
    });

    const values: Record<string, string> = {
        disclosure_avg_monthly_revenue: ctx.averageMonthlyIncome ?? "",
        /** Purchase Price = Funding Amount. */
        disclosure_purchase_price: ctx.fundingProvided || ctx.amountBusinessFund || "",
        total_amount_business_fund: ctx.fundingProvided || ctx.amountBusinessFund || "",
        purchase_amount: ctx.fundingProvided || ctx.amountBusinessFund || "",
        disclosure_amount_financed: netFunding || ctx.amountBusinessFund || "",
        /** Guide: page-3 amount given directly = net funding (NO REFI) / actual disbursement (REFI). */
        disclosure_recipient_funds: page3TopLine,
        NetFundProvided: page3TopLine,
        funding_provided:
            ctx.isRefinance
                ? ctx.netContractedFunding || netFunding
                : netFunding || ctx.fundingProvided || "",
        funding_provided_direct: ctx.isRefinance
            ? ctx.actualDisbursement || netFunding
            : netFunding || ctx.fundingProvidedDirect || ctx.fundingProvided || "",
        disclosure_fees_deducted: originationFee || ctx.feesDeducted || "",
        disclosure_apr: ctx.estimatedAnnualPercentageRate ?? "",
        disclosure_finance_charge: ctx.financeCharge || ctx.totalDollarCost || "",
        /** Receivables = repayment amount. */
        disclosure_total_payment: ctx.totalRepayment ?? "",
        receivables: ctx.totalRepayment ?? "",
        revenue_purchased: ctx.totalRepayment ?? "",
        payment_total: ctx.totalRepayment ?? "",
        disclosure_estimated_payment: ctx.estimatedPayment ?? "",
        disclosure_monthly_cost: ctx.estimatedMonthlyCost ?? "",
        disclosure_payment_terms: ctx.percentOfBusinessIncome || ctx.paymentExceededPercent || "",
        disclosure_term_days: ctx.estimatedTermDays ?? ctx.estimatedTerm ?? "",
        disclosure_broker_fee: originationFee || ctx.brokerFeePaidToBroker || "",
        disclosure_page3_line_1: nyLines.page3Line1 || page3.page3Line1 || originationFee,
        disclosure_page3_line_2: nyLines.page3Line2 || page3.page3Line2 || "",
        disclosure_page3_subtotal: page3.page3Subtotal,
        disclosure_page3_net: page3.page3Net,
        disclosure_page3_third_parties: "0.00",
        disclosure_page3_3a: "N/A",
        disclosure_page3_3b: "N/A",
        disclosure_page3_3c: "N/A",
        previous_lender_name: coercePositiveMoney(
            nyLines.page3Line2 || page3.page3Line2,
        )
            ? String(ctx.funderName ?? PLATFORM_DISCLOSURE_FUNDER_NAME).trim() || "N/A"
            : "N/A",
        client_name: String(ctx.recipientName ?? "").trim().toUpperCase(),
        funder_name: String(ctx.funderName ?? PLATFORM_DISCLOSURE_FUNDER_NAME)
            .trim()
            .toUpperCase(),
        funder_address: String(ctx.funderAddress ?? "").trim(),
        funder_phone: String(ctx.funderPhone ?? "").trim(),
        funder_email: String(ctx.funderEmail ?? "").trim(),
        deal_id_prefix: String(ctx.dealIdPrefix ?? "").trim(),
        disclosure_date: disclosureDate,
        payment_frequency:
            formatDisclosurePaymentFrequencyLabel(ctx.frequency || ctx.paymentFrequency) || "",
        disclosure_payment_frequency:
            formatDisclosurePaymentFrequencyLabel(ctx.frequency || ctx.paymentFrequency) || "",
    };

    return DISCLOSURE_EDITOR_FIELD_CATALOG.map((field) => ({
        id: field.id,
        label: field.label,
        value: values[field.id] ?? "",
    }));
}

function coercePositiveMoney(value: unknown): boolean {
    const n = Number.parseFloat(String(value ?? "").replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) && n > 0;
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
            | "originationFee"
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
    const stateKey = String(options?.state ?? options?.inputs?.state ?? "")
        .trim()
        .toLowerCase();
    const isUtah = isUtahDisclosureState(stateKey);
    const isCaOrNy =
        stateKey === "california" ||
        stateKey === "ca" ||
        stateKey === "new york" ||
        stateKey === "ny" ||
        stateKey === "new_york";

    const purchasePrice =
        options?.inputs?.purchasePrice != null && options.inputs.purchasePrice > 0
            ? options.inputs.purchasePrice
            : metrics.purchasePrice;
    const netFunding = Math.max(
        0,
        metrics.netContractedFunding ?? metrics.amountFinanced ?? metrics.recipientFunds,
    );
    const actualDisbursement = Math.max(
        0,
        metrics.actualDisbursement ?? metrics.recipientFunds,
    );
    const isRefinance = Boolean(metrics.isRefinance);
    /**
     * Origination on PDF = applicable fee + $50.
     * Prefer calculator inputs (applicable); else back-solve from funding − net (already includes $50).
     */
    const originationFee =
        options?.inputs?.originationFee != null && options.inputs.originationFee >= 0
            ? applyDisclosurePlatformFee(options.inputs.originationFee)
            : purchasePrice > 0
              ? Math.max(
                    DISCLOSURE_PLATFORM_FEE_USD,
                    Math.round((purchasePrice - netFunding) * 100) / 100,
                )
              : DISCLOSURE_PLATFORM_FEE_USD;
    const brokerFeeTotal =
        (options?.inputs?.brokerFeePaidByFunder ?? 0) +
        (options?.inputs?.brokerFeePaidByMerchant ?? 0);

    /**
     * Purchase Price / Funding Amount = contract funding.
     * CA/NY “funding provided” boxes stay net (Guide); FL-group provided = funding.
     * Net Funds / recipient = funding − (fee + $50).
     */
    const fundingProvidedPrimary = isCaOrNy ? netFunding : purchasePrice;
    const fundingProvidedDirect = isRefinance ? actualDisbursement : fundingProvidedPrimary;
    const page3AmountGiven = isRefinance ? actualDisbursement : netFunding;
    const frequencyLabel = formatDisclosurePaymentFrequencyLabel(
        options?.inputs?.frequency ?? "",
    );

    const page3 = isRefinance
        ? buildCaliforniaRefinancePage3Amounts({
              actualDisbursement: page3AmountGiven,
              originationFee,
              previousRefiBalance: metrics.previousRefiBalance ?? 0,
          })
        : {
              ...buildCaliforniaDisclosurePage3Amounts({
                  recipientFunds: formatDisclosureUsd(page3AmountGiven),
                  page3Line1: formatDisclosureUsd(originationFee),
                  page3Line2: "0.00",
                  brokerFee: formatDisclosureUsd(originationFee),
              }),
              page3Line1: formatDisclosureUsd(originationFee),
              page3Line2: "0.00",
          };

    const avgMonthly = metrics.estimatedMerchantAverageMonthlyRevenue;
    const avgMonthlyStr =
        avgMonthly > 0 ? formatDisclosureUsd(avgMonthly) : "";

    /**
     * CA page-3 `disclosure_broker_fee` tab = prepaid origination fee (Guide).
     * Utah uses the same editor id for broker fee paid to broker.
     */
    const disclosureBrokerFeeForPdf = isUtah
        ? formatDisclosureUsd(brokerFeeTotal)
        : formatDisclosureUsd(originationFee);

    const editorFields: Record<string, string> = {
        ...(avgMonthlyStr
            ? { disclosure_avg_monthly_revenue: avgMonthlyStr }
            : {}),
        /** Purchase Price = Funding Amount. */
        disclosure_purchase_price: formatDisclosureUsd(purchasePrice),
        total_amount_business_fund: formatDisclosureUsd(purchasePrice),
        purchase_amount: formatDisclosureUsd(purchasePrice),
        disclosure_amount_financed: formatDisclosureUsd(netFunding),
        /** Net Funds Provided / recipient funds. */
        disclosure_recipient_funds: formatDisclosureUsd(page3AmountGiven),
        NetFundProvided: formatDisclosureUsd(page3AmountGiven),
        net_to_merchant: formatDisclosureUsd(page3AmountGiven),
        funding_provided: formatDisclosureUsd(fundingProvidedPrimary),
        funding_provided_direct: formatDisclosureUsd(fundingProvidedDirect),
        disclosure_fees_deducted: formatDisclosureUsd(originationFee),
        disclosure_origination_fee: formatDisclosureUsd(originationFee),
        disclosure_apr: formatDisclosurePercent(metrics.estimatedAnnualPercentageRate),
        disclosure_finance_charge: formatDisclosureUsd(metrics.financeCharge),
        /** Receivables = repayment amount. */
        disclosure_total_payment: formatDisclosureUsd(metrics.estimatedTotalPayment),
        receivables: formatDisclosureUsd(metrics.estimatedTotalPayment),
        revenue_purchased: formatDisclosureUsd(metrics.estimatedTotalPayment),
        payment_total: formatDisclosureUsd(metrics.estimatedTotalPayment),
        disclosure_estimated_payment: formatDisclosureUsd(metrics.estimatedPayment),
        disclosure_monthly_cost: formatDisclosureUsd(metrics.estimatedMonthlyCost),
        disclosure_payment_terms: formatDisclosurePercent(
            metrics.percentOfDailyIncomePurchased,
            "",
        ),
        disclosure_term_days: String(metrics.estimatedTermDays),
        disclosure_broker_fee: disclosureBrokerFeeForPdf,
        disclosure_page3_line_1: page3.page3Line1,
        disclosure_page3_line_2: page3.page3Line2,
        disclosure_page3_subtotal: page3.page3Subtotal,
        disclosure_page3_net: page3.page3Net,
        disclosure_page3_third_parties: "0.00",
        disclosure_page3_3a: "N/A",
        disclosure_page3_3b: "N/A",
        disclosure_page3_3c: "N/A",
        previous_lender_name:
            isRefinance && (metrics.previousRefiBalance ?? 0) > 0
                ? PLATFORM_DISCLOSURE_FUNDER_NAME
                : "N/A",
        ...(merchant ? { client_name: merchant } : {}),
        funder_name: PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        ...(disclosureDate ? { disclosure_date: disclosureDate } : {}),
        ...(frequencyLabel
            ? {
                  payment_frequency: frequencyLabel,
                  disclosure_payment_frequency: frequencyLabel,
              }
            : {}),
    };

    if (isUtah && options?.inputs) {
        return {
            ...editorFields,
            ...mapUtahDisclosureCalculatorToPdfFields(metrics, options.inputs),
        };
    }

    return editorFields;
}
