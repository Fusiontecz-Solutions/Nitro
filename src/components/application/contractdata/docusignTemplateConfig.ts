/** Default signer role on Woodmere DocuSign templates (must match template role name exactly). */
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
