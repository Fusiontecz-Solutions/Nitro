import {
  CONTRACT_WIRE_FEE_USD,
  type ContractOfferPrefillSource,
} from '../../contractOfferValueSync';

/**
 * The state disclosure's own money row, derived from the live offer.
 *
 * Every value on the disclosure used to reach SignNow from ONE place: the CRM
 * screen's prefill payload, computed by the front-end disclosure calculator and
 * posted with the send. Nothing on the server recomputed it, and nothing on the
 * server could fill it in — `loadContractPrefillDefaults` reads contract columns
 * only, and `buildOfferPrefillOverrides` published just the cadence and the
 * estimated term. So whenever that payload arrived without the disclosure keys —
 * the screen posting a package it had not opened the disclosure editor for, a
 * deal in a state the front-end's per-state registry does not cover, a funder
 * whose own disclosure template id had not been registered yet — the whole page
 * opened blank in Review, on every funder, because all three funders' copies
 * (Nitro Advance, Obsidian Capital Group, Tiberian Funding) carry the same
 * widget names and therefore share one source of values.
 *
 * These are published as DEFAULTS, never overrides: a value the CRM screen did
 * post always wins, because the screen can see things the offer cannot (bank
 * analyses, a refinance payoff typed by hand, a state-specific itemization).
 * The offer is only the floor, so the page can no longer go out empty.
 *
 * The arithmetic mirrors the front-end calculator
 * (`contractdata/disclosureAprCalculator.ts`, `refinanceDealCalculations.ts`,
 * `california_disclosure.ts`) so the two sources cannot disagree about a deal.
 */

/** Payments per month the disclosure prints its "estimated monthly cost" against. */
const MONTHLY_PAYMENT_MULTIPLIER: Record<string, number> = {
  daily: 20,
  weekly: 4,
  'bi-weekly': 2,
  biweekly: 2,
  monthly: 1,
};

/** Business days per month used to turn a payment count into APR term months. */
const APR_BUSINESS_DAYS_PER_MONTH = 20;

/** Weeks per month the front-end's percent-of-income math uses. */
const WEEKS_PER_MONTH = 4.3;

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.round(value * 100) / 100);
}

