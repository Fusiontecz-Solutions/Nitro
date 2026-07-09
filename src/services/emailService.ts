import fs from 'fs';
import path from 'path';
import sendMail, {
    getSendGridMailFrom,
    isOutboundSmtpConfigured,
    isSendGridConfigured,
    sendSendGridMail,
    type SendMailResult,
} from '../config/nodemailer';
import prisma from '../config/prismaClient';
import { resolveEmailBrandDisplayName } from '../constants/emailBrand';
import {
  resolveCrmFrontendBaseUrl,
  resolveDecisionLogicInvitationBaseUrl,
} from '../utils/crmFrontendUrl';
import { renderApplicationApprovalEmailHtml } from './emailTemplates/applicationApprovalEmailHtml';
import { renderApplicationApprovedEmailHtml } from './emailTemplates/applicationApprovedEmailHtml';
import { renderOfferUpdatedEmailHtml } from './emailTemplates/offerUpdatedEmailHtml';

/**
 * Inline brand logos used inside transactional email templates.
 * The light variant has dark artwork on a transparent background (suits
 * default white email canvases), while the dark variant has ligaht artwork
 * for clients that render the message in dark mode.
 *
 * Files live under `<project-root>/public/` (NOT in `src/`) so they survive
 * the `tsc` build (`rootDir: ./src` would otherwise strip non-`.ts` files).
 */
const BRAND_ASSETS_DIR = path.resolve(__dirname, '..', '..', 'public');
const BRAND_LIGHT_LOGO_PATH = path.join(BRAND_ASSETS_DIR, 'katan_transparent.png');
const BRAND_DARK_LOGO_PATH = path.join(BRAND_ASSETS_DIR, 'katan_dark_theme_logo.png');

const BRAND_LIGHT_LOGO_CID = 'brand-logo-light@finexusai';
const BRAND_DARK_LOGO_CID = 'brand-logo-dark@finexusai';

const DEFAULT_BRAND_NAME = resolveEmailBrandDisplayName();

function brandLogoFileExists(filePath: string): boolean {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

export function hasBrandLogoAssets(): boolean {
    return (
        brandLogoFileExists(BRAND_LIGHT_LOGO_PATH) ||
        brandLogoFileExists(BRAND_DARK_LOGO_PATH)
    );
}

/**
 * Inline attachments (Content-ID) for the katan logo. Pass these to
 * `sendMail` whenever the HTML body contains the brand header so the
 * `cid:...` references in the markup resolve to real images.
 * Skips files that are not on disk so SMTP send does not fail with ENOENT.
 */
export function buildBrandLogoAttachments(): Array<{
    filename: false;
    path: string;
    cid: string;
    contentType: string;
    contentDisposition: 'inline';
}> {
    const attachments: Array<{
        filename: false;
        path: string;
        cid: string;
        contentType: string;
        contentDisposition: 'inline';
    }> = [];

    if (brandLogoFileExists(BRAND_LIGHT_LOGO_PATH)) {
        attachments.push({
            filename: false,
            path: BRAND_LIGHT_LOGO_PATH,
            cid: BRAND_LIGHT_LOGO_CID,
            contentType: 'image/png',
            contentDisposition: 'inline',
        });
    }

    if (brandLogoFileExists(BRAND_DARK_LOGO_PATH)) {
        attachments.push({
            filename: false,
            path: BRAND_DARK_LOGO_PATH,
            cid: BRAND_DARK_LOGO_CID,
            contentType: 'image/png',
            contentDisposition: 'inline',
        });
    }

    if (!attachments.length) {
        // eslint-disable-next-line no-console
        console.warn(
            '[email] Brand logo files not found under public/. Emails will use a text header instead. Expected:',
            BRAND_LIGHT_LOGO_PATH,
        );
    }

    return attachments;
}

/**
 * Theme-aware brand header (`<tr>` row) used at the top of every
 * transactional email. Non-Outlook clients paint the CID via CSS
 * `background-image` rather than `<img>` so Gmail Web does not wrap the graphic
 * in its image hover toolbar (download / Drive / Photos). Outlook Windows still
 * uses `<img>` (VML/Word layout) inside the `[if mso]` branch.
 *
 * Returns the table row markup only — callers paste it where the previous
 * `<span>FinexusAI</span>` row used to live.
 */
function buildBrandHeaderRowHtml(): string {
    if (!hasBrandLogoAssets()) {
        return `
                    <tr>
                        <td align="center" style="padding: 20px 24px 8px;">
                            <p style="margin:0; color:#276D9C; font-size:22px; font-weight:700; font-family: Arial, Helvetica, sans-serif; letter-spacing:0.02em;">
                                ${DEFAULT_BRAND_NAME}
                            </p>
                        </td>
                    </tr>`;
    }

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
                                 alt="katan"
                                 width="180"
                                 border="0"
                                 style="display:block; margin: 0 auto; width:180px; height:auto; border:0; outline:none;" />
                            <![endif]-->
                        </td>
                    </tr>`;
}

/**
 * `<style>` + `<meta>` block that toggles which logo is visible based on
 * the recipient's email-client theme. Inserted inside `<head>` of every
 * branded template.
 */
function buildBrandHeaderStyles(): string {
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

/** Katan Capital purple & blue palette — approval / offer-update client emails. */
const KATAN_EMAIL_THEME = {
    bgBody: '#f5f4f8',
    bgCard: '#ffffff',
    borderCard: '#e1dae6',
    purpleDeep: '#7a33a8',
    purpleAmethyst: '#a364c9',
    blueSky: '#1bb2e9',
    textPrimary: '#4b3658',
    textMuted: '#5a4b64',
    textDisabled: '#bca6cc',
    trackerLineInactive: '#cbd5e1',
    trackerBgInactive: '#f1ecf6',
    gradientHero: 'linear-gradient(135deg, #7a33a8 0%, #a364c9 50%, #1bb2e9 100%)',
    gradientCta: 'linear-gradient(to right, #a364c9, #1bb2e9)',
} as const;

/**
 * Logo shown above the hero banner on ISO "Application Approved" and "Offer Updated"
 * emails (white card background — use a dark logo URL).
 *
 * Set in `.env`:
 *   ISO_EMAIL_LOGO_URL=https://res.cloudinary.com/.../black_logo.svg
 *
 * Per-template overrides (optional):
 *   APPROVAL_BANNER_LOGO_URL=...
 *   OFFER_UPDATED_BANNER_LOGO_URL=...
 *
 * When empty, falls back to the inline katan brand header (CID attachments).
 */
const DEFAULT_ISO_EMAIL_LOGO_URL =
    'https://res.cloudinary.com/dfy6ahsqz/image/upload/v1780324705/white_logo_d8bsb1.svg';

export const ISO_EMAIL_LOGO_URL =
    String(process.env.ISO_EMAIL_LOGO_URL || '').trim() || DEFAULT_ISO_EMAIL_LOGO_URL;

export const APPROVAL_BANNER_LOGO_URL =
    String(process.env.APPROVAL_BANNER_LOGO_URL || '').trim() || ISO_EMAIL_LOGO_URL;

export const OFFER_UPDATED_BANNER_LOGO_URL =
    String(process.env.OFFER_UPDATED_BANNER_LOGO_URL || '').trim() || ISO_EMAIL_LOGO_URL;

/** Logo row on white, then purple gradient title strip — approval / offer-update emails. */
function buildKatanCapitalEmailHeaderHtml(
    logoUrl: string | undefined,
    title: string,
    subtitle: string,
): string {
    const t = KATAN_EMAIL_THEME;
    const url = String(logoUrl || '').trim();
    const logoRow = url
        ? `
                    <tr>
                        <td align="center" style="padding: 24px 20px 16px; background-color: ${t.bgCard};">
                            <img src="${url}" alt="katan" width="180" style="display: block; margin: 0 auto; max-width: 180px; width: 180px; height: auto; border: 0; outline: none;" />
                        </td>
                    </tr>`
        : buildBrandHeaderRowHtml();

    return `
                    ${logoRow}
                    <tr>
                        <td style="padding: 0 20px 4px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: ${t.gradientHero}; background-color: ${t.purpleDeep}; border-radius: 8px;">
                                <tr>
                                    <td align="center" style="padding: 28px 24px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">${title}</div>
                                        <div style="font-size: 14px; opacity: 0.9;">${subtitle}</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>`;
}

type KatanEmailTrackerStep = { label: string; complete: boolean };

function buildKatanCapitalEmailTracker(steps: KatanEmailTrackerStep[]): string {
    const t = KATAN_EMAIL_THEME;
    return steps
        .map((step, index) => {
            const isLast = index === steps.length - 1;
            const connector = isLast
                ? ''
                : `<tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted ${step.complete ? t.purpleAmethyst : t.trackerLineInactive}; height: 35px;"></div></td></tr>`;
            const circleBg = step.complete ? t.purpleDeep : t.trackerBgInactive;
            const circleColor = step.complete ? '#ffffff' : t.textDisabled;
            const labelColor = step.complete ? t.textPrimary : t.textDisabled;
            return `
            <tr><td align="center"><div style="width: 32px; height: 32px; background: ${circleBg}; border-radius: 50%; color: ${circleColor}; line-height: 32px; font-size: 16px;">${step.complete ? '&#10003;' : 'X'}</div></td></tr>
            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: ${labelColor}; line-height: 1.2;">${step.label}</td></tr>
            ${connector}`;
        })
        .join('');
}

function buildKatanCapitalCtaButton(href: string, label: string): string {
    const t = KATAN_EMAIL_THEME;
    return `
        <table border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0 25px 0;">
            <tr>
                <td align="center" style="border-radius: 5px; background: ${t.gradientCta}; background-color: ${t.purpleAmethyst};">
                    <a href="${href}" style="display: inline-block; padding: 12px 25px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">${label}</a>
                </td>
            </tr>
        </table>`;
}

function formatOfferEmailCurrency(value?: number | null): string | undefined {
    if (value == null || !Number.isFinite(value)) return undefined;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

function formatOfferEmailFactorRate(value?: number | null): string | undefined {
    if (value == null || !Number.isFinite(value)) return undefined;
    return value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
    });
}

