import { randomBytes } from 'crypto';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const LOG_PREFIX = '[letter-html-pdf]';

/** Puppeteer `setContent` timeout (ms) — letters may load many external images. */
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
 * Letter PDF height (mm) — taller than A4 (297mm) so one page fits the HTML letter
 * (footer + watermark) without a blank second page. Override with LETTER_PDF_PAGE_HEIGHT_MM.
 */
const LETTER_PDF_PAGE_HEIGHT_MM = (() => {
    const n = Number(process.env.LETTER_PDF_PAGE_HEIGHT_MM ?? '320');
    return Number.isFinite(n) && n > 0 ? n : 340;
})();

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
 * Letter fragment or body inner HTML → full HTML document with print/PDF-only styles.
 * Chromium PDF uses this shell so the page is entirely white with no “browser grey” frame.
 */
function buildLetterPdfDocument(innerHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style id="letter-pdf-print-shell">
  /* ----- Page: A4 width, extra height so template fits on one sheet (see LETTER_PDF_PAGE_HEIGHT_MM) ----- */
  @page {
    size: ${LETTER_PDF_PAGE_WIDTH_MM}mm ${LETTER_PDF_PAGE_HEIGHT_MM}mm;
    margin: 0;
    background: #ffffff;
  }

  /* ----- Hard reset: no default UA grey, no stray margins ----- */
  *, *::before, *::after {
    box-sizing: border-box;
  }
  html {
    margin: 0 !important;
    padding: 0 !important;
    width: 100%;
    /* Content-height only — avoid 100vh/100% stacking past one A4 and spawning a blank page */
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

  /* Stage height = template only (no forced viewport tallness) */
  .letter-pdf-stage {
    margin: 0 !important;
    padding: 0 !important;
    width: 100%;
    height: auto !important;
    min-height: 0 !important;
    background: #ffffff !important;
    display: block;
  }

  /* Letter column = full A4 width. No max-width / centering / gutters */
  .letter-pdf-root {
    margin: 0 !important;
    padding: 0 !important;
    width: 100%;
    max-width: 100%;
    background: #ffffff !important;
    overflow: visible;
  }

  /* Strip every email-only "card" decoration from the outer template table */
  .letter-pdf-root,
  .letter-pdf-root * {
    box-shadow: none !important;
    text-shadow: none !important;
  }
  .letter-pdf-root > table,
  .letter-pdf-root > div > table {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    /* Email templates use min-height:1123px for “one page” preview; that + row heights
       often exceeds A4 by a few px in Chromium PDF and creates an empty second page. */
    min-height: auto !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #ffffff !important;
  }

  img {
    max-width: 100%;
    height: auto;
  }

  table {
    border-collapse: collapse;
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
 * If content is taller than one printable A4 area, scale the root down slightly
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
 * Page size: {@link LETTER_PDF_PAGE_WIDTH_MM} × {@link LETTER_PDF_PAGE_HEIGHT_MM} mm
 * (default 210×340 — A4 width, extra height so letters fit on one page).
 */
export async function renderLetterHtmlToPdfBuffer(htmlBody: string): Promise<Buffer> {
    if (!htmlBody || !String(htmlBody).trim()) {
        throw new Error('HTML body is required for PDF generation');
    }

    let browser: Browser | undefined;
    const started = Date.now();
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--font-render-hinting=none',
                '--force-color-profile=srgb',
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined,
        });

        const page = await browser.newPage();

        // “Screen” paint path keeps template colors/gradients closer to the email preview.
        await page.emulateMediaType('screen');

        // Viewport matches PDF page (same mm → CSS px) so layout and print page align.
        await page.setViewport({
            width: mmToCssPx(LETTER_PDF_PAGE_WIDTH_MM),
            height: mmToCssPx(LETTER_PDF_PAGE_HEIGHT_MM),
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
        await scaleLetterToFitOnePageIfNeeded(page);
        await waitForNextPaint(page);

        // Single sheet: A4 width, taller height (default 340mm vs 297mm) — see LETTER_PDF_PAGE_HEIGHT_MM.
        const pdfUint8 = await page.pdf({
            width: `${LETTER_PDF_PAGE_WIDTH_MM}mm`,
            height: `${LETTER_PDF_PAGE_HEIGHT_MM}mm`,
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
            omitBackground: false,
            tagged: false,
        });

        const buf = Buffer.from(pdfUint8);
        if (!buf.length) {
            throw new Error('Puppeteer returned an empty PDF buffer');
        }
        console.info(
            `${LOG_PREFIX} generated pdf bytes=${buf.length} elapsedMs=${Date.now() - started}`,
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
