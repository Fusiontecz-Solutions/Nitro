import {
  normalizeOperationsDashboardStatusParam,
  OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
} from "@/constants/operationsDashboardApplications";
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

/** Application `type` field — matches create form + operations bypass intake. */
export const APPLICATION_TYPE_FILTER_OPTIONS = [
  { label: "New Application", value: "New" },
  { label: "Renewal", value: "Renewal" },
  { label: "Modification", value: "Modification" },
  { label: "Bypass", value: "Bypass" },
] as const;

export function applicationTypeFilterLabel(typeFilter: string): string {
  if (typeFilter === "all") return "All types";
  const match = APPLICATION_TYPE_FILTER_OPTIONS.find((o) => o.value === typeFilter);
  return match?.label ?? typeFilter;
}

/** Application `priority` field — matches create form options. */
export const APPLICATION_PRIORITY_FILTER_OPTIONS = [
  { label: "Low", value: "Low" },
  { label: "Medium", value: "Medium" },
  { label: "High", value: "High" },
  { label: "Urgent", value: "Urgent" },
] as const;

export function applicationPriorityFilterLabel(priorityFilter: string): string {
  if (priorityFilter === "all") return "All priorities";
  const match = APPLICATION_PRIORITY_FILTER_OPTIONS.find(
    (o) => o.value === priorityFilter,
  );
  return match?.label ?? priorityFilter;
}

/** Auto-tagged organization for imported deals. */
export const APPLICATION_ORGANIZATION_FILTER_OPTIONS = [
  { label: "Katan 2", value: "Katan II" },
  { label: "Katan 3", value: "Katan III" },
] as const;

export function applicationOrganizationFilterLabel(
  organizationFilter: string,
): string {
  if (organizationFilter === "all") return "All organizations";
  const match = APPLICATION_ORGANIZATION_FILTER_OPTIONS.find(
    (o) => o.value === organizationFilter,
  );
  return match?.label ?? organizationFilter;
}

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
  /** `all` or application type value (New, Renewal, …). */
  typeFilter?: string;
  /** `all` or priority value (Low, Medium, High, Urgent). */
  priorityFilter?: string;
  /** `all` or organization value (Katan II, Katan III). */
  organizationFilter?: string;
  /** UNDERWRITER: server-side pool / my-claimed (Underwriter queue only). Overrides queue dropdown. */
  underwriterClaim?: "unclaimed" | "mine";
  /**
   * When true (operations sidebar: `fromDashboard=operations`), `dashboardStateFilter`
   * drives `operationsStatus`. When false, the pipeline dropdown (`statusFilter`) wins.
   */
  useDashboardStageFilter?: boolean;
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
  if (options.typeFilter && options.typeFilter !== "all") {
    params.type = options.typeFilter;
  }
  if (options.priorityFilter && options.priorityFilter !== "all") {
    params.priority = options.priorityFilter;
  }
  if (options.organizationFilter && options.organizationFilter !== "all") {
    params.organization = options.organizationFilter;
  }
  if (options.underwriterClaim) {
    params.underwriterClaim = options.underwriterClaim;
    return params;
  }

  if (options.useDashboardStageFilter && options.dashboardStateFilter) {
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
    return params;
  }

  if (options.dashboardStateFilter) {
    const isAllPipeline =
      options.dashboardStateFilter === OPERATIONS_APPLICATIONS_LIST_ALL_QUERY ||
      options.dashboardStateFilter.toLowerCase() === "all";
    if (!isAllPipeline) {
      params.operationsStatus = options.dashboardStateFilter;
    }
  }
  return params;
}

/** First-page request for the current URL (route loader + cache key). */
export function buildInitialApplicationsListParamsFromSearch(
  urlSearch: string,
): GetApplicationsParams {
  const query = new URLSearchParams(urlSearch);
  const { dashboardStateFilter, statusFilter } =
    parseApplicationsListRouteFilters(urlSearch);
  const useDashboardStageFilter =
    query.get("fromDashboard") === "operations";
  return buildApplicationsListParams({
    pageIndex: 0,
    pageSize: DEFAULT_APPLICATIONS_PAGE_SIZE,
    searchTerm: "",
    dashboardStateFilter,
    statusFilter,
    useDashboardStageFilter,
  });
}
