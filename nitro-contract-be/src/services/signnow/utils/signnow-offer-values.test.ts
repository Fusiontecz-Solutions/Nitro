import {
  alignDisclosureRecipientFundsWithRefinance,
  alignDisclosureWireFeeWithTotalFees,
  buildOfferPrefillOverrides,
} from './signnow-offer-values';
import {
  readSavedOfferPrefillFromOverrides,
  resolveOfferDerivedContractValues,
} from '../../contractOfferValueSync';
import { resolveSignNowPrefillValue } from './signnow-field-map';

/** The re-scrubbed deal from the bug report: $1,000 @ 1.499 raised to $2,000 @ 1.499. */
const LIVE_OFFER = {
  offer: 2000,
  totalRemit: 2998,
  term: '10',
  frequency: 'Daily',
  repayPerPeriod: 299.8,
  fees: 10,
};

/** The deal's $25 wire fee is on unless the CRM checkbox was explicitly cleared. */
function source(offer: unknown, includeWireFee = true) {
  return { values: resolveOfferDerivedContractValues(offer as never), includeWireFee };
}

describe('buildOfferPrefillOverrides', () => {
  it('overrides a payload still carrying the superseded offer', () => {
    const stale = {
      purchase_price: '1,000.00',
      purchased_amount: '1,499.00',
      remittance: '149.90',
      net_to_merchant: '875.00',
      appendix_underwriting_fees: '1,000.00',
    };
    const overrides = buildOfferPrefillOverrides(source(LIVE_OFFER, false), stale);

    expect(overrides.purchase_price).toBe('2,000.00');
    expect(overrides.purchased_amount).toBe('2,998.00');
    expect(overrides.remittance).toBe('299.80');
    expect(overrides.appendix_underwriting_fees).toBe('200.00');
    // No ACH box in this payload, so TOTAL FEES is the origination fee alone.
    expect(overrides.total_fees).toBe('200.00');
    expect(overrides.net_to_merchant).toBe('1,800.00');
  });

  it('keeps the ACH program fee out of TOTAL FEES and NET AMOUNT', () => {
    const overrides = buildOfferPrefillOverrides(source(LIVE_OFFER, false), {
      ach_enabled: 'true',
    });
    expect(overrides.total_fees).toBe('200.00');
    expect(overrides.net_to_merchant).toBe('1,800.00');
  });

  it('adds the $25 wire fee when the deal has it switched on', () => {
    const overrides = buildOfferPrefillOverrides(source(LIVE_OFFER, true), {});
    expect(overrides.appendix_underwriting_fees).toBe('225.00');
    expect(overrides.total_fees).toBe('225.00');
    expect(overrides.net_to_merchant).toBe('1,775.00');
  });

  it('omits the $25 wire fee once the checkbox is cleared', () => {
    const overrides = buildOfferPrefillOverrides(source(LIVE_OFFER, false), {});
    expect(overrides.appendix_underwriting_fees).toBe('200.00');
    expect(overrides.total_fees).toBe('200.00');
    expect(overrides.net_to_merchant).toBe('1,800.00');
  });

  it('charges the wire fee but never the ACH program fee in TOTAL FEES', () => {
    const overrides = buildOfferPrefillOverrides(source(LIVE_OFFER, true), {
      ach_program_fee: '49.00',
    });
    // 200 origination + 25 wire. The $49 ACH program fee is billed separately.
    expect(overrides.total_fees).toBe('225.00');
    expect(overrides.net_to_merchant).toBe('1,775.00');
  });

  it('reproduces the reported $10,000 deal with the wire fee checked', () => {
    const overrides = buildOfferPrefillOverrides(
      source({ offer: 10000, totalRemit: 14990, term: '10', fees: 10 }, true),
      {},
    );
    expect(overrides.purchase_price).toBe('10,000.00');
    expect(overrides.purchased_amount).toBe('14,990.00');
    // The document printed 1,000.00 / 9,000.00 — the checked $25 had gone missing.
    expect(overrides.total_fees).toBe('1,025.00');
    expect(overrides.net_to_merchant).toBe('8,975.00');
  });

  /**
   * Tiberian, $50,000 @ 10%: the CRM screen showed $5,025.00 of fees and
   * $44,975.00 of recipient funds, while the agreement printed $5,035.00 /
   * $44,965.00 — the deal's $10 ACH program fee had been folded into TOTAL FEES.
   */
  it('prints the CRM total when the deal carries an ACH program fee', () => {
    const overrides = buildOfferPrefillOverrides(
      source({ offer: 50000, totalRemit: 74950, term: '10 Weeks', frequency: 'Weekly', fees: 10 }, true),
      { ach_program_fee: '10.00' },
    );
    expect(overrides.appendix_underwriting_fees).toBe('5,025.00');
    expect(overrides.total_fees).toBe('5,025.00');
    expect(overrides.net_to_merchant).toBe('44,975.00');
  });

  it('keeps the printed row self-consistent: price − fees = net', () => {
    const overrides = buildOfferPrefillOverrides(source(LIVE_OFFER), {
      ach_program_fee: '49.00',
    });
    const money = (v: string) => Number(v.replace(/[$,]/g, ''));
    expect(money(overrides.purchase_price) - money(overrides.total_fees)).toBe(
      money(overrides.net_to_merchant),
    );
  });

  it('carries the offer cadence onto every disclosure frequency field', () => {
    const overrides = buildOfferPrefillOverrides(
      source({ offer: 10000, totalRemit: 14990, term: '10 Weeks', frequency: 'Weekly' }),
      // The CRM screen posted the cadence it had resolved through the contract row.
      { frequency: 'Daily', disclosure_payment_frequency: 'Daily' },
    );
    expect(overrides.frequency).toBe('Weekly');
    expect(overrides.payment_frequency).toBe('Weekly');
    expect(overrides.disclosure_payment_frequency).toBe('Weekly');
    expect(overrides.disclouser_pg2_frequency).toBe('Weekly');
    // The unit beside the page-2 estimated term: the term is in days.
    expect(overrides.page2_frequency).toBe('DAYS');
  });

  it('discloses a weekly term in days (weeks x 7)', () => {
    const overrides = buildOfferPrefillOverrides(
      source({ offer: 10000, totalRemit: 14990, term: '10 Weeks', frequency: 'Weekly' }),
      {},
    );
    expect(overrides.disclosure_term_days).toBe('70');
    expect(overrides.estimated_term).toBe('70');
  });

  it('leaves a daily term as its own number of days', () => {
    const overrides = buildOfferPrefillOverrides(
      source({ offer: 10000, totalRemit: 14990, term: '20 Days', frequency: 'Daily' }),
      {},
    );
    expect(overrides.disclosure_term_days).toBe('20');
    expect(overrides.estimated_term).toBe('20');
  });

  it('reads a unitless term in the selected cadence', () => {
    expect(
      buildOfferPrefillOverrides(
        source({ offer: 10000, totalRemit: 14990, term: '10', frequency: 'Weekly' }),
        {},
      ).disclosure_term_days,
    ).toBe('70');
    expect(
      buildOfferPrefillOverrides(
        source({ offer: 10000, totalRemit: 14990, term: '20', frequency: 'Daily' }),
        {},
      ).disclosure_term_days,
    ).toBe('20');
  });

  it('never rescales a term already written in days', () => {
    // A weekly deal whose term was captured as "70 Days" must stay 70, not 490.
    expect(
      buildOfferPrefillOverrides(
        source({ offer: 10000, totalRemit: 14990, term: '70 Days', frequency: 'Weekly' }),
        {},
      ).disclosure_term_days,
    ).toBe('70');
  });

  it('leaves the term and cadence alone when the offer has neither', () => {
    const overrides = buildOfferPrefillOverrides(
      source({ offer: 10000, totalRemit: 14990, term: null, frequency: null }),
      { frequency: 'Daily' },
    );
    expect(overrides.frequency).toBeUndefined();
    expect(overrides.disclosure_term_days).toBeUndefined();
  });

  it('returns nothing when the contract has no offer', () => {
    expect(buildOfferPrefillOverrides(null, {})).toEqual({});
    expect(buildOfferPrefillOverrides({ values: null, includeWireFee: true }, {})).toEqual({});
  });
});

