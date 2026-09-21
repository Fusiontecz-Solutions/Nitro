import prisma from '../../../config/prismaClient';
import { fetchStoredSignedPdfBuffer } from '../../docusign/utils/archive-signed-envelope-pdf';
import { uploadPdfBufferToCloudinary } from '../../docusign/utils/cloudinary-pdf-upload';

/**
 * Permanent DB + Cloudinary archive for blank SignNow template PDFs.
 *
 * Template previews (the "Contract template" modal, and the addendum /
 * disclosure / exhibit picker under Info Required) used to download the PDF from
 * SignNow on every in-process cache miss. That cache is cold after each deploy
 * and private to each instance, so a handful of previews could burn a
 * meaningful share of the daily SignNow API budget for documents that only
 * change when somebody edits them by hand in SignNow.
 *
 * A template PDF is therefore fetched from SignNow at most once: the bytes are
 * uploaded to Cloudinary and the delivery URL is stored against the SignNow
 * template id. Every later preview reads the URL from the DB and streams from
 * Cloudinary. This module is deliberately generic — it keys on the SignNow
 * template id alone and knows nothing about contract / addendum / disclosure
 * distinctions, so it covers every template type without special-casing.
 *
 * Nothing here ever throws: an archive failure must degrade to serving the
 * buffer we already hold, never fail the preview.
 */

const TEMPLATE_PDF_ROOT = 'ih-crm/signnow-template-pdfs';

export type StoredTemplatePdfArchive = {
  signnowTemplateId: string;
  pdfUrl: string;
  pdfPublicId: string | null;
  layoutKey: string | null;
  name: string | null;
  type: string | null;
  byteSize: number | null;
  fetchedAt: Date;
};

export type TemplatePdfIdentity = {
  /** SignNow document-group template id — the archive key. */
  signnowTemplateId: string;
  layoutKey?: string | null;
  name?: string | null;
  type?: string | null;
  originDocumentId?: string | null;
};

function normalizeTemplateId(value: unknown): string {
  return String(value || '').trim();
}

