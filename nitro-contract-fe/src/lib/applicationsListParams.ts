import {
  normalizeOperationsDashboardStatusParam,
  OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
} from "@/constants/operationsDashboardApplications";
import { normalizeUnderwriterPipelineParam } from "@/constants/underwriterPipeline";
import type { GetApplicationsParams } from "@/types/applicationTypes";
import type { SortingState } from "@tanstack/react-table";

/** API `sortBy` values supported by `GET /applications`. */
export type ApplicationsListSortField = "createdAt" | "applicationId" | "updatedAt";

const TABLE_SORT_TO_API: Record<string, ApplicationsListSortField> = {
  createdAt: "createdAt",
  applicationId: "applicationId",
  dealId: "applicationId",
  updatedAt: "updatedAt",
  lastModifiedAt: "updatedAt",
};

/** Map TanStack column sort → backend query (defaults to newest first). */
export function applicationsListSortFromTable(
  sorting: SortingState,
): Pick<GetApplicationsParams, "sortBy" | "sortOrder"> {
  const rule = sorting[0];
  if (!rule) return { ...APPLICATIONS_LIST_DEFAULT_SORT };
  const sortBy = TABLE_SORT_TO_API[rule.id];
  if (!sortBy) return { ...APPLICATIONS_LIST_DEFAULT_SORT };
  return {
    sortBy,
    sortOrder: rule.desc ? "desc" : "asc",
  };
}

/**
 * Pipeline dropdown values that must use `operationsStatus` (not a single `currentQueue`
 * equality), so contract-stage lists match mixed queue/state rows reliably.
 */
const PIPELINE_STATUS_USES_OPERATIONS_STATUS = new Set([
  "Contract_Pending",
  "Contract_Generated",
  "Contract_Sent",
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

/** URL → underwriter sidebar pipeline (`/applications?underwriterPipeline=`). */
export function parseUnderwriterPipelineFromSearch(
  search: string,
): ReturnType<typeof normalizeUnderwriterPipelineParam> {
  const raw = new URLSearchParams(search).get("underwriterPipeline");
  return normalizeUnderwriterPipelineParam(raw);
}

/** URL → scrubber / underwriter deal-pool tab (`/applications?underwriterClaim=`). */
export type UnderwriterClaimParam = "unclaimed" | "claimed" | "mine";

export type ScrubberPoolTab = "queue" | "claimed" | "my";

export function parseUnderwriterClaimFromSearch(
  search: string,
): UnderwriterClaimParam | undefined {
  const raw = new URLSearchParams(search)
    .get("underwriterClaim")
    ?.trim()
    .toLowerCase();
  if (raw === "unclaimed" || raw === "claimed" || raw === "mine") return raw;
  return undefined;
}

export function poolTabFromUnderwriterClaim(
  claim: UnderwriterClaimParam | undefined,
): ScrubberPoolTab {
  if (claim === "claimed") return "claimed";
  if (claim === "mine") return "my";
  return "queue";
}

export function underwriterClaimFromPoolTab(
  tab: ScrubberPoolTab,
  roleKey: string,
): UnderwriterClaimParam {
  const normalizedRole = roleKey.toUpperCase().replace(/-/g, "_");
  if (normalizedRole === "SCRUBBING") {
    if (tab === "claimed") return "claimed";
    if (tab === "my") return "mine";
    return "unclaimed";
  }
  return tab === "my" ? "mine" : "unclaimed";
}

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
  /** SCRUBBING / UNDERWRITER: narrow list to pool vs claimed vs my deals. */
  underwriterClaim?: UnderwriterClaimParam;
  /** UNDERWRITER: sidebar pipeline drill-down scoped to the logged-in underwriter. */
  underwriterPipeline?: string;
  /** CONTRACTS_LOG / OPERATIONS: scrubbing-stage claim user id. */
  scrubberFilter?: string;
  /** CONTRACTS_LOG / OPERATIONS: assigned underwriter user id. */
  underwriterFilter?: string;
  statsBucket?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /**
   * When true (operations sidebar: `fromDashboard=operations`), `dashboardStateFilter`
   * drives `operationsStatus`. When false, the pipeline dropdown (`statusFilter`) wins.
   */
  useDashboardStageFilter?: boolean;
}): GetApplicationsParams {
  const params: GetApplicationsParams = {
    page: options.pageIndex + 1,
    limit: options.pageSize,
    sortBy: options.sortBy ?? APPLICATIONS_LIST_DEFAULT_SORT.sortBy,
    sortOrder: options.sortOrder ?? APPLICATIONS_LIST_DEFAULT_SORT.sortOrder,
    lite: true,
  };
  if (options.statsBucket) {
    params.statsBucket = options.statsBucket;
  }
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
  if (options.scrubberFilter && options.scrubberFilter !== "all") {
    params.claimedByUnderwriterId = options.scrubberFilter;
  }
  if (options.underwriterFilter && options.underwriterFilter !== "all") {
    params.assignedUnderwriterId = options.underwriterFilter;
  }
  if (options.statsBucket) {
    return params;
  }
  if (options.underwriterPipeline) {
    params.underwriterPipeline = options.underwriterPipeline;
    return params;
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
  const { dashboardStateFilter, statusFilter } =
    parseApplicationsListRouteFilters(urlSearch);
  return buildApplicationsListParams({
    pageIndex: 0,
    pageSize: DEFAULT_APPLICATIONS_PAGE_SIZE,
    searchTerm: "",
    dashboardStateFilter,
    statusFilter,
  });
}
