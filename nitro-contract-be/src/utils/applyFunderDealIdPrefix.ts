import { compactDealIdToken } from './funderDealIdTokens';

/**
 * Strip any leading letter prefix and return the trailing numeric core
 * (e.g. `WF12` / `KK12` / `12` → `"12"`).
 */
export function extractDealIdNumericCore(dealIdRaw: string | null | undefined): string | null {
  const compact = compactDealIdToken(dealIdRaw);
  if (!compact) return null;
  const match = compact.match(/([0-9]+)$/);
  return match?.[1] ?? null;
}

/**
 * Build `{PREFIX}{numericCore}` from an existing deal id and funder prefix.
 * Returns null when there is no numeric core to keep.
 */
export function buildPrefixedDealId(
  dealIdRaw: string | null | undefined,
  dealIdPrefix: string | null | undefined,
): string | null {
  const core = extractDealIdNumericCore(dealIdRaw);
  if (!core) return null;
  const prefix = String(dealIdPrefix ?? '')
    .trim()
    .toUpperCase();
  if (!prefix) return core;
  return `${prefix}${core}`;
}
