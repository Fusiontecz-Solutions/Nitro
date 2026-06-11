import type { DocuSignTemplateRolePayload } from "./templateRecipients";
import {
    DOCUSIGN_PRIMARY_SIGNER_ROLE,
} from "./docusignTemplateConfig";
import {
    PLATFORM_PRIMARY_SIGNER_ROLE,
    PLATFORM_SECONDARY_SIGNER_ROLE,
} from "./platformDocumentConfig";
import {
    isClientRoleName,
    isGuarantorRoleName,
    isOwnerRoleName,
} from "./templateRecipients";

function partyEmail(row: Record<string, unknown> | undefined): string {
    return String(row?.email ?? row?.ownerEmail ?? row?.guarantorEmail ?? "").trim();
}

/** Owner/guarantor row counts when email or legal name is present (DocuSign prefill does not require email). */
export function ownerRowHasIdentity(row: Record<string, unknown> | undefined): boolean {
    if (!row) return false;
    if (partyEmail(row)) return true;
    const first = String(
        row.firstName ?? row.ownerFirstName ?? row.guarantorFirstName ?? "",
    ).trim();
    const last = String(row.lastName ?? row.ownerLastName ?? row.guarantorLastName ?? "").trim();
    return Boolean(first || last);
}

export function countOwnersWithEmail(
    owners?: Record<string, unknown>[] | null,
): number {
    if (!Array.isArray(owners)) return 0;
    return owners.filter((o) => ownerRowHasIdentity(o)).length;
}

