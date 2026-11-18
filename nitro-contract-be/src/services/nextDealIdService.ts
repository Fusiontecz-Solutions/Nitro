import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';

/**
 * @deprecated Deal ids are numeric on create; funder prefixes are applied later.
 * Kept for callers that still import the symbol.
 */
export const DEAL_ID_PREFIX = '';

type TransactionClient = Prisma.TransactionClient;

/** Postgres advisory lock key for serializing deal id allocation. */
const ADVISORY_LOCK_KEY = 874_203_891;

/** After the first successful sequence sync in this process, skip the full-table MAX scan. */
let dealIdSequenceReady = false;

async function scanMaxDealNumber(tx: TransactionClient): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ max_num: number | null }>>`
        SELECT MAX((regexp_match(trim("dealId"), '([0-9]+)$'))[1]::integer) AS max_num
        FROM "Application"
        WHERE "dealId" IS NOT NULL
          AND trim("dealId") <> ''
          AND trim("dealId") ~ '[0-9]+$'
    `;
    const maxNum = rows[0]?.max_num != null ? Number(rows[0].max_num) : 0;
    return Number.isFinite(maxNum) && maxNum >= 0 ? maxNum : 0;
}

async function allocateFromSequence(tx: TransactionClient): Promise<string> {
    if (!dealIdSequenceReady) {
        await tx.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS application_deal_id_seq');

        const maxNum = await scanMaxDealNumber(tx);
        const seqInfo = await tx.$queryRaw<Array<{ last_value: unknown; is_called: boolean }>>`
            SELECT last_value, is_called FROM application_deal_id_seq
        `;
        const lastValue = Number(seqInfo[0]?.last_value);
        const isCalled = Boolean(seqInfo[0]?.is_called);
        const current = !isCalled || !Number.isFinite(lastValue) ? 0 : lastValue;

        if (maxNum > current) {
            await tx.$executeRaw`SELECT setval('application_deal_id_seq', ${maxNum}, true)`;
        }

        dealIdSequenceReady = true;
    }

    const nextRows = await tx.$queryRaw<Array<{ next: unknown }>>`
        SELECT nextval('application_deal_id_seq') AS next
    `;
    const next = Number(nextRows[0]?.next);
    if (!Number.isFinite(next) || next < 1) {
        throw new Error('application_deal_id_seq returned an invalid value');
    }
    return String(next);
}

async function allocateFromMaxScan(tx: TransactionClient): Promise<string> {
    const maxNum = await scanMaxDealNumber(tx);
    return String(maxNum + 1);
}

/**
 * Returns the next deal id as a bare number string (`"1"`, `"2"`, …).
 * Sequence is one greater than the highest trailing numeric suffix among existing
 * deal ids (e.g. `WF3`, `KK12`, `15` → next is `"16"`). Starts at `"1"` when none exist.
 */
export async function allocateNextDealId(tx: TransactionClient): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;

    try {
        return await allocateFromSequence(tx);
    } catch (err) {
        dealIdSequenceReady = false;
        console.warn('[nextDealId] sequence allocation failed, falling back to MAX scan:', err);
        return allocateFromMaxScan(tx);
    }
}

/** Allocate a deal id and run `fn` inside the same transaction (safe under concurrent creates). */
export async function withAllocatedDealId<T>(
    fn: (dealId: string, tx: TransactionClient) => Promise<T>,
): Promise<T> {
    // Default interactive tx timeout is 5s; allocate + create can exceed that
    // under concurrent load / advisory lock wait (P2028).
    return prisma.$transaction(
        async (tx) => {
            const dealId = await allocateNextDealId(tx);
            return fn(dealId, tx);
        },
        { maxWait: 10_000, timeout: 30_000 },
    );
}
