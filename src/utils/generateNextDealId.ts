import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { allocateNextDealId } from '../services/nextDealIdService';

export { DEAL_ID_PREFIX } from '../services/nextDealIdService';

/**
 * Returns the next sequential `Application.dealId` (`WF{n}`), one greater than the
 * highest existing `WF`-prefixed deal id (e.g. `WF2011` → `WF2012`).
 *
 * Pass the Prisma transaction client when already inside `$transaction`; otherwise
 * a short transaction is used so allocation is serialized via advisory lock.
 */
export async function generateNextDealId(tx?: Prisma.TransactionClient): Promise<string> {
    if (tx) return allocateNextDealId(tx);
    return prisma.$transaction((innerTx) => allocateNextDealId(innerTx));
}
