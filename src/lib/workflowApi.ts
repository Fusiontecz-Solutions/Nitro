/**
 * Agent / Underwriter workflow API (backend: controllers/applicationWorkflowController.ts,
 * routes/gmailRoutes.ts). Queue / state labels mirror backend constants/applicationWorkflow.ts.
 */
import { axiosDelete, axiosGet, axiosPost } from "@/redux/axios";
import { invalidateHttpGetCacheForResource } from "@/lib/httpGetCache";

export const WORKFLOW_QUEUE = {
  AGENT_DRAFT: "Agent",
  UNDERWRITER: "Underwriter",
  AGENT_APPROVAL: "Agent Review",
  APPROVAL_SENT: "Approval Sent",
  CONTRACT_PENDING: "Contract Pending",
} as const;

/** `currentState` set when the Agent requests changes (queue stays `Underwriter`). */
export const WORKFLOW_STATE_NEEDS_RE_REVIEW = "Needs Re-Review";

export const workflowToken = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

export const isWorkflowQueue = (queue: unknown, target: string) =>
  workflowToken(queue) === workflowToken(target);

export type WorkflowScope = "agent" | "underwriter";

export type AgentBucket =
  | "all"
  | "drafts"
  | "in_underwriting"
  | "awaiting_my_approval"
  | "sent_to_iso"
  | "contract_pending";
export type UnderwriterBucket = "incoming" | "my_claimed" | "needs_re_review" | "sent_to_agent" | "completed";
export type WorkflowBucket = AgentBucket | UnderwriterBucket;

