import prisma from '../../config/prismaClient';
import { isPreferredCapitalBranding } from '../../utils/preferredCapitalBranding';
import {
  DOCUMENT_LAYOUT_KEYS,
  getDocumentLayout,
  type DocumentLayoutKey,
} from './layouts/document-layout.registry';
import {
  DOCUSIGN_DEFAULT_ROLE_NAME,
  DOCUSIGN_SECONDARY_ROLE_NAME,
} from './utils/docusign-client';

export type PlatformDocumentDefinition = {
  layoutKey: DocumentLayoutKey;
  name: string;
  type: string;
};

/** Envelope signer slots for code-built layouts — not DocuSign Admin templates. */
export const PLATFORM_SIGNER_SLOTS = [
  { roleIndex: 1, roleName: DOCUSIGN_DEFAULT_ROLE_NAME, signerOrder: 1 },
  { roleIndex: 2, roleName: DOCUSIGN_SECONDARY_ROLE_NAME, signerOrder: 2 },
] as const;

export const PLATFORM_DOCUMENTS: Record<DocumentLayoutKey, PlatformDocumentDefinition> = {
  [DOCUMENT_LAYOUT_KEYS.contract]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.contract,
    name: 'Nitro Advance Contract',
    type: 'contract',
  },
  [DOCUMENT_LAYOUT_KEYS.addendum_p]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.addendum_p,
    name: 'Addendum P (REFI)',
    type: 'addendum_p',
  },
  [DOCUMENT_LAYOUT_KEYS.addendum_ca]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.addendum_ca,
    name: 'Addendum CA',
    type: 'addendum_ca',
  },
  [DOCUMENT_LAYOUT_KEYS.addendum_ny]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.addendum_ny,
    name: 'Addendum NY',
    type: 'addendum_ny',
  },
  [DOCUMENT_LAYOUT_KEYS.addendum_va]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.addendum_va,
    name: 'Addendum VA',
    type: 'addendum_va',
  },
};

/** Supplemental documents available in the addendum picker (excludes main contract). */
export const SUPPLEMENTAL_PLATFORM_DOCUMENTS: PlatformDocumentDefinition[] = [
  PLATFORM_DOCUMENTS[DOCUMENT_LAYOUT_KEYS.addendum_p],
  PLATFORM_DOCUMENTS[DOCUMENT_LAYOUT_KEYS.addendum_ca],
  PLATFORM_DOCUMENTS[DOCUMENT_LAYOUT_KEYS.addendum_ny],
  PLATFORM_DOCUMENTS[DOCUMENT_LAYOUT_KEYS.addendum_va],
];

const LAYOUT_KEY_SET = new Set<string>(Object.values(DOCUMENT_LAYOUT_KEYS));

/** When a layout key has no uploaded PDF, also try these sibling keys' uploads. */
const PDF_URL_ALIASES: Partial<Record<DocumentLayoutKey, DocumentLayoutKey[]>> = {};

export function isDocumentLayoutKey(value: string): value is DocumentLayoutKey {
  return LAYOUT_KEY_SET.has(String(value || '').trim());
}

function isValidRemotePdfUrl(url: string): boolean {
  const trimmed = String(url || '').trim();
  if (!trimmed || trimmed.startsWith('platform://')) return false;
  return /^https?:\/\//i.test(trimmed);
}

async function findLatestNonPcmContractTemplateUrl(): Promise<string | null> {
  const recent = await prisma.contractTemplate.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { url: true, originalName: true },
  });
  for (const row of recent) {
    if (
      isPreferredCapitalBranding(row.originalName) ||
      isPreferredCapitalBranding(row.url)
    ) {
      continue;
    }
    const url = String(row.url || '').trim();
    if (isValidRemotePdfUrl(url)) return url;
  }
  return null;
}

/**
 * Resolve pdfUrl by exact layoutKey / templateId only.
 * Never match by BoldSignTemplate.type — multiple funders share type "contract"
 * and fuzzy matching can return the wrong funder's PDF (legal/compliance risk).
 */
