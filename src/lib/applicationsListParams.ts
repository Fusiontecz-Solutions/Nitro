import {
  normalizeOperationsDashboardStatusParam,
  OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
} from "@/constants/operationsDashboardApplications";
import { normalizeUnderwriterPipelineParam } from "@/constants/underwriterPipeline";
import type { GetApplicationsParams } from "@/types/applicationTypes";
import type { SortingState } from "@tanstack/react-table";

/** Legacy pipeline dropdown labels → `operationsStatus` API keys. */
const PIPELINE_STATUS_LEGACY_TO_OPERATIONS: Record<string, string> = {
  "Contract Generated": "Contract_Generated",
  "Contract Sent": "Contract_Sent",
  "Contract Cancelled": "Contract_Cancelled",
  "Funding call": "Funding Call",
  Disbursement: "Disbursment",
  Contract_Signed: "Contract_Signed",
  Signed_Contracts: "Signed_Contracts",
};

/** Maps `/applications` pipeline filter selection to GET /applications query fields. */
export function pipelineStatusFilterToApiFields(
  statusFilter: string,
): Pick<GetApplicationsParams, "currentQueue" | "operationsStatus"> {
  if (statusFilter === "all") return {};
  const operationsStatus =
    PIPELINE_STATUS_LEGACY_TO_OPERATIONS[statusFilter] ?? statusFilter;
  return { operationsStatus };
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

/** URL → underwriter deal-pool tab (`/applications?underwriterClaim=`). */
export function parseUnderwriterClaimFromSearch(
  search: string,
): "unclaimed" | "mine" | undefined {
  const raw = new URLSearchParams(search).get("underwriterClaim")?.trim().toLowerCase();
  if (raw === "unclaimed" || raw === "mine") return raw;
  return undefined;
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
    /** SCRUBBING / UNDERWRITER: narrow list to pool vs my claimed deals. Overrides queue dropdown. */
    underwriterClaim?: "unclaimed" | "mine";
    /** UNDERWRITER: sidebar pipeline drill-down scoped to the logged-in underwriter. */
    underwriterPipeline?: string;
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

const TABLE_COLUMN_TO_API_SORT: Record<string, string> = {
  dealId: "dealId",
  businessName: "businessName",
  createdAt: "createdAt",
  lastModifiedAt: "lastModifiedAt",
  status: "status",
};

/** Map TanStack table sorting state to GET /applications `sortBy` / `sortOrder`. */
export function applicationsListSortFromTable(
  sorting: SortingState,
): Pick<GetApplicationsParams, "sortBy" | "sortOrder"> {
  const active = sorting[0];
  if (!active?.id) return {};
  const sortBy = TABLE_COLUMN_TO_API_SORT[active.id];
  if (!sortBy) return {};
  return {
    sortBy,
    sortOrder: active.desc ? "desc" : "asc",
  };
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
  const underwriterClaim = parseUnderwriterClaimFromSearch(urlSearch);
  const underwriterPipeline = parseUnderwriterPipelineFromSearch(urlSearch);
  return buildApplicationsListParams({
    pageIndex: 0,
    pageSize: DEFAULT_APPLICATIONS_PAGE_SIZE,
    searchTerm: "",
    dashboardStateFilter,
    statusFilter,
    underwriterClaim,
    underwriterPipeline,
    useDashboardStageFilter,
  });
}
