import uploadService from '../../uploadService';

/**
 * Shared Cloudinary PDF upload for archived e-sign documents.
 *
 * Extracted from `archiveSignedEnvelopePdf` so the signed-envelope archive and
 * the blank template archive use one upload + URL-normalisation path instead of
 * two copies that can drift apart.
 */

/**
 * Cloudinary hands back a `/raw/upload/` URL for some accounts and drops the
 * extension for others; browsers only render the PDF inline from an
 * `/image/upload/….pdf` delivery URL.
 */
export function normalizeCloudinaryPdfUrl(rawUrl: string | null | undefined): string {
  let url = String(rawUrl || '').trim();
  if (!url) return '';
  if (url.includes('/raw/upload/')) {
    url = url.replace('/raw/upload/', '/image/upload/');
  }
  if (!/\.pdf(\?|$)/i.test(url)) {
    url = `${url}.pdf`;
  }
  return url;
}

export type UploadedPdf = {
  url: string;
  publicId: string;
  byteSize: number;
};

/**
 * Upload a PDF buffer and return its inline-renderable delivery URL.
 * Returns null (after logging) instead of throwing — every caller archives
 * best-effort and must still be able to serve the buffer it already holds.
 */
export async function uploadPdfBufferToCloudinary(args: {
  pdf: Buffer;
  folder: string;
  fileName: string;
  /** Log prefix, e.g. `[SignNow] template`. */
  label: string;
}): Promise<UploadedPdf | null> {
  const { pdf, folder, fileName, label } = args;
  if (!pdf?.length) return null;

  const uploaded = await uploadService.uploadBuffer(pdf, folder, fileName, {
    forcePdf: true,
  });
  if (!uploaded.success || !uploaded.data?.secure_url) {
    console.error(
      `${label} PDF Cloudinary upload failed:`,
      uploaded.error || uploaded.message,
    );
    return null;
  }

  const format = String(uploaded.data.format || '').toLowerCase();
  if (format && format !== 'pdf') {
    console.warn(
      `${label} PDF uploaded with unexpected Cloudinary format="${format}" (expected pdf)`,
    );
  }

  return {
    url: normalizeCloudinaryPdfUrl(uploaded.data.secure_url || uploaded.data.url),
    publicId: String(uploaded.data.public_id || '').trim(),
    byteSize: pdf.length,
  };
}
