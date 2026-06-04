/** Shared TanStack Query timing for read-mostly dashboard data. */
export const QUERY_STALE_TIME_MS = 60_000;
export const QUERY_REFETCH_INTERVAL_MS = 60_000;

/** REST fallback when Socket.IO is down. */
export const NOTIFICATIONS_FALLBACK_POLL_MS = 60_000;
export const CHAT_MESSAGES_FALLBACK_POLL_MS = 30_000;

/** Refetch interval only while the tab is visible (TanStack Query `refetchInterval` callback). */
export function visibleRefetchInterval(): number | false {
  if (typeof document !== "undefined" && document.hidden) return false;
  return QUERY_REFETCH_INTERVAL_MS;
}
