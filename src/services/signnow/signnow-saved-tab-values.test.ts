/**
 * A value typed into a document's tab in the contract prefill editor is what
 * that document prints — never a figure re-derived from the offer on top of it.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { signNowDocumentPrefillValues } from './signnow.service';
import type { SignNowDocumentTabValues } from './utils/signnow-document-tab-values';

const PACKAGE: Record<string, string> = {
  purchase_price: '40,000.00',
  approved_amount: '40,000.00',
  total_fees: '4,025.00',
  appendix_underwriting_fees: '4,025.00',
  net_to_merchant: '35,975.00',
  refinance_amount: '19,500.00',
  disclosure_page3_line_2: '19,500.00',
};

const payoffTab = (values: Record<string, string>): SignNowDocumentTabValues[] => [
  {
    mappingId: 'payoff-1',
    templateName: 'PayOff Addendum (Refi)',
    layoutKey: 'payoff_addendum',
    values,
  },
];

describe('saved document tab values reach SignNow as saved', () => {
  it('keeps the PayOff Addendum net amount the preparer saved', () => {
    const { values } = signNowDocumentPrefillValues(
      PACKAGE,
      [],
      'PayOff Addendum (Refi)',
      payoffTab({ net_to_merchant_p1: '36,000.00', addendum_p_pay_up_to_amount_p1: '19,500.00' }),
    );
    expect(values.net_to_merchant_p1).toBe('36,000.00');
    expect(values.addendum_p_pay_up_to_amount_p1).toBe('19,500.00');
  });

  it('keeps a hand-typed disclosure fee and net instead of re-deriving them', () => {
    const { values } = signNowDocumentPrefillValues(
      PACKAGE,
      [],
      'PayOff Addendum (Refi)',
      payoffTab({
        disclosure_origination_fee_p1: '4,000.00',
        disclosure_page3_net_p3: '16,500.00',
      }).map((tab) => ({
        ...tab,
        manualFieldIds: ['disclosure_origination_fee', 'disclosure_page3_net'],
      })),
    );
    expect(values.disclosure_origination_fee_p1).toBe('4,000.00');
    expect(values.disclosure_page3_net_p3).toBe('16,500.00');
  });
});

/**
 * The Obsidian refi deal from the bug report. The disclosure tab was saved by
 * the CRM calculator while the "$25 wire fee" box was still ticked and before
 * the payoff was entered; the preparer then unchecked the wire fee. The sent
 * documents printed that snapshot (50,025.00 / 449,975.00) instead of the
 * contract's TOTAL FEES 50,000.00 and NET AMOUNT 232,451.36.
 */
