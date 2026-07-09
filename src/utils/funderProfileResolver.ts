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
  isTexasContractState,
  isTexasFundingGroupFunder,
} from '../services/docusign/utils/resolve-main-contract-layout';
import { DOCUMENT_LAYOUT_KEYS } from '../services/docusign/layouts/document-layout.registry';
import { CONTRACT_ENVELOPE_LENDER_NAME } from '../utils/contractEnvelopeEmailSubject';

export type { SerializedFunderProfile };
export { pickFunderProfileFromList, resolveFunderProfile };

function normalizeFunderToken(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
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
      DOCUMENT_LAYOUT_KEYS.texasFundingGroupContract
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

  const woodmere = active.find((p) => isWoodmereFunderProfile(p));
  if (woodmere?.name) return String(woodmere.name).trim();

  const fallback = active
    .filter((p) => !isTexasFundingGroupFunderProfile(p))
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

  if (current && isWoodmereFunderProfile(current)) {
    return null;
  }

  if (current && isTexasFundingGroupFunderProfile(current) && !enteringTexas) {
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
