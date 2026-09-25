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

/**
 * Marker stored in place of a value fingerprint for a group that was copied but
 * never prefilled — the `structureOnly` pre-warm the UI fires while the user is
 * still on the Summary step.
 *
 * The value guard below exists because a group that has been prefilled or sent
 * carries CRM values baked onto the page as `texts[]`, which a re-prefill cannot
 * overwrite. A pristine group has no such values by construction, so there is
 * nothing stale to inherit and it stays reusable no matter how much the contract
 * is edited before Review is clicked. Without this, every edit after a pre-warm
 * would throw the pre-warmed group away and copy a second one against SignNow's
 * daily document limit.
 */
export const SIGNNOW_PRISTINE_PREFILL_FINGERPRINT = 'pristine:structure-only';

export type SignNowPrefillReuseReason =
  | 'prefill_fingerprint_match'
  | 'prefill_fingerprint_changed'
  | 'missing_prefill_fingerprint'
  | 'pristine_structure_only';

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
  if (previous === SIGNNOW_PRISTINE_PREFILL_FINGERPRINT) {
    return { reuse: true, reason: 'pristine_structure_only' };
  }
  if (previous !== String(input.currentFingerprint ?? '').trim()) {
    return { reuse: false, reason: 'prefill_fingerprint_changed' };
  }
  return { reuse: true, reason: 'prefill_fingerprint_match' };
}

export type SignNowPrewarmLinkReason =
  | 'no_linked_document'
  | 'open_draft'
  | 'not_open_draft'
  | 'review_finished'
  | 'already_prefilled_by_review';

export type SignNowPrewarmLinkDecision = {
  link: boolean;
  reason: SignNowPrewarmLinkReason;
};

/**
 * May the background pre-warm park its group against the application?
 *
 * The warm is fire-and-forget and takes as long as SignNow's group copy, so the
 * Review click routinely lands while it is still in flight — and both requests
 * then share that one copy. Review writes the real value fingerprint, the warm
 * writes the pristine marker, and whichever write lands last wins. When the warm
 * won, Send found the pristine marker on a package Review had fully prefilled
 * and refused it on every funder. A group Review has already fingerprinted is
 * never downgraded back to pristine.
 */
export function resolveSignNowPrewarmLink(input: {
  live: {
    envelopeId?: string | null;
    status?: string | null;
    prefillFingerprint?: string | null;
  } | null;
  warmGroupId: string;
  reviewFinished: boolean;
}): SignNowPrewarmLinkDecision {
  const live = input.live;
  if (!live) return { link: true, reason: 'no_linked_document' };
  const status = String(live.status || '').trim().toLowerCase();
  if (status && status !== 'draft') return { link: false, reason: 'not_open_draft' };
  if (input.reviewFinished) return { link: false, reason: 'review_finished' };
  const liveFingerprint = String(live.prefillFingerprint || '').trim();
  if (
    String(live.envelopeId || '').trim() === String(input.warmGroupId || '').trim() &&
    liveFingerprint &&
    liveFingerprint !== SIGNNOW_PRISTINE_PREFILL_FINGERPRINT
  ) {
    return { link: false, reason: 'already_prefilled_by_review' };
  }
  return { link: true, reason: 'open_draft' };
}
