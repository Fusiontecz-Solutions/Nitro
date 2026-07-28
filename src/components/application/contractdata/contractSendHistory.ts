import {
    formatAchAuthorizationCapsuleLabel,
    mapInternalEnvelopeStatusToAchCapsule,
    parseAchAuthorizationDocuSignFromPrefill,
    parseAchSendHistoryFromPrefill,
    type AchAuthorizationDocuSignCapsuleStatus,
} from "./achAuthorizationDocuSign";
import {
    formatStandalonePackageSendLabel,
    formatStandalonePackageTableStatusLabel,
    listStandalonePackageDocumentLabels,
    parseStandalonePackageDocuSignFromPrefill,
    parseStandalonePackageSendHistoryFromPrefill,
    type StandalonePackageDocuSignCapsuleStatus,
    type StandalonePackageDocuSignMeta,
} from "./standalonePackageDocuSign";
import {
    isAchEnvelopeDraftLikeStatus,
    parseDocumentSendHistory,
    parseDocumentTemplateEnvelopeByMappingId,
    parseLastAchSentFunder,
} from "./documentTemplateMappingPrefill";
import { ACH_PREFILL_MAPPING_ALIAS_KEY } from "./achFormEditConfig";

/** Prior main-contract DocuSign sends — stored on `Contract.contractPrefillOverrides`. */
export const CONTRACT_SEND_HISTORY_KEY = "contractSendHistory";

/** Documents included in the current main-contract DocuSign envelope (for separate table rows). */
export const MAIN_CONTRACT_SEND_PACKAGE_KEY = "mainContractSendPackage";

/** Prefill JSON keys that must survive FE rebuilds so Contracts Generated keeps history. */
export const DOCUSIGN_ENVELOPE_PREFILL_META_KEYS = [
    CONTRACT_SEND_HISTORY_KEY,
    MAIN_CONTRACT_SEND_PACKAGE_KEY,
    "achAuthorizationDocuSign",
    "achSendHistory",
    "standalonePackageDocuSign",
    "standalonePackageSendHistory",
    "documentSendHistory",
    "documentTemplateEnvelopeByMappingId",
    "documentTemplatePrefillByMappingId",
    "lastAchSentFunder",
    "contractSignerOverrides",
] as const;

/** Copy DocuSign history / capsule keys from an existing prefill blob. */
export function pickPreservedDocuSignEnvelopeMetaFromPrefill(
    raw: unknown,
): Record<string, unknown> {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const o = raw as Record<string, unknown>;
    const preserved: Record<string, unknown> = {};
    for (const key of DOCUSIGN_ENVELOPE_PREFILL_META_KEYS) {
        if (o[key] !== undefined) preserved[key] = o[key];
    }
    return preserved;
}

export type MainContractSendPackageMeta = {
    envelopeId: string;
    includeMainContract?: boolean;
    includeAddendum?: boolean;
    includeDisclosure?: boolean;
};

/** Contract terms captured when a main-contract envelope is sent/archived. */
export type ContractSendHistoryTermsSnapshot = {
    approvedAmount?: number | null;
    totalAmount?: number | null;
    contractLength?: number | null;
    term?: string | null;
    position?: string | null;
    buyRate?: number | null;
    factorRate?: number | null;
    paymentAmount?: number | null;
    paybackAmount?: number | null;
    percentOfGross?: number | null;
};

export type ContractSendHistoryEntry = {
    envelopeId: string;
    status: string;
    sentAt?: string | null;
    completedAt?: string | null;
    archivedAt: string;
    package?: MainContractSendPackageMeta;
    /** DocuSign sender funder at send time (may differ from current contract funder). */
    funderName?: string | null;
    funderProfileId?: string | null;
    /** Contract terms at send time — keeps history rows from reflecting later edits. */
    termsSnapshot?: ContractSendHistoryTermsSnapshot | null;
};

export type ContractSendTableRowKind = "contract" | "ach" | "package";

/** Document identity within an envelope row (package envelopes may emit multiple rows). */
export type ContractSendTableDocumentKind =
    | "contract"
    | "ach"
    | "addendum"
    | "disclosure"
    | "package";

export type ContractSendTableRow = {
    rowType: ContractSendTableRowKind;
    key: string;
    label: string;
    envelopeId: string | null;
    contractStatus: unknown;
    documentStatus: unknown;
    sentAt: unknown;
    isCurrent: boolean;
    /** Present when `rowType === "ach"`. */
    achStatus?: AchAuthorizationDocuSignCapsuleStatus;
    /** Present when `rowType === "package"`. */
    packageStatus?: StandalonePackageDocuSignCapsuleStatus;
    /** Which document this row represents (addendum/disclosure stay separate). */
    documentKind?: ContractSendTableDocumentKind;
    /** DocuSign sender funder — may differ from contract funder (e.g. ACH). */
    funderName?: string | null;
    funderProfileId?: string | null;
    /**
     * Archived / send-time terms for this envelope row.
     * Used by Contracts Generated so prior sends keep their own amounts.
     */
    termsSnapshot?: ContractSendHistoryTermsSnapshot | null;
};