describe('TOTAL FEES regression — fee scaled against a superseded offer', () => {
  it('never prints a fee that exceeds the purchase price', () => {
    // 10% of a $10,000 advance left on a deal since cut to $1,000: this printed
    // $1,000.00+ of fees against a $1,000.00 purchase price and an $875 net.
    const value = resolveSignNowPrefillValue('total_fees', {
      purchase_price: '1,000.00',
      appendix_underwriting_fees: '1,000.00',
      net_to_merchant: '875.00',
      ach_enabled: 'true',
    });
    expect(value).toBe('125.00');
  });

  it('prints the underwriting fee alone when the ACH box is checked', () => {
    expect(
      resolveSignNowPrefillValue('total_fees', {
        purchase_price: '2,000.00',
        appendix_underwriting_fees: '200.00',
        ach_enabled: 'true',
      }),
    ).toBe('200.00');
  });
});

/**
 * Tiberian Funding's disclosure printed "Estimated Term 20" on a weekly deal
 * whose disclosure term is 140 days. The scaling was already right; the page
 * never saw it, because the CRM screen posts the disclosure's own widget name
 * and an exact widget name outranks every alias.
 */
describe('disclosure estimated term on a weekly deal', () => {
  const WEEKLY_OFFER = {
    offer: 10000,
    totalRemit: 14990,
    term: '20 Weeks',
    frequency: 'Weekly',
    repayPerPeriod: 749.5,
    fees: 10,
  };

  it('publishes the term in days onto the disclosure widget the page reads', () => {
    const overrides = buildOfferPrefillOverrides(source(WEEKLY_OFFER), {});
    expect(overrides.disclosure_term_days).toBe('140');
    expect(overrides.estimated_term).toBe('140');
    expect(overrides.estimated_term_p2).toBe('140');
  });

  it('outranks the raw cadence count the CRM screen posts', () => {
    const payload = { estimated_term_p2: '20' };
    const values = { ...payload, ...buildOfferPrefillOverrides(source(WEEKLY_OFFER), payload) };
    expect(resolveSignNowPrefillValue('estimated_term_p2', values)).toBe('140');
  });

  it('leaves a daily deal counting in days', () => {
    const overrides = buildOfferPrefillOverrides(source(LIVE_OFFER), {});
    expect(overrides.estimated_term_p2).toBe('10');
  });
});

