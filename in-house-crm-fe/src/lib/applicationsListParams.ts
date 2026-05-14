import {
  normalizeOperationsDashboardStatusParam,
  OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
} from "@/constants/operationsDashboardApplications";
import { APPLICATIONS_TABLE_CLIENT_FETCH_LIMIT } from "@/lib/applicationTableSearch";
import type { GetApplicationsParams } from "@/types/applicationTypes";

/**
 * Pipeline dropdown values that must use `operationsStatus` (not a single `currentQueue`
 * equality), so lists match mixed queue/state rows for the signed-contract stage.
 */
const PIPELINE_STATUS_USES_OPERATIONS_STATUS = new Set([
  "Signed_Contracts",
  "Contract_Signed",
]);

/** Maps `/applications` pipeline filter selection to GET /applications query fields. */
export function pipelineStatusFilterToApiFields(
  statusFilter: string,
): Pick<GetApplicationsParams, "currentQueue" | "operationsStatus"> {
  if (statusFilter === "all") return {};
  if (PIPELINE_STATUS_USES_OPERATIONS_STATUS.has(statusFilter)) {
    return { operationsStatus: statusFilter };
  }
  return { currentQueue: statusFilter };
}

export const DEFAULT_APPLICATIONS_PAGE_SIZE = 10;

/** Default ordering for the main applications table (newest first). */
export const APPLICATIONS_LIST_DEFAULT_SORT: Pick<
  GetApplicationsParams,
  "sortBy" | "sortOrder"
> = {
  sortBy: "createdAt",
  sortOrder: "desc",
};

/** URL → list filters (operations dashboard drill-down). */
export function parseApplicationsListRouteFilters(search: string): {
  dashboardStateFilter: string;
  statusFilter: string;
} {
  const query = new URLSearchParams(search);
  const operationsStatusFromQuery =
    query.get("operationsStatus") || query.get("currentState");
  const fromDashboard = query.get("fromDashboard");
  if (fromDashboard === "operations" && operationsStatusFromQuery) {
    const normalized =
      normalizeOperationsDashboardStatusParam(operationsStatusFromQuery) ??
      operationsStatusFromQuery.trim();
    return { dashboardStateFilter: normalized, statusFilter: "all" };
  }
  return { dashboardStateFilter: "", statusFilter: "all" };
}

/** Same rules as `Applications` / `getApplications` list (operations vs queue dropdown). */
export function buildApplicationsListParams(options: {
  pageIndex: number;
  pageSize: number;
  searchTerm: string;
  dashboardStateFilter: string;
  statusFilter: string;
  /** UNDERWRITER: server-side pool / my-claimed (Underwriter queue only). Overrides queue dropdown. */
  underwriterClaim?: "unclaimed" | "mine";
}): GetApplicationsParams {
  const params: GetApplicationsParams = {
    page: options.pageIndex + 1,
    limit: options.pageSize,
    ...APPLICATIONS_LIST_DEFAULT_SORT,
    lite: true,
  };
  if (options.searchTerm) {
    params.search = options.searchTerm;
  }
  if (options.underwriterClaim) {
    params.underwriterClaim = options.underwriterClaim;
    return params;
  }
  if (options.dashboardStateFilter) {
    const isAllPipeline =
      options.dashboardStateFilter === OPERATIONS_APPLICATIONS_LIST_ALL_QUERY ||
      options.dashboardStateFilter.toLowerCase() === "all";
    if (!isAllPipeline) {
      params.operationsStatus = options.dashboardStateFilter;
    }
    return params;
  }
  if (options.statusFilter !== "all") {
    Object.assign(params, pipelineStatusFilterToApiFields(options.statusFilter));
  }
  return params;
}

/** First-page request for the current URL (route loader + cache key). */
export function buildInitialApplicationsListParamsFromSearch(
  urlSearch: string,
): GetApplicationsParams {
  const { dashboardStateFilter, statusFilter } =
    parseApplicationsListRouteFilters(urlSearch);
  return buildApplicationsListParams({
    pageIndex: 0,
    pageSize: APPLICATIONS_TABLE_CLIENT_FETCH_LIMIT,
    searchTerm: "",
    dashboardStateFilter,
    statusFilter,
  });
}
