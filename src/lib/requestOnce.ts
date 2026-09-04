/** Skip duplicate reads for the same resource within a short window. */

const DEFAULT_TTL_MS = 60_000;
const lastAt = new Map<string, number>();

export function shouldSkipFreshRequest(
  key: string,
  ttlMs: number = DEFAULT_TTL_MS,
): boolean {
  const at = lastAt.get(key);
  if (at != null && Date.now() - at < ttlMs) return true;
  lastAt.set(key, Date.now());
  return false;
}

export function markRequestFresh(key: string): void {
  lastAt.set(key, Date.now());
}

export function invalidateRequestFreshness(prefix?: string): void {
  if (!prefix) {
    lastAt.clear();
    return;
  }
  for (const key of lastAt.keys()) {
    if (key.startsWith(prefix)) lastAt.delete(key);
  }
}
