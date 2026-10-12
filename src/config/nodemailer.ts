/**
 * Central outbound mailer — Gmail API (SendGrid is disabled; see the commented-out
 * implementation at the bottom of this file).
 *
 * Routing for every `sendMail` / `sendSendGridMail` call:
 *   1. `threadApplicationId` set → reply on that deal's Gmail thread
 *      (`applicationEmailThreadService`, thread + Message-ID stored in the DB).
 *   2. Gmail API sender configured (GMAIL_SENDER_EMAIL + Google OAuth client) →
 *      new message from the server mailbox.
 *   3. Legacy Gmail SMTP with an app password (SMTP_AUTH_USER / SMTP_AUTH_PASS).
 */
import nodemailer from 'nodemailer';
import prisma from './prismaClient';
import { resolveMailSender, type MailSender } from '../services/mailSenderIdentity';
import { rewriteBrandLogoUrlsForEmail } from '../constants/brand';
import {
    getGmailSenderEmail,
    getSystemGmailMailbox,
    isGmailApiMailerConfigured,
    sendViaGmailApi,
} from './gmailApiMailer';
import { sendOnApplicationThread } from '../services/applicationEmailThreadService';

/** SendGrid is disabled — kept so existing imports compile. */
export function isSendGridOpenPixelTrackingEnabled(): boolean {
    return false;
}

/** SendGrid is disabled — kept so existing imports compile. */
export function isSendGridClickTrackingEnabled(): boolean {
    return false;
}

/** @deprecated SendGrid is disabled. */
export function isSendGridEngagementTrackingEnabled(): boolean {
    return false;
}

/** SendGrid is disabled; all mail goes through Gmail. Always false. */
export function isSendGridConfigured(): boolean {
    return false;
}

function isSmtpFallbackConfigured(): boolean {
    return Boolean(process.env.SMTP_AUTH_USER?.trim() && process.env.SMTP_AUTH_PASS?.trim());
}

/** True when outbound mail can be sent (Gmail API sender or Gmail SMTP app password). */
export function isOutboundMailConfigured(): boolean {
    return isGmailApiMailerConfigured() || isSmtpFallbackConfigured();
}

/** @deprecated Use {@link isOutboundMailConfigured}. */
export function isOutboundSmtpConfigured(): boolean {
    return isOutboundMailConfigured();
}

/** Which transport untargeted mail uses right now (for logs / provider fields). */
export function describeMailTransport(): 'gmail' | 'smtp' | 'none' {
    if (isGmailApiMailerConfigured()) return 'gmail';
    if (isSmtpFallbackConfigured()) return 'smtp';
    return 'none';
}

/**
 * Display name for a send. The address is always the sending Gmail mailbox
 * (Gmail rewrites any other From), so only the name is taken from `from`.
 */
async function resolveFromName(from: SendMailOptions['from']): Promise<string> {
    try {
        return (await resolveMailSender(from)).name;
    } catch {
        return (
            process.env.GMAIL_SENDER_NAME?.trim() ||
            process.env.MAIL_FROM_NAME?.trim() ||
            process.env.SENDGRID_FROM_NAME?.trim() ||
            getGmailSenderEmail()
        );
    }
}

/** Default sender for startup diagnostics. */
export async function describeDefaultMailSender(): Promise<string> {
    const transport = describeMailTransport();
    if (transport === 'none') {
        return 'NOT READY — set GMAIL_SENDER_EMAIL + GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (Gmail API)';
    }
    const address = transport === 'gmail' ? getGmailSenderEmail() : String(process.env.SMTP_AUTH_USER || '').trim();
    return `"${await resolveFromName(undefined)}" <${address}> via ${transport === 'gmail' ? 'Gmail API' : 'Gmail SMTP'}`;
}

/**
 * Bounds on one SMTP conversation (fallback transport only).
 */
const SMTP_TIMEOUTS = {
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 45_000,
};

let smtpTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getSmtpTransporter() {
    if (!smtpTransporter) {
        smtpTransporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            service: 'gmail',
            port: 587,
            secure: false,
            auth: {
                user: process.env.SMTP_AUTH_USER,
                pass: process.env.SMTP_AUTH_PASS,
            },
            ...SMTP_TIMEOUTS,
        });
    }
    return smtpTransporter;
}

