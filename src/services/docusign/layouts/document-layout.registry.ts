import type { DocumentLayout } from '../utils/convert-docusign-template-export';
import contractLayout from './contract.layout.json';
import { buildAddendumDocumentLayout } from '../utils/addendum-document-layout';

/** Document type keys used with BoldSignTemplate.type and merge order. */
export const DOCUMENT_LAYOUT_KEYS = {
  contract: 'contract',
  addendum_p: 'addendum_p',
  addendum_ca: 'addendum_ca',
  addendum_ny: 'addendum_ny',
  addendum_va: 'addendum_va',
} as const;

export type DocumentLayoutKey =
  (typeof DOCUMENT_LAYOUT_KEYS)[keyof typeof DOCUMENT_LAYOUT_KEYS];

/** Maps BoldSignTemplate.type values to coordinate layouts. */
export const BOLD_SIGN_TYPE_TO_LAYOUT_KEY: Record<string, DocumentLayoutKey> = {
  contract: DOCUMENT_LAYOUT_KEYS.contract,
  addendum_p: DOCUMENT_LAYOUT_KEYS.addendum_p,
  addendum_ca: DOCUMENT_LAYOUT_KEYS.addendum_ca,
  addendum_ny: DOCUMENT_LAYOUT_KEYS.addendum_ny,
  addendum_va: DOCUMENT_LAYOUT_KEYS.addendum_va,
};

function requireAddendumLayout(key: DocumentLayoutKey): DocumentLayout {
  const layout = buildAddendumDocumentLayout(key);
  if (!layout) {
    throw new Error(`Failed to build addendum layout for key: ${key}`);
  }
  return layout;
}

const REGISTRY: Record<DocumentLayoutKey, DocumentLayout> = {
  [DOCUMENT_LAYOUT_KEYS.contract]: contractLayout as DocumentLayout,
  [DOCUMENT_LAYOUT_KEYS.addendum_p]: requireAddendumLayout(
    DOCUMENT_LAYOUT_KEYS.addendum_p,
  ),
  [DOCUMENT_LAYOUT_KEYS.addendum_ca]: requireAddendumLayout(
    DOCUMENT_LAYOUT_KEYS.addendum_ca,
  ),
  [DOCUMENT_LAYOUT_KEYS.addendum_ny]: requireAddendumLayout(
    DOCUMENT_LAYOUT_KEYS.addendum_ny,
  ),
  [DOCUMENT_LAYOUT_KEYS.addendum_va]: requireAddendumLayout(
    DOCUMENT_LAYOUT_KEYS.addendum_va,
  ),
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

/** Default merge order for a full contract package (Harbor MCA is self-contained). */
export const DEFAULT_MERGE_LAYOUT_ORDER: DocumentLayoutKey[] = [
  DOCUMENT_LAYOUT_KEYS.contract,
];
