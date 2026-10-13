/**
 * Per-user Gmail connection (Google OAuth, offline access).
 *
 * Unlike the Katan callback (which matched the Google address to a CRM user by
 * email and never checked `state`), the connect URL here is minted for the
 * signed-in user: `state` is a short-lived signed JWT carrying their user id, so
 * the callback always attaches the mailbox to the user who started the flow.
 */
import jwt from 'jsonwebtoken';
import prisma from '../../config/prismaClient';
import {
    createOAuth2Client,
    getAccessTokenForRefreshToken,
    getGoogleOAuthClientId,
    invalidateAccessTokenCache,
    isGoogleOAuthConfigured,
    isTokenFromCurrentClient,
} from '../../config/gmail';
import { resolveCrmFrontendBaseUrl } from '../../utils/crmFrontendUrl';
import { decryptRefreshToken, encryptRefreshToken, isEncryptedToken } from './gmailTokenCrypto';

const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

export const GMAIL_OAUTH_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.send',
    // Read access is needed to fetch the Message-ID of sent mail (threading) and the ISO's replies.
    'https://www.googleapis.com/auth/gmail.readonly',
    // Gmail workspace page: labels / star / archive / trash (modify) and drafts (compose).
    GMAIL_MODIFY_SCOPE,
    'https://www.googleapis.com/auth/gmail.compose',
];

const STATE_PURPOSE = 'gmail_connect';
const STATE_TTL = '15m';

/**
 * Google OAuth `state` purposes sharing GET /api/v1/google/callback. Each flow
 * signs its own purpose so a state minted for one can never complete another.
 */
export const OAUTH_STATE_PURPOSES = { userGmail: STATE_PURPOSE, funderGmail: 'funder_gmail_connect' } as const;

/** Purpose of a signed callback state, or null when it is missing / forged / expired. */
export function readOAuthStatePurpose(state: unknown): string | null {
    try {
        const decoded = jwt.verify(String(state ?? ''), jwtSecret()) as { p?: string };
        return typeof decoded?.p === 'string' ? decoded.p : null;
    } catch {
        return null;
    }
}

export class GmailNotConnectedError extends Error {
    readonly code = 'GMAIL_NOT_CONNECTED';
    constructor(message = 'Connect your Gmail account before sending this email.') {
        super(message);
    }
}

const tokenCacheKey = (userId: string) => `user:${userId}`;

function jwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return secret;
}

/** Only allow in-app return paths (open-redirect safe). */
export function safeReturnPath(raw: unknown, fallback = '/user-setting?tab=email'): string {
    const path = String(raw ?? '').trim();
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback;
    return path;
}

/** Sign a short-lived callback state for one OAuth purpose. */
export function signOAuthState(payload: Record<string, unknown> & { p: string }): string {
    return jwt.sign(payload, jwtSecret(), { expiresIn: STATE_TTL });
}

/** Verify a callback state minted for `purpose`; null when invalid, expired or for another flow. */
export function verifyOAuthState<T extends Record<string, unknown>>(state: unknown, purpose: string): (T & { p: string }) | null {
    try {
        const decoded = jwt.verify(String(state ?? ''), jwtSecret()) as T & { p?: string };
        return decoded?.p === purpose ? (decoded as T & { p: string }) : null;
    } catch {
        return null;
    }
}

export function buildGmailConnectUrl(userId: string, returnPath?: string): string {
    if (!isGoogleOAuthConfigured()) {
        throw new Error('Gmail connection is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).');
    }
    const state = jwt.sign(
        { uid: userId, p: STATE_PURPOSE, r: safeReturnPath(returnPath) },
        jwtSecret(),
        { expiresIn: STATE_TTL },
    );
    return createOAuth2Client().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        scope: GMAIL_OAUTH_SCOPES,
        state,
    });
}

export function frontendRedirect(returnPath: string, params: Record<string, string>): string {
    const base = (resolveCrmFrontendBaseUrl() || '').replace(/\/+$/, '');
    const [path, query = ''] = safeReturnPath(returnPath, '/').split('?');
    const search = new URLSearchParams(query);
    for (const [k, v] of Object.entries(params)) search.set(k, v);
    return `${base}${path}?${search.toString()}`;
}

/** Handle Google's redirect. Returns the frontend URL to send the browser to. */
export async function completeGmailConnect(code: unknown, state: unknown, oauthError?: unknown): Promise<string> {
    let userId = '';
    let returnPath = '/user-setting?tab=email';
    try {
        const decoded = jwt.verify(String(state ?? ''), jwtSecret()) as { uid?: string; p?: string; r?: string };
        if (decoded?.p !== STATE_PURPOSE || !decoded.uid) throw new Error('bad state');
        userId = decoded.uid;
        returnPath = safeReturnPath(decoded.r);
    } catch {
        return frontendRedirect(returnPath, { gmail: 'error', reason: 'invalid_state' });
    }

    if (oauthError) {
        return frontendRedirect(returnPath, { gmail: 'error', reason: String(oauthError).slice(0, 64) });
    }
    if (!code) {
        return frontendRedirect(returnPath, { gmail: 'error', reason: 'missing_code' });
    }

    try {
        const client = createOAuth2Client();
        const { tokens } = await client.getToken(String(code));
        const refreshToken = String(tokens.refresh_token ?? '').trim();
        if (!refreshToken) {
            return frontendRedirect(returnPath, { gmail: 'error', reason: 'no_refresh_token' });
        }

        let googleEmail = '';
        if (tokens.id_token) {
            try {
                const ticket = await client.verifyIdToken({
                    idToken: tokens.id_token,
                    audience: process.env.GOOGLE_CLIENT_ID,
                });
                googleEmail = String(ticket.getPayload()?.email ?? '').trim().toLowerCase();
            } catch (err) {
                console.warn('[gmail-connect] id_token verification failed:', (err as Error)?.message);
            }
        }

        await prisma.user.update({
            where: { id: userId },
            data: {
                googleRefreshToken: encryptRefreshToken(refreshToken),
                googleOAuthClientId: getGoogleOAuthClientId() || null,
                googleEmail: googleEmail || null,
                googleConnectedAt: new Date(),
            },
        });
        invalidateAccessTokenCache(tokenCacheKey(userId));
        return frontendRedirect(returnPath, { gmail: 'connected' });
    } catch (err) {
        console.error('[gmail-connect] token exchange failed:', (err as Error)?.message);
        return frontendRedirect(returnPath, { gmail: 'error', reason: 'token_exchange_failed' });
    }
}

