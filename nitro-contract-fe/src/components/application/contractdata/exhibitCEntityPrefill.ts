/** Multi-entity Exhibit C slots stored on `contractPrefillOverrides.exhibitCEntities` (JSON string). */

import { isMultiInstanceAddendumRef } from "./multiInstanceAddendum";

export const EXHIBIT_C_ENTITIES_PREFILL_KEY = "exhibitCEntities" as const;
export const EXHIBIT_C_ENTITY_MAX = 10;

export type ExhibitCEntityPrefill = {
    id: string;
    /** Merchant / entity legal name on this Exhibit C. */
    clientLegalName: string;
    /** Guarantor / signer name. */
    clientName: string;
    accountHolderName: string;
    accountHolderDba: string;
    accountHolderAddress: string;
    accountHolderCity: string;
    accountHolderState: string;
    accountHolderZip: string;
    bankName: string;
    bankAccount: string;
    bankRouting: string;
    bankPortal: string;
    bankUsername: string;
    bankPassword: string;
    securityQa1: string;
    securityQa2: string;
    agreementDate: string;
};

export const EXHIBIT_C_ENTITY_FIELD_DEFS: Array<{
    key: keyof Omit<ExhibitCEntityPrefill, "id">;
    label: string;
    group: string;
}> = [
    { key: "agreementDate", label: "Agreement date", group: "Account" },
    { key: "clientLegalName", label: "Entity / merchant legal name", group: "Account" },
    { key: "clientName", label: "Guarantor name", group: "Account" },
    { key: "accountHolderName", label: "Account holder name", group: "Account" },
    { key: "accountHolderDba", label: "Account holder DBA", group: "Account" },
    { key: "accountHolderAddress", label: "Account holder street", group: "Account" },
    { key: "accountHolderCity", label: "City", group: "Account" },
    { key: "accountHolderState", label: "State", group: "Account" },
    { key: "accountHolderZip", label: "ZIP", group: "Account" },
    { key: "bankName", label: "Bank name", group: "Bank" },
    { key: "bankAccount", label: "Bank account number", group: "Bank" },
    { key: "bankRouting", label: "Routing number", group: "Bank" },
    { key: "bankPortal", label: "Bank portal website", group: "Online banking" },
    { key: "bankUsername", label: "Account username", group: "Online banking" },
    { key: "bankPassword", label: "Bank account password", group: "Online banking" },
    { key: "securityQa1", label: "Security Q/A 1", group: "Online banking" },
    { key: "securityQa2", label: "Security Q/A 2", group: "Online banking" },
];

function str(v: unknown): string {
    return String(v ?? "").trim();
}

function normName(v: unknown): string {
    return str(v).toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ");
}

