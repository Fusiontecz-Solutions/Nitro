/**
 * Workflow labels for "Current state" / summary — aligned with API `mapApplicationToApi` / `toWorkflowApiState`.
 */
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
  if (queue === "Underwriting" || queue === "Underwriter" || queue === "Review") {
    return "In Progress";
  }
  if (queue === "Final Review" || queue === "Final Underwriter") {
    if (state === "Approved" || state === "Completed") return "Approved";
    return "In Progress";
  }

  if (queue === "On Hold") return "Pending";

  if (state === "Cancelled") return "Rejected";
  if (app.status) return String(app.status);

  return "Pending";
}
