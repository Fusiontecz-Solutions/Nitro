import prisma from '../../config/prismaClient';
import { getRedisClient } from '../../config/redis';
import { attachBufferAsApplicationFile } from '../applicationPdfAttachService';
import {
    hasRecentApplicationForGmailMessage,
    readPdfFileDedupeDays,
} from '../pdfFileDedupeService';
import type { PdfApplicationResult } from '../applicationService';
import { notifyNewInUnderwriterPool } from '../applicationWorkflowService';
import {
    buildGmailPdfInboxQuery,
    hasRecentGmailPdfContentHash,
    isGmailAutoCreateMessageHandled,
    recordGmailAutoCreateMessageHandled,
    sha256PdfContent,
} from './gmailAutoCreateProcessedStore';
import { evaluateGmailAutoCreateSkip } from './gmailAutoCreateFilters';
import { parseMerchantNameFromSubject } from './gmailSubjectMerchantParser';
import {
    downloadAttachmentById,
    getMessageFull,
    labelMessagesInCrm,
    listMessageIds,
    modifyMessages,
} from './gmailMailboxService';
import { getGmailAccessTokenForUser } from './gmailOAuthService';

/**
 * Gmail PDF auto-create (ported from Katam): scans a CRM user's connected INBOX for
 * deal-submission emails (≥2 PDFs), extracts the application PDF with the configured
 * extractor (Document AI via PDF_EXTRACTION_PROVIDER) and creates Client + Application.
 *
 * Ownership: every deal is created with referringAgentId = createdById = salesRep = the
 * mailbox owner, so the Agent visibility rules (`buildAgentApplicationVisibilityWhere`,
 * `canUserAccessApplication`) show it to that Agent only. For an Agent mailbox, client
 * matching is also limited to that Agent's own clients.
 *
 * Dedupe layers: in-flight Set → ledger (DB + Redis) → `gmail-msg:<id>` note → `-label:in-crm`
 * → application-PDF SHA-256 (same deal arriving in a second email).
 * Messages that need a human (unparseable PDF) are starred.
 */

const inFlightAutoCreateMessageIds = new Set<string>();

export type GmailAutoCreateResult = {
    messageId: string;
    fileName: string | null;
    clientId: string | null;
    applicationId: string | null;
    existingClient: boolean;
    senderEmail: string | null;
    matchedIsoId: string | null;
};

export type GmailAutoCreateOwner = {
    id: string;
    role: string;
    email?: string | null;
    googleEmail?: string | null;
};

/* ================================
   MIME helpers
================================ */

/** Breadth-first MIME walk — avoids stack overflow on deeply nested multiparts. */
export function collectMimeAttachmentParts(payload: unknown): any[] {
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
            for (const p of part.parts) queue.push(p);
        }
    }
    if (steps >= MAX_STEPS) {
        console.warn('[gmail-auto-create] MIME walk hit step limit; attachments may be incomplete.');
    }
    return found;
}

export function collectPdfAttachmentParts(parts: unknown[]): Array<Record<string, any>> {
    return (parts || []).filter((p: any) => {
        const filename = String(p?.filename || '').trim().toLowerCase();
        return Boolean(p?.body?.attachmentId) && filename.endsWith('.pdf');
    }) as Array<Record<string, any>>;
}

/**
 * Filename order: Application → app → form → deal; then largest PDF above a minimum size.
 */
function applicationPdfAttachmentFilenameScore(filename: string): number {
    const n = filename.trim().toLowerCase();
    if (n.includes('application')) return 4;
    if (
        /\bapp\b/i.test(n) ||
        /^app(?:[\s_\-./]|$)/i.test(n) ||
        /[\s_\/-]app(?:[\s_\-./]|\.pdf$|$)/i.test(n)
    ) {
        return 3;
    }
    if (/\bform\b/.test(n)) return 2;
    if (/\bdeal\b/.test(n)) return 1;
    return 0;
}

function gmailAttachmentDeclaredSize(part: { body?: { size?: unknown } | null } | null): number {
    const s = Number(part?.body?.size ?? 0);
    return Number.isFinite(s) && s > 0 ? s : 0;
}

