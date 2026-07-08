import { formatUSD } from "@/utils/formatCurrency";

/** Primary signer role when the template defines multiple roles but only one should receive the envelope. */
export const DOCUSIGN_PRIMARY_SIGNER_ROLE = String(
    (typeof import.meta !== "undefined" &&
        (import.meta.env?.VITE_DOCUSIGN_SIGNER_ROLE ||
            import.meta.env?.VITE_DOCUSIGN_PRIMARY_SIGNER_ROLE ||
            import.meta.env?.VITE_DOCUSIGN_DEFAULT_ROLE_NAME ||
            import.meta.env?.VITE_DOCUSIGN_DEFAULT_SIGNER_ROLE)) ||
        "Signer",
).trim();

/** Default signer role when template recipients are unavailable (must match DocuSign template). */
export const DOCUSIGN_DEFAULT_SIGNER_ROLE = DOCUSIGN_PRIMARY_SIGNER_ROLE;

/** Map legacy DocuSign role labels (Receiver, Client, etc.) to the platform signer role. */
export function normalizeDocuSignSignerRoleName(role: unknown): string {
    const trimmed = String(role ?? "").trim();
    if (!trimmed) return DOCUSIGN_DEFAULT_SIGNER_ROLE;
    if (/^owner\s*2$/i.test(trimmed) || /^guarantor\s*2$/i.test(trimmed)) {
        return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (
        lower === "receiver" ||
        lower === "client" ||
        lower === "merchant" ||
        lower === "customer" ||
        lower === "signer"
    ) {
        return DOCUSIGN_DEFAULT_SIGNER_ROLE;
    }
    return trimmed;
}

/** Public HTTPS URL DocuSign redirects to after Send (required for localhost dev). */
export const DOCUSIGN_SENDER_RETURN_URL = String(
    (typeof import.meta !== "undefined" &&
        import.meta.env?.VITE_DOCUSIGN_SENDER_RETURN_URL) ||
        "",
).trim();

/** DocuSign template GUID — must exist in the connected DocuSign account (demo vs prod). */
export const DEFAULT_DOCUSIGN_TEMPLATE_ID = String(
    (typeof import.meta !== "undefined" &&
        (import.meta.env?.VITE_DOCUSIGN_TEMPLATE_ID ||
            import.meta.env?.VITE_BOLDSIGN_TEMPLATE_ID)) ||
        "",
).trim();

/** Lender prefix for contract / ACH envelope email subjects and PDF names. */
export const CONTRACT_ENVELOPE_LENDER_NAME = String(
    (typeof import.meta !== "undefined" &&
        import.meta.env?.VITE_DOCUSIGN_EMAIL_LENDER_NAME) ||
        "KATAN CAPITAL",
).trim();

/** Alliance Bridge contract envelope subject / PDF prefix (Texas and non-Texas). */
export const ALLIANCE_BRIDGE_CONTRACT_LENDER_NAME = "ALLIANCE BRIDGE CAPITAL";

/** @deprecated Use CONTRACT_ENVELOPE_LENDER_NAME */
export const DOCUSIGN_EMAIL_LENDER_NAME = CONTRACT_ENVELOPE_LENDER_NAME;

export function isAllianceFunderNameForEnvelope(funderName?: string | null): boolean {
    const key = String(funderName ?? "")
        .trim()
        .toLowerCase();
    if (!key) return false;
    return key.includes("alliance bridge") || key.includes("alliance capital");
}

/** Lender prefix for envelope subject / PDF name from selected funder. */
export function resolveContractEnvelopeLenderName(options?: {
    funderName?: string | null;
    isAllianceProfile?: boolean;
}): string {
    if (
        options?.isAllianceProfile ||
        isAllianceFunderNameForEnvelope(options?.funderName)
    ) {
        return ALLIANCE_BRIDGE_CONTRACT_LENDER_NAME;
    }
    return CONTRACT_ENVELOPE_LENDER_NAME;
}

/** Contract envelope email subject: KATAN CAPITAL : BusinessName - $Offer Amount */
export function buildContractEnvelopeEmailSubject(
    businessName: string,
    offerAmount?: number | string | null,
    lenderName?: string | null,
): string {
    const business = String(businessName || "").trim() || "Business";
    const amount = formatUSD(offerAmount, { fallback: "$0.00" });
    const lender =
        String(lenderName ?? CONTRACT_ENVELOPE_LENDER_NAME).trim() ||
        CONTRACT_ENVELOPE_LENDER_NAME;
    return `${lender} : ${business} - ${amount}`;
}

/** ACH-only envelope email subject and PDF name: ACH FORM: BusinessName */
export function buildAchFormEnvelopeEmailSubject(businessName: string): string {
    const business = String(businessName || "").trim() || "Business";
    return `ACH FORM: ${business}`;
}

/** @deprecated Use buildContractEnvelopeEmailSubject */
export function buildDocuSignEnvelopeEmailSubject(
    businessName: string,
    offerAmount?: number | string | null,
): string {
    return buildContractEnvelopeEmailSubject(businessName, offerAmount);
}
