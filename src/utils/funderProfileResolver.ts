import {
  funderAvailableForState,
  funderNamesEquivalent,
  isPersistedFunderProfileId,
  pickFunderProfileFromList,
  resolveFunderProfile,
  type SerializedFunderProfile,
} from '../services/funderProfileService';
import prisma from '../config/prismaClient';
import {
  isAllianceBridgeFunder,
  isTexasFundingGroupFunder,
} from '../services/docusign/utils/resolve-main-contract-layout';
import { CONTRACT_ENVELOPE_LENDER_NAME } from '../utils/contractEnvelopeEmailSubject';

export type { SerializedFunderProfile };
export { pickFunderProfileFromList, resolveFunderProfile };

function normalizeFunderToken(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/** Legacy Alliance Bridge profile matcher (kept for contract CC defaults). */
export function isAllianceFunderProfile(profile: {
  name?: string | null;
  displayName?: string | null;
  mainContractLayoutKey?: string | null;
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
}): boolean {
  return (
    isAllianceBridgeFunder(profile.name) ||
    isAllianceBridgeFunder(profile.displayName) ||
    isAllianceBridgeFunder(profile.organization) ||
    isAllianceBridgeFunder(profile.legalName) ||
    String(profile.name ?? '').toLowerCase().includes('alliance capital') ||
    String(profile.displayName ?? '').toLowerCase().includes('alliance capital') ||
    String(profile.contactEmail ?? '')
      .toLowerCase()
      .includes('@alliancebridgecapital.com') ||
    String(profile.mainContractLayoutKey || '').trim() === 'alliance_bridge_contract'
  );
}

export function isWoodmereFunderProfile(profile: {
  name?: string | null;
  displayName?: string | null;
  organization?: string | null;
  legalName?: string | null;
}): boolean {
  const tokens = [profile.name, profile.displayName, profile.organization, profile.legalName]
    .map(normalizeFunderToken)
    .filter(Boolean);
  return tokens.some(
    (t) =>
      funderNamesEquivalent(t, CONTRACT_ENVELOPE_LENDER_NAME) ||
      (t.includes('harbor view') && !t.includes('texas')) ||
      (t.includes('woodmere') && !t.includes('texas')),
  );
}

export function isTexasFundingGroupFunderProfile(profile: {
  name?: string | null;
  displayName?: string | null;
  mainContractLayoutKey?: string | null;
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
}): boolean {
  if (isWoodmereFunderProfile(profile)) return false;

  return (
    isTexasFundingGroupFunder(profile.name) ||
    isTexasFundingGroupFunder(profile.displayName) ||
    isTexasFundingGroupFunder(profile.organization) ||
    isTexasFundingGroupFunder(profile.legalName) ||
    String(profile.mainContractLayoutKey || '').trim() ===
      'texas_funding_group_contract'
  );
}

export function resolveDefaultFunderNameForState(
  profiles: Array<{
    name: string;
    displayName?: string | null;
    allowedStates?: string[];
    excludedStates?: string[];
    sortOrder?: number;
    isActive?: boolean;
    mainContractLayoutKey?: string | null;
    organization?: string | null;
    legalName?: string | null;
  }>,
  state?: string | null,
): string | null {
  const normalizedState = normalizeFunderToken(state);
  const active = profiles.filter((p) => p.isActive !== false);

  const platform = active.find((p) => isWoodmereFunderProfile(p));
  if (
    platform?.name &&
    funderAvailableForState(
      platform.allowedStates ?? [],
      platform.excludedStates ?? [],
      normalizedState,
    )
  ) {
    return String(platform.name).trim();
  }

  const fallback = active
    .filter((p) =>
      funderAvailableForState(
        p.allowedStates ?? [],
        p.excludedStates ?? [],
        normalizedState,
      ),
    )
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
  return fallback?.name ? String(fallback.name).trim() : null;
}

/**
 * Auto-select funder on contract state change:
 * - Keep current when still allowed for the new state
 * - Otherwise prefer platform/Harbor funder, then first allowed funder
 */
export function resolveFunderSwitchOnStateChange(options: {
  currentFunderName?: string | null;
  previousState?: string | null;
  newState?: string | null;
  profiles: Array<{
    name: string;
    displayName?: string | null;
    allowedStates?: string[];
    excludedStates?: string[];
    sortOrder?: number;
    isActive?: boolean;
    mainContractLayoutKey?: string | null;
    organization?: string | null;
    legalName?: string | null;
  }>;
}): string | null {
  const pickedState = String(options.newState ?? '').trim();
  if (!pickedState) return null;

  const profiles = options.profiles.filter((p) => p.isActive !== false);
  const current = pickFunderProfileFromList(
    profiles as SerializedFunderProfile[],
    options.currentFunderName,
    pickedState,
  );

  if (
    current &&
    funderAvailableForState(
      current.allowedStates ?? [],
      current.excludedStates ?? [],
      pickedState,
    )
  ) {
    return null;
  }

  const next = resolveDefaultFunderNameForState(profiles, pickedState);
  if (!next) return null;
  if (funderNamesEquivalent(next, options.currentFunderName)) return null;
  return next;
}

export async function getFunderWithDocuSignCredentialsResolved(options: {
  funderProfileId?: string | null;
  funderName?: string | null;
  state?: string | null;
}) {
  const profile = await resolveFunderProfile(options);
  if (!profile) return null;

  if (!isPersistedFunderProfileId(profile.id)) {
    return { funder: profile, docusignProfile: null };
  }

  const row = await prisma.funderProfile.findUnique({
    where: { id: profile.id },
    include: { docusignAccountProfile: true },
  });
  if (!row) return null;

  return {
    funder: profile,
    docusignProfile: row.docusignAccountProfile,
  };
}
