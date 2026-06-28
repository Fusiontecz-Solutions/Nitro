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
import { isFunderContractLayoutKey } from '../../../utils/funderContractLayout';
import type { DocumentLayout } from './convert-docusign-template-export';
import {
  buildEnvelopeFromLayouts,
  prefillFieldsToValueMap,
  renderFlattenedLayoutPdf,
  type LayoutSignerInput,
} from './build-envelope-from-layout';
import { fetchPdfAsBase64, resolveTemplateRefForMerge } from './merge-template-resolve';
import { DOCUSIGN_DEFAULT_ROLE_NAME } from './docusign-client';
import { PLATFORM_SIGNER_SLOTS } from '../platform-document-registry';

const DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME =
  process.env.DOCUSIGN_SECONDARY_ROLE_NAME || PLATFORM_SIGNER_SLOTS[1].roleName;

export type DocumentLayoutWithBase64 = DocumentLayout & { documentBase64: string };

export async function loadMainContractLayoutPackage(
  layoutKey: string = DOCUMENT_LAYOUT_KEYS.contract,
): Promise<DocumentLayoutWithBase64> {
  const key = String(layoutKey || '').trim() || DOCUMENT_LAYOUT_KEYS.contract;

  if (isFunderContractLayoutKey(key)) {
    const layout = getDocumentLayout(DOCUMENT_LAYOUT_KEYS.contract);
    const row = await prisma.boldSignTemplate.findFirst({
      where: { OR: [{ layoutKey: key }, { templateId: key }] },
      orderBy: { createdAt: 'desc' },
      select: { pdfUrl: true, name: true },
    });
    const pdfUrl = String(row?.pdfUrl || '').trim();
    if (!pdfUrl) {
      throw new Error('No contract PDF uploaded for this funder.');
    }
    const documentBase64 = await fetchPdfAsBase64(pdfUrl);
    return {
      ...layout,
      key,
      name: row?.name || layout.name,
      documentBase64,
    };
  }

  const platformKey = key as DocumentLayoutKey;
  const layout = getDocumentLayout(platformKey);
  try {
    const documentBase64 = await loadPlatformDocumentPdfBase64(platformKey);
    return { ...layout, documentBase64 };
  } catch {
    if (platformKey !== DOCUMENT_LAYOUT_KEYS.contract) {
      throw new Error(
        `No PDF configured for "${layout.name}". Upload to Cloudinary and set BoldSignTemplate.pdfUrl with layoutKey "${platformKey}".`,
      );
    }
    const latest = await prisma.contractTemplate.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (!latest?.url) {
      throw new Error(
        'No contract PDF configured. Upload a contract PDF from the Underwriter dashboard or set BoldSignTemplate.pdfUrl for layoutKey "contract".',
      );
    }
    const documentBase64 = await fetchPdfAsBase64(latest.url);
    return { ...layout, documentBase64 };
  }
}

/** @deprecated Use loadMainContractLayoutPackage */
export async function loadLatestContractLayoutPackage(): Promise<DocumentLayoutWithBase64> {
  return loadMainContractLayoutPackage(DOCUMENT_LAYOUT_KEYS.contract);
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
  const documentBase64 = await fetchPdfAsBase64(pdfUrl);
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

  const primaryRoleName = PLATFORM_SIGNER_SLOTS[0].roleName;
  const secondaryRoleName = DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME;

  const out: Array<Record<string, unknown>> = [];
  if (primary) {
    out.push({
      ...primary,
      signerRole: primaryRoleName,
      roleName: primaryRoleName,
      signerOrder: 1,
    });
  }
  if (secondary && secondary !== primary) {
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
  /** When false, envelope contains only supplemental layouts (e.g. standalone ACH). */
  includeMainContract?: boolean;
  /** Platform or funder-specific layout key for the main contract PDF. */
  mainContractLayoutKey?: string;
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
  const includeMainContract = options.includeMainContract !== false;
  const layouts: DocumentLayoutWithBase64[] = [];
  if (includeMainContract) {
    layouts.push(
      await loadMainContractLayoutPackage(
        options.mainContractLayoutKey || DOCUMENT_LAYOUT_KEYS.contract,
      ),
    );
  }
  for (const ref of options.supplementalRefs || []) {
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
  let flattenedLayoutCount = 0;
  if (shouldFlatten) {
    for (const layout of layouts) {
      try {
        const buf = await renderFlattenedLayoutPdf(layout, values, partyCounts);
        if (buf?.length) {
          flattenedLayouts.push({
            ...layout,
            documentBase64: buf.toString('base64'),
          });
          flattenedLayoutCount += 1;
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
  const prefillFlattenedInPdf =
    shouldFlatten && layouts.length > 0 && flattenedLayoutCount === layouts.length;

  const envelope = buildEnvelopeFromLayouts({
    layouts: flattenedLayouts,
    values,
    signers,
    ownerCount,
    guarantorCount,
    primaryDocumentName: options.documentName,
    skipTextDateTabs: prefillFlattenedInPdf,
    lockDataTabs: options.lockDataTabs === true,
  });

  const createTimePrefillTabCount = prefillFlattenedInPdf
    ? 0
    : envelope.recipients.signers.reduce(
        (sum, s) =>
          sum +
          (s.tabs?.textTabs?.length || 0) +
          (s.tabs?.dateTabs?.length || 0) +
          (s.tabs?.dateSignedTabs?.length || 0),
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
