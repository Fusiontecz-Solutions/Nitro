import axios from 'axios';
import prisma from '../config/prismaClient';
import { attachBufferAsApplicationFile } from './applicationPdfAttachService';
import {
    hasRecentDuplicatePdfForCreator,
    readPdfFileDedupeDays,
} from './pdfFileDedupeService';

const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const inFlightAutoCreateMessageIds = new Set<string>();

/** Gmail allows ~50 concurrent in-flight requests per mailbox — stay well under that. */
const GMAIL_MESSAGE_FETCH_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const worker = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await fn(items[index], index);
        }
    };

    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

function isGmailConcurrentLimitError(error: unknown): boolean {
    const status = (error as { response?: { status?: number } })?.response?.status;
    const message = String(
        (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data
            ?.error?.message ||
            (error as Error)?.message ||
            '',
    ).toLowerCase();
    return status === 429 || message.includes('too many concurrent requests');
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gmail API expects repeated query‑params for arrays
 * (e.g. `labelIds=INBOX&labelIds=SENT`, NOT `labelIds[]=INBOX`).
 * Axios default serialization adds brackets, which Gmail silently ignores.
 */
function gmailParamsSerializer(params: Record<string, any>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
            value.forEach((v: any) => searchParams.append(key, String(v)));
        } else {
            searchParams.append(key, String(value));
        }
    }
    return searchParams.toString();
}

/* ================================
   Types
================================ */

export interface GmailMessage {
    id: string;
    threadId: string;
}

export interface GmailMessagesListResponse {
    messages?: GmailMessage[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
}

export interface GmailAttachmentResponse {
    data: string; // base64 string
}

/** Breadth-first MIME walk — avoids stack overflow on deeply nested multiparts. */
function collectMimeAttachmentParts(payload: unknown): any[] {
    const found: any[] = [];
    const queue: any[] = payload ? [payload as any] : [];
    let steps = 0;
    const MAX_STEPS = 20_000;
    while (queue.length > 0 && steps < MAX_STEPS) {
        steps += 1;
        const part = queue.shift();
        if (!part) continue;
        if (part.filename && part.body?.attachmentId) {
            found.push(part);
        }
        if (Array.isArray(part.parts)) {
            for (const p of part.parts) {
                queue.push(p);
            }
        }
    }
    if (steps >= MAX_STEPS) {
        console.warn('[gmail-auto-create] MIME walk hit step limit; attachments may be incomplete.');
    }
    return found;
}

async function markMessageAsRead(messageId: string, accessToken: string): Promise<void> {
    if (!messageId || !accessToken) return;
    try {
        await axios.post(
            `${GMAIL_BASE_URL}/messages/${messageId}/modify`,
            { removeLabelIds: ['UNREAD'] },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            },
        );
    } catch (error: any) {
        console.warn(
            `Failed to mark message ${messageId} as read:`,
            error?.response?.data?.error?.message || error?.message || error,
        );
    }
}

async function starMessage(messageId: string, accessToken: string): Promise<void> {
    if (!messageId || !accessToken) return;
    try {
        await axios.post(
            `${GMAIL_BASE_URL}/messages/${messageId}/modify`,
            { addLabelIds: ['STARRED'] },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            },
        );
    } catch (error: any) {
        console.warn(
            `Failed to star message ${messageId}:`,
            error?.response?.data?.error?.message || error?.message || error,
        );
    }
}

/**
 * Prefer real loan/app PDFs over random attachments in the same email.
 * Filename order per product: Application → app → form → deal; then largest PDF above a minimum size.
 */
function applicationPdfAttachmentFilenameScore(filename: string): number {
    const n = filename.trim().toLowerCase();

    /** “application” before generic “app” so filenames like `loan_application.pdf` rank highest. */
    if (/\bapplication\b/.test(n) || n.includes('application')) return 4;

    /**
     * Standalone “app” (already excluded real “application” matches above).
     * Covers `*_app.pdf`, `my-app.pdf`, `app_submit.pdf`; avoids blindly matching substrings inside long tokens.
     */
    if (
        /\bapp\b/i.test(n) ||
        /^app(?:[\s_\-./]|$)/i.test(n.trim()) ||
        /[\s_\/-]app(?:[\s_\-./]|\.pdf$|$)/i.test(n)
    ) {
        return 3;
    }

    if (/\bform\b/.test(n)) return 2;

    /** “deal” in filename (e.g. DEAL 217 APP) — weaker heuristic than explicit “application”. */
    if (/\bdeal\b/.test(n)) return 1;

    return 0;
}

