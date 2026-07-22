import prisma from '../../../config/prismaClient';
import uploadService from '../../uploadService';
import { slugifyFunderDocumentToken } from '../../../utils/funderContractLayout';
import { resolveEnvelopeFunderAuthHints } from './envelope-funder-auth';

const SIGNED_CONTRACTS_ROOT = 'ih-crm/signed-contracts';

export function buildSignedContractsFolder(args: {
  funderName?: string | null;
  funderProfileId?: string | null;
}): string {
  const byId = String(args.funderProfileId || '').trim();
  const byName = slugifyFunderDocumentToken(String(args.funderName || ''));
  const segment = byName || (byId ? `funder_${byId}` : 'unknown-funder');
  return `${SIGNED_CONTRACTS_ROOT}/${segment}`;
}

export async function getStoredSignedPdfUrl(envelopeId: string): Promise<string | null> {
  const eid = String(envelopeId || '').trim();
  if (!eid) return null;
  const row = await prisma.document.findFirst({
    where: { envelopeId: eid },
    select: { signedPdfUrl: true },
  });
  const url = String(row?.signedPdfUrl || '').trim();
  return url || null;
}

/** Fetch a previously archived signed PDF (Cloudinary / HTTPS). */
export async function fetchStoredSignedPdfBuffer(url: string): Promise<Buffer | null> {
  const href = String(url || '').trim();
  if (!href.startsWith('http://') && !href.startsWith('https://')) return null;
  try {
    const res = await fetch(href);
    if (!res.ok) {
      console.warn(
        `[DocuSign] stored signed PDF fetch failed (${res.status}) for ${href.slice(0, 120)}`,
      );
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length ? buf : null;
  } catch (err) {
    console.warn('[DocuSign] stored signed PDF fetch error:', err);
    return null;
  }
}

/**
 * Upload a signed envelope PDF into `ih-crm/signed-contracts/{funder}/…`
 * and persist the URL on Document so later previews skip DocuSign.
 */
export async function archiveSignedEnvelopePdf(args: {
  envelopeId: string;
  pdf: Buffer;
  applicationId?: string | null;
  funderName?: string | null;
  funderProfileId?: string | null;
}): Promise<{ url: string; publicId: string } | null> {
  const eid = String(args.envelopeId || '').trim();
  const pdf = args.pdf;
  if (!eid || !pdf?.length) return null;

  const existing = await prisma.document.findFirst({
    where: { envelopeId: eid },
    select: {
      id: true,
      applicationId: true,
      signedPdfUrl: true,
      signedPdfPublicId: true,
    },
  });
  const existingUrl = String(existing?.signedPdfUrl || '').trim();
  if (existingUrl) {
    return {
      url: existingUrl,
      publicId: String(existing?.signedPdfPublicId || '').trim(),
    };
  }

  let funderName = String(args.funderName || '').trim() || null;
  let funderProfileId = String(args.funderProfileId || '').trim() || null;
  const applicationId =
    String(args.applicationId || existing?.applicationId || '').trim() || null;

  if (!funderName && !funderProfileId) {
    try {
      const hints = await resolveEnvelopeFunderAuthHints(eid, {
        applicationId,
      });
      funderName = String(hints.funderName || '').trim() || null;
      funderProfileId = String(hints.funderProfileId || '').trim() || null;
    } catch {
      /* folder falls back to unknown-funder */
    }
  }

  const folder = buildSignedContractsFolder({ funderName, funderProfileId });
  const appPart = applicationId ? applicationId.slice(0, 8) : 'app';
  const envPart = eid.slice(0, 8);
  const fileName = `${appPart}_${envPart}_signed.pdf`;

  const uploaded = await uploadService.uploadBuffer(pdf, folder, fileName, { forcePdf: true });
  if (!uploaded.success || !uploaded.data?.secure_url) {
    console.error(
      '[DocuSign] signed PDF Cloudinary upload failed:',
      uploaded.error || uploaded.message,
    );
    return null;
  }

  // Prefer a .pdf delivery URL (image/upload/…/file.pdf), never /raw/upload/.
  let url = String(uploaded.data.secure_url || uploaded.data.url || '').trim();
  if (url.includes('/raw/upload/')) {
    url = url.replace('/raw/upload/', '/image/upload/');
  }
  if (url && !/\.pdf(\?|$)/i.test(url)) {
    url = `${url}.pdf`;
  }
  const publicId = String(uploaded.data.public_id || '').trim();
  const format = String(uploaded.data.format || '').toLowerCase();
  if (format && format !== 'pdf') {
    console.warn(
      `[DocuSign] signed PDF uploaded with unexpected Cloudinary format="${format}" (expected pdf)`,
    );
  }

  const updated = await prisma.document.updateMany({
    where: { envelopeId: eid },
    data: {
      signedPdfUrl: url,
      signedPdfPublicId: publicId || null,
    },
  });

  if (updated.count === 0) {
    console.warn(
      `[DocuSign] signed PDF uploaded but no Document row for envelope ${eid} (url=${url})`,
    );
  } else {
    console.info(
      `[DocuSign] archived signed PDF for envelope ${eid} → ${folder}/${fileName}`,
    );
  }

  // Best-effort: also surface in application files list.
  if (applicationId) {
    try {
      await prisma.applicationFile.create({
        data: {
          applicationId,
          url,
          publicId: publicId || url,
          originalName: `Signed contract (${envPart}).pdf`,
          mimeType: 'application/pdf',
          size: pdf.length,
          uploadedAt: new Date(),
          requestedDocumentSlug: 'signed-contract',
        },
      });
    } catch (err) {
      console.warn(
        '[DocuSign] ApplicationFile create for signed PDF skipped:',
        (err as { message?: string })?.message || err,
      );
    }
  }

  return { url, publicId };
}