/** Prefer send-time terms for prior history rows; current row uses live contract. */
export function getContractSendRowTermsSnapshot(
    row: ContractSendTableRow | null | undefined,
): ContractSendHistoryTermsSnapshot | null {
    if (!row || row.isCurrent) return null;
    const snap = row.termsSnapshot;
    return snap != null && typeof snap === "object" ? snap : null;
}

export function resolveContractSendRowFunderAuth(
    contract: Record<string, unknown> | null | undefined,
    row: ContractSendTableRow,
): {
    funderName?: string;
    funderProfileId?: string;
    contractState?: string;
} {
    const envelopeId = String(row.envelopeId ?? "").trim();
    const contractState = String((contract as { state?: unknown })?.state ?? "").trim();
    const withState = (auth: {
        funderName?: string;
        funderProfileId?: string;
    }) => ({
        ...auth,
        ...(contractState ? { contractState } : {}),
    });

    if (row.funderName || row.funderProfileId) {
        return withState({
            ...(row.funderName ? { funderName: String(row.funderName).trim() } : {}),
            ...(row.funderProfileId
                ? { funderProfileId: String(row.funderProfileId).trim() }
                : {}),
        });
    }

    const prefill = contract?.contractPrefillOverrides;
    if (envelopeId) {
        const fromContractHistory = parseContractSendHistoryFromPrefill(prefill).find(
            (h) => String(h.envelopeId ?? "").trim() === envelopeId,
        );
        if (fromContractHistory?.funderName || fromContractHistory?.funderProfileId) {
            return withState({
                ...(fromContractHistory.funderName
                    ? { funderName: fromContractHistory.funderName }
                    : {}),
                ...(fromContractHistory.funderProfileId
                    ? { funderProfileId: fromContractHistory.funderProfileId }
                    : {}),
            });
        }
        const fromHistory = parseDocumentSendHistory(prefill).find(
            (h) => String(h.envelopeId ?? "").trim() === envelopeId,
        );
        if (fromHistory?.funderName || fromHistory?.funderProfileId) {
            return withState({
                ...(fromHistory.funderName ? { funderName: fromHistory.funderName } : {}),
                ...(fromHistory.funderProfileId
                    ? { funderProfileId: fromHistory.funderProfileId }
                    : {}),
            });
        }
        const lastAch = parseLastAchSentFunder(prefill);
        if (
            lastAch &&
            (row.rowType === "ach" ||
                !lastAch.envelopeId ||
                lastAch.envelopeId === envelopeId)
        ) {
            return withState({
                funderName: lastAch.funderName,
                ...(lastAch.funderProfileId ? { funderProfileId: lastAch.funderProfileId } : {}),
            });
        }
    }

    // For ACH rows, never guess the contract funder — backend will try linked DocuSign accounts.
    if (row.rowType === "ach") {
        return withState({});
    }

    const contractFunder = String((contract as { funderName?: unknown })?.funderName ?? "").trim();
    return withState({
        ...(contractFunder ? { funderName: contractFunder } : {}),
    });
}

export function pickContractEnvelopeDocument(
    contract: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    const app = contract?.application;
    const doc =
        app && typeof app === "object"
            ? (app as { document?: unknown }).document
            : null;
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
}

export function isContractFullySigned(
    contractStatus: unknown,
    documentStatus?: unknown,
): boolean {
    const cs = String(contractStatus ?? "").trim().toUpperCase();
    const ds = String(documentStatus ?? "").trim().toLowerCase();
    if (cs === "COMPLETED" || cs === "SIGNED") return true;
    if (ds === "completed") return true;
    return false;
}

/** True when the main contract envelope is fully signed or voided (no manual refresh needed). */
export function isContractSigningFinished(
    contract: Record<string, unknown> | null | undefined,
): boolean {
    if (!contract) return false;
    const doc = pickContractEnvelopeDocument(contract);
    const contractStatus = (contract as { status?: unknown }).status;
    const documentStatus = doc?.status;
    if (isContractFullySigned(contractStatus, documentStatus)) return true;
    return isContractVoidedOrTerminal(contractStatus, documentStatus);
}

export function isAchSigningFinished(
    status: AchAuthorizationDocuSignCapsuleStatus | null | undefined,
): boolean {
    return status === "SIGNED" || status === "VOIDED";
}

export function formatAchTableStatusLabel(
    meta: { envelopeId?: string | null; status?: AchAuthorizationDocuSignCapsuleStatus } | null,
): string {
    if (!meta?.envelopeId) return "Pending";
    // Drafts are filtered from Contracts Generated — do not surface Draft here.
    if (meta.status === "DRAFT") return "Pending";
    if (meta.status === "VOIDED") return "Voided";
    return formatAchAuthorizationCapsuleLabel(meta.status ?? "DRAFT");
}

