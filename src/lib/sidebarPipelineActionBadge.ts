/** Next-action hints shown under deal-pipeline sidebar sub-items. */
export const SIDEBAR_PIPELINE_ACTION_HINTS: Partial<Record<string, string>> = {
  Contract_Pending: "Generate Contract",
  Contract_Sent: "Send ACH Form",
};

export type SidebarPipelineActionAccent =
  | "contract-pending"
  | "contract-sent"
  | "contract-signed";

export function getSidebarPipelineActionHint(
  operationsStatus: string,
): string | null {
  return SIDEBAR_PIPELINE_ACTION_HINTS[operationsStatus] ?? null;
}

export function resolveSidebarPipelineActionAccent(
  operationsStatus: string,
): SidebarPipelineActionAccent | null {
  if (operationsStatus === "Contract_Pending") return "contract-pending";
  if (operationsStatus === "Contract_Sent") return "contract-sent";
  if (operationsStatus === "Contract_Signed") return "contract-signed";
  return null;
}

/** Bold action pill colors aligned with each pipeline stage accent. */
export function getSidebarPipelineActionBadgeClass(
  accent: SidebarPipelineActionAccent,
): string {
  switch (accent) {
    case "contract-pending":
      return [
        "bg-sky-100 text-sky-900",
        "dark:bg-sky-900/45 dark:text-sky-100",
      ].join(" ");
    case "contract-sent":
      return [
        "bg-amber-100 text-amber-900",
        "dark:bg-amber-900/45 dark:text-amber-100",
      ].join(" ");
    case "contract-signed":
      return [
        "bg-violet-100 text-violet-900",
        "dark:bg-violet-900/45 dark:text-violet-100",
      ].join(" ");
    default:
      return "bg-muted text-muted-foreground";
  }
}
