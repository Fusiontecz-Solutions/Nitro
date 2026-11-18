import prisma from '../../../config/prismaClient';
import type { DocumentLayout, DocumentLayoutPlacement } from './convert-docusign-template-export';
import {
  ADDENDUM_LAYOUT_DISPLAY_NAMES,
  getAddendumDocumentConfig,
  resolveAddendumDocumentConfigKey,
  resolveAddendumPdfVariant,
  type AddendumDocumentFieldConfig,
  type AddendumPdfVariant,
} from '../addendum-document-config';
import { parseFunderSupplementalLayoutKey } from '../../../utils/funderContractLayout';

function textPlacements(
  config: AddendumDocumentFieldConfig,
  startId: number,
): { placements: DocumentLayoutPlacement[]; nextId: number } {
  const placements: DocumentLayoutPlacement[] = [];
  let id = startId;
  for (const tab of config.textTabs) {
    const variable = tab.tabLabel;
    placements.push({
      id: `ad_text_${id}`,
      type: 'text',
      variable,
      sourceTabLabel: `${variable}_${id}`,
      documentId: config.documentId,
      pageNumber: tab.pageNumber || config.pageNumber,
      x: tab.x,
      y: tab.y,
      width: tab.width && tab.width !== 'auto' ? tab.width : undefined,
      height: tab.height || '18',
      optional: tab.optional === true,
      lockedForSigner: tab.lockedForSigner === true,
      signerParty: 'primary',
    });
    id += 1;
  }
  return { placements, nextId: id };
}

function datePlacements(
  config: AddendumDocumentFieldConfig,
  startId: number,
): { placements: DocumentLayoutPlacement[]; nextId: number } {
  const placements: DocumentLayoutPlacement[] = [];
  let id = startId;
  for (const tab of config.dateTabs) {
    const variable = String(tab.tabLabel || 'signature_date').trim() || 'signature_date';
    placements.push({
      id: `ad_date_${id}`,
      type: 'date',
      variable,
      documentId: config.documentId,
      pageNumber: tab.pageNumber || config.pageNumber,
      x: tab.x,
      y: tab.y,
      height: '18',
      signerParty: tab.signerParty === 'secondary' ? 'secondary' : 'primary',
    });
    id += 1;
  }
  return { placements, nextId: id };
}

function signaturePlacements(
  config: AddendumDocumentFieldConfig,
  startId: number,
): { placements: DocumentLayoutPlacement[]; nextId: number } {
  const placements: DocumentLayoutPlacement[] = [];
  let id = startId;
  for (const tab of config.signHere) {
    placements.push({
      id: `ad_sign_${id}`,
      type: 'signature',
      slot: `signature_${tab.x}_${tab.y}`,
      documentId: config.documentId,
      pageNumber: tab.pageNumber || config.pageNumber,
      x: tab.x,
      y: tab.y,
      width: '140',
      height: '36',
      signerParty: tab.signerParty === 'secondary' ? 'secondary' : 'primary',
    });
    id += 1;
  }
  return { placements, nextId: id };
}

function initialPlacements(
  config: AddendumDocumentFieldConfig,
  startId: number,
): { placements: DocumentLayoutPlacement[]; nextId: number } {
  const placements: DocumentLayoutPlacement[] = [];
  let id = startId;
  for (const tab of config.initialHereTabs || []) {
    placements.push({
      id: `ad_initial_${id}`,
      type: 'initial',
      slot: `initial_${tab.x}_${tab.y}`,
      documentId: config.documentId,
      pageNumber: tab.pageNumber || config.pageNumber,
      x: tab.x,
      y: tab.y,
      width: '80',
      height: '24',
      signerParty: 'primary',
    });
    id += 1;
  }
  return { placements, nextId: id };
}

/** Build a platform `DocumentLayout` from addendum coordinate config. */
export function buildDocumentLayoutFromAddendumDocumentConfig(options: {
  configKey: string;
  config: AddendumDocumentFieldConfig;
  name: string;
  fileName?: string;
}): DocumentLayout {
  const { config, configKey, name, fileName } = options;
  let id = 1;
  const chunks: DocumentLayoutPlacement[] = [];

  const text = textPlacements(config, id);
  chunks.push(...text.placements);
  id = text.nextId;

  const dates = datePlacements(config, id);
  chunks.push(...dates.placements);
  id = dates.nextId;

  const signs = signaturePlacements(config, id);
  chunks.push(...signs.placements);
  id = signs.nextId;

  const initials = initialPlacements(config, id);
  chunks.push(...initials.placements);

  const variables = [
    ...new Set(
      chunks
        .map((p) => String(p.variable || '').trim())
        .filter(Boolean),
    ),
  ];

  return {
    layoutVersion: 1,
    key: configKey,
    name,
    description:
      'Generated from addendum-document-config.ts (disclosures/addendums setup guide)',
    document: {
      documentId: config.documentId,
      originalFileName: fileName || `${name}.pdf`,
    },
    signers: [
      { roleName: 'Client', routingOrder: 1 },
      { roleName: 'Owner 2', routingOrder: 2 },
    ],
    variables,
    placements: chunks,
  };
}

export function buildAddendumDocumentLayout(
  configKey: string,
  variant: AddendumPdfVariant = 'harbor_view',
): DocumentLayout | null {
  const key = resolveAddendumDocumentConfigKey(configKey);
  if (!key || key === 'guarantorAddendum') return null;
  const config = getAddendumDocumentConfig(key, variant);
  if (!config) return null;
  return buildDocumentLayoutFromAddendumDocumentConfig({
    configKey: key,
    config,
    name: ADDENDUM_LAYOUT_DISPLAY_NAMES[key] || key,
  });
}

async function resolveFunderNameFromLayoutKey(
  layoutKey?: string | null,
): Promise<string | null> {
  const parsed = parseFunderSupplementalLayoutKey(String(layoutKey || '').trim());
  if (!parsed?.funderId) return null;
  const row = await prisma.funderProfile.findUnique({
    where: { id: parsed.funderId },
    select: { name: true },
  });
  const name = String(row?.name || '').trim();
  return name || null;
}

export async function tryBuildAddendumLayoutFromDbRow(row: {
  name?: string | null;
  type?: string | null;
  layoutKey?: string | null;
  pdfUrl?: string | null;
  funderName?: string | null;
}): Promise<DocumentLayout | null> {
  const fromType = resolveAddendumDocumentConfigKey(row.type);
  const fromLayout = resolveAddendumDocumentConfigKey(row.layoutKey);
  const configKey = fromType || fromLayout;
  if (!configKey) return null;

  const fileName = String(row.pdfUrl || '')
    .split('/')
    .pop()
    ?.split('?')[0];

  const funderName =
    String(row.funderName || '').trim() ||
    (await resolveFunderNameFromLayoutKey(row.layoutKey)) ||
    null;

  const variant = resolveAddendumPdfVariant({
    funderName,
    name: row.name,
    pdfUrl: row.pdfUrl,
    fileName,
  });

  const config = getAddendumDocumentConfig(configKey, variant);
  if (!config) return null;

  return buildDocumentLayoutFromAddendumDocumentConfig({
    configKey,
    config,
    name:
      String(row.name || '').trim() ||
      ADDENDUM_LAYOUT_DISPLAY_NAMES[configKey] ||
      configKey,
    fileName: fileName || undefined,
  });
}
