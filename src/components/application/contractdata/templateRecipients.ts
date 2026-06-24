/** Shared parsing for `/docusign/template/recipients` and legacy BoldSign shapes. */

export function firstNonEmptyString(...values: unknown[]): string {
    for (const v of values) {
        if (typeof v === "string" && v.trim().length > 0) {
            return v.trim();
        }
    }
    return "";
}

/**
 * Recipients API / Redux `templateRecipients` shapes vary: top-level `roles`,
 * `data.roles`, PascalCase, DocuSign `raw.recipients.signers`, or BoldSign `raw.roles`.
 */
export function parseBoldSignTemplateRolesFromRecipientsPayload(
    payload: unknown,
): Array<Record<string, unknown>> {
    if (!payload || typeof payload !== "object") {
        return [];
    }
    const p = payload as Record<string, unknown>;
    const data = (p.data as Record<string, unknown>) ?? p;
    const innerRaw =
        data.raw && typeof data.raw === "object"
            ? (data.raw as Record<string, unknown>)
            : null;

    const rawRecipients =
        innerRaw?.recipients && typeof innerRaw.recipients === "object"
            ? (innerRaw.recipients as Record<string, unknown>)
            : null;

    const candidates: unknown[] = [
        data.roles,
        data.Roles,
        data.Signers,
        p.roles,
        p.Roles,
        p.Signers,
        innerRaw?.roles,
        innerRaw?.Roles,
        innerRaw?.Signers,
        rawRecipients?.signers,
        rawRecipients?.Signers,
    ];

    for (const arr of candidates) {
        if (
            Array.isArray(arr) &&
            arr.length > 0 &&
            typeof arr[0] === "object" &&
            arr[0] !== null
        ) {
            return arr as Array<Record<string, unknown>>;
        }
    }
    return [];
}

export function getTemplateRoleLabel(row: Record<string, unknown>): string {
    return (
        firstNonEmptyString(
            row.roleName,
            row.RoleName,
            row.name,
            row.Name,
            row.signerRole,
            row.SignerRole,
        ) || "Role"
    );
}

export function getTemplateRoleEmailFromRow(row: Record<string, unknown>): string {
    const nestedSigner =
        row.signer && typeof row.signer === "object"
            ? (row.signer as Record<string, unknown>)
            : row.Signer && typeof row.Signer === "object"
              ? (row.Signer as Record<string, unknown>)
              : null;

    return firstNonEmptyString(
        row.signerEmail,
        row.SignerEmail,
        row.defaultSignerEmail,
        row.DefaultSignerEmail,
        row.email,
        row.Email,
        nestedSigner?.email,
        nestedSigner?.Email,
    );
}

import {
    DOCUSIGN_DEFAULT_SIGNER_ROLE,
    DOCUSIGN_PRIMARY_SIGNER_ROLE,
} from "./docusignTemplateConfig";

/** Role payload for `/docusign/send-template` and sync-envelope-cc. */
export type DocuSignTemplateRolePayload = {
    roleIndex: number;
    signerName: string;
    signerOrder: number;
    signerEmail: string;
    signerRole: string;
    privateMessage?: string;
    authenticationCode?: string;
    authenticationType?: "AccessCode";
    deliveryMode?: "Email";
    signerType?: "signer";
    locale?: "EN";
};

/** CRM-only signer rows (this send) — does not modify the DocuSign template. */
export type ContractSignerOverrideRow = {
    role: string;
    name: string;
    email: string;
};

function normalizeSignerEmail(email: string): string {
    return String(email || "").trim().toLowerCase();
}

/** Drop duplicate signer slots (same email, or same name when email is blank). */
export function dedupeContractSignerRows(
    rows: ContractSignerOverrideRow[],
): ContractSignerOverrideRow[] {
    const seen = new Set<string>();
    const out: ContractSignerOverrideRow[] = [];
    for (const row of rows) {
        const email = normalizeSignerEmail(row.email);
        const name = String(row.name || "").trim().toLowerCase();
        const key = email || (name ? `name:${name}` : "");
        if (key) {
            if (seen.has(key)) continue;
            seen.add(key);
        }
        out.push(row);
    }
    return out;
}

