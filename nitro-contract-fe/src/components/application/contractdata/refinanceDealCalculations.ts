import { roundMoney } from "@/lib/offerRepaymentCalculations";
import {
    computeDisclosureApr,
    computeDisclosureTermMonths,
    computeAprTermMonthsFromBusinessDays,
    formatDisclosurePercent,
    formatDisclosureUsd,
    formatDisclosureUsDate,
    applyDisclosurePlatformFee,
    resolveDailyEstimatedTermDays,
    type DisclosureCalculatorFrequency,
} from "./disclosureAprCalculator";
import { PLATFORM_DISCLOSURE_FUNDER_NAME } from "./platformDocumentConfig";

export { computeAprTermMonthsFromBusinessDays };

/** Deal is REFI when a positive previous-deal payoff / refinance balance is present. */
export function isRefinanceDeal(refinanceAmount: unknown): boolean {
    const n = coerceMoney(refinanceAmount);
    return n != null && n > 0;
}

export type RefinanceDealType = "REFI" | "NO_REFI";

export interface RefinanceDealCalculationInput {
    state?: string | null;
    label?: string | null;
    paymentFrequency: DisclosureCalculatorFrequency | string;
    contractAmount: number;
    /** Origination / underwriting fee in dollars (not percent). */
    originationFee: number;
    /** The deal's "$25 wire fee" box. false = no $25; omitted = the fee-on default. */
    includeWireFee?: boolean;
    /** Optional percent (e.g. 10 for 10%). Used only for display when fee dollars are derived. */
    originationFeePercent?: number | null;
    factorRate: number;
    paymentAmount?: number | null;
    previousRefiBalance: number;
    previousDealDate?: string | null;
    merchantName?: string | null;
    businessName?: string | null;
    businessAddress?: string | null;
    averageMonthlyRevenue?: number | null;
    /** Payment-period count (weeks for daily, weeks for weekly, etc.). */
    numberOfPayments?: number | null;
    /** Business/calendar payment days used for APR / term. */
    numberOfPaymentDays?: number | null;
    /** Specified % of income (payment terms). */
    specifiedPercent?: number | null;
}

export interface RefinanceDealCalculationResult {
    dealType: RefinanceDealType;
    contractAmount: number;
    originationFee: number;
    originationFeePercent: number;
    netContractedFunding: number;
    previousRefiBalance: number;
    actualDisbursement: number;
    factorRate: number;
    totalPayback: number;
    financeCharge: number;
    apr: number;
    paymentAmount: number;
    paymentFrequency: DisclosureCalculatorFrequency;
    estimatedMonthlyCost: number;
    /** California / NY style: always calendar days (weekly = weeks × 7). */
    estimatedTermDays: number;
    /** Connecticut style: business days for weekly (weeks × 5). */
    estimatedTermBusinessDays: number;
    /** APR calculator months — business days / 20, rounded up (PDF: 50ds → 2.5 → 3). */
    estimatedTermMonths: number;
    averageMonthlyRevenue: number;
    specifiedPercent: number;
    previousDealDate: string;
    merchantName: string;
    businessName: string;
    businessAddress: string;
    label: string;
    /** Legal funder name for addendum “agreement to” slots (always Nitro Advance). */
    refiLabelName: string;
    state: string;
}

export interface RefinanceValidationIssue {
    field: string;
    message: string;
}

