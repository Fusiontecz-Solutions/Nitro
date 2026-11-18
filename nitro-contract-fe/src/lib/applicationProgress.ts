/**
 * Canonical application lifecycle used by the application-detail progress bar.
 *
 * Agent → Underwriter → Agent Review → ISO → contract lifecycle. For the Agent / Underwriter
 * workflow queues the queue is authoritative (a deal returned to underwriting moves back);
 * otherwise we take the furthest stage implied by `currentQueue`, `currentState` or
 * `status`, so the bar reflects real progress even when one field lags behind another.
 *
 * Declined / rejected / cancelled deals are surfaced as a terminal negative
 * state rather than a position on the happy path.
 */

export type ApplicationProgressStageKey =
  | "APPLICATION_ADDED"
  | "UNDERWRITING"
  | "AGENT_REVIEW"
  | "SENT_TO_ISO"
  | "CONTRACT_GENERATED"
  | "CONTRACT_SENT"
  | "CONTRACT_SIGNED";

export interface ApplicationProgressStage {
  key: ApplicationProgressStageKey;
  label: string;
  /** Slightly longer description shown on hover / for screen readers. */
  description: string;
}

/** Ordered lifecycle. Index === progress position. */
export const APPLICATION_PROGRESS_STAGES: ApplicationProgressStage[] = [
  {
    key: "APPLICATION_ADDED",
    label: "Application Added",
    description: "Application has been created",
  },
  {
    key: "UNDERWRITING",
    label: "Underwriting",
    description: "Underwriter scrubs the deal and creates the offer",
  },
  {
    key: "AGENT_REVIEW",
    label: "Agent Review",
    description: "Agent reviews the underwritten offer",
  },
  {
    key: "SENT_TO_ISO",
    label: "Sent to ISO",
    description: "Approval request emailed to the ISO",
  },
  {
    key: "CONTRACT_GENERATED",
    label: "Contract Pending",
    description: "Contract is pending",
  },
  {
    key: "CONTRACT_SENT",
    label: "Contract Sent",
    description: "Contract has been sent to the customer",
  },
  {
    key: "CONTRACT_SIGNED",
    label: "Contract Signed",
    description: "Contract has been signed",
  },
];

const STAGE_INDEX_BY_KEY: Record<ApplicationProgressStageKey, number> =
  APPLICATION_PROGRESS_STAGES.reduce(
    (acc, stage, index) => {
      acc[stage.key] = index;
      return acc;
    },
    {} as Record<ApplicationProgressStageKey, number>,
  );

/** Strip spaces / underscores / dashes and lowercase for tolerant matching. */
function normalizeToken(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/[\s_-]+/g, "")
    .toLowerCase();
}

/** Tokens that mean the deal is dead (no longer on the happy path). */
const NEGATIVE_TOKENS = new Set([
  "declined",
  "rejected",
  "cancelled",
  "canceled",
  "contractcancelled",
  "contractcanceled",
]);

/** Maps a normalized queue/state/status token to its lifecycle index. */
const TOKEN_TO_INDEX: Record<string, number> = {
  // Application added / intake
  "": STAGE_INDEX_BY_KEY.APPLICATION_ADDED,
  new: STAGE_INDEX_BY_KEY.APPLICATION_ADDED,
  agent: STAGE_INDEX_BY_KEY.APPLICATION_ADDED,
  onhold: STAGE_INDEX_BY_KEY.APPLICATION_ADDED,
  draft: STAGE_INDEX_BY_KEY.APPLICATION_ADDED,
  pending: STAGE_INDEX_BY_KEY.APPLICATION_ADDED,
  submitted: STAGE_INDEX_BY_KEY.APPLICATION_ADDED,
  applicationadded: STAGE_INDEX_BY_KEY.APPLICATION_ADDED,

  // Underwriting (scrubbing / underwriting / offer creation)
  review: STAGE_INDEX_BY_KEY.UNDERWRITING,
  scrubbing: STAGE_INDEX_BY_KEY.UNDERWRITING,
  underwriting: STAGE_INDEX_BY_KEY.UNDERWRITING,
  inprogress: STAGE_INDEX_BY_KEY.UNDERWRITING,
  underwriter: STAGE_INDEX_BY_KEY.UNDERWRITING,
  finalreview: STAGE_INDEX_BY_KEY.UNDERWRITING,
  approved: STAGE_INDEX_BY_KEY.UNDERWRITING,
  underwriterapproved: STAGE_INDEX_BY_KEY.UNDERWRITING,

  // Agent review (underwriting handed back to the Agent)
  agentreview: STAGE_INDEX_BY_KEY.AGENT_REVIEW,
  agentapproval: STAGE_INDEX_BY_KEY.AGENT_REVIEW,
  approvedbyuw: STAGE_INDEX_BY_KEY.AGENT_REVIEW,

  // ISO approval requested
  approvalsent: STAGE_INDEX_BY_KEY.SENT_TO_ISO,

  // ISO approved → Contract Pending
  isoapproved: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,
  approvedbyiso: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,

  // Contract generated
  contracted: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,
  contractpending: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,
  contractgenerated: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,

  // Contract sent
  contractsent: STAGE_INDEX_BY_KEY.CONTRACT_SENT,
  contractout: STAGE_INDEX_BY_KEY.CONTRACT_SENT,
  contractsout: STAGE_INDEX_BY_KEY.CONTRACT_SENT,

  // Contract signed — terminal happy path
  contractsigned: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  signedcontracts: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,

  // Legacy post-contract tokens collapse to Contract Signed
  finalapproval: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  finalapprovedbyuw: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  final: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  fundingcall: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  finalsandfundingcall: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  disbursment: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  disbursement: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  funded: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  completed: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
};

