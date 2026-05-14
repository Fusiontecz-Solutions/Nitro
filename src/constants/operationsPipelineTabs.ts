import type { OperationsApplicationsListStatus } from "@/constants/operationsDashboardApplications";

/** Full operations funding-pipeline tab order (left → right). */
export const OPERATIONS_PIPELINE_TABS: { id: string; label: string }[] = [
  { id: "overview", label: "OVERVIEW" },
  { id: "documents", label: "DOCUMENTS" },
  { id: "bank-analysis", label: "BANK ANALYSIS" },
  { id: "decision-making", label: "DECISION MAKING" },
  { id: "contract", label: "CONTRACT" },
  { id: "final", label: "FINAL" },
  { id: "funding-call", label: "FUNDING CALL" },
  { id: "disbursement", label: "DISBURSEMENT" },
];

const TAB_INDEX = {
  contract: OPERATIONS_PIPELINE_TABS.findIndex((t) => t.id === "contract"),
  final: OPERATIONS_PIPELINE_TABS.findIndex((t) => t.id === "final"),
  fundingCall: OPERATIONS_PIPELINE_TABS.findIndex((t) => t.id === "funding-call"),
} as const;

/**
 * Visible pipeline tabs for Operations / Super Admin from `?operationsStatus=…`
 * (dashboard card, sidebar, or inferred stage when opening from “all” cases).
 *
 * - Agent → OVERVIEW, DOCUMENTS
 * - Underwriter → through DECISION MAKING
 * - Final Underwriter → DECISION MAKING, CONTRACT
 * - Contract pending / contracted / signed contracts → through CONTRACT
 * - Final → through FINAL
 * - Funding Call → through FUNDING CALL
 * - Funded / Disbursment → full strip through DISBURSEMENT
 * - No / unknown status → full pipeline
 */
export function getOperationsTabsForDashboardEntry(
  status: OperationsApplicationsListStatus | null,
): { id: string; label: string }[] {
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
