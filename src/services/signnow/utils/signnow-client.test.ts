import { isTransientSignNowFailure } from './signnow-client';

describe('isTransientSignNowFailure', () => {
  it('retries timeouts and network drops', () => {
    expect(isTransientSignNowFailure(undefined, 'timeout of 45000ms exceeded')).toBe(true);
    expect(isTransientSignNowFailure(undefined, 'ECONNRESET')).toBe(true);
    expect(isTransientSignNowFailure(undefined, 'socket hang up')).toBe(true);
  });

  it('retries 429, 408, 409, and 5xx', () => {
    expect(isTransientSignNowFailure(429, 'rate limited')).toBe(true);
    expect(isTransientSignNowFailure(408, 'timeout')).toBe(true);
    expect(isTransientSignNowFailure(409, 'conflict')).toBe(true);
    expect(isTransientSignNowFailure(503, 'unavailable')).toBe(true);
  });

  it('does not retry ordinary 400 validation errors', () => {
    expect(isTransientSignNowFailure(400, 'unknown role Recipient 2')).toBe(false);
    expect(isTransientSignNowFailure(401, 'unauthorized')).toBe(false);
  });
});
