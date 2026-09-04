import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const LOG_PREFIX = '[letter-html-pdf]';

/** Puppeteer `setContent` timeout (ms) ΓÇö letters may load many external images. */
const SET_CONTENT_TIMEOUT_MS = Number(process.env.LETTER_PDF_SET_CONTENT_TIMEOUT_MS ?? '45000');

/** Max time to wait for `<img>` decode after `load` (ms). */
const IMAGE_WAIT_MS = Number(process.env.LETTER_PDF_IMAGE_WAIT_MS ?? '12000');

/** When `1`, shrink letter to fit one A4 page if it overflows (may reduce text size). */
const FIT_ONE_PAGE = process.env.LETTER_PDF_FIT_ONE_PAGE === '1';

/** Letter PDF width (mm). Default A4 width. */
const LETTER_PDF_PAGE_WIDTH_MM = (() => {
    const n = Number(process.env.LETTER_PDF_PAGE_WIDTH_MM ?? '210');
    return Number.isFinite(n) && n > 0 ? n : 210;
})();
/**
 * Fallback / fit-one-page reference height (mm). Content-sized PDFs measure the
 * letter card instead of using this as the page height.
 */
const LETTER_PDF_PAGE_HEIGHT_MM = (() => {
    const n = Number(process.env.LETTER_PDF_PAGE_HEIGHT_MM ?? '320');
    return Number.isFinite(n) && n > 0 ? n : 340;
})();

/** Minimum PDF page height (mm) — avoids zero-height sheets on empty markup. */
const LETTER_PDF_MIN_HEIGHT_MM = 20;

/** Max single-page PDF height (mm). Very long letters may be clipped if exceeded. */
const LETTER_PDF_MAX_HEIGHT_MM = (() => {
    const n = Number(process.env.LETTER_PDF_MAX_HEIGHT_MM ?? '1500');
    return Number.isFinite(n) && n > 0 ? n : 1500;
})();

/**
 * Extra page height (mm) after ceil(px→mm) so Chromium does not push the last
 * footer accent strip onto page 2. Keep tiny — large buffers leave a white gap.
 */
const LETTER_PDF_HEIGHT_SLACK_MM = 0.5;

/** Viewport padding (CSS px) above measured content before `page.pdf()`. */
const LETTER_PDF_VIEWPORT_SLACK_PX = 8;

/** Standard A4 (matches typical contract PDF pages). */
const A4_PAGE_WIDTH_MM = 210;
const A4_PAGE_HEIGHT_MM = 297;
const A4_PDF_MARGIN_TOP_MM = 12;
const A4_PDF_MARGIN_RIGHT_MM = 10;
const A4_PDF_MARGIN_BOTTOM_MM = 14;
const A4_PDF_MARGIN_LEFT_MM = 10;

function pxToMm(px: number): number {
    return (px * 25.4) / 96;
}

function mmToCssPx(mm: number): number {
    return Math.round((mm * 96) / 25.4);
}

function looksLikeFullHtmlDocument(html: string): boolean {
    const t = html.trim();
    return /^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t);
}

/**
 * Pull inner HTML from a full document so we can wrap it with print-safe chrome
 * (white page, no viewport grey, consistent @page).
 */
function extractBodyInnerHtml(html: string): string {
    const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
    if (m?.[1]) return m[1].trim();
    return html.trim();
}

/**
 * Letter fragment or body inner HTML ΓåÆ full HTML document with print/PDF-only styles.
 * Chromium PDF uses this shell so the page is entirely white with no ΓÇ£browser greyΓÇ¥ frame.
 */
