/** Standalone contract-package sends (addendum / disclosure without main contract PDF). */
export const STANDALONE_PACKAGE_DOCUSIGN_KEY = "standalonePackageDocuSign";

export const STANDALONE_PACKAGE_SEND_HISTORY_KEY = "standalonePackageSendHistory";

export type StandalonePackageDocuSignCapsuleStatus =
    | "DRAFT"
    | "SENT"
    | "VIEWED"
    | "SIGNED"
    | "VOIDED";

export type StandalonePackageDocuSignMeta = {
    envelopeId: string;
    status: StandalonePackageDocuSignCapsuleStatus;
    sentAt?: string | null;
    updatedAt?: string | null;
    /** Documents included in this envelope (main contract PDF omitted when false). */
    package?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
    };
};

export type StandalonePackageSendHistoryEntry = {
    envelopeId: string;
    status: StandalonePackageDocuSignCapsuleStatus;
    sentAt?: string | null;
    archivedAt: string;
    package?: StandalonePackageDocuSignMeta["package"];
};

export function mapInternalEnvelopeStatusToPackageCapsule(
    internalStatus: unknown,
): StandalonePackageDocuSignCapsuleStatus {
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

export function parseStandalonePackageDocuSignFromPrefill(
    raw: unknown,
    options?: { excludeEnvelopeId?: string | null },
): StandalonePackageDocuSignMeta | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const blob = (raw as Record<string, unknown>)[STANDALONE_PACKAGE_DOCUSIGN_KEY];
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return null;
    const o = blob as Record<string, unknown>;
    const envelopeId = String(o.envelopeId ?? "").trim();
    if (!envelopeId) return null;
    const exclude = String(options?.excludeEnvelopeId ?? "").trim();
    if (exclude && envelopeId === exclude) return null;
    const statusRaw = String(o.status ?? "DRAFT").trim().toUpperCase();
    const status: StandalonePackageDocuSignCapsuleStatus =
        statusRaw === "SENT" ||
        statusRaw === "VIEWED" ||
        statusRaw === "SIGNED" ||
        statusRaw === "VOIDED"
            ? statusRaw
            : "DRAFT";
    const pkgRaw = o.package;
    const packageMeta =
        pkgRaw != null && typeof pkgRaw === "object" && !Array.isArray(pkgRaw)
            ? {
                  includeMainContract: Boolean(
                      (pkgRaw as Record<string, unknown>).includeMainContract,
                  ),
                  includeAddendum: Boolean((pkgRaw as Record<string, unknown>).includeAddendum),
                  includeDisclosure: Boolean(
                      (pkgRaw as Record<string, unknown>).includeDisclosure,
                  ),
              }
            : undefined;
    return {
        envelopeId,
        status,
        sentAt: o.sentAt != null ? String(o.sentAt) : null,
        updatedAt: o.updatedAt != null ? String(o.updatedAt) : null,
        package: packageMeta,
    };
}

export function mergeStandalonePackageDocuSignIntoPrefill(
    baseRaw: unknown,
    patch: Partial<StandalonePackageDocuSignMeta> & { envelopeId: string },
): Record<string, unknown> {
    const base =
        baseRaw && typeof baseRaw === "object" && !Array.isArray(baseRaw)
            ? { ...(baseRaw as Record<string, unknown>) }
            : {};
    const prior = parseStandalonePackageDocuSignFromPrefill(base) ?? {
        envelopeId: patch.envelopeId,
        status: "DRAFT" as const,
    };
    const status = patch.status ?? prior.status;
    const now = new Date().toISOString();
    const meta: StandalonePackageDocuSignMeta = {
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
        package: patch.package ?? prior.package,
    };
    return {
        ...base,
        [STANDALONE_PACKAGE_DOCUSIGN_KEY]: meta,
    };
}
