import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { allocateNextDealId } from '../services/nextDealIdService';

export { DEAL_ID_PREFIX } from '../services/nextDealIdService';

/**
 * Returns the next sequential `Application.dealId` as a bare number string
 * (e.g. `"15"` → `"16"`). Funder letter prefixes are applied later when a
 * contract funder is selected.
 *
 * Pass the Prisma transaction client when already inside `$transaction`; otherwise
 * a short transaction is used so allocation is serialized via advisory lock.
 */
export async function generateNextDealId(tx?: Prisma.TransactionClient): Promise<string> {
    if (tx) return allocateNextDealId(tx);
    return prisma.$transaction((innerTx) => allocateNextDealId(innerTx), {
        maxWait: 10_000,
        timeout: 30_000,
    });
}
