import type { DocuSignTemplateRolePayload } from "./templateRecipients";
import {
    isClientRoleName,
    isGuarantorRoleName,
    isOwnerRoleName,
} from "./templateRecipients";

function partyEmail(row: Record<string, unknown> | undefined): string {
    return String(row?.email ?? row?.ownerEmail ?? row?.guarantorEmail ?? "").trim();
}

/** Owner/guarantor row counts when email or legal name is present. */
export function ownerRowHasIdentity(row: Record<string, unknown> | undefined): boolean {
    if (!row) return false;
    if (partyEmail(row)) return true;
    const first = String(
        row.firstName ?? row.ownerFirstName ?? row.guarantorFirstName ?? "",
    ).trim();
    const last = String(
        row.lastName ?? row.ownerLastName ?? row.guarantorLastName ?? "",
    ).trim();
    return Boolean(first || last);
}

export function countOwnersWithEmail(
    owners?: Record<string, unknown>[] | null,
): number {
    if (!Array.isArray(owners)) return 0;
    return owners.filter((o) => partyEmail(o)).length;
}

export function countOwnersWithIdentity(
    owners?: Record<string, unknown>[] | null,
): number {
    if (!Array.isArray(owners)) return 0;
    return owners.filter((o) => ownerRowHasIdentity(o)).length;
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
    const fromDb = Math.max(
        countOwnersWithIdentity(options.owners),
        countOwnersWithEmail(options.owners),
    );

    const hasExplicitSecondSlot = roles.some((r) => {
        const label = signerRoleLabel(r);
        return (
            /owner\s*2|guarantor\s*2/i.test(label) &&
            String(r.signerEmail || "").trim()
        );
    });
    const distinctSignerEmails = countDistinctContractSignersWithEmail(roles);

    // Two CRM owners (Application Basic Details) must keep Seller #2 / Guarantor #2
    // slots even when Manage Signers still has only one invite.
    if (fromDb >= 2) return 2;
    if (hasExplicitSecondSlot || distinctSignerEmails >= 2) return 2;

    // Count only roles that carry an email so blank Owner 2 template slots never inflate to 2.
    const rolesWithEmail = roles.filter((r) => String(r.signerEmail || "").trim());
    if (rolesWithEmail.length > 0) return 1;

    return Math.min(2, Math.max(1, fromDb));
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
    ownerRows?: Record<string, unknown>[] | null,
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

    if (!secondary && ownerCount >= 2) {
        const secondOwner = ownerRows?.[1];
        const email = partyEmail(secondOwner);
        const name = resolveOwnerRowFullName(secondOwner);
        const primaryEmail = String(primary?.signerEmail || "").trim().toLowerCase();
        if (email && email.toLowerCase() !== primaryEmail) {
            secondary = {
                roleIndex: 2,
                signerOrder: 2,
                signerRole: "Owner 2",
                signerName: name || email.split("@")[0] || "",
                signerEmail: email,
                privateMessage: "Kindly sign this article",
                authenticationCode: "1234",
                authenticationType: "AccessCode",
                deliveryMode: "Email",
                signerType: "signer",
                locale: "EN",
            };
        }
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
    "owner2_email",
    "owner2_phone",
    "owner2_address",
    "owner2_print_title",
    "guarantor2_phone",
    "guarantor2_address",
    "client_email2",
    "client_phone2",
] as const;

const PRIMARY_GUARANTOR_PREFILL_IDS = [
    "owner1_guarantor_name",
    "guaranty_owner1_name",
    "guaranty_guarantor1_name",
    "guaranty_client_name",
    "client_name",
    "addendum_client_name",
    "security_guarantor",
] as const;

const PRIMARY_PARTY_SS_IDS = [
    "guaranty_owner1_ss",
    "guaranty_guarantor1_ss",
    "guaranty_ss",
] as const;

const PRIMARY_PARTY_DL_IDS = [
    "guaranty_owner1_driver_license",
    "guaranty_guarantor1_driver_license",
    "guaranty_ss_driver_license",
] as const;

const SECOND_PARTY_SS_IDS = ["guaranty_owner2_ss", "guaranty_guarantor2_ss"] as const;

const SECOND_PARTY_DL_IDS = [
    "guaranty_owner2_driver_license",
    "guaranty_guarantor2_driver_license",
] as const;

const PARTY2_PREFILL_FIELD_IDS = [
    ...SECOND_OWNER_PREFILL_IDS,
    "business_name_2",
    "addendum_dated_principal_owner2_name",
    "addendum_dated_principal_owner2_date",
] as const;

function isParty2PrefillFieldId(id: string): boolean {
    const key = String(id || "").trim().toLowerCase();
    if (!key) return false;
    if ((PARTY2_PREFILL_FIELD_IDS as readonly string[]).includes(key)) return true;
    return /owner2|owner_2|guarantor2|guarantor_2|merchant2|merchant_2|seller_2|business_name_2|appendix_merchant2/.test(
        key,
    );
}

/** Remove owner-2 / guarantor-2 / merchant-2 prefill when only one merchant signer. */
export function clearParty2PrefillFieldPayload<T extends { id: string; value: string }>(
    fields: T[],
    ownerCount: number,
): T[] {
    if (ownerCount >= 2) return fields;
    return fields.filter((f) => !isParty2PrefillFieldId(f.id));
}

function forcePrefillIds<T extends { id: string; value: string }>(
    byId: Map<string, T>,
    ids: readonly string[],
    value: string,
): void {
    const v = String(value || "").trim();
    if (!v) return;
    for (const id of ids) {
        const existing = byId.get(id);
        byId.set(id, (existing ? { ...existing, value: v } : { id, value: v }) as T);
    }
}

export function resolveOwnerRowFullName(
    row: Record<string, unknown> | null | undefined,
): string {
    if (!row) return "";
    const first = String(row.firstName || row.ownerFirstName || "").trim();
    const last = String(row.lastName || row.ownerLastName || "").trim();
    // Avoid "Prafull Prafull" from single-token names previously mirrored into first+last.
    if (first && last && first.toLowerCase() === last.toLowerCase()) return first;
    return `${first} ${last}`.trim();
}

/** Merchant / owner 1 / guarantor 1 share the same identity on all primary-party lines. */
export function applyPrimaryGuarantorNamesToPrefillFields<T extends { id: string; value: string }>(
    fields: T[],
    primaryName: string,
    options?: { primarySs?: string; primaryDriverLicense?: string },
): T[] {
    const byId = new Map(fields.map((f) => [f.id, { ...f }]));
    forcePrefillIds(byId, PRIMARY_GUARANTOR_PREFILL_IDS, primaryName);
    forcePrefillIds(byId, PRIMARY_PARTY_SS_IDS, options?.primarySs || "");
    forcePrefillIds(byId, PRIMARY_PARTY_DL_IDS, options?.primaryDriverLicense || "");
    const personal = String(primaryName || "").trim();
    if (personal) {
        const existing = byId.get("client_name");
        byId.set(
            "client_name",
            (existing ? { ...existing, value: personal } : { id: "client_name", value: personal }) as T,
        );
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

    return resolveOwnerRowFullName(ownerRows?.[1] as Record<string, unknown> | undefined);
}

/** Fill owner-2 / guarantor-2 / merchant-2 lines from the 2nd contract signer. */
export function applySecondOwnerNameToPrefillFields<T extends { id: string; value: string }>(
    fields: T[],
    options: {
        ownerCount: number;
        secondOwnerName?: string;
        secondOwnerSs?: string;
        secondOwnerDriverLicense?: string;
        secondOwnerEmail?: string;
        secondOwnerPhone?: string;
        secondOwnerAddress?: string;
        secondOwnerTitle?: string;
    },
): T[] {
    if (options.ownerCount < 2) return fields;
    const byId = new Map(fields.map((f) => [f.id, { ...f }]));
    const nameIds = PARTY2_PREFILL_FIELD_IDS.filter((id) => id.includes("name"));
    forcePrefillIds(byId, nameIds, options.secondOwnerName || "");
    forcePrefillIds(byId, SECOND_PARTY_SS_IDS, options.secondOwnerSs || "");
    forcePrefillIds(byId, SECOND_PARTY_DL_IDS, options.secondOwnerDriverLicense || "");
    forcePrefillIds(byId, ["owner2_email", "client_email2", "client_email_s2"], options.secondOwnerEmail || "");
    forcePrefillIds(
        byId,
        ["owner2_phone", "guarantor2_phone", "client_phone2", "client_phone_s2"],
        options.secondOwnerPhone || "",
    );
    forcePrefillIds(byId, ["owner2_address", "guarantor2_address"], options.secondOwnerAddress || "");
    forcePrefillIds(
        byId,
        ["owner2_print_title", "owner_print_title_s2"],
        options.secondOwnerTitle || (options.secondOwnerName ? "OWNER" : ""),
    );
    return Array.from(byId.values());
}

/** All camelCase prefill keys that represent the same person as Owner / Merchant / Guarantor 2. */
export const OWNER2_NAME_SYNC_CAMEL_KEYS = [
    "owner2GuarantorName",
    "merchant2Name",
    "guarantyOwner2Name",
    "guarantyGuarantor2Name",
    "appendixMerchant2Name",
    "addendumDatedPrincipalOwner2Name",
    "businessName2",
] as const;

/** Force the canonical Owner 2 person name onto every linked party-2 name field. */
export function syncOwner2NameToPrefillPartial(
    partial: Record<string, unknown>,
    name: string,
): void {
    const value = String(name || "").trim();
    if (!value) return;
    for (const key of OWNER2_NAME_SYNC_CAMEL_KEYS) {
        partial[key] = value;
    }
}

export const OWNER2_PREFILL_FORM_KEYS = [
    "merchant2Name",
    "owner2GuarantorName",
    "guarantyOwner2Name",
    "guarantyOwner2Ss",
    "guarantyOwner2DriverLicense",
    "addendumDatedPrincipalOwner2Name",
    "addendumDatedPrincipalOwner2Date",
    "owner2Email",
    "owner2Phone",
    "owner2Address",
    "owner2PrintTitle",
    "clientEmail2",
    "clientPhone2",
] as const;

/** Clear camelCase party-2 keys on the prefill partial object. */
export function clearParty2PrefillPartial(
    partial: Record<string, unknown>,
    ownerCount: number,
): void {
    if (ownerCount >= 2) return;
    for (const key of [
        ...OWNER2_PREFILL_FORM_KEYS,
        ...GUARANTOR2_PREFILL_FORM_KEYS,
        "appendixMerchant2Name",
        "businessName2",
    ]) {
        delete partial[key];
    }
}

export const GUARANTOR2_PREFILL_FORM_KEYS = [
    "guarantyGuarantor2Name",
    "guarantyGuarantor2Ss",
    "guarantyGuarantor2DriverLicense",
    "guarantor2Phone",
    "guarantor2Address",
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
