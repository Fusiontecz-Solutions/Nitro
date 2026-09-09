import {
    resolveDocuSignSignerRole,
    type ContractSignerOverrideRow,
} from "./templateRecipients";

export type OwnerPartyForSigner = {
    ownerFirstName?: string;
    ownerLastName?: string;
    ownerEmail?: string;
};

function str(v: unknown): string {
    return String(v ?? "").trim();
}

/** One signer row per CRM owner slot (up to 2); do not collapse by shared email. */
export function buildContractSignerRowsFromOwnerParties(
    owners: OwnerPartyForSigner[],
): ContractSignerOverrideRow[] {
    return owners
        .slice(0, 2)
        .map((o, index) => {
            const name = `${str(o.ownerFirstName)} ${str(o.ownerLastName)}`.trim();
            const email = str(o.ownerEmail);
            return {
                role: resolveDocuSignSignerRole(index === 0 ? undefined : "Owner 2"),
                name: name || (email ? email.split("@")[0] : ""),
                email,
            };
        })
        .filter((row) => row.name || row.email);
}

/**
 * Prefer live CRM owner rows over saved contract signer overrides (stale prefill).
 * Owner slots are positional (up to 2) — never collapse two owners because they share an email.
 */
export function reconcileSignerRowsWithFreshOwners(
    saved: ContractSignerOverrideRow[] | null | undefined,
    fresh: ContractSignerOverrideRow[],
): ContractSignerOverrideRow[] {
    const freshRows = fresh.slice(0, 2);
    if (!saved?.length) {
        return freshRows;
    }
    if (!freshRows.length) {
        return saved.slice(0, 2);
    }

    const savedRows = saved.slice(0, 2);
    const slotCount = Math.max(freshRows.length, savedRows.length);
    const out: ContractSignerOverrideRow[] = [];
    for (let i = 0; i < slotCount; i++) {
        const live = freshRows[i];
        const persisted = savedRows[i];
        out.push({
            role: resolveDocuSignSignerRole(persisted?.role || live?.role),
            name: str(live?.name) || str(persisted?.name),
            email: str(live?.email) || str(persisted?.email),
        });
    }
    return out;
}

/**
 * Always include Signer 2 when Application Basic Details has a second owner.
 * Saved Manage Signers values fill gaps; they do not hide a live Owner 2.
 */
export function ensureSignerRowsFromCrmOwners(
    saved: ContractSignerOverrideRow[] | null | undefined,
    ownerParties: OwnerPartyForSigner[],
): ContractSignerOverrideRow[] {
    const fromOwners = buildContractSignerRowsFromOwnerParties(ownerParties);
    return reconcileSignerRowsWithFreshOwners(saved, fromOwners);
}
