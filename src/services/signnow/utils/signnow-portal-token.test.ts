import {
  buildSigningPortalUrl,
  createSigningPortalToken,
  verifySigningPortalToken,
} from './signnow-portal-token';

const ENVELOPE = 'group-123';
const EMAIL = 'merchant@example.com';

describe('signing portal tokens', () => {
  const previousSecret = process.env.SIGNING_PORTAL_SECRET;

  beforeAll(() => {
    process.env.SIGNING_PORTAL_SECRET = 'test-portal-secret';
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.SIGNING_PORTAL_SECRET;
    else process.env.SIGNING_PORTAL_SECRET = previousSecret;
  });

  it('round-trips a token for the signer it was issued to', () => {
    const token = createSigningPortalToken({ envelopeId: ENVELOPE, email: EMAIL });
    expect(
      verifySigningPortalToken({ token, envelopeId: ENVELOPE, email: EMAIL }),
    ).toMatchObject({ valid: true });
  });

  it('is case-insensitive on the signer email', () => {
    const token = createSigningPortalToken({ envelopeId: ENVELOPE, email: EMAIL });
    expect(
      verifySigningPortalToken({
        token,
        envelopeId: ENVELOPE,
        email: '  Merchant@Example.COM ',
      }).valid,
    ).toBe(true);
  });

  it('rejects a token replayed against another signer or envelope', () => {
    const token = createSigningPortalToken({ envelopeId: ENVELOPE, email: EMAIL });
    expect(
      verifySigningPortalToken({
        token,
        envelopeId: ENVELOPE,
        email: 'someone-else@example.com',
      }),
    ).toEqual({ valid: false, reason: 'signature_mismatch' });
    expect(
      verifySigningPortalToken({ token, envelopeId: 'other-group', email: EMAIL }),
    ).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('rejects a tampered timestamp rather than trusting it', () => {
    const token = createSigningPortalToken({
      envelopeId: ENVELOPE,
      email: EMAIL,
      issuedAt: 1_000,
    });
    const [, signature] = token.split('_');
    expect(
      verifySigningPortalToken({
        token: `${Date.now()}_${signature}`,
        envelopeId: ENVELOPE,
        email: EMAIL,
      }),
    ).toEqual({ valid: false, reason: 'signature_mismatch' });
  });

  it('expires after the TTL', () => {
    const issuedAt = 1_000_000;
    const token = createSigningPortalToken({ envelopeId: ENVELOPE, email: EMAIL, issuedAt });
    expect(
      verifySigningPortalToken({
        token,
        envelopeId: ENVELOPE,
        email: EMAIL,
        now: issuedAt + 60_000,
        ttlMs: 120_000,
      }).valid,
    ).toBe(true);
    expect(
      verifySigningPortalToken({
        token,
        envelopeId: ENVELOPE,
        email: EMAIL,
        now: issuedAt + 180_000,
        ttlMs: 120_000,
      }),
    ).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects malformed tokens', () => {
    for (const token of ['', 'nonsense', '_abc', '12345']) {
      expect(
        verifySigningPortalToken({ token, envelopeId: ENVELOPE, email: EMAIL }).valid,
      ).toBe(false);
    }
  });

  it('builds a portal url carrying the signer identity', () => {
    const url = buildSigningPortalUrl({
      baseUrl: 'https://crm.example.com/',
      envelopeId: ENVELOPE,
      email: EMAIL,
      token: 'tok',
    });
    expect(url).toBe(
      'https://crm.example.com/sign/group-123?email=merchant%40example.com&token=tok',
    );
  });
});
