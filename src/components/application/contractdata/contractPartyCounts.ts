import type { DocuSignTemplateRolePayload } from "./templateRecipients";
import {
    isClientRoleName,
    isGuarantorRoleName,
    isOwnerRoleName,
} from "./templateRecipients";

function partyEmail(row: Record<string, unknown> | undefined): string {
    return String(row?.email ?? "").trim();
}

export function countOwnersWithEmail(
    owners?: Record<string, unknown>[] | null,
): number {
    if (!Array.isArray(owners)) return 0;
    return owners.filter((o) => partyEmail(o)).length;
}

export function countGuarantorsWithEmail(
    guarantors?: Record<string, unknown>[] | null,
): number {
    if (!Array.isArray(guarantors)) return 0;
    return guarantors.filter((g) => partyEmail(g)).length;
}

export function countOwnersFromSignerRoles(
    roles: Array<{ signerRole?: string; roleName?: string; signerEmail?: string }>,
): number {
    return roles.filter(
        (r) =>
            isOwnerRoleName(String(r.signerRole || r.roleName || "")) &&
            String(r.signerEmail || "").trim(),
    ).length;
}

export function countGuarantorsFromSignerRoles(
    roles: Array<{ signerRole?: string; roleName?: string; signerEmail?: string }>,
): number {
    return roles.filter(
        (r) =>
            isGuarantorRoleName(String(r.signerRole || r.roleName || "")) &&
            String(r.signerEmail || "").trim(),
    ).length;
}

function signerRoleLabel(
    r: { signerRole?: string; roleName?: string },
): string {
    return String(r.signerRole || r.roleName || "").trim();
}

/** Distinct contract signer emails (Manage Signers / payload roles). */
export function countDistinctContractSignersWithEmail(
    roles: Array<{ signerEmail?: string }>,
): number {
    const emails = new Set(
        roles
            .map((r) => String(r.signerEmail || "").trim().toLowerCase())
            .filter(Boolean),
    );
    return emails.size;
}

/** Active owner count (1 or 2) from CRM owners and/or contract signer rows. */
export function resolveActiveOwnerCount(options: {
    owners?: Record<string, unknown>[] | null;
    signerRoles?: Array<{ signerRole?: string; roleName?: string; signerEmail?: string }>;
}): number {
    const roles = options.signerRoles || [];
    const fromDb = countOwnersWithEmail(options.owners);
    const fromRoles = countOwnersFromSignerRoles(roles);
    const fromContractSignerRows =
        countDistinctContractSignersWithEmail(roles) >= 2 ? 2 : 0;

    const hasExplicitSecondSlot = roles.some((r) => {
        const label = signerRoleLabel(r);
        return (
            /owner\s*2|guarantor\s*2/i.test(label) &&
            String(r.signerEmail || "").trim()
        );
    });

    const clientEmail = roles
        .find((r) => isClientRoleName(signerRoleLabel(r)))
        ?.signerEmail?.trim()
        .toLowerCase();

    const distinctNonClientPartyEmails = new Set(
        roles
            .filter((r) => {
                const email = String(r.signerEmail || "").trim().toLowerCase();
                if (!email) return false;
                if (clientEmail && email === clientEmail) return false;
                const label = signerRoleLabel(r);
                return (
                    isOwnerRoleName(label) ||
                    isGuarantorRoleName(label) ||
                    /owner\s*2|guarantor\s*2/i.test(label)
                );
            })
            .map((r) => String(r.signerEmail).trim().toLowerCase()),
    );
    const fromDistinctPartySigners =
        distinctNonClientPartyEmails.size >= 2 ? 2 : distinctNonClientPartyEmails.size;

    return Math.min(
        2,
        Math.max(
            1,
            fromDb,
            fromRoles,
            fromContractSignerRows,
            hasExplicitSecondSlot ? 2 : 0,
            fromDistinctPartySigners,
        ),
    );
}

/** Active guarantor count (0–2) from CRM guarantors and/or saved contract signers. */
export function resolveActiveGuarantorCount(options: {
    guarantors?: Record<string, unknown>[] | null;
    signerRoles?: Array<{ signerRole?: string; roleName?: string; signerEmail?: string }>;
}): number {
    const fromDb = countGuarantorsWithEmail(options.guarantors);
    const fromRoles = countGuarantorsFromSignerRoles(options.signerRoles || []);
    return Math.min(2, Math.max(fromDb, fromRoles));
}

/**
 * Merchant/client, owner 1, and guarantor 1 are the same person → one primary signer.
 * Owner 2 and guarantor 2 are the same person → one secondary signer when ownerCount >= 2.
 */
export function collapseDocuSignRolesToSignerSlots(
    roles: DocuSignTemplateRolePayload[],
    ownerCount: number,
): DocuSignTemplateRolePayload[] {
    const withEmail = roles.filter((r) => String(r.signerEmail || "").trim());
    const roleLabel = (r: DocuSignTemplateRolePayload) =>
        String(r.signerRole || (r as { roleName?: string }).roleName || "").trim();

    const primary =
        withEmail.find((r) => isClientRoleName(roleLabel(r))) ||
        withEmail.find((r) => /^owner$/i.test(roleLabel(r))) ||
        withEmail.find((r) => /^guarantor$/i.test(roleLabel(r))) ||
        withEmail[0];

    let secondary =
        withEmail.find((r) => /owner\s*2/i.test(roleLabel(r))) ||
        withEmail.find((r) => /guarantor\s*2/i.test(roleLabel(r)));

    if (!secondary && ownerCount >= 2) {
        const primaryEmail = String(primary?.signerEmail || "").trim().toLowerCase();
        secondary =
            withEmail.find((r) => {
                if (r === primary) return false;
                const label = roleLabel(r);
                const email = String(r.signerEmail || "").trim().toLowerCase();
                if (!email || email === primaryEmail) return false;
                return isOwnerRoleName(label) || isGuarantorRoleName(label);
            }) ||
            withEmail.find((r) => {
                if (r === primary) return false;
                const email = String(r.signerEmail || "").trim().toLowerCase();
                return Boolean(email && email !== primaryEmail);
            });
    }

    const out: DocuSignTemplateRolePayload[] = [];
    if (primary) {
        out.push({
            ...primary,
            signerRole: "Signer",
            signerOrder: 1,
            roleIndex: 1,
        });
    }
    if (ownerCount >= 2 && secondary) {
        out.push({
            ...secondary,
            signerRole: "Owner 2",
            signerOrder: 2,
            roleIndex: 2,
        });
    }
    return out;
}

