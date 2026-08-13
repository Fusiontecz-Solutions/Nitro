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

/**
 * Returns the next deal id as a bare number string (`"1"`, `"2"`, …).
 * Sequence is one greater than the highest trailing numeric suffix among existing
 * deal ids (e.g. `WF3`, `KK12`, `15` → next is `"16"`). Starts at `"1"` when none exist.
 */
export async function allocateNextDealId(tx: TransactionClient): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;

    const rows = await tx.$queryRaw<Array<{ max_num: number | null }>>`
        SELECT MAX((regexp_match(trim("dealId"), '([0-9]+)$'))[1]::integer) AS max_num
        FROM "Application"
        WHERE "dealId" IS NOT NULL
          AND trim("dealId") <> ''
          AND trim("dealId") ~ '[0-9]+$'
    `;

    const maxNum = rows[0]?.max_num != null ? Number(rows[0].max_num) : 0;
    const next = Number.isFinite(maxNum) && maxNum >= 0 ? maxNum + 1 : 1;
    return String(next);
}

/** Allocate a deal id and run `fn` inside the same transaction (safe under concurrent creates). */
export async function withAllocatedDealId<T>(
    fn: (dealId: string, tx: TransactionClient) => Promise<T>,
): Promise<T> {
    // Default interactive tx timeout is 5s; allocate + create (with includes) can exceed that
    // under concurrent load / advisory lock wait (P2028).
    return prisma.$transaction(
        async (tx) => {
            const dealId = await allocateNextDealId(tx);
            return fn(dealId, tx);
        },
        { maxWait: 10_000, timeout: 30_000 },
    );
}
