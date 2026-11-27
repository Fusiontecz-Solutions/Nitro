/**
 * PayOff Addendum "Net Amount to Merchant" = the contract's NET AMOUNT.
 * REFI deal (90,000 advance, 9,025 fees, 48,999.93 payoff): the addendum printed 80,975.00
 * (advance − fees, payoff not taken off) from a tab saved before the payoff.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

import { signNowDocumentPrefillValues } from './signnow.service';

const PACKAGE = {
  net_to_merchant: '31,975.07',
  purchase_price: '90,000.00',
  total_fees: '9,025.00',
  refinance_amount: '48,999.93',
};

function tab(values: Record<string, string>, manual: string[] = []) {
  return [
    {
      mappingId: 'm1',
      templateName: 'PayOff Addendum (refi)',
      layoutKey: 'addendum_p',
      values,
      manualFieldIds: manual,
    },
  ];
}

describe('PayOff Addendum net to merchant', () => {
  it('prints the contract NET, not a stale advance − fees tab value', () => {
    const { values } = signNowDocumentPrefillValues(
      PACKAGE,
      [],
      'PayOff Addendum (refi)',
      tab({ net_to_merchant_p1: '80,975.00' }),
    );
    expect(values.net_to_merchant_p1).toBe('31,975.07');
  });

  it('keeps a net typed by hand on the addendum', () => {
    const { values } = signNowDocumentPrefillValues(
      PACKAGE,
      [],
      'PayOff Addendum (refi)',
      tab({ net_to_merchant_p1: '50,000.00' }, ['net_to_merchant_p1']),
    );
    expect(values.net_to_merchant_p1).toBe('50,000.00');
  });

  it('leaves other documents alone', () => {
    const { values } = signNowDocumentPrefillValues(PACKAGE, [], 'Flex Addendum', []);
    expect(values.net_to_merchant_p1).toBeUndefined();
  });
});
