/**
 * The SignNow contract status job moves signed contracts to Contract Signed and
 * chases missing CC notices without a click on the refresh button — while
 * spending the 5s cadence (and its SignNow calls) only on contracts that are
 * actually being signed.
 *
 * Prisma, Redis and the SignNow service are stubbed.
 */
const document = { findMany: jest.fn() };
jest.mock('../config/prismaClient', () => ({ __esModule: true, default: { document } }));
jest.mock('../config/redis', () => ({ getRedisClient: () => null }));

const getGroupStatus = jest.fn();
const reconcileCcSignedNotice = jest.fn();
jest.mock('../services/signnow/signnow.service', () => ({
  signNowService: {
    getGroupStatus: (...args: unknown[]) => getGroupStatus(...args),
    reconcileCcSignedNotice: (...args: unknown[]) => reconcileCcSignedNotice(...args),
  },
}));

import {
  markSignNowEnvelopeActive,
  resetSignNowContractStatusJobState,
  runSignNowContractStatusJob,
} from './signNowContractStatusJob';

const ACTIVE = 'a'.repeat(40);
const IDLE = 'b'.repeat(40);
const DOCUSIGN = '3f2b8c1e-1111-2222-3333-444455556666';
const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const MINUTE = 60 * 1000;

function openRow(envelopeId: string, sentMinutesAgo: number) {
  const sentAt = new Date(NOW - sentMinutesAgo * MINUTE);
  return { envelopeId, applicationId: `app-${envelopeId.slice(0, 2)}`, sentAt, updatedAt: sentAt };
}

/** First findMany = open contracts, second = completed contracts missing a CC notice. */
function mockDocuments(open: unknown[], completedWithoutCc: unknown[] = []) {
  document.findMany.mockImplementation(async (args: any) =>
    args?.where?.status === 'completed' ? completedWithoutCc : open,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SIGNNOW_WEBHOOK_SECRET;
  resetSignNowContractStatusJobState();
  getGroupStatus.mockResolvedValue({ status: 'sent' });
  reconcileCcSignedNotice.mockResolvedValue(null);
});

describe('runSignNowContractStatusJob', () => {
  it('reads a just-sent contract every 5s tick through getGroupStatus', async () => {
    mockDocuments([openRow(ACTIVE, 2)]);

    await runSignNowContractStatusJob(NOW);
    await runSignNowContractStatusJob(NOW + 5_000);

    expect(getGroupStatus).toHaveBeenCalledTimes(2);
    expect(getGroupStatus).toHaveBeenCalledWith(ACTIVE, `app-${ACTIVE.slice(0, 2)}`);
  });

  it('checks an idle contract on the slow sweep, and not right after a restart', async () => {
    mockDocuments([openRow(IDLE, 3 * 60)]);

    await runSignNowContractStatusJob(NOW);
    await runSignNowContractStatusJob(NOW + 5_000);
    expect(getGroupStatus).not.toHaveBeenCalled();

    await runSignNowContractStatusJob(NOW + 30 * MINUTE);
    expect(getGroupStatus).toHaveBeenCalledTimes(1);
  });

  it('switches an idle contract to the 5s cadence once a signer opens the portal', async () => {
    mockDocuments([openRow(IDLE, 3 * 60)]);
    await runSignNowContractStatusJob(NOW);
    expect(getGroupStatus).not.toHaveBeenCalled();

    markSignNowEnvelopeActive(IDLE, NOW + 1_000);
    await runSignNowContractStatusJob(NOW + 5_000);
    await runSignNowContractStatusJob(NOW + 10_000);

    expect(getGroupStatus).toHaveBeenCalledTimes(2);
  });

  it('makes no SignNow status reads when signed webhooks are configured', async () => {
    process.env.SIGNNOW_WEBHOOK_SECRET = 'test-secret';
    mockDocuments([openRow(ACTIVE, 2)], [{ envelopeId: IDLE, applicationId: 'app-1' }]);
    markSignNowEnvelopeActive(ACTIVE, NOW);

    await runSignNowContractStatusJob(NOW);
    await runSignNowContractStatusJob(NOW + 5_000);
    await runSignNowContractStatusJob(NOW + 24 * 60 * MINUTE);

    expect(getGroupStatus).not.toHaveBeenCalled();
    // The CC notice check is database work and keeps running.
    expect(reconcileCcSignedNotice).toHaveBeenCalled();
  });

  it('ignores envelopes from other e-sign providers', async () => {
    mockDocuments([openRow(DOCUSIGN, 1)]);

    await runSignNowContractStatusJob(NOW);

    expect(getGroupStatus).not.toHaveBeenCalled();
  });

  it('chases the CC notice of a completed contract at most once a minute', async () => {
    mockDocuments([], [{ envelopeId: ACTIVE, applicationId: 'app-1' }]);

    await runSignNowContractStatusJob(NOW);
    await runSignNowContractStatusJob(NOW + 5_000);
    expect(reconcileCcSignedNotice).toHaveBeenCalledTimes(1);
    expect(reconcileCcSignedNotice).toHaveBeenCalledWith(ACTIVE, 'app-1');

    await runSignNowContractStatusJob(NOW + MINUTE);
    expect(reconcileCcSignedNotice).toHaveBeenCalledTimes(2);
  });

  it('keeps going when one status read fails', async () => {
    mockDocuments([openRow(ACTIVE, 1), openRow('c'.repeat(40), 1)]);
    getGroupStatus.mockRejectedValueOnce(new Error('SignNow 503')).mockResolvedValueOnce({ status: 'completed' });

    const result = await runSignNowContractStatusJob(NOW);

    expect(result.statusChecks).toBe(2);
    expect(getGroupStatus).toHaveBeenCalledTimes(2);
  });
});
