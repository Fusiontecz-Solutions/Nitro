import fs from 'fs';
import nodemailer from 'nodemailer';
import { resolveEmailBrandDisplayName } from '../constants/emailBrand';
import { rewriteBrandLogoUrlsForEmail } from '../constants/brand';

const sendgridApiKey = process.env.SENDGRID_API_KEY?.trim();
const useSendgrid = Boolean(sendgridApiKey);

/**
 * SendGrid open tracking for tracked mail (default ON). Set SENDGRID_TRACK_OPEN_PIXEL=false to disable.
 */
export function isSendGridOpenPixelTrackingEnabled(): boolean {
    return String(process.env.SENDGRID_TRACK_OPEN_PIXEL ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
}

/** Link click tracking — on by default for tracked mail. */
export function isSendGridClickTrackingEnabled(): boolean {
    return String(process.env.SENDGRID_TRACK_CLICKS ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
}

/** @deprecated Use isSendGridOpenPixelTrackingEnabled / isSendGridClickTrackingEnabled */
export function isSendGridEngagementTrackingEnabled(): boolean {
    return isSendGridOpenPixelTrackingEnabled() || isSendGridClickTrackingEnabled();
}

/** True when `SENDGRID_API_KEY` is set (payment letters require this). */
export function isSendGridConfigured(): boolean {
    return Boolean(sendgridApiKey);
}

/** True when SendGrid API key or classic Gmail SMTP user+pass is configured. */
export function isOutboundSmtpConfigured(): boolean {
    if (sendgridApiKey) return true;
    return Boolean(
        process.env.SMTP_AUTH_USER?.trim() && process.env.SMTP_AUTH_PASS?.trim(),
    );
}

/** Display name for outbound SMTP / SendGrid (read at send time, not module load). */
function getMailFromDisplayName(): string {
    return resolveEmailBrandDisplayName();
}
/** Strip optional `"Name"` wrapper and extract the bare email from a From value. */
function extractEmailAddress(raw: string): string {
    const trimmed = raw.trim();
    const angle = trimmed.match(/<([^>]+)>/);
    if (angle?.[1]) return angle[1].trim();
    return trimmed;
}

function resolveVerifiedFromEmail(): string | undefined {
    return (
        process.env.SMTP_FROM?.trim() ||
        process.env.MAIL_FROM?.trim() ||
        process.env.SENDGRID_FROM_EMAIL?.trim() ||
        process.env.SENDGRID_AUTH_USER?.trim() ||
        process.env.SMTP_AUTH_USER?.trim()
    );
}

/** Nodemailer + SendGrid: object `from` is more reliable than a formatted string. */
export function buildMailFrom(optionalRaw?: string): { name: string; address: string } {
    const raw = optionalRaw?.trim() || resolveVerifiedFromEmail();
    if (!raw) {
        if (sendgridApiKey) {
            throw new Error(
                'SendGrid is configured but no verified From email is set. Add SENDGRID_FROM_EMAIL or SENDGRID_AUTH_USER to .env.',
            );
        }
        throw new Error(
            'Outbound email is not configured. Set SENDGRID_FROM_EMAIL (or SENDGRID_API_KEY + verified sender).',
        );
    }
    return {
        name: getMailFromDisplayName(),
        address: extractEmailAddress(raw),
    };
}

function formatMailFromAddress(emailOrFrom: string): string {
    const { name, address } = buildMailFrom(emailOrFrom);
    return `"${name}" <${address}>`;
}

/** From address for SendGrid-only sends (verified sender in SendGrid). */
export function getSendGridMailFrom(): string {
    const { name, address } = buildMailFrom(
        process.env.SENDGRID_FROM_EMAIL?.trim() ||
            process.env.SENDGRID_AUTH_USER?.trim(),
    );
    return `"${name}" <${address}>`;
}

function createSendGridTransporter() {
    const port = Number(process.env.SENDGRID_SMTP_PORT) || 587;
    return nodemailer.createTransport({
        host: process.env.SENDGRID_SMTP_HOST?.trim() || 'smtp.sendgrid.net',
        port,
        secure: port === 465,
        auth: {
            user: 'apikey',
            pass: sendgridApiKey,
        },
    });
}

/**
 * Default From header. SendGrid requires a verified sender; use SMTP_FROM,
 * MAIL_FROM, SENDGRID_FROM_EMAIL, or SENDGRID_AUTH_USER (verified address).
 * Display name defaults to Nitro Advance (override with MAIL_FROM_NAME or SENDGRID_FROM_NAME).
 */
export function getDefaultMailFrom(): string {
    const { name, address } = buildMailFrom();
    return `"${name}" <${address}>`;
}

function createTransporter() {
    if (useSendgrid) {
        return createSendGridTransporter();
    }

    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        service: 'gmail',
        port: 587,
        secure: false,
        auth: {
            user: process.env.SMTP_AUTH_USER,
            pass: process.env.SMTP_AUTH_PASS,
        },
    });
}

