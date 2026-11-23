/**
 * PDF / image → OpenAI Chat Completions → structured key_data.
 *
 * Used for application creation (upload + Gmail auto-create), driver's license and
 * voided check. Output shape matches the old Claude / Document AI extractors, so
 * downstream parsing is unchanged.
 *
 * Token budget (what this file does to avoid paying for tokens nobody uses):
 *  - Application prompt asks for key_data only: no transactions[], pages[] or long
 *    summaries (application creation never reads them; on packets that bundle bank
 *    statements those were thousands of output tokens).
 *  - Text PDFs: whitespace is collapsed and input is capped (application data sits
 *    on the first pages). Scanned PDFs: only the first pages are sent as a file.
 *  - Business-name retry only on the text path, with a short excerpt.
 *  - Identical files are served from an in-memory cache (and concurrent identical
 *    requests share one call), so re-uploads / re-extracts cost nothing.
 *  - Token usage is logged per call: "[openaiPdf] ... in=.. cached=.. out=..".
 *
 * Env:
 *   OPEN_AI_KEY (or OPENAI_API_KEY / OPENAI_KEY / OPEN_AI_API_KEY)   required
 * Optional:
 *   OPENAI_PDF_MODEL              default gpt-4o (gpt-4o-mini is ~15x cheaper; spot-check accuracy)
 *   OPENAI_PDF_MAX_TOKENS         output cap for applications, default 4000
 *   OPENAI_KYC_MAX_TOKENS         output cap for license / check, default 1500
 *   OPENAI_APP_MAX_INPUT_CHARS    text sent for text PDFs, default 40000 (~10k tokens)
 *   OPENAI_APP_MAX_PDF_PAGES      pages sent for scanned application PDFs, default 6
 *   OPENAI_KYC_MAX_PDF_PAGES      pages sent for license / check PDFs, default 2
 *   OPENAI_CACHE_TTL_SECONDS      in-memory result cache, default 86400 (0 disables)
 *   OPENAI_CACHE_MAX_ENTRIES      default 200
 *   OPENAI_API_URL                default https://api.openai.com/v1
 *   OPENAI_TIMEOUT_MS             default 120000
 *   PDF_HYBRID_MIN_TOTAL_LETTERS  default 500 (below this the PDF itself is sent, not its text)
 */

import crypto from 'crypto';
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

/** Bump when prompts change so cached results from older prompts are not reused. */
const PROMPT_VERSION = 'v2';

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

function readNonNegativeInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
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

/** Collapse pdf-parse padding (runs of spaces, blank lines) — pure token savings. */
export function compactPdfText(text: string): string {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Keep only the first `maxPages` pages; returns the original buffer if it is already short or unreadable. */
async function firstPdfPages(pdf: Buffer, maxPages: number): Promise<{ buffer: Buffer; pages: number; sent: number }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PDFDocument } = require('pdf-lib') as typeof import('pdf-lib');
    const src = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
    const pages = src.getPageCount();
    if (pages <= maxPages) return { buffer: pdf, pages, sent: pages };
    const out = await PDFDocument.create();
    const copied = await out.copyPages(
      src,
      Array.from({ length: maxPages }, (_, i) => i),
    );
    copied.forEach((p) => out.addPage(p));
    return { buffer: Buffer.from(await out.save()), pages, sent: maxPages };
  } catch (err) {
    console.warn('[openaiPdf] could not trim PDF pages, sending whole file:', err instanceof Error ? err.message : err);
    return { buffer: pdf, pages: -1, sent: -1 };
  }
}

function pdfPart(pdf: Buffer, filename = 'document.pdf'): ChatContentPart {
  return {
    type: 'file',
    file: { filename, file_data: `data:application/pdf;base64,${pdf.toString('base64')}` },
  };
}

function imagePart(buffer: Buffer, mime: string): ChatContentPart {
  return {
    // High detail: account / routing / license numbers must be read exactly.
    type: 'image_url',
    image_url: { url: `data:${mime};base64,${buffer.toString('base64')}`, detail: 'high' },
  };
}

/**
 * Application-creation prompt. Lists the fields the CRM parser actually reads
 * (claudePdfResultToSyntheticParseText) and forbids the large arrays it never uses.
 */
