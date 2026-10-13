/**
 * Deal emails share one Gmail thread: the first send stores the thread id and
 * Message-ID; every later send replies on that thread (threadId + In-Reply-To +
 * References + "Re:" subject) and advances the stored Message-ID.
 */
const threads = new Map<string, any>();

jest.mock('../config/prismaClient', () => ({
    __esModule: true,
    default: {
        applicationEmailThread: {
            findUnique: jest.fn(async ({ where }: any) => threads.get(where.applicationId_purpose.applicationId) ?? null),
            upsert: jest.fn(async ({ where, create, update }: any) => {
                const key = where.applicationId_purpose.applicationId;
                const row = threads.has(key) ? { ...threads.get(key), ...update } : { ...create };
                threads.set(key, row);
                return row;
            }),
        },
        application: { findUnique: jest.fn(async () => ({ note: '', createdById: null })) },
        user: { findUnique: jest.fn(async () => null) },
    },
}));

const sendViaGmailApi = jest.fn();
jest.mock('../config/gmailApiMailer', () => ({
    getSystemGmailMailbox: jest.fn(async () => ({ email: 'deals@nitro.test', accessToken: 'tok', userId: null })),
    sendViaGmailApi: (...args: unknown[]) => sendViaGmailApi(...args),
}));
jest.mock('../config/gmail', () => ({ invalidateAccessTokenCache: jest.fn() }));
jest.mock('./gmail/gmailOAuthService', () => ({ getGmailAccessTokenForUser: jest.fn(async () => null) }));
const getGmailMessageHeaders = jest.fn();
jest.mock('./gmail/gmailMailService', () => ({
    getGmailMessageHeaders: (...args: unknown[]) => getGmailMessageHeaders(...args),
}));

import {
    appendReference,
    buildReplySubject,
    hasApplicationEmailChain,
    sendOnApplicationChainExternal,
    sendOnApplicationThread,
} from './applicationEmailThreadService';

describe('sendOnApplicationThread', () => {
    beforeEach(() => {
        threads.clear();
        sendViaGmailApi.mockReset();
        getGmailMessageHeaders.mockReset();
    });

    it('starts a thread, then replies on it with threading headers', async () => {
        sendViaGmailApi.mockResolvedValueOnce({
            gmailMessageId: 'g1',
            gmailThreadId: 'T1',
            rfcMessageId: '<local1@nitro.test>',
            accepted: ['iso@example.com'],
        });
        getGmailMessageHeaders.mockResolvedValueOnce({ messageId: '<m1@mail.gmail.com>', references: '', subject: '' });

        const first = await sendOnApplicationThread({
            applicationId: 'app-1',
            to: 'iso@example.com',
            subject: 'Application Approved — Acme',
            html: '<p>approved</p>',
        });
        expect(first.repliedOnExistingThread).toBe(false);
        expect(sendViaGmailApi.mock.calls[0][0]).toMatchObject({ threadId: undefined, inReplyTo: undefined });
        expect(threads.get('app-1')).toMatchObject({
            gmailThreadId: 'T1',
            lastMessageId: '<m1@mail.gmail.com>',
            mailboxEmail: 'deals@nitro.test',
        });

        sendViaGmailApi.mockResolvedValueOnce({
            gmailMessageId: 'g2',
            gmailThreadId: 'T1',
            rfcMessageId: '<local2@nitro.test>',
            accepted: ['iso@example.com'],
        });
        getGmailMessageHeaders.mockResolvedValueOnce({ messageId: '<m2@mail.gmail.com>', references: '', subject: '' });

        const second = await sendOnApplicationThread({
            applicationId: 'app-1',
            to: 'iso@example.com',
            subject: 'Application Rejected — Acme',
            html: '<p>declined</p>',
        });
        expect(second.repliedOnExistingThread).toBe(true);
        expect(sendViaGmailApi.mock.calls[1][0]).toMatchObject({
            threadId: 'T1',
            inReplyTo: '<m1@mail.gmail.com>',
            references: '<m1@mail.gmail.com>',
            subject: 'Re: Application Approved — Acme',
        });
        expect(threads.get('app-1')).toMatchObject({
            gmailThreadId: 'T1',
            lastMessageId: '<m2@mail.gmail.com>',
            references: '<m1@mail.gmail.com>',
        });
    });

    it('serializes concurrent sends so only one thread is started', async () => {
        let n = 0;
        sendViaGmailApi.mockImplementation(async () => {
            n += 1;
            return { gmailMessageId: `g${n}`, gmailThreadId: 'T9', rfcMessageId: `<l${n}@x>`, accepted: [] };
        });
        getGmailMessageHeaders.mockImplementation(async (_t: string, id: string) => ({
            messageId: `<${id}@mail.gmail.com>`,
            references: '',
            subject: '',
        }));

        await Promise.all([
            sendOnApplicationThread({ applicationId: 'app-2', to: 'a@x.com', subject: 'S', html: '1' }),
            sendOnApplicationThread({ applicationId: 'app-2', to: 'a@x.com', subject: 'S', html: '2' }),
        ]);
        expect(sendViaGmailApi.mock.calls[0][0].threadId).toBeUndefined();
        expect(sendViaGmailApi.mock.calls[1][0]).toMatchObject({ threadId: 'T9', inReplyTo: '<g1@mail.gmail.com>' });
    });
});

