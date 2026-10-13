/**
 * One email conversation per deal for every ISO-facing email (adapted from Katan
 * `applicationGmailThreadMailService.ts`).
 *
 * Approval / offer updated / decline / document request / staff reply / ISO offer
 * acceptance all go out on the same chain:
 *   - the first send starts the conversation (or replies to the ISO's original
 *     submission email when the deal was auto-created from Gmail — `gmail-msg:`
 *     marker on `Application.note`);
 *   - every later send carries `In-Reply-To` / `References` built from the stored
 *     Message-ID with a `Re:` subject, plus the stored Gmail `threadId` when the
 *     sending mailbox owns that Gmail thread, so Gmail and the ISO's mail client
 *     keep one chain;
 *   - the thread id, owning mailbox, latest Message-ID and References chain are
 *     persisted in `ApplicationEmailThread` (purpose ISO_APPROVAL) after every send.
 *
 * Mailbox: the caller's preferred mailbox when given (a funder on the Gmail
 * provider), else the one that owns the thread (Gmail thread ids are per
 * mailbox), else the acting user's connected Gmail, else the server-wide sender
 * (GMAIL_SENDER_EMAIL). A chain can also continue over SendGrid
 * ({@link sendOnApplicationChainExternal}) — headers only, no Gmail thread id.
 */
import axios from 'axios';
import prisma from '../config/prismaClient';
import { invalidateAccessTokenCache } from '../config/gmail';
import { ISO_APPROVAL_THREAD_PURPOSE } from '../constants/applicationWorkflow';
import {
    getSystemGmailMailbox,
    sendViaGmailApi,
    type GmailApiAttachment,
    type GmailMailbox,
} from '../config/gmailApiMailer';
import { getGmailAccessTokenForUser } from './gmail/gmailOAuthService';
import { getGmailMessageHeaders } from './gmail/gmailMailService';
import { parseGmailMessageIdFromApplicationNote } from './pdfFileDedupeService';
import { MailDeliveryError, type MailProviderName } from './mail/mailErrors';
import { withDealMailLock } from './mail/dealMailLock';

export const APPLICATION_EMAIL_THREAD_PURPOSE = ISO_APPROVAL_THREAD_PURPOSE;

export interface SendOnApplicationThreadInput {
    applicationId: string;
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    subject: string;
    html: string;
    attachments?: GmailApiAttachment[];
    /** Display name for the From header (address is always the sending mailbox). */
    fromName?: string;
    /** Acting CRM user — their connected Gmail starts a new thread when available. */
    senderUserId?: string | null;
    /**
     * Mailbox that must send this email (a funder's Gmail). It continues the Gmail
     * thread when it owns it; otherwise it replies by headers and takes the thread over.
     */
    mailbox?: GmailMailbox;
    /** Fresh access token for `mailbox` after a 401. */
    refreshMailboxToken?: () => Promise<string | null>;
}

export interface SendOnApplicationThreadResult {
    gmailMessageId: string;
    gmailThreadId: string;
    rfcMessageId: string | null;
    repliedOnExistingThread: boolean;
    mailboxEmail: string;
    subject: string;
    accepted: string[];
}

export const buildReplySubject = (subject: string): string => {
    const trimmed = String(subject || '').trim();
    return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
};

const ensureAngleBrackets = (value: string | null | undefined): string => {
    const v = String(value ?? '').trim();
    if (!v) return '';
    return v.startsWith('<') ? v : `<${v.replace(/^<|>$/g, '')}>`;
};

/** Append a Message-ID to a References chain (deduped, space separated). */
export const appendReference = (references: string | null | undefined, messageId: string | null | undefined): string => {
    const ids = String(references ?? '').split(/\s+/).filter(Boolean);
    const next = ensureAngleBrackets(messageId);
    if (next && !ids.includes(next)) ids.push(next);
    return ids.join(' ');
};

export async function getApplicationEmailThread(applicationId: string) {
    return prisma.applicationEmailThread.findUnique({
        where: { applicationId_purpose: { applicationId, purpose: APPLICATION_EMAIL_THREAD_PURPOSE } },
    });
}

