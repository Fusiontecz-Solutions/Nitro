/** Platform PDF + coordinate layouts — PDF bytes from BoldSignTemplate.pdfUrl (Cloudinary). */

export const PLATFORM_LAYOUT_KEYS = {
    contract: "contract",
    allianceBridgeContract: "alliance_bridge_contract",
    flexAddendum: "flex_addendum",
    balanceTransfer: "balance_transfer",
    achAuthorization: "ach_authorization",
} as const;

export type PlatformLayoutKey =
    (typeof PLATFORM_LAYOUT_KEYS)[keyof typeof PLATFORM_LAYOUT_KEYS];

/** Legal funder name on state disclosure forms (not Contract.funderName Katan II / III). */
export const PLATFORM_DISCLOSURE_FUNDER_NAME = "Katan Capital LLC";

function isKatanBrandedDocumentName(value?: string | null): boolean {
    return /katan/i.test(String(value ?? "").trim());
}

function funderBrandingLabel(profile?: {
    displayName?: string | null;
    name?: string | null;
} | null): string {
    return String(profile?.displayName || profile?.name || "").trim();
}

/**
 * Human-readable label for a supplemental doc (addendum / balance transfer).
 * Platform template rows are Katan-branded; non-platform funders get their own name.
 */
export function resolveFunderSupplementalDocumentLabel(
    layoutKey: string,
    options?: {
        funderProfile?: {
            displayName?: string | null;
            name?: string | null;
            documentsSource?: string | null;
        } | null;
        storedTemplateName?: string | null;
    },
): string {
    const key = String(layoutKey || "").trim();
    const genericLabel = supplementalOptionLabel(key);
    const storedName = String(options?.storedTemplateName ?? "").trim();
    const profile = options?.funderProfile;
    const usesPlatformDocs =
        !profile ||
        String(profile.documentsSource ?? "")
            .trim()
            .toLowerCase() === "platform";

    if (usesPlatformDocs) {
        return storedName || genericLabel;
    }

    if (storedName && !isKatanBrandedDocumentName(storedName)) {
        return storedName;
    }

    const funderLabel = funderBrandingLabel(profile);
    return funderLabel ? `${funderLabel} ${genericLabel}` : genericLabel;
}

/** DocuSign envelope role names — must match backend platform-document-registry slots. */
export const PLATFORM_PRIMARY_SIGNER_ROLE = "Signer";
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
