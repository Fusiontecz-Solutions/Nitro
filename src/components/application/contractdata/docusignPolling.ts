/** Client throttle for automatic sync only — manual Refresh uses `force: true` to bypass. */
export const DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS = 60_000;

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
