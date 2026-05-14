/**
 * Session-scoped cache for Deal Pipeline `/applications` list responses so the table
 * can hydrate immediately on mount / stage switches (stale-while-revalidate).
 */

const STORAGE_KEY = "ihcrm_deal_pipeline_lists_v1";
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 40;

type CacheEntry = {
  savedAt: number;
  total: number;
  raw: unknown[];
};

type StoredBlob = {
  v: 1;
  userId: string;
  entries: Record<string, CacheEntry>;
};

function entryKey(
  operationsStatus: string,
  page: number,
  limit: number,
  search: string,
): string {
  return `${operationsStatus}\0${page}\0${limit}\0${search}`;
}

function parseBlob(raw: string | null): StoredBlob | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as StoredBlob;
    if (p.v !== 1 || typeof p.userId !== "string" || !p.entries || typeof p.entries !== "object") {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

function readBlob(userId: string): StoredBlob | null {
  if (typeof window === "undefined") return null;
  const parsed = parseBlob(sessionStorage.getItem(STORAGE_KEY));
  if (!parsed || parsed.userId !== userId) return null;
  return parsed;
}

function evictOldest(entries: Record<string, CacheEntry>): void {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return;
  const sorted = keys.sort((a, b) => entries[a].savedAt - entries[b].savedAt);
  const drop = sorted.length - MAX_ENTRIES;
  for (let i = 0; i < drop; i++) {
    delete entries[sorted[i]];
  }
}

export function readDealPipelineListCache(
  userId: string,
  operationsStatus: string,
  page: number,
  limit: number,
  search: string,
): { raw: unknown[]; total: number } | null {
  if (!userId) return null;
  const blob = readBlob(userId);
  if (!blob) return null;
  const k = entryKey(operationsStatus, page, limit, search);
  const e = blob.entries[k];
  if (!e || !Array.isArray(e.raw)) return null;
  if (Date.now() - e.savedAt > MAX_CACHE_AGE_MS) {
    delete blob.entries[k];
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch {
      /* ignore */
    }
    return null;
  }
  return { raw: e.raw, total: Number(e.total) || 0 };
}

export function writeDealPipelineListCache(
  userId: string,
  operationsStatus: string,
  page: number,
  limit: number,
  search: string,
  raw: unknown[],
  total: number,
): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    let blob = readBlob(userId);
    if (!blob) {
      blob = { v: 1, userId, entries: {} };
    }
    const k = entryKey(operationsStatus, page, limit, search);
    blob.entries[k] = {
      savedAt: Date.now(),
      total,
      raw: JSON.parse(JSON.stringify(raw)) as unknown[],
    };
    evictOldest(blob.entries);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  } catch {
    /* quota / private mode */
  }
}

export function clearDealPipelineListCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
