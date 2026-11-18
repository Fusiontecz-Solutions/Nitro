import prisma from '../../../config/prismaClient';

/**
 * Which deal a SignNow document group belongs to.
 *
 * `Document` holds ONE row per application (`applicationId` is unique), so it
 * only ever points at the deal's latest group. Every re-initiate, pre-warm and
 * Review moves it to a newer group, after which an older group that is still
 * being sent no longer resolves to its deal through it. The merchant publish
 * used that row alone: it then read no CRM values, deleted every Owner widget
 * and stamped nothing in their place, and the merchant signed a blank contract
 * (C. R1 Construction, Tiberian, 2026-11-12).
 *
 * The contract records every group it was sent or reviewed as, so those
 * records are the fallback after the caller's own application id.
 */

/** Keys under `contractPrefillOverrides` that name the groups a contract used. */
const ENVELOPE_RECORD_KEYS = [
  'mainContractSendPackage',
  'portalSigningQueue',
  'documentSendHistory',
  'contractSendHistory',
] as const;

/** SignNow group / document ids are hex; anything else is not looked up. */
const ENVELOPE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function mentionsEnvelope(value: unknown, envelopeId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((row) => mentionsEnvelope(row, envelopeId));
  return String((value as Record<string, unknown>).envelopeId ?? '').trim() === envelopeId;
}

/** True when a contract's own send / review records name this group. */
export function overridesReferenceEnvelope(overrides: unknown, envelopeId: string): boolean {
  const id = String(envelopeId || '').trim();
  if (!id || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return false;
  }
  const record = overrides as Record<string, unknown>;
  return ENVELOPE_RECORD_KEYS.some((key) => mentionsEnvelope(record[key], id));
}

/**
 * The application a group belongs to: its `Document` row, then the id the
 * caller already knows, then the contract whose send records name the group.
 * Null when none of them can tell.
 */
export async function resolveApplicationIdForEnvelope(
  envelopeId: string,
  applicationIdHint?: string | null,
): Promise<string | null> {
  const id = String(envelopeId || '').trim();
  const hint = String(applicationIdHint || '').trim();
  if (id) {
    const document = await prisma.document.findUnique({
      where: { envelopeId: id },
      select: { applicationId: true },
    });
    const fromDocument = String(document?.applicationId || '').trim();
    if (fromDocument) return fromDocument;
  }
  if (hint) return hint;
  if (!ENVELOPE_ID_RE.test(id)) return null;
  try {
    const candidates: Array<{ applicationId: string | null; contractPrefillOverrides: unknown }> =
      await prisma.$queryRaw`
        SELECT "applicationId"::text AS "applicationId", "contractPrefillOverrides"
        FROM "Contract"
        WHERE "applicationId" IS NOT NULL
          AND "contractPrefillOverrides"::text LIKE ${`%${id}%`}
        ORDER BY "updatedAt" DESC
        LIMIT 5`;
    const match = candidates.find((row) =>
      overridesReferenceEnvelope(row.contractPrefillOverrides, id),
    );
    return String(match?.applicationId || '').trim() || null;
  } catch (err) {
    console.warn('[SignNow] could not resolve the deal behind a group from its contract', {
      envelopeId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Offer amounts every real deal carries; without them the package is not this deal's. */
const DEAL_DEFINING_KEYS = ['purchase_price', 'purchased_amount'] as const;

/**
 * Whether a merchant publish has the deal's values to print. The signer
 * prefill alone (names / emails from the roles) does not count: those few
 * values are exactly what a publish that lost its deal still had.
 */
export function hasDealDefiningValues(values: Record<string, string>): boolean {
  return DEAL_DEFINING_KEYS.some((key) => String(values[key] ?? '').trim() !== '');
}
