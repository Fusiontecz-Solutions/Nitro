/**
 * SignNow signs each callback as X-SignNow-Signature = base64(HMAC-SHA256(body))
 * with the subscription's `secret_key`. Comparing that header to the secret
 * itself rejected every genuine callback, so the CRM never heard about signing.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('../config/prismaClient', () => ({ __esModule: true, default: {} }));
jest.mock('../services/signnow/signnow.service', () => ({ signNowService: {} }));
jest.mock('../services/signnow/signnow-portal-send.service', () => ({
  advancePortalSigningQueue: jest.fn(),
}));

import crypto from 'crypto';
import { isValidSignNowWebhookSignature } from './signnowWebhookController';

const SECRET = 'webhook-secret';
const body = Buffer.from(JSON.stringify({ meta: { event: 'user.document_group.complete' } }));
const hmac = crypto.createHmac('sha256', SECRET).update(body).digest();

describe('isValidSignNowWebhookSignature', () => {
  it('accepts every callback when no secret is configured', () => {
    expect(isValidSignNowWebhookSignature('', body, '', '')).toBe(true);
  });

  it('accepts SignNow HMAC signatures (base64 and hex)', () => {
    expect(isValidSignNowWebhookSignature(SECRET, body, hmac.toString('base64'), '')).toBe(true);
    expect(isValidSignNowWebhookSignature(SECRET, body, hmac.toString('hex'), '')).toBe(true);
  });

  it('accepts the plain shared secret for custom-header subscriptions', () => {
    expect(isValidSignNowWebhookSignature(SECRET, body, SECRET, '')).toBe(true);
    expect(isValidSignNowWebhookSignature(SECRET, body, '', SECRET)).toBe(true);
  });

  it('rejects a missing or forged signature', () => {
    expect(isValidSignNowWebhookSignature(SECRET, body, '', '')).toBe(false);
    const forged = crypto.createHmac('sha256', 'other').update(body).digest('base64');
    expect(isValidSignNowWebhookSignature(SECRET, body, forged, '')).toBe(false);
    const tampered = Buffer.from('{"meta":{"event":"tampered"}}');
    expect(isValidSignNowWebhookSignature(SECRET, tampered, hmac.toString('base64'), '')).toBe(false);
  });
});
