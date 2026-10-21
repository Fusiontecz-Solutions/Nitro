import type { ContractPrefillField } from "./Contract";
import type {
    DisclosureCalculatorInputs,
    DisclosureCalculatorResult,
} from "./disclosureAprCalculator";
import {
    applyDisclosurePlatformFee,
    formatDisclosureDocumentFrequencyLabel,
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

/**
 * PDF / legacy prefill field ids written for each canonical editor field.
 *
 * The `_p2` / `_p3` / `_p2_s1` entries are the live SignNow unique names on the
 * funder disclosure templates — verified against Nitro Advance
 * (ce1229f1…), Obsidian Capital Group (445770b8…) and Tiberian Funding
 * (46bffdc5…), which ship byte-identical widget names. SignNow scopes a widget
 * to its page with that suffix; writing both the suffixed and unsuffixed id
 * means the value lands whether or not the reader strips the suffix.
 */
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
        "disclosure_recipient_funds_p3",
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
        "finance_charge_p2",
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
        "payement_exceeded_percent_p2_s1",
    ],
    disclosure_term_days: [
        "disclosure_term_days",
        "estimated_term",
        "estimated_term_p2",
        "estimated_number_of_payement",
        "estimated_time_periodic_paymement",
    ],
    disclosure_broker_fee: [
        "disclosure_broker_fee",
        "disclosure_broker_fee_p3",
        "appendix_underwriting_fees",
    ],
    disclosure_page3_line_1: [
        "disclosure_page3_line_1",
        "disclosure_page3_line_1_p3",
        "disclosure_fees_deducted",
        "disclosure_origination_fee",
    ],
    disclosure_page3_line_2: [
        "disclosure_page3_line_2",
        "disclosure_page3_line_2_p3",
        "refinance_amount",
    ],
    disclosure_page3_subtotal: ["disclosure_page3_subtotal", "disclosure_page3_subtotal_p3"],
    disclosure_page3_net: ["disclosure_page3_net", "disclosure_page3_net_p3"],
    disclosure_page3_third_parties: [
        "disclosure_page3_third_parties",
        "disclosure_page3_third_parties_p3",
    ],
    disclosure_page3_3a: ["disclosure_page3_3a", "disclosure_page3_3a_p3"],
    disclosure_page3_3b: ["disclosure_page3_3b", "disclosure_page3_3b_p3"],
    disclosure_page3_3c: ["disclosure_page3_3c", "disclosure_page3_3c_p3"],
    previous_lender_name: ["previous_lender_name", "previous_lender_name_p3"],
    disclosure_payment_frequency: [
        "disclosure_payment_frequency",
        "payment_frequency",
        // SignNow's own spelling on the disclosure page-1 payment row.
        "disclouser_pg2_frequency",
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
        "signature_date_p2",
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

const DISCLOSURE_PAGE3_SIGNNOW_P3_IDS = [
    "disclosure_page3_line_2",
    "disclosure_page3_third_parties",
    "disclosure_page3_3a",
    "disclosure_page3_3b",
    "disclosure_page3_3c",
] as const;

function stripSignNowPageSuffix(key: string): string {
    return String(key || "")
        .trim()
        .replace(/_p\d+$/i, "");
}

function disclosureEditorIdFromSavedKey(key: string): string {
    const k = String(key || "").trim();
    if (!k) return k;
    const mapped = PDF_TO_EDITOR_FIELD_ID.get(k);
    if (mapped) return mapped;
    const stripped = stripSignNowPageSuffix(k);
    if (stripped !== k) {
        const mappedStripped = PDF_TO_EDITOR_FIELD_ID.get(stripped);
        if (mappedStripped) return mappedStripped;
        if (DISCLOSURE_EDITOR_FIELD_CATALOG.some((field) => field.id === stripped)) {
            return stripped;
        }
    }
    return k;
}

/** Calculator defaults that must not overwrite a value typed in Verify Prefill. */
export function isWeakDisclosurePage3PrefillValue(fieldId: string, value: string): boolean {
    const v = String(value ?? "").trim();
    if (!v) return true;
    const canon = stripSignNowPageSuffix(fieldId).toLowerCase();
    if (/^n\/a$/i.test(v)) {
        return (
            /^disclosure_page3_3[abc]$/.test(canon) ||
            canon === "disclosure_page3_third_parties" ||
            canon === "disclosure_page3_line_2"
        );
    }
    if (canon === "disclosure_page3_third_parties" || canon === "disclosure_page3_line_2") {
        return parseDisclosurePrefillMoney(v) === 0;
    }
    return false;
}

function pickStrongerDisclosurePrefillValue(
    fieldId: string,
    current: string,
    incoming: string,
): string {
    const cur = String(current ?? "").trim();
    const next = String(incoming ?? "").trim();
    if (!cur) return next;
    if (!next) return cur;
    if (isWeakDisclosurePage3PrefillValue(fieldId, cur) && !isWeakDisclosurePage3PrefillValue(fieldId, next)) {
        return next;
    }
    const existingNum = parseDisclosurePrefillMoney(cur);
    const incomingNum = parseDisclosurePrefillMoney(next);
    if (existingNum === 0 && incomingNum !== undefined && incomingNum > 0) {
        return next;
    }
    return cur;
}

/** Collapse legacy PDF-key blobs into canonical editor keys for the form UI. */
export function collapsePdfFieldsToDisclosureEditorValues(
    saved: Record<string, string> | null | undefined,
): Record<string, string> {
    const raw = saved ?? {};
    const out: Record<string, string> = {};

    // Canonical calculator / editor keys always win over legacy PDF tab ids.
    for (const field of DISCLOSURE_EDITOR_FIELD_CATALOG) {
        const catalogV = String(raw[field.id] ?? "").trim();
        const p3V = String(raw[`${field.id}_p3`] ?? "").trim();
        const v = pickStrongerDisclosurePrefillValue(field.id, catalogV, p3V);
        if (v) out[field.id] = v;
    }

    for (const [key, value] of Object.entries(raw)) {
        const v = String(value ?? "").trim();
        if (!v) continue;
        const editorId = disclosureEditorIdFromSavedKey(key);
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
        out[editorId] = pickStrongerDisclosurePrefillValue(editorId, existing, v);
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
    if (!String(out.disclosure_page3_3a ?? "").trim()) out.disclosure_page3_3a = "";
    if (!String(out.disclosure_page3_3b ?? "").trim()) out.disclosure_page3_3b = "";
    if (!String(out.disclosure_page3_3c ?? "").trim()) out.disclosure_page3_3c = "";
    // SignNow unique names are `*_p3` on the Florida disclosure PDF.
    for (const editorId of DISCLOSURE_PAGE3_SIGNNOW_P3_IDS) {
        const v = String(out[editorId] ?? "").trim();
        if (v) out[`${editorId}_p3`] = v;
    }
    if (!String(out.previous_lender_name ?? "").trim()) {
        const refiLine = parseDisclosurePrefillMoney(
            editorValues.disclosure_page3_line_2 ?? out.disclosure_page3_line_2,
        );
        out.previous_lender_name =
            refiLine && refiLine > 0
                ? String(editorValues.funder_name || PLATFORM_DISCLOSURE_FUNDER_NAME).trim()
                : "";
    }
    // Resolved after the expansion loop above, so its SignNow page-3 name is
    // mirrored here rather than through EDITOR_TO_PDF_FIELD_IDS.
    out.previous_lender_name_p3 = out.previous_lender_name;

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

    // Disclosure PDF: cadence is day / week (renders as “per day”). CRM editor keeps Daily / Weekly.
    for (const [id, raw] of Object.entries(out)) {
        let value = String(raw ?? "").trim();
        if (!value) continue;
        const idNorm = id.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
            idNorm === "paymentfrequency" ||
            idNorm === "disclosurepaymentfrequency" ||
            // SignNow's own (misspelled) name for the page-1 cadence widget on
            // the funder disclosure templates.
            idNorm === "disclouserpg2frequency" ||
            idNorm === "frequency" ||
            idNorm === "paymentterms"
        ) {
            const freq = formatDisclosureDocumentFrequencyLabel(value);
            out[id] = (freq || value).toUpperCase();
            continue;
        }
        out[id] = value.toUpperCase();
    }

    // Unit beside the Estimated Term on disclosure page 2. The term is always stated
    // in days (weekly = weeks × 7), so the label is DAYS for daily and weekly deals.
    const termUnit = String(out.disclosure_term_days ?? "").trim() ? "DAYS" : "";
    for (const id of DISCLOSURE_PAGE2_TERM_UNIT_IDS) out[id] = termUnit;

    return out;
}

/** SignNow names for the unit label next to the page-2 Estimated Term. */
const DISCLOSURE_PAGE2_TERM_UNIT_IDS = ["page2_frequency", "Text Field 9"] as const;

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
        /**
         * Row 1 of the Offer Summary: "This is how much funding Nitro Advance
         * will provide" — the gross funding amount, the same figure as
         * `purchase_amount` / `total_amount_business_fund` just above.
         *
         * This used to resolve to `netFunding`, so both this row and the
         * "funds that will be provided to you directly" blank underneath it
         * printed the same net number and the disclosure never showed what was
         * deducted. Net belongs only in `funding_provided_direct` below, which
         * is what the state-builder path has always done (see the REFI case in
         * disclosureGuide.acceptance.test.ts: 100,000 gross vs 65,000 direct).
         *
         * Gross is gross on a refinance too — only the direct figure changes,
         * to the actual disbursement after the previous balance is paid off.
         */
        funding_provided: ctx.fundingProvided || ctx.amountBusinessFund || netFunding || "",
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
        disclosure_page3_3a: "",
        disclosure_page3_3b: "",
        disclosure_page3_3c: "",
        previous_lender_name: coercePositiveMoney(
            nyLines.page3Line2 || page3.page3Line2,
        )
            ? String(ctx.funderName ?? PLATFORM_DISCLOSURE_FUNDER_NAME).trim()
            : "",
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
            | "includeWireFee"
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
    const includeWireFee = options?.inputs?.includeWireFee !== false;
    /**
     * Origination on PDF = applicable fee + optional $25 wire fee.
     * Prefer calculator inputs (applicable); else back-solve from funding − net.
     */
    const originationFee =
        options?.inputs?.originationFee != null && options.inputs.originationFee >= 0
            ? applyDisclosurePlatformFee(options.inputs.originationFee, includeWireFee)
            : purchasePrice > 0
              ? Math.max(
                    includeWireFee ? DISCLOSURE_PLATFORM_FEE_USD : 0,
                    Math.round((purchasePrice - netFunding) * 100) / 100,
                )
              : includeWireFee
                ? DISCLOSURE_PLATFORM_FEE_USD
                : 0;
    const brokerFeeTotal =
        (options?.inputs?.brokerFeePaidByFunder ?? 0) +
        (options?.inputs?.brokerFeePaidByMerchant ?? 0);

    /**
     * Funding Provided (main box) = contract / purchase price.
     * "Provided to you directly" = net after fees (REFI: actual disbursement).
     */
    const fundingProvidedPrimary = purchasePrice;
    const fundingProvidedDirect = isRefinance ? actualDisbursement : netFunding;
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
        disclosure_apr: formatDisclosurePercent(metrics.estimatedAnnualPercentageRate, ""),
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
        disclosure_page3_3a: "",
        disclosure_page3_3b: "",
        disclosure_page3_3c: "",
        previous_lender_name:
            isRefinance && (metrics.previousRefiBalance ?? 0) > 0
                ? PLATFORM_DISCLOSURE_FUNDER_NAME
                : "",
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
