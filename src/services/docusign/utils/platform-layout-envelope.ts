import prisma from '../../../config/prismaClient';
import {
  DOCUMENT_LAYOUT_KEYS,
  getDocumentLayout,
  type DocumentLayoutKey,
} from '../layouts/document-layout.registry';
import {
  isDocumentLayoutKey,
  loadPlatformDocumentPdfBase64,
  normalizeSupplementalLayoutKeys,
} from '../platform-document-registry';
import type { DocumentLayout } from './convert-docusign-template-export';
import {
  buildEnvelopeFromLayouts,
  prefillFieldsToValueMap,
  renderFlattenedLayoutPdf,
  shouldFlattenLayoutPdf,
  assertLayoutPlacementsFitPdfPages,
  type LayoutSignerInput,
} from './build-envelope-from-layout';
import { fetchPdfAsBase64, resolveTemplateRefForMerge } from './merge-template-resolve';
import {
  DOCUSIGN_COMBINE_PACKAGE_PDF,
  DOCUSIGN_DEFAULT_ROLE_NAME,
  DOCUSIGN_SECONDARY_ROLE_NAME,
} from './docusign-client';
import { mergeLayoutPdfsToSingleDocument } from './merge-layout-pdfs';

const DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME = DOCUSIGN_SECONDARY_ROLE_NAME;

export type DocumentLayoutWithBase64 = DocumentLayout & { documentBase64: string };

export async function loadLatestContractLayoutPackage(): Promise<DocumentLayoutWithBase64> {
  const layoutKey = DOCUMENT_LAYOUT_KEYS.contract;
  const layout = getDocumentLayout(layoutKey);
  try {
    const documentBase64 = await loadPlatformDocumentPdfBase64(layoutKey);
    return { ...layout, documentBase64 };
  } catch {
    const latest = await prisma.contractTemplate.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!latest?.url) {
      throw new Error(
        'No contract PDF configured. Upload a contract PDF from the Final Underwriter dashboard or set BoldSignTemplate.pdfUrl for layoutKey "contract".',
      );
    }
    const documentBase64 = await fetchPdfAsBase64(latest.url);
    return { ...layout, documentBase64 };
  }
}

export async function loadSupplementalLayoutPackage(
  ref: string,
): Promise<DocumentLayoutWithBase64> {
  const sourceRef = String(ref || '').trim();
  if (isDocumentLayoutKey(sourceRef)) {
    const layout = getDocumentLayout(sourceRef);
    const documentBase64 = await loadPlatformDocumentPdfBase64(sourceRef);
    return { ...layout, documentBase64 };
  }

  const resolved = await resolveTemplateRefForMerge(sourceRef);
  const layout =
    resolved.inlineLayout ||
    (resolved.layoutKey ? getDocumentLayout(resolved.layoutKey) : null);
  if (!layout) {
    throw new Error(`Supplemental document "${resolved.name || ref}" has no layout.`);
  }
  const pdfUrl = String(resolved.pdfUrl || '').trim();
  if (!pdfUrl || pdfUrl.startsWith('platform://')) {
    throw new Error(
      `Supplemental document "${resolved.name || ref}" is missing a Cloudinary pdfUrl.`,
    );
  }
  const documentBase64 = await fetchPdfAsBase64(pdfUrl, resolved.name || ref);
  if (!documentBase64) {
    throw new Error(`Supplemental document "${resolved.name || ref}" PDF could not be loaded.`);
  }
  return { ...layout, documentBase64 };
}

export function signerRolesToLayoutSigners(
  roles: Array<Record<string, unknown>>,
): LayoutSignerInput[] {
  return roles
    .map((r, idx) => ({
      roleName: String(r.roleName || r.signerRole || `Signer ${idx + 1}`).trim(),
      name: String(r.signerName || '').trim(),
      email: String(r.signerEmail || '').trim(),
      routingOrder: Number(r.signerOrder ?? idx + 1),
    }))
    .filter((s) => s.email);
}

function roleLabelFromRow(row: Record<string, unknown>): string {
  return String(row.roleName || row.signerRole || '').trim();
}

