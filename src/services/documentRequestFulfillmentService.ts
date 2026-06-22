import prisma from '../config/prismaClient';
import { documentRequestDisplayLabel } from '../utils/documentRequestMatch';

/** Notify CRM users who requested a document when it is uploaded via the public portal. */
export async function notifyRequestersDocumentReceived(params: {
  applicationUuid: string;
  documentSlug: string;
  uploadedByUserId: string;
}): Promise<void> {
  const { applicationUuid, documentSlug, uploadedByUserId } = params;
  const slug = String(documentSlug || '').trim();
  if (!slug) return;

  const application = await prisma.application.findUnique({
    where: { id: applicationUuid },
    select: { id: true, applicationId: true },
  });
  if (!application) return;

  const requestNotifications = await prisma.notification.findMany({
    where: { applicationId: applicationUuid, type: 'document_request' },
    orderBy: { createdAt: 'desc' },
  });

  const label = documentRequestDisplayLabel(slug);
  const appLabel = application.applicationId != null ? String(application.applicationId) : 'N/A';
  const notifiedRecipients = new Set<string>();

  for (const row of requestNotifications) {
    const docs = row.documentRequestedDocuments || [];
    if (!docs.includes(slug)) continue;

    const recipientId = String(row.createdById || '').trim();
    if (!recipientId || notifiedRecipients.has(recipientId)) continue;
    notifiedRecipients.add(recipientId);

    const actorId = String(uploadedByUserId || recipientId).trim();
    if (!actorId) continue;

    await prisma.notification.create({
      data: {
        title: 'Requested document received',
        message: `${label} was uploaded for Application #${appLabel}.`,
        type: 'document_request_received',
        applicationId: applicationUuid,
        recipientId,
        createdById: actorId,
        documentRequestedDocuments: [slug],
        documentRequestAdditional: false,
        isRead: false,
      },
    });
  }
}
