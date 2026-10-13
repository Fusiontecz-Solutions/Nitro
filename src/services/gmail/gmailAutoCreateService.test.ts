/**
 * Gmail PDF auto-create: deal emails in a mailbox become applications owned by
 * that mailbox's user, and an Agent mailbox only ever reuses that Agent's clients.
 */
const isoFindMany = jest.fn(async (_args?: any): Promise<any[]> => []);
const isoCreate = jest.fn(async (_args?: any) => ({ id: 'iso-new' }));
jest.mock('../../config/prismaClient', () => ({
    __esModule: true,
    default: { iso: { findMany: (a: any) => isoFindMany(a), create: (a: any) => isoCreate(a) } },
}));
jest.mock('../../config/redis', () => ({ getRedisClient: () => null }));

const handled = new Set<string>();
const successPdfHashes = new Set<string>();
const recordHandled = jest.fn(async (userId: string, messageId: string, outcome: string, extras?: any) => {
    handled.add(`${userId}:${messageId}`);
    if (outcome === 'success' && extras?.pdfContentHash) successPdfHashes.add(`${userId}:${extras.pdfContentHash}`);
});
jest.mock('./gmailAutoCreateProcessedStore', () => ({
    ...jest.requireActual('./gmailAutoCreateProcessedStore'),
    isGmailAutoCreateMessageHandled: jest.fn(async (u: string, m: string) => handled.has(`${u}:${m}`)),
    recordGmailAutoCreateMessageHandled: (...a: [string, string, string, any?]) => recordHandled(...a),
    hasRecentGmailPdfContentHash: jest.fn(async (p: { userId: string; pdfContentHash: string }) =>
        successPdfHashes.has(`${p.userId}:${p.pdfContentHash}`),
    ),
}));

jest.mock('../pdfFileDedupeService', () => ({
    hasRecentApplicationForGmailMessage: jest.fn(async () => false),
    readPdfFileDedupeDays: () => 7,
}));

const attachBuffer = jest.fn(async (..._a: any[]) => undefined);
jest.mock('../applicationPdfAttachService', () => ({
    attachBufferAsApplicationFile: (...a: any[]) => attachBuffer(...a),
}));

class InsufficientParsedPdfError extends Error {}
const createFromPdf = jest.fn(async (_buf: Buffer, userId: string, _opts: any) => ({
    client: { id: 'client-1' },
    application: { id: `app-for-${userId}` },
    existingClient: false,
}));
const createFromSubject = jest.fn();
jest.mock('../applicationService', () => ({
    createClientAndApplicationFromPDFBuffer: (...a: [Buffer, string, any]) => createFromPdf(...a),
    createApplicationFromGmailSubjectFallback: (...a: any[]) => createFromSubject(...a),
    InsufficientParsedPdfError,
}));

const notifyPool = jest.fn();
jest.mock('../applicationWorkflowService', () => ({
    notifyNewInUnderwriterPool: (...a: any[]) => notifyPool(...a),
}));

const messages = new Map<string, any>();
const listMessageIds = jest.fn(async (..._a: any[]) => ({ ids: Array.from(messages.keys()) }));
const getMessageFull = jest.fn(async (_t: string, id: string) => messages.get(id));
const labelMessagesInCrm = jest.fn(async (..._a: any[]) => 'label-in-crm');
const modifyMessages = jest.fn(async (..._a: any[]) => undefined);
jest.mock('./gmailMailboxService', () => ({
    listMessageIds: (...a: any[]) => listMessageIds(...a),
    getMessageFull: (t: string, id: string) => getMessageFull(t, id),
    downloadAttachmentById: jest.fn(async (_t: string, _m: string, aid: string) => Buffer.from(`pdf:${aid}`)),
    labelMessagesInCrm: (...a: any[]) => labelMessagesInCrm(...a),
    modifyMessages: (...a: any[]) => modifyMessages(...a),
}));
jest.mock('./gmailOAuthService', () => ({ getGmailAccessTokenForUser: jest.fn() }));

import {
    autoCreateApplicationsFromEmails,
    isInternalAddress,
    pickApplicationPdfAttachment,
} from './gmailAutoCreateService';

const b64 = (s: string) => Buffer.from(s).toString('base64url');

function pdf(filename: string, attachmentId: string, size = 50_000) {
    return { filename, mimeType: 'application/pdf', body: { attachmentId, size } };
}

function addMessage(id: string, opts: { from: string; subject?: string; body?: string; pdfs: any[] }) {
    messages.set(id, {
        id,
        snippet: '',
        payload: {
            headers: [
                { name: 'From', value: opts.from },
                { name: 'Subject', value: opts.subject ?? 'New Deal - ACME LLC' },
            ],
            parts: [{ mimeType: 'text/plain', body: { data: b64(opts.body ?? '') } }, ...opts.pdfs],
        },
    });
}

