/**
 * Agent → ISO approval email on a per-deal Gmail thread.
 *
 * First send starts a new conversation from the Agent's connected mailbox and
 * records it in `ApplicationEmailThread` (purpose ISO_APPROVAL). Every later send
 * for the same deal (resend, updated offer) replies on that thread with
 * `threadId` + `In-Reply-To` / `References`, so the ISO sees one chain and any
 * reply they send lands on a thread we can map back to the application.
 */
import prisma from '../config/prismaClient';
import { ISO_APPROVAL_THREAD_PURPOSE } from '../constants/applicationWorkflow';
import { GmailNotConnectedError, getGmailAccessTokenForUser } from './gmail/gmailOAuthService';
import { getSystemGmailMailbox } from '../config/gmailApiMailer';
import { getFunderGmailMailboxForSend } from './gmail/funderGmailOAuthService';
import {
    getGmailMessageHeaders,
    getGmailThreadMessages,
    sendGmailMessage,
    type GmailAttachment,
    type GmailThreadMessage,
} from './gmail/gmailMailService';

export interface SendIsoApprovalOnThreadInput {
    applicationId: string;
    senderUserId: string;
    to: string;
    cc?: string[];
    subject: string;
    html: string;
    attachments?: GmailAttachment[];
}

export interface SendIsoApprovalOnThreadResult {
    gmailMessageId: string;
    gmailThreadId: string;
    rfcMessageId: string | null;
    repliedOnExistingThread: boolean;
    mailboxEmail: string | null;
}

const replySubject = (subject: string): string => (/^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`);

const appendReference = (references: string | null | undefined, messageId: string | null | undefined): string =>
    [String(references ?? '').trim(), String(messageId ?? '').trim()].filter(Boolean).join(' ').trim();

/** Does the user have a Gmail mailbox we can send from right now? */
export async function canSendFromUserGmail(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    return Boolean(await getGmailAccessTokenForUser(userId).catch(() => null));
}

export async function getIsoApprovalThread(applicationId: string) {
    return prisma.applicationEmailThread.findUnique({
        where: { applicationId_purpose: { applicationId, purpose: ISO_APPROVAL_THREAD_PURPOSE } },
    });
}

export async function sendIsoApprovalOnThread(
    input: SendIsoApprovalOnThreadInput,
): Promise<SendIsoApprovalOnThreadResult> {
    const accessToken = await getGmailAccessTokenForUser(input.senderUserId);
    if (!accessToken) throw new GmailNotConnectedError();

    const sender = await prisma.user.findUnique({
        where: { id: input.senderUserId },
        select: { googleEmail: true, firstName: true, lastName: true },
    });
    const mailboxEmail = sender?.googleEmail ?? null;

    const existing = await getIsoApprovalThread(input.applicationId);
    // A thread only continues from the mailbox that owns it (Gmail thread ids are per mailbox).
    const continueThread = Boolean(existing && existing.ownerUserId === input.senderUserId && existing.gmailThreadId);

    const subject = continueThread && existing?.subject ? replySubject(existing.subject) : input.subject;
    const inReplyTo = continueThread ? existing?.lastMessageId || undefined : undefined;
    const references = continueThread ? appendReference(existing?.references, existing?.lastMessageId) || undefined : undefined;

    const senderName = `${sender?.firstName ?? ''} ${sender?.lastName ?? ''}`.trim();
    const from = mailboxEmail ? (senderName ? `"${senderName.replace(/"/g, '')}" <${mailboxEmail}>` : mailboxEmail) : undefined;

    const sent = await sendGmailMessage({
        accessToken,
        from,
        to: input.to,
        cc: input.cc,
        subject,
        html: input.html,
        threadId: continueThread ? existing!.gmailThreadId ?? undefined : undefined,
        inReplyTo,
        references,
        attachments: input.attachments,
    });

    let rfcMessageId: string | null = null;
    try {
        rfcMessageId = (await getGmailMessageHeaders(accessToken, sent.id)).messageId || null;
    } catch (err) {
        // Threading still works through threadId; only In-Reply-To on the next send is lost.
        console.warn('[iso-approval-thread] could not read Message-ID of sent mail:', (err as Error)?.message);
    }

    const threadData = {
        ownerUserId: input.senderUserId,
        mailboxEmail,
        gmailThreadId: sent.threadId || existing?.gmailThreadId || '',
        lastMessageId: rfcMessageId ?? (continueThread ? existing?.lastMessageId ?? null : null),
        references: continueThread ? appendReference(references, null) || null : null,
        subject: continueThread ? existing?.subject ?? input.subject : input.subject,
        counterpartEmail: input.to,
    };

    await prisma.applicationEmailThread.upsert({
        where: {
            applicationId_purpose: { applicationId: input.applicationId, purpose: ISO_APPROVAL_THREAD_PURPOSE },
        },
        create: { applicationId: input.applicationId, purpose: ISO_APPROVAL_THREAD_PURPOSE, ...threadData },
        update: threadData,
    });

    return {
        gmailMessageId: sent.id,
        gmailThreadId: threadData.gmailThreadId,
        rfcMessageId,
        repliedOnExistingThread: continueThread,
        mailboxEmail,
    };
}

