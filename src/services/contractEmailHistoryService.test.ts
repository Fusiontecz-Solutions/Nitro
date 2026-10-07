/**
 * The Contract tab's email history: one row per recipient with the role they
 * got the email as, including signed-copy notices logged as a single row and
 * portal invites sent before invites were logged.
 */
const resolveSignedCopyParties = jest.fn();
jest.mock('./signnow/utils/signnow-signed-copy-parties', () => ({
  resolveSignedCopyParties: (...args: unknown[]) => resolveSignedCopyParties(...args),
}));

import prisma from '../config/prismaClient';
import { listContractEmailHistory } from './contractEmailHistoryService';

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
