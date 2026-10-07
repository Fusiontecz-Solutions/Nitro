/**
 * "Resend" on a sent, unsigned contract re-emails the SAME package's signing
 * link — it never rebuilds the contract or clears its values — and a corrected
 * signer email moves the signing invite to the new address and retires the old
 * link.
 *
 * `prismaClient`, the SignNow API client, mail and `signNowService` are stubbed
 * so the queue logic runs without a database, SMTP or SignNow.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
process.env.SIGNING_PORTAL_SECRET = process.env.SIGNING_PORTAL_SECRET || 'test-portal-secret';

const document = { findUnique: jest.fn() };
const contract = { findFirst: jest.fn(), update: jest.fn(async (_args: unknown) => undefined) };
jest.mock('../../config/prismaClient', () => ({
  __esModule: true,
  default: { document, contract },
}));
jest.mock('../../config/nodemailer', () => ({
  __esModule: true,
  default: jest.fn(async () => undefined),
  sendSendGridMail: jest.fn(async () => undefined),
  isSendGridConfigured: () => true,
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

const publishGroupFieldsToMerchant = jest.fn();
jest.mock('./signnow.service', () => ({
  assertPackageWasPrefilledByReview: jest.fn(),
  signNowService: {
    publishGroupFieldsToMerchant: (...args: unknown[]) => publishGroupFieldsToMerchant(...args),
  },
}));

import { sendSendGridMail } from '../../config/nodemailer';
import {
  PORTAL_SIGNING_QUEUE_KEY,
  startContractPortalResend,
  verifyPortalAccess,
} from './signnow-portal-send.service';
import { createSigningPortalToken } from './utils/signnow-portal-token';

const GROUP = 'group-resend';
const LONG_AGO = '2026-09-25T00:00:00.000Z';

const sendMock = sendSendGridMail as unknown as jest.Mock;

function row(email: string, extra: Record<string, unknown> = {}) {
  return { email, name: 'Jane', role: 'Recipient 1', emailedAt: LONG_AGO, completedAt: null, ...extra };
}

function useQueue(recipients: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  contract.findFirst.mockResolvedValue({
    id: 7,
    contractPrefillOverrides: {
      keepMe: 'hand-edited value',
      [PORTAL_SIGNING_QUEUE_KEY]: {
        envelopeId: GROUP,
        contractLabel: 'Deal',
        emailSubject: 'Deal',
        startedAt: LONG_AGO,
        recipients,
        ...extra,
      },
    },
  });
}

function signNowReports(signers: Array<{ email: string; status: string }>) {
  embeddedInvites.get.mockResolvedValue({ status: 200, data: { data: [{ signers }] } });
}

function savedQueue(): any {
  const call = contract.update.mock.calls.at(-1)?.[0] as any;
  return call?.data?.contractPrefillOverrides;
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  jest.clearAllMocks();
  document.findUnique.mockResolvedValue({
    applicationId: 'app-1',
    status: 'sent',
    sentAt: new Date(LONG_AGO),
    portalSentAt: new Date(LONG_AGO),
  });
  signNowReports([{ email: 'jane@merchant.com', status: 'pending' }]);
  publishGroupFieldsToMerchant.mockResolvedValue({
    documentCount: 2,
    failed: [],
    errors: {},
    valueCount: 10,
  });
});

describe('resend without changes', () => {
  it('re-emails the unsigned signer and keeps every other contract value', async () => {
    useQueue([row('jane@merchant.com')]);
    const accepted = await startContractPortalResend({ envelopeId: GROUP });

    expect(accepted.queued).toBe(false);
    expect(accepted.result?.emailed).toEqual(['jane@merchant.com']);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toBe('jane@merchant.com');
    expect(publishGroupFieldsToMerchant).not.toHaveBeenCalled();
    const saved = savedQueue();
    expect(saved.keepMe).toBe('hand-edited value');
    expect(saved[PORTAL_SIGNING_QUEUE_KEY].recipients[0].remindedAt).toEqual(expect.any(String));
  });

  it('skips a signer SignNow reports as finished', async () => {
    useQueue([row('jane@merchant.com'), row('bob@merchant.com', { role: 'Recipient 2' })]);
    signNowReports([
      { email: 'jane@merchant.com', status: 'fulfilled' },
      { email: 'bob@merchant.com', status: 'pending' },
    ]);
    const accepted = await startContractPortalResend({ envelopeId: GROUP });
    expect(accepted.result?.emailed).toEqual(['bob@merchant.com']);
    expect(accepted.result?.alreadySigned).toEqual(['jane@merchant.com']);
  });

  it('refuses a second click within the cooldown', async () => {
    useQueue([row('jane@merchant.com', { remindedAt: new Date().toISOString() })]);
    await expect(startContractPortalResend({ envelopeId: GROUP })).rejects.toMatchObject({
      status: 429,
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('refuses a completed contract', async () => {
    document.findUnique.mockResolvedValue({ status: 'completed', sentAt: new Date(), portalSentAt: null });
    useQueue([row('jane@merchant.com')]);
    await expect(startContractPortalResend({ envelopeId: GROUP })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('resend to a corrected email', () => {
  it('moves the invite to the new address without rebuilding the package', async () => {
    useQueue([row('wrong@merchant.com')], {
      roles: [
        { roleName: 'Recipient 1', signerRole: 'Recipient 1', signerName: 'Jane', signerEmail: 'wrong@merchant.com', signerOrder: 1 },
      ],
    });
    signNowReports([{ email: 'wrong@merchant.com', status: 'pending' }]);

    const accepted = await startContractPortalResend({
      envelopeId: GROUP,
      recipientChanges: [{ email: 'wrong@merchant.com', newEmail: 'Right@Merchant.com' }],
    });
    expect(accepted.queued).toBe(true);
    await settle();

    expect(publishGroupFieldsToMerchant).toHaveBeenCalledTimes(1);
    const [groupId, options] = publishGroupFieldsToMerchant.mock.calls[0];
    expect(groupId).toBe(GROUP);
    expect(options.prefillFields).toBeUndefined();
    expect(options.roles[0].signerEmail).toBe('right@merchant.com');
    expect(sendMock.mock.calls.map((c) => c[0].to)).toEqual(['right@merchant.com']);

    const saved = savedQueue();
    expect(saved.keepMe).toBe('hand-edited value');
    expect(saved[PORTAL_SIGNING_QUEUE_KEY].recipients[0].email).toBe('right@merchant.com');
    expect(saved[PORTAL_SIGNING_QUEUE_KEY].roles[0].signerEmail).toBe('right@merchant.com');
  });

  it('rebuilds roles from the queue for contracts sent before roles were stored', async () => {
    useQueue([row('wrong@merchant.com')]);
    signNowReports([{ email: 'wrong@merchant.com', status: 'pending' }]);
    await startContractPortalResend({
      envelopeId: GROUP,
      recipientChanges: [{ email: 'wrong@merchant.com', newEmail: 'right@merchant.com' }],
    });
    await settle();
    const roles = publishGroupFieldsToMerchant.mock.calls[0][1].roles;
    expect(roles).toEqual([
      expect.objectContaining({ signerRole: 'Recipient 1', signerEmail: 'right@merchant.com' }),
    ]);
  });

  it('refuses to change a signer once anyone has signed', async () => {
    useQueue([row('jane@merchant.com'), row('bob@merchant.com', { role: 'Recipient 2' })]);
    signNowReports([
      { email: 'jane@merchant.com', status: 'fulfilled' },
      { email: 'bob@merchant.com', status: 'pending' },
    ]);
    await expect(
      startContractPortalResend({
        envelopeId: GROUP,
        recipientChanges: [{ email: 'bob@merchant.com', newEmail: 'robert@merchant.com' }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(publishGroupFieldsToMerchant).not.toHaveBeenCalled();
  });

  it('rejects an invalid new address', async () => {
    useQueue([row('jane@merchant.com')]);
    await expect(
      startContractPortalResend({
        envelopeId: GROUP,
        recipientChanges: [{ email: 'jane@merchant.com', newEmail: 'not-an-email' }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('verifyPortalAccess after a signer change', () => {
  it('stops the replaced address from opening the contract', async () => {
    useQueue([row('right@merchant.com')]);
    const token = createSigningPortalToken({ envelopeId: GROUP, email: 'wrong@merchant.com' });
    await expect(
      verifyPortalAccess({ envelopeId: GROUP, email: 'wrong@merchant.com', token }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('still admits the current signer', async () => {
    useQueue([row('right@merchant.com')]);
    const token = createSigningPortalToken({ envelopeId: GROUP, email: 'right@merchant.com' });
    await expect(
      verifyPortalAccess({ envelopeId: GROUP, email: 'right@merchant.com', token }),
    ).resolves.toEqual({ envelopeId: GROUP, email: 'right@merchant.com' });
  });
});
