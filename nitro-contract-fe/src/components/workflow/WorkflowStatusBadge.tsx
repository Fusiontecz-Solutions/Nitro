import { cn } from "@/lib/utils";
import { workflowToken } from "@/lib/workflowApi";
import { APPLICATION_QUEUE_BADGE_BASE_CLASS, getApplicationQueueBadgeClass } from "@/lib/applicationQueueBadge";

/** Friendlier labels for the Agent → Underwriter workflow queues; colours come from the shared badge helper. */
const WORKFLOW_LABELS: Record<string, string> = {
  agent: "Draft",
  new: "Draft",
  underwriter: "Underwriting",
  agentreview: "Agent Review",
  agentapproval: "Agent Review",
  approvalsent: "ISO Approval Pending",
};

export default function WorkflowStatusBadge({
  queue,
  className,
}: {
  queue: string | null | undefined;
  className?: string;
}) {
  const raw = String(queue ?? "").trim();
  return (
    <span className={cn("inline-flex items-center", APPLICATION_QUEUE_BADGE_BASE_CLASS, getApplicationQueueBadgeClass(raw || "-"), className)}>
      {WORKFLOW_LABELS[workflowToken(raw)] ?? (raw || "-")}
    </span>
  );
}