function buildLetterPdfDocument(innerHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style id="letter-pdf-print-shell">
  /* Page size is set dynamically via page.pdf({ width, height }); keep margins 0. */
  @page {
    margin: 0;
    background: #ffffff;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }
  html {
    margin: 0 !important;
    padding: 0 !important;
    width: 100%;
    /* Content-height only — never stretch to viewport/A4 (creates blank PDF space) */
    height: auto !important;
    min-height: 0 !important;
    background: #ffffff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100%;
    height: auto !important;
    min-height: 0 !important;
    background: #ffffff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
    font-family: Arial, Helvetica, sans-serif;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }

  .letter-pdf-stage {
    margin: 0 !important;
    padding: 0 !important;
    width: 100%;
    height: auto !important;
    min-height: 0 !important;
    background: #ffffff !important;
    display: block;
  }

  .letter-pdf-root {
    margin: 0 !important;
    padding: 0 !important;
    width: 100%;
    max-width: 100%;
    background: #ffffff !important;
    overflow: visible;
  }

  .letter-pdf-root,
  .letter-pdf-root * {
    box-shadow: none !important;
    text-shadow: none !important;
  }

  /* Outer grey email canvas → white, full-bleed, no gutters */
  .letter-pdf-root > table,
  .letter-pdf-root > div > table {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    min-height: auto !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #ffffff !important;
    background-color: #ffffff !important;
  }

  /* Kill wrapper cell padding (e.g. padding:12px 10px around the 600px card) */
  .letter-pdf-root > table > tbody > tr > td,
  .letter-pdf-root > table > tr > td,
  .letter-pdf-root > div > table > tbody > tr > td,
  .letter-pdf-root > div > table > tr > td {
    padding: 0 !important;
    background: #ffffff !important;
    background-color: #ffffff !important;
  }

  img {
    max-width: 100%;
    height: auto;
  }

  table {
    border-collapse: collapse;
  }

  body,
  body[style] {
    background: #ffffff !important;
    background-color: #ffffff !important;
  }

  /* Keep nested centered tables (header logo plaque, icon cells) centered.
     Do NOT zero their margins — that slides the brand logo to the left. */
  .letter-pdf-root .email-container table[align="center"],
  .letter-pdf-root [data-letter-pdf-card] table[align="center"] {
    margin-left: auto !important;
    margin-right: auto !important;
  }

  /* Header brand bar: keep the white logo plaque centered on the gold strip. */
  .letter-pdf-root .email-container > tbody > tr:first-child > td,
  .letter-pdf-root .email-container > tr:first-child > td,
  .letter-pdf-root [data-letter-pdf-card] > tbody > tr:first-child > td,
  .letter-pdf-root [data-letter-pdf-card] > tr:first-child > td {
    text-align: center !important;
  }

  /* Email card → full page width (PDF-only; email HTML left unchanged) */
  .letter-pdf-root .email-container,
  .letter-pdf-root [data-letter-pdf-card],
  .letter-pdf-root table[width="600"],
  .letter-pdf-root table[width='600'] {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  /* Info tables (e.g. 510px) → full content width */
  .letter-pdf-root .info-table,
  .letter-pdf-root table[width="510"],
  .letter-pdf-root table[width='510'] {
    width: 100% !important;
    max-width: 100% !important;
  }
</style>
</head>
<body>
  <div class="letter-pdf-stage">
    <div class="letter-pdf-root">${innerHtml}</div>
  </div>
</body>
</html>`;
}

function wrapEmailHtmlForPdf(html: string): string {
    const inner = looksLikeFullHtmlDocument(html) ? extractBodyInnerHtml(html) : html.trim();
    return buildLetterPdfDocument(inner);
}

function buildA4PdfDocument(innerHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style id="a4-pdf-print-shell">
  @page {
    size: ${A4_PAGE_WIDTH_MM}mm ${A4_PAGE_HEIGHT_MM}mm;
    margin: ${A4_PDF_MARGIN_TOP_MM}mm ${A4_PDF_MARGIN_RIGHT_MM}mm ${A4_PDF_MARGIN_BOTTOM_MM}mm ${A4_PDF_MARGIN_LEFT_MM}mm;
    background: #ffffff;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100%;
    background: #ffffff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
    font-family: Arial, Helvetica, sans-serif;
  }
  .a4-pdf-stage {
    width: 100%;
    background: #ffffff !important;
  }
  .a4-pdf-root {
    width: 100%;
    background: #ffffff !important;
  }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; }
</style>
</head>
<body>
  <div class="a4-pdf-stage">
    <div class="a4-pdf-root">${innerHtml}</div>
  </div>
</body>
</html>`;
}

function wrapHtmlForA4Pdf(html: string): string {
    const inner = looksLikeFullHtmlDocument(html) ? extractBodyInnerHtml(html) : html.trim();
    return buildA4PdfDocument(inner);
}

async function resolveLetterPdfExecutablePaths(): Promise<Array<string | undefined>> {
  const candidates: Array<string | undefined> = [];
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (envPath) candidates.push(envPath);

  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    candidates.push(`${programFiles}\\Google\\Chrome\\Application\\chrome.exe`);
    candidates.push(`${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`);
    if (localAppData) {
      candidates.push(`${localAppData}\\Google\\Chrome\\Application\\chrome.exe`);
      candidates.push(`${localAppData}\\Chromium\\Application\\chrome.exe`);
    }
  }

  try {
    const bundled = await puppeteer.executablePath();
    if (bundled) candidates.push(bundled);
  } catch {
    // Bundled Chromium unavailable ΓÇö try other candidates.
  }

  const seen = new Set<string>();
  const resolved: Array<string | undefined> = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (existsSync(candidate)) resolved.push(candidate);
  }

  if (resolved.length === 0) {
    resolved.push(undefined);
  }
  return resolved;
}

