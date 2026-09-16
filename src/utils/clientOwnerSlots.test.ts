import {
  nextAvailableOwnerSortOrder,
  OWNER_ORDER_BY,
  ownerRowForSlot,
} from './clientOwnerSlots';
import { scoreOwnerNameMatch } from '../services/autoCreateBatchClassifyService';

/**
 * Regression: "Business Owner Details (2)" rendered the same person in both slots.
 * A driver-licence upload picked its ClientOwner row by fuzzy name match across the
 * whole owners array, so owner 2's licence bound to owner 1's row.
 */
describe('owner slot resolution', () => {
  const OWNER_1 = { id: 'o1', firstName: 'Monika', lastName: 'Test', sortOrder: 0 };
  const OWNER_2 = { id: 'o2', firstName: 'Arman', lastName: 'Test', sortOrder: 1 };

  it('demonstrates why name matching cannot pick the slot', () => {
    // Co-owners who share a surname — spouses, siblings, parent/child — are common.
    // A shared last name alone scores 60, above the old `>= 40` accept threshold.
    const crossMatch = scoreOwnerNameMatch(
      { firstName: OWNER_2.firstName, lastName: OWNER_2.lastName },
      { firstName: OWNER_1.firstName, lastName: OWNER_1.lastName },
    );
    expect(crossMatch).toBeGreaterThanOrEqual(40);
  });

  it('maps each owner index to its own row', () => {
    const owners = [OWNER_1, OWNER_2];
    expect(ownerRowForSlot(owners, 1)).toBe(OWNER_1);
    // The bug: this used to resolve to OWNER_1 via the surname match.
    expect(ownerRowForSlot(owners, 2)).toBe(OWNER_2);
  });

  it('returns nothing for a slot with no row yet, so a new owner is created', () => {
    expect(ownerRowForSlot([OWNER_1], 2)).toBeUndefined();
    expect(ownerRowForSlot([], 1)).toBeUndefined();
  });

  it('ignores an invalid owner index instead of wrapping to another slot', () => {
    expect(ownerRowForSlot([OWNER_1, OWNER_2], 0)).toBeUndefined();
    expect(ownerRowForSlot([OWNER_1, OWNER_2], -1)).toBeUndefined();
    expect(ownerRowForSlot([OWNER_1, OWNER_2], Number.NaN)).toBeUndefined();
  });
});

describe('nextAvailableOwnerSortOrder', () => {
  it('uses the requested slot when it is free', () => {
    expect(nextAvailableOwnerSortOrder([0], 2)).toBe(1);
    expect(nextAvailableOwnerSortOrder([], 1)).toBe(0);
  });

  it('never reuses an occupied sortOrder', () => {
    // Two rows on sortOrder 0 make `orderBy sortOrder asc` arbitrary, which is how
    // the owners appeared to swap between refreshes.
    expect(nextAvailableOwnerSortOrder([0], 1)).toBe(1);
    expect(nextAvailableOwnerSortOrder([0, 1], 1)).toBe(2);
    expect(nextAvailableOwnerSortOrder([0, 1, 2], 2)).toBe(3);
  });

  it('treats a null sortOrder as 0, matching the read-side sort', () => {
    expect(nextAvailableOwnerSortOrder([null], 1)).toBe(1);
    expect(nextAvailableOwnerSortOrder([undefined, 1], 1)).toBe(2);
  });
});

describe('OWNER_ORDER_BY', () => {
  it('is a total order — sortOrder, then createdAt, then the unique id', () => {
    // sortOrder alone ties on legacy rows, and createMany gives every row it inserts
    // the same createdAt, so without `id` Postgres may return tied rows in a
    // different order per query and the two owners appear to swap.
    expect(OWNER_ORDER_BY).toEqual([
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
    expect(OWNER_ORDER_BY[OWNER_ORDER_BY.length - 1]).toEqual({ id: 'asc' });
  });
});