function readGmailApplicationPdfMinBytes(): number {
    const n = Number(String(process.env.GMAIL_APPLICATION_PDF_MIN_BYTES ?? '20480').trim());
    if (!Number.isFinite(n) || n < 4096) return 20480;
    return Math.min(Math.floor(n), 50 * 1024 * 1024);
}

/** The MIME part most likely to be the MCA application, or null when it is a coin-flip. */
export function pickApplicationPdfAttachment(parts: unknown[]): Record<string, any> | null {
    const pdfParts = collectPdfAttachmentParts(parts);
    if (pdfParts.length === 0) return null;
    if (pdfParts.length === 1) return pdfParts[0] ?? null;

    const ranked = pdfParts.map((part) => {
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
        if (second && second.score === best.score && second.size === best.size && best.filename !== second.filename) {
            return null;
        }
        return best.part;
    }

    // No filename hint: the largest PDF ≥ min bytes (a scanned app beats one-page stubs).
    const eligible = ranked.filter((r) => r.size >= readGmailApplicationPdfMinBytes());
    if (eligible.length === 0) return null;
    eligible.sort(
        (a, b) => b.size - a.size || a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }),
    );
    const top = eligible[0]!;
    const next = eligible[1];
    if (next && next.size === top.size && top.filename !== next.filename) return null;
    return top.part;
}

