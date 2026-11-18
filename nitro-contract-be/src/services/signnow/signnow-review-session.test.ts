/**
 * Persisted SignNow Owner review state.
 *
 * "Review finished" has to outlive the browser tab that saw it: after a
 * refresh, a closed tab or an expired session the CRM must still offer
 * "Send via SignNow" for a package whose review is done — and must stop
 * offering it once that package has left draft.
 *
 * `prismaClient` is stubbed with an in-memory review-session table.
 */
type SessionRow = {
  envelopeId: string;
  startedAt: Date;
  completedAt: Date | null;
  fulfilledRoles: string[];
};

const sessions = new Map<string, SessionRow>();
const documents = new Map<string, Record<string, unknown>>();

jest.mock('../../config/prismaClient', () => ({
  __esModule: true,
  default: {
    signNowReviewSession: {
      findUnique: jest.fn(async ({ where }: any) => sessions.get(where.envelopeId) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const current = sessions.get(where.envelopeId);
        const next = current ? { ...current, ...update } : { ...create };
        sessions.set(where.envelopeId, next);
        return next;
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const had = sessions.delete(where.envelopeId);
        return { count: had ? 1 : 0 };
      }),
    },
    document: {
      findUnique: jest.fn(async ({ where }: any) => documents.get(where.applicationId) ?? null),
    },
  },
}));

import {
  clearSignNowReviewSession,
  deriveSignNowReviewPhase,
  readSignNowApplicationReviewState,
  recordSignNowReviewCompleted,
  recordSignNowReviewStarted,
} from './utils/signnow-review-session';

const APP_ID = '11111111-2222-3333-4444-555555555555';
const GROUP = 'a'.repeat(40);

beforeEach(() => {
  sessions.clear();
  documents.clear();
  documents.set(APP_ID, { envelopeId: GROUP, status: 'draft', sentAt: null, portalSentAt: null });
});

describe('deriveSignNowReviewPhase', () => {
  const draft = { envelopeId: GROUP, status: 'draft', sentAt: null };

  it('is not_started without a linked package or review row', () => {
    expect(deriveSignNowReviewPhase(null, null)).toBe('not_started');
    expect(deriveSignNowReviewPhase(draft, null)).toBe('not_started');
  });

  it('ignores a review row that belongs to a different package', () => {
    expect(
      deriveSignNowReviewPhase(draft, { envelopeId: 'b'.repeat(40), completedAt: new Date() }),
    ).toBe('not_started');
  });

  it('separates an open review from a finished one', () => {
    expect(deriveSignNowReviewPhase(draft, { envelopeId: GROUP, completedAt: null })).toBe(
      'in_review',
    );
    expect(deriveSignNowReviewPhase(draft, { envelopeId: GROUP, completedAt: new Date() })).toBe(
      'review_complete',
    );
  });

  it('is closed once the package left draft, whatever the review row says', () => {
    const finished = { envelopeId: GROUP, completedAt: new Date() };
    expect(deriveSignNowReviewPhase({ ...draft, status: 'sent' }, finished)).toBe('closed');
    expect(deriveSignNowReviewPhase({ ...draft, status: 'revoked' }, finished)).toBe('closed');
    expect(deriveSignNowReviewPhase({ ...draft, sentAt: new Date() }, finished)).toBe('closed');
    expect(deriveSignNowReviewPhase({ ...draft, portalSentAt: new Date() }, finished)).toBe(
      'closed',
    );
  });
});

describe('review session lifecycle', () => {
  it('survives without any browser state: start, finish, read back', async () => {
    await recordSignNowReviewStarted(GROUP, new Date('2026-09-24T10:00:00Z'));
    expect((await readSignNowApplicationReviewState(APP_ID))?.phase).toBe('in_review');

    await recordSignNowReviewCompleted(GROUP, ['Preparer'], new Date('2026-09-24T10:05:00Z'));
    const state = await readSignNowApplicationReviewState(APP_ID);
    expect(state).toMatchObject({
      envelopeId: GROUP,
      phase: 'review_complete',
      reviewComplete: true,
      reviewCompletedAt: '2026-09-24T10:05:00.000Z',
    });
  });

  it('keeps the first confirmed finish when polls report it again', async () => {
    await recordSignNowReviewStarted(GROUP);
    await recordSignNowReviewCompleted(GROUP, [], new Date('2026-09-24T10:05:00Z'));
    await recordSignNowReviewCompleted(GROUP, [], new Date('2026-09-24T10:09:00Z'));
    expect(sessions.get(GROUP)?.completedAt?.toISOString()).toBe('2026-09-24T10:05:00.000Z');
  });

  it('a newly minted review link voids the earlier finish', async () => {
    await recordSignNowReviewStarted(GROUP);
    await recordSignNowReviewCompleted(GROUP);
    await recordSignNowReviewStarted(GROUP);
    expect((await readSignNowApplicationReviewState(APP_ID))?.phase).toBe('in_review');
  });

  it('reset (change details) drops the review entirely', async () => {
    await recordSignNowReviewStarted(GROUP);
    await recordSignNowReviewCompleted(GROUP);
    await clearSignNowReviewSession(GROUP);
    expect((await readSignNowApplicationReviewState(APP_ID))?.phase).toBe('not_started');
  });

  it('stops offering Send via SignNow once the package was sent', async () => {
    await recordSignNowReviewStarted(GROUP);
    await recordSignNowReviewCompleted(GROUP);
    documents.set(APP_ID, { envelopeId: GROUP, status: 'sent', sentAt: new Date() });
    const state = await readSignNowApplicationReviewState(APP_ID);
    expect(state).toMatchObject({ phase: 'closed', reviewComplete: false });
  });
});
