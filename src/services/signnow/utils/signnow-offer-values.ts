import { buildDisclosurePrefillDefaults } from './signnow-disclosure-values';
import {
  CONTRACT_WIRE_FEE_USD,
  type ContractOfferPrefillSource,
} from '../../contractOfferValueSync';

/**
 * Prefill overrides that carry the live offer onto every document in a package.
 *
 * The CRM screen posts values it cached when the deal was first prepared, so after an
 * offer is re-scrubbed the payload can still describe the superseded terms. These keys
 * are therefore layered OVER the payload rather than filling its gaps: the offer is what
 * defines the deal, and the contract table, the ACH addendums and the disclosure all have
 * to agree with it.
 */

function money(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.round(value * 100) / 100);
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(String(value).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * The offer's derived values with what the preparer saved in the prefill editor
 * laid over them. Saving there also writes the offer, but a figure the offer
 * cannot hold exactly (a hand-entered fee, a rounded remittance) must still
 * reach SignNow as saved rather than be re-derived.
 */
function withSavedPrefillValues(
  source: ContractOfferPrefillSource | null | undefined,
): ContractOfferPrefillSource | null | undefined {
  const saved = source?.saved;
  if (!source?.values || !saved) return source;
  const values = { ...source.values };
  if (saved.purchaseAmount != null) {
    values.approvedAmount = saved.purchaseAmount;
    values.purchaseAmount = String(saved.purchaseAmount);
  }
  if (saved.purchasePrice != null) {
    values.totalAmount = saved.purchasePrice;
    values.purchasePrice = String(saved.purchasePrice);
  }
  if (saved.remittance) values.remittance = saved.remittance;
  if (saved.frequency) values.frequency = saved.frequency;
  if (saved.appendixUnderwritingFees) {
    values.appendixUnderwritingFees = saved.appendixUnderwritingFees;
  }
  if (saved.refinanceAmount != null) values.refinanceAmount = saved.refinanceAmount;
  return { ...source, values };
}

/**
 * Build the override map for a package's prefill values.
 *
 * `current` is read only as a floor for the state disclosure's money row; the deal's ACH
 * program fee is a separate recurring charge on the ACH addendum and is deliberately kept
 * out of TOTAL FEES and NET AMOUNT.
 *
 * Note the column/PDF naming inversion: on the PDF, PURCHASE PRICE is the funded advance
 * and PURCHASED AMOUNT is the payback — the reverse of the `purchasePrice` /
 * `purchaseAmount` contract columns.
 */
export function buildOfferPrefillOverrides(
  offerSource: ContractOfferPrefillSource | null | undefined,
  current: Record<string, string> = {},
): Record<string, string> {
  const source = withSavedPrefillValues(offerSource);
  const derived = source?.values;
  if (!derived) return {};
  const wireFee = source?.includeWireFee === false ? 0 : CONTRACT_WIRE_FEE_USD;

  const out: Record<string, string> = {};
  const put = (key: string, value: string | null) => {
    if (value) out[key] = value;
  };

  const funded = derived.approvedAmount;
  const payback = derived.totalAmount;
  const fundedText = funded != null ? money(funded) : null;
  const paybackText = payback != null ? money(payback) : null;

  put('purchase_price', fundedText);
  put('purchase_amount', fundedText);
  put('approved_amount', fundedText);
  put('offer_amount', fundedText);
  put('funding_provided', fundedText);
  put('purchased_amount', paybackText);
  put('payback_amount', paybackText);
  put('payment_total', paybackText);

  const remittance = parseMoney(derived.remittance ?? undefined);
  if (remittance != null) {
    const remittanceText = money(remittance);
    put('remittance', remittanceText);
    put('initial_installment', remittanceText);
    put('weekly_payment', remittanceText);
  }
  /**
   * Payment cadence and the disclosure's estimated term both come from the offer.
   *
   * The CRM screen resolves the cadence through the contract row, which has no frequency
   * column of its own, so a weekly deal could reach the disclosure with an empty cadence
   * and fall back to a "Daily" default — and the estimated term, which the cadence scales,
   * followed it. Publishing both from the live offer keeps the disclosure, the agreement's
   * installment block and the ACH addendum on the same terms as the deal.
   */
  put('frequency', derived.frequency);
  put('payment_frequency', derived.frequency);
  put('disclosure_payment_frequency', derived.frequency);
  put('disclouser_pg2_frequency', derived.frequency);
  put('page2_frequency', derived.frequency);

  if (derived.disclosureTermDays != null) {
    const termDaysText = String(derived.disclosureTermDays);
    put('disclosure_term_days', termDaysText);
    put('estimated_term', termDaysText);
    /**
     * The disclosure's own widget is `estimated_term_p2`, and an exact widget
     * name outranks every alias. The CRM screen posts that key with the offer's
     * raw term (`20` on a 10-week deal), so publishing only the aliases left the
     * page showing the cadence's own unit while the rest of the disclosure had
     * already been scaled to days. Every funder's disclosure — Nitro, Obsidian,
     * Tiberian — names the slot identically, so one override covers all three.
     */
    put('estimated_term_p2', termDaysText);
  }

  const origination = parseMoney(derived.appendixUnderwritingFees ?? undefined);
  if (origination != null && origination > 0) {
    // The origination fee carries the wire fee, matching how the CRM renders every
    // origination / total-fee field. Overriding it without the wire fee is what silently
    // dropped a checked "$25 wire fee" from TOTAL FEES and NET AMOUNT.
    const underwriting = origination + wireFee;
    put('appendix_underwriting_fees', money(underwriting));
    /**
     * TOTAL FEES is the origination fee plus the $25 wire fee when the deal's
     * checkbox is ticked — nothing else. The ACH/monthly program fee used to be
     * folded in here, which silently inflated TOTAL FEES (and deflated NET
     * AMOUNT) by the program fee on every funder, so the printed row disagreed
     * with the CRM's own fee/recipient-funds figures.
     */
    const totalFees = underwriting;
    // Only publish the derived totals while they still describe a real deal; a fee at or
    // above the advance means the inputs disagree, and a wrong NET is worse than a stale one.
    if (funded != null && totalFees < funded) {
      put('total_fees', money(totalFees));
      put('net_to_merchant', money(funded - totalFees));
    }
  }
  // A net the preparer typed into the prefill editor prints as typed.
  const manualNet = parseMoney(source?.saved?.netToMerchant);
  if (manualNet != null && manualNet > 0) put('net_to_merchant', money(manualNet));

  /**
   * The state disclosure's own money row. Unlike everything above it, these are
   * layered UNDER the payload (see `buildDisclosurePrefillDefaults`): the CRM
   * screen's disclosure calculator sees the bank analyses and the per-state
   * itemization rules and is still the better source when it posts them. It is
   * only when it does not that the page needs a floor, which is what left the
   * whole disclosure blank in Review on every funder.
   */
  for (const [key, value] of Object.entries(
    buildDisclosurePrefillDefaults(source, { ...current, ...out }),
  )) {
    if (!String(out[key] ?? '').trim()) out[key] = value;
  }

  return out;
}

/**
 * Disclosure lines that print the deal's total fee (origination + optional wire
 * fee), by the CRM id and by every widget name the CRM screen posts it under.
 * Keys are compared canonicalized (lower case, page suffix dropped).
 */
const DISCLOSURE_FEE_KEYS = new Set([
  'disclosure_broker_fee',
  'disclosure_page3_line_1',
  'disclosure_fees_deducted',
  'deducted_at_disbursement',
  'fees_deducted',
  'disclosure_origination_fee',
  // The contract's own fee ids, when an addendum's saved tab carries them.
  'total_fees',
  'appendix_underwriting_fees',
]);

/**
 * Disclosure lines that print what is left of the advance after that fee.
 * `Text Field 2` is the CA-style page 1 "funds provided directly" box, which is
 * the line the merchant reads first.
 */
const DISCLOSURE_NET_KEYS = new Set([
  'disclosure_page3_net',
  'disclosure_recipient_funds',
  'funding_provided_direct',
  'disclosure_amount_financed',
  'total_amount_of_fund_disbursed',
  'total_amount_fund_disbursed',
  'disbursement_amount',
  'text field 2',
  /**
   * The disclosure calculator's other aliases for the same net. `net_to_merchant`
   * is deliberately not here: `buildOfferPrefillOverrides` already sets it from
   * the live TOTAL FEES, or to the net the preparer typed into the prefill
   * editor, and a typed net must print as typed (36,000.00 was being moved to
   * 35,975.00 as if it were a stale wire-fee choice).
   */
  'netfundprovided',
  'amountfinanced',
  'total_amount_of_fund_provided',
  'total_amount_business_fund',
  'total_amount_sales_based_financing',
]);

function canonicalDisclosureKey(key: string): string {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/_p\d+$/, '');
}

