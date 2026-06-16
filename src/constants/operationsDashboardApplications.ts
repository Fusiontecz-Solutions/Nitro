/**
 * URL/query value when no operations stage filter is applied
 * (`/applications?fromDashboard=operations&operationsStatus=all`). The list API is called without `operationsStatus`.
 */
export const OPERATIONS_APPLICATIONS_LIST_ALL_QUERY = "all";

/** Backend `operationsStatus` values used by Operations dashboard stat cards and `/applications` filtering. */
export const OPERATIONS_DASHBOARD_APPLICATION_STATUSES = [
  "Contract_Pending",
  "Contract_Generated",
  "Contract_Sent",
  "Contract_Cancelled",
  "Contract_Out",
  "Contracted",
  "Contract_Signed",
  "Signed_Contracts",
  "Funding Call",
  "Finals_And_Funding_Call",
  "Disbursment",
  "Funded",
  "Declined",
] as const;

export type OperationsDashboardApplicationStatus =
  (typeof OPERATIONS_DASHBOARD_APPLICATION_STATUSES)[number];

/** Deal-pipeline queue stages (aligned with Deal Pipeline `/applications?operationsStatus=`). */
export const OPERATIONS_PIPELINE_QUEUE_STATUSES = [
  "Agent",
  "Underwriter",
  "Final Underwriter",
  "Final",
] as const;

export type OperationsPipelineQueueStatus =
  (typeof OPERATIONS_PIPELINE_QUEUE_STATUSES)[number];

/** All values valid for operations applications list + application-details depth rules. */
export const OPERATIONS_APPLICATIONS_LIST_STATUSES = [
  ...OPERATIONS_DASHBOARD_APPLICATION_STATUSES,
  ...OPERATIONS_PIPELINE_QUEUE_STATUSES,
] as const;

export type OperationsApplicationsListStatus =
  (typeof OPERATIONS_APPLICATIONS_LIST_STATUSES)[number];

const STATUS_LABELS: Record<OperationsApplicationsListStatus, string> = {
  Contract_Pending: "Contract Pending",
  Contract_Generated: "Contract Generated",
  Contract_Sent: "Contract Sent",
  Contract_Cancelled: "Contract Cancelled",
  Contract_Out: "Contract Sent",
  Contracted: "Contract",
  Contract_Signed: "Contract Signed",
  Signed_Contracts: "Signed Contracts",
  "Funding Call": "Funding Call",
  Finals_And_Funding_Call: "Finals and Funding Call",
  Disbursment: "Disbursement",
  Funded: "Funded",
  Declined: "Rejected",
  Agent: "Agent",
  Underwriter: "Underwriter",
  "Final Underwriter": "Final Underwriter",
  Final: "Final",
};

const ALLOWED = new Set<string>(OPERATIONS_APPLICATIONS_LIST_STATUSES);

/** Normalize query param (slug or mixed case) to API `operationsStatus`. */
export function normalizeOperationsDashboardStatusParam(
  raw: string | null,
): OperationsApplicationsListStatus | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (ALLOWED.has(trimmed)) {
    return trimmed as OperationsApplicationsListStatus;
  }
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, OperationsApplicationsListStatus> = {
    contract_pending: "Contract_Pending",
    contract_generated: "Contract_Generated",
    contract_sent: "Contract_Sent",
    contract_cancelled: "Contract_Cancelled",
    contract_out: "Contract_Sent",
    contracted: "Contracted",
    contracts_out: "Contract_Sent",
    contract_signed: "Contract_Signed",
    signed_contracts: "Contract_Signed",
    funding_call: "Funding Call",
    finals_and_funding_call: "Finals_And_Funding_Call",
    disbursment: "Disbursment",
    disbursement: "Disbursment",
    funded: "Funded",
    declined: "Declined",
    rejected: "Declined",
    agent: "Agent",
    underwriter: "Underwriter",
    final_underwriter: "Final Underwriter",
    final: "Final",
  };
  const mapped = map[key];
  return mapped ?? null;
}

/** Normalize queue/status strings for pipeline-stage inference (no spaces, lowercase). */
function normalizePipelineKey(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
}

/**
 * Maps loaded application workflow fields to an operations list status so
 * detail tabs match the deal stage (e.g. opening a row from Total Cases / “all”).
 */
