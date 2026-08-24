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

  const publicRes = await fetch(url, { redirect: 'follow' });
  if (publicRes.ok) {
    return Buffer.from(await publicRes.arrayBuffer());
  }

  const parsed = parseCloudinaryDeliveryUrl(url);
  if (!parsed || !isOurCloudinaryCloud(parsed.cloud)) {
    throw new Error(
      `Could not fetch Cloudinary asset (${publicRes.status})`,
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

  const authRes = await fetch(downloadUrl, { redirect: 'follow' });
  if (!authRes.ok) {
    throw new Error(
      `Could not fetch Cloudinary asset via authenticated download (${authRes.status})`,
    );
  }
  return Buffer.from(await authRes.arrayBuffer());
}
