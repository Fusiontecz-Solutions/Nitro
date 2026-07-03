import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchFunderProfiles } from "@/redux/actions/integrationSettingsActions";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import { PLATFORM_LAYOUT_KEYS } from "@/components/application/contractdata/platformDocumentConfig";
import {
  funderStateListIncludes,
  isTexasContractState,
  normalizeContractStateToken,
} from "@/utils/usStateMatch";

export {
  funderStateListIncludes,
  isTexasContractState,
  normalizeContractStateToken,
};

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
    documentsSource: "platform",
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
    documentsSource: "platform",
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

/** Omit client-only fallback ids — backend funder profiles use UUID primary keys. */
export function persistedFunderProfileIdForApi(
  profile?: Pick<FunderProfile, "id"> | null,
): string | null {
  const id = String(profile?.id ?? "").trim();
  if (!id || id.startsWith("fallback-")) return null;
  return id;
}

export function funderNamesEquivalent(
  left?: string | null,
  right?: string | null,
): boolean {
  const a = normalizeFunderName(left);
  const b = normalizeFunderName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const katanIi = new Set(["katan ii", "katan 2", "katan2"]);
  const katanIii = new Set(["katan iii", "katan 3", "katan3"]);
  if (katanIi.has(a) && katanIi.has(b)) return true;
  if (katanIii.has(a) && katanIii.has(b)) return true;
  return false;
}

export function pickCanonicalFunderName(
  funders: FunderProfile[],
  rawName?: string | null,
  state?: string | null,
): string {
  const raw = String(rawName ?? "").trim();
  if (!raw) return "";
  const picked = findFunderProfile(funders, raw, state);
  return picked?.name ?? raw;
}

export function isAllianceFunderProfile(
  funder: {
    name?: string | null;
    displayName?: string | null;
    mainContractLayoutKey?: string | null;
    organization?: string | null;
    legalName?: string | null;
    contactEmail?: string | null;
  },
): boolean {
  const name = normalizeFunderName(funder.name);
  const display = normalizeFunderName(funder.displayName);
  const org = normalizeFunderName(funder.organization);
  const legal = normalizeFunderName(funder.legalName);
  const email = String(funder.contactEmail ?? "").toLowerCase();
  return (
    name.includes("alliance bridge") ||
    display.includes("alliance bridge") ||
    org.includes("alliance bridge") ||
    legal.includes("alliance bridge") ||
    name.includes("alliance capital") ||
    display.includes("alliance capital") ||
    org.includes("alliance capital") ||
    legal.includes("alliance capital") ||
    email.includes("@alliancebridgecapital.com") ||
    String(funder.mainContractLayoutKey || "").trim() ===
      PLATFORM_LAYOUT_KEYS.allianceBridgeContract
  );
}

export function findFunderProfile(
  funders: FunderProfile[],
  funderName?: string | null,
  state?: string | null,
): FunderProfile | undefined {
  const key = normalizeFunderName(funderName);
  if (!key) return undefined;

  const matches = funders.filter(
    (f) =>
      funderNamesEquivalent(f.name, key) ||
      funderNamesEquivalent(f.displayName, key),
  );
  if (!matches.length) return undefined;
  if (matches.length === 1) return matches[0];

  const normalizedState = String(state ?? "")
    .trim()
    .toLowerCase();
  if (normalizedState) {
    const forState = matches.filter((f) =>
      funderAvailableForContractState(f, normalizedState),
    );
    if (forState.length === 1) return forState[0];
    if (forState.length > 0) {
      return [...forState].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
    }
  }

  return [...matches].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
}

