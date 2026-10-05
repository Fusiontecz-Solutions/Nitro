import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * OAuth redirect registered in Google Cloud Console. Must point at this backend's
 * `GET /api/v1/google/callback`. Set GOOGLE_REDIRECT_URI in every deployed environment.
 */
export function getRedirectUri(): string {
  const configured = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const port = process.env.PORT || '4000';
  return `http://localhost:${port}/api/v1/google/callback`;
}

/** True when Google OAuth client credentials are present (Gmail connect is available). */
export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    String(process.env.GOOGLE_CLIENT_ID || '').trim() &&
      String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  );
}

/** Create a fresh OAuth2 client — never share instances across users or cron ticks. */
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    getRedirectUri(),
  );
}

type CachedAccessToken = { token: string; expiresAt: number };

/** Reuse short-lived access tokens per user to avoid parallel refresh storms. */
const accessTokenCache = new Map<string, CachedAccessToken>();
const TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;

/** Avoid spamming the same invalid_grant warn on every cron tick. */
const invalidGrantWarned = new Set<string>();

function getOAuthErrorCode(error: unknown): string | undefined {
  const err = error as {
    response?: { data?: { error?: string } };
    code?: string | number;
    message?: string;
  };
  return (
    err?.response?.data?.error ||
    (typeof err?.code === 'string' ? err.code : undefined) ||
    undefined
  );
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const code = getOAuthErrorCode(error);
  if (code) return code;
  return 'unknown error';
}

export function invalidateAccessTokenCache(cacheKey?: string): void {
  if (cacheKey) {
    accessTokenCache.delete(cacheKey);
    invalidGrantWarned.delete(cacheKey);
    return;
  }
  accessTokenCache.clear();
  invalidGrantWarned.clear();
}

/** Mint a short-lived access token using an isolated client (safe for concurrent use). */
export async function getAccessTokenForRefreshToken(
  refreshToken: string,
  cacheKey?: string,
): Promise<string | null> {
  if (cacheKey) {
    const cached = accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
  }

  const client = createOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken.trim() });
  try {
    const response = await client.getAccessToken();
    const token = response?.token ?? null;

    if (cacheKey && token) {
      accessTokenCache.set(cacheKey, {
        token,
        expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
      });
      invalidGrantWarned.delete(cacheKey);
    }

    return token;
  } catch (error: unknown) {
    if (cacheKey) {
      accessTokenCache.delete(cacheKey);
    }

    const oauthError = getOAuthErrorCode(error);
    if (oauthError === 'invalid_grant') {
      const key = cacheKey || 'unknown';
      if (!invalidGrantWarned.has(key)) {
        invalidGrantWarned.add(key);
        console.warn(
          `[gmail] refresh token invalid for cacheKey=${key}; reconnect Google to restore inbox sync`,
        );
      }
      // Dead refresh tokens are expected until reconnect — don't throw GaxiosError (leaks tokens in logs).
      return null;
    }

    throw new Error(`[gmail] access token refresh failed: ${getSafeErrorMessage(error)}`);
  }
}
