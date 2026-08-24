import {
    calculateRefinanceDealMetrics,
    formatRefinanceValidationError,
    isRefinanceDeal,
    type RefinanceDealCalculationInput,
    type RefinanceDealCalculationResult,
    type RefinanceValidationIssue,
    validateRefinanceDealForDocuments,
} from "./refinanceDealCalculations";

/** Addendum kinds selected from the Disclosures / Addendum guide. */
export type DisclosureAddendumKind =
    | "addendum_p"
    | "addendum_ca"
    | "addendum_ny"
    | "addendum_va";

/**
 * Composable addendum rules (Guide):
 * - REFI → Addendum P
 * - CA → Addendum CA
 * - NY → Addendum NY
 * - VA → Addendum VA
 * Combinations are additive (e.g. CA + REFI → P + CA).
 */
export function resolveWantedAddendumKinds(
    state: string | null | undefined,
    isRefinance: boolean,
): DisclosureAddendumKind[] {
    const kinds: DisclosureAddendumKind[] = [];
    if (isRefinance) kinds.push("addendum_p");

    const key = String(state ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if (key === "california" || key === "ca") kinds.push("addendum_ca");
    if (key === "new_york" || key === "ny" || key === "newyork") kinds.push("addendum_ny");
    if (key === "virginia" || key === "va") kinds.push("addendum_va");
    return kinds;
}

export function stateRequiresAverageMonthlyRevenueForDisclosure(
    state: string | null | undefined,
): boolean {
    const key = String(state ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    return (
        key === "california" ||
        key === "ca" ||
        key === "new_york" ||
        key === "ny" ||
        key === "newyork"
    );
}

/** Shared required fields for disclosure generation (REFI and NO-REFI). */
export function validateDisclosureDealForDocuments(
    metrics: RefinanceDealCalculationResult,
    options?: { requireAverageMonthlyRevenue?: boolean; requireApr?: boolean },
): RefinanceValidationIssue[] {
    if (metrics.dealType === "REFI") {
        return validateRefinanceDealForDocuments(metrics, {
            requireAverageMonthlyRevenue: options?.requireAverageMonthlyRevenue,
        });
    }

    const issues: RefinanceValidationIssue[] = [];
    const require = (field: string, ok: boolean, message: string) => {
        if (!ok) issues.push({ field, message });
    };

    require("state", Boolean(metrics.state), "State is required for disclosures.");
    require(
        "label",
        Boolean(metrics.label || metrics.refiLabelName),
        "Label / funder is required.",
    );
    require(
        "paymentFrequency",
        Boolean(metrics.paymentFrequency),
        "Payment frequency (Daily/Weekly) is required.",
    );
    require("contractAmount", metrics.contractAmount > 0, "Contract amount is required.");
    require("originationFee", metrics.originationFee >= 0, "Origination fee is required.");
    require("factorRate", metrics.factorRate > 0, "Factor rate is required.");
    require("paymentAmount", metrics.paymentAmount > 0, "Payment amount is required.");
    require("businessName", Boolean(metrics.businessName), "Business name is required.");
    require(
        "businessAddress",
        Boolean(metrics.businessAddress),
        "Business address is required.",
    );
    require("merchantName", Boolean(metrics.merchantName), "Merchant name is required.");

    if (options?.requireAverageMonthlyRevenue) {
        require(
            "averageMonthlyRevenue",
            metrics.averageMonthlyRevenue > 0,
            "Average Monthly Revenue is required for this state’s disclosure.",
        );
    }

    if (options?.requireApr) {
        require(
            "apr",
            metrics.apr > 0,
            "APR cannot be calculated — Amount Borrowed, Payback, and Estimated Term (months) are required (MCA APR Calculator inputs).",
        );
    }

    return issues;
}

export function formatDisclosureValidationError(
    issues: RefinanceValidationIssue[],
    dealType: "REFI" | "NO_REFI" = "NO_REFI",
): string {
    if (!issues.length) return "";
    if (dealType === "REFI") return formatRefinanceValidationError(issues);
    return `Cannot generate disclosure — missing or invalid: ${issues
        .map((i) => i.field)
        .join(", ")}. ${issues.map((i) => i.message).join(" ")}`;
}

/** Build metrics + validate for document generation. */
export function buildAndValidateDisclosureMetrics(
    input: RefinanceDealCalculationInput,
    options?: { requireAverageMonthlyRevenue?: boolean },
): {
    metrics: RefinanceDealCalculationResult;
    issues: RefinanceValidationIssue[];
    errorMessage: string;
} {
    const metrics = calculateRefinanceDealMetrics(input);
    const requireAvg =
        options?.requireAverageMonthlyRevenue ??
        stateRequiresAverageMonthlyRevenueForDisclosure(input.state);
    const issues = validateDisclosureDealForDocuments(metrics, {
        requireAverageMonthlyRevenue: requireAvg,
        requireApr: requireAvg,
    });
    return {
        metrics,
        issues,
        errorMessage: formatDisclosureValidationError(issues, metrics.dealType),
    };
}

export { isRefinanceDeal };
