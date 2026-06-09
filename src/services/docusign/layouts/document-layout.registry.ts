import type { DocumentLayout } from '../utils/convert-docusign-template-export';
import balanceTransferLayout from './balance_transfer.layout.json';
import contractLayout from './contract.layout.json';
import flexAddendumLayout from './flex_addendum.layout.json';

/** Document type keys used with BoldSignTemplate.type and merge order. */
export const DOCUMENT_LAYOUT_KEYS = {
  contract: 'contract',
  balanceTransfer: 'balance_transfer',
  flexAddendum: 'flex_addendum',
} as const;

export type DocumentLayoutKey =
  (typeof DOCUMENT_LAYOUT_KEYS)[keyof typeof DOCUMENT_LAYOUT_KEYS];

/** Maps BoldSignTemplate.type values to coordinate layouts. */
export const BOLD_SIGN_TYPE_TO_LAYOUT_KEY: Record<string, DocumentLayoutKey> = {
  contract: DOCUMENT_LAYOUT_KEYS.contract,
  balance_transfer: DOCUMENT_LAYOUT_KEYS.balanceTransfer,
  addendum: DOCUMENT_LAYOUT_KEYS.flexAddendum,
  flex_addendum: DOCUMENT_LAYOUT_KEYS.flexAddendum,
};

const REGISTRY: Record<DocumentLayoutKey, DocumentLayout> = {
  [DOCUMENT_LAYOUT_KEYS.contract]: contractLayout as DocumentLayout,
  [DOCUMENT_LAYOUT_KEYS.balanceTransfer]: balanceTransferLayout as DocumentLayout,
  [DOCUMENT_LAYOUT_KEYS.flexAddendum]: flexAddendumLayout as DocumentLayout,
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