/**
 * The deal from the bug report: $10,000 advance, $1,000 origination fee, the
 * "$25 wire fee" box unticked. The contract read TOTAL FEES 1,000 / NET 9,000,
 * while the disclosure's saved tab — written while the box was still ticked —
 * printed 1,025 and "funds provided directly 8,975.00".
 */
describe('alignDisclosureWireFeeWithTotalFees', () => {
  const unticked = {
    purchase_price: '10,000.00',
    total_fees: '1,000.00',
    net_to_merchant: '9,000.00',
    disclosure_broker_fee: '1,025.00',
    disclosure_page3_line_1: '1,025.00',
    disclosure_page3_line_2: '0.00',
    disclosure_page3_net: '8,975.00',
    disclosure_recipient_funds: '8,975.00',
    funding_provided_direct: '8,975.00',
    disclosure_amount_financed: '8,975.00',
    disclosure_page3_subtotal: '10,000.00',
  };

  it('drops the stale $25 from every disclosure fee and net line', () => {
    const out = alignDisclosureWireFeeWithTotalFees(unticked);
    expect(out.disclosure_broker_fee).toBe('1,000.00');
    expect(out.disclosure_page3_line_1).toBe('1,000.00');
    expect(out.disclosure_page3_net).toBe('9,000.00');
    expect(out.disclosure_recipient_funds).toBe('9,000.00');
    expect(out.funding_provided_direct).toBe('9,000.00');
    expect(out.disclosure_amount_financed).toBe('9,000.00');
    expect(out.disclosure_page3_subtotal).toBe('10,000.00');
  });

  it('adds the $25 back when the box is ticked and the tab was saved without it', () => {
    const out = alignDisclosureWireFeeWithTotalFees({
      purchase_price: '10,000.00',
      total_fees: '1,025.00',
      disclosure_page3_line_1: '1,000.00',
      disclosure_recipient_funds: '9,000.00',
    });
    expect(out.disclosure_page3_line_1).toBe('1,025.00');
    expect(out.disclosure_recipient_funds).toBe('8,975.00');
  });

  it('keeps a refinance deduction and never shifts a line holding the whole advance', () => {
    const out = alignDisclosureWireFeeWithTotalFees({
      purchase_price: '10,000.00',
      total_fees: '1,000.00',
      disclosure_page3_line_1: '1,025.00',
      disclosure_page3_line_2: '2,000.00',
      disclosure_recipient_funds: '6,975.00',
      disclosure_amount_financed: '10,000.00',
    });
    expect(out.disclosure_recipient_funds).toBe('7,000.00');
    expect(out.disclosure_amount_financed).toBe('10,000.00');
  });

  /**
   * The CRM screen also posts the saved tab under the widget names, and an exact
   * widget name outranks every alias — this is the line the merchant saw.
   */
  it('corrects the widget-name keys the CRM screen posts, not just the CRM ids', () => {
    const out = alignDisclosureWireFeeWithTotalFees({
      purchase_price: '10,000.00',
      total_fees: '1,000.00',
      'Text Field 1': '10,000.00',
      'Text Field 2': '8,975.00',
      disclosure_recipient_funds_p3: '8,975.00',
      disclosure_page3_net_p3: '8,975.00',
      disclosure_page3_line_1_p3: '1,025.00',
      disclosure_broker_fee_p3: '1,025.00',
      disclosure_page3_subtotal_p3: '10,000.00',
    });
    expect(out['Text Field 2']).toBe('9,000.00');
    expect(out.disclosure_recipient_funds_p3).toBe('9,000.00');
    expect(out.disclosure_page3_net_p3).toBe('9,000.00');
    expect(out.disclosure_page3_line_1_p3).toBe('1,000.00');
    expect(out.disclosure_broker_fee_p3).toBe('1,000.00');
    expect(out['Text Field 1']).toBe('10,000.00');
    expect(out.disclosure_page3_subtotal_p3).toBe('10,000.00');
  });

  it('leaves a hand-entered net to merchant alone while correcting stale disclosure lines', () => {
    const out = alignDisclosureWireFeeWithTotalFees({
      purchase_price: '20,000.00',
      total_fees: '2,000.00',
      net_to_merchant: '18,000.00',
      net_to_merchant_p1: '17,975.00',
      total_fees_p1: '2,025.00',
      amountFinanced: '17,975.00',
    });
    expect(out.net_to_merchant_p1).toBe('17,975.00');
    expect(out.total_fees_p1).toBe('2,000.00');
    expect(out.amountFinanced).toBe('18,000.00');
    expect(out.net_to_merchant).toBe('18,000.00');
    expect(out.total_fees).toBe('2,000.00');
  });

  it('detects the stale toggle from the net line alone when no fee line is posted', () => {
    const out = alignDisclosureWireFeeWithTotalFees({
      purchase_price: '10,000.00',
      total_fees: '1,000.00',
      'Text Field 2': '8,975.00',
    });
    expect(out['Text Field 2']).toBe('9,000.00');
  });

  it('leaves a disclosure that already agrees with TOTAL FEES', () => {
    const agreeing = {
      ...unticked,
      disclosure_broker_fee: '1,000.00',
      disclosure_page3_line_1: '1,000.00',
      disclosure_page3_net: '9,000.00',
      disclosure_recipient_funds: '9,000.00',
      funding_provided_direct: '9,000.00',
      disclosure_amount_financed: '9,000.00',
    };
    expect(alignDisclosureWireFeeWithTotalFees(agreeing)).toEqual(agreeing);
  });

  /**
   * Regenerated contract: the offer's origination rate moved from 10% to 7% on a
   * $30,000 advance, the contract printed TOTAL FEES 2,125.00, and the disclosure
   * tab saved against the old offer still printed 3,025.00 — on every funder.
   */
  it('replaces an origination fee saved against a superseded offer', () => {
    const out = alignDisclosureWireFeeWithTotalFees({
      purchase_price: '30,000.00',
      total_fees: '2,125.00',
      net_to_merchant: '27,875.00',
      disclosure_origination_fee: '3,025.00',
      disclosure_fees_deducted: '3,025.00',
      disclosure_broker_fee_p3: '3,025.00',
      disclosure_page3_line_1_p3: '3,025.00',
      disclosure_page3_line_2: '0.00',
      'Text Field 1': '30,000.00',
      'Text Field 2': '26,975.00',
      disclosure_recipient_funds_p3: '26,975.00',
      disclosure_page3_net_p3: '26,975.00',
      disclosure_page3_subtotal_p3: '30,000.00',
    });
    expect(out.disclosure_origination_fee).toBe('2,125.00');
    expect(out.disclosure_fees_deducted).toBe('2,125.00');
    expect(out.disclosure_broker_fee_p3).toBe('2,125.00');
    expect(out.disclosure_page3_line_1_p3).toBe('2,125.00');
    expect(out['Text Field 2']).toBe('27,875.00');
    expect(out.disclosure_recipient_funds_p3).toBe('27,875.00');
    expect(out.disclosure_page3_net_p3).toBe('27,875.00');
    expect(out['Text Field 1']).toBe('30,000.00');
    expect(out.disclosure_page3_subtotal_p3).toBe('30,000.00');
    expect(out.net_to_merchant).toBe('27,875.00');
  });

  it("keeps a broker fee that is not the origination fee (Utah)", () => {
    const out = alignDisclosureWireFeeWithTotalFees({
      purchase_price: '30,000.00',
      total_fees: '2,125.00',
      disclosure_fees_deducted: '3,025.00',
      disclosure_broker_fee: '600.00',
    });
    expect(out.disclosure_fees_deducted).toBe('2,125.00');
    expect(out.disclosure_broker_fee).toBe('600.00');
  });

  it('ignores a fee line at or above the advance', () => {
    const values = {
      purchase_price: '10,000.00',
      total_fees: '1,000.00',
      disclosure_fees_deducted: '10,025.00',
    };
    expect(alignDisclosureWireFeeWithTotalFees(values)).toEqual(values);
  });
});

