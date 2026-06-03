/** Shell layout prefetch TTL — skip duplicate dashboard/stats calls within this window. */
export const SHELL_PREFETCH_TTL_MS = 30_000;

export function isPrefetchFresh(lastFetchedAt: number | null | undefined): boolean {
  if (lastFetchedAt == null || !Number.isFinite(lastFetchedAt)) return false;
  return Date.now() - lastFetchedAt < SHELL_PREFETCH_TTL_MS;
}

/** TanStack Query refetchInterval helper — pause polling when tab is hidden. */
export function visibleRefetchInterval(intervalMs: number): number | false {
  if (typeof document !== "undefined" && document.hidden) return false;
  return intervalMs;
}
