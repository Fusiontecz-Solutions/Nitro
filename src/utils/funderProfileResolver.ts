import {
  funderAvailableForState,
  isPersistedFunderProfileId,
  pickFunderProfileFromList,
  resolveFunderProfile,
  type SerializedFunderProfile,
} from '../services/funderProfileService';
import prisma from '../config/prismaClient';
import { isAllianceBridgeFunder, isTexasContractState } from '../services/docusign/utils/resolve-main-contract-layout';

export type { SerializedFunderProfile };
export { pickFunderProfileFromList, resolveFunderProfile };

function normalizeFunderToken(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

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

export function resolveDefaultFunderNameForState(
  profiles: Array<{
    name: string;
    displayName?: string | null;
    allowedStates?: string[];
    excludedStates?: string[];
    sortOrder?: number;
    isActive?: boolean;
  }>,
  state?: string | null,
): string | null {
  const normalizedState = normalizeFunderToken(state);
  const active = profiles.filter((p) => p.isActive !== false);

  if (isTexasContractState(normalizedState)) {
    const alliance = active
      .filter((p) => isAllianceFunderProfile(p))
      .filter((p) =>
        funderAvailableForState(
          p.allowedStates ?? [],
          p.excludedStates ?? [],
          normalizedState,
        ),
      )
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    if (alliance[0]?.name) return String(alliance[0].name).trim();
  }

  const katanIi = active.find(
    (p) =>
      normalizeFunderToken(p.name) === 'katan ii' ||
      normalizeFunderToken(p.displayName) === 'katan ii' ||
      normalizeFunderToken(p.name) === 'katan 2' ||
      normalizeFunderToken(p.displayName) === 'katan 2',
  );
  if (katanIi?.name) return String(katanIi.name).trim();

  const fallback = active
    .filter((p) => !isAllianceFunderProfile(p))
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

export function resolveFunderSwitchOnStateChange(options: {
  currentFunderName?: string | null;
  newState?: string | null;
  profiles: Array<{
    name: string;
    displayName?: string | null;
    allowedStates?: string[];
    excludedStates?: string[];
    sortOrder?: number;
    isActive?: boolean;
    mainContractLayoutKey?: string | null;
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
  const enteringTexas = isTexasContractState(pickedState);

  if (enteringTexas) {
    const allianceName = resolveDefaultFunderNameForState(profiles, pickedState);
    if (allianceName) return allianceName;
  }

  if (current && isAllianceFunderProfile(current) && !enteringTexas) {
    return resolveDefaultFunderNameForState(profiles, pickedState);
  }

  if (
    current &&
    !funderAvailableForState(
      current.allowedStates ?? [],
      current.excludedStates ?? [],
      pickedState,
    )
  ) {
    return resolveDefaultFunderNameForState(profiles, pickedState);
  }

  return null;
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
