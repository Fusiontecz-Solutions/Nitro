import crypto from 'crypto';
import { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import { signNowService } from '../services/signnow/signnow.service';
import { advancePortalSigningQueue } from '../services/signnow/signnow-portal-send.service';
import {
  isSignNowGroupCompleteEvent,
  scheduleSignNowCompletionRecheck,
} from '../services/signnow/signnow-completion-recheck';

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

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * SignNow signs every callback with the subscription's `secret_key`:
 * `X-SignNow-Signature` is base64(HMAC-SHA256(raw body)). Comparing that header
 * to the secret itself rejected every signed callback. The plain secret is still
 * accepted (in either header) for subscriptions registered as a custom header.
 */
export function isValidSignNowWebhookSignature(
  secret: string,
  rawBody: Buffer | string | undefined,
  signatureHeader: string,
  sharedSecretHeader: string,
): boolean {
  const key = String(secret || '').trim();
  if (!key) return true;
  const shared = String(sharedSecretHeader || '').trim();
  if (shared && safeEqual(shared, key)) return true;
  const signature = String(signatureHeader || '').trim();
  if (!signature) return false;
  if (safeEqual(signature, key)) return true;
  if (rawBody === undefined) return false;
  const digest = crypto.createHmac('sha256', key).update(rawBody).digest();
  return safeEqual(signature, digest.toString('base64')) || safeEqual(signature, digest.toString('hex'));
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
  const signatureOk = isValidSignNowWebhookSignature(
    expectedSecret,
    (req as Request & { rawBody?: Buffer }).rawBody,
    String(req.header('x-signnow-signature') || ''),
    String(req.header('x-webhook-secret') || ''),
  );
  if (!signatureOk) {
    console.warn('[SignNow webhook] rejected: signature mismatch');
    res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    return;
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

  // Verified-webhook mode (the secret is configured and the signature matched):
  // the event itself is the status. Nothing here reads the SignNow API, so the
  // account's hourly limit is left for sending contracts.
  if (expectedSecret) {
    const finalStatus = isSignNowGroupCompleteEvent(event)
      ? 'completed'
      : /declined$/i.test(event)
        ? 'voided'
        : null;
    try {
      if (finalStatus) {
        const applied = await signNowService.applyVerifiedGroupStatus(
          resolved.envelopeId,
          finalStatus,
          resolved.applicationId || undefined,
        );
        console.info('[SignNow webhook] verified status persisted', {
          event,
          envelopeId: resolved.envelopeId,
          applicationId: resolved.applicationId || null,
          status: applied.status,
          source: applied.source,
        });
        res.status(200).json({ success: true, envelopeId: resolved.envelopeId, status: applied.status });
        return;
      }
      // One signer finished: the group's own `complete` event reports the end.
      // Only email a signer the send never reached — no SignNow read.
      await advancePortalSigningQueue(resolved.envelopeId, { readSignNow: false });
      console.info('[SignNow webhook] verified signer event recorded', {
        event,
        envelopeId: resolved.envelopeId,
      });
      res.status(200).json({ success: true, envelopeId: resolved.envelopeId, status: 'sent' });
    } catch (err) {
      console.error('[SignNow webhook] verified event failed', {
        event,
        envelopeId: resolved.envelopeId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ success: false, message: 'Status sync failed' });
    }
    return;
  }

  try {
    // A signer who finished without the portal redirect (closed the tab, or
    // signed from SignNow's own email) still releases the next signer.
    try {
      await advancePortalSigningQueue(resolved.envelopeId);
    } catch (queueError) {
      console.warn('[SignNow webhook] portal queue advance failed', queueError);
    }
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
    // SignNow sends the completion callback before its API reports the group
    // finished. Re-read shortly instead of dropping the event.
    if (
      isSignNowGroupCompleteEvent(event) &&
      status.status !== 'completed' &&
      status.status !== 'voided'
    ) {
      const scheduled = scheduleSignNowCompletionRecheck(
        resolved.envelopeId,
        resolved.applicationId || undefined,
      );
      console.info('[SignNow webhook] completion event ahead of SignNow API; re-check scheduled', {
        envelopeId: resolved.envelopeId,
        status: status.status,
        scheduled,
      });
    }
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
