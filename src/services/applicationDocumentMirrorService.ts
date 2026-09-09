/**
 * Keep Documents-tab ApplicationFile rows in sync with Contract-tab FileMetadata uploads.
 */
import prisma from '../config/prismaClient';

const TYPE_FILENAME_SEPARATOR = '::';

const CONTRACT_TYPE_TO_SLUG: Record<string, string> = {
  voidedcheck: 'voided-check',
  driverlicense: 'driver-license',
  driverslicense: 'driver-license',
  driverlicenseowner2: 'driver-license-owner-2',
  bankstatement: 'bank-statements',
  bankstatements: 'bank-statements',
  utilitybill: 'proof-of-address',
  proofofaddress: 'proof-of-address',
};

function normalizeTypeKey(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function decodeStoredFileName(storedFileName: unknown): {
  documentType: string | null;
  displayFileName: string;
} {
  const raw = String(storedFileName ?? '').trim();
  if (!raw) return { documentType: null, displayFileName: '' };
  const idx = raw.indexOf(TYPE_FILENAME_SEPARATOR);
  if (idx <= 0) return { documentType: null, displayFileName: raw };
  return {
    documentType: raw.slice(0, idx).trim() || null,
    displayFileName: raw.slice(idx + TYPE_FILENAME_SEPARATOR.length).trim() || raw,
  };
}

export function slugFromContractDocumentType(documentType: unknown): string | null {
  const key = normalizeTypeKey(documentType);
  if (!key) return null;
  if (CONTRACT_TYPE_TO_SLUG[key]) return CONTRACT_TYPE_TO_SLUG[key];
  const dashed = String(documentType ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return dashed || null;
}

function normalizeUrl(url: unknown): string {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();
}

export async function mirrorUploadToApplicationFile(input: {
  applicationId: string;
  url: string;
  publicId: string;
  originalName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  requestedDocumentSlug?: string | null;
  uploadedAt?: Date | null;
}): Promise<void> {
  const applicationId = String(input.applicationId || '').trim();
  const url = String(input.url || '').trim();
  if (!applicationId || !url) return;

  const publicId = String(input.publicId || '').trim();
  const existing = await prisma.applicationFile.findFirst({
    where: {
      applicationId,
      OR: [
        { url },
        ...(publicId ? [{ publicId }] : []),
      ],
    },
    select: { id: true },
  });
  if (existing) return;

  await prisma.applicationFile.create({
    data: {
      applicationId,
      url,
      publicId: publicId || url,
      originalName: String(input.originalName || '').trim() || 'document',
      mimeType: input.mimeType || null,
      size: typeof input.size === 'number' && Number.isFinite(input.size) ? input.size : null,
      requestedDocumentSlug: input.requestedDocumentSlug || null,
      ...(input.uploadedAt ? { uploadedAt: input.uploadedAt } : {}),
    },
  });
}

export async function removeMirroredApplicationFile(input: {
  applicationId?: string | null;
  url?: string | null;
  publicId?: string | null;
}): Promise<void> {
  const applicationId = String(input.applicationId || '').trim();
  const url = String(input.url || '').trim();
  const publicId = String(input.publicId || '').trim();
  if (!applicationId || (!url && !publicId)) return;

  await prisma.applicationFile.deleteMany({
    where: {
      applicationId,
      OR: [
        ...(url ? [{ url }] : []),
        ...(publicId ? [{ publicId }] : []),
      ],
    },
  });
}

/** Copy any Contract-tab FileMetadata rows that are missing from ApplicationFile. */
export async function syncContractDocumentsOntoApplication(applicationId: string): Promise<void> {
  const id = String(applicationId || '').trim();
  if (!id) return;

  const contract = await prisma.contract.findFirst({
    where: { applicationId: id },
    select: { id: true },
  });
  if (!contract) return;

  const [appFiles, contractFiles] = await Promise.all([
    prisma.applicationFile.findMany({
      where: { applicationId: id },
      select: { url: true, publicId: true },
    }),
    prisma.fileMetadata.findMany({
      where: { contractId: contract.id },
    }),
  ]);

  const existingUrls = new Set(appFiles.map((f) => normalizeUrl(f.url)).filter(Boolean));
  const existingPublicIds = new Set(appFiles.map((f) => String(f.publicId || '').trim()).filter(Boolean));

  for (const row of contractFiles) {
    const url = String(row.fileUrl || row.downloadUrl || '').trim();
    const publicId = String(row.filePath || '').trim();
    if (!url) continue;
    if (existingUrls.has(normalizeUrl(url))) continue;
    if (publicId && existingPublicIds.has(publicId)) continue;

    const decoded = decodeStoredFileName(row.fileName);
    const documentType = row.documentType || decoded.documentType;
    await prisma.applicationFile.create({
      data: {
        applicationId: id,
        url,
        publicId: publicId || url,
        originalName: decoded.displayFileName || 'document',
        mimeType: row.contentType || null,
        size: typeof row.size === 'number' ? row.size : null,
        requestedDocumentSlug: slugFromContractDocumentType(documentType),
        uploadedAt: row.uploadedAt || new Date(),
      },
    });
    existingUrls.add(normalizeUrl(url));
    if (publicId) existingPublicIds.add(publicId);
  }
}
