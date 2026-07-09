import { isUnderwriterApprovedApplication } from "@/lib/underwriterApprovalLabel";

/**
 * Workflow labels for "Current state" / summary — aligned with API `mapApplicationToApi` / `toWorkflowApiState`.
 */

/** First review stage queue (stored as `Scrubbing`; legacy: Underwriting). */
export function isScrubbingWorkflowQueue(queue: string | null | undefined): boolean {
  const q = String(queue ?? "").trim().toLowerCase();
  return q === "scrubbing" || q === "underwriting" || q === "review";
}

/** Final review stage queue (stored as `Underwriter`; legacy: Final Review / Final Underwriter). */
export function isFinalUnderwriterWorkflowQueue(queue: string | null | undefined): boolean {
  const q = String(queue ?? "").trim().toLowerCase();
  return q === "underwriter" || q === "final review" || q === "final underwriter";
}

/** Final approval stage queue (stored as `Final Approval`). */
export function isFinalApprovalWorkflowQueue(queue: string | null | undefined): boolean {
  const q = String(queue ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return q === "finalapproval";
}

type WorkflowDecisionApp = {
  currentQueue?: string | null;
  currentState?: string | null;
  queue?: string | null;
  state?: string | null;
  status?: string | null;
  statsCurrentState?: string | null;
};

export function resolveApplicationWorkflowQueueAndStates(
  app: WorkflowDecisionApp | null | undefined,
): {
  queue: string;
  mappedState: string;
  rawState: string;
} {
  if (!app) return { queue: "", mappedState: "", rawState: "" };
  const queue = String(app.currentQueue ?? app.queue ?? "").trim();
  const mappedState = String(
    app.currentState ?? app.state ?? app.status ?? "",
  ).trim();
  const rawState = String(app.statsCurrentState ?? mappedState).trim();
  return { queue, mappedState, rawState };
}

export function isApplicationInFinalApprovalStage(
  app: WorkflowDecisionApp | null | undefined,
): boolean {
  const { queue, mappedState, rawState } =
    resolveApplicationWorkflowQueueAndStates(app);
  return (
    isFinalApprovalWorkflowQueue(queue) ||
    isFinalApprovalWorkflowQueue(mappedState) ||
    isFinalApprovalWorkflowQueue(rawState)
  );
}

export function isUnderwriterWorkflowDecisionStage(
  app: WorkflowDecisionApp | null | undefined,
): boolean {
  if (!app) return false;
  const { queue } = resolveApplicationWorkflowQueueAndStates(app);
  if (isFinalUnderwriterWorkflowQueue(queue)) return true;
  if (isApplicationInFinalApprovalStage(app)) return true;
  if (isUnderwriterApprovedApplication(app as Record<string, unknown>)) return true;
  const q = String(queue ?? "").trim().toLowerCase();
  return q === "scrubbing" || q === "underwriting" || q === "review";
}

export function getWorkflowCurrentStateLabel(app: {
  currentQueue?: string | null;
  queue?: string | null;
  currentState?: string | null;
  state?: string | null;
  status?: string | null;
}): string {
  const queue = app.currentQueue || app.queue || "";
  const state = app.currentState || app.state || "";

  if (queue === "Final") return "FINAL";
  if (queue === "Funding Call") return "FUNDING CALL";
  if (queue === "Disbursement") return "DISBURSEMENT";
  if (queue === "Funded") return "FUNDED";

  if (queue === "Approved") {
    if (state === "Completed") return "Funded";
    return "Approved";
  }
  if (queue === "Declined") return "Rejected";

  if (queue === "Agent" || queue === "New") return "Pending";
  if (queue === "Underwriting" || queue === "Scrubbing" || queue === "Review") {
    return "In Progress";
  }
  if (queue === "Final Review" || queue === "Underwriter" || queue === "Final Underwriter") {
    if (state === "Approved" || state === "Completed") return "Approved";
    return "In Progress";
  }

  if (queue === "On Hold") return "Pending";

  if (state === "Cancelled") return "Rejected";
  if (app.status) return String(app.status);

  return "Pending";
}