export interface SendMailOptions {
    to: string | string[];
    subject: string;
    html: string;
    /**
     * Sender identity. Only the display name is used — the address is the
     * sending Gmail mailbox. Omit for the default sender name from `.env`.
     */
    from?: string | MailSender;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    /** RFC 2822 `In-Reply-To` for email threading (non-application sends). */
    inReplyTo?: string;
    /** RFC 2822 `References` for email threading (non-application sends). */
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
     * OutboundCommunication id of the mail-log row. Gmail ids (message, thread,
     * Message-ID) are written to its metadata after the send.
     */
    trackingId?: string;
    /**
     * Deal whose ISO Gmail thread this message belongs to. When set the mail
     * replies on that thread (same conversation for approval / offer / decline /
     * document request / comments) and the thread state is stored in the DB.
     */
    threadApplicationId?: string;
    /** Acting CRM user; their connected Gmail starts a new deal thread when available. */
    threadSenderUserId?: string | null;
    /** @deprecated SendGrid only — ignored. */
    enableOpenTracking?: boolean;
    /** @deprecated SendGrid only — ignored. */
    enableClickTracking?: boolean;
    /** @deprecated SendGrid only — ignored. */
    categories?: string[];
}

export type SendMailResult = {
    /** RFC Message-ID (Gmail API sends) or transport message id. */
    messageId?: string;
    gmailMessageId?: string;
    gmailThreadId?: string;
    accepted?: string[];
    rejected?: string[];
};

function buildThreadingHeaders(options: Pick<SendMailOptions, 'inReplyTo' | 'references'>): Record<string, string> | undefined {
    const headers: Record<string, string> = {};
    const inReplyTo = String(options.inReplyTo || '').trim();
    const references = String(options.references || '').trim();
    if (inReplyTo) headers['In-Reply-To'] = inReplyTo;
    if (references) headers.References = references;
    return Object.keys(headers).length ? headers : undefined;
}

/** Store Gmail ids on the mail-log row so a deal's sends can be traced to the thread. */
async function recordGmailIdsOnOutbound(trackingId: string | undefined, result: SendMailResult): Promise<void> {
    const id = String(trackingId || '').trim();
    if (!id || !result.gmailMessageId) return;
    try {
        const existing = await prisma.outbound_communications.findUnique({
            where: { id },
            select: { metadata: true },
        });
        if (!existing) return;
        const prior =
            existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
                ? (existing.metadata as Record<string, unknown>)
                : {};
        await prisma.outbound_communications.update({
            where: { id },
            data: {
                metadata: {
                    ...prior,
                    provider: 'gmail',
                    gmailMessageId: result.gmailMessageId,
                    gmailThreadId: result.gmailThreadId ?? null,
                    rfcMessageId: result.messageId ?? null,
                } as object,
            },
        });
    } catch (err) {
        console.warn('[mail] could not store Gmail ids on outbound row:', id, (err as Error)?.message);
    }
}

async function deliver(options: SendMailOptions): Promise<SendMailResult> {
    const html = rewriteBrandLogoUrlsForEmail(String(options.html || ''));
    const attachments = options.attachments?.length ? options.attachments : undefined;

    // 1. Deal thread (Gmail).
    const threadApplicationId = String(options.threadApplicationId || '').trim();
    if (threadApplicationId) {
        try {
            const sent = await sendOnApplicationThread({
                applicationId: threadApplicationId,
                senderUserId: options.threadSenderUserId ?? null,
                to: options.to,
                cc: options.cc,
                bcc: options.bcc,
                replyTo: options.replyTo,
                subject: options.subject,
                html,
                attachments: attachments as never,
                fromName: await resolveFromName(options.from),
            });
            return {
                messageId: sent.rfcMessageId ?? undefined,
                gmailMessageId: sent.gmailMessageId,
                gmailThreadId: sent.gmailThreadId,
                accepted: sent.accepted,
                rejected: [],
            };
        } catch (err) {
            if (!isSmtpFallbackConfigured()) throw err;
            console.warn('[mail] deal thread send failed, falling back to SMTP:', (err as Error)?.message);
            return deliverViaSmtp({ ...options, html, attachments });
        }
    }

    // 2. Server-wide Gmail mailbox.
    if (isGmailApiMailerConfigured()) {
        const mailbox = await getSystemGmailMailbox();
        if (mailbox) {
            const sent = await sendViaGmailApi(
                {
                    accessToken: mailbox.accessToken,
                    from: { name: await resolveFromName(options.from), address: mailbox.email },
                    to: options.to,
                    cc: options.cc,
                    bcc: options.bcc,
                    replyTo: options.replyTo,
                    subject: options.subject,
                    html,
                    attachments: attachments as never,
                    inReplyTo: options.inReplyTo,
                    references: options.references,
                },
                async () => (await getSystemGmailMailbox({ forceRefresh: true }))?.accessToken ?? null,
            );
            return {
                messageId: sent.rfcMessageId,
                gmailMessageId: sent.gmailMessageId,
                gmailThreadId: sent.gmailThreadId,
                accepted: sent.accepted,
                rejected: [],
            };
        }
        if (!isSmtpFallbackConfigured()) {
            throw new Error(
                `Gmail sender ${getGmailSenderEmail()} is not connected. Connect that mailbox (Settings → Email) or set GMAIL_SENDER_REFRESH_TOKEN.`,
            );
        }
    }

    // 3. Gmail SMTP (app password).
    if (!isSmtpFallbackConfigured()) {
        throw new Error(
            'No outbound mail transport is configured. Set GMAIL_SENDER_EMAIL with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (Gmail API).',
        );
    }
    return deliverViaSmtp({ ...options, html, attachments });
}

