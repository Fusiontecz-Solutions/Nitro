import type { GetApplicationsParams } from "@/types/applicationTypes";
import { axiosGet } from "@/redux/axios";

const TTL_MS = 60_000;
const MAX_ENTRIES = 40;

/** Survives full page reload so `/applications` can paint cached rows before the network returns. */
const SESSION_STORAGE_PREFIX = "inhcrm.appsList.v1:";

type CacheEntry = { at: number; data: unknown };

const cache = new Map<string, CacheEntry>();

function readSessionEntry(key: string): CacheEntry | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEntry;
    if (!entry || typeof entry.at !== "number") return undefined;
    return entry;
  } catch {
    return undefined;
  }
}

function writeSessionEntry(key: string, entry: CacheEntry) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      SESSION_STORAGE_PREFIX + key,
      JSON.stringify(entry),
    );
  } catch {
    /* quota or private mode */
  }
}

function removeSessionEntry(key: string) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(SESSION_STORAGE_PREFIX + key);
  } catch {
    /* ignore */
  }
}

function pruneIfNeeded() {
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

/** Stable key for list requests (defaults match `Applications` first-page fetch). */
export function applicationsListParamsCacheKey(
  params: GetApplicationsParams,
): string {
  const p = {
    fetchAllPages: params.fetchAllPages ? "1" : "",
    page: params.page ?? 1,
    limit: params.limit ?? 10,
    search: params.search ?? "",
    status: params.status ?? "",
    statsBucket: params.statsBucket ?? "",
    operationsStatus: params.operationsStatus ?? "",
    priority: params.priority ?? "",
    type: params.type ?? "",
    clientId: params.clientId ?? "",
    currentQueue: params.currentQueue ?? "",
    currentState: params.currentState ?? "",
    sortBy: params.sortBy ?? "",
    sortOrder: params.sortOrder ?? "",
    lite: params.lite ? "1" : "",
    underwriterClaim: params.underwriterClaim ?? "",
  };
  return JSON.stringify(p);
}

export function buildApplicationsListUrl(
  params: GetApplicationsParams = {},
): string {
  const queryParams = new URLSearchParams();
  if (params.page) queryParams.append("page", params.page.toString());
  if (params.limit) queryParams.append("limit", params.limit.toString());
  if (params.search) queryParams.append("search", params.search);
  if (params.status) queryParams.append("status", params.status);
  if (params.statsBucket) queryParams.append("statsBucket", params.statsBucket);
  if (params.operationsStatus) {
    queryParams.append("operationsStatus", params.operationsStatus);
  }
  if (params.priority) queryParams.append("priority", params.priority);
  if (params.type) queryParams.append("type", params.type);
  if (params.clientId) queryParams.append("clientId", params.clientId);
  if (params.currentQueue) {
    queryParams.append("currentQueue", params.currentQueue);
  }
  if (params.currentState) {
    queryParams.append("currentState", params.currentState);
  }
  if (params.sortBy) queryParams.append("sortBy", params.sortBy);
  if (params.sortOrder) queryParams.append("sortOrder", params.sortOrder);
  if (params.lite) queryParams.append("lite", "1");
  if (params.underwriterClaim) {
    queryParams.append("underwriterClaim", params.underwriterClaim);
  }
  const q = queryParams.toString();
  return `/applications${q ? `?${q}` : ""}`;
}

export function getCachedApplicationsList(
  key: string,
): unknown | undefined {
  const entry = cache.get(key);
  if (entry) {
    if (Date.now() - entry.at > TTL_MS) {
      cache.delete(key);
      removeSessionEntry(key);
    } else {
      return entry.data;
    }
  }

  const fromSession = readSessionEntry(key);
  if (!fromSession) return undefined;
  if (Date.now() - fromSession.at > TTL_MS) {
    removeSessionEntry(key);
    return undefined;
  }
  cache.set(key, fromSession);
  return fromSession.data;
}

/**
 * Returns the freshest non-expired cached list across all keys.
 * Useful as a first-paint fallback when the exact filter key has no cache yet.
 */
export function getMostRecentCachedApplicationsList(): unknown | undefined {
  const now = Date.now();
  let freshest: CacheEntry | undefined;

  for (const entry of cache.values()) {
    if (now - entry.at > TTL_MS) continue;
    if (!freshest || entry.at > freshest.at) {
      freshest = entry;
    }
  }

  if (typeof sessionStorage !== "undefined") {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (!key || !key.startsWith(SESSION_STORAGE_PREFIX)) continue;
        const raw = sessionStorage.getItem(key);
        if (!raw) continue;
        const entry = JSON.parse(raw) as CacheEntry;
        if (!entry || typeof entry.at !== "number") continue;
        if (now - entry.at > TTL_MS) continue;
        if (!freshest || entry.at > freshest.at) {
          freshest = entry;
        }
      }
    } catch {
      /* ignore malformed or unavailable session storage */
    }
  }

  return freshest?.data;
}

export function setCachedApplicationsList(key: string, data: unknown) {
  const entry: CacheEntry = { at: Date.now(), data };
  cache.set(key, entry);
  writeSessionEntry(key, entry);
  pruneIfNeeded();
}

export function invalidateApplicationsListCache() {
  cache.clear();
  if (typeof sessionStorage === "undefined") return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(SESSION_STORAGE_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** Warm cache for deal-pipeline links (hover). Ignores errors. */
export function prefetchApplicationsList(
  params: GetApplicationsParams = {},
): void {
  const key = applicationsListParamsCacheKey(params);
  const existing = cache.get(key);
  if (existing && Date.now() - existing.at < TTL_MS) return;
  const url = buildApplicationsListUrl(params);
  void axiosGet(url)
    .then((res) => {
      setCachedApplicationsList(key, res.data);
    })
    .catch(() => {
      /* prefetch only */
    });
}