/** @deprecated Use collapseDocuSignRolesToSignerSlots */
export function filterDocuSignRolesByPartyCounts(
    roles: DocuSignTemplateRolePayload[],
    ownerCount: number,
    _guarantorCount: number,
): DocuSignTemplateRolePayload[] {
    return collapseDocuSignRolesToSignerSlots(roles, ownerCount);
}

const SECOND_OWNER_PREFILL_IDS = [
    "guaranty_owner2_name",
    "guaranty_owner2_ss",
    "guaranty_owner2_driver_license",
    "owner2_guarantor_name",
    "guaranty_guarantor2_name",
    "merchant2_name",
    "appendix_merchant2_name",
] as const;

const PRIMARY_GUARANTOR_PREFILL_IDS = [
    "owner1_guarantor_name",
    "guaranty_owner1_name",
    "guaranty_guarantor1_name",
] as const;

/** Merchant / owner 1 / guarantor 1 share the same name on all guarantor lines. */
export function applyPrimaryGuarantorNamesToPrefillFields(
    fields: Array<{ id: string; value: string }>,
    primaryName: string,
): Array<{ id: string; value: string }> {
    const name = String(primaryName || "").trim();
    if (!name) return fields;
    const byId = new Map(fields.map((f) => [f.id, { ...f }]));
    for (const id of PRIMARY_GUARANTOR_PREFILL_IDS) {
        if (!String(byId.get(id)?.value || "").trim()) {
            byId.set(id, { id, value: name });
        }
    }
    return Array.from(byId.values());
}

/** Resolve the 2nd owner/guarantor display name from signer rows (before or after collapse). */
export function resolveSecondOwnerSignerName(
    roles: DocuSignTemplateRolePayload[],
    ownerCount: number,
    ownerRows?: Record<string, unknown>[] | null,
): string {
    if (ownerCount < 2) return "";

    const roleLabel = (r: DocuSignTemplateRolePayload) =>
        String(r.signerRole || (r as { roleName?: string }).roleName || "").trim();

    const withEmail = roles.filter((r) => String(r.signerEmail || "").trim());
    const primary =
        withEmail.find((x) => isClientRoleName(roleLabel(x))) ||
        withEmail.find((x) => /^owner$/i.test(roleLabel(x))) ||
        withEmail[0];
    const primaryEmail = String(primary?.signerEmail || "").trim().toLowerCase();

    const fromExplicit =
        roles.find((r) => /owner\s*2|guarantor\s*2/i.test(roleLabel(r))) ||
        roles.find((r) => {
            if (r === primary) return false;
            const label = roleLabel(r);
            return (
                (isOwnerRoleName(label) || isGuarantorRoleName(label)) &&
                String(r.signerEmail || "").trim()
            );
        }) ||
        withEmail.find((r) => {
            const email = String(r.signerEmail || "").trim().toLowerCase();
            return Boolean(email && email !== primaryEmail);
        });

    const fromRole = String(fromExplicit?.signerName || "").trim();
    if (fromRole) return fromRole;

    const secondFromDb = ownerRows?.[1] as { firstName?: string; lastName?: string } | undefined;
    return `${String(secondFromDb?.firstName || "").trim()} ${String(secondFromDb?.lastName || "").trim()}`.trim();
}

/** Fill owner-2 / guarantor-2 name lines from the 2nd contract signer. */
export function applySecondOwnerNameToPrefillFields(
    fields: Array<{ id: string; value: string }>,
    options: { ownerCount: number; secondOwnerName?: string },
): Array<{ id: string; value: string }> {
    const name = String(options.secondOwnerName || "").trim();
    if (options.ownerCount < 2 || !name) return fields;
    const byId = new Map(fields.map((f) => [f.id, { ...f }]));
    for (const id of SECOND_OWNER_PREFILL_IDS) {
        if (id.includes("name") && !String(byId.get(id)?.value || "").trim()) {
            byId.set(id, { id, value: name });
        }
    }
    return Array.from(byId.values());
}

export const OWNER2_PREFILL_FORM_KEYS = [
    "owner2GuarantorName",
    "guarantyOwner2Name",
    "guarantyOwner2Ss",
    "guarantyOwner2DriverLicense",
    "addendumDatedPrincipalOwner2Name",
    "addendumDatedPrincipalOwner2Date",
] as const;

export const GUARANTOR2_PREFILL_FORM_KEYS = [
    "guarantyGuarantor2Name",
    "guarantyGuarantor2Ss",
    "guarantyGuarantor2DriverLicense",
] as const;

export const GUARANTOR1_PREFILL_FORM_KEYS = [
    "guarantorEmail",
    "guarantorPhone",
    "guarantorAddress",
    "guarantorAddressCity",
    "guarantorAddressState",
    "guarantorAddressZip",
    "guarantyGuarantor1Name",
    "guarantyGuarantor1Ss",
    "guarantyGuarantor1DriverLicense",
] as const;
