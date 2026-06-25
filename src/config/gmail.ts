import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

function getRedirectUri(): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    'https://www.katan.finexusai.com/backend/api/v1'
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
  client.setCredentials({ refresh_token: refreshToken });
  const response = await client.getAccessToken();
  const token = response?.token ?? null;

  if (cacheKey && token) {
    accessTokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
    });
  }

  return token;
}
