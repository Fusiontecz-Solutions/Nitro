import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchFunderProfiles } from "@/redux/actions/integrationSettingsActions";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import {
  PLATFORM_LAYOUT_KEYS,
  TEXAS_FUNDING_GROUP_FUNDER_LABEL,
} from "@/components/application/contractdata/platformDocumentConfig";
import { CONTRACT_ENVELOPE_LENDER_NAME } from "@/components/application/contractdata/docusignTemplateConfig";
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
    id: "fallback-harbor-view-capital",
    name: CONTRACT_ENVELOPE_LENDER_NAME,
    displayName: CONTRACT_ENVELOPE_LENDER_NAME,
    assignsDealId: true,
    mainContractLayoutKey: PLATFORM_LAYOUT_KEYS.contract,
    contractPdfFileName: "Contract.pdf",
    allowedStates: [],
    excludedStates: [],
    organization: CONTRACT_ENVELOPE_LENDER_NAME,
    sortOrder: 1,
    isActive: true,
    documentsSource: "platform",
    addendumDocumentsSource: "platform",
    disclosureDocumentsSource: "platform",
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
  const woodmere = new Set([
    "woodmere financial",
    "woodmere",
    "harbor view capital",
    "harbor view",
  ]);
  const texasFunding = new Set(["texas funding group", "tfg"]);
  if (woodmere.has(a) && woodmere.has(b)) return true;
  if (texasFunding.has(a) && texasFunding.has(b)) return true;
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

export function isWoodmereFunderProfile(
  funder: {
    name?: string | null;
    displayName?: string | null;
    organization?: string | null;
    legalName?: string | null;
  },
): boolean {
  const tokens = [funder.name, funder.displayName, funder.organization, funder.legalName]
    .map((v) => normalizeFunderName(v))
    .filter(Boolean);
  return tokens.some(
    (t) =>
      funderNamesEquivalent(t, CONTRACT_ENVELOPE_LENDER_NAME) ||
      (t.includes("harbor view") && !t.includes("texas")) ||
      (t.includes("woodmere") && !t.includes("texas")),
  );
}

