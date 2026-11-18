/**
 * Per-user Gmail tokens: stored encrypted on connect, legacy plain-text values
 * re-encrypted on first use, and a token from a different OAuth client reads as
 * "reconnect needed" instead of failing sends.
 */
process.env.JWT_SECRET = 'unit-test-jwt';
process.env.FIELD_ENCRYPTION_KEY = 'unit-test-field-key';

const users = new Map<string, any>();
jest.mock('../../config/prismaClient', () => ({
    __esModule: true,
    default: {
        user: {
            findUnique: jest.fn(async ({ where }: any) => users.get(where.id) ?? null),
            update: jest.fn(async ({ where, data }: any) => Object.assign(users.get(where.id), data)),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const row = users.get(where.id);
                if (!row || row.googleRefreshToken !== where.googleRefreshToken) return { count: 0 };
                Object.assign(row, data);
                return { count: 1 };
            }),
        },
    },
}));

const getAccessTokenForRefreshToken = jest.fn();
const oauthClient = {
    generateAuthUrl: jest.fn((opts: any) => `https://accounts.google.com/auth?state=${encodeURIComponent(opts.state)}`),
    getToken: jest.fn(async () => ({ tokens: { refresh_token: '1//new-refresh', id_token: 'idt' } })),
    verifyIdToken: jest.fn(async () => ({ getPayload: () => ({ email: 'agent@nitro.test' }) })),
};
jest.mock('../../config/gmail', () => ({
    createOAuth2Client: () => oauthClient,
    getAccessTokenForRefreshToken: (...args: unknown[]) => getAccessTokenForRefreshToken(...args),
    getGoogleOAuthClientId: () => 'client-A',
    invalidateAccessTokenCache: jest.fn(),
    isGoogleOAuthConfigured: () => true,
    isTokenFromCurrentClient: (stored: string | null) => !stored || stored === 'client-A',
}));
jest.mock('../../utils/crmFrontendUrl', () => ({ resolveCrmFrontendBaseUrl: () => 'https://crm.test' }));

import jwt from 'jsonwebtoken';
import { buildGmailConnectUrl, completeGmailConnect, getGmailAccessTokenForUser, getGmailConnectionStatus } from './gmailOAuthService';
import { decryptRefreshToken, encryptRefreshToken, isEncryptedToken } from './gmailTokenCrypto';

beforeEach(() => {
    users.clear();
    jest.clearAllMocks();
    getAccessTokenForRefreshToken.mockResolvedValue('ya29.access');
});

describe('per-user Gmail token storage', () => {
    it('stores the token encrypted together with the minting client id', async () => {
        users.set('u1', { id: 'u1' });
        const state = new URL(buildGmailConnectUrl('u1', '/user-setting?tab=email')).searchParams.get('state');
        const redirect = await completeGmailConnect('code', state);
        expect(new URL(redirect).searchParams.get('gmail')).toBe('connected');
        const row = users.get('u1');
        expect(isEncryptedToken(row.googleRefreshToken)).toBe(true);
        expect(row.googleRefreshToken).not.toContain('1//new-refresh');
        expect(decryptRefreshToken(row.googleRefreshToken)).toBe('1//new-refresh');
        expect(row.googleOAuthClientId).toBe('client-A');
    });

    it('re-encrypts a legacy plain-text token on first use and refreshes with the plain value', async () => {
        users.set('u2', { id: 'u2', googleRefreshToken: '1//legacy-plain', googleOAuthClientId: null });
        await expect(getGmailAccessTokenForUser('u2')).resolves.toBe('ya29.access');
        expect(getAccessTokenForRefreshToken).toHaveBeenCalledWith('1//legacy-plain', 'user:u2');
        expect(isEncryptedToken(users.get('u2').googleRefreshToken)).toBe(true);
        expect(decryptRefreshToken(users.get('u2').googleRefreshToken)).toBe('1//legacy-plain');
    });

    it('uses an encrypted token without rewriting it', async () => {
        const stored = encryptRefreshToken('1//enc-token');
        users.set('u3', { id: 'u3', googleRefreshToken: stored, googleOAuthClientId: 'client-A' });
        await getGmailAccessTokenForUser('u3');
        expect(getAccessTokenForRefreshToken).toHaveBeenCalledWith('1//enc-token', 'user:u3');
        expect(users.get('u3').googleRefreshToken).toBe(stored);
    });

    it('treats a token minted by another OAuth client as needing reconnect', async () => {
        users.set('u4', { id: 'u4', googleRefreshToken: encryptRefreshToken('1//old'), googleOAuthClientId: 'client-OLD', googleEmail: 'a@x' });
        await expect(getGmailAccessTokenForUser('u4')).resolves.toBeNull();
        expect(getAccessTokenForRefreshToken).not.toHaveBeenCalled();
        await expect(getGmailConnectionStatus('u4')).resolves.toMatchObject({ connected: true, needsReconnect: true });
    });

    it('rejects a callback whose state was minted for a funder connection', async () => {
        const funderState = jwt.sign({ p: 'funder_gmail_connect', uid: 'u1', fid: 'f1' }, 'unit-test-jwt');
        const redirect = await completeGmailConnect('code', funderState);
        expect(new URL(redirect).searchParams.get('reason')).toBe('invalid_state');
        expect(oauthClient.getToken).not.toHaveBeenCalled();
    });
});
