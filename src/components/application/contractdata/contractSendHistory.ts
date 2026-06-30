import {
    formatAchAuthorizationCapsuleLabel,
    parseAchAuthorizationDocuSignFromPrefill,
    parseAchSendHistoryFromPrefill,
    type AchAuthorizationDocuSignCapsuleStatus,
} from "./achAuthorizationDocuSign";
import {
    formatStandalonePackageSendLabel,
    formatStandalonePackageTableStatusLabel,
    parseStandalonePackageDocuSignFromPrefill,
    parseStandalonePackageSendHistoryFromPrefill,
    type StandalonePackageDocuSignCapsuleStatus,
    type StandalonePackageDocuSignMeta,
} from "./standalonePackageDocuSign";

/** Prior main-contract DocuSign sends — stored on `Contract.contractPrefillOverrides`. */
export const CONTRACT_SEND_HISTORY_KEY = "contractSendHistory";

export type ContractSendHistoryEntry = {
    envelopeId: string;
    status: string;
    sentAt?: string | null;
    completedAt?: string | null;
    archivedAt: string;
};

export type ContractSendTableRowKind = "contract" | "ach" | "package";

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
};

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
    if (meta.status === "DRAFT") return "Draft";
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
 * Sent or viewed but not fully signed — void before sending again.
 * Optional sessionSentAt covers the modal session before webhook refresh.
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

/** Draft, voided, or never sent — open Review & send (not while out for signature or signed). */
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

/** Resend only after the contract is fully signed. */
export function canResendMainContract(
    contract: Record<string, unknown> | null | undefined,
): boolean {
    if (!contract) return false;
    const doc = pickContractEnvelopeDocument(contract);
    return isContractFullySigned(
        (contract as { status?: unknown }).status,
        doc?.status,
    );
}

/** Current (or only) main-contract row from the send-history table. */
export function resolveMainContractSendTableRow(
    contract: Record<string, unknown> | null | undefined,
): ContractSendTableRow | null {
    const rows = buildContractSendTableRows(contract);
    return (
        rows.find((row) => row.rowType === "contract" && row.isCurrent) ??
        rows.find((row) => row.rowType === "contract") ??
        null
    );
}

/**
 * Main contract may be sent again after a full sign or a void/declined/expired envelope.
 * Uses CRM contract + document status and the send-history table (when CRM lags DocuSign).
 */
export function canSendMainContractAgain(
    contract: Record<string, unknown> | null | undefined,
): boolean {
    if (!contract) return false;
    const doc = pickContractEnvelopeDocument(contract);
    const contractStatus = (contract as { status?: unknown }).status;
    const documentStatus = doc?.status;

    if (canResendMainContract(contract)) return true;
    if (isContractVoidedOrTerminal(contractStatus, documentStatus)) return true;

    const mainRow = resolveMainContractSendTableRow(contract);
    if (mainRow) {
        if (isContractSendTableRowFullySigned(mainRow)) return true;
        if (isContractSendTableRowVoided(mainRow)) return true;
    }
    return false;
}

/** True when the main contract envelope is still out for signature (void before resend). */
export function isMainContractOutForSignature(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt?: Date | null,
): boolean {
    return canVoidMainContract(contract, sessionSentAt);
}

/** A main-contract send-history row that is fully signed or voided/terminal — eligible for a new send. */
export function canResendContractSendTableRow(
    row: ContractSendTableRow | null | undefined,
): boolean {
    if (!row || row.rowType !== "contract") return false;
    return isContractSendTableRowFullySigned(row) || isContractSendTableRowVoided(row);
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
        out.push({
            envelopeId,
            status: String(o.status ?? "draft").trim().toLowerCase(),
            sentAt: o.sentAt != null ? String(o.sentAt) : null,
            completedAt: o.completedAt != null ? String(o.completedAt) : null,
            archivedAt: String(o.archivedAt ?? ""),
        });
    }
    return out;
}

/** Contracts Generated table — only envelopes that left DocuSign draft. */
function isContractRowVisibleInSendTable(
    contractStatus: unknown,
    documentStatus?: unknown,
    envelopeId?: string | null,
): boolean {
    if (!String(envelopeId ?? "").trim()) return false;
    const ds = String(documentStatus ?? "").trim().toLowerCase();
    const cs = String(contractStatus ?? "").trim().toUpperCase();
    if (ds === "draft" || ds === "created" || cs === "DRAFT") return false;
    if (!ds && (cs === "DRAFT" || cs === "GENERATED" || !cs)) return false;
    return true;
}

function isAchRowVisibleInSendTable(
    status: AchAuthorizationDocuSignCapsuleStatus | undefined,
    envelopeId?: string | null,
): boolean {
    if (!String(envelopeId ?? "").trim()) return false;
    return Boolean(status && status !== "DRAFT");
}

function isPackageRowVisibleInSendTable(
    status: StandalonePackageDocuSignCapsuleStatus | undefined,
    envelopeId?: string | null,
): boolean {
    if (!String(envelopeId ?? "").trim()) return false;
    return Boolean(status && status !== "DRAFT");
}

