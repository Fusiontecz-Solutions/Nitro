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

export function normalizeDocusignRestBaseUri(baseUri: string): string {
  let uri = String(baseUri || '').trim().replace(/\/+$/, '');
  if (!uri) return uri;
  if (!uri.endsWith('/restapi')) {
    uri = `${uri}/restapi`;
  }
  return uri;
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
