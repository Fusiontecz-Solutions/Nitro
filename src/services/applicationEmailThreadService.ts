/**
 * One Gmail conversation per deal for every ISO-facing email (adapted from Katan
 * `applicationGmailThreadMailService.ts`).
 *
 * Approval / offer updated / decline / document request / staff reply / ISO offer
 * acceptance all go out on the same thread:
 *   - the first send starts the conversation (or replies to the ISO's original
 *     submission email when the deal was auto-created from Gmail — `gmail-msg:`
 *     marker on `Application.note`);
 *   - every later send passes the stored Gmail `threadId` plus `In-Reply-To` /
 *     `References` built from the stored Message-ID, with a `Re:` subject, so both
 *     Gmail and the ISO's mail client keep one chain;
 *   - the thread id, latest Message-ID and References chain are persisted in
 *     `ApplicationEmailThread` (purpose ISO_APPROVAL) after every send.
 *
 * Mailbox: the one that owns the thread (Gmail thread ids are per mailbox). A new
 * thread starts from the acting user's connected Gmail when there is one, else
 * from the server-wide sender (GMAIL_SENDER_EMAIL).
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

type ThreadAnchor = {
    mailbox: GmailMailbox;
    /** Set only when `mailbox` owns this Gmail thread. */
    gmailThreadId?: string;
    inReplyTo?: string;
    references?: string;
    subject?: string;
};

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

async function resolveAnchor(
    applicationId: string,
    senderUserId: string | null | undefined,
    existing: Awaited<ReturnType<typeof getApplicationEmailThread>>,
): Promise<ThreadAnchor | null> {
    if (existing?.gmailThreadId) {
        const chain = {
            inReplyTo: ensureAngleBrackets(existing.lastMessageId) || undefined,
            references: appendReference(existing.references, existing.lastMessageId) || undefined,
            subject: existing.subject || undefined,
        };
        // Same mailbox → continue the Gmail thread itself.
        const ownerMailbox = existing.ownerUserId
            ? await userMailbox(existing.ownerUserId)
            : await getSystemGmailMailbox();
        if (ownerMailbox && (!existing.mailboxEmail || sameMailbox(ownerMailbox.email, existing.mailboxEmail))) {
            return { mailbox: ownerMailbox, gmailThreadId: existing.gmailThreadId, ...chain };
        }
        // Owner mailbox gone: send from another mailbox, still threaded by headers for the ISO.
        const fallback = (await userMailbox(senderUserId)) ?? (await getSystemGmailMailbox());
        if (!fallback) return null;
        const sameAsStored = sameMailbox(fallback.email, existing.mailboxEmail);
        return { mailbox: fallback, ...(sameAsStored ? { gmailThreadId: existing.gmailThreadId } : {}), ...chain };
    }

    const submission = await resolveSubmissionAnchor(applicationId);
    if (submission) return submission;

    const mailbox = (await userMailbox(senderUserId)) ?? (await getSystemGmailMailbox());
    return mailbox ? { mailbox } : null;
}

/** True when some mailbox can send for this deal right now. */
export async function canSendOnApplicationThread(senderUserId?: string | null): Promise<boolean> {
    return Boolean((await userMailbox(senderUserId)) ?? (await getSystemGmailMailbox().catch(() => null)));
}

/** Serialize sends per deal so two concurrent mails never start two threads. */
const inFlight = new Map<string, Promise<unknown>>();

function withApplicationLock<T>(applicationId: string, task: () => Promise<T>): Promise<T> {
    const previous = inFlight.get(applicationId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tracked = run.finally(() => {
        if (inFlight.get(applicationId) === tracked) inFlight.delete(applicationId);
    });
    inFlight.set(applicationId, tracked);
    return run;
}

export class NoGmailMailboxError extends Error {
    readonly code = 'GMAIL_NOT_CONFIGURED';
    constructor() {
        super(
            'No Gmail mailbox is available to send from. Set GMAIL_SENDER_EMAIL (and connect that mailbox or set GMAIL_SENDER_REFRESH_TOKEN), or connect your Gmail account.',
        );
    }
}

export function sendOnApplicationThread(input: SendOnApplicationThreadInput): Promise<SendOnApplicationThreadResult> {
    return withApplicationLock(input.applicationId, () => sendOnApplicationThreadUnlocked(input));
}

async function sendOnApplicationThreadUnlocked(
    input: SendOnApplicationThreadInput,
): Promise<SendOnApplicationThreadResult> {
    const existing = await getApplicationEmailThread(input.applicationId);
    const anchor = await resolveAnchor(input.applicationId, input.senderUserId, existing);
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
        if (anchor.mailbox.userId) invalidateAccessTokenCache(`user:${anchor.mailbox.userId}`);
        const fresh = anchor.mailbox.userId
            ? await userMailbox(anchor.mailbox.userId)
            : await getSystemGmailMailbox({ forceRefresh: true });
        return fresh?.accessToken ?? null;
    };

    const sent = await sendViaGmailApi(
        {
            accessToken: anchor.mailbox.accessToken,
            from: { name: fromName, address: anchor.mailbox.email },
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
        mailboxEmail: anchor.mailbox.email,
        gmailThreadId: sent.gmailThreadId || anchor.gmailThreadId || existing?.gmailThreadId || '',
        lastMessageId: rfcMessageId,
        references: anchor.references || null,
        subject: baseSubject.replace(/^re:\s*/i, ''),
        counterpartEmail: primaryTo[0] || existing?.counterpartEmail || null,
    };

    await prisma.applicationEmailThread.upsert({
        where: {
            applicationId_purpose: { applicationId: input.applicationId, purpose: APPLICATION_EMAIL_THREAD_PURPOSE },
        },
        create: { applicationId: input.applicationId, purpose: APPLICATION_EMAIL_THREAD_PURPOSE, ...threadData },
        update: threadData,
    });

    return {
        gmailMessageId: sent.gmailMessageId,
        gmailThreadId: threadData.gmailThreadId,
        rfcMessageId,
        repliedOnExistingThread: Boolean(anchor.gmailThreadId),
        mailboxEmail: anchor.mailbox.email,
        subject,
        accepted: sent.accepted,
    };
}
