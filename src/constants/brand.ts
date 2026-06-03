import path from 'path';

/** Display name used in transactional email copy (matches outbound mail From name). */
export const BRAND_DISPLAY_NAME = 'Woodmere Financial';

/**
 * Inline brand logos used inside transactional email templates.
 * Files live under `<project-root>/public/` (NOT in `src/`) so they survive
 * the `tsc` build (`rootDir: ./src` would otherwise strip non-`.ts` files).
 */
const BRAND_ASSETS_DIR = path.resolve(__dirname, '..', '..', 'public');
const BRAND_LIGHT_LOGO_PATH = path.join(BRAND_ASSETS_DIR, 'woodmere_transparent.png');
const BRAND_DARK_LOGO_PATH = path.join(BRAND_ASSETS_DIR, 'woodmere_dark_theme_logo.png');

const BRAND_LIGHT_LOGO_CID = 'brand-logo-light@finexusai';
const BRAND_DARK_LOGO_CID = 'brand-logo-dark@finexusai';

/**
 * Inline attachments (Content-ID) for the Woodmere logo. Pass these to
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
    return [
        {
            filename: false,
            path: BRAND_LIGHT_LOGO_PATH,
            cid: BRAND_LIGHT_LOGO_CID,
            contentType: 'image/png',
            contentDisposition: 'inline',
        },
        {
            filename: false,
            path: BRAND_DARK_LOGO_PATH,
            cid: BRAND_DARK_LOGO_CID,
            contentType: 'image/png',
            contentDisposition: 'inline',
        },
    ];
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
                                 alt="Woodmere"
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
