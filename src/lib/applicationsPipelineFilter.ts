import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import ContentPasteSearchIcon from "@mui/icons-material/ContentPasteSearch";
import FactCheck from "@mui/icons-material/FactCheck";
import Article from "@mui/icons-material/Article";
import CheckCircle from "@mui/icons-material/CheckCircle";
import AccountBalance from "@mui/icons-material/AccountBalance";
import Paid from "@mui/icons-material/Paid";
import HighlightOff from "@mui/icons-material/HighlightOff";
import VerifiedUser from "@mui/icons-material/VerifiedUser";
import PauseCircle from "@mui/icons-material/PauseCircle";
import { operationsDashboardStatusTitle } from "@/constants/operationsDashboardApplications";

export type ApplicationsPipelineFilterIcon = ComponentType<SvgIconProps>;

export type ApplicationsPipelineFilterChild = {
  label: string;
  /** Value passed to `statusFilter` / `operationsStatus` list API. */
  filterValue: string;
};

export type ApplicationsPipelineFilterItem = {
  label: string;
  filterValue: string;
  icon: ApplicationsPipelineFilterIcon;
  children?: ApplicationsPipelineFilterChild[];
  showCount?: boolean;
};

/** Deal pipeline stages for `/applications` list filtering (matches sidebar DEAL PIPELINE). */
export const APPLICATIONS_PIPELINE_FILTER_ITEMS: ApplicationsPipelineFilterItem[] =
  [
    {
      label: "Create Offer",
      filterValue: "Scrubbing",
      icon: ContentPasteSearchIcon,
      showCount: false,
    },
    {
      label: "Underwriter",
      filterValue: "Underwriter",
      icon: FactCheck,
      showCount: false,
    },
    {
      label: "Approve",
      filterValue: "Approved",
      icon: VerifiedUser,
      children: [
        {
          label: operationsDashboardStatusTitle("Approved_By_UW"),
          filterValue: "Approved_By_UW",
        },
        {
          label: operationsDashboardStatusTitle("Approval_Sent"),
          filterValue: "Approval_Sent",
        },
        {
          label: operationsDashboardStatusTitle("Approved_By_ISO"),
          filterValue: "Approved_By_ISO",
        },
      ],
    },
    {
      label: "Contract",
      filterValue: "Contracted",
      icon: Article,
      children: [
        {
          label: operationsDashboardStatusTitle("Contract_Pending"),
          filterValue: "Contract_Pending",
        },
        {
          label: operationsDashboardStatusTitle("Contract_Sent"),
          filterValue: "Contract_Sent",
        },
        {
          label: operationsDashboardStatusTitle("Contract_Signed"),
          filterValue: "Contract_Signed",
        },
      ],
    },
    {
      label: operationsDashboardStatusTitle("Finals_And_Funding_Call"),
      filterValue: "Finals_And_Funding_Call",
      icon: CheckCircle,
      showCount: true,
    },
    {
      label: "Disbursement",
      filterValue: "Disbursment",
      icon: AccountBalance,
      showCount: true,
    },
    {
      label: operationsDashboardStatusTitle("On_Hold"),
      filterValue: "On_Hold",
      icon: PauseCircle,
      showCount: true,
    },
    {
      label: "Funded",
      filterValue: "Funded",
      icon: Paid,
      showCount: true,
    },
    {
      label: "Rejected",
      filterValue: "Declined",
      icon: HighlightOff,
      showCount: true,
    },
  ];

/** Flat list for the Applications page status dropdown (contract stages only). */
export const APPLICATIONS_STATUS_FILTER_OPTIONS: ApplicationsPipelineFilterChild[] =
  [
    {
      label: operationsDashboardStatusTitle("Contract_Pending"),
      filterValue: "Contract_Pending",
    },
    {
      label: operationsDashboardStatusTitle("Contract_Sent"),
      filterValue: "Contract_Sent",
    },
    {
      label: operationsDashboardStatusTitle("Contract_Signed"),
      filterValue: "Contract_Signed",
    },
  ];

export function applicationsPipelineFilterLabel(filterValue: string): string {
  if (filterValue === "all") return "All";
  const fromFlat = APPLICATIONS_STATUS_FILTER_OPTIONS.find(
    (opt) => opt.filterValue === filterValue,
  );
  if (fromFlat) return fromFlat.label;
  for (const item of APPLICATIONS_PIPELINE_FILTER_ITEMS) {
    if (item.filterValue === filterValue) return item.label;
    for (const child of item.children ?? []) {
      if (child.filterValue === filterValue) return child.label;
    }
  }
  return operationsDashboardStatusTitle(
    filterValue as Parameters<typeof operationsDashboardStatusTitle>[0],
  );
}

export function isApplicationsPipelineFilterActive(
  statusFilter: string,
  filterValue: string,
): boolean {
  if (statusFilter === filterValue) return true;
  if (filterValue === "Contracted") {
    return (
      statusFilter === "Contract_Pending" ||
      statusFilter === "Contract_Sent" ||
      statusFilter === "Contract_Signed"
    );
  }
  if (filterValue === "Approved") {
    return (
      statusFilter === "Approved_By_UW" ||
      statusFilter === "Approval_Sent" ||
      statusFilter === "Approved_By_ISO"
    );
  }
  if (filterValue === "Finals_And_Funding_Call") {
    return (
      statusFilter === "Finals_And_Funding_Call" ||
      statusFilter === "Final" ||
      statusFilter === "Funding Call"
    );
  }
  return false;
}

export function getPipelineCountBadgeClass(): string {
  return "bg-muted text-muted-foreground";
}

export function resolveApplicationsPipelineCount(
  filterValue: string | undefined,
  summaryCounts: {
    contractPending: number;
    contractGenerated: number;
    contractsOut: number;
    signedContracts: number;
    disbursment: number;
    funded: number;
  },
  caseStageCounts: Record<string, number>,
  rejectedCount: number,
): number | null {
  if (!filterValue) return null;
  switch (filterValue) {
    case "Scrubbing":
      return caseStageCounts.Scrubbing ?? 0;
    case "Underwriter":
      return caseStageCounts["Underwriter"] ?? 0;
    case "Final_Approval":
      return caseStageCounts.Final_Approval ?? 0;
    case "Approved_By_UW":
      return caseStageCounts.Approved_By_UW ?? 0;
    case "Approval_Sent":
      return caseStageCounts.Approval_Sent ?? 0;
    case "Approved_By_ISO":
      return caseStageCounts.Approved_By_ISO ?? 0;
    case "Contract_Pending":
      return caseStageCounts.Contract_Pending ?? summaryCounts.contractPending ?? 0;
    case "Contract_Sent":
      return caseStageCounts.Contract_Sent ?? summaryCounts.contractsOut ?? 0;
    case "Contract_Signed":
      return caseStageCounts.Contract_Signed ?? summaryCounts.signedContracts ?? 0;
    case "Final":
      return caseStageCounts.Final ?? 0;
    case "Funding Call":
      return caseStageCounts["Funding Call"] ?? 0;
    case "Finals_And_Funding_Call":
      return (
        (caseStageCounts.Final ?? 0) + (caseStageCounts["Funding Call"] ?? 0)
      );
    case "Disbursment":
      return summaryCounts.disbursment;
    case "On_Hold":
      return caseStageCounts.On_Hold ?? 0;
    case "Funded":
      return summaryCounts.funded;
    case "Declined":
      return rejectedCount;
    case "Recently_Deleted":
      return caseStageCounts.Recently_Deleted ?? 0;
    default:
      return null;
  }
}