type ThreadRow = Awaited<ReturnType<typeof getApplicationEmailThread>>;

/** True when the deal already has a conversation (Gmail thread or a header-only chain). */
export function hasApplicationEmailChain(thread: ThreadRow): boolean {
    return Boolean(thread?.gmailThreadId || thread?.lastMessageId);
}

async function userMailbox(userId: string | null | undefined): Promise<GmailMailbox | null> {
    if (!userId) return null;
    const accessToken = await getGmailAccessTokenForUser(userId).catch(() => null);
    if (!accessToken) return null;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleEmail: true, email: true } });
    const email = String(user?.googleEmail || user?.email || '').trim().toLowerCase();
    return email ? { email, accessToken, userId } : null;
}

const sameMailbox = (a: string | null | undefined, b: string | null | undefined) =>
    Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/** True when `mailbox` is the mailbox that owns the stored Gmail thread. */
function ownsThread(mailbox: GmailMailbox, existing: NonNullable<ThreadRow>): boolean {
    if (!existing.gmailThreadId) return false;
    if (existing.mailboxEmail && !sameMailbox(mailbox.email, existing.mailboxEmail)) return false;
    if (existing.ownerFunderMailboxId) return mailbox.funderMailboxId === existing.ownerFunderMailboxId;
    if (existing.ownerUserId) return mailbox.userId === existing.ownerUserId;
    // Server-wide sender: no owning user or funder.
    return !mailbox.userId && !mailbox.funderMailboxId;
}

type ThreadAnchor = {
    mailbox: GmailMailbox;
    /** Set only when `mailbox` owns this Gmail thread. */
    gmailThreadId?: string;
    inReplyTo?: string;
    references?: string;
    subject?: string;
};

/** Header chain for the next reply on a stored conversation. */
function chainOf(existing: ThreadRow) {
    if (!existing?.lastMessageId) return { subject: existing?.subject || undefined };
    return {
        inReplyTo: ensureAngleBrackets(existing.lastMessageId) || undefined,
        references: appendReference(existing.references, existing.lastMessageId) || undefined,
        subject: existing.subject || undefined,
    };
}

/**
 * Deal auto-created from an ISO's Gmail submission: reply to that message from the
 * mailbox that received it (Katan parity).
 */
