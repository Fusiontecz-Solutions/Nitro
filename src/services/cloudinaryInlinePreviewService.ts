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

export type CloudinaryUrlError = { status: number; message: string };

/**
 * Optional allow-list of Cloudinary cloud names (comma-separated env
 * `CLOUDINARY_ALLOWED_CLOUDS`). When unset, any cloud on res.cloudinary.com is
 * permitted — documents in this CRM span multiple historical Cloudinary
 * accounts, so pinning to a single `CLOUD_NAME` wrongly rejects older files.
 */
function restrictedCloudNames(): Set<string> | null {
  const raw = process.env.CLOUDINARY_ALLOWED_CLOUDS?.trim();
  if (!raw) return null;
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length ? new Set(names) : null;
}

/**
 * Validate that a URL is a safe Cloudinary asset to proxy. Locked to the
 * res.cloudinary.com host and the standard `<cloud>/<image|raw|video>/...`
 * delivery path to prevent SSRF, matching the frontend's `isCloudinaryAssetUrl`.
 * Returns `null` when the URL is allowed, otherwise a status + message.
 */
export function assertAllowedCloudinaryUrl(rawUrl: string): CloudinaryUrlError | null {
  const url = String(rawUrl ?? '').trim();
  if (!url) return { status: 400, message: 'url query parameter is required' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: 400, message: 'Invalid URL' };
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
    return { status: 403, message: 'URL not allowed' };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const cloud = segments[0];
  const resourceType = segments[1];
  if (!cloud || !['image', 'raw', 'video'].includes(resourceType)) {
    return { status: 403, message: 'URL not allowed' };
  }

  const allowed = restrictedCloudNames();
  if (allowed && !allowed.has(cloud)) {
    return { status: 403, message: 'URL not allowed' };
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
    res.status(validationError.status).json({
      success: false,
      message: validationError.message,
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
