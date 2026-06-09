import prisma from '../../../config/prismaClient';
import {
  getDocumentLayout,
  type DocumentLayoutKey,
} from '../layouts/document-layout.registry';
import type { DocumentLayout } from './convert-docusign-template-export';
import {
  buildEnvelopeFromLayouts,
  prefillFieldsToValueMap,
  type LayoutSignerInput,
} from './build-envelope-from-layout';
import { fetchPdfAsBase64, resolveTemplateRefForMerge } from './merge-template-resolve';

export type DocumentLayoutWithBase64 = DocumentLayout & { documentBase64: string };

export async function loadLatestContractLayoutPackage(): Promise<DocumentLayoutWithBase64> {
  const latest = await prisma.contractTemplate.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  if (!latest?.url) {
    throw new Error(
      'No contract PDF uploaded. Upload a contract template PDF from the Final Underwriter dashboard.',
    );
  }
  const layoutKey = (String(latest.layoutKey || 'contract').trim() ||
    'contract') as DocumentLayoutKey;
  const layout = getDocumentLayout(layoutKey);
  const documentBase64 = await fetchPdfAsBase64(latest.url);
  return { ...layout, documentBase64 };
}

export async function loadSupplementalLayoutPackage(
  ref: string,
): Promise<DocumentLayoutWithBase64> {
  const resolved = await resolveTemplateRefForMerge(ref);
  if (!resolved.pdfUrl || !resolved.layoutKey) {
    throw new Error(
      `Supplemental document "${resolved.name || ref}" needs pdfUrl and layoutKey on the document template record.`,
    );
  }
  const layout = getDocumentLayout(resolved.layoutKey);
  const documentBase64 = await fetchPdfAsBase64(resolved.pdfUrl);
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
      ? [{ ...primary, signerRole: 'Client', roleName: 'Client', signerOrder: 1 }]
      : roles;
  }

  let secondary =
    withEmail.find((r) => /owner\s*2/i.test(roleLabelFromRow(r))) ||
    withEmail.find((r) => /guarantor\s*2/i.test(roleLabelFromRow(r)));

  if (!secondary) {
    const primaryEmail = String(primary?.signerEmail || '').trim().toLowerCase();
    secondary =
      withEmail.find((r) => {
        if (r === primary) return false;
        const email = String(r.signerEmail || '').trim().toLowerCase();
        return Boolean(email && email !== primaryEmail);
      }) || withEmail[1];
  }

  const out: Array<Record<string, unknown>> = [];
  if (primary) {
    out.push({ ...primary, signerRole: 'Client', roleName: 'Client', signerOrder: 1 });
  }
  if (secondary && secondary !== primary) {
    out.push({
      ...secondary,
      signerRole: 'Owner 2',
      roleName: 'Owner 2',
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

/** Skip legacy DocuSign template UUIDs that are not stored as BoldSignTemplate rows. */
export async function filterSupplementalRefs(refs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    const trimmed = String(ref || '').trim();
    if (!trimmed) continue;

    const row = await prisma.boldSignTemplate.findFirst({
      where: { OR: [{ id: trimmed }, { templateId: trimmed }] },
      select: { id: true, pdfUrl: true },
    });

    if (row?.pdfUrl) {
      out.push(row.id);
      continue;
    }

    if (row && !row.pdfUrl) {
      throw new Error(
        `Document template "${trimmed}" has no pdfUrl. Upload a PDF to Cloudinary first.`,
      );
    }
    // Ignore unknown DocuSign-only template UUIDs (e.g. legacy VITE_DOCUSIGN_TEMPLATE_ID).
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
  roles: Array<Record<string, unknown>>;
  prefillFields?: Array<{ id: string; value: string }>;
  ownerCount?: number;
  guarantorCount?: number;
  title?: string;
  message?: string;
}) {
  const layouts: DocumentLayoutWithBase64[] = [await loadLatestContractLayoutPackage()];

  for (const ref of options.supplementalRefs || []) {
    layouts.push(await loadSupplementalLayoutPackage(ref));
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

  const envelope = buildEnvelopeFromLayouts({
    layouts,
    values,
    signers,
    ownerCount,
    guarantorCount,
  });

  const createTimePrefillTabCount = envelope.recipients.signers.reduce(
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
    layoutKeys: layouts.map((l) => l.key),
  };
}