function buildApplicationSystemPrompt(): string {
  return [
    'You extract fields from business-funding / merchant cash advance application documents.',
    'Reply with ONE JSON object only: {"document_type": string, "summary": string, "key_data": {string: string}}.',
    '- summary: at most one short sentence.',
    '- Do NOT include transactions, pages, page notes or any other keys.',
    '- The file may also contain bank statements or other documents: ignore them and read only the application.',
    '',
    'key_data fields (omit a field if it is not on the application; never invent values):',
    'business_name (legal/corporate name), dba_name, physical_address, city, state, zip, phone, website,',
    'type_of_entity, email (business email), ein, date_business_started, requested_amount,',
    'gross_annual_sales, length_of_ownership, industry, use_of_funds,',
    'owner_first_name, owner_last_name, owner_email, home_address, owner_city, owner_state, owner_zip,',
    'owner_mobile, ownership_percent, credit_score, ssn, date_of_birth,',
    'owner2_first_name, owner2_last_name, owner2_email, owner2_mobile, owner2_ownership_percent, owner2_ssn,',
    'owner2_date_of_birth, owner2_home_address.',
    '',
    'Rules:',
    '- Values are the raw field values only, without labels (no "Owner Mobile :").',
    '- business_name is the legal entity name; if only a DBA is shown, use it for both.',
    '- Copy numbers exactly as printed (SSN, EIN, phone, amounts).',
  ].join('\n');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CacheEntry = { at: number; value: unknown };
const resultCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const ttlMs = readNonNegativeInt('OPENAI_CACHE_TTL_SECONDS', 86_400) * 1000;
  if (!ttlMs) return undefined;
  const hit = resultCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlMs) {
    resultCache.delete(key);
    return undefined;
  }
  // Refresh LRU position.
  resultCache.delete(key);
  resultCache.set(key, hit);
  return structuredClone(hit.value) as T;
}

function cacheSet(key: string, value: unknown): void {
  if (!readNonNegativeInt('OPENAI_CACHE_TTL_SECONDS', 86_400)) return;
  resultCache.set(key, { at: Date.now(), value: structuredClone(value) });
  const max = readPositiveInt('OPENAI_CACHE_MAX_ENTRIES', 200);
  while (resultCache.size > max) {
    const oldest = resultCache.keys().next().value;
    if (oldest === undefined) break;
    resultCache.delete(oldest);
  }
}

/**
 * Serve identical requests from cache and let concurrent identical requests share
 * one API call. Results stay in this process's memory only (they contain SSNs and
 * account numbers), never in Redis or on disk.
 */
