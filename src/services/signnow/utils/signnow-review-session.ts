import prisma from '../../../config/prismaClient';
import { isPortalSendInFlight } from './signnow-portal-send-inflight';

/**
 * Server-side record of the Owner review on a SignNow document group.
 *
 * "Review finished" used to exist only in the contract modal's React state.
 * Refreshing the CRM, closing or reloading its tab, an expired session or a
 * modal remount all dropped it, and the footer went back to "Review in SignNow"
 * for a package the preparer had already finished — the next click rebuilt the
 * package instead of sending it. The review is now a row keyed by the group id:
 * minting a review link opens it, SignNow confirming the Finish closes it, and
 * the CRM reads it back whenever the modal loads or the tab regains focus.
 */

export type SignNowReviewSessionRow = {
  envelopeId: string;
  startedAt: Date;
  completedAt: Date | null;
  fulfilledRoles: string[];
};

/**
 * `not_started` — no review link minted for the linked package.
 * `in_review`   — link minted, Finish not confirmed yet.
 * `review_complete` — Finish confirmed; the CRM must offer Send via SignNow.
 * `closed`      — the package already left draft (sent, signed, voided), so
 *                 there is no review to resume.
 */
export type SignNowReviewPhase = 'not_started' | 'in_review' | 'review_complete' | 'closed';

export type SignNowApplicationReviewState = {
  applicationId: string;
  envelopeId: string | null;
  documentStatus: string | null;
  phase: SignNowReviewPhase;
  reviewComplete: boolean;
  reviewStartedAt: string | null;
  reviewCompletedAt: string | null;
};

const APPLICATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reviewSessionTable = () => prisma.signNowReviewSession;

function toRow(raw: any): SignNowReviewSessionRow | null {
  if (!raw) return null;
  return {
    envelopeId: String(raw.envelopeId),
    startedAt: new Date(raw.startedAt),
    completedAt: raw.completedAt ? new Date(raw.completedAt) : null,
    fulfilledRoles: Array.isArray(raw.fulfilledRoles) ? raw.fulfilledRoles : [],
  };
}

/** A new review link was minted: any earlier Finish on this group no longer counts. */
export async function recordSignNowReviewStarted(
  envelopeId: string,
  startedAt: Date = new Date(),
): Promise<void> {
  const id = String(envelopeId || '').trim();
  if (!id) return;
  await reviewSessionTable().upsert({
    where: { envelopeId: id },
    create: { envelopeId: id, startedAt, completedAt: null, fulfilledRoles: [] },
    update: { startedAt, completedAt: null, fulfilledRoles: [] },
  });
}

/**
 * SignNow confirmed the preparer's Finish. Idempotent: the first confirmation
 * wins, so repeated polls do not keep moving `completedAt`.
 */
export async function recordSignNowReviewCompleted(
  envelopeId: string,
  fulfilledRoles: string[] = [],
  completedAt: Date = new Date(),
): Promise<SignNowReviewSessionRow | null> {
  const id = String(envelopeId || '').trim();
  if (!id) return null;
  const existing = toRow(await reviewSessionTable().findUnique({ where: { envelopeId: id } }));
  if (existing?.completedAt) return existing;
  const saved = await reviewSessionTable().upsert({
    where: { envelopeId: id },
    // No row means the link was minted before this table existed; the finish
    // is still real, so record it rather than lose it.
    create: { envelopeId: id, startedAt: completedAt, completedAt, fulfilledRoles },
    update: { completedAt, fulfilledRoles },
  });
  return toRow(saved);
}

export async function readSignNowReviewSession(
  envelopeId: string,
): Promise<SignNowReviewSessionRow | null> {
  const id = String(envelopeId || '').trim();
  if (!id) return null;
  return toRow(await reviewSessionTable().findUnique({ where: { envelopeId: id } }));
}

/** The user chose to change details / walk back — the finished review is void. */
export async function clearSignNowReviewSession(envelopeId: string): Promise<void> {
  const id = String(envelopeId || '').trim();
  if (!id) return;
  await reviewSessionTable().deleteMany({ where: { envelopeId: id } });
}

const CLOSED_DOCUMENT_STATUSES = new Set([
  'sent',
  'delivered',
  'completed',
  'signed',
  'revoked',
  'voided',
  'declined',
]);

/** Pure: combine the linked Document row with its review session. */
export function deriveSignNowReviewPhase(
  document: {
    envelopeId?: string | null;
    status?: string | null;
    sentAt?: Date | string | null;
    portalSentAt?: Date | string | null;
  } | null,
  session: Pick<SignNowReviewSessionRow, 'envelopeId' | 'completedAt'> | null,
): SignNowReviewPhase {
  const envelopeId = String(document?.envelopeId || '').trim();
  if (!envelopeId) return 'not_started';
  const status = String(document?.status || '').trim().toLowerCase();
  if (CLOSED_DOCUMENT_STATUSES.has(status) || document?.sentAt || document?.portalSentAt) {
    return 'closed';
  }
  if (!session || session.envelopeId !== envelopeId) return 'not_started';
  return session.completedAt ? 'review_complete' : 'in_review';
}

async function resolveApplicationUuid(applicationRef: string): Promise<string | null> {
  const ref = String(applicationRef || '').trim();
  if (!ref) return null;
  if (APPLICATION_UUID_RE.test(ref)) return ref;
  const { resolveApplicationWhere } = await import('../../applicationService');
  const where = resolveApplicationWhere(ref);
  if (!where) return null;
  const app = await prisma.application.findUnique({ where, select: { id: true } });
  return app?.id ?? null;
}

/** Review state of the SignNow package currently linked to an application. */
export async function readSignNowApplicationReviewState(
  applicationRef: string,
): Promise<SignNowApplicationReviewState | null> {
  const applicationId = await resolveApplicationUuid(applicationRef);
  if (!applicationId) return null;
  const document = await prisma.document.findUnique({
    where: { applicationId },
    select: { envelopeId: true, status: true, sentAt: true, portalSentAt: true },
  });
  const envelopeId = String(document?.envelopeId || '').trim() || null;
  const session = envelopeId ? await readSignNowReviewSession(envelopeId) : null;
  // A background portal send has not marked the row sent yet, but the review
  // is over — reporting it as finished put "Send via SignNow" back on screen.
  const phase =
    envelopeId && isPortalSendInFlight(envelopeId)
      ? 'closed'
      : deriveSignNowReviewPhase(document, session);
  const live = phase === 'in_review' || phase === 'review_complete';
  return {
    applicationId,
    envelopeId,
    documentStatus: document?.status ?? null,
    phase,
    reviewComplete: phase === 'review_complete',
    reviewStartedAt: live && session ? session.startedAt.toISOString() : null,
    reviewCompletedAt: live && session?.completedAt ? session.completedAt.toISOString() : null,
  };
}
