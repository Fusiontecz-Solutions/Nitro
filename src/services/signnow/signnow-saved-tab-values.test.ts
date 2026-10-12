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
