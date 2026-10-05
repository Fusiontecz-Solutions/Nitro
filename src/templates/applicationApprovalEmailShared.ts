/** Mirrors `woodmere-inhouse-fe/src/pages/templates/applicationApprovalEmailShared.ts`. */
import { APPLICATION_APPROVAL_URL_PLACEHOLDER } from './applicationApprovalEmailPlaceholders';
import { BRAND_EMAIL_LOGO_SRC } from '../constants/brand';

export const APP_COMPANY_NAME = 'Nitro Advance';
export const APP_COMPANY_CRM_NAME = 'Nitro Advance';

export const APPLICATION_APPROVAL_EMAIL_LOGO_SRC = BRAND_EMAIL_LOGO_SRC;

export const APPLICATION_APPROVAL_EMAIL_WATERMARK_SRC = BRAND_EMAIL_LOGO_SRC;

/**
 * Body background watermark for the approval / offer-updated emails. Email clients
 * ignore CSS opacity on background images, so this only renders when a hosted,
 * pre-faded asset is configured via `BRAND_EMAIL_WATERMARK_URL`.
 */
export const APPLICATION_APPROVAL_EMAIL_BG_WATERMARK_SRC = String(
    process.env.BRAND_EMAIL_WATERMARK_URL ?? '',
).trim();

export const CLIENT_PROVIDED_STIPS = ['Void Check', "Driver's License", 'Merchant Interview'] as const;

export const COMPANY_HANDLED_STIPS = [
    'Decision Logic/Bank Login',
    'Recent Bank Statements',
] as const;

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Encode a URL for use in an HTML href attribute (preserves the merge-field placeholder). */
export function escapeHrefAttribute(url: string): string {
    if (url === APPLICATION_APPROVAL_URL_PLACEHOLDER) {
        return url;
    }
    return escapeHtml(url);
}

export type ApplicationApprovalEmailFields = {
    clientName: string;
    companyName: string;
    /** Public ISO approval portal — single link for approval + offer-updated CTAs. */
    isoApprovalUrl: string;
    viewApplicationUrl: string;
    calculateApprovalUrl: string;
    viewCommentUrl: string;
    companyNameBrand: string;
    crmName: string;
};

/** One canonical public approval link for both email templates. */
export function resolveIsoApprovalUrl(values: Record<string, string | undefined>): string {
    return (
        String(values.calculate_approval_url || values.view_application_url || '').trim() ||
        APPLICATION_APPROVAL_URL_PLACEHOLDER
    );
}

export function resolveApplicationApprovalEmailFields(
    values: Record<string, string | undefined>,
): ApplicationApprovalEmailFields {
    const clientName = String(values.client_name || '').trim() || 'Valued Client';
    const companyName = String(values.company_name || '').trim() || 'your company';
    const isoApprovalUrl = resolveIsoApprovalUrl(values);

    return {
        clientName,
        companyName,
        isoApprovalUrl,
        viewApplicationUrl: isoApprovalUrl,
        calculateApprovalUrl: isoApprovalUrl,
        viewCommentUrl: isoApprovalUrl,
        companyNameBrand: APP_COMPANY_NAME,
        crmName: APP_COMPANY_CRM_NAME,
    };
}
