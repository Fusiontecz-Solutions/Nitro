/**
 * Funder Gmail connection: one Google mailbox per funder, connected through the
 * same Google OAuth client and the same callback as the per-user connection
 * (GET /api/v1/google/callback). The signed `state` carries purpose
 * `funder_gmail_connect`, the funder id and the admin who started the flow, so
 * the callback can only ever attach the mailbox to that funder.
 *
 * Refresh tokens are encrypted at rest (`FunderMailbox.refreshTokenEnc`) and are
 * never returned by the API or written to logs.
 */
import axios from 'axios';
import prisma from '../../config/prismaClient';
import {
    createOAuth2Client,
    getAccessTokenForRefreshToken,
    getGoogleOAuthClientId,
    invalidateAccessTokenCache,
    isGoogleOAuthConfigured,
    isTokenFromCurrentClient,
} from '../../config/gmail';
import { hasContractsLogAccess } from '../../constants/roles';
import { invalidateSenderDirectoryCache } from '../mailSenderIdentity';
import { decryptRefreshToken, encryptRefreshToken } from './gmailTokenCrypto';
import {
    OAUTH_STATE_PURPOSES,
    frontendRedirect,
    isGoogleGrantSharedElsewhere,
    safeReturnPath,
    signOAuthState,
    verifyOAuthState,
} from './gmailOAuthService';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** Minimal grant: send, plus read for Message-ID read-back, thread history and Send-as aliases. */
export const FUNDER_GMAIL_OAUTH_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    GMAIL_SEND_SCOPE,
    GMAIL_READONLY_SCOPE,
];
const REQUIRED_SCOPES = [GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE];

const DEFAULT_RETURN_PATH = '/user-setting?tab=funders';

export const FUNDER_MAILBOX_STATUS = {
    connected: 'connected',
    needsReconnect: 'needs_reconnect',
    disconnected: 'disconnected',
} as const;

export const MAIL_PROVIDERS = ['sendgrid', 'gmail'] as const;
export type FunderMailProvider = (typeof MAIL_PROVIDERS)[number];

export class FunderGmailError extends Error {
    constructor(
        message: string,
        readonly status = 400,
        readonly code = 'FUNDER_GMAIL_ERROR',
    ) {
        super(message);
        this.name = 'FunderGmailError';
    }
}

const cacheKey = (funderMailboxId: string) => `funder-mailbox:${funderMailboxId}`;
const normalizeEmail = (v: unknown) => String(v ?? '').trim().toLowerCase();

/** Errors stored on the row / shown in the UI: short, and never a token. */
function safeErrorText(error: unknown): string {
    const err = error as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
    const data = err?.response?.data?.error;
    const raw = (typeof data === 'string' ? data : data?.message) || err?.message || 'unknown error';
    return String(raw).replace(/ya29\.[\w.-]+|1\/\/[\w.-]+/g, '[redacted]').slice(0, 300);
}

async function requireFunder(funderProfileId: string) {
    const funder = await prisma.funderProfile.findUnique({
        where: { id: funderProfileId },
        select: { id: true, name: true, displayName: true, sendgridFromEmail: true, mailProvider: true },
    });
    if (!funder) throw new FunderGmailError('Funder not found', 404, 'FUNDER_NOT_FOUND');
    return funder;
}

/** Same rule as the funder settings routes (requireSuperAdmin): CONTRACTS_LOG or SUPER_ADMIN. */
async function userMayManageFunders(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
    return Boolean(user?.isActive) && hasContractsLogAccess(user?.role);
}

// ---------------------------------------------------------------------------
// Connect / callback
// ---------------------------------------------------------------------------

