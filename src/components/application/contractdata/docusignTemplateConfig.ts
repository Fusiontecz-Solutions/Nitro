import { formatUSD } from "@/utils/formatCurrency";

/** Default signer role on Harbor DocuSign templates (must match template role name exactly). */
export const DOCUSIGN_DEFAULT_SIGNER_ROLE = "Signer";

/** Primary signer role when the template defines multiple roles but only one should receive the envelope. */
export const DOCUSIGN_PRIMARY_SIGNER_ROLE = String(
    (typeof import.meta !== "undefined" &&
        (import.meta.env?.VITE_DOCUSIGN_SIGNER_ROLE ||
            import.meta.env?.VITE_DOCUSIGN_PRIMARY_SIGNER_ROLE ||
            import.meta.env?.VITE_DOCUSIGN_DEFAULT_ROLE_NAME ||
            import.meta.env?.VITE_DOCUSIGN_DEFAULT_SIGNER_ROLE)) ||
        DOCUSIGN_DEFAULT_SIGNER_ROLE,
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
        "Nitro Advance",
).trim();

/** @deprecated Use CONTRACT_ENVELOPE_LENDER_NAME */
export const DOCUSIGN_EMAIL_LENDER_NAME = CONTRACT_ENVELOPE_LENDER_NAME;

/** Contract envelope email subject: {FunderName}: BusinessName $Offer Amount */
export function buildContractEnvelopeEmailSubject(
    businessName: string,
    offerAmount?: number | string | null,
    funderName?: string | null,
): string {
    const business = String(businessName || "").trim() || "Business";
    const amount = formatUSD(offerAmount, { fallback: "$0.00" });
    const lender =
        String(funderName || "").trim() || CONTRACT_ENVELOPE_LENDER_NAME;
    return `${lender}: ${business} ${amount}`;
}

/** ACH / standalone envelope subject / PDF name: {FunderName}: BusinessName - ACH */
export function buildAchFormEnvelopeEmailSubject(
    businessName: string,
    _offerAmount?: number | string | null,
    funderName?: string | null,
): string {
    const business = String(businessName || "").trim() || "Business";
    const lender =
        String(funderName || "").trim() || CONTRACT_ENVELOPE_LENDER_NAME;
    return `${lender}: ${business} - ACH`;
}

/** DocuSign envelope email subject: fixed lender + per-deal client name. */
export function buildDocuSignEnvelopeEmailSubject(
    clientName: string,
    offerAmount?: number | string | null,
    funderName?: string | null,
): string {
    return buildContractEnvelopeEmailSubject(clientName, offerAmount, funderName);
}
