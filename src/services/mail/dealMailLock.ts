/**
 * Serialize a deal's thread sends so two concurrent emails never start two
 * threads or interleave the References chain.
 *
 *   1. in-process queue per deal (cheap, always on);
 *   2. Postgres transaction-scoped advisory lock (`pg_advisory_xact_lock`) so the
 *      same holds across server instances. Released automatically on commit,
 *      rollback or a dropped connection.
 *
 * The send itself never runs on the lock's connection and its outcome always
 * wins: if the email went out, a failure to release the lock is not reported as
 * a send failure (that would invite a resend).
 */
import prisma from '../../config/prismaClient';

const inFlight = new Map<string, Promise<unknown>>();
const LOCK_TX_TIMEOUT_MS = 180_000;
const LOCK_MAX_WAIT_MS = 30_000;

function withInProcessLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = inFlight.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tracked = run.finally(() => {
        if (inFlight.get(key) === tracked) inFlight.delete(key);
    });
    inFlight.set(key, tracked);
    return run;
}

async function withAdvisoryLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (typeof (prisma as { $transaction?: unknown }).$transaction !== 'function') return task();
    let lockAcquired = false;
    let finished = false;
    let result!: T;
    try {
        await prisma.$transaction(
            async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
                lockAcquired = true;
                result = await task();
                finished = true;
            },
            { timeout: LOCK_TX_TIMEOUT_MS, maxWait: LOCK_MAX_WAIT_MS },
        );
    } catch (error) {
        if (finished) return result;
        if (!lockAcquired) {
            // DB lock unavailable (pool exhausted, DB hiccup): the in-process lock still holds.
            console.warn('[deal-mail-lock] advisory lock unavailable, continuing with in-process lock:', (error as Error)?.message);
            return task();
        }
        throw error;
    }
    return result;
}

export function withDealMailLock<T>(applicationId: string, task: () => Promise<T>): Promise<T> {
    const key = `deal-mail:${applicationId}`;
    return withInProcessLock(key, () => withAdvisoryLock(key, task));
}