async function resolveSubmissionAnchor(applicationId: string): Promise<ThreadAnchor | null> {
    const app = await prisma.application.findUnique({
        where: { id: applicationId },
        select: { note: true, createdById: true },
    });
    const sourceMessageId = parseGmailMessageIdFromApplicationNote(app?.note);
    if (!sourceMessageId || !app?.createdById) return null;
    const mailbox = await userMailbox(app.createdById);
    if (!mailbox) return null;
    try {
        const response = await axios.get(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(sourceMessageId)}`,
            {
                params: { format: 'metadata', metadataHeaders: ['Message-ID', 'References', 'Subject'] },
                paramsSerializer: { indexes: null },
                headers: { Authorization: `Bearer ${mailbox.accessToken}` },
                timeout: 30_000,
            },
        );
        const headers: Array<{ name?: string; value?: string }> = response.data?.payload?.headers ?? [];
        const header = (name: string) =>
            String(headers.find((h) => String(h.name || '').toLowerCase() === name.toLowerCase())?.value ?? '').trim();
        const rfc = ensureAngleBrackets(header('Message-ID'));
        if (!rfc) return null;
        return {
            mailbox,
            gmailThreadId: response.data?.threadId ? String(response.data.threadId) : undefined,
            inReplyTo: rfc,
            references: appendReference(header('References'), rfc),
            subject: header('Subject') || undefined,
        };
    } catch (err) {
        console.warn('[application-email-thread] submission message lookup failed:', (err as Error)?.message);
        return null;
    }
}

async function resolveAnchor(input: SendOnApplicationThreadInput, existing: ThreadRow): Promise<ThreadAnchor | null> {
    const chain = chainOf(existing);

    // Funder mailbox (or another caller-chosen mailbox) must send.
    if (input.mailbox) {
        if (existing && hasApplicationEmailChain(existing)) {
            return { mailbox: input.mailbox, ...(ownsThread(input.mailbox, existing) ? { gmailThreadId: existing.gmailThreadId! } : {}), ...chain };
        }
        // New conversation from the preferred mailbox (submission replies belong to the receiving mailbox).
        return { mailbox: input.mailbox };
    }

    if (existing && hasApplicationEmailChain(existing)) {
        // Same mailbox → continue the Gmail thread itself.
        if (existing.gmailThreadId && !existing.ownerFunderMailboxId) {
            const ownerMailbox = existing.ownerUserId ? await userMailbox(existing.ownerUserId) : await getSystemGmailMailbox();
            if (ownerMailbox && ownsThread(ownerMailbox, existing)) {
                return { mailbox: ownerMailbox, gmailThreadId: existing.gmailThreadId, ...chain };
            }
        }
        // Owner mailbox gone / funder-owned / header-only chain: send from another mailbox, threaded by headers.
        const fallback = (await userMailbox(input.senderUserId)) ?? (await getSystemGmailMailbox());
        if (!fallback) return null;
        return { mailbox: fallback, ...(ownsThread(fallback, existing) ? { gmailThreadId: existing.gmailThreadId! } : {}), ...chain };
    }

    const submission = await resolveSubmissionAnchor(input.applicationId);
    if (submission) return submission;

    const mailbox = (await userMailbox(input.senderUserId)) ?? (await getSystemGmailMailbox());
    return mailbox ? { mailbox } : null;
}

/** True when some mailbox can send for this deal right now. */
export async function canSendOnApplicationThread(senderUserId?: string | null): Promise<boolean> {
    return Boolean((await userMailbox(senderUserId)) ?? (await getSystemGmailMailbox().catch(() => null)));
}

export class NoGmailMailboxError extends MailDeliveryError {
    readonly code = 'GMAIL_NOT_CONFIGURED';
    constructor() {
        super(
            'No Gmail mailbox is available to send from. Set GMAIL_SENDER_EMAIL (and connect that mailbox or set GMAIL_SENDER_REFRESH_TOKEN), or connect your Gmail account.',
            { kind: 'not_sent', provider: 'gmail' },
        );
    }
}

export function sendOnApplicationThread(input: SendOnApplicationThreadInput): Promise<SendOnApplicationThreadResult> {
    return withDealMailLock(input.applicationId, () => sendOnApplicationThreadUnlocked(input));
}

async function sendOnApplicationThreadUnlocked(
    input: SendOnApplicationThreadInput,
): Promise<SendOnApplicationThreadResult> {
    const existing = await getApplicationEmailThread(input.applicationId);
    const anchor = await resolveAnchor(input, existing);
    if (!anchor) throw new NoGmailMailboxError();

    const isReply = Boolean(anchor.inReplyTo);
    const baseSubject = anchor.subject || input.subject;
    const subject = isReply ? buildReplySubject(baseSubject) : input.subject;
    const fromName =
        String(input.fromName || '').trim() ||
        process.env.MAIL_FROM_NAME?.trim() ||
        process.env.SENDGRID_FROM_NAME?.trim() ||
        anchor.mailbox.email;

    const refreshMailbox = async () => {
        if (input.mailbox && anchor.mailbox === input.mailbox) {
            return input.refreshMailboxToken ? input.refreshMailboxToken() : null;
        }
        if (anchor.mailbox.userId) invalidateAccessTokenCache(`user:${anchor.mailbox.userId}`);
        const fresh = anchor.mailbox.userId
            ? await userMailbox(anchor.mailbox.userId)
            : await getSystemGmailMailbox({ forceRefresh: true });
        return fresh?.accessToken ?? null;
    };

    const sent = await sendViaGmailApi(
        {
            accessToken: anchor.mailbox.accessToken,
            from: { name: fromName, address: anchor.mailbox.fromEmail || anchor.mailbox.email },
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            replyTo: input.replyTo,
            subject,
            html: input.html,
            attachments: input.attachments,
            threadId: anchor.gmailThreadId,
            inReplyTo: anchor.inReplyTo,
            references: anchor.references,
        },
        refreshMailbox,
    );

    // Gmail may replace the Message-ID we set; read back the one actually sent.
    let rfcMessageId: string | null = sent.rfcMessageId || null;
    try {
        const headers = await getGmailMessageHeaders(anchor.mailbox.accessToken, sent.gmailMessageId);
        rfcMessageId = headers.messageId || rfcMessageId;
    } catch (err) {
        console.warn('[application-email-thread] could not read Message-ID of sent mail:', (err as Error)?.message);
    }

    const primaryTo = (Array.isArray(input.to) ? input.to : [input.to]).map((v) => String(v || '').trim()).filter(Boolean);
    const threadData = {
        ownerUserId: anchor.mailbox.userId,
        ownerFunderMailboxId: anchor.mailbox.funderMailboxId ?? null,
        mailboxEmail: anchor.mailbox.email,
        gmailThreadId: sent.gmailThreadId || anchor.gmailThreadId || null,
        lastMessageId: rfcMessageId,
        references: anchor.references || null,
        subject: baseSubject.replace(/^re:\s*/i, ''),
        counterpartEmail: primaryTo[0] || existing?.counterpartEmail || null,
        lastProvider: 'gmail',
    };

    await saveThread(input.applicationId, threadData);

    return {
        gmailMessageId: sent.gmailMessageId,
        gmailThreadId: threadData.gmailThreadId ?? '',
        rfcMessageId,
        repliedOnExistingThread: Boolean(anchor.gmailThreadId),
        mailboxEmail: anchor.mailbox.email,
        subject,
        accepted: sent.accepted,
    };
}

async function saveThread(applicationId: string, data: Record<string, unknown>) {
    // The email is already out: a failed bookkeeping write must not surface as a send failure.
    try {
        await prisma.applicationEmailThread.upsert({
            where: { applicationId_purpose: { applicationId, purpose: APPLICATION_EMAIL_THREAD_PURPOSE } },
            create: { applicationId, purpose: APPLICATION_EMAIL_THREAD_PURPOSE, ...data } as never,
            update: data as never,
        });
    } catch (err) {
        console.error('[application-email-thread] could not store thread state:', applicationId, (err as Error)?.message);
    }
}

export interface ExternalChainSendInput {
    applicationId: string;
    to: string | string[];
    subject: string;
    provider: Exclude<MailProviderName, 'gmail'>;
}

export interface ExternalChainHeaders {
    subject: string;
    inReplyTo?: string;
    references?: string;
}

/**
 * Send a deal email through a non-Gmail provider (SendGrid) while keeping the
 * deal's chain: the provided `send` gets the `Re:` subject and In-Reply-To /
 * References, must set the RFC Message-ID it returns, and the chain is advanced
 * to that Message-ID. The Gmail thread id / owner are kept for later Gmail sends.
 */
export function sendOnApplicationChainExternal<T extends { rfcMessageId?: string | null }>(
    input: ExternalChainSendInput,
    send: (headers: ExternalChainHeaders) => Promise<T>,
): Promise<T & { chainSubject: string }> {
    return withDealMailLock(input.applicationId, async () => {
        const existing = await getApplicationEmailThread(input.applicationId);
        const chain = chainOf(existing);
        const isReply = Boolean(chain.inReplyTo);
        const baseSubject = chain.subject || input.subject;
        const subject = isReply ? buildReplySubject(baseSubject) : input.subject;

        const result = await send({ subject, inReplyTo: chain.inReplyTo, references: chain.references });

        const rfcMessageId = ensureAngleBrackets(result.rfcMessageId) || null;
        if (rfcMessageId) {
            const primaryTo = (Array.isArray(input.to) ? input.to : [input.to]).map((v) => String(v || '').trim()).filter(Boolean);
            await saveThread(input.applicationId, {
                lastMessageId: rfcMessageId,
                references: chain.references || null,
                subject: baseSubject.replace(/^re:\s*/i, ''),
                counterpartEmail: primaryTo[0] || existing?.counterpartEmail || null,
                lastProvider: input.provider,
            });
        }
        return { ...result, chainSubject: subject };
    });
}
