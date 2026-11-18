import { cloudinary } from '../config/cloudinary';

export type ParsedCloudinaryDeliveryUrl = {
  cloud: string;
  resourceType: 'image' | 'raw' | 'video';
  deliveryType: string;
  publicId: string;
  format?: string;
  version?: string;
};

function ensureCloudinaryConfigured(): void {
  // Server normally calls cloudinaryConnect() at boot; re-apply here so
  // authenticated downloads work even if that path was skipped in tests.
  cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
    secure: true,
  });
}

/**
 * Parse a standard Cloudinary delivery URL into public_id + format.
 * Supports common delivery paths without (or with simple) transformations:
 *   /{cloud}/{image|raw|video}/{type}/[v{version}/]{public_id}[.{format}]
 */
export function parseCloudinaryDeliveryUrl(
  rawUrl: string,
): ParsedCloudinaryDeliveryUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(String(rawUrl ?? '').trim());
  } catch {
    return null;
  }
  if (parsed.hostname !== 'res.cloudinary.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 4) return null;

  const cloud = segments[0];
  const resourceType = segments[1];
  const deliveryType = segments[2];
  if (!cloud || !['image', 'raw', 'video'].includes(resourceType)) return null;
  if (!deliveryType) return null;

  let rest = segments.slice(3);

  // Skip signed-url / transformation segments until version or public_id.
  // e.g. s--xxxx--, c_fill,w_100, fl_attachment
  while (rest.length > 0) {
    const seg = rest[0];
    if (/^v\d+$/i.test(seg)) break;
    // Heuristic: transformation segments contain `,` or start with known prefixes / s--
    if (
      seg.includes(',') ||
      /^s--/.test(seg) ||
      /^(c_|w_|h_|f_|q_|fl_|t_|l_|e_|b_|a_|d_|o_|r_|u_|x_|y_)/i.test(seg)
    ) {
      rest = rest.slice(1);
      continue;
    }
    break;
  }

  let version: string | undefined;
  if (rest[0] && /^v\d+$/i.test(rest[0])) {
    version = rest[0].slice(1);
    rest = rest.slice(1);
  }

  if (!rest.length) return null;

  const last = rest[rest.length - 1];
  const formatMatch = last.match(/\.([a-z0-9]+)$/i);
  let format = formatMatch?.[1]?.toLowerCase();
  const publicIdParts = [...rest];
  if (formatMatch) {
    publicIdParts[publicIdParts.length - 1] = last.replace(/\.[a-z0-9]+$/i, '');
  }

  const publicId = publicIdParts.join('/');
  if (!publicId) return null;

  // PDFs stored as Cloudinary image resources often omit an extension in public_id
  // but keep `.pdf` on the delivery URL — prefer that format.
  if (!format && resourceType === 'image') {
    format = undefined;
  }

  return {
    cloud,
    resourceType: resourceType as 'image' | 'raw' | 'video',
    deliveryType,
    publicId,
    format,
    version,
  };
}

function isOurCloudinaryCloud(cloud: string): boolean {
  const ours = String(process.env.CLOUD_NAME || '').trim();
  return Boolean(ours) && ours === cloud;
}

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * GET with a per-attempt timeout, retrying network errors and transient
 * statuses (408/425/429/5xx). Returns the last response for non-retryable or
 * exhausted statuses; throws only when every attempt failed at the network level.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  let lastRes: Response | undefined;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok || !isRetryableStatus(res.status)) return res;
      lastRes = res;
      lastError = undefined;
    } catch (error) {
      lastError = error;
      lastRes = undefined;
    }
  }
  if (lastRes) return lastRes;
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Short-lived cache so repeated previews of the same template PDF (tab
 * switches, modal re-opens) don't re-download it and re-risk a Cloudinary blip.
 * Cloudinary delivery URLs are versioned, so a URL's bytes don't change.
 */
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
const assetCache = new Map<string, { buf: Buffer; expiresAt: number }>();
let assetCacheBytes = 0;

function cacheGet(url: string): Buffer | null {
  const hit = assetCache.get(url);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    assetCache.delete(url);
    assetCacheBytes -= hit.buf.length;
    return null;
  }
  // Refresh LRU position.
  assetCache.delete(url);
  assetCache.set(url, hit);
  return hit.buf;
}

function cacheSet(url: string, buf: Buffer): void {
  if (buf.length > CACHE_MAX_BYTES / 4) return;
  const prev = assetCache.get(url);
  if (prev) {
    assetCache.delete(url);
    assetCacheBytes -= prev.buf.length;
  }
  while (assetCacheBytes + buf.length > CACHE_MAX_BYTES && assetCache.size > 0) {
    const [oldestKey, oldest] = assetCache.entries().next().value as [
      string,
      { buf: Buffer; expiresAt: number },
    ];
    assetCache.delete(oldestKey);
    assetCacheBytes -= oldest.buf.length;
  }
  assetCache.set(url, { buf, expiresAt: Date.now() + CACHE_TTL_MS });
  assetCacheBytes += buf.length;
}

/** Test hook. */
export function clearCloudinaryAssetCache(): void {
  assetCache.clear();
  assetCacheBytes = 0;
}

/**
 * Download a Cloudinary asset as a Buffer.
 * Public delivery URLs on this account currently return 401 (ACL / restricted media),
 * so fall back to an authenticated Admin API download URL for our cloud.
 */
export async function fetchCloudinaryAssetBuffer(rawUrl: string): Promise<Buffer> {
  const url = String(rawUrl ?? '').trim();
  if (!url) {
    throw new Error('Cloudinary URL is required');
  }

  const cached = cacheGet(url);
  if (cached) return cached;

  const buf = await downloadCloudinaryAsset(url);
  cacheSet(url, buf);
  return buf;
}

async function downloadCloudinaryAsset(url: string): Promise<Buffer> {
  // A network-level failure on the public URL must still fall through to the
  // authenticated download rather than surfacing as a 502.
  let publicStatus = 0;
  let publicError: unknown;
  try {
    const publicRes = await fetchWithRetry(url);
    if (publicRes.ok) {
      return Buffer.from(await publicRes.arrayBuffer());
    }
    publicStatus = publicRes.status;
  } catch (error) {
    publicError = error;
  }

  const parsed = parseCloudinaryDeliveryUrl(url);
  if (!parsed || !isOurCloudinaryCloud(parsed.cloud)) {
    throw new Error(
      publicError
        ? `Could not fetch Cloudinary asset (${publicError instanceof Error ? publicError.message : String(publicError)})`
        : `Could not fetch Cloudinary asset (${publicStatus})`,
    );
  }

  const format =
    parsed.format ||
    (parsed.resourceType === 'image' ? 'pdf' : undefined) ||
    'pdf';

  ensureCloudinaryConfigured();
  const downloadUrl = cloudinary.utils.private_download_url(parsed.publicId, format, {
    resource_type: parsed.resourceType,
    type: parsed.deliveryType || 'upload',
    attachment: false,
  });

  const authRes = await fetchWithRetry(downloadUrl);
  if (!authRes.ok) {
    throw new Error(
      `Could not fetch Cloudinary asset via authenticated download (${authRes.status})`,
    );
  }
  return Buffer.from(await authRes.arrayBuffer());
}
