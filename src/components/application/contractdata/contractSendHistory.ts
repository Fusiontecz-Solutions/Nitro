/** Prior main-contract DocuSign sends — stored on `Contract.contractPrefillOverrides`. */
export const CONTRACT_SEND_HISTORY_KEY = "contractSendHistory";

export type ContractSendHistoryEntry = {
    envelopeId: string;
    status: string;
    sentAt?: string | null;
    completedAt?: string | null;
    archivedAt: string;
};

export type ContractSendTableRow = {
    key: string;
    label: string;
    envelopeId: string | null;
    contractStatus: unknown;
    documentStatus: unknown;
    sentAt: unknown;
    isCurrent: boolean;
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

export function buildContractSendTableRows(
    contract: Record<string, unknown> | null | undefined,
): ContractSendTableRow[] {
    if (!contract) return [];

    const history = parseContractSendHistoryFromPrefill(contract.contractPrefillOverrides);
    const doc = pickContractEnvelopeDocument(contract);
    const currentEid = String(doc?.envelopeId ?? "").trim();
    const contractId = Number((contract as { id?: unknown }).id);
    const hasContractRecord = Number.isFinite(contractId) && contractId > 0;

    const rows: ContractSendTableRow[] = [];

    if (hasContractRecord) {
        rows.push({
            key: `current-${currentEid || contractId}`,
            label: "Contract",
            envelopeId: currentEid || null,
            contractStatus: (contract as { status?: unknown }).status,
            documentStatus: doc?.status,
            sentAt: doc?.sentAt ?? doc?.updatedAt ?? null,
            isCurrent: true,
        });
    }

    const historyNewestFirst = [...history].reverse();
    historyNewestFirst.forEach((entry, index) => {
        const sendNumber = history.length - index;
        rows.push({
            key: `history-${entry.envelopeId}`,
            label:
                history.length > 1
                    ? `Contract (send ${sendNumber})`
                    : "Contract (prior send)",
            envelopeId: entry.envelopeId,
            contractStatus: entry.status,
            documentStatus: entry.status,
            sentAt: entry.sentAt ?? entry.archivedAt ?? null,
            isCurrent: false,
        });
    });

    return rows;
}
