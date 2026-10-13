/**
 * Funder Gmail connection through the shared Google OAuth client and callback.
 */
process.env.JWT_SECRET = 'unit-test-jwt';
process.env.FIELD_ENCRYPTION_KEY = 'unit-test-field-key';

const db = {
    funders: new Map<string, any>(),
    mailboxes: new Map<string, any>(),
    users: new Map<string, any>(),
};

jest.mock('../../config/prismaClient', () => {
    const mailboxByFunder = (funderProfileId: string) => [...db.mailboxes.values()].find((m) => m.funderProfileId === funderProfileId) ?? null;
    return {
        __esModule: true,
        default: {
            funderProfile: {
                findUnique: jest.fn(async ({ where }: any) => db.funders.get(where.id) ?? null),
                update: jest.fn(async ({ where, data }: any) => Object.assign(db.funders.get(where.id), data)),
            },
            funderMailbox: {
                findUnique: jest.fn(async ({ where }: any) => {
                    const row = where.id ? db.mailboxes.get(where.id) : mailboxByFunder(where.funderProfileId);
                    return row ? { ...row, connectedBy: null } : null;
                }),
                upsert: jest.fn(async ({ where, create, update }: any) => {
                    const existing = mailboxByFunder(where.funderProfileId);
                    if (existing) return Object.assign(existing, update);
                    const row = { id: `mb-${db.mailboxes.size + 1}`, ...create };
                    db.mailboxes.set(row.id, row);
                    return row;
                }),
                update: jest.fn(async ({ where, data }: any) => Object.assign(db.mailboxes.get(where.id), data)),
                count: jest.fn(async ({ where }: any) =>
                    [...db.mailboxes.values()].filter(
                        (m) => m.refreshTokenEnc && m.email?.toLowerCase() === where.email.equals.toLowerCase() && m.id !== where.id?.not,
                    ).length,
                ),
            },
            user: {
                findUnique: jest.fn(async ({ where }: any) => db.users.get(where.id) ?? null),
                count: jest.fn(async ({ where }: any) =>
                    [...db.users.values()].filter(
                        (u) => u.googleRefreshToken && u.googleEmail?.toLowerCase() === where.googleEmail.equals.toLowerCase(),
                    ).length,
                ),
            },
            $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
        },
    };
});

const oauthClient = {
    generateAuthUrl: jest.fn((opts: any) => `https://accounts.google.com/o/oauth2/auth?${new URLSearchParams({ ...opts, scope: opts.scope.join(' ') })}`),
    getToken: jest.fn(),
    verifyIdToken: jest.fn(),
    revokeToken: jest.fn(async () => undefined),
};
const getAccessTokenForRefreshToken = jest.fn();
jest.mock('../../config/gmail', () => ({
    createOAuth2Client: () => oauthClient,
    getAccessTokenForRefreshToken: (...args: unknown[]) => getAccessTokenForRefreshToken(...args),
    getGoogleOAuthClientId: () => 'client-A',
    invalidateAccessTokenCache: jest.fn(),
    isGoogleOAuthConfigured: () => true,
    isTokenFromCurrentClient: (stored: string | null) => !stored || stored === 'client-A',
}));
jest.mock('../../utils/crmFrontendUrl', () => ({ resolveCrmFrontendBaseUrl: () => 'https://crm.test' }));
jest.mock('../mailSenderIdentity', () => ({ invalidateSenderDirectoryCache: jest.fn() }));
const axiosGet = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { get: (...args: unknown[]) => axiosGet(...args) } }));

import { buildGmailConnectUrl } from './gmailOAuthService';
import { decryptRefreshToken, isEncryptedToken } from './gmailTokenCrypto';
import {
    assertFunderMailProviderAllowed,
    buildFunderGmailConnectUrl,
    completeFunderGmailConnect,
    disconnectFunderGmail,
    getFunderGmailMailboxForSend,
    getFunderGmailStatus,
    isFunderGmailState,
} from './funderGmailOAuthService';

