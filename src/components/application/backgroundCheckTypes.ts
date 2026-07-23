export type BackgroundCheckStatus = "completed" | "pending";

export type BackgroundCheckRisk = "high" | "medium" | "low";

export type BackgroundCheckAttachment = {
  name: string;
  url: string;
  publicId: string;
};

export type BackgroundCheckNoteImage = {
  id: string;
  name: string;
  url: string;
  publicId?: string;
};

/** Screenshot upload or external link attached to NY Court judgements / liens. */
export type BackgroundCheckEvidenceItem = {
  id: string;
  kind: "link" | "image";
  url: string;
  name: string;
  publicId?: string;
};

export type BackgroundCheckItemState = {
  notes: string;
  status?: BackgroundCheckStatus;
  risk?: BackgroundCheckRisk;
  optional?: boolean;
  attachmentName?: string;
  attachmentUrl?: string;
  attachmentPublicId?: string;
  noteImages?: BackgroundCheckNoteImage[];
  /** NY Court — civil judgment evidence (screenshots or links). */
  judgements?: BackgroundCheckEvidenceItem[];
  /** NY Court — lien evidence (screenshots or links). */
  liens?: BackgroundCheckEvidenceItem[];
  savedAt?: string;
  linkOpenedAt?: string;
  /** CLEAR (TLO) search metadata for match/sync UI. */
  clearMetadata?: import("./clearTypes").ClearLookupMetadata | null;
};

export type BackgroundCheckFormState = Record<string, BackgroundCheckItemState>;

export type BackgroundCheckPersistedState = {
  checks: BackgroundCheckFormState;
  savedAt?: string;
};

const LEGACY_COMPLETED_STATUSES = new Set(["pass", "fail", "flag", "na"]);

export function normalizeBackgroundCheckStatus(
  status?: string | null,
): BackgroundCheckStatus | undefined {
  if (status === "completed" || status === "pending") return status;
  if (status && LEGACY_COMPLETED_STATUSES.has(status)) return "completed";
  return undefined;
}

export function isBackgroundCheckCompleted(status?: string | null): boolean {
  return normalizeBackgroundCheckStatus(status) === "completed";
}

export function isBackgroundCheckPending(status?: string | null): boolean {
  const normalized = normalizeBackgroundCheckStatus(status);
  return normalized == null || normalized === "pending";
}

export const BACKGROUND_CHECK_STATUS_OPTIONS: Array<{
  value: BackgroundCheckStatus;
  label: string;
  activeClass: string;
}> = [
  {
    value: "completed",
    label: "Completed",
    activeClass: "bg-[#22C55E] text-white shadow-sm",
  },
  {
    value: "pending",
    label: "Pending",
    activeClass: "bg-[#94A3B8] text-white shadow-sm",
  },
];

export const BACKGROUND_CHECK_RISK_OPTIONS: Array<{
  value: BackgroundCheckRisk;
  label: string;
  selectClass: string;
}> = [
  {
    value: "high",
    label: "High",
    selectClass: "border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C] font-semibold",
  },
  {
    value: "medium",
    label: "Medium",
    selectClass: "border-[#FDE047] bg-[#FEFCE8] text-[#A16207] font-semibold",
  },
  {
    value: "low",
    label: "Low",
    selectClass: "border-[#86EFAC] bg-[#F0FDF4] text-[#15803D] font-semibold",
  },
];
