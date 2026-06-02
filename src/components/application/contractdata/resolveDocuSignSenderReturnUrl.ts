/**
 * DocuSign Sender View requires a public HTTPS returnUrl.
 *
 * - On production HTTPS: return the current page (same deal / contract tab).
 * - On localhost: map to VITE_DOCUSIGN_SENDER_RETURN_URL origin + current path.
 */
function normalizePublicAppOrigin(raw: string): string {
    const trimmed = String(raw || "").trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    if (trimmed.includes("://")) {
        try {
            return new URL(trimmed).origin;
        } catch {
            return "";
        }
    }
    return `https://${trimmed.replace(/^\/+/, "")}`;
}

function isLocalDevHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
}

export function resolveDocuSignSenderReturnUrl(): string {
    const publicOrigin = normalizePublicAppOrigin(
        String(import.meta.env?.VITE_DOCUSIGN_SENDER_RETURN_URL ?? "").trim(),
    );

    if (typeof window !== "undefined") {
        try {
            const current = new URL(window.location.href);
            const pathSuffix = `${current.pathname}${current.search}${current.hash}`;

            if (!isLocalDevHost(current.hostname) && current.protocol === "https:") {
                return current.href;
            }

            if (isLocalDevHost(current.hostname) && publicOrigin && pathSuffix) {
                return `${publicOrigin}${pathSuffix}`;
            }
        } catch {
            /* fall through */
        }
    }

    return publicOrigin || "https://www.katan.finexusai.com";
}