const transporter = createTransporter();

interface SendMailOptions {
    to: string | string[];
    subject: string;
    html: string;
    from?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    /** RFC 2822 `In-Reply-To` for email threading. */
    inReplyTo?: string;
    /** RFC 2822 `References` for email threading. */
    references?: string;
    attachments?: Array<{
        filename?: string | false;
        content?: Buffer | string;
        path?: string;
        cid?: string;
        contentType?: string;
        contentDisposition?: 'inline' | 'attachment';
    }>;
    /**
     * Correlation id echoed back by the SendGrid Event Webhook as the custom
     * arg `ocid`. Pass the OutboundCommunication id here so delivery / bounce
     * events can be matched back to the originating mail-log row.
     * Delivery, open, and click tracking are enabled for tracked mail.
     */
    trackingId?: string;
    /** Override open tracking (default ON when `trackingId` is set). */
    enableOpenTracking?: boolean;
    /** Override link click tracking (default ON when `trackingId` is set). */
    enableClickTracking?: boolean;
    /** Optional SendGrid categories for analytics/filtering. */
    categories?: string[];
}

/**
 * Build the `X-SMTPAPI` header value SendGrid reads for SMTP relay.
 *
 * - `unique_args.ocid` is surfaced on every Event Webhook record so we can map
 *   an event back to its OutboundCommunication row.
 * - `filters.opentrack` / `filters.clicktrack` enable per-message open/click
 *   tracking independent of account-wide settings.
 */
function buildSendGridSmtpApiHeader(opts: {
    trackingId?: string;
    enableOpenTracking?: boolean;
    enableClickTracking?: boolean;
    categories?: string[];
}): string | undefined {
    const trackingId = opts.trackingId?.trim();
    const wantsTracking = Boolean(trackingId);
    const openTracking =
        opts.enableOpenTracking ??
        (wantsTracking && isSendGridOpenPixelTrackingEnabled());
    const clickTracking =
        opts.enableClickTracking ?? (wantsTracking && isSendGridClickTrackingEnabled());
    const categories = (opts.categories ?? []).filter(Boolean);

    if (!trackingId && !openTracking && !clickTracking && categories.length === 0) {
        return undefined;
    }

    const payload: Record<string, unknown> = {};
    if (trackingId) {
        payload.unique_args = { ocid: trackingId };
    }
    if (categories.length) {
        payload.category = categories;
    }

    const filters: Record<string, unknown> = {};
    if (openTracking) {
        filters.opentrack = { settings: { enable: 1 } };
    }
    if (clickTracking) {
        filters.clicktrack = { settings: { enable: 1, enable_text: 1 } };
    }
    if (Object.keys(filters).length) {
        payload.filters = filters;
    }

    return JSON.stringify(payload);
}

export type SendMailResult = {
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
};

function normalizeRecipients(to: string | string[]): Array<{ email: string }> {
    const list = Array.isArray(to) ? to : [to];
    return list
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
        .map((email) => ({ email }));
}

function listRecipientEmails(value?: string | string[]): string[] {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map((entry) => String(entry || '').trim()).filter(Boolean);
}

/** SendGrid HTTP API is used for tracked mail; multi-To / CC / BCC are more reliable via SMTP relay. */
function shouldUseSendGridHttpApi(options: SendMailOptions): boolean {
    if (!useSendgrid || !options.trackingId?.trim()) return false;
    const hasCc = listRecipientEmails(options.cc).length > 0;
    const hasBcc = listRecipientEmails(options.bcc).length > 0;
    const toCount = listRecipientEmails(options.to).length;
    return !hasCc && !hasBcc && toCount <= 1;
}

function toSendGridApiAttachments(
    attachments?: SendMailOptions['attachments'],
): Array<{
    content: string;
    type: string;
    filename: string;
    disposition: 'inline' | 'attachment';
    content_id?: string;
}> {
    if (!attachments?.length) return [];
    const out: Array<{
        content: string;
        type: string;
        filename: string;
        disposition: 'inline' | 'attachment';
        content_id?: string;
    }> = [];

    for (const attachment of attachments) {
        let buffer: Buffer | null = null;
        if (attachment.content) {
            buffer = Buffer.isBuffer(attachment.content)
                ? attachment.content
                : Buffer.from(String(attachment.content));
        } else if (attachment.path && fs.existsSync(attachment.path)) {
            buffer = fs.readFileSync(attachment.path);
        }
        if (!buffer) continue;

        const filename =
            (typeof attachment.filename === 'string' && attachment.filename) ||
            (attachment.path ? attachment.path.split(/[/\\]/).pop() || 'attachment' : 'attachment');

        out.push({
            content: buffer.toString('base64'),
            type: attachment.contentType || 'application/octet-stream',
            filename,
            disposition: attachment.contentDisposition === 'inline' ? 'inline' : 'attachment',
            ...(attachment.cid ? { content_id: attachment.cid } : {}),
        });
    }
    return out;
}