function looksLikeEmail(value: unknown): boolean {
    const s = String(value ?? '').trim();
    if (!s) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function pickFirstValidEmail(...candidates: unknown[]): string | undefined {
    for (const candidate of candidates) {
        const value = String(candidate ?? '').trim();
        if (looksLikeEmail(value)) return value;
    }
    return undefined;
}

export type ResolveMerchantContactOptions = {
    /** Caller-resolved linked client email (e.g. Funding Call UI from application detail). */
    explicitClientEmail?: string | null;
    /** Persisted contract signer email — highest priority when set. */
    contractClientEmail?: string | null;
};

/**
 * CRM client rows sometimes store a phone number in `ownerEmail` (OCR / manual entry).
 * Prefer a real email address and keep phone-only values out of the Owner Email row.
 * Also checks linked `ClientOwner` rows when flat client columns are empty or invalid.
 * Order: explicit caller email → owner flat → ClientOwner rows → contract signer → business inbox.
 */
export function resolveMerchantContactForOfferEmail(
    client: {
        ownerEmail?: string | null;
        businessEmail?: string | null;
        ownerMobileNumber?: string | null;
        businessNumber?: string | null;
        owners?: Array<{ email?: string | null; sortOrder?: number | null }> | null;
    } | null
    | undefined,
    options?: ResolveMerchantContactOptions,
): { merchantEmail?: string; merchantPhone?: string } {
    const ownerEmailRaw = String(client?.ownerEmail ?? '').trim();
    const businessEmailRaw = String(client?.businessEmail ?? '').trim();
    const ownerMobileRaw = String(client?.ownerMobileNumber ?? '').trim();
    const businessPhoneRaw = String(client?.businessNumber ?? '').trim();

    const ownerRelationEmails = Array.isArray(client?.owners)
        ? [...client.owners]
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
              .map((owner) => String(owner?.email ?? '').trim())
              .filter(Boolean)
        : [];

    const merchantEmail = pickFirstValidEmail(
        options?.explicitClientEmail,
        ownerEmailRaw,
        ...ownerRelationEmails,
        options?.contractClientEmail,
        businessEmailRaw,
    );

    const phoneCandidates = [ownerMobileRaw, businessPhoneRaw];
    if (ownerEmailRaw && !looksLikeEmail(ownerEmailRaw)) phoneCandidates.push(ownerEmailRaw);
    if (businessEmailRaw && !looksLikeEmail(businessEmailRaw)) phoneCandidates.push(businessEmailRaw);

    const merchantPhone = phoneCandidates.find((value) => value.length > 0);
    return { merchantEmail, merchantPhone };
}

/** Katan-themed "Application Details" summary block for the Offer Updated email. */
function buildKatanOfferDetailsHtml({
    applicationNumber,
    companyName,
    merchantName,
    merchantEmail,
    merchantPhone,
    approvedAmount,
    factorRate,
    repaymentAmount,
}: {
    applicationNumber?: number | string;
    companyName: string;
    merchantName?: string;
    merchantEmail?: string;
    merchantPhone?: string;
    approvedAmount?: number;
    factorRate?: number;
    repaymentAmount?: number;
}): string {
    const t = KATAN_EMAIL_THEME;
    const rows: { label: string; value: string }[] = [];
    const emailRaw = String(merchantEmail ?? '').trim();
    const phoneRaw = String(merchantPhone ?? '').trim();
    const displayEmail = looksLikeEmail(emailRaw) ? emailRaw : undefined;
    const displayPhone =
        phoneRaw || (emailRaw && !looksLikeEmail(emailRaw) ? emailRaw : undefined);
    const safeAppRef =
        applicationNumber != null && String(applicationNumber).trim() !== ''
            ? `#${String(applicationNumber).trim()}`
            : '';
    if (safeAppRef) rows.push({ label: 'Application ID', value: safeAppRef });
    rows.push({ label: 'Business Name', value: companyName || '—' });
    if (merchantName) rows.push({ label: 'Merchant / Owner', value: merchantName });
    if (displayEmail) {
        rows.push({
            label: 'Owner Email',
            value: `<a href="mailto:${displayEmail}" style="color: ${t.blueSky}; text-decoration: none;">${displayEmail}</a>`,
        });
    }
    if (displayPhone) rows.push({ label: 'Owner Phone', value: displayPhone });

    const formattedApprovedAmount = formatOfferEmailCurrency(approvedAmount);
    const formattedFactorRate = formatOfferEmailFactorRate(factorRate);
    const formattedRepaymentAmount = formatOfferEmailCurrency(repaymentAmount);
    if (formattedApprovedAmount) rows.push({ label: 'Approved Amount', value: formattedApprovedAmount });
    if (formattedFactorRate) rows.push({ label: 'Factor Rate', value: formattedFactorRate });
    if (formattedRepaymentAmount) rows.push({ label: 'Repayment Amount', value: formattedRepaymentAmount });

    const detailRows = rows
        .map(
            (row) => `
                                            <tr>
                                                <td style="padding: 8px 12px; font-size: 12px; color: ${t.textMuted}; border-bottom: 1px solid ${t.borderCard}; width: 38%;">${row.label}</td>
                                                <td style="padding: 8px 12px; font-size: 13px; color: ${t.textPrimary}; font-weight: bold; border-bottom: 1px solid ${t.borderCard};">${row.value}</td>
                                            </tr>`,
        )
        .join('');

    return `
            <h4 style="margin: 28px 0 10px 0; font-size: 15px; color: ${t.purpleDeep}; text-decoration: underline; letter-spacing: 0.5px;">APPLICATION DETAILS</h4>
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: ${t.trackerBgInactive}; border: 1px solid ${t.borderCard}; border-radius: 4px;">
                ${detailRows}
            </table>`;
}

function buildKatanCapitalClientEmailHtml({
    pageTitle,
    heroTitle,
    heroSubtitle,
    trackerSteps,
    bodyHtml,
    bannerLogoUrl,
}: {
    pageTitle: string;
    heroTitle: string;
    heroSubtitle: string;
    trackerSteps: KatanEmailTrackerStep[];
    bodyHtml: string;
    bannerLogoUrl?: string;
}): string {
    const t = KATAN_EMAIL_THEME;
    const emailHeader = buildKatanCapitalEmailHeaderHtml(bannerLogoUrl, heroTitle, heroSubtitle);
    return `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>${pageTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: ${t.bgBody}; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: ${t.bgCard}; border: 1px solid ${t.borderCard};">
                    ${emailHeader}
                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="110" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            ${buildKatanCapitalEmailTracker(trackerSteps)}
                                        </table>
                                    </td>
                                    <td valign="top" style="padding-left: 25px;">
                                        ${bodyHtml}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

/**
 * Href values in these templates (`viewApplicationUrl`, `publicPortalUrl`, `calculateApprovalUrl`, etc.)
 * are supplied by callers (e.g. `applicationController`) using `resolveCrmFrontendBaseUrl()` from `../utils/crmFrontendUrl`.
 * For local testing, set `LOCAL_FRONTEND_URL` (or `DEV_FRONTEND_URL`) in the API `.env` so links open your dev SPA;
 * in production, set `PUBLIC_SITE_ORIGIN` or `FRONTEND_URL` to the live client origin.
 */

/**
 * When true, application status templates (client/ISO recipient flows) are not sent (no `sendMail`).
 * Internal emails (e.g. welcome, scrubbing notifications) are unaffected.
 *
 * ISO email delivery policy: only `sendApplicationApprovalEmail` and `sendApplicationOfferUpdatedEmail`
 * should target the linked ISO address. Step templates (submitted, underwriting complete, funded, etc.)
 * must not be sent to ISO — callers enforce this; these helpers remain available for other recipients.
 */
const DISABLE_CLIENT_APPLICATION_EMAILS =
    String(process.env.DISABLE_CLIENT_APPLICATION_EMAILS || '').trim().toLowerCase() === 'true';

/**
 * ISO-linked deals should only receive branded approval and offer-update emails.
 * Workflow step templates (submitted, underwriting, etc.) must not be sent to the ISO email.
 */
export const ISO_APPLICATION_EMAIL_TEMPLATES = ['approval', 'offer_updated'] as const;

const isoWorkflowSkipCache = new Map<string, boolean>();

/**
 * Workflow step templates must not be delivered to registered ISO emails.
 * ISO-linked deals only receive approval and offer-update branded emails.
 */
async function shouldSkipWorkflowStepEmailForIsoRecipient(
    to: string,
    template: string,
): Promise<boolean> {
    const normalized = String(to || '').trim().toLowerCase();
    if (!normalized) return false;

    if (isoWorkflowSkipCache.has(normalized)) {
        const cached = isoWorkflowSkipCache.get(normalized) ?? false;
        if (cached) {
            // eslint-disable-next-line no-console
            console.log(
                `[email] Skipped ${template} for ISO recipient ${normalized} — ISO receives approval and offer-update templates only`,
            );
        }
        return cached;
    }

    const iso = await prisma.iso.findFirst({
        where: { email: { equals: normalized, mode: 'insensitive' } },
        select: { id: true },
    });
    const skip = Boolean(iso);
    isoWorkflowSkipCache.set(normalized, skip);
    if (skip) {
        // eslint-disable-next-line no-console
        console.log(
            `[email] Skipped ${template} for ISO recipient ${normalized} — ISO receives approval and offer-update templates only`,
        );
    }
    return skip;
}

/** Resolves links like `{base}/application-details/:id/overview` (idempotent if `/overview` is already present). */
export function withApplicationDetailsOverviewHref(
    viewApplicationUrl: string | undefined,
): string {
    const u = (viewApplicationUrl || '').trim();
    if (!u) return '#';
    const base = u.replace(/\/$/, '');
    if (/\/overview$/i.test(base)) return base;
    return `${base}/overview`;
}

export interface WelcomeEmailParams {
    to: string;
    name: string;
    role: string;
    temporaryPassword: string;
    loginUrl: string;
}

export async function sendWelcomeEmail({
    to,
    name,
    role,
    temporaryPassword,
    loginUrl,
}: WelcomeEmailParams): Promise<void> {
    const safeName = name || to;
    const subject = 'Your In-House CRM Account Details';
    const body = `
    <h2>Hello ${safeName},</h2>
    <p>Your account has been created in <strong>In-House CRM</strong>.</p>
    <p><strong>Assigned role:</strong> ${role}</p>
    <p><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
    <p><strong>Temporary password:</strong> ${temporaryPassword}</p>
    <p>For security, please log in and change your password after first sign-in.</p>
  `;

    try {
        await sendMail(to, subject, body);
    } catch (error) {
        // Log only – user creation must not fail because of email issues
        // eslint-disable-next-line no-console
        console.error('Welcome email send failed (user was created):', error);
    }
}

export interface ApplicationApprovalEmailParams {
    to: string;
    /** Optional CC recipients on the approval template email. */
    cc?: string[];
    clientName: string;
    companyName: string;
    viewApplicationUrl?: string;
    calculateApprovalUrl?: string;
    /** Optional logo URL above the hero banner (overrides APPROVAL_BANNER_LOGO_URL). */
    bannerLogoUrl?: string;
    /** Frontend-rendered branded HTML; when set it is sent as-is instead of the backend template. */
    html?: string;
    /** Overrides the default subject when the frontend template is used. */
    subject?: string;
    /** SendGrid webhook correlation id (`ocid` custom arg). */
    trackingId?: string;
    /** Resolved offer terms injected into frontend HTML placeholders. */
    offerInjectValues?: Pick<
        ApplicationApprovalEmailInjectValues,
        | 'requestAmount'
        | 'approvedAmount'
        | 'factorRate'
        | 'paybackAmount'
        | 'term'
        | 'repay'
        | 'monthlyRepayment'
        | 'achFrequency'
    >;
}

/**
 * Placeholders embedded by the frontend approval template. The backend owns the
 * signed public-portal URL and the resolved ISO recipient / business name, so it
 * swaps these tokens for real values before sending (mirrors the document-request
 * `__DOCUMENT_REQUEST_UPLOAD_URL__` flow).
 */
export const APPLICATION_APPROVAL_URL_PLACEHOLDER = '__APPLICATION_APPROVAL_URL__';
export const APPLICATION_APPROVAL_CLIENT_NAME_PLACEHOLDER = '__APPROVAL_CLIENT_NAME__';
export const APPLICATION_APPROVAL_COMPANY_NAME_PLACEHOLDER = '__APPROVAL_COMPANY_NAME__';

export const APPLICATION_APPROVED_REQUEST_AMOUNT_PLACEHOLDER =
    '__APPROVAL_REQUEST_AMOUNT__';
export const APPLICATION_APPROVED_APPROVED_AMOUNT_PLACEHOLDER =
    '__APPROVAL_APPROVED_AMOUNT__';
export const APPLICATION_APPROVED_FACTOR_RATE_PLACEHOLDER = '__APPROVAL_FACTOR_RATE__';
export const APPLICATION_APPROVED_PAYBACK_AMOUNT_PLACEHOLDER =
    '__APPROVAL_PAYBACK_AMOUNT__';
export const APPLICATION_APPROVED_TERM_PLACEHOLDER = '__APPROVAL_TERM__';
export const APPLICATION_APPROVED_REPAY_PLACEHOLDER = '__APPROVAL_REPAY__';
export const APPLICATION_APPROVED_MONTHLY_REPAYMENT_PLACEHOLDER =
    '__APPROVAL_MONTHLY_REPAYMENT__';
export const APPLICATION_APPROVED_ACH_FREQUENCY_PLACEHOLDER =
    '__APPROVAL_ACH_FREQUENCY__';

export type ApplicationApprovalEmailInjectValues = {
    approvalUrl?: string;
    clientName?: string;
    companyName?: string;
    requestAmount?: string;
    approvedAmount?: string;
    factorRate?: string;
    paybackAmount?: string;
    term?: string;
    repay?: string;
    monthlyRepayment?: string;
    achFrequency?: string;
};

function escapeApprovalEmailValue(value: string): string {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Fills the frontend approval-template placeholders with server-resolved values. */
export function injectApplicationApprovalEmailValues(
    html: string,
    values: ApplicationApprovalEmailInjectValues,
): string {
    let out = String(html || '');
    const approvalUrl = String(values.approvalUrl || '').trim();
    if (approvalUrl) {
        out = out.split(APPLICATION_APPROVAL_URL_PLACEHOLDER).join(approvalUrl);
    }
    const replaceText = (placeholder: string, raw: string | undefined) => {
        const text = String(raw ?? '').trim() || '—';
        out = out.split(placeholder).join(escapeApprovalEmailValue(text));
    };
    replaceText(APPLICATION_APPROVAL_CLIENT_NAME_PLACEHOLDER, values.clientName);
    replaceText(APPLICATION_APPROVAL_COMPANY_NAME_PLACEHOLDER, values.companyName);
    replaceText(APPLICATION_APPROVED_REQUEST_AMOUNT_PLACEHOLDER, values.requestAmount);
    replaceText(APPLICATION_APPROVED_APPROVED_AMOUNT_PLACEHOLDER, values.approvedAmount);
    replaceText(APPLICATION_APPROVED_FACTOR_RATE_PLACEHOLDER, values.factorRate);
    replaceText(APPLICATION_APPROVED_PAYBACK_AMOUNT_PLACEHOLDER, values.paybackAmount);
    replaceText(APPLICATION_APPROVED_TERM_PLACEHOLDER, values.term);
    replaceText(APPLICATION_APPROVED_REPAY_PLACEHOLDER, values.repay);
    replaceText(
        APPLICATION_APPROVED_MONTHLY_REPAYMENT_PLACEHOLDER,
        values.monthlyRepayment,
    );
    replaceText(APPLICATION_APPROVED_ACH_FREQUENCY_PLACEHOLDER, values.achFrequency);
    return out;
}

export function buildApplicationApprovedEmailInjectValues(input: {
    requestAmount?: number | null;
    approvedAmount?: number | null;
    factorRate?: number | null;
    paybackAmount?: number | null;
    term?: string | number | null;
    repay?: number | null;
    monthlyRepayment?: number | null;
    achFrequency?: string | null;
}): Pick<
    ApplicationApprovalEmailInjectValues,
    | 'requestAmount'
    | 'approvedAmount'
    | 'factorRate'
    | 'paybackAmount'
    | 'term'
    | 'repay'
    | 'monthlyRepayment'
    | 'achFrequency'
> {
    const termRaw = input.term;
    const termText =
        termRaw == null || String(termRaw).trim() === ''
            ? undefined
            : String(termRaw).replace(/\s*payments?/i, '').trim();

    return {
        requestAmount: formatOfferEmailCurrency(input.requestAmount),
        approvedAmount: formatOfferEmailCurrency(input.approvedAmount),
        factorRate: formatOfferEmailFactorRate(input.factorRate),
        paybackAmount: formatOfferEmailCurrency(input.paybackAmount),
        term: termText,
        repay: formatOfferEmailCurrency(input.repay),
        monthlyRepayment: formatOfferEmailCurrency(input.monthlyRepayment),
        achFrequency: String(input.achFrequency || '').trim() || undefined,
    };
}

export const APPROVAL_EMAIL_PDF_FILENAME = 'Application-approved-template.pdf';
export const OFFER_UPDATED_EMAIL_PDF_FILENAME = 'Update-offer-template.pdf';

type MailAttachment = {
    filename?: string | false;
    content?: Buffer | string;
    path?: string;
    cid?: string;
    contentType?: string;
    contentDisposition?: 'inline' | 'attachment';
};

function buildIsoBrandedEmailAttachments(): MailAttachment[] {
    return [...buildBrandLogoAttachments()];
}

export const buildApplicationApprovalEmailHtml = ({
    clientName,
    companyName,
    calculateApprovalUrl,
    viewApplicationUrl,
}: Omit<ApplicationApprovalEmailParams, 'to' | 'bannerLogoUrl'>): string =>
    renderApplicationApprovalEmailHtml({
        client_name: clientName || 'Valued Client',
        company_name: companyName || 'your company',
        calculate_approval_url: calculateApprovalUrl || APPLICATION_APPROVAL_URL_PLACEHOLDER,
        view_application_url:
            viewApplicationUrl || calculateApprovalUrl || APPLICATION_APPROVAL_URL_PLACEHOLDER,
    });

export const buildApplicationApprovedEmailHtml = ({
    clientName,
    companyName,
}: Pick<ApplicationApprovalEmailParams, 'clientName' | 'companyName'>): string =>
    renderApplicationApprovedEmailHtml({
        client_name: clientName || APPLICATION_APPROVAL_CLIENT_NAME_PLACEHOLDER,
        company_name: companyName || APPLICATION_APPROVAL_COMPANY_NAME_PLACEHOLDER,
        request_amount: APPLICATION_APPROVED_REQUEST_AMOUNT_PLACEHOLDER,
        approved_amount: APPLICATION_APPROVED_APPROVED_AMOUNT_PLACEHOLDER,
        factor_rate: APPLICATION_APPROVED_FACTOR_RATE_PLACEHOLDER,
        payback_amount: APPLICATION_APPROVED_PAYBACK_AMOUNT_PLACEHOLDER,
        term: APPLICATION_APPROVED_TERM_PLACEHOLDER,
        repay: APPLICATION_APPROVED_REPAY_PLACEHOLDER,
        monthly_repayment: APPLICATION_APPROVED_MONTHLY_REPAYMENT_PLACEHOLDER,
        ach_frequency: APPLICATION_APPROVED_ACH_FREQUENCY_PLACEHOLDER,
    });

export type IsoBrandedEmailSendResult = { sent: boolean; sgMessageId?: string };

function readSendGridMessageId(result: unknown): string | undefined {
    return typeof (result as { messageId?: string })?.messageId === 'string'
        ? (result as { messageId: string }).messageId
        : undefined;
}

/** @returns send outcome; includes SendGrid message id when tracked delivery succeeds */
export async function sendApplicationApprovalEmail({
    to,
    cc,
    clientName,
    companyName,
    viewApplicationUrl,
    calculateApprovalUrl,
    html: clientHtml,
    subject: clientSubject,
    trackingId,
    offerInjectValues,
}: ApplicationApprovalEmailParams): Promise<IsoBrandedEmailSendResult> {
    const toTrimmed = String(to || '').trim();
    if (!toTrimmed) {
        // eslint-disable-next-line no-console
        console.warn('[email] Application approval skipped: empty recipient');
        return { sent: false };
    }

    if (DISABLE_CLIENT_APPLICATION_EMAILS) {
        // eslint-disable-next-line no-console
        console.warn(
            '[email] Application approval skipped: DISABLE_CLIENT_APPLICATION_EMAILS=true (set to false to deliver ISO approval template)',
            { to: toTrimmed },
        );
        return { sent: false };
    }

    const subject = String(clientSubject || '').trim() || 'Your Application Has Been Approved';
    const rawHtml =
        String(clientHtml || '').trim() ||
        (offerInjectValues
            ? buildApplicationApprovedEmailHtml({ clientName, companyName })
            : buildApplicationApprovalEmailHtml({
                  clientName,
                  companyName,
                  viewApplicationUrl,
                  calculateApprovalUrl,
              }));
    const html = injectApplicationApprovalEmailValues(rawHtml, {
        approvalUrl: calculateApprovalUrl,
        clientName,
        companyName,
        ...offerInjectValues,
    });

    const trackingIdTrimmed = String(trackingId || '').trim();
    const usesApprovedOfferTemplate =
        Boolean(offerInjectValues) || html.includes('Approved Offer Details');
    const ccList = (cc || []).map((e) => String(e || '').trim()).filter(Boolean);
    const uniqueCc = [...new Set(ccList.map((e) => e.toLowerCase()))]
        .map((lower) => ccList.find((e) => e.toLowerCase() === lower) || lower)
        .filter((e) => e.toLowerCase() !== toTrimmed.toLowerCase());

    try {
        const attachments = buildIsoBrandedEmailAttachments();
        const mailOptions = {
            to: toTrimmed,
            cc: uniqueCc.length ? uniqueCc : undefined,
            subject,
            html,
            attachments,
            trackingId: trackingIdTrimmed || undefined,
            categories: trackingIdTrimmed
                ? [usesApprovedOfferTemplate ? 'application-approved' : 'approval']
                : undefined,
        };
        const result = trackingIdTrimmed
            ? await sendSendGridMail({
                  ...mailOptions,
                  from: getSendGridMailFrom(),
              })
            : await sendMail(mailOptions);
        if (!trackingIdTrimmed) {
            // eslint-disable-next-line no-console
            console.warn(
                '[email] Application approval sent without trackingId — SendGrid webhook delivery status will not be recorded',
                { to: toTrimmed },
            );
        }
        return { sent: true, sgMessageId: readSendGridMessageId(result) };
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Application approval email send failed:', { to: toTrimmed, error });
        return { sent: false };
    }
}

export interface ApplicationRejectionEmailParams {
    to: string;
    /** Optional CC recipients on the rejection template email. */
    cc?: string[];
    /** RFC `In-Reply-To` — threads decline mail onto the ISO submission email. */
    inReplyTo?: string;
    /** RFC `References` — threads decline mail onto the ISO submission email. */
    references?: string;
    /** Greeting name — the linked ISO contact (falls back to recipient email). */
    clientName: string;
    /** Primary decline reason (the selected rejection reason). */
    primaryReason: string;
    /** Optional free-text "other reasons" (maps to the decline additional comments). */
    otherReasons?: string;
    /** Optional logo URL above the header (overrides ISO_EMAIL_LOGO_URL). */
    bannerLogoUrl?: string;
    /** Pre-rendered HTML from the CRM frontend template (skips legacy builder). */
    html?: string;
    /** Threaded reply subject for the ISO (may include `Re:`). */
    subject?: string;
    /** Standalone subject for CC copies — no threading, no `Re:` prefix. */
    freshSubject?: string;
    /** SendGrid webhook correlation id (`ocid` custom arg). */
    trackingId?: string;
}

export const REJECTION_EMAIL_PDF_FILENAME = 'Application-declined-template.pdf';

export type ApplicationRejectionEmailResult = {
    sent: boolean;
    emailedTo: string[];
    emailedCc: string[];
    ccErrors: string[];
    sgMessageId?: string;
};

function cloneMailAttachments(attachments: MailAttachment[]) {
    return attachments.map((attachment) => ({
        ...attachment,
        content:
            attachment.content != null && Buffer.isBuffer(attachment.content)
                ? Buffer.from(attachment.content)
                : attachment.content,
    }));
}

/** Minimal HTML escaping for values interpolated into email markup. */
function escapeEmailHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function resolveDeclineReasonsFromParams(
    primaryReason: string,
    otherReasons?: string,
): string[] {
    const primary = String(primaryReason || '').trim();
    const other = String(otherReasons || '').trim();
    const reasons: string[] = [];
    if (primary) reasons.push(primary);
    if (other) {
        other
            .split(',')
            .map((reason) => reason.trim())
            .filter(Boolean)
            .forEach((reason) => reasons.push(reason));
    }
    return reasons.length ? reasons : ['Does not meet underwriting criteria'];
}

function renderDeclineReasonBulletRow(
    reason: string,
    paddingBottom: number,
): string {
    return `
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:${paddingBottom}px;">
                                        <tr>
                                          <td style="font-size:18px;color:#da1e28;padding-right:8px;line-height:1;vertical-align:top;width:16px;">&bull;</td>
                                          <td style="font-family:Georgia,Times,serif;font-size:18px;font-weight:bold;color:#111111;line-height:1.3;vertical-align:top;">
                                            ${escapeEmailHtml(reason)}
                                          </td>
                                        </tr>
                                      </table>`;
}

function renderDeclineReasonColumnHtml(reasons: string[]): string {
    if (reasons.length === 0) {
        return '&nbsp;';
    }

    return reasons
        .map((reason, index) =>
            renderDeclineReasonBulletRow(reason, index < reasons.length - 1 ? 12 : 0),
        )
        .join('');
}

function splitDeclineReasonsForColumns(
    reasons: string[],
    perColumn = 5,
): { left: string[]; right: string[] } {
    const list = reasons.length ? reasons : ['Does not meet underwriting criteria'];
    return {
        left: list.slice(0, perColumn),
        right: list.slice(perColumn),
    };
}

function renderDeclineReasonsEmailRows(reasons: string[]): string {
    const { left, right } = splitDeclineReasonsForColumns(reasons);

    if (right.length === 0) {
        return `
                                  <tr>
                                    <td style="vertical-align:top;">
                                      ${renderDeclineReasonColumnHtml(left)}
                                    </td>
                                  </tr>`;
    }

    return `
                                  <tr>
                                    <td style="vertical-align:top;">
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                        <tr>
                                          <td width="50%" valign="top" style="width:50%;padding-right:10px;vertical-align:top;">
                                            ${renderDeclineReasonColumnHtml(left)}
                                          </td>
                                          <td width="50%" valign="top" style="width:50%;padding-left:10px;vertical-align:top;">
                                            ${renderDeclineReasonColumnHtml(right)}
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                  </tr>`;
}

/**
 * Branded "Application Declined" email for the linked ISO.
 * Self-contained, inbox-safe HTML (table layout, no external CSS) matching the
 * approved decline design: purple accent bars, blue "Reason For Decline" panel,
 * info disclaimer, and footer ribbon.
 */
export const buildApplicationRejectionEmailHtml = ({
    clientName,
    primaryReason,
    otherReasons,
    bannerLogoUrl,
}: Omit<ApplicationRejectionEmailParams, 'to' | 'trackingId'>): string => {
    const safeClientName = escapeEmailHtml(clientName || 'Valued Partner');
    const declineReasons = resolveDeclineReasonsFromParams(primaryReason, otherReasons);
    const declineReasonsBlock = renderDeclineReasonsEmailRows(declineReasons);
    const reasonsHeading = declineReasons.length > 1 ? 'Decline Reasons' : 'Decline Reason';
    const logoUrl = escapeEmailHtml(String(bannerLogoUrl || ISO_EMAIL_LOGO_URL || '').trim());

    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Application Declined</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; display: block; }
    a { text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; border: none !important; }
      .content-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .reason-table { width: 100% !important; }
      .reason-sidebar { display: block !important; width: 100% !important; border-radius: 6px 6px 0 0 !important; text-align: center !important; padding: 20px 0 !important; }
      .reason-content { display: block !important; width: 100% !important; border-radius: 0 0 6px 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f4f5f7;">
    <tr>
      <td align="center" style="padding:20px 10px;">

        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;border-collapse:collapse;border:1px solid #e2e8f0;background-color:#ffffff;">
          <tr>
            <td style="padding:0;position:relative;z-index:1;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;">

                <!-- Top Header Accent Bar -->
                <tr>
                  <td bgcolor="#a25ddc" style="padding:0;line-height:0;font-size:0;background-color:#a25ddc;height:45px;text-align:center;vertical-align:bottom;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;background-color:#ffffff;border-radius:12px 12px 0 0;">
                      <tr>
                        <td style="padding:10px 45px 0 45px;line-height:0;font-size:0;">
                          <img src="${logoUrl}" alt="katan" width="130" style="display:block;width:130px;height:auto;max-width:130px;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Title Block -->
                <tr>
                  <td align="center" class="content-pad" style="padding:40px 45px 15px 45px;">
                    <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;line-height:1.2;color:#22a1e3;letter-spacing:0.5px;">
                      APPLICATION <span style="color:#22a1e3;">REJECT</span>
                    </h1>
                    <p style="margin:16px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#666666;font-weight:normal;max-width:420px;text-align:center;margin-left:auto;margin-right:auto;">
                      Thank you for your application.<br>After careful review, we are unable to approve it at this time.
                    </p>
                  </td>
                </tr>

                <!-- Body Content Area -->
                <tr>
                  <td class="content-pad" style="padding:30px 45px 30px 45px;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                      <tr>
                        <td style="padding:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:1.3;color:#333333;">
                          Hi ${safeClientName},
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 0 25px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#777777;">
                          Unfortunately, your application does not meet our underwriting criteria.
                        </td>
                      </tr>

                      <!-- Reason for Decline -->
                      <tr>
                        <td style="padding:0 0 20px 0;">
                          <table role="presentation" class="reason-table" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #bce1f6;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
                            <tr>
                              <td class="reason-sidebar" width="115" bgcolor="#0056cd" align="center" valign="middle" style="width:115px;background-color:#0056cd;padding:25px 10px;text-align:center;vertical-align:middle;border-radius:10px 0 0 10px;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;background-color:#ffffff;border-radius:50%;width:34px;height:34px;">
                                  <tr>
                                    <td align="center" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#0056cd;height:34px;line-height:34px;text-align:center;vertical-align:middle;">
                                      X
                                    </td>
                                  </tr>
                                </table>
                                <p style="margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;line-height:1.3;color:#ffffff;letter-spacing:0.5px;text-transform:uppercase;">
                                  Reason For<br>Decline
                                </p>
                              </td>

                              <td class="reason-content" bgcolor="#ffffff" valign="top" style="background-color:#ffffff;padding:20px 25px;border-radius:0 10px 10px 0;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                  <tr>
                                    <td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#da1e28;padding-bottom:8px;">
                                      ${reasonsHeading}
                                    </td>
                                  </tr>${declineReasonsBlock}
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <!-- Disclaimer Notice -->
                      <tr>
                        <td style="padding:0 0 35px 0;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#dff0fa" style="background-color:#dff0fa;border-radius:6px;border-left:4px solid #0056cd;">
                            <tr>
                              <td width="30" valign="middle" style="padding:10px 0 10px 12px;vertical-align:middle;text-align:center;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" bgcolor="#0056cd" style="background-color:#0056cd;border-radius:50%;width:16px;height:16px;text-align:center;">
                                  <tr>
                                    <td align="center" valign="middle" style="font-family:Georgia,serif;font-size:11px;font-weight:bold;color:#ffffff;line-height:16px;height:16px;text-align:center;font-style:italic;">i</td>
                                  </tr>
                                </table>
                              </td>
                              <td style="padding:10px 15px 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#454f63;vertical-align:middle;">
                                This decision is based on information from the review of your application and support documents.
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#888888;">
                          This decision is specific to this application and does not affect future submissions.
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#444444;">
                          <strong style="color:#333333;font-weight:bold;">Thank you for considering us as your funding partner.</strong><br>
                          <span style="color:#777777;">We appreciate your interest and wish you success.</span>
                        </td>
                      </tr>

                    </table>
                  </td>
                </tr>

                <!-- Footer Accent Ribbon -->
                <tr>
                  <td style="padding:0;line-height:0;font-size:0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">
                      <tr>
                        <td height="12" bgcolor="#a25ddc" style="height:12px;line-height:12px;font-size:12px;background-color:#a25ddc;">&nbsp;</td>
                      </tr>
                      <tr>
                        <td align="center" bgcolor="#22a1e3" style="height:12px;line-height:0;font-size:0;background-color:#22a1e3;padding:0;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="80" align="center" style="margin:0 auto;">
                            <tr>
                              <td height="12" bgcolor="#22a1e3" style="height:12px;background-color:#22a1e3;border-left:10px solid #a25ddc;border-right:10px solid #a25ddc;">&nbsp;</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
};

/** @returns delivery summary; CC recipients each receive a dedicated To copy (reliable SendGrid delivery). */
export async function sendApplicationRejectionEmail({
    to,
    cc,
    inReplyTo,
    references,
    clientName,
    primaryReason,
    otherReasons,
    bannerLogoUrl,
    html: clientHtml,
    subject: clientSubject,
    freshSubject: clientFreshSubject,
    trackingId,
}: ApplicationRejectionEmailParams): Promise<ApplicationRejectionEmailResult> {
    const emptyResult: ApplicationRejectionEmailResult = {
        sent: false,
        emailedTo: [],
        emailedCc: [],
        ccErrors: [],
    };
    const toTrimmed = String(to || '').trim();
    if (!toTrimmed) {
        // eslint-disable-next-line no-console
        console.warn('[email] Application rejection skipped: empty recipient');
        return emptyResult;
    }

    if (DISABLE_CLIENT_APPLICATION_EMAILS) {
        // eslint-disable-next-line no-console
        console.warn(
            '[email] Application rejection skipped: DISABLE_CLIENT_APPLICATION_EMAILS=true (set to false to deliver ISO decline template)',
            { to: toTrimmed },
        );
        return emptyResult;
    }

    const threadedSubject = String(clientSubject || '').trim() || 'Application Rejected';
    const standaloneSubject =
        String(clientFreshSubject || '').trim() ||
        threadedSubject.replace(/^re:\s*/i, '').trim() ||
        'Application Rejected';
    const html =
        String(clientHtml || '').trim() ||
        buildApplicationRejectionEmailHtml({
            clientName,
            primaryReason,
            otherReasons,
            bannerLogoUrl,
        });
    const ccList = (cc || []).map((e) => String(e || '').trim()).filter(Boolean);
    const uniqueCc = [...new Set(ccList.map((e) => e.toLowerCase()))]
        .map((lower) => ccList.find((e) => e.toLowerCase() === lower) || lower)
        .filter((e) => e.toLowerCase() !== toTrimmed.toLowerCase());

    const emailedTo: string[] = [];
    const emailedCc: string[] = [];
    const ccErrors: string[] = [];

    const dispatchRejectionMail = async (
        mailTo: string | string[],
        options: { threaded: boolean; withTracking: boolean },
        attachments: MailAttachment[],
    ): Promise<SendMailResult | undefined> => {
        const payload = {
            inReplyTo: options.threaded
                ? String(inReplyTo || '').trim() || undefined
                : undefined,
            references: options.threaded
                ? String(references || '').trim() || undefined
                : undefined,
            subject: options.threaded ? threadedSubject : standaloneSubject,
            html,
            to: mailTo,
            categories: ['rejection'] as string[],
            attachments: cloneMailAttachments(attachments),
            ...(options.withTracking && trackingId ? { trackingId } : {}),
        };

        if (isSendGridConfigured()) {
            return sendSendGridMail({
                ...payload,
                from: getSendGridMailFrom(),
            });
        }

        return sendMail(payload) as Promise<SendMailResult>;
    };

    try {
        const attachments = buildIsoBrandedEmailAttachments();

        // ISO: reply in the original submission thread when headers are available.
        const primaryResult = await dispatchRejectionMail(
            toTrimmed,
            { threaded: true, withTracking: true },
            attachments,
        );
        emailedTo.push(toTrimmed);
        const sgMessageId = readSendGridMessageId(primaryResult);

        // CC: each address gets a fresh standalone message (no In-Reply-To / References).
        for (const ccAddress of uniqueCc) {
            try {
                await dispatchRejectionMail(
                    ccAddress,
                    { threaded: false, withTracking: false },
                    attachments,
                );
                emailedCc.push(ccAddress);
            } catch (ccError) {
                const message = ccError instanceof Error ? ccError.message : String(ccError);
                ccErrors.push(`${ccAddress}: ${message}`);
                console.error('[email] Application rejection CC copy failed:', {
                    cc: ccAddress,
                    error: ccError,
                });
            }
        }

        if (uniqueCc.length > 0) {
            console.info('[email] Application rejection delivery summary', {
                to: emailedTo,
                cc: emailedCc,
                ccErrors,
            });
        }
        return {
            sent: emailedTo.length > 0,
            emailedTo,
            emailedCc,
            ccErrors,
            sgMessageId,
        };
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Application rejection email send failed:', { to: toTrimmed, cc: uniqueCc, error });
        return {
            sent: false,
            emailedTo,
            emailedCc,
            ccErrors,
        };
    }
}

export interface OperationsIsoApprovalAlertEmailParams {
    to: string;
    operationsName?: string;
    isoName: string;
    applicationNumber: string;
    clientName: string;
    viewApplicationUrl?: string;
}

/** Operations alert email when ISO approves an application and contract creation can begin. */
export async function sendOperationsIsoApprovalAlertEmail({
    to,
    operationsName,
    isoName,
    applicationNumber,
    clientName,
    viewApplicationUrl,
}: OperationsIsoApprovalAlertEmailParams): Promise<boolean> {
    const toTrimmed = String(to || '').trim();
    if (!toTrimmed) {
        // eslint-disable-next-line no-console
        console.warn('[email] Operations ISO-approval alert skipped: empty recipient');
        return false;
    }

    const safeOperationsName = String(operationsName || '').trim() || 'Operations Team';
    const safeIsoName = String(isoName || '').trim() || 'ISO';
    const safeApplicationNumber = String(applicationNumber || '').trim() || 'N/A';
    const safeClientName = String(clientName || '').trim() || 'Client';
    const applicationHref = withApplicationDetailsOverviewHref(viewApplicationUrl);

    const subject = `ISO approved application #${safeApplicationNumber} - proceed to generate contract`;
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>ISO Approval Alert</title>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin:0; padding:0; background:#f4f7f9; font-family: Arial, Helvetica, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border:1px solid #e5e7eb;">
                    ${buildBrandHeaderRowHtml()}
                    <tr>
                        <td style="padding: 20px 24px 8px;">
                            <h2 style="margin:0; color:#111827; font-size:22px;">ISO Approval Received</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 20px; color:#374151; font-size:14px; line-height:1.6;">
                            <p style="margin: 0 0 12px;">Hi ${safeOperationsName},</p>
                            <p style="margin: 0 0 8px;">
                                <strong>Application ID:</strong> #${safeApplicationNumber}
                            </p>
                            <p style="margin: 0 0 16px;">
                                <strong>ISO</strong> approved application <strong>#${safeApplicationNumber}</strong>.
                                The deal has been moved to the <strong>Contract Pending</strong> stage.
                                Now you can proceed to generate contract.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

    try {
        await sendMail({
            to: toTrimmed,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
        return true;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Operations ISO-approval alert email send failed:', { to: toTrimmed, error });
        return false;
    }
}

/** Client email when offer values are updated after approval comments. */
export interface ApplicationOfferUpdatedEmailParams {
    to: string;
    /** Optional CC recipients on the offer-updated template email. */
    cc?: string[];
    clientName: string;
    companyName: string;
    viewApplicationUrl?: string;
    calculateApprovalUrl?: string;
    applicationNumber?: number | string;
    merchantName?: string;
    merchantEmail?: string;
    merchantPhone?: string;
    approvedAmount?: number;
    factorRate?: number;
    repaymentAmount?: number;
    /** Optional logo URL above the hero banner (overrides OFFER_UPDATED_BANNER_LOGO_URL). */
    bannerLogoUrl?: string;
    /** Frontend-rendered branded HTML; when set it is sent as-is instead of the backend template. */
    html?: string;
    /** Overrides the default subject when the frontend template is used. */
    subject?: string;
    /** SendGrid webhook correlation id (`ocid` custom arg). */
    trackingId?: string;
}

export const buildApplicationOfferUpdatedEmailHtml = ({
    clientName,
    companyName,
    calculateApprovalUrl,
    viewApplicationUrl,
}: Omit<
    ApplicationOfferUpdatedEmailParams,
    'to' | 'applicationNumber' | 'merchantName' | 'merchantEmail' | 'merchantPhone' | 'approvedAmount' | 'factorRate' | 'repaymentAmount' | 'bannerLogoUrl'
>): string =>
    renderOfferUpdatedEmailHtml({
        client_name: clientName || 'Valued Client',
        company_name: companyName || 'your company',
        calculate_approval_url: calculateApprovalUrl || APPLICATION_APPROVAL_URL_PLACEHOLDER,
        view_application_url:
            viewApplicationUrl || calculateApprovalUrl || APPLICATION_APPROVAL_URL_PLACEHOLDER,
    });

export async function sendApplicationOfferUpdatedEmail({
    to,
    cc,
    clientName,
    companyName,
    viewApplicationUrl,
    calculateApprovalUrl,
    html: clientHtml,
    subject: clientSubject,
    trackingId,
}: ApplicationOfferUpdatedEmailParams): Promise<IsoBrandedEmailSendResult> {
    const toTrimmed = String(to || '').trim();
    if (!toTrimmed) {
        // eslint-disable-next-line no-console
        console.warn('[email] Offer update skipped: empty recipient');
        return { sent: false };
    }

    if (DISABLE_CLIENT_APPLICATION_EMAILS) {
        // eslint-disable-next-line no-console
        console.warn(
            '[email] Offer update skipped: DISABLE_CLIENT_APPLICATION_EMAILS=true',
            { to: toTrimmed },
        );
        return { sent: false };
    }

    const subject = String(clientSubject || '').trim() || 'Your Offer Values Have Been Updated';
    const rawHtml =
        String(clientHtml || '').trim() ||
        buildApplicationOfferUpdatedEmailHtml({
            clientName,
            companyName,
            viewApplicationUrl,
            calculateApprovalUrl,
        });
    const html = injectApplicationApprovalEmailValues(rawHtml, {
        approvalUrl: calculateApprovalUrl,
        clientName,
        companyName,
    });
    const ccList = (cc || []).map((e) => String(e || '').trim()).filter(Boolean);
    const uniqueCc = [...new Set(ccList.map((e) => e.toLowerCase()))]
        .map((lower) => ccList.find((e) => e.toLowerCase() === lower) || lower)
        .filter((e) => e.toLowerCase() !== toTrimmed.toLowerCase());

    try {
        const attachments = buildIsoBrandedEmailAttachments();
        const mailOptions = {
            to: toTrimmed,
            cc: uniqueCc.length ? uniqueCc : undefined,
            subject,
            html,
            attachments,
            trackingId,
            categories: ['offer-updated'] as string[],
        };
        const result = isSendGridConfigured()
            ? await sendSendGridMail({
                  ...mailOptions,
                  from: getSendGridMailFrom(),
              })
            : await sendMail(mailOptions);
        return { sent: true, sgMessageId: readSendGridMessageId(result) };
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Offer update email send failed:', { to: toTrimmed, error });
        return { sent: false };
    }
}

/** Client email when Operations updates Funding Call status (merchant interview / verification stage). */
export interface FundingCallPendingEmailParams {
    to: string;
    clientName?: string;
    companyName?: string;
}

export const buildFundingCallPendingEmailHtml = ({
    clientName,
    companyName,
}: Omit<FundingCallPendingEmailParams, 'to'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your business';

    return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Funding Call Stage</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">📞</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">FUNDING CALL PENDING</div>
                                        <div style="font-size: 14px; opacity: 0.9;">You're almost there! One final call to verify your funding details.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="110" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Contract</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; font-weight: bold;">Funding Call</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            Your application for <strong style="color: #0b71a9;">'${safeCompanyName}'</strong> has reached the final verification stage: <strong>The Funding Call</strong>.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            To complete the process and release your funds, we need to conduct a brief merchant interview. This call is to verify the terms of the advance and confirm your business details. 
                                        </p>

                                      

                                       
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

export async function sendFundingCallPendingEmail({
    to,
    clientName,
    companyName,
}: FundingCallPendingEmailParams): Promise<void> {
    if (DISABLE_CLIENT_APPLICATION_EMAILS) return;
    if (await shouldSkipWorkflowStepEmailForIsoRecipient(to, 'funding-call-pending')) return;

    const subject = 'Funding call — next step for your application';
    const html = buildFundingCallPendingEmailHtml({ clientName, companyName });

    try {
        await sendMail({
            to,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Funding call pending email send failed:', error);
    }
}

/** Client email when disbursement is confirmed (funds released notification). */
export interface ApplicationFundedEmailParams {
    to: string;
    clientName?: string;
    companyName?: string;
}

export const buildApplicationFundedEmailHtml = ({
    clientName,
    companyName,
}: Omit<ApplicationFundedEmailParams, 'to'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your business';

    return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Application Funded</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">💰</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">FUNDS RELEASED</div>
                                        <div style="font-size: 14px; opacity: 0.9;">Success! Your funding has been processed and sent.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="110" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Verification</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333;">Final Review</td></tr>
                                            <tr><td align="center" style="padding: 5px 0;"><div style="width: 0px; border-left: 2px dotted #0b71a9; height: 35px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 32px; height: 32px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 32px; font-size: 16px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; font-weight: bold;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            We are excited to inform you that your application for <strong style="color: #0b71a9;">'${safeCompanyName}'</strong> is now fully <strong>Funded</strong>.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            The funds have been successfully released to your designated bank account. Depending on your bank's processing time, you should see the capital reflected in your balance shortly.
                                        </p>

                                    
                                        <p style="font-size: 13px; color: #777; margin-top: 20px; line-height: 1.4;">
                                            Thank you for choosing FinexusAI as your funding partner. We look forward to supporting your business growth!
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

export async function sendApplicationFundedEmail({
    to,
    clientName,
    companyName,
}: ApplicationFundedEmailParams): Promise<void> {
    if (DISABLE_CLIENT_APPLICATION_EMAILS) return;
    if (await shouldSkipWorkflowStepEmailForIsoRecipient(to, 'application-funded')) return;

    const subject = 'Your application is funded — funds released';
    const html = buildApplicationFundedEmailHtml({ clientName, companyName });

    try {
        await sendMail({
            to,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Application funded email send failed:', error);
    }
}

/** Client email when an agent sends the application to Underwriting — prefer `publicPortalUrl` (token link; no CRM login). */
export interface ApplicationSentToUnderwritingClientEmailParams {
    to: string;
    clientName?: string;
    companyName?: string;
    agentName?: string;
    applicationNumber?: number | string;
    /** Optional CRM deep link for internal staff only. */
    viewApplicationUrl?: string;
    /** Public secure URL: /public/application/status/:token */
    publicPortalUrl?: string;
}

export const buildApplicationSentToUnderwritingClientEmailHtml = ({
    clientName,
    companyName,
    agentName,
    applicationNumber,
    viewApplicationUrl,
    publicPortalUrl,
}: Omit<ApplicationSentToUnderwritingClientEmailParams, 'to'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your business';
    const safeAgentName = agentName || 'your representative';
    const safeAppRef = applicationNumber != null && String(applicationNumber).trim() !== ''
        ? String(applicationNumber).trim()
        : null;
    const externalHref = (publicPortalUrl || '').trim();
    const internalFallback = withApplicationDetailsOverviewHref(viewApplicationUrl);
    const primaryHref = externalHref || internalFallback;
    const hasValidPortalLink = primaryHref !== '#' && primaryHref.length > 1;
    const isPublicTokenLink = Boolean(externalHref);

    const portalButtonBlock = hasValidPortalLink
        ? `<table border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="${primaryHref}" style="display: inline-block; padding: 12px 25px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">View your application</a>
                                                </td>
                                            </tr>
                                        </table>
                                        ${isPublicTokenLink
            ? `<p style="font-size: 12px; color: #777; margin: 8px 0 0 0;">No FinexusAI login required. This personal link expires after 90 days; do not forward to anyone you do not trust.</p>`
            : ''
        }`
        : `<p style="font-size: 13px; color: #777;">We could not generate a secure portal link. Please contact your representative for an updated link.</p>`;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Application Submitted</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">📩</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">APPLICATION SUBMITTED</div>
                                        <div style="font-size: 14px; opacity: 0.9;">Your application has been successfully submitted.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="120" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; font-weight: bold; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Contract</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funding Call</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            Great news! Your application for 
                                            <strong style="color: #0b71a9;">'${safeCompanyName}'</strong> 
                                            has been <strong>successfully submitted</strong>.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            Our underwriting team will begin reviewing your request shortly.${hasValidPortalLink
            ? ' Use the button below to view status, leave comments, and upload documents — the same secure experience we use for approvals.'
            : ''
        }
                                        </p>

                                        ${portalButtonBlock}

                                        <p style="font-size: 13px; color: #777; margin-top: 20px; line-height: 1.4;">
                                            Need help or have questions? Open the link above — you can leave a comment for your representative from that page.
                                        </p>
                                        
                                        <table border="0" cellpadding="0" cellspacing="0" style="margin-top: 10px;">
                                            <tr>
                                                <td align="center" bgcolor="#eeeeee" style="border-radius: 5px;">
                                                    <a href="${hasValidPortalLink ? primaryHref : '#'}" style="display: inline-block; padding: 10px 20px; color: #555555; font-size: 14px; font-weight: bold; text-decoration: none;">Write a comment</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`
};

export async function sendApplicationSentToUnderwritingClientEmail({
    to,
    clientName,
    companyName,
    agentName,
    applicationNumber,
    viewApplicationUrl,
    publicPortalUrl,
}: ApplicationSentToUnderwritingClientEmailParams): Promise<void> {
    if (DISABLE_CLIENT_APPLICATION_EMAILS) return;
    if (await shouldSkipWorkflowStepEmailForIsoRecipient(to, 'application-submitted')) return;

    const safeAppRef = applicationNumber != null && String(applicationNumber).trim() !== ''
        ? String(applicationNumber).trim()
        : '';
    const subject = safeAppRef
        ? `Your application #${safeAppRef} is with Underwriting`
        : 'Your application is with Underwriting';

    const html = buildApplicationSentToUnderwritingClientEmailHtml({
        clientName,
        companyName,
        agentName,
        applicationNumber,
        viewApplicationUrl,
        publicPortalUrl,
    });

    try {
        await sendMail({
            to,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Client sent-to-underwriting email send failed:', error);
    }
}

/** Client email when an Scrubbing forwards the application to Underwriter (initial underwriting complete). */
export interface ApplicationUnderwritingCompletedClientEmailParams {
    to: string;
    clientName?: string;
    companyName?: string;
    /** Optional CRM deep link */
    viewApplicationUrl?: string;
    /** Public secure URL: /public/application/status/:token */
    publicPortalUrl?: string;
    applicationNumber?: number | string;
}

export const buildApplicationUnderwritingCompletedClientEmailHtml = ({
    clientName,
    companyName,
    viewApplicationUrl,
    publicPortalUrl,
}: Omit<ApplicationUnderwritingCompletedClientEmailParams, 'to' | 'applicationNumber'>): string => {
    const safeClientName = clientName || 'Valued Client';
    const safeCompanyName = companyName || 'your business';
    const externalHref = (publicPortalUrl || '').trim();
    const internalFallback = withApplicationDetailsOverviewHref(viewApplicationUrl);
    const primaryHref = externalHref || internalFallback;
    const hasValidPortalLink = primaryHref !== '#' && primaryHref.length > 1;

    const statusButtonBlock = hasValidPortalLink
        ? `<table border="0" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                                            <tr>
                                                <td align="center" bgcolor="#3b7ab0" style="border-radius: 5px;">
                                                    <a href="${primaryHref}" style="display: inline-block; padding: 12px 25px; color: #ffffff; font-size: 16px; font-weight: bold; text-decoration: none;">View Review Status</a>
                                                </td>
                                            </tr>
                                        </table>`
        : `<p style="font-size: 13px; color: #777;">We could not generate a secure portal link. Please contact your representative for an updated link.</p>`;

    return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>Underwriting Completed</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f9; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background-color: #ffffff; border: 1px solid #dddddd;">
                    
                    ${buildBrandHeaderRowHtml()}

                    <tr>
                        <td style="padding: 0 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(to right, #3b7ab0, #1a4a7c); background-color: #1a4a7c; border-radius: 8px;">
                                <tr>
                                    <td width="100" align="center" style="padding: 30px 0 30px 20px;">
                                        <div style="width: 70px; height: 70px; border: 2px solid #ffffff; border-radius: 50%; line-height: 70px; text-align: center; font-size: 35px; color: #ffffff;">✅</div>
                                    </td>
                                    <td style="padding: 30px 20px; color: #ffffff;">
                                        <div style="font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 5px;">UNDERWRITING COMPLETED</div>
                                        <div style="font-size: 14px; opacity: 0.9;">Great news! The initial underwriting review is finished.</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 30px 20px;">
                            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                    <td width="120" valign="top" align="center">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; line-height: 1.2;">Application<br/>Submitted</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2.5px dotted #0b71a9; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #0b71a9; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">✓</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #333; font-weight: bold;">Underwriting</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Approved</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Contract</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funding Call</td></tr>
                                            <tr><td align="center" style="padding: 2px 0;"><div style="width: 0px; border-left: 2px dotted #cccccc; height: 30px;"></div></td></tr>

                                            <tr><td align="center"><div style="width: 35px; height: 35px; background: #cccccc; border-radius: 50%; color: #ffffff; line-height: 35px; font-size: 18px;">X</div></td></tr>
                                            <tr><td align="center" style="font-size: 11px; padding: 5px 0; color: #888;">Funded</td></tr>
                                        </table>
                                    </td>

                                    <td valign="top" style="padding-left: 25px;">
                                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #444;">Hi ${safeClientName}!</p>
                                        
                                        <p style="font-size: 15px; color: #666; line-height: 1.5;">
                                            We are happy to inform you that our underwriters have finished 
                                            analyzing your application for <strong style="color: #0b71a9;">'${safeCompanyName}'</strong>.
                                        </p>

                                        <p style="font-size: 14px; color: #666; line-height: 1.5;">
                                            The review stage is now complete. Your application is being prepared for the <strong>Approval</strong> stage. Please check your dashboard to see if any specific conditions or additional documents are needed to finalize the offer.
                                        </p>

                                        ${statusButtonBlock}

                                        <p style="font-size: 13px; color: #777; margin-top: 20px; line-height: 1.4;">
                                            Our team will reach out shortly if further clarification is required. You can also leave a direct comment for the scrubbing below.
                                        </p>
                                        
                                        <table border="0" cellpadding="0" cellspacing="0" style="margin-top: 10px;">
                                            <tr>
                                                <td align="center" bgcolor="#eeeeee" style="border-radius: 5px;">
                                                    <a href="${hasValidPortalLink ? primaryHref : '#'}" style="display: inline-block; padding: 10px 20px; color: #555555; font-size: 14px; font-weight: bold; text-decoration: none;">Write a Comment</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
};

export async function sendApplicationUnderwritingCompletedClientEmail({
    to,
    clientName,
    companyName,
    viewApplicationUrl,
    publicPortalUrl,
    applicationNumber,
}: ApplicationUnderwritingCompletedClientEmailParams): Promise<void> {
    if (DISABLE_CLIENT_APPLICATION_EMAILS) return;
    if (await shouldSkipWorkflowStepEmailForIsoRecipient(to, 'underwriting-completed')) return;

    const safeAppRef =
        applicationNumber != null && String(applicationNumber).trim() !== ''
            ? String(applicationNumber).trim()
            : '';
    const subject = safeAppRef
        ? `Application #${safeAppRef}: underwriting complete — next step is approval`
        : 'Your application: underwriting complete';

    const html = buildApplicationUnderwritingCompletedClientEmailHtml({
        clientName,
        companyName,
        viewApplicationUrl,
        publicPortalUrl,
    });

    try {
        await sendMail({
            to,
            subject,
            html,
            attachments: buildBrandLogoAttachments(),
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Client underwriting-completed email send failed:', error);
    }
}

export interface UnderwriterNewApplicationEmailParams {
    to: string;
    underwriterName?: string;
    agentName: string;
    applicationNumber?: number | string;
    clientName?: string;
    viewApplicationUrl?: string;
}

export async function sendUnderwriterNewApplicationEmail({
    to,
    underwriterName,
    agentName,
    applicationNumber,
    clientName,
    viewApplicationUrl,
}: UnderwriterNewApplicationEmailParams): Promise<void> {
    const safeUnderwriterName = underwriterName || to;
    const safeAgentName = agentName || 'Agent';
    const safeClientName = clientName || 'Client';
    const safeApplicationNumber = applicationNumber ? String(applicationNumber) : '';

    const subject = `New application${safeApplicationNumber ? ` #${safeApplicationNumber}` : ''} sent to Underwriting`;

    const buttonHtml = viewApplicationUrl
        ? `<p style="margin:24px 0;">
        <a href="${viewApplicationUrl}"
           style="display:inline-block; padding:12px 18px; background-color:#1E88E5; color:#ffffff; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:600; border-radius:6px;">
          View application
        </a>
      </p>`
        : '';

    const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; color:#111827; line-height:1.5;">
      <h2 style="margin:0 0 12px 0;">Hi ${safeUnderwriterName},</h2>
      <p style="margin:0 0 10px 0;">
        <strong>${safeAgentName}</strong> sent a new application${safeApplicationNumber ? ` <strong>#${safeApplicationNumber}</strong>` : ''} to <strong>Underwriting</strong>.
      </p>
      <p style="margin:0 0 10px 0;">
        Client: <strong>${safeClientName}</strong>
      </p>
      ${buttonHtml}
      <p style="margin:18px 0 0 0; font-size:12px; color:#6B7280;">
        This is an automated notification from In-House CRM.
      </p>
    </div>
  `;

    try {
        await sendMail(to, subject, html);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Scrubbing new application email send failed:', error);
    }
}

/** Hostname (+ port) only, `www.` stripped — for detecting duplicate primary vs katan hosted link. */
function decisionLogicInvitationHostKey(raw: string): string | null {
    const t = String(raw || '').trim();
    if (!t || t.startsWith('(')) return null;
    try {
        const url = /^https?:/i.test(t) ? new URL(t) : new URL(`https://${t}`);
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        const port =
            url.port && url.port !== '80' && url.port !== '443'
                ? `:${url.port}`
                : '';
        return `${host}${port}`;
    } catch {
        return null;
    }
}

export function buildDecisionLogicEmailHtml({
    verificationUrl,
    alternateVerificationUrl,
    showAlternateLink = false,
}: {
    verificationUrl: string;
    alternateVerificationUrl?: string;
    showAlternateLink?: boolean;
}): string {
    const safeUrl = String(verificationUrl || '').trim();
    const safeAlternateUrl = String(alternateVerificationUrl || '').trim();
    const alternateBlock =
        showAlternateLink && safeAlternateUrl && safeAlternateUrl !== safeUrl
            ? `
                            <p style="margin: 16px 0 0; font-size:12px; color:#6b7280; line-height:1.5;">
                                Alternate link:
                                <a href="${safeAlternateUrl}" style="color:#276D9C; word-break:break-all;">${safeAlternateUrl}</a>
                            </p>`
            : '';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Bank Verification</title>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin:0; padding:0; background:#f4f7f9; font-family: Arial, Helvetica, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border:1px solid #e5e7eb;">
                    ${buildBrandHeaderRowHtml()}
                    <tr>
                        <td style="padding: 20px 24px 8px;">
                            <h2 style="margin:0; color:#111827; font-size:22px;">Bank Verification</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 20px; color:#374151; font-size:14px; line-height:1.6;">
                            <p style="margin: 0 0 12px;">Hello,</p>
                            <p style="margin: 0 0 12px;">
                                You have been invited to complete secure bank verification for your application with <strong>${DEFAULT_BRAND_NAME}</strong>.
                            </p>
                            <p style="margin: 0 0 12px;">
                                Use the button below to connect your financial institution through Decision Logic. The process is encrypted.
                            </p>
                            <p style="margin: 20px 0 0; text-align:center;">
                                <a href="${safeUrl}" style="display:inline-block; background:#276D9C; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:12px 24px; border-radius:6px;">Complete bank verification</a>
                            </p>
                            <p style="margin: 20px 0 0; font-size:12px; color:#6b7280; line-height:1.5;">
                                If the button does not work, copy and paste this URL into your browser:
                                <br/>
                                <a href="${safeUrl}" style="color:#276D9C; word-break:break-all;">${safeUrl}</a>
                            </p>
                            ${alternateBlock}
                            <p style="margin: 20px 0 0; font-size:12px; color:#6b7280; line-height:1.5;">
                                This link is unique to you and may expire. If it has expired, please contact your underwriter for a new invitation.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export async function sendDecisionLogicEmail(
    to: string,
    token: string,
): Promise<void> {
    if (!isOutboundSmtpConfigured()) {
        throw new Error(
            'Decision Logic invitation email cannot be sent: outbound mail is not configured. ' +
                'Set SENDGRID_API_KEY (recommended: SendGrid SMTP via smtp.sendgrid.net, user "apikey") ' +
                'or SMTP_AUTH_USER + SMTP_AUTH_PASS. Also set a verified From address: SMTP_FROM, MAIL_FROM, ' +
                'SENDGRID_FROM_EMAIL, or SENDGRID_AUTH_USER.',
        );
    }

    const hostedOrigin = String(
        process.env.katan_HOSTED_ORIGIN ||
            process.env.DECISION_LOGIC_HOSTED_FALLBACK_ORIGIN ||
            'https://katan.finexusai.com',

    )
        .trim()
        .replace(/\/$/, '');
    const base =
        resolveDecisionLogicInvitationBaseUrl() ||
        resolveCrmFrontendBaseUrl()?.replace(/\/$/, '') ||
        '';
    const link = base
        ? `${base}/decision-logic?token=${encodeURIComponent(token)}`
        : `(configure a frontend base URL in env) token=${encodeURIComponent(token)}`;
    const hostedLink = `${hostedOrigin}/decision-logic?token=${encodeURIComponent(token)}`;
    const primaryHost = decisionLogicInvitationHostKey(base);
    const hostedHost = decisionLogicInvitationHostKey(hostedOrigin);
    const primaryIsHosted =
        primaryHost != null &&
        hostedHost != null &&
        primaryHost === hostedHost;
    const subject = `Bank verification — ${DEFAULT_BRAND_NAME}`;
    const html = buildDecisionLogicEmailHtml({
        verificationUrl: link,
        alternateVerificationUrl: hostedLink,
        showAlternateLink: !primaryIsHosted,
    });
    await sendMail({
        to,
        subject,
        html,
        attachments: buildBrandLogoAttachments(),
    });
}

export {
    DOCUMENT_REQUEST_LABELS,
    humanizeDocumentRequestLabels,
} from '../constants/documentRequestTypes';

function humanizeSendGridErrorMessage(error: unknown): string {
    const raw =
        (error as { message?: string })?.message ||
        (error as { response?: string })?.response ||
        String(error || 'Unknown email error');
    if (/maximum credits exceeded/i.test(raw) || /\b451\b/.test(raw)) {
        return 'SendGrid account has exceeded its email credits. Add credits in your SendGrid billing settings and try again.';
    }
    return raw;
}

export interface SendDocumentRequestEmailParams {
    to: string[];
    cc?: string[];
    isoName?: string;
    clientName: string;
    applicationNumber: string | number;
    requestedDocumentLabels: string[];
    requestAdditional?: boolean;
    note?: string;
    viewApplicationUrl?: string;
    /** Pre-rendered HTML from the CRM frontend template. */
    html?: string;
    subject?: string;
    /** SendGrid webhook correlation id (`ocid` custom arg). */
    trackingId?: string;
}

/** Replaced with the public upload portal URL before SendGrid send. */
const DOCUMENT_REQUEST_UPLOAD_URL_PLACEHOLDER = '__DOCUMENT_REQUEST_UPLOAD_URL__';

function injectDocumentRequestUploadUrl(html: string, uploadUrl: string | undefined): string {
    const safeUrl = String(uploadUrl || '').trim();
    if (!safeUrl) return html;
    return html.split(DOCUMENT_REQUEST_UPLOAD_URL_PLACEHOLDER).join(safeUrl);
}

export function buildDocumentRequestEmailHtml({
    isoName,
    clientName,
    applicationNumber,
    requestedDocumentLabels,
    requestAdditional,
    note,
    viewApplicationUrl,
}: Omit<SendDocumentRequestEmailParams, 'to' | 'cc'>): string {
    const safeIsoName = String(isoName || '').trim() || 'ISO Partner';
    const safeClientName = String(clientName || '').trim() || 'Client';
    const safeAppNumber = String(applicationNumber || '').trim() || 'N/A';
    const applicationHref =
        viewApplicationUrl &&
        (/\/documents(?:\/[^/?#]+)?$/i.test(viewApplicationUrl.trim()) ||
            /\/public\/application\/documents\//i.test(viewApplicationUrl.trim()))
            ? viewApplicationUrl.trim()
            : withApplicationDetailsOverviewHref(viewApplicationUrl);

    const docItems = [...(requestedDocumentLabels || [])];
    if (requestAdditional) {
        docItems.push('Additional documents (as discussed)');
    }
    const docListHtml =
        docItems.length > 0
            ? `<ul style="margin:12px 0; padding-left:20px; color:#374151; font-size:14px; line-height:1.6;">
                ${docItems.map((label) => `<li style="margin-bottom:6px;">${label}</li>`).join('')}
               </ul>`
            : `<p style="margin:12px 0; color:#374151; font-size:14px;">Additional documents are required for this application.</p>`;

    const noteBlock =
        note && String(note).trim()
            ? `<p style="margin:16px 0 0; padding:12px 14px; background:#f9fafb; border-left:3px solid #276D9C; color:#374151; font-size:14px; line-height:1.6;"><strong>Note from underwriting:</strong><br/>${String(note).trim().replace(/\n/g, '<br/>')}</p>`
            : '';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Document Request</title>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin:0; padding:0; background:#f4f7f9; font-family: Arial, Helvetica, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border:1px solid #e5e7eb;">
                    ${buildBrandHeaderRowHtml()}
                    <tr>
                        <td style="padding: 20px 24px 8px;">
                            <h2 style="margin:0; color:#111827; font-size:22px;">Document Request</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 20px; color:#374151; font-size:14px; line-height:1.6;">
                            <p style="margin: 0 0 12px;">Hi ${safeIsoName},</p>
                            <p style="margin: 0 0 12px;">
                                We need additional documents for <strong>${safeClientName}</strong> (Application <strong>#${safeAppNumber}</strong>).
                            </p>
                            <p style="margin: 0 0 4px; font-weight:600; color:#111827;">Requested documents:</p>
                            ${docListHtml}
                            ${noteBlock}
                            <p style="margin: 20px 0 0; text-align:center;">
                                <a href="${applicationHref}" style="display:inline-block; background:#276D9C; color:#ffffff; text-decoration:none; font-weight:600; font-size:14px; padding:12px 24px; border-radius:6px;">Upload requested documents</a>
                            </p>
                            <p style="margin: 20px 0 0; font-size:12px; color:#6b7280; line-height:1.5;">
                                Open the link above to upload each requested document. No login is required.
                                Underwriting will be notified automatically when files are received.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export const DOCUMENT_REQUEST_EMAIL_PDF_FILENAME = 'Document-request-template.pdf';

/** Send ISO document-request email via SendGrid SMTP only. */
export async function sendDocumentRequestEmail(
    params: SendDocumentRequestEmailParams,
): Promise<{ sent: boolean; error?: string; sgMessageId?: string }> {
    const toList = (params.to || []).map((e) => String(e || '').trim()).filter(Boolean);
    if (!toList.length) {
        return { sent: false, error: 'No recipient email addresses provided.' };
    }

    const ccList = (params.cc || []).map((e) => String(e || '').trim()).filter(Boolean);
    const subject =
        String(params.subject || '').trim() ||
        (() => {
            const num = String(params.applicationNumber || '').trim() || 'N/A';
            const client = String(params.clientName || '').trim();
            const parts = [`Document request — Application #${num}`];
            if (client) parts.push(client);
            return parts.join(' — ');
        })();
    const html = params.html?.trim()
        ? injectDocumentRequestUploadUrl(params.html.trim(), params.viewApplicationUrl)
        : buildDocumentRequestEmailHtml(params);

    try {
        const attachments = buildIsoBrandedEmailAttachments();
        const result = await sendSendGridMail({
            to: toList,
            cc: ccList.length ? ccList : undefined,
            subject,
            html,
            trackingId: params.trackingId,
            categories: params.trackingId ? ['document-request'] : undefined,
            attachments,
        });
        const sgMessageId =
            typeof (result as { messageId?: string })?.messageId === 'string'
                ? (result as { messageId: string }).messageId
                : undefined;
        return { sent: true, sgMessageId };
    } catch (error) {
        const errorMessage = humanizeSendGridErrorMessage(error);
        // eslint-disable-next-line no-console
        console.error('[email] Document request email send failed:', { to: toList, error });
        return { sent: false, error: errorMessage };
    }
}

