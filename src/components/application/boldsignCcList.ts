/** Shared BoldSign CC list: PDF viewer reads/writes this storage key before send. */
export const BOLDSIGN_CC_LIST_STORAGE_KEY = "boldsign_cc_list";

/**
 * Returns saved CC emails only (no hardcoded defaults).
 * Use this so every address on the envelope comes from what the user saved in the UI.
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
            if (typeof e === "string" && e.trim() !== "") {
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
    const unique = [...new Set(emails.map((e) => e.trim()).filter(Boolean))];
    localStorage.setItem(BOLDSIGN_CC_LIST_STORAGE_KEY, JSON.stringify(unique));
}
