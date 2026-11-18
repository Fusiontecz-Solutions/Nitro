/**
 * Which SendGrid HTTP API failures are safe to retry.
 *
 * A retry must never email a recipient twice, so only failures where SendGrid
 * certainly did not accept the message qualify: throttling, server errors and
 * connection errors raised before any response. A timed-out request may have
 * been accepted and is left alone.
 */
import { isRetryableSendGridFailure } from './nodemailer';

describe('isRetryableSendGridFailure', () => {
  it('retries throttling and server errors', () => {
    expect(isRetryableSendGridFailure({ status: 429 })).toBe(true);
    expect(isRetryableSendGridFailure({ status: 500 })).toBe(true);
    expect(isRetryableSendGridFailure({ status: 503 })).toBe(true);
  });

  it('does not retry client errors', () => {
    expect(isRetryableSendGridFailure({ status: 400 })).toBe(false);
    expect(isRetryableSendGridFailure({ status: 401 })).toBe(false);
    expect(isRetryableSendGridFailure({ status: 413 })).toBe(false);
  });

  it('retries connection errors raised before a response', () => {
    const reset = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET' },
    });
    expect(isRetryableSendGridFailure({ error: reset })).toBe(true);
    expect(isRetryableSendGridFailure({ error: { code: 'ENOTFOUND' } })).toBe(true);
  });

  it('never retries a timeout, which may already have been delivered', () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    expect(isRetryableSendGridFailure({ error: timeout })).toBe(false);
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(isRetryableSendGridFailure({ error: abort })).toBe(false);
  });
});
