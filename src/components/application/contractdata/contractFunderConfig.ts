import { PLATFORM_LAYOUT_KEYS } from "./platformDocumentConfig";

/** @deprecated Use `useFunderProfiles` — kept for imports that only need Texas check. */
export function isTexasContractState(state?: string | null): boolean {
  const normalized = String(state ?? "")
    .trim()
    .toLowerCase();
  return normalized === "texas" || normalized === "tx";
}

/** @deprecated Use `useFunderProfiles().resolveLayoutKey` */
export function resolveMainContractLayoutKey(funderName?: string | null): string {
  const normalized = String(funderName ?? "")
    .trim()
    .toLowerCase();
  if (normalized.includes("alliance bridge")) {
    return PLATFORM_LAYOUT_KEYS.allianceBridgeContract;
  }
  return PLATFORM_LAYOUT_KEYS.contract;
}

/** @deprecated Use `useFunderProfiles().previewNameFor` */
export function contractPreviewNameForLayoutKey(layoutKey: string): string {
  if (layoutKey === PLATFORM_LAYOUT_KEYS.allianceBridgeContract) {
    return "ALLIANCE BRIDGE CAPITAL.pdf";
  }
  return "Contract.pdf";
}

/** @deprecated Use `useFunderProfiles().funderOptions` */
export const KATAN_FUNDER_OPTIONS = ["Katan II", "Katan III"] as const;

/** @deprecated Use funder profiles from Settings */
export const ALLIANCE_BRIDGE_FUNDER_LABEL = "ALLIANCE BRIDGE CAPITAL";

/** @deprecated Use `useFunderProfiles` */
export function isAllianceBridgeFunder(funderName?: string | null): boolean {
  const normalized = String(funderName ?? "")
    .trim()
    .toLowerCase();
  return normalized.includes("alliance bridge");
}

/** @deprecated Use `useFunderProfiles().funderOptions` */
export function funderOptionsForState(state?: string | null): string[] {
  const base = [...KATAN_FUNDER_OPTIONS];
  if (isTexasContractState(state)) {
    return [...base, ALLIANCE_BRIDGE_FUNDER_LABEL];
  }
  return base;
}