function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fee lines checked, in order, for the fee a stale disclosure tab was saved
 * with. Lines that can only ever hold the origination fee come first; the
 * page-3 line 1 (a state's own itemization on NY) and the broker fee (Utah's
 * fee paid to the broker) come last, so they are never what defines it.
 */
const DISCLOSURE_FEE_KEY_PRIORITY = [
  'disclosure_origination_fee',
  'disclosure_fees_deducted',
  'fees_deducted',
  'deducted_at_disbursement',
  'total_fees',
  'appendix_underwriting_fees',
  'disclosure_page3_line_1',
  'disclosure_broker_fee',
];

/**
 * Keep the disclosure's fee and net lines on the contract's TOTAL FEES.
 *
 * The disclosure's own tab in the prefill editor saves its money lines, and the
 * CRM screen posts that tab under the CRM ids *and* under the widget names
 * (`Text Field 2`, `disclosure_recipient_funds_p3`, …). A widget-name key
 * outranks every alias when a widget resolves, so a tab saved before the deal
 * changed kept printing the old fee:
 *  - a tab saved while the "$25 wire fee" box was ticked kept the $25 after it
 *    was unticked ("funds provided directly 8,975.00" beside a contract NET
 *    AMOUNT of 9,000.00);
 *  - a tab saved before the offer was regenerated with a new origination rate
 *    kept the old fee outright (the disclosure's "Prepaid Finance Charges:
 *    Origination Fee" 3,025.00 beside a contract TOTAL FEES of 2,125.00).
 * Every funder — Nitro Advance, Obsidian Capital Group, Tiberian Funding —
 * shares these widget names, so this one pass covers all three.
 *
 * `total_fees` has already been resolved from the live offer and the deal's
 * wire-fee choice, and it is what the contract's first page prints. The stale
 * fee is read from the first origination line that disagrees with it; every fee
 * line holding that same stale fee is set to TOTAL FEES, and net lines move by
 * the same amount the other way. A net line only moves when it really is
 * "advance − that stale fee (− any refinance)", so a line holding the whole
 * advance or a refinance balance is never touched, and a fee line holding a
 * different amount (Utah's broker fee) keeps it.
 */
