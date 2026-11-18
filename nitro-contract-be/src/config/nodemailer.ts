/**
 * Central outbound mailer. Every `sendMail` / `sendSendGridMail` call is routed by funder:
 *
 *   funder on 'gmail'    → the funder's connected Gmail mailbox (FunderMailbox)
 *   funder on 'sendgrid' → SendGrid with the funder's verified sender   ← default
 *   no funder yet        → the server Gmail mailbox (GMAIL_SENDER_EMAIL)
 *
 * The funder comes from `funderProfileId` / `funderName`, else the deal
 * (`threadApplicationId` / `applicationId`) — see services/mail/mailRouting.
 *
 * Deal emails (`threadApplicationId`) stay on the deal's conversation whatever the
 * provider: Gmail continues the stored thread id; SendGrid replies by
 * In-Reply-To / References (applicationEmailThreadService).
 *
 * Safety:
 *   - another provider is tried only when the previous one certainly did not
 *     send (MailDeliveryError kind `not_sent`); a timeout / 5xx is never resent;
 *   - deal emails carry a durable idempotency key (MailSendClaim), so a double
 *     submit, duplicate request or job retry cannot email the ISO twice.
 */
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import prisma from './prismaClient';
import { resolveMailSender, type MailSender } from '../services/mailSenderIdentity';
import { rewriteBrandLogoUrlsForEmail } from '../constants/brand';
import {
    getGmailSenderEmail,
    getSystemGmailMailbox,
    isGmailApiMailerConfigured,
    sendViaGmailApi,
    type GmailMailbox,
} from './gmailApiMailer';
import {
    isSendGridClickTrackingEnabled,
    isSendGridConfigured,
    isSendGridOpenPixelTrackingEnabled,
    isRetryableSendGridFailure,
    sendViaSendGrid,
} from './sendgridMailer';
import { sendOnApplicationChainExternal, sendOnApplicationThread } from '../services/applicationEmailThreadService';
import {
    getFunderGmailMailboxForSend,
    markFunderMailboxNeedsReconnect,
    markFunderMailboxUsed,
    recordFunderMailboxError,
} from '../services/gmail/funderGmailOAuthService';
import { resolveMailFunder, planMailRoutes, type MailFunder, type MailRoute } from '../services/mail/mailRouting';
import {
    DuplicateMailSendError,
    MailDeliveryError,
    classifySmtpFailure,
    isSafeToFallback,
    notSent,
    type MailProviderName,
} from '../services/mail/mailErrors';
import {
    buildDealMailIdempotencyKey,
    claimMailSend,
    completeMailSend,
    failMailSend,
    getMailSendClaim,
    type ClaimedMailSend,
} from '../services/mail/mailSendClaims';

export { isSendGridConfigured, isSendGridOpenPixelTrackingEnabled, isSendGridClickTrackingEnabled, isRetryableSendGridFailure };

/** @deprecated Use isSendGridOpenPixelTrackingEnabled / isSendGridClickTrackingEnabled */
export function isSendGridEngagementTrackingEnabled(): boolean {
    return isSendGridOpenPixelTrackingEnabled() || isSendGridClickTrackingEnabled();
}

function isSmtpFallbackConfigured(): boolean {
    return Boolean(process.env.SMTP_AUTH_USER?.trim() && process.env.SMTP_AUTH_PASS?.trim());
}

/** True when outbound mail can be sent (SendGrid, server Gmail mailbox or Gmail SMTP). */
export function isOutboundMailConfigured(): boolean {
    return isSendGridConfigured() || isGmailApiMailerConfigured() || isSmtpFallbackConfigured();
}

/** @deprecated Use {@link isOutboundMailConfigured}. */
export function isOutboundSmtpConfigured(): boolean {
    return isOutboundMailConfigured();
}

/** Transport for mail with no funder (server mailbox), for logs / provider fields. */
export function describeMailTransport(): 'gmail' | 'sendgrid' | 'smtp' | 'none' {
    if (isGmailApiMailerConfigured()) return 'gmail';
    if (isSendGridConfigured()) return 'sendgrid';
    if (isSmtpFallbackConfigured()) return 'smtp';
    return 'none';
}

