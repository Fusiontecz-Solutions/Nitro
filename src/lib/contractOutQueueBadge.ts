/**
 * Shared “Contract out” queue/state pill styling for every role and surface.
 */
export const CONTRACT_OUT_QUEUE_BADGE_CLASS =
  "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200";

export function normalizeQueueBadgeLabel(label: string): string {
  return String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the label is explicitly Contract(s) Out (not generic “Contracted” alone). */
export function isContractOutQueueBadgeLabel(label: string): boolean {
  const n = normalizeQueueBadgeLabel(label);
  if (!n || n === "-") return false;
  if (n === "contract out" || n === "contracts out") return true;
  const compact = n.replace(/\s+/g, "");
  return compact === "contractout" || compact === "contractsout";
}