/** Voided / declined / expired — eligible for a fresh send, not void or in-flight resend. */
export function isContractVoidedOrTerminal(
    contractStatus: unknown,
    documentStatus?: unknown,
): boolean {
    const cs = String(contractStatus ?? "").trim().toUpperCase();
    const ds = String(documentStatus ?? "").trim().toLowerCase();
    if (["REVOKED", "DECLINED", "EXPIRED", "VOIDED"].includes(cs)) return true;
    if (["revoked", "voided", "declined", "expired"].includes(ds)) return true;
    return false;
}

/**
 * Sent or viewed but not fully signed — can void, or send a new envelope
 * (send-new voids the open envelope first).
 */
export function isContractOutForSignature(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt?: Date | null,
): boolean {
    if (!contract) return false;
    const doc = pickContractEnvelopeDocument(contract);
    const contractStatus = (contract as { status?: unknown }).status;
    const documentStatus = doc?.status;
    if (isContractFullySigned(contractStatus, documentStatus)) return false;
    if (isContractVoidedOrTerminal(contractStatus, documentStatus)) return false;

    if (sessionSentAt) return true;

    const cs = String(contractStatus ?? "").trim().toUpperCase();
    if (["SENT", "VIEWED"].includes(cs)) return true;

    if (!doc) return false;
    if (doc.sentAt) return true;
    const ds = String(documentStatus ?? "").trim().toLowerCase();
    if (["sent", "viewed", "delivered"].includes(ds)) return true;
    return false;
}

export function canVoidMainContract(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt?: Date | null,
): boolean {
    const doc = pickContractEnvelopeDocument(contract);
    const envelopeId = String(doc?.envelopeId ?? "").trim();
    if (!envelopeId) return false;
    return isContractOutForSignature(contract, sessionSentAt);
}

/** Draft or never sent — open Review & send (not while out for signature or signed). */
export function canSendMainContract(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt?: Date | null,
): boolean {
    if (!contract) return false;
    const doc = pickContractEnvelopeDocument(contract);
    const contractStatus = (contract as { status?: unknown }).status;
    const documentStatus = doc?.status;
    if (isContractFullySigned(contractStatus, documentStatus)) return false;
    if (isContractOutForSignature(contract, sessionSentAt)) return false;
    return true;
}

/**
 * New envelope after fully signed, or while out for signature
 * (creates a new envelope without voiding the previous one).
 */
export function canResendMainContract(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt?: Date | null,
): boolean {
    if (!contract) return false;
    if (isContractOutForSignature(contract, sessionSentAt)) return true;
    const doc = pickContractEnvelopeDocument(contract);
    return isContractFullySigned(
        (contract as { status?: unknown }).status,
        doc?.status,
    );
}

export function parseContractSendHistoryFromPrefill(raw: unknown): ContractSendHistoryEntry[] {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const list = (raw as Record<string, unknown>)[CONTRACT_SEND_HISTORY_KEY];
    if (!Array.isArray(list)) return [];
    const out: ContractSendHistoryEntry[] = [];
    for (const item of list) {
        if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
        const o = item as Record<string, unknown>;
        const envelopeId = String(o.envelopeId ?? "").trim();
        if (!envelopeId) continue;
        const pkgRaw = o.package;
        const packageMeta =
            pkgRaw != null && typeof pkgRaw === "object" && !Array.isArray(pkgRaw)
                ? {
                      envelopeId,
                      includeMainContract: Boolean(
                          (pkgRaw as Record<string, unknown>).includeMainContract ?? true,
                      ),
                      includeAddendum: Boolean(
                          (pkgRaw as Record<string, unknown>).includeAddendum,
                      ),
                      includeDisclosure: Boolean(
                          (pkgRaw as Record<string, unknown>).includeDisclosure,
                      ),
                  }
                : undefined;
        const snapRaw = o.termsSnapshot;
        const termsSnapshot =
            snapRaw != null && typeof snapRaw === "object" && !Array.isArray(snapRaw)
                ? (snapRaw as ContractSendHistoryTermsSnapshot)
                : null;
        out.push({
            envelopeId,
            status: String(o.status ?? "draft").trim().toLowerCase(),
            sentAt: o.sentAt != null ? String(o.sentAt) : null,
            completedAt: o.completedAt != null ? String(o.completedAt) : null,
            archivedAt: String(o.archivedAt ?? ""),
            package: packageMeta,
            funderName: String(o.funderName ?? "").trim() || null,
            funderProfileId: String(o.funderProfileId ?? "").trim() || null,
            termsSnapshot,
        });
    }
    return out;
}