/** Display name for a Gmail / SMTP send (Gmail rewrites any From address but a verified alias). */
async function resolveFromName(from: SendMailOptions['from'], funder?: MailFunder | null): Promise<string> {
    try {
        if (from) return (await resolveMailSender(from)).name;
        if (funder?.sender) return funder.sender.name;
        return (await resolveMailSender(undefined)).name;
    } catch {
        return (
            funder?.sender?.name ||
            process.env.GMAIL_SENDER_NAME?.trim() ||
            process.env.MAIL_FROM_NAME?.trim() ||
            process.env.SENDGRID_FROM_NAME?.trim() ||
            getGmailSenderEmail()
        );
    }
}

/** Startup diagnostics: default provider and the no-funder mailbox. */
export async function describeDefaultMailSender(): Promise<string> {
    const parts: string[] = [];
    if (isSendGridConfigured()) {
        try {
            const sender = await resolveMailSender(undefined, { sendgridOnly: true });
            parts.push(`funder default: SendGrid "${sender.name}" <${sender.email}>`);
        } catch (error) {
            parts.push(`funder default: SendGrid NOT READY — ${(error as Error).message}`);
        }
    } else {
        parts.push('funder default: SendGrid NOT CONFIGURED (SENDGRID_API_KEY)');
    }
    parts.push(
        isGmailApiMailerConfigured()
            ? `no-funder mail: Gmail API <${getGmailSenderEmail()}>`
            : 'no-funder mail: Gmail API NOT CONFIGURED (GMAIL_SENDER_EMAIL + GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)',
    );
    return parts.join('; ');
}

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
     * Sender identity. SendGrid uses it as the verified From; Gmail uses only the
     * display name (the address is the sending mailbox). Omit for the funder's /
     * default sender.
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
     * OutboundCommunication id of the mail-log row. SendGrid echoes it back on the
     * Event Webhook (`ocid`); provider / mailbox / message ids are written to its
     * metadata after the send.
     */
    trackingId?: string;
    /**
     * Deal whose ISO conversation this message belongs to. When set the mail
     * replies on that conversation (approval / offer / decline / document request /
     * comments) and the chain state is stored in the DB.
     */
    threadApplicationId?: string;
    /** Acting CRM user; their connected Gmail starts a new deal thread when no funder mailbox applies. */
    threadSenderUserId?: string | null;
    /** Deal this (non-threaded) email belongs to — used to find its funder and for idempotency. */
    applicationId?: string | null;
    /** Funder this email belongs to (overrides the deal lookup). */
    funderProfileId?: string | null;
    funderName?: string | null;
    /**
     * Send through SendGrid, or the funder's own connected Gmail when the funder
     * is on Gmail — never the server Gmail mailbox or Gmail SMTP, which would
     * replace the sender's address with the mailbox's. A SendGrid failure is
     * thrown, not retried on another provider.
     */
    sendgridOnly?: boolean;
    /**
     * Durable idempotency key (one physical email). Deal emails get an automatic
     * key; pass `false` to opt out (e.g. an intentional identical resend).
     */
    idempotencyKey?: string | false;
    /** Override open tracking (SendGrid, default ON when `trackingId` is set). */
    enableOpenTracking?: boolean;
    /** Override link click tracking (SendGrid, default ON when `trackingId` is set). */
    enableClickTracking?: boolean;
    /** SendGrid categories for analytics / filtering. */
    categories?: string[];
}

export type SendMailResult = {
    /** Provider message id: SendGrid `x-message-id` (webhook matching) or the RFC Message-ID for Gmail. */
    messageId?: string;
    /** RFC 5322 Message-ID of the sent email. */
    rfcMessageId?: string;
    gmailMessageId?: string;
    gmailThreadId?: string;
    accepted?: string[];
    rejected?: string[];
    provider?: MailProviderName;
    /** Mailbox / sender address the email went out from. */
    mailboxEmail?: string;
    funderProfileId?: string | null;
    /** True when an identical email was already sent and this call did not send again. */
    deduplicated?: boolean;
};

