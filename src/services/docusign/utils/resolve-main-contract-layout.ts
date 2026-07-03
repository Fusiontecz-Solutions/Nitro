import {
  DOCUMENT_LAYOUT_KEYS,
  type DocumentLayoutKey,
} from '../layouts/document-layout.registry';
import { isDocumentLayoutKey } from '../platform-document-registry';
import { getFunderProfileByName } from '../../funderProfileService';
import {
  funderContractLayoutKey,
  isFunderContractLayoutKey,
} from '../../../utils/funderContractLayout';
import { findBoldSignTemplatePdfUrlByExactLayoutKey } from '../platform-document-registry';
import { isAllianceFunderProfile } from '../../../utils/funderProfileResolver';
import { isTexasContractState as isTexasState } from '../../../utils/usStateMatch';

export const ALLIANCE_BRIDGE_FUNDER_LABEL = 'ALLIANCE BRIDGE CAPITAL';

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

export function isTexasContractState(state?: string | null): boolean {
  return isTexasState(state);
}

/** Coordinate layout for main contract PDF (not necessarily the PDF storage key). */
export function resolveMainContractCoordinateLayoutKey(options: {
  funderName?: string | null;
  state?: string | null;
  mainContractLayoutKey?: string | null;
}): DocumentLayoutKey {
  const profileLayout = String(options.mainContractLayoutKey || '').trim();
  const alliance =
    isAllianceBridgeFunder(options.funderName) ||
    profileLayout === DOCUMENT_LAYOUT_KEYS.allianceBridgeContract;

  if (alliance) {
    return isTexasContractState(options.state)
      ? DOCUMENT_LAYOUT_KEYS.allianceBridgeContract
      : DOCUMENT_LAYOUT_KEYS.contract;
  }
  return DOCUMENT_LAYOUT_KEYS.contract;
}

/** Main contract PDF + coordinate layout for Create Contract / DocuSign send. */
export function resolveMainContractLayoutKey(
  funderName?: string | null,
  state?: string | null,
): DocumentLayoutKey {
  return resolveMainContractCoordinateLayoutKey({ funderName, state });
}

/**
 * Authoritative layout key for DocuSign send — prefers the funder profile in DB
 * so a generic "contract" key cannot pull another funder's PDF.
 */
export async function resolveMainContractLayoutKeyForSend(options: {
  mainContractLayoutKey?: string | null;
  funderName?: string | null;
  state?: string | null;
}): Promise<string> {
  const fromClient = String(options.mainContractLayoutKey || '').trim();
  const funderName = String(options.funderName || '').trim();
  const state = options.state ?? null;

  if (funderName) {
    const profile = await getFunderProfileByName(funderName, state);
    if (profile) {
      const profileKey = String(profile.mainContractLayoutKey || '').trim();
      if (isFunderContractLayoutKey(profileKey)) {
        return profileKey;
      }
      if (profileKey && isDocumentLayoutKey(profileKey)) {
        if (
          profileKey === DOCUMENT_LAYOUT_KEYS.allianceBridgeContract &&
          !isTexasContractState(state)
        ) {
          const funderId = String(profile.id || '').trim();
          if (funderId) {
            const funderScopedKey = funderContractLayoutKey(funderId);
            const scopedPdf = await findBoldSignTemplatePdfUrlByExactLayoutKey(funderScopedKey);
            if (scopedPdf) return funderScopedKey;
          }
          return DOCUMENT_LAYOUT_KEYS.contract;
        }
        return profileKey;
      }
      const funderId = String(profile.id || '').trim();
      if (funderId) {
        const funderScopedKey = funderContractLayoutKey(funderId);
        const scopedPdf = await findBoldSignTemplatePdfUrlByExactLayoutKey(funderScopedKey);
        if (scopedPdf) {
          return funderScopedKey;
        }
      }
      if (isAllianceFunderProfile(profile)) {
        return resolveMainContractCoordinateLayoutKey({
          funderName: profile.name,
          state,
          mainContractLayoutKey: profileKey,
        });
      }
      if (profileKey) {
        return profileKey;
      }
    }
  }

  if (fromClient) {
    if (
      fromClient === DOCUMENT_LAYOUT_KEYS.allianceBridgeContract &&
      !isTexasContractState(state)
    ) {
      return DOCUMENT_LAYOUT_KEYS.contract;
    }
    return fromClient;
  }
  return resolveMainContractLayoutKey(funderName, state);
}