/** Map CRM / template signer rows to DocuSign Client + Owner 2 slots for layout routing. */
export function collapseSignerRolesForLayoutEnvelope(
  roles: Array<Record<string, unknown>>,
  ownerCount: number,
): Array<Record<string, unknown>> {
  const withEmail = roles.filter((r) => String(r.signerEmail || '').trim());
  if (!withEmail.length) return roles;

  const primary =
    withEmail.find((r) => /^client|merchant|customer|receiver/i.test(roleLabelFromRow(r))) ||
    withEmail.find((r) => /^owner$/i.test(roleLabelFromRow(r))) ||
    withEmail.find((r) => /^guarantor$/i.test(roleLabelFromRow(r))) ||
    withEmail[0];

  if (ownerCount < 2) {
    return primary
      ? [
          {
            ...primary,
            signerRole: DOCUSIGN_DEFAULT_ROLE_NAME,
            roleName: DOCUSIGN_DEFAULT_ROLE_NAME,
            signerOrder: 1,
          },
        ]
      : roles;
  }

  let secondary =
    withEmail.find((r) => /owner\s*2/i.test(roleLabelFromRow(r))) ||
    withEmail.find((r) => /guarantor\s*2/i.test(roleLabelFromRow(r)));

  if (!secondary) {
    const primaryEmail = String(primary?.signerEmail || '').trim().toLowerCase();
    const secondaryCandidates = withEmail.filter((r) => {
      if (r === primary) return false;
      const label = roleLabelFromRow(r);
      const email = String(r.signerEmail || '').trim().toLowerCase();
      if (!email || email === primaryEmail) return false;
      return (
        /owner\s*2|guarantor\s*2/i.test(label) ||
        /^owner(\s*2)?$/i.test(label) ||
        /^guarantor(\s*2)?$/i.test(label) ||
        /^signer$/i.test(label)
      );
    });
    secondary =
      secondaryCandidates[secondaryCandidates.length - 1] ||
      withEmail.find((r) => {
        if (r === primary) return false;
        const email = String(r.signerEmail || '').trim().toLowerCase();
        return Boolean(email && email !== primaryEmail);
      }) ||
      withEmail[1];
  }

  const out: Array<Record<string, unknown>> = [];
  if (primary) {
    out.push({
      ...primary,
      signerRole: DOCUSIGN_DEFAULT_ROLE_NAME,
      roleName: DOCUSIGN_DEFAULT_ROLE_NAME,
      signerOrder: 1,
    });
  }
  if (secondary && secondary !== primary) {
    const secondaryRoleName =
      DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME.toLowerCase() ===
      DOCUSIGN_DEFAULT_ROLE_NAME.toLowerCase()
        ? 'Owner 2'
        : DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME;
    out.push({
      ...secondary,
      signerRole: secondaryRoleName,
      roleName: secondaryRoleName,
      signerOrder: 2,
    });
  }
  return out.length ? out : roles;
}

