import {
  DOCUMENT_LAYOUT_KEYS,
  type DocumentLayoutKey,
} from '../layouts/document-layout.registry';
import { isDocumentLayoutKey } from '../platform-document-registry';
import { resolveFunderProfile, isPersistedFunderProfileId } from '../../funderProfileService';
import {
  funderContractLayoutKey,
  isFunderContractLayoutKey,
} from '../../../utils/funderContractLayout';
import { findBoldSignTemplatePdfUrlByExactLayoutKey } from '../platform-document-registry';
import {
  isTexasFundingGroupFunderProfile,
  isWoodmereFunderProfile,
} from '../../../utils/funderProfileResolver';
import { isTexasContractState as isTexasState } from '../../../utils/usStateMatch';

export const TEXAS_FUNDING_GROUP_FUNDER_LABEL = 'TEXAS FUNDING GROUP';

/** @deprecated Legacy Alliance Bridge label — prefer Texas Funding Group. */
export const ALLIANCE_BRIDGE_FUNDER_LABEL = 'ALLIANCE BRIDGE CAPITAL';

/** Legacy deleted layout key — kept for profile / history matching only. */
const LEGACY_TEXAS_FUNDING_GROUP_CONTRACT_LAYOUT = 'texas_funding_group_contract';

export function isTexasContractState(state?: string | null): boolean {
  return isTexasState(state);
}

export function isTexasFundingGroupFunder(funderName?: string | null): boolean {
  const normalized = String(funderName ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!normalized) return false;
  return (
    normalized === 'texas funding group' ||
    normalized.includes('texas funding group')
  );
}

/** Legacy Alliance Bridge name matcher (kept for CC / prefill call sites). */
export function isAllianceBridgeFunder(funderName?: string | null): boolean {
  const normalized = String(funderName ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  if (!normalized) return false;
  return (
    normalized === 'alliance bridge capital' ||
    normalized === 'alliance bridge' ||
    normalized.includes('alliance bridge') ||
    normalized.includes('alliance capital')
  );
}

/**
 * Coordinate layout for main contract PDF.
 * Only the Harbor `contract` layout ships; funder-scoped PDFs still use `funder_<uuid>` storage keys.
 */
export function resolveMainContractCoordinateLayoutKey(_options?: {
  funderName?: string | null;
  state?: string | null;
  mainContractLayoutKey?: string | null;
}): DocumentLayoutKey {
  return DOCUMENT_LAYOUT_KEYS.contract;
}

/** Main contract PDF + coordinate layout for Create Contract / DocuSign send. */
export function resolveMainContractLayoutKey(
  _funderName?: string | null,
  _state?: string | null,
): DocumentLayoutKey {
  return DOCUMENT_LAYOUT_KEYS.contract;
}

/**
 * Authoritative layout key for DocuSign send — prefers the funder profile in DB
 * so a generic "contract" key cannot pull another funder's PDF.
 * Coordinate layout is always `contract`; storage may be `funder_<uuid>`.
 */
export async function resolveMainContractLayoutKeyForSend(options: {
  mainContractLayoutKey?: string | null;
  funderName?: string | null;
  funderProfileId?: string | null;
  state?: string | null;
}): Promise<string> {
  const fromClient = String(options.mainContractLayoutKey || '').trim();
  const state = options.state ?? null;

  if (fromClient && isFunderContractLayoutKey(fromClient)) {
    const scopedPdf = await findBoldSignTemplatePdfUrlByExactLayoutKey(fromClient);
    if (scopedPdf) return fromClient;
  }

  const profile = await resolveFunderProfile({
    funderProfileId: options.funderProfileId,
    funderName: options.funderName,
    state,
  });
  const funderName = String(options.funderName || profile?.name || '').trim();

  if (profile) {
    const funderId = String(profile.id || '').trim();
    if (funderId && isPersistedFunderProfileId(funderId)) {
      const funderScopedKey = funderContractLayoutKey(funderId);
      const scopedPdf = await findBoldSignTemplatePdfUrlByExactLayoutKey(funderScopedKey);
      if (scopedPdf) return funderScopedKey;
    }

    if (isWoodmereFunderProfile(profile)) {
      const profileKey = String(profile.mainContractLayoutKey || '').trim();
      if (isFunderContractLayoutKey(profileKey)) {
        return profileKey;
      }
      return DOCUMENT_LAYOUT_KEYS.contract;
    }

    const profileKey = String(profile.mainContractLayoutKey || '').trim();
    if (isFunderContractLayoutKey(profileKey)) {
      return profileKey;
    }
    if (profileKey && isDocumentLayoutKey(profileKey)) {
      return profileKey;
    }
    if (funderId) {
      const funderScopedKey = funderContractLayoutKey(funderId);
      const scopedPdf = await findBoldSignTemplatePdfUrlByExactLayoutKey(funderScopedKey);
      if (scopedPdf) {
        return funderScopedKey;
      }
    }
    // Legacy profile keys (e.g. texas_funding_group_contract) resolve to platform contract.
    if (
      profileKey === LEGACY_TEXAS_FUNDING_GROUP_CONTRACT_LAYOUT ||
      isTexasFundingGroupFunderProfile(profile)
    ) {
      return DOCUMENT_LAYOUT_KEYS.contract;
    }
    if (profileKey) {
      return isDocumentLayoutKey(profileKey)
        ? profileKey
        : DOCUMENT_LAYOUT_KEYS.contract;
    }
  }

  if (fromClient) {
    if (
      fromClient === LEGACY_TEXAS_FUNDING_GROUP_CONTRACT_LAYOUT ||
      (funderName && isWoodmereFunderProfile({ name: funderName }))
    ) {
      return DOCUMENT_LAYOUT_KEYS.contract;
    }
    if (isDocumentLayoutKey(fromClient) || isFunderContractLayoutKey(fromClient)) {
      return fromClient;
    }
    return DOCUMENT_LAYOUT_KEYS.contract;
  }
  return resolveMainContractLayoutKey(funderName, state);
}
