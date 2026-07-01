import { formatDealPipelineCurrentStateLabel } from "@/lib/dealPipelineCurrentState";

type ApplicationStatusFields = {
  currentState?: string | null;
  state?: string | null;
  currentQueue?: string | null;
  queue?: string | null;
};

function formatWorkflowStateValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "—";

  const pipelineLabel = formatDealPipelineCurrentStateLabel({
    currentState: trimmed,
    state: trimmed,
  });
  if (pipelineLabel !== "—") return pipelineLabel;

  return trimmed.replace(/_/g, " ");
}

/**
 * Status label for Application Summary and the applications list "Current State" column.
 * Prefers `currentState` (workflow state) over `currentQueue`.
 */
export function getApplicationSummaryStatusLabel(
  app: ApplicationStatusFields,
): string {
  const state = String(app.currentState ?? app.state ?? "").trim();
  if (state) return formatWorkflowStateValue(state);

  const queue = String(app.currentQueue ?? app.queue ?? "").trim();
  if (queue) {
    const pipelineLabel = formatDealPipelineCurrentStateLabel({
      currentQueue: queue,
      queue,
    });
    return pipelineLabel !== "—" ? pipelineLabel : queue;
  }

  return "—";
}
