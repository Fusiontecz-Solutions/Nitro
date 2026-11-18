/**
 * Agent → Underwriter → Agent → ISO → Contract Pending workflow.
 *
 *   Agent creates the deal (optionally as a draft in `Agent`)
 *     → `Underwriter`      unclaimed pool; an Underwriter claims it (assignedUnderwriterId)
 *     → `Agent Review`     Underwriter finished underwriting and handed it back to the Agent
 *                          (older rows may still hold the previous label `Agent Approval`)
 *                          Agent "Request changes" → back to `Underwriter` with state
 *                          `Needs Re-Review` (Underwriter sidebar: Needs Re-Review)
 *     → `Approval Sent`    Agent emailed the ISO approval request from their Gmail thread
 *     → `Contract Pending` ISO approved on the public portal (see applicationApprovalService)
 *
 * `Approval Sent` / `Contract Pending` reuse the existing contract-workflow labels so the
 * Super Admin contract pipeline picks the deal up without any extra mapping.
 */
import { CANONICAL_WORKFLOW_QUEUES } from '../utils/workflowQueueStorage';

/** Literals match `applicationApprovalEmailValues` / `contractApplicationWorkflowSync` (kept inline to avoid import cycles). */
export const WORKFLOW_QUEUE = {
    AGENT_DRAFT: CANONICAL_WORKFLOW_QUEUES.AGENT,
    UNDERWRITER: CANONICAL_WORKFLOW_QUEUES.UNDERWRITER,
    AGENT_APPROVAL: 'Agent Review',
    APPROVAL_SENT: 'Approval Sent',
    CONTRACT_PENDING: 'Contract Pending',
} as const;

export const WORKFLOW_STATE = {
    PENDING: 'PENDING',
    IN_PROGRESS: 'IN_PROGRESS',
    AGENT_APPROVAL: 'Agent Review',
    APPROVAL_SENT: 'Approval Sent',
    /** Agent requested changes; the deal stays in the `Underwriter` queue so claim / edit rules are unchanged. */
    NEEDS_RE_REVIEW: 'Needs Re-Review',
} as const;

/** Agent review stage, including the legacy `Agent Approval` label on older rows. */
export const AGENT_REVIEW_QUEUES = [WORKFLOW_QUEUE.AGENT_APPROVAL, 'Agent Approval'] as const;

/** `ApplicationEmailThread.purpose` for the Agent → ISO approval chain. */
export const ISO_APPROVAL_THREAD_PURPOSE = 'ISO_APPROVAL' as const;

/** Mirrors `UNDERWRITER_ACTION_APPROVED` in applicationController (list / dashboard label). */
export const UNDERWRITER_ACTION_SENT_TO_AGENT = 'Approved By UW' as const;

export const normalizeWorkflowToken = (value: unknown): string =>
    String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

export const isQueue = (queue: unknown, target: string): boolean =>
    normalizeWorkflowToken(queue) === normalizeWorkflowToken(target);

/** True for the Agent review stage (current `Agent Review` or legacy `Agent Approval`). */
export const isAgentReviewQueue = (queue: unknown): boolean => AGENT_REVIEW_QUEUES.some((q) => isQueue(queue, q));

/** Queues where an Agent may (re)send the ISO approval email. */
export const isAgentIsoSendableQueue = (queue: unknown): boolean =>
    isAgentReviewQueue(queue) || isQueue(queue, WORKFLOW_QUEUE.APPROVAL_SENT);

/**
 * Queues before ISO approval. Saving an offer here must not jump the deal to Contract Pending —
 * it advances only via send-to-agent-approval → ISO approval.
 */
export const isPreIsoApprovalQueue = (queue: unknown): boolean =>
    isQueue(queue, WORKFLOW_QUEUE.AGENT_DRAFT) ||
    isQueue(queue, WORKFLOW_QUEUE.UNDERWRITER) ||
    isAgentReviewQueue(queue) ||
    isQueue(queue, WORKFLOW_QUEUE.APPROVAL_SENT);

/** List / dashboard buckets per role (GET /applications/workflow/queue?bucket=). */
export const AGENT_BUCKETS = [
    'all',
    'drafts',
    'in_underwriting',
    'awaiting_my_approval',
    'sent_to_iso',
    'contract_pending',
] as const;

export const UNDERWRITER_BUCKETS = [
    'incoming',
    'my_claimed',
    'needs_re_review',
    'sent_to_agent',
    'completed',
] as const;

export type AgentBucket = (typeof AGENT_BUCKETS)[number];
export type UnderwriterBucket = (typeof UNDERWRITER_BUCKETS)[number];
export type WorkflowBucket = AgentBucket | UnderwriterBucket;

/** Queues that count as "past ISO approval" for the Contract Pending bucket. */
export const CONTRACT_STAGE_QUEUES = [
    'Contract Pending',
    'Contract Generated',
    'Contract Sent',
    'Contract Signed',
    'Contracted',
    'Contract Out',
    'Contracts Out',
    'Final',
    'Funding Call',
    'Disbursment',
    'Funded',
] as const;
