/** Stored on `Contract.contractPrefillOverrides` — separate from main contract envelope. */
export const ACH_AUTHORIZATION_DOCUSIGN_KEY = "achAuthorizationDocuSign";

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
                : status === "VOIDED"
                  ? null
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

export function achEnvelopeIsActive(status: AchAuthorizationDocuSignCapsuleStatus): boolean {
    return status === "DRAFT" || status === "SENT" || status === "VIEWED";
}

export function canVoidAchAuthorization(
    meta: AchAuthorizationDocuSignMeta | null,
    sessionEnvelopeId?: string | null,
): boolean {
    const envelopeId = String(meta?.envelopeId ?? sessionEnvelopeId ?? "").trim();
    if (!envelopeId) return false;
    const status = meta?.status ?? "DRAFT";
    return status === "SENT" || status === "VIEWED";
}

/** Strip ACH DocuSign envelope meta before merging into the prefill edit form. */
export function stripAchDocuSignMetaFromPrefillOverrides(
    raw: unknown,
): Record<string, unknown> | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = { ...(raw as Record<string, unknown>) };
    delete o[ACH_AUTHORIZATION_DOCUSIGN_KEY];
    return o;
}

export function canResendAchAuthorization(
    meta: AchAuthorizationDocuSignMeta | null,
    sessionEnvelopeId?: string | null,
): boolean {
    const envelopeId = String(meta?.envelopeId ?? sessionEnvelopeId ?? "").trim();
    if (!envelopeId) return true;
    const status = meta?.status ?? "DRAFT";
    return status === "VOIDED" || status === "SIGNED";
}

/** Main contract DocuSign envelope — never treat ACH authorization envelope as the contract. */
export function resolveMainContractEnvelopeId(
    contract:
        | {
              application?: { document?: { envelopeId?: unknown } };
              contractPrefillOverrides?: unknown;
          }
        | null
        | undefined,
): string | null {
    const fromDocument = String(contract?.application?.document?.envelopeId ?? "").trim();
    if (!fromDocument) return null;
    const achEnvelopeId = String(
        parseAchAuthorizationDocuSignFromPrefill(contract?.contractPrefillOverrides)?.envelopeId ??
            "",
    ).trim();
    if (achEnvelopeId && achEnvelopeId === fromDocument) {
        return null;
    }
    return fromDocument;
}

export function isAchAuthorizationEnvelopeId(
    envelopeId: string | null | undefined,
    contractPrefillOverrides?: unknown,
): boolean {
    const eid = String(envelopeId ?? "").trim();
    if (!eid) return false;
    const achEnvelopeId = String(
        parseAchAuthorizationDocuSignFromPrefill(contractPrefillOverrides)?.envelopeId ?? "",
    ).trim();
    return Boolean(achEnvelopeId && achEnvelopeId === eid);
}
