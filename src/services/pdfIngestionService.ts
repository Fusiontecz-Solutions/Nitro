/**
 * Gmail / PDF-ingest pipeline: local text / form fields first, Document AI only if needed.
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

function countLetters(text: string): number {
    return (String(text || '').match(/[A-Za-z]/g) || []).length;
}

function humanizePdfFieldName(name: string): string {
    return String(name || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_./]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Fillable MCA apps often store values only in AcroForm fields, which pdf-parse misses.
 * Dumping "Label : value" lets enrichFromRawText / parseBusinessData run locally.
 */
async function extractPdfFormFieldText(buffer: Buffer): Promise<string> {
    try {
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.load(buffer, {
            ignoreEncryption: true,
            updateMetadata: false,
        });
        const fields = doc.getForm().getFields();
        const lines: string[] = [];
        for (const field of fields) {
            const name = field.getName();
            if (!name) continue;
            let value = '';
            const maybe = field as {
                getText?: () => string | undefined;
                getSelected?: () => string | string[] | undefined;
            };
            try {
                if (typeof maybe.getText === 'function') {
                    value = String(maybe.getText() ?? '').trim();
                } else if (typeof maybe.getSelected === 'function') {
                    const selected = maybe.getSelected();
                    value = Array.isArray(selected)
                        ? selected.filter(Boolean).join(', ')
                        : String(selected ?? '').trim();
                }
            } catch {
                // skip unreadable widget
            }
            if (!value) continue;
            const label = humanizePdfFieldName(name);
            lines.push(`${label} : ${value}`);
        }
        return lines.join('\n');
    } catch {
        return '';
    }
}

function localExtractIsSufficient(
    letters: number,
    keyData: Record<string, string>,
): boolean {
    const fn = String(keyData.owner_first_name || '').trim();
    const ln = String(keyData.owner_last_name || '').trim();
    const biz = String(keyData.business_name || keyData.legal_business_name || '').trim();
    const ein = String(keyData.ein || keyData.business_ein_number || keyData.federal_tax_id || '').trim();
    if (fn && ln) return true;
    if (biz && ein) return true;
    return letters >= LOCAL_TEXT_MIN_LETTERS && Boolean(biz || fn);
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
    const startedAt = Date.now();

    try {
        const localStartedAt = Date.now();
        const [embeddedRaw, formText] = await Promise.all([
            extractEmbeddedPdfText(pdfBuffer),
            extractPdfFormFieldText(pdfBuffer),
        ]);
        const embedded = [formText, embeddedRaw].filter((part) => part.trim().length > 0).join('\n\n');
        const letters = countLetters(embedded);
        const result = PdfClaudeExtractionUtils.withCanonicalBusinessName(
            PdfClaudeExtractionUtils.enrichFromRawText(emptyExtractResult(), embedded),
        );
        const kd = result.key_data || {};
        const fn = String(kd.owner_first_name || '').trim();
        const ln = String(kd.owner_last_name || '').trim();
        console.log(
            `[pdfIngestion] local extract (${name}): letters=${letters} form_lines=${formText ? formText.split('\n').length : 0} owner="${fn} ${ln}" in ${Date.now() - localStartedAt}ms`,
        );

        if (localExtractIsSufficient(letters, kd)) {
            const synthetic = claudePdfResultToSyntheticParseText(result);
            console.log(
                `[pdfIngestion] local-text fast path (${name}): letters=${letters} owner="${fn} ${ln}" total=${Date.now() - startedAt}ms`,
            );
            return `${synthetic}\n\n${embedded}`;
        }

        console.log(
            `[pdfIngestion] local text insufficient (${name}): letters=${letters} owner=${Boolean(fn && ln)}; calling Document AI`,
        );
        const svc = getPdfExtractionService();
        const { result: aiResult, meta } = await svc.extractHybridFromPdfBuffer(pdfBuffer);
        const dbg = svc.getRuntimeDebugConfig();
        const aiKd = aiResult.key_data || {};
        const nonEmptyKeyCount = Object.values(aiKd).filter((v) => String(v ?? '').trim().length > 0).length;
        console.log(
            `[pdfIngestion] PDF extraction (${name}): provider=${String((dbg as { provider?: string }).provider ?? 'claude')} mode=${meta.text_mode_used} letters_seen=${meta.extracted_letters} bytes=${pdfBuffer.length} key_data_non_empty=${nonEmptyKeyCount} total=${Date.now() - startedAt}ms`,
        );
        console.log(
            `[pdfIngestion] key preview (${name}): business_name="${String(aiKd.business_name ?? '').trim()}" legal_business_name="${String(aiKd.legal_business_name ?? '').trim()}" owner_first_name="${String(aiKd.owner_first_name ?? '').trim()}" owner_last_name="${String(aiKd.owner_last_name ?? '').trim()}"`,
        );
        const synthetic = claudePdfResultToSyntheticParseText(aiResult);
        const rawOcr = String(aiResult.raw_ocr_text || aiResult.summary || '').trim();
        const hasOwner =
            !!String(aiKd.owner_first_name || '').trim() &&
            !!String(aiKd.owner_last_name || '').trim();
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
