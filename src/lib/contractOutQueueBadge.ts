/**
 * Shared contract workflow queue/state pill styling for every role and surface.
 */
export const CONTRACT_PENDING_QUEUE_BADGE_CLASS =
  "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";

export const CONTRACT_GENERATED_QUEUE_BADGE_CLASS =
  "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200";

/** Sent / legacy Contract Out — envelope with signer(s). */
export const CONTRACT_OUT_QUEUE_BADGE_CLASS =
  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200";

export const CONTRACT_SENT_QUEUE_BADGE_CLASS = CONTRACT_OUT_QUEUE_BADGE_CLASS;

export const CONTRACT_CANCELLED_QUEUE_BADGE_CLASS =
  "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200";

export function normalizeQueueBadgeLabel(label: string): string {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isContractPendingQueueBadgeLabel(label: string): boolean {
  const n = normalizeQueueBadgeLabel(label);
  return n === "contract pending";
}

export function isContractGeneratedQueueBadgeLabel(label: string): boolean {
  const n = normalizeQueueBadgeLabel(label);
  return n === "contract generated";
}

/** True when the label is Contract Sent or legacy Contract(s) Out. */
export function isContractSentQueueBadgeLabel(label: string): boolean {
  const n = normalizeQueueBadgeLabel(label);
  if (!n || n === "-") return false;
  if (n === "contract sent" || n === "contract out" || n === "contracts out") return true;
  const compact = n.replace(/\s+/g, "");
  return (
    compact === "contractsent" ||
    compact === "contractout" ||
    compact === "contractsout"
  );
}

/** @deprecated Use {@link isContractSentQueueBadgeLabel}. */
export function isContractOutQueueBadgeLabel(label: string): boolean {
  return isContractSentQueueBadgeLabel(label);
}

export function isContractCancelledQueueBadgeLabel(label: string): boolean {
  const n = normalizeQueueBadgeLabel(label);
  return n === "contract cancelled";
}

export function getContractWorkflowQueueBadgeClass(label: string): string | null {
  if (isContractPendingQueueBadgeLabel(label)) return CONTRACT_PENDING_QUEUE_BADGE_CLASS;
  if (isContractGeneratedQueueBadgeLabel(label)) return CONTRACT_GENERATED_QUEUE_BADGE_CLASS;
  if (isContractSentQueueBadgeLabel(label)) return CONTRACT_SENT_QUEUE_BADGE_CLASS;
  if (isContractCancelledQueueBadgeLabel(label)) return CONTRACT_CANCELLED_QUEUE_BADGE_CLASS;
  return null;
}