/** Declared MIME size from Gmail (`body.size`). */
function gmailAttachmentDeclaredSize(part: { body?: { size?: unknown } | null } | null): number {
    const s = Number(part?.body?.size ?? 0);
    return Number.isFinite(s) && s > 0 ? s : 0;
}

function readGmailApplicationPdfMinBytes(): number {
    const raw = process.env.GMAIL_APPLICATION_PDF_MIN_BYTES ?? '20480';
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n < 4096) return 20480;
    return Math.min(Math.floor(n), 50 * 1024 * 1024);
}

/** When multiple PDFs exist, returns the MIME part most likely to be the MCA/application; otherwise null → caller should star. */
function pickApplicationPdfAttachment(parts: unknown[]): unknown | null {
    const pdfParts = parts.filter((p: any) => {
        const fn = String(p?.filename || '').trim();
        return Boolean(p?.body?.attachmentId) && fn.toLowerCase().endsWith('.pdf');
    });

    if (pdfParts.length === 0) return null;

    if (pdfParts.length === 1) {
        return pdfParts[0] ?? null;
    }

    const minBytes = readGmailApplicationPdfMinBytes();

    type Ranked = { part: unknown; filename: string; score: number; size: number };
    const ranked: Ranked[] = pdfParts.map((part: any) => {
        const filename = String(part.filename || '').trim() || 'document.pdf';
        return {
            part,
            filename,
            score: applicationPdfAttachmentFilenameScore(filename),
            size: gmailAttachmentDeclaredSize(part),
        };
    });

    ranked.sort(
        (a, b) =>
            b.score - a.score ||
            b.size - a.size ||
            a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }),
    );

    const best = ranked[0]!;
    const second = ranked[1];

    if (best.score > 0) {
        /** Unambiguous keyword winner unless perfect tie at top */
        if (second && second.score === best.score && second.size === best.size && best.filename !== second.filename) {
            return null;
        }
        return best.part;
    }

    /** No filename hint: require substantive size — pick the largest among PDFs ≥ min bytes (typical scanned app beats one-page stubs). */
    const eligible = ranked.filter((r) => r.size >= minBytes);
    if (eligible.length === 0) {
        return null;
    }

    eligible.sort(
        (a, b) =>
            b.size - a.size ||
            a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }),
    );

    const top = eligible[0]!;
    const nextEl = eligible[1];
    if (nextEl && nextEl.size === top.size && top.filename !== nextEl.filename) {
        return null;
    }

    return top.part;
}

function collectPdfAttachmentParts(parts: unknown[]): Array<Record<string, any>> {
    return (parts || []).filter((p: any) => {
        const filename = String(p?.filename || '')
            .trim()
            .toLowerCase();
        return Boolean(p?.body?.attachmentId) && filename.endsWith('.pdf');
    }) as Array<Record<string, any>>;
}

function extractEmailAddress(fromHeader?: string): string | null {
    const raw = String(fromHeader || '').trim();
    if (!raw) return null;
    const angleMatch = raw.match(/<([^>]+)>/);
    const direct = (angleMatch?.[1] || raw).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direct)) return direct;
    const embeddedMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return embeddedMatch?.[0]?.trim().toLowerCase() || null;
}

function normalizeEmailAddress(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function extractAllEmails(value: unknown): string[] {
    const text = String(value || '');
    if (!text) return [];
    const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const out = new Set<string>();
    for (const match of matches) {
        const normalized = normalizeEmailAddress(match);
        if (normalized) out.add(normalized);
    }
    return Array.from(out);
}

function decodeBase64Url(input: string): string {
    if (!input) return '';
    try {
        let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) base64 += '=';
        return Buffer.from(base64, 'base64').toString('utf8');
    } catch {
        return '';
    }
}

function collectPayloadTextParts(payload: any): string[] {
    const partsText: string[] = [];
    const walk = (part: any) => {
        if (!part) return;
        const mimeType = String(part?.mimeType || '').toLowerCase();
        const data = String(part?.body?.data || '');
        if ((mimeType === 'text/plain' || mimeType === 'text/html') && data) {
            const decoded = decodeBase64Url(data);
            if (decoded) partsText.push(decoded);
        }
        if (Array.isArray(part?.parts)) {
            part.parts.forEach(walk);
        }
    };
    walk(payload);
    return partsText;
}

