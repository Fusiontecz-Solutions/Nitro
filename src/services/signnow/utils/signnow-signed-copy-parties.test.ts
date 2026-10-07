/**
 * The signer, agent and sender of a contract each get the signed copy.
 * `prismaClient` is stubbed so the lookup runs without a database.
 */
const document = { findUnique: jest.fn() };
const contract = { findFirst: jest.fn(), findUnique: jest.fn() };
const application = { findUnique: jest.fn() };
const user = { findUnique: jest.fn() };
jest.mock('../../../config/prismaClient', () => ({
  __esModule: true,
  default: { document, contract, application, user },
}));

import { resolveSignedCopyParties, signedCopyPartyEmails } from './signnow-signed-copy-parties';

const GROUP = 'group-1';

beforeEach(() => {
  jest.clearAllMocks();
  document.findUnique.mockResolvedValue({ applicationId: 'app-1', userId: 12 });
  user.findUnique.mockResolvedValue({ email: 'owner@nitroadvance.com' });
  contract.findUnique.mockResolvedValue({ agentEmail: null });
  application.findUnique.mockResolvedValue({
    referringAgent: { email: 'agent@nitroadvance.com' },
    createdBy: { email: 'creator@nitroadvance.com', role: 'AGENT' },
  });
  contract.findFirst.mockResolvedValue({
    contractPrefillOverrides: {
      portalSigningQueue: {
        envelopeId: GROUP,
        senderEmail: 'sender@nitroadvance.com',
        recipients: [{ email: 'jane@merchant.com' }, { email: 'bob@merchant.com' }],
      },
    },
  });
});

it('reads signers and sender from the portal queue and the referring agent', async () => {
  const parties = await resolveSignedCopyParties(GROUP);
  expect(parties).toEqual({
    signerEmails: ['jane@merchant.com', 'bob@merchant.com'],
    senderEmail: 'sender@nitroadvance.com',
    agentEmails: ['agent@nitroadvance.com'],
  });
  expect(signedCopyPartyEmails(parties)).toEqual([
    'jane@merchant.com',
    'bob@merchant.com',
    'agent@nitroadvance.com',
    'sender@nitroadvance.com',
  ]);
});

it('falls back to the Document owner and an AGENT creator', async () => {
  contract.findFirst.mockResolvedValue({ contractPrefillOverrides: {} });
  application.findUnique.mockResolvedValue({
    referringAgent: null,
    createdBy: { email: 'creator@nitroadvance.com', role: 'AGENT' },
  });
  const parties = await resolveSignedCopyParties(GROUP);
  expect(parties).toEqual({
    signerEmails: [],
    senderEmail: 'owner@nitroadvance.com',
    agentEmails: ['creator@nitroadvance.com'],
  });
});

it('ignores a queue left from a different envelope', async () => {
  contract.findFirst.mockResolvedValue({
    contractPrefillOverrides: {
      portalSigningQueue: {
        envelopeId: 'older-group',
        senderEmail: 'old@nitroadvance.com',
        recipients: [{ email: 'old@merchant.com' }],
      },
    },
  });
  const parties = await resolveSignedCopyParties(GROUP);
  expect(parties.signerEmails).toEqual([]);
  expect(parties.senderEmail).toBe('owner@nitroadvance.com');
});

it('does not treat a non-agent creator as the agent', async () => {
  application.findUnique.mockResolvedValue({
    referringAgent: null,
    createdBy: { email: 'admin@nitroadvance.com', role: 'SUPER_ADMIN' },
  });
  expect((await resolveSignedCopyParties(GROUP)).agentEmails).toEqual([]);
});

it('prefers the agent email saved in the send panel over the referring agent', async () => {
  contract.findUnique.mockResolvedValue({ agentEmail: 'saved.agent@broker.com' });
  const parties = await resolveSignedCopyParties(GROUP);
  expect(parties.agentEmails).toEqual(['saved.agent@broker.com']);
});

it('sends the signed copy to every agent saved in the send panel', async () => {
  contract.findUnique.mockResolvedValue({ agentEmail: 'one@broker.com,two@broker.com' });
  const parties = await resolveSignedCopyParties(GROUP);
  expect(parties.agentEmails).toEqual(['one@broker.com', 'two@broker.com']);
  expect(signedCopyPartyEmails(parties)).toEqual([
    'jane@merchant.com',
    'bob@merchant.com',
    'one@broker.com',
    'two@broker.com',
    'sender@nitroadvance.com',
  ]);
});