describe('a refi deal whose disclosure tab was saved before the wire fee was removed', () => {
  const REFI_PACKAGE: Record<string, string> = {
    purchase_price: '500,000.00',
    approved_amount: '500,000.00',
    funding_provided: '500,000.00',
    total_fees: '50,000.00',
    appendix_underwriting_fees: '50,000.00',
    net_to_merchant: '232,451.36',
    refinance_amount: '217,548.64',
    disclosure_page3_line_2: '217,548.64',
  };
  const STALE_DISCLOSURE_TAB = {
    funding_provided: '500,000.00',
    disclosure_broker_fee: '50,025.00',
    disclosure_page3_line_1: '50,025.00',
    disclosure_page3_line_2: '0.00',
    disclosure_page3_net: '449,975.00',
    disclosure_amount_financed: '449,975.00',
    disclosure_recipient_funds: '449,975.00',
    funding_provided_direct: '449,975.00',
  };
  const disclosureTab = (name: string, manualFieldIds?: string[]): SignNowDocumentTabValues[] => [
    {
      mappingId: 'disclosure-1',
      templateName: name,
      layoutKey: 'disclosure',
      values: STALE_DISCLOSURE_TAB,
      ...(manualFieldIds ? { manualFieldIds } : {}),
    },
  ];

  it.each([
    'Nitro Advance NY Disclosure',
    'Obsidian Capital Group NY Disclosure',
    'Tiberian Funding NY Disclosure',
  ])('%s follows the contract fee, payoff and net', (name) => {
    const { values } = signNowDocumentPrefillValues(REFI_PACKAGE, [], name, disclosureTab(name));
    expect(values.disclosure_page3_line_1).toBe('50,000.00');
    expect(values.disclosure_broker_fee).toBe('50,000.00');
    expect(values.disclosure_page3_line_2).toBe('217,548.64');
    expect(values.disclosure_page3_net).toBe('450,000.00');
    expect(values.disclosure_amount_financed).toBe('450,000.00');
    // The cash the merchant actually receives: advance − fees − payoff.
    expect(values.disclosure_recipient_funds).toBe('232,451.36');
    expect(values.funding_provided_direct).toBe('232,451.36');
    // The contract's own row is untouched.
    expect(values.total_fees).toBe('50,000.00');
    expect(values.net_to_merchant).toBe('232,451.36');
  });

  it('still prints a disclosure fee the preparer typed by hand', () => {
    const name = 'Obsidian Capital Group NY Disclosure';
    const { values } = signNowDocumentPrefillValues(
      REFI_PACKAGE,
      [],
      name,
      disclosureTab(name, ['disclosure_page3_line_1']),
    );
    expect(values.disclosure_page3_line_1).toBe('50,025.00');
  });

  it('keeps the PayOff Addendum net the preparer saved', () => {
    const { values } = signNowDocumentPrefillValues(
      REFI_PACKAGE,
      [],
      'Payoff Addendum (refi)',
      payoffTab({
        net_to_merchant_p1: '232,451.36',
        addendum_p_pay_up_to_amount_p1: '217,548.64',
      }),
    );
    expect(values.net_to_merchant_p1).toBe('232,451.36');
    expect(values.addendum_p_pay_up_to_amount_p1).toBe('217,548.64');
    expect(values.total_fees).toBe('50,000.00');
  });
});

/**
 * The editor saves every field on a tab, so a tab saved before the deal was
 * corrected holds the old business name / address. Regenerating must print the
 * corrected deal, not that snapshot.
 */
describe('a corrected deal outranks identity values a tab only copied', () => {
  const LIVE: Record<string, string> = {
    ...PACKAGE,
    legal_name: 'NEW NAME LLC',
    business_address: '2 New St',
    business_address_city: 'Austin',
    doing_business_as: '',
  };
  const staleTab = (extra: Record<string, string> = {}, manualFieldIds?: string[]) =>
    payoffTab({
      legal_name_p1: 'OLD NAME LLC',
      business_address_p1: '1 Old Rd, Dallas',
      doing_business_as_p1: 'OLD DBA',
      net_to_merchant_p1: '36,000.00',
      ...extra,
    }).map((tab) => ({ ...tab, ...(manualFieldIds ? { manualFieldIds } : {}) }));

  it('prints the live name and address instead of the saved copy', () => {
    const { values } = signNowDocumentPrefillValues(LIVE, [], 'PayOff Addendum (Refi)', staleTab());
    expect(values.legal_name_p1).toBeUndefined();
    expect(values.business_address_p1).toBeUndefined();
    expect(values.legal_name).toBe('NEW NAME LLC');
  });

  it('drops a DBA the tab copied, so a cleared DBA stays cleared', () => {
    const { values } = signNowDocumentPrefillValues(LIVE, [], 'PayOff Addendum (Refi)', staleTab());
    expect(values.doing_business_as_p1).toBeUndefined();
  });

  it('still prints document-only amounts as saved', () => {
    const { values } = signNowDocumentPrefillValues(LIVE, [], 'PayOff Addendum (Refi)', staleTab());
    expect(values.net_to_merchant_p1).toBe('36,000.00');
  });

  it('keeps an identity value the preparer typed by hand on the tab', () => {
    const { values } = signNowDocumentPrefillValues(
      LIVE,
      [],
      'PayOff Addendum (Refi)',
      staleTab({}, ['legal_name']),
    );
    expect(values.legal_name_p1).toBe('OLD NAME LLC');
    expect(values.business_address_p1).toBeUndefined();
  });

  it('keeps a copied value the live deal has nothing for', () => {
    const { values } = signNowDocumentPrefillValues(
      { ...PACKAGE },
      [],
      'PayOff Addendum (Refi)',
      staleTab(),
    );
    expect(values.legal_name_p1).toBe('OLD NAME LLC');
  });
});

