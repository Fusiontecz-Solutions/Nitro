import { DASHBOARD_APPLICATION_STATS_BUCKET } from "@/constants/dashboardApplicationsNavigation";
import { DEFAULT_APPLICATIONS_PAGE_SIZE } from "@/lib/applicationsListParams";
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
 * Server-paginated funded cohort for the payment dashboard table (no `fetchAllPages`).
 * Full application payload is required for payback math — not `lite`.
 */
export function buildPaymentFundedCohortParams(options: {
  pageIndex?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
} = {}): GetApplicationsParams {
  const params: GetApplicationsParams = {
    page: (options.pageIndex ?? 0) + 1,
    limit: options.pageSize ?? DEFAULT_APPLICATIONS_PAGE_SIZE,
    sortBy: options.sortBy ?? "createdAt",
    sortOrder: options.sortOrder ?? "desc",
    statsBucket: DASHBOARD_APPLICATION_STATS_BUCKET.FUNDED,
    skipListCacheRead: true,
    skipListCache: true,
    requestTimeoutMs: 120_000,
  };
  const q = options.search?.trim();
  if (q) params.search = q;
  return params;
}

/** @deprecated Use `buildPaymentFundedCohortParams` with explicit page/limit. */
export function paymentFundedDealsListParams(): GetApplicationsParams {
  return buildPaymentFundedCohortParams({
    pageIndex: 0,
    pageSize: DEFAULT_APPLICATIONS_PAGE_SIZE,
  });
}
