import type { FunderProfile } from "@/types/integrationSettingsTypes";
import {
  findFunderProfile,
  funderAvailableForContractState,
  isAllianceFunderProfile,
} from "@/hooks/useFunderProfiles";

export type AchFunderBrand = "katan" | "alliance";

export const ACH_FUNDER_BRAND_OPTIONS: ReadonlyArray<{
  value: AchFunderBrand;
  label: string;
}> = [
  { value: "katan", label: "Katan" },
  { value: "alliance", label: "Alliance" },
];

function normalizeFunderName(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isKatanIiProfile(profile: Pick<FunderProfile, "name" | "displayName">): boolean {
  const name = normalizeFunderName(profile.name);
  const display = normalizeFunderName(profile.displayName);
  return (
    name === "katan ii" ||
    name === "katan 2" ||
    name === "katan2" ||
    display === "katan ii" ||
    display === "katan 2" ||
    display === "katan2"
  );
}

/** Representative Katan funder profile — both Katan funders share the Katan DocuSign account. */
export function resolveKatanFunderProfileName(funders: FunderProfile[]): string {
  const active = funders.filter((f) => f.isActive && !isAllianceFunderProfile(f));
  const katanIi = active.find(isKatanIiProfile);
  if (katanIi?.name) return String(katanIi.name).trim();

  const sorted = [...active].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return sorted[0]?.name ? String(sorted[0].name).trim() : "Katan II";
}

/**
 * Alliance funder for ACH — Texas vs non-Texas profiles share the Alliance DocuSign account
 * but may differ by allowed state.
 */
export function resolveAllianceFunderProfileName(
  funders: FunderProfile[],
  state?: string | null,
): string {
  const active = funders.filter((f) => f.isActive && isAllianceFunderProfile(f));
  const forState = active
    .filter((f) => funderAvailableForContractState(f, state))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  if (forState[0]?.name) return String(forState[0].name).trim();

  const anyAlliance = [...active].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return anyAlliance[0]?.name ? String(anyAlliance[0].name).trim() : "ALLIANCE BRIDGE CAPITAL";
}

export function resolveAchFunderProfileName(
  brand: AchFunderBrand,
  funders: FunderProfile[],
  state?: string | null,
): string {
  return brand === "alliance"
    ? resolveAllianceFunderProfileName(funders, state)
    : resolveKatanFunderProfileName(funders);
}

export function inferAchFunderBrand(
  funderName: string | null | undefined,
  funders: FunderProfile[],
  state?: string | null,
): AchFunderBrand {
  const profile = findFunderProfile(funders, funderName, state);
  if (profile && isAllianceFunderProfile(profile)) return "alliance";
  const name = normalizeFunderName(funderName);
  if (name.includes("alliance bridge")) return "alliance";
  return "katan";
}
