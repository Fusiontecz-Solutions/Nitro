/**
 * Provider routing in the central mailer:
 *   funder on gmail → funder mailbox; funder on sendgrid (default) → SendGrid;
 *   no funder → server Gmail mailbox. Fallback only after a definite "not sent";
 *   never after a timeout / 5xx. Deal emails are idempotent.
 */
import { MailDeliveryError, DuplicateMailSendError } from '../services/mail/mailErrors';

jest.mock('./prismaClient', () => ({
    __esModule: true,
    default: { outbound_communications: { findUnique: jest.fn(async () => null), update: jest.fn() } },
}));

const resolveMailFunder = jest.fn();
jest.mock('../services/mail/mailRouting', () => ({
    ...jest.requireActual('../services/mail/mailRouting'),
    resolveMailFunder: (...args: unknown[]) => resolveMailFunder(...args),
}));

const sendViaSendGrid = jest.fn();
let sendGridConfigured = true;
jest.mock('./sendgridMailer', () => ({
    ...jest.requireActual('./sendgridMailer'),
    isSendGridConfigured: () => sendGridConfigured,
    sendViaSendGrid: (...args: unknown[]) => sendViaSendGrid(...args),
}));

const sendViaGmailApi = jest.fn();
const getSystemGmailMailbox = jest.fn();
jest.mock('./gmailApiMailer', () => ({
    getGmailSenderEmail: () => 'deals@nitro.test',
    isGmailApiMailerConfigured: () => true,
    getSystemGmailMailbox: (...args: unknown[]) => getSystemGmailMailbox(...args),
    sendViaGmailApi: (...args: unknown[]) => sendViaGmailApi(...args),
}));

const sendOnApplicationThread = jest.fn();
const sendOnApplicationChainExternal = jest.fn();
jest.mock('../services/applicationEmailThreadService', () => ({
    sendOnApplicationThread: (...args: unknown[]) => sendOnApplicationThread(...args),
    sendOnApplicationChainExternal: (...args: unknown[]) => sendOnApplicationChainExternal(...args),
}));

const getFunderGmailMailboxForSend = jest.fn();
const markFunderMailboxNeedsReconnect = jest.fn();
jest.mock('../services/gmail/funderGmailOAuthService', () => ({
    getFunderGmailMailboxForSend: (...args: unknown[]) => getFunderGmailMailboxForSend(...args),
    markFunderMailboxNeedsReconnect: (...args: unknown[]) => markFunderMailboxNeedsReconnect(...args),
    markFunderMailboxUsed: jest.fn(),
    recordFunderMailboxError: jest.fn(),
}));

jest.mock('../services/mailSenderIdentity', () => ({
    resolveMailSender: jest.fn(async (from: any) => (from && typeof from === 'object' ? from : { email: 'noreply@nitro.test', name: 'Nitro Advance' })),
}));
jest.mock('../constants/brand', () => ({ rewriteBrandLogoUrlsForEmail: (html: string) => html }));

const claimMailSend = jest.fn();
const completeMailSend = jest.fn();
const failMailSend = jest.fn();
const getMailSendClaim = jest.fn();
jest.mock('../services/mail/mailSendClaims', () => ({
    ...jest.requireActual('../services/mail/mailSendClaims'),
    claimMailSend: (...args: unknown[]) => claimMailSend(...args),
    completeMailSend: (...args: unknown[]) => completeMailSend(...args),
    failMailSend: (...args: unknown[]) => failMailSend(...args),
    getMailSendClaim: (...args: unknown[]) => getMailSendClaim(...args),
}));

import sendMail from './nodemailer';

const TIBERIAN_SENDER = { email: 'funding@tiberian.test', name: 'Tiberian Funding' };
const funder = (mailProvider: 'gmail' | 'sendgrid') => ({ id: 'f1', name: 'Tiberian', mailProvider, sender: TIBERIAN_SENDER });
const gmailOk = { gmailMessageId: 'g1', gmailThreadId: 'T1', rfcMessageId: '<m1@x>', accepted: ['iso@x.com'] };
const funderMailbox = { email: 'deals@tiberian.test', fromEmail: 'funding@tiberian.test', accessToken: 'tok', userId: null, funderMailboxId: 'mb1', funderProfileId: 'f1' };

beforeEach(() => {
    jest.clearAllMocks();
    sendGridConfigured = true;
    claimMailSend.mockResolvedValue({ claimId: 'c1', idempotencyKey: 'k' });
    completeMailSend.mockResolvedValue(undefined);
    failMailSend.mockResolvedValue(undefined);
    getSystemGmailMailbox.mockResolvedValue({ email: 'deals@nitro.test', accessToken: 'sys', userId: null });
    sendViaGmailApi.mockResolvedValue(gmailOk);
    sendViaSendGrid.mockResolvedValue({ messageId: 'sg-1', rfcMessageId: '<sg1@tiberian.test>', accepted: ['iso@x.com'], rejected: [] });
});