describe('funder mailboxes and SendGrid chains', () => {
    const funderMailbox = {
        email: 'deals@tiberian.test',
        fromEmail: 'funding@tiberian.test',
        accessToken: 'ftok',
        userId: null,
        funderMailboxId: 'mb1',
    };

    beforeEach(() => {
        threads.clear();
        sendViaGmailApi.mockReset();
        getGmailMessageHeaders.mockReset();
        getGmailMessageHeaders.mockImplementation(async (_t: string, id: string) => ({
            messageId: `<${id}@mail.gmail.com>`,
            references: '',
            subject: '',
        }));
    });

    it('takes a server-mailbox thread over by headers, then continues its own Gmail thread', async () => {
        // Approval went out before a funder was chosen (server mailbox, thread T1).
        threads.set('app-3', {
            applicationId: 'app-3',
            ownerUserId: null,
            ownerFunderMailboxId: null,
            mailboxEmail: 'deals@nitro.test',
            gmailThreadId: 'T1',
            lastMessageId: '<a1@mail.gmail.com>',
            references: null,
            subject: 'Application Approved — Acme',
        });
        sendViaGmailApi.mockResolvedValueOnce({ gmailMessageId: 'f1', gmailThreadId: 'FT1', rfcMessageId: '<l@x>', accepted: [] });

        await sendOnApplicationThread({ applicationId: 'app-3', to: 'iso@x.com', subject: 'Offer updated', html: 'h', mailbox: funderMailbox });
        // Gmail thread ids belong to one mailbox: no threadId, but the ISO-side chain is kept.
        expect(sendViaGmailApi.mock.calls[0][0]).toMatchObject({
            accessToken: 'ftok',
            from: { address: 'funding@tiberian.test' },
            threadId: undefined,
            inReplyTo: '<a1@mail.gmail.com>',
            references: '<a1@mail.gmail.com>',
            subject: 'Re: Application Approved — Acme',
        });
        expect(threads.get('app-3')).toMatchObject({
            ownerFunderMailboxId: 'mb1',
            ownerUserId: null,
            mailboxEmail: 'deals@tiberian.test',
            gmailThreadId: 'FT1',
            lastMessageId: '<f1@mail.gmail.com>',
            lastProvider: 'gmail',
        });

        sendViaGmailApi.mockResolvedValueOnce({ gmailMessageId: 'f2', gmailThreadId: 'FT1', rfcMessageId: '<l2@x>', accepted: [] });
        await sendOnApplicationThread({ applicationId: 'app-3', to: 'iso@x.com', subject: 'Offer declined', html: 'h', mailbox: funderMailbox });
        expect(sendViaGmailApi.mock.calls[1][0]).toMatchObject({ threadId: 'FT1', inReplyTo: '<f1@mail.gmail.com>' });
    });

    it('does not continue a funder-owned thread from the server mailbox', async () => {
        threads.set('app-4', {
            applicationId: 'app-4',
            ownerUserId: null,
            ownerFunderMailboxId: 'mb1',
            mailboxEmail: 'deals@tiberian.test',
            gmailThreadId: 'FT9',
            lastMessageId: '<f9@mail.gmail.com>',
            references: null,
            subject: 'Approved',
        });
        sendViaGmailApi.mockResolvedValueOnce({ gmailMessageId: 's1', gmailThreadId: 'ST1', rfcMessageId: '<l@x>', accepted: [] });
        await sendOnApplicationThread({ applicationId: 'app-4', to: 'iso@x.com', subject: 'x', html: 'h' });
        expect(sendViaGmailApi.mock.calls[0][0]).toMatchObject({ accessToken: 'tok', threadId: undefined, inReplyTo: '<f9@mail.gmail.com>' });
    });

    it('advances the chain over SendGrid and keeps the Gmail thread for later Gmail sends', async () => {
        threads.set('app-5', {
            applicationId: 'app-5',
            ownerUserId: null,
            ownerFunderMailboxId: null,
            mailboxEmail: 'deals@nitro.test',
            gmailThreadId: 'T5',
            lastMessageId: '<a5@mail.gmail.com>',
            references: null,
            subject: 'Approved',
        });
        const send = jest.fn(async () => ({ rfcMessageId: '<sg5@tiberian.test>', messageId: 'sg-5' }));
        const result = await sendOnApplicationChainExternal(
            { applicationId: 'app-5', to: 'iso@x.com', subject: 'Declined', provider: 'sendgrid' },
            send,
        );
        expect(send).toHaveBeenCalledWith({ subject: 'Re: Approved', inReplyTo: '<a5@mail.gmail.com>', references: '<a5@mail.gmail.com>' });
        expect(result).toMatchObject({ messageId: 'sg-5', chainSubject: 'Re: Approved' });
        expect(threads.get('app-5')).toMatchObject({
            gmailThreadId: 'T5',
            mailboxEmail: 'deals@nitro.test',
            lastMessageId: '<sg5@tiberian.test>',
            references: '<a5@mail.gmail.com>',
            lastProvider: 'sendgrid',
        });
    });

    it('starts a header-only chain over SendGrid that later Gmail sends reply to', async () => {
        await sendOnApplicationChainExternal(
            { applicationId: 'app-6', to: 'iso@x.com', subject: 'Approved', provider: 'sendgrid' },
            async (headers) => {
                expect(headers).toEqual({ subject: 'Approved', inReplyTo: undefined, references: undefined });
                return { rfcMessageId: '<sg6@tiberian.test>' };
            },
        );
        expect(hasApplicationEmailChain(threads.get('app-6'))).toBe(true);
        expect(threads.get('app-6').gmailThreadId).toBeUndefined();

        sendViaGmailApi.mockResolvedValueOnce({ gmailMessageId: 'g6', gmailThreadId: 'T6', rfcMessageId: '<l@x>', accepted: [] });
        await sendOnApplicationThread({ applicationId: 'app-6', to: 'iso@x.com', subject: 'x', html: 'h' });
        expect(sendViaGmailApi.mock.calls[0][0]).toMatchObject({ threadId: undefined, inReplyTo: '<sg6@tiberian.test>', subject: 'Re: Approved' });
    });

    it('reports the send as done even if storing the thread state fails', async () => {
        const prisma = jest.requireMock('../config/prismaClient').default;
        prisma.applicationEmailThread.upsert.mockRejectedValueOnce(new Error('db down'));
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        sendViaGmailApi.mockResolvedValueOnce({ gmailMessageId: 'g7', gmailThreadId: 'T7', rfcMessageId: '<l@x>', accepted: [] });
        await expect(
            sendOnApplicationThread({ applicationId: 'app-7', to: 'iso@x.com', subject: 'x', html: 'h' }),
        ).resolves.toMatchObject({ gmailMessageId: 'g7' });
        error.mockRestore();
    });
});

describe('threading helpers', () => {
    it('builds reply subjects once', () => {
        expect(buildReplySubject('Offer')).toBe('Re: Offer');
        expect(buildReplySubject('RE: Offer')).toBe('RE: Offer');
    });

    it('appends message ids to References without duplicates', () => {
        expect(appendReference('<a@x>', 'b@x')).toBe('<a@x> <b@x>');
        expect(appendReference('<a@x> <b@x>', '<b@x>')).toBe('<a@x> <b@x>');
        expect(appendReference(null, null)).toBe('');
    });
});
