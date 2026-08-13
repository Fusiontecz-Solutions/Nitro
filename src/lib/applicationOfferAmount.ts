import type { Application } from "@/types/applicationTypes";
import { resolveOfferDecisionFundedAmount } from "@/lib/offerDecisionFees";

function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const n = Number(String(value).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Underwritten offer amount for lists/overview.
 * Prefer live OfferDecision (source of truth), then TermsOffer mirror.
 * Matches `resolveApplicationOfferAmount` / BE dashboard precedence.
 */
export function getApplicationApprovedAmount(app: Application): number | null {
  const od = app.OfferDecision;
  const decisionNorm = od?.decision ? String(od.decision).toLowerCase() : "";
  const fromOfferDecision =
    od && decisionNorm !== "declined"
      ? resolveOfferDecisionFundedAmount(od as Record<string, unknown>)
      : null;
  if (fromOfferDecision != null && fromOfferDecision > 0) return fromOfferDecision;

  const termsOffers = app.termsOffers;
  const fromTerms =
    termsOffers && termsOffers.length > 0
      ? parseMoney(termsOffers[0].approvedAmount)
      : null;

  return fromTerms;
}
