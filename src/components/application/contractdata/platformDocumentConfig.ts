/** Platform PDF + coordinate layouts — PDF bytes from BoldSignTemplate.pdfUrl (Cloudinary). */

import { DOCUSIGN_PRIMARY_SIGNER_ROLE } from "./docusignTemplateConfig";

export const PLATFORM_LAYOUT_KEYS = {
    contract: "contract",
    texasFundingGroupContract: "texas_funding_group_contract",
    flexAddendum: "flex_addendum",
    balanceTransfer: "balance_transfer",
    achAuthorization: "ach_authorization",
} as const;

export type PlatformLayoutKey =
    (typeof PLATFORM_LAYOUT_KEYS)[keyof typeof PLATFORM_LAYOUT_KEYS];

/** Legal funder name on state disclosure forms (not Contract.funderName legacy variants). */
export const PLATFORM_DISCLOSURE_FUNDER_NAME = "Woodmere Financial";

/** DocuSign envelope role names — must match template / backend DOCUSIGN_DEFAULT_ROLE_NAME. */
export const PLATFORM_PRIMARY_SIGNER_ROLE = DOCUSIGN_PRIMARY_SIGNER_ROLE;
export const PLATFORM_SECONDARY_SIGNER_ROLE = "Owner 2";

export const PLATFORM_SIGNER_SLOTS = [
    { roleIndex: 1, roleName: PLATFORM_PRIMARY_SIGNER_ROLE, signerOrder: 1 },
    { roleIndex: 2, roleName: PLATFORM_SECONDARY_SIGNER_ROLE, signerOrder: 2 },
] as const;

export type SupplementalDocumentOption = {
    layoutKey: PlatformLayoutKey;
    label: string;
};

export const SUPPLEMENTAL_DOCUMENT_OPTIONS: SupplementalDocumentOption[] = [
    { layoutKey: PLATFORM_LAYOUT_KEYS.flexAddendum, label: "Flex Addendum" },
    { layoutKey: PLATFORM_LAYOUT_KEYS.balanceTransfer, label: "Balance Transfer Sheet" },
    { layoutKey: PLATFORM_LAYOUT_KEYS.achAuthorization, label: "ACH Authorization" },
];

/** Addendum picker — ACH is managed in its own Info Required section. */
export const CONTRACT_ADDENDUM_DOCUMENT_OPTIONS: SupplementalDocumentOption[] =
    SUPPLEMENTAL_DOCUMENT_OPTIONS.filter(
        (o) => o.layoutKey !== PLATFORM_LAYOUT_KEYS.achAuthorization,
    );

export function isAchAuthorizationLayoutKey(value: unknown): boolean {
    const key = String(value ?? "")
        .trim()
        .toLowerCase();
    return (
        key === PLATFORM_LAYOUT_KEYS.achAuthorization ||
        key.includes("ach_authorization") ||
        key.includes("ach-authorization")
    );
}

const LAYOUT_KEY_SET = new Set<string>(Object.values(PLATFORM_LAYOUT_KEYS));

export function isPlatformLayoutKey(value: unknown): value is PlatformLayoutKey {
    return LAYOUT_KEY_SET.has(String(value ?? "").trim());
}

/** Texas deals with Texas Funding Group use the 13-page contract layout (Alliance Bridge coordinates). */
export function isTexasContractState(state?: string | null): boolean {
    const normalized = String(state ?? "")
        .trim()
        .toLowerCase();
    return normalized === "texas" || normalized === "tx";
}

export const TEXAS_FUNDING_GROUP_FUNDER_LABEL = "TEXAS FUNDING GROUP";

export function isTexasFundingGroupFunder(funderName?: string | null): boolean {
    const normalized = String(funderName ?? "")
        .trim()
        .toLowerCase();
    return normalized.includes("texas funding group");
}

export function resolveMainContractLayoutKey(
    funderName?: string | null,
    state?: string | null,
): PlatformLayoutKey {
    if (
        funderName &&
        (funderName.toLowerCase().includes("woodmere") &&
            !funderName.toLowerCase().includes("texas"))
    ) {
        return PLATFORM_LAYOUT_KEYS.contract;
    }
    if (isTexasFundingGroupFunder(funderName) && isTexasContractState(state)) {
        return PLATFORM_LAYOUT_KEYS.texasFundingGroupContract;
    }
    return PLATFORM_LAYOUT_KEYS.contract;
}

/** Layout envelope slots — Owner 2 only when a second owner/signer is active. */
export function getPlatformSignerRoleRows(
    ownerCount = 1,
): Array<Record<string, unknown>> {
    const slots =
        ownerCount >= 2
            ? PLATFORM_SIGNER_SLOTS
            : PLATFORM_SIGNER_SLOTS.filter(
                  (s) => s.roleName === PLATFORM_PRIMARY_SIGNER_ROLE,
              );
    return slots.map((slot, idx) => ({
        roleIndex: idx + 1,
        roleName: slot.roleName,
        signerOrder: slot.signerOrder,
        signerName: "",
        signerEmail: "",
    }));
}

export function supplementalOptionLabel(layoutKey: string): string {
    const found = SUPPLEMENTAL_DOCUMENT_OPTIONS.find((o) => o.layoutKey === layoutKey);
    return found?.label || layoutKey;
}
