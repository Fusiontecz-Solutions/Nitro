/** Client throttle for automatic sync only — manual Refresh uses `force: true` to bypass. */
export const DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS = 60_000;

const TERMINAL_ENVELOPE_STATUSES = new Set([
    "completed",
    "declined",
    "voided",
    "revoked",
    "expired",
]);

/** Envelopes already known terminal in CRM — skip automatic sync entirely. */
const terminalEnvelopeIds = new Set<string>();

export function rememberTerminalEnvelope(envelopeId: string, data: unknown): void {
    const record = data as {
        internalStatus?: string;
        docusignStatus?: string;
        skippedDocuSign?: boolean;
    } | null;
    const status = String(
        record?.internalStatus ?? record?.docusignStatus ?? "",
    )
        .trim()
        .toLowerCase();
    if (TERMINAL_ENVELOPE_STATUSES.has(status)) {
        terminalEnvelopeIds.add(envelopeId);
    }
}

export function isDocuSignEnvelopeSyncTerminal(envelopeId: string): boolean {
    return terminalEnvelopeIds.has(String(envelopeId ?? "").trim());
}

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

export async function parseApiErrorMessageFromAxios(error: unknown): Promise<string> {
    const e = error as {
        response?: { data?: unknown };
        message?: string;
    };
    const data = e?.response?.data;
    if (data instanceof Blob) {
        try {
            const text = await data.text();
            try {
                const j = JSON.parse(text) as { message?: string };
                return String(j?.message ?? text).trim() || "Request failed";
            } catch {
                return text.trim() || "Request failed";
            }
        } catch {
            return "Request failed";
        }
    }
    if (data && typeof data === "object" && "message" in data) {
        return String((data as { message?: string }).message ?? e?.message ?? "Request failed");
    }
    return String(e?.message ?? "Request failed");
}
