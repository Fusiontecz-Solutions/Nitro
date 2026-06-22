import prisma from '../config/prismaClient';
import {
  documentRequestDisplayLabel,
  documentRequestMatchesUploadedFile,
  isDocumentRequestFulfilled,
} from '../utils/documentRequestMatch';

export type DocumentRequestListRow = {
  name: string;
  label: string;
  status: 'Complete' | 'Pending';
  createdAt: Date;
  fileUrl?: string;
  fileId?: string;
  message?: string;
};

function normalizeSlug(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

function findMatchingApplicationFile(
  requestedDocName: string,
  files: Array<{
    id: string;
    url: string;
    originalName?: string | null;
    requestedDocumentSlug?: string | null;
  }>,
) {
  const reqSlug = normalizeSlug(requestedDocName);
  for (const file of files) {
    const fileSlug = normalizeSlug(file.requestedDocumentSlug);
    if (fileSlug && fileSlug === reqSlug) return file;
    if (
      documentRequestMatchesUploadedFile(requestedDocName, {
        originalName: file.originalName,
        fileName: file.originalName,
      })
    ) {
      return file;
    }
  }
  return null;
}

/** Build the public document-request portal list for an application UUID. */
export async function buildDocumentRequestListForApplication(
  applicationUuid: string,
): Promise<DocumentRequestListRow[]> {
  const application = await prisma.application.findUnique({
    where: { id: applicationUuid },
    include: { files: true },
  });
  if (!application) return [];

  const contracts = await prisma.contract.findMany({
    where: { applicationId: application.id },
    select: { id: true },
  });
  const contractIds = contracts.map((c) => c.id);
  const contractFiles =
    contractIds.length > 0
      ? await prisma.fileMetadata.findMany({
          where: { contractId: { in: contractIds } },
          select: {
            fileName: true,
            documentType: true,
          },
        })
      : [];

  const applicationFiles = (application.files || []).map((file) => ({
    id: file.id,
    url: file.url,
    originalName: file.originalName,
    requestedDocumentSlug: file.requestedDocumentSlug,
  }));

  const filesForMatching = [
    ...applicationFiles.map((file) => ({
      originalName: file.originalName,
      fileName: file.originalName,
      documentType: file.requestedDocumentSlug ?? null,
    })),
    ...contractFiles.map((file) => ({
      originalName: file.fileName,
      fileName: file.fileName,
      documentType: file.documentType,
    })),
  ];

  const notificationsRecords = await prisma.notification.findMany({
    where: {
      applicationId: application.id,
      type: 'document_request',
    },
    orderBy: { createdAt: 'desc' },
  });

  const documentMap = new Map<
    string,
    { status: 'Complete' | 'Pending'; createdAt: Date; message?: string; fileUrl?: string; fileId?: string }
  >();
  const generalRequests: DocumentRequestListRow[] = [];

  for (const notification of notificationsRecords) {
    const requestedDocs = notification.documentRequestedDocuments || [];

    for (const docName of requestedDocs) {
      const matchedFile = findMatchingApplicationFile(docName, applicationFiles);
      const isUploaded = Boolean(matchedFile) || isDocumentRequestFulfilled(docName, filesForMatching);

      const existing = documentMap.get(docName);
      const shouldReplace =
        !existing ||
        (existing.status === 'Pending' && isUploaded) ||
        notification.createdAt > existing.createdAt;

      if (shouldReplace) {
        documentMap.set(docName, {
          status: isUploaded ? 'Complete' : 'Pending',
          createdAt: notification.createdAt,
          fileUrl: matchedFile?.url,
          fileId: matchedFile?.id,
        });
      }
    }

    if (requestedDocs.length === 0 && notification.message) {
      generalRequests.push({
        name: 'Sent Back for Documentation',
        label: 'Sent Back for Documentation',
        status: 'Pending',
        createdAt: notification.createdAt,
        message: notification.message,
      });
    }
  }

  const documents: DocumentRequestListRow[] = Array.from(documentMap.entries()).map(([name, data]) => ({
    name,
    label: documentRequestDisplayLabel(name),
    status: data.status,
    createdAt: data.createdAt,
    fileUrl: data.fileUrl,
    fileId: data.fileId,
    message: data.message,
  }));

  generalRequests
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .forEach((req) => documents.push(req));

  return documents;
}
