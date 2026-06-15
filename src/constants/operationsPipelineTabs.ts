import type { OperationsApplicationsListStatus } from "@/constants/operationsDashboardApplications";

export type PipelineTab = { id: string; label: string };

/** Full pipeline for Super Admin — includes Bank Analysis after Documents and Final + Funding Call between Contract and Disbursement. */
export const SUPER_ADMIN_PIPELINE_TABS: PipelineTab[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "documents", label: "DOCUMENTS" },
  { id: "bank-analysis", label: "BANK ANALYSIS" },
  { id: "decision-making", label: "DECISION MAKING" },
  { id: "eligibility-analysis", label: "ELIGIBILITY ANALYSIS" },
  { id: "contract", label: "CONTRACT" },
  { id: "final", label: "FINAL" },
  { id: "funding-call", label: "FUNDING CALL" },
  { id: "disbursement", label: "DISBURSEMENT" },
];

/**
 * Operations pipeline: same flow but **no** Final or Funding Call tabs.
 * Dashboard buckets named Final / Funding Call still resolve to the full Operations strip
 * (overview → disbursement) via `getOperationsTabsForDashboardEntry`.
 */
export const OPERATIONS_PIPELINE_TABS: PipelineTab[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "documents", label: "DOCUMENTS" },
  { id: "decision-making", label: "DECISION MAKING" },
  { id: "contract", label: "CONTRACT" },
  { id: "disbursement", label: "DISBURSEMENT" },
];

const TAB_INDEX = {
  contract: OPERATIONS_PIPELINE_TABS.findIndex((t) => t.id === "contract"),
  final: OPERATIONS_PIPELINE_TABS.findIndex((t) => t.id === "final"),
  fundingCall: OPERATIONS_PIPELINE_TABS.findIndex((t) => t.id === "funding-call"),
} as const;

/**
 * Visible pipeline tabs for **Operations** from `?operationsStatus=…`
 * (dashboard card, sidebar, or inferred stage when opening from “all” cases).
 *
 * Uses {@link OPERATIONS_PIPELINE_TABS} (no Final / Funding Call tab IDs).
 *
 * - Agent → OVERVIEW, DOCUMENTS
 * - Underwriter → through CONTRACT (first four tabs)
 * - Final Underwriter → DECISION MAKING, CONTRACT
 * - Contract pending / … → through CONTRACT
 * - Final / Funding Call buckets → full Operations strip (those tabs are not shown individually)
 * - Funded / Disbursment → full strip
 * - No / unknown status → full Operations strip
 */
export function getOperationsTabsForDashboardEntry(
  status: OperationsApplicationsListStatus | null,
): PipelineTab[] {
  const full = OPERATIONS_PIPELINE_TABS;

  if (!status) {
    return [...full];
  }

  switch (status) {
    case "Agent":
      return full.slice(0, 2);
    case "Underwriter":
      return full.slice(0, 4);
    case "Final Underwriter":
      return [
        { id: "decision-making", label: "DECISION MAKING" },
        { id: "contract", label: "CONTRACT" },
      ];
    case "Contract_Pending":
    case "Contract_Generated":
    case "Contract_Sent":
    case "Contract_Cancelled":
    case "Contract_Out":
    case "Contracted":
    case "Contract_Signed":
    case "Signed_Contracts":
    case "Signed_Contracts": {
      const end = TAB_INDEX.contract;
      return end >= 0 ? full.slice(0, end + 1) : [...full];
    }
    case "Final": {
      const end = TAB_INDEX.final;
      return end >= 0 ? full.slice(0, end + 1) : [...full];
    }
    case "Funding Call": {
      const end = TAB_INDEX.fundingCall;
      return end >= 0 ? full.slice(0, end + 1) : [...full];
    }
    case "Finals_And_Funding_Call":
    case "Funded":
    case "Disbursment":
    case "Declined":
      return [...full];
    default:
      return [...full];
  }
}

/**
 * Pipeline tab that best matches where the deal currently sits (for edit vs preview).
 * Uses the longest strip ({@link SUPER_ADMIN_PIPELINE_TABS}) so bank-analysis lines up with decision-making.
 */
export function getOperationsPipelineStageTabId(
  status: OperationsApplicationsListStatus,
): string {
  switch (status) {
    case "Agent":
      return "documents";
    case "Underwriter":
      return "decision-making";
    case "Final Underwriter":
      return "decision-making";
    case "Contract_Pending":
    case "Contract_Generated":
    case "Contract_Sent":
    case "Contract_Cancelled":
    case "Contract_Out":
    case "Contracted":
    case "Contract_Signed":
    case "Signed_Contracts":
    case "Signed_Contracts":
      return "contract";
    case "Final":
      return "final";
    case "Funding Call":
      return "funding-call";
    case "Finals_And_Funding_Call":
      return "funding-call";
    case "Funded":
    case "Disbursment":
      return "disbursement";
    case "Declined":
      return "overview";
    default:
      return "disbursement";
  }
}

function pipelineTabIndex(tabId: string, pipelineTabs: PipelineTab[]): number {
  return pipelineTabs.findIndex((t) => t.id === tabId);
}

/**
 * True when the user is viewing an earlier pipeline tab than the deal's current stage
 * (e.g. Decision Making / Bank Analysis while status is Contract Out).
 */
export function isOperationsPipelineTabBehindDealStage(
  activeTabId: string,
  dealStageStatus: OperationsApplicationsListStatus | null,
  pipelineTabs: PipelineTab[],
): boolean {
  if (!dealStageStatus || pipelineTabs.length === 0) return false;

  const stageTabId = getOperationsPipelineStageTabId(dealStageStatus);
  const stageIdx = pipelineTabIndex(stageTabId, pipelineTabs);
  const activeIdx = pipelineTabIndex(activeTabId, pipelineTabs);

  if (stageIdx < 0 || activeIdx < 0) return false;
  return activeIdx < stageIdx;
}