function extractForwardedSenderCandidates(message: any): string[] {
    const candidates = new Set<string>();
    const snippetEmails = extractAllEmails(String(message?.snippet || ''));
    snippetEmails.forEach((email) => candidates.add(email));

    const payloadTexts = collectPayloadTextParts(message?.payload);
    for (const text of payloadTexts) {
        const textEmails = extractAllEmails(text);
        textEmails.forEach((email) => candidates.add(email));
    }
    return Array.from(candidates);
}

function extractSenderCandidates(headers: Array<{ name?: string; value?: string }>): string[] {
    const preferredHeaderNames = ['from', 'reply-to', 'sender', 'return-path'];
    const candidates = new Set<string>();
    for (const headerName of preferredHeaderNames) {
        const rawValue = headers.find((h) => String(h?.name || '').toLowerCase() === headerName)?.value;
        const best = extractEmailAddress(rawValue);
        if (best) candidates.add(normalizeEmailAddress(best));
        const all = extractAllEmails(rawValue);
        for (const email of all) candidates.add(email);
    }
    return Array.from(candidates);
}

async function resolveIsoIdFromSenderCandidates(senderCandidates: string[]): Promise<string | null> {
    if (senderCandidates.length === 0) return null;
    for (const senderEmail of senderCandidates) {
        const byEquals = await prisma.iso.findFirst({
            where: {
                email: {
                    equals: senderEmail,
                    mode: 'insensitive',
                },
            },
            select: { id: true },
        });
        if (byEquals?.id) return String(byEquals.id);
    }

    const isoCandidates = await prisma.iso.findMany({
        where: {
            email: {
                not: null,
            },
        },
        select: {
            id: true,
            email: true,
        },
    });

    const match = isoCandidates.find((iso) => {
        const isoEmail = normalizeEmailAddress(iso.email);
        return senderCandidates.includes(isoEmail);
    });
    if (match?.id) return String(match.id);

    // Auto-create ISO when sender email is unknown so the deal always links to an ISO.
    const preferredEmail =
        senderCandidates.find((email) => !email.endsWith('@fusiontecz.com')) ||
        senderCandidates[0];
    if (!preferredEmail) return null;

    const localPart = preferredEmail.split('@')[0] || 'Auto ISO';
    const inferredName = localPart
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase()) || 'Auto ISO';

    const createdIso = await prisma.iso.create({
        data: {
            name: inferredName,
            email: preferredEmail,
            bankAccountNo: 'AUTO_PENDING',
            routingNumber: 'AUTO_PENDING',
            commissionPercentage: 0,
        },
        select: { id: true },
    });
    console.log(
        `[gmail-auto-create] auto-created ISO email=${preferredEmail} isoId=${createdIso.id}`,
    );
    return String(createdIso.id);
}

/* ================================
   Fetch Emails With PDF
================================ */

export async function fetchRecentPdfEmails(
    accessToken: string
): Promise<GmailMessage[]> {
    if (!accessToken) {
        throw new Error('Access token is required');
    }

    try {
        const response = await axios.get<GmailMessagesListResponse>(
            `${GMAIL_BASE_URL}/messages`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                params: {
                    q: 'has:attachment filename:pdf newer_than:1d',
                },
            }
        );

        return response.data.messages ?? [];
    } catch (error: any) {
        throw new Error(
            `Failed to fetch recent PDF emails: ${error.response?.data?.error?.message || error.message}`
        );
    }
}

/* ================================
   Fetch ALL Emails (Paginated)
================================ */

// export async function fetchAllEmails(
//     accessToken: string,
//     pageToken?: string,
//     limit: number = 15
// ): Promise<{
//     messages: any[];
//     nextPageToken?: string;
// }> {
//     if (!accessToken) {
//         throw new Error('Access token is required');
//     }

//     try {
//         // 1️⃣ Get message IDs
//         const response = await axios.get<GmailMessagesListResponse>(
//             `${GMAIL_BASE_URL}/messages`,
//             {
//                 headers: {
//                     Authorization: `Bearer ${accessToken}`,
//                 },
//                 params: {
//                     maxResults: limit,
//                     pageToken,
//                 },
//             }
//         );