describe('values saved in the Verify contract prefill editor', () => {
  const REFI_OFFER = {
    offer: 40000,
    totalRemit: 60000,
    term: '70',
    frequency: 'Daily',
    repayPerPeriod: 857.14,
    fees: 10,
    refinanceAmount: 19500,
  };

  it('prints a hand-entered net to merchant instead of re-deriving it', () => {
    const saved = readSavedOfferPrefillFromOverrides({
      netToMerchant: '36,000.00',
      _manualNetToMerchant: true,
    });
    const overrides = buildOfferPrefillOverrides(
      { ...source(REFI_OFFER, true), saved },
      {},
    );
    expect(overrides.net_to_merchant).toBe('36,000.00');
    // A net the alignment pass must not mistake for a stale wire-fee choice.
    expect(
      alignDisclosureWireFeeWithTotalFees({ ...overrides, disclosure_origination_fee: '4,000.00' })
        .net_to_merchant,
    ).toBe('36,000.00');
  });

  it('ignores a saved net that was never entered by hand', () => {
    const saved = readSavedOfferPrefillFromOverrides({ netToMerchant: '36,000.00' });
    const overrides = buildOfferPrefillOverrides({ ...source(REFI_OFFER, true), saved }, {});
    // 40,000 − 4,025 fees − 19,500 payoff.
    expect(overrides.net_to_merchant).toBe('16,475.00');
  });

  it('uses the saved offer amounts, remittance and fee over the offer row', () => {
    const saved = readSavedOfferPrefillFromOverrides({
      purchaseAmount: '45,000',
      purchasePrice: '63,000.00',
      remittance: '900.00',
      appendixUnderwritingFees: '3,000.00',
    });
    const overrides = buildOfferPrefillOverrides({ ...source(REFI_OFFER, false), saved }, {});
    expect(overrides.purchase_price).toBe('45,000.00');
    expect(overrides.purchased_amount).toBe('63,000.00');
    expect(overrides.remittance).toBe('900.00');
    expect(overrides.appendix_underwriting_fees).toBe('3,000.00');
    expect(overrides.total_fees).toBe('3,000.00');
    // 45,000 − 3,000 fees − 19,500 payoff.
    expect(overrides.net_to_merchant).toBe('22,500.00');
  });
});

