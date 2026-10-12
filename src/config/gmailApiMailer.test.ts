jest.mock('./prismaClient', () => ({ __esModule: true, default: {} }));
jest.mock('../services/gmail/gmailOAuthService', () => ({ getGmailAccessTokenForUser: jest.fn() }));

import { buildGmailRawMessage } from './gmailApiMailer';

const decode = (raw: string) => Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

describe('buildGmailRawMessage', () => {
    it('carries threading headers, BCC and inline images', async () => {
        const { raw, rfcMessageId } = await buildGmailRawMessage({
            from: { name: 'Nitro Advance', address: 'deals@nitro.test' },
            to: 'iso@example.com',
            cc: ['am@example.com'],
            bcc: 'audit@example.com',
            subject: 'Re: Application Approved — Acme',
            html: '<img src="cid:logo"/><p>hi</p>',
            inReplyTo: '<m1@mail.gmail.com>',
            references: '<m0@mail.gmail.com> <m1@mail.gmail.com>',
            attachments: [{ filename: 'logo.png', content: Buffer.from('png'), cid: 'logo' }],
        });
        const mime = decode(raw);
        expect(rfcMessageId).toMatch(/^<.+@nitro\.test>$/);
        expect(mime).toContain(`Message-ID: ${rfcMessageId}`);
        expect(mime).toContain('In-Reply-To: <m1@mail.gmail.com>');
        expect(mime).toContain('References: <m0@mail.gmail.com> <m1@mail.gmail.com>');
        expect(mime).toContain('Bcc: audit@example.com');
        expect(mime).toContain('Cc: am@example.com');
        expect(mime).toMatch(/Content-Id: <logo>/i);
    });
});
