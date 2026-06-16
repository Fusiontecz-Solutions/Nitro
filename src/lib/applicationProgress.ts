/**
 * Canonical application lifecycle used by the application-detail progress bar.
 *
 * The deal moves through these stages in order. We resolve the furthest-reached
 * stage from any of `currentQueue`, `currentState`, or `status`, so the bar
 * reflects real progress even when one field lags behind another.
 *
 * Declined / rejected / cancelled deals are surfaced as a terminal negative
 * state rather than a position on the happy path.
 */

export type ApplicationProgressStageKey =
  | "UNDERWRITER"
  | "FINAL_UNDERWRITER"
  | "APPROVED"
  | "CONTRACT_GENERATED"
  | "CONTRACT_SIGNED"
  | "FINAL"
  | "FUNDING_CALL"
  | "DISBURSEMENT"
  | "FUNDED";

export interface ApplicationProgressStage {
  key: ApplicationProgressStageKey;
  label: string;
  /** Slightly longer description shown on hover / for screen readers. */
  description: string;
}

/** Ordered lifecycle. Index === progress position. */
export const APPLICATION_PROGRESS_STAGES: ApplicationProgressStage[] = [
  { key: "UNDERWRITER", label: "Underwriting", description: "Under review by an underwriter" },
  { key: "FINAL_UNDERWRITER", label: "Final Underwriter", description: "Final underwriter review" },
  { key: "APPROVED", label: "Approved", description: "Approved and ready for contract" },
  {
    key: "CONTRACT_GENERATED",
    label: "Contract Generated",
    description: "Contract has been generated",
  },
  {
    key: "CONTRACT_SIGNED",
    label: "Contract Signed",
    description: "Contract has been signed",
  },
  { key: "FINAL", label: "Final", description: "Final review before funding call" },
  { key: "FUNDING_CALL", label: "Funding Call", description: "Funding call in progress" },
  { key: "DISBURSEMENT", label: "Disbursement", description: "Funds being disbursed" },
  { key: "FUNDED", label: "Funded", description: "Deal funded and complete" },
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
  // Intake / agent (no separate Agent step on the bar — earliest visible stage is Underwriting)
  "": STAGE_INDEX_BY_KEY.UNDERWRITER,
  new: STAGE_INDEX_BY_KEY.UNDERWRITER,
  agent: STAGE_INDEX_BY_KEY.UNDERWRITER,
  onhold: STAGE_INDEX_BY_KEY.UNDERWRITER,
  review: STAGE_INDEX_BY_KEY.UNDERWRITER,
  draft: STAGE_INDEX_BY_KEY.UNDERWRITER,
  pending: STAGE_INDEX_BY_KEY.UNDERWRITER,
  submitted: STAGE_INDEX_BY_KEY.UNDERWRITER,

  // Underwriter
  underwriter: STAGE_INDEX_BY_KEY.UNDERWRITER,
  underwriting: STAGE_INDEX_BY_KEY.UNDERWRITER,
  inprogress: STAGE_INDEX_BY_KEY.UNDERWRITER,

  // Final underwriter
  finalunderwriter: STAGE_INDEX_BY_KEY.FINAL_UNDERWRITER,
  finalreview: STAGE_INDEX_BY_KEY.FINAL_UNDERWRITER,

  // Approved
  approved: STAGE_INDEX_BY_KEY.APPROVED,

  // Contract generated (pending, sent, out, etc.)
  contracted: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,
  contractpending: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,
  contractgenerated: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,
  contractsent: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,
  contractout: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,
  contractsout: STAGE_INDEX_BY_KEY.CONTRACT_GENERATED,

  // Contract signed
  contractsigned: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,
  signedcontracts: STAGE_INDEX_BY_KEY.CONTRACT_SIGNED,

  // Final (ops bucket — distinct from Final Underwriter)
  final: STAGE_INDEX_BY_KEY.FINAL,

  // Funding call
  fundingcall: STAGE_INDEX_BY_KEY.FUNDING_CALL,

  // Disbursement
  disbursment: STAGE_INDEX_BY_KEY.DISBURSEMENT,
  disbursement: STAGE_INDEX_BY_KEY.DISBURSEMENT,

  // Funded
  funded: STAGE_INDEX_BY_KEY.FUNDED,
  completed: STAGE_INDEX_BY_KEY.FUNDED,
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
  /** Rounded percent remaining until funded. */
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
}

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
  ];

  const negativeToken = tokens.find((t) => NEGATIVE_TOKENS.has(t));
  const isNegative = Boolean(negativeToken);

  let currentIndex = 0;
  for (const token of tokens) {
    const idx = indexForToken(token);
    if (idx != null && idx > currentIndex) {
      currentIndex = idx;
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

