/**
 * Who receives the signed contract once every signer has finished.
 *
 * The signed package has to land in the submissions inbox, not only in the
 * SignNow account mailbox the contract was sent from, and the people CC'd at
 * send time have to be told the deal is signed rather than being left with the
 * unsigned copy they received days earlier.
 *
 * `prismaClient`, `nodemailer` and the outbound-communication log are stubbed so
 * the module can be imported without a database or SMTP connection. The PDF
 * filename helper reaches puppeteer, whose ESM build Jest cannot parse, so that
 * package is stubbed too.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('../../config/prismaClient', () => ({
  __esModule: true,
  default: {
    application: { findUnique: jest.fn(async () => null) },
    contract: { findFirst: jest.fn(async () => null) },
    funderProfile: { findMany: jest.fn(async () => []) },
    outbound_communications: { findMany: jest.fn(async () => []) },
  },
}));
jest.mock('../../config/nodemailer', () => ({
  __esModule: true,
  default: jest.fn(async () => undefined),
  isOutboundSmtpConfigured: () => true,
}));
jest.mock('../outboundCommunicationService', () => ({
  createOutboundCommunication: jest.fn(async () => undefined),
}));

import sendMail from '../../config/nodemailer';
import prisma from '../../config/prismaClient';
import {
  findLoggedSignNowCompletionNotice,
  resolveSignNowCompletionNoticeRecipients,
  sendSignNowCompletionNotice,
} from './signnow-completion-notice.service';

const sendMailMock = sendMail as unknown as jest.Mock;

describe('resolveSignNowCompletionNoticeRecipients', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('sends the signed copy to the submissions inbox and the SignNow account owner', () => {
    delete process.env.SIGNNOW_COMPLETION_NOTICE_TO;
    delete process.env.SIGNNOW_SIGNED_COPY_TO;
    process.env.SIGNNOW_USERNAME = 'contracts@nitroadvance.com';
    expect(resolveSignNowCompletionNoticeRecipients()).toEqual([
      'subs@nitroadvance.com',
      'contracts@nitroadvance.com',
    ]);
  });

  it('does not duplicate the inbox when it is also the SignNow account', () => {
    delete process.env.SIGNNOW_COMPLETION_NOTICE_TO;
    process.env.SIGNNOW_SIGNED_COPY_TO = 'Subs@NitroAdvance.com';
    process.env.SIGNNOW_USERNAME = 'subs@nitroadvance.com';
    expect(resolveSignNowCompletionNoticeRecipients()).toEqual(['Subs@NitroAdvance.com']);
  });

  it('lets SIGNNOW_COMPLETION_NOTICE_TO override the list outright', () => {
    process.env.SIGNNOW_COMPLETION_NOTICE_TO = 'ops@example.com, legal@example.com';
    process.env.SIGNNOW_USERNAME = 'contracts@nitroadvance.com';
    expect(resolveSignNowCompletionNoticeRecipients()).toEqual([
      'ops@example.com',
      'legal@example.com',
    ]);
  });
});

describe('sendSignNowCompletionNotice', () => {
  const env = { ...process.env };
  beforeEach(() => {
    sendMailMock.mockClear();
    delete process.env.SIGNNOW_COMPLETION_NOTICE_TO;
    delete process.env.SIGNNOW_SIGNED_COPY_TO;
    process.env.SIGNNOW_USERNAME = 'contracts@nitroadvance.com';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('emails the CC list from the send alongside the inbox, signed PDF attached', async () => {
    const result = await sendSignNowCompletionNotice({
      groupId: 'group-1',
      contractLabel: 'Tiberian Funding Acme LLC $25,000.00',
      pdf: Buffer.from('signed'),
      ccEmails: ['broker@example.com'],
    });

    expect(result.emailed).toEqual(['subs@nitroadvance.com', 'contracts@nitroadvance.com']);
    expect(result.emailedCc).toEqual(['broker@example.com']);

    const ccCall = sendMailMock.mock.calls.find(
      ([args]) => args.to === 'broker@example.com',
    );
    expect(ccCall).toBeDefined();
    // No application to read the book / merchant from: the label stands in.
    expect(ccCall[0].subject).toBe('Tiberian Funding Acme LLC $25,000.00: Signed Contract');
    expect(
      ccCall[0].attachments.some(
        (a: { contentType?: string }) => a.contentType === 'application/pdf',
      ),
    ).toBe(true);
  });

  it('titles the email "{Book}: {Merchant}: Signed Contract" and brands it with the funder logo', async () => {
    (prisma as any).application.findUnique.mockResolvedValueOnce({
      applicationId: '10428',
      dealDisplayName: null,
      client: { businessName: 'VVS CARTELL LLC' },
    });
    (prisma as any).contract.findFirst.mockImplementation(async () => ({
      funderName: 'Obsidian Capital Group',
      state: 'NY',
      legalName: null,
      doingBusinessAs: null,
      clientName: null,
      approvedAmount: 30000,
    }));
    (prisma as any).funderProfile.findMany.mockResolvedValueOnce([
      {
        id: 'f-1',
        name: 'Obsidian Capital Group',
        displayName: 'Obsidian Capital Group',
        isActive: true,
        letterLogoUrl: 'https://cdn.example.com/obsidian.png',
      },
    ]);

    try {
      await sendSignNowCompletionNotice({
        groupId: 'group-1',
        applicationId: 'app-1',
        contractLabel: 'Obsidian Capital Group VVS CARTELL LLC $30,000.00',
        pdf: Buffer.from('signed'),
      });
    } finally {
      (prisma as any).contract.findFirst.mockImplementation(async () => null);
    }

    const [args] = sendMailMock.mock.calls[0];
    expect(args.subject).toBe('Obsidian Capital Group: VVS CARTELL LLC: Signed Contract');
    expect(args.html).toContain('https://cdn.example.com/obsidian.png');
    expect(args.html).toContain('$30,000.00');
    expect(args.html).toContain('#10428');
  });

  it('does not copy a CC address that is already a notice recipient', async () => {
    const result = await sendSignNowCompletionNotice({
      groupId: 'group-1',
      contractLabel: 'Acme LLC',
      ccEmails: ['Contracts@nitroadvance.com', 'broker@example.com'],
    });

    expect(result.emailedCc).toEqual(['broker@example.com']);
    expect(
      sendMailMock.mock.calls.filter(
        ([args]) => String(args.to).toLowerCase() === 'contracts@nitroadvance.com',
      ),
    ).toHaveLength(1);
  });

  it('counts a CC address that is also an inbox recipient as reached', async () => {
    const result = await sendSignNowCompletionNotice({
      groupId: 'group-1',
      contractLabel: 'Acme LLC',
      ccEmails: ['Subs@nitroadvance.com', 'broker@example.com'],
    });

    expect(result.emailedCc).toEqual(['broker@example.com']);
    expect(result.ccReached).toEqual(['Subs@nitroadvance.com', 'broker@example.com']);
  });

  it('emails only the CC list on a CC-only catch-up, so the inbox gets no duplicate', async () => {
    const result = await sendSignNowCompletionNotice({
      groupId: 'group-1',
      contractLabel: 'Acme LLC',
      ccEmails: ['subs@nitroadvance.com', 'broker@example.com'],
      ccOnly: true,
    });

    expect(result.emailed).toEqual([]);
    expect(result.emailedCc).toEqual(['subs@nitroadvance.com', 'broker@example.com']);
    expect(sendMailMock.mock.calls.map(([args]) => args.to)).toEqual([
      'subs@nitroadvance.com',
      'broker@example.com',
    ]);
  });

  it('sends the signed copy to the signer, agent and sender too', async () => {
    const result = await sendSignNowCompletionNotice({
      groupId: 'group-1',
      contractLabel: 'Acme LLC',
      pdf: Buffer.from('signed'),
      ccEmails: ['broker@example.com'],
      partyEmails: ['jane@merchant.com', 'agent@nitroadvance.com', 'Broker@example.com'],
    });

    // A party who is already on the CC list is not emailed twice.
    expect(result.emailedParties).toEqual(['jane@merchant.com', 'agent@nitroadvance.com']);
    const signerCall = sendMailMock.mock.calls.find(([args]) => args.to === 'jane@merchant.com');
    expect(
      signerCall[0].attachments.some(
        (a: { contentType?: string }) => a.contentType === 'application/pdf',
      ),
    ).toBe(true);
  });

  it('does not email the parties again on a CC-only catch-up', async () => {
    const result = await sendSignNowCompletionNotice({
      groupId: 'group-1',
      contractLabel: 'Acme LLC',
      ccEmails: ['broker@example.com'],
      partyEmails: ['jane@merchant.com'],
      ccOnly: true,
    });
    expect(result.emailedParties).toEqual([]);
    expect(sendMailMock.mock.calls.map(([args]) => args.to)).toEqual(['broker@example.com']);
  });
});

describe('findLoggedSignNowCompletionNotice', () => {
  const findManyMock = (prisma as any).outbound_communications.findMany as jest.Mock;

  it('recognises a notice logged before delivery was recorded on the Document', async () => {
    const sentAt = new Date('2026-09-24T18:52:57.168Z');
    findManyMock.mockResolvedValueOnce([
      {
        createdAt: sentAt,
        metadata: {
          source: 'signnow_completion_notice',
          groupId: 'group-1',
          recipients: ['subs@nitroadvance.com', 'contracts@nitroadvance.com'],
          ccEmails: ['admin@nitroadvance.com', 'Mark@nitroadvance.com'],
        },
      },
    ]);

    const logged = await findLoggedSignNowCompletionNotice('group-1', [
      'subs@nitroadvance.com',
      'admin@nitroadvance.com',
      'mark@nitroadvance.com',
    ]);

    expect(logged?.sentAt).toEqual(sentAt);
    expect(logged?.ccReached).toEqual([
      'subs@nitroadvance.com',
      'admin@nitroadvance.com',
      'mark@nitroadvance.com',
    ]);
  });

  it('returns null when no notice was ever logged', async () => {
    findManyMock.mockResolvedValueOnce([]);
    expect(await findLoggedSignNowCompletionNotice('group-1', ['a@example.com'])).toBeNull();
  });
});
