import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless signing-portal tokens for contracts emailed via SendGrid.
 *
 * Token shape: `{timestamp}_{signature}`, signed over `envelopeId:email:timestamp`.
 * Stateless on purpose — the link is derived, not stored, so sending a contract
 * costs no extra table and no extra write. The envelope's own SignNow status
 * remains the authority on whether signing is still open.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Seven days is a floor, not merely a default, because the merchant email
 * promises a seven-day window. A shorter `SIGNING_PORTAL_TOKEN_TTL_MS` on a
 * deployed box — a stale 48h value left over from an earlier release, or a
 * seconds/minutes number dropped in where milliseconds are required — must not
 * be able to kill a link while the merchant still has the email in their inbox.
 * Longer windows are honoured exactly as configured.
 */
const MIN_TTL_MS = SEVEN_DAYS_MS;

let warnedOnce = false;

export function signingPortalTokenTtlMs(): number {
  const raw = Number(process.env.SIGNING_PORTAL_TOKEN_TTL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return SEVEN_DAYS_MS;
  if (raw < MIN_TTL_MS) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        `[SignNow] SIGNING_PORTAL_TOKEN_TTL_MS=${raw} is below the ${MIN_TTL_MS}ms (7 day) floor; ` +
          'using the floor instead. This env var is milliseconds — set it to at least 604800000 (7 days).',
      );
    }
    return MIN_TTL_MS;
  }
  return raw;
}

/**
 * TTL as whole hours for merchant-facing copy, so the email can never promise a
 * window the token does not actually honour. Rounds up, and never below 1.
 */
export function signingPortalTokenTtlHours(ttlMs = signingPortalTokenTtlMs()): number {
  return Math.max(1, Math.ceil(ttlMs / (60 * 60 * 1000)));
}

function getPortalSecret(): string {
  const secret =
    process.env.SIGNING_PORTAL_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    '';
  if (!secret) {
    throw new Error(
      'SIGNING_PORTAL_SECRET or JWT_SECRET must be set to issue signing-portal links.',
    );
  }
  return secret;
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function sign(payload: string): string {
  return createHmac('sha256', getPortalSecret()).update(payload).digest('hex');
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createSigningPortalToken(input: {
  envelopeId: string;
  email: string;
  issuedAt?: number;
}): string {
  const envelopeId = String(input.envelopeId || '').trim();
  const email = normalizeEmail(input.email);
  if (!envelopeId || !email) {
    throw new Error('envelopeId and email are required to issue a signing-portal token.');
  }
  const timestamp = Number.isFinite(input.issuedAt) ? Number(input.issuedAt) : Date.now();
  return `${timestamp}_${sign(`${envelopeId}:${email}:${timestamp}`)}`;
}

export type SigningPortalTokenVerification =
  | { valid: true; issuedAt: number }
  | { valid: false; reason: 'malformed' | 'expired' | 'signature_mismatch' };

export function verifySigningPortalToken(input: {
  token: string;
  envelopeId: string;
  email: string;
  now?: number;
  ttlMs?: number;
}): SigningPortalTokenVerification {
  const token = String(input.token || '').trim();
  const envelopeId = String(input.envelopeId || '').trim();
  const email = normalizeEmail(input.email);
  const separator = token.indexOf('_');
  if (!token || !envelopeId || !email || separator <= 0) {
    return { valid: false, reason: 'malformed' };
  }
  const timestampRaw = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const timestamp = Number(timestampRaw);
  if (!signature || !Number.isFinite(timestamp) || timestamp <= 0) {
    return { valid: false, reason: 'malformed' };
  }
  // Signature is checked before expiry so a tampered timestamp cannot be probed
  // for validity through the difference between the two failures.
  if (!safeEquals(signature, sign(`${envelopeId}:${email}:${timestamp}`))) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const ttlMs = Number.isFinite(input.ttlMs) ? Number(input.ttlMs) : signingPortalTokenTtlMs();
  if (now - timestamp > ttlMs) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, issuedAt: timestamp };
}

/** Merchant-facing portal URL for one signer. */
export function buildSigningPortalUrl(input: {
  baseUrl: string;
  envelopeId: string;
  email: string;
  token: string;
}): string {
  const base = String(input.baseUrl || '').replace(/\/+$/, '');
  const params = new URLSearchParams({
    email: normalizeEmail(input.email),
    token: String(input.token || ''),
  });
  return `${base}/sign/${encodeURIComponent(String(input.envelopeId || '').trim())}?${params.toString()}`;
}