export function alignDisclosureWireFeeWithTotalFees(
  values: Record<string, string>,
): Record<string, string> {
  const totalFees = parseMoney(values.total_fees);
  if (totalFees == null || !(totalFees > 0)) return values;
  const funded = parseMoney(
    values.purchase_price || values.approved_amount || values.funding_provided,
  );
  const refi = cents(
    parseMoney(values.disclosure_page3_line_2) ?? parseMoney(values.refinance_amount) ?? 0,
  );
  const wire = CONTRACT_WIRE_FEE_USD;

  const feeKeys: string[] = [];
  const netKeys: string[] = [];
  for (const key of Object.keys(values)) {
    const canon = canonicalDisclosureKey(key);
    if (DISCLOSURE_FEE_KEYS.has(canon)) feeKeys.push(key);
    else if (DISCLOSURE_NET_KEYS.has(canon)) netKeys.push(key);
  }
  const priority = (key: string) =>
    DISCLOSURE_FEE_KEY_PRIORITY.indexOf(canonicalDisclosureKey(key));
  const feeKeysByPriority = [...feeKeys].sort((a, b) => priority(a) - priority(b));

  /** `staleFee − totalFees` for a fee line saved against other terms, else 0. */
  const feeDrift = (key: string): number => {
    const fee = parseMoney(values[key]);
    if (fee == null || !(fee > 0)) return 0;
    // A fee at or above the advance is not a fee this deal could carry.
    if (funded != null && funded > 0 && cents(fee + refi) >= funded) return 0;
    return cents(fee - totalFees);
  };
  /** How far a net line is from "advance − TOTAL FEES (− refinance)". */
  const netDelta = (key: string, matches: (delta: number) => boolean): number => {
    const net = parseMoney(values[key]);
    if (net == null || !(net > 0) || funded == null || !(funded > 0)) return 0;
    for (const deducted of refi > 0 ? [0, refi] : [0]) {
      const delta = cents(funded - totalFees - deducted - net);
      if (delta && matches(delta)) return delta;
    }
    return 0;
  };

  let drift = 0;
  for (const key of feeKeysByPriority) {
    drift = feeDrift(key);
    if (drift) break;
  }
  // No fee line posted: only the wire-fee toggle can be read from a net alone.
  if (!drift) {
    for (const key of netKeys) {
      drift = netDelta(key, (delta) => Math.abs(delta) === wire);
      if (drift) break;
    }
  }
  if (!drift) return values;

  const out = { ...values };
  for (const key of feeKeys) {
    if (feeDrift(key) === drift) out[key] = money(totalFees);
  }
  for (const key of netKeys) {
    if (netDelta(key, (delta) => delta === drift)) {
      out[key] = money((parseMoney(values[key]) as number) + drift);
    }
  }
  return out;
}