/**
 * Contract 304 from the end-to-end run: the disclosure tab was calculated when
 * the offer was $90,000, the offer was then changed to $50,000, and the sent
 * disclosure still printed the $90,000 deal beside a $50,000 agreement.
 */
describe('a disclosure tab calculated against a superseded offer', () => {
  const LIVE: Record<string, string> = {
    purchase_price: '50,000.00',
    approved_amount: '50,000.00',
    funding_provided: '50,000.00',
    total_fees: '3,025.00',
    disclosure_total_payment: '72,500.00',
    disclosure_finance_charge: '22,500.00',
    disclosure_recipient_funds: '46,975.00',
    disclosure_page3_subtotal: '50,000.00',
    disclosure_term_days: '133',
  };
  const OLD_TAB = {
    client_name: 'CENTRAL POWER ELECTRIC CORP',
    funding_provided: '90,000.00',
    disclosure_total_payment: '129,600.00',
    disclosure_finance_charge: '39,600.00',
    disclosure_recipient_funds: '85,475.00',
    funding_provided_direct: '85,475.00',
    disclosure_avg_monthly_revenue: '120,000.00',
    disclosure_page3_subtotal: '90,000.00',
    disclosure_term_days: '140',
  };
  const tab = (manualFieldIds?: string[]): SignNowDocumentTabValues[] => [
    {
      mappingId: 'disclosure-304',
      templateName: 'State Disclosure',
      layoutKey: 'disclosure',
      values: OLD_TAB,
      ...(manualFieldIds ? { manualFieldIds } : {}),
    },
  ];

  it('prints the live deal, not the old calculation', () => {
    const { values } = signNowDocumentPrefillValues(LIVE, [], 'State Disclosure', tab());
    expect(values.funding_provided).toBe('50,000.00');
    expect(values.disclosure_total_payment).toBe('72,500.00');
    expect(values.disclosure_finance_charge).toBe('22,500.00');
    expect(values.disclosure_recipient_funds).toBe('46,975.00');
    expect(values.disclosure_page3_subtotal).toBe('50,000.00');
    expect(values.disclosure_term_days).toBe('133');
    // Page 1 "funds provided directly" falls through to the live recipient funds.
    expect(values.funding_provided_direct).toBeUndefined();
    expect(values.client_name).toBe('CENTRAL POWER ELECTRIC CORP');
    // Revenue comes from the bank analyses, not the offer: it stays.
    expect(values.disclosure_avg_monthly_revenue).toBe('120,000.00');
  });

  it('still prints a line the preparer typed by hand', () => {
    const { values } = signNowDocumentPrefillValues(
      LIVE,
      [],
      'State Disclosure',
      tab(['disclosure_finance_charge']),
    );
    expect(values.disclosure_finance_charge).toBe('39,600.00');
    expect(values.disclosure_total_payment).toBe('72,500.00');
  });

  it('keeps a tab saved against the live advance exactly as saved', () => {
    const current = { ...OLD_TAB, funding_provided: '50,000.00', disclosure_page3_subtotal: '50,000.00' };
    const { values } = signNowDocumentPrefillValues(LIVE, [], 'State Disclosure', [
      { mappingId: 'd', templateName: 'State Disclosure', layoutKey: 'disclosure', values: current },
    ]);
    expect(values.disclosure_term_days).toBe('140');
    expect(values.disclosure_total_payment).toBe('129,600.00');
  });
});
