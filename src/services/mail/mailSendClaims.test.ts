/**
 * Durable idempotency ledger: one claim per physical email, enforced by the
 * unique key (simulated here); only a `failed` claim can be taken over.
 */
import { Prisma } from '@prisma/client';

const rows = new Map<string, any>();
let nextId = 1;
const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

jest.mock('../../config/prismaClient', () => ({
    __esModule: true,
    default: {
        mailSendClaim: {
            create: jest.fn(async ({ data }: any) => {
                if ([...rows.values()].some((r) => r.idempotencyKey === data.idempotencyKey)) throw uniqueViolation();
                const row = { id: `c${nextId++}`, attempts: 1, ...data };
                rows.set(row.id, row);
                return row;
            }),
            findUnique: jest.fn(async ({ where }: any) => [...rows.values()].find((r) => r.idempotencyKey === where.idempotencyKey) ?? null),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const matches = [...rows.values()].filter(
                    (r) =>
                        (!where.id || r.id === where.id) &&
                        (!where.idempotencyKey || r.idempotencyKey === where.idempotencyKey) &&
                        (typeof where.state === 'string' ? r.state === where.state : !where.state?.in || where.state.in.includes(r.state)),
                );
                for (const r of matches) {
                    const { attempts, ...rest } = data;
                    Object.assign(r, rest, attempts?.increment ? { attempts: r.attempts + attempts.increment } : {});
                }
                return { count: matches.length };
            }),
            update: jest.fn(async ({ where, data }: any) => Object.assign(rows.get(where.id), data)),
        },
    },
}));

import { MailDeliveryError, DuplicateMailSendError } from './mailErrors';
import {
    DEAL_MAIL_DEDUPE_WINDOW_MS,
    buildDealMailIdempotencyKey,
    claimMailSend,
    completeMailSend,
    failMailSend,
    releaseMailSendClaim,
} from './mailSendClaims';

describe('buildDealMailIdempotencyKey', () => {
    const base = { applicationId: 'app-1', to: ['ISO@x.com'], subject: 'Approved', html: '<p>a</p>', now: 1_000_000 };

    it('is stable for the same email regardless of recipient order / case', () => {
        expect(buildDealMailIdempotencyKey({ ...base, to: ['b@x.com', 'iso@x.com'] })).toBe(
            buildDealMailIdempotencyKey({ ...base, to: ['ISO@x.com', 'B@x.com'] }),
        );
    });

    it('differs per recipient, content, deal and time window', () => {
        const key = buildDealMailIdempotencyKey(base);
        expect(buildDealMailIdempotencyKey({ ...base, to: 'other@x.com' })).not.toBe(key);
        expect(buildDealMailIdempotencyKey({ ...base, html: '<p>b</p>' })).not.toBe(key);
        expect(buildDealMailIdempotencyKey({ ...base, applicationId: 'app-2' })).not.toBe(key);
        expect(buildDealMailIdempotencyKey({ ...base, now: base.now + DEAL_MAIL_DEDUPE_WINDOW_MS })).not.toBe(key);
    });

    it('is null for mail that is not deal-scoped', () => {
        expect(buildDealMailIdempotencyKey({ ...base, applicationId: null })).toBeNull();
    });
});

describe('claimMailSend', () => {
    beforeEach(() => {
        rows.clear();
        nextId = 1;
    });

    it('lets exactly one concurrent claim through', async () => {
        const results = await Promise.allSettled([
            claimMailSend({ idempotencyKey: 'k1' }),
            claimMailSend({ idempotencyKey: 'k1' }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(DuplicateMailSendError);
        expect(rejected.reason.state).toBe('sending');
    });

    it('blocks a resend once sent', async () => {
        const claim = await claimMailSend({ idempotencyKey: 'k2' });
        await completeMailSend(claim.claimId, { provider: 'sendgrid', providerMessageId: 'sg-1' });
        await expect(claimMailSend({ idempotencyKey: 'k2' })).rejects.toMatchObject({ state: 'sent' });
    });

    it('allows a retry after a definite failure, and blocks it after an ambiguous one', async () => {
        const first = await claimMailSend({ idempotencyKey: 'k3' });
        await failMailSend(first.claimId, new MailDeliveryError('rejected', { kind: 'not_sent' }));
        const retry = await claimMailSend({ idempotencyKey: 'k3' });
        expect(retry.claimId).toBe(first.claimId);
        expect([...rows.values()][0].attempts).toBe(2);

        await failMailSend(retry.claimId, new MailDeliveryError('timeout', { kind: 'ambiguous' }));
        await expect(claimMailSend({ idempotencyKey: 'k3' })).rejects.toMatchObject({ state: 'unknown' });
    });

    it('can be released manually after a person confirms non-delivery', async () => {
        const claim = await claimMailSend({ idempotencyKey: 'k4' });
        await failMailSend(claim.claimId, new Error('socket hang up'));
        expect(await releaseMailSendClaim('k4')).toBe(true);
        await expect(claimMailSend({ idempotencyKey: 'k4' })).resolves.toMatchObject({ claimId: claim.claimId });
    });
});
