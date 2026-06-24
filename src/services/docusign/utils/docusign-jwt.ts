import jwt from 'jsonwebtoken';
import axios from 'axios';
import {
  DOCUSIGN_AUTH_BASE,
  DOCUSIGN_CLIENT_ID,
  DOCUSIGN_INTEGRATION_KEY,
  DOCUSIGN_RSA_PRIVATE_KEY,
  DOCUSIGN_IMPERSONATED_USER_ID,
  DOCUSIGN_ACCOUNT_ID,
  DOCUSIGN_BASE_URI,
  getDocusignOAuthUrls,
  isDocusignAccountIdGuid,
  normalizeDocusignRestBaseUri,
} from './docusign-client';
import { normalizePemKey } from './normalize-pem-key';

const JWT_LIFETIME_SEC = 3600;
const JWT_SCOPES = 'signature impersonation';

type CachedJwtSession = {
  accessToken: string;
  accountId: string;
  baseUri: string;
  expiresAtMs: number;
};

let cachedSession: CachedJwtSession | null = null;

/** True when server-side JWT impersonation is configured (BoldSign-style; no per-user OAuth). */
export function isDocusignJwtConfigured(): boolean {
  const integrationKey = DOCUSIGN_INTEGRATION_KEY || DOCUSIGN_CLIENT_ID;
  return Boolean(
    integrationKey?.trim() &&
      DOCUSIGN_IMPERSONATED_USER_ID?.trim() &&
      DOCUSIGN_RSA_PRIVATE_KEY?.trim(),
  );
}

function getJwtAudience(): string {
  try {
    const host = new URL(DOCUSIGN_AUTH_BASE).host;
    return host;
  } catch {
    return DOCUSIGN_AUTH_BASE.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function buildJwtAssertion(): string {
  const integrationKey = DOCUSIGN_INTEGRATION_KEY || DOCUSIGN_CLIENT_ID;
  const userId = DOCUSIGN_IMPERSONATED_USER_ID;
  const privateKey = normalizePemKey(DOCUSIGN_RSA_PRIVATE_KEY);

  if (!integrationKey || !userId || !privateKey) {
    throw new Error(
      'DocuSign JWT is not configured. Set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_IMPERSONATED_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY.',
    );
  }

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: integrationKey,
      sub: userId,
      aud: getJwtAudience(),
      iat: now,
      exp: now + JWT_LIFETIME_SEC,
      scope: JWT_SCOPES,
    },
    privateKey,
    { algorithm: 'RS256' },
  );
}

async function fetchAccessToken(assertion: string): Promise<string> {
  const { tokenUrl } = getDocusignOAuthUrls();
  const params = new URLSearchParams();
  params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  params.append('assertion', assertion);

  const res = await axios.post(tokenUrl, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const accessToken = res.data?.access_token;
  if (!accessToken) {
    throw new Error('DocuSign JWT token response missing access_token');
  }
  return accessToken;
}

async function resolveAccountFromUserInfo(accessToken: string): Promise<{
  accountId: string;
  baseUri: string;
}> {
  const { userInfoUrl } = getDocusignOAuthUrls();
  const userInfoRes = await axios.get(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const accounts = userInfoRes.data?.accounts || [];
  const defaultAccount =
    accounts.find((a: { is_default?: boolean }) => a.is_default) || accounts[0];

  if (!defaultAccount?.account_id || !defaultAccount?.base_uri) {
    throw new Error(
      'Could not resolve DocuSign account from userinfo. Check JWT consent and impersonated user.',
    );
  }

  const envAccountId = DOCUSIGN_ACCOUNT_ID?.trim() || '';
  const envBaseUri = DOCUSIGN_BASE_URI?.trim() || '';

  let selected = defaultAccount as { account_id?: string; base_uri?: string };
  if (envAccountId && isDocusignAccountIdGuid(envAccountId)) {
    const match = accounts.find(
      (a: { account_id?: string }) => String(a.account_id) === envAccountId,
    );
    if (match) {
      selected = match;
    } else {
      console.warn(
        `[DocuSign] DOCUSIGN_ACCOUNT_ID="${envAccountId}" not found in userinfo accounts; using default account.`,
      );
    }
  } else if (envAccountId) {
    console.warn(
      `[DocuSign] DOCUSIGN_ACCOUNT_ID="${envAccountId}" is not an API account GUID ` +
        `(use Apps and Keys → API Account ID). Using userinfo account_id ${defaultAccount.account_id}.`,
    );
  }

  const accountId = String(selected.account_id);
  const baseUri = normalizeDocusignRestBaseUri(String(selected.base_uri));

  if (envBaseUri) {
    const envNormalized = normalizeDocusignRestBaseUri(envBaseUri);
    if (envNormalized !== baseUri) {
      console.warn(
        `[DocuSign] DOCUSIGN_BASE_URI="${envBaseUri}" does not match userinfo base_uri ` +
          `"${selected.base_uri}" for this account; using userinfo (avoids INVALID_API_VERSION).`,
      );
    }
  }

  return { accountId, baseUri };
}

/**
 * Server-to-server DocuSign session (JWT grant). Cached ~50 minutes.
 * Same idea as BoldSign API-key auth — CRM users do not need to connect DocuSign.
 */
export async function getDocusignJwtSession(): Promise<{
  accessToken: string;
  accountId: string;
  baseUri: string;
}> {
  const bufferMs = 5 * 60 * 1000;
  const cachedBaseOk =
    cachedSession &&
    isDocusignAccountIdGuid(cachedSession.accountId) &&
    !/\/v2\.1\/?$/i.test(cachedSession.baseUri) &&
    /\/restapi$/i.test(cachedSession.baseUri.replace(/\/+$/, ''));

  if (cachedSession && cachedSession.expiresAtMs - bufferMs > Date.now() && cachedBaseOk) {
    return {
      accessToken: cachedSession.accessToken,
      accountId: cachedSession.accountId,
      baseUri: cachedSession.baseUri,
    };
  }
  if (cachedSession && !cachedBaseOk) {
    cachedSession = null;
  }

  const assertion = buildJwtAssertion();
  const accessToken = await fetchAccessToken(assertion);
  const { accountId, baseUri } = await resolveAccountFromUserInfo(accessToken);

  cachedSession = {
    accessToken,
    accountId,
    baseUri,
    expiresAtMs: Date.now() + (JWT_LIFETIME_SEC - 60) * 1000,
  };

  console.log(`[DocuSign] JWT session resolved accountId=${accountId} apiBase=${baseUri}`);

  return { accessToken, accountId, baseUri };
}

/** Clear cached JWT (e.g. after consent or key rotation). */
export function clearDocusignJwtCache(): void {
  cachedSession = null;
}
