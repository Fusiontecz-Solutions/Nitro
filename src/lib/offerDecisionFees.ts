/**
 * Origination / commission fee % and dollars for contract final calculation.
 * Priority: terms commission % → application commission % → inferred from OfferDecision.fees → 10%.
 */

const DEFAULT_FEE_PERCENT = 10;
const MAX_PLAUSIBLE_FEE_PERCENT = 25;

function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const s = String(value).replace(/[^0-9.-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPlausibleFeePercent(pct: number): boolean {
  return Number.isFinite(pct) && pct > 0 && pct <= MAX_PLAUSIBLE_FEE_PERCENT;
}

/**
 * Infer fee % from `OfferDecision.fees` (often stored as dollars).
 * Legacy rows may store ~1% of payback instead of funded amount.
 */
export function inferFeePercentFromFeesRaw(
  feesRaw: unknown,
  fundedAmount: number,
  paybackAmount?: number | null,
): number | null {
  const fees = parseMoney(feesRaw);
  if (fees == null || fees <= 0) return null;

  // Small values (e.g. 10) are treated as percent when plausible.
  if (fees <= MAX_PLAUSIBLE_FEE_PERCENT && fundedAmount > 0 && fees < fundedAmount) {
    return round2(fees);
  }

  if (fundedAmount > 0) {
    const pctOfFunded = (fees / fundedAmount) * 100;
    if (isPlausibleFeePercent(pctOfFunded)) return round2(pctOfFunded);
  }

  const payback = paybackAmount ?? 0;
  if (payback > 0) {
    const pctOfPayback = (fees / payback) * 100;
    if (Math.abs(pctOfPayback - 1) < 0.2) return 1;
  }

  return null;
}

export type ResolveOfferFeePercentInput = {
  termsCommissionPercent?: unknown;
  applicationCommissionPercentage?: unknown;
  feesRaw?: unknown;
  fundedAmount?: unknown;
  factorRate?: unknown;
  paybackAmount?: unknown;
};

/** Resolve origination fee % for contract funding math. */
export function resolveOfferFeePercentForDeal(
  input: ResolveOfferFeePercentInput,
): number {
  const funded = parseMoney(input.fundedAmount) ?? 0;
  const payback = parseMoney(input.paybackAmount);

  const termsPct = parseMoney(input.termsCommissionPercent);
  if (termsPct != null && isPlausibleFeePercent(termsPct)) return round2(termsPct);

  const appPct = parseMoney(input.applicationCommissionPercentage);
  if (appPct != null && isPlausibleFeePercent(appPct)) return round2(appPct);

  const inferred = inferFeePercentFromFeesRaw(
    input.feesRaw,
    funded,
    payback,
  );
  if (inferred != null) return inferred;

  return DEFAULT_FEE_PERCENT;
}

/** Resolve origination fee dollars for a deal (fee % × funded amount). */
export function resolveOfferFeeAmountForDeal(
  input: ResolveOfferFeePercentInput,
): number {
  const funded = parseMoney(input.fundedAmount) ?? 0;
  const pct = resolveOfferFeePercentForDeal(input);
  return computeOfferFeeAmountDollars(funded, pct);
}

/** Fee dollars = funded amount × (fee % ÷ 100). */
export function computeOfferFeeAmountDollars(
  fundedAmount: unknown,
  feePercent: unknown,
): number {
  const fundedN = parseMoney(fundedAmount) ?? 0;
  const pctN = parseMoney(feePercent) ?? 0;
  if (fundedN <= 0 || pctN <= 0) return 0;
  return round2((fundedN * pctN) / 100);
}

/** Alias used when persisting/displaying fee % as dollars on funded amount. */
export function feesPercentToDollarsFromFunded(
  fundedAmount: unknown,
  feePercent: unknown,
): number {
  return computeOfferFeeAmountDollars(fundedAmount, feePercent);
}

/** Matches BE `offerDecisionEffectiveRecord` — nested `offer` JSON holds saved field values. */
export function offerDecisionEffectiveRecord(
  odRoot: unknown,
): Record<string, unknown> | null {
  if (!odRoot || typeof odRoot !== "object") return null;
  const root = odRoot as Record<string, unknown>;
  const inner = root.offer;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return root;
}

/** Funded/approved amount from an OfferDecision record (`offer` field holds the dollar amount). */
export function resolveOfferDecisionFundedAmount(
  odRoot: unknown,
): number | null {
  const rec = offerDecisionEffectiveRecord(odRoot);
  if (!rec) return null;
  const funded = parseMoney(
    rec.offer ?? rec.fundedAmount ?? rec.approvedAmount ?? rec.amount,
  );
  return funded != null && funded > 0 ? round2(funded) : null;
}

function resolveOfferAmountFromOfferDecisionRoot(
  odRoot: unknown,
): number | null {
  if (!odRoot || typeof odRoot !== "object") return null;
  const decisionNorm = String(
    (odRoot as Record<string, unknown>).decision ?? "",
  ).toLowerCase();
  if (decisionNorm === "declined") return null;
  return resolveOfferDecisionFundedAmount(odRoot);
}

/**
 * Approved offer amount for summary/header display.
 * Priority: terms offer → application OfferDecision → fetched offer-decision row.
 * Does not fall back to requested loan amount (that has its own column).
 */
export function resolveApplicationOfferAmount(sources: {
  application?: unknown;
  offerDecision?: unknown;
}): number | null {
  const application = sources.application;
  if (application && typeof application === "object") {
    const app = application as Record<string, unknown>;
    const termsOffers = app.termsOffers;
    if (Array.isArray(termsOffers) && termsOffers.length > 0) {
      const latestTerms = termsOffers[0];
      if (latestTerms && typeof latestTerms === "object") {
        const fromTerms = parseMoney(
          (latestTerms as Record<string, unknown>).approvedAmount,
        );
        if (fromTerms != null && fromTerms > 0) return round2(fromTerms);
      }
    }

    const fromAppOfferDecision = resolveOfferAmountFromOfferDecisionRoot(
      app.OfferDecision ?? app.offerDecision ?? null,
    );
    if (fromAppOfferDecision != null) return fromAppOfferDecision;
  }

  const fromFetched = resolveOfferAmountFromOfferDecisionRoot(
    sources.offerDecision ?? null,
  );
  if (fromFetched != null) return fromFetched;

  return null;
}

/** Raw `fees` value from an OfferDecision record (may be dollars or a legacy percent). */
export function resolveOfferDecisionFeesRaw(odRoot: unknown): unknown {
  const rec = offerDecisionEffectiveRecord(odRoot);
  if (!rec) return null;
  return rec.fees ?? null;
}

export type ResolveOfferDecisionFeesDisplayOptions = {
  applicationCommissionPercentage?: unknown;
  termsCommissionPercent?: unknown;
};

/** Fee dollars for offer-decision summary display. */
export function resolveOfferDecisionFeesDisplayDollars(
  odRoot: unknown,
  options: ResolveOfferDecisionFeesDisplayOptions = {},
): number {
  const rec = offerDecisionEffectiveRecord(odRoot);
  const root =
    odRoot && typeof odRoot === "object"
      ? (odRoot as Record<string, unknown>)
      : null;

  return resolveOfferFeeAmountForDeal({
    fundedAmount: resolveOfferDecisionFundedAmount(odRoot),
    factorRate: rec?.rate ?? root?.rate,
    feesRaw: resolveOfferDecisionFeesRaw(odRoot),
    termsCommissionPercent: options.termsCommissionPercent,
    applicationCommissionPercentage: options.applicationCommissionPercentage,
  });
}

/**
 * Fee percent for the contract form.
 * Mirrors `inferFeePercentFromFeesRaw`, using factor-rate payback as a fallback signal.
 */
export function resolveOfferFeesPercentForForm(
  fundedAmount: unknown,
  factorRate: unknown,
  feesRaw: unknown,
): number | null {
  const funded = parseMoney(fundedAmount) ?? 0;
  const rate = parseMoney(factorRate);
  const payback = funded > 0 && rate != null && rate > 0 ? funded * rate : null;
  return inferFeePercentFromFeesRaw(feesRaw, funded, payback);
}

/**
 * Fee dollar amount for the contract form.
 * Small `fees` values are treated as a percent of the funded amount; larger values
 * are treated as a dollar amount already, matching `inferFeePercentFromFeesRaw`.
 */
export function resolveOfferFeesAmountForForm(
  fundedAmount: unknown,
  factorRate: unknown,
  feesRaw: unknown,
): number | null {
  const funded = parseMoney(fundedAmount) ?? 0;
  const fees = parseMoney(feesRaw);
  if (fees == null || fees <= 0) return null;
  if (funded > 0 && fees <= MAX_PLAUSIBLE_FEE_PERCENT && fees < funded) {
    return round2((funded * fees) / 100);
  }
  return round2(fees);
}