/**
 * The Obsidian refi deal from the bug report: $500,000 advance, $50,000 fee,
 * $217,548.64 payoff, "$25 wire fee" unchecked. The CRM printed NET AMOUNT
 * 232,451.36; the sent contract printed TOTAL FEES 50,025.00 and NET AMOUNT
 * 449,975.00 — the payoff left in and the wire fee back on.
 */
describe('a refinance deal NET AMOUNT', () => {
  const CARBON_OFFER = {
    offer: 500000,
    totalRemit: 740000,
    term: '16',
    frequency: 'weekly',
    repayPerPeriod: 46250,
    fees: 50000,
    refinanceAmount: 217548.64,
  };

  it('takes the payoff out, with the wire fee off', () => {
    const overrides = buildOfferPrefillOverrides(source(CARBON_OFFER, false), {
      total_fees: '50,000.00',
      net_to_merchant: '232,451.36',
    });
    expect(overrides.total_fees).toBe('50,000.00');
    expect(overrides.net_to_merchant).toBe('232,451.36');
  });

  it('takes the payoff out, with the wire fee on', () => {
    const overrides = buildOfferPrefillOverrides(source(CARBON_OFFER, true), {});
    expect(overrides.total_fees).toBe('50,025.00');
    expect(overrides.net_to_merchant).toBe('232,426.36');
  });

  it('uses a payoff saved in the prefill editor over the offer row', () => {
    const saved = readSavedOfferPrefillFromOverrides({ refinanceAmount: '200,000.00' });
    const overrides = buildOfferPrefillOverrides({ ...source(CARBON_OFFER, false), saved }, {});
    expect(overrides.net_to_merchant).toBe('250,000.00');
  });

  it('leaves NET AMOUNT unset when fees and payoff exceed the advance', () => {
    const overrides = buildOfferPrefillOverrides(
      source({ ...CARBON_OFFER, refinanceAmount: 460000 }, false),
      {},
    );
    expect(overrides.total_fees).toBe('50,000.00');
    expect(overrides.net_to_merchant).toBeUndefined();
  });
});