export function parseMainContractSendPackageFromPrefill(
    raw: unknown,
    options?: { envelopeId?: string | null },
): MainContractSendPackageMeta | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const blob = (raw as Record<string, unknown>)[MAIN_CONTRACT_SEND_PACKAGE_KEY];
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return null;
    const o = blob as Record<string, unknown>;
    const envelopeId = String(o.envelopeId ?? "").trim();
    if (!envelopeId) return null;
    const expected = String(options?.envelopeId ?? "").trim();
    if (expected && envelopeId !== expected) return null;
    return {
        envelopeId,
        includeMainContract: o.includeMainContract !== false,
        includeAddendum: Boolean(o.includeAddendum),
        includeDisclosure: Boolean(o.includeDisclosure),
    };
}

export function mergeMainContractSendPackageIntoPrefill(
    baseRaw: unknown,
    packageMeta: MainContractSendPackageMeta,
): Record<string, unknown> {
    const base =
        baseRaw && typeof baseRaw === "object" && !Array.isArray(baseRaw)
            ? { ...(baseRaw as Record<string, unknown>) }
            : {};
    const envelopeId = String(packageMeta.envelopeId ?? "").trim();
    if (!envelopeId) return base;
    return {
        ...base,
        [MAIN_CONTRACT_SEND_PACKAGE_KEY]: {
            envelopeId,
            includeMainContract: packageMeta.includeMainContract !== false,
            includeAddendum: Boolean(packageMeta.includeAddendum),
            includeDisclosure: Boolean(packageMeta.includeDisclosure),
        },
    };
}

/**
 * Contracts Generated — only real DocuSign outcomes:
 * Sent / Viewed / Signed / Completed / Voided (plus declined/expired).
 * Do not show draft/created rows (those used to surface as "Pending" via sentAt fallbacks
 * when older archives stored status incorrectly).
 */
function isContractRowVisibleInSendTable(
    contractStatus: unknown,
    documentStatus?: unknown,
    envelopeId?: string | null,
    _sentAt?: unknown,
): boolean {
    if (!String(envelopeId ?? "").trim()) return false;
    const ds = String(documentStatus ?? "").trim().toLowerCase();
    const cs = String(contractStatus ?? "").trim().toUpperCase();

    // Envelope/document status is the source of truth. Do NOT hide just because
    // Contract.status is still DRAFT (common after void/resend races).
    if (
        ds === "sent" ||
        ds === "delivered" ||
        ds === "viewed" ||
        ds === "signed" ||
        ds === "completed" ||
        ds === "revoked" ||
        ds === "voided" ||
        ds === "declined" ||
        ds === "expired"
    ) {
        return true;
    }

    // No usable document status — fall back to contract status only.
    if (
        cs === "SENT" ||
        cs === "VIEWED" ||
        cs === "SIGNED" ||
        cs === "COMPLETED" ||
        cs === "REVOKED" ||
        cs === "VOIDED" ||
        cs === "DECLINED" ||
        cs === "EXPIRED"
    ) {
        return true;
    }

    return false;
}

function isAchRowVisibleInSendTable(
    status: AchAuthorizationDocuSignCapsuleStatus | undefined,
    envelopeId?: string | null,
    _sentAt?: unknown,
): boolean {
    if (!String(envelopeId ?? "").trim()) return false;
    // SENT / VIEWED / SIGNED / VOIDED only — never draft-as-Pending.
    return Boolean(status && status !== "DRAFT");
}

function isPackageRowVisibleInSendTable(
    status: StandalonePackageDocuSignCapsuleStatus | undefined,
    envelopeId?: string | null,
    _sentAt?: unknown,
): boolean {
    if (!String(envelopeId ?? "").trim()) return false;
    return Boolean(status && status !== "DRAFT");
}

function buildStandalonePackageHistoryLabel(
    packageMeta: StandalonePackageDocuSignMeta["package"] | undefined,
    documentLabel: string,
    historyCount: number,
    sendNumber: number,
): string {
    if (historyCount <= 1) return `${documentLabel} (prior send)`;
    return `${documentLabel} (send ${sendNumber})`;
}

function documentKindFromPackageLabel(label: string): ContractSendTableDocumentKind {
    const lower = label.toLowerCase();
    if (lower.includes("addendum")) return "addendum";
    if (lower.includes("disclosure")) return "disclosure";
    return "package";
}

/**
 * One Contracts Generated row per envelope.
 * Addendum + disclosure (and optional contract) that share an envelope stay combined.
 */
function listMainEnvelopeDocumentParts(
    packageMeta?: MainContractSendPackageMeta | StandalonePackageDocuSignMeta["package"] | null,
): Array<{ documentKind: ContractSendTableDocumentKind; label: string }> {
    if (!packageMeta) {
        return [{ documentKind: "contract", label: "Contract" }];
    }
    const labels: string[] = [];
    const includeMain =
        (packageMeta as MainContractSendPackageMeta).includeMainContract !== false;
    if (includeMain) labels.push("Contract");
    if (packageMeta.includeAddendum) labels.push("Addendum");
    if (packageMeta.includeDisclosure) labels.push("State disclosure");
    if (!labels.length) {
        return [{ documentKind: "contract", label: "Contract" }];
    }
    let documentKind: ContractSendTableDocumentKind = "contract";
    if (!includeMain && labels.length === 1) {
        documentKind = documentKindFromPackageLabel(labels[0]!);
    } else if (!includeMain) {
        documentKind = "package";
    }
    return [{ documentKind, label: labels.join(" & ") }];
}

