/**
 * The deal's agent is emailed "Application sent for contract" with the package
 * PDF when the contract goes out — from the funder's sender, sharing the CC
 * job's single PDF download, and never as a duplicate bare CC copy.
 *
 * `signnow.service` reaches puppeteer through the funder/PDF helpers it imports
 * and Jest cannot parse that package's ESM build, so it is stubbed. Mail, the
 * funder sender and the agent lookup are stubbed so nothing leaves the process.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
const sendMail = jest.fn(async (_options: Record<string, unknown>) => ({}));
jest.mock('../../config/nodemailer', () => ({
  __esModule: true,
  default: (options: Record<string, unknown>) => sendMail(options),
  isOutboundSmtpConfigured: () => true,
}));
jest.mock('../funderProfileService', () => ({
  ...jest.requireActual('../funderProfileService'),
  resolveEnvelopeMailSender: async () => ({
    email: 'contracts@tiberianfunding.com',
    name: 'Tiberian Funding',
  }),
}));
const readContractAgentEmail = jest.fn();
jest.mock('../../utils/contractAgentEmail', () => ({
  readContractAgentEmail: (...args: unknown[]) => readContractAgentEmail(...args),
}));

import prisma from '../../config/prismaClient';
import { signNowService } from './signnow.service';

const GROUP = 'group-agent-1';
const PDF = Buffer.from('%PDF-1.4 ' + 'x'.repeat(200));
const service = signNowService as any;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(prisma.document, 'findFirst').mockResolvedValue({ applicationId: 'app-1' } as never);
  service.downloadGroupPdf = jest.fn(async () => PDF);
  service.rememberCcRecipientsForGroup = jest.fn(async () => undefined);
  service.readSignedNoticeCcRecipients = jest.fn(async () => []);
});

it('emails the agent the package from the funder sender, separately from the CC copy', async () => {
  const result = await signNowService.notifyCcRecipientsOnSend(
    GROUP,
    ['funder@tiberianfunding.com', 'agent@broker.com'],
    ['merchant@acme.com'],
    'Tiberian Funding Acme LLC $25,000.00',
    ['agent@broker.com'],
  );

  expect(service.downloadGroupPdf).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ emailed: ['funder@tiberianfunding.com'], agentsEmailed: ['agent@broker.com'] });
  // The agent is not also stored / emailed as a CC.
  expect(service.rememberCcRecipientsForGroup).toHaveBeenCalledWith(GROUP, [
    'funder@tiberianfunding.com',
  ]);
  const agentMail = sendMail.mock.calls
    .map(([options]) => options)
    .find((options) => options.to === 'agent@broker.com')!;
  expect(agentMail.subject).toContain('Contract Sent');
  expect(agentMail.from).toEqual({ email: 'contracts@tiberianfunding.com', name: 'Tiberian Funding' });
  expect(String(agentMail.html)).toContain('Application Sent for Contract');
  expect((agentMail.attachments as Array<{ content: Buffer }>)[0].content).toBe(PDF);
});

it('emails every agent their own contract-sent notice, and none of them a CC copy', async () => {
  const result = await signNowService.notifyCcRecipientsOnSend(
    GROUP,
    ['admin@nitroadvance.com', 'Two@Broker.com'],
    ['merchant@acme.com'],
    'Tiberian Funding Acme LLC $25,000.00',
    ['one@broker.com', 'two@broker.com', 'merchant@acme.com'],
  );

  expect(result).toEqual({
    emailed: ['admin@nitroadvance.com'],
    agentsEmailed: ['one@broker.com', 'two@broker.com'],
  });
  const byRecipient = Object.fromEntries(
    sendMail.mock.calls.map(([options]) => [String(options.to), String(options.subject)]),
  );
  expect(Object.keys(byRecipient).sort()).toEqual(
    ['admin@nitroadvance.com', 'one@broker.com', 'two@broker.com'].sort(),
  );
  expect(byRecipient['one@broker.com']).toContain('Contract Sent');
  expect(byRecipient['two@broker.com']).toContain('Contract Sent');
  expect(byRecipient['admin@nitroadvance.com']).not.toContain('Contract Sent');
  expect(service.downloadGroupPdf).toHaveBeenCalledTimes(1);
});

it('queues the agent from the saved contract value even with no CC list', async () => {
  readContractAgentEmail.mockResolvedValue({ agentEmails: ['agent@broker.com'] });
  const notify = jest
    .spyOn(signNowService, 'notifyCcRecipientsOnSend')
    .mockResolvedValue({ emailed: [], agentsEmailed: ['agent@broker.com'] });

  const result = await signNowService.queueCcRecipientsOnSend(GROUP, [], ['merchant@acme.com'], 'Label');
  await new Promise((resolve) => setImmediate(resolve));

  expect(readContractAgentEmail).toHaveBeenCalledWith('app-1');
  expect(result).toEqual({ emailed: [], queued: [], agentsQueued: ['agent@broker.com'] });
  expect(notify).toHaveBeenCalledWith(GROUP, [], ['merchant@acme.com'], 'Label', ['agent@broker.com']);
  notify.mockRestore();
});

it('does not email an agent who is also a signer', async () => {
  readContractAgentEmail.mockResolvedValue({ agentEmails: ['merchant@acme.com'] });
  const result = await signNowService.queueCcRecipientsOnSend(GROUP, [], ['merchant@acme.com'], 'Label');
  expect(result.skippedReason).toBe('no_cc_addresses');
});

it("never emails the funder's CC the unsigned package — it gets only the signed copy", async () => {
  service.readSignedNoticeCcRecipients = jest.fn(async () => ['Funder@TiberianFunding.com']);
  const result = await signNowService.notifyCcRecipientsOnSend(
    GROUP,
    ['funder@tiberianfunding.com', 'admin@nitroadvance.com'],
    ['merchant@acme.com'],
    'Tiberian Funding Acme LLC $25,000.00',
    [],
  );

  expect(result).toEqual({ emailed: ['admin@nitroadvance.com'], agentsEmailed: [] });
  expect(sendMail.mock.calls.map(([options]) => options.to)).toEqual(['admin@nitroadvance.com']);
  // Still remembered on the envelope for the completion notice.
  expect(service.rememberCcRecipientsForGroup).toHaveBeenCalledWith(GROUP, [
    'funder@tiberianfunding.com',
    'admin@nitroadvance.com',
  ]);
});

it('queues nothing when the funder CC is the only CC and there is no agent', async () => {
  readContractAgentEmail.mockResolvedValue({ agentEmails: [] });
  service.readSignedNoticeCcRecipients = jest.fn(async () => ['funder@tiberianfunding.com']);
  const notify = jest.spyOn(signNowService, 'notifyCcRecipientsOnSend');

  const result = await signNowService.queueCcRecipientsOnSend(
    GROUP,
    ['funder@tiberianfunding.com'],
    ['merchant@acme.com'],
    'Label',
  );
  await new Promise((resolve) => setImmediate(resolve));

  expect(result).toEqual({ emailed: [], queued: [], skippedReason: 'funder_cc_gets_signed_copy_only' });
  expect(notify).not.toHaveBeenCalled();
  expect(sendMail).not.toHaveBeenCalled();
  notify.mockRestore();
});