function buildStandalonePackageHistoryLabel(
    packageMeta: StandalonePackageDocuSignMeta["package"] | undefined,
    historyCount: number,
    sendNumber: number,
): string {
    const base = formatStandalonePackageSendLabel(packageMeta);
    if (historyCount <= 1) return `${base} (prior send)`;
    return `${base} (send ${sendNumber})`;
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
    if (ds === "completed" || cs === "COMPLETED" || cs === "SIGNED") return "Signed";
    if (ds === "viewed" || ds === "delivered" || cs === "VIEWED") return "Viewed";
    if (ds === "sent" || cs === "SENT") return "Sent";
    if (ds === "draft" || ds === "created" || cs === "DRAFT") return "Draft";
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
    return cs || ds || "Pending";
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
    if (!row?.isCurrent || !String(row.envelopeId ?? "").trim()) return false;
    if (row.rowType === "contract") {
        return canVoidMainContract(contract, sessionSentAt);
    }
    if (row.rowType === "ach") {
        const status = row.achStatus ?? "DRAFT";
        return status === "DRAFT" || status === "SENT" || status === "VIEWED";
    }
    if (row.rowType === "package") {
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

    const seenEnvelopeIds = new Set<string>();
    const rows: ContractSendTableRow[] = [];

    const mainEnvelopeIsAchOnly = Boolean(
        mainEnvelopeId && achEnvelopeId && mainEnvelopeId === achEnvelopeId,
    );
    const mainEnvelopeIsPackageOnly = Boolean(
        mainEnvelopeId && packageEnvelopeId && mainEnvelopeId === packageEnvelopeId,
    );

    if (mainEnvelopeId && !mainEnvelopeIsAchOnly && !mainEnvelopeIsPackageOnly) {
        if (
            isContractRowVisibleInSendTable(
                (contract as { status?: unknown }).status,
                doc?.status,
                mainEnvelopeId,
            )
        ) {
            seenEnvelopeIds.add(mainEnvelopeId);
            rows.push({
                rowType: "contract",
                key: `current-contract-${mainEnvelopeId}`,
                label: "Contract",
                envelopeId: mainEnvelopeId,
                contractStatus: (contract as { status?: unknown }).status,
                documentStatus: doc?.status,
                sentAt: doc?.sentAt ?? doc?.updatedAt ?? null,
                isCurrent: true,
            });
        }
    }

    const contractHistoryNewestFirst = [...contractHistory].reverse();
    contractHistoryNewestFirst.forEach((entry, index) => {
        if (seenEnvelopeIds.has(entry.envelopeId)) return;
        if (!isContractRowVisibleInSendTable(entry.status, entry.status, entry.envelopeId)) {
            return;
        }
        seenEnvelopeIds.add(entry.envelopeId);
        const sendNumber = contractHistory.length - index;
        rows.push({
            rowType: "contract",
            key: `history-contract-${entry.envelopeId}`,
            label:
                contractHistory.length > 1
                    ? `Contract (send ${sendNumber})`
                    : "Contract (prior send)",
            envelopeId: entry.envelopeId,
            contractStatus: entry.status,
            documentStatus: entry.status,
            sentAt: entry.sentAt ?? entry.archivedAt ?? null,
            isCurrent: false,
        });
    });

    if (achEnvelopeId && !seenEnvelopeIds.has(achEnvelopeId)) {
        if (isAchRowVisibleInSendTable(achCurrent?.status, achEnvelopeId)) {
            seenEnvelopeIds.add(achEnvelopeId);
            rows.push({
                rowType: "ach",
                key: `current-ach-${achEnvelopeId}`,
                label: "ACH Authorization",
                envelopeId: achEnvelopeId,
                contractStatus: achCurrent?.status,
                documentStatus: achCurrent?.status,
                sentAt: achCurrent?.sentAt ?? achCurrent?.updatedAt ?? null,
                isCurrent: true,
                achStatus: achCurrent?.status ?? "DRAFT",
            });
        }
    }

    if (packageEnvelopeId && !seenEnvelopeIds.has(packageEnvelopeId)) {
        if (isPackageRowVisibleInSendTable(packageCurrent?.status, packageEnvelopeId)) {
            seenEnvelopeIds.add(packageEnvelopeId);
            rows.push({
                rowType: "package",
                key: `current-package-${packageEnvelopeId}`,
                label: formatStandalonePackageSendLabel(packageCurrent?.package),
                envelopeId: packageEnvelopeId,
                contractStatus: packageCurrent?.status,
                documentStatus: packageCurrent?.status,
                sentAt: packageCurrent?.sentAt ?? packageCurrent?.updatedAt ?? null,
                isCurrent: true,
                packageStatus: packageCurrent?.status ?? "DRAFT",
            });
        }
    }

    const packageHistoryNewestFirst = [...packageHistory].reverse();
    packageHistoryNewestFirst.forEach((entry, index) => {
        if (seenEnvelopeIds.has(entry.envelopeId)) return;
        if (!isPackageRowVisibleInSendTable(entry.status, entry.envelopeId)) return;
        seenEnvelopeIds.add(entry.envelopeId);
        const sendNumber = packageHistory.length - index;
        rows.push({
            rowType: "package",
            key: `history-package-${entry.envelopeId}`,
            label: buildStandalonePackageHistoryLabel(
                entry.package,
                packageHistory.length,
                sendNumber,
            ),
            envelopeId: entry.envelopeId,
            contractStatus: entry.status,
            documentStatus: entry.status,
            sentAt: entry.sentAt ?? entry.archivedAt ?? null,
            isCurrent: false,
            packageStatus: entry.status,
        });
    });

    const achHistoryNewestFirst = [...achHistory].reverse();
    achHistoryNewestFirst.forEach((entry, index) => {
        if (seenEnvelopeIds.has(entry.envelopeId)) return;
        if (!isAchRowVisibleInSendTable(entry.status, entry.envelopeId)) return;
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
        });
    });

    return rows;
}