function pushMainEnvelopeDocumentRows(
    rows: ContractSendTableRow[],
    args: {
        envelopeId: string;
        contractStatus: unknown;
        documentStatus: unknown;
        sentAt: unknown;
        isCurrent: boolean;
        packageMeta?: MainContractSendPackageMeta | StandalonePackageDocuSignMeta["package"] | null;
        keyPrefix: string;
        historyCount?: number;
        sendNumber?: number;
        funderName?: string | null;
        funderProfileId?: string | null;
        termsSnapshot?: ContractSendHistoryTermsSnapshot | null;
    },
): void {
    const parts = listMainEnvelopeDocumentParts(args.packageMeta);
    const part = parts[0]!;
    let label = part.label;
    if (!args.isCurrent && args.historyCount != null && args.sendNumber != null) {
        label =
            args.historyCount > 1
                ? `${part.label} (send ${args.sendNumber})`
                : `${part.label} (prior send)`;
    }
    rows.push({
        rowType: "contract",
        key: `${args.keyPrefix}-${part.documentKind}-${args.envelopeId}`,
        label,
        envelopeId: args.envelopeId,
        contractStatus: args.contractStatus,
        documentStatus: args.documentStatus,
        sentAt: args.sentAt,
        isCurrent: args.isCurrent,
        documentKind: part.documentKind,
        ...(args.funderName ? { funderName: args.funderName } : {}),
        ...(args.funderProfileId ? { funderProfileId: args.funderProfileId } : {}),
        ...(args.termsSnapshot ? { termsSnapshot: args.termsSnapshot } : {}),
    });
}

function pushPackageDocumentRows(
    rows: ContractSendTableRow[],
    args: {
        envelopeId: string;
        status: StandalonePackageDocuSignCapsuleStatus;
        sentAt: unknown;
        isCurrent: boolean;
        packageMeta?: StandalonePackageDocuSignMeta["package"];
        keyPrefix: string;
        historyCount?: number;
        sendNumber?: number;
    },
): void {
    const combinedLabel = formatStandalonePackageSendLabel(args.packageMeta);
    const documentKind =
        listStandalonePackageDocumentLabels(args.packageMeta).length > 1
            ? "package"
            : documentKindFromPackageLabel(combinedLabel);
    let label = combinedLabel;
    if (!args.isCurrent && args.historyCount != null && args.sendNumber != null) {
        label = buildStandalonePackageHistoryLabel(
            args.packageMeta,
            combinedLabel,
            args.historyCount,
            args.sendNumber,
        );
    }
    rows.push({
        rowType: "package",
        key: `${args.keyPrefix}-${documentKind}-${args.envelopeId}`,
        label,
        envelopeId: args.envelopeId,
        contractStatus: args.status,
        documentStatus: args.status,
        sentAt: args.sentAt,
        isCurrent: args.isCurrent,
        packageStatus: args.status,
        documentKind,
    });
}

export function getContractSendTableRowStatusLabel(row: ContractSendTableRow): string {
    if (row.rowType === "ach") {
        return formatAchTableStatusLabel({
            envelopeId: row.envelopeId,
            status: row.achStatus,
        });
    }
    if (row.rowType === "package") {
        return formatStandalonePackageTableStatusLabel(row.packageStatus, row.envelopeId);
    }
    const ds = String(row.documentStatus ?? "").trim().toLowerCase();
    const cs = String(row.contractStatus ?? "").trim().toUpperCase();
    // Prefer Completed over Signed so fully-finished envelopes stay distinct.
    if (ds === "completed" || cs === "COMPLETED") return "Completed";
    if (ds === "signed" || cs === "SIGNED") return "Signed";
    if (ds === "viewed" || ds === "delivered" || cs === "VIEWED") return "Viewed";
    if (ds === "sent" || cs === "SENT") return "Sent";
    if (
        ds === "revoked" ||
        ds === "voided" ||
        cs === "REVOKED" ||
        cs === "VOIDED" ||
        cs === "DECLINED" ||
        cs === "EXPIRED"
    ) {
        return "Voided";
    }
    // Draft/unknown rows are filtered out of Contracts Generated.
    return cs || ds || "Sent";
}

export function isContractSendTableRowFullySigned(row: ContractSendTableRow): boolean {
    if (row.rowType === "ach") return row.achStatus === "SIGNED";
    if (row.rowType === "package") return row.packageStatus === "SIGNED";
    return isContractFullySigned(row.contractStatus, row.documentStatus);
}

export function isContractSendTableRowVoided(row: ContractSendTableRow): boolean {
    if (row.rowType === "ach") return row.achStatus === "VOIDED";
    if (row.rowType === "package") return row.packageStatus === "VOIDED";
    return isContractVoidedOrTerminal(row.contractStatus, row.documentStatus);
}