/** Persisted on `Contract.contractPrefillOverrides` (excluded from main prefill form). */
export const CONTRACT_SIGNER_OVERRIDES_KEY = "contractSignerOverrides";

type SuggestedSignerParty = {
    ownerFirstName?: string;
    ownerLastName?: string;
    ownerEmail?: string;
    guarantorFirstName?: string;
    guarantorLastName?: string;
    guarantorEmail?: string;
};

/** DocuSign envelope role — CRM display labels (Client, Owner, etc.) map to this on send. */
export function resolveDocuSignSignerRole(_crmRole?: string): string {
    return DOCUSIGN_DEFAULT_SIGNER_ROLE;
}

/** Suggested CRM signer rows (client + owners/guarantors with emails). */
export function buildSuggestedContractSignerRows(input: {
    clientName?: string;
    clientEmail?: string;
    owners?: SuggestedSignerParty[];
    guarantors?: SuggestedSignerParty[];
}): ContractSignerOverrideRow[] {
    const rows: ContractSignerOverrideRow[] = [];
    const clientEmail = String(input.clientEmail || "").trim();
    const clientName = String(input.clientName || "").trim();
    if (clientEmail) {
        rows.push({
            role: resolveDocuSignSignerRole(),
            name: clientName || clientEmail.split("@")[0],
            email: clientEmail,
        });
    }

    let ownerIndex = 0;
    const ownerInputs = input.owners || [];
    for (const o of ownerInputs) {
        const email = String(o.ownerEmail || "").trim();
        const name =
            `${String(o.ownerFirstName || "").trim()} ${String(o.ownerLastName || "").trim()}`.trim();
        if (!email && !name) continue;
        ownerIndex += 1;
        const displayName = name || (email ? email.split("@")[0] : "");
        if (ownerIndex === 1) {
            if (rows.length > 0) {
                const primary = rows[0]!;
                rows[0] = {
                    ...primary,
                    name:
                        displayName ||
                        primary.name ||
                        clientName ||
                        (email ? email.split("@")[0] : ""),
                    email: email || primary.email,
                };
            } else {
                rows.push({
                    role: resolveDocuSignSignerRole(),
                    name: displayName || clientName || (email ? email.split("@")[0] : "Signer"),
                    email: email || clientEmail,
                });
            }
            continue;
        }
        rows.push({
            role: resolveDocuSignSignerRole(),
            name: displayName,
            email,
        });
    }

    /** Two owners on the application → two signer slots (Signer 1 / Signer 2). */
    if (ownerInputs.filter((o) => {
        const email = String(o.ownerEmail || "").trim();
        const name =
            `${String(o.ownerFirstName || "").trim()} ${String(o.ownerLastName || "").trim()}`.trim();
        return Boolean(email || name);
    }).length >= 2 && rows.length < 2) {
        const second = ownerInputs
            .map((o) => ({
                email: String(o.ownerEmail || "").trim(),
                name: `${String(o.ownerFirstName || "").trim()} ${String(o.ownerLastName || "").trim()}`.trim(),
            }))
            .filter((o) => o.email || o.name)[1];
        if (second) {
            rows.push({
                role: resolveDocuSignSignerRole(),
                name: second.name || (second.email ? second.email.split("@")[0] : ""),
                email: second.email,
            });
        }
    }

    let guarantorIndex = 0;
    for (const g of input.guarantors || []) {
        const email = String(g.guarantorEmail || "").trim();
        if (!email) continue;
        guarantorIndex += 1;
        const name =
            `${String(g.guarantorFirstName || "").trim()} ${String(g.guarantorLastName || "").trim()}`.trim() ||
            email.split("@")[0];
        rows.push({
            role: resolveDocuSignSignerRole(),
            name,
            email,
        });
    }

    return dedupeContractSignerRows(rows);
}

export function suggestedRowsToSummaryTemplateRoles(
    rows: ContractSignerOverrideRow[],
): Array<Record<string, unknown>> {
    return rows.map((r, idx) => ({
        roleName: r.role,
        signerEmail: r.email,
        signerName: r.name,
        roleIndex: idx + 1,
    }));
}

