/**
 * PDF / image → OpenAI Chat Completions → structured key_data.
 *
 * Drop-in replacement for the Google Document AI / Claude extractors: it uses the
 * same prompts, JSON parsing and validation (PdfClaudeExtractionUtils), so callers
 * (application scan, driver's license, voided check) get the exact same shape.
 *
 * Env:
 *   OPEN_AI_KEY (or OPENAI_API_KEY)   required
 * Optional:
 *   OPENAI_PDF_MODEL        default gpt-4o (must accept image + PDF file input)
 *   OPENAI_PDF_MAX_TOKENS   default 12000
 *   OPENAI_API_URL          default https://api.openai.com/v1
 *   OPENAI_TIMEOUT_MS       default 120000
 *   PDF_HYBRID_MIN_TOTAL_LETTERS  default 500 (below this the PDF itself is sent, not its text)
 */

import {
  PdfClaudeExtractionUtils,
  extractEmbeddedPdfText,
  type ClaudePdfExtractMetaDTO,
  type PdfClaudeExtractResultDTO,
} from '../../nestjs-claude-pdf/claude-pdf-extraction.service';

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'high' | 'low' | 'auto' } }
  | { type: 'file'; file: { filename: string; file_data: string } };

export function readOpenAiApiKey(): string {
  return String(
    process.env.OPEN_AI_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENAI_KEY ||
      process.env.OPEN_AI_API_KEY ||
      '',
  ).trim();
}

function readPositiveInt(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function detectMime(buffer: Buffer, declared: string): string {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).toString('latin1') === '\x89PNG\r\n\x1a\n') {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }
  const mime = String(declared || '').toLowerCase().trim();
  if (mime === 'image/jpg') return 'image/jpeg';
  return mime || 'application/pdf';
}

function pdfPart(pdf: Buffer, filename = 'document.pdf'): ChatContentPart {
  return {
    type: 'file',
    file: { filename, file_data: `data:application/pdf;base64,${pdf.toString('base64')}` },
  };
}