/* ================================
   Sender → ISO
================================ */

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function normalizeEmailAddress(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function extractAllEmails(value: unknown): string[] {
    const matches = String(value || '').match(EMAIL_RE) || [];
    return Array.from(new Set(matches.map(normalizeEmailAddress).filter(Boolean)));
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
    const out: string[] = [];
    const queue: any[] = payload ? [payload] : [];
    while (queue.length) {
        const part = queue.shift();
        const mimeType = String(part?.mimeType || '').toLowerCase();
        const data = String(part?.body?.data || '');
        if ((mimeType === 'text/plain' || mimeType === 'text/html') && data) {
            const decoded = decodeBase64Url(data);
            if (decoded) out.push(decoded);
        }
        if (Array.isArray(part?.parts)) queue.push(...part.parts);
    }
    return out;
}

function extractSenderCandidates(headers: Array<{ name?: string; value?: string }>): string[] {
    const candidates = new Set<string>();
    for (const headerName of ['from', 'reply-to', 'sender', 'return-path']) {
        const rawValue = headers.find((h) => String(h?.name || '').toLowerCase() === headerName)?.value;
        extractAllEmails(rawValue).forEach((e) => candidates.add(e));
    }
    return Array.from(candidates);
}

/** Addresses quoted in a forwarded body ("From: iso@…") — the real ISO when an Agent forwards. */
function extractForwardedSenderCandidates(message: any): string[] {
    const candidates = new Set<string>(extractAllEmails(message?.snippet));
    for (const text of collectPayloadTextParts(message?.payload)) {
        extractAllEmails(text).forEach((e) => candidates.add(e));
    }
    return Array.from(candidates);
}

/** Domains of our own staff (comma-separated `GMAIL_AUTO_CREATE_INTERNAL_DOMAINS`); never an ISO. */
function readInternalDomains(): string[] {
    return String(process.env.GMAIL_AUTO_CREATE_INTERNAL_DOMAINS || '')
        .split(',')
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
}

export function isInternalAddress(email: string, ownAddresses: string[]): boolean {
    const e = normalizeEmailAddress(email);
    if (!e) return true;
    if (ownAddresses.includes(e)) return true;
    const domain = e.split('@')[1] || '';
    return readInternalDomains().some((d) => domain === d || domain.endsWith(`.${d}`));
}

async function resolveIsoIdFromSenderCandidates(senderCandidates: string[]): Promise<string | null> {
    if (senderCandidates.length === 0) return null;
    const isos = await prisma.iso.findMany({
        where: { OR: senderCandidates.map((email) => ({ email: { equals: email, mode: 'insensitive' as const } })) },
        select: { id: true, email: true },
    });
    // Candidates are ordered by priority (headers first), so honour that order.
    for (const email of senderCandidates) {
        const match = isos.find((iso) => normalizeEmailAddress(iso.email) === email);
        if (match) return String(match.id);
    }

    // Unknown sender: auto-create an ISO so the deal always links to one (Katam behaviour).
    const preferredEmail = senderCandidates[0];
    if (!preferredEmail) return null;
    const localPart = preferredEmail.split('@')[0] || 'Auto ISO';
    const inferredName =
        localPart
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
    console.log(`[gmail-auto-create] auto-created ISO email=${preferredEmail} isoId=${createdIso.id}`);
    return String(createdIso.id);
}

/* ================================
   Gmail side effects (best-effort)
================================ */

async function markInCrm(accessToken: string, messageId: string): Promise<void> {
    try {
        await labelMessagesInCrm(accessToken, [messageId]);
    } catch (err: any) {
        console.warn(
            `[gmail-auto-create] failed to label ${messageId} in-crm:`,
            err?.response?.data?.error?.message || err?.message || err,
        );
    }
}

/** Starred = needs a human look (PDF could not be read confidently). */
async function starMessage(accessToken: string, messageId: string): Promise<void> {
    try {
        await modifyMessages(accessToken, [messageId], ['STARRED'], []);
    } catch (err: any) {
        console.warn(
            `[gmail-auto-create] failed to star ${messageId}:`,
            err?.response?.data?.error?.message || err?.message || err,
        );
    }
}

function getHeader(headers: Array<{ name?: string; value?: string }>, name: string): string {
    const lower = name.toLowerCase();
    return headers.find((h) => String(h?.name || '').toLowerCase() === lower)?.value || '';
}

async function attachPdfParts(
    accessToken: string,
    applicationId: string,
    messageId: string,
    pdfParts: Array<Record<string, any>>,
): Promise<void> {
    for (const pdfPart of pdfParts) {
        const fileName = String(pdfPart?.filename || '').trim() || 'document.pdf';
        try {
            const attachmentId = String(pdfPart?.body?.attachmentId || '').trim();
            if (!attachmentId) continue;
            const buffer = await downloadAttachmentById(accessToken, messageId, attachmentId);
            await attachBufferAsApplicationFile(applicationId, buffer, fileName);
        } catch (err) {
            console.error(`[gmail-auto-create] message=${messageId} failed to attach PDF "${fileName}":`, err);
        }
    }
}

/* ================================
   Subject fallback
================================ */

type FallbackOutcome =
    | { kind: 'created'; result: PdfApplicationResult }
    | { kind: 'duplicate' }
    | null;

async function attemptSubjectFallbackCreate(params: {
    accessToken: string;
    owner: GmailAutoCreateOwner;
    messageId: string;
    subject: string;
    pdfParts: Array<Record<string, any>>;
    isoId: string | null;
}): Promise<FallbackOutcome> {
    const merchantName = parseMerchantNameFromSubject(params.subject);
    if (!merchantName || params.pdfParts.length < 2) {
        console.warn(
            `[gmail-auto-create] message=${params.messageId} subject fallback skipped (merchant="${merchantName || ''}" pdfs=${params.pdfParts.length})`,
        );
        return null;
    }
    if (
        await hasRecentApplicationForGmailMessage({
            createdById: params.owner.id,
            gmailMessageId: params.messageId,
            dedupeDays: readPdfFileDedupeDays(),
        })
    ) {
        return { kind: 'duplicate' };
    }

    const { createApplicationFromGmailSubjectFallback } = await import('../applicationService');
    console.log(`[gmail-auto-create] message=${params.messageId} subject fallback merchant="${merchantName}"`);
    const result = await createApplicationFromGmailSubjectFallback(merchantName, params.owner.id, {
        isoId: params.isoId,
        gmailMessageId: params.messageId,
        restrictClientToOwnerId: clientOwnerScopeFor(params.owner),
    });
    await attachPdfParts(params.accessToken, result.application.id, params.messageId, params.pdfParts);
    notifyUnderwriters(result, params.owner.id);
    return { kind: 'created', result };
}

/** Auto-created deals land in the Underwriter pool — alert the Underwriters like a submitted deal. */
function notifyUnderwriters(created: PdfApplicationResult, ownerId: string): void {
    const app = created.application;
    if (!app?.id) return;
    notifyNewInUnderwriterPool(
        { id: app.id, applicationId: app.applicationId, client: app.client ?? created.client },
        ownerId,
    );
}

/** Agent mailboxes only reuse / own their own clients; other roles keep the global match. */
function clientOwnerScopeFor(owner: GmailAutoCreateOwner): string | null {
    return String(owner.role || '').trim().toUpperCase() === 'AGENT' ? owner.id : null;
}

function toResult(
    messageId: string,
    fileName: string | null,
    created: PdfApplicationResult,
    senderEmail: string | null,
    matchedIsoId: string | null,
): GmailAutoCreateResult {
    return {
        messageId,
        fileName,
        clientId: created.client?.id ?? null,
        applicationId: created.application?.id ?? null,
        existingClient: created.existingClient,
        senderEmail,
        matchedIsoId,
    };
}

/* ================================
   Entry point
================================ */

function readMaxMessages(): number {
    const raw = Number(process.env.GMAIL_AUTO_CREATE_MAX_MESSAGES ?? 100);
    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 300) : 100;
}

