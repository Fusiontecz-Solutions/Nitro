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
    normalized.includes('alliance bridge')
  );
}

export function isTexasContractState(state?: string | null): boolean {
  const normalized = String(state ?? '')
    .trim()
    .toLowerCase();
  return normalized === 'texas' || normalized === 'tx';
}

/** Main contract PDF + coordinate layout for Create Contract / DocuSign send. */
export function resolveMainContractLayoutKey(
  funderName?: string | null,
): DocumentLayoutKey {
  if (isAllianceBridgeFunder(funderName)) {
    return DOCUMENT_LAYOUT_KEYS.allianceBridgeContract;
  }
  return DOCUMENT_LAYOUT_KEYS.contract;
}

/**
 * Authoritative layout key for DocuSign send — prefers the funder profile in DB
 * so a generic "contract" key cannot pull another funder's PDF.
 */
export async function resolveMainContractLayoutKeyForSend(options: {
  mainContractLayoutKey?: string | null;
  funderName?: string | null;
}): Promise<string> {
  const fromClient = String(options.mainContractLayoutKey || '').trim();
  const funderName = String(options.funderName || '').trim();

  if (funderName) {
    const profile = await getFunderProfileByName(funderName);
    if (profile) {
      const profileKey = String(profile.mainContractLayoutKey || '').trim();
      if (isFunderContractLayoutKey(profileKey)) {
        return profileKey;
      }
      if (profileKey && isDocumentLayoutKey(profileKey)) {
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
      if (profileKey) {
        return profileKey;
      }
    }
  }

  if (fromClient) return fromClient;
  return resolveMainContractLayoutKey(funderName);
}
