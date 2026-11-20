import type { AxiosRequestConfig, AxiosResponse } from "axios";

const GET_CACHE_TTL_MS = 90_000;
const MAX_ENTRIES = 80;

/**
 * Endpoints that must always hit the network (OAuth, binary, live signing) plus
 * the live count feeds. Stat cards, queue totals and the sidebar badges are
 * refetched precisely when something changed, so serving them from this cache
 * only reintroduced the staleness the refetch was meant to clear.
 */
const SKIP_URL_RE =
  /\/docusign\/(callback|sender-view|signnow-review-status|signnow-invite-status)|\/uploads\/|\/public\/|\/auth\/(login|logout|verify)|\/applications\/(stats|operations-dashboard-summary|operations-dashboard-recent-cases)/i;

type CachedGetEntry = {
  at: number;
  data: unknown;
  status: number;
  statusText: string;
  headers: AxiosResponse["headers"];
};

const memory = new Map<string, CachedGetEntry>();
const inFlight = new Map<string, Promise<AxiosResponse>>();

declare module "axios" {
  export interface AxiosRequestConfig {
    /** Skip the short-lived GET response cache (in-flight dedupe still applies). */
    skipCache?: boolean;
  }
}

function pruneIfNeeded() {
  while (memory.size > MAX_ENTRIES) {
    const first = memory.keys().next().value;
    if (first === undefined) break;
    memory.delete(first);
  }
}

export function httpGetCacheKey(url: string, config?: AxiosRequestConfig): string {
  const method = String(config?.method || "get").toLowerCase();
  const params = config?.params ? JSON.stringify(config.params) : "";
  let authTag = "";
  try {
    const token =
      localStorage.getItem("token") || sessionStorage.getItem("token") || "";
    authTag = token.slice(-12);
  } catch {
    authTag = "";
  }
  return `${method}:${url}?${params}|${authTag}`;
}

export function shouldUseGetResponseCache(
  url: string,
  config?: AxiosRequestConfig,
): boolean {
  if (config?.skipCache) return false;
  const method = String(config?.method || "get").toLowerCase();
  if (method !== "get") return false;
  if (config?.responseType && config.responseType !== "json") return false;
  if (SKIP_URL_RE.test(url)) return false;
  return true;
}

export function readCachedGetResponse(key: string): CachedGetEntry | undefined {
  const entry = memory.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > GET_CACHE_TTL_MS) {
    memory.delete(key);
    return undefined;
  }
  return entry;
}

export function writeCachedGetResponse(
  key: string,
  response: AxiosResponse,
): void {
  memory.set(key, {
    at: Date.now(),
    data: response.data,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  pruneIfNeeded();
}

export function toCachedAxiosResponse(
  entry: CachedGetEntry,
  config?: AxiosRequestConfig,
): AxiosResponse {
  return {
    data: entry.data,
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
    config: (config ?? {}) as AxiosResponse["config"],
  } as AxiosResponse;
}

export function getInFlightGet(
  key: string,
): Promise<AxiosResponse> | undefined {
  return inFlight.get(key);
}

export function setInFlightGet(
  key: string,
  promise: Promise<AxiosResponse>,
): void {
  inFlight.set(key, promise);
}

export function clearInFlightGet(key: string): void {
  inFlight.delete(key);
}

/** Drop all GET responses — call on logout. */
export function clearHttpGetCache(): void {
  memory.clear();
}

/** Drop cached GETs whose key mentions this resource path segment. */
export function invalidateHttpGetCacheForResource(resource: string): void {
  const needle = String(resource || "").replace(/^\//, "").split("/")[0];
  if (!needle) return;
  for (const key of [...memory.keys()]) {
    if (key.includes(needle)) memory.delete(key);
  }
}

/**
 * Drop cached GETs for one record of a resource, e.g. ("applications", id) drops
 * `/applications/<id>` and its sub-resources but leaves list pages cached.
 */
export function invalidateHttpGetCacheForRecord(resource: string, id: string | number): void {
  const root = String(resource || "").replace(/^\/|\/$/g, "");
  const rid = String(id ?? "").trim();
  if (!root || !rid) return;
  const needle = `/${root}/${rid}`;
  for (const key of [...memory.keys()]) {
    if (!key.includes(needle)) continue;
    const next = key.charAt(key.indexOf(needle) + needle.length);
    // Avoid /applications/12 matching /applications/123.
    if (next === "" || next === "/" || next === "?" || next === "&") memory.delete(key);
  }
}

/** Drop the cached GET for exactly this URL (any params / auth tag). */
export function invalidateHttpGetCacheForUrl(url: string): void {
  const prefix = `get:${String(url || "")}?`;
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
}

/** Drop cached GETs for the mutated resource family only. */
export function invalidateHttpGetCacheByUrl(url: string): void {
  const path = String(url || "").split("?")[0].replace(/^\//, "");
  if (!path) return;
  const family = path.split("/").slice(0, 2).join("/");
  const related = new Set<string>([path, family].filter(Boolean));
  if (family.includes("clients") || path.includes("/clients")) {
    related.add("applications");
    related.add("clients");
  }
  if (family.includes("applications") || path.includes("/applications")) {
    related.add("clients");
    related.add("applications");
  }
  /**
   * Every contract read (`get_contract_by_application`, `get_contract_by_id`,
   * `:id/document-template-mappings`) shares the `/contract/` prefix, but a save
   * goes to `contract/update_contract/:id`, whose family names none of them. So
   * for 90s after an Info Required / addendum save, the refresh that runs when
   * the user comes back from the SignNow tab, and the Review rebuild, read the
   * contract as it was BEFORE the save — and the next save wrote that stale
   * per-addendum blob back over the real one. SignNow sends (`docusign/…`)
   * write the contract row server-side too (send package, wire-fee choice,
   * history), so they clear it as well.
   */
  if (/^(contract|docusign)\//.test(path)) {
    related.add(":/contract/");
  }
  for (const key of [...memory.keys()]) {
    if ([...related].some((part) => key.includes(part))) {
      memory.delete(key);
    }
  }
}
