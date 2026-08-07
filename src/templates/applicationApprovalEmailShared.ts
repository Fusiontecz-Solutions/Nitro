/** Mirrors `woodmere-inhouse-fe/src/pages/templates/applicationApprovalEmailShared.ts`. */
import { APPLICATION_APPROVAL_URL_PLACEHOLDER } from './applicationApprovalEmailPlaceholders';

export const APP_COMPANY_NAME = 'Harbor View Capital';
export const APP_COMPANY_CRM_NAME = 'Harbor View Capital';

export const APPLICATION_APPROVAL_EMAIL_LOGO_SRC =
    'https://res.cloudinary.com/dehrku8og/image/upload/v1786111779/ChatGPT_Image_Aug_7_2026_07_39_08_PM_zri2ha.png';

export const APPLICATION_APPROVAL_EMAIL_WATERMARK_SRC =
    'https://res.cloudinary.com/dehrku8og/image/upload/v1786111779/ChatGPT_Image_Aug_7_2026_07_39_08_PM_zri2ha.png';

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
