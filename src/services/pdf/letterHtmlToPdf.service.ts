import { randomBytes } from 'crypto';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const LOG_PREFIX = '[letter-html-pdf]';

/** Puppeteer `setContent` timeout (ms) — letters may load many external images. */
const SET_CONTENT_TIMEOUT_MS = Number(process.env.LETTER_PDF_SET_CONTENT_TIMEOUT_MS ?? '45000');

/** Max time to wait for `<img>` decode after `load` (ms). */
const IMAGE_WAIT_MS = Number(process.env.LETTER_PDF_IMAGE_WAIT_MS ?? '12000');

/** When `1`, shrink content to fit one page if it overflows (may reduce text size). */
const FIT_ONE_PAGE = process.env.LETTER_PDF_FIT_ONE_PAGE === '1';

/** US Letter width at 96dpi — matches payoff / wire letter templates. */
const US_LETTER_WIDTH_PX = 816;

/** ISO workflow email column width (approval / offer-updated templates). */
const CRM_EMAIL_WIDTH_PX = 600;

type PdfHtmlKind = 'crm-letter' | 'crm-email' | 'compliance-report' | 'fragment';

const COMPLIANCE_PDF_PRINT_STYLE = `<style id="compliance-pdf-print-inject">
  @page {
    size: letter;
    margin: 0;
    background: #ffffff;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    overflow-x: hidden;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  table {
    border-collapse: collapse;
    max-width: 100%;
  }
  td, th {
    word-wrap: break-word;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  img {
    max-width: 100%;
    height: auto;
  }
</style>`;

const PRINT_INJECT_STYLE = `<style id="letter-pdf-print-inject">
  @page {
    size: letter;
    margin: 0.5in;
    background: #ffffff;
  }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    overflow-x: hidden;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }
  *, *::before, *::after {
    box-sizing: border-box;
  }
  table {
    border-collapse: collapse;
    max-width: 100%;
  }
  td, th {
    word-wrap: break-word;
    overflow-wrap: break-word;
    word-break: break-word;
  }
  img {
    max-width: 100%;
    height: auto;
  }
</style>`;

function looksLikeFullHtmlDocument(html: string): boolean {
    const t = html.trim();
    return /^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t);
}

function extractBodyInnerHtml(html: string): string {
    const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
    if (m?.[1]) return m[1].trim();
    return html.trim();
}

/**
 * ISO approval / offer-updated templates vs standalone payoff letters.
 * Letter documents keep their original table layout; emails are centered at 600px.
 */
