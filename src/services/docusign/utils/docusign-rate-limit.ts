import {
  formatDocusignApiErrorMessage,
  isDocuSignPollingLimitError,
} from './docusign-client';

class DocuSignRateLimitError extends Error {
  status = 429;
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestException';
  }
}

/** Keep circuit closed slightly under 1h so the next hour window can recover. */
const CIRCUIT_OPEN_MS = 55 * 60 * 1000;
/** Reuse GET /recipients within a single send / finalize flow. */
const RECIPIENTS_CACHE_TTL_MS = 2 * 60_000;
/** Reuse GET /envelopes/{id} status within short windows. */
const ENVELOPE_STATUS_CACHE_TTL_MS = 60_000;
/** Reuse GET /custom_fields within a send / CC notify flow. */
const CUSTOM_FIELDS_CACHE_TTL_MS = 2 * 60_000;
/** After Connect fires, trust CRM and skip DocuSign GET unless force (default 45 min). */
const WEBHOOK_TRUST_SKIP_POLL_MS = Math.max(
  60_000,
  parseInt(String(process.env.DOCUSIGN_WEBHOOK_TRUST_MS || ''), 10) || 45 * 60_000,
);
/** Fallback status-sync spacing when webhooks are missing (default 15 min). */
const ENVELOPE_STATUS_SYNC_MIN_INTERVAL_MS = Math.max(
  60_000,
  parseInt(String(process.env.DOCUSIGN_FALLBACK_POLL_MS || ''), 10) || 15 * 60_000,
);

/** Per DocuSign account GUID — Woodmere limit must not block Atlas / other funders. */
const pollingCircuitOpenUntilByAccount = new Map<string, number>();

type CacheEntry<T> = { value: T; expiresAt: number };

const recipientsCache = new Map<string, CacheEntry<unknown>>();
const envelopeStatusCache = new Map<string, CacheEntry<string>>();
const customFieldsCache = new Map<
  string,
  CacheEntry<Array<{ name?: string; value?: string; show?: string }>>
>();
const envelopeLastWebhookAt = new Map<string, number>();
const envelopeStatusSyncCache = new Map<
  string,
  { syncedAt: number; payload: Record<string, unknown> }
>();

function normalizeAccountId(accountId?: string | null): string {
  return String(accountId || '').trim().toLowerCase();
}

function cacheKey(accountId: string, envelopeId: string): string {
  return `${normalizeAccountId(accountId)}::${String(envelopeId).trim()}`;
}

/** Extract DocuSign account GUID from REST path `/v2.1/accounts/{guid}/...`. */
export function extractDocusignAccountIdFromUrl(url?: string): string | null {
  const m = String(url || '').match(/\/accounts\/([0-9a-f-]{36})(?:\/|$|\?)/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

export function isDocuSignPollingCircuitOpen(accountId?: string | null): boolean {
  const aid = normalizeAccountId(accountId);
  if (!aid) return false;
  const until = pollingCircuitOpenUntilByAccount.get(aid) ?? 0;
  if (Date.now() >= until) {
    if (until) pollingCircuitOpenUntilByAccount.delete(aid);
    return false;
  }
  return true;
}

export function getDocuSignPollingCircuitOpenUntilMs(accountId?: string | null): number {
  const aid = normalizeAccountId(accountId);
  if (!aid) return 0;
  return pollingCircuitOpenUntilByAccount.get(aid) ?? 0;
}

export function tripDocuSignPollingCircuit(
  accountId?: string | null,
  err?: unknown,
): void {
  const aid = normalizeAccountId(accountId);
  if (!aid) {
    console.warn(
      '[DocuSign] rate-limit error without accountId — circuit not tripped (avoid global block)',
    );
    return;
  }
  const until = Date.now() + CIRCUIT_OPEN_MS;
  pollingCircuitOpenUntilByAccount.set(aid, until);
  const detail = err ? formatDocusignApiErrorMessage(err) : 'DocuSign polling/API limit';
  console.warn(
    `[DocuSign] polling circuit OPEN for account ${aid} until ${new Date(until).toISOString()}: ${detail}`,
  );
}

export function clearDocuSignPollingCircuit(accountId?: string | null): void {
  const aid = normalizeAccountId(accountId);
  if (!aid) {
    pollingCircuitOpenUntilByAccount.clear();
    return;
  }
  pollingCircuitOpenUntilByAccount.delete(aid);
}

export function assertDocuSignPollingAllowed(
  accountId?: string | null,
  action = 'DocuSign API call',
): void {
  const aid = normalizeAccountId(accountId);
  if (!aid || !isDocuSignPollingCircuitOpen(aid)) return;
  const until = getDocuSignPollingCircuitOpenUntilMs(aid);
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
  throw new DocuSignRateLimitError(
    `DocuSign account ${aid.slice(0, 8)}… hourly polling/API limit reached. ${action} blocked for ~${mins} more minute(s). ` +
      'Other DocuSign accounts are unaffected. Status still updates via webhook — do not refresh this funder until the hour resets.',
  );
}

/** GETs against envelope resources count toward DocuSign's 250/hour polling budget. */
export function isDocuSignEnvelopePollingGet(method?: string, url?: string): boolean {
  if (String(method || 'get').toLowerCase() !== 'get') return false;
  const path = String(url || '');
  // /envelopes/{guid} or /envelopes/{guid}/...
  return /\/envelopes\/[0-9a-f-]{36}(\/|$|\?)/i.test(path);
}

export function noteDocuSignApiErrorForCircuit(
  err: unknown,
  accountId?: string | null,
): void {
  if (!isDocuSignPollingLimitError(err)) return;
  const ax = err as { config?: { url?: string; baseURL?: string } };
  const fromUrl =
    extractDocusignAccountIdFromUrl(ax?.config?.url) ||
    extractDocusignAccountIdFromUrl(ax?.config?.baseURL);
  tripDocuSignPollingCircuit(accountId || fromUrl, err);
}

export function getCachedEnvelopeRecipients(
  accountId: string,
  envelopeId: string,
): unknown | null {
  const key = cacheKey(accountId, envelopeId);
  const hit = recipientsCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    recipientsCache.delete(key);
    return null;
  }
  return hit.value;
}

export function setCachedEnvelopeRecipients(
  accountId: string,
  envelopeId: string,
  value: unknown,
): void {
  const eid = String(envelopeId || '').trim();
  const aid = normalizeAccountId(accountId);
  if (!eid || !aid) return;
  recipientsCache.set(cacheKey(aid, eid), {
    value,
    expiresAt: Date.now() + RECIPIENTS_CACHE_TTL_MS,
  });
}

export function invalidateCachedEnvelopeRecipients(
  accountId: string,
  envelopeId: string,
): void {
  recipientsCache.delete(cacheKey(accountId, envelopeId));
}

export function getCachedEnvelopeStatus(
  accountId: string,
  envelopeId: string,
): string | null {
  const key = cacheKey(accountId, envelopeId);
  const hit = envelopeStatusCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    envelopeStatusCache.delete(key);
    return null;
  }
  return hit.value;
}

