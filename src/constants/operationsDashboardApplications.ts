/**
 * URL/query value when no operations stage filter is applied
 * (`/applications?fromDashboard=operations&operationsStatus=all`). The list API is called without `operationsStatus`.
 */
export const OPERATIONS_APPLICATIONS_LIST_ALL_QUERY = "all";

/** Backend `operationsStatus` values used by Operations dashboard stat cards and `/applications` filtering. */
export const OPERATIONS_DASHBOARD_APPLICATION_STATUSES = [
  "Contract_Pending",
  "Contract_Out",
  "Contracted",
  "Contract_Signed",
  "Signed_Contracts",
  "Funding Call",
  "Disbursment",
  "Funded",
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
  Contract_Out: "Contract Out",
  Contracted: "Contract",
  Contract_Signed: "Contract Signed",
  Signed_Contracts: "Signed Contracts",
  "Funding Call": "Funding Call",
  Disbursment: "Disbursement",
  Funded: "Funded",
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
    contract_out: "Contract_Out",
    contracted: "Contracted",
    contracts_out: "Contract_Out",
    contract_signed: "Contract_Signed",
    signed_contracts: "Contract_Signed",
    funding_call: "Funding Call",
    disbursment: "Disbursment",
    disbursement: "Disbursment",
    funded: "Funded",
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

  if (st === "funded" || q === "funded") return "Funded";
  if (
    q === "disbursment" ||
    q === "disbursement" ||
    (q.length > 0 && q.includes("disburs"))
  ) {
    return "Disbursment";
  }
  if (q === "fundingcall" || (q.includes("funding") && q.includes("call"))) {
    return "Funding Call";
  }
  if (q === "final" && !q.includes("underwriter")) return "Final";
  if (q === "finalunderwriter" || q === "finalreview") return "Final Underwriter";
  if (
    q === "underwriter" ||
    q === "underwriting" ||
    q === "review"
  ) {
    return "Underwriter";
  }
  if (q === "contractout" || q === "contractsout") {
    return "Contract_Out";
  }
  if (q === "contractsigned" || q === "signedcontracts") {
    return "Contract_Signed";
  }
  if (state === "signedcontracts" || state === "signed_contracts") {
    return "Contract_Signed";
  }
  if (q === "contracted" || q === "contractpending" || st === "contracted") {
    return "Contracted";
  }
  if (q === "new" || q === "agent" || q === "draft") return "Agent";
  if (state === "completed" && st === "approved") return "Funded";

  return null;
}

/**
 * Whether the Disbursement tab may be opened for this application.
 * Requires Funding Call stage or later (Disbursement / Funded), using the same
 * queue / status / state signals as {@link inferOperationsListStatusFromApplication}.
 */
export function isApplicationAtOrPastFundingCallForDisbursement(
  currentQueue: string | null | undefined,
  options?: { explicitStatus?: string | null; currentState?: string | null },
): boolean {
  const inferred = inferOperationsListStatusFromApplication(currentQueue, options);
  if (
    inferred === "Funding Call" ||
    inferred === "Disbursment" ||
    inferred === "Funded"
  ) {
    return true;
  }

  const st = normalizePipelineKey(options?.explicitStatus);
  const state = normalizePipelineKey(options?.currentState);

  if (st === "fundingcall" || (st.includes("funding") && st.includes("call"))) {
    return true;
  }
  if (
    state === "fundingcall" ||
    (state.includes("funding") && state.includes("call"))
  ) {
    return true;
  }

  return false;
}

export function operationsDashboardStatusTitle(
  status: OperationsApplicationsListStatus,
): string {
  return STATUS_LABELS[status] ?? status;
}