function classifyHtmlForPdf(html: string): PdfHtmlKind {
    const t = html.trim();

    const isIsoWorkflowEmail =
        /width=["']600["']/i.test(t) &&
        (/APPLICATION HAS BEEN APPROVED|OFFER UPDATED|Calculate your Approval|Review Updated Offer|REQUIRED STIPS FOR FUNDING/i.test(
            t,
        ) ||
            /Application<br\/>Submitted|Offer Updated/i.test(t));

    if (isIsoWorkflowEmail) {
        return 'crm-email';
    }

    if (/COMPLIANCE REPORT/i.test(t) && /bc-check-card/i.test(t)) {
        return 'compliance-report';
    }

    if (looksLikeFullHtmlDocument(t)) {
        return 'crm-letter';
    }

    return 'fragment';
}

/** Preserve template `<head>` styles; only add print-safe helpers. */
function injectPrintStylesIntoFullDocument(html: string, printStyle = PRINT_INJECT_STYLE): string {
    if (/<\/head>/i.test(html)) {
        return html.replace(/<\/head>/i, `${printStyle}</head>`);
    }
    if (/<html[\s>]/i.test(html)) {
        return html.replace(/<html([^>]*)>/i, `<html$1><head>${printStyle}</head>`);
    }
    return `<!DOCTYPE html><html lang="en"><head>${printStyle}</head><body>${html}</body></html>`;
}

/** Center 600px CRM email templates without overriding inner table widths. */
function buildEmailPdfDocument(innerHtml: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
${PRINT_INJECT_STYLE}
<style id="letter-pdf-email-shell">
  .email-pdf-stage {
    width: ${CRM_EMAIL_WIDTH_PX}px;
    max-width: 100%;
    margin: 0 auto;
    background: #ffffff;
  }
  .email-pdf-stage > table[width="600"],
  .email-pdf-stage table[align="center"] {
    margin-left: auto;
    margin-right: auto;
  }
</style>
</head>
<body>
  <div class="email-pdf-stage">${innerHtml}</div>
</body>
</html>`;
}

function prepareHtmlForPdf(html: string, kind: PdfHtmlKind): string {
    const trimmed = html.trim();
    if (kind === 'crm-letter') {
        return injectPrintStylesIntoFullDocument(trimmed);
    }
    if (kind === 'crm-email') {
        const inner = looksLikeFullHtmlDocument(trimmed) ? extractBodyInnerHtml(trimmed) : trimmed;
        return buildEmailPdfDocument(inner);
    }
    if (kind === 'compliance-report') {
        return injectPrintStylesIntoFullDocument(
            looksLikeFullHtmlDocument(trimmed)
                ? trimmed
                : `<!DOCTYPE html><html><body>${trimmed}</body></html>`,
            COMPLIANCE_PDF_PRINT_STYLE,
        );
    }
    return injectPrintStylesIntoFullDocument(
        looksLikeFullHtmlDocument(trimmed)
            ? trimmed
            : `<!DOCTYPE html><html><body>${trimmed}</body></html>`,
    );
}

function viewportWidthForKind(kind: PdfHtmlKind): number {
    return kind === 'crm-email' ? US_LETTER_WIDTH_PX : US_LETTER_WIDTH_PX;
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

async function measureContentSize(page: Page): Promise<{ width: number; height: number }> {
    return page.evaluate(() => {
        const g = globalThis as unknown as {
            document: {
                documentElement: { scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number };
                body: {
                    scrollWidth: number;
                    offsetWidth: number;
                    scrollHeight: number;
                    offsetHeight: number;
                } | null;
            };
        };
        const doc = g.document.documentElement;
        const body = g.document.body;
        const width = Math.ceil(
            Math.max(body?.scrollWidth ?? 0, body?.offsetWidth ?? 0, doc?.scrollWidth ?? 0, doc?.clientWidth ?? 0),
        );
        const height = Math.ceil(
            Math.max(
                body?.scrollHeight ?? 0,
                body?.offsetHeight ?? 0,
                doc?.scrollHeight ?? 0,
                doc?.clientHeight ?? 0,
            ),
        );
        return { width, height };
    });
}

/**
 * If content is taller than the printable area, scale down slightly
 * so a single PDF page is more likely (optional; LETTER_PDF_FIT_ONE_PAGE=1).
 */
async function scaleContentToFitPageIfNeeded(
    page: Page,
    pageWidthPx: number,
    pageHeightPx: number,
): Promise<void> {
    if (!FIT_ONE_PAGE) return;
    await page.evaluate(
        (args: { pageWidthPx: number; pageHeightPx: number }) => {
            const g = globalThis as unknown as {
                document: {
                    body: {
                        style: { transformOrigin: string; transform: string; width: string };
                        scrollHeight: number;
                        scrollWidth: number;
                        getBoundingClientRect: () => { width: number; height: number };
                    } | null;
                };
            };
            const body = g.document.body;
            if (!body) return;

            const rect = body.getBoundingClientRect();
            const h = Math.max(rect.height, body.scrollHeight);
            const w = Math.max(rect.width, body.scrollWidth);
            if (h <= args.pageHeightPx && w <= args.pageWidthPx) return;

            const scale = Math.min(args.pageHeightPx / h, args.pageWidthPx / w, 1) * 0.985;
            if (scale >= 0.999) return;

            body.style.transformOrigin = 'top center';
            body.style.transform = `scale(${scale})`;
            body.style.width = `${args.pageWidthPx}px`;
        },
        { pageWidthPx, pageHeightPx },
    );
}

/**
 * Render page to PDF using the measured content height (no fixed blank tail page).
 */
async function renderPdfFromMeasuredContent(
    page: Page,
    pageWidthPx: number,
): Promise<Buffer> {
    const measured = await measureContentSize(page);
    const heightPx = Math.max(measured.height + 16, 120);

    const pdfUint8 = await page.pdf({
        width: `${pageWidthPx}px`,
        height: `${heightPx}px`,
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
    return buf;
}

/**
 * Renders CRM letter / rich HTML email body to a PDF buffer that matches the
 * on-screen preview layout (US Letter width, content-height pages).
 */
export async function renderLetterHtmlToPdfBuffer(htmlBody: string): Promise<Buffer> {
    if (!htmlBody || !String(htmlBody).trim()) {
        throw new Error('HTML body is required for PDF generation');
    }

    const kind = classifyHtmlForPdf(htmlBody);
    const pageWidthPx = viewportWidthForKind(kind);
    const documentHtml = prepareHtmlForPdf(htmlBody, kind);

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
        await page.emulateMediaType('screen');

        await page.setViewport({
            width: pageWidthPx,
            height: 1056,
            deviceScaleFactor: 2,
        });

        await page.setContent(documentHtml, {
            waitUntil: 'load',
            timeout: SET_CONTENT_TIMEOUT_MS,
        });
        await waitForImages(page);
        await waitForFonts(page);
        await waitForNextPaint(page);

        const measured = await measureContentSize(page);
        await scaleContentToFitPageIfNeeded(page, pageWidthPx, measured.height);
        await waitForNextPaint(page);

        const buf = await renderPdfFromMeasuredContent(page, pageWidthPx);

        console.info(
            `${LOG_PREFIX} kind=${kind} pdf bytes=${buf.length} elapsedMs=${Date.now() - started}`,
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
