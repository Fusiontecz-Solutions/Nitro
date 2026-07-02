/** Stored on `Contract.contractPrefillOverrides` — separate from main contract envelope. */
export const ACH_AUTHORIZATION_DOCUSIGN_KEY = "achAuthorizationDocuSign";

/** ACH-only signer overrides (not merged with contract signers). */
export const ACH_SIGNER_OVERRIDES_KEY = "achSignerOverrides";

/** Prior standalone ACH DocuSign sends — stored on `Contract.contractPrefillOverrides`. */
export const ACH_SEND_HISTORY_KEY = "achSendHistory";

export type AchSignerOverrideRow = {
    role: string;
    name: string;
    email: string;
};

export type AchSendHistoryEntry = {
    envelopeId: string;
    status: AchAuthorizationDocuSignCapsuleStatus;
    sentAt?: string | null;
    archivedAt: string;
    funderName?: string | null;
};

export type AchAuthorizationDocuSignCapsuleStatus =
    | "DRAFT"
    | "SENT"
    | "VIEWED"
    | "SIGNED"
    | "VOIDED";

export type AchAuthorizationDocuSignMeta = {
    envelopeId: string;
    status: AchAuthorizationDocuSignCapsuleStatus;
    sentAt?: string | null;
    updatedAt?: string | null;
    /** DocuSign account used for this ACH send (Katan vs Alliance). */
    funderName?: string | null;
};

export function mapInternalEnvelopeStatusToAchCapsule(
    internalStatus: unknown,
): AchAuthorizationDocuSignCapsuleStatus {
    const k = String(internalStatus ?? "")
        .trim()
        .toLowerCase();
    if (k === "voided" || k === "revoked" || k === "declined" || k === "expired") {
        return "VOIDED";
    }
    if (k === "completed" || k === "signed") return "SIGNED";
    if (k === "viewed" || k === "delivered") return "VIEWED";
    if (k === "sent" || k === "processing") return "SENT";
    return "DRAFT";
}

const ACH_CAPSULE_STATUS_RANK: Record<AchAuthorizationDocuSignCapsuleStatus, number> = {
    DRAFT: 0,
    SENT: 1,
    VIEWED: 2,
    SIGNED: 3,
    VOIDED: 4,
};

export function mergeAchAuthorizationCapsuleStatus(
    prior: AchAuthorizationDocuSignCapsuleStatus,
    patch?: AchAuthorizationDocuSignCapsuleStatus,
): AchAuthorizationDocuSignCapsuleStatus {
    if (!patch) return prior;
    if (patch === "VOIDED" || prior === "VOIDED") return "VOIDED";
    return ACH_CAPSULE_STATUS_RANK[patch] >= ACH_CAPSULE_STATUS_RANK[prior] ? patch : prior;
}

export function parseAchAuthorizationDocuSignFromPrefill(
    raw: unknown,
    options?: { excludeEnvelopeId?: string | null },
): AchAuthorizationDocuSignMeta | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const blob = (raw as Record<string, unknown>)[ACH_AUTHORIZATION_DOCUSIGN_KEY];
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return null;
    const o = blob as Record<string, unknown>;
    const envelopeId = String(o.envelopeId ?? "").trim();
    if (!envelopeId) return null;
    const exclude = String(options?.excludeEnvelopeId ?? "").trim();
    if (exclude && envelopeId === exclude) return null;
    const statusRaw = String(o.status ?? "DRAFT").trim().toUpperCase();
    const status: AchAuthorizationDocuSignCapsuleStatus =
        statusRaw === "SENT" ||
        statusRaw === "VIEWED" ||
        statusRaw === "SIGNED" ||
        statusRaw === "VOIDED"
            ? statusRaw
            : "DRAFT";
    return {
        envelopeId,
        status,
        sentAt: o.sentAt != null ? String(o.sentAt) : null,
        updatedAt: o.updatedAt != null ? String(o.updatedAt) : null,
        funderName: o.funderName != null ? String(o.funderName).trim() || null : null,
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
    const status = mergeAchAuthorizationCapsuleStatus(prior.status, patch.status);
    const now = new Date().toISOString();
    const meta: AchAuthorizationDocuSignMeta = {
        envelopeId: String(patch.envelopeId || prior.envelopeId).trim(),
        status,
        sentAt:
            patch.sentAt !== undefined
                ? patch.sentAt
                : status === "VOIDED"
                  ? null
                  : status === "SENT" || status === "VIEWED" || status === "SIGNED"
                    ? (prior.sentAt ?? now)
                    : (prior.sentAt ?? null),
        updatedAt: patch.updatedAt ?? now,
        funderName:
            patch.funderName !== undefined
                ? patch.funderName
                : (prior.funderName ?? null),
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
        case "VOIDED":
            return "Voided";
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
        case "VOIDED":
            return "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600";
        default:
            return "bg-sky-100 text-sky-800 ring-sky-200/80 dark:bg-sky-900/40 dark:text-sky-200 dark:ring-sky-800/50";
    }
}

