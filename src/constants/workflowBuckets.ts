import type { ComponentType } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  FileEdit,
  FileSignature,
  Files,
  Inbox,
  MailCheck,
  RotateCcw,
  Send,
  UserCheck,
} from "lucide-react";
import type { AgentBucket, UnderwriterBucket, WorkflowBucket, WorkflowScope } from "@/lib/workflowApi";

export interface WorkflowBucketDef {
  key: WorkflowBucket;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string; size?: number }>;
}

export const AGENT_BUCKET_DEFS: Array<WorkflowBucketDef & { key: AgentBucket }> = [
  { key: "all", label: "All applications", description: "Everything you created", icon: Files },
  { key: "drafts", label: "Drafts", description: "Not yet submitted", icon: FileEdit },
  { key: "in_underwriting", label: "In underwriting", description: "With the Underwriter", icon: ClipboardCheck },
  {
    key: "awaiting_my_approval",
    label: "Awaiting my approval",
    description: "Send to the ISO",
    icon: UserCheck,
  },
  { key: "sent_to_iso", label: "Sent to ISO", description: "Waiting for ISO approval", icon: MailCheck },
  { key: "contract_pending", label: "Contract pending", description: "ISO approved", icon: FileSignature },
];

export const UNDERWRITER_BUCKET_DEFS: Array<WorkflowBucketDef & { key: UnderwriterBucket }> = [
  { key: "incoming", label: "Incoming", description: "Unclaimed — ready to claim", icon: Inbox },
  { key: "my_claimed", label: "My claimed", description: "You are underwriting", icon: ClipboardCheck },
  { key: "needs_re_review", label: "Needs Re-Review", description: "Agent requested changes", icon: RotateCcw },
  { key: "sent_to_agent", label: "Sent to Agent", description: "Awaiting Agent approval", icon: Send },
  { key: "completed", label: "Completed", description: "Sent to ISO or later", icon: CheckCircle2 },
];

export const bucketDefsForScope = (scope: WorkflowScope): WorkflowBucketDef[] =>
  scope === "agent" ? AGENT_BUCKET_DEFS : UNDERWRITER_BUCKET_DEFS;

export const defaultBucketForScope = (scope: WorkflowScope): WorkflowBucket =>
  scope === "agent" ? "all" : "incoming";
