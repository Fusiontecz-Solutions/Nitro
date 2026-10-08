/**
 * The Contract tab's email history: one row per recipient with the role they
 * got the email as, including signed-copy notices logged as a single row and
 * portal invites sent before invites were logged.
 */
const resolveSignedCopyParties = jest.fn();
jest.mock('./signnow/utils/signnow-signed-copy-parties', () => ({
  resolveSignedCopyParties: (...args: unknown[]) => resolveSignedCopyParties(...args),
}));

const createOutboundCommunication = jest.fn(async (_input: Record<string, unknown>) => ({}));
jest.mock('./outboundCommunicationService', () => ({
  createOutboundCommunication: (input: Record<string, unknown>) => createOutboundCommunication(input),
  storeSgMessageIdOnOutbound: jest.fn(async () => undefined),
}));

import prisma from '../config/prismaClient';
import { listContractEmailHistory, sendTrackedContractEmail } from './contractEmailHistoryService';

const APP = 'app-1';
const GROUP = 'group-1';

function mockRows(rows: unknown[], overrides: unknown = null) {
  jest.spyOn(prisma.outbound_communications, 'findMany').mockResolvedValue(rows as never);
  jest
    .spyOn(prisma.contract, 'findFirst')
    .mockResolvedValue({ contractPrefillOverrides: overrides } as never);
}

beforeEach(() => {
  jest.restoreAllMocks();
  resolveSignedCopyParties.mockReset();
  createOutboundCommunication.mockClear();
});

it('splits a signed-copy notice into one row per recipient with its role', async () => {
  mockRows([
    {
      id: 'n1',
      createdAt: new Date('2026-10-07T09:35:00Z'),
      recipient: 'subs@nitroadvance.com, cc@funder.com, owner@acme.com, agent@broker.com',
      subject: 'Obsidian: Acme LLC: Signed Contract',
      status: 'sent',
      metadata: {
        source: 'signnow_completion_notice',
        groupId: GROUP,
        recipients: ['subs@nitroadvance.com'],
        ccEmails: ['cc@funder.com'],
        partyEmails: ['owner@acme.com', 'agent@broker.com'],
        partyRoles: { 'owner@acme.com': 'SIGNER', 'agent@broker.com': 'AGENT' },
      },
    },
  ]);

  const rows = await listContractEmailHistory(APP);

  expect(rows.map((r) => [r.email, r.role, r.kind])).toEqual([
    ['subs@nitroadvance.com', 'CONTRACTS_INBOX', 'signed_copy'],
    ['cc@funder.com', 'FUNDER_CC', 'signed_copy'],
    ['owner@acme.com', 'SIGNER', 'signed_copy'],
    ['agent@broker.com', 'AGENT', 'signed_copy'],
  ]);
  expect(rows.every((r) => r.subject === 'Obsidian: Acme LLC: Signed Contract')).toBe(true);
  expect(resolveSignedCopyParties).not.toHaveBeenCalled();
});

it("reads party roles from the deal for a notice logged before roles were stored", async () => {
  resolveSignedCopyParties.mockResolvedValue({
    signerEmails: ['owner@acme.com'],
    agentEmails: ['agent@broker.com'],
    senderEmail: 'rep@nitroadvance.com',
  });
  mockRows([
    {
      id: 'n1',
      createdAt: new Date('2026-10-07T09:35:00Z'),
      recipient: '',
      subject: 'Signed',
      status: 'sent',
      metadata: {
        source: 'signnow_completion_notice',
        groupId: GROUP,
        partyEmails: ['Agent@Broker.com', 'rep@nitroadvance.com'],
      },
    },
  ]);

  const rows = await listContractEmailHistory(APP);

  expect(rows.map((r) => [r.email, r.role])).toEqual([
    ['Agent@Broker.com', 'AGENT'],
    ['rep@nitroadvance.com', 'SENDER'],
  ]);
});

it('adds portal invites from the signing queue that were never logged, newest first', async () => {
  mockRows(
    [
      {
        id: 'cc1',
        createdAt: new Date('2026-10-06T18:22:00Z'),
        recipient: 'admin@nitroadvance.com',
        subject: 'Obsidian Acme LLC $50,000.00',
        status: 'sent',
        metadata: { source: 'contract_email', kind: 'cc_copy', role: 'CC', groupId: GROUP },
      },
    ],
    {
      portalSigningQueue: {
        envelopeId: GROUP,
        emailSubject: 'Obsidian Acme LLC $50,000.00',
        recipients: [
          {
            email: 'owner@acme.com',
            name: 'Jane Owner',
            role: 'Recipient 1',
            emailedAt: '2026-10-06T18:21:00Z',
            remindedAt: '2026-10-07T08:00:00Z',
          },
        ],
      },
    },
  );

  const rows = await listContractEmailHistory(APP);

  expect(rows.map((r) => [r.email, r.role, r.kind, r.roleDetail])).toEqual([
    ['owner@acme.com', 'SIGNER', 'signing_reminder', 'Recipient 1'],
    ['admin@nitroadvance.com', 'CC', 'cc_copy', null],
    ['owner@acme.com', 'SIGNER', 'signing_invite', 'Recipient 1'],
  ]);
  expect(rows[0].name).toBe('Jane Owner');
});

