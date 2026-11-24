/** Platform PDF + coordinate layouts — PDF bytes from BoldSignTemplate.pdfUrl (Cloudinary). */

import { DOCUSIGN_PRIMARY_SIGNER_ROLE } from "./docusignTemplateConfig";

export const PLATFORM_LAYOUT_KEYS = {
    contract: "contract",
    addendum_p: "addendum_p",
    addendum_ca: "addendum_ca",
    addendum_ny: "addendum_ny",
    addendum_va: "addendum_va",
} as const;

export type PlatformLayoutKey =
    (typeof PLATFORM_LAYOUT_KEYS)[keyof typeof PLATFORM_LAYOUT_KEYS];

/** Legal funder name on state disclosure forms (not Contract.funderName legacy variants). */
export const PLATFORM_DISCLOSURE_FUNDER_NAME = "Nitro Advance";

/**
 * Optional $25 wire fee on every deal (on by default; can be turned off per contract):
 * - Origination / total fees on the agreement + disclosures = applicable fee + this amount
 * - Net / recipient funds = funding − (applicable fee + this amount) − refinance
 */
export const DISCLOSURE_WIRE_FEE_USD = 25;
/** @deprecated Use DISCLOSURE_WIRE_FEE_USD — kept so existing imports keep working. */
export const DISCLOSURE_PLATFORM_FEE_USD = DISCLOSURE_WIRE_FEE_USD;

export function resolveIncludeWireFee(value: unknown): boolean {
    if (value === false || value === 0) return false;
    const s = String(value ?? "")
        .trim()
        .toLowerCase();
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
    return true;
}

function refinanceDollars(value: unknown): number {
    const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

/** True when any of the given refinance / previous-balance amounts is positive. */
export function isRefinanceForWireFee(...refinanceAmounts: unknown[]): boolean {
    return refinanceAmounts.some((v) => refinanceDollars(v) > 0);
}

/**
 * The deal's "$25 wire fee" choice, with a REFI-aware default.
 *
 * An explicit choice (the box, ticked or unticked) always wins. With no saved
 * choice, REFI deals get NO wire fee — the $25 is added to a REFI deal only when
 * someone ticked the box — while other deals keep the fee-on default.
 * Every place that used to fall back to "on" for a REFI deal is what printed
 * TOTAL FEES / NET AMOUNT $25 off after the box was unticked.
 */
export function resolveIncludeWireFeeForDeal(
    value: unknown,
    ...refinanceAmounts: unknown[]
): boolean {
    if (value === true || value === false || value === 0 || value === 1) {
        return resolveIncludeWireFee(value);
    }
    if (String(value ?? "").trim()) return resolveIncludeWireFee(value);
    return !isRefinanceForWireFee(...refinanceAmounts);
}

export function resolveDisclosureWireFeeUsd(includeWireFee?: boolean): number {
    return includeWireFee === false ? 0 : DISCLOSURE_WIRE_FEE_USD;
}

/** DocuSign envelope role names — must match template / backend DOCUSIGN_DEFAULT_ROLE_NAME. */
export const PLATFORM_PRIMARY_SIGNER_ROLE = DOCUSIGN_PRIMARY_SIGNER_ROLE;
export const PLATFORM_SECONDARY_SIGNER_ROLE = "Owner 2";

export const PLATFORM_SIGNER_SLOTS = [
    { roleIndex: 1, roleName: PLATFORM_PRIMARY_SIGNER_ROLE, signerOrder: 1 },
    { roleIndex: 2, roleName: PLATFORM_SECONDARY_SIGNER_ROLE, signerOrder: 2 },
] as const;

export type SupplementalDocumentOption = {
    layoutKey: string;
    label: string;
};

export const SUPPLEMENTAL_DOCUMENT_OPTIONS: SupplementalDocumentOption[] = [];

/**
 * Upload-gated addendums — shown in Create Contract only after the funder
 * uploads that PDF on their profile (Settings → Funder → Addendum PDFs).
 */
export const UPLOAD_GATED_ADDENDUM_DOCUMENT_OPTIONS: SupplementalDocumentOption[] = [];

/** Addendum picker — ACH is managed in its own Info Required section. */
export const CONTRACT_ADDENDUM_DOCUMENT_OPTIONS: SupplementalDocumentOption[] = [];

export function isAchAuthorizationLayoutKey(value: unknown): boolean {
    const key = String(value ?? "")
        .trim()
        .toLowerCase();
    return (
        key === "ach_authorization" ||
        key === "ach_authorization_texas" ||
        key === "ach_authorization_standalone" ||
        key.includes("ach_authorization") ||
        key.includes("ach-authorization")
    );
}

export function isTexasAchAuthorizationLayoutKey(value: unknown): boolean {
    const key = String(value ?? "")
        .trim()
        .toLowerCase();
    return (
        key === "ach_authorization_texas" ||
        key.includes("ach_authorization_texas") ||
        key.includes("texas_ach")
    );
}

const LAYOUT_KEY_SET = new Set<string>(Object.values(PLATFORM_LAYOUT_KEYS));

export function isPlatformLayoutKey(value: unknown): value is PlatformLayoutKey {
    return LAYOUT_KEY_SET.has(String(value ?? "").trim());
}

/** Texas-state helper (TX deals use the same Harbor `contract` layout). */
export function isTexasContractState(state?: string | null): boolean {
    const normalized = String(state ?? "")
        .trim()
        .toLowerCase();
    return normalized === "texas" || normalized === "tx";
}

/** @deprecated Legacy match token for old funder rows — do not show in UI. */
export const TEXAS_FUNDING_GROUP_FUNDER_LABEL = "TEXAS FUNDING GROUP";

export function isTexasFundingGroupFunder(funderName?: string | null): boolean {
    const normalized = String(funderName ?? "")
        .trim()
        .toLowerCase();
    return normalized.includes("texas funding group");
}

/** Main contract always uses the Harbor `contract` layout (funder PDFs use `funder_<uuid>`). */
export function resolveMainContractLayoutKey(
    _funderName?: string | null,
    _state?: string | null,
): PlatformLayoutKey {
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
