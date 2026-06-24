import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFunderProfiles } from "@/redux/actions/integrationSettingsActions";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import { PLATFORM_LAYOUT_KEYS } from "@/components/application/contractdata/platformDocumentConfig";

/** Static fallback when API is empty or unavailable (matches DB seed). */
export const FALLBACK_FUNDER_PROFILES: FunderProfile[] = [
  {
    id: "fallback-katan-ii",
    name: "Katan II",
    displayName: "Katan II",
    dealIdPrefix: "KK",
    assignsDealId: true,
    mainContractLayoutKey: PLATFORM_LAYOUT_KEYS.contract,
    contractPdfFileName: "Contract.pdf",
    allowedStates: [],
    excludedStates: [],
    organization: "Katan II",
    sortOrder: 1,
    isActive: true,
  },
  {
    id: "fallback-katan-iii",
    name: "Katan III",
    displayName: "Katan III",
    dealIdPrefix: "KC",
    assignsDealId: true,
    mainContractLayoutKey: PLATFORM_LAYOUT_KEYS.contract,
    contractPdfFileName: "Contract.pdf",
    allowedStates: [],
    excludedStates: [],
    organization: "Katan III",
    sortOrder: 2,
    isActive: true,
  },
  {
    id: "fallback-alliance-bridge",
    name: "ALLIANCE BRIDGE CAPITAL",
    displayName: "Alliance Bridge Capital",
    assignsDealId: false,
    mainContractLayoutKey: PLATFORM_LAYOUT_KEYS.allianceBridgeContract,
    contractPdfFileName: "ALLIANCE BRIDGE CAPITAL.pdf",
    allowedStates: ["TX", "tx", "Texas", "texas"],
    excludedStates: [],
    sortOrder: 3,
    isActive: true,
  },
];

function normalizeFunderName(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function findFunderProfile(
  funders: FunderProfile[],
  funderName?: string | null,
): FunderProfile | undefined {
  const key = normalizeFunderName(funderName);
  if (!key) return undefined;
  return funders.find(
    (f) =>
      normalizeFunderName(f.name) === key ||
      normalizeFunderName(f.displayName) === key,
  );
}

export function funderAvailableForContractState(
  funder: Pick<FunderProfile, "allowedStates" | "excludedStates">,
  state?: string | null,
): boolean {
  const normalizedState = String(state ?? "")
    .trim()
    .toLowerCase();
  if (!normalizedState) return true;

  const excluded = funder.excludedStates ?? [];
  if (
    excluded.length > 0 &&
    excluded.some((s) => String(s).trim().toLowerCase() === normalizedState)
  ) {
    return false;
  }

  const allowed = funder.allowedStates ?? [];
  if (!allowed.length) return true;
  return allowed.some((s) => String(s).trim().toLowerCase() === normalizedState);
}

export function funderNamesForContractState(
  funders: FunderProfile[],
  state?: string | null,
): string[] {
  return funders
    .filter((f) => {
      if (!f.isActive) return false;
      return funderAvailableForContractState(f, state);
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((f) => f.name);
}

export function resolveMainContractLayoutKeyFromFunders(
  funders: FunderProfile[],
  funderName?: string | null,
): string {
  const profile = findFunderProfile(funders, funderName);
  return profile?.mainContractLayoutKey || PLATFORM_LAYOUT_KEYS.contract;
}

export function contractPreviewNameForFunder(
  funders: FunderProfile[],
  funderName?: string | null,
): string {
  const profile = findFunderProfile(funders, funderName);
  if (profile?.contractPdfFileName) return profile.contractPdfFileName;
  const layoutKey = resolveMainContractLayoutKeyFromFunders(funders, funderName);
  if (layoutKey === PLATFORM_LAYOUT_KEYS.allianceBridgeContract) {
    return "ALLIANCE BRIDGE CAPITAL.pdf";
  }
  return "Contract.pdf";
}

export function funderAssignsDealId(
  funders: FunderProfile[],
  funderName?: string | null,
): boolean {
  const profile = findFunderProfile(funders, funderName);
  return profile?.assignsDealId === true;
}

export function useFunderProfiles(contractState?: string | null) {
  const [funders, setFunders] = useState<FunderProfile[]>(FALLBACK_FUNDER_PROFILES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchFunderProfiles(contractState);
      setFunders(rows.length ? rows : FALLBACK_FUNDER_PROFILES);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load funders");
      setFunders(FALLBACK_FUNDER_PROFILES);
    } finally {
      setLoading(false);
    }
  }, [contractState]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const funderOptions = useMemo(
    () => funderNamesForContractState(funders, contractState),
    [funders, contractState],
  );

  return {
    funders,
    funderOptions,
    loading,
    error,
    reload,
    findFunder: (name?: string | null) => findFunderProfile(funders, name),
    resolveLayoutKey: (name?: string | null) =>
      resolveMainContractLayoutKeyFromFunders(funders, name),
    previewNameFor: (name?: string | null) => contractPreviewNameForFunder(funders, name),
    assignsDealId: (name?: string | null) => funderAssignsDealId(funders, name),
  };
}
