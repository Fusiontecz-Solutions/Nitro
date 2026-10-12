/**
 * Server-wide Gmail API mailer (replaces SendGrid — adapted from Katan
 * `config/gmailApiMailer.ts`).
 *
 * Every outbound CRM email goes out from one Google mailbox:
 *   GMAIL_SENDER_EMAIL          — the mailbox address (also the From address)
 *   GMAIL_SENDER_REFRESH_TOKEN  — optional; otherwise the refresh token of the CRM
 *                                 user who connected that mailbox (Settings → Email)
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET — OAuth client that minted the token
 *
 * Messages are built with nodemailer's MailComposer (CC / BCC / Reply-To / inline
 * CID images / attachments) and posted to `users.messages.send` with an optional
 * `threadId`, so replies land on the same Gmail conversation. Gmail has no
 * delivery webhooks — mail-log rows stay at "sent".
 */
import MailComposer from 'nodemailer/lib/mail-composer';
import type Mail from 'nodemailer/lib/mailer';
import axios from 'axios';
import prisma from './prismaClient';
import { getAccessTokenForRefreshToken, invalidateAccessTokenCache, isGoogleOAuthConfigured } from './gmail';
import { getGmailAccessTokenForUser } from '../services/gmail/gmailOAuthService';

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SYSTEM_TOKEN_CACHE_KEY = 'gmail-system-sender';

export function getGmailSenderEmail(): string {
    return String(process.env.GMAIL_SENDER_EMAIL || '').trim().toLowerCase();
}

/** True when the server-wide Gmail sender is configured (mailbox + OAuth client). */
export function isGmailApiMailerConfigured(): boolean {
    return Boolean(getGmailSenderEmail() && isGoogleOAuthConfigured());
}

export interface GmailMailbox {
    email: string;
    accessToken: string;
    /** CRM user whose connection backs the mailbox; null for the env refresh token. */
    userId: string | null;
}

/** Access token for the server-wide sender mailbox, or null when unavailable. */
export async function getSystemGmailMailbox(options?: { forceRefresh?: boolean }): Promise<GmailMailbox | null> {
    const email = getGmailSenderEmail();
    if (!email || !isGoogleOAuthConfigured()) return null;

    const envRefreshToken = String(process.env.GMAIL_SENDER_REFRESH_TOKEN || '').trim();
    if (envRefreshToken) {
        if (options?.forceRefresh) invalidateAccessTokenCache(SYSTEM_TOKEN_CACHE_KEY);
        const accessToken = await getAccessTokenForRefreshToken(envRefreshToken, SYSTEM_TOKEN_CACHE_KEY);
        return accessToken ? { email, accessToken, userId: null } : null;
    }

    const owner = await prisma.user.findFirst({
        where: {
            googleRefreshToken: { not: null },
            OR: [
                { googleEmail: { equals: email, mode: 'insensitive' } },
                { email: { equals: email, mode: 'insensitive' } },
            ],
        },
        select: { id: true },
        orderBy: { googleConnectedAt: 'desc' },
    });
    if (!owner) return null;
    if (options?.forceRefresh) invalidateAccessTokenCache(`user:${owner.id}`);
    const accessToken = await getGmailAccessTokenForUser(owner.id);
    return accessToken ? { email, accessToken, userId: owner.id } : null;
}

export type GmailApiAttachment = NonNullable<Mail.Options['attachments']>[number];

export interface GmailApiSendOptions {
    accessToken: string;
    from: { name: string; address: string };
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    subject: string;
    html: string;
    attachments?: GmailApiAttachment[];
    /** Gmail thread to append to (must belong to the sending mailbox). */
    threadId?: string;
    inReplyTo?: string;
    references?: string;
}

export interface GmailApiSendResult {
    /** Gmail API message id. */
    gmailMessageId: string;
    gmailThreadId: string;
    /** RFC 5322 Message-ID set on the outgoing message. */
    rfcMessageId: string;
    accepted: string[];
}

const toBase64Url = (buffer: Buffer): string =>
    buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const listOf = (value?: string | string[]): string[] =>
    (Array.isArray(value) ? value : value ? [value] : []).map((v) => String(v || '').trim()).filter(Boolean);

function domainOf(address: string): string {
    return address.split('@')[1] || 'mail.gmail.com';
}

/** Build the raw RFC 2822 message (BCC kept so Gmail delivers to it, then strips it). */
export async function buildGmailRawMessage(
    options: Omit<GmailApiSendOptions, 'accessToken' | 'threadId'>,
): Promise<{ raw: string; rfcMessageId: string }> {
    const rfcMessageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}@${domainOf(options.from.address)}>`;
    const composer = new MailComposer({
        from: options.from,
        to: listOf(options.to),
        cc: listOf(options.cc),
        bcc: listOf(options.bcc),
        replyTo: options.replyTo || undefined,
        subject: options.subject,
        html: options.html,
        attachments: options.attachments,
        messageId: rfcMessageId,
        inReplyTo: options.inReplyTo || undefined,
        references: options.references || undefined,
    });
    const mail = composer.compile();
    (mail as unknown as { keepBcc: boolean }).keepBcc = true;
    const buffer: Buffer = await new Promise((resolve, reject) =>
        mail.build((err, message) => (err ? reject(err) : resolve(message))),
    );
    return { raw: toBase64Url(buffer), rfcMessageId };
}

const gmailErrorMessage = (error: any): string =>
    error?.response?.data?.error?.message || error?.message || 'Gmail send failed';

/** Send one message through the Gmail API. Throws on failure. */
export async function sendViaGmailApi(
    options: GmailApiSendOptions,
    retryWithFreshToken?: () => Promise<string | null>,
): Promise<GmailApiSendResult> {
    const { raw, rfcMessageId } = await buildGmailRawMessage(options);
    const body = { raw, ...(options.threadId ? { threadId: options.threadId } : {}) };

    const post = (accessToken: string) =>
        axios.post(GMAIL_SEND_URL, body, {
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            timeout: 60_000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });

    let response;
    try {
        response = await post(options.accessToken);
    } catch (error: any) {
        // A cached token may have been revoked/expired early — retry once with a fresh one.
        if (error?.response?.status === 401 && retryWithFreshToken) {
            const fresh = await retryWithFreshToken().catch(() => null);
            if (!fresh) throw new Error(gmailErrorMessage(error));
            try {
                response = await post(fresh);
            } catch (retryError) {
                throw new Error(gmailErrorMessage(retryError));
            }
        } else {
            throw new Error(gmailErrorMessage(error));
        }
    }

    return {
        gmailMessageId: String(response.data?.id ?? ''),
        gmailThreadId: String(response.data?.threadId ?? ''),
        rfcMessageId,
        accepted: [...listOf(options.to), ...listOf(options.cc), ...listOf(options.bcc)],
    };
}
