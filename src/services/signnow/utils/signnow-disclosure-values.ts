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

/**
 * `0.00`, `$0`, `0%` — what the CRM screen's disclosure calculator prints for
 * every line when it ran without inputs. It is a placeholder, not an amount.
 */
export function isZeroDisclosureAmount(value: unknown): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const n = parseMoney(text);
  return n != null && n === 0;
}

function hasDisclosureAmount(value: unknown): boolean {
  return Boolean(String(value ?? '').trim()) && !isZeroDisclosureAmount(value);
}

/**
 * Keys the disclosure's money lines are printed from, whether they are posted
 * under the CRM id or saved in the disclosure's own prefill tab. A zero in one
 * of these must never hide a real amount the deal holds for the same line.
 */
export function isDisclosureAmountKey(key: unknown): boolean {
  const k = String(key ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!k) return false;
  if (/^text field [1-8]$/.test(k)) return true;
  if (/^disclosure_/.test(k)) {
    // Text lines on the page, not amounts.
    return !/^disclosure_(?:date|payment_frequency|page3_3[abc])(?:_p\d+)?$/.test(k);
  }
  return DISCLOSURE_AMOUNT_EXTRA_KEYS.has(k);
}

const DISCLOSURE_AMOUNT_EXTRA_KEYS = new Set([
  'funding_provided',
  'funding_provided_direct',
  'avarage_monthly_income',
  'monthly_income',
  'estimated_annual_percentage_rate',
  'finance_charge',
  'finance_charge_p2',
  'total_dollar_cost',
  'estimated_monthly_cost',
  'estimated_payment',
  'payement_exceeded_percent_p2_s1',
]);

/**
 * The disclosure's own widget names, and the CRM ids each one prints.
 *
 * The CRM screen posts every line under the widget name as well
 * (`Text Field 1`, `finance_charge_p2`, `disclosure_page3_net_p3`, …), and an
 * exact widget name outranks every alias when the field resolves. So a
 * placeholder `0.00` posted under a widget name printed on the page even after
 * the CRM id underneath it had been filled from the offer. Widgets are listed
 * against the live inventory shared by the Nitro Advance, Obsidian Capital
 * Group and Tiberian Funding disclosure templates.
 */
const DISCLOSURE_WIDGET_SOURCE_KEYS: Record<string, readonly string[]> = {
  'Text Field 1': ['funding_provided', 'disclosure_amount_financed'],
  'Text Field 2': ['funding_provided_direct', 'disclosure_recipient_funds'],
  'Text Field 3': ['disclosure_apr', 'estimated_annual_percentage_rate'],
  'Text Field 4': ['disclosure_avg_monthly_revenue', 'avarage_monthly_income', 'monthly_income'],
  'Text Field 5': ['disclosure_finance_charge'],
  'Text Field 6': ['disclosure_total_payment'],
  'Text Field 7': ['disclosure_monthly_cost'],
  'Text Field 8': ['disclosure_estimated_payment'],
  finance_charge_p2: ['disclosure_finance_charge'],
  payement_exceeded_percent_p2_s1: ['disclosure_payment_terms'],
  disclosure_recipient_funds_p3: ['disclosure_recipient_funds'],
  disclosure_page3_line_1_p3: ['disclosure_page3_line_1'],
  disclosure_page3_line_2_p3: ['disclosure_page3_line_2'],
  disclosure_page3_subtotal_p3: ['disclosure_page3_subtotal'],
  disclosure_broker_fee_p3: ['disclosure_broker_fee'],
  disclosure_page3_net_p3: ['disclosure_page3_net'],
};

/**
 * Saved disclosure-tab values, minus the zero placeholders that would bury a
 * real amount already in `base` for the same line.
 *
 * The disclosure's prefill tab is saved straight from the CRM calculator, and a
 * calculation run before the deal's revenue or fees were loaded saves `0.00` on
 * those lines. The tab is layered over the package map for its document, so
 * that `0.00` replaced the deal's own figure and the Owner opened Review on a
 * disclosure full of zeros. Every other saved value — including a zero where
 * the deal has nothing better — still wins, exactly as before.
 */
export function dropZeroDisclosurePlaceholders(
  tabs: Record<string, string>,
  base: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tabs)) {
    if (isDisclosureAmountKey(key) && isZeroDisclosureAmount(value) && hasDisclosureAmount(base[key])) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Lay the contract's stored values (`loadContractPrefillDefaults`) under the
 * package map, in place.
 *
 * A stored value only fills a gap — except on a disclosure amount line, where a
 * zero placeholder counts as a gap too: the screen posts its calculator's
 * `0.00` under every alias of the line (`disclosure_avg_monthly_revenue`,
 * `avarage_monthly_income`, `monthly_income`), which otherwise shut out the
 * business's declared revenue on all of them. `disclosureAmountsOnly` limits
 * the layering to those lines, for callers that do not read the rest.
 */
export function layerContractPrefillDefaults(
  values: Record<string, string>,
  defaults: Record<string, string>,
  options?: { disclosureAmountsOnly?: boolean },
): void {
  for (const [key, value] of Object.entries(defaults)) {
    const disclosureAmount = isDisclosureAmountKey(key);
    if (options?.disclosureAmountsOnly && !disclosureAmount) continue;
    const current = String(values[key] ?? '').trim();
    if (!current) {
      values[key] = value;
    } else if (disclosureAmount && isZeroDisclosureAmount(current) && hasDisclosureAmount(value)) {
      values[key] = value;
    }
  }
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
    // Defaults only: whatever the CRM screen posted describes this deal better —
    // except a zero placeholder, which the calculator prints when it ran without
    // inputs and which is what left Review showing 0.00 on real amounts.
    const posted = String(current[key] ?? '').trim();
    if (posted && !(isZeroDisclosureAmount(posted) && !isZeroDisclosureAmount(value))) return;
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
    [
      current.disclosure_avg_monthly_revenue,
      current.avarage_monthly_income,
      current.monthly_income,
    ].find(hasDisclosureAmount),
  );
  const terms = paymentTermsPercent(estimatedPayment, avgMonthlyRevenue, derived.frequency);
  if (terms != null && terms > 0) put('disclosure_payment_terms', percent(terms));
  // The revenue line itself: a zero on the preferred key must not hide the
  // deal's declared revenue carried on the others.
  if (avgMonthlyRevenue != null && avgMonthlyRevenue > 0) {
    put('disclosure_avg_monthly_revenue', money(avgMonthlyRevenue));
  }

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

  // A zero posted under the widget's own name outranks every CRM id, so it is
  // replaced by the line's real amount (screen-posted or derived above).
  const effective = { ...current, ...out };
  for (const [widget, sources] of Object.entries(DISCLOSURE_WIDGET_SOURCE_KEYS)) {
    if (!isZeroDisclosureAmount(current[widget])) continue;
    const amount = sources.map((key) => effective[key]).find(hasDisclosureAmount);
    if (amount) out[widget] = String(amount).trim();
  }

  return out;
}
