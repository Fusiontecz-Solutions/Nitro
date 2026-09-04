/**
 * Gmail / PDF-ingest pipeline: Claude hybrid extraction → synthetic parse text.
 */
import path from 'path';
import { getPdfExtractionService } from './pdf-extraction/pdfExtraction.context';
import { claudePdfResultToSyntheticParseText } from './claudePdfResultToSyntheticParseText';
import {
    extractEmbeddedPdfText,
    PdfClaudeExtractionUtils,
    type PdfClaudeExtractResultDTO,
} from '../nestjs-claude-pdf/claude-pdf-extraction.service';

const LOCAL_TEXT_MIN_LETTERS = 400;

function emptyExtractResult(): PdfClaudeExtractResultDTO {
    return {
        document_type: 'application',
        title: '',
        summary: '',
        key_data: {},
        pages: [],
        transactions: [],
    };
}

export async function extractPdfPlainTextForParsing(
    pdfBuffer: Buffer,
    originalFilename: string,
    filePathFallback?: string,
): Promise<string> {
    const name =
        originalFilename?.trim?.() ||
        path.basename(filePathFallback || '') ||
        'document.pdf';

    try {
        const embedded = await extractEmbeddedPdfText(pdfBuffer);
        const letters = (embedded.match(/[A-Za-z]/g) || []).length;
        // Text PDFs: skip Google Document AI. parseBusinessData often misses first+last
        // even when enrichFromRawText (the same post-processor Document AI uses) finds them.
        if (letters >= 200) {
            const result = PdfClaudeExtractionUtils.withCanonicalBusinessName(
                PdfClaudeExtractionUtils.enrichFromRawText(emptyExtractResult(), embedded),
            );
            const kd = result.key_data || {};
            const fn = String(kd.owner_first_name || '').trim();
            const ln = String(kd.owner_last_name || '').trim();
            if (letters >= LOCAL_TEXT_MIN_LETTERS || (fn && ln)) {
                const synthetic = claudePdfResultToSyntheticParseText(result);
                console.log(
                    `[pdfIngestion] local-text fast path (${name}): letters=${letters} owner="${fn} ${ln}"`,
                );
                return `${synthetic}\n\n${embedded}`;
            }
        }

        const svc = getPdfExtractionService();
        const { result, meta } = await svc.extractHybridFromPdfBuffer(pdfBuffer);
        const dbg = svc.getRuntimeDebugConfig();
        const kd = result.key_data || {};
        const nonEmptyKeyCount = Object.values(kd).filter((v) => String(v ?? '').trim().length > 0).length;
        console.log(
            `[pdfIngestion] PDF extraction (${name}): provider=${String((dbg as { provider?: string }).provider ?? 'claude')} mode=${meta.text_mode_used} letters_seen=${meta.extracted_letters} bytes=${pdfBuffer.length} key_data_non_empty=${nonEmptyKeyCount}`,
        );
        console.log(
            `[pdfIngestion] key preview (${name}): business_name="${String(kd.business_name ?? '').trim()}" legal_business_name="${String(kd.legal_business_name ?? '').trim()}" owner_first_name="${String(kd.owner_first_name ?? '').trim()}" owner_last_name="${String(kd.owner_last_name ?? '').trim()}"`,
        );
        const synthetic = claudePdfResultToSyntheticParseText(result);
        const rawOcr = String(result.raw_ocr_text || result.summary || '').trim();
        const hasOwner =
            !!String(kd.owner_first_name || '').trim() &&
            !!String(kd.owner_last_name || '').trim();
        if (!hasOwner && rawOcr.length > 40) {
            console.log(
                `[pdfIngestion] owner names missing from key_data; appending OCR/PDF text (${rawOcr.length} chars)`,
            );
            console.log(
                `[pdfIngestion] OCR preview (${name}):\n`,
                rawOcr.length > 800 ? `${rawOcr.slice(0, 800)}…` : rawOcr,
            );
            return `${synthetic}\n\n${rawOcr}`;
        }
        return synthetic;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[pdfIngestion] PDF extraction failed for "${name}". ${msg}`);
    }
}
