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
    invalidateAccessTokenCache,
    isGoogleOAuthConfigured,
} from '../../config/gmail';
import { resolveCrmFrontendBaseUrl } from '../../utils/crmFrontendUrl';

export const GMAIL_OAUTH_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.send',
    // Read access is needed to fetch the Message-ID of sent mail (threading) and the ISO's replies.
    'https://www.googleapis.com/auth/gmail.readonly',
];

const STATE_PURPOSE = 'gmail_connect';
const STATE_TTL = '15m';

export class GmailNotConnectedError extends Error {
    readonly code = 'GMAIL_NOT_CONNECTED';
    constructor(message = 'Connect your Gmail account before sending this email.') {
        super(message);
    }
}

const tokenCacheKey = (userId: string) => `user:${userId}`;

const jwtSecret = (): string => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return secret;
};

/** Only allow in-app return paths (open-redirect safe). */
const safeReturnPath = (raw: unknown): string => {
    const path = String(raw ?? '').trim();
    if (!path.startsWith('/') || path.startsWith('//')) return '/user-setting?tab=email';
    return path;
};

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

function frontendRedirect(returnPath: string, params: Record<string, string>): string {
    const base = (resolveCrmFrontendBaseUrl() || '').replace(/\/+$/, '');
    const [path, query = ''] = safeReturnPath(returnPath).split('?');
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
                googleRefreshToken: refreshToken,
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
}

export async function getGmailConnectionStatus(userId: string, probe = false): Promise<GmailConnectionStatus> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { googleRefreshToken: true, googleEmail: true, googleConnectedAt: true },
    });
    const connected = Boolean(user?.googleRefreshToken);
    let needsReconnect = false;
    if (connected && probe) {
        needsReconnect = !(await getGmailAccessTokenForUser(userId).catch(() => null));
    }
    return {
        configured: isGoogleOAuthConfigured(),
        connected,
        gmailEmail: user?.googleEmail ?? null,
        connectedAt: user?.googleConnectedAt ?? null,
        needsReconnect,
    };
}

export async function disconnectGmail(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleRefreshToken: true } });
    const token = String(user?.googleRefreshToken ?? '').trim();
    if (token) {
        try {
            await createOAuth2Client().revokeToken(token);
        } catch (err) {
            // Token may already be revoked on Google's side — clearing locally is what matters.
            console.warn('[gmail-connect] revoke failed:', (err as Error)?.message);
        }
    }
    await prisma.user.update({
        where: { id: userId },
        data: { googleRefreshToken: null, googleEmail: null, googleConnectedAt: null },
    });
    invalidateAccessTokenCache(tokenCacheKey(userId));
}

/** Short-lived access token for a user's mailbox, or null when not connected / revoked. */
export async function getGmailAccessTokenForUser(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleRefreshToken: true } });
    const refreshToken = String(user?.googleRefreshToken ?? '').trim();
    if (!refreshToken) return null;
    return getAccessTokenForRefreshToken(refreshToken, tokenCacheKey(userId));
}