function coerceMoney(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value == null) return null;
    const cleaned = String(value).trim().replace(/[$,\s]/g, "").replace(/%$/, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function normalizeFrequency(
    value: string | null | undefined,
): DisclosureCalculatorFrequency {
    const f = String(value ?? "")
        .trim()
        .toLowerCase();
    if (f.startsWith("week")) return "Weekly";
    if (f.startsWith("bi")) return "Bi-Weekly";
    if (f.startsWith("month")) return "Monthly";
    return "Daily";
}

/**
 * Legal name used on Addendum P / Payoff “agreement to” slots.
 * Always Nitro Advance — Clear / Harbor labels are not used on these docs.
 */
export function resolveRefiLabelName(_labelOrFunder?: string | null): string {
    return PLATFORM_DISCLOSURE_FUNDER_NAME;
}

/**
 * PDF estimated monthly cost:
 * Daily → daily payment × 20
 * Weekly → weekly payment × 4
 */
export function computePdfEstimatedMonthlyCost(
    paymentAmount: number,
    frequency: DisclosureCalculatorFrequency,
): number {
    const pay = Math.max(0, paymentAmount);
    if (!(pay > 0)) return 0;
    if (frequency === "Weekly") return roundMoney(pay * 4);
    if (frequency === "Bi-Weekly") return roundMoney(pay * 2);
    if (frequency === "Monthly") return roundMoney(pay);
    return roundMoney(pay * 20);
}

/**
 * Central REFI money layer — keep Contract Amount, Net Contracted Funding,
 * Previous Refi Balance, and Actual Disbursement as separate values.
 */
export function calculateRefinanceDealMetrics(
    input: RefinanceDealCalculationInput,
): RefinanceDealCalculationResult {
    const contractAmount = Math.max(0, input.contractAmount);
    // The $25 wire fee rides on the origination fee unless the deal's box is unticked.
    // Callers never passed the box before, so an unticked REFI deal still got the $25.
    const originationFee = applyDisclosurePlatformFee(
        Math.max(0, input.originationFee),
        input.includeWireFee !== false,
    );
    const previousRefiBalance = Math.max(0, input.previousRefiBalance);
    const factorRate = input.factorRate > 0 ? input.factorRate : 1;
    const frequency = normalizeFrequency(String(input.paymentFrequency));
    const dealType: RefinanceDealType =
        previousRefiBalance > 0 ? "REFI" : "NO_REFI";

    const netContractedFunding = roundMoney(
        Math.max(0, contractAmount - originationFee),
    );
    const actualDisbursement = roundMoney(
        Math.max(0, netContractedFunding - previousRefiBalance),
    );
    const totalPayback = roundMoney(contractAmount * factorRate);
    /** PDF: Total Payback − Contract Amount (not net funding). */
    const financeCharge = roundMoney(Math.max(0, totalPayback - contractAmount));

    const numberOfPayments = Math.max(1, Math.trunc(input.numberOfPayments ?? 0) || 1);
    let numberOfPaymentDays = Math.max(0, Math.trunc(input.numberOfPaymentDays ?? 0));
    if (!(numberOfPaymentDays > 0)) {
        numberOfPaymentDays =
            frequency === "Weekly"
                ? numberOfPayments * 7
                : frequency === "Daily"
                  ? numberOfPayments * 5
                  : numberOfPayments;
    }

    const numberOfWeeks =
        frequency === "Daily"
            ? Math.max(
                  1,
                  numberOfPayments > 0 && numberOfPayments < 40
                      ? numberOfPayments
                      : Math.round(numberOfPaymentDays / 5) || 1,
              )
            : numberOfPayments;

    const estimatedTermBusinessDays =
        frequency === "Weekly"
            ? Math.max(1, numberOfPayments * 5)
            : frequency === "Daily"
              ? Math.max(1, numberOfPaymentDays || numberOfWeeks * 5)
              : Math.max(1, numberOfPaymentDays);
    /**
     * Estimated term in calendar days:
     * Daily = remittance days (never weeks). Weekly = weeks × 7.
     * CT uses estimatedTermBusinessDays (weekly = weeks × 5) separately.
     */
    const estimatedTermDays =
        frequency === "Weekly"
            ? Math.max(1, numberOfPayments * 7)
            : frequency === "Daily"
              ? Math.max(
                    1,
                    resolveDailyEstimatedTermDays({
                        numberOfPayments,
                        numberOfPaymentDays,
                        totalPayback,
                        paymentAmount:
                            input.paymentAmount != null && input.paymentAmount > 0
                                ? input.paymentAmount
                                : undefined,
                    }),
                )
              : Math.max(1, numberOfPaymentDays);

    const estimatedTermMonths = computeDisclosureTermMonths({
        frequency,
        numberOfPayments,
        numberOfPaymentDays:
            frequency === "Weekly" ? numberOfPayments * 5 : numberOfPaymentDays,
        numberOfWeeks,
    });

    const paymentAmount =
        input.paymentAmount != null && input.paymentAmount > 0
            ? roundMoney(input.paymentAmount)
            : roundMoney(totalPayback / Math.max(1, numberOfPaymentDays || numberOfPayments));

    const estimatedMonthlyCost = computePdfEstimatedMonthlyCost(paymentAmount, frequency);

    const apr = computeDisclosureApr({
        financeCharge,
        purchasePrice: contractAmount,
        termMonths: estimatedTermMonths,
    });

    const originationFeePercent =
        input.originationFeePercent != null && input.originationFeePercent > 0
            ? input.originationFeePercent
            : contractAmount > 0
              ? roundMoney((originationFee / contractAmount) * 100)
              : 0;

    const label = String(input.label ?? "").trim();
    return {
        dealType,
        contractAmount: roundMoney(contractAmount),
        originationFee: roundMoney(originationFee),
        originationFeePercent,
        netContractedFunding,
        previousRefiBalance: roundMoney(previousRefiBalance),
        actualDisbursement,
        factorRate,
        totalPayback,
        financeCharge,
        apr,
        paymentAmount,
        paymentFrequency: frequency,
        estimatedMonthlyCost,
        estimatedTermDays,
        estimatedTermBusinessDays,
        estimatedTermMonths,
        averageMonthlyRevenue: Math.max(0, input.averageMonthlyRevenue ?? 0),
        specifiedPercent: Math.max(0, input.specifiedPercent ?? 0),
        previousDealDate: formatDisclosureUsDate(input.previousDealDate ?? ""),
        merchantName: String(input.merchantName ?? "").trim(),
        businessName: String(input.businessName ?? "").trim(),
        businessAddress: String(input.businessAddress ?? "").trim(),
        label,
        refiLabelName: resolveRefiLabelName(label || PLATFORM_DISCLOSURE_FUNDER_NAME),
        state: String(input.state ?? "").trim(),
    };
}

/** Required fields before generating REFI disclosure / addendum documents. */
export function validateRefinanceDealForDocuments(
    metrics: RefinanceDealCalculationResult,
    options?: { requireAverageMonthlyRevenue?: boolean },
): RefinanceValidationIssue[] {
    const issues: RefinanceValidationIssue[] = [];
    const require = (field: string, ok: boolean, message: string) => {
        if (!ok) issues.push({ field, message });
    };

    require("state", Boolean(metrics.state), "State is required for REFI disclosures.");
    require("label", Boolean(metrics.label || metrics.refiLabelName), "Label / funder is required.");
    require(
        "paymentFrequency",
        Boolean(metrics.paymentFrequency),
        "Payment frequency (Daily/Weekly) is required.",
    );
    require("dealType", metrics.dealType === "REFI", "Deal type must be REFI.");
    require("contractAmount", metrics.contractAmount > 0, "Contract amount is required.");
    require("originationFee", metrics.originationFee >= 0, "Origination fee is required.");
    require("factorRate", metrics.factorRate > 0, "Factor rate is required.");
    require("paymentAmount", metrics.paymentAmount > 0, "Payment amount is required.");
    require(
        "previousRefiBalance",
        metrics.previousRefiBalance > 0,
        "Previous deal / REFI balance is required.",
    );
    require(
        "previousDealDate",
        Boolean(metrics.previousDealDate),
        "Previous deal date is required.",
    );
    require(
        "businessName",
        Boolean(metrics.businessName),
        "Merchant / business name is required.",
    );
    require(
        "businessAddress",
        Boolean(metrics.businessAddress),
        "Business address is required.",
    );
    require("merchantName", Boolean(metrics.merchantName), "Merchant name is required.");
    require("apr", metrics.apr > 0, "APR inputs are incomplete (could not compute APR).");

    if (options?.requireAverageMonthlyRevenue) {
        require(
            "averageMonthlyRevenue",
            metrics.averageMonthlyRevenue > 0,
            "Average Monthly Revenue is required for this state’s disclosure.",
        );
    }

    return issues;
}

export function formatRefinanceValidationError(
    issues: RefinanceValidationIssue[],
): string {
    if (!issues.length) return "";
    return `Cannot generate REFI documents — missing or invalid: ${issues
        .map((i) => i.field)
        .join(", ")}.`;
}

/** Formatted money/percent helpers for disclosure templates. */
export function formatRefinanceUsd(value: number): string {
    return formatDisclosureUsd(value);
}

export function formatRefinancePercent(value: number): string {
    return formatDisclosurePercent(value);
}