//         const messageIds = response.data.messages ?? [];

//         if (!messageIds.length) {
//             return {
//                 messages: [],
//                 nextPageToken: response.data.nextPageToken,
//             };
//         }

//         // 2️⃣ Fetch full message details in parallel
//         const detailedMessages = await Promise.all(
//             messageIds.map(async (msg) => {
//                 const fullMessage = await axios.get(
//                     `${GMAIL_BASE_URL}/messages/${msg.id}`,
//                     {
//                         headers: {
//                             Authorization: `Bearer ${accessToken}`,
//                         },
//                         params: {
//                             format: "metadata",
//                             metadataHeaders: ["Subject", "From", "To", "Date"],
//                         },
//                     }
//                 );

//                 const data = fullMessage.data;
//                 const headers = data.payload.headers;

//                 const getHeader = (name: string) =>
//                     headers.find((h: any) => h.name === name)?.value || "";

//                 return {
//                     id: data.id,
//                     threadId: data.threadId,
//                     subject: getHeader("Subject"),
//                     from: getHeader("From"),
//                     to: getHeader("To"),
//                     date: getHeader("Date"),
//                     snippet: data.snippet,
//                     isRead: !data.labelIds?.includes("UNREAD"),
//                 };
//             })
//         );

//         return {
//             messages: detailedMessages,
//             nextPageToken: response.data.nextPageToken,
//         };

//     } catch (error: any) {
//         throw new Error(
//             error.response?.data?.error?.message || error.message
//         );
//     }
// }

