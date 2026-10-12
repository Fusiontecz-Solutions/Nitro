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

  it('keeps a saved disclosure fee and net instead of re-deriving them', () => {
    const { values } = signNowDocumentPrefillValues(
      PACKAGE,
      [],
      'PayOff Addendum (Refi)',
      payoffTab({ disclosure_origination_fee_p1: '4,000.00', disclosure_page3_net_p3: '16,500.00' }),
    );
    expect(values.disclosure_origination_fee_p1).toBe('4,000.00');
    expect(values.disclosure_page3_net_p3).toBe('16,500.00');
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
