import { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import { signNowService } from '../services/signnow/signnow.service';

/**
 * SignNow delivers events as `{ meta: { event }, content: { … } }`. Which id
 * the payload carries depends on the event: document-level callbacks send
 * `document_id`, document-group callbacks send `document_group_id`. Collect any
 * of them and let the CRM lookup decide which one maps to a tracked envelope.
 */
function collectCandidateIds(body: unknown): string[] {
  const root = (body || {}) as Record<string, any>;
  const content = (root.content ?? root.data ?? root) as Record<string, any>;
  const raw = [
    content?.document_group_id,
    content?.documentgroup_id,
    content?.group_id,
    root?.document_group_id,
    content?.document_id,
    root?.document_id,
    content?.id,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const id = String(value ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function signNowWebhookEventName(body: unknown): string {
  const root = (body || {}) as Record<string, any>;
  return String(root?.meta?.event ?? root?.event ?? root?.event_name ?? '').trim();
}

/**
 * Resolve the id SignNow sent onto the envelope the CRM stores on `Document`.
 * `Document.envelopeId` holds the SignNow document-group id, so a group event
 * matches directly; a document-level event only matches when that document is
 * itself the tracked envelope.
 */
export async function resolveSignNowEnvelopeId(
  candidates: string[],
): Promise<{ envelopeId: string; applicationId: string } | null> {
  for (const id of candidates) {
    const doc = await prisma.document.findFirst({
      where: { envelopeId: id },
      select: { envelopeId: true, applicationId: true },
    });
    if (doc?.envelopeId) {
      return {
        envelopeId: doc.envelopeId,
        applicationId: String(doc.applicationId || ''),
      };
    }
  }
  return null;
}

/**
 * Event callback for SignNow signing activity.
 *
 * The handler deliberately does no status mapping of its own: it resolves the
 * document group and defers to `getGroupStatus`, which already reads the live
 * group, persists `completed` / `voided` onto Document + Contract, and runs the
 * Contract → Application workflow sync that moves the deal to Contract Signed.
 * That keeps the webhook and the existing manual refresh on one code path.
 */
export async function handleSignNowWebhook(req: Request, res: Response): Promise<void> {
  const expectedSecret = String(process.env.SIGNNOW_WEBHOOK_SECRET || '').trim();
  if (expectedSecret) {
    const provided = String(
      req.header('x-signnow-signature') || req.header('x-webhook-secret') || '',
    ).trim();
    if (provided !== expectedSecret) {
      console.warn('[SignNow webhook] rejected: shared secret mismatch');
      res.status(401).json({ success: false, message: 'Invalid webhook secret' });
      return;
    }
  }

  const event = signNowWebhookEventName(req.body);
  const candidates = collectCandidateIds(req.body);
  console.info('[SignNow webhook] received', { event, candidates });

  if (!candidates.length) {
    // Acknowledge: retrying an unparseable body will never succeed.
    res.status(200).json({ success: true, message: 'No SignNow id in payload; ignored' });
    return;
  }

  const resolved = await resolveSignNowEnvelopeId(candidates);
  if (!resolved) {
    console.info('[SignNow webhook] no CRM envelope for this event; ignored', {
      event,
      candidates,
    });
    res.status(200).json({ success: true, message: 'No matching CRM envelope; ignored' });
    return;
  }

  try {
    const status = await signNowService.getGroupStatus(
      resolved.envelopeId,
      resolved.applicationId || undefined,
    );
    console.info('[SignNow webhook] synced group status', {
      event,
      envelopeId: resolved.envelopeId,
      applicationId: resolved.applicationId || null,
      status: status.status,
      source: status.source || 'signnow',
    });
    res.status(200).json({ success: true, envelopeId: resolved.envelopeId, status: status.status });
  } catch (err) {
    // 5xx so SignNow retries a transient API/database failure.
    console.error('[SignNow webhook] status sync failed', {
      event,
      envelopeId: resolved.envelopeId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ success: false, message: 'Status sync failed' });
  }
}

export default { handleSignNowWebhook };