export interface ApplicationProgress {
  /** Index into {@link APPLICATION_PROGRESS_STAGES} of the current stage. */
  currentIndex: number;
  currentStageKey: ApplicationProgressStageKey;
  /** Human-readable label for the active stage. */
  currentStageLabel: string;
  /** Completion ratio across the bar (0–1). */
  ratio: number;
  /** Rounded percent complete (current stage counts toward progress). */
  percentComplete: number;
  /** Rounded percent remaining until contract signed. */
  percentRemaining: number;
  /** True when the deal was declined / rejected / cancelled. */
  isNegative: boolean;
  /** Label to show for a negative terminal state (e.g. "Declined"). */
  negativeLabel: string | null;
}

interface ResolveProgressInput {
  currentQueue?: string | null;
  queue?: string | null;
  currentState?: string | null;
  state?: string | null;
  statsCurrentState?: string | null;
  status?: string | null;
  /** "Approved By UW", "Final Approved by UW", etc. */
  underwriterAction?: string | null;
  finalApprovalSource?: string | null;
}

/** Agent / Underwriter workflow queues: when the deal sits in one, that queue decides the stage. */
const AUTHORITATIVE_QUEUE_TOKENS = new Set([
  "agent",
  "new",
  "underwriter",
  "agentreview",
  "agentapproval",
  "approvalsent",
]);

function indexForToken(token: string): number | null {
  if (token in TOKEN_TO_INDEX) return TOKEN_TO_INDEX[token];
  return null;
}

/**
 * Resolve the lifecycle position of an application. We take the furthest stage
 * implied by any workflow field so a lagging field never understates progress.
 */
export function resolveApplicationProgress(
  application: ResolveProgressInput | null | undefined,
): ApplicationProgress {
  const tokens = [
    normalizeToken(application?.currentQueue ?? application?.queue),
    normalizeToken(application?.currentState ?? application?.state),
    normalizeToken(application?.statsCurrentState),
    normalizeToken(application?.status),
    normalizeToken(application?.underwriterAction),
  ];

  const negativeToken = tokens.find((t) => NEGATIVE_TOKENS.has(t));
  const isNegative = Boolean(negativeToken);

  let currentIndex = 0;
  const queueToken = tokens[0];
  const queueIndex = AUTHORITATIVE_QUEUE_TOKENS.has(queueToken) ? indexForToken(queueToken) : null;
  if (queueIndex != null) {
    // e.g. returned to underwriting: `underwriterAction` still says "Approved By UW".
    currentIndex = queueIndex;
  } else {
    for (const token of tokens) {
      const idx = indexForToken(token);
      if (idx != null && idx > currentIndex) {
        currentIndex = idx;
      }
    }
  }

  const stageCount = APPLICATION_PROGRESS_STAGES.length;
  const lastIndex = stageCount - 1;
  const ratio = lastIndex > 0 ? currentIndex / lastIndex : 0;
  const currentStageKey = APPLICATION_PROGRESS_STAGES[currentIndex]!.key;
  const currentStageLabel = APPLICATION_PROGRESS_STAGES[currentIndex]!.label;

  const percentComplete = isNegative
    ? 0
    : Math.round(((currentIndex + 1) / stageCount) * 100);
  const percentRemaining = isNegative ? 100 : 100 - percentComplete;

  return {
    currentIndex,
    currentStageKey,
    currentStageLabel,
    ratio,
    percentComplete,
    percentRemaining,
    isNegative,
    negativeLabel: isNegative
      ? negativeToken === "rejected"
        ? "Rejected"
        : negativeToken?.includes("cancel")
          ? "Cancelled"
          : "Declined"
      : null,
  };
}
