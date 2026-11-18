/**
 * SendGrid transport — the default provider for funder / deal mail.
 *
 * Restored from the pre-Gmail implementation (commit 90ac3ff, `config/nodemailer.ts`)
 * unchanged in behaviour:
 *   - tracked single-recipient mail → Mail Send HTTP API v3 (`custom_args.ocid`
 *     reaches the Event Webhook reliably), bounded retries on 429 / 5xx /
 *     pre-response connection errors, never on a timeout;
 *   - everything else → SendGrid SMTP relay with an `X-SMTPAPI` header;
 *   - tracked mail with CC / BCC / extra To → primary via HTTP API, copies separately.
 *
 * Additions: an explicit RFC Message-ID / In-Reply-To / References on every send
 * (deal chains continue over SendGrid), and failures thrown as
 * {@link MailDeliveryError} so the router never falls back after an ambiguous error.
 */
import fs from 'fs';
import nodemailer from 'nodemailer';
import { parseMailSender, resolveMailSender, type MailSender } from '../services/mailSenderIdentity';
import { MailDeliveryError, classifyHttpFailure, classifySmtpFailure } from '../services/mail/mailErrors';

export function getSendGridApiKey(): string {
    return String(process.env.SENDGRID_API_KEY || '').trim();
}

/** True when `SENDGRID_API_KEY` is set. */
export function isSendGridConfigured(): boolean {
    return Boolean(getSendGridApiKey());
}

/** SendGrid open tracking for tracked mail (default ON). Set SENDGRID_TRACK_OPEN_PIXEL=false to disable. */
export function isSendGridOpenPixelTrackingEnabled(): boolean {
    return String(process.env.SENDGRID_TRACK_OPEN_PIXEL ?? 'true').trim().toLowerCase() !== 'false';
}

/** Link click tracking — on by default for tracked mail. */
export function isSendGridClickTrackingEnabled(): boolean {
    return String(process.env.SENDGRID_TRACK_CLICKS ?? 'true').trim().toLowerCase() !== 'false';
}

export interface SendGridMailOptions {
    to: string | string[];
    subject: string;
    html: string;
    from?: string | MailSender;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    /** RFC 5322 Message-ID to set on the message (deal chains record it). */
    messageId?: string;
    inReplyTo?: string;
    references?: string;
    attachments?: Array<{
        filename?: string | false;
        content?: Buffer | string;
        path?: string;
        cid?: string;
        contentType?: string;
        contentDisposition?: 'inline' | 'attachment';
    }>;
    trackingId?: string;
    enableOpenTracking?: boolean;
    enableClickTracking?: boolean;
    categories?: string[];
}

export interface SendGridSendResult {
    /** SendGrid `x-message-id` (HTTP API) or SMTP transport message id — used for webhook matching. */
    messageId?: string;
    /** RFC Message-ID header we set. */
    rfcMessageId?: string;
    accepted: string[];
    rejected: string[];
}

/** Bounds on one SMTP conversation so a stalled relay fails fast. */
const SMTP_TIMEOUTS = {
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 45_000,
};

let cachedTransporter: { key: string; transporter: ReturnType<typeof nodemailer.createTransport> } | null = null;

/** One SendGrid SMTP transporter per process (rebuilt if the key changes). */
function getSendGridTransporter() {
    const apiKey = getSendGridApiKey();
    if (cachedTransporter?.key === apiKey) return cachedTransporter.transporter;
    const port = Number(process.env.SENDGRID_SMTP_PORT) || 587;
    const transporter = nodemailer.createTransport({
        host: process.env.SENDGRID_SMTP_HOST?.trim() || 'smtp.sendgrid.net',
        port,
        secure: port === 465,
        auth: { user: 'apikey', pass: apiKey },
        ...SMTP_TIMEOUTS,
    });
    cachedTransporter = { key: apiKey, transporter };
    return transporter;
}

const SENDGRID_HTTP_TIMEOUT_MS = 20_000;
const SENDGRID_HTTP_MAX_ATTEMPTS = 3;

/**
 * Only failures where SendGrid did not accept the message are retried: 429 and
 * 5xx responses, and connection errors raised before any response arrived. A
 * timeout is not retried — the request may have been accepted.
 */
export function isRetryableSendGridFailure(input: { status?: number; error?: unknown }): boolean {
    if (typeof input.status === 'number') {
        return input.status === 429 || input.status >= 500;
    }
    const err = input.error as { name?: string; code?: string; cause?: { code?: string } } | null;
    if (!err) return false;
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return false;
    const code = String(err.code || err.cause?.code || '').toUpperCase();
    return ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code);
}

function sendGridRetryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
    const retryAfter = Number(retryAfterHeader);
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(10_000, retryAfter * 1000);
    return 750 * 2 ** (attempt - 1);
}