/**
 * Send via SendGrid Mail Send HTTP API (v3). Unlike SMTP + X-SMTPAPI, `custom_args`
 * reliably appear on Event Webhook payloads as top-level `ocid`.
 */
function buildThreadingHeaders(options: Pick<SendMailOptions, 'inReplyTo' | 'references'>): Record<string, string> | undefined {
    const headers: Record<string, string> = {};
    const inReplyTo = String(options.inReplyTo || '').trim();
    const references = String(options.references || '').trim();
    if (inReplyTo) headers['In-Reply-To'] = inReplyTo;
    if (references) headers.References = references;
    return Object.keys(headers).length ? headers : undefined;
}

async function sendViaSendGridHttpApi(options: SendMailOptions): Promise<SendMailResult> {
    if (!sendgridApiKey) {
        throw new Error('SendGrid API key is not configured');
    }

    const {
        to,
        subject,
        html,
        from,
        cc,
        bcc,
        replyTo,
        attachments,
        trackingId,
        enableOpenTracking,
        enableClickTracking,
        categories,
        inReplyTo,
        references,
    } = options;

    const threadingHeaders = buildThreadingHeaders({ inReplyTo, references });
    const fromAddr = buildMailFrom(from);
    const wantsTracking = Boolean(trackingId?.trim());
    const openTracking =
        enableOpenTracking ?? (wantsTracking && isSendGridOpenPixelTrackingEnabled());
    const clickTracking =
        enableClickTracking ?? (wantsTracking && isSendGridClickTrackingEnabled());

    const personalization: Record<string, unknown> = {
        to: normalizeRecipients(to),
    };
    const ccRecipients = normalizeRecipients(listRecipientEmails(cc));
    const bccRecipients = normalizeRecipients(listRecipientEmails(bcc));
    if (ccRecipients.length) personalization.cc = ccRecipients;
    if (bccRecipients.length) personalization.bcc = bccRecipients;
    if (trackingId?.trim()) {
        personalization.custom_args = { ocid: trackingId.trim() };
    }

    const payload: Record<string, unknown> = {
        personalizations: [personalization],
        from: { email: fromAddr.address, name: fromAddr.name },
        subject,
        content: [{ type: 'text/html', value: html }],
    };

    if (replyTo) payload.reply_to = { email: extractEmailAddress(String(replyTo)) };
    if (threadingHeaders) payload.headers = threadingHeaders;
    if (categories?.length) payload.categories = categories;

    const apiAttachments = toSendGridApiAttachments(attachments);
    if (apiAttachments.length) payload.attachments = apiAttachments;

    if (openTracking || clickTracking) {
        payload.tracking_settings = {
            ...(openTracking ? { open_tracking: { enable: true } } : {}),
            ...(clickTracking
                ? { click_tracking: { enable: true, enable_text: true } }
                : {}),
        };
    }

    const recipients = normalizeRecipients(to).map((r) => r.email);

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${sendgridApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        if (
            response.status === 401 &&
            /maximum credits exceeded/i.test(errorBody)
        ) {
            throw new Error(
                'SendGrid email credits exceeded. Add credits or upgrade your SendGrid plan, then try again.',
            );
        }
        throw new Error(`SendGrid API send failed (${response.status}): ${errorBody}`);
    }

    const messageId = response.headers.get('x-message-id') ?? undefined;

    return {
        messageId: messageId ?? undefined,
        accepted: recipients,
        rejected: [],
    };
}

