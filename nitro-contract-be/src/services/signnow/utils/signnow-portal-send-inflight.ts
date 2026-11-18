/**
 * Portal sends ("Send via SignNow") still publishing/emailing in the background.
 *
 * Kept apart from the portal send service so the review-session reader can ask
 * "is this package being sent right now?" without importing the SignNow service.
 * Until the send finishes the Document row still looks like a finished review,
 * and answering `review_complete` put "Send via SignNow" (and its toast) back
 * on the screen the user had just sent from.
 */
const inFlight = new Map<string, Promise<unknown>>();

function key(envelopeId: string): string {
  return String(envelopeId || '').trim();
}

export function isPortalSendInFlight(envelopeId: string): boolean {
  return inFlight.has(key(envelopeId));
}

/** Track `work` until it settles. Returns false when a send is already running. */
export function trackPortalSend(envelopeId: string, work: Promise<unknown>): boolean {
  const id = key(envelopeId);
  if (!id || inFlight.has(id)) return false;
  inFlight.set(id, work);
  const clear = () => {
    if (inFlight.get(id) === work) inFlight.delete(id);
  };
  work.then(clear, clear);
  return true;
}

/**
 * Wait (at most `timeoutMs`) for a running portal send to settle. Resolves
 * true when nothing is in flight or the send finished, false on timeout.
 * Never rejects: a failed send has stopped writing, which is all a reader needs.
 */
export async function waitForPortalSendToSettle(
  envelopeId: string,
  timeoutMs: number,
): Promise<boolean> {
  const work = inFlight.get(key(envelopeId));
  if (!work) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = work.then(
    () => true,
    () => true,
  );
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
