/**
 * Durable idempotency for outbound email (MailSendClaim, one row per physical email).
 *
 *   claim    → insert the key in state `sending` (unique index = cross-instance safe)
 *   success  → `sent` with provider / mailbox / message ids
 *   failure  → `failed` when the provider certainly did not accept it (may be
 *              reclaimed by a later attempt), `unknown` when it may have (blocks
 *              every automatic resend; a person must check and release it)
 *
 * Deal emails get an automatic key: deal + recipients + subject + body hash +
 * a short time window, so a double click, a duplicate request or a job retry
 * cannot email the ISO twice, while a deliberate resend later still goes out.
 */
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../config/prismaClient';
import { DuplicateMailSendError, failureKindOf, type MailProviderName } from './mailErrors';

/** Identical deal emails inside this window are treated as one. */
export const DEAL_MAIL_DEDUPE_WINDOW_MS = 2 * 60 * 1000;

export interface ClaimedMailSend {
    claimId: string;
    idempotencyKey: string;
}

export interface MailSendClaimRecord {
    state: string;
    provider: string | null;
    providerMessageId: string | null;
    rfcMessageId: string | null;
    gmailThreadId: string | null;
    mailboxEmail: string | null;
}

const listOf = (value?: string | string[]): string[] =>
    (Array.isArray(value) ? value : value ? [value] : [])
        .map((v) => String(v || '').trim().toLowerCase())
        .filter(Boolean)
        .sort();

/** Automatic key for a deal email (null when the email is not deal-scoped). */
export function buildDealMailIdempotencyKey(input: {
    applicationId?: string | null;
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    subject: string;
    html: string;
    now?: number;
}): string | null {
    const applicationId = String(input.applicationId ?? '').trim();
    if (!applicationId) return null;
    const digest = crypto
        .createHash('sha256')
        .update(
            JSON.stringify({
                to: listOf(input.to),
                cc: listOf(input.cc),
                bcc: listOf(input.bcc),
                subject: String(input.subject || '').trim(),
                html: String(input.html || ''),
            }),
        )
        .digest('hex')
        .slice(0, 32);
    const bucket = Math.floor((input.now ?? Date.now()) / DEAL_MAIL_DEDUPE_WINDOW_MS);
    return `deal:${applicationId}:${digest}:${bucket}`;
}

const isUniqueViolation = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Claim `idempotencyKey`. Throws {@link DuplicateMailSendError} when the key is
 * already sent / in flight / unknown. A `failed` claim is taken over atomically.
 */
export async function claimMailSend(input: {
    idempotencyKey: string;
    applicationId?: string | null;
    outboundCommunicationId?: string | null;
    recipient?: string | null;
    subject?: string | null;
}): Promise<ClaimedMailSend> {
    const idempotencyKey = input.idempotencyKey.slice(0, 512);
    try {
        const row = await prisma.mailSendClaim.create({
            data: {
                idempotencyKey,
                state: 'sending',
                applicationId: input.applicationId || null,
                outboundCommunicationId: input.outboundCommunicationId || null,
                recipient: input.recipient?.slice(0, 1000) || null,
                subject: input.subject?.slice(0, 500) || null,
            },
            select: { id: true },
        });
        return { claimId: row.id, idempotencyKey };
    } catch (error) {
        if (!isUniqueViolation(error)) throw error;
    }

    const existing = await prisma.mailSendClaim.findUnique({ where: { idempotencyKey } });
    if (existing?.state === 'failed') {
        // Conditional update: only one concurrent retry can take over a failed claim.
        const taken = await prisma.mailSendClaim.updateMany({
            where: { id: existing.id, state: 'failed' },
            data: { state: 'sending', error: null, attempts: { increment: 1 }, completedAt: null },
        });
        if (taken.count === 1) return { claimId: existing.id, idempotencyKey };
    }
    const current = existing?.state === 'failed' ? await prisma.mailSendClaim.findUnique({ where: { idempotencyKey } }) : existing;
    throw new DuplicateMailSendError(idempotencyKey, current?.state ?? 'sending');
}

export async function getMailSendClaim(idempotencyKey: string): Promise<MailSendClaimRecord | null> {
    return prisma.mailSendClaim.findUnique({
        where: { idempotencyKey },
        select: { state: true, provider: true, providerMessageId: true, rfcMessageId: true, gmailThreadId: true, mailboxEmail: true },
    });
}

export async function completeMailSend(
    claimId: string,
    result: {
        provider?: MailProviderName | null;
        mailboxEmail?: string | null;
        funderProfileId?: string | null;
        providerMessageId?: string | null;
        gmailThreadId?: string | null;
        rfcMessageId?: string | null;
    },
): Promise<void> {
    await prisma.mailSendClaim.update({
        where: { id: claimId },
        data: {
            state: 'sent',
            provider: result.provider ?? null,
            mailboxEmail: result.mailboxEmail ?? null,
            funderProfileId: result.funderProfileId ?? null,
            providerMessageId: result.providerMessageId ?? null,
            gmailThreadId: result.gmailThreadId ?? null,
            rfcMessageId: result.rfcMessageId ?? null,
            error: null,
            completedAt: new Date(),
        },
    });
}

export async function failMailSend(claimId: string, error: unknown): Promise<void> {
    const state = failureKindOf(error) === 'not_sent' ? 'failed' : 'unknown';
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await prisma.mailSendClaim.update({
        where: { id: claimId },
        data: { state, error: message, completedAt: new Date() },
    });
}

/**
 * Manual release after a person confirmed an `unknown` / stuck `sending` email
 * was NOT delivered. Marks it `failed` so the next send may proceed.
 */
export async function releaseMailSendClaim(idempotencyKey: string): Promise<boolean> {
    const result = await prisma.mailSendClaim.updateMany({
        where: { idempotencyKey, state: { in: ['unknown', 'sending'] } },
        data: { state: 'failed', error: 'released manually' },
    });
    return result.count === 1;
}
