/**
 * "$25 wire fee" default: on a REFI deal the $25 goes on only when the box was
 * ticked. A missing choice used to resolve to "on", which printed TOTAL FEES
 * 1,025.00 / NET AMOUNT 4,475.00 on a 10,000 advance with a 1,000 fee and a
 * 4,500 refinance after the box had been unticked.
 */
jest.mock('../config/prismaClient', () => ({ __esModule: true, default: {} }));

import { readIncludeWireFeeFromOverrides } from './contractOfferValueSync';
import { buildOfferPrefillOverrides } from './signnow/utils/signnow-offer-values';

describe('readIncludeWireFeeFromOverrides', () => {
  it('honours an explicit choice on any deal', () => {
    expect(readIncludeWireFeeFromOverrides({ includeWireFee: 'false' }, 4500)).toBe(false);
    expect(readIncludeWireFeeFromOverrides({ includeWireFee: 'true' }, 4500)).toBe(true);
    expect(readIncludeWireFeeFromOverrides({ includeWireFee: 'false' })).toBe(false);
  });

  it('REFI deal with no saved choice: no wire fee', () => {
    expect(readIncludeWireFeeFromOverrides({}, 4500)).toBe(false);
    expect(readIncludeWireFeeFromOverrides(null, '4,500.00')).toBe(false);
    expect(readIncludeWireFeeFromOverrides({ refinanceAmount: '4500' })).toBe(false);
  });

  it('non-REFI deal with no saved choice keeps the fee-on default', () => {
    expect(readIncludeWireFeeFromOverrides({})).toBe(true);
    expect(readIncludeWireFeeFromOverrides(undefined, 0)).toBe(true);
    expect(readIncludeWireFeeFromOverrides({ refinanceAmount: '0' }, null)).toBe(true);
  });
});

describe('contract table on the reported REFI deal (10,000 / 1,000 fee / 4,500 refi)', () => {
  const values = {
    approvedAmount: 10000,
    totalAmount: 15000,
    appendixUnderwritingFees: '1000',
    refinanceAmount: 4500,
  } as never;

  it('unticked (or no choice saved): TOTAL FEES 1,000.00, NET AMOUNT 4,500.00', () => {
    const out = buildOfferPrefillOverrides({
      values,
      includeWireFee: readIncludeWireFeeFromOverrides({}, 4500),
    });
    expect(out.total_fees).toBe('1,000.00');
    expect(out.net_to_merchant).toBe('4,500.00');
  });

  it('ticked: TOTAL FEES 1,025.00, NET AMOUNT 4,475.00', () => {
    const out = buildOfferPrefillOverrides({
      values,
      includeWireFee: readIncludeWireFeeFromOverrides({ includeWireFee: 'true' }, 4500),
    });
    expect(out.total_fees).toBe('1,025.00');
    expect(out.net_to_merchant).toBe('4,475.00');
  });
});