export function countOwnersFromRoles(roles: Array<Record<string, unknown>>): number {
  const distinctEmails = new Set(
    roles
      .map((r) => String(r.signerEmail || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (distinctEmails.size >= 2) return 2;

  let ownerLikeCount = 0;
  let hasExplicitSecond = false;
  for (const r of roles) {
    const roleName = String(r.roleName || r.signerRole || '').trim();
    const email = String(r.signerEmail || '').trim();
    if (!email) continue;
    if (/owner\s*2|guarantor\s*2/i.test(roleName)) {
      hasExplicitSecond = true;
    }
    if (/^owner(\s*2)?$/i.test(roleName) || /guarantor(\s*2)?/i.test(roleName)) {
      ownerLikeCount++;
    }
  }
  if (hasExplicitSecond) return 2;
  return ownerLikeCount > 0 ? Math.min(2, ownerLikeCount) : 1;
}

export function countGuarantorsFromRoles(roles: Array<Record<string, unknown>>): number {
  let count = 0;
  for (const r of roles) {
    const roleName = String(r.roleName || r.signerRole || '').trim();
    if (/^guarantor(\s*2)?$/i.test(roleName) && String(r.signerEmail || '').trim()) {
      count++;
    }
  }
  return Math.min(2, count);
}

/** Normalize supplemental refs to platform layout keys or CRM template row ids (e.g. state disclosure). */
export async function filterSupplementalRefs(refs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    const trimmed = String(ref || '').trim();
    if (!trimmed) continue;
    if (isDocumentLayoutKey(trimmed)) {
      out.push(trimmed);
      continue;
    }

    const row = await prisma.boldSignTemplate.findFirst({
      where: { OR: [{ id: trimmed }, { templateId: trimmed }, { layoutKey: trimmed }] },
      select: { id: true, layoutKey: true, type: true, templateId: true, pdfUrl: true },
    });
    if (row?.id && String(row.pdfUrl || '').trim()) {
      out.push(String(row.id));
      continue;
    }
    const fromRow = String(row?.layoutKey || row?.templateId || '').trim();
    if (isDocumentLayoutKey(fromRow)) {
      out.push(fromRow);
    }
  }
  return [...new Set(out)];
}

export async function resolveSupplementalRefsFromDb(filters: {
  state?: string | null;
  frequency?: string | null;
  type?: string | null;
}): Promise<string[]> {
  const normalize = (value: string | null | undefined) => {
    const v = String(value ?? '').trim().toLowerCase();
    return v || undefined;
  };
  const where: Record<string, string> = {};
  const state = normalize(filters.state);
  const frequency = normalize(filters.frequency);
  const type = normalize(filters.type);
  if (state) where.state = state;
  if (frequency) where.frequency = frequency;
  if (type) where.type = type;

  const rows = await prisma.boldSignTemplate.findMany({
    where,
    select: { id: true, pdfUrl: true },
  });
  return [...new Set(rows.filter((r) => r.pdfUrl).map((r) => r.id))];
}

export async function buildPlatformLayoutEnvelopeDefinition(options: {
  supplementalRefs?: string[];
  /** ACH / other standalone docs — envelope contains only these PDFs (no main contract). */
  standaloneDocumentRefs?: string[];
  /** When false, envelope contains only supplemental layouts (e.g. standalone ACH). */
  includeMainContract?: boolean;
  roles: Array<Record<string, unknown>>;
  prefillFields?: Array<{ id: string; value: string }>;
  ownerCount?: number;
  guarantorCount?: number;
  title?: string;
  message?: string;
  /** Display name for the primary PDF document in the envelope. */
  documentName?: string;
  /** Burn prefill into PDF at create (auto-send). Draft review keeps editable tabs. */
  flattenPrefillInPdf?: boolean;
  lockDataTabs?: boolean;
}) {
  const standaloneRefs = options.standaloneDocumentRefs || [];
  const hasStandaloneOnly = standaloneRefs.length > 0;
  const includeMainContract = hasStandaloneOnly
    ? false
    : options.includeMainContract !== false;
  const layouts: DocumentLayoutWithBase64[] = [];
  if (includeMainContract) {
    layouts.push(await loadLatestContractLayoutPackage());
  }
  for (const ref of options.supplementalRefs || []) {
    layouts.push(await loadSupplementalLayoutPackage(ref));
  }
  for (const ref of standaloneRefs) {
    layouts.push(await loadSupplementalLayoutPackage(ref));
  }
  if (!layouts.length) {
    throw new Error('At least one document layout is required.');
  }

  const ownerCount = options.ownerCount ?? countOwnersFromRoles(options.roles);
  const collapsedRoles = collapseSignerRolesForLayoutEnvelope(options.roles, ownerCount);
  const signers = signerRolesToLayoutSigners(collapsedRoles);
  if (!signers.length) {
    throw new Error('At least one signer with a valid email is required.');
  }
  const guarantorCount =
    options.guarantorCount ??
    (ownerCount >= 2 ? 2 : countGuarantorsFromRoles(options.roles));
  const values = prefillFieldsToValueMap(options.prefillFields || []);
  const partyCounts = { ownerCount, guarantorCount };

  const shouldFlatten = options.flattenPrefillInPdf === true;
  const flattenedLayouts: DocumentLayoutWithBase64[] = [];
  const flattenedLayoutKeys = new Set<string>();
  if (shouldFlatten) {
    for (const layout of layouts) {
      if (!shouldFlattenLayoutPdf(layout)) {
        flattenedLayouts.push(layout);
        continue;
      }
      try {
        const buf = await renderFlattenedLayoutPdf(layout, values, partyCounts);
        if (buf?.length) {
          flattenedLayouts.push({
            ...layout,
            documentBase64: buf.toString('base64'),
          });
          flattenedLayoutKeys.add(layout.key);
          continue;
        }
      } catch (err) {
        console.warn(
          `[DocuSign] flatten prefill into PDF failed for layout "${layout.key}":`,
          err,
        );
      }
      flattenedLayouts.push(layout);
    }
  } else {
    flattenedLayouts.push(...layouts);
  }
  const prefillFlattenedInPdf = flattenedLayoutKeys.size > 0;

  for (const layout of flattenedLayouts) {
    await assertLayoutPlacementsFitPdfPages(layout);
  }

  let mergedDocument: { name: string; documentBase64: string } | undefined;
  let pageOffsetByLayoutKey: Map<string, number> | undefined;
  if (DOCUSIGN_COMBINE_PACKAGE_PDF && flattenedLayouts.length > 1) {
    const merged = await mergeLayoutPdfsToSingleDocument(flattenedLayouts);
    pageOffsetByLayoutKey = merged.pageOffsetByLayoutKey;
    const mergedName =
      String(options.documentName || '').trim() ||
      flattenedLayouts[0].document.originalFileName ||
      flattenedLayouts[0].name ||
      'Contract Package';
    mergedDocument = {
      name: mergedName,
      documentBase64: merged.documentBase64,
    };
    console.log(
      `[DocuSign] combined ${flattenedLayouts.length} layout PDF(s) into one document (${merged.pageCount} pages) for envelope send`,
    );
  }

  const envelope = buildEnvelopeFromLayouts({
    layouts: flattenedLayouts,
    values,
    signers,
    ownerCount,
    guarantorCount,
    primaryDocumentName: options.documentName,
    flattenedLayoutKeys,
    lockDataTabs: options.lockDataTabs === true,
    mergedDocument,
    pageOffsetByLayoutKey,
  });

  const createTimePrefillTabCount = prefillFlattenedInPdf
    ? 0
    : envelope.recipients.signers.reduce(
        (sum, s) =>
          sum +
          (s.tabs?.textTabs?.length || 0) +
          (s.tabs?.dateTabs?.length || 0),
        0,
      );

  return {
    envelopeDefinition: {
      ...envelope,
      emailSubject: options.title || 'Please sign this document',
      emailBlurb: options.message || '',
    },
    createTimePrefillTabCount,
    prefillFlattenedInPdf,
    layoutKeys: layouts.map((l) => l.key),
  };
}