type Prepared = SendMailOptions & { html: string; applicationId: string | null };

const listOf = (value?: string | string[]): string[] =>
    (Array.isArray(value) ? value : value ? [value] : []).map((v) => String(v || '').trim()).filter(Boolean);

function newRfcMessageId(fromEmail: string): string {
    const domain = String(fromEmail || '').split('@')[1] || 'mail.local';
    return `<${Date.now().toString(36)}.${crypto.randomBytes(6).toString('hex')}@${domain}>`;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function sendFromGmailMailbox(
    options: Prepared,
    mailbox: GmailMailbox,
    fromName: string,
    refresh: () => Promise<string | null>,
): Promise<SendMailResult> {
    if (options.threadApplicationId) {
        const sent = await sendOnApplicationThread({
            applicationId: options.threadApplicationId,
            senderUserId: options.threadSenderUserId ?? null,
            to: options.to,
            cc: options.cc,
            bcc: options.bcc,
            replyTo: options.replyTo,
            subject: options.subject,
            html: options.html,
            attachments: options.attachments as never,
            fromName,
            mailbox,
            refreshMailboxToken: refresh,
        });
        return {
            messageId: sent.rfcMessageId ?? undefined,
            rfcMessageId: sent.rfcMessageId ?? undefined,
            gmailMessageId: sent.gmailMessageId,
            gmailThreadId: sent.gmailThreadId,
            accepted: sent.accepted,
            rejected: [],
            provider: 'gmail',
            mailboxEmail: sent.mailboxEmail,
        };
    }
    const sent = await sendViaGmailApi(
        {
            accessToken: mailbox.accessToken,
            from: { name: fromName, address: mailbox.fromEmail || mailbox.email },
            to: options.to,
            cc: options.cc,
            bcc: options.bcc,
            replyTo: options.replyTo,
            subject: options.subject,
            html: options.html,
            attachments: options.attachments as never,
            inReplyTo: options.inReplyTo,
            references: options.references,
        },
        refresh,
    );
    return {
        messageId: sent.rfcMessageId,
        rfcMessageId: sent.rfcMessageId,
        gmailMessageId: sent.gmailMessageId,
        gmailThreadId: sent.gmailThreadId,
        accepted: sent.accepted,
        rejected: [],
        provider: 'gmail',
        mailboxEmail: mailbox.email,
    };
}

async function sendViaFunderGmail(options: Prepared, funder: MailFunder): Promise<SendMailResult> {
    let mailbox;
    try {
        mailbox = await getFunderGmailMailboxForSend(funder.id);
    } catch (error) {
        throw notSent(`Funder Gmail token refresh failed: ${(error as Error)?.message}`, 'gmail', error);
    }
    if (!mailbox) throw notSent(`Funder "${funder.name}" Gmail mailbox is not connected.`, 'gmail');
    const funderMailboxId = mailbox.funderMailboxId;
    const refresh = async () => (await getFunderGmailMailboxForSend(funder.id, { forceRefresh: true }).catch(() => null))?.accessToken ?? null;
    try {
        const result = await sendFromGmailMailbox(options, mailbox, await resolveFromName(options.from, funder), refresh);
        markFunderMailboxUsed(funderMailboxId);
        return { ...result, funderProfileId: funder.id };
    } catch (error) {
        if (error instanceof MailDeliveryError && (error.status === 401 || error.status === 403)) {
            // Revoked grant / missing scope: the mailbox needs an admin to reconnect it.
            await markFunderMailboxNeedsReconnect(funderMailboxId, `Gmail rejected the send (${error.status}): ${error.message}`);
        } else {
            await recordFunderMailboxError(funderMailboxId, (error as Error)?.message || 'Gmail send failed');
        }
        throw error;
    }
}

async function sendViaSystemGmail(options: Prepared, funder: MailFunder | null): Promise<SendMailResult> {
    if (!isGmailApiMailerConfigured() && !options.threadApplicationId) {
        throw notSent('Server Gmail mailbox is not configured (GMAIL_SENDER_EMAIL).', 'gmail');
    }
    const fromName = await resolveFromName(options.from, funder);
    if (options.threadApplicationId) {
        // Existing deal-thread rules: thread owner, the acting user's Gmail, else the server mailbox.
        const sent = await sendOnApplicationThread({
            applicationId: options.threadApplicationId,
            senderUserId: options.threadSenderUserId ?? null,
            to: options.to,
            cc: options.cc,
            bcc: options.bcc,
            replyTo: options.replyTo,
            subject: options.subject,
            html: options.html,
            attachments: options.attachments as never,
            fromName,
        });
        return {
            messageId: sent.rfcMessageId ?? undefined,
            rfcMessageId: sent.rfcMessageId ?? undefined,
            gmailMessageId: sent.gmailMessageId,
            gmailThreadId: sent.gmailThreadId,
            accepted: sent.accepted,
            rejected: [],
            provider: 'gmail',
            mailboxEmail: sent.mailboxEmail,
        };
    }
    let mailbox: GmailMailbox | null;
    try {
        mailbox = await getSystemGmailMailbox();
    } catch (error) {
        throw notSent(`Server Gmail token refresh failed: ${(error as Error)?.message}`, 'gmail', error);
    }
    if (!mailbox) {
        throw notSent(
            `Gmail sender ${getGmailSenderEmail()} is not connected. Connect that mailbox (Settings → Email) or set GMAIL_SENDER_REFRESH_TOKEN.`,
            'gmail',
        );
    }
    return sendFromGmailMailbox(options, mailbox, fromName, async () => (await getSystemGmailMailbox({ forceRefresh: true }))?.accessToken ?? null);
}

async function sendViaSendGridRoute(options: Prepared, funder: MailFunder | null): Promise<SendMailResult> {
    if (!isSendGridConfigured()) throw notSent('SendGrid is not configured (SENDGRID_API_KEY).', 'sendgrid');
    const from = options.from ?? funder?.sender ?? undefined;
    let fromEmail: string;
    try {
        fromEmail = (await resolveMailSender(from, { sendgridOnly: true })).email;
    } catch (error) {
        throw notSent((error as Error)?.message || 'SendGrid sender is not configured', 'sendgrid', error);
    }
    const base = {
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
        html: options.html,
        from,
        attachments: options.attachments,
        trackingId: options.trackingId,
        enableOpenTracking: options.enableOpenTracking,
        enableClickTracking: options.enableClickTracking,
        categories: options.categories,
    };

    if (options.threadApplicationId) {
        const sent = await sendOnApplicationChainExternal(
            { applicationId: options.threadApplicationId, to: options.to, subject: options.subject, provider: 'sendgrid' },
            (headers) =>
                sendViaSendGrid({
                    ...base,
                    subject: headers.subject,
                    inReplyTo: headers.inReplyTo,
                    references: headers.references,
                    messageId: newRfcMessageId(fromEmail),
                }),
        );
        return {
            messageId: sent.messageId,
            rfcMessageId: sent.rfcMessageId,
            accepted: sent.accepted,
            rejected: sent.rejected,
            provider: 'sendgrid',
            mailboxEmail: fromEmail,
            funderProfileId: funder?.id ?? null,
        };
    }
    const sent = await sendViaSendGrid({
        ...base,
        subject: options.subject,
        inReplyTo: options.inReplyTo,
        references: options.references,
        messageId: newRfcMessageId(fromEmail),
    });
    return {
        messageId: sent.messageId,
        rfcMessageId: sent.rfcMessageId,
        accepted: sent.accepted,
        rejected: sent.rejected,
        provider: 'sendgrid',
        mailboxEmail: fromEmail,
        funderProfileId: funder?.id ?? null,
    };
}

async function sendViaSmtpRoute(options: Prepared, funder: MailFunder | null): Promise<SendMailResult> {
    if (!isSmtpFallbackConfigured()) throw notSent('Gmail SMTP fallback is not configured (SMTP_AUTH_USER / SMTP_AUTH_PASS).', 'smtp');
    const threading: Record<string, string> = {};
    if (options.inReplyTo?.trim()) threading['In-Reply-To'] = options.inReplyTo.trim();
    if (options.references?.trim()) threading.References = options.references.trim();
    const address = String(process.env.SMTP_AUTH_USER || '').trim();
    try {
        const response = await getSmtpTransporter().sendMail({
            from: { name: await resolveFromName(options.from, funder), address },
            to: options.to,
            subject: options.subject,
            html: options.html,
            cc: options.cc,
            bcc: options.bcc,
            replyTo: options.replyTo,
            ...(options.attachments?.length ? { attachments: options.attachments } : {}),
            ...(Object.keys(threading).length ? { headers: threading } : {}),
        });
        return {
            messageId: response?.messageId,
            rfcMessageId: response?.messageId,
            accepted: (response?.accepted ?? []).map(String),
            rejected: (response?.rejected ?? []).map(String),
            provider: 'smtp',
            mailboxEmail: address,
            funderProfileId: funder?.id ?? null,
        };
    } catch (error) {
        throw new MailDeliveryError(`Gmail SMTP send failed: ${(error as Error)?.message}`, {
            kind: classifySmtpFailure(error),
            provider: 'smtp',
            cause: error,
        });
    }
}

const ROUTES: Record<MailRoute, (options: Prepared, funder: MailFunder | null) => Promise<SendMailResult>> = {
    funder_gmail: (options, funder) => sendViaFunderGmail(options, funder!),
    sendgrid: sendViaSendGridRoute,
    system_gmail: sendViaSystemGmail,
    smtp: sendViaSmtpRoute,
};

async function deliver(options: Prepared): Promise<SendMailResult> {
    let funder: MailFunder | null = null;
    try {
        funder = await resolveMailFunder({
            funderProfileId: options.funderProfileId,
            funderName: options.funderName,
            applicationId: options.applicationId,
        });
    } catch (error) {
        console.warn('[mail] funder lookup failed, sending as no-funder mail:', (error as Error)?.message);
    }

    // The funder's own Gmail sends from the funder's address, so it is allowed for SendGrid-only mail.
    const routes: MailRoute[] = options.sendgridOnly
        ? funder?.mailProvider === 'gmail' ? ['funder_gmail', 'sendgrid'] : ['sendgrid']
        : planMailRoutes(funder);
    let lastError: unknown = null;
    for (const [index, route] of routes.entries()) {
        try {
            return await ROUTES[route](options, funder);
        } catch (error) {
            lastError = error;
            const more = index < routes.length - 1;
            if (!isSafeToFallback(error) || !more) throw error;
            console.warn(
                `[mail] ${route} did not send (${(error as Error)?.message}); trying ${routes[index + 1]}`,
                options.applicationId ? `application=${options.applicationId}` : '',
            );
        }
    }
    throw lastError ?? new Error('No outbound mail transport is configured.');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Store provider / mailbox / message ids on the mail-log row so a send can be traced. */
async function recordDeliveryOnOutbound(trackingId: string | undefined, result: SendMailResult): Promise<void> {
    const id = String(trackingId || '').trim();
    if (!id || !result.provider) return;
    try {
        const existing = await prisma.outbound_communications.findUnique({ where: { id }, select: { metadata: true } });
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
                    provider: result.provider,
                    mailboxEmail: result.mailboxEmail ?? null,
                    funderProfileId: result.funderProfileId ?? null,
                    rfcMessageId: result.rfcMessageId ?? null,
                    ...(result.gmailMessageId
                        ? { gmailMessageId: result.gmailMessageId, gmailThreadId: result.gmailThreadId ?? null }
                        : {}),
                } as object,
            },
        });
    } catch (err) {
        console.warn('[mail] could not store delivery ids on outbound row:', id, (err as Error)?.message);
    }
}

