type SignNowFeTimingSession = {
  requestId: string;
  clickAt: number;
  requestStartAt?: number;
  responseAt?: number;
  embedSetAt?: number;
  iframeLogged?: boolean;
};

const sessions = new Map<string, SignNowFeTimingSession>();

export function newSignNowTimingRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function logSignNowFeTiming(
  requestId: string,
  step: string,
  durationMs: number,
  extra?: Record<string, unknown>,
): void {
  const session = sessions.get(requestId);
  const elapsedMs = session ? Date.now() - session.clickAt : durationMs;
  const payload: Record<string, unknown> = {
    requestId,
    step,
    durationMs,
    elapsedMs,
  };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue;
      payload[key] = value;
    }
  }
  console.info("[SignNow] timing", payload);
}

export function beginSignNowReviewTiming(requestId: string, clickAt: number): void {
  sessions.set(requestId, { requestId, clickAt });
  logSignNowFeTiming(requestId, "button-click", 0);
}

export function markSignNowReviewRequestStart(requestId: string): void {
  const session = sessions.get(requestId);
  if (!session || session.requestStartAt != null) return;
  const now = Date.now();
  session.requestStartAt = now;
  logSignNowFeTiming(requestId, "click-to-request-start", now - session.clickAt);
  logSignNowFeTiming(requestId, "http-request-start", 0, {
    elapsedMs: now - session.clickAt,
  });
}

export function markSignNowReviewHttpResponse(requestId: string): void {
  const session = sessions.get(requestId);
  if (!session || session.responseAt != null) return;
  const now = Date.now();
  session.responseAt = now;
  const httpStart = session.requestStartAt ?? session.clickAt;
  logSignNowFeTiming(requestId, "http-request-to-response", now - httpStart);
}

export function markSignNowReviewEmbedSet(requestId: string): void {
  const session = sessions.get(requestId);
  if (!session || session.embedSetAt != null) return;
  const now = Date.now();
  session.embedSetAt = now;
  if (session.responseAt != null) {
    logSignNowFeTiming(requestId, "response-to-embed-url", now - session.responseAt);
  }
}

export function markSignNowReviewIframeLoad(requestId: string): void {
  const session = sessions.get(requestId);
  if (!session || session.iframeLogged) return;
  session.iframeLogged = true;
  const now = Date.now();
  const embedSetAt = session.embedSetAt ?? now;
  logSignNowFeTiming(requestId, "embed-url-to-iframe-load", now - embedSetAt);
  logSignNowFeTiming(requestId, "click-to-iframe-loaded", now - session.clickAt);
}

export function getActiveSignNowReviewTimingId(): string | null {
  let latest: SignNowFeTimingSession | null = null;
  for (const session of sessions.values()) {
    if (session.iframeLogged) continue;
    if (!latest || session.clickAt > latest.clickAt) latest = session;
  }
  return latest?.requestId ?? null;
}