export function canVoidContractSendTableRow(
    contract: Record<string, unknown> | null | undefined,
    row: ContractSendTableRow | null | undefined,
    sessionSentAt?: Date | null,
): boolean {
    if (!row || !String(row.envelopeId ?? "").trim()) return false;
    if (row.rowType === "contract") {
        if (!row.isCurrent) return false;
        return canVoidMainContract(contract, sessionSentAt);
    }
    if (row.rowType === "ach") {
        const status = row.achStatus ?? "DRAFT";
        return status === "DRAFT" || status === "SENT" || status === "VIEWED";
    }
    if (row.rowType === "package") {
        if (!row.isCurrent) return false;
        const status = row.packageStatus ?? "DRAFT";
        return status === "DRAFT" || status === "SENT" || status === "VIEWED";
    }
    return false;
}

/** True when at least one envelope left DocuSign draft (main, ACH, or standalone package). */
export function hasVisibleContractSendTableRows(
    contract: Record<string, unknown> | null | undefined,
): boolean {
    return buildContractSendTableRows(contract).length > 0;
}

export function buildContractSendTableRows(
    contract: Record<string, unknown> | null | undefined,
): ContractSendTableRow[] {
    if (!contract) return [];

    const contractId = Number((contract as { id?: unknown }).id);
    const hasContractRecord = Number.isFinite(contractId) && contractId > 0;
    if (!hasContractRecord) return [];

    const prefill = contract.contractPrefillOverrides;
    const doc = pickContractEnvelopeDocument(contract);
    const mainEnvelopeId = String(doc?.envelopeId ?? "").trim() || null;

    const achCurrent = parseAchAuthorizationDocuSignFromPrefill(prefill, {
        excludeEnvelopeId: mainEnvelopeId,
    });
    const achEnvelopeId = String(achCurrent?.envelopeId ?? "").trim() || null;

    const packageCurrent = parseStandalonePackageDocuSignFromPrefill(prefill, {
        excludeEnvelopeId: mainEnvelopeId,
    });
    const packageEnvelopeId = String(packageCurrent?.envelopeId ?? "").trim() || null;

    const contractHistory = parseContractSendHistoryFromPrefill(prefill);
    const achHistory = parseAchSendHistoryFromPrefill(prefill);
    const packageHistory = parseStandalonePackageSendHistoryFromPrefill(prefill);
    const documentAchHistory = parseDocumentSendHistory(prefill).filter(
        (h) => h.documentKind === "ach",
    );
    const documentAchEnvelopeIds = new Set(
        documentAchHistory.map((h) => String(h.envelopeId ?? "").trim()).filter(Boolean),
    );
    const mainSendPackage = parseMainContractSendPackageFromPrefill(prefill, {
        envelopeId: mainEnvelopeId,
    });

    const seenEnvelopeIds = new Set<string>();
    const rows: ContractSendTableRow[] = [];

    const mainEnvelopeIsAchOnly = Boolean(
        mainEnvelopeId && achEnvelopeId && mainEnvelopeId === achEnvelopeId,
    );
    const mainEnvelopeIsPackageOnly = Boolean(
        mainEnvelopeId && packageEnvelopeId && mainEnvelopeId === packageEnvelopeId,
    );
    // ACH wrongly linked as package (legacy bug) — treat as ACH, not supplemental package.
    const packageEnvelopeIsAch = Boolean(
        packageEnvelopeId && documentAchEnvelopeIds.has(packageEnvelopeId),
    );

    if (mainEnvelopeId && !mainEnvelopeIsAchOnly && !mainEnvelopeIsPackageOnly) {
        if (
            isContractRowVisibleInSendTable(
                (contract as { status?: unknown }).status,
                doc?.status,
                mainEnvelopeId,
                doc?.sentAt ?? doc?.updatedAt,
            )
        ) {
            seenEnvelopeIds.add(mainEnvelopeId);
            pushMainEnvelopeDocumentRows(rows, {
                envelopeId: mainEnvelopeId,
                contractStatus: (contract as { status?: unknown }).status,
                documentStatus: doc?.status,
                sentAt: doc?.sentAt ?? doc?.updatedAt ?? null,
                isCurrent: true,
                packageMeta: mainSendPackage,
                keyPrefix: "current-contract",
                funderName:
                    String((contract as { funderName?: unknown }).funderName ?? "").trim() ||
                    null,
            });
        }
    }

    const contractHistoryNewestFirst = [...contractHistory].reverse();
    contractHistoryNewestFirst.forEach((entry, index) => {
        if (seenEnvelopeIds.has(entry.envelopeId)) return;
        if (
            !isContractRowVisibleInSendTable(
                entry.status,
                entry.status,
                entry.envelopeId,
                entry.sentAt ?? entry.archivedAt,
            )
        ) {
            return;
        }
        seenEnvelopeIds.add(entry.envelopeId);
        const sendNumber = contractHistory.length - index;
        const fromDocHistory = parseDocumentSendHistory(prefill).find(
            (h) => String(h.envelopeId ?? "").trim() === entry.envelopeId,
        );
        const docSnap =
            fromDocHistory &&
            (fromDocHistory as { termsSnapshot?: ContractSendHistoryTermsSnapshot | null })
                .termsSnapshot
                ? (fromDocHistory as { termsSnapshot?: ContractSendHistoryTermsSnapshot | null })
                      .termsSnapshot
                : null;
        pushMainEnvelopeDocumentRows(rows, {
            envelopeId: entry.envelopeId,
            contractStatus: entry.status,
            documentStatus: entry.status,
            sentAt: entry.sentAt ?? entry.archivedAt ?? null,
            isCurrent: false,
            packageMeta: entry.package,
            keyPrefix: "history-contract",
            historyCount: contractHistory.length,
            sendNumber,
            funderName: entry.funderName,
            funderProfileId: entry.funderProfileId,
            termsSnapshot: entry.termsSnapshot ?? docSnap ?? null,
        });
    });

    const envelopeByMappingId = parseDocumentTemplateEnvelopeByMappingId(prefill);
    const achAliasMeta = envelopeByMappingId[ACH_PREFILL_MAPPING_ALIAS_KEY];
    const achAliasEnvelopeId = String(achAliasMeta?.envelopeId ?? "").trim() || null;

    const resolveAchDisplayCapsuleStatus = (
        envelopeId: string,
        preferred?: AchAuthorizationDocuSignCapsuleStatus | string | null,
    ): AchAuthorizationDocuSignCapsuleStatus => {
        const fromDoc = documentAchHistory.find(
            (h) => String(h.envelopeId ?? "").trim() === envelopeId,
        );
        const preferredMapped = preferred
            ? mapInternalEnvelopeStatusToAchCapsule(preferred)
            : undefined;
        // Prefer non-draft history when capsule/alias is still stuck on DRAFT.
        if (
            (!preferredMapped || preferredMapped === "DRAFT") &&
            fromDoc?.status &&
            !isAchEnvelopeDraftLikeStatus(fromDoc.status)
        ) {
            return mapInternalEnvelopeStatusToAchCapsule(fromDoc.status);
        }
        return preferredMapped ?? mapInternalEnvelopeStatusToAchCapsule(fromDoc?.status ?? "DRAFT");
    };

    if (achEnvelopeId && !seenEnvelopeIds.has(achEnvelopeId)) {
        const status = resolveAchDisplayCapsuleStatus(achEnvelopeId, achCurrent?.status);
        if (isAchRowVisibleInSendTable(status, achEnvelopeId, achCurrent?.sentAt ?? achCurrent?.updatedAt)) {
            seenEnvelopeIds.add(achEnvelopeId);
            rows.push({
                rowType: "ach",
                key: `current-ach-${achEnvelopeId}`,
                label: "ACH Authorization",
                envelopeId: achEnvelopeId,
                contractStatus: status,
                documentStatus: status,
                sentAt: achCurrent?.sentAt ?? achCurrent?.updatedAt ?? null,
                isCurrent: true,
                achStatus: status,
                documentKind: "ach",
            });
        }
    }

    // Recover current ACH from stable alias when capsule is missing / draft-only.
    if (
        achAliasEnvelopeId &&
        !seenEnvelopeIds.has(achAliasEnvelopeId) &&
        achAliasEnvelopeId !== mainEnvelopeId
    ) {
        const status = resolveAchDisplayCapsuleStatus(
            achAliasEnvelopeId,
            achAliasMeta?.status,
        );
        if (isAchRowVisibleInSendTable(status, achAliasEnvelopeId, achAliasMeta?.updatedAt)) {
            seenEnvelopeIds.add(achAliasEnvelopeId);
            rows.push({
                rowType: "ach",
                key: `current-ach-${achAliasEnvelopeId}`,
                label: "ACH Authorization",
                envelopeId: achAliasEnvelopeId,
                contractStatus: status,
                documentStatus: status,
                sentAt: achAliasMeta?.updatedAt ?? null,
                isCurrent: true,
                achStatus: status,
                documentKind: "ach",
            });
        }
    }

    // Recover current ACH from document send history / mis-linked package capsule.
    if (packageEnvelopeIsAch && packageEnvelopeId && !seenEnvelopeIds.has(packageEnvelopeId)) {
        const fromDoc = documentAchHistory.find(
            (h) => String(h.envelopeId ?? "").trim() === packageEnvelopeId,
        );
        const status = resolveAchDisplayCapsuleStatus(
            packageEnvelopeId,
            fromDoc?.status ?? packageCurrent?.status ?? "DRAFT",
        );
        if (
            isAchRowVisibleInSendTable(
                status,
                packageEnvelopeId,
                packageCurrent?.sentAt ?? packageCurrent?.updatedAt ?? fromDoc?.updatedAt,
            )
        ) {
            seenEnvelopeIds.add(packageEnvelopeId);
            rows.push({
                rowType: "ach",
                key: `current-ach-${packageEnvelopeId}`,
                label: "ACH Authorization",
                envelopeId: packageEnvelopeId,
                contractStatus: status,
                documentStatus: status,
                sentAt:
                    packageCurrent?.sentAt ??
                    packageCurrent?.updatedAt ??
                    fromDoc?.updatedAt ??
                    null,
                isCurrent: true,
                achStatus: status,
                documentKind: "ach",
            });
        }
    }

    if (
        packageEnvelopeId &&
        !packageEnvelopeIsAch &&
        !seenEnvelopeIds.has(packageEnvelopeId)
    ) {
        if (
            isPackageRowVisibleInSendTable(
                packageCurrent?.status,
                packageEnvelopeId,
                packageCurrent?.sentAt ?? packageCurrent?.updatedAt,
            )
        ) {
            seenEnvelopeIds.add(packageEnvelopeId);
            pushPackageDocumentRows(rows, {
                envelopeId: packageEnvelopeId,
                status: packageCurrent?.status ?? "DRAFT",
                sentAt: packageCurrent?.sentAt ?? packageCurrent?.updatedAt ?? null,
                isCurrent: true,
                packageMeta: packageCurrent?.package,
                keyPrefix: "current-package",
            });
        }
    }

    const packageHistoryNewestFirst = [...packageHistory].reverse();
    packageHistoryNewestFirst.forEach((entry, index) => {
        if (seenEnvelopeIds.has(entry.envelopeId)) return;
        if (documentAchEnvelopeIds.has(entry.envelopeId)) return;
        if (
            !isPackageRowVisibleInSendTable(
                entry.status,
                entry.envelopeId,
                entry.sentAt ?? entry.archivedAt,
            )
        )
            return;
        seenEnvelopeIds.add(entry.envelopeId);
        const sendNumber = packageHistory.length - index;
        pushPackageDocumentRows(rows, {
            envelopeId: entry.envelopeId,
            status: entry.status,
            sentAt: entry.sentAt ?? entry.archivedAt ?? null,
            isCurrent: false,
            packageMeta: entry.package,
            keyPrefix: "history-package",
            historyCount: packageHistory.length,
            sendNumber,
        });
    });

    const achHistoryNewestFirst = [...achHistory].reverse();
    achHistoryNewestFirst.forEach((entry, index) => {
        if (seenEnvelopeIds.has(entry.envelopeId)) return;
        if (
            !isAchRowVisibleInSendTable(
                entry.status,
                entry.envelopeId,
                entry.sentAt ?? entry.archivedAt,
            )
        )
            return;
        seenEnvelopeIds.add(entry.envelopeId);
        const sendNumber = achHistory.length - index;
        rows.push({
            rowType: "ach",
            key: `history-ach-${entry.envelopeId}`,
            label:
                achHistory.length > 1
                    ? `ACH Authorization (send ${sendNumber})`
                    : "ACH Authorization (prior send)",
            envelopeId: entry.envelopeId,
            contractStatus: entry.status,
            documentStatus: entry.status,
            sentAt: entry.sentAt ?? entry.archivedAt ?? null,
            isCurrent: false,
            achStatus: entry.status,
            documentKind: "ach",
        });
    });

    // FE documentSendHistory ACH rows (covers sends before ACH capsule was linked correctly).
    let hasCurrentAchRow = rows.some((r) => r.rowType === "ach" && r.isCurrent);
    const documentAchNewestFirst = [...documentAchHistory]
        .filter((h) => String(h.envelopeId ?? "").trim())
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    documentAchNewestFirst.forEach((entry, index) => {
        const envelopeId = String(entry.envelopeId ?? "").trim();
        if (!envelopeId || seenEnvelopeIds.has(envelopeId)) return;
        const status = mapInternalEnvelopeStatusToAchCapsule(entry.status);
        if (!isAchRowVisibleInSendTable(status, envelopeId, entry.updatedAt)) return;
        seenEnvelopeIds.add(envelopeId);
        const treatAsCurrent = !hasCurrentAchRow;
        if (treatAsCurrent) hasCurrentAchRow = true;
        const sendNumber = documentAchHistory.length - index;
        rows.push({
            rowType: "ach",
            key: treatAsCurrent ? `current-ach-${envelopeId}` : `history-doc-ach-${envelopeId}`,
            label:
                treatAsCurrent
                    ? "ACH Authorization"
                    : documentAchHistory.length > 1
                      ? `ACH Authorization (send ${sendNumber})`
                      : "ACH Authorization",
            envelopeId,
            contractStatus: status,
            documentStatus: status,
            sentAt: entry.updatedAt ?? null,
            isCurrent: treatAsCurrent,
            achStatus: status,
            documentKind: "ach",
        });
    });

    return rows;
}
