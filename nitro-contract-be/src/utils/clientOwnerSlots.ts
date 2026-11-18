/**
 * Owner slot addressing for ClientOwner rows.
 *
 * A client's owners are stored one row per slot and read back with
 * `orderBy: { sortOrder: 'asc' }`, so a slot is a position — Owner 1 is index 0,
 * Owner 2 is index 1. Keeping that rule in one place is what stops an owner's
 * document from being written onto another owner's row.
 */

/**
 * Deterministic owner ordering for every ClientOwner read.
 *
 * `sortOrder` alone is not a total order. Rows written before slot numbering was
 * enforced can share a sortOrder, and `createMany` stamps every row it inserts with
 * the same `createdAt`, so both keys can tie. Postgres is then free to return tied
 * rows in any order and may return a different one per query — which showed up as
 * Owner 1 and Owner 2 swapping places on the Overview tab on every refetch.
 *
 * `id` is unique, so appending it makes the order total and the UI stable even
 * where the underlying sortOrder data is still duplicated.
 */
export const OWNER_ORDER_BY = [
  { sortOrder: 'asc' as const },
  { createdAt: 'asc' as const },
  { id: 'asc' as const },
];

/**
 * Owner slot lookup. `ownerIndex` is 1-based and `owners` is ordered by `sortOrder`,
 * so the slot is simply the matching position. Deliberately does not fall back to
 * name matching: a name match can only ever bind one owner's document onto another
 * owner's row, which is what made two owners render as the same person.
 */
export function ownerRowForSlot<T>(owners: T[], ownerIndex: number): T | undefined {
  if (!Array.isArray(owners) || !Number.isFinite(ownerIndex) || ownerIndex < 1) {
    return undefined;
  }
  return owners[ownerIndex - 1];
}

/**
 * First sortOrder at or after the requested slot that no existing owner occupies.
 * Duplicate sortOrders make `orderBy: { sortOrder: 'asc' }` non-deterministic, so
 * owners could swap position between reads and appear to change on their own.
 */
export function nextAvailableOwnerSortOrder(
  existingSortOrders: Array<number | null | undefined>,
  ownerIndex: number,
): number {
  const used = new Set<number>(
    (existingSortOrders || []).map((value) => Number(value ?? 0)),
  );
  let next = Math.max(0, ownerIndex - 1);
  while (used.has(next)) next += 1;
  return next;
}
