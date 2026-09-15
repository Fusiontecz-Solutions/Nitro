import axios, { type AxiosInstance } from '../../../types/http';
import {
  countSignNowApiCall,
  getSignNowTiming,
  logSignNowTiming,
} from './signnow-timing';

export const SIGNNOW_API_BASE = (
  process.env.SIGNNOW_API_BASE_URL ||
  process.env.SIGNNOW_BASE_URL ||
  'https://api.signnow.com'
).replace(/\/$/, '');

export const SIGNNOW_APP_ORIGIN = (
  process.env.SIGNNOW_APP_ORIGIN || 'https://app.signnow.com'
).replace(/\/$/, '');

export const SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID = String(
  process.env.SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID || '',
).trim();

const TOKEN_SKEW_MS = 60_000;

let cachedToken: { accessToken: string; expiresAt: number } | null = null;
let inflightToken: Promise<string> | null = null;

function signNowApiKey(): string {
  return String(
    process.env.SIGNNOW_API_KEY || process.env.SIGNNOW_ACCESS_TOKEN || '',
  ).trim();
}

function signNowBasicToken(): string {
  const clientId = String(process.env.SIGNNOW_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.SIGNNOW_CLIENT_SECRET || '').trim();
  if (clientId && clientSecret) {
    return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  }
  return String(process.env.SIGNNOW_BASIC_AUTH_TOKEN || '').trim();
}

export function isSignNowConfigured(): boolean {
  if (!SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID) return false;
  const username = String(process.env.SIGNNOW_USERNAME || '').trim();
  const password = String(process.env.SIGNNOW_PASSWORD || '');
  if (username && password && signNowBasicToken()) return true;
  return Boolean(signNowApiKey());
}

/** SignNow document / group ids are 40-char hex; DocuSign envelopes are UUIDs. */
export function isSignNowEnvelopeId(value: string | null | undefined): boolean {
  return /^[a-f0-9]{40}$/i.test(String(value || '').trim());
}

/** Extract a 40-char SignNow template/document id from a pasted URL or raw id. */
export function extractSignNowTemplateId(linkOrId?: string | null): string {
  const raw = String(linkOrId ?? '').trim();
  if (!raw) return '';
  if (/^[a-f0-9]{40}$/i.test(raw)) return raw.toLowerCase();
  const match = raw.match(/[a-f0-9]{40}/i);
  return match ? match[0].toLowerCase() : '';
}

export function isSignNowDailyLimitError(detail: string): boolean {
  return /daily document limit exceeded/i.test(String(detail || ''));
}

export const SIGNNOW_DAILY_LIMIT_MESSAGE =
  "SignNow's daily document limit is used up on this account. Each Review copies the contract and every selected addendum. Click Review again to open an existing draft, uncheck addenda you do not need, or try again tomorrow.";

export function signNowDocumentGroupUrl(groupId: string): string {
  return `${SIGNNOW_APP_ORIGIN}/webapp/documentgroup/${String(groupId).trim()}`;
}

export function clearSignNowAccessTokenCache() {
  cachedToken = null;
}

async function fetchOAuthAccessToken(): Promise<string> {
  const basic = signNowBasicToken();
  const username = String(process.env.SIGNNOW_USERNAME || '').trim();
  const password = String(process.env.SIGNNOW_PASSWORD || '');
  if (!basic || !username || !password) {
    throw new Error('SignNow credentials are not configured in .env');
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - TOKEN_SKEW_MS > now) {
    return cachedToken.accessToken;
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    scope: '*',
  });
  if (getSignNowTiming()) countSignNowApiCall();
  const res = await axios.post(`${SIGNNOW_API_BASE}/oauth2/token`, body.toString(), {
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 20_000,
    validateStatus: () => true,
  });
  const token = String(res.data?.access_token || '').trim();
  if (res.status >= 400 || !token) {
    const detail =
      res.data?.error_description || res.data?.error || res.statusText || 'token failed';
    throw new Error(`SignNow authentication failed: ${detail}`);
  }
  const expiresIn = Number(res.data?.expires_in) || 3600;
  cachedToken = {
    accessToken: token,
    expiresAt: now + expiresIn * 1000,
  };
  return token;
}

/**
 * Katan-clone auth: OAuth password grant with CLIENT_ID:CLIENT_SECRET as Basic.
 * API key is a last-resort fallback only.
 */
export async function getSignNowAccessToken(): Promise<string> {
  const timing = getSignNowTiming();
  const started = timing ? Date.now() : 0;
  const cacheHit = Boolean(
    cachedToken && cachedToken.expiresAt - TOKEN_SKEW_MS > Date.now(),
  );
  try {
    const username = String(process.env.SIGNNOW_USERNAME || '').trim();
    const password = String(process.env.SIGNNOW_PASSWORD || '');
    if (username && password && signNowBasicToken()) {
      if (!inflightToken) {
        inflightToken = fetchOAuthAccessToken().finally(() => {
          inflightToken = null;
        });
      }
      return await inflightToken;
    }
    const apiKey = signNowApiKey();
    if (apiKey) return apiKey;
    throw new Error('SignNow credentials are not configured in .env');
  } finally {
    if (timing) {
      logSignNowTiming('getSignNowAccessToken', Date.now() - started, { cacheHit });
    }
  }
}

export function isTransientSignNowFailure(
  status?: number | null,
  detail?: string,
): boolean {
  const text = String(detail || '');
  if (
    /timeout|ECONNABORTED|ECONNRESET|socket hang up|network|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|temporarily unavailable|try again/i.test(
      text,
    )
  ) {
    return true;
  }
  if (status == null) return false;
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function sleepSignNow(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createSignNowApiClient(): Promise<AxiosInstance> {
  const token = await getSignNowAccessToken();
  const client = axios.create({
    baseURL: SIGNNOW_API_BASE,
    // Group-template copy often needs 25–40s. A 20s abort triggers the slow
    // addendum-group fallback and Review stretches to 2–3 minutes.
    timeout: 45_000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  client.interceptors.request.use((config) => {
    if (getSignNowTiming()) countSignNowApiCall();
    return config;
  });
  client.interceptors.response.use(
    async (res) => {
      const cfg = res.config as { headers?: Record<string, unknown>; __signNowRetried401?: boolean };
      if (res.status !== 401 || cfg.__signNowRetried401) return res;
      cfg.__signNowRetried401 = true;
      clearSignNowAccessTokenCache();
      const nextToken = await getSignNowAccessToken();
      cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${nextToken}` };
      return client.request(res.config);
    },
    async (error) => {
      const cfg = error?.config as
        | { headers?: Record<string, unknown>; __signNowRetried401?: boolean }
        | undefined;
      if (!cfg || cfg.__signNowRetried401 || error?.response?.status !== 401) {
        throw error;
      }
      cfg.__signNowRetried401 = true;
      clearSignNowAccessTokenCache();
      const nextToken = await getSignNowAccessToken();
      cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${nextToken}` };
      return client.request(error.config);
    },
  );
  return client;
}
