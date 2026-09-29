import {
  buildSignNowDocumentPrefillTexts,
  signNowPrefillOptionsForDocument,
} from './utils/signnow-field-map';
import { buildOfferPrefillOverrides } from './utils/signnow-offer-values';
import {
  buildDisclosurePrefillDefaults,
  dropZeroDisclosurePlaceholders,
  layerContractPrefillDefaults,
} from './utils/signnow-disclosure-values';
import { resolveOfferDerivedContractValues } from '../contractOfferValueSync';

/**
 * The state disclosure must fill from the deal alone.
 *
 * Every value on the page used to arrive only in the CRM screen's prefill
 * payload, so a send whose payload carried no disclosure keys opened blank in
 * Review — on Nitro Advance, Obsidian Capital Group and Tiberian Funding alike,
 * because all three funders' copies share these widget names.
 *
 * The widget list below is the live inventory of all three templates, read from
 * SignNow (Nitro `ce1229f1…`, Obsidian `445770b8…`, Tiberian `46bffdc5…`).
 */
const DISCLOSURE_WIDGETS = [
  'Text Field 1',
  'Text Field 2',
  'Text Field 3',
  'Text Field 4',
  'Text Field 5',
  'Text Field 6',
  'Text Field 7',
  'Text Field 8',
  'disclouser_pg2_frequency',
  'payement_exceeded_percent_p2_s1',
  'estimated_term_p2',
  'finance_charge_p2',
  'signature_date_p2',
  'disclosure_recipient_funds_p3',
  'disclosure_page3_line_1_p3',
  'disclosure_page3_third_parties_p3',
  'previous_lender_name_p3',
  'disclosure_page3_line_2_p3',
  'disclosure_page3_subtotal_p3',
  'disclosure_broker_fee_p3',
  'disclosure_page3_net_p3',
];

/** A 60-payment daily deal: $50,000 advanced, $72,500 back, 2.9% origination. */
const OFFER = {
  offer: 50000,
  totalRemit: 72500,
  term: '60 Days',
  frequency: 'Daily',
  repayPerPeriod: 1208.33,
  fees: 2.9,
  refinanceAmount: null,
};

/** Exactly what the server holds when the CRM screen posts no disclosure keys. */
function backendOnlyValues(
  offer: Record<string, unknown> = OFFER,
  extra: Record<string, string> = {},
): Record<string, string> {
  const values: Record<string, string> = {
    client_name: 'ACME LLC',
    agreement_date: '09/22/2026',
    signature_date: '09/22/2026',
    // `loadContractPrefillDefaults` publishes these from Client.businessMonthlyRevenue.
    disclosure_avg_monthly_revenue: '120,000.00',
    avarage_monthly_income: '120,000.00',
    monthly_income: '120,000.00',
    ...extra,
  };
  Object.assign(
    values,
    buildOfferPrefillOverrides(
      { values: resolveOfferDerivedContractValues(offer), includeWireFee: true },
      values,
    ),
  );
  return values;
}

function filled(
  documentName: string,
  values: Record<string, string> = backendOnlyValues(),
): Record<string, string> {
  const options = signNowPrefillOptionsForDocument(documentName, DISCLOSURE_WIDGETS);
  const out: Record<string, string> = {};
  for (const text of buildSignNowDocumentPrefillTexts(DISCLOSURE_WIDGETS, values, options)) {
    out[text.field_name] = text.prefilled_text;
  }
  return out;
}

