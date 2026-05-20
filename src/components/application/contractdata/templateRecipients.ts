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
