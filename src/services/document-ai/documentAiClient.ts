import fs from 'fs';
import path from 'path';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import type { google } from '@google-cloud/documentai/build/protos/protos';
import { BACKEND_PACKAGE_ROOT } from '../../config/loadEnv';

type Document = google.cloud.documentai.v1.IDocument;
type ProcessRequest = google.cloud.documentai.v1.IProcessRequest;

let clientSingleton: DocumentProcessorServiceClient | undefined;

function resolveCredentialsPath(): string {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!raw) return '';
  if (path.isAbsolute(raw)) return raw;
  const fromCwd = path.resolve(process.cwd(), raw);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(BACKEND_PACKAGE_ROOT, raw);
}

export function getDocumentAiClient(): DocumentProcessorServiceClient {
  if (!clientSingleton) {
    const keyPath = resolveCredentialsPath();
    if (keyPath) {
      if (!fs.existsSync(keyPath)) {
        throw new Error(
          `GOOGLE_APPLICATION_CREDENTIALS points to a file that does not exist: ${keyPath}`,
        );
      }
      process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
      clientSingleton = new DocumentProcessorServiceClient({ keyFilename: keyPath });
    } else {
      clientSingleton = new DocumentProcessorServiceClient();
    }
  }
  return clientSingleton;
}

export function resolveDocumentAiProcessorName(processorId: string): string {
  const projectId = String(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '').trim();
  const location = String(process.env.DOCUMENT_AI_LOCATION || process.env.DOCAI_LOCATION || 'us').trim();
  const id = String(processorId || '').trim();
  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT (or GCP_PROJECT_ID) is required for Document AI');
  }
  if (!id) {
    throw new Error('DOCUMENT_AI_PROCESSOR_ID is required for Document AI PDF extraction');
  }
  return `projects/${projectId}/locations/${location}/processors/${id}`;
}

function readMaxPdfPages(): number {
  const raw = Number(process.env.DOCUMENT_AI_MAX_PAGES || 4);
  if (!Number.isFinite(raw) || raw <= 0) return 4;
  return Math.min(10, Math.floor(raw));
}

export async function processDocumentWithProcessor(
  buffer: Buffer,
  processorId: string,
  mimeType = 'application/pdf',
  options?: { maxPages?: number },
): Promise<Document> {
  if (!buffer.length) {
    throw new Error('processDocumentWithProcessor: empty buffer');
  }

  const client = getDocumentAiClient();
  const name = resolveDocumentAiProcessorName(processorId);
  const isPdf = String(mimeType || '').toLowerCase().includes('pdf');
  const maxPages = options?.maxPages ?? (isPdf ? readMaxPdfPages() : 0);
  const request: ProcessRequest = {
    name,
    skipHumanReview: true,
    rawDocument: {
      // gRPC accepts raw bytes; avoid a large base64 copy of every upload.
      content: buffer,
      mimeType,
    },
    processOptions: {
      ...(isPdf && maxPages > 0 ? { fromStart: maxPages } : {}),
      ocrConfig: {
        enableNativePdfParsing: true,
      },
    },
  };

  const startedAt = Date.now();
  let result: google.cloud.documentai.v1.IProcessResponse;
  try {
    [result] = await client.processDocument(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/processOptions|fromStart|ocrConfig|INVALID_ARGUMENT/i.test(msg)) {
      throw err;
    }
    console.warn('[documentAi] retrying without processOptions:', msg);
    [result] = await client.processDocument({
      name,
      skipHumanReview: true,
      rawDocument: {
        content: buffer,
        mimeType,
      },
    });
  }
  console.log(
    `[documentAi] processDocument ${buffer.length}b mime=${mimeType} pages<=${maxPages || 'all'} in ${Date.now() - startedAt}ms`,
  );
  if (!result.document) {
    throw new Error('Document AI returned no document payload');
  }
  return result.document;
}