export function inferOperationsListStatusFromApplication(
  currentQueue: string | null | undefined,
  options?: {
    explicitStatus?: string | null;
    currentState?: string | null;
  },
): OperationsApplicationsListStatus | null {
  const q = normalizePipelineKey(currentQueue);
  const st = normalizePipelineKey(options?.explicitStatus);
  const state = normalizePipelineKey(options?.currentState);

  if (q === "declined" || st === "declined" || state === "cancelled") {
    return "Declined";
  }
  if (st === "funded" || q === "funded") return "Funded";
  if (
    q === "disbursment" ||
    q === "disbursement" ||
    (q.length > 0 && q.includes("disburs"))
  ) {
    return "Disbursment";
  }
  if (
    state === "fundingcall" ||
    q === "fundingcall" ||
    (q.includes("funding") && q.includes("call"))
  ) {
    return "Funding Call";
  }
  if (
    (state === "final" && !state.includes("underwriter")) ||
    (q === "final" && !q.includes("underwriter"))
  ) {
    return "Final";
  }
  if (q === "finalunderwriter" || q === "finalreview") return "Final Underwriter";
  if (
    q === "underwriter" ||
    q === "underwriting" ||
    q === "review"
  ) {
    return "Underwriter";
  }
  if (q === "contractpending") {
    return "Contract_Pending";
  }
  if (q === "contractgenerated") {
    return "Contract_Generated";
  }
  if (q === "contractsent" || q === "contractout" || q === "contractsout") {
    return "Contract_Sent";
  }
  if (q === "contractcancelled") {
    return "Contract_Cancelled";
  }
  if (q === "contractsigned" || q === "signedcontracts") {
    return "Contract_Signed";
  }
  if (state === "signedcontracts" || state === "signed_contracts") {
    return "Contract_Signed";
  }
  if (q === "approved" && (state === "approved" || st === "approved")) {
    return "Contract_Pending";
  }
  if (q === "contracted" || st === "contracted") {
    return "Contracted";
  }
  if (q === "new" || q === "agent" || q === "draft") return "Agent";
  if (state === "completed" && st === "approved") return "Funded";

  return null;
}

/** Operations list filters that combine multiple stages — table rows show each deal's actual status. */
export const OPERATIONS_DASHBOARD_PER_ROW_STATUS_FILTERS = new Set<
  OperationsApplicationsListStatus
>(["Contracted", "Finals_And_Funding_Call"]);

export function normalizeFundingCallStatus(
  value: string | null | undefined,
): string {
  return String(value ?? "")
    .trim()
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
}

/** Latest persisted funding call status is "Call Done" (case / spacing insensitive). */
export function isFundingCallStatusCallDone(
  value: string | null | undefined,
): boolean {
  return normalizeFundingCallStatus(value) === "calldone";
}

/** Latest persisted funding call status is "Rejected" (case / spacing insensitive). */
export function isFundingCallStatusRejected(
  value: string | null | undefined,
): boolean {
  return normalizeFundingCallStatus(value) === "rejected";
}

/**
 * Whether the Disbursement tab may be opened for Operations / Super Admin.
 * Unlocks when there is a latest Funding Call selection that is NOT "Rejected",
 * or when the deal is already in Disbursement / Funded.
 */
export function canOpenDisbursementTab(
  currentQueue: string | null | undefined,
  options?: {
    explicitStatus?: string | null;
    currentState?: string | null;
    latestFundingCallStatus?: string | null;
  },
): boolean {
  const inferred = inferOperationsListStatusFromApplication(currentQueue, options);
  if (inferred === "Disbursment" || inferred === "Funded") {
    return true;
  }

  // If Operations explicitly rejected the deal in Funding Call, do not allow moving to Disbursement.
  if (isFundingCallStatusRejected(options?.latestFundingCallStatus)) {
    return false;
  }

  // If a Funding Call outcome exists and is not "Rejected", allow Disbursement.
  const latest = options?.latestFundingCallStatus;
  if (latest != null && String(latest).trim() !== "") {
    return true;
  }

  const st = normalizePipelineKey(options?.explicitStatus);
  const state = normalizePipelineKey(options?.currentState);

  if (st === "funded" || state === "funded") return true;
  if (
    st === "disbursment" ||
    st === "disbursement" ||
    state === "disbursment" ||
    state === "disbursement"
  ) {
    return true;
  }

  return false;
}

/** @deprecated Use {@link canOpenDisbursementTab} — kept for existing imports. */
export function isApplicationAtOrPastFundingCallForDisbursement(
  currentQueue: string | null | undefined,
  options?: {
    explicitStatus?: string | null;
    currentState?: string | null;
    latestFundingCallStatus?: string | null;
  },
): boolean {
  return canOpenDisbursementTab(currentQueue, options);
}

export function operationsDashboardStatusTitle(
  status: OperationsApplicationsListStatus,
): string {
  return STATUS_LABELS[status] ?? status;
}