export interface IsoApprovalThreadHistory {
    thread: {
        /** Null when the chain so far went out over SendGrid (no Gmail thread to read). */
        gmailThreadId: string | null;
        mailboxEmail: string | null;
        ownerFunderMailboxId: string | null;
        lastProvider: string | null;
        subject: string | null;
        counterpartEmail: string | null;
        ownerUserId: string | null;
        updatedAt: Date;
    } | null;
    /** Live Gmail messages (includes ISO replies) — null when the owner's mailbox is unavailable. */
    messages: GmailThreadMessage[] | null;
    messagesUnavailableReason: string | null;
}

export async function getIsoApprovalThreadHistory(applicationId: string): Promise<IsoApprovalThreadHistory> {
    const thread = await getIsoApprovalThread(applicationId);
    if (!thread) return { thread: null, messages: null, messagesUnavailableReason: null };

    const summary = {
        gmailThreadId: thread.gmailThreadId,
        mailboxEmail: thread.mailboxEmail,
        ownerFunderMailboxId: thread.ownerFunderMailboxId,
        lastProvider: thread.lastProvider,
        subject: thread.subject,
        counterpartEmail: thread.counterpartEmail,
        ownerUserId: thread.ownerUserId,
        updatedAt: thread.updatedAt,
    };

    if (!thread.gmailThreadId) {
        return {
            thread: summary,
            messages: null,
            messagesUnavailableReason: 'This conversation was sent through SendGrid — replies arrive in the funder sender inbox.',
        };
    }
    const gmailThreadId = thread.gmailThreadId;

    // Funder-owned threads read through the funder mailbox; server-wide sender threads have no owner.
    const accessToken = thread.ownerFunderMailboxId
        ? await funderMailboxToken(thread.ownerFunderMailboxId, thread.mailboxEmail)
        : thread.ownerUserId
        ? await getGmailAccessTokenForUser(thread.ownerUserId).catch(() => null)
        : await getSystemGmailMailbox()
              .then((mailbox) =>
                  mailbox && (!thread.mailboxEmail || mailbox.email === thread.mailboxEmail.toLowerCase())
                      ? mailbox.accessToken
                      : null,
              )
              .catch(() => null);
    if (!accessToken) {
        return {
            thread: summary,
            messages: null,
            messagesUnavailableReason: 'The sending mailbox is disconnected — reconnect Gmail to load replies.',
        };
    }
    try {
        const messages = await getGmailThreadMessages(accessToken, gmailThreadId, thread.mailboxEmail);
        return { thread: summary, messages, messagesUnavailableReason: null };
    } catch (err) {
        return { thread: summary, messages: null, messagesUnavailableReason: (err as Error)?.message || 'Gmail error' };
    }
}

/** Access token of the funder mailbox that owns a thread, when it is still the same Google account. */
async function funderMailboxToken(funderMailboxId: string, threadMailboxEmail: string | null): Promise<string | null> {
    try {
        const row = await prisma.funderMailbox.findUnique({ where: { id: funderMailboxId }, select: { funderProfileId: true } });
        if (!row) return null;
        const mailbox = await getFunderGmailMailboxForSend(row.funderProfileId);
        if (!mailbox) return null;
        if (threadMailboxEmail && mailbox.email !== threadMailboxEmail.trim().toLowerCase()) return null;
        return mailbox.accessToken;
    } catch {
        return null;
    }
}