describe('provider selection', () => {
    it('sends mail with no funder from the server Gmail mailbox', async () => {
        resolveMailFunder.mockResolvedValue(null);
        const result = await sendMail({ to: 'user@x.com', subject: 'Welcome', html: '<p>hi</p>' });
        expect(result).toMatchObject({ provider: 'gmail', mailboxEmail: 'deals@nitro.test' });
        expect(sendViaGmailApi.mock.calls[0][0]).toMatchObject({ accessToken: 'sys', from: { address: 'deals@nitro.test' } });
        expect(sendViaSendGrid).not.toHaveBeenCalled();
    });

    it('keeps SendGrid (with the funder sender) as the default for funder mail', async () => {
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        const result = await sendMail({ to: 'iso@x.com', subject: 'Letter', html: '<p>x</p>', applicationId: 'app-1' });
        expect(result).toMatchObject({ provider: 'sendgrid', messageId: 'sg-1', funderProfileId: 'f1' });
        expect(sendViaSendGrid.mock.calls[0][0]).toMatchObject({ from: TIBERIAN_SENDER, messageId: expect.stringMatching(/@tiberian\.test>$/) });
        expect(sendViaGmailApi).not.toHaveBeenCalled();
        expect(getFunderGmailMailboxForSend).not.toHaveBeenCalled();
    });

    it("sends from the funder's Gmail (verified alias as From) when the funder is on Gmail", async () => {
        resolveMailFunder.mockResolvedValue(funder('gmail'));
        getFunderGmailMailboxForSend.mockResolvedValue(funderMailbox);
        const result = await sendMail({ to: 'iso@x.com', subject: 'Letter', html: '<p>x</p>', applicationId: 'app-1' });
        expect(result).toMatchObject({ provider: 'gmail', mailboxEmail: 'deals@tiberian.test', funderProfileId: 'f1' });
        expect(sendViaGmailApi.mock.calls[0][0]).toMatchObject({
            accessToken: 'tok',
            from: { name: 'Tiberian Funding', address: 'funding@tiberian.test' },
        });
        expect(sendViaSendGrid).not.toHaveBeenCalled();
    });

    it('lets an explicit funder override the deal lookup', async () => {
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        await sendMail({ to: 'a@x.com', subject: 's', html: 'h', funderName: 'Tiberian', applicationId: 'app-1' });
        expect(resolveMailFunder).toHaveBeenCalledWith({ funderProfileId: undefined, funderName: 'Tiberian', applicationId: 'app-1' });
    });
});

