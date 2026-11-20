import type { ConfigService } from '@nestjs/config';
import { ClaudePdfExtractionService } from '../../nestjs-claude-pdf/claude-pdf-extraction.service';
import { OpenAiPdfExtractionService } from '../openai/openAiPdfExtraction.service';

/**
 * All document extraction — application creation (upload + Gmail auto-create),
 * driver's license and voided check — runs on OpenAI. Google Document AI is no
 * longer used anywhere, whatever PDF_EXTRACTION_PROVIDER says.
 */
export type PdfExtractionProvider = 'openai';

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

export function readProvider(): PdfExtractionProvider {
  return 'openai';
}

/**
 * OpenAI extraction. Throws a clear error (OPEN_AI_KEY missing) instead of
 * falling back to another provider; a failed build is not cached, so adding the
 * key and restarting is enough.
 */
export function getPdfExtractionService(): PdfExtractionServiceLike {
  return (singleton ??= new OpenAiPdfExtractionService());
}

/** Driver's license / voided check extraction — same OpenAI service. */
export function getKycExtractionService(): PdfExtractionServiceLike {
  return getPdfExtractionService();
}

function buildEnvConfigService(): Pick<ConfigService, 'get'> {
  return {
    get: <T = string>(key: string): T | undefined => {
      let v = process.env[key];
      if (v == null || v === '') {
        const bomKey = Object.keys(process.env).find((k) => k.replace(/^\uFEFF/, '') === key);
        if (bomKey) v = process.env[bomKey];
      }
      return (v ?? undefined) as T | undefined;
    },
  } as Pick<ConfigService, 'get'>;
}

/** Claude extraction, kept for explicit callers only (none in the app today). */
export function getClaudePdfExtractionService(): PdfExtractionServiceLike {
  return new ClaudePdfExtractionService(buildEnvConfigService() as ConfigService);
}