describe('the state disclosure fills from the offer alone', () => {
  it.each([
    ['Disclosure - Nitro Advance'],
    ['Disclosure Obsidian Capital Group'],
    ['Tiberian Funding - Disclosure'],
  ])('%s leaves no CRM slot blank', (documentName) => {
    const out = filled(documentName);
    // Page 1 money row.
    expect(out['Text Field 1']).toBe('50,000.00'); // amount financed
    expect(out['Text Field 2']).toBe('48,525.00'); // funds to the recipient
    expect(out['Text Field 3']).toBe('180.00'); // estimated APR
    expect(out['Text Field 4']).toBe('120,000.00'); // avg monthly revenue
    expect(out['Text Field 5']).toBe('22,500.00'); // finance charge
    expect(out['Text Field 6']).toBe('72,500.00'); // total amount to be paid
    expect(out['Text Field 7']).toBe('24,166.60'); // estimated monthly cost
    expect(out['Text Field 8']).toBe('1,208.33'); // estimated payment
    expect(out.disclouser_pg2_frequency).toBe('DAILY');
    // Page 2.
    expect(out.payement_exceeded_percent_p2_s1).toBe('21.65');
    expect(out.estimated_term_p2).toBe('60');
    expect(out.finance_charge_p2).toBe('22,500.00');
    expect(out.signature_date_p2).toBe('09/22/2026');
    // Page 3 itemization — the lines add back up to the advance.
    expect(out.disclosure_recipient_funds_p3).toBe('48,525.00');
    expect(out.disclosure_page3_line_1_p3).toBe('1,475.00');
    expect(out.disclosure_page3_third_parties_p3).toBe('0.00');
    expect(out.disclosure_page3_line_2_p3).toBe('0.00');
    expect(out.disclosure_page3_subtotal_p3).toBe('50,000.00');
    expect(out.disclosure_broker_fee_p3).toBe('1,475.00');
    expect(out.disclosure_page3_net_p3).toBe('48,525.00');
  });

  it('fills every funder copy identically', () => {
    const nitro = filled('Disclosure - Nitro Advance');
    expect(filled('Disclosure Obsidian Capital Group')).toEqual(nitro);
    expect(filled('Tiberian Funding - Disclosure')).toEqual(nitro);
    // Tiberian's copy is titled with the funder alone and is classified by its
    // widgets, so it must not be read as that funder's agreement layout.
    expect(filled('TIBERIAN FUNDING')).toEqual(nitro);
  });

  it('never overrides a value the CRM screen posted', () => {
    const out = filled(
      'Disclosure - Nitro Advance',
      backendOnlyValues(OFFER, {
        // The screen's calculator sees the bank analyses; the offer does not.
        disclosure_apr: '41.23',
        disclosure_finance_charge: '19,000.00',
        disclosure_page3_net: '47,050.00',
      }),
    );
    expect(out['Text Field 3']).toBe('41.23');
    expect(out['Text Field 5']).toBe('19,000.00');
    expect(out.finance_charge_p2).toBe('19,000.00');
    expect(out.disclosure_page3_net_p3).toBe('47,050.00');
  });

  it('fills real amounts over the 0.00 a calculator without inputs posted', () => {
    // What the screen posts when its disclosure calculator ran before the deal
    // loaded: every line 0.00, under the CRM id AND the widget's own name.
    const zeros: Record<string, string> = {};
    for (const key of [
      'disclosure_amount_financed',
      'disclosure_recipient_funds',
      'disclosure_apr',
      'disclosure_finance_charge',
      'disclosure_total_payment',
      'disclosure_estimated_payment',
      'disclosure_monthly_cost',
      'disclosure_payment_terms',
      'disclosure_page3_line_1',
      'disclosure_page3_subtotal',
      'disclosure_broker_fee',
      'disclosure_page3_net',
      'funding_provided_direct',
      'Text Field 1',
      'Text Field 2',
      'Text Field 3',
      'Text Field 5',
      'Text Field 6',
      'Text Field 7',
      'Text Field 8',
      'finance_charge_p2',
      'payement_exceeded_percent_p2_s1',
      'disclosure_recipient_funds_p3',
      'disclosure_page3_line_1_p3',
      'disclosure_page3_subtotal_p3',
      'disclosure_broker_fee_p3',
      'disclosure_page3_net_p3',
    ]) {
      zeros[key] = '0.00';
    }
    const out = filled('Disclosure - Nitro Advance', backendOnlyValues(OFFER, zeros));
    expect(out).toEqual(filled('Disclosure - Nitro Advance'));
    expect(out['Text Field 1']).toBe('50,000.00');
    expect(out['Text Field 3']).toBe('180.00');
    expect(out.finance_charge_p2).toBe('22,500.00');
    expect(out.payement_exceeded_percent_p2_s1).toBe('21.65');
    expect(out.disclosure_page3_net_p3).toBe('48,525.00');
  });

  it('keeps the declared revenue when the revenue line is posted as 0.00', () => {
    const values: Record<string, string> = {
      disclosure_avg_monthly_revenue: '0.00',
      avarage_monthly_income: '0.00',
      monthly_income: '0.00',
      'Text Field 4': '0.00',
    };
    // `loadContractPrefillDefaults` holds Client.businessMonthlyRevenue.
    layerContractPrefillDefaults(values, {
      disclosure_avg_monthly_revenue: '120,000.00',
      avarage_monthly_income: '120,000.00',
      monthly_income: '120,000.00',
      purchase_price: '1.00',
    }, { disclosureAmountsOnly: true });
    expect(values.purchase_price).toBeUndefined();
    const out = filled('Disclosure - Nitro Advance', backendOnlyValues(OFFER, values));
    expect(out['Text Field 4']).toBe('120,000.00');
    expect(out.payement_exceeded_percent_p2_s1).toBe('21.65');
  });

  it('keeps a zero where zero is the real amount', () => {
    const out = filled(
      'Disclosure - Nitro Advance',
      backendOnlyValues(OFFER, {
        disclosure_page3_line_2: '0.00',
        disclosure_page3_third_parties: '0.00',
        'Text Field 4': '0.00',
        disclosure_avg_monthly_revenue: '0.00',
        avarage_monthly_income: '',
        monthly_income: '',
      }),
    );
    expect(out.disclosure_page3_line_2_p3).toBe('0.00');
    expect(out.disclosure_page3_third_parties_p3).toBe('0.00');
    // No revenue anywhere on the deal: nothing better to print.
    expect(out['Text Field 4']).toBe('0.00');
  });

  it('does not let a saved tab 0.00 bury a real amount', () => {
    const base = backendOnlyValues();
    const tab = {
      disclosure_avg_monthly_revenue: '0.00',
      disclosure_apr: '41.23',
      disclosure_page3_third_parties: '0.00',
      disclosure_date: '09/22/2026',
    };
    expect(dropZeroDisclosurePlaceholders(tab, base)).toEqual({
      disclosure_apr: '41.23',
      disclosure_page3_third_parties: '0.00',
      disclosure_date: '09/22/2026',
    });
    // A zero with nothing real beneath it is still the tab's value.
    expect(dropZeroDisclosurePlaceholders(tab, {})).toEqual(tab);
  });

  it('splits the page-3 itemization across a refinanced balance', () => {
    const out = filled(
      'Disclosure - Nitro Advance',
      backendOnlyValues({ ...OFFER, refinanceAmount: 10000 }),
    );
    expect(out.disclosure_recipient_funds_p3).toBe('38,525.00');
    expect(out.disclosure_page3_line_1_p3).toBe('1,475.00');
    expect(out.disclosure_page3_line_2_p3).toBe('10,000.00');
    expect(out.disclosure_page3_subtotal_p3).toBe('50,000.00');
    expect(out.disclosure_page3_net_p3).toBe('48,525.00');
  });

  it('scales the weekly deal by weeks, not by payment count', () => {
    const weekly = { ...OFFER, term: '10 Weeks', frequency: 'Weekly', repayPerPeriod: 7250 };
    const values = backendOnlyValues(weekly);
    const out = filled('Disclosure - Nitro Advance', values);
    expect(out.estimated_term_p2).toBe('70'); // calendar days, not 10
    expect(out['Text Field 7']).toBe('29,000.00'); // payment x 4 weeks
    expect(out.disclouser_pg2_frequency).toBe('WEEKLY');
  });

  it('publishes nothing when the deal has no live offer', () => {
    expect(buildDisclosurePrefillDefaults({ values: null, includeWireFee: true })).toEqual({});
  });

  it('keeps the page-3 itemization off a deal whose fee swallows the advance', () => {
    // A fee at or above the advance is a stale value scaled against a superseded
    // offer (100% of the advance, here); printing it would break the page's own
    // arithmetic.
    const out = buildDisclosurePrefillDefaults({
      values: resolveOfferDerivedContractValues({ ...OFFER, fees: 100 }),
      includeWireFee: true,
    });
    expect(out.disclosure_page3_subtotal).toBeUndefined();
    expect(out.disclosure_recipient_funds).toBeUndefined();
    // The values that do not depend on the fee still publish.
    expect(out.disclosure_total_payment).toBe('72,500.00');
  });
});
