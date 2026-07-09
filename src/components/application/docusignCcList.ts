/** Shared DocuSign CC list: PDF viewer reads/writes this storage key before send. */
export const BOLDSIGN_CC_LIST_STORAGE_KEY = "boldsign_cc_list";

/** Platform default when a funder has no default CC configured in Settings. */
export const DOCUSIGN_DEFAULT_CC_EMAIL = "info@woodmerefinancial.com";

export function normalizeCcEmailToken(email: string): string {
    return email.trim().toLowerCase();
}

export function parseFunderDefaultCcEmails(value?: string | null): string[] {
    return [
        ...new Set(
            String(value ?? "")
                .split(/[,;\n]+/)
                .map((part) => part.trim())
                .filter(Boolean),
        ),
    ];
}

export function isDefaultCcEmail(email: string): boolean {
    return normalizeCcEmailToken(email) === normalizeCcEmailToken(DOCUSIGN_DEFAULT_CC_EMAIL);
}

/** Funder profile CC replaces platform default; otherwise platform default is used. */
export function resolveContractDefaultCcEmails(options?: {
    funderDefaultCcEmail?: string | null;
}): string[] {
    const funderCcs = parseFunderDefaultCcEmails(options?.funderDefaultCcEmail);
    if (funderCcs.length) return funderCcs;
    return [DOCUSIGN_DEFAULT_CC_EMAIL];
}

export function isReservedContractCcEmail(
    email: string,
    options?: { funderDefaultCcEmail?: string | null },
): boolean {
    const token = normalizeCcEmailToken(email);
    if (!token) return false;
    return resolveContractDefaultCcEmails(options).some(
        (reserved) => normalizeCcEmailToken(reserved) === token,
    );
}

/** Default CC (platform or funder override), then user-added addresses (deduped). */
export function mergeWithDefaultCcEmails(
    emails: string[],
    options?: { funderDefaultCcEmail?: string | null },
): string[] {
    const out = new Set<string>(resolveContractDefaultCcEmails(options));
    for (const e of emails) {
        const trimmed = e.trim();
        if (trimmed && !isReservedContractCcEmail(trimmed, options)) {
            out.add(trimmed);
        }
    }
    return [...out];
}

/**
 * Returns saved CC emails only (excludes default CC — merged at send time).
 */
export function loadBoldSignCcEmailList(
    options?: { funderDefaultCcEmail?: string | null },
): string[] {
    if (typeof window === "undefined") {
        return [];
    }
    const raw = localStorage.getItem(BOLDSIGN_CC_LIST_STORAGE_KEY);
    if (!raw) {
        return [];
    }
    try {
        const saved = JSON.parse(raw) as unknown;
        if (!Array.isArray(saved)) {
            return [];
        }
        const out = new Set<string>();
        for (const e of saved) {
            if (
                typeof e === "string" &&
                e.trim() !== "" &&
                !isReservedContractCcEmail(e, options)
            ) {
                out.add(e.trim());
            }
        }
        return [...out];
    } catch {
        return [];
    }
}

export function saveBoldSignCcEmailList(
    emails: string[],
    options?: { funderDefaultCcEmail?: string | null },
): void {
    if (typeof window === "undefined") {
        return;
    }
    const unique = [
        ...new Set(
            emails
                .map((e) => e.trim())
                .filter(Boolean)
                .filter((e) => !isReservedContractCcEmail(e, options)),
        ),
    ];
    localStorage.setItem(BOLDSIGN_CC_LIST_STORAGE_KEY, JSON.stringify(unique));
}
