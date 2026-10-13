/**
 * Only failures where the provider certainly did not accept the email may fall
 * back to another provider; timeouts / 5xx / dropped connections never do.
 */
import {
    MailDeliveryError,
    classifyHttpFailure,
    classifySmtpFailure,
    isSafeToFallback,
} from './mailErrors';

describe('classifyHttpFailure', () => {
    it('treats 4xx (incl. 429) as not sent', () => {
        for (const status of [400, 401, 403, 404, 413, 429]) {
            expect(classifyHttpFailure({ response: { status } })).toBe('not_sent');
        }
    });

    it('treats 5xx as ambiguous', () => {
        expect(classifyHttpFailure({ response: { status: 500 } })).toBe('ambiguous');
        expect(classifyHttpFailure(null, 503)).toBe('ambiguous');
    });

    it('treats timeouts and mid-request resets as ambiguous', () => {
        expect(classifyHttpFailure(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe('ambiguous');
        expect(classifyHttpFailure(Object.assign(new Error('t'), { code: 'ECONNABORTED' }))).toBe('ambiguous');
        expect(classifyHttpFailure(Object.assign(new Error('t'), { code: 'ECONNRESET' }))).toBe('ambiguous');
        expect(classifyHttpFailure(new Error('unknown'))).toBe('ambiguous');
    });

    it('treats pre-request connection failures as not sent', () => {
        expect(classifyHttpFailure({ code: 'ENOTFOUND' })).toBe('not_sent');
        expect(classifyHttpFailure({ cause: { code: 'ECONNREFUSED' } })).toBe('not_sent');
    });
});

describe('classifySmtpFailure', () => {
    it('treats an SMTP rejection or auth failure as not sent', () => {
        expect(classifySmtpFailure({ responseCode: 550 })).toBe('not_sent');
        expect(classifySmtpFailure({ responseCode: 451 })).toBe('not_sent');
        expect(classifySmtpFailure({ code: 'EAUTH' })).toBe('not_sent');
    });

    it('treats dropped sockets as ambiguous', () => {
        expect(classifySmtpFailure({ code: 'ETIMEDOUT' })).toBe('ambiguous');
        expect(classifySmtpFailure({ code: 'ECONNRESET' })).toBe('ambiguous');
    });
});

describe('isSafeToFallback', () => {
    it('allows fallback only for classified not-sent failures', () => {
        expect(isSafeToFallback(new MailDeliveryError('x', { kind: 'not_sent' }))).toBe(true);
        expect(isSafeToFallback(new MailDeliveryError('x', { kind: 'ambiguous' }))).toBe(false);
        expect(isSafeToFallback(new Error('plain error'))).toBe(false);
    });
});
