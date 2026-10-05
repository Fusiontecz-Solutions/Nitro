import { getContractWorkflowQueueBadgeClass } from "@/lib/contractOutQueueBadge";
import {
  CONTRACT_SIGNED_QUEUE_BADGE_CLASS,
  isContractSignedQueueBadgeLabel,
} from "@/lib/contractSignedQueueBadge";

/** Pill base classes shared by every application table's CURRENT STATE column. */
export const APPLICATION_QUEUE_BADGE_BASE_CLASS = "px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap";

/**
 * Pill colours for an application's queue label. Used by the Applications list, the
 * Agent / Underwriter workflow queues and the dashboards so the badge looks the same everywhere.
 */
export function getApplicationQueueBadgeClass(queueLabel: string): string {
  const contractWorkflowClass = getContractWorkflowQueueBadgeClass(queueLabel);
  if (contractWorkflowClass) return contractWorkflowClass;
  if (isContractSignedQueueBadgeLabel(queueLabel)) {
    return CONTRACT_SIGNED_QUEUE_BADGE_CLASS;
  }
  const n = queueLabel.trim().toLowerCase();
  if (n === "final scrubbing-approved") {
    return "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";
  }
  if (n === "funded" || n === "disbursement") {
    return "bg-green-100 text-green-700";
  }
  if (n === "approved" || n === "contracted") {
    return "bg-blue-100 text-blue-700";
  }
  if (n === "declined") {
    return "bg-red-100 text-red-700";
  }
  // Agent → Underwriter workflow stages.
  if (n === "agent review" || n === "agent approval") {
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  }
  if (n === "approval sent") {
    return "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200";
  }
  if (n === "agent" || n === "draft") {
    return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200";
  }
  if (
    n === "underwriting" ||
    n === "scrubbing" ||
    n === "underwriter" ||
    n === "review" ||
    n === "final review" ||
    n === "final scrubbing" ||
    n === "final" ||
    n === "funding call"
  ) {
    return "bg-sky-100 text-sky-800";
  }
  if (n === "-") {
    return "bg-muted/50 text-foreground";
  }
  return "bg-yellow-100 text-yellow-700";
}