const AGENT = { id: 'agent-1', role: 'AGENT', email: 'agent1@nitro.test', googleEmail: 'agent1@gmail.com' };

beforeEach(() => {
    messages.clear();
    handled.clear();
    successPdfHashes.clear();
    delete process.env.GMAIL_AUTO_CREATE_INTERNAL_DOMAINS;
});

describe('autoCreateApplicationsFromEmails', () => {
    it("creates the deal as the mailbox Agent's own and keeps client matching to that Agent", async () => {
        isoFindMany.mockResolvedValueOnce([{ id: 'iso-1', email: 'iso@broker.com' }]);
        addMessage('m1', {
            from: 'ISO Broker <iso@broker.com>',
            pdfs: [pdf('ACME application.pdf', 'a-app'), pdf('bank statement.pdf', 'a-bank')],
        });

        const results = await autoCreateApplicationsFromEmails('tok', AGENT);

        expect(createFromPdf).toHaveBeenCalledTimes(1);
        const [buf, userId, opts] = createFromPdf.mock.calls[0]!;
        expect(buf.toString()).toBe('pdf:a-app');
        expect(userId).toBe('agent-1');
        expect(opts).toMatchObject({
            isoId: 'iso-1',
            gmailMessageId: 'm1',
            originalFileName: 'ACME application.pdf',
            restrictClientToOwnerId: 'agent-1',
            startInUnderwriterPool: true,
        });
        // Lands in the Underwriter pool, so the Underwriters are alerted.
        expect(notifyPool).toHaveBeenCalledWith(expect.objectContaining({ id: 'app-for-agent-1' }), 'agent-1');
        // The supporting statement is attached to the same deal.
        expect(attachBuffer).toHaveBeenCalledWith('app-for-agent-1', expect.any(Buffer), 'bank statement.pdf');
        expect(recordHandled).toHaveBeenCalledWith('agent-1', 'm1', 'success', expect.objectContaining({ applicationId: 'app-for-agent-1' }));
        expect(labelMessagesInCrm).toHaveBeenCalledWith('tok', ['m1']);
        expect(results).toEqual([expect.objectContaining({ messageId: 'm1', applicationId: 'app-for-agent-1' })]);
    });

    it('does not restrict client matching for a Super Admin mailbox', async () => {
        addMessage('m1', { from: 'iso@broker.com', pdfs: [pdf('application.pdf', 'a1'), pdf('stmt.pdf', 'a2')] });
        await autoCreateApplicationsFromEmails('tok', { id: 'sa-1', role: 'SUPER_ADMIN' });
        expect(createFromPdf.mock.calls[0]![1]).toBe('sa-1');
        expect(createFromPdf.mock.calls[0]![2].restrictClientToOwnerId).toBeNull();
    });

    it('skips single-PDF mail without extraction and labels it so it is not rescanned', async () => {
        addMessage('m1', { from: 'iso@broker.com', pdfs: [pdf('application.pdf', 'a1')] });
        await autoCreateApplicationsFromEmails('tok', AGENT);
        expect(createFromPdf).not.toHaveBeenCalled();
        expect(isoCreate).not.toHaveBeenCalled();
        expect(recordHandled).toHaveBeenCalledWith('agent-1', 'm1', 'skipped_filtered');
        expect(labelMessagesInCrm).toHaveBeenCalledWith('tok', ['m1']);
    });

    it('never processes a message the ledger already handled', async () => {
        handled.add('agent-1:m1');
        addMessage('m1', { from: 'iso@broker.com', pdfs: [pdf('application.pdf', 'a1'), pdf('s.pdf', 'a2')] });
        await autoCreateApplicationsFromEmails('tok', AGENT);
        expect(getMessageFull).not.toHaveBeenCalled();
        expect(createFromPdf).not.toHaveBeenCalled();
    });

    it('does not create a second deal when the same application PDF arrives in another email', async () => {
        // Same attachment id → identical bytes from the download mock, as when an ISO resends a deal.
        addMessage('m1', { from: 'iso@broker.com', pdfs: [pdf('application.pdf', 'same-app'), pdf('s.pdf', 'a2')] });
        addMessage('m2', { from: 'iso@broker.com', pdfs: [pdf('application.pdf', 'same-app'), pdf('s.pdf', 'a3')] });

        const results = await autoCreateApplicationsFromEmails('tok', AGENT);

        expect(createFromPdf).toHaveBeenCalledTimes(1);
        expect(notifyPool).toHaveBeenCalledTimes(1);
        expect(results).toEqual([expect.objectContaining({ messageId: 'm1' })]);
        expect(recordHandled).toHaveBeenCalledWith(
            'agent-1',
            'm2',
            'skipped_duplicate',
            expect.objectContaining({ pdfContentHash: expect.any(String) }),
        );
        expect(labelMessagesInCrm).toHaveBeenCalledWith('tok', ['m2']);
    });

    it('still creates a deal for a different application PDF from the same sender', async () => {
        addMessage('m1', { from: 'iso@broker.com', pdfs: [pdf('application.pdf', 'app-1'), pdf('s.pdf', 'a2')] });
        addMessage('m2', { from: 'iso@broker.com', pdfs: [pdf('application.pdf', 'app-2'), pdf('s.pdf', 'a3')] });
        await autoCreateApplicationsFromEmails('tok', AGENT);
        expect(createFromPdf).toHaveBeenCalledTimes(2);
    });

    it("uses the forwarded ISO address, not the Agent's own, when the Agent forwards a deal", async () => {
        process.env.GMAIL_AUTO_CREATE_INTERNAL_DOMAINS = 'nitro.test';
        addMessage('m1', {
            from: 'Agent One <agent1@gmail.com>',
            body: '---------- Forwarded message ---------\nFrom: Broker <deals@isoshop.com>\nCc: ops@nitro.test',
            pdfs: [pdf('application.pdf', 'a1'), pdf('s.pdf', 'a2')],
        });
        await autoCreateApplicationsFromEmails('tok', AGENT);
        expect(isoCreate).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ email: 'deals@isoshop.com' }) }),
        );
        expect(createFromPdf.mock.calls[0]![2].isoId).toBe('iso-new');
    });

    it('stars the email for review when the PDF cannot be parsed and the subject has no merchant', async () => {
        createFromPdf.mockRejectedValueOnce(new InsufficientParsedPdfError('no owner name'));
        addMessage('m1', {
            from: 'iso@broker.com',
            subject: '',
            pdfs: [pdf('application.pdf', 'a1'), pdf('s.pdf', 'a2')],
        });
        await autoCreateApplicationsFromEmails('tok', AGENT);
        expect(recordHandled).toHaveBeenCalledWith('agent-1', 'm1', 'failed_parse');
        expect(modifyMessages).toHaveBeenCalledWith('tok', ['m1'], ['STARRED'], []);
    });

    it('falls back to the subject merchant, still owned by the Agent', async () => {
        createFromPdf.mockRejectedValueOnce(new Error('Document AI down'));
        createFromSubject.mockResolvedValueOnce({
            client: { id: 'c2' },
            application: { id: 'app-subject' },
            existingClient: false,
        });
        addMessage('m1', {
            from: 'iso@broker.com',
            subject: 'Fwd: New Deal - PRIME 6 LLC',
            pdfs: [pdf('application.pdf', 'a1'), pdf('s.pdf', 'a2')],
        });
        await autoCreateApplicationsFromEmails('tok', AGENT);
        expect(createFromSubject).toHaveBeenCalledWith(
            'PRIME 6 LLC',
            'agent-1',
            expect.objectContaining({ gmailMessageId: 'm1', restrictClientToOwnerId: 'agent-1' }),
        );
        expect(recordHandled).toHaveBeenCalledWith('agent-1', 'm1', 'success', { applicationId: 'app-subject' });
        expect(notifyPool).toHaveBeenCalledWith(expect.objectContaining({ id: 'app-subject' }), 'agent-1');
    });
});

describe('pickApplicationPdfAttachment', () => {
    it('prefers an "application" filename over a larger statement', () => {
        const picked = pickApplicationPdfAttachment([pdf('statement.pdf', 's', 900_000), pdf('Loan Application.pdf', 'a', 40_000)]);
        expect(picked?.body.attachmentId).toBe('a');
    });

    it('returns null on an exact tie so the subject fallback decides', () => {
        expect(pickApplicationPdfAttachment([pdf('jan.pdf', 'x', 30_000), pdf('feb.pdf', 'y', 30_000)])).toBeNull();
    });
});

describe('isInternalAddress', () => {
    it('treats the mailbox owner and configured staff domains as internal', () => {
        process.env.GMAIL_AUTO_CREATE_INTERNAL_DOMAINS = '@nitro.test';
        expect(isInternalAddress('Agent1@Gmail.com', ['agent1@gmail.com'])).toBe(true);
        expect(isInternalAddress('ops@mail.nitro.test', [])).toBe(true);
        expect(isInternalAddress('iso@broker.com', [])).toBe(false);
    });
});
