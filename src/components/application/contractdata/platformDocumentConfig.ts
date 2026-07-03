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

/** Legal funder name on state disclosures when the deal funder is Alliance Bridge. */
export const ALLIANCE_DISCLOSURE_FUNDER_NAME = "Alliance Bridge Capital LLC";

export function isAllianceBridgeFunderName(value?: string | null): boolean {
    return isAllianceDisclosureFunderName(value);
}

/** Alliance Bridge / Alliance Capital funders use the same disclosure legal name. */
export function isAllianceDisclosureFunderName(value?: string | null): boolean {
    const key = String(value ?? "")
        .trim()
        .toLowerCase();
    if (!key) return false;
    return key.includes("alliance bridge") || key.includes("alliance capital");
}

export type DisclosureFunderProfileRef = {
    name?: string | null;
    displayName?: string | null;
    organization?: string | null;
    legalName?: string | null;
    mainContractLayoutKey?: string | null;
    contactEmail?: string | null;
};

export function isAllianceDisclosureFunderProfile(
    profile?: DisclosureFunderProfileRef | null,
): boolean {
    if (!profile) return false;
    return (
        isAllianceDisclosureFunderName(profile.name) ||
        isAllianceDisclosureFunderName(profile.displayName) ||
        isAllianceDisclosureFunderName(profile.organization) ||
        isAllianceDisclosureFunderName(profile.legalName) ||
        String(profile.contactEmail ?? "")
            .toLowerCase()
            .includes("@alliancebridgecapital.com") ||
        String(profile.mainContractLayoutKey || "").trim() ===
            PLATFORM_LAYOUT_KEYS.allianceBridgeContract
    );
}

export function extractContractFunderNameForDisclosure(
    contract?: Record<string, unknown> | null,
): string {
    const c = contract ?? {};
    const profile = c.funderProfile;
    const profileRecord =
        profile && typeof profile === "object" && !Array.isArray(profile)
            ? (profile as Record<string, unknown>)
            : null;
    const candidates = [
        c.funderName,
        c.selectedFunder,
        c.funder,
        profileRecord?.name,
        profileRecord?.displayName,
    ];
    for (const raw of candidates) {
        const value = String(raw ?? "").trim();
        if (value) return value;
    }
    return "";
}

export function extractContractFunderProfileForDisclosure(
    contract?: Record<string, unknown> | null,
): DisclosureFunderProfileRef | null {
    const profile = contract?.funderProfile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) return null;
    return profile as DisclosureFunderProfileRef;
}

export function resolveDisclosureFunderNamePrefill(options?: {
    funderName?: string | null;
    mainContractLayoutKey?: string | null;
    funderProfile?: DisclosureFunderProfileRef | null;
}): string {
    const layoutKey = String(options?.mainContractLayoutKey ?? "").trim();
    const funderName = String(options?.funderName ?? "").trim();
    if (
        layoutKey === PLATFORM_LAYOUT_KEYS.allianceBridgeContract ||
        isAllianceDisclosureFunderName(funderName) ||
        isAllianceDisclosureFunderProfile(options?.funderProfile)
    ) {
        return ALLIANCE_DISCLOSURE_FUNDER_NAME;
    }
    return PLATFORM_DISCLOSURE_FUNDER_NAME;
}

/** Uppercase legal name for disclosure PDF / DocuSign tabs (matches existing Katan forms). */
export function formatDisclosureFunderNameForPdf(name?: string | null): string {
    return String(name ?? PLATFORM_DISCLOSURE_FUNDER_NAME).trim().toUpperCase();
}

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
    const storedName = humanizeLayoutKeyLikeName(options?.storedTemplateName);
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
    const key = String(layoutKey || "").trim();
    const normalized = key.toLowerCase().replace(/-/g, "_");
    if (
        normalized === PLATFORM_LAYOUT_KEYS.achAuthorization ||
        normalized === "ach_authorization_standalone"
    ) {
        return "ACH Authorization";
    }
    const found = SUPPLEMENTAL_DOCUMENT_OPTIONS.find((o) => o.layoutKey === key);
    return found?.label || key;
}

function humanizeLayoutKeyLikeName(value?: string | null): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const normalized = raw.toLowerCase().replace(/-/g, "_");
    if (
        normalized === PLATFORM_LAYOUT_KEYS.achAuthorization ||
        normalized === "ach_authorization_standalone"
    ) {
        return "ACH Authorization";
    }
    if (isPlatformLayoutKey(raw)) {
        return supplementalOptionLabel(raw);
    }
    return raw;
}
