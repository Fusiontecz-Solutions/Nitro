import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

/** Display name used in transactional email copy (matches outbound mail From name). */
export const BRAND_DISPLAY_NAME = 'Nitro Advance';

/**
 * Inline brand logos used inside transactional email templates.
 * Files live under `<project-root>/public/` (NOT in `src/`) so they survive
 * the `tsc` build (`rootDir: ./src` would otherwise strip non-`.ts` files).
 */
const BRAND_ASSETS_DIR = path.resolve(__dirname, '..', '..', 'public');
const BRAND_LOGO_PATH = path.join(BRAND_ASSETS_DIR, 'logoo.png');
const BRAND_LIGHT_LOGO_PATH = BRAND_LOGO_PATH;
const BRAND_DARK_LOGO_PATH = BRAND_LOGO_PATH;

const BRAND_LIGHT_LOGO_CID = 'brand-logo-light@finexusai';
const BRAND_DARK_LOGO_CID = 'brand-logo-dark@finexusai';

/** CID `src` for HTML emails that attach `buildBrandLogoAttachments()`. */
export const BRAND_EMAIL_LOGO_SRC = `cid:${BRAND_LIGHT_LOGO_CID}`;

/** Local file URL for Puppeteer PDFs (payment letters, disbursement schedule). */
export function getBrandLogoFileUrl(): string {
    if (!fs.existsSync(BRAND_LOGO_PATH)) return '';
    return pathToFileURL(BRAND_LOGO_PATH).href;
}

/** Hosted / email / PDF brand logo. Prefer CID in mail; file URL for local PDF render. */
export const BRAND_LOGO_URL = BRAND_EMAIL_LOGO_SRC;

const LEGACY_HOSTED_BRAND_LOGO_URLS = [
    'https://res.cloudinary.com/dehrku8og/image/upload/v1786111779/ChatGPT_Image_Aug_7_2026_07_39_08_PM_zri2ha.png',
];

function rewriteBrandLogoSrc(html: string, logoSrc: string): string {
    let out = String(html || '');
    const next = String(logoSrc || '').trim();
    if (!out || !next) return out;
    for (const legacy of LEGACY_HOSTED_BRAND_LOGO_URLS) {
        out = out.split(legacy).join(next);
    }
    out = out.split('http://localhost:5173/logoo.png').join(next);
    out = out.split('/logoo.png').join(next);
    out = out.split('http://localhost:5173/nitro_advance_logo.png').join(next);
    out = out.split('/nitro_advance_logo.png').join(next);
    return out;
}

/** Swap in-app / leftover hosted logo URLs for CID so Gmail can show the attached logo. */
export function rewriteBrandLogoUrlsForEmail(html: string): string {
    return rewriteBrandLogoSrc(html, BRAND_EMAIL_LOGO_SRC);
}

/** Swap logo URLs for a local file path so Puppeteer can paint the logo into PDFs. */
export function rewriteBrandLogoUrlsForPdf(html: string): string {
    return rewriteBrandLogoSrc(html, getBrandLogoFileUrl() || BRAND_EMAIL_LOGO_SRC);
}

/**
 * Inline attachments (Content-ID) for the Nitro Advance logo. Pass these to
 * `sendMail` whenever the HTML body contains the brand header so the
 * `cid:...` references in the markup resolve to real images.
 */
export function buildBrandLogoAttachments(): Array<{
    filename: false;
    path: string;
    cid: string;
    contentType: string;
    contentDisposition: 'inline';
}> {
    const candidates = [
        {
            filename: false as const,
            path: BRAND_LIGHT_LOGO_PATH,
            cid: BRAND_LIGHT_LOGO_CID,
            contentType: 'image/png',
            contentDisposition: 'inline' as const,
        },
        {
            filename: false as const,
            path: BRAND_DARK_LOGO_PATH,
            cid: BRAND_DARK_LOGO_CID,
            contentType: 'image/png',
            contentDisposition: 'inline' as const,
        },
    ];

    const existing = candidates.filter((attachment) => fs.existsSync(attachment.path));
    if (existing.length < candidates.length) {
        const missing = candidates
            .filter((attachment) => !fs.existsSync(attachment.path))
            .map((attachment) => attachment.path);
        console.warn('[email] Brand logo files missing; sending without inline logos:', missing);
    }

    return existing;
}

/**
 * Theme-aware brand header (`<tr>` row) used at the top of every
 * transactional email.
 */
export function buildBrandHeaderRowHtml(): string {
    return `
                    <tr>
                        <td align="center" style="padding: 6px 16px 0; line-height: 0; font-size: 0;">
                            <!--[if !mso]><!-->
                            <table role="presentation" align="center" border="0" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                                <tr>
                                    <td align="center" style="padding:0; line-height:0; font-size:0;">
                            <div class="brand-logo-bg-light brand-logo-bg-slot"
                                 role="presentation"
                                 aria-hidden="true"
                                 style="display:inline-block; margin:0; padding:0; vertical-align:top;
                                        width:180px; height:78px;
                                        background-image:url('cid:${BRAND_LIGHT_LOGO_CID}');
                                        background-position:center center;
                                        background-repeat:no-repeat;
                                        background-size:contain;"></div>
                            <div class="brand-logo-bg-dark brand-logo-bg-slot"
                                 role="presentation"
                                 aria-hidden="true"
                                 style="display:inline-block; margin:0; padding:0; vertical-align:top;
                                        width:180px; height:78px;
                                        background-image:url('cid:${BRAND_DARK_LOGO_CID}');
                                        background-position:center center;
                                        background-repeat:no-repeat;
                                        background-size:contain;"></div>
                                    </td>
                                </tr>
                            </table>
                            <!--<![endif]-->
                            <!--[if mso]>
                            <span style="line-height:normal; font-family: Arial, Helvetica, sans-serif; font-size: 1px; color:#ffffff">&nbsp;<br /></span>
                            <img src="cid:${BRAND_LIGHT_LOGO_CID}"
                                 alt="Nitro Advance"
                                 width="180"
                                 border="0"
                                 style="display:block; margin: 0 auto; width:180px; height:auto; border:0; outline:none;" />
                            <![endif]-->
                        </td>
                    </tr>`;
}

/** `<style>` + `<meta>` block for theme-aware logo visibility in email clients. */
export function buildBrandHeaderStyles(): string {
    return `
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <style>
        .brand-logo-bg-dark { display: none !important; width: 0 !important; height: 0 !important; overflow: hidden !important; }
        @media (prefers-color-scheme: dark) {
            .brand-logo-bg-light { display: none !important; width: 0 !important; height: 0 !important; overflow: hidden !important; }
            .brand-logo-bg-dark { display: inline-block !important; width: 180px !important; height: 78px !important; overflow: visible !important; }
        }
        [data-ogsc] .brand-logo-bg-light { display: none !important; width: 0 !important; height: 0 !important; overflow: hidden !important; }
        [data-ogsc] .brand-logo-bg-dark { display: inline-block !important; width: 180px !important; height: 78px !important; overflow: visible !important; }
    </style>`;
}
