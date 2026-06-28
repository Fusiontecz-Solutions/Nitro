/** Underwriter sidebar pipeline filters — must match backend `underwriterPipelineFilter`. */
export const UNDERWRITER_PIPELINE_FILTERS = {
  /** Underwriter queue — available to claim. */
  UNCLAIMED: "unclaimed",
  CLAIMED: "claimed",
  APPROVED_BY_UW: "approved-by-uw",
  DECLINED_BY_UW: "declined-by-uw",
  FINAL_APPROVAL: "final-approval",
  FINAL_APPROVED_BY_UW: "final-approved-by-uw",
} as const;

export type UnderwriterPipelineFilter =
  (typeof UNDERWRITER_PIPELINE_FILTERS)[keyof typeof UNDERWRITER_PIPELINE_FILTERS];

const ALLOWED = new Set<string>(Object.values(UNDERWRITER_PIPELINE_FILTERS));

export function normalizeUnderwriterPipelineParam(
  raw: string | null | undefined,
): UnderwriterPipelineFilter | undefined {
  if (!raw?.trim()) return undefined;
  const value = raw.trim().toLowerCase();
  return ALLOWED.has(value) ? (value as UnderwriterPipelineFilter) : undefined;
}

export function underwriterPipelineTitle(
  pipeline: UnderwriterPipelineFilter,
): string {
  switch (pipeline) {
    case UNDERWRITER_PIPELINE_FILTERS.CLAIMED:
      return "Claimed Applications";
    case UNDERWRITER_PIPELINE_FILTERS.APPROVED_BY_UW:
      return "Approved";
    case UNDERWRITER_PIPELINE_FILTERS.DECLINED_BY_UW:
      return "Decline";
    case UNDERWRITER_PIPELINE_FILTERS.FINAL_APPROVAL:
      return "Admin Sent for final Approval";
    case UNDERWRITER_PIPELINE_FILTERS.FINAL_APPROVED_BY_UW:
      return "Final Approved";
    default:
      return "Applications";
  }
}

export type UnderwriterPipelineCounts = Record<UnderwriterPipelineFilter, number>;