function resolveIdempotencyKey(options: Prepared): string | null {
    if (options.idempotencyKey === false) return null;
    if (typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim()) return options.idempotencyKey.trim();
    return buildDealMailIdempotencyKey({
        applicationId: options.applicationId,
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        subject: options.subject,
        html: options.html,
    });
}

/**
 * Claim the key. Returns the claim, `null` when the ledger is unavailable (mail
 * still goes out), or a deduplicated result when this exact email was already sent.
 */
async function claimOrDedupe(key: string, options: Prepared): Promise<ClaimedMailSend | SendMailResult | null> {
    try {
        return await claimMailSend({
            idempotencyKey: key,
            applicationId: options.applicationId,
            outboundCommunicationId: options.trackingId || null,
            recipient: listOf(options.to).join(', '),
            subject: options.subject,
        });
    } catch (error) {
        if (error instanceof DuplicateMailSendError) {
            if (error.state === 'sent') {
                const prior = await getMailSendClaim(key).catch(() => null);
                console.info('[mail] duplicate send suppressed (already sent):', key);
                return {
                    deduplicated: true,
                    provider: (prior?.provider as MailProviderName) ?? undefined,
                    // Same shape as a real send: Gmail → RFC Message-ID, SendGrid → x-message-id.
                    messageId: (prior?.provider === 'gmail' ? prior?.rfcMessageId : prior?.providerMessageId) ?? undefined,
                    rfcMessageId: prior?.rfcMessageId ?? undefined,
                    gmailThreadId: prior?.gmailThreadId ?? undefined,
                    mailboxEmail: prior?.mailboxEmail ?? undefined,
                    accepted: listOf(options.to),
                    rejected: [],
                };
            }
            throw error;
        }
        console.warn('[mail] idempotency ledger unavailable, sending without a claim:', (error as Error)?.message);
        return null;
    }
}