export function createEmptyExhibitCEntity(
    partial?: Partial<ExhibitCEntityPrefill>,
): ExhibitCEntityPrefill {
    return {
        id:
            str(partial?.id) ||
            `exhibit-c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        clientLegalName: str(partial?.clientLegalName),
        clientName: str(partial?.clientName),
        accountHolderName: str(partial?.accountHolderName),
        accountHolderDba: str(partial?.accountHolderDba),
        accountHolderAddress: str(partial?.accountHolderAddress),
        accountHolderCity: str(partial?.accountHolderCity),
        accountHolderState: str(partial?.accountHolderState),
        accountHolderZip: str(partial?.accountHolderZip),
        bankName: str(partial?.bankName),
        bankAccount: str(partial?.bankAccount),
        bankRouting: str(partial?.bankRouting),
        bankPortal: str(partial?.bankPortal),
        bankUsername: str(partial?.bankUsername),
        bankPassword: str(partial?.bankPassword),
        securityQa1: str(partial?.securityQa1),
        securityQa2: str(partial?.securityQa2),
        agreementDate: str(partial?.agreementDate),
    };
}

export function parseExhibitCEntities(raw: unknown): ExhibitCEntityPrefill[] {
    if (raw == null) return [];
    let parsed: unknown = raw;
    if (typeof raw === "string") {
        const s = raw.trim();
        if (!s) return [];
        try {
            parsed = JSON.parse(s);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter((row) => row && typeof row === "object" && !Array.isArray(row))
        .map((row) => createEmptyExhibitCEntity(row as Partial<ExhibitCEntityPrefill>))
        .slice(0, EXHIBIT_C_ENTITY_MAX);
}

export function serializeExhibitCEntities(entities: readonly ExhibitCEntityPrefill[]): string {
    const cleaned = entities
        .map((e) => createEmptyExhibitCEntity(e))
        .slice(0, EXHIBIT_C_ENTITY_MAX);
    // Keep empty middle slots so Exhibit C (2)/(3) indices stay stable; only
    // drop trailing empties.
    let end = cleaned.length;
    while (end > 0 && !exhibitCEntityHasData(cleaned[end - 1])) end -= 1;
    const kept = cleaned.slice(0, Math.max(end, 0));
    return kept.length ? JSON.stringify(kept) : "";
}

export function exhibitCEntityHasData(entity: ExhibitCEntityPrefill | null | undefined): boolean {
    if (!entity) return false;
    return Boolean(
        entity.clientLegalName ||
            entity.accountHolderName ||
            entity.bankAccount ||
            entity.bankRouting ||
            entity.bankName ||
            entity.accountHolderDba ||
            entity.clientName ||
            entity.accountHolderAddress,
    );
}

function tabPick(tabs: Record<string, string>, ...keys: string[]): string {
    for (const key of keys) {
        const v = str(tabs[key]);
        if (v) return v;
        const bare = key.replace(/_p1$/i, "");
        if (bare !== key) {
            const v2 = str(tabs[bare]);
            if (v2) return v2;
        }
    }
    return "";
}

/**
 * True when an Exhibit C legal name is only an echo of the deal's merchant legal name.
 *
 * Every Exhibit C is its own entity and starts blank. An older build seeded the
 * first slot with the application's legal name, and that value was saved into
 * `exhibitCEntities` and the copy's tab — so the echo kept coming back on every
 * Exhibit C as if someone had typed it.
 */
export function isDealLegalNameEcho(value: unknown, dealLegalName: unknown): boolean {
    const v = normName(value);
    return Boolean(v) && v === normName(dealLegalName);
}

/** Blank an entity's legal name when it only echoes the deal's merchant legal name. */
export function withoutDealLegalNameEcho(
    entity: ExhibitCEntityPrefill,
    dealLegalName: unknown,
): ExhibitCEntityPrefill {
    return isDealLegalNameEcho(entity.clientLegalName, dealLegalName)
        ? { ...entity, clientLegalName: "" }
        : entity;
}

/** Build / update an Exhibit C entity slot from a mapping prefill tab map. */
export function exhibitCEntityFromTabValues(
    tabs: Record<string, string>,
    existing?: ExhibitCEntityPrefill | null,
): ExhibitCEntityPrefill {
    return createEmptyExhibitCEntity({
        id: existing?.id,
        agreementDate: tabPick(tabs, "agreement_date_p1", "agreement_date"),
        clientLegalName: tabPick(tabs, "client_legal_name_p1", "client_legal_name", "legal_name"),
        clientName: tabPick(tabs, "client_name_p1", "client_name"),
        accountHolderName: tabPick(
            tabs,
            "ach_account_holder_name_p1",
            "ach_account_holder_name",
            "ach_authorization_account_holder_name",
        ),
        // Not `doing_business_as`: that is the deal-wide D/B/A key other
        // addendums' saves push into every tab.
        accountHolderDba: tabPick(tabs, "ach_account_holder_dba_p1", "ach_account_holder_dba"),
        accountHolderAddress: tabPick(
            tabs,
            "ach_account_holder_address_p1",
            "ach_account_holder_address",
        ),
        bankName: tabPick(tabs, "ach_bank_name_p1", "ach_bank_name"),
        bankAccount: tabPick(tabs, "ach_bank_account_p1", "ach_bank_account"),
        bankRouting: tabPick(tabs, "ach_bank_routing_p1", "ach_bank_routing"),
        bankPortal: tabPick(tabs, "ach_bank_portal_p1", "ach_bank_portal"),
        bankUsername: tabPick(tabs, "ach_username_p1", "ach_username"),
        bankPassword: tabPick(tabs, "ach_password_p1", "ach_password"),
        securityQa1: tabPick(tabs, "ach_security_q1_p1", "ach_security_q1"),
        securityQa2: tabPick(tabs, "ach_security_q2_p1", "ach_security_q2"),
    });
}

/** Write an Exhibit C entity into SignNow / mapping tab ids for DB persistence. */
export function exhibitCEntityToTabValues(
    entity: ExhibitCEntityPrefill | null | undefined,
): Record<string, string> {
    if (!entity) return {};
    const e = createEmptyExhibitCEntity(entity);
    return {
        agreement_date: e.agreementDate,
        agreement_date_p1: e.agreementDate,
        client_legal_name: e.clientLegalName,
        client_legal_name_p1: e.clientLegalName,
        legal_name: e.clientLegalName,
        client_name: e.clientName,
        client_name_p1: e.clientName,
        ach_account_holder_name: e.accountHolderName,
        ach_account_holder_name_p1: e.accountHolderName,
        ach_authorization_account_holder_name: e.accountHolderName,
        ach_account_holder_dba: e.accountHolderDba,
        ach_account_holder_dba_p1: e.accountHolderDba,
        doing_business_as: e.accountHolderDba,
        ach_account_holder_address: e.accountHolderAddress,
        ach_account_holder_address_p1: e.accountHolderAddress,
        ach_bank_name: e.bankName,
        ach_bank_name_p1: e.bankName,
        ach_bank_account: e.bankAccount,
        ach_bank_account_p1: e.bankAccount,
        ach_bank_routing: e.bankRouting,
        ach_bank_routing_p1: e.bankRouting,
        ach_bank_portal: e.bankPortal,
        ach_bank_portal_p1: e.bankPortal,
        ach_username: e.bankUsername,
        ach_username_p1: e.bankUsername,
        ach_password: e.bankPassword,
        ach_password_p1: e.bankPassword,
        ach_security_q1: e.securityQa1,
        ach_security_q1_p1: e.securityQa1,
        ach_security_q2: e.securityQa2,
        ach_security_q2_p1: e.securityQa2,
    };
}

/** Pad empty entity slots so index i matches Exhibit C / Exhibit C (i+1) documents. */
export function padExhibitCEntitiesToCount(
    entities: readonly ExhibitCEntityPrefill[],
    count: number,
): ExhibitCEntityPrefill[] {
    const want = Math.max(0, Math.min(EXHIBIT_C_ENTITY_MAX, Math.floor(count)));
    const next = entities.map((e) => createEmptyExhibitCEntity(e));
    while (next.length < want) next.push(createEmptyExhibitCEntity());
    return next.slice(0, Math.max(next.length, want));
}

/** Ensure `entities[index]` exists (padding empty slots) and replace that slot. */
export function upsertExhibitCEntityAtIndex(
    entities: readonly ExhibitCEntityPrefill[],
    index: number,
    entity: ExhibitCEntityPrefill,
): ExhibitCEntityPrefill[] {
    const idx = Math.max(0, Math.min(EXHIBIT_C_ENTITY_MAX - 1, Math.floor(index)));
    const next = entities.map((e) => createEmptyExhibitCEntity(e));
    while (next.length <= idx) next.push(createEmptyExhibitCEntity());
    next[idx] = createEmptyExhibitCEntity({ ...entity, id: entity.id || next[idx]?.id });
    return next.slice(0, EXHIBIT_C_ENTITY_MAX);
}

export function exhibitCEntitiesFromPrefill(
    prefill: Record<string, unknown> | null | undefined,
): ExhibitCEntityPrefill[] {
    if (!prefill || typeof prefill !== "object") return [];
    return parseExhibitCEntities(prefill[EXHIBIT_C_ENTITIES_PREFILL_KEY]);
}

export function namesDiffer(a: unknown, b: unknown): boolean {
    const left = normName(a);
    const right = normName(b);
    if (!left || !right) return Boolean(left || right);
    return left !== right;
}

/** True when void-check / ACH holder should become its own Exhibit C entity. */
export function shouldCreateExhibitCEntityForAccountHolder(
    accountHolderName: unknown,
    businessLegalName: unknown,
): boolean {
    const holder = str(accountHolderName);
    if (!holder) return false;
    const business = str(businessLegalName);
    if (!business) return true;
    return namesDiffer(holder, business);
}

export type VoidCheckExhibitCSource = {
    accountHolderName?: string;
    dba?: string;
    bankName?: string;
    accountNumber?: string;
    routingNumber?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
};

/** Upsert an Exhibit C entity from void-check ACH panels (match by account holder or bank account). */
export function upsertExhibitCEntityFromVoidCheck(
    existing: readonly ExhibitCEntityPrefill[],
    source: VoidCheckExhibitCSource,
): ExhibitCEntityPrefill[] {
    const holder = str(source.accountHolderName);
    const account = str(source.accountNumber);
    if (!holder && !account && !str(source.routingNumber)) {
        return [...existing];
    }

    const next = createEmptyExhibitCEntity({
        clientLegalName: holder,
        accountHolderName: holder,
        accountHolderDba: str(source.dba),
        accountHolderAddress: str(source.address),
        accountHolderCity: str(source.city),
        accountHolderState: str(source.state),
        accountHolderZip: str(source.zip),
        bankName: str(source.bankName),
        bankAccount: account,
        bankRouting: str(source.routingNumber),
    });

    const matchIdx = existing.findIndex((row) => {
        if (account && str(row.bankAccount) === account) return true;
        if (holder && normName(row.accountHolderName) === normName(holder)) return true;
        if (holder && normName(row.clientLegalName) === normName(holder)) return true;
        return false;
    });

    if (matchIdx >= 0) {
        const prev = existing[matchIdx];
        const merged = createEmptyExhibitCEntity({
            ...prev,
            clientLegalName: next.clientLegalName || prev.clientLegalName,
            accountHolderName: next.accountHolderName || prev.accountHolderName,
            accountHolderDba: next.accountHolderDba || prev.accountHolderDba,
            accountHolderAddress: next.accountHolderAddress || prev.accountHolderAddress,
            accountHolderCity: next.accountHolderCity || prev.accountHolderCity,
            accountHolderState: next.accountHolderState || prev.accountHolderState,
            accountHolderZip: next.accountHolderZip || prev.accountHolderZip,
            bankName: next.bankName || prev.bankName,
            bankAccount: next.bankAccount || prev.bankAccount,
            bankRouting: next.bankRouting || prev.bankRouting,
        });
        return existing.map((row, i) => (i === matchIdx ? merged : row));
    }

    if (existing.length >= EXHIBIT_C_ENTITY_MAX) return [...existing];
    return [...existing, next];
}

export function exhibitCEntitySectionId(index: number): string {
    return `exhibit_c_entity_${index + 1}`;
}

function parseMappingPrefillBlob(raw: unknown): Record<string, Record<string, string>> {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const blob = (raw as Record<string, unknown>).documentTemplatePrefillByMappingId;
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return {};
    const out: Record<string, Record<string, string>> = {};
    for (const [mappingId, row] of Object.entries(blob)) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const inner: Record<string, string> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
            inner[k] = String(v ?? "");
        }
        out[mappingId] = inner;
    }
    return out;
}

/** Merge saved mapping blobs into entity slots so SignNow gets every Exhibit C copy. */
export function mergeExhibitCEntitiesForSignNowSend(args: {
    rawOverrides: unknown;
    mappingRows?: Array<{
        id?: string;
        template?: {
            name?: string | null;
            layoutKey?: string | null;
            templateId?: string | null;
        } | null;
    }>;
}): ExhibitCEntityPrefill[] {
    const overrides =
        args.rawOverrides &&
        typeof args.rawOverrides === "object" &&
        !Array.isArray(args.rawOverrides)
            ? (args.rawOverrides as Record<string, unknown>)
            : {};
    const existing = exhibitCEntitiesFromPrefill(overrides);
    const blob = parseMappingPrefillBlob(overrides);
    const exhibitRows = (args.mappingRows ?? []).filter((row) =>
        isMultiInstanceAddendumRef(
            row.template?.layoutKey || row.template?.templateId || "",
            row.template?.name,
        ),
    );
    const next = padExhibitCEntitiesToCount(
        existing,
        Math.max(existing.length, exhibitRows.length),
    );
    for (let i = 0; i < exhibitRows.length; i++) {
        const mappingId = String(exhibitRows[i]?.id ?? "").trim();
        if (!mappingId) continue;
        const fromTabs = exhibitCEntityFromTabValues(blob[mappingId] ?? {}, next[i]);
        const prev = next[i];
        // A saved entity is this copy's record: its blank lines stay blank. The
        // tab is only a fallback for a copy that has no record yet — other
        // addendums' saves pushed the deal's DBA / bank into it.
        if (exhibitCEntityHasData(prev)) {
            if (!prev.agreementDate && fromTabs.agreementDate) {
                next[i] = { ...prev, agreementDate: fromTabs.agreementDate };
            }
            continue;
        }
        next[i] = createEmptyExhibitCEntity({
            id: prev.id || fromTabs.id,
            agreementDate: prev.agreementDate || fromTabs.agreementDate,
            clientLegalName: prev.clientLegalName || fromTabs.clientLegalName,
            clientName: prev.clientName || fromTabs.clientName,
            accountHolderName: prev.accountHolderName || fromTabs.accountHolderName,
            accountHolderDba: prev.accountHolderDba || fromTabs.accountHolderDba,
            accountHolderAddress: prev.accountHolderAddress || fromTabs.accountHolderAddress,
            accountHolderCity: prev.accountHolderCity || fromTabs.accountHolderCity,
            accountHolderState: prev.accountHolderState || fromTabs.accountHolderState,
            accountHolderZip: prev.accountHolderZip || fromTabs.accountHolderZip,
            bankName: prev.bankName || fromTabs.bankName,
            bankAccount: prev.bankAccount || fromTabs.bankAccount,
            bankRouting: prev.bankRouting || fromTabs.bankRouting,
            bankPortal: prev.bankPortal || fromTabs.bankPortal,
            bankUsername: prev.bankUsername || fromTabs.bankUsername,
            bankPassword: prev.bankPassword || fromTabs.bankPassword,
            securityQa1: prev.securityQa1 || fromTabs.securityQa1,
            securityQa2: prev.securityQa2 || fromTabs.securityQa2,
        });
    }
    return next;
}

export function parseExhibitCEntitySectionIndex(sectionId: string): number | null {
    const m = String(sectionId || "").match(/^exhibit_c_entity_(\d+)$/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1) return null;
    return n - 1;
}

export function exhibitCEntityNavTitle(entity: ExhibitCEntityPrefill, index: number): string {
    const name = str(entity.accountHolderName) || str(entity.clientLegalName);
    if (name) return `Exhibit C — ${name}`;
    return `Exhibit C — Entity ${index + 1}`;
}