async function deliverViaSmtp(options: SendMailOptions): Promise<SendMailResult> {
    const threadingHeaders = buildThreadingHeaders(options);
    const response = await getSmtpTransporter().sendMail({
        from: { name: await resolveFromName(options.from), address: String(process.env.SMTP_AUTH_USER || '').trim() },
        to: options.to,
        subject: options.subject,
        html: options.html,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
        ...(options.attachments?.length ? { attachments: options.attachments } : {}),
        ...(threadingHeaders ? { headers: threadingHeaders } : {}),
    });
    return response as SendMailResult;
}

const sendMail = async (
    optionsOrTo: SendMailOptions | string,
    legacySubject?: string,
    legacyHtml?: string,
): Promise<SendMailResult> => {
    const options: SendMailOptions =
        typeof optionsOrTo === 'string'
            ? { to: optionsOrTo, subject: legacySubject || '', html: legacyHtml || '' }
            : optionsOrTo;
    try {
        const result = await deliver(options);
        await recordGmailIdsOnOutbound(options.trackingId, result);
        return result;
    } catch (error) {
        console.error('sendMail failed:', error);
        throw error;
    }
};

/**
 * Legacy name kept for existing callers (contract portal, payment letters,
 * document requests). SendGrid is disabled — this sends through Gmail.
 */
export async function sendSendGridMail(options: SendMailOptions): Promise<SendMailResult> {
    return sendMail(options);
}

export default sendMail;

/* ==========================================================================
 * SENDGRID — DISABLED. Original SendGrid implementation kept for reference.
 * All mail now goes through Gmail (see above). Do not re-enable without
 * restoring the SendGrid webhook route and usage service.
 * ========================================================================== */
