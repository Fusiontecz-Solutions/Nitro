import type { ConfigService } from '@nestjs/config';
import { ClaudePdfExtractionService } from '../../nestjs-claude-pdf/claude-pdf-extraction.service';
import { DocumentAiPdfExtractionService } from '../document-ai/documentAiPdfExtraction.service';

export type PdfExtractionProvider = 'documentai' | 'claude';

export interface PdfExtractionServiceLike {
  getRuntimeDebugConfig(): Record<string, unknown>;
  extractHybridFromPdfBuffer(
    pdf: Buffer,
  ): Promise<{
    result: import('../../nestjs-claude-pdf/claude-pdf-extraction.service').PdfClaudeExtractResultDTO;
    meta: import('../../nestjs-claude-pdf/claude-pdf-extraction.service').ClaudePdfExtractMetaDTO;
  }>;
  extractKycDocument(
    buffer: Buffer,
    mimeType: string,
    documentType: 'driverLicense' | 'voidedCheck',
  ): Promise<{ key_data: Record<string, string> }>;
}

let singleton: PdfExtractionServiceLike | undefined;

function readProvider(): PdfExtractionProvider {
  const raw = String(process.env.PDF_EXTRACTION_PROVIDER || 'documentai')
    .trim()
    .toLowerCase();
  if (raw === 'claude' || raw === 'anthropic') return 'claude';
  return 'documentai';
}

function buildEnvConfigService(): Pick<ConfigService, 'get'> {
  return {
    get: <T = string>(key: string): T | undefined => {
      let v = process.env[key];
      if (v == null || v === '') {
        const bomKey = Object.keys(process.env).find((k) => k.replace(/^\ufeff/, '') === key);
        if (bomKey) v = process.env[bomKey];
      }
      return (v ?? undefined) as T | undefined;
    },
  } as Pick<ConfigService, 'get'>;
}

/** Document AI by default; Claude when PDF_EXTRACTION_PROVIDER=claude. */
export function getPdfExtractionService(): PdfExtractionServiceLike {
  if (!singleton) {
    singleton =
      readProvider() === 'claude'
        ? new ClaudePdfExtractionService(buildEnvConfigService() as ConfigService)
        : new DocumentAiPdfExtractionService();
  }
  return singleton;
}

/** @deprecated Use getPdfExtractionService() */
export function getClaudePdfExtractionService(): PdfExtractionServiceLike {
  return getPdfExtractionService();
}
