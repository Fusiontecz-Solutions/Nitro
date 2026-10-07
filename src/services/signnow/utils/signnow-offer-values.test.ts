import {
  alignDisclosureWireFeeWithTotalFees,
  buildOfferPrefillOverrides,
} from './signnow-offer-values';
import { resolveOfferDerivedContractValues } from '../../contractOfferValueSync';
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
    expect(overrides.page2_frequency).toBe('Weekly');
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

  it('corrects an addendum tab that saved the contract net under the stale toggle', () => {
    const out = alignDisclosureWireFeeWithTotalFees({
      purchase_price: '20,000.00',
      total_fees: '2,000.00',
      net_to_merchant: '18,000.00',
      net_to_merchant_p1: '17,975.00',
      total_fees_p1: '2,025.00',
      amountFinanced: '17,975.00',
    });
    expect(out.net_to_merchant_p1).toBe('18,000.00');
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

  it('leaves a disclosure that already agrees with TOTAL FEES, or differs by another amount', () => {
    const lines = (fee: string, net: string) => ({
      ...unticked,
      disclosure_broker_fee: fee,
      disclosure_page3_line_1: fee,
      disclosure_page3_net: net,
      disclosure_recipient_funds: net,
      funding_provided_direct: net,
      disclosure_amount_financed: net,
    });
    const agreeing = lines('1,000.00', '9,000.00');
    expect(alignDisclosureWireFeeWithTotalFees(agreeing)).toEqual(agreeing);
    const stateItemized = lines('1,150.00', '8,850.00');
    expect(alignDisclosureWireFeeWithTotalFees(stateItemized)).toEqual(stateItemized);
  });
});