export interface WorkflowListItem {
  id: string;
  _id: string;
  applicationId: number;
  dealId: string | null;
  businessName: string | null;
  ownerName: string | null;
  loanAmount: number | null;
  offerAmount: number | null;
  currentQueue: string;
  currentState: string;
  underwriterAction: string | null;
  iso: { id: string; name: string; email: string | null } | null;
  agent: { id: string; name: string | null; email: string | null } | null;
  underwriter: { id: string; name: string | null; email: string | null } | null;
  approvedBy: { id: string; name: string | null } | null;
  claimedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowQueueResponse {
  scope: WorkflowScope;
  bucket: WorkflowBucket;
  items: WorkflowListItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface WorkflowSummaryResponse {
  scope: WorkflowScope;
  counts: Record<string, number>;
  /** Sum of loan amounts per bucket. */
  amounts?: Record<string, number>;
  recent: WorkflowListItem[];
  /** Monthly submitted vs underwriter-approved loan amounts (`dateKey` = YYYY-MM). */
  trend?: { dateKey: string; submitted: number; approved: number }[];
}

const apiMessage = (error: any, fallback: string): string =>
  error?.response?.data?.message || error?.message || fallback;

export class WorkflowApiError extends Error {
  readonly code?: string;
  readonly status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const rethrow = (error: any, fallback: string): never => {
  throw new WorkflowApiError(
    apiMessage(error, fallback),
    error?.response?.data?.code,
    error?.response?.status,
  );
};

/** Workflow reads must never be served from the GET cache after a transition. */
const fresh = { skipCache: true } as const;

export async function fetchWorkflowSummary(
  scope?: WorkflowScope,
  range?: { startDate?: string; endDate?: string },
): Promise<WorkflowSummaryResponse> {
  try {
    const res = await axiosGet("/applications/workflow/summary", {
      ...fresh,
      params: { scope, ...(range?.startDate ? { startDate: range.startDate } : {}), ...(range?.endDate ? { endDate: range.endDate } : {}) },
    });
    return res.data?.data as WorkflowSummaryResponse;
  } catch (error) {
    return rethrow(error, "Failed to load dashboard");
  }
}

export async function fetchWorkflowQueue(params: {
  scope?: WorkflowScope;
  bucket: WorkflowBucket;
  page: number;
  limit: number;
  search?: string;
}): Promise<WorkflowQueueResponse> {
  try {
    const res = await axiosGet("/applications/workflow/queue", {
      ...fresh,
      params: { ...params },
    });
    return res.data?.data as WorkflowQueueResponse;
  } catch (error) {
    return rethrow(error, "Failed to load applications");
  }
}

const afterTransition = () => {
  invalidateHttpGetCacheForResource("applications");
};

export async function claimApplication(applicationRef: string) {
  try {
    const res = await axiosPost(`/applications/${applicationRef}/underwriter-claim`, {});
    afterTransition();
    return res.data;
  } catch (error) {
    return rethrow(error, "Failed to claim application");
  }
}

export async function submitToUnderwriting(applicationRef: string) {
  try {
    const res = await axiosPost(`/applications/${applicationRef}/submit-to-underwriting`, {});
    afterTransition();
    return res.data;
  } catch (error) {
    return rethrow(error, "Failed to submit to underwriting");
  }
}

export async function sendToAgentApproval(applicationRef: string, note: string) {
  try {
    const res = await axiosPost(`/applications/${applicationRef}/send-to-agent-approval`, { note });
    afterTransition();
    return res.data;
  } catch (error) {
    return rethrow(error, "Failed to send to the Agent");
  }
}

export async function returnToUnderwriter(applicationRef: string, note: string) {
  try {
    const res = await axiosPost(`/applications/${applicationRef}/return-to-underwriter`, { note });
    afterTransition();
    return res.data;
  } catch (error) {
    return rethrow(error, "Failed to return to underwriting");
  }
}

export interface IsoEmailThreadResponse {
  thread: {
    gmailThreadId: string;
    mailboxEmail: string | null;
    subject: string | null;
    counterpartEmail: string | null;
    updatedAt: string;
  } | null;
  messages:
    | Array<{
        id: string;
        from: string;
        to: string;
        subject: string;
        date: string;
        snippet: string;
        fromMailbox: boolean;
      }>
    | null;
  messagesUnavailableReason: string | null;
  sends: Array<{
    id: string;
    recipient: string;
    subject: string | null;
    templateName: string | null;
    status: string;
    createdAt: string;
    sentBy: string | null;
    ccEmails: string[];
    transport: "gmail" | "system" | null;
    repliedOnExistingThread: boolean;
    delivered: boolean | null;
  }>;
}

export async function fetchIsoEmailThread(applicationRef: string): Promise<IsoEmailThreadResponse> {
  try {
    const res = await axiosGet(`/applications/${applicationRef}/email-thread`, fresh);
    return res.data?.data as IsoEmailThreadResponse;
  } catch (error) {
    return rethrow(error, "Failed to load email history");
  }
}

/* --------------------------------- Gmail --------------------------------- */

export interface GmailConnectionStatus {
  configured: boolean;
  connected: boolean;
  gmailEmail: string | null;
  connectedAt: string | null;
  needsReconnect: boolean;
}

export async function fetchGmailStatus(probe = false): Promise<GmailConnectionStatus> {
  try {
    const res = await axiosGet("/gmail/me", { ...fresh, params: { probe: probe ? 1 : 0 } });
    return res.data?.data as GmailConnectionStatus;
  } catch (error) {
    return rethrow(error, "Failed to load Gmail status");
  }
}

/** Redirects the browser to Google's consent screen. */
export async function startGmailConnect(returnPath = "/user-setting?tab=email"): Promise<void> {
  try {
    const res = await axiosGet("/gmail/connect-url", { ...fresh, params: { returnPath } });
    const url = res.data?.data?.url;
    if (!url) throw new Error("No Google authorization URL returned");
    window.location.assign(url);
  } catch (error) {
    rethrow(error, "Could not start Gmail connection");
  }
}

export async function disconnectGmail(): Promise<void> {
  try {
    await axiosDelete("/gmail/connection");
  } catch (error) {
    rethrow(error, "Failed to disconnect Gmail");
  }
}
