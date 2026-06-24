import type { DocumentLayout } from '../utils/convert-docusign-template-export';
import { convertSimplifiedTabsContractExport } from '../utils/convert-docusign-template-export';
import achAuthorizationLayout from './ach_authorization.layout.json';
import achAuthorizationStandaloneLayout from './ach_authorization_standalone.layout.json';
import allianceBridgeContractExport from './alliance_bridge_contract.json';
import balanceTransferLayout from './balance_transfer.layout.json';
import contractLayout from './contract.layout.json';
import flexAddendumLayout from './flex_addendum.layout.json';

/** Document type keys used with BoldSignTemplate.type and merge order. */
export const DOCUMENT_LAYOUT_KEYS = {
  contract: 'contract',
  allianceBridgeContract: 'alliance_bridge_contract',
  balanceTransfer: 'balance_transfer',
  flexAddendum: 'flex_addendum',
  achAuthorization: 'ach_authorization',
  achAuthorizationStandalone: 'ach_authorization_standalone',
} as const;

export type DocumentLayoutKey =
  (typeof DOCUMENT_LAYOUT_KEYS)[keyof typeof DOCUMENT_LAYOUT_KEYS];

/** Maps BoldSignTemplate.type values to coordinate layouts. */
export const BOLD_SIGN_TYPE_TO_LAYOUT_KEY: Record<string, DocumentLayoutKey> = {
  contract: DOCUMENT_LAYOUT_KEYS.contract,
  alliance_bridge_contract: DOCUMENT_LAYOUT_KEYS.allianceBridgeContract,
  alliance_bridge: DOCUMENT_LAYOUT_KEYS.allianceBridgeContract,
  balance_transfer: DOCUMENT_LAYOUT_KEYS.balanceTransfer,
  addendum: DOCUMENT_LAYOUT_KEYS.flexAddendum,
  flex_addendum: DOCUMENT_LAYOUT_KEYS.flexAddendum,
  ach_authorization: DOCUMENT_LAYOUT_KEYS.achAuthorization,
  ach_authorization_standalone: DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone,
  ach: DOCUMENT_LAYOUT_KEYS.achAuthorization,
  katan_ach_authorization: DOCUMENT_LAYOUT_KEYS.achAuthorization,
};

const allianceBridgeLayout = convertSimplifiedTabsContractExport(
  allianceBridgeContractExport as Record<string, unknown>,
  {
    key: DOCUMENT_LAYOUT_KEYS.allianceBridgeContract,
    name: 'Alliance Bridge Capital Contract',
    pdfFileName: 'ALLIANCE BRIDGE CAPITAL.pdf',
  },
);

const REGISTRY: Record<DocumentLayoutKey, DocumentLayout> = {
  [DOCUMENT_LAYOUT_KEYS.contract]: contractLayout as DocumentLayout,
  [DOCUMENT_LAYOUT_KEYS.allianceBridgeContract]: allianceBridgeLayout,
  [DOCUMENT_LAYOUT_KEYS.balanceTransfer]: balanceTransferLayout as DocumentLayout,
  [DOCUMENT_LAYOUT_KEYS.flexAddendum]: flexAddendumLayout as DocumentLayout,
  [DOCUMENT_LAYOUT_KEYS.achAuthorization]: achAuthorizationLayout as DocumentLayout,
  [DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone]:
    achAuthorizationStandaloneLayout as DocumentLayout,
};

export function getDocumentLayout(key: DocumentLayoutKey): DocumentLayout {
  const layout = REGISTRY[key];
  if (!layout) {
    throw new Error(`Unknown document layout key: ${key}`);
  }
  return layout;
}

export function resolveLayoutKeyFromBoldSignType(type: string): DocumentLayoutKey | null {
  const normalized = String(type || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return BOLD_SIGN_TYPE_TO_LAYOUT_KEY[normalized] || null;
}

/** Default merge order for a full contract package. */
export const DEFAULT_MERGE_LAYOUT_ORDER: DocumentLayoutKey[] = [
  DOCUMENT_LAYOUT_KEYS.contract,
  DOCUMENT_LAYOUT_KEYS.balanceTransfer,
];