// import fs from 'fs';
// import nodemailer from 'nodemailer';
// import {
//     parseMailSender,
//     resolveMailSender,
//     type MailSender,
// } from '../services/mailSenderIdentity';
// import { rewriteBrandLogoUrlsForEmail } from '../constants/brand';
// 
// const sendgridApiKey = process.env.SENDGRID_API_KEY?.trim();
// const useSendgrid = Boolean(sendgridApiKey);
// 
// /**
//  * SendGrid open tracking for tracked mail (default ON). Set SENDGRID_TRACK_OPEN_PIXEL=false to disable.
//  */
// export function isSendGridOpenPixelTrackingEnabled(): boolean {
//     return String(process.env.SENDGRID_TRACK_OPEN_PIXEL ?? 'true')
//         .trim()
//         .toLowerCase() !== 'false';
// }
// 
// /** Link click tracking — on by default for tracked mail. */
// export function isSendGridClickTrackingEnabled(): boolean {
//     return String(process.env.SENDGRID_TRACK_CLICKS ?? 'true')
//         .trim()
//         .toLowerCase() !== 'false';
// }
// 
// /** @deprecated Use isSendGridOpenPixelTrackingEnabled / isSendGridClickTrackingEnabled */
// export function isSendGridEngagementTrackingEnabled(): boolean {
//     return isSendGridOpenPixelTrackingEnabled() || isSendGridClickTrackingEnabled();
// }
// 
// /** True when `SENDGRID_API_KEY` is set (payment letters require this). */
// export function isSendGridConfigured(): boolean {
//     return Boolean(sendgridApiKey);
// }
// 
// /** True when SendGrid API key or classic Gmail SMTP user+pass is configured. */
// export function isOutboundSmtpConfigured(): boolean {
//     if (sendgridApiKey) return true;
//     return Boolean(
//         process.env.SMTP_AUTH_USER?.trim() && process.env.SMTP_AUTH_PASS?.trim(),
//     );
// }
// 
// /** Strip optional `"Name"` wrapper and extract the bare email from a From value. */
// function extractEmailAddress(raw: string): string {
//     return parseMailSender(raw).email;
// }
// 
// /**
//  * Resolve the sender a message goes out as. The display name always belongs to
//  * the chosen sender identity (see `mailSenderIdentity`) — never the SendGrid
//  * account / brand name.
//  */
// async function resolveFromHeader(
//     from: SendMailOptions['from'],
//     options?: { sendgridOnly?: boolean },
// ): Promise<{ name: string; address: string }> {
//     const sender = await resolveMailSender(from, options);
//     return { name: sender.name, address: sender.email };
// }
// 
// /**
//  * Bounds on one SMTP conversation. Nodemailer's defaults (2 min to connect,
//  * 10 min of socket silence) let a stalled relay hold a contract send open far
//  * past any request timeout; these fail fast enough for a retry to matter.
//  */
// const SMTP_TIMEOUTS = {
//     connectionTimeout: 15_000,
//     greetingTimeout: 10_000,
//     socketTimeout: 45_000,
// };
// 
// function createSendGridTransporter() {
//     const port = Number(process.env.SENDGRID_SMTP_PORT) || 587;
//     return nodemailer.createTransport({
//         host: process.env.SENDGRID_SMTP_HOST?.trim() || 'smtp.sendgrid.net',
//         port,
//         secure: port === 465,
//         auth: {
//             user: 'apikey',
//             pass: sendgridApiKey,
//         },
//         ...SMTP_TIMEOUTS,
//     });
// }
// 
// let cachedSendGridTransporter: ReturnType<typeof createSendGridTransporter> | null = null;
// 
// /** One SendGrid SMTP transporter per process instead of one per message. */
// function getSendGridTransporter() {
//     if (!cachedSendGridTransporter) cachedSendGridTransporter = createSendGridTransporter();
//     return cachedSendGridTransporter;
// }
// 
// /** SendGrid HTTP API: per-attempt timeout and bounded retries. */
// const SENDGRID_HTTP_TIMEOUT_MS = 20_000;
// const SENDGRID_HTTP_MAX_ATTEMPTS = 3;
// 
// /**
//  * Only failures where SendGrid did not accept the message are retried: 429 and
//  * 5xx responses, and connection errors raised before any response arrived. A
//  * timeout is not retried — the request may have been accepted, and a retry
//  * would email the recipient twice.
//  */
// export function isRetryableSendGridFailure(input: {
//     status?: number;
//     error?: unknown;
// }): boolean {
//     if (typeof input.status === 'number') {
//         return input.status === 429 || input.status >= 500;
//     }
//     const err = input.error as { name?: string; code?: string; cause?: { code?: string } } | null;
//     if (!err) return false;
//     if (err.name === 'TimeoutError' || err.name === 'AbortError') return false;
//     const code = String(err.code || err.cause?.code || '').toUpperCase();
//     return ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(
//         code,
//     );
// }
// 
// function sendGridRetryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
//     const retryAfter = Number(retryAfterHeader);
//     if (Number.isFinite(retryAfter) && retryAfter > 0) {
//         return Math.min(10_000, retryAfter * 1000);
//     }
//     return 750 * 2 ** (attempt - 1);
// }
// 
// const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
// 
// async function postToSendGridMailApi(body: string): Promise<Response> {
//     for (let attempt = 1; ; attempt += 1) {
//         let response: Response;
//         try {
//             response = await fetch('https://api.sendgrid.com/v3/mail/send', {
//                 method: 'POST',
//                 headers: {
//                     Authorization: `Bearer ${sendgridApiKey}`,
//                     'Content-Type': 'application/json',
//                 },
//                 body,
//                 signal: AbortSignal.timeout(SENDGRID_HTTP_TIMEOUT_MS),
//             });
//         } catch (error) {
//             if (attempt < SENDGRID_HTTP_MAX_ATTEMPTS && isRetryableSendGridFailure({ error })) {
//                 await sleepMs(sendGridRetryDelayMs(attempt));
//                 continue;
//             }
//             throw error;
//         }
//         if (
//             !response.ok &&
//             attempt < SENDGRID_HTTP_MAX_ATTEMPTS &&
//             isRetryableSendGridFailure({ status: response.status })
//         ) {
//             await sleepMs(sendGridRetryDelayMs(attempt, response.headers.get('retry-after')));
//             continue;
//         }
//         return response;
//     }
// }
// 
// /**
//  * Default sender for startup diagnostics: SENDGRID_FROM_EMAIL (or SMTP_FROM /
//  * MAIL_FROM) paired with SENDGRID_FROM_NAME, or the funder that owns the address.
//  */
// export async function describeDefaultMailSender(): Promise<string> {
//     try {
//         const { name, address } = await resolveFromHeader(undefined);
//         return `"${name}" <${address}>`;
//     } catch (error) {
//         return `NOT READY — ${error instanceof Error ? error.message : String(error)}`;
//     }
// }
// 
// function createTransporter() {
//     if (useSendgrid) {
//         return createSendGridTransporter();
//     }
// 
//     return nodemailer.createTransport({
//         host: 'smtp.gmail.com',
//         service: 'gmail',
//         port: 587,
//         secure: false,
//         auth: {
//             user: process.env.SMTP_AUTH_USER,
//             pass: process.env.SMTP_AUTH_PASS,
//         },
//         ...SMTP_TIMEOUTS,
//     });
// }
// 
// const transporter = createTransporter();
// 
// interface SendMailOptions {
//     to: string | string[];
//     subject: string;
//     html: string;
//     /**
//      * Sender identity. Prefer `{ email, name }`; a bare email is resolved to the
//      * name stored for that sender. Omit for the default sender from `.env`.
//      */
//     from?: string | MailSender;
//     cc?: string | string[];
//     bcc?: string | string[];
//     replyTo?: string;
//     /** RFC 2822 `In-Reply-To` for email threading. */
//     inReplyTo?: string;
//     /** RFC 2822 `References` for email threading. */
//     references?: string;
//     attachments?: Array<{
//         filename?: string | false;
//         content?: Buffer | string;
//         path?: string;
//         cid?: string;
//         contentType?: string;
//         contentDisposition?: 'inline' | 'attachment';
//     }>;
//     /**
//      * Correlation id echoed back by the SendGrid Event Webhook as the custom
//      * arg `ocid`. Pass the OutboundCommunication id here so delivery / bounce
//      * events can be matched back to the originating mail-log row.
//      * Delivery, open, and click tracking are enabled for tracked mail.
//      */
//     trackingId?: string;
//     /** Override open tracking (default ON when `trackingId` is set). */
//     enableOpenTracking?: boolean;
//     /** Override link click tracking (default ON when `trackingId` is set). */
//     enableClickTracking?: boolean;
//     /** Optional SendGrid categories for analytics/filtering. */
//     categories?: string[];
// }
// 
// /**
//  * Build the `X-SMTPAPI` header value SendGrid reads for SMTP relay.
//  *
//  * - `unique_args.ocid` is surfaced on every Event Webhook record so we can map
//  *   an event back to its OutboundCommunication row.
//  * - `filters.opentrack` / `filters.clicktrack` enable per-message open/click
//  *   tracking independent of account-wide settings.
//  */
// function buildSendGridSmtpApiHeader(opts: {
//     trackingId?: string;
//     enableOpenTracking?: boolean;
//     enableClickTracking?: boolean;
//     categories?: string[];
// }): string | undefined {
//     const trackingId = opts.trackingId?.trim();
//     const wantsTracking = Boolean(trackingId);
//     const openTracking =
//         opts.enableOpenTracking ??
//         (wantsTracking && isSendGridOpenPixelTrackingEnabled());
//     const clickTracking =
//         opts.enableClickTracking ?? (wantsTracking && isSendGridClickTrackingEnabled());
//     const categories = (opts.categories ?? []).filter(Boolean);
// 
//     if (!trackingId && !openTracking && !clickTracking && categories.length === 0) {
//         return undefined;
//     }
// 
//     const payload: Record<string, unknown> = {};
//     if (trackingId) {
//         payload.unique_args = { ocid: trackingId };
//     }
//     if (categories.length) {
//         payload.category = categories;
//     }
// 
//     const filters: Record<string, unknown> = {};
//     if (openTracking) {
//         filters.opentrack = { settings: { enable: 1 } };
//     }
//     if (clickTracking) {
//         filters.clicktrack = { settings: { enable: 1, enable_text: 1 } };
//     }
//     if (Object.keys(filters).length) {
//         payload.filters = filters;
//     }
// 
//     return JSON.stringify(payload);
// }
// 
// export type SendMailResult = {
//     messageId?: string;
//     accepted?: string[];
//     rejected?: string[];
// };
// 
// function normalizeRecipients(to: string | string[]): Array<{ email: string }> {
//     const list = Array.isArray(to) ? to : [to];
//     return list
//         .map((entry) => String(entry || '').trim())
//         .filter(Boolean)
//         .map((email) => ({ email }));
// }
// 
// function listRecipientEmails(value?: string | string[]): string[] {
//     if (!value) return [];
//     const list = Array.isArray(value) ? value : [value];
//     return list.map((entry) => String(entry || '').trim()).filter(Boolean);
// }
// 
// /** SendGrid HTTP API is used for tracked mail; multi-To / CC / BCC are more reliable via SMTP relay. */
// function shouldUseSendGridHttpApi(options: SendMailOptions): boolean {
//     if (!useSendgrid || !options.trackingId?.trim()) return false;
//     const hasCc = listRecipientEmails(options.cc).length > 0;
//     const hasBcc = listRecipientEmails(options.bcc).length > 0;
//     const toCount = listRecipientEmails(options.to).length;
//     return !hasCc && !hasBcc && toCount <= 1;
// }
// 
// function toSendGridApiAttachments(
//     attachments?: SendMailOptions['attachments'],
// ): Array<{
//     content: string;
//     type: string;
//     filename: string;
//     disposition: 'inline' | 'attachment';
//     content_id?: string;
// }> {
//     if (!attachments?.length) return [];
//     const out: Array<{
//         content: string;
//         type: string;
//         filename: string;
//         disposition: 'inline' | 'attachment';
//         content_id?: string;
//     }> = [];
// 
//     for (const attachment of attachments) {
//         let buffer: Buffer | null = null;
//         if (attachment.content) {
//             buffer = Buffer.isBuffer(attachment.content)
//                 ? attachment.content
//                 : Buffer.from(String(attachment.content));
//         } else if (attachment.path && fs.existsSync(attachment.path)) {
//             buffer = fs.readFileSync(attachment.path);
//         }
//         if (!buffer) continue;
// 
//         const filename =
//             (typeof attachment.filename === 'string' && attachment.filename) ||
//             (attachment.path ? attachment.path.split(/[/\\]/).pop() || 'attachment' : 'attachment');
// 
//         out.push({
//             content: buffer.toString('base64'),
//             type: attachment.contentType || 'application/octet-stream',
//             filename,
//             disposition: attachment.contentDisposition === 'inline' ? 'inline' : 'attachment',
//             ...(attachment.cid ? { content_id: attachment.cid } : {}),
//         });
//     }
//     return out;
// }
// 
// /**
//  * Send via SendGrid Mail Send HTTP API (v3). Unlike SMTP + X-SMTPAPI, `custom_args`
//  * reliably appear on Event Webhook payloads as top-level `ocid`.
//  */
// function buildThreadingHeaders(options: Pick<SendMailOptions, 'inReplyTo' | 'references'>): Record<string, string> | undefined {
//     const headers: Record<string, string> = {};
//     const inReplyTo = String(options.inReplyTo || '').trim();
//     const references = String(options.references || '').trim();
//     if (inReplyTo) headers['In-Reply-To'] = inReplyTo;
//     if (references) headers.References = references;
//     return Object.keys(headers).length ? headers : undefined;
// }
// 
// async function sendViaSendGridHttpApi(options: SendMailOptions): Promise<SendMailResult> {
//     if (!sendgridApiKey) {
//         throw new Error('SendGrid API key is not configured');
//     }
// 
//     const {
//         to,
//         subject,
//         html,
//         from,
//         cc,
//         bcc,
//         replyTo,
//         attachments,
//         trackingId,
//         enableOpenTracking,
//         enableClickTracking,
//         categories,
//         inReplyTo,
//         references,
//     } = options;
// 
//     const threadingHeaders = buildThreadingHeaders({ inReplyTo, references });
//     const fromAddr = await resolveFromHeader(from);
//     const wantsTracking = Boolean(trackingId?.trim());
//     const openTracking =
//         enableOpenTracking ?? (wantsTracking && isSendGridOpenPixelTrackingEnabled());
//     const clickTracking =
//         enableClickTracking ?? (wantsTracking && isSendGridClickTrackingEnabled());
// 
//     const personalization: Record<string, unknown> = {
//         to: normalizeRecipients(to),
//     };
//     const ccRecipients = normalizeRecipients(listRecipientEmails(cc));
//     const bccRecipients = normalizeRecipients(listRecipientEmails(bcc));
//     if (ccRecipients.length) personalization.cc = ccRecipients;
//     if (bccRecipients.length) personalization.bcc = bccRecipients;
//     if (trackingId?.trim()) {
//         personalization.custom_args = { ocid: trackingId.trim() };
//     }
// 
//     const payload: Record<string, unknown> = {
//         personalizations: [personalization],
//         from: { email: fromAddr.address, name: fromAddr.name },
//         subject,
//         content: [{ type: 'text/html', value: html }],
//     };
// 
//     if (replyTo) payload.reply_to = { email: extractEmailAddress(String(replyTo)) };
//     if (threadingHeaders) payload.headers = threadingHeaders;
//     if (categories?.length) payload.categories = categories;
// 
//     const apiAttachments = toSendGridApiAttachments(attachments);
//     if (apiAttachments.length) payload.attachments = apiAttachments;
// 
//     if (openTracking || clickTracking) {
//         payload.tracking_settings = {
//             ...(openTracking ? { open_tracking: { enable: true } } : {}),
//             ...(clickTracking
//                 ? { click_tracking: { enable: true, enable_text: true } }
//                 : {}),
//         };
//     }
// 
//     const recipients = normalizeRecipients(to).map((r) => r.email);
// 
//     const response = await postToSendGridMailApi(JSON.stringify(payload));
// 
//     if (!response.ok) {
//         const errorBody = await response.text();
//         if (
//             response.status === 401 &&
//             /maximum credits exceeded/i.test(errorBody)
//         ) {
//             throw new Error(
//                 'SendGrid email credits exceeded. Add credits or upgrade your SendGrid plan, then try again.',
//             );
//         }
//         throw new Error(`SendGrid API send failed (${response.status}): ${errorBody}`);
//     }
// 
//     const messageId = response.headers.get('x-message-id') ?? undefined;
// 
//     return {
//         messageId: messageId ?? undefined,
//         accepted: recipients,
//         rejected: [],
//     };
// }
// 
// const sendMail = async (
//     optionsOrTo: SendMailOptions | string,
//     legacySubject?: string,
//     legacyHtml?: string,
// ) => {
//     try {
//         const options: SendMailOptions =
//             typeof optionsOrTo === 'string'
//                 ? {
//                       to: optionsOrTo,
//                       subject: legacySubject || '',
//                       html: legacyHtml || '',
//                   }
//                 : optionsOrTo;
// 
//         const {
//             to,
//             subject,
//             html,
//             from,
//             cc,
//             bcc,
//             replyTo,
//             attachments,
//             trackingId,
//             enableOpenTracking,
//             enableClickTracking,
//             categories,
//             inReplyTo,
//             references,
//         } = options;
// 
//         const htmlWithBrandLogo = rewriteBrandLogoUrlsForEmail(String(html || ''));
//         const optionsWithBrandLogo: SendMailOptions = { ...options, html: htmlWithBrandLogo };
// 
//         const threadingHeaders = buildThreadingHeaders({ inReplyTo, references });
// 
//         // Tracked mail uses the HTTP API so `custom_args.ocid` is present on webhooks.
//         // When CC/BCC are present, prefer SMTP relay — CC delivery is unreliable on HTTP API.
//         if (shouldUseSendGridHttpApi(optionsWithBrandLogo)) {
//             return sendViaSendGridHttpApi(optionsWithBrandLogo);
//         }
// 
//         const smtpApiHeader = useSendgrid
//             ? buildSendGridSmtpApiHeader({
//                   trackingId,
//                   enableOpenTracking,
//                   enableClickTracking,
//                   categories,
//               })
//             : undefined;
// 
//         const mailOptions = {
//             from: await resolveFromHeader(from),
//             to,
//             subject,
//             html: htmlWithBrandLogo,
//             cc,
//             bcc,
//             replyTo,
//             ...(attachments?.length ? { attachments } : {}),
//             ...(smtpApiHeader || threadingHeaders
//                 ? {
//                       headers: {
//                           ...(smtpApiHeader ? { 'X-SMTPAPI': smtpApiHeader } : {}),
//                           ...(threadingHeaders ?? {}),
//                       },
//                   }
//                 : {}),
//         };
// 
//         const response = await transporter.sendMail(mailOptions);
//         return response;
//     } catch (error) {
//         console.error('SMTP sendMail failed:', error);
//         throw error;
//     }
// };
// 
// /** Deliver one SendGrid message (no CC/BCC/multi-To split). */
// async function deliverSendGridMailOnce(options: SendMailOptions): Promise<SendMailResult> {
//     // Tracked sends use the HTTP API so `custom_args.ocid` is present on webhooks.
//     if (shouldUseSendGridHttpApi(options)) {
//         return sendViaSendGridHttpApi({
//             ...options,
//             from: await resolveMailSender(options.from, { sendgridOnly: true }),
//         });
//     }
// 
//     const transporter = getSendGridTransporter();
//     const {
//         to,
//         subject,
//         html,
//         from,
//         cc,
//         bcc,
//         replyTo,
//         attachments,
//         trackingId,
//         enableOpenTracking,
//         enableClickTracking,
//         categories,
//         inReplyTo,
//         references,
//     } = options;
//     const threadingHeaders = buildThreadingHeaders({ inReplyTo, references });
//     const smtpApiHeader = buildSendGridSmtpApiHeader({
//         trackingId,
//         enableOpenTracking,
//         enableClickTracking,
//         categories,
//     });
// 
//     const mailOptions = {
//         from: await resolveFromHeader(from, { sendgridOnly: true }),
//         to,
//         subject,
//         html,
//         cc,
//         bcc,
//         replyTo,
//         ...(attachments?.length ? { attachments } : {}),
//         ...(smtpApiHeader || threadingHeaders
//             ? {
//                   headers: {
//                       ...(smtpApiHeader ? { 'X-SMTPAPI': smtpApiHeader } : {}),
//                       ...(threadingHeaders ?? {}),
//                   },
//               }
//             : {}),
//     };
//     try {
//         return (await transporter.sendMail(mailOptions)) as SendMailResult;
//     } catch (error) {
//         throw explainSendGridSmtpError(error);
//     }
// }
// 
// /**
//  * SendGrid answers an exhausted plan with an SMTP auth failure ("Invalid login:
//  * 451 Authentication failed: Maximum credits exceeded"), which reads like a bad
//  * API key. Say what it actually is; the HTTP API path does the same.
//  */
// function explainSendGridSmtpError(error: unknown): unknown {
//     const message = error instanceof Error ? error.message : String(error);
//     if (/maximum credits exceeded/i.test(message)) {
//         return new Error(
//             'SendGrid email credits exceeded. Add credits or upgrade your SendGrid plan, then try again.',
//         );
//     }
//     return error;
// }
// 
// /**
//  * When CC/BCC/extra To would force SMTP relay, webhook `ocid` matching is unreliable.
//  * Send the primary recipient via the HTTP API with tracking; deliver copies separately.
//  */
// function shouldSplitTrackedSendGridDelivery(options: SendMailOptions): boolean {
//     const trackingId = options.trackingId?.trim();
//     if (!trackingId) return false;
//     const toCount = listRecipientEmails(options.to).length;
//     const hasCc = listRecipientEmails(options.cc).length > 0;
//     const hasBcc = listRecipientEmails(options.bcc).length > 0;
//     return toCount > 1 || hasCc || hasBcc;
// }
// 
// /** Send mail via SendGrid SMTP only (never Gmail OAuth or Gmail SMTP). */
// export async function sendSendGridMail(options: SendMailOptions): Promise<SendMailResult> {
//     if (!sendgridApiKey) {
//         throw new Error(
//             'SendGrid is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL on the server.',
//         );
//     }
// 
//     // Resolve once up front: every split copy carries the same sender identity,
//     // and a missing sender name fails the send before anything is delivered.
//     options = { ...options, from: await resolveMailSender(options.from, { sendgridOnly: true }) };
// 
//     if (shouldSplitTrackedSendGridDelivery(options)) {
//         const toList = listRecipientEmails(options.to);
//         const ccList = listRecipientEmails(options.cc);
//         const bccList = listRecipientEmails(options.bcc);
//         const [primaryTo, ...extraTo] = toList;
//         if (!primaryTo) {
//             throw new Error('At least one recipient (to) is required');
//         }
// 
//         const primaryResult = await deliverSendGridMailOnce({
//             ...options,
//             to: primaryTo,
//             cc: undefined,
//             bcc: undefined,
//         });
// 
//         const copyRecipients = [...extraTo, ...ccList, ...bccList];
//         for (const recipient of copyRecipients) {
//             const { trackingId: _trackingId, ...copyOptions } = options;
//             await deliverSendGridMailOnce({
//                 ...copyOptions,
//                 to: recipient,
//                 cc: undefined,
//                 bcc: undefined,
//             });
//         }
// 
//         return primaryResult;
//     }
// 
//     return deliverSendGridMailOnce(options);
// }
// 
// export default sendMail;