describe('alignDisclosureRecipientFundsWithRefinance', () => {
  const deal = {
    purchase_price: '25,000.00',
    total_fees: '1,250.00',
    disclosure_page3_line_2: '14,625.00',
  };

  it('takes the payoff out of a recipient-funds line saved before the refi', () => {
    const out = alignDisclosureRecipientFundsWithRefinance({
      ...deal,
      disclosure_recipient_funds: '23,750.00',
      disclosure_recipient_funds_p3: '23,750.00',
      funding_provided_direct: '23,750.00',
      'Text Field 2': '23,750.00',
      disclosure_page3_net_p3: '23,750.00',
      total_amount_of_fund_disbursed: '23,750.00',
    });
    expect(out.disclosure_recipient_funds).toBe('9,125.00');
    expect(out.disclosure_recipient_funds_p3).toBe('9,125.00');
    expect(out.funding_provided_direct).toBe('9,125.00');
    expect(out['Text Field 2']).toBe('9,125.00');
    // Amount financed keeps the payoff; state "funds disbursed" boxes stay net-after-fees.
    expect(out.disclosure_page3_net_p3).toBe('23,750.00');
    expect(out.total_amount_of_fund_disbursed).toBe('23,750.00');
  });

  it('leaves a hand-entered or already-correct figure alone', () => {
    const values = {
      ...deal,
      disclosure_recipient_funds_p3: '9,125.00',
      funding_provided_direct: '9,000.00',
    };
    expect(alignDisclosureRecipientFundsWithRefinance(values)).toBe(values);
  });

  it('does nothing on a deal without a refinance', () => {
    const values = { ...deal, disclosure_page3_line_2: '0.00', disclosure_recipient_funds: '23,750.00' };
    expect(alignDisclosureRecipientFundsWithRefinance(values)).toBe(values);
  });
});
