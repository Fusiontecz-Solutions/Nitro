import type { Application, GetApplicationsParams } from "@/types/applicationTypes";
import { axiosGet } from "@/redux/axios";
import { routeParamMatchesApplication } from "@/lib/applicationRouteMatch";
import { writeApplicationDetailCache } from "@/lib/applicationDetailCache";
import {
  CRM_CACHE_NS,
  crmCacheClearNamespace,
  crmCacheGet,
  crmCacheGetFreshest,
  crmCacheSet,
  memoryEntriesForNamespace,
} from "@/lib/crmCache";
import { invalidateApplicationsListQueries } from "@/lib/applicationsListQuerySync";

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

const NS = CRM_CACHE_NS.APPLICATIONS_LIST;

export function getCachedApplicationsList(
  key: string,
): unknown | undefined {
  return crmCacheGet<unknown>(NS, key);
}

/**
 * Returns the freshest non-expired cached list across all keys.
 * Useful as a first-paint fallback when the exact filter key has no cache yet.
 */
export function getMostRecentCachedApplicationsList(): unknown | undefined {
  return crmCacheGetFreshest<unknown>(NS);
}

/** Rows from any cached list API payload (`{ data: [] }` or merged fetch-all). */
export function extractApplicationsFromListPayload(
  payload: unknown,
): Application[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as { data?: unknown };
  if (!Array.isArray(body.data)) return [];
  return body.data.filter(
    (row): row is Application =>
      row != null &&
      typeof row === "object" &&
      (Boolean((row as Application)._id) ||
        Boolean((row as Application & { id?: string }).id) ||
        (row as Application).applicationId != null),
  );
}

/** Mirror list rows into per-application detail cache (L1 + IndexedDB). */
function syncDetailCacheFromListPayload(payload: unknown) {
  for (const app of extractApplicationsFromListPayload(payload)) {
    writeApplicationDetailCache(app);
  }
}

/**
 * Find an application row in any non-expired cached list response.
 * Used to open Application Details without a second GET when the list already loaded the row.
 */
export function findApplicationInListCache(
  routeParam: string,
): Application | undefined {
  const key = String(routeParam).trim();
  if (!key) return undefined;

  const rows = memoryEntriesForNamespace(NS);
  rows.sort((a, b) => b.entry.at - a.entry.at);

  for (const { entry } of rows) {
    for (const app of extractApplicationsFromListPayload(entry.data)) {
      if (routeParamMatchesApplication(key, app)) {
        return app;
      }
    }
  }
  return undefined;
}

export function setCachedApplicationsList(key: string, data: unknown) {
  crmCacheSet(NS, key, data);
  syncDetailCacheFromListPayload(data);
}

/** After IndexedDB bootstrap, seed per-app detail keys from cached list blobs. */
export function hydrateApplicationDetailCacheFromCachedLists() {
  for (const { entry } of memoryEntriesForNamespace(NS)) {
    syncDetailCacheFromListPayload(entry.data);
  }
}

export function invalidateApplicationsListCache() {
  crmCacheClearNamespace(NS);
  invalidateApplicationsListQueries();
}

/** Warm cache for deal-pipeline links (hover). Ignores errors. */
export function prefetchApplicationsList(
  params: GetApplicationsParams = {},
): void {
  const key = applicationsListParamsCacheKey(params);
  if (getCachedApplicationsList(key) !== undefined) return;
  const url = buildApplicationsListUrl(params);
  void axiosGet(url)
    .then((res) => {
      setCachedApplicationsList(key, res.data);
    })
    .catch(() => {
      /* prefetch only */
    });
}
