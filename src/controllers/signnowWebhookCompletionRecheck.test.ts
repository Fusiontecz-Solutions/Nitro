/**
 * SignNow fires `document_group.complete` a few seconds before its own API
 * reports the group finished. The webhook must not drop that event: it re-reads
 * the group on a short backoff until it resolves to completed, without polling
 * groups SignNow never reported complete.
 *
 * Prisma and the SignNow services are stubbed; timers are faked.
 */
const document = { findFirst: jest.fn() };
jest.mock('../config/prismaClient', () => ({ __esModule: true, default: { document } }));

const getGroupStatus = jest.fn();
const applyVerifiedGroupStatus = jest.fn();
jest.mock('../services/signnow/signnow.service', () => ({
  signNowService: {
    getGroupStatus: (...args: unknown[]) => getGroupStatus(...args),
    applyVerifiedGroupStatus: (...args: unknown[]) => applyVerifiedGroupStatus(...args),
  },
}));
const advancePortalSigningQueue = jest.fn(async (..._args: unknown[]) => ({ advanced: false }));
jest.mock('../services/signnow/signnow-portal-send.service', () => ({
  advancePortalSigningQueue: (...args: unknown[]) => advancePortalSigningQueue(...args),
}));

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { handleSignNowWebhook } from './signnowWebhookController';
import {
  cancelAllSignNowCompletionRechecks,
  isSignNowGroupCompleteEvent,
} from '../services/signnow/signnow-completion-recheck';

const GROUP_ID = 'c'.repeat(40);
const APP_ID = '11111111-2222-3333-4444-555555555555';

function webhookRequest(event: string): Request {
  const body = { meta: { event }, content: { document_group_id: GROUP_ID } };
  return {
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
    header: () => '',
  } as unknown as Request;
}

/** A callback signed the way SignNow signs it: base64(HMAC-SHA256(raw body)). */
function signedWebhookRequest(event: string, secret: string, signWith = secret): Request {
  const body = { meta: { event }, content: { document_group_id: GROUP_ID } };
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', signWith).update(rawBody).digest('base64');
  return {
    body,
    rawBody,
    header: (name: string) => (name.toLowerCase() === 'x-signnow-signature' ? signature : ''),
  } as unknown as Request;
}

function mockResponse(): Response {
  const res = {} as Response;
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

/** Let the re-check's async body settle after its timer fires. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  delete process.env.SIGNNOW_WEBHOOK_SECRET;
  delete process.env.SIGNNOW_WEBHOOK_RECHECK_DELAYS_SECONDS;
  document.findFirst.mockResolvedValue({ envelopeId: GROUP_ID, applicationId: APP_ID });
});

afterEach(() => {
  cancelAllSignNowCompletionRechecks();
  jest.useRealTimers();
});

describe('isSignNowGroupCompleteEvent', () => {
  it('matches group completion but not a single signer finishing', () => {
    expect(isSignNowGroupCompleteEvent('user.document_group.complete')).toBe(true);
    expect(isSignNowGroupCompleteEvent('document_group.complete')).toBe(true);
    expect(isSignNowGroupCompleteEvent('user.document_group.invite.signer.complete')).toBe(false);
    expect(isSignNowGroupCompleteEvent('user.document_group.invite.declined')).toBe(false);
  });
});

describe('SignNow completion webhook re-check', () => {
  it('re-reads the group 10s later when the completion event beat the SignNow API', async () => {
    getGroupStatus.mockResolvedValueOnce({ status: 'sent' }).mockResolvedValueOnce({ status: 'completed' });

    const res = mockResponse();
    await handleSignNowWebhook(webhookRequest('user.document_group.complete'), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(getGroupStatus).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(9_999);
    expect(getGroupStatus).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await flush();
    expect(getGroupStatus).toHaveBeenCalledTimes(2);
    expect(getGroupStatus).toHaveBeenLastCalledWith(GROUP_ID, APP_ID);

    // Completed: no further SignNow reads.
    await jest.advanceTimersByTimeAsync(120_000);
    expect(getGroupStatus).toHaveBeenCalledTimes(2);
  });

  it('backs off 10s → 20s → 30s and then stops', async () => {
    getGroupStatus.mockResolvedValue({ status: 'sent' });

    await handleSignNowWebhook(webhookRequest('user.document_group.complete'), mockResponse());
    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    await jest.advanceTimersByTimeAsync(20_000);
    await flush();
    await jest.advanceTimersByTimeAsync(30_000);
    await flush();
    await jest.advanceTimersByTimeAsync(600_000);

    expect(getGroupStatus).toHaveBeenCalledTimes(4);
  });

  it('does not stack re-checks for duplicate completion callbacks', async () => {
    getGroupStatus.mockResolvedValue({ status: 'sent' });

    await handleSignNowWebhook(webhookRequest('user.document_group.complete'), mockResponse());
    await handleSignNowWebhook(webhookRequest('user.document_group.complete'), mockResponse());
    expect(getGroupStatus).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(getGroupStatus).toHaveBeenCalledTimes(3);
  });

  it('schedules nothing for a signer-complete event or an already completed group', async () => {
    getGroupStatus.mockResolvedValueOnce({ status: 'sent' }).mockResolvedValueOnce({ status: 'completed' });

    await handleSignNowWebhook(webhookRequest('user.document_group.invite.signer.complete'), mockResponse());
    await handleSignNowWebhook(webhookRequest('user.document_group.complete'), mockResponse());
    await jest.advanceTimersByTimeAsync(600_000);

    expect(getGroupStatus).toHaveBeenCalledTimes(2);
  });
});

describe('verified SignNow webhooks (secret configured)', () => {
  const SECRET = 'test-webhook-secret';
  beforeEach(() => {
    process.env.SIGNNOW_WEBHOOK_SECRET = SECRET;
    applyVerifiedGroupStatus.mockResolvedValue({ envelopeId: GROUP_ID, status: 'completed', source: 'webhook' });
  });

  it('persists a signed completion event without reading SignNow', async () => {
    const res = mockResponse();
    await handleSignNowWebhook(signedWebhookRequest('user.document_group.complete', SECRET), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(applyVerifiedGroupStatus).toHaveBeenCalledWith(GROUP_ID, 'completed', APP_ID);
    expect(advancePortalSigningQueue).not.toHaveBeenCalled();
    expect(getGroupStatus).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(120_000);
    expect(getGroupStatus).not.toHaveBeenCalled();
  });

  it('spends no status read on a single signer finishing', async () => {
    const res = mockResponse();
    await handleSignNowWebhook(
      signedWebhookRequest('user.document_group.invite.signer.complete', SECRET),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(getGroupStatus).not.toHaveBeenCalled();
    expect(applyVerifiedGroupStatus).not.toHaveBeenCalled();
    expect(advancePortalSigningQueue).toHaveBeenCalledWith(GROUP_ID, { readSignNow: false });
  });

  it('persists a signed decline as voided without reading SignNow', async () => {
    const res = mockResponse();
    await handleSignNowWebhook(signedWebhookRequest('user.document_group.invite.declined', SECRET), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(applyVerifiedGroupStatus).toHaveBeenCalledWith(GROUP_ID, 'voided', APP_ID);
    expect(getGroupStatus).not.toHaveBeenCalled();
  });

  it('rejects a completion event signed with the wrong secret', async () => {
    const res = mockResponse();
    await handleSignNowWebhook(
      signedWebhookRequest('user.document_group.complete', SECRET, 'forged'),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(applyVerifiedGroupStatus).not.toHaveBeenCalled();
  });
});
