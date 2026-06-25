import dotenv from 'dotenv';

dotenv.config();

/** Demo: account-d.docusign.com — Production: account.docusign.com */
export const DOCUSIGN_AUTH_BASE =
  process.env.DOCUSIGN_AUTH_BASE || 'https://account-d.docusign.com';

/** Integration key (Apps and Keys) — used for OAuth and JWT */
export const DOCUSIGN_CLIENT_ID = process.env.DOCUSIGN_CLIENT_ID || '';
export const DOCUSIGN_INTEGRATION_KEY =
  process.env.DOCUSIGN_INTEGRATION_KEY || DOCUSIGN_CLIENT_ID || '';

export const DOCUSIGN_CLIENT_SECRET = process.env.DOCUSIGN_CLIENT_SECRET || '';
export const DOCUSIGN_REDIRECT_URI = process.env.DOCUSIGN_REDIRECT_URI || '';

/** Default redirect for JWT admin consent (add this URI in Apps and Keys → Redirect URIs). */
export const DOCUSIGN_JWT_CONSENT_REDIRECT_URI =
  process.env.DOCUSIGN_JWT_CONSENT_REDIRECT_URI ||
  'https://developers.docusign.com/platform/auth/consent';

/**
 * JWT service account (BoldSign-style): impersonated sender GUID from DocuSign → My Profile → API Username.
 */
export const DOCUSIGN_IMPERSONATED_USER_ID =
  process.env.DOCUSIGN_IMPERSONATED_USER_ID ||
  process.env.DOCUSIGN_USER_ID ||
  '';

/** RSA private key PEM (use \\n for newlines in .env) */
export const DOCUSIGN_RSA_PRIVATE_KEY = process.env.DOCUSIGN_RSA_PRIVATE_KEY || '';

/** Optional — skip userinfo lookup when both are set */
export const DOCUSIGN_ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID || '';
export const DOCUSIGN_BASE_URI = process.env.DOCUSIGN_BASE_URI || '';

/**
 * Auth mode: `jwt` (server, no user connect) | `oauth` (per-user connect).
 * Default: jwt when RSA key + user id are set, otherwise oauth.
 */
export const DOCUSIGN_AUTH_MODE = (process.env.DOCUSIGN_AUTH_MODE || '').trim().toLowerCase();

export const DOCUSIGN_DEFAULT_TEMPLATE_ID =
  process.env.DOCUSIGN_DEFAULT_TEMPLATE_ID ||
  process.env.BOLDSIGN_DEFAULT_TEMPLATE_ID ||
  '';

export const DOCUSIGN_DEFAULT_ROLE_NAME =
  process.env.DOCUSIGN_DEFAULT_ROLE_NAME || 'Signer';

/**
 * When true (default), draft envelopes drop signer slots not listed in CRM roles
 * (DocuSign templates often define multiple signer roles).
 */
export const DOCUSIGN_SINGLE_SIGNER_ONLY =
  String(process.env.DOCUSIGN_SINGLE_SIGNER_ONLY || 'true').trim().toLowerCase() !== 'false';

/** When true (default), contract + addendum + disclosure are one PDF in DocuSign. Set to false for separate files. */
export const DOCUSIGN_COMBINE_PACKAGE_PDF =
  String(process.env.DOCUSIGN_COMBINE_PACKAGE_PDF || 'true').trim().toLowerCase() !== 'false';

/**
 * When true (default), lock text/number/list/etc. tabs when the envelope is sent so signers
 * can only sign. Draft / Sender View review keeps fields editable until send.
 */
export const DOCUSIGN_LOCK_SIGNER_DATA_TABS =
  String(process.env.DOCUSIGN_LOCK_SIGNER_DATA_TABS || 'true').trim().toLowerCase() !== 'false';

/** How many times to attempt locking when tabs are still appearing (prod is slower than demo). */
export const DOCUSIGN_LOCK_RETRY_ATTEMPTS = Math.max(
  1,
  parseInt(String(process.env.DOCUSIGN_LOCK_RETRY_ATTEMPTS || '8'), 10) || 8,
);

