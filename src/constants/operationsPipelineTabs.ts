import type { OperationsApplicationsListStatus } from "@/constants/operationsDashboardApplications";

export type PipelineTab = { id: string; label: string };

/** Full pipeline for Super Admin — includes Bank Analysis after Documents and Final + Funding Call between Contract and Disbursement. */
export const SUPER_ADMIN_PIPELINE_TABS: PipelineTab[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "documents", label: "DOCUMENTS" },
  { id: "bank-analysis", label: "BANK ANALYSIS" },
  { id: "decision-making", label: "DECISION MAKING" },
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
    case "Contract_Out":
    case "Contracted":
    case "Contract_Signed":
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
    case "Funded":
    case "Disbursment":
      return [...full];
    default:
      return [...full];
  }
}
