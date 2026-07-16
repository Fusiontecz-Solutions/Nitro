/** Shared DocuSign CC list: PDF viewer reads/writes this storage key before send. */
export const BOLDSIGN_CC_LIST_STORAGE_KEY = "boldsign_cc_list";

/** Platform default when a funder has no default CC configured in Settings. */
export const DOCUSIGN_DEFAULT_CC_EMAIL = "subs@woodmerefinancial.com";

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

/** Platform default + every funder-profile default CC (normalized). */
export function collectKnownFunderDefaultCcEmails(
    funderDefaultCcValues: Array<string | null | undefined> = [],
): Set<string> {
    const out = new Set<string>([normalizeCcEmailToken(DOCUSIGN_DEFAULT_CC_EMAIL)]);
    for (const value of funderDefaultCcValues) {
        for (const email of parseFunderDefaultCcEmails(value)) {
            out.add(normalizeCcEmailToken(email));
        }
    }
    return out;
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
    options?: {
        funderDefaultCcEmail?: string | null;
        /** When set, also treat other funders' default CCs as reserved (not user-added). */
        knownFunderDefaultCcEmails?: Iterable<string>;
    },
): boolean {
    const token = normalizeCcEmailToken(email);
    if (!token) return false;
    if (
        resolveContractDefaultCcEmails(options).some(
            (reserved) => normalizeCcEmailToken(reserved) === token,
        )
    ) {
        return true;
    }
    if (!options?.knownFunderDefaultCcEmails) return false;
    for (const known of options.knownFunderDefaultCcEmails) {
        if (normalizeCcEmailToken(known) === token) return true;
    }
    return false;
}

/** Default CC (platform or funder override), then user-added addresses (deduped). */
export function mergeWithDefaultCcEmails(
    emails: string[],
    options?: {
        funderDefaultCcEmail?: string | null;
        knownFunderDefaultCcEmails?: Iterable<string>;
    },
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
 * Also drops other funders' default CCs so switching funders does not keep their CC.
 */
export function loadBoldSignCcEmailList(
    options?: {
        funderDefaultCcEmail?: string | null;
        knownFunderDefaultCcEmails?: Iterable<string>;
    },
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
    options?: {
        funderDefaultCcEmail?: string | null;
        knownFunderDefaultCcEmails?: Iterable<string>;
    },
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

/** User-added contract CC emails — stored on `Contract.contractPrefillOverrides`. */
export const CONTRACT_CC_EMAILS_PREFILL_KEY = "contractCcEmails";

export function parseContractCcEmailsFromPrefill(raw: unknown): string[] {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const list = (raw as Record<string, unknown>)[CONTRACT_CC_EMAILS_PREFILL_KEY];
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const entry of list) {
        if (typeof entry === "string" && entry.trim()) {
            out.push(entry.trim());
        }
    }
    return [...new Set(out.map((e) => e.toLowerCase()))].map(
        (lower) => out.find((e) => e.toLowerCase() === lower) || lower,
    );
}

export function mergeContractPrefillWithCcEmails(
    baseRaw: unknown,
    userEmails: string[],
): Record<string, unknown> {
    const base =
        baseRaw != null && typeof baseRaw === "object" && !Array.isArray(baseRaw)
            ? { ...(baseRaw as Record<string, unknown>) }
            : {};
    const normalized = [
        ...new Set(
            userEmails
                .map((e) => String(e ?? "").trim())
                .filter(Boolean)
                .filter((e) => !isDefaultCcEmail(e)),
        ),
    ];
    if (!normalized.length) {
        const next = { ...base };
        delete next[CONTRACT_CC_EMAILS_PREFILL_KEY];
        return next;
    }
    return {
        ...base,
        [CONTRACT_CC_EMAILS_PREFILL_KEY]: normalized,
    };
}