async function cached<T>(key: string, label: string, run: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) {
    console.log(`[openaiPdf] ${label}: cache hit, no API call`);
    return hit;
  }
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) {
    console.log(`[openaiPdf] ${label}: joined identical in-flight request`);
    return structuredClone(await pending);
  }
  const p = run()
    .then((value) => {
      cacheSet(key, value);
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return structuredClone(await p);
}

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

  private cacheKey(kind: string, buffer: Buffer): string {
    return crypto
      .createHash('sha256')
      .update(`${kind}|${this.model}|${PROMPT_VERSION}|`)
      .update(buffer)
      .digest('hex');
  }

  /** Application creation: text path for text PDFs, first pages as a file for scanned ones. */
  async extractHybridFromPdfBuffer(
    pdf: Buffer,
  ): Promise<{ result: PdfClaudeExtractResultDTO; meta: ClaudePdfExtractMetaDTO }> {
    if (!pdf.length) throw new Error('extractHybridFromPdfBuffer: empty PDF buffer');
    return cached(this.cacheKey('application', pdf), 'application', () => this.extractApplication(pdf));
  }

  private async extractApplication(
    pdf: Buffer,
  ): Promise<{ result: PdfClaudeExtractResultDTO; meta: ClaudePdfExtractMetaDTO }> {
    const fullText = await extractEmbeddedPdfText(pdf);
    const letters = PdfClaudeExtractionUtils.countLetters(fullText);
    const minLetters = readPositiveInt('PDF_HYBRID_MIN_TOTAL_LETTERS', 500);
    const system = buildApplicationSystemPrompt();
    const maxTokens = readPositiveInt('OPENAI_PDF_MAX_TOKENS', 4000);

    let result: PdfClaudeExtractResultDTO;
    let mode: ClaudePdfExtractMetaDTO['text_mode_used'];

    if (letters >= minLetters) {
      const compact = PdfClaudeExtractionUtils.clip(
        compactPdfText(fullText),
        readPositiveInt('OPENAI_APP_MAX_INPUT_CHARS', 40_000),
      );
      result = PdfClaudeExtractionUtils.validateResult(
        PdfClaudeExtractionUtils.parseJsonFromModel(
          await this.chat('application:text', system, [{ type: 'text', text: `Document text:\n${compact}` }], maxTokens),
        ),
      );
      mode = 'text';
    } else {
      // Scanned / image-only PDF: send only the first pages (each page costs image tokens).
      const trimmed = await firstPdfPages(pdf, readPositiveInt('OPENAI_APP_MAX_PDF_PAGES', 6));
      result = PdfClaudeExtractionUtils.validateResult(
        PdfClaudeExtractionUtils.parseJsonFromModel(
          await this.chat(
            `application:scan(${trimmed.sent}/${trimmed.pages} pages)`,
            system,
            [pdfPart(trimmed.buffer), { type: 'text', text: 'Read the application in the attached file.' }],
            maxTokens,
          ),
        ),
      );
      mode = 'vision_base64';
    }

    // Never pay for arrays the CRM does not read, even if the model adds them.
    result.transactions = [];
    result.pages = [];

    if (mode === 'text' && !String(result.key_data?.business_name ?? '').trim()) {
      result = await this.retryMissingBusinessName(result, fullText);
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
    return cached(this.cacheKey(`kyc:${documentType}`, buffer), documentType, () =>
      this.extractKyc(buffer, mimeType, documentType),
    );
  }

  private async extractKyc(
    buffer: Buffer,
    mimeType: string,
    documentType: 'driverLicense' | 'voidedCheck',
  ): Promise<{ key_data: Record<string, string> }> {
    const mime = detectMime(buffer, mimeType);
    const isImage = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
    const isPdf = mime === 'application/pdf' || mime === 'application/x-pdf';
    if (!isImage && !isPdf) {
      throw new Error(`Unsupported file type for KYC extraction: ${mimeType || 'unknown'}`);
    }

    let filePart: ChatContentPart;
    if (isImage) {
      filePart = imagePart(buffer, mime);
    } else {
      const trimmed = await firstPdfPages(buffer, readPositiveInt('OPENAI_KYC_MAX_PDF_PAGES', 2));
      filePart = pdfPart(trimmed.buffer, `${documentType}.pdf`);
    }

    const { system, userPrompt } = PdfClaudeExtractionUtils.buildKycSystemAndPrompt(documentType);
    const raw = await this.chat(
      `kyc:${documentType}`,
      system,
      [filePart, { type: 'text', text: userPrompt }],
      readPositiveInt('OPENAI_KYC_MAX_TOKENS', 1500),
    );
    const validated = PdfClaudeExtractionUtils.validateKycResult(
      PdfClaudeExtractionUtils.parseJsonFromModel(raw),
      documentType,
    );
    return { key_data: validated.key_data };
  }

  /** Cheap second pass for a missing legal name: short excerpt, tiny output. */
  private async retryMissingBusinessName(
    base: PdfClaudeExtractResultDTO,
    fullText: string,
  ): Promise<PdfClaudeExtractResultDTO> {
    const dtype = String(base.document_type ?? '').toLowerCase();
    const looksLikeApp =
      /(application|funding|merchant|loan|mca)/.test(dtype) ||
      !!base.key_data?.owner_first_name ||
      !!base.key_data?.owner_last_name ||
      !!base.key_data?.ssn;
    if (!looksLikeApp) return base;

    const system =
      'Return one JSON object {"key_data": {...}} with only business_name (legal merchant/business ' +
      'name exactly as printed) and, if present, legal_business_name, dba_name.';
    try {
      const excerpt = PdfClaudeExtractionUtils.clip(compactPdfText(fullText), 8_000);
      const retry = PdfClaudeExtractionUtils.validateResult(
        PdfClaudeExtractionUtils.parseJsonFromModel(
          await this.chat('application:name-retry', system, [{ type: 'text', text: excerpt }], 300),
        ),
      );
      return PdfClaudeExtractionUtils.mergeBusinessNameAliases(base, retry.key_data || {});
    } catch (err) {
      console.warn('[openaiPdf] business-name retry failed:', err instanceof Error ? err.message : err);
      return base;
    }
  }

  /** One JSON-mode chat completion, retried on rate limits / transient server errors. */
  private async chat(label: string, system: string, content: ChatContentPart[], maxTokens: number): Promise<string> {
    const body = JSON.stringify({
      model: this.model,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    });
    const timeoutMs = readPositiveInt('OPENAI_TIMEOUT_MS', 120_000);
    const maxAttempts = 3;
    const startedAt = Date.now();

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
          choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          };
        };
        const u = json.usage || {};
        const choice = json.choices?.[0];
        console.log(
          `[openaiPdf] ${label} model=${this.model} in=${u.prompt_tokens ?? '?'} cached=${u.prompt_tokens_details?.cached_tokens ?? 0} out=${u.completion_tokens ?? '?'} finish=${choice?.finish_reason ?? '?'} ${Date.now() - startedAt}ms`,
        );
        if (choice?.message?.refusal) throw new Error(`OpenAI refused the extraction: ${choice.message.refusal}`);
        return String(choice?.message?.content ?? '').trim();
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
