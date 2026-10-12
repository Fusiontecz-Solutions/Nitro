/**
 * Staff External Comment → email the linked ISO with the comment body and a
 * "Reply in portal" CTA to the public status/comments page. ISO replies posted
 * there come back as `ISO Comment` rows on the deal.
 *
 * Sent through Gmail on the deal's ISO thread (same conversation as the approval /
 * offer / decline emails), so the ISO sees staff replies in one chain.
 */
import prisma from '../config/prismaClient';
import sendMail, { isOutboundMailConfigured } from '../config/nodemailer';
import { BRAND_EMAIL_LOGO_SRC, buildBrandLogoAttachments } from '../constants/brand';
import { resolveEmailBrandDisplayName } from '../constants/emailBrand';
import { resolvePublicApplicationStatusPortalUrl } from './publicApplicationStatusPortalUrlService';

function escapeHtml(value: string): string {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildExternalCommentIsoEmailHtml(params: {
    brandName: string;
    /** Inline CID logo (sent as an attachment alongside the message). */
    logoSrc?: string;
    businessName: string;
    actorName: string;
    commentBody: string;
    portalUrl?: string;
}): string {
    const { brandName, logoSrc, businessName, actorName, commentBody, portalUrl } = params;
    const logoBlock = logoSrc
        ? `<p style="margin:0 0 20px;">
            <img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(brandName)}" width="140"
                 style="display:block;width:140px;max-width:140px;height:auto;border:0;outline:none;" />
          </p>`
        : '';
    const cta = portalUrl
        ? `<p style="margin:24px 0 8px;">
            <a href="${escapeHtml(portalUrl)}"
               style="display:inline-block;background:#1E4FA3;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">
              Reply in portal
            </a>
          </p>
          <p style="margin:0 0 16px;font-size:12px;color:#6b7280;">
            Or open: <a href="${escapeHtml(portalUrl)}" style="color:#1E4FA3;">${escapeHtml(portalUrl)}</a>
          </p>`
        : '';

    return `
<div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#1f2937;max-width:640px;">
  ${logoBlock}
  <p style="margin:0 0 16px;">Hi Team,</p>
  <p style="margin:0 0 12px;">
    ${escapeHtml(actorName)} from <strong>${escapeHtml(brandName)}</strong> shared a comment${businessName ? ` on the application for <strong>${escapeHtml(businessName)}</strong>` : ' on your application'}.
  </p>
  <div style="margin:16px 0;padding:14px 16px;border-left:4px solid #1E4FA3;background:#f3f4f6;border-radius:4px;white-space:pre-wrap;">
${escapeHtml(commentBody)}
  </div>
  ${cta}
  <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
    Please reply from the portal so your response appears on the deal in our system.
  </p>
  <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">— ${escapeHtml(brandName)}</p>
</div>`.trim();
}

export type ExternalCommentIsoMailResult = {
    sent: boolean;
    via?: 'gmail' | 'smtp';
    to?: string;
    skippedReason?: string;
};

/**
 * Notify the linked ISO about a new staff External Comment.
 * Safe to fire-and-forget from comment create (errors are logged, never thrown).
 */
export async function sendExternalCommentToIsoEmail(params: {
    applicationId: string;
    commentBody: string;
    actorName?: string | null;
    /** Staff user who wrote the comment (their Gmail starts the thread if none exists yet). */
    actorUserId?: string | null;
}): Promise<ExternalCommentIsoMailResult> {
    const applicationId = String(params.applicationId || '').trim();
    const commentBody = String(params.commentBody || '').trim();
    if (!applicationId || !commentBody) {
        return { sent: false, skippedReason: 'missing-application-or-body' };
    }

    try {
        const application = await prisma.application.findUnique({
            where: { id: applicationId },
            select: {
                id: true,
                iso: { select: { email: true } },
                client: { select: { businessName: true, ownerFirstName: true, ownerLastName: true } },
            },
        });
        if (!application) return { sent: false, skippedReason: 'application-not-found' };

        const isoEmail = String(application.iso?.email || '').trim();
        if (!isoEmail) return { sent: false, skippedReason: 'no-iso-email' };

        const brandName = resolveEmailBrandDisplayName();
        const businessName =
            String(application.client?.businessName || '').trim() ||
            `${application.client?.ownerFirstName || ''} ${application.client?.ownerLastName || ''}`.trim();
        const actorName = String(params.actorName || '').trim() || 'Our team';
        const portalUrl = await resolvePublicApplicationStatusPortalUrl(application.id).catch((err) => {
            console.error('[external-comment-iso-mail] portal URL failed:', err);
            return undefined;
        });
        const subject = `${brandName}: New comment${businessName ? ` for ${businessName}` : ''}`;
        const htmlParams = { brandName, businessName, actorName, commentBody, portalUrl };

        if (!isOutboundMailConfigured()) {
            console.warn('[external-comment-iso-mail] no mail transport configured', applicationId);
            return { sent: false, skippedReason: 'no-mail-transport' };
        }

        const result = await sendMail({
            to: isoEmail,
            subject,
            html: buildExternalCommentIsoEmailHtml({ ...htmlParams, logoSrc: BRAND_EMAIL_LOGO_SRC }),
            attachments: buildBrandLogoAttachments(),
            threadApplicationId: application.id,
            threadSenderUserId: params.actorUserId ?? null,
        });
        return { sent: true, via: result.gmailMessageId ? 'gmail' : 'smtp', to: isoEmail };
    } catch (error) {
        console.error('[external-comment-iso-mail] send failed:', applicationId, error);
        return { sent: false, skippedReason: 'send-failed' };
    }
}