export function countGuarantorsWithEmail(
    guarantors?: Record<string, unknown>[] | null,
): number {
    if (!Array.isArray(guarantors)) return 0;
    return guarantors.filter((g) => ownerRowHasIdentity(g)).length;
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

/** Active owner count (1 or 2) from CRM owners/guarantors and/or contract signer rows. */
export function resolveActiveOwnerCount(options: {
    owners?: Record<string, unknown>[] | null;
    guarantors?: Record<string, unknown>[] | null;
    signerRoles?: Array<{ signerRole?: string; roleName?: string; signerEmail?: string }>;
}): number {
    const roles = options.signerRoles || [];
    const fromDb = Math.max(
        countOwnersWithEmail(options.owners),
        countGuarantorsWithEmail(options.guarantors),
    );
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
                    /owner\s*2|guarantor\s*2/i.test(label) ||
                    /^signer$/i.test(label)
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
        withEmail.find((r) => /^receiver$/i.test(roleLabel(r))) ||
        withEmail[0];

    let secondary =
        withEmail.find((r) => /owner\s*2/i.test(roleLabel(r))) ||
        withEmail.find((r) => /guarantor\s*2/i.test(roleLabel(r)));

    if (!secondary && ownerCount >= 2) {
        const primaryEmail = String(primary?.signerEmail || "").trim().toLowerCase();
        const secondaryCandidates = withEmail.filter((r) => {
            if (r === primary) return false;
            const label = roleLabel(r);
            const email = String(r.signerEmail || "").trim().toLowerCase();
            if (!email || email === primaryEmail) return false;
            return (
                /owner\s*2|guarantor\s*2/i.test(label) ||
                isOwnerRoleName(label) ||
                isGuarantorRoleName(label) ||
                /^signer$/i.test(label)
            );
        });
        // Owner 1 shares the primary slot — pick the last non-primary party (Owner 2 / Guarantor 2).
        secondary =
            secondaryCandidates[secondaryCandidates.length - 1] ||
            withEmail.find((r) => {
                if (r === primary) return false;
                const email = String(r.signerEmail || "").trim().toLowerCase();
                return Boolean(email && email !== primaryEmail);
            });
    }

    const out: DocuSignTemplateRolePayload[] = [];
    const primaryRoleName = PLATFORM_PRIMARY_SIGNER_ROLE || DOCUSIGN_PRIMARY_SIGNER_ROLE;
    if (primary) {
        out.push({
            ...primary,
            signerRole: primaryRoleName,
            signerOrder: 1,
            roleIndex: 1,
        });
    }
    if (ownerCount >= 2 && secondary) {
        out.push({
            ...secondary,
            signerRole: PLATFORM_SECONDARY_SIGNER_ROLE,
            signerOrder: 2,
            roleIndex: 2,
        });
    }
    return out;
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
    "client_name",
    "owner1_guarantor_name",
    "guaranty_owner1_name",
    "guaranty_guarantor1_name",
    "guaranty_client_name",
    "security_guarantor",
] as const;

const PRIMARY_PARTY_SS_IDS = ["guaranty_owner1_ss", "guaranty_guarantor1_ss"] as const;
const PRIMARY_PARTY_DL_IDS = [
    "guaranty_owner1_driver_license",
    "guaranty_guarantor1_driver_license",
] as const;

const SECOND_PARTY_SS_IDS = ["guaranty_owner2_ss", "guaranty_guarantor2_ss"] as const;
const SECOND_PARTY_DL_IDS = [
    "guaranty_owner2_driver_license",
    "guaranty_guarantor2_driver_license",
] as const;

function mirrorEmptyPrefillIds(
    byId: Map<string, { id: string; value: string }>,
    ids: readonly string[],
    value: string,
): void {
    const v = String(value || "").trim();
    if (!v) return;
    for (const id of ids) {
        if (!String(byId.get(id)?.value || "").trim()) {
            byId.set(id, { id, value: v });
        }
    }
}

function forcePrefillIds(
    byId: Map<string, { id: string; value: string }>,
    ids: readonly string[],
    value: string,
): void {
    const v = String(value || "").trim();
    if (!v) return;
    for (const id of ids) {
        byId.set(id, { id, value: v });
    }
}

export function resolveOwnerRowFullName(
    row: Record<string, unknown> | null | undefined,
): string {
    if (!row) return "";
    return `${String(row.firstName || "").trim()} ${String(row.lastName || "").trim()}`.trim();
}

/** Merchant / owner 1 / guarantor 1 share the same identity on all primary-party lines. */
export function applyPrimaryGuarantorNamesToPrefillFields(
    fields: Array<{ id: string; value: string }>,
    primaryName: string,
    options?: { primarySs?: string; primaryDriverLicense?: string },
): Array<{ id: string; value: string }> {
    const byId = new Map(fields.map((f) => [f.id, { ...f }]));
    mirrorEmptyPrefillIds(byId, PRIMARY_GUARANTOR_PREFILL_IDS, primaryName);
    mirrorEmptyPrefillIds(byId, PRIMARY_PARTY_SS_IDS, options?.primarySs || "");
    mirrorEmptyPrefillIds(byId, PRIMARY_PARTY_DL_IDS, options?.primaryDriverLicense || "");
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

    const secondaryCandidates = withEmail.filter((r) => {
        if (r === primary) return false;
        const label = roleLabel(r);
        const email = String(r.signerEmail || "").trim().toLowerCase();
        if (!email || email === primaryEmail) return false;
        return (
            /owner\s*2|guarantor\s*2/i.test(label) ||
            isOwnerRoleName(label) ||
            isGuarantorRoleName(label) ||
            /^signer$/i.test(label)
        );
    });
    const fromExplicit =
        roles.find((r) => /owner\s*2|guarantor\s*2/i.test(roleLabel(r))) ||
        secondaryCandidates[secondaryCandidates.length - 1];

    const fromRole = String(fromExplicit?.signerName || "").trim();
    if (fromRole) return fromRole;

    const secondFromDb = ownerRows?.[1] as
        | { firstName?: string; lastName?: string; ownerFirstName?: string; ownerLastName?: string }
        | undefined;
    return resolveOwnerRowFullName(secondFromDb);
}

/** Fill owner-2 / guarantor-2 / merchant-2 lines from the 2nd contract signer. */
export function applySecondOwnerNameToPrefillFields(
    fields: Array<{ id: string; value: string }>,
    options: {
        ownerCount: number;
        secondOwnerName?: string;
        secondOwnerSs?: string;
        secondOwnerDriverLicense?: string;
    },
): Array<{ id: string; value: string }> {
    if (options.ownerCount < 2) return fields;
    const byId = new Map(fields.map((f) => [f.id, { ...f }]));
    const nameIds = SECOND_OWNER_PREFILL_IDS.filter((id) => id.includes("name"));
    forcePrefillIds(byId, nameIds, options.secondOwnerName || "");
    forcePrefillIds(byId, SECOND_PARTY_SS_IDS, options.secondOwnerSs || "");
    forcePrefillIds(byId, SECOND_PARTY_DL_IDS, options.secondOwnerDriverLicense || "");
    return Array.from(byId.values());
}

export const OWNER2_PREFILL_FORM_KEYS = [
    "merchant2Name",
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