export async function buildFunderGmailConnectUrl(input: {
    funderProfileId: string;
    userId: string;
    returnPath?: string;
}): Promise<string> {
    if (!isGoogleOAuthConfigured()) {
        throw new FunderGmailError(
            'Gmail connection is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
            503,
            'GMAIL_NOT_CONFIGURED',
        );
    }
    const funder = await requireFunder(input.funderProfileId);
    const existing = await prisma.funderMailbox.findUnique({
        where: { funderProfileId: funder.id },
        select: { email: true },
    });
    const state = signOAuthState({
        p: OAUTH_STATE_PURPOSES.funderGmail,
        uid: input.userId,
        fid: funder.id,
        r: safeReturnPath(input.returnPath, DEFAULT_RETURN_PATH),
    });
    const loginHint = normalizeEmail(existing?.email || funder.sendgridFromEmail);
    return createOAuth2Client().generateAuthUrl({
        access_type: 'offline',
        // select_account: the admin is usually signed in to their own Google account,
        // not the funder's. consent: guarantees a refresh token on every connect.
        prompt: 'consent select_account',
        include_granted_scopes: false,
        scope: FUNDER_GMAIL_OAUTH_SCOPES,
        state,
        ...(loginHint ? { login_hint: loginHint } : {}),
    });
}

/** True when `state` was minted by {@link buildFunderGmailConnectUrl}. */
export function isFunderGmailState(state: unknown): boolean {
    return Boolean(verifyOAuthState(state, OAUTH_STATE_PURPOSES.funderGmail));
}

async function fetchGmailProfileEmail(accessToken: string): Promise<string> {
    const response = await axios.get(`${GMAIL_API}/profile`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 20_000,
    });
    return normalizeEmail(response.data?.emailAddress);
}

/** The funder's sender address when it is the mailbox itself or a verified Send-as alias. */
async function resolveSendAsEmail(accessToken: string, mailboxEmail: string, senderEmail: string | null): Promise<string | null> {
    const wanted = normalizeEmail(senderEmail);
    if (!wanted) return null;
    if (wanted === mailboxEmail) return mailboxEmail;
    try {
        const response = await axios.get(`${GMAIL_API}/settings/sendAs`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 20_000,
        });
        const aliases: Array<{ sendAsEmail?: string; verificationStatus?: string; isPrimary?: boolean }> =
            response.data?.sendAs ?? [];
        const match = aliases.find(
            (a) => normalizeEmail(a.sendAsEmail) === wanted && (a.isPrimary || a.verificationStatus === 'accepted'),
        );
        return match ? wanted : null;
    } catch (err) {
        console.warn('[funder-gmail] Send-as lookup failed:', safeErrorText(err));
        return null;
    }
}