export function isTexasFundingGroupFunderProfile(
  funder: {
    name?: string | null;
    displayName?: string | null;
    mainContractLayoutKey?: string | null;
    organization?: string | null;
    legalName?: string | null;
    contactEmail?: string | null;
  },
): boolean {
  if (isWoodmereFunderProfile(funder)) return false;

  const name = normalizeFunderName(funder.name);
  const display = normalizeFunderName(funder.displayName);
  const org = normalizeFunderName(funder.organization);
  const legal = normalizeFunderName(funder.legalName);
  const layoutKey = String(funder.mainContractLayoutKey || "").trim();
  return (
    name.includes("texas funding group") ||
    display.includes("texas funding group") ||
    org.includes("texas funding group") ||
    legal.includes("texas funding group") ||
    name.includes("texas funding") ||
    display.includes("texas funding") ||
    name === "tfg" ||
    display === "tfg" ||
    layoutKey === "texas_funding_group_contract"
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
      if (f.isActive === false) return false;
      return funderAvailableForContractState(f, state);
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((f) => f.name);
}

export type FunderSelectOption = {
  value: string;
  label: string;
  funderName: string;
};

export function funderSelectOptionsForState(
  funders: FunderProfile[],
  state?: string | null,
): FunderSelectOption[] {
  const profiles = funderProfilesForContractState(funders, state);
  const labelCounts = new Map<string, number>();
  for (const profile of profiles) {
    const label = formatFunderSelectLabel(profile);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return profiles.map((profile) => {
    let label = formatFunderSelectLabel(profile);
    if ((labelCounts.get(label) ?? 0) > 1) {
      const scope =
        (profile.allowedStates ?? []).length > 0
          ? ` (${(profile.allowedStates ?? []).join(", ")})`
          : profile.excludedStates?.length
            ? ` (excl. ${profile.excludedStates.join(", ")})`
            : " (default)";
      label = `${label}${scope}`;
    }
    return {
      value: profile.id,
      label,
      funderName: profile.name,
    };
  });
}

export function formatFunderSelectLabel(
  profile?: Pick<FunderProfile, "name" | "displayName">,
): string {
  if (!profile) return "";
  const display = String(profile.displayName || "").trim();
  if (display) return display;
  return profile.name;
}

/**
 * Prefer the platform/Harbor funder when available for the state; else first active funder.
 * Does not hard-code Texas Funding Group.
 */
export function resolveDefaultFunderNameForState(
  funders: FunderProfile[],
  state?: string | null,
): string {
  const active = funders.filter((f) => f.isActive !== false);

  const platform = findPlatformFunder(active);
  if (platform?.name && funderAvailableForContractState(platform, state)) {
    return platform.name;
  }

  const fallback = active
    .filter((f) => funderAvailableForContractState(f, state))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
  return fallback?.name ?? "";
}

function findPlatformFunder(funders: FunderProfile[]): FunderProfile | undefined {
  return funders.find((f) => isWoodmereFunderProfile(f));
}

/**
 * Auto-select funder on contract state change:
 * - Keep current when still allowed for the new state
 * - Otherwise pick first funder allowed for that state (platform preferred)
 */
export function resolveFunderSwitchOnStateChange(options: {
  currentFunderName?: string | null;
  previousState?: string | null;
  newState?: string | null;
  funders: FunderProfile[];
}): string | null {
  const pickedState = String(options.newState ?? "").trim();
  if (!pickedState) return null;

  const funders = options.funders.filter((f) => f.isActive !== false);
  const current = findFunderProfile(
    funders,
    options.currentFunderName,
    pickedState,
  );

  if (current && funderAvailableForContractState(current, pickedState)) {
    return null;
  }

  const next = resolveDefaultFunderNameForState(funders, pickedState);
  if (!next) return null;
  if (
    funderNamesEquivalent(next, options.currentFunderName) ||
    next === String(options.currentFunderName ?? "").trim()
  ) {
    return null;
  }
  return next;
}

export function findFunderProfileById(
  funders: FunderProfile[],
  funderProfileId?: string | null,
): FunderProfile | undefined {
  const id = String(funderProfileId ?? "").trim();
  if (!id) return undefined;
  return funders.find((f) => f.id === id);
}

export function funderProfilesForContractState(
  funders: FunderProfile[],
  state?: string | null,
): FunderProfile[] {
  return funders
    .filter((f) => {
      if (f.isActive === false) return false;
      return funderAvailableForContractState(f, state);
    })
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function resolveMainContractLayoutKeyFromProfile(
  profile: FunderProfile,
  _state?: string | null,
): string {
  const profileKey = String(profile.mainContractLayoutKey || "").trim();
  if (profileKey.startsWith("funder_")) {
    return profileKey;
  }
  // Deleted platform layouts (texas_funding_group_contract, etc.) map to Harbor contract.
  return PLATFORM_LAYOUT_KEYS.contract;
}

export function resolveMainContractLayoutKeyFromFunders(
  funders: FunderProfile[],
  funderName?: string | null,
  state?: string | null,
  funderProfileId?: string | null,
): string {
  const byId = findFunderProfileById(funders, funderProfileId);
  if (byId) {
    return resolveMainContractLayoutKeyFromProfile(byId, state);
  }

  const profile = findFunderProfile(funders, funderName, state);
  if (!profile) return PLATFORM_LAYOUT_KEYS.contract;

  return resolveMainContractLayoutKeyFromProfile(profile, state);
}

export function contractPreviewNameForFunder(
  funders: FunderProfile[],
  funderName?: string | null,
  state?: string | null,
): string {
  const profile = findFunderProfile(funders, funderName, state);
  if (profile?.contractPdfFileName) return profile.contractPdfFileName;
  return "Contract.pdf";
}

export function resolveContractEnvelopeLenderNameForFunder(
  funders: FunderProfile[],
  funderName?: string | null,
  state?: string | null,
): string {
  const profile = findFunderProfile(funders, funderName, state);
  const fromProfile = String(profile?.displayName || profile?.name || "").trim();
  return fromProfile || CONTRACT_ENVELOPE_LENDER_NAME;
}

export { CONTRACT_ENVELOPE_LENDER_NAME, TEXAS_FUNDING_GROUP_FUNDER_LABEL };

export function funderAssignsDealId(
  funders: FunderProfile[],
  funderName?: string | null,
  state?: string | null,
): boolean {
  const profile = findFunderProfile(funders, funderName, state);
  return profile?.assignsDealId === true;
}

export function useFunderProfiles(contractState?: string | null) {
  const query = useQuery({
    queryKey: ["funder-profiles"],
    queryFn: () => fetchFunderProfiles(null),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const funders =
    query.data && query.data.length > 0
      ? query.data
      : FALLBACK_FUNDER_PROFILES;
  const loading = query.isLoading;
  const error =
    query.error instanceof Error
      ? query.error.message
      : query.error
        ? "Failed to load funders"
        : null;

  const { refetch } = query;
  const reload = useCallback(async () => {
    await refetch();
  }, [refetch]);

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
    findFunderById: (id?: string | null) => findFunderProfileById(funders, id),
    resolveLayoutKey: (name?: string | null, funderProfileId?: string | null) =>
      resolveMainContractLayoutKeyFromFunders(
        funders,
        name,
        contractState,
        funderProfileId,
      ),
    resolveLayoutKeyForProfile: (profile?: FunderProfile | null) =>
      profile
        ? resolveMainContractLayoutKeyFromProfile(profile, contractState)
        : PLATFORM_LAYOUT_KEYS.contract,
    previewNameFor: (name?: string | null, funderProfileId?: string | null) => {
      const profile =
        findFunderProfileById(funders, funderProfileId) ??
        findFunderProfile(funders, name, contractState);
      return contractPreviewNameForFunder(funders, profile?.name ?? name, contractState);
    },
    resolveEnvelopeLenderName: (name?: string | null, state?: string | null) =>
      resolveContractEnvelopeLenderNameForFunder(
        funders,
        name,
        state ?? contractState,
      ),
    assignsDealId: (name?: string | null) =>
      funderAssignsDealId(funders, name, contractState),
    resolveDefaultFunder: () =>
      resolveDefaultFunderNameForState(funders, contractState),
    resolveExpectedFunderForState: (state?: string | null) =>
      resolveDefaultFunderNameForState(funders, state ?? contractState),
    resolveFunderOnStateChange: (
      currentFunderName: string,
      newState: string,
      previousState?: string | null,
    ) =>
      resolveFunderSwitchOnStateChange({
        currentFunderName,
        previousState,
        newState,
        funders,
      }),
    pickCanonicalFunderName: (name?: string | null, state?: string | null) =>
      pickCanonicalFunderName(funders, name, state ?? contractState),
  };
}
