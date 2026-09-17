import { resolveAchProgramFeeAmount } from './signnow-field-map';
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
 * Build the override map for a package's prefill values.
 *
 * `current` is read only to recover the deal's ACH program fee, which is a document-level
 * charge (the checkbox on the deal) rather than part of the offer, and which TOTAL FEES
 * and NET AMOUNT both have to include to stay self-consistent.
 *
 * Note the column/PDF naming inversion: on the PDF, PURCHASE PRICE is the funded advance
 * and PURCHASED AMOUNT is the payback — the reverse of the `purchasePrice` /
 * `purchaseAmount` contract columns.
 */
export function buildOfferPrefillOverrides(
  source: ContractOfferPrefillSource | null | undefined,
  current: Record<string, string> = {},
): Record<string, string> {
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

  if (derived.disclosureTermDays != null) {
    const termDaysText = String(derived.disclosureTermDays);
    put('disclosure_term_days', termDaysText);
    put('estimated_term', termDaysText);
  }

  const origination = parseMoney(derived.appendixUnderwritingFees ?? undefined);
  if (origination != null && origination > 0) {
    // The origination fee carries the wire fee, matching how the CRM renders every
    // origination / total-fee field. Overriding it without the wire fee is what silently
    // dropped a checked "$25 wire fee" from TOTAL FEES and NET AMOUNT.
    const underwriting = origination + wireFee;
    put('appendix_underwriting_fees', money(underwriting));
    const achFee = resolveAchProgramFeeAmount(
      new Map(Object.entries(current).map(([key, value]) => [key.toLowerCase(), value])),
    );
    const totalFees = underwriting + achFee;
    // Only publish the derived totals while they still describe a real deal; a fee at or
    // above the advance means the inputs disagree, and a wrong NET is worse than a stale one.
    if (funded != null && totalFees < funded) {
      put('total_fees', money(totalFees));
      put('net_to_merchant', money(funded - totalFees));
    }
  }

  return out;
}
