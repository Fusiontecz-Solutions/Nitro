/**
 * Gmail / PDF-ingest pipeline: Claude hybrid extraction (text + optional vision).
 * Builds synthetic labeled text compatible with parseBusinessData.
 */
import path from 'path';
import { getClaudePdfExtractionService } from '../nestjs-claude-pdf/claude-pdf-extraction.context';
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

    try {
        const svc = getClaudePdfExtractionService();
        const { result, meta } = await svc.extractHybridFromPdfBuffer(pdfBuffer);
        const dbg = svc.getRuntimeDebugConfig();
        const kd = result.key_data || {};
        const nonEmptyKeyCount = Object.values(kd).filter((v) => String(v ?? '').trim().length > 0).length;
        console.log(
            `[pdfIngestion] Claude PDF extraction (${name}): model=${dbg.model} mode=${meta.text_mode_used} visionDisabled=${dbg.disableVisionFallback} letters_seen=${meta.extracted_letters} bytes=${pdfBuffer.length} key_data_non_empty=${nonEmptyKeyCount}`,
        );
        console.log(
            `[pdfIngestion] Claude key preview (${name}): business_name="${String(kd.business_name ?? '').trim()}" legal_business_name="${String(kd.legal_business_name ?? '').trim()}" owner_first_name="${String(kd.owner_first_name ?? '').trim()}" owner_last_name="${String(kd.owner_last_name ?? '').trim()}"`,
        );
        return claudePdfResultToSyntheticParseText(result);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `[pdfIngestion] Claude PDF extraction failed for "${name}". ${msg}`,
        );
    }
}
