import { resolveOfferDecisionFundedAmount } from "@/lib/offerDecisionFees";

type ApplicationAmountSource = {
  loanAmount?: number | string | null;
  OfferDecision?: Record<string, unknown> | null;
  offerDecision?: Record<string, unknown> | null;
};

function parseLoanAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const n = Number(String(value).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Amount shown in application lists: prefer OfferDecision offer after underwriting,
 * otherwise the requested amount on the application (`loanAmount`).
 */
export function resolveApplicationDisplayLoanAmount(
  app: ApplicationAmountSource | null | undefined,
): number | null {
  if (!app) return null;

  const offerDecision =
    (app.OfferDecision as Record<string, unknown> | null | undefined) ??
    (app.offerDecision as Record<string, unknown> | null | undefined) ??
    null;
  const fromOffer = resolveOfferDecisionFundedAmount(offerDecision);
  if (fromOffer != null && fromOffer > 0) return fromOffer;

  return parseLoanAmount(app.loanAmount);
}
