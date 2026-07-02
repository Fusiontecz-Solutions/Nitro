import { isAllianceFunderProfile } from './funderProfileResolver';

export const FUNDER_DOCUMENTS_SOURCES = ['platform', 'own', 'shared'] as const;
export type FunderDocumentsSource = (typeof FUNDER_DOCUMENTS_SOURCES)[number];

function normalizeToken(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function normalizeFunderDocumentsSource(
  value?: string | null,
): FunderDocumentsSource {
  const token = normalizeToken(value);
  if (token === 'platform' || token === 'shared') return token;
  return 'own';
}

export function isKatanFunderName(name?: string | null, displayName?: string | null): boolean {
  const n = normalizeToken(name);
  const d = normalizeToken(displayName);
  return n.includes('katan') || d.includes('katan');
}

export function isAllianceFunderName(name?: string | null, displayName?: string | null): boolean {
  return isAllianceFunderProfile({ name, displayName });
}

export function inferDefaultFunderDocumentsSource(input: {
  name?: string | null;
  displayName?: string | null;
  mainContractLayoutKey?: string | null;
}): FunderDocumentsSource {
  if (isKatanFunderName(input.name, input.displayName)) return 'platform';
  return 'own';
}

/** Funder id used for addendum/disclosure layout keys; null = platform templates only. */
export function resolveDocumentsLayoutFunderId(profile: {
  id: string;
  name?: string | null;
  displayName?: string | null;
  mainContractLayoutKey?: string | null;
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
  documentsSource?: string | null;
  sharedDocumentsFunderId?: string | null;
}): string | null {
  const source = normalizeFunderDocumentsSource(profile.documentsSource);
  if (isAllianceFunderProfile(profile)) {
    if (source === 'shared') {
      const sharedId = String(profile.sharedDocumentsFunderId || '').trim();
      return sharedId || profile.id;
    }
    return profile.id;
  }
  if (source === 'platform') return null;
  if (source === 'shared') {
    const sharedId = String(profile.sharedDocumentsFunderId || '').trim();
    return sharedId || profile.id;
  }
  return profile.id;
}

/** True when this funder's settings page should allow uploading addendum/disclosure PDFs. */
export function canManageFunderDocuments(profile: {
  id: string;
  documentsSource?: string | null;
  sharedDocumentsFunderId?: string | null;
}): boolean {
  const source = normalizeFunderDocumentsSource(profile.documentsSource);
  if (source === 'platform') return false;
  const layoutFunderId = resolveDocumentsLayoutFunderId(profile);
  return layoutFunderId === profile.id;
}

const SUPPLEMENTAL_GENERIC_DISPLAY_NAMES: Record<string, string> = {
  flex_addendum: 'Flex Addendum',
  balance_transfer: 'Balance Transfer Sheet',
  ach_authorization: 'ACH Authorization',
  ach_authorization_standalone: 'ACH Authorization',
};

/** Display name for funder-owned supplemental PDFs (avoid Katan platform labels on Alliance sends). */
export function resolveFunderSupplementalDocumentDisplayName(
  supplementalType: string,
  profile: {
    name?: string | null;
    displayName?: string | null;
    documentsSource?: string | null;
  } | null | undefined,
  uploadedName?: string | null,
  platformDefaultName?: string | null,
): string {
  const type = String(supplementalType || '').trim();
  const uploaded = String(uploadedName ?? '').trim();
  const usesPlatform =
    !profile || normalizeFunderDocumentsSource(profile.documentsSource) === 'platform';
  if (usesPlatform) {
    return uploaded || String(platformDefaultName ?? '').trim() || type;
  }
  if (uploaded && !/katan/i.test(uploaded)) {
    return uploaded;
  }
  const generic =
    SUPPLEMENTAL_GENERIC_DISPLAY_NAMES[type] ||
    String(platformDefaultName ?? '')
      .replace(/^Katan[^ ]+\s+/i, '')
      .trim() ||
    type;
  const funderLabel = String(profile?.displayName || profile?.name || '').trim();
  return funderLabel ? `${funderLabel} ${generic}` : generic;
}
