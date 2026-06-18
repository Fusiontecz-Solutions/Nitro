import {
    isPlatformLayoutKey,
    PLATFORM_LAYOUT_KEYS,
    type PlatformLayoutKey,
} from "./platformDocumentConfig";

/** @deprecated Use PLATFORM_LAYOUT_KEYS — layout keys for code-driven addendum prefill. */
export const DOCUSIGN_ADDENDUM_LAYOUT_KEYS = {
    BALANCE_TRANSFER_SHEET: PLATFORM_LAYOUT_KEYS.balanceTransfer,
    FLEX_ADDENDUM: PLATFORM_LAYOUT_KEYS.flexAddendum,
    ACH_AUTHORIZATION: PLATFORM_LAYOUT_KEYS.achAuthorization,
    /** Standalone ACH send — same PDF/coords, no owner 2 initial mirror. */
    ACH_AUTHORIZATION_STANDALONE: "ach_authorization_standalone",
} as const;

export type DocusignAddendumLayoutKey =
    (typeof DOCUSIGN_ADDENDUM_LAYOUT_KEYS)[keyof typeof DOCUSIGN_ADDENDUM_LAYOUT_KEYS];

const LAYOUT_KEY_SET = new Set<string>(Object.values(DOCUSIGN_ADDENDUM_LAYOUT_KEYS));

export function normalizeDocusignLayoutKey(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
}

/** @deprecated Use normalizeDocusignLayoutKey */
export const normalizeDocusignTemplateId = normalizeDocusignLayoutKey;

export function isKnownKatanAddendumLayoutKey(layoutKey: unknown): layoutKey is PlatformLayoutKey {
    return LAYOUT_KEY_SET.has(normalizeDocusignLayoutKey(layoutKey));
}

/** Accept platform layout keys (legacy DocuSign GUIDs still resolve for existing mappings). */
export function isKnownKatanAddendumTemplateId(ref: unknown): boolean {
    return isPlatformLayoutKey(ref) || isKnownKatanAddendumLayoutKey(ref);
}
