import type { Response } from 'express';

/** Safe filename for Content-Disposition (ASCII subset). */
export function sanitizeInlinePreviewFilename(name: string): string {
  const trimmed = String(name ?? 'document').trim().slice(0, 200);
  return trimmed.replace(/[^\w.\- ()]+/g, '_') || 'document';
}

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function fileExtFromNameOrUrl(name: string, rawUrl: string): string {
  const n = String(name ?? '').toLowerCase().trim();
  const fromName = n.match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  if (fromName) return fromName;
  try {
    const path = new URL(rawUrl).pathname.toLowerCase();
    return path.match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  } catch {
    return '';
  }
}

const SHORT_FORMAT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

function normalizeMimeHint(mimeTypeHint?: string): string {
  const hint = String(mimeTypeHint ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase();
  if (!hint) return '';
  if (SHORT_FORMAT_TO_MIME[hint]) return SHORT_FORMAT_TO_MIME[hint];
  return hint;
}

/** Cloudinary raw files often come back as octet-stream; browsers then download blob: URLs in iframes. */
export function resolveInlineContentType(
  upstreamCt: string,
  rawUrl: string,
  nameParam: string,
  mimeTypeHint?: string,
): string {
  const hint = normalizeMimeHint(mimeTypeHint);
  if (hint && hint !== 'application/octet-stream') {
    return hint;
  }

  const ext = fileExtFromNameOrUrl(nameParam, rawUrl);
  const fromExt = ext && EXT_TO_MIME[ext];
  if (fromExt) {
    return fromExt;
  }

  const base = (upstreamCt || '').split(';')[0].trim().toLowerCase();
  if (base && base !== 'application/octet-stream') {
    return base;
  }
  return 'application/octet-stream';
}

export function assertAllowedCloudinaryUrl(rawUrl: string): string | null {
  const url = String(rawUrl ?? '').trim();
  if (!url) return 'url query parameter is required';

  const cloudName = process.env.CLOUD_NAME?.trim();
  if (!cloudName) return 'Server misconfigured (cloud name)';

  const prefix = `https://res.cloudinary.com/${cloudName}/`;
  if (!url.startsWith(prefix)) return 'URL not allowed';

  if (!/^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\//.test(url)) {
    return 'URL not allowed';
  }

  return null;
}

/** Proxy Cloudinary assets with Content-Disposition: inline so PDFs render in-browser. */
export async function streamCloudinaryInlinePreview(
  res: Response,
  rawUrl: string,
  nameParam = '',
  mimeTypeHint?: string,
): Promise<void> {
  const validationError = assertAllowedCloudinaryUrl(rawUrl);
  if (validationError) {
    res.status(validationError.includes('required') ? 400 : 500).json({
      success: false,
      message: validationError,
    });
    return;
  }

  const upstream = await fetch(rawUrl, { redirect: 'follow' });
  if (!upstream.ok) {
    res.status(502).json({
      success: false,
      message: 'Could not fetch file from storage',
    });
    return;
  }

  const upstreamCt =
    upstream.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  const filename = sanitizeInlinePreviewFilename(nameParam || 'document');
  const ct = resolveInlineContentType(upstreamCt, rawUrl, nameParam, mimeTypeHint);

  res.setHeader('Content-Type', ct);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');

  const buf = Buffer.from(await upstream.arrayBuffer());
  res.send(buf);
}
