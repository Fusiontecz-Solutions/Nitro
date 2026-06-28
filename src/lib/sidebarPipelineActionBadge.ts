/** Next-action hints shown under deal-pipeline sidebar sub-items. */
export const SIDEBAR_PIPELINE_ACTION_HINTS: Partial<Record<string, string>> = {
  Approved_By_ISO: "Perform background checks",
  Contract_Signed: "Perform final & funding call",
};

export type SidebarPipelineActionAccent = "approved-by-iso" | "contract-signed";

export function getSidebarPipelineActionHint(
  operationsStatus: string,
): string | null {
  return SIDEBAR_PIPELINE_ACTION_HINTS[operationsStatus] ?? null;
}

export function resolveSidebarPipelineActionAccent(
  operationsStatus: string,
): SidebarPipelineActionAccent | null {
  if (operationsStatus === "Approved_By_ISO") return "approved-by-iso";
  if (operationsStatus === "Contract_Signed") return "contract-signed";
  return null;
}

/** Bold action pill colors aligned with each pipeline stage accent. */
export function getSidebarPipelineActionBadgeClass(
  accent: SidebarPipelineActionAccent,
): string {
  switch (accent) {
    case "approved-by-iso":
      return [
        "bg-violet-100 text-violet-900",
        "dark:bg-violet-900/50 dark:text-violet-100",
        "[data-theme=katan]:bg-[color-mix(in_srgb,var(--brand)_20%,white)]",
        "[data-theme=katan]:text-[var(--brand-mid)]",
        "dark:[data-theme=katan]:bg-[color-mix(in_srgb,var(--brand)_28%,#1a1028)]",
        "dark:[data-theme=katan]:text-violet-100",
      ].join(" ");
    case "contract-signed":
      return [
        "bg-amber-100 text-amber-900",
        "dark:bg-amber-900/45 dark:text-amber-100",
      ].join(" ");
    default:
      return "bg-muted text-muted-foreground";
  }
}
