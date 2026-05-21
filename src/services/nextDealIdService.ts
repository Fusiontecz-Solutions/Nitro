import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';

export const DEAL_ID_PREFIX = 'WF';

type TransactionClient = Prisma.TransactionClient;

/** Postgres advisory lock key for serializing WF deal id allocation. */
const ADVISORY_LOCK_KEY = 874_203_891;

/**
 * Returns the next deal id (`WF{n}`) where `n` is one greater than the highest numeric
 * suffix among existing `WF`-prefixed deal ids (case-insensitive). Starts at `WF1` when none exist.
 */
export async function allocateNextDealId(tx: TransactionClient): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;

    const rows = await tx.$queryRaw<Array<{ max_num: number | null }>>`
        SELECT MAX((regexp_match(upper("dealId"), '^WF([0-9]+)$'))[1]::integer) AS max_num
        FROM "Application"
        WHERE "dealId" IS NOT NULL
    `;

    const maxNum = rows[0]?.max_num != null ? Number(rows[0].max_num) : 0;
    const next = Number.isFinite(maxNum) && maxNum >= 0 ? maxNum + 1 : 1;
    return `${DEAL_ID_PREFIX}${next}`;
}

/** Allocate a deal id and run `fn` inside the same transaction (safe under concurrent creates). */
export async function withAllocatedDealId<T>(
    fn: (dealId: string, tx: TransactionClient) => Promise<T>,
): Promise<T> {
    return prisma.$transaction(async (tx) => {
        const dealId = await allocateNextDealId(tx);
        return fn(dealId, tx);
    });
}