const sendMail = async (
    optionsOrTo: SendMailOptions | string,
    legacySubject?: string,
    legacyHtml?: string,
): Promise<SendMailResult> => {
    const raw: SendMailOptions =
        typeof optionsOrTo === 'string'
            ? { to: optionsOrTo, subject: legacySubject || '', html: legacyHtml || '' }
            : optionsOrTo;
    const options: Prepared = {
        ...raw,
        html: rewriteBrandLogoUrlsForEmail(String(raw.html || '')),
        attachments: raw.attachments?.length ? raw.attachments : undefined,
        applicationId: String(raw.threadApplicationId || raw.applicationId || '').trim() || null,
    };

    const key = resolveIdempotencyKey(options);
    const claimed = key ? await claimOrDedupe(key, options) : null;
    if (claimed && 'deduplicated' in claimed) return claimed;
    const claim = claimed as ClaimedMailSend | null;

    let result: SendMailResult;
    try {
        result = await deliver(options);
    } catch (error) {
        if (claim) await failMailSend(claim.claimId, error).catch(() => undefined);
        console.error('sendMail failed:', (error as Error)?.message || error);
        throw error;
    }
    if (claim) {
        await completeMailSend(claim.claimId, {
            provider: result.provider,
            mailboxEmail: result.mailboxEmail,
            funderProfileId: result.funderProfileId,
            providerMessageId: result.gmailMessageId || result.messageId,
            gmailThreadId: result.gmailThreadId,
            rfcMessageId: result.rfcMessageId,
        }).catch((err) => console.warn('[mail] could not mark claim sent:', claim.idempotencyKey, (err as Error)?.message));
    }
    await recordDeliveryOnOutbound(options.trackingId, result);
    return result;
};

/**
 * Legacy name kept for existing callers (contract portal, payment letters,
 * document requests). Routed like every other send: the funder's provider
 * (SendGrid by default) with the funder's sender.
 */
export async function sendSendGridMail(options: SendMailOptions): Promise<SendMailResult> {
    return sendMail(options);
}

export default sendMail;
