import { createHash } from 'crypto';

import prisma from '../config/prismaClient';
import { getRedisClient } from '../config/redis';

/** In-process dedupe when Redis is unavailable. */
const handledInMemory = new Set<string>();

const TTL_DAYS_DEFAULT = 90;
const SCAN_DAYS_DEFAULT = 14;

function cacheKey(userId: string, messageId: string): string {
    return `gmail:auto-create:handled:${userId}:${messageId}`;
}

function readTtlSeconds(): number {
    const raw = Number(process.env.GMAIL_AUTO_CREATE_PROCESSED_TTL_DAYS ?? TTL_DAYS_DEFAULT);
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 365) : TTL_DAYS_DEFAULT;
    return days * 24 * 60 * 60;
}

/** How far back the Gmail list query scans (read + unread). */
export function readGmailAutoCreateScanDays(): number {
    const raw = Number(process.env.GMAIL_AUTO_CREATE_SCAN_DAYS ?? SCAN_DAYS_DEFAULT);
    if (!Number.isFinite(raw) || raw < 1) return SCAN_DAYS_DEFAULT;
    return Math.min(Math.floor(raw), 90);
}

export function buildGmailPdfInboxQuery(): string {
    const scanDays = readGmailAutoCreateScanDays();
    return `has:attachment filename:pdf newer_than:${scanDays}d`;
}

/** Stable SHA-256 idempotency key for a CRM user + Gmail message id. */
export function gmailAutoCreateMessageKey(userId: string, gmailMessageId: string): string {
    const user = String(userId || '').trim();
    const messageId = String(gmailMessageId || '').trim();
    return createHash('sha256').update(`${user}:${messageId}`, 'utf8').digest('hex');
}

/** SHA-256 hex digest of PDF attachment bytes (cross-email duplicate detection). */
export function sha256PdfContent(pdfBuffer: Buffer): string {
    return createHash('sha256').update(pdfBuffer).digest('hex');
}

export type GmailAutoCreateOutcome =
    | 'success'
    | 'skipped_no_pdf'
    | 'skipped_duplicate'
    | 'failed_parse'
    | 'failed_other';

export type RecordGmailAutoCreateParams = {
    applicationId?: string | null;
    pdfContentHash?: string | null;
};

async function lookupLedger(messageKey: string): Promise<boolean> {
    try {
        const row = await prisma.gmailAutoCreateLedger.findUnique({
            where: { messageKey },
            select: { id: true },
        });
        return !!row;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gmail-auto-create] ledger lookup failed for key=${messageKey}: ${msg}`);
        return false;
    }
}

/**
 * True if this Gmail message was already handled by auto-create for this CRM user
 * (success, skip, or terminal failure). Prevents repeat Claude calls on cron retries.
 */
export async function isGmailAutoCreateMessageHandled(
    userId: string,
    messageId: string,
): Promise<boolean> {
    const messageKey = gmailAutoCreateMessageKey(userId, messageId);
    const key = cacheKey(userId, messageId);
    if (handledInMemory.has(key)) {
        return true;
    }

    if (await lookupLedger(messageKey)) {
        handledInMemory.add(key);
        return true;
    }

    const redis = getRedisClient();
    if (!redis) {
        return false;
    }

    try {
        const value = await redis.get(key);
        if (value) {
            handledInMemory.add(key);
            return true;
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gmail-auto-create] Redis lookup failed for ${messageId}: ${msg}`);
    }
    return false;
}

export async function hasRecentGmailPdfContentHash(params: {
    userId: string;
    pdfContentHash: string;
    dedupeDays?: number;
}): Promise<boolean> {
    const pdfContentHash = String(params.pdfContentHash || '').trim();
    if (!pdfContentHash || !params.userId) return false;

    const dedupeDaysRaw = Number(process.env.GMAIL_AUTO_CREATE_DEDUPE_DAYS ?? 7);
    const dedupeDays =
        Number.isFinite(dedupeDaysRaw) && dedupeDaysRaw > 0
            ? Math.min(Math.floor(dedupeDaysRaw), 90)
            : 7;
    const since = new Date(Date.now() - dedupeDays * 24 * 60 * 60 * 1000);

    try {
        const row = await prisma.gmailAutoCreateLedger.findFirst({
            where: {
                userId: params.userId,
                pdfContentHash,
                outcome: 'success',
                createdAt: { gte: since },
            },
            select: { id: true },
        });
        return !!row;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gmail-auto-create] pdf hash lookup failed: ${msg}`);
        return false;
    }
}

export async function recordGmailAutoCreateMessageHandled(
    userId: string,
    messageId: string,
    outcome: GmailAutoCreateOutcome,
    extras?: RecordGmailAutoCreateParams,
): Promise<void> {
    const gmailMessageId = String(messageId || '').trim();
    if (!gmailMessageId || !userId) return;

    const messageKey = gmailAutoCreateMessageKey(userId, gmailMessageId);
    const key = cacheKey(userId, gmailMessageId);
    handledInMemory.add(key);

    const applicationId = extras?.applicationId ? String(extras.applicationId).trim() : null;
    const pdfContentHash = extras?.pdfContentHash ? String(extras.pdfContentHash).trim() : null;

    try {
        await prisma.gmailAutoCreateLedger.upsert({
            where: { messageKey },
            create: {
                userId,
                gmailMessageId,
                messageKey,
                outcome,
                applicationId: applicationId || undefined,
                pdfContentHash: pdfContentHash || undefined,
            },
            update: {
                outcome,
                applicationId: applicationId || undefined,
                pdfContentHash: pdfContentHash || undefined,
            },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gmail-auto-create] ledger upsert failed for ${gmailMessageId}: ${msg}`);
    }

    const redis = getRedisClient();
    if (!redis) {
        return;
    }

    try {
        await redis.set(key, outcome, 'EX', readTtlSeconds());
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[gmail-auto-create] Redis record failed for ${gmailMessageId}: ${msg}`);
    }
}
