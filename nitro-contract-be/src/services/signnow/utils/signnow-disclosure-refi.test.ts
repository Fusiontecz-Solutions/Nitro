/**
 * REFI disclosure money lines, every state. Reported deal: 50,000 advance,
 * 5,000 fee, 10,000 previous balance — contract NET AMOUNT 35,000.00, but the
 * disclosure printed "Amount Financed 45,000.00" and a blank origination fee.
 */
jest.mock('../../../config/prismaClient', () => ({ __esModule: true, default: {} }));

import { buildDisclosurePrefillDefaults } from './signnow-disclosure-values';

const source = (refinanceAmount: number) =>
  ({
    values: {
      approvedAmount: 50000,
      totalAmount: 75000,
      appendixUnderwritingFees: '5000',
      refinanceAmount,
      remittance: '3750',
      frequency: 'Daily',
    },
    includeWireFee: false,
  }) as never;

describe('buildDisclosurePrefillDefaults on a REFI deal', () => {
  it('Amount Financed = advance − fee − previous balance (35,000.00)', () => {
    const out = buildDisclosurePrefillDefaults(source(10000));
    expect(out.disclosure_amount_financed).toBe('35,000.00');
    expect(out.disclosure_recipient_funds).toBe('35,000.00');
  });

  it('prints the origination fee on the prepaid finance charge lines', () => {
    const out = buildDisclosurePrefillDefaults(source(10000));
    expect(out.disclosure_origination_fee).toBe('5,000.00');
    expect(out.disclosure_fees_deducted).toBe('5,000.00');
    expect(out.disclosure_page3_line_1).toBe('5,000.00');
    expect(out.disclosure_page3_line_2).toBe('10,000.00');
  });

  it('non-REFI deal keeps its existing Amount Financed default', () => {
    const out = buildDisclosurePrefillDefaults(source(0));
    expect(out.disclosure_amount_financed).toBe('50,000.00');
    expect(out.disclosure_origination_fee).toBe('5,000.00');
  });
});
