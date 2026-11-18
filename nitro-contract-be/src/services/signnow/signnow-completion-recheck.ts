import { signNowService } from './signnow.service';

/**
 * Follow-up status reads for a `document_group.complete` webhook that arrived
 * before SignNow's own API caught up.
 *
 * SignNow fires the completion callback a few seconds before `GET
 * /documentgroup` stops reporting open field invites, so the webhook's live
 * read can still resolve to `sent`. The handler then persisted nothing and
 * answered 200 — SignNow never retried — and the deal sat on Contract Sent
 * until someone clicked the eye button. Here the same `getGroupStatus` read is
 * repeated on a short backoff, only for groups SignNow has just said are
 * complete, and stops at the first terminal status. There is no background
 * polling: every SignNow call here is triggered by a webhook.
 */

const DEFAULT_DELAYS_SECONDS = [10, 20, 30];

export function signNowCompletionRecheckDelaysMs(): number[] {
  const raw = String(process.env.SIGNNOW_WEBHOOK_RECHECK_DELAYS_SECONDS || '').trim();
  const parsed = raw
    ? raw
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  return (parsed.length ? parsed : DEFAULT_DELAYS_SECONDS).slice(0, 5).map((s) => Math.round(s * 1000));
}

/** Webhook events that mean "the whole group is signed". */
export function isSignNowGroupCompleteEvent(event: string): boolean {
  return /(^|\.)document_group\.complete$/i.test(String(event || '').trim());
}

/** envelopeId → timer of its next scheduled re-check. */
const pending = new Map<string, NodeJS.Timeout>();

/**
 * Schedule the next re-check for `envelopeId`. A group already waiting on one is
 * left alone, so SignNow's duplicate / retried callbacks do not stack reads.
 * Returns false when nothing was scheduled.
 */
export function scheduleSignNowCompletionRecheck(
  envelopeId: string,
  applicationId?: string,
  attempt = 0,
): boolean {
  const id = String(envelopeId || '').trim();
  if (!id || pending.has(id)) return false;
  const delays = signNowCompletionRecheckDelaysMs();
  if (attempt >= delays.length) {
    console.warn('[SignNow webhook] group still not complete after re-checks; the eye button refresh will pick it up', {
      envelopeId: id,
      attempts: attempt,
    });
    return false;
  }

  const timer = setTimeout(() => {
    pending.delete(id);
    void (async () => {
      try {
        const result = await signNowService.getGroupStatus(id, applicationId || undefined);
        if (result.status === 'completed' || result.status === 'voided') {
          console.info('[SignNow webhook] re-check synced group status', {
            envelopeId: id,
            status: result.status,
            attempt: attempt + 1,
          });
          return;
        }
      } catch (err) {
        console.warn('[SignNow webhook] re-check failed', {
          envelopeId: id,
          attempt: attempt + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      scheduleSignNowCompletionRecheck(id, applicationId, attempt + 1);
    })();
  }, delays[attempt]);
  timer.unref?.();
  pending.set(id, timer);
  return true;
}

export function cancelAllSignNowCompletionRechecks(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
}
