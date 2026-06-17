import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import ContentPasteSearchIcon from "@mui/icons-material/ContentPasteSearch";
import FactCheck from "@mui/icons-material/FactCheck";
import Article from "@mui/icons-material/Article";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Phone from "@mui/icons-material/Phone";
import AccountBalance from "@mui/icons-material/AccountBalance";
import Paid from "@mui/icons-material/Paid";
import HighlightOff from "@mui/icons-material/HighlightOff";
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
      label: "Underwriter",
      filterValue: "Underwriter",
      icon: ContentPasteSearchIcon,
      showCount: false,
    },
    {
      label: "Final Underwriter",
      filterValue: "Final Underwriter",
      icon: FactCheck,
      showCount: false,
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
          label: operationsDashboardStatusTitle("Contract_Generated"),
          filterValue: "Contract_Generated",
        },
        {
          label: operationsDashboardStatusTitle("Contract_Signed"),
          filterValue: "Contract_Signed",
        },
      ],
    },
    {
      label: "Final",
      filterValue: "Final",
      icon: CheckCircle,
      showCount: true,
    },
    {
      label: "Funding Call",
      filterValue: "Funding Call",
      icon: Phone,
      showCount: true,
    },
    {
      label: "Disbursement",
      filterValue: "Disbursment",
      icon: AccountBalance,
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

/** Flat list for the Applications page status dropdown (original UI + new pipeline stages). */
export const APPLICATIONS_STATUS_FILTER_OPTIONS: ApplicationsPipelineFilterChild[] =
  [
    // { label: "Agent", filterValue: "Agent" },
    { label: "Underwriter", filterValue: "Underwriter" },
    { label: "Final Underwriter", filterValue: "Final Underwriter" },
    {
      label: operationsDashboardStatusTitle("Contract_Pending"),
      filterValue: "Contract_Pending",
    },
    {
      label: operationsDashboardStatusTitle("Contract_Generated"),
      filterValue: "Contract_Generated",
    },
    {
      label: operationsDashboardStatusTitle("Contract_Signed"),
      filterValue: "Contract_Signed",
    },
    { label: "Final", filterValue: "Final" },
    { label: "Funding call", filterValue: "Funding Call" },
    { label: "Disbursement", filterValue: "Disbursment" },
    { label: "Funded", filterValue: "Funded" },
    { label: "Rejected", filterValue: "Declined" },
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
      statusFilter === "Contract_Generated" ||
      statusFilter === "Contract_Signed"
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
    case "Underwriter":
      return caseStageCounts.Underwriter ?? 0;
    case "Final Underwriter":
      return caseStageCounts["Final Underwriter"] ?? 0;
    case "Contract_Pending":
      return summaryCounts.contractPending;
    case "Contract_Generated":
      return summaryCounts.contractGenerated || summaryCounts.contractsOut;
    case "Contract_Signed":
      return summaryCounts.signedContracts;
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
    case "Funded":
      return summaryCounts.funded;
    case "Declined":
      return rejectedCount;
    default:
      return null;
  }
}