const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function postToSendGridMailApi(body: string): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
        let response: Response;
        try {
            response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: { Authorization: `Bearer ${getSendGridApiKey()}`, 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(SENDGRID_HTTP_TIMEOUT_MS),
            });
        } catch (error) {
            if (attempt < SENDGRID_HTTP_MAX_ATTEMPTS && isRetryableSendGridFailure({ error })) {
                await sleepMs(sendGridRetryDelayMs(attempt));
                continue;
            }
            throw new MailDeliveryError(`SendGrid request failed: ${(error as Error)?.message || 'network error'}`, {
                kind: classifyHttpFailure(error),
                provider: 'sendgrid',
                cause: error,
            });
        }
        if (!response.ok && attempt < SENDGRID_HTTP_MAX_ATTEMPTS && isRetryableSendGridFailure({ status: response.status })) {
            await sleepMs(sendGridRetryDelayMs(attempt, response.headers.get('retry-after')));
            continue;
        }
        return response;
    }
}

const listOf = (value?: string | string[]): string[] =>
    (Array.isArray(value) ? value : value ? [value] : []).map((v) => String(v || '').trim()).filter(Boolean);

function buildHeaders(options: Pick<SendGridMailOptions, 'messageId' | 'inReplyTo' | 'references'>): Record<string, string> | undefined {
    const headers: Record<string, string> = {};
    if (options.messageId?.trim()) headers['Message-ID'] = options.messageId.trim();
    if (options.inReplyTo?.trim()) headers['In-Reply-To'] = options.inReplyTo.trim();
    if (options.references?.trim()) headers.References = options.references.trim();
    return Object.keys(headers).length ? headers : undefined;
}

/** `X-SMTPAPI` header SendGrid reads on the SMTP relay (ocid custom arg, tracking filters, categories). */
function buildSendGridSmtpApiHeader(opts: SendGridMailOptions): string | undefined {
    const trackingId = opts.trackingId?.trim();
    const openTracking = opts.enableOpenTracking ?? (Boolean(trackingId) && isSendGridOpenPixelTrackingEnabled());
    const clickTracking = opts.enableClickTracking ?? (Boolean(trackingId) && isSendGridClickTrackingEnabled());
    const categories = (opts.categories ?? []).filter(Boolean);
    if (!trackingId && !openTracking && !clickTracking && categories.length === 0) return undefined;

    const payload: Record<string, unknown> = {};
    if (trackingId) payload.unique_args = { ocid: trackingId };
    if (categories.length) payload.category = categories;
    const filters: Record<string, unknown> = {};
    if (openTracking) filters.opentrack = { settings: { enable: 1 } };
    if (clickTracking) filters.clicktrack = { settings: { enable: 1, enable_text: 1 } };
    if (Object.keys(filters).length) payload.filters = filters;
    return JSON.stringify(payload);
}

/** HTTP API for tracked mail; multi-To / CC / BCC are more reliable via the SMTP relay. */
function shouldUseHttpApi(options: SendGridMailOptions): boolean {
    if (!options.trackingId?.trim()) return false;
    return !listOf(options.cc).length && !listOf(options.bcc).length && listOf(options.to).length <= 1;
}