/** Handle Google's redirect for a funder connection. Returns the frontend URL to redirect to. */
export async function completeFunderGmailConnect(code: unknown, state: unknown, oauthError?: unknown): Promise<string> {
    const decoded = verifyOAuthState<{ uid?: string; fid?: string; r?: string }>(state, OAUTH_STATE_PURPOSES.funderGmail);
    const returnPath = safeReturnPath(decoded?.r, DEFAULT_RETURN_PATH);
    const fail = (reason: string, funderId?: string) =>
        frontendRedirect(returnPath, { funderGmail: 'error', reason, ...(funderId ? { funderId } : {}) });

    if (!decoded?.uid || !decoded.fid) return fail('invalid_state');
    const funderId = decoded.fid;
    if (oauthError) return fail(String(oauthError).replace(/[^\w-]/g, '').slice(0, 64) || 'oauth_error', funderId);
    if (!code) return fail('missing_code', funderId);

    try {
        if (!(await userMayManageFunders(decoded.uid))) return fail('forbidden', funderId);
        const funder = await requireFunder(funderId);

        const client = createOAuth2Client();
        const { tokens } = await client.getToken(String(code));
        const refreshToken = String(tokens.refresh_token ?? '').trim();
        if (!refreshToken) return fail('no_refresh_token', funderId);

        const granted = String(tokens.scope ?? '').split(/\s+/).filter(Boolean);
        if (!REQUIRED_SCOPES.every((s) => granted.includes(s))) {
            // The consent screen lets the admin untick Gmail permissions.
            return fail('missing_scopes', funderId);
        }

        let idTokenEmail = '';
        if (tokens.id_token) {
            const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: getGoogleOAuthClientId() });
            const payload = ticket.getPayload();
            if (payload?.email_verified === false) return fail('email_not_verified', funderId);
            idTokenEmail = normalizeEmail(payload?.email);
        }

        // Verify the grant actually works for Gmail before storing it.
        const accessToken = String(tokens.access_token ?? '');
        const profileEmail = accessToken ? await fetchGmailProfileEmail(accessToken) : '';
        const mailboxEmail = profileEmail || idTokenEmail;
        if (!mailboxEmail) return fail('profile_unavailable', funderId);
        if (idTokenEmail && profileEmail && idTokenEmail !== profileEmail) return fail('account_mismatch', funderId);
        const sendAsEmail = await resolveSendAsEmail(accessToken, mailboxEmail, funder.sendgridFromEmail);

        const previous = await prisma.funderMailbox.findUnique({ where: { funderProfileId: funder.id } });
        const now = new Date();
        const data = {
            provider: 'gmail',
            email: mailboxEmail,
            sendAsEmail,
            refreshTokenEnc: encryptRefreshToken(refreshToken),
            oauthClientId: getGoogleOAuthClientId() || null,
            scopes: granted,
            status: FUNDER_MAILBOX_STATUS.connected,
            verifiedAt: now,
            connectedById: decoded.uid,
            connectedAt: now,
            lastError: null,
            lastErrorAt: null,
        };
        const saved = await prisma.funderMailbox.upsert({
            where: { funderProfileId: funder.id },
            create: { funderProfileId: funder.id, ...data },
            update: data,
        });
        invalidateAccessTokenCache(cacheKey(saved.id));

        // A different Google account replaced the old one: revoke the old grant
        // (same account → same grant; revoking would kill the new token too).
        if (previous?.refreshTokenEnc && normalizeEmail(previous.email) !== mailboxEmail) {
            await revokeQuietly(previous.refreshTokenEnc, previous.email, saved.id);
        }
        console.info(`[funder-gmail] connected funder=${funder.id} mailbox=${mailboxEmail}`);
        return frontendRedirect(returnPath, { funderGmail: 'connected', funderId });
    } catch (err) {
        if (err instanceof FunderGmailError) return fail(err.code.toLowerCase(), funderId);
        console.error('[funder-gmail] connect failed:', safeErrorText(err));
        return fail('token_exchange_failed', funderId);
    }
}

async function revokeQuietly(storedToken: string, email: string | null, excludeFunderMailboxId: string): Promise<void> {
    const plain = decryptRefreshToken(storedToken);
    if (!plain) return;
    if (await isGoogleGrantSharedElsewhere(email, { funderMailboxId: excludeFunderMailboxId })) return;
    try {
        await createOAuth2Client().revokeToken(plain);
    } catch (err) {
        console.warn('[funder-gmail] revoke failed:', safeErrorText(err));
    }
}

// ---------------------------------------------------------------------------
// Status / verify / disconnect
// ---------------------------------------------------------------------------

export interface FunderGmailStatus {
    configured: boolean;
    funderProfileId: string;
    mailProvider: string;
    status: string;
    connected: boolean;
    needsReconnect: boolean;
    /** True when Gmail may be selected as this funder's provider. */
    canUseGmail: boolean;
    gmailEmail: string | null;
    /** Address mail goes out as (verified Send-as alias, else the mailbox itself). */
    sendAsEmail: string | null;
    /** Funder's configured sender address (SendGrid From Email). */
    senderEmail: string | null;
    /** False when the funder's sender address is neither the mailbox nor a verified alias. */
    senderMatchesMailbox: boolean | null;
    verifiedAt: Date | null;
    connectedAt: Date | null;
    connectedBy: string | null;
    lastUsedAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
}

