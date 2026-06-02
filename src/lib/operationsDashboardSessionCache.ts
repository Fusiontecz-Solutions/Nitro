import { jwtDecode } from "jwt-decode";
import type { OperationsDashboardRecentCase } from "@/redux/actions/operationsDashboardActions";
import { CRM_CACHE_NS, crmCacheClearNamespace, crmCacheGet, crmCacheSet } from "@/lib/crmCache";

const NS = CRM_CACHE_NS.OPS_DASHBOARD;
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type StoredBlob = {
  v: 1;
  userId: string;
  savedAt: number;
  summaryCounts: {
    totalCases: number;
    contractPending: number;
    contractsOut: number;
    signedContracts: number;
    fundingCall: number;
    disbursment: number;
    funded: number;
  };
  caseStageCounts: Record<string, number>;
  operationsMetricsMode: string | null;
  /** Present on blobs written after this field was added; older caches infer from list length. */
  hasLoadedRecentOnce?: boolean;
  recentCases: OperationsDashboardRecentCase[];
};

function getTokenUserId(): string {
  if (typeof window === "undefined") return "";
  try {
    const token = localStorage.getItem("token");
    if (!token) return "";
    const decoded = jwtDecode<{ id?: string }>(token);
    return decoded?.id ? String(decoded.id) : "";
  } catch {
    return "";
  }
}

function normalizeRecentCase(
  row: OperationsDashboardRecentCase,
): OperationsDashboardRecentCase {
  return {
    ...row,
    applicationMongoId: row.applicationMongoId ?? "",
    clientLookupId:
      row.clientLookupId != null && String(row.clientLookupId).trim()
        ? String(row.clientLookupId).trim()
        : null,
  };
}

export type OperationsDashboardHydration = {
  summaryCounts: StoredBlob["summaryCounts"];
  caseStageCounts: Record<string, number>;
  operationsMetricsMode: string | null;
  hasLoadedSummaryOnce: boolean;
  lastSummaryFetchedAt: null;
  hasLoadedRecentOnce: boolean;
  lastRecentFetchedAt: null;
  recentCases: OperationsDashboardRecentCase[];
};

/**
 * Read last persisted ops dashboard payload for the current JWT user.
 * Timestamps are cleared so thunks still refetch in the background.
 */
export function readOperationsDashboardSession(): OperationsDashboardHydration | null {
  if (typeof window === "undefined") return null;
  const userId = getTokenUserId();
  if (!userId) return null;
  try {
    const parsed = crmCacheGet<StoredBlob>(NS, userId);
    if (!parsed || parsed.v !== 1 || parsed.userId !== userId) return null;
    if (
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > MAX_CACHE_AGE_MS
    ) {
      crmCacheClearNamespace(NS);
      return null;
    }
    if (!parsed.summaryCounts || !parsed.caseStageCounts) return null;

    const recentCases = Array.isArray(parsed.recentCases)
      ? parsed.recentCases.map((r) => normalizeRecentCase(r))
      : [];

    const hasLoadedRecentOnce =
      typeof parsed.hasLoadedRecentOnce === "boolean"
        ? parsed.hasLoadedRecentOnce
        : recentCases.length > 0;

    return {
      summaryCounts: { ...parsed.summaryCounts },
      caseStageCounts: { ...parsed.caseStageCounts },
      operationsMetricsMode:
        typeof parsed.operationsMetricsMode === "string"
          ? parsed.operationsMetricsMode
          : null,
      hasLoadedSummaryOnce: true,
      lastSummaryFetchedAt: null,
      hasLoadedRecentOnce,
      lastRecentFetchedAt: null,
      recentCases,
    };
  } catch {
    return null;
  }
}

export function persistOperationsDashboardSession(payload: {
  userId: string;
  summaryCounts: StoredBlob["summaryCounts"];
  caseStageCounts: Record<string, number>;
  operationsMetricsMode: string | null;
  hasLoadedRecentOnce: boolean;
  recentCases: OperationsDashboardRecentCase[];
}): void {
  if (typeof window === "undefined") return;
  try {
    const blob: StoredBlob = {
      v: 1,
      userId: payload.userId,
      savedAt: Date.now(),
      summaryCounts: { ...payload.summaryCounts },
      caseStageCounts: { ...payload.caseStageCounts },
      operationsMetricsMode: payload.operationsMetricsMode,
      hasLoadedRecentOnce: payload.hasLoadedRecentOnce,
      recentCases: payload.recentCases.map((r) => normalizeRecentCase(r)),
    };
    crmCacheSet(NS, payload.userId, blob);
  } catch {
    /* quota / private mode */
  }
}

export function clearOperationsDashboardSession(): void {
  crmCacheClearNamespace(NS);
}

export { getTokenUserId };