function percent(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function parseMoney(value: string | undefined | null): number | null {
  if (!value) return null;
  const n = Number(String(value).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizedFrequency(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * APR term in months. The disclosure's APR is a simple annualised cost rate, so
 * the term has to be expressed in months however the deal is paid: a business-day
 * count for daily and weekly deals (20 business days to the month), the period
 * count itself for monthly, half of it for bi-weekly.
 */
export function disclosureAprTermMonths(
  payments: number | null,
  frequency: unknown,
): number | null {
  if (payments == null || !(payments > 0)) return null;
  const freq = normalizedFrequency(frequency);
  if (freq === 'monthly') return Math.max(1, Math.ceil(payments));
  if (freq === 'bi-weekly' || freq === 'biweekly') return Math.max(1, Math.ceil(payments / 2));
  const businessDays = freq === 'weekly' ? payments * 5 : payments;
  return Math.max(1, Math.ceil(businessDays / APR_BUSINESS_DAYS_PER_MONTH));
}

/** `(finance charge / amount financed) / term months x 12`, as a percentage. */
export function disclosureApr(args: {
  financeCharge: number | null;
  amountFinanced: number | null;
  termMonths: number | null;
}): number | null {
  const { financeCharge, amountFinanced, termMonths } = args;
  if (financeCharge == null || amountFinanced == null || termMonths == null) return null;
  if (!(financeCharge > 0) || !(amountFinanced > 0) || !(termMonths > 0)) return null;
  return (financeCharge / amountFinanced / termMonths) * 12 * 100;
}

/**
 * The payment as a percentage of the business's income over one payment period.
 * Only derivable when the deal's average monthly revenue is already on the
 * payload — it comes from the bank analyses, which the offer does not carry.
 */
function paymentTermsPercent(
  payment: number | null,
  avgMonthlyRevenue: number | null,
  frequency: unknown,
): number | null {
  if (payment == null || avgMonthlyRevenue == null) return null;
  if (!(payment > 0) || !(avgMonthlyRevenue > 0)) return null;
  const freq = normalizedFrequency(frequency);
  if (freq === 'monthly') return (payment / avgMonthlyRevenue) * 100;
  if (freq === 'bi-weekly' || freq === 'biweekly') {
    return (payment / (avgMonthlyRevenue / (WEEKS_PER_MONTH / 2))) * 100;
  }
  if (freq === 'weekly') return (payment / (avgMonthlyRevenue / WEEKS_PER_MONTH)) * 100;
  // Daily: five business days a week, so 5 x 4.3 payment days in a month.
  return (payment / (avgMonthlyRevenue / (5 * WEEKS_PER_MONTH))) * 100;
}

/**
 * Disclosure values the live offer can supply, keyed by the CRM prefill ids the
 * SignNow field map resolves the disclosure's widgets through.
 *
 * `current` is read for the two things the offer does not know — the deal's
 * average monthly revenue and whatever the screen already posted — and is never
 * written to.
 */
export function buildDisclosurePrefillDefaults(
  source: ContractOfferPrefillSource | null | undefined,
  current: Record<string, string> = {},
): Record<string, string> {
  const derived = source?.values;
  if (!derived) return {};

  const out: Record<string, string> = {};
  const put = (key: string, value: string | null) => {
    if (!value) return;
    // Defaults only: whatever the CRM screen posted describes this deal better.
    if (String(current[key] ?? '').trim()) return;
    out[key] = value;
  };

  const funded = derived.approvedAmount;
  const payback = derived.totalAmount;
  if (funded == null || !(funded > 0)) return out;

  const wireFee = source?.includeWireFee === false ? 0 : CONTRACT_WIRE_FEE_USD;
  const originationRaw = parseMoney(derived.appendixUnderwritingFees ?? undefined);
  // The origination fee carries the wire fee on every document that prints it,
  // exactly as `buildOfferPrefillOverrides` publishes TOTAL FEES.
  const origination =
    originationRaw != null && originationRaw > 0 ? originationRaw + wireFee : 0;
  const refiBalance =
    derived.refinanceAmount != null && derived.refinanceAmount > 0
      ? derived.refinanceAmount
      : 0;

  /**
   * A fee at or above the advance is a stale value scaled against a superseded
   * offer, not a fee — publishing it would break the page's own arithmetic.
   */
  const feesUsable = origination > 0 && origination + refiBalance < funded;
  const recipientFunds = feesUsable ? funded - origination - refiBalance : null;

  const financeCharge = payback != null && payback > funded ? payback - funded : null;

  put('disclosure_amount_financed', money(funded));
  if (recipientFunds != null) put('disclosure_recipient_funds', money(recipientFunds));
  if (financeCharge != null) put('disclosure_finance_charge', money(financeCharge));
  if (payback != null && payback > 0) put('disclosure_total_payment', money(payback));

  const estimatedPayment = parseMoney(derived.remittance ?? undefined);
  if (estimatedPayment != null && estimatedPayment > 0) {
    put('disclosure_estimated_payment', money(estimatedPayment));
    const multiplier =
      MONTHLY_PAYMENT_MULTIPLIER[normalizedFrequency(derived.frequency)] ?? 20;
    put('disclosure_monthly_cost', money(estimatedPayment * multiplier));
  }

  const apr = disclosureApr({
    financeCharge,
    amountFinanced: funded,
    termMonths: disclosureAprTermMonths(derived.termDays, derived.frequency),
  });
  if (apr != null && apr > 0) put('disclosure_apr', percent(apr));

  const avgMonthlyRevenue = parseMoney(
    current.disclosure_avg_monthly_revenue ||
      current.avarage_monthly_income ||
      current.monthly_income,
  );
  const terms = paymentTermsPercent(estimatedPayment, avgMonthlyRevenue, derived.frequency);
  if (terms != null && terms > 0) put('disclosure_payment_terms', percent(terms));

  /**
   * Page 3, "itemization of amount financed". The four lines always add back up
   * to the advance, whether or not the deal refinances a previous balance:
   *
   *   funds to the recipient   = advance - origination - refinance payoff
   *   line 1 (to the provider) = origination fee
   *   line 2 (refi payoff)     = previous balance, 0.00 on a new deal
   *   subtotal                 = advance
   *   net                      = subtotal - broker fee (the same origination fee)
   */
  if (recipientFunds != null) {
    put('disclosure_page3_line_1', money(origination));
    put('disclosure_page3_line_2', money(refiBalance));
    put('disclosure_page3_third_parties', '0.00');
    put('disclosure_page3_subtotal', money(funded));
    put('disclosure_broker_fee', money(origination));
    put('disclosure_page3_net', money(Math.max(0, funded - origination)));
  }

  return out;
}