export function funderAvailableForContractState(
  funder: Pick<FunderProfile, "allowedStates" | "excludedStates">,
  state?: string | null,
): boolean {
  const normalizedState = normalizeContractStateToken(state);
  if (!normalizedState) return true;

  const excluded = funder.excludedStates ?? [];
  if (excluded.length > 0 && funderStateListIncludes(excluded, normalizedState)) {
    return false;
  }

  const allowed = funder.allowedStates ?? [];
  if (!allowed.length) return true;
  return funderStateListIncludes(allowed, normalizedState);
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

export type FunderSelectOption = {
  value: string;
  label: string;
};

export function funderSelectOptionsForState(
  funders: FunderProfile[],
  state?: string | null,
): FunderSelectOption[] {
  const names = funderNamesForContractState(funders, state);
  const labelCounts = new Map<string, number>();
  for (const name of names) {
    const profile = findFunderProfile(funders, name, state);
    const label = formatFunderSelectLabel(profile);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return names.map((name) => {
    const profile = findFunderProfile(funders, name, state)!;
    let label = formatFunderSelectLabel(profile);
    if ((labelCounts.get(label) ?? 0) > 1) {
      const scope =
        (profile.allowedStates ?? []).length > 0
          ? ` (${(profile.allowedStates ?? []).join(", ")})`
          : " (default)";
      label = `${label}${scope}`;
    }
    return { value: name, label };
  });
}

export function formatFunderSelectLabel(
  profile?: Pick<FunderProfile, "name" | "displayName">,
): string {
  if (!profile) return "";
  const display = String(profile.displayName || "").trim();
  if (display) {
    if (normalizeFunderName(display) === "katan ii") return "Katan 2";
    if (normalizeFunderName(display) === "katan iii") return "Katan 3";
    return display;
  }
  if (normalizeFunderName(profile.name) === "katan ii") return "Katan 2";
  if (normalizeFunderName(profile.name) === "katan iii") return "Katan 3";
  return profile.name;
}

export function resolveDefaultFunderNameForState(
  funders: FunderProfile[],
  state?: string | null,
): string {
  const active = funders.filter((f) => f.isActive);
  if (isTexasContractState(state)) {
    const alliance = active
      .filter((f) => isAllianceFunderProfile(f))
      .filter((f) => funderAvailableForContractState(f, state))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (alliance[0]?.name) return alliance[0].name;
  }

  const katanIi = active.find(
    (f) =>
      normalizeFunderName(f.name) === "katan ii" ||
      normalizeFunderName(f.displayName) === "katan ii" ||
      normalizeFunderName(f.name) === "katan 2" ||
      normalizeFunderName(f.displayName) === "katan 2",
  );
  if (katanIi?.name) return katanIi.name;

  const fallback = active
    .filter((f) => !isAllianceFunderProfile(f))
    .filter((f) => funderAvailableForContractState(f, state))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
  return fallback?.name ?? "";
}

export function resolveFunderSwitchOnStateChange(options: {
  currentFunderName?: string | null;
  newState?: string | null;
  funders: FunderProfile[];
}): string | null {
  const pickedState = String(options.newState ?? "").trim();
  if (!pickedState) return null;

  const funders = options.funders.filter((f) => f.isActive);
  const current = findFunderProfile(funders, options.currentFunderName, pickedState);
  const enteringTexas = isTexasContractState(pickedState);

  if (enteringTexas) {
    const allianceName = resolveDefaultFunderNameForState(funders, pickedState);
    if (allianceName) return allianceName;
  }

  if (current && isAllianceFunderProfile(current) && !enteringTexas) {
    return resolveDefaultFunderNameForState(funders, pickedState) || null;
  }

  if (current && !funderAvailableForContractState(current, pickedState)) {
    return resolveDefaultFunderNameForState(funders, pickedState) || null;
  }

  return null;
}

export function resolveMainContractLayoutKeyFromFunders(
  funders: FunderProfile[],
  funderName?: string | null,
  state?: string | null,
): string {
  const profile = findFunderProfile(funders, funderName, state);
  if (!profile) return PLATFORM_LAYOUT_KEYS.contract;

  const profileKey = String(profile.mainContractLayoutKey || "").trim();
  if (profileKey.startsWith("funder_")) {
    return profileKey;
  }

  if (isAllianceFunderProfile(profile)) {
    return isTexasContractState(state)
      ? PLATFORM_LAYOUT_KEYS.allianceBridgeContract
      : profileKey && profileKey !== PLATFORM_LAYOUT_KEYS.allianceBridgeContract
        ? profileKey
        : PLATFORM_LAYOUT_KEYS.contract;
  }

  return profileKey || PLATFORM_LAYOUT_KEYS.contract;
}

export function contractPreviewNameForFunder(
  funders: FunderProfile[],
  funderName?: string | null,
  state?: string | null,
): string {
  const profile = findFunderProfile(funders, funderName, state);
  if (profile?.contractPdfFileName) return profile.contractPdfFileName;
  const layoutKey = resolveMainContractLayoutKeyFromFunders(funders, funderName, state);
  if (layoutKey === PLATFORM_LAYOUT_KEYS.allianceBridgeContract) {
    return "ALLIANCE BRIDGE CAPITAL.pdf";
  }
  return "Contract.pdf";
}

export function funderAssignsDealId(
  funders: FunderProfile[],
  funderName?: string | null,
  state?: string | null,
): boolean {
  const profile = findFunderProfile(funders, funderName, state);
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
      const rows = await fetchFunderProfiles(null);
      setFunders(rows.length ? rows : FALLBACK_FUNDER_PROFILES);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load funders");
      setFunders(FALLBACK_FUNDER_PROFILES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const funderOptions = useMemo(
    () => funderNamesForContractState(funders, contractState),
    [funders, contractState],
  );

  const funderSelectEntries = useMemo(
    () => funderSelectOptionsForState(funders, contractState),
    [funders, contractState],
  );

  return {
    funders,
    funderOptions,
    funderSelectEntries,
    loading,
    error,
    reload,
    findFunder: (name?: string | null) =>
      findFunderProfile(funders, name, contractState),
    resolveLayoutKey: (name?: string | null) =>
      resolveMainContractLayoutKeyFromFunders(funders, name, contractState),
    previewNameFor: (name?: string | null) =>
      contractPreviewNameForFunder(funders, name, contractState),
    assignsDealId: (name?: string | null) =>
      funderAssignsDealId(funders, name, contractState),
    resolveDefaultFunder: () =>
      resolveDefaultFunderNameForState(funders, contractState),
    resolveExpectedFunderForState: (state?: string | null) =>
      resolveDefaultFunderNameForState(funders, state ?? contractState),
    resolveFunderOnStateChange: (currentFunderName: string, newState: string) =>
      resolveFunderSwitchOnStateChange({
        currentFunderName,
        newState,
        funders,
      }),
    pickCanonicalFunderName: (name?: string | null, state?: string | null) =>
      pickCanonicalFunderName(funders, name, state ?? contractState),
  };
}
