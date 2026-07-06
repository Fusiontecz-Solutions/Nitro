import { axiosPost } from "@/redux/axios";
import {
    DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS,
    formatDocuSignSyncErrorMessage,
    isDocuSignEnvelopeSyncTerminal,
    isDocuSignPollingLimitError,
    rememberTerminalEnvelope,
} from "./docusignPolling";

const lastSyncedAtByEnvelope = new Map<string, number>();
const inFlightByEnvelope = new Map<string, Promise<unknown>>();

function isRateLimitedError(err: unknown): boolean {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 429 || status === 400) {
        const msg = String(
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                (err as Error)?.message ??
                "",
        );
        if (isDocuSignPollingLimitError(msg)) return true;
    }
    return status === 429;
}

export type SyncDocuSignEnvelopeStatusOptions = {
    applicationId?: string;
    contractId?: number | null;
    /** Bypass client + server throttle/cache. */
    force?: boolean;
    /** When true, 429 and throttle skips do not throw. */
    silent?: boolean;
    /** Used in user-facing error text. */
    envelopeLabel?: string;
    ccEmails?: string[];
    funderName?: string;
};

export type SyncDocuSignEnvelopeStatusResult = {
    skipped?: boolean;
    rateLimited?: boolean;
    data?: unknown;
};

/**
 * Throttled DocuSign envelope status sync — one in-flight request per envelope id.
 */
export async function syncDocuSignEnvelopeStatus(
    envelopeId: string,
    options?: SyncDocuSignEnvelopeStatusOptions,
): Promise<SyncDocuSignEnvelopeStatusResult> {
    const eid = String(envelopeId ?? "").trim();
    if (!eid) return { skipped: true };

    const label = options?.envelopeLabel ?? "envelope";

    if (!options?.force && isDocuSignEnvelopeSyncTerminal(eid)) {
        return { skipped: true };
    }

    const now = Date.now();
    const last = lastSyncedAtByEnvelope.get(eid) ?? 0;
    if (!options?.force && now - last < DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS) {
        return { skipped: true };
    }

    const inFlight = inFlightByEnvelope.get(eid);
    if (inFlight && !options?.force) {
        try {
            const data = await inFlight;
            return { data };
        } catch (err) {
            if (options?.silent && isRateLimitedError(err)) {
                return { rateLimited: true };
            }
            throw err;
        }
    }

    const contractIdNum = Number(options?.contractId);
    const funderName = String(options?.funderName ?? "").trim();
    const request = axiosPost("/docusign/sync-envelope-status", {
        envelopeId: eid,
        ...(options?.applicationId ? { applicationId: String(options.applicationId) } : {}),
        ...(Number.isFinite(contractIdNum) && contractIdNum > 0
            ? { contractId: contractIdNum }
            : {}),
        ...(funderName ? { funderName } : {}),
        ...(options?.force ? { force: true } : {}),
        ...(options?.ccEmails?.length ? { ccEmails: options.ccEmails } : {}),
    })
        .then((res) => {
            lastSyncedAtByEnvelope.set(eid, Date.now());
            const data = res?.data ?? res;
            rememberTerminalEnvelope(eid, data);
            return data;
        })
        .finally(() => {
            inFlightByEnvelope.delete(eid);
        });

    inFlightByEnvelope.set(eid, request);

    try {
        const data = await request;
        const rateLimited = Boolean(
            (data as { rateLimited?: boolean } | null | undefined)?.rateLimited,
        );
        if (rateLimited && options?.silent) {
            return { rateLimited: true, data };
        }
        return { data };
    } catch (err) {
        if (isRateLimitedError(err)) {
            lastSyncedAtByEnvelope.set(eid, Date.now());
            if (options?.silent) return { rateLimited: true };
            throw new Error(formatDocuSignSyncErrorMessage(err, label));
        }
        throw new Error(formatDocuSignSyncErrorMessage(err, label));
    }
}
