/** Shared DocuSign CC list: PDF viewer reads/writes this storage key before send. */
export const BOLDSIGN_CC_LIST_STORAGE_KEY = "boldsign_cc_list";

/** Always included as a DocuSign carbon-copy recipient on contract envelopes. */
export const DOCUSIGN_DEFAULT_CC_EMAIL = "info@woodmerefinancial.com";

export function isDefaultCcEmail(email: string): boolean {
    return email.trim().toLowerCase() === DOCUSIGN_DEFAULT_CC_EMAIL.toLowerCase();
}

/** Default CC first, then any additional user-added addresses (deduped). */
export function mergeWithDefaultCcEmails(emails: string[]): string[] {
    const out = new Set<string>([DOCUSIGN_DEFAULT_CC_EMAIL]);
    for (const e of emails) {
        const trimmed = e.trim();
        if (trimmed && !isDefaultCcEmail(trimmed)) {
            out.add(trimmed);
        }
    }
    return [...out];
}

/**
 * Returns saved CC emails only (excludes the default — it is always merged at send time).
 */
export function loadBoldSignCcEmailList(): string[] {
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
            if (typeof e === "string" && e.trim() !== "" && !isDefaultCcEmail(e)) {
                out.add(e.trim());
            }
        }
        return [...out];
    } catch {
        return [];
    }
}

export function saveBoldSignCcEmailList(emails: string[]): void {
    if (typeof window === "undefined") {
        return;
    }
    const unique = [
        ...new Set(
            emails.map((e) => e.trim()).filter(Boolean).filter((e) => !isDefaultCcEmail(e)),
        ),
    ];
    localStorage.setItem(BOLDSIGN_CC_LIST_STORAGE_KEY, JSON.stringify(unique));
}
