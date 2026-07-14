import prisma from '../../../config/prismaClient';
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
import { isAllianceFunderProfile } from '../../../utils/funderProfileResolver';
import { isTexasContractState as isTexasState } from '../../../utils/usStateMatch';

export const ALLIANCE_BRIDGE_FUNDER_LABEL = 'ALLIANCE BRIDGE CAPITAL';

/**
 * Layout-key token for the Alliance Bridge contract. The platform coordinate
 * registry intentionally does not ship Alliance coordinates, so this token is
 * only used for detection — Alliance contracts fall back to the standard
 * `contract` coordinate layout.
 */
const ALLIANCE_BRIDGE_CONTRACT_LAYOUT_KEY = 'alliance_bridge_contract';

/** Exact-match BoldSignTemplate pdfUrl lookup by layout/template key. */
async function findBoldSignTemplatePdfUrlByExactLayoutKey(
  layoutKey: string,
): Promise<string | null> {
  const trimmed = String(layoutKey || '').trim();
  if (!trimmed) return null;
  const row = await prisma.boldSignTemplate.findFirst({
    where: { OR: [{ layoutKey: trimmed }, { templateId: trimmed }] },
    orderBy: { createdAt: 'desc' },
    select: { pdfUrl: true },
  });
  const url = String(row?.pdfUrl || '').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

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
  // Alliance Bridge coordinates are not part of the platform registry, so all
  // funders (including Alliance) use the standard contract coordinate layout.
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
        // Platform coordinate layout keys are used as-is (no Alliance-specific
        // layout ships in the platform registry).
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
      fromClient === ALLIANCE_BRIDGE_CONTRACT_LAYOUT_KEY &&
      !isTexasContractState(state)
    ) {
      return DOCUMENT_LAYOUT_KEYS.contract;
    }
    return fromClient;
  }
  return resolveMainContractLayoutKey(funderName, state);
}