describe('fallback safety', () => {
    it('falls back to SendGrid when the funder mailbox is disconnected (nothing was sent)', async () => {
        resolveMailFunder.mockResolvedValue(funder('gmail'));
        getFunderGmailMailboxForSend.mockResolvedValue(null);
        const result = await sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1' });
        expect(result.provider).toBe('sendgrid');
        expect(sendViaGmailApi).not.toHaveBeenCalled();
    });

    it('falls back after Gmail rejects the send (4xx) and flags the mailbox for reconnect on 401/403', async () => {
        resolveMailFunder.mockResolvedValue(funder('gmail'));
        getFunderGmailMailboxForSend.mockResolvedValue(funderMailbox);
        sendViaGmailApi.mockRejectedValueOnce(new MailDeliveryError('insufficient scope', { kind: 'not_sent', provider: 'gmail', status: 403 }));
        const result = await sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1' });
        expect(result.provider).toBe('sendgrid');
        expect(markFunderMailboxNeedsReconnect).toHaveBeenCalledWith('mb1', expect.stringContaining('403'));
    });

    it('never resends through another provider after an ambiguous Gmail failure', async () => {
        resolveMailFunder.mockResolvedValue(funder('gmail'));
        getFunderGmailMailboxForSend.mockResolvedValue(funderMailbox);
        const ambiguous = new MailDeliveryError('backend error', { kind: 'ambiguous', provider: 'gmail', status: 503 });
        sendViaGmailApi.mockRejectedValueOnce(ambiguous);
        await expect(sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1' })).rejects.toBe(ambiguous);
        expect(sendViaSendGrid).not.toHaveBeenCalled();
        expect(failMailSend).toHaveBeenCalledWith('c1', ambiguous);
    });

    it('never resends after a SendGrid timeout', async () => {
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        sendViaSendGrid.mockRejectedValueOnce(new MailDeliveryError('timed out', { kind: 'ambiguous', provider: 'sendgrid' }));
        await expect(sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1' })).rejects.toThrow('timed out');
        expect(sendViaGmailApi).not.toHaveBeenCalled();
    });

    it('uses the server Gmail mailbox when SendGrid is not configured', async () => {
        sendGridConfigured = false;
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        const result = await sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1' });
        expect(result).toMatchObject({ provider: 'gmail', mailboxEmail: 'deals@nitro.test' });
    });
});

describe('deal threads', () => {
    it('continues the deal chain over SendGrid with In-Reply-To / References', async () => {
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        sendOnApplicationChainExternal.mockImplementation(async (_input: unknown, send: (h: unknown) => Promise<any>) => ({
            ...(await send({ subject: 'Re: Approved', inReplyTo: '<m1@x>', references: '<m0@x> <m1@x>' })),
            chainSubject: 'Re: Approved',
        }));
        await sendMail({ to: 'iso@x.com', subject: 'Offer declined', html: 'h', threadApplicationId: 'app-1' });
        expect(sendOnApplicationChainExternal.mock.calls[0][0]).toMatchObject({ applicationId: 'app-1', provider: 'sendgrid' });
        expect(sendViaSendGrid.mock.calls[0][0]).toMatchObject({
            subject: 'Re: Approved',
            inReplyTo: '<m1@x>',
            references: '<m0@x> <m1@x>',
            messageId: expect.stringMatching(/^<.+@tiberian\.test>$/),
        });
    });

    it("sends deal mail on the funder mailbox's thread when the funder is on Gmail", async () => {
        resolveMailFunder.mockResolvedValue(funder('gmail'));
        getFunderGmailMailboxForSend.mockResolvedValue(funderMailbox);
        sendOnApplicationThread.mockResolvedValue({ ...gmailOk, mailboxEmail: 'deals@tiberian.test', subject: 'Re: x', repliedOnExistingThread: true });
        const result = await sendMail({ to: 'iso@x.com', subject: 'x', html: 'h', threadApplicationId: 'app-1' });
        expect(sendOnApplicationThread.mock.calls[0][0]).toMatchObject({ applicationId: 'app-1', mailbox: funderMailbox });
        expect(result).toMatchObject({ provider: 'gmail', gmailThreadId: 'T1' });
    });

    it('starts pre-funder deal mail from the server mailbox rules (no preferred mailbox)', async () => {
        resolveMailFunder.mockResolvedValue(null);
        sendOnApplicationThread.mockResolvedValue({ ...gmailOk, mailboxEmail: 'deals@nitro.test', subject: 'x', repliedOnExistingThread: false });
        await sendMail({ to: 'iso@x.com', subject: 'x', html: 'h', threadApplicationId: 'app-1', threadSenderUserId: 'u1' });
        expect(sendOnApplicationThread.mock.calls[0][0]).toMatchObject({ applicationId: 'app-1', senderUserId: 'u1' });
        expect(sendOnApplicationThread.mock.calls[0][0].mailbox).toBeUndefined();
    });
});

describe('idempotency', () => {
    it('claims deal mail with an automatic key and records the result', async () => {
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        await sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1', trackingId: 'ocid-1' });
        expect(claimMailSend.mock.calls[0][0]).toMatchObject({
            idempotencyKey: expect.stringMatching(/^deal:app-1:/),
            applicationId: 'app-1',
            outboundCommunicationId: 'ocid-1',
        });
        expect(completeMailSend).toHaveBeenCalledWith('c1', expect.objectContaining({ provider: 'sendgrid', providerMessageId: 'sg-1' }));
    });

    it('does not send an email that was already sent', async () => {
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        claimMailSend.mockRejectedValueOnce(new DuplicateMailSendError('k', 'sent'));
        getMailSendClaim.mockResolvedValueOnce({ state: 'sent', provider: 'sendgrid', providerMessageId: 'sg-0' });
        const result = await sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1' });
        expect(result).toMatchObject({ deduplicated: true, provider: 'sendgrid', messageId: 'sg-0' });
        expect(sendViaSendGrid).not.toHaveBeenCalled();
    });

    it('refuses while a previous attempt is in flight or unconfirmed', async () => {
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        claimMailSend.mockRejectedValueOnce(new DuplicateMailSendError('k', 'unknown'));
        await expect(sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1' })).rejects.toBeInstanceOf(DuplicateMailSendError);
        expect(sendViaSendGrid).not.toHaveBeenCalled();
    });

    it('still sends when the ledger itself is unavailable', async () => {
        resolveMailFunder.mockResolvedValue(funder('sendgrid'));
        claimMailSend.mockRejectedValueOnce(new Error('relation "MailSendClaim" does not exist'));
        await expect(sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1' })).resolves.toMatchObject({ provider: 'sendgrid' });
    });

    it('does not claim non-deal mail or an explicit opt-out', async () => {
        resolveMailFunder.mockResolvedValue(null);
        await sendMail({ to: 'user@x.com', subject: 'Reset', html: 'h' });
        await sendMail({ to: 'iso@x.com', subject: 's', html: 'h', applicationId: 'app-1', idempotencyKey: false });
        expect(claimMailSend).not.toHaveBeenCalled();
    });
});
