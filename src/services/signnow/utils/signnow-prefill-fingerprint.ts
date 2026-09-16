import { createHash } from 'node:crypto';

/**
 * Value fingerprint for a SignNow review package.
 *
 * `buildSignNowPackageFingerprint` only describes package *structure* (which
 * templates, how many), so a reused document group survives any amount of CRM
 * editing. That is what let an already-sent group come back with its previous
 * values: the re-prefill writes `prefilled_text`, but values baked onto the page
 * as `texts[]` by the earlier send stay put, and `collectExistingSignNowFieldValues`
 * re-reads those old texts as the base layer under the new CRM values.
 *
 * So reuse is additionally gated on the values themselves. When they change, the
 * group is rebuilt from the template instead of being re-prefilled in place.
 */

/** Prefill keys that legitimately differ between two otherwise identical sends. */
const VOLATILE_PREFILL_KEYS = new Set([
  'timing_request_id',
  'request_id',
  'idempotency_key',
]);

function canonicalizeValues(values: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!values) return out;
  for (const key of Object.keys(values).sort()) {
    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey || VOLATILE_PREFILL_KEYS.has(normalizedKey)) continue;
    const value = String(values[key] ?? '').trim();
    // An absent key and an empty value must fingerprint identically — otherwise
    // every optional blank field would look like a change and force a rebuild.
    if (!value) continue;
    out[normalizedKey] = value;
  }
  return out;
}

export type SignNowPrefillFingerprintSource = {
  /** Structural fingerprint from buildSignNowPackageFingerprint. */
  packageFingerprint: string;
  /** Flattened CRM prefill values actually sent to SignNow. */
  values: Record<string, string> | null | undefined;
};

export function buildSignNowPrefillFingerprint(
  input: SignNowPrefillFingerprintSource,
): string {
  const payload = {
    package: String(input.packageFingerprint || '').trim().toLowerCase(),
    values: canonicalizeValues(input.values),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export type SignNowPrefillReuseReason =
  | 'prefill_fingerprint_match'
  | 'prefill_fingerprint_changed'
  | 'missing_prefill_fingerprint';

export type SignNowPrefillReuseDecision = {
  reuse: boolean;
  reason: SignNowPrefillReuseReason;
};

/**
 * Reuse an existing draft group only when the values behind it are unchanged.
 *
 * A missing fingerprint is treated as stale: rows written before this check
 * existed carry no proof of what they were filled with, and silently reusing
 * them is the exact failure this guard exists to prevent. Those applications
 * rebuild once, then fingerprint normally.
 */
export function resolveSignNowPrefillReuse(input: {
  previousFingerprint: string | null | undefined;
  currentFingerprint: string;
}): SignNowPrefillReuseDecision {
  const previous = String(input.previousFingerprint ?? '').trim();
  if (!previous) {
    return { reuse: false, reason: 'missing_prefill_fingerprint' };
  }
  if (previous !== String(input.currentFingerprint ?? '').trim()) {
    return { reuse: false, reason: 'prefill_fingerprint_changed' };
  }
  return { reuse: true, reason: 'prefill_fingerprint_match' };
}