async function launchLetterPdfBrowser(): Promise<Browser> {
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
    '--force-color-profile=srgb',
  ];

  const executablePaths = await resolveLetterPdfExecutablePaths();
  let lastError: unknown;

  for (const executablePath of executablePaths) {
    try {
      return await puppeteer.launch({
        headless: true,
        args: launchArgs,
        executablePath,
      });
    } catch (error) {
      lastError = error;
      console.warn(
        `${LOG_PREFIX} browser launch failed${executablePath ? ` (${executablePath})` : ''}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to launch PDF browser');
}

async function waitForImages(page: Page): Promise<void> {
    await page.evaluate((maxMs: number) => {
        type ImgEl = {
            complete: boolean;
            addEventListener: (
                type: string,
                listener: () => void,
                options?: { once?: boolean },
            ) => void;
        };
        const g = globalThis as unknown as {
            document: { images: ArrayLike<ImgEl> };
        };
        const imgs = Array.from(g.document.images);
        const pending = imgs
            .filter((img) => !img.complete)
            .map(
                (img) =>
                    new Promise<void>((resolve) => {
                        const done = () => resolve();
                        img.addEventListener('load', done, { once: true });
                        img.addEventListener('error', done, { once: true });
                        setTimeout(done, maxMs);
                    }),
            );
        return Promise.all(pending);
    }, IMAGE_WAIT_MS);
}

async function waitForFonts(page: Page): Promise<void> {
    await page
        .evaluate(() => {
            const g = globalThis as unknown as {
                document: { fonts?: { ready: Promise<unknown> } };
            };
            return g.document.fonts?.ready ?? Promise.resolve();
        })
        .catch(() => undefined);
}

/** Double rAF so first layout/paint after fonts/images settles before `page.pdf`. */
async function waitForNextPaint(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                const g = globalThis as unknown as {
                    requestAnimationFrame: (cb: () => void) => number;
                };
                g.requestAnimationFrame(() => {
                    g.requestAnimationFrame(() => resolve());
                });
            }),
    );
}

/**
 * PDF-only layout pass: expand the email card / info tables to full page width
 * and strip outer canvas padding. Does not change the source email HTML templates.
 */
async function normalizeLetterLayoutForPdf(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as unknown as {
            document: {
                querySelector: (sel: string) => unknown | null;
                querySelectorAll: (sel: string) => ArrayLike<{
                    setAttribute: (name: string, value: string) => void;
                    style: {
                        width: string;
                        maxWidth: string;
                        padding: string;
                        border: string;
                        margin: string;
                    };
                }>;
            };
        };

        if (!g.document.querySelector('.letter-pdf-root')) return;

        const cards = g.document.querySelectorAll(
            '.letter-pdf-root .email-container, .letter-pdf-root table[width="600"], .letter-pdf-root table[width=\'600\']',
        );
        for (let i = 0; i < cards.length; i += 1) {
            const el = cards[i];
            el.setAttribute('width', '100%');
            el.setAttribute('data-letter-pdf-card', '');
            el.style.width = '100%';
            el.style.maxWidth = '100%';
            el.style.margin = '0';
            el.style.border = '0';
        }

        const infoTables = g.document.querySelectorAll(
            '.letter-pdf-root .info-table, .letter-pdf-root table[width="510"], .letter-pdf-root table[width=\'510\']',
        );
        for (let i = 0; i < infoTables.length; i += 1) {
            const el = infoTables[i];
            el.setAttribute('width', '100%');
            el.style.width = '100%';
            el.style.maxWidth = '100%';
            el.style.margin = '0';
            el.style.border = '0';
        }

        const outerTables = g.document.querySelectorAll(
            '.letter-pdf-root > table, .letter-pdf-root > div > table',
        );
        for (let i = 0; i < outerTables.length; i += 1) {
            const table = outerTables[i];
            table.style.width = '100%';
            table.style.maxWidth = '100%';
            table.style.margin = '0';
            table.style.border = '0';
        }

        const wrapperCells = g.document.querySelectorAll(
            '.letter-pdf-root > table > tbody > tr > td, .letter-pdf-root > table > tr > td, .letter-pdf-root > div > table > tbody > tr > td, .letter-pdf-root > div > table > tr > td',
        );
        for (let i = 0; i < wrapperCells.length; i += 1) {
            wrapperCells[i].style.padding = '0';
        }

        // Restore header/icon tables that use align=center + margin:auto (logo plaque).
        const centeredInner = g.document.querySelectorAll(
            '.letter-pdf-root .email-container table[align="center"], .letter-pdf-root [data-letter-pdf-card] table[align="center"]',
        );
        for (let i = 0; i < centeredInner.length; i += 1) {
            const el = centeredInner[i];
            el.style.margin = '0 auto';
        }
    });
}

/**
 * Measure the letter card height only (not body/document scrollHeight).
 * Prefer `.email-container` / `[data-letter-pdf-card]` so footer accent bars
 * (inside the card) are included. Span from stage top → card bottom so any
 * residual wrapper offset is counted and the last strip is not clipped.
 */
async function measureContentHeightPx(page: Page): Promise<number> {
    return page.evaluate(() => {
        type Measurable = {
            getBoundingClientRect: () => { top: number; bottom: number; height: number };
            offsetHeight: number;
            querySelectorAll: (sel: string) => ArrayLike<{
                getBoundingClientRect: () => { bottom: number };
            }>;
            setAttribute: (name: string, value: string) => void;
        };

        const g = globalThis as unknown as {
            document: {
                querySelector: (sel: string) => Measurable | null;
            };
        };

        const card =
            g.document.querySelector('[data-letter-pdf-card]') ??
            g.document.querySelector('.email-container') ??
            g.document.querySelector('.letter-pdf-root table[width="600"]') ??
            g.document.querySelector(".letter-pdf-root table[width='600']");

        const stage =
            g.document.querySelector('.letter-pdf-stage') ??
            g.document.querySelector('.letter-pdf-root');

        const el = card ?? stage;
        if (!el) {
            // Never use body/documentElement.scrollHeight (equals tall Puppeteer viewport).
            return 0;
        }

        if (card) {
            card.setAttribute('data-letter-pdf-card', '');
        }

        const rect = el.getBoundingClientRect();
        let maxBottom = rect.bottom;
        // Include nested rows/cells (footer accent bars) that may extend past table rect rounding.
        const descendants = el.querySelectorAll('tr, td, table, img, div, p, h1');
        for (let i = 0; i < descendants.length; i += 1) {
            const b = descendants[i].getBoundingClientRect().bottom;
            if (b > maxBottom) maxBottom = b;
        }

        const topOrigin = stage ? stage.getBoundingClientRect().top : rect.top;
        const fromTopToBottom = Math.max(0, maxBottom - topOrigin);
        return Math.ceil(
            Math.max(rect.height, el.offsetHeight || 0, fromTopToBottom),
        );
    });
}

async function applyDynamicPageSize(page: Page, widthMm: number, heightMm: number): Promise<void> {
    await page.addStyleTag({
        content: `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; background: #ffffff; }`,
    });
}