/** Cloudinary folder per template type, so archives stay browsable in the console. */
function templatePdfFolder(type?: string | null): string {
  const token = String(type || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return token ? `${TEMPLATE_PDF_ROOT}/${token}` : TEMPLATE_PDF_ROOT;
}

function templatePdfFileName(identity: TemplatePdfIdentity): string {
  const base =
    String(identity.layoutKey || identity.name || 'template')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'template';
  return `${base}_${normalizeTemplateId(identity.signnowTemplateId).slice(0, 8)}.pdf`;
}

/** Stored archive row for a SignNow template id, or null when never archived. */
export async function readStoredTemplatePdfArchive(
  signnowTemplateId: string,
): Promise<StoredTemplatePdfArchive | null> {
  const id = normalizeTemplateId(signnowTemplateId);
  if (!id) return null;
  try {
    const row = await prisma.signNowTemplatePdf.findUnique({
      where: { signnowTemplateId: id },
    });
    if (!row?.pdfUrl) return null;
    return {
      signnowTemplateId: row.signnowTemplateId,
      pdfUrl: row.pdfUrl,
      pdfPublicId: row.pdfPublicId ?? null,
      layoutKey: row.layoutKey ?? null,
      name: row.name ?? null,
      type: row.type ?? null,
      byteSize: row.byteSize ?? null,
      fetchedAt: row.fetchedAt,
    };
  } catch (err) {
    console.warn('[SignNow] template PDF archive read failed', {
      templateId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Archived PDF bytes for a template, or null when there is no usable archive.
 * A stored URL that no longer resolves returns null so the caller can re-fetch.
 */
export async function readArchivedTemplatePdfBuffer(
  signnowTemplateId: string,
): Promise<Buffer | null> {
  const archive = await readStoredTemplatePdfArchive(signnowTemplateId);
  if (!archive?.pdfUrl) return null;
  const buffer = await fetchStoredSignedPdfBuffer(archive.pdfUrl);
  if (buffer?.length) return buffer;
  console.warn('[SignNow] archived template PDF could not be fetched; will re-fetch', {
    templateId: archive.signnowTemplateId,
    url: archive.pdfUrl.slice(0, 120),
  });
  return null;
}

/**
 * Upload a template PDF to Cloudinary and persist its URL.
 *
 * Idempotent: an existing archive is returned untouched unless `replaceExisting`
 * is set, so repeated previews / syncs of the same template never re-upload.
 */
export async function archiveTemplatePdf(args: {
  identity: TemplatePdfIdentity;
  pdf: Buffer;
  replaceExisting?: boolean;
}): Promise<StoredTemplatePdfArchive | null> {
  const identity = args.identity;
  const id = normalizeTemplateId(identity.signnowTemplateId);
  if (!id || !args.pdf?.length) return null;

  if (args.replaceExisting !== true) {
    const existing = await readStoredTemplatePdfArchive(id);
    if (existing) return existing;
  }

  const uploaded = await uploadPdfBufferToCloudinary({
    pdf: args.pdf,
    folder: templatePdfFolder(identity.type),
    fileName: templatePdfFileName(identity),
    label: '[SignNow] template',
  });
  if (!uploaded?.url) return null;

  const data = {
    signnowTemplateId: id,
    originDocumentId: normalizeTemplateId(identity.originDocumentId) || null,
    layoutKey: String(identity.layoutKey || '').trim() || null,
    name: String(identity.name || '').trim() || null,
    type: String(identity.type || '').trim() || null,
    pdfUrl: uploaded.url,
    pdfPublicId: uploaded.publicId || null,
    byteSize: uploaded.byteSize,
    fetchedAt: new Date(),
  };

  try {
    const row = await prisma.signNowTemplatePdf.upsert({
      where: { signnowTemplateId: id },
      create: data,
      update: data,
    });
    console.info('[SignNow] archived template PDF', {
      templateId: id,
      layoutKey: data.layoutKey,
      bytes: data.byteSize,
    });
    return {
      signnowTemplateId: row.signnowTemplateId,
      pdfUrl: row.pdfUrl,
      pdfPublicId: row.pdfPublicId ?? null,
      layoutKey: row.layoutKey ?? null,
      name: row.name ?? null,
      type: row.type ?? null,
      byteSize: row.byteSize ?? null,
      fetchedAt: row.fetchedAt,
    };
  } catch (err) {
    console.warn('[SignNow] template PDF archive write failed', {
      templateId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Drop a stored template PDF — call when a funder repoints a template link. */
export async function invalidateStoredTemplatePdf(
  signnowTemplateId: string,
): Promise<void> {
  const id = normalizeTemplateId(signnowTemplateId);
  if (!id) return;
  try {
    await prisma.signNowTemplatePdf.deleteMany({ where: { signnowTemplateId: id } });
  } catch (err) {
    console.warn('[SignNow] template PDF archive invalidation failed', {
      templateId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** In-flight dedupe so concurrent cold previews trigger one SignNow fetch. */
const templatePdfInflight = new Map<string, Promise<Buffer>>();

/**
 * The one entry point previews use: archive first, SignNow only as the
 * migration / backward-compatibility fallback.
 *
 *   DB → Cloudinary → user
 *   (miss) → SignNow once → Cloudinary → DB → user
 *
 * `fetchFromSignNow` is only invoked when nothing is archived yet.
 */
export async function resolveTemplatePdf(args: {
  identity: TemplatePdfIdentity;
  fetchFromSignNow: () => Promise<{ pdf: Buffer; originDocumentId?: string | null }>;
  /** Ignore any archive and re-fetch (template link repointed / backfill refresh). */
  forceRefresh?: boolean;
}): Promise<Buffer> {
  const id = normalizeTemplateId(args.identity.signnowTemplateId);
  if (!id) {
    const fetched = await args.fetchFromSignNow();
    return fetched.pdf;
  }

  if (args.forceRefresh !== true) {
    const archived = await readArchivedTemplatePdfBuffer(id);
    if (archived?.length) return archived;
  }

  const inflight = templatePdfInflight.get(id);
  if (inflight) return inflight;

  const pending = (async () => {
    const fetched = await args.fetchFromSignNow();
    const pdf = fetched.pdf;
    // Archive before returning so the very next request is already served from
    // Cloudinary, but never let an archive failure fail the preview itself.
    try {
      await archiveTemplatePdf({
        identity: {
          ...args.identity,
          signnowTemplateId: id,
          originDocumentId: fetched.originDocumentId ?? args.identity.originDocumentId,
        },
        pdf,
        replaceExisting: args.forceRefresh === true,
      });
    } catch (err) {
      console.warn('[SignNow] template PDF archive skipped', {
        templateId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return pdf;
  })().finally(() => {
    templatePdfInflight.delete(id);
  });

  templatePdfInflight.set(id, pending);
  return pending;
}
