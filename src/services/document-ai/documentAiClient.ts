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

export async function processDocumentWithProcessor(
  buffer: Buffer,
  processorId: string,
  mimeType = 'application/pdf',
): Promise<Document> {
  if (!buffer.length) {
    throw new Error('processDocumentWithProcessor: empty buffer');
  }

  const client = getDocumentAiClient();
  const name = resolveDocumentAiProcessorName(processorId);
  const request: ProcessRequest = {
    name,
    rawDocument: {
      content: buffer.toString('base64'),
      mimeType,
    },
  };

  const startedAt = Date.now();
  const [result] = await client.processDocument(request);
  console.log(
    `[documentAi] processDocument ${buffer.length}b mime=${mimeType} in ${Date.now() - startedAt}ms`,
  );
  if (!result.document) {
    throw new Error('Document AI returned no document payload');
  }
  return result.document;
}
