/** Stored on `Contract.contractPrefillOverrides` — separate from main contract envelope. */
export const ACH_AUTHORIZATION_DOCUSIGN_KEY = "achAuthorizationDocuSign";

export type AchAuthorizationDocuSignCapsuleStatus = "DRAFT" | "SENT" | "VIEWED" | "SIGNED";

export type AchAuthorizationDocuSignMeta = {
    envelopeId: string;
    status: AchAuthorizationDocuSignCapsuleStatus;
    sentAt?: string | null;
    updatedAt?: string | null;
};

export function mapInternalEnvelopeStatusToAchCapsule(
    internalStatus: unknown,
): AchAuthorizationDocuSignCapsuleStatus {
    const k = String(internalStatus ?? "")
        .trim()
        .toLowerCase();
    if (k === "completed" || k === "signed") return "SIGNED";
    if (k === "viewed" || k === "delivered") return "VIEWED";
    if (k === "sent" || k === "processing") return "SENT";
    return "DRAFT";
}

export function parseAchAuthorizationDocuSignFromPrefill(
    raw: unknown,
): AchAuthorizationDocuSignMeta | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const blob = (raw as Record<string, unknown>)[ACH_AUTHORIZATION_DOCUSIGN_KEY];
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return null;
    const o = blob as Record<string, unknown>;
    const envelopeId = String(o.envelopeId ?? "").trim();
    if (!envelopeId) return null;
    const statusRaw = String(o.status ?? "DRAFT").trim().toUpperCase();
    const status: AchAuthorizationDocuSignCapsuleStatus =
        statusRaw === "SENT" || statusRaw === "VIEWED" || statusRaw === "SIGNED"
            ? statusRaw
            : "DRAFT";
    return {
        envelopeId,
        status,
        sentAt: o.sentAt != null ? String(o.sentAt) : null,
        updatedAt: o.updatedAt != null ? String(o.updatedAt) : null,
    };
}

export function mergeAchAuthorizationDocuSignIntoPrefill(
    baseRaw: unknown,
    patch: Partial<AchAuthorizationDocuSignMeta> & { envelopeId: string },
): Record<string, unknown> {
    const base =
        baseRaw && typeof baseRaw === "object" && !Array.isArray(baseRaw)
            ? { ...(baseRaw as Record<string, unknown>) }
            : {};
    const prior = parseAchAuthorizationDocuSignFromPrefill(base) ?? {
        envelopeId: patch.envelopeId,
        status: "DRAFT" as const,
    };
    const status = patch.status ?? prior.status;
    const now = new Date().toISOString();
    const meta: AchAuthorizationDocuSignMeta = {
        envelopeId: String(patch.envelopeId || prior.envelopeId).trim(),
        status,
        sentAt:
            patch.sentAt !== undefined
                ? patch.sentAt
                : status === "SENT" || status === "VIEWED" || status === "SIGNED"
                  ? (prior.sentAt ?? now)
                  : (prior.sentAt ?? null),
        updatedAt: patch.updatedAt ?? now,
    };
    return {
        ...base,
        [ACH_AUTHORIZATION_DOCUSIGN_KEY]: meta,
    };
}

export function formatAchAuthorizationCapsuleLabel(
    status: AchAuthorizationDocuSignCapsuleStatus,
): string {
    switch (status) {
        case "SENT":
            return "Sent";
        case "VIEWED":
            return "Viewed";
        case "SIGNED":
            return "Signed";
        default:
            return "Ready";
    }
}

export function achCapsuleClassName(status: AchAuthorizationDocuSignCapsuleStatus): string {
    switch (status) {
        case "SENT":
            return "bg-sky-100 text-sky-800 ring-sky-200/80 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-800/50";
        case "VIEWED":
            return "bg-amber-100 text-amber-900 ring-amber-200/80 dark:bg-amber-900/35 dark:text-amber-100 dark:ring-amber-800/50";
        case "SIGNED":
            return "bg-emerald-100 text-emerald-800 ring-emerald-200/80 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800/50";
        default:
            return "bg-sky-100 text-sky-800 ring-sky-200/80 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-800/50";
    }
}