export async function findBoldSignTemplatePdfUrlByExactLayoutKey(
  layoutKey: string,
): Promise<string | null> {
  const key = String(layoutKey || '').trim();
  if (!key) return null;

  const rows = await prisma.boldSignTemplate.findMany({
    where: {
      OR: [{ layoutKey: key }, { templateId: key }],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { pdfUrl: true, name: true, originalFileName: true },
  });

  for (const row of rows) {
    if (
      isPreferredCapitalBranding(row.name) ||
      isPreferredCapitalBranding(row.originalFileName) ||
      isPreferredCapitalBranding(row.pdfUrl)
    ) {
      continue;
    }
    const url = String(row.pdfUrl || '').trim();
    if (isValidRemotePdfUrl(url)) return url;
  }
  return null;
}

/** Resolve Cloudinary (or other HTTPS) pdfUrl from BoldSignTemplate for a platform layout key. */
export async function findBoldSignTemplatePdfUrlForLayout(
  layoutKey: DocumentLayoutKey,
): Promise<string | null> {
  const exact = await findBoldSignTemplatePdfUrlByExactLayoutKey(layoutKey);
  if (exact) return exact;

  for (const alias of PDF_URL_ALIASES[layoutKey] ?? []) {
    const aliased = await findBoldSignTemplatePdfUrlByExactLayoutKey(alias);
    if (aliased) return aliased;
  }
  return null;
}

async function fetchRemotePdfAsBase64(url: string, documentName: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${documentName} PDF (${res.status})`);
  }
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

export async function resolvePlatformDocumentPdfUrl(
  layoutKey: DocumentLayoutKey,
): Promise<string> {
  const def = PLATFORM_DOCUMENTS[layoutKey];
  const fromDb = await findBoldSignTemplatePdfUrlForLayout(layoutKey);
  if (fromDb) return fromDb;

  if (layoutKey === DOCUMENT_LAYOUT_KEYS.contract) {
    const url = await findLatestNonPcmContractTemplateUrl();
    if (url) return url;
  }

  throw new Error(
    `Missing PDF URL for "${def.name}". Upload via Settings → Funders → Upload PDFs (contract / addendum), or Contract Templates.`,
  );
}

/**
 * Load platform document PDF bytes.
 * Priority: BoldSignTemplate.pdfUrl → latest ContractTemplate.url (platform contract only).
 * Never reads local filesystem files.
 */
export async function loadPlatformDocumentPdfBase64(
  layoutKey: DocumentLayoutKey,
): Promise<string> {
  const def = PLATFORM_DOCUMENTS[layoutKey];

  const fromDb = await findBoldSignTemplatePdfUrlForLayout(layoutKey);
  if (fromDb) {
    return fetchRemotePdfAsBase64(fromDb, def.name);
  }

  if (layoutKey === DOCUMENT_LAYOUT_KEYS.contract) {
    const url = await findLatestNonPcmContractTemplateUrl();
    if (url) {
      return fetchRemotePdfAsBase64(url, def.name);
    }
  }

  throw new Error(
    `No PDF configured for "${def.name}". Upload from Settings → Funders → Upload PDFs (addendum / contract), or upload a Contract Template (Cloudinary URL in DB).`,
  );
}

export function normalizeSupplementalLayoutKeys(refs: string[]): DocumentLayoutKey[] {
  const out: DocumentLayoutKey[] = [];
  for (const ref of refs) {
    const key = String(ref || '').trim();
    if (!key) continue;
    if (isDocumentLayoutKey(key)) {
      out.push(key);
      continue;
    }
    throw new Error(
      `Unknown supplemental layout key "${key}". Use one of: ${[...LAYOUT_KEY_SET].join(', ')}`,
    );
  }
  return [...new Set(out)];
}

/** Resolves CRM document row id for a platform layout key (coordinates come from code layouts). */
export async function ensurePlatformBoldSignTemplateRow(
  layoutKey: DocumentLayoutKey,
): Promise<string> {
  const def = PLATFORM_DOCUMENTS[layoutKey];

  const existing = await prisma.boldSignTemplate.findFirst({
    where: { OR: [{ templateId: layoutKey }, { layoutKey }] },
    orderBy: { createdAt: 'desc' },
    select: { id: true, layoutKey: true, name: true, type: true },
  });
  if (existing?.id) {
    const needsSync =
      existing.layoutKey !== layoutKey ||
      existing.name !== def.name ||
      existing.type !== def.type;
    if (needsSync) {
      await prisma.boldSignTemplate.update({
        where: { id: existing.id },
        data: { layoutKey, name: def.name, type: def.type, templateId: layoutKey },
      });
    }
    return existing.id;
  }

  throw new Error(
    `No document record for "${def.name}" (layoutKey: ${layoutKey}). Create a BoldSignTemplate row with layoutKey "${layoutKey}" and a Cloudinary pdfUrl, or upload via Settings → Funders.`,
  );
}

export function getPlatformTemplateRecipients() {
  return {
    success: true,
    source: 'platform-layout',
    roles: PLATFORM_SIGNER_SLOTS.map((slot) => ({
      roleIndex: slot.roleIndex,
      roleName: slot.roleName,
      signerName: '',
      signerEmail: '',
      signerOrder: slot.signerOrder,
    })),
  };
}
