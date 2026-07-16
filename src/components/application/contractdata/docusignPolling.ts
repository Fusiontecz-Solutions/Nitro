/** Client throttle for automatic DocuSign API sync only — manual Refresh uses `force: true`. */
export const DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS = 60_000;

/**
 * How long after the last CRM status change before we treat DocuSign Connect as missed
 * and fall back to a single envelope status poll.
 */
export const DOCUSIGN_WEBHOOK_STALE_MS = 3 * 60_000;

/** CRM-only refresh while waiting for webhooks (no DocuSign API). */
export const DOCUSIGN_CRM_STATUS_POLL_MS = 45_000;

export function isDocuSignPollingLimitError(message: string): boolean {
    return /burst_envelope_polling|hourly_envelope_polling|polling.?limit|rate.?limit|too many requests/i.test(
        message,
    );
}

export function formatDocuSignSyncErrorMessage(err: unknown, context: string): string {
    const fromAxios = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
    const raw =
        (typeof fromAxios === "string" && fromAxios.trim()) ||
        (err instanceof Error ? err.message : String(err ?? ""));
    if (isDocuSignPollingLimitError(raw)) {
        return `DocuSign polling limit reached for ${context}. Status will update via webhook — wait a few minutes or use Refresh once.`;
    }
    if (raw.trim()) return raw.trim();
    return `Could not refresh ${context} status.`;
}

/** True when status is still in-flight and Connect may have missed an update. */
export function isDocuSignStatusInProgress(status: string | null | undefined): boolean {
    const s = String(status ?? "")
        .trim()
        .toLowerCase();
    if (!s) return false;
    return (
        s === "sent" ||
        s === "delivered" ||
        s === "viewed" ||
        s === "signed" ||
        s === "processing" ||
        s === "created" ||
        s === "draft"
    );
}

/**
 * Poll DocuSign only when webhook-driven CRM updates look stale.
 * Manual Refresh / post-send return always bypass this via `force`.
 */
export function shouldFallbackPollDocuSign(args: {
    force?: boolean;
    signingFinished?: boolean;
    lastCrmStatusAtMs: number;
    nowMs?: number;
    staleMs?: number;
}): boolean {
    if (args.force) return true;
    if (args.signingFinished) return false;
    const now = args.nowMs ?? Date.now();
    const staleMs = args.staleMs ?? DOCUSIGN_WEBHOOK_STALE_MS;
    const last = Number(args.lastCrmStatusAtMs) || 0;
    // Webhooks + Socket.IO push CRM updates — do not poll DocuSign on first open.
    if (!last) return false;
    return now - last >= staleMs;
}