/**
 * Lines that print the cash the merchant actually receives. On a refinance that
 * is advance − fees − payoff; `disclosure_page3_net` / the amount financed keep
 * the payoff (it is paid on the merchant's behalf), and the state templates'
 * "funds disbursed" boxes print net-after-fees by design, so neither is listed.
 */
const DISCLOSURE_RECIPIENT_CASH_KEYS = new Set([
  'disclosure_recipient_funds',
  'funding_provided_direct',
  'text field 2',
  'netfundprovided',
]);

/**
 * Take the refinance payoff out of a recipient-funds line still saved as
 * "advance − fees".
 *
 * The CRM saves the disclosure tab and the contract's net when the deal is
 * prepared. Entering the refi balance afterwards refreshed the itemization's
 * line 4 (a 0.00 there counts as a placeholder) but left line 1, "Amount Given
 * Directly to You", on the pre-refi net — $25,000 − $1,250 = 23,750.00 beside a
 * $14,625 payoff, instead of 9,125.00. Only a line exactly equal to
 * advance − TOTAL FEES moves, so a hand-entered figure is never rewritten.
 */
export function alignDisclosureRecipientFundsWithRefinance(
  values: Record<string, string>,
): Record<string, string> {
  const refi = cents(
    parseMoney(values.disclosure_page3_line_2) ??
      parseMoney(values.disclosure_page3_line_2_p3) ??
      parseMoney(values.refinance_amount) ??
      0,
  );
  if (!(refi > 0)) return values;
  const funded = parseMoney(
    values.purchase_price || values.approved_amount || values.funding_provided,
  );
  const totalFees = parseMoney(values.total_fees);
  if (funded == null || !(funded > 0) || totalFees == null || !(totalFees >= 0)) return values;
  const preRefiNet = cents(funded - totalFees);
  const cash = cents(preRefiNet - refi);
  if (!(cash > 0)) return values;
  let out: Record<string, string> | null = null;
  for (const [key, value] of Object.entries(values)) {
    if (!DISCLOSURE_RECIPIENT_CASH_KEYS.has(canonicalDisclosureKey(key))) continue;
    const n = parseMoney(value);
    if (n == null || cents(n) !== preRefiNet) continue;
    out ??= { ...values };
    out[key] = money(cash);
  }
  return out ?? values;
}