export async function getFunderGmailStatus(funderProfileId: string, options?: { probe?: boolean }): Promise<FunderGmailStatus> {
    const funder = await requireFunder(funderProfileId);
    if (options?.probe) await verifyFunderMailbox(funder.id).catch(() => undefined);
    const mailbox = await prisma.funderMailbox.findUnique({
        where: { funderProfileId: funder.id },
        include: { connectedBy: { select: { firstName: true, lastName: true, email: true } } },
    });
    const hasToken = Boolean(mailbox?.refreshTokenEnc);
    const clientOk = isTokenFromCurrentClient(mailbox?.oauthClientId);
    const status = !mailbox
        ? FUNDER_MAILBOX_STATUS.disconnected
        : hasToken && !clientOk
          ? FUNDER_MAILBOX_STATUS.needsReconnect
          : mailbox.status;
    const connected = hasToken && status === FUNDER_MAILBOX_STATUS.connected;
    const senderEmail = funder.sendgridFromEmail?.trim() || null;
    const who = mailbox?.connectedBy;
    return {
        configured: isGoogleOAuthConfigured(),
        funderProfileId: funder.id,
        mailProvider: funder.mailProvider,
        status,
        connected,
        needsReconnect: status === FUNDER_MAILBOX_STATUS.needsReconnect,
        canUseGmail: connected && Boolean(mailbox?.verifiedAt),
        gmailEmail: mailbox?.email ?? null,
        sendAsEmail: mailbox?.sendAsEmail ?? null,
        senderEmail,
        senderMatchesMailbox: connected && senderEmail ? Boolean(mailbox?.sendAsEmail) : null,
        verifiedAt: mailbox?.verifiedAt ?? null,
        connectedAt: mailbox?.connectedAt ?? null,
        connectedBy: who ? [who.firstName, who.lastName].filter(Boolean).join(' ') || who.email : null,
        lastUsedAt: mailbox?.lastUsedAt ?? null,
        lastError: mailbox?.lastError ?? null,
        lastErrorAt: mailbox?.lastErrorAt ?? null,
    };
}

/** Live check: refresh the token and read the Gmail profile. Updates verifiedAt / status. */
export async function verifyFunderMailbox(funderProfileId: string): Promise<boolean> {
    const mailbox = await prisma.funderMailbox.findUnique({ where: { funderProfileId } });
    if (!mailbox?.refreshTokenEnc) return false;
    try {
        const resolved = await getFunderGmailMailboxForSend(funderProfileId, { forceRefresh: true });
        if (!resolved) return false;
        const profileEmail = await fetchGmailProfileEmail(resolved.accessToken);
        if (mailbox.email && profileEmail && profileEmail !== normalizeEmail(mailbox.email)) {
            await markFunderMailboxNeedsReconnect(mailbox.id, 'Mailbox address changed — reconnect');
            return false;
        }
        await prisma.funderMailbox.update({
            where: { id: mailbox.id },
            data: { status: FUNDER_MAILBOX_STATUS.connected, verifiedAt: new Date(), lastError: null, lastErrorAt: null },
        });
        return true;
    } catch (err) {
        await recordFunderMailboxError(mailbox.id, safeErrorText(err));
        return false;
    }
}

export async function disconnectFunderGmail(funderProfileId: string): Promise<void> {
    const funder = await requireFunder(funderProfileId);
    const mailbox = await prisma.funderMailbox.findUnique({ where: { funderProfileId: funder.id } });
    if (mailbox?.refreshTokenEnc) await revokeQuietly(mailbox.refreshTokenEnc, mailbox.email, mailbox.id);
    await prisma.$transaction([
        // Keep the row (thread ownership history); drop the credential.
        ...(mailbox
            ? [
                  prisma.funderMailbox.update({
                      where: { id: mailbox.id },
                      data: {
                          refreshTokenEnc: null,
                          status: FUNDER_MAILBOX_STATUS.disconnected,
                          verifiedAt: null,
                          sendAsEmail: null,
                          scopes: [],
                      },
                  }),
              ]
            : []),
        // A funder cannot stay on Gmail without a mailbox — back to the default provider.
        prisma.funderProfile.update({ where: { id: funder.id }, data: { mailProvider: 'sendgrid' } }),
    ]);
    if (mailbox) invalidateAccessTokenCache(cacheKey(mailbox.id));
    invalidateSenderDirectoryCache();
    console.info(`[funder-gmail] disconnected funder=${funder.id}`);
}

/**
 * Validate a provider change requested through the funder form. Gmail requires a
 * connected, verified mailbox; throws {@link FunderGmailError} otherwise.
 */