const GMAIL_SCOPES = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';
const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
const redirectParams = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

function grantSuccess(email = 'deals@tiberian.test') {
    oauthClient.getToken.mockResolvedValue({
        tokens: { refresh_token: '1//refresh-secret', access_token: 'ya29.access', id_token: 'idt', scope: GMAIL_SCOPES },
    });
    oauthClient.verifyIdToken.mockResolvedValue({ getPayload: () => ({ email, email_verified: true }) });
    axiosGet.mockImplementation(async (url: string) =>
        url.endsWith('/profile')
            ? { data: { emailAddress: email } }
            : { data: { sendAs: [{ sendAsEmail: 'funding@tiberian.test', verificationStatus: 'accepted' }] } },
    );
}

beforeEach(() => {
    db.funders.clear();
    db.mailboxes.clear();
    db.users.clear();
    db.funders.set('f1', { id: 'f1', name: 'Tiberian', sendgridFromEmail: 'funding@tiberian.test', mailProvider: 'sendgrid' });
    db.users.set('admin', { id: 'admin', role: 'SUPER_ADMIN', isActive: true });
    db.users.set('agent', { id: 'agent', role: 'AGENT', isActive: true });
    jest.clearAllMocks();
});

describe('connect URL and state', () => {
    it('requests the minimal Gmail scopes for the funder and hints the funder sender', async () => {
        const url = await buildFunderGmailConnectUrl({ funderProfileId: 'f1', userId: 'admin' });
        const opts = oauthClient.generateAuthUrl.mock.calls[0][0];
        expect(opts.scope).toEqual(GMAIL_SCOPES.split(' '));
        expect(opts).toMatchObject({ access_type: 'offline', prompt: 'consent select_account', login_hint: 'funding@tiberian.test' });
        expect(url).not.toMatch(/secret/i);
        expect(isFunderGmailState(stateOf(url))).toBe(true);
    });

    it('never treats a per-user connect state as a funder state', () => {
        const userUrl = buildGmailConnectUrl('admin', '/user-setting?tab=email');
        expect(isFunderGmailState(stateOf(userUrl))).toBe(false);
        expect(isFunderGmailState('forged.jwt.value')).toBe(false);
    });

    it('rejects an unknown funder', async () => {
        await expect(buildFunderGmailConnectUrl({ funderProfileId: 'nope', userId: 'admin' })).rejects.toMatchObject({ status: 404 });
    });
});

describe('callback', () => {
    it('stores an encrypted token, verified status and the Send-as alias', async () => {
        grantSuccess();
        const state = stateOf(await buildFunderGmailConnectUrl({ funderProfileId: 'f1', userId: 'admin' }));
        const redirect = await completeFunderGmailConnect('code-1', state);
        expect(redirectParams(redirect)).toMatchObject({ funderGmail: 'connected', funderId: 'f1', tab: 'funders' });

        const row = [...db.mailboxes.values()][0];
        expect(row).toMatchObject({ email: 'deals@tiberian.test', sendAsEmail: 'funding@tiberian.test', status: 'connected', oauthClientId: 'client-A' });
        expect(isEncryptedToken(row.refreshTokenEnc)).toBe(true);
        expect(row.refreshTokenEnc).not.toContain('1//refresh-secret');
        expect(decryptRefreshToken(row.refreshTokenEnc)).toBe('1//refresh-secret');
        expect(row.verifiedAt).toBeInstanceOf(Date);
    });

    it('rejects a forged state, a user without funder rights and an unchecked Gmail scope', async () => {
        expect(redirectParams(await completeFunderGmailConnect('c', 'forged'))).toMatchObject({ funderGmail: 'error', reason: 'invalid_state' });

        grantSuccess();
        const agentState = stateOf(await buildFunderGmailConnectUrl({ funderProfileId: 'f1', userId: 'agent' }));
        expect(redirectParams(await completeFunderGmailConnect('c', agentState))).toMatchObject({ reason: 'forbidden' });

        oauthClient.getToken.mockResolvedValue({ tokens: { refresh_token: 'r', access_token: 'a', scope: 'openid https://www.googleapis.com/auth/gmail.send' } });
        const state = stateOf(await buildFunderGmailConnectUrl({ funderProfileId: 'f1', userId: 'admin' }));
        expect(redirectParams(await completeFunderGmailConnect('c', state))).toMatchObject({ reason: 'missing_scopes' });
        expect(db.mailboxes.size).toBe(0);
    });

    it('rejects a grant whose Gmail profile is a different account than the id token', async () => {
        grantSuccess('deals@tiberian.test');
        axiosGet.mockImplementation(async () => ({ data: { emailAddress: 'someone-else@test' } }));
        const state = stateOf(await buildFunderGmailConnectUrl({ funderProfileId: 'f1', userId: 'admin' }));
        expect(redirectParams(await completeFunderGmailConnect('c', state))).toMatchObject({ reason: 'account_mismatch' });
    });
});

