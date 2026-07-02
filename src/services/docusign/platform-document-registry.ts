import prisma from '../../config/prismaClient';
import {
  DOCUMENT_LAYOUT_KEYS,
  type DocumentLayoutKey,
} from './layouts/document-layout.registry';

export type PlatformDocumentDefinition = {
  layoutKey: DocumentLayoutKey;
  name: string;
  type: string;
};

export const PLATFORM_SIGNER_SLOTS = [
  { roleIndex: 1, roleName: 'Signer', signerOrder: 1 },
  { roleIndex: 2, roleName: 'Owner 2', signerOrder: 2 },
] as const;

export const PLATFORM_DOCUMENTS: Record<DocumentLayoutKey, PlatformDocumentDefinition> = {
  [DOCUMENT_LAYOUT_KEYS.contract]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.contract,
    name: 'Katan Capital Funding Contract',
    type: 'contract',
  },
  [DOCUMENT_LAYOUT_KEYS.allianceBridgeContract]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.allianceBridgeContract,
    name: 'Alliance Bridge Capital Contract',
    type: 'alliance_bridge_contract',
  },
  [DOCUMENT_LAYOUT_KEYS.flexAddendum]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.flexAddendum,
    name: 'Katan Capital Flex Addendum',
    type: 'flex_addendum',
  },
  [DOCUMENT_LAYOUT_KEYS.balanceTransfer]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.balanceTransfer,
    name: 'Katan Capital Balance Transfer Sheet',
    type: 'balance_transfer',
  },
  [DOCUMENT_LAYOUT_KEYS.achAuthorization]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.achAuthorization,
    name: 'Katan LLC ACH Authorization',
    type: 'ach_authorization',
  },
  [DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone]: {
    layoutKey: DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone,
    name: 'Katan LLC ACH Authorization',
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

/** Same Cloudinary PDF may be registered under the bundled layout key only. */
const PDF_LAYOUT_KEY_FALLBACKS: Partial<Record<DocumentLayoutKey, DocumentLayoutKey>> = {
  [DOCUMENT_LAYOUT_KEYS.achAuthorizationStandalone]: DOCUMENT_LAYOUT_KEYS.achAuthorization,
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
  const direct = await findBoldSignTemplatePdfUrlByExactLayoutKey(layoutKey);
  if (direct) return direct;

  const fallbackKey = PDF_LAYOUT_KEY_FALLBACKS[layoutKey];
  if (fallbackKey) {
    return findBoldSignTemplatePdfUrlByExactLayoutKey(fallbackKey);
  }

  return null;
}

async function findBoldSignTemplateRowForLayout(layoutKey: DocumentLayoutKey) {
  const keysToTry = [layoutKey, PDF_LAYOUT_KEY_FALLBACKS[layoutKey]].filter(
    (key): key is DocumentLayoutKey => Boolean(key),
  );

  for (const key of keysToTry) {
    const row = await prisma.boldSignTemplate.findFirst({
      where: { OR: [{ templateId: key }, { layoutKey: key }] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, layoutKey: true, name: true, type: true },
    });
    if (row?.id) return { row, layoutKey: key };
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

  const resolved = await findBoldSignTemplateRowForLayout(layoutKey);
  if (resolved?.row?.id) {
    const { row, layoutKey: matchedKey } = resolved;
    if (matchedKey === layoutKey) {
      const needsSync =
        row.layoutKey !== layoutKey || row.name !== def.name || row.type !== def.type;
      if (needsSync) {
        await prisma.boldSignTemplate.update({
          where: { id: row.id },
          data: { layoutKey, name: def.name, type: def.type, templateId: layoutKey },
        });
      }
    }
    return row.id;
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