/**
 * If content is taller than one printable area, scale the root down slightly
 * so a single PDF page is more likely (optional; LETTER_PDF_FIT_ONE_PAGE=1).
 */
async function scaleLetterToFitOnePageIfNeeded(page: Page): Promise<void> {
    if (!FIT_ONE_PAGE) return;
    const widthMm = LETTER_PDF_PAGE_WIDTH_MM;
    const heightMm = LETTER_PDF_PAGE_HEIGHT_MM;
    await page.evaluate(
        (args: { widthMm: number; heightMm: number }) => {
            const g = globalThis as unknown as {
                document: {
                    querySelector: (sel: string) => {
                        style: { transformOrigin: string; transform: string };
                        getBoundingClientRect: () => { width: number; height: number };
                        scrollHeight: number;
                        scrollWidth: number;
                    } | null;
                };
            };
            const root = g.document.querySelector('.letter-pdf-root');
            if (!root) return;

            const mmToPx = (mm: number) => (mm * 96) / 25.4;
            const pageInnerH = mmToPx(args.heightMm);
            const pageInnerW = mmToPx(args.widthMm);

            const rect = root.getBoundingClientRect();
            const h = Math.max(rect.height, root.scrollHeight);
            const w = Math.max(rect.width, root.scrollWidth);
            if (h <= pageInnerH && w <= pageInnerW) return;

            const scale = Math.min(pageInnerH / h, pageInnerW / w, 1) * 0.985;
            if (scale >= 0.999) return;

            root.style.transformOrigin = 'top center';
            root.style.transform = `scale(${scale})`;
        },
        { widthMm, heightMm },
    );
}