describe('provider gating, sending and disconnect', () => {
    async function connect() {
        grantSuccess();
        const state = stateOf(await buildFunderGmailConnectUrl({ funderProfileId: 'f1', userId: 'admin' }));
        await completeFunderGmailConnect('code', state);
    }

    it('refuses Gmail as provider until the mailbox is connected and verified', async () => {
        await expect(assertFunderMailProviderAllowed('f1', 'gmail')).rejects.toThrow(/Connect and verify/);
        await expect(assertFunderMailProviderAllowed(null, 'gmail')).rejects.toThrow();
        await expect(assertFunderMailProviderAllowed('f1', 'outlook')).rejects.toThrow(/one of/);
        await connect();
        await expect(assertFunderMailProviderAllowed('f1', 'gmail')).resolves.toBe('gmail');
    });

    it('status never exposes the token', async () => {
        await connect();
        const status = await getFunderGmailStatus('f1');
        expect(status).toMatchObject({ connected: true, canUseGmail: true, gmailEmail: 'deals@tiberian.test', senderMatchesMailbox: true });
        expect(JSON.stringify(status)).not.toMatch(/refresh|enc:v1|1\/\//);
    });

    it('marks the mailbox for reconnect when Google revoked the grant', async () => {
        await connect();
        getAccessTokenForRefreshToken.mockResolvedValueOnce(null);
        await expect(getFunderGmailMailboxForSend('f1')).resolves.toBeNull();
        const status = await getFunderGmailStatus('f1');
        expect(status).toMatchObject({ needsReconnect: true, canUseGmail: false });
    });

    it('returns the alias as From address for sends', async () => {
        await connect();
        getAccessTokenForRefreshToken.mockResolvedValueOnce('ya29.fresh');
        await expect(getFunderGmailMailboxForSend('f1')).resolves.toMatchObject({
            email: 'deals@tiberian.test',
            fromEmail: 'funding@tiberian.test',
            accessToken: 'ya29.fresh',
        });
        expect(getAccessTokenForRefreshToken).toHaveBeenCalledWith('1//refresh-secret', expect.stringMatching(/^funder-mailbox:/));
    });

    it('disconnect clears the credential, resets the provider to SendGrid and revokes the grant', async () => {
        await connect();
        db.funders.get('f1').mailProvider = 'gmail';
        await disconnectFunderGmail('f1');
        expect(oauthClient.revokeToken).toHaveBeenCalledWith('1//refresh-secret');
        expect([...db.mailboxes.values()][0]).toMatchObject({ refreshTokenEnc: null, status: 'disconnected' });
        expect(db.funders.get('f1').mailProvider).toBe('sendgrid');
    });

    it('does not revoke a grant another connection still uses', async () => {
        await connect();
        db.users.set('u2', { id: 'u2', googleRefreshToken: 'enc', googleEmail: 'deals@tiberian.test' });
        await disconnectFunderGmail('f1');
        expect(oauthClient.revokeToken).not.toHaveBeenCalled();
        expect([...db.mailboxes.values()][0].refreshTokenEnc).toBeNull();
    });
});