function toApiAttachments(attachments?: SendGridMailOptions['attachments']) {
    const out: Array<{ content: string; type: string; filename: string; disposition: 'inline' | 'attachment'; content_id?: string }> = [];
    for (const attachment of attachments ?? []) {
        let buffer: Buffer | null = null;
        if (attachment.content) {
            buffer = Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(String(attachment.content));
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

const CREDITS_EXCEEDED_MESSAGE = 'SendGrid email credits exceeded. Add credits or upgrade your SendGrid plan, then try again.';

async function sendViaHttpApi(options: SendGridMailOptions, from: MailSender): Promise<SendGridSendResult> {
    const trackingId = options.trackingId?.trim();
    const openTracking = options.enableOpenTracking ?? (Boolean(trackingId) && isSendGridOpenPixelTrackingEnabled());
    const clickTracking = options.enableClickTracking ?? (Boolean(trackingId) && isSendGridClickTrackingEnabled());

    const personalization: Record<string, unknown> = { to: listOf(options.to).map((email) => ({ email })) };
    const cc = listOf(options.cc).map((email) => ({ email }));
    const bcc = listOf(options.bcc).map((email) => ({ email }));
    if (cc.length) personalization.cc = cc;
    if (bcc.length) personalization.bcc = bcc;
    if (trackingId) personalization.custom_args = { ocid: trackingId };

    const payload: Record<string, unknown> = {
        personalizations: [personalization],
        from: { email: from.email, name: from.name },
        subject: options.subject,
        content: [{ type: 'text/html', value: options.html }],
    };
    if (options.replyTo) payload.reply_to = { email: parseMailSender(String(options.replyTo)).email };
    const headers = buildHeaders(options);
    if (headers) payload.headers = headers;
    if (options.categories?.length) payload.categories = options.categories;
    const apiAttachments = toApiAttachments(options.attachments);
    if (apiAttachments.length) payload.attachments = apiAttachments;
    if (openTracking || clickTracking) {
        payload.tracking_settings = {
            ...(openTracking ? { open_tracking: { enable: true } } : {}),
            ...(clickTracking ? { click_tracking: { enable: true, enable_text: true } } : {}),
        };
    }

    const response = await postToSendGridMailApi(JSON.stringify(payload));
    if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const message =
            response.status === 401 && /maximum credits exceeded/i.test(errorBody)
                ? CREDITS_EXCEEDED_MESSAGE
                : `SendGrid API send failed (${response.status}): ${errorBody.slice(0, 500)}`;
        throw new MailDeliveryError(message, {
            kind: classifyHttpFailure(null, response.status),
            provider: 'sendgrid',
            status: response.status,
        });
    }
    return {
        messageId: response.headers.get('x-message-id') ?? undefined,
        rfcMessageId: options.messageId,
        accepted: listOf(options.to),
        rejected: [],
    };
}

async function sendViaSmtpRelay(options: SendGridMailOptions, from: MailSender): Promise<SendGridSendResult> {
    const smtpApiHeader = buildSendGridSmtpApiHeader(options);
    const threading = buildHeaders({ inReplyTo: options.inReplyTo, references: options.references });
    try {
        const response = await getSendGridTransporter().sendMail({
            from: { name: from.name, address: from.email },
            to: options.to,
            subject: options.subject,
            html: options.html,
            cc: options.cc,
            bcc: options.bcc,
            replyTo: options.replyTo,
            ...(options.messageId ? { messageId: options.messageId } : {}),
            ...(options.attachments?.length ? { attachments: options.attachments } : {}),
            ...(smtpApiHeader || threading
                ? { headers: { ...(smtpApiHeader ? { 'X-SMTPAPI': smtpApiHeader } : {}), ...(threading ?? {}) } }
                : {}),
        });
        return {
            messageId: response?.messageId,
            rfcMessageId: options.messageId || response?.messageId,
            accepted: (response?.accepted ?? []).map(String),
            rejected: (response?.rejected ?? []).map(String),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new MailDeliveryError(/maximum credits exceeded/i.test(message) ? CREDITS_EXCEEDED_MESSAGE : `SendGrid SMTP send failed: ${message}`, {
            kind: classifySmtpFailure(error),
            provider: 'sendgrid',
            cause: error,
        });
    }
}

async function deliverOnce(options: SendGridMailOptions, from: MailSender): Promise<SendGridSendResult> {
    return shouldUseHttpApi(options) ? sendViaHttpApi(options, from) : sendViaSmtpRelay(options, from);
}

/**
 * Send one email through SendGrid. The From identity is the verified SendGrid
 * sender (`options.from`, else SENDGRID_FROM_EMAIL + SENDGRID_FROM_NAME).
 */
export async function sendViaSendGrid(options: SendGridMailOptions): Promise<SendGridSendResult> {
    if (!isSendGridConfigured()) {
        throw new MailDeliveryError('SendGrid is not configured (SENDGRID_API_KEY).', { kind: 'not_sent', provider: 'sendgrid' });
    }
    let from: MailSender;
    try {
        from = await resolveMailSender(options.from, { sendgridOnly: true });
    } catch (error) {
        // Missing sender identity: nothing was sent.
        throw new MailDeliveryError((error as Error)?.message || 'SendGrid sender is not configured', {
            kind: 'not_sent',
            provider: 'sendgrid',
            cause: error,
        });
    }

    const toList = listOf(options.to);
    const copies = [...toList.slice(1), ...listOf(options.cc), ...listOf(options.bcc)];
    if (options.trackingId?.trim() && copies.length) {
        // Primary recipient via the HTTP API with tracking; copies delivered separately (untracked).
        if (!toList[0]) throw new MailDeliveryError('At least one recipient (to) is required', { kind: 'not_sent', provider: 'sendgrid' });
        const primary = await deliverOnce({ ...options, to: toList[0], cc: undefined, bcc: undefined }, from);
        // Copies are untracked and get their own Message-ID (nodemailer / SendGrid assign one).
        const copy: SendGridMailOptions = { ...options, trackingId: undefined, messageId: undefined, cc: undefined, bcc: undefined };
        for (const recipient of copies) {
            try {
                await deliverOnce({ ...copy, to: recipient }, from);
            } catch (error) {
                // The primary email is out; a failed copy must not make the caller resend it.
                console.error('[sendgrid] copy delivery failed:', recipient, (error as Error)?.message);
            }
        }
        return primary;
    }
    return deliverOnce(options, from);
}
