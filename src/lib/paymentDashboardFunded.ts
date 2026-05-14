import { DASHBOARD_APPLICATION_STATS_BUCKET } from "@/constants/dashboardApplicationsNavigation";
import { APPLICATIONS_TABLE_CLIENT_FETCH_LIMIT } from "@/lib/applicationTableSearch";
import { APPLICATIONS_LIST_DEFAULT_SORT } from "@/lib/applicationsListParams";
import type { Application, GetApplicationsParams } from "@/types/applicationTypes";

/** Matches backend funded cohort for payment dashboard lists. */
export function isFundedApplication(app: Application): boolean {
  const q = normalizeStatus(app.currentQueue || app.queue || "");
  if (q === "funded" || q === "disbursement" || q === "disbursment") return true;
  return false;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Funded deals need `termsOffers` + OfferDecision for payback math — not available on `lite` lists.
 * Same page size cap as Applications client search; extended timeout for heavier includes.
 */
export function paymentFundedDealsListParams(): GetApplicationsParams {
  return {
    page: 1,
    limit: APPLICATIONS_TABLE_CLIENT_FETCH_LIMIT,
    ...APPLICATIONS_LIST_DEFAULT_SORT,
    statsBucket: DASHBOARD_APPLICATION_STATS_BUCKET.FUNDED,
    skipListCacheRead: true,
    skipListCache: true,
    requestTimeoutMs: 120_000,
    fetchAllPages: true,
  };
}