it('does not repeat a portal invite that is already logged', async () => {
  mockRows(
    [
      {
        id: 'inv1',
        createdAt: new Date('2026-10-06T18:21:01Z'),
        recipient: 'owner@acme.com',
        subject: 'S',
        status: 'sent',
        metadata: {
          source: 'contract_email',
          kind: 'signing_invite',
          role: 'SIGNER',
          groupId: GROUP,
        },
      },
    ],
    {
      portalSigningQueue: {
        envelopeId: GROUP,
        recipients: [{ email: 'Owner@acme.com', emailedAt: '2026-10-06T18:21:00Z' }],
      },
    },
  );

  const rows = await listContractEmailHistory(APP);

  expect(rows.map((r) => r.id)).toEqual(['inv1']);
});

it('lists a tracked email with its delivery status and lets it be viewed and resent', async () => {
  mockRows([
    {
      id: 'agent1',
      createdAt: new Date('2026-10-07T09:39:00Z'),
      recipient: 'agent@broker.com',
      subject: 'Contract Sent',
      status: 'opened',
      body: '<p>Contract sent</p>',
      metadata: {
        source: 'contract_email',
        kind: 'agent_sent_notice',
        role: 'AGENT',
        groupId: GROUP,
        provider: 'smtp',
        resend: { attachments: ['contract_pdf'] },
        tracking: { deliveredAt: '2026-10-07T09:39:05Z', openedAt: '2026-10-07T09:45:00Z', openCount: 2 },
      },
    },
    {
      id: 'sn1',
      createdAt: new Date('2026-10-07T09:38:00Z'),
      recipient: 'owner@acme.com',
      subject: 'Invite',
      status: 'sent',
      metadata: { source: 'contract_email', kind: 'signing_invite', role: 'SIGNER', groupId: GROUP, provider: 'signnow' },
    },
    {
      id: 'agg1',
      createdAt: new Date('2026-10-07T09:57:00Z'),
      recipient: 'subs@nitroadvance.com',
      subject: 'Signed Contract',
      status: 'sent',
      metadata: {
        source: 'signnow_completion_notice',
        groupId: GROUP,
        recipients: ['subs@nitroadvance.com'],
        perRecipientLogged: true,
      },
    },
  ]);

  const rows = await listContractEmailHistory(APP);

  expect(rows.map((r) => r.id)).toEqual(['agent1', 'sn1']);
  expect(rows[0]).toMatchObject({
    status: 'opened',
    tracked: true,
    canView: true,
    canResend: true,
    openCount: 2,
    deliveredAt: '2026-10-07T09:39:05Z',
  });
  // SignNow emailed its own invite: nothing stored, nothing to resend from here.
  expect(rows[1]).toMatchObject({ tracked: false, canView: false, canResend: false });
});

it('sends a contract email with its log row id as the SendGrid tracking id', async () => {
  const update = jest.spyOn(prisma.outbound_communications, 'updateMany').mockResolvedValue({ count: 1 } as never);
  const send = jest.fn(async (_options: Record<string, unknown>) => ({}));

  await sendTrackedContractEmail({
    groupId: GROUP,
    applicationId: APP,
    kind: 'cc_copy',
    recipient: { email: 'cc@funder.com', role: 'CC' },
    provider: 'smtp',
    mail: { subject: 'Copy', html: '<p>Copy</p>' },
    resend: { attachments: ['contract_pdf'], pdfFilename: 'Contract.pdf' },
    send,
  });

  const logged = createOutboundCommunication.mock.calls[0][0] as Record<string, any>;
  expect(logged).toMatchObject({ applicationId: APP, recipient: 'cc@funder.com', body: '<p>Copy</p>', status: 'sending' });
  expect(logged.metadata).toMatchObject({ source: 'contract_email', kind: 'cc_copy', role: 'CC' });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'cc@funder.com', trackingId: logged.id }));
  expect(update).toHaveBeenCalledWith({ where: { id: logged.id, status: 'sending' }, data: { status: 'sent' } });
});

it('marks a contract email failed when it cannot be sent', async () => {
  jest.spyOn(prisma.outbound_communications, 'findUnique').mockResolvedValue({ metadata: { source: 'contract_email' } } as never);
  const update = jest.spyOn(prisma.outbound_communications, 'update').mockResolvedValue({} as never);

  await expect(
    sendTrackedContractEmail({
      groupId: GROUP,
      applicationId: APP,
      kind: 'agent_sent_notice',
      recipient: { email: 'agent@broker.com', role: 'AGENT' },
      provider: 'smtp',
      mail: { subject: 'S', html: '<p>S</p>' },
      resend: { attachments: [] },
      send: async () => {
        throw new Error('SMTP down');
      },
    }),
  ).rejects.toThrow('SMTP down');

  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: { status: 'failed', metadata: { source: 'contract_email', error: 'SMTP down' } },
    }),
  );
});