/**
 * Scan the owner's INBOX and auto-create Clients + Applications from deal emails.
 * Every created application belongs to `owner` (referring agent, creator, sales rep).
 */
export async function autoCreateApplicationsFromEmails(
    accessToken: string,
    owner: GmailAutoCreateOwner,
    options?: { notBefore?: Date | null },
): Promise<GmailAutoCreateResult[]> {
    const { createClientAndApplicationFromPDFBuffer, InsufficientParsedPdfError } = await import(
        '../applicationService'
    );
    const userId = owner.id;
    const ownAddresses = [owner.email, owner.googleEmail].map(normalizeEmailAddress).filter(Boolean);
    const clientOwnerId = clientOwnerScopeFor(owner);

    const notBefore = options?.notBefore;
    const query =
        notBefore && !Number.isNaN(notBefore.getTime())
            ? `${buildGmailPdfInboxQuery()} after:${Math.floor(notBefore.getTime() / 1000)}`
            : buildGmailPdfInboxQuery();

    // Paginate past noise (e-sign / single-PDF mail) so real deals are not stranded behind page 1.
    const maxMessages = readMaxMessages();
    const messageIds: string[] = [];
    let pageToken: string | undefined;
    while (messageIds.length < maxMessages) {
        const page = await listMessageIds(accessToken, {
            q: query,
            labelIds: ['INBOX'],
            maxResults: Math.min(50, maxMessages - messageIds.length),
            pageToken,
        });
        messageIds.push(...page.ids);
        if (!page.nextPageToken || page.ids.length === 0) break;
        pageToken = page.nextPageToken;
    }

    const results: GmailAutoCreateResult[] = [];
    for (const messageId of Array.from(new Set(messageIds))) {
        const inFlightKey = `${userId}:${messageId}`;
        if (inFlightAutoCreateMessageIds.has(inFlightKey)) continue;
        if (await isGmailAutoCreateMessageHandled(userId, messageId)) continue;

        inFlightAutoCreateMessageIds.add(inFlightKey);
        try {
            const message = await getMessageFull(accessToken, messageId);
            const headers: Array<{ name?: string; value?: string }> = message?.payload?.headers || [];
            const subject = getHeader(headers, 'Subject');
            const fromHeader = getHeader(headers, 'From');

            const allSenderCandidates = Array.from(
                new Set([...extractSenderCandidates(headers), ...extractForwardedSenderCandidates(message)]),
            );
            // Our own addresses (the Agent forwarding mail to themself, staff domains) are never the ISO.
            const senderCandidates = allSenderCandidates.filter((e) => !isInternalAddress(e, ownAddresses));
            const senderEmail = senderCandidates[0] || null;

            if (
                await hasRecentApplicationForGmailMessage({
                    createdById: userId,
                    gmailMessageId: messageId,
                    dedupeDays: readPdfFileDedupeDays(),
                })
            ) {
                await recordGmailAutoCreateMessageHandled(userId, messageId, 'skipped_duplicate');
                continue;
            }

            const allParts = collectMimeAttachmentParts(message?.payload);
            const pdfParts = collectPdfAttachmentParts(allParts);
            const skip = evaluateGmailAutoCreateSkip({
                subject,
                fromHeader,
                senderEmails: allSenderCandidates,
                pdfFilenames: pdfParts.map((p) => String(p?.filename || '').trim()),
                pdfCount: pdfParts.length,
            });
            if (skip.skip) {
                console.log(
                    `[gmail-auto-create] message=${messageId} skipped_${skip.reason}: ${skip.detail} subject="${subject.slice(0, 120)}"`,
                );
                await recordGmailAutoCreateMessageHandled(userId, messageId, 'skipped_filtered');
                // Keep these out of future scans (`-label:in-crm`) so genuine deals aren't buried.
                await markInCrm(accessToken, messageId);
                continue;
            }

            // Only resolve / auto-create an ISO once we know this is a deal email.
            const isoId = await resolveIsoIdFromSenderCandidates(senderCandidates);
            console.log(
                `[gmail-auto-create] user=${userId} message=${messageId} sender=${senderEmail || 'none'} isoId=${isoId || 'none'}`,
            );

            const fallbackParams = { accessToken, owner, messageId, subject, pdfParts, isoId };
            const part = pickApplicationPdfAttachment(allParts);

            if (!part) {
                console.warn(
                    `[gmail-auto-create] message=${messageId} could not pick the application PDF (${pdfParts.length} pdfs); trying subject fallback`,
                );
                const outcome = await attemptSubjectFallbackCreate(fallbackParams);
                if (outcome?.kind === 'created') {
                    results.push(toResult(messageId, null, outcome.result, senderEmail, isoId));
                    await recordGmailAutoCreateMessageHandled(userId, messageId, 'success', {
                        applicationId: outcome.result.application?.id,
                    });
                    await markInCrm(accessToken, messageId);
                    await starMessage(accessToken, messageId);
                } else if (outcome?.kind === 'duplicate') {
                    await recordGmailAutoCreateMessageHandled(userId, messageId, 'skipped_duplicate');
                } else {
                    await recordGmailAutoCreateMessageHandled(userId, messageId, 'failed_parse');
                    await starMessage(accessToken, messageId);
                }
                continue;
            }

            const attachmentId = String(part.body?.attachmentId || '');
            const fileName = String(part.filename || '').trim() || 'application.pdf';
            try {
                const pdfBuffer = await downloadAttachmentById(accessToken, messageId, attachmentId);
                const pdfContentHash = sha256PdfContent(pdfBuffer);
                // The same deal emailed twice (resent, CC'd, forwarded) arrives as separate
                // messages with an identical application PDF — keep the first deal only.
                if (await hasRecentGmailPdfContentHash({ userId, pdfContentHash })) {
                    console.log(
                        `[gmail-auto-create] message=${messageId} skipped_duplicate: application PDF "${fileName}" already created a deal`,
                    );
                    await recordGmailAutoCreateMessageHandled(userId, messageId, 'skipped_duplicate', {
                        pdfContentHash,
                    });
                    await markInCrm(accessToken, messageId);
                    continue;
                }
                const created = await createClientAndApplicationFromPDFBuffer(pdfBuffer, userId, {
                    isoId,
                    originalFileName: fileName,
                    gmailMessageId: messageId,
                    skipClaudeBusinessNameRetry: true,
                    restrictClientToOwnerId: clientOwnerId,
                    startInUnderwriterPool: true,
                });
                await attachPdfParts(
                    accessToken,
                    created.application.id,
                    messageId,
                    pdfParts.filter((p) => p?.body?.attachmentId !== attachmentId),
                );
                notifyUnderwriters(created, userId);
                results.push(toResult(messageId, fileName, created, senderEmail, isoId));
                await recordGmailAutoCreateMessageHandled(userId, messageId, 'success', {
                    applicationId: created.application.id,
                    pdfContentHash,
                });
                await markInCrm(accessToken, messageId);
            } catch (pdfError: unknown) {
                console.error(
                    `[gmail-auto-create] message=${messageId} PDF "${fileName}" failed:`,
                    pdfError instanceof Error ? pdfError.message : pdfError,
                );
                const outcome = await attemptSubjectFallbackCreate(fallbackParams);
                if (outcome?.kind === 'created') {
                    results.push(toResult(messageId, fileName, outcome.result, senderEmail, isoId));
                    await recordGmailAutoCreateMessageHandled(userId, messageId, 'success', {
                        applicationId: outcome.result.application?.id,
                    });
                    await markInCrm(accessToken, messageId);
                    await starMessage(accessToken, messageId);
                } else if (outcome?.kind === 'duplicate') {
                    await recordGmailAutoCreateMessageHandled(userId, messageId, 'skipped_duplicate');
                } else {
                    await recordGmailAutoCreateMessageHandled(
                        userId,
                        messageId,
                        pdfError instanceof InsufficientParsedPdfError ? 'failed_parse' : 'failed_other',
                    );
                    await starMessage(accessToken, messageId);
                }
            }
        } catch (messageErr: unknown) {
            // Transient (Gmail / network) — not recorded, so the next sweep retries it.
            console.error(`[gmail-auto-create] message ${messageId} failed — continuing:`, messageErr);
        } finally {
            inFlightAutoCreateMessageIds.delete(inFlightKey);
        }
    }
    return results;
}

