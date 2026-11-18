import type { OperationsApplicationsListStatus } from "@/constants/operationsDashboardApplications";

export type PipelineTab = { id: string; label: string };

/** Combined Final + Funding Call stage (sidebar bucket and application-details tab). */
export const FINALS_AND_FUNDING_CALL_TAB: PipelineTab = {
  id: "finals-and-funding-call",
  label: "FINALS & FUNDING CALL",
};

/** Contract workflow — Overview, Documents, Create Offer, Background Check, Contract. */
export const SUPER_ADMIN_PIPELINE_TABS: PipelineTab[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "documents", label: "DOCUMENTS" },
  { id: "decision-making", label: "CREATE OFFER" },
  { id: "background-check", label: "BACKGROUND CHECK" },
  { id: "contract", label: "CONTRACT" },
];

/**
 * Operations pipeline: same flow with the merged Finals & Funding Call tab
 * between Contract and Disbursement.
 */
export const OPERATIONS_PIPELINE_TABS: PipelineTab[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "documents", label: "DOCUMENTS" },
  { id: "decision-making", label: "DECISION MAKING" },
  { id: "background-check", label: "BACKGROUND CHECK" },
  { id: "contract", label: "CONTRACT" },
  { id: "eligibility-analysis", label: "DECISION LOGIC" },
  FINALS_AND_FUNDING_CALL_TAB,
  { id: "disbursement", label: "DISBURSEMENT" },
];

const TAB_INDEX = {
  contract: OPERATIONS_PIPELINE_TABS.findIndex((t) => t.id === "contract"),
  finalsAndFundingCall: OPERATIONS_PIPELINE_TABS.findIndex(
    (t) => t.id === "finals-and-funding-call",
  ),
} as const;

/**
 * Visible pipeline tabs for **Operations** from `?operationsStatus=…`
 * (dashboard card, sidebar, or inferred stage when opening from “all” cases).
 *
 * Uses {@link OPERATIONS_PIPELINE_TABS} (includes merged Finals & Funding Call tab).
 *
 * - Agent → OVERVIEW, DOCUMENTS
 * - Scrubbing → through CONTRACT (overview → contract)
 * - Underwriter → DECISION MAKING, BACKGROUND CHECK, CONTRACT, DECISION LOGIC
 * - Contract pending / … → through CONTRACT
 * - Final / Funding Call / Finals & Funding Call → through merged tab
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
    case "Scrubbing": {
      const end = TAB_INDEX.contract;
      return end >= 0 ? full.slice(0, end + 1) : [...full];
    }
    case "Underwriter":
      return [
        { id: "decision-making", label: "DECISION MAKING" },
        { id: "background-check", label: "BACKGROUND CHECK" },
        { id: "contract", label: "CONTRACT" },
        { id: "eligibility-analysis", label: "DECISION LOGIC" },
      ];
    case "Contract_Pending":
    case "Contract_Generated":
    case "Contract_Sent":
    case "Contract_Cancelled":
    case "Contract_Out":
    case "Contracted": {
      const end = TAB_INDEX.contract;
      return end >= 0 ? full.slice(0, end + 1) : [...full];
    }
    case "Contract_Signed":
    case "Signed_Contracts": {
      const eligIdx = full.findIndex((t) => t.id === "eligibility-analysis");
      return eligIdx >= 0 ? full.slice(0, eligIdx + 1) : [...full];
    }
    case "Final_Approval": {
      const end = TAB_INDEX.finalsAndFundingCall;
      return end >= 0 ? full.slice(0, end + 1) : [...full];
    }
    case "Reinitiate_Contract": {
      const end = TAB_INDEX.contract;
      return end >= 0 ? full.slice(0, end + 1) : [...full];
    }
    case "Final":
    case "Funding Call":
    case "Finals_And_Funding_Call": {
      const end = TAB_INDEX.finalsAndFundingCall;
      return end >= 0 ? full.slice(0, end + 1) : [...full];
    }
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
 * Uses the longest strip ({@link SUPER_ADMIN_PIPELINE_TABS}) so stage indices align with the Super Admin pipeline.
 */
export function getOperationsPipelineStageTabId(
  status: OperationsApplicationsListStatus,
): string {
  switch (status) {
    case "Agent":
      return "documents";
    case "Scrubbing":
    case "Underwriter":
      return "decision-making";
    case "Contract_Pending":
    case "Contract_Generated":
    case "Contract_Sent":
    case "Contract_Cancelled":
    case "Contract_Out":
    case "Contracted":
    case "Contract_Signed":
    case "Signed_Contracts":
    case "Reinitiate_Contract":
      return "contract";
    case "Final_Approval":
      return "decision-making";
    case "Final":
    case "Funding Call":
    case "Finals_And_Funding_Call":
    case "Funded":
    case "Disbursment":
      return "contract";
    case "Declined":
      return "overview";
    default:
      return "overview";
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
