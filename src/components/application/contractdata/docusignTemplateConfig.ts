/** Default signer role on Woodmere DocuSign templates (must match template role name exactly). */
export const DOCUSIGN_DEFAULT_SIGNER_ROLE = "Signer";

/** DocuSign template GUID — must exist in the connected DocuSign account (demo vs prod). */
export const DEFAULT_DOCUSIGN_TEMPLATE_ID = String(
    (typeof import.meta !== "undefined" &&
        (import.meta.env?.VITE_DOCUSIGN_TEMPLATE_ID ||
            import.meta.env?.VITE_BOLDSIGN_TEMPLATE_ID)) ||
        "",
).trim();
