import prisma from '../../../config/prismaClient';
import {
  SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID,
  extractSignNowTemplateId,
  isSignNowConfigured,
} from './signnow-client';
import { getSignNowSupplementalTemplates } from './signnow-addendum-templates';
import {
  readStoredTemplatePdfArchive,
  type TemplatePdfIdentity,
} from './signnow-template-pdf-archive';

/**
 * One-time migration of template PDFs that predate the archive.
 *
 * Templates reach the CRM from three places — the env-configured catalog, the
 * per-funder links in Settings → Funders, and the `BoldSignTemplate` rows those
 * two sync into. This module collects all of them generically by SignNow
 * template id, so main contracts, addenda, disclosures and exhibits are covered
 * by the same pass and a new template type needs no change here.
 */

function pushIdentity(
  out: Map<string, TemplatePdfIdentity>,
  identity: TemplatePdfIdentity | null,
): void {
  if (!identity) return;
  const id = extractSignNowTemplateId(identity.signnowTemplateId);
  if (!id) return;
  const existing = out.get(id);
  if (existing) {
    // Keep the richest labelling we have seen for this template.
    out.set(id, {
      signnowTemplateId: id,
      layoutKey: existing.layoutKey || identity.layoutKey || null,
      name: existing.name || identity.name || null,
      type: existing.type || identity.type || null,
    });
    return;
  }
  out.set(id, {
    signnowTemplateId: id,
    layoutKey: identity.layoutKey ?? null,
    name: identity.name ?? null,
    type: identity.type ?? null,
  });
}

function funderLinkRows(value: unknown): Array<{ name?: unknown; link?: unknown }> {
  return Array.isArray(value)
    ? (value as Array<{ name?: unknown; link?: unknown }>)
    : [];
}

/** Every SignNow template the CRM can be asked to preview, de-duplicated by id. */
export async function collectSignNowTemplateIdentities(): Promise<TemplatePdfIdentity[]> {
  const out = new Map<string, TemplatePdfIdentity>();

  // 1. Env-configured catalog: main agreement + addenda + disclosures.
  pushIdentity(out, {
    signnowTemplateId: SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID,
    name: 'Agreement',
    type: 'contract',
  });
  for (const row of getSignNowSupplementalTemplates()) {
    pushIdentity(out, {
      signnowTemplateId: row.templateId,
      layoutKey: row.layoutKey,
      name: row.name,
      type: row.type,
    });
  }

  // 2. Settings → Funders: per-funder contract, addendum and disclosure links.
  const funders = await prisma.funderProfile.findMany({
    select: {
      name: true,
      signnowContractTemplateLink: true,
      signnowAddendumTemplates: true,
      signnowDisclosureTemplates: true,
    },
  });
  for (const funder of funders) {
    pushIdentity(out, {
      signnowTemplateId: String(funder.signnowContractTemplateLink || ''),
      name: funder.name ? `${funder.name} Agreement` : 'Agreement',
      type: 'contract',
    });
    const buckets: Array<{ rows: unknown; type: 'addendum' | 'disclosure' }> = [
      { rows: funder.signnowAddendumTemplates, type: 'addendum' },
      { rows: funder.signnowDisclosureTemplates, type: 'disclosure' },
    ];
    for (const bucket of buckets) {
      for (const row of funderLinkRows(bucket.rows)) {
        pushIdentity(out, {
          signnowTemplateId: String(row?.link || ''),
          name: String(row?.name || '').trim() || null,
          type: bucket.type,
        });
      }
    }
  }

  // 3. Template rows already stored in the CRM whose id is a SignNow template.
  const rows = await prisma.boldSignTemplate.findMany({
    select: { name: true, type: true, layoutKey: true, templateId: true },
  });
  for (const row of rows) {
    pushIdentity(out, {
      signnowTemplateId:
        extractSignNowTemplateId(row.templateId) ||
        extractSignNowTemplateId(row.layoutKey),
      layoutKey: row.layoutKey,
      name: row.name,
      type: row.type,
    });
  }

  return [...out.values()];
}

export type TemplatePdfBackfillOutcome =
  | 'archived'
  | 'already-archived'
  | 'would-archive'
  | 'failed';

export type TemplatePdfBackfillResult = {
  identity: TemplatePdfIdentity;
  outcome: TemplatePdfBackfillOutcome;
  error?: string;
};

/**
 * Fetch-and-archive every template that has no stored PDF yet.
 *
 * Sequential on purpose: SignNow rate-limits per account, and a backfill that
 * fans out would trip the same daily limit this archive exists to avoid.
 */
export async function backfillSignNowTemplatePdfs(options?: {
  /** Report what would happen without calling SignNow or Cloudinary. */
  dryRun?: boolean;
  /** Re-fetch and replace templates that are already archived. */
  force?: boolean;
  /** Stop after this many SignNow fetches (0 = no limit). */
  limit?: number;
  onProgress?: (result: TemplatePdfBackfillResult) => void;
}): Promise<TemplatePdfBackfillResult[]> {
  if (!isSignNowConfigured()) {
    throw new Error('SignNow is not configured; set the SIGNNOW_* environment variables.');
  }
  // Imported lazily: the service module pulls in the whole SignNow stack, and
  // `collectSignNowTemplateIdentities` is useful on its own.
  const { signNowService } = await import('../signnow.service');

  const identities = await collectSignNowTemplateIdentities();
  const results: TemplatePdfBackfillResult[] = [];
  const limit = Number(options?.limit) > 0 ? Number(options?.limit) : 0;
  let fetched = 0;

  for (const identity of identities) {
    const existing = options?.force
      ? null
      : await readStoredTemplatePdfArchive(identity.signnowTemplateId);
    if (existing) {
      const result: TemplatePdfBackfillResult = { identity, outcome: 'already-archived' };
      results.push(result);
      options?.onProgress?.(result);
      continue;
    }

    if (options?.dryRun) {
      const result: TemplatePdfBackfillResult = { identity, outcome: 'would-archive' };
      results.push(result);
      options?.onProgress?.(result);
      continue;
    }

    if (limit && fetched >= limit) break;

    try {
      // Both paths archive as a side effect of the fetch; `contract` templates
      // resolve their origin document differently from supplemental ones.
      if (String(identity.type || '').toLowerCase() === 'contract') {
        await signNowService.downloadAgreementPdf(identity.signnowTemplateId, {
          forceRefresh: options?.force === true,
        });
      } else {
        await signNowService.downloadGroupTemplatePdf(identity.signnowTemplateId, {
          forceRefresh: options?.force === true,
        });
      }
      fetched += 1;
      const result: TemplatePdfBackfillResult = { identity, outcome: 'archived' };
      results.push(result);
      options?.onProgress?.(result);
    } catch (err) {
      const result: TemplatePdfBackfillResult = {
        identity,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
      results.push(result);
      options?.onProgress?.(result);
    }
  }

  return results;
}
