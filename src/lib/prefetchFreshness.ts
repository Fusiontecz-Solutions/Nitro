/** Skip duplicate shell prefetches when data was loaded recently. */
export const SHELL_PREFETCH_TTL_MS = 30_000;

export function isShellPrefetchFresh(
  lastFetchedAt: number | null | undefined,
  ttlMs: number = SHELL_PREFETCH_TTL_MS,
): boolean {
  if (lastFetchedAt == null || !Number.isFinite(lastFetchedAt)) return false;
  return Date.now() - lastFetchedAt < ttlMs;
}
