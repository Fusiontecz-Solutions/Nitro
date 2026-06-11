/** Shared contract CC list: PDF viewer reads/writes this storage key before send. */
export const BOLDSIGN_CC_LIST_STORAGE_KEY = "boldsign_cc_list";

/** Always CC'd on every contract (users may add more). */
export const DEFAULT_CONTRACT_CC_EMAIL = "admin@katancapital.com";

export function isDefaultContractCcEmail(email: string): boolean {
    return email.trim().toLowerCase() === DEFAULT_CONTRACT_CC_EMAIL.toLowerCase();
}

/** Default admin CC first, then user-supplied addresses (deduped). */
export function mergeContractCcEmailList(emails?: string[] | null): string[] {
    const out: string[] = [DEFAULT_CONTRACT_CC_EMAIL];
    const seen = new Set<string>([DEFAULT_CONTRACT_CC_EMAIL.toLowerCase()]);
    for (const raw of emails || []) {
        const email = String(raw ?? "").trim();
        if (!email) continue;
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(email);
    }
    return out;
}

/**
 * Returns saved user CC emails plus the default admin address.
 */
export function loadBoldSignCcEmailList(): string[] {
    if (typeof window === "undefined") {
        return mergeContractCcEmailList([]);
    }
    const raw = localStorage.getItem(BOLDSIGN_CC_LIST_STORAGE_KEY);
    if (!raw) {
        return mergeContractCcEmailList([]);
    }
    try {
        const saved = JSON.parse(raw) as unknown;
        if (!Array.isArray(saved)) {
            return mergeContractCcEmailList([]);
        }
        const userEmails: string[] = [];
        for (const e of saved) {
            if (typeof e === "string" && e.trim() !== "") {
                userEmails.push(e.trim());
            }
        }
        return mergeContractCcEmailList(userEmails);
    } catch {
        return mergeContractCcEmailList([]);
    }
}

/** Persist only user-added CC emails (default admin is always merged on load). */
export function saveBoldSignCcEmailList(emails: string[]): void {
    if (typeof window === "undefined") {
        return;
    }
    const userOnly = [
        ...new Set(
            emails
                .map((e) => e.trim())
                .filter(Boolean)
                .filter((e) => !isDefaultContractCcEmail(e)),
        ),
    ];
    localStorage.setItem(BOLDSIGN_CC_LIST_STORAGE_KEY, JSON.stringify(userOnly));
}
