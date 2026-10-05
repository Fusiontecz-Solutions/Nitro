/**
 * Minimal Gmail REST client for sending workflow mail from a user's own mailbox
 * and reading back a thread (adapted from Katan `gmail.service.ts` sendEmail).
 *
 * Bodies are base64-encoded so non-ASCII content survives transport, and replies
 * carry `threadId` + `In-Reply-To` / `References` so Gmail (and the recipient's
 * client) keep them on the same conversation.
 */
import axios from 'axios';

const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type GmailAttachment = {
    filename: string;
    content: Buffer;
    contentType?: string;
};

export interface SendGmailMessageOptions {
    accessToken: string;
    from?: string;
    to: string | string[];
    cc?: string[];
    subject: string;
    html: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    attachments?: GmailAttachment[];
}

export interface SentGmailMessage {
    id: string;
    threadId: string;
}

const encodeHeaderValue = (value: string): string =>
    /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

const foldBase64 = (buffer: Buffer): string =>
    buffer
        .toString('base64')
        .replace(/.{1,76}/g, (line) => `${line}\r\n`)
        .trimEnd();

const sanitizeHeaderLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

const toBase64Url = (raw: string): string =>
    Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function buildRawMimeMessage(options: Omit<SendGmailMessageOptions, 'accessToken' | 'threadId'>): string {
    const toList = (Array.isArray(options.to) ? options.to : [options.to]).map(sanitizeHeaderLine).filter(Boolean);
    const ccList = (options.cc ?? []).map(sanitizeHeaderLine).filter(Boolean);
    const headers: string[] = [];
    if (options.from) headers.push(`From: ${sanitizeHeaderLine(options.from)}`);
    headers.push(`To: ${toList.join(', ')}`);
    if (ccList.length) headers.push(`Cc: ${ccList.join(', ')}`);
    headers.push(`Subject: ${encodeHeaderValue(sanitizeHeaderLine(options.subject || '(no subject)'))}`);
    if (options.inReplyTo) headers.push(`In-Reply-To: ${sanitizeHeaderLine(options.inReplyTo)}`);
    if (options.references) headers.push(`References: ${sanitizeHeaderLine(options.references)}`);
    headers.push('MIME-Version: 1.0');

    const htmlPart = [
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        foldBase64(Buffer.from(options.html || '', 'utf8')),
    ].join('\r\n');

    const attachments = (options.attachments ?? []).filter(
        (a) => a?.content && Buffer.isBuffer(a.content) && a.content.length > 0,
    );
    if (!attachments.length) {
        return `${headers.join('\r\n')}\r\n${htmlPart}\r\n`;
    }

    const boundary = `nitro_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = [
        `--${boundary}`,
        htmlPart,
        ...attachments.flatMap((attachment) => {
            const filename = String(attachment.filename || 'attachment.bin').replace(/["\r\n]/g, '');
            return [
                `--${boundary}`,
                [
                    `Content-Type: ${attachment.contentType || 'application/octet-stream'}; name="${filename}"`,
                    'Content-Transfer-Encoding: base64',
                    `Content-Disposition: attachment; filename="${filename}"`,
                    '',
                    foldBase64(attachment.content),
                ].join('\r\n'),
            ];
        }),
        `--${boundary}--`,
        '',
    ];
    return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

const gmailErrorMessage = (error: any): string =>
    error?.response?.data?.error?.message || error?.message || 'Gmail request failed';

export async function sendGmailMessage(options: SendGmailMessageOptions): Promise<SentGmailMessage> {
    if (!options.accessToken) throw new Error('Gmail access token is required');
    const raw = buildRawMimeMessage(options);
    try {
        const response = await axios.post(
            `${GMAIL_BASE_URL}/messages/send`,
            { raw: toBase64Url(raw), ...(options.threadId ? { threadId: options.threadId } : {}) },
            {
                headers: {
                    Authorization: `Bearer ${options.accessToken}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60_000,
            },
        );
        return { id: String(response.data?.id ?? ''), threadId: String(response.data?.threadId ?? '') };
    } catch (error) {
        throw new Error(gmailErrorMessage(error));
    }
}

type GmailHeader = { name?: string; value?: string };

const headerValue = (headers: GmailHeader[] | undefined, name: string): string => {
    const found = (headers ?? []).find((h) => String(h.name || '').toLowerCase() === name.toLowerCase());
    return String(found?.value ?? '').trim();
};

/** RFC headers of a message we just sent (Gmail assigns the Message-ID server side). */
export async function getGmailMessageHeaders(
    accessToken: string,
    messageId: string,
): Promise<{ messageId: string; references: string; subject: string }> {
    try {
        const response = await axios.get(`${GMAIL_BASE_URL}/messages/${encodeURIComponent(messageId)}`, {
            params: { format: 'metadata', metadataHeaders: ['Message-ID', 'References', 'Subject'] },
            paramsSerializer: { indexes: null },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 30_000,
        });
        const headers = response.data?.payload?.headers as GmailHeader[] | undefined;
        return {
            messageId: headerValue(headers, 'Message-ID') || headerValue(headers, 'Message-Id'),
            references: headerValue(headers, 'References'),
            subject: headerValue(headers, 'Subject'),
        };
    } catch (error) {
        throw new Error(gmailErrorMessage(error));
    }
}

export interface GmailThreadMessage {
    id: string;
    from: string;
    to: string;
    cc: string;
    subject: string;
    date: string;
    snippet: string;
    /** True when the message was sent from the connected mailbox (vs. a reply from the ISO). */
    fromMailbox: boolean;
}

/** Messages on a Gmail thread (metadata only — used for the deal's ISO email history). */
export async function getGmailThreadMessages(
    accessToken: string,
    threadId: string,
    mailboxEmail?: string | null,
): Promise<GmailThreadMessage[]> {
    try {
        const response = await axios.get(`${GMAIL_BASE_URL}/threads/${encodeURIComponent(threadId)}`, {
            params: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'] },
            paramsSerializer: { indexes: null },
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 30_000,
        });
        const mailbox = String(mailboxEmail ?? '').trim().toLowerCase();
        const messages = Array.isArray(response.data?.messages) ? response.data.messages : [];
        return messages.map((m: any) => {
            const headers = m?.payload?.headers as GmailHeader[] | undefined;
            const from = headerValue(headers, 'From');
            const labelIds: string[] = Array.isArray(m?.labelIds) ? m.labelIds : [];
            return {
                id: String(m?.id ?? ''),
                from,
                to: headerValue(headers, 'To'),
                cc: headerValue(headers, 'Cc'),
                subject: headerValue(headers, 'Subject'),
                date: m?.internalDate ? new Date(Number(m.internalDate)).toISOString() : headerValue(headers, 'Date'),
                snippet: String(m?.snippet ?? ''),
                fromMailbox: labelIds.includes('SENT') || (mailbox ? from.toLowerCase().includes(mailbox) : false),
            };
        });
    } catch (error) {
        throw new Error(gmailErrorMessage(error));
    }
}
