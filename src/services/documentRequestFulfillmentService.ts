import prisma from '../config/prismaClient';
import {
  DOCUMENT_REQUEST_LABELS,
  findFulfilledDocumentForRequest,
  getDocumentRequestConfig,
} from '../constants/documentRequestTypes';
import { deriveCategory } from './notificationCategory';

export async function loadDocumentRequestFulfillmentContext(applicationUuid: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationUuid },
    include: {
      files: true,
      contract: {
        select: {
          id: true,
          documents: {
            select: {
              id: true,
              documentType: true,
              fileName: true,
              fileUrl: true,
              downloadUrl: true,
            },
          },
        },
      },
    },
  });

  if (!application) return null;

  const contractFiles =
    (application as any).contract?.documents?.map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ''),
      documentType: row.documentType,
      fileName: row.fileName,
      fileUrl: row.fileUrl,
      downloadUrl: row.downloadUrl,
    })) ?? [];

  return {
    applicationId: application.applicationId,
    applicationUuid: application.id,
    applicationFiles: application.files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      requestedDocumentSlug: (f as { requestedDocumentSlug?: string | null }).requestedDocumentSlug,
      url: f.url,
    })),
    contractFiles,
  };
}

export async function notifyRequestersDocumentReceived(options: {
  applicationUuid: string;
  documentSlug: string;
  uploadedByUserId: string;
}): Promise<void> {
  const slug = String(options.documentSlug || '').trim().toLowerCase();
  if (!slug) return;

  const config = getDocumentRequestConfig(slug);
  const label = config?.label || DOCUMENT_REQUEST_LABELS[slug] || slug;

  const application = await prisma.application.findUnique({
    where: { id: options.applicationUuid },
    select: { id: true, applicationId: true },
  });
  if (!application) return;

  const notifications = await prisma.notification.findMany({
    where: {
      applicationId: application.id,
      type: 'document_request',
    },
    orderBy: { createdAt: 'desc' },
    select: {
      createdById: true,
      documentRequestedDocuments: true,
    },
  });

  const recipientIds = new Set<string>();
  for (const row of notifications) {
    const docs = row.documentRequestedDocuments || [];
    if (!docs.includes(slug)) continue;
    if (row.createdById) recipientIds.add(String(row.createdById));
  }

  const uploaderId = String(options.uploadedByUserId || '').trim();
  const appNum = application.applicationId ?? 'N/A';

  for (const recipientId of recipientIds) {
    if (recipientId === uploaderId) continue;
    try {
      await prisma.notification.create({
        data: {
          title: 'Requested document received',
          message: `${label} was uploaded for Application #${appNum}.`,
          type: 'document_received',
          category: deriveCategory('document_received'),
          applicationId: application.id,
          recipientId,
          createdById: uploaderId || recipientId,
        },
      });
    } catch (err) {
      console.error('[documentRequest] Failed to notify recipient:', err);
    }
  }
}

export async function notifyForContractDocumentUpload(options: {
  contractId: number;
  contractUploadKeys: string[];
  uploadedByUserId: string;
}): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: options.contractId },
    select: { applicationId: true },
  });
  if (!contract?.applicationId) return;

  const { slugsForContractUploadKey } = await import('../constants/documentRequestTypes');
  const slugs = new Set<string>();
  for (const key of options.contractUploadKeys) {
    for (const slug of slugsForContractUploadKey(key)) {
      slugs.add(slug);
    }
  }

  const context = await loadDocumentRequestFulfillmentContext(contract.applicationId);
  if (!context) return;

  for (const slug of slugs) {
    const fulfilled = findFulfilledDocumentForRequest(slug, {
      applicationFiles: context.applicationFiles,
      contractFiles: context.contractFiles,
    });
    if (!fulfilled || fulfilled.source !== 'contract') continue;
    await notifyRequestersDocumentReceived({
      applicationUuid: contract.applicationId,
      documentSlug: slug,
      uploadedByUserId: options.uploadedByUserId,
    });
  }
}