/**
 * Renders CRM letter / rich HTML email body to a single-page PDF buffer.
 * Page width: {@link LETTER_PDF_PAGE_WIDTH_MM} mm (default A4 width).
 * Page height: measured letter-card height (+ tiny slack), not a fixed A4 sheet.
 */
export async function renderLetterHtmlToPdfBuffer(htmlBody: string): Promise<Buffer> {
    if (!htmlBody || !String(htmlBody).trim()) {
        throw new Error('HTML body is required for PDF generation');
    }

    let browser: Browser | undefined;
    const started = Date.now();
    try {
        browser = await launchLetterPdfBrowser();

        const page = await browser.newPage();

        // "Screen" paint path keeps template colors/gradients closer to the email preview.
        await page.emulateMediaType('screen');

        const measureViewportHeightPx = mmToCssPx(LETTER_PDF_MAX_HEIGHT_MM);
        const pageWidthPx = mmToCssPx(LETTER_PDF_PAGE_WIDTH_MM);

        // Tall viewport so layout is not clipped before we measure content height.
        await page.setViewport({
            width: pageWidthPx,
            height: measureViewportHeightPx,
            deviceScaleFactor: 2,
        });

        const documentHtml = wrapEmailHtmlForPdf(htmlBody);
        await page.setContent(documentHtml, {
            waitUntil: 'load',
            timeout: SET_CONTENT_TIMEOUT_MS,
        });
        await waitForImages(page);
        await waitForFonts(page);
        await waitForNextPaint(page);
        await normalizeLetterLayoutForPdf(page);
        await waitForNextPaint(page);
        await scaleLetterToFitOnePageIfNeeded(page);
        await waitForNextPaint(page);

        const contentHeightPx = await measureContentHeightPx(page);
        // ceil(px→mm) so the last footer strip is not clipped, then tiny slack only.
        const contentHeightMm = Math.min(
            LETTER_PDF_MAX_HEIGHT_MM,
            Math.max(
                LETTER_PDF_MIN_HEIGHT_MM,
                Math.ceil(pxToMm(contentHeightPx)) + LETTER_PDF_HEIGHT_SLACK_MM,
            ),
        );

        // Never shrink viewport below letter content — that pushes overflow onto page 2.
        const pdfViewportHeightPx = Math.max(
            measureViewportHeightPx,
            contentHeightPx + LETTER_PDF_VIEWPORT_SLACK_PX,
        );
        await page.setViewport({
            width: pageWidthPx,
            height: pdfViewportHeightPx,
            deviceScaleFactor: 2,
        });
        await waitForNextPaint(page);

        await applyDynamicPageSize(page, LETTER_PDF_PAGE_WIDTH_MM, contentHeightMm);

        const pdfUint8 = await page.pdf({
            width: `${LETTER_PDF_PAGE_WIDTH_MM}mm`,
            height: `${contentHeightMm}mm`,
            printBackground: true,
            preferCSSPageSize: false,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            omitBackground: false,
            tagged: false,
        });

        const buf = Buffer.from(pdfUint8);
        if (!buf.length) {
            throw new Error('Puppeteer returned an empty PDF buffer');
        }
        console.info(
            `${LOG_PREFIX} generated pdf bytes=${buf.length} heightPx=${contentHeightPx} heightMm=${contentHeightMm} elapsedMs=${Date.now() - started}`,
        );
        return buf;
    } catch (err) {
        console.error(`${LOG_PREFIX} generation failed:`, err);
        throw err;
    } finally {
        if (browser) {
            await browser.close().catch((closeErr) => {
                console.error(`${LOG_PREFIX} browser.close failed:`, closeErr);
            });
        }
    }
}

