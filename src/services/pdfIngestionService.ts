/**
 * Gmail / PDF-ingest pipeline: Document AI (or Claude) hybrid extraction → synthetic parse text.
 * Same path as Ocean — always run the configured extractor; never skip on local PDF text.
 */
import path from 'path';
import { getPdfExtractionService } from './pdf-extraction/pdfExtraction.context';
import { claudePdfResultToSyntheticParseText } from './claudePdfResultToSyntheticParseText';

export async function extractPdfPlainTextForParsing(
    pdfBuffer: Buffer,
    originalFilename: string,
    filePathFallback?: string,
): Promise<string> {
    const name =
        originalFilename?.trim?.() ||
        path.basename(filePathFallback || '') ||
        'document.pdf';
    const startedAt = Date.now();

    try {
        const svc = getPdfExtractionService();
        const { result, meta } = await svc.extractHybridFromPdfBuffer(pdfBuffer);
        const dbg = svc.getRuntimeDebugConfig();
        const kd = result.key_data || {};
        const nonEmptyKeyCount = Object.values(kd).filter((v) => String(v ?? '').trim().length > 0).length;
        console.log(
            `[pdfIngestion] PDF extraction (${name}): provider=${String((dbg as { provider?: string }).provider ?? 'claude')} mode=${meta.text_mode_used} letters_seen=${meta.extracted_letters} bytes=${pdfBuffer.length} key_data_non_empty=${nonEmptyKeyCount} total=${Date.now() - startedAt}ms`,
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
            return `${synthetic}\n\n${rawOcr}`;
        }
        return synthetic;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[pdfIngestion] PDF extraction failed for "${name}". ${msg}`);
    }
}