/** ACH envelope is in-flight (draft, sent, or viewed) — void before resending. */
export function achEnvelopeIsActive(status: AchAuthorizationDocuSignCapsuleStatus): boolean {
    return status === "DRAFT" || status === "SENT" || status === "VIEWED";
}

export function canSendAchAuthorization(
    meta: AchAuthorizationDocuSignMeta | null,
    sessionEnvelopeId?: string | null,
): boolean {
    const envelopeId = String(meta?.envelopeId ?? sessionEnvelopeId ?? "").trim();
    if (!envelopeId) return true;
    const status = meta?.status ?? "DRAFT";
    return status === "VOIDED";
}

export function canVoidAchAuthorization(
    meta: AchAuthorizationDocuSignMeta | null,
    sessionEnvelopeId?: string | null,
): boolean {
    const envelopeId = String(meta?.envelopeId ?? sessionEnvelopeId ?? "").trim();
    if (!envelopeId) return false;
    const status = meta?.status ?? "DRAFT";
    return achEnvelopeIsActive(status);
}

export function canResendAchAuthorization(
    meta: AchAuthorizationDocuSignMeta | null,
    sessionEnvelopeId?: string | null,
): boolean {
    const envelopeId = String(meta?.envelopeId ?? sessionEnvelopeId ?? "").trim();
    if (!envelopeId) return false;
    const status = meta?.status ?? "DRAFT";
    return status === "VOIDED" || status === "SIGNED";
}

export function parseAchSignerOverridesFromPrefill(
    raw: unknown,
): AchSignerOverrideRow[] | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const list = (raw as Record<string, unknown>)[ACH_SIGNER_OVERRIDES_KEY];
    if (!Array.isArray(list)) return null;
    const out: AchSignerOverrideRow[] = [];
    for (const item of list) {
        if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
        const o = item as Record<string, unknown>;
        const role = String(o.role ?? "").trim();
        const email = String(o.email ?? "").trim();
        if (!role || !email) continue;
        out.push({
            role,
            name: String(o.name ?? "").trim(),
            email,
        });
    }
    return out.length ? out : null;
}

export function mergeAchSignerOverridesIntoPrefill(
    baseRaw: unknown,
    signerRows: AchSignerOverrideRow[],
): Record<string, unknown> {
    const base =
        baseRaw && typeof baseRaw === "object" && !Array.isArray(baseRaw)
            ? { ...(baseRaw as Record<string, unknown>) }
            : {};
    const rows = signerRows
        .map((r) => ({
            role: String(r.role ?? "").trim(),
            name: String(r.name ?? "").trim(),
            email: String(r.email ?? "").trim(),
        }))
        .filter((r) => r.role && r.email);
    if (!rows.length) {
        const next = { ...base };
        delete next[ACH_SIGNER_OVERRIDES_KEY];
        return next;
    }
    return {
        ...base,
        [ACH_SIGNER_OVERRIDES_KEY]: rows,
    };
}

export function parseAchSendHistoryFromPrefill(raw: unknown): AchSendHistoryEntry[] {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const list = (raw as Record<string, unknown>)[ACH_SEND_HISTORY_KEY];
    if (!Array.isArray(list)) return [];
    const out: AchSendHistoryEntry[] = [];
    for (const item of list) {
        if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
        const o = item as Record<string, unknown>;
        const envelopeId = String(o.envelopeId ?? "").trim();
        if (!envelopeId) continue;
        const statusRaw = String(o.status ?? "DRAFT").trim().toUpperCase();
        const status: AchAuthorizationDocuSignCapsuleStatus =
            statusRaw === "SENT" ||
            statusRaw === "VIEWED" ||
            statusRaw === "SIGNED" ||
            statusRaw === "VOIDED"
                ? statusRaw
                : "DRAFT";
        out.push({
            envelopeId,
            status,
            sentAt: o.sentAt != null ? String(o.sentAt) : null,
            archivedAt: String(o.archivedAt ?? ""),
            funderName: o.funderName != null ? String(o.funderName).trim() || null : null,
        });
    }
    return out;
}