/**
 * Renders HTML to a fixed A4 PDF (210├ù297 mm) ΓÇö same page size as standard contract pages.
 * Unlike {@link renderLetterHtmlToPdfBuffer}, page height is not shrunk to content.
 */
export async function renderHtmlToA4PdfBuffer(htmlBody: string): Promise<Buffer> {
    if (!htmlBody || !String(htmlBody).trim()) {
        throw new Error('HTML body is required for PDF generation');
    }

    let browser: Browser | undefined;
    const started = Date.now();
    try {
        browser = await launchLetterPdfBrowser();
        const page = await browser.newPage();
        await page.emulateMediaType('print');
        await page.setViewport({
            width: mmToCssPx(A4_PAGE_WIDTH_MM),
            height: mmToCssPx(A4_PAGE_HEIGHT_MM),
            deviceScaleFactor: 2,
        });

        const documentHtml = wrapHtmlForA4Pdf(htmlBody);
        await page.setContent(documentHtml, {
            waitUntil: 'load',
            timeout: SET_CONTENT_TIMEOUT_MS,
        });
        await waitForImages(page);
        await waitForFonts(page);
        await waitForNextPaint(page);

        const pdfUint8 = await page.pdf({
            format: 'a4',
            printBackground: true,
            preferCSSPageSize: true,
            margin: {
                top: `${A4_PDF_MARGIN_TOP_MM}mm`,
                right: `${A4_PDF_MARGIN_RIGHT_MM}mm`,
                bottom: `${A4_PDF_MARGIN_BOTTOM_MM}mm`,
                left: `${A4_PDF_MARGIN_LEFT_MM}mm`,
            },
            omitBackground: false,
            tagged: false,
        });

        const buf = Buffer.from(pdfUint8);
        if (!buf.length) {
            throw new Error('Puppeteer returned an empty PDF buffer');
        }
        console.info(
            `${LOG_PREFIX} generated A4 pdf bytes=${buf.length} elapsedMs=${Date.now() - started}`,
        );
        return buf;
    } catch (err) {
        console.error(`${LOG_PREFIX} A4 generation failed:`, err);
        throw err;
    } finally {
        if (browser) {
            await browser.close().catch((closeErr) => {
                console.error(`${LOG_PREFIX} browser.close failed:`, closeErr);
            });
        }
    }
}

/** Safe ASCII-ish filename for MIME / filesystem (caller may add .pdf). */
export function sanitizeLetterPdfFilename(name: string): string {
    const trimmed = String(name || 'letter').trim() || 'letter';
    const cleaned = trimmed
        .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 180)
        .replace(/^-+|-+$/g, '');
    const base = cleaned || `letter-${randomBytes(4).toString('hex')}`;
    return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}