export const DOCUSIGN_LOCK_RETRY_DELAY_MS = Math.max(
  500,
  parseInt(String(process.env.DOCUSIGN_LOCK_RETRY_DELAY_MS || '2500'), 10) || 2500,
);

/**
 * When true, envelope is set to `sent` after prefill (DocuSign emails signers).
 * Default true unless DOCUSIGN_AUTO_SEND_ENVELOPE=false in .env.
 */
export const DOCUSIGN_AUTO_SEND_ENVELOPE =
  String(process.env.DOCUSIGN_AUTO_SEND_ENVELOPE || 'true').trim().toLowerCase() !== 'false';

export const DOCUSIGN_WEBHOOK_BASIC_USER = process.env.DOCUSIGN_WEBHOOK_BASIC_USER || '';
export const DOCUSIGN_WEBHOOK_BASIC_PASSWORD = process.env.DOCUSIGN_WEBHOOK_BASIC_PASSWORD || '';

/** Public URL DocuSign Connect posts to (per-envelope + account Connect). */
export function resolveDocusignWebhookUrl(): string | null {
  const explicit =
    process.env.DOCUSIGN_WEBHOOK_URL ||
    process.env.DOCUSIGN_CONNECT_WEBHOOK_URL ||
    process.env.NGROK_URL?.replace(/\/boldsign\/webhook\/?$/i, '/docusign/webhook');
  if (explicit?.trim()) return explicit.trim().replace(/\/+$/, '');

  const crmApi = process.env.CRM_API_URL || process.env.API_BASE_URL || '';
  if (crmApi.includes('/api/v1')) {
    return crmApi.replace(/\/uploads\/?$/i, '').replace(/\/+$/, '') + '/docusign/webhook';
  }
  return null;
}

export function getDocusignOAuthUrls() {
  return {
    authUrl: `${DOCUSIGN_AUTH_BASE}/oauth/auth`,
    tokenUrl: `${DOCUSIGN_AUTH_BASE}/oauth/token`,
    userInfoUrl: `${DOCUSIGN_AUTH_BASE}/oauth/userinfo`,
  };
}

/** DocuSign REST paths include `/v2.1/...` — base URI must end at `/restapi` only. */
export function isDocusignAccountIdGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim(),
  );
}

export function normalizeDocusignRestBaseUri(baseUri: string): string {
  let uri = String(baseUri || '').trim().replace(/\/+$/, '');
  if (!uri) return uri;
  // Never keep /v2.1 on the axios baseURL — paths already include /v2.1/... (double version → INVALID_API_VERSION)
  uri = uri.replace(/\/restapi\/v2\.1$/i, '/restapi');
  uri = uri.replace(/\/v2\.1$/i, '');
  if (!/\/restapi$/i.test(uri)) {
    uri = `${uri}/restapi`;
  }
  return uri;
}

/** Absolute REST URL: `{base}/restapi/v2.1/accounts/...` (path may start with `/accounts/` or `/v2.1/accounts/`). */
export function buildDocusignApiUrl(restBaseUri: string, relativePath: string): string {
  const base = normalizeDocusignRestBaseUri(restBaseUri).replace(/\/+$/, '');
  let rel = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  if (!rel.startsWith('/v2.1/')) {
    rel = `/v2.1${rel}`;
  }
  return `${base}${rel}`;
}

export function resolveDocusignAuthMode(): 'jwt' | 'oauth' {
  if (DOCUSIGN_AUTH_MODE === 'oauth') return 'oauth';
  if (DOCUSIGN_AUTH_MODE === 'jwt') return 'jwt';
  const integrationKey = DOCUSIGN_INTEGRATION_KEY || DOCUSIGN_CLIENT_ID;
  if (
    integrationKey?.trim() &&
    DOCUSIGN_IMPERSONATED_USER_ID?.trim() &&
    DOCUSIGN_RSA_PRIVATE_KEY?.trim()
  ) {
    return 'jwt';
  }
  return 'oauth';
}