function imagePart(buffer: Buffer, mime: string): ChatContentPart {
  return {
    type: 'image_url',
    image_url: { url: `data:${mime};base64,${buffer.toString('base64')}`, detail: 'high' },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class OpenAiPdfExtractionService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.apiKey = readOpenAiApiKey();
    if (!this.apiKey) {
      throw new Error('OPEN_AI_KEY (or OPENAI_API_KEY) is required for OpenAI PDF extraction');
    }
    this.baseUrl = (String(process.env.OPENAI_API_URL || '').trim() || 'https://api.openai.com/v1').replace(
      /\/+$/,
      '',
    );
    this.model = String(process.env.OPENAI_PDF_MODEL || '').trim() || 'gpt-4o';
  }

  getRuntimeDebugConfig(): Record<string, unknown> {
    return { provider: 'openai', model: this.model };
  }

  /** Application scan: text path for text PDFs, the PDF itself for scanned ones. */
  async extractHybridFromPdfBuffer(
    pdf: Buffer,
  ): Promise<{ result: PdfClaudeExtractResultDTO; meta: ClaudePdfExtractMetaDTO }> {
    if (!pdf.length) throw new Error('extractHybridFromPdfBuffer: empty PDF buffer');

    const fullText = await extractEmbeddedPdfText(pdf);
    const letters = PdfClaudeExtractionUtils.countLetters(fullText);
    const minLetters = readPositiveInt('PDF_HYBRID_MIN_TOTAL_LETTERS', 500);
    const system = PdfClaudeExtractionUtils.buildSystemPrompt();

    let result: PdfClaudeExtractResultDTO;
    let mode: ClaudePdfExtractMetaDTO['text_mode_used'];

    if (letters >= minLetters) {
      const user = PdfClaudeExtractionUtils.buildUserTextPass(fullText, []);
      result = PdfClaudeExtractionUtils.validateResult(
        PdfClaudeExtractionUtils.parseJsonFromModel(
          await this.chat(system, [{ type: 'text', text: user }]),
        ),
      );
      mode = 'text';
    } else {
      // Scanned / image-only PDF: let the model read the pages.
      result = PdfClaudeExtractionUtils.validateResult(
        PdfClaudeExtractionUtils.parseJsonFromModel(
          await this.chat(system, [
            pdfPart(pdf),
            {
              type: 'text',
              text:
                'The attached file is the document. Read every page and produce the single JSON object ' +
                'described in the system instructions. If it is a statement with transaction lines, ' +
                'populate transactions[]; otherwise use [].',
            },
          ]),
        ),
      );
      mode = 'vision_base64';
    }

    if (!String(result.key_data?.business_name ?? '').trim()) {
      result = await this.retryMissingBusinessName(result, mode === 'text' ? fullText : null, pdf);
    }

    result.raw_ocr_text = fullText;
    result = PdfClaudeExtractionUtils.enrichFromRawText(result, fullText);
    result = PdfClaudeExtractionUtils.withCanonicalBusinessName(result);
    result.raw_ocr_text = fullText;

    return { result, meta: { text_mode_used: mode, extracted_letters: letters } };
  }

  /** Driver's license or voided check / bank letter (image or PDF). */
  async extractKycDocument(
    buffer: Buffer,
    mimeType: string,
    documentType: 'driverLicense' | 'voidedCheck',
  ): Promise<{ key_data: Record<string, string> }> {
    if (!buffer.length) throw new Error('extractKycDocument: empty file buffer');

    const mime = detectMime(buffer, mimeType);
    const isImage = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
    const isPdf = mime === 'application/pdf' || mime === 'application/x-pdf';
    if (!isImage && !isPdf) {
      throw new Error(`Unsupported file type for KYC extraction: ${mimeType || 'unknown'}`);
    }

    const { system, userPrompt } = PdfClaudeExtractionUtils.buildKycSystemAndPrompt(documentType);
    const raw = await this.chat(system, [
      isImage ? imagePart(buffer, mime) : pdfPart(buffer, `${documentType}.pdf`),
      { type: 'text', text: userPrompt },
    ]);
    const validated = PdfClaudeExtractionUtils.validateKycResult(
      PdfClaudeExtractionUtils.parseJsonFromModel(raw),
      documentType,
    );
    return { key_data: validated.key_data };
  }

  private async retryMissingBusinessName(
    base: PdfClaudeExtractResultDTO,
    fullText: string | null,
    pdf: Buffer,
  ): Promise<PdfClaudeExtractResultDTO> {
    const dtype = String(base.document_type ?? '').toLowerCase();
    const looksLikeApp =
      /(application|funding|merchant|loan|mca)/.test(dtype) ||
      !!base.key_data?.owner_first_name ||
      !!base.key_data?.owner_last_name ||
      !!base.key_data?.ssn;
    const likelyForm = !Array.isArray(base.transactions) || base.transactions.length === 0;
    if (!looksLikeApp && !likelyForm) return base;

    const system =
      'You extract business-funding application fields. Return one JSON object only with key_data. ' +
      'Set key_data.business_name to the legal merchant/business name exactly as printed. ' +
      'Also include legal_business_name, company_name, merchant_name, dba_name if present.';
    try {
      const content: ChatContentPart[] = fullText
        ? [
            {
              type: 'text',
              text:
                'Extract only missing merchant-name fields from this document text.\n\n' +
                `Document text:\n${PdfClaudeExtractionUtils.clip(fullText, 120_000)}`,
            },
          ]
        : [pdfPart(pdf), { type: 'text', text: 'Extract only the merchant-name fields from this document.' }];
      const retry = PdfClaudeExtractionUtils.validateResult(
        PdfClaudeExtractionUtils.parseJsonFromModel(await this.chat(system, content)),
      );
      return PdfClaudeExtractionUtils.mergeBusinessNameAliases(base, retry.key_data || {});
    } catch (err) {
      console.warn('[openaiPdf] business-name retry failed:', err instanceof Error ? err.message : err);
      return base;
    }
  }

  /** One JSON-mode chat completion, retried on rate limits / transient server errors. */
  private async chat(system: string, content: ChatContentPart[]): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      temperature: 0,
      max_tokens: readPositiveInt('OPENAI_PDF_MAX_TOKENS', 12000),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    });
    const timeoutMs = readPositiveInt('OPENAI_TIMEOUT_MS', 120_000);
    const maxAttempts = 3;

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt < maxAttempts) {
          await sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        throw new Error(`OpenAI request failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (res.ok) {
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>;
        };
        const msg = json.choices?.[0]?.message;
        if (msg?.refusal) throw new Error(`OpenAI refused the extraction: ${msg.refusal}`);
        return String(msg?.content ?? '').trim();
      }

      const errText = (await res.text().catch(() => '')).slice(0, 500);
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`OpenAI API error ${res.status}: ${errText}`);
    }
  }
}
