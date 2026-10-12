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

import { appendReference, buildReplySubject, sendOnApplicationThread } from './applicationEmailThreadService';

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
