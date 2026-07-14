import prisma from '../../config/prismaClient';
import {
  BOLD_SIGN_TYPE_TO_LAYOUT_KEY,
  DOCUMENT_LAYOUT_KEYS,
  resolveLayoutKeyFromBoldSignType,
  type DocumentLayoutKey,
} from './layouts/document-layout.registry';

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

export function isDocumentLayoutKey(value: string): value is DocumentLayoutKey {
  return LAYOUT_KEY_SET.has(String(value || '').trim());
}

function isValidRemotePdfUrl(url: string): boolean {
  const trimmed = String(url || '').trim();
  if (!trimmed || trimmed.startsWith('platform://')) return false;
  return /^https?:\/\//i.test(trimmed);
}

function layoutKeyMatchScore(
  layoutKey: DocumentLayoutKey,
  row: { layoutKey: string | null; type: string; pdfUrl: string | null },
): number {
  const rowLayoutKey = String(row.layoutKey || '').trim();
  if (rowLayoutKey === layoutKey) return 4;
  if (resolveLayoutKeyFromBoldSignType(row.type) === layoutKey) return 2;
  if (rowLayoutKey && resolveLayoutKeyFromBoldSignType(row.type) === layoutKey) return 3;
  return 0;
}

/** Resolve Cloudinary (or other HTTPS) pdfUrl from BoldSignTemplate for a platform layout key. */
export async function findBoldSignTemplatePdfUrlForLayout(
  layoutKey: DocumentLayoutKey,
): Promise<string | null> {
  const def = PLATFORM_DOCUMENTS[layoutKey];
  const typeVariants = new Set<string>([def.type, layoutKey]);
  for (const [type, key] of Object.entries(BOLD_SIGN_TYPE_TO_LAYOUT_KEY)) {
    if (key === layoutKey) typeVariants.add(type);
  }

  const rows = await prisma.boldSignTemplate.findMany({
    where: {
      OR: [
        { layoutKey },
        { templateId: layoutKey },
        { type: { in: [...typeVariants] } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { pdfUrl: true, layoutKey: true, type: true, templateId: true },
  });

  // Never treat funder-scoped uploads (`funder_<uuid>_…`) as the platform PDF.
  const platformRows = rows.filter((row) => {
    const key = String(row.layoutKey || row.templateId || '').trim().toLowerCase();
    return !key.startsWith('funder_');
  });

  const ranked = [...platformRows].sort(
    (a, b) => layoutKeyMatchScore(layoutKey, b) - layoutKeyMatchScore(layoutKey, a),
  );

  for (const row of ranked) {
    const url = String(row.pdfUrl || '').trim();
    if (isValidRemotePdfUrl(url)) return url;
  }

  // Standalone ACH reuses the same Cloudinary PDF / row as `ach_authorization`.
  if (layoutKey === DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone) {
    return findBoldSignTemplatePdfUrlForLayout(DOCUMENT_LAYOUT_KEYS.achAuthorization);
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

  throw new Error(
    `Missing PDF URL for "${def.name}". Upload the PDF to Cloudinary and set pdfUrl on the BoldSignTemplate row with layoutKey "${layoutKey}".`,
  );
}

export async function loadPlatformDocumentPdfBase64(
  layoutKey: DocumentLayoutKey,
): Promise<string> {
  const def = PLATFORM_DOCUMENTS[layoutKey];
  const fromDb = await findBoldSignTemplatePdfUrlForLayout(layoutKey);
  if (!fromDb) {
    throw new Error(
      `No PDF configured for "${def.name}". Upload to Cloudinary and set BoldSignTemplate.pdfUrl with layoutKey "${layoutKey}".`,
    );
  }
  return fetchRemotePdfAsBase64(fromDb, def.name);
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