/* ================================
   Per-user run (cron + "Run now")
================================ */

const USER_LOCK_TTL_MS = 15 * 60 * 1000;
const localUserLocks = new Set<string>();

/** One sweep per mailbox at a time, across API instances when Redis is available. */
async function acquireUserLock(userId: string): Promise<boolean> {
    if (localUserLocks.has(userId)) return false;
    const redis = getRedisClient();
    if (redis) {
        try {
            const ok = await redis.set(`gmail:auto-create:lock:${userId}`, String(process.pid), 'PX', USER_LOCK_TTL_MS, 'NX');
            if (ok !== 'OK') return false;
        } catch (err) {
            console.warn('[gmail-auto-create] redis lock failed; running anyway', (err as Error)?.message);
        }
    }
    localUserLocks.add(userId);
    return true;
}

async function releaseUserLock(userId: string): Promise<void> {
    localUserLocks.delete(userId);
    const redis = getRedisClient();
    if (!redis) return;
    try {
        await redis.del(`gmail:auto-create:lock:${userId}`);
    } catch {
        // The lock expires on its own.
    }
}

export type GmailAutoCreateRunStatus =
    | { status: 'ok'; created: GmailAutoCreateResult[] }
    | { status: 'disabled' | 'not_connected' | 'busy' };

export async function runGmailAutoCreateForUser(userId: string): Promise<GmailAutoCreateRunStatus> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            role: true,
            email: true,
            googleEmail: true,
            isActive: true,
            gmailAutoCreateEnabled: true,
            gmailAutoCreateEnabledAt: true,
        },
    });
    if (!user?.isActive || !user.gmailAutoCreateEnabled) return { status: 'disabled' };

    const accessToken = await getGmailAccessTokenForUser(user.id);
    if (!accessToken) return { status: 'not_connected' };

    if (!(await acquireUserLock(user.id))) return { status: 'busy' };
    try {
        const created = await autoCreateApplicationsFromEmails(
            accessToken,
            { id: user.id, role: String(user.role), email: user.email, googleEmail: user.googleEmail },
            { notBefore: user.gmailAutoCreateEnabledAt },
        );
        return { status: 'ok', created };
    } finally {
        await releaseUserLock(user.id);
    }
}