export function setCachedEnvelopeStatus(
  accountId: string,
  envelopeId: string,
  status: string,
): void {
  const eid = String(envelopeId || '').trim();
  const aid = normalizeAccountId(accountId);
  if (!eid || !aid) return;
  envelopeStatusCache.set(cacheKey(aid, eid), {
    value: String(status || '').toLowerCase(),
    expiresAt: Date.now() + ENVELOPE_STATUS_CACHE_TTL_MS,
  });
}

export function invalidateCachedEnvelopeStatus(
  accountId: string,
  envelopeId: string,
): void {
  envelopeStatusCache.delete(cacheKey(accountId, envelopeId));
}

export function getCachedEnvelopeCustomFields(
  accountId: string,
  envelopeId: string,
): Array<{ name?: string; value?: string; show?: string }> | null {
  const key = cacheKey(accountId, envelopeId);
  const hit = customFieldsCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    customFieldsCache.delete(key);
    return null;
  }
  return hit.value;
}

export function setCachedEnvelopeCustomFields(
  accountId: string,
  envelopeId: string,
  value: Array<{ name?: string; value?: string; show?: string }>,
): void {
  const eid = String(envelopeId || '').trim();
  const aid = normalizeAccountId(accountId);
  if (!eid || !aid) return;
  customFieldsCache.set(cacheKey(aid, eid), {
    value,
    expiresAt: Date.now() + CUSTOM_FIELDS_CACHE_TTL_MS,
  });
}

export function invalidateCachedEnvelopeCustomFields(
  accountId: string,
  envelopeId: string,
): void {
  customFieldsCache.delete(cacheKey(accountId, envelopeId));
}

export function rememberEnvelopeWebhook(envelopeId?: string): void {
  const eid = String(envelopeId || '').trim();
  if (!eid) return;
  envelopeLastWebhookAt.set(eid, Date.now());
  envelopeStatusSyncCache.delete(eid);
}

export function shouldSkipDocuSignPollForWebhook(
  envelopeId: string,
  force: boolean,
): boolean {
  if (force) return false;
  const at = envelopeLastWebhookAt.get(String(envelopeId || '').trim());
  if (!at) return false;
  return Date.now() - at < WEBHOOK_TRUST_SKIP_POLL_MS;
}

export function getEnvelopeStatusSyncCache(
  envelopeId: string,
): { syncedAt: number; payload: Record<string, unknown> } | null {
  const eid = String(envelopeId || '').trim();
  if (!eid) return null;
  const hit = envelopeStatusSyncCache.get(eid);
  if (!hit) return null;
  if (Date.now() - hit.syncedAt >= ENVELOPE_STATUS_SYNC_MIN_INTERVAL_MS) {
    return null;
  }
  return hit;
}

export function setEnvelopeStatusSyncCache(
  envelopeId: string,
  payload: Record<string, unknown>,
): void {
  const eid = String(envelopeId || '').trim();
  if (!eid) return;
  envelopeStatusSyncCache.set(eid, { syncedAt: Date.now(), payload });
}

export function getEnvelopeStatusSyncMinIntervalMs(): number {
  return ENVELOPE_STATUS_SYNC_MIN_INTERVAL_MS;
}
