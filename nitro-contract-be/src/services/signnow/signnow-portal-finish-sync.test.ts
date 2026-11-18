/**
 * The CRM learns a portal-signed contract is finished the moment the last
 * signer is redirected back — it must not wait for a SignNow webhook (which
 * cannot reach a CRM that is not publicly reachable) or a manual refresh.
 *
 * `prismaClient`, the SignNow API client, mail and `signNowService` are stubbed
 * so the queue logic runs without a database, SMTP or SignNow.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
process.env.SIGNING_PORTAL_SECRET = process.env.SIGNING_PORTAL_SECRET || 'test-portal-secret';

const document = { findUnique: jest.fn() };
const contract = { findFirst: jest.fn(), update: jest.fn(async () => undefined) };
jest.mock('../../config/prismaClient', () => ({
  __esModule: true,
  default: { document, contract },
}));
jest.mock('../../config/nodemailer', () => ({
  __esModule: true,
  default: jest.fn(async () => undefined),
  sendSendGridMail: jest.fn(async () => undefined),
  isSendGridConfigured: () => false,
  isOutboundMailConfigured: () => true,
}));
jest.mock('../funderProfileService', () => ({
  resolveFunderMailSender: async () => null,
}));
jest.mock('../mailSenderIdentity', () => ({
  resolveMailSender: async () => ({ email: 'contracts@example.com', name: 'Example Funder' }),
}));
jest.mock('../../utils/crmFrontendUrl', () => ({
  resolveCrmFrontendBaseUrl: () => 'https://crm.example.com',
}));

const embeddedInvites = { get: jest.fn() };
jest.mock('./utils/signnow-client', () => ({
  createSignNowApiClient: jest.fn(async () => embeddedInvites),
}));

const getGroupStatus = jest.fn();
jest.mock('./signnow.service', () => ({
  assertPackageWasPrefilledByReview: jest.fn(),
  signNowService: { getGroupStatus: (...args: unknown[]) => getGroupStatus(...args) },
}));

import { sendSendGridMail } from '../../config/nodemailer';
import {
  PORTAL_SIGNING_QUEUE_KEY,
  advancePortalSigningQueue,
  syncPortalEnvelopeAfterSignerFinished,
} from './signnow-portal-send.service';

const GROUP = 'group-1';
const NO_DELAY = [0, 0, 0];

function queueWith(recipients: Array<Record<string, unknown>>) {
  return {
    id: 7,
    contractPrefillOverrides: {
      [PORTAL_SIGNING_QUEUE_KEY]: {
        envelopeId: GROUP,
        contractLabel: 'Deal',
        emailSubject: 'Deal',
        startedAt: '2026-09-25T00:00:00.000Z',
        recipients,
      },
    },
  };
}

function signerStatus(email: string, status: string) {
  embeddedInvites.get.mockResolvedValue({
    status: 200,
    data: { data: [{ signers: [{ email, status }] }] },
  });
}

const emailed = (email: string) => ({
  email,
  name: null,
  role: null,
  emailedAt: '2026-09-25T00:00:00.000Z',
  completedAt: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  document.findUnique.mockResolvedValue({ applicationId: 'app-1' });
});

describe('syncPortalEnvelopeAfterSignerFinished', () => {
  it('moves the deal to Contract Signed when the last signer finishes', async () => {
    contract.findFirst.mockResolvedValue(
      queueWith([
        { ...emailed('a@example.com'), completedAt: '2026-09-25T00:01:00.000Z' },
        emailed('b@example.com'),
      ]),
    );
    signerStatus('b@example.com', 'fulfilled');
    getGroupStatus.mockResolvedValue({ envelopeId: GROUP, status: 'completed' });

    const result = await syncPortalEnvelopeAfterSignerFinished(GROUP, NO_DELAY);

    expect(result.status).toBe('completed');
    expect(getGroupStatus).toHaveBeenCalledWith(GROUP, 'app-1');
  });

  it('retries while SignNow is still settling the group, then stops', async () => {
    contract.findFirst.mockResolvedValue(queueWith([emailed('a@example.com')]));
    signerStatus('a@example.com', 'fulfilled');
    getGroupStatus
      .mockResolvedValueOnce({ envelopeId: GROUP, status: 'sent' })
      .mockResolvedValueOnce({ envelopeId: GROUP, status: 'completed' });

    const result = await syncPortalEnvelopeAfterSignerFinished(GROUP, NO_DELAY);

    expect(result.status).toBe('completed');
    expect(getGroupStatus).toHaveBeenCalledTimes(2);
  });

  it('only invites the next signer while others still have to sign', async () => {
    contract.findFirst.mockResolvedValue(
      queueWith([emailed('a@example.com'), { ...emailed('b@example.com'), emailedAt: null }]),
    );
    signerStatus('a@example.com', 'fulfilled');

    const result = await syncPortalEnvelopeAfterSignerFinished(GROUP, NO_DELAY);

    expect(result).toEqual({
      queue: { advanced: true, emailed: 'b@example.com', done: false },
      status: null,
    });
    expect(sendSendGridMail).toHaveBeenCalledTimes(1);
    expect(getGroupStatus).not.toHaveBeenCalled();
  });

  it('gives up after the bounded retries when SignNow never confirms the signer', async () => {
    contract.findFirst.mockResolvedValue(queueWith([emailed('a@example.com')]));
    signerStatus('a@example.com', 'pending');

    const result = await syncPortalEnvelopeAfterSignerFinished(GROUP, NO_DELAY);

    expect(result.status).toBeNull();
    expect(embeddedInvites.get).toHaveBeenCalledTimes(NO_DELAY.length);
    expect(getGroupStatus).not.toHaveBeenCalled();
  });

  it('completes a parallel send once SignNow closed the invites of signers who all signed', async () => {
    // Both merchants were emailed together; neither finish was recorded, and
    // SignNow no longer lists their embedded invites.
    contract.findFirst.mockResolvedValue(queueWith([emailed('a@example.com'), emailed('b@example.com')]));
    embeddedInvites.get.mockResolvedValue({ status: 200, data: { data: [] } });
    getGroupStatus.mockResolvedValue({ envelopeId: GROUP, status: 'completed' });

    const result = await syncPortalEnvelopeAfterSignerFinished(GROUP, NO_DELAY, 'b@example.com');

    expect(result.status).toBe('completed');
    expect(getGroupStatus).toHaveBeenCalledTimes(1);
    expect(sendSendGridMail).not.toHaveBeenCalled();
  });

  it('records every finished signer of a parallel send without re-emailing anyone', async () => {
    contract.findFirst.mockResolvedValue(queueWith([emailed('a@example.com'), emailed('b@example.com')]));
    embeddedInvites.get.mockResolvedValue({
      status: 200,
      data: {
        data: [
          { signers: [{ email: 'a@example.com', status: 'fulfilled' }] },
          { signers: [{ email: 'b@example.com', status: 'fulfilled' }] },
        ],
      },
    });
    getGroupStatus.mockResolvedValue({ envelopeId: GROUP, status: 'completed' });

    const result = await syncPortalEnvelopeAfterSignerFinished(GROUP, NO_DELAY, 'b@example.com');

    expect(result.status).toBe('completed');
    expect(result.queue.done).toBe(true);
    expect(sendSendGridMail).not.toHaveBeenCalled();
    const saved = (contract.update.mock.calls[0] as any[])[0].data.contractPrefillOverrides[
      PORTAL_SIGNING_QUEUE_KEY
    ];
    expect(saved.recipients.every((row: any) => row.completedAt)).toBe(true);
  });

  it('stops after one read when another signer of a parallel send has not signed yet', async () => {
    contract.findFirst.mockResolvedValue(queueWith([emailed('a@example.com'), emailed('b@example.com')]));
    embeddedInvites.get.mockResolvedValue({
      status: 200,
      data: {
        data: [
          { signers: [{ email: 'a@example.com', status: 'fulfilled' }] },
          { signers: [{ email: 'b@example.com', status: 'pending' }] },
        ],
      },
    });

    const result = await syncPortalEnvelopeAfterSignerFinished(GROUP, NO_DELAY, 'a@example.com');

    expect(result.status).toBeNull();
    expect(embeddedInvites.get).toHaveBeenCalledTimes(1);
    expect(getGroupStatus).not.toHaveBeenCalled();
    expect(sendSendGridMail).not.toHaveBeenCalled();
  });

  it('reads the group status directly for an envelope without a signing queue', async () => {
    contract.findFirst.mockResolvedValue({ id: 7, contractPrefillOverrides: {} });
    getGroupStatus.mockResolvedValue({ envelopeId: GROUP, status: 'completed' });

    const result = await syncPortalEnvelopeAfterSignerFinished(GROUP, NO_DELAY);

    expect(result.status).toBe('completed');
    expect(embeddedInvites.get).not.toHaveBeenCalled();
  });
});

describe('advancePortalSigningQueue in verified-webhook mode', () => {
  it('emails a signer the send never reached without calling SignNow', async () => {
    contract.findFirst.mockResolvedValue(
      queueWith([emailed('a@example.com'), { ...emailed('b@example.com'), emailedAt: null }]),
    );

    const result = await advancePortalSigningQueue(GROUP, { readSignNow: false });

    expect(result).toEqual({ advanced: true, emailed: 'b@example.com', done: false });
    expect(embeddedInvites.get).not.toHaveBeenCalled();
    expect(sendSendGridMail).toHaveBeenCalledTimes(1);
  });

  it('makes no SignNow call when every signer was already emailed', async () => {
    contract.findFirst.mockResolvedValue(queueWith([emailed('a@example.com'), emailed('b@example.com')]));

    const result = await advancePortalSigningQueue(GROUP, { readSignNow: false });

    expect(result.done).toBe(false);
    expect(embeddedInvites.get).not.toHaveBeenCalled();
    expect(sendSendGridMail).not.toHaveBeenCalled();
  });
});
