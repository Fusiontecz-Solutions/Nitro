import prisma from '../../../config/prismaClient';
import type { DocumentLayout } from './convert-docusign-template-export';
import {
  getDocumentLayout,
  resolveLayoutKeyFromBoldSignType,
  type DocumentLayoutKey,
} from '../layouts/document-layout.registry';
import {
  buildRecipientTabsByRoleForLayout,
  prefillFieldsToValueMap,
  type LayoutSignerInput,
} from './build-envelope-from-layout';

export type ResolvedMergeTemplate = {
  sourceRef: string;
  name?: string;
  pdfUrl?: string;
  layoutKey?: DocumentLayoutKey;
};

export async function resolveTemplateRefForMerge(
  ref: string,
): Promise<ResolvedMergeTemplate> {
  const sourceRef = String(ref || '').trim();
  if (!sourceRef) {
    throw new Error('Empty template reference');
  }

  const row = await prisma.boldSignTemplate.findFirst({
    where: {
      OR: [{ id: sourceRef }, { templateId: sourceRef }],
    },
  });

  if (row) {
    const layoutFromRow = String(row.layoutKey || '').trim();
    const layoutKey =
      (layoutFromRow as DocumentLayoutKey) ||
      resolveLayoutKeyFromBoldSignType(String(row.type || '')) ||
      undefined;
    const pdfUrl = String(row.pdfUrl || '').trim() || undefined;

    if (!pdfUrl) {
      throw new Error(
        `Template "${row.name}" has no pdfUrl. Upload a PDF to Cloudinary and set pdfUrl on the document template record.`,
      );
    }
    if (!layoutKey) {
      throw new Error(
        `Template "${row.name}" has no layoutKey. Set layoutKey (e.g. flex_addendum) on the document template record.`,
      );
    }

    return {
      sourceRef,
      name: row.name,
      pdfUrl,
      layoutKey,
    };
  }

  throw new Error(
    `Unknown document reference "${sourceRef}". Use a CRM document template row id with pdfUrl and layoutKey.`,
  );
}

export async function fetchPdfAsBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download PDF (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

export function buildPdfCompositeTemplate(options: {
  compositeTemplateId: string;
  envelopeDocumentId: string;
  layout: DocumentLayout;
  documentBase64: string;
  signers: LayoutSignerInput[];
  values: Record<string, string>;
  ownerCount?: number;
  guarantorCount?: number;
}): Record<string, unknown> {
  const tabsByRole = buildRecipientTabsByRoleForLayout(
    options.layout,
    options.envelopeDocumentId,
    options.values,
    options.signers,
    {
      ownerCount: options.ownerCount ?? 1,
      guarantorCount: options.guarantorCount ?? 0,
    },
  );

  const signers = options.signers.map((s, idx) => {
    const tabs = tabsByRole.get(s.roleName) || {
      textTabs: [],
      dateTabs: [],
      signHereTabs: [],
      initialHereTabs: [],
    };
    const hasTabs =
      tabs.textTabs.length +
        tabs.dateTabs.length +
        tabs.signHereTabs.length +
        tabs.initialHereTabs.length >
      0;
    return {
      roleName: s.roleName,
      name: s.name,
      email: s.email,
      recipientId: String(idx + 1),
      routingOrder: String(s.routingOrder ?? idx + 1),
      ...(hasTabs ? { tabs } : {}),
    };
  });

  return {
    compositeTemplateId: options.compositeTemplateId,
    document: {
      documentId: options.envelopeDocumentId,
      name: options.layout.document.originalFileName || options.layout.name,
      documentBase64: options.documentBase64,
    },
    inlineTemplates: [
      {
        sequence: options.compositeTemplateId,
        recipients: { signers },
      },
    ],
  };
}

export async function buildPdfCompositeFromResolved(
  resolved: ResolvedMergeTemplate,
  compositeTemplateId: string,
  envelopeDocumentId: string,
  signers: LayoutSignerInput[],
  prefillFields: Array<{ id: string; value: string }>,
  ownerCount = 1,
  guarantorCount = 0,
): Promise<Record<string, unknown>> {
  if (!resolved.pdfUrl || !resolved.layoutKey) {
    throw new Error(
      `Template "${resolved.name || resolved.sourceRef}" is missing pdfUrl or layoutKey`,
    );
  }
  const layout = getDocumentLayout(resolved.layoutKey);
  const documentBase64 = await fetchPdfAsBase64(resolved.pdfUrl);
  const values = prefillFieldsToValueMap(prefillFields);
  return buildPdfCompositeTemplate({
    compositeTemplateId,
    envelopeDocumentId,
    layout,
    documentBase64,
    signers,
    values,
    ownerCount,
    guarantorCount,
  });
}