export async function assertFunderMailProviderAllowed(funderProfileId: string | null, provider: unknown): Promise<FunderMailProvider> {
    const value = String(provider ?? '').trim().toLowerCase();
    if (!(MAIL_PROVIDERS as readonly string[]).includes(value)) {
        throw new FunderGmailError(`Mail provider must be one of: ${MAIL_PROVIDERS.join(', ')}`);
    }
    if (value === 'gmail') {
        if (!funderProfileId) throw new FunderGmailError('Save the funder and connect its Gmail account before switching to Gmail.');
        const status = await getFunderGmailStatus(funderProfileId);
        if (!status.canUseGmail) {
            throw new FunderGmailError('Connect and verify this funder\'s Gmail account before switching its provider to Gmail.');
        }
    }
    return value as FunderMailProvider;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface FunderGmailMailbox {
    email: string;
    accessToken: string;
    userId: null;
    funderMailboxId: string;
    funderProfileId: string;
    /** From address: verified Send-as alias, else the mailbox address. */
    fromEmail: string;
}

/**
 * Access token for a funder's mailbox, or null when it is not connected, needs
 * reconnecting, or its grant was revoked (status is updated so the UI shows it).
 * Throws only on transient refresh failures — nothing was sent in either case.
 */
export async function getFunderGmailMailboxForSend(
    funderProfileId: string,
    options?: { forceRefresh?: boolean },
): Promise<FunderGmailMailbox | null> {
    const mailbox = await prisma.funderMailbox.findUnique({ where: { funderProfileId } });
    if (!mailbox?.refreshTokenEnc || !mailbox.email || mailbox.status === FUNDER_MAILBOX_STATUS.disconnected) return null;
    if (!isTokenFromCurrentClient(mailbox.oauthClientId)) {
        await markFunderMailboxNeedsReconnect(mailbox.id, 'Google OAuth client changed — reconnect this mailbox');
        return null;
    }
    const refreshToken = decryptRefreshToken(mailbox.refreshTokenEnc);
    if (!refreshToken) {
        await markFunderMailboxNeedsReconnect(mailbox.id, 'Stored token could not be decrypted — reconnect this mailbox');
        return null;
    }
    if (options?.forceRefresh) invalidateAccessTokenCache(cacheKey(mailbox.id));
    const accessToken = await getAccessTokenForRefreshToken(refreshToken, cacheKey(mailbox.id));
    if (!accessToken) {
        await markFunderMailboxNeedsReconnect(mailbox.id, 'Google access was revoked or expired — reconnect this mailbox');
        return null;
    }
    if (mailbox.status !== FUNDER_MAILBOX_STATUS.connected) {
        await prisma.funderMailbox
            .update({ where: { id: mailbox.id }, data: { status: FUNDER_MAILBOX_STATUS.connected } })
            .catch(() => undefined);
    }
    const email = normalizeEmail(mailbox.email);
    return {
        email,
        accessToken,
        userId: null,
        funderMailboxId: mailbox.id,
        funderProfileId,
        fromEmail: normalizeEmail(mailbox.sendAsEmail) || email,
    };
}

export async function markFunderMailboxNeedsReconnect(funderMailboxId: string, reason: string): Promise<void> {
    invalidateAccessTokenCache(cacheKey(funderMailboxId));
    await prisma.funderMailbox
        .update({
            where: { id: funderMailboxId },
            data: { status: FUNDER_MAILBOX_STATUS.needsReconnect, lastError: reason.slice(0, 300), lastErrorAt: new Date() },
        })
        .catch(() => undefined);
}

export async function recordFunderMailboxError(funderMailboxId: string, message: string): Promise<void> {
    await prisma.funderMailbox
        .update({ where: { id: funderMailboxId }, data: { lastError: message.slice(0, 300), lastErrorAt: new Date() } })
        .catch(() => undefined);
}

export function markFunderMailboxUsed(funderMailboxId: string): void {
    void prisma.funderMailbox
        .update({ where: { id: funderMailboxId }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
}
