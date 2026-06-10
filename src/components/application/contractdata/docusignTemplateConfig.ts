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

/** Fixed lender name in DocuSign signer email subject (maps to envelope `emailSubject`). */
export const DOCUSIGN_EMAIL_LENDER_NAME = String(
    (typeof import.meta !== "undefined" &&
        import.meta.env?.VITE_DOCUSIGN_EMAIL_LENDER_NAME) ||
        "KATAN CAPITAL LLC",
).trim();

/** DocuSign envelope email subject: fixed lender + per-deal client name. */
export function buildDocuSignEnvelopeEmailSubject(clientName: string): string {
    const client = String(clientName || "").trim() || "Client";
    return `Complete with Docusign: ${DOCUSIGN_EMAIL_LENDER_NAME} - ${client}`;
}