/** Resolve persisted CRM signer rows from contract prefill JSON (ignores template-mapping-only blobs). */
export function resolveContractSignerOverrideRows(options: {
    explicit?: ContractSignerOverrideRow[] | null;
    contractPrefillOverrides?: unknown;
    additionalPrefillJson?: unknown;
}): ContractSignerOverrideRow[] | null {
    if (options.explicit?.length) return options.explicit;
    return (
        parseContractSignerOverridesFromPrefill(options.contractPrefillOverrides) ??
        parseContractSignerOverridesFromPrefill(options.additionalPrefillJson)
    );
}

export function parseContractSignerOverridesFromPrefill(
    raw: unknown,
): ContractSignerOverrideRow[] | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const rows = (raw as Record<string, unknown>)[CONTRACT_SIGNER_OVERRIDES_KEY];
    if (!Array.isArray(rows) || !rows.length) return null;
    const parsed = rows
        .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as Record<string, unknown>;
            const role = String(r.role ?? "").trim();
            const email = String(r.email ?? "").trim();
            const name = String(r.name ?? "").trim();
            if (!email) return null;
            return {
                role: resolveDocuSignSignerRole(role),
                name,
                email,
            };
        })
        .filter((r): r is ContractSignerOverrideRow => r != null);
    const deduped = dedupeContractSignerRows(parsed);
    return deduped.length ? deduped : null;
}

/** Map send/review role payloads to persisted Contract Signers rows. */
export function contractSignerRowsFromRolePayload(
    roles: DocuSignTemplateRolePayload[],
): ContractSignerOverrideRow[] {
    return roles
        .map((r) => ({
            role: resolveDocuSignSignerRole(r.signerRole),
            name: String(r.signerName || "").trim(),
            email: String(r.signerEmail || "").trim(),
        }))
        .filter((r) => r.email);
}

export function mergeContractPrefillWithSignerOverrides(
    baseRaw: unknown,
    signerRows: ContractSignerOverrideRow[],
): Record<string, unknown> {
    const base =
        baseRaw && typeof baseRaw === "object" && !Array.isArray(baseRaw)
            ? { ...(baseRaw as Record<string, unknown>) }
            : {};
    return {
        ...base,
        [CONTRACT_SIGNER_OVERRIDES_KEY]: signerRows,
    };
}

const DOCUSIGN_SIGNER_ROLE_COMMON = {
    privateMessage: "Kindly sign this article",
    authenticationCode: "1234",
    authenticationType: "AccessCode" as const,
    deliveryMode: "Email" as const,
    signerType: "signer" as const,
    locale: "EN" as const,
};

/** Build send/sync payload from Summary recipient editor rows. */
export function buildDocuSignRolesFromEditorRows(
    rows: ContractSignerOverrideRow[],
): DocuSignTemplateRolePayload[] {
    return rows
        .filter((r) => String(r.email || "").trim())
        .map((r, idx) => ({
            roleIndex: idx + 1,
            signerName: String(r.name || "").trim() || String(r.email).trim().split("@")[0],
            signerOrder: idx + 1,
            signerEmail: String(r.email).trim(),
            signerRole: resolveDocuSignSignerRole(r.role),
            ...DOCUSIGN_SIGNER_ROLE_COMMON,
        }));
}

export function contractSignerOverridesFingerprint(
    rows: ContractSignerOverrideRow[],
): string {
    return JSON.stringify(
        rows.map((r) => ({
            role: String(r.role || "").trim(),
            name: String(r.name || "").trim(),
            email: String(r.email || "").trim().toLowerCase(),
        })),
    );
}

/** Block DocuSign review/send when contract signers are missing or incomplete. */
export function getContractSignerValidationMessage(
    roles: DocuSignTemplateRolePayload[],
    signerOverrideRows?: ContractSignerOverrideRow[] | null,
): string | null {
    if (signerOverrideRows?.length) {
        if (signerOverrideRows.some((r) => !String(r.email || "").trim())) {
            return "Every signer needs an email address. Edit recipients in Contract Signers to continue.";
        }
    }

    if (!roles.length) {
        return "Enter a recipient in Contract Signers before reviewing in DocuSign.";
    }

    if (roles.some((r) => !String(r.signerEmail || "").trim())) {
        return "Every signer role needs an email address. Edit recipients in Contract Signers to continue.";
    }

    return null;
}