const sendMail = async (
    optionsOrTo: SendMailOptions | string,
    legacySubject?: string,
    legacyHtml?: string,
) => {
    try {
        const options: SendMailOptions =
            typeof optionsOrTo === 'string'
                ? {
                      to: optionsOrTo,
                      subject: legacySubject || '',
                      html: legacyHtml || '',
                  }
                : optionsOrTo;

        const {
            to,
            subject,
            html,
            from,
            cc,
            bcc,
            replyTo,
            attachments,
            trackingId,
            enableOpenTracking,
            enableClickTracking,
            categories,
            inReplyTo,
            references,
        } = options;

        const htmlWithBrandLogo = rewriteBrandLogoUrlsForEmail(String(html || ''));
        const optionsWithBrandLogo: SendMailOptions = { ...options, html: htmlWithBrandLogo };

        const threadingHeaders = buildThreadingHeaders({ inReplyTo, references });

        // Tracked mail uses the HTTP API so `custom_args.ocid` is present on webhooks.
        // When CC/BCC are present, prefer SMTP relay — CC delivery is unreliable on HTTP API.
        if (shouldUseSendGridHttpApi(optionsWithBrandLogo)) {
            return sendViaSendGridHttpApi(optionsWithBrandLogo);
        }

        const smtpApiHeader = useSendgrid
            ? buildSendGridSmtpApiHeader({
                  trackingId,
                  enableOpenTracking,
                  enableClickTracking,
                  categories,
              })
            : undefined;

        const mailOptions = {
            from: buildMailFrom(from),
            to,
            subject,
            html: htmlWithBrandLogo,
            cc,
            bcc,
            replyTo,
            ...(attachments?.length ? { attachments } : {}),
            ...(smtpApiHeader || threadingHeaders
                ? {
                      headers: {
                          ...(smtpApiHeader ? { 'X-SMTPAPI': smtpApiHeader } : {}),
                          ...(threadingHeaders ?? {}),
                      },
                  }
                : {}),
        };

        const response = await transporter.sendMail(mailOptions);
        return response;
    } catch (error) {
        console.error('SMTP sendMail failed:', error);
        throw error;
    }
};

function resolveSendGridFromAddress(from?: string): string | undefined {
    return (
        from ||
        process.env.SENDGRID_FROM_EMAIL?.trim() ||
        process.env.SENDGRID_AUTH_USER?.trim()
    );
}

/** Deliver one SendGrid message (no CC/BCC/multi-To split). */
async function deliverSendGridMailOnce(options: SendMailOptions): Promise<SendMailResult> {
    // Tracked sends use the HTTP API so `custom_args.ocid` is present on webhooks.
    if (shouldUseSendGridHttpApi(options)) {
        return sendViaSendGridHttpApi({
            ...options,
            from: resolveSendGridFromAddress(options.from),
        });
    }

    const transporter = createSendGridTransporter();
    const {
        to,
        subject,
        html,
        from,
        cc,
        bcc,
        replyTo,
        attachments,
        trackingId,
        enableOpenTracking,
        enableClickTracking,
        categories,
        inReplyTo,
        references,
    } = options;
    const threadingHeaders = buildThreadingHeaders({ inReplyTo, references });
    const smtpApiHeader = buildSendGridSmtpApiHeader({
        trackingId,
        enableOpenTracking,
        enableClickTracking,
        categories,
    });

    const mailOptions = {
        from: buildMailFrom(resolveSendGridFromAddress(from)),
        to,
        subject,
        html,
        cc,
        bcc,
        replyTo,
        ...(attachments?.length ? { attachments } : {}),
        ...(smtpApiHeader || threadingHeaders
            ? {
                  headers: {
                      ...(smtpApiHeader ? { 'X-SMTPAPI': smtpApiHeader } : {}),
                      ...(threadingHeaders ?? {}),
                  },
              }
            : {}),
    };
    return transporter.sendMail(mailOptions) as Promise<SendMailResult>;
}

/**
 * When CC/BCC/extra To would force SMTP relay, webhook `ocid` matching is unreliable.
 * Send the primary recipient via the HTTP API with tracking; deliver copies separately.
 */
function shouldSplitTrackedSendGridDelivery(options: SendMailOptions): boolean {
    const trackingId = options.trackingId?.trim();
    if (!trackingId) return false;
    const toCount = listRecipientEmails(options.to).length;
    const hasCc = listRecipientEmails(options.cc).length > 0;
    const hasBcc = listRecipientEmails(options.bcc).length > 0;
    return toCount > 1 || hasCc || hasBcc;
}

/** Send mail via SendGrid SMTP only (never Gmail OAuth or Gmail SMTP). */
export async function sendSendGridMail(options: SendMailOptions): Promise<SendMailResult> {
    if (!sendgridApiKey) {
        throw new Error(
            'SendGrid is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL on the server.',
        );
    }

    if (shouldSplitTrackedSendGridDelivery(options)) {
        const toList = listRecipientEmails(options.to);
        const ccList = listRecipientEmails(options.cc);
        const bccList = listRecipientEmails(options.bcc);
        const [primaryTo, ...extraTo] = toList;
        if (!primaryTo) {
            throw new Error('At least one recipient (to) is required');
        }

        const primaryResult = await deliverSendGridMailOnce({
            ...options,
            to: primaryTo,
            cc: undefined,
            bcc: undefined,
        });

        const copyRecipients = [...extraTo, ...ccList, ...bccList];
        for (const recipient of copyRecipients) {
            const { trackingId: _trackingId, ...copyOptions } = options;
            await deliverSendGridMailOnce({
                ...copyOptions,
                to: recipient,
                cc: undefined,
                bcc: undefined,
            });
        }

        return primaryResult;
    }

    return deliverSendGridMailOnce(options);
}

export default sendMail;
