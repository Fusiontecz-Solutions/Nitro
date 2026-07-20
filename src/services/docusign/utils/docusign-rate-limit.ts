/** Reuse GET /recipients within a single send / finalize flow (and short draft edits). */
const RECIPIENTS_CACHE_TTL_MS = 5 * 60_000;
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