function normalizeRoleKey(role: string): string {
    return String(role || "").trim().toLowerCase();
}

export function isOwnerRoleName(role: string): boolean {
    const key = normalizeRoleKey(role);
    return key === "owner" || /^owner[\s_-]*\d*$/.test(key);
}

export function isGuarantorRoleName(role: string): boolean {
    return normalizeRoleKey(role).includes("guarantor");
}

export function isClientRoleName(role: string): boolean {
    const key = normalizeRoleKey(role);
    return (
        key === "client" ||
        key.includes("merchant") ||
        key.includes("receiver") ||
        key.includes("customer")
    );
}

export function getTemplateRoleNameFromRow(row: Record<string, unknown>): string {
    const nestedSigner =
        row.signer && typeof row.signer === "object"
            ? (row.signer as Record<string, unknown>)
            : row.Signer && typeof row.Signer === "object"
              ? (row.Signer as Record<string, unknown>)
              : null;

    return firstNonEmptyString(
        row.signerName,
        row.SignerName,
        row.defaultSignerName,
        row.DefaultSignerName,
        nestedSigner?.name,
        nestedSigner?.Name,
    );
}

/**
 * When a DocuSign template lists multiple signer roles, keep only the primary role
 * (e.g. "Signer") so the envelope is not sent to duplicate signer slots.
 */
export function filterTemplateRolesToPrimarySigner(
    templateRoles: Array<Record<string, unknown>>,
    preferredRoleName: string = DOCUSIGN_PRIMARY_SIGNER_ROLE,
): Array<Record<string, unknown>> {
    if (templateRoles.length <= 1) return templateRoles;
    const preferred = String(preferredRoleName || DOCUSIGN_PRIMARY_SIGNER_ROLE).trim().toLowerCase();
    if (!preferred) return [templateRoles[0]!];
    const matched = templateRoles.filter(
        (row) => getTemplateRoleLabel(row).toLowerCase() === preferred,
    );
    if (matched.length === 1) return matched;
    return [templateRoles[0]!];
}

/** Map template recipient rows + application client email to DocuSign signer roles. */
export function buildBoldSignRolesFromTemplateRecipients(
    templateRoles: Array<Record<string, unknown>>,
    applicationSignerEmail: string,
    applicationSignerName: string,
    options?: { singleSignerOnly?: boolean; preferredRoleName?: string },
): DocuSignTemplateRolePayload[] {
    const rolesForSend =
        options?.singleSignerOnly === false
            ? templateRoles
            : filterTemplateRolesToPrimarySigner(
                  templateRoles,
                  options?.preferredRoleName,
              );
    const appEmail = applicationSignerEmail.trim();

    if (rolesForSend.length === 0) {
        if (!appEmail) {
            return [];
        }
        return [
            {
                roleIndex: 1,
                signerName: applicationSignerName,
                signerOrder: 1,
                signerEmail: appEmail,
                signerRole: DOCUSIGN_DEFAULT_SIGNER_ROLE,
                ...DOCUSIGN_SIGNER_ROLE_COMMON,
            },
        ];
    }

    return rolesForSend.map((r, idx) => {
        const row = r as Record<string, unknown>;
        const templateEmail = getTemplateRoleEmailFromRow(row);
        const signerEmail = templateEmail || (idx === 0 ? appEmail : "");
        const templatePersonName = getTemplateRoleNameFromRow(row);
        const signerName =
            templatePersonName ||
            (idx === 0 ? applicationSignerName : `Signer ${idx + 1}`);
        const roleLabel = getTemplateRoleLabel(row) || `Role ${idx + 1}`;
        const roleIndexRaw = row.roleIndex ?? row.RoleIndex;
        const roleIndex =
            typeof roleIndexRaw === "number" && Number.isFinite(roleIndexRaw)
                ? roleIndexRaw
                : idx + 1;

        return {
            roleIndex,
            signerName,
            signerOrder: idx + 1,
            signerEmail,
            signerRole: roleLabel,
            ...DOCUSIGN_SIGNER_ROLE_COMMON,
        };
    });
}
