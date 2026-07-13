import prisma from '../../config/prismaClient';
import {
  DOCUMENT_LAYOUT_KEYS,
  getDocumentLayout,
  type DocumentLayoutKey,
} from './layouts/document-layout.registry';
import { downloadLegacyDocuSignTemplatePdfBase64 } from './utils/download-legacy-docusign-template-pdf';

export type PlatformDocumentDefinition = {
  layoutKey: DocumentLayoutKey;
  name: string;
  type: string;
};

export const PLATFORM_SIGNER_SLOTS = [
  { roleIndex: 1, roleName: 'Client', signerOrder: 1 },
  { roleIndex: 2, roleName: 'Owner 2', signerOrder: 2 },
] as const;

export const PLATFORM_DOCUMENTS: Record<DocumentLayoutKey, PlatformDocumentDefinition> = {
  [DOCUMENT_LAYOUT_KEYS.contract]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.contract,
    name: 'Woodmere Financial Contract',
    type: 'contract',
  },
  [DOCUMENT_LAYOUT_KEYS.texasFundingGroupContract]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.texasFundingGroupContract,
    name: 'Texas Funding Group Contract',
    type: 'texas_funding_group_contract',
  },
  [DOCUMENT_LAYOUT_KEYS.flexAddendum]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.flexAddendum,
    name: 'Woodmere Flex Addendum',
    type: 'flex_addendum',
  },
  [DOCUMENT_LAYOUT_KEYS.balanceTransfer]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.balanceTransfer,
    name: 'Woodmere Financial Balance Transfer Sheet',
    type: 'balance_transfer',
  },
  [DOCUMENT_LAYOUT_KEYS.achAuthorization]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.achAuthorization,
    name: 'Woodmere Financial ACH Authorization',
    type: 'ach_authorization',
  },
  [DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone,
    name: 'Woodmere Financial ACH Authorization (standalone)',
    type: 'ach_authorization',
  },
};

/** Supplemental documents available in the addendum picker (excludes main contract). */
export const SUPPLEMENTAL_PLATFORM_DOCUMENTS: PlatformDocumentDefinition[] = [
  PLATFORM_DOCUMENTS[DOCUMENT_LAYOUT_KEYS.flexAddendum],
  PLATFORM_DOCUMENTS[DOCUMENT_LAYOUT_KEYS.balanceTransfer],
  PLATFORM_DOCUMENTS[DOCUMENT_LAYOUT_KEYS.achAuthorization],
];

const LAYOUT_KEY_SET = new Set<string>(Object.values(DOCUMENT_LAYOUT_KEYS));

/** When a layout key has no uploaded PDF, also try these sibling keys' uploads. */
const PDF_URL_ALIASES: Partial<Record<DocumentLayoutKey, DocumentLayoutKey[]>> = {
  [DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone]: [
    DOCUMENT_LAYOUT_KEYS.achAuthorization,
  ],
  [DOCUMENT_LAYOUT_KEYS.achAuthorization]: [
    DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone,
  ],
};

export function isDocumentLayoutKey(value: string): value is DocumentLayoutKey {
  return LAYOUT_KEY_SET.has(String(value || '').trim());
}

function isValidRemotePdfUrl(url: string): boolean {
  const trimmed = String(url || '').trim();
  if (!trimmed || trimmed.startsWith('platform://')) return false;
  return /^https?:\/\//i.test(trimmed);
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

  const row = await prisma.boldSignTemplate.findFirst({
    where: {
      OR: [{ layoutKey: key }, { templateId: key }],
    },
    orderBy: { createdAt: 'desc' },
    select: { pdfUrl: true },
  });

  const url = String(row?.pdfUrl || '').trim();
  return isValidRemotePdfUrl(url) ? url : null;
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

async function loadDefaultPdfFromLegacyDocuSign(
  layoutKey: DocumentLayoutKey,
): Promise<string | null> {
  const layout = getDocumentLayout(layoutKey);
  const legacyId = String(layout.legacyDocuSignTemplateId || '').trim();
  if (!legacyId) return null;
  try {
    return await downloadLegacyDocuSignTemplatePdfBase64(legacyId, layout.name);
  } catch (err) {
    console.warn(
      `[platform-docs] Default DocuSign PDF failed for "${layoutKey}" (${legacyId}):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function resolvePlatformDocumentPdfUrl(
  layoutKey: DocumentLayoutKey,
): Promise<string> {
  const def = PLATFORM_DOCUMENTS[layoutKey];
  const fromDb = await findBoldSignTemplatePdfUrlForLayout(layoutKey);
  if (fromDb) return fromDb;

  throw new Error(
    `Missing PDF URL for "${def.name}". Upload the PDF to Cloudinary and set pdfUrl on the BoldSignTemplate row with layoutKey "${layoutKey}", or rely on the default DocuSign template PDF via loadPlatformDocumentPdfBase64.`,
  );
}

/**
 * Load platform document PDF bytes.
 * Priority: uploaded BoldSignTemplate.pdfUrl → sibling layout upload → default DocuSign template PDF.
 * Uploaded PDFs always win; DocuSign defaults are only used when nothing is uploaded.
 */
export async function loadPlatformDocumentPdfBase64(
  layoutKey: DocumentLayoutKey,
): Promise<string> {
  const def = PLATFORM_DOCUMENTS[layoutKey];
  const fromDb = await findBoldSignTemplatePdfUrlForLayout(layoutKey);
  if (fromDb) {
    return fetchRemotePdfAsBase64(fromDb, def.name);
  }

  const fromLegacy = await loadDefaultPdfFromLegacyDocuSign(layoutKey);
  if (fromLegacy) return fromLegacy;

  for (const alias of PDF_URL_ALIASES[layoutKey] ?? []) {
    const aliasLegacy = await loadDefaultPdfFromLegacyDocuSign(alias);
    if (aliasLegacy) return aliasLegacy;
  }

  throw new Error(
    `No PDF configured for "${def.name}". Upload to Cloudinary (BoldSignTemplate.pdfUrl, layoutKey "${layoutKey}") or ensure the default DocuSign template is available.`,
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
    `No document record for "${def.name}" (layoutKey: ${layoutKey}). Create a BoldSignTemplate row with layoutKey "${layoutKey}" and a Cloudinary pdfUrl.`,
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