export interface GmailConnectionStatus {
    configured: boolean;
    connected: boolean;
    gmailEmail: string | null;
    connectedAt: Date | null;
    needsReconnect: boolean;
    /**
     * Whether the grant covers the Gmail workspace page (modify scope). Null when not probed.
     * Mailboxes connected before the page existed only have send/readonly and must reconnect.
     */
    mailboxAccess: boolean | null;
}

export async function getGmailConnectionStatus(userId: string, probe = false): Promise<GmailConnectionStatus> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { googleRefreshToken: true, googleOAuthClientId: true, googleEmail: true, googleConnectedAt: true },
    });
    const connected = Boolean(user?.googleRefreshToken);
    let needsReconnect = connected && !isTokenFromCurrentClient(user?.googleOAuthClientId);
    let mailboxAccess: boolean | null = null;
    if (connected && probe && !needsReconnect) {
        const accessToken = await getGmailAccessTokenForUser(userId).catch(() => null);
        needsReconnect = !accessToken;
        if (accessToken) {
            try {
                const info = await createOAuth2Client().getTokenInfo(accessToken);
                mailboxAccess = (info.scopes ?? []).includes(GMAIL_MODIFY_SCOPE);
            } catch (err) {
                console.warn('[gmail-connect] token scope lookup failed:', (err as Error)?.message);
            }
        }
    }
    return {
        configured: isGoogleOAuthConfigured(),
        connected,
        gmailEmail: user?.googleEmail ?? null,
        connectedAt: user?.googleConnectedAt ?? null,
        needsReconnect,
        mailboxAccess,
    };
}

/**
 * Revoking any token revokes the whole Google grant (account + OAuth client), so a
 * mailbox connected both as a user and as a funder must not be revoked while the
 * other connection still uses it — clear the local copy only.
 */
export async function isGoogleGrantSharedElsewhere(
    email: string | null | undefined,
    exclude: { userId?: string; funderMailboxId?: string },
): Promise<boolean> {
    const address = String(email ?? '').trim();
    if (!address) return false;
    const [userCount, funderCount] = await Promise.all([
        prisma.user.count({
            where: {
                googleRefreshToken: { not: null },
                googleEmail: { equals: address, mode: 'insensitive' },
                ...(exclude.userId ? { id: { not: exclude.userId } } : {}),
            },
        }),
        prisma.funderMailbox.count({
            where: {
                refreshTokenEnc: { not: null },
                email: { equals: address, mode: 'insensitive' },
                ...(exclude.funderMailboxId ? { id: { not: exclude.funderMailboxId } } : {}),
            },
        }),
    ]);
    return userCount + funderCount > 0;
}

export async function disconnectGmail(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { googleRefreshToken: true, googleEmail: true },
    });
    const token = decryptRefreshToken(user?.googleRefreshToken);
    const shared = token ? await isGoogleGrantSharedElsewhere(user?.googleEmail, { userId }) : false;
    if (token && !shared) {
        try {
            await createOAuth2Client().revokeToken(token);
        } catch (err) {
            // Token may already be revoked on Google's side — clearing locally is what matters.
            console.warn('[gmail-connect] revoke failed:', (err as Error)?.message);
        }
    }
    await prisma.user.update({
        where: { id: userId },
        data: { googleRefreshToken: null, googleOAuthClientId: null, googleEmail: null, googleConnectedAt: null },
    });
    invalidateAccessTokenCache(tokenCacheKey(userId));
}

/** Short-lived access token for a user's mailbox, or null when not connected / revoked. */
export async function getGmailAccessTokenForUser(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { googleRefreshToken: true, googleOAuthClientId: true },
    });
    const stored = String(user?.googleRefreshToken ?? '').trim();
    if (!stored || !isTokenFromCurrentClient(user?.googleOAuthClientId)) return null;
    const refreshToken = decryptRefreshToken(stored);
    if (!refreshToken) return null;
    if (!isEncryptedToken(stored)) await encryptLegacyUserToken(userId, stored, refreshToken);
    return getAccessTokenForRefreshToken(refreshToken, tokenCacheKey(userId));
}

/** Re-save a legacy plain-text token encrypted (only if it has not changed meanwhile). */
async function encryptLegacyUserToken(userId: string, stored: string, plain: string): Promise<void> {
    try {
        await prisma.user.updateMany({
            where: { id: userId, googleRefreshToken: stored },
            data: { googleRefreshToken: encryptRefreshToken(plain) },
        });
    } catch (err) {
        // FIELD_ENCRYPTION_KEY missing etc. — keep sending; the backfill script reports it.
        console.warn('[gmail-connect] could not encrypt legacy refresh token for user', userId, (err as Error)?.message);
    }
}