export async function fetchAllEmails(
    accessToken: string,
    pageToken?: string,
    limit: number = 15,
    label?: 'INBOX' | 'SENT' | 'DRAFT' | 'IMPORTANT' | 'STARRED',
    query?: string
): Promise<{
    messages: any[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
}> {

    if (!accessToken) {
        throw new Error('Access token is required');
    }

    try {

        // 1️⃣ Get message IDs
        const response = await axios.get<GmailMessagesListResponse>(
            `${GMAIL_BASE_URL}/messages`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                params: {
                    maxResults: limit,
                    pageToken,
                    labelIds: label ? [label] : undefined,
                    q: query
                },
                paramsSerializer: gmailParamsSerializer,
            }
        );

        const messageIds = response.data.messages ?? [];

        if (!messageIds.length) {
            return {
                messages: [],
                nextPageToken: response.data.nextPageToken,
                resultSizeEstimate: response.data.resultSizeEstimate,
            };
        }

        // 2️⃣ Fetch full message details (batched — Gmail caps concurrent requests per mailbox)
        const detailedMessages = await mapWithConcurrency(
            messageIds,
            GMAIL_MESSAGE_FETCH_CONCURRENCY,
            async (msg) => {
                let attempt = 0;
                while (attempt < 4) {
                    try {
                        const fullMessage = await axios.get(
                            `${GMAIL_BASE_URL}/messages/${msg.id}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                },
                                params: {
                                    format: 'metadata',
                                    metadataHeaders: ['Subject', 'From', 'To', 'Date'],
                                },
                                paramsSerializer: gmailParamsSerializer,
                            },
                        );

                        const data = fullMessage.data;
                        const headers = data.payload.headers;

                        const getHeader = (name: string) =>
                            headers.find((h: any) => h.name === name)?.value || '';

                        return {
                            id: data.id,
                            threadId: data.threadId,
                            subject: getHeader('Subject'),
                            from: getHeader('From'),
                            to: getHeader('To'),
                            date: getHeader('Date'),
                            snippet: data.snippet,
                            labelIds: data.labelIds,
                            isRead: !data.labelIds?.includes('UNREAD'),
                        };
                    } catch (error: any) {
                        if (!isGmailConcurrentLimitError(error) || attempt >= 3) {
                            throw error;
                        }
                        attempt += 1;
                        await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 200));
                    }
                }
                throw new Error('Failed to fetch message metadata');
            },
        );

        return {
            messages: detailedMessages,
            nextPageToken: response.data.nextPageToken,
            resultSizeEstimate: response.data.resultSizeEstimate,
        };

    } catch (error: any) {
        throw new Error(
            error.response?.data?.error?.message || error.message
        );
    }
}


/* ================================
   Get Full Message Details
================================ */

export async function getMessageDetails(
    messageId: string,
    token: { accessToken: string }
): Promise<any> {
    if (process.env.DEBUG_GMAIL_ACCESS_TOKEN === '1') {
        console.log('[gmail] MESSAGE ID:', messageId, 'accessToken length:', token.accessToken?.length ?? 0);
    } else {
        console.log('[gmail] MESSAGE ID:', messageId);
    }

    try {
        const response = await axios.get(
            `${GMAIL_BASE_URL}/messages/${messageId}`,
            { headers: { Authorization: `Bearer ${token.accessToken}` } }
        );
        return response.data;
    } catch (error: any) {
        throw new Error(
            `Failed to fetch message details: ${error.response?.data?.error?.message || error.message}`
        );
    }
}
/* ================================
   Download Attachment
================================ */

// export async function downloadAttachment(
//     messageId: string,
//     attachmentId: string,
//     accessToken: string
// ): Promise<Buffer> {
//     if (!messageId || !attachmentId) {
//         throw new Error('Message ID and Attachment ID are required');
//     }

//     try {
//         const response = await axios.get<GmailAttachmentResponse>(
//             `${GMAIL_BASE_URL}/messages/${messageId}/attachments/${attachmentId}`,
//             {
//                 headers: {
//                     Authorization: `Bearer ${accessToken}`,
//                 },
//             }
//         );

//         const base64Data = response.data.data;

//         return Buffer.from(base64Data, 'base64');
//     } catch (error: any) {
//         throw new Error(
//             `Failed to download attachment: ${error.response?.data?.error?.message || error.message}`
//         );
//     }
// }

export async function downloadAttachment(
    messageId: string,
    attachmentId: string,
    accessToken: string
): Promise<Buffer> {

    const response = await axios.get<GmailAttachmentResponse>(
        `${GMAIL_BASE_URL}/messages/${messageId}/attachments/${attachmentId}`,
        {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        }
    );

    let base64Data = response.data.data;

    // 🔥 FIX FOR GMAIL BASE64URL
    base64Data = base64Data
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    // Add padding if missing
    while (base64Data.length % 4) {
        base64Data += '=';
    }

    return Buffer.from(base64Data, 'base64');
}

/* ================================
   Send Email (Compose)
================================ */

/**
 * Detect whether the body is already HTML. Plain text must be wrapped or Gmail
 * collapses newlines and long unbroken lines (e.g. dash rules) overflow horizontally.
 */
function looksLikeHtmlEmail(body: string): boolean {
    const t = body.trim();
    if (!t) return false;
    if (/^<!DOCTYPE\s+html/i.test(t)) return true;
    if (/^<html[\s>]/i.test(t)) return true;
    if (/<\/?(?:p|div|br|table|span|a|b|strong|ul|ol|li|h[1-6]|body|head|meta|style|section|article)\b/i.test(t)) {
        return true;
    }
    return false;
}

function escapeHtmlForEmail(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Wrap plain text in a minimal HTML document with wrapping rules that work in Gmail. */
function plainTextBodyToHtmlEmail(body: string): string {
    const escaped = escapeHtmlForEmail(body);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">
<div style="white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word;word-break:break-word;max-width:100%;">${escaped}</div>
</body>
</html>`;
}

export interface SendEmailOptions {
    accessToken: string;
    to: string | string[];
    subject: string;
    body: string;           // HTML body
    cc?: string | string[];
    bcc?: string | string[];
    from?: string;          // sender (defaults to authenticated user)
    replyTo?: string;
    threadId?: string;      // set when replying to an existing thread
    inReplyTo?: string;     // Message-ID header of the message being replied to
    references?: string;    // References header for threading
}

/**
 * Builds an RFC 2822 compliant email, base64url-encodes it,
 * and sends it via the Gmail API `messages.send` endpoint.
 */
export async function sendEmail(options: SendEmailOptions): Promise<any> {
    const {
        accessToken,
        to,
        subject,
        body,
        cc,
        bcc,
        from,
        replyTo,
        threadId,
        inReplyTo,
        references,
    } = options;

    if (!accessToken) {
        throw new Error('Access token is required');
    }

    if (!to || (Array.isArray(to) && to.length === 0)) {
        throw new Error('At least one recipient (to) is required');
    }

    // Build RFC 2822 headers
    const toStr = Array.isArray(to) ? to.join(', ') : to;
    const headers: string[] = [];

    if (from) headers.push(`From: ${from}`);
    headers.push(`To: ${toStr}`);

    if (cc) {
        const ccStr = Array.isArray(cc) ? cc.join(', ') : cc;
        headers.push(`Cc: ${ccStr}`);
    }

    if (bcc) {
        const bccStr = Array.isArray(bcc) ? bcc.join(', ') : bcc;
        headers.push(`Bcc: ${bccStr}`);
    }

    headers.push(`Subject: ${subject || '(no subject)'}`);

    if (replyTo) {
        headers.push(`Reply-To: ${replyTo}`);
    }

    if (inReplyTo) {
        headers.push(`In-Reply-To: ${inReplyTo}`);
    }

    if (references) {
        headers.push(`References: ${references}`);
    }

    headers.push('MIME-Version: 1.0');
    headers.push('Content-Type: text/html; charset=utf-8');

    const htmlBody = looksLikeHtmlEmail(body) ? body : plainTextBodyToHtmlEmail(body);

    // Combine headers + body into RFC 2822 message
    const rawMessage = `${headers.join('\r\n')}\r\n\r\n${htmlBody}`;

    // Gmail API expects web-safe base64 (base64url)
    const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    try {
        const response = await axios.post(
            `${GMAIL_BASE_URL}/messages/send`,
            {
                raw: encodedMessage,
                ...(threadId ? { threadId } : {}),
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        return response.data;
    } catch (error: any) {
        throw new Error(
            error.response?.data?.error?.message || error.message
        );
    }
}

/**
 * Scans INBOX for emails with PDF attachments, extracts business data
 * from each PDF, and auto-creates Clients + Applications in the DB.
 *
 * @param accessToken - Gmail OAuth access token
 * @param userId      - ID of the authenticated CRM user (used as creator / sales rep / agent)
 */
export async function autoCreateApplicationsFromEmails(
    accessToken: string,
    userId: string
) {
    try {
        // Lazy import to avoid circular dependency (must stay inside try so failures are handled)
        const { createClientAndApplicationFromPDFBuffer, InsufficientParsedPdfError } =
            await import('./applicationService');

        // 1️⃣ Fetch unread INBOX emails with PDF attachments
        const { messages: rawMessages } = await fetchAllEmails(
            accessToken,
            undefined,
            15,
            "INBOX",
            "has:attachment filename:pdf is:unread"
        );
        const messages = Array.from(
            new Map((rawMessages ?? []).map((m) => [m.id, m])).values(),
        );

        const results: Array<{
            messageId: string;
            fileName: string;
            client: any;
            application: any;
            existingClient: boolean;
            senderEmail: string | null;
            matchedIsoId: string | null;
        }> = [];

        for (const msg of messages) {
            if (!msg?.id) continue;
            if (inFlightAutoCreateMessageIds.has(msg.id)) {
                console.warn(`[gmail-auto-create] message=${msg.id} already in-flight; skipping duplicate trigger`);
                continue;
            }
            inFlightAutoCreateMessageIds.add(msg.id);
            try {
                // 2️⃣ Get full message details (includes attachment metadata)
                const message = await getMessageDetails(msg.id, { accessToken });
                const headers = message?.payload?.headers || [];
                const senderCandidates = extractSenderCandidates(headers);
                const forwardedCandidates = extractForwardedSenderCandidates(message);
                for (const candidate of forwardedCandidates) {
                    senderCandidates.push(candidate);
                }
                const senderCandidateSet = Array.from(
                    new Set(senderCandidates.map((email) => normalizeEmailAddress(email)).filter(Boolean)),
                );
                const senderEmail = senderCandidateSet[0] || null;
                const resolvedIsoId = await resolveIsoIdFromSenderCandidates(senderCandidateSet);
                if (senderCandidateSet.length > 0) {
                    console.log(
                        `[gmail-auto-create] message=${msg.id} senderCandidates=${senderCandidateSet.join(',')} matchedIsoId=${resolvedIsoId || 'none'}`,
                    );
                }

                const allParts = collectMimeAttachmentParts(message?.payload);

                const pdfParts = collectPdfAttachmentParts(allParts);
                const pdfCountBeforePick = pdfParts.length;

                const chosenPart = pickApplicationPdfAttachment(allParts) as Record<string, any> | null;
                const part =
                    chosenPart &&
                    chosenPart.body?.attachmentId &&
                    String(chosenPart.filename || '')
                        .trim()
                        .toLowerCase()
                        .endsWith('.pdf')
                        ? chosenPart
                        : null;

                if (!part) {
                    console.warn(
                        `[gmail-auto-create] message=${msg.id} could not confidently pick application PDF (${pdfCountBeforePick} pdf(s)); starring for manual review`,
                    );
                    await starMessage(msg.id, accessToken);
                    continue;
                }

                console.log(
                    `[gmail-auto-create] message=${msg.id} pick_application_pdf attachment="${String(part.filename || '').trim()}" (among ${pdfCountBeforePick})`,
                );
                let processedAnyPdf = false;

                try {
                    const attachmentId = part.body?.attachmentId;
                    if (!attachmentId) {
                        console.warn(`[gmail-auto-create] message=${msg.id} chosen part missing attachmentId`);
                        continue;
                    }

                    const pickedFileName = String(part.filename || '').trim() || 'application.pdf';
                    const dedupeDays = readPdfFileDedupeDays();
                    const isRecentDuplicate = await hasRecentDuplicatePdfForCreator({
                        createdById: userId,
                        fileName: pickedFileName,
                        dedupeDays,
                    });
                    if (isRecentDuplicate) {
                        console.log(
                            `[gmail-auto-create] message=${msg.id} duplicate_detected_within_${dedupeDays}d (same PDF filename): "${pickedFileName}" — skipping create, marking read`,
                        );
                        await markMessageAsRead(msg.id, accessToken);
                        continue;
                    }

                    const pdfBuffer = await downloadAttachment(
                        msg.id,
                        attachmentId,
                        accessToken,
                    );

                    const { client, application, existingClient } =
                        await createClientAndApplicationFromPDFBuffer(pdfBuffer as any, userId, {
                            isoId: resolvedIsoId,
                            originalFileName: pickedFileName,
                        });

                    // Upload all remaining PDFs from the same email into the application's files/documents.
                    const extraPdfParts = pdfParts.filter(
                        (pdfPart) => pdfPart?.body?.attachmentId !== attachmentId,
                    );
                    for (const extraPdfPart of extraPdfParts) {
                        try {
                            const extraAttachmentId = String(extraPdfPart?.body?.attachmentId || '').trim();
                            if (!extraAttachmentId) continue;
                            const extraFileName =
                                String(extraPdfPart?.filename || '').trim() || 'document.pdf';
                            const extraPdfBuffer = await downloadAttachment(
                                msg.id,
                                extraAttachmentId,
                                accessToken,
                            );
                            await attachBufferAsApplicationFile(
                                application.id,
                                extraPdfBuffer,
                                extraFileName,
                            );
                        } catch (extraAttachErr) {
                            console.error(
                                `[gmail-auto-create] message=${msg.id} failed to attach supporting PDF "${String(extraPdfPart?.filename || '').trim() || 'document.pdf'}":`,
                                extraAttachErr,
                            );
                        }
                    }

                    results.push({
                        messageId: msg.id,
                        fileName: part.filename,
                        client,
                        application,
                        existingClient,
                        senderEmail,
                        matchedIsoId: resolvedIsoId,
                    });
                    processedAnyPdf = true;
                } catch (pdfError: unknown) {
                    const pm = pdfError instanceof Error ? pdfError.message : String(pdfError);
                    console.error(
                        `Failed to process PDF "${part.filename}" from message ${msg.id}:`,
                        pm,
                        pdfError,
                    );
                    /** New-client path requires business name + owner names; starring flags manual intake. */
                    if (pdfError instanceof InsufficientParsedPdfError) {
                        console.warn(
                            `[gmail-auto-create] message=${msg.id} insufficient PDF data (owner name); starring`,
                        );
                        await starMessage(msg.id, accessToken);
                    }
                }

                if (processedAnyPdf) {
                    await markMessageAsRead(msg.id, accessToken);
                }
            } catch (messageErr: unknown) {
                console.error(
                    `[gmail-auto-create] message ${msg.id} failed — continuing with next:`,
                    messageErr,
                );
            } finally {
                inFlightAutoCreateMessageIds.delete(msg.id);
            }
        }

        return results;
    } catch (error: unknown) {
        const msg =
            error instanceof Error && error.message
                ? error.message
                : String(error ?? 'unknown error');
        throw new Error(`[gmail-auto-create] ${msg}`);
    }
}