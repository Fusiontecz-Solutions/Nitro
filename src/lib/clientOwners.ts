import type { Address, OwnerDetail } from "../types/clientTypes";

function str(v: unknown): string {
    return String(v ?? "").trim();
}

function cloneOwnerAddress(address: OwnerDetail["address"] | undefined): OwnerDetail["address"] {
    return {
        address1: String(address?.address1 ?? ""),
        address2: String(address?.address2 ?? ""),
        city: String(address?.city ?? ""),
        state: String(address?.state ?? ""),
        zipCode: String(address?.zipCode ?? ""),
    };
}

/** Deep-clone an owner so nested address is never shared across owner slots. */
export function cloneOwnerDetail(owner: OwnerDetail): OwnerDetail {
    return {
        ...owner,
        address: cloneOwnerAddress(owner?.address),
    };
}

/**
 * Contact fields for one owner row.
 * Owner 1 may use Client flat columns; Owner 2+ must not inherit those.
 */
export function mapOwnerContactFromClientRow(
    related: Record<string, unknown> | undefined,
    client: Record<string, unknown>,
    index: number,
): {
    mobileNumber: string;
    ssn: string;
    dateOfBirth: string;
    address: Address;
} {
    const ownAddr = (related?.address ?? {}) as Record<string, unknown>;
    const primaryFlat = index === 0;
    return {
        mobileNumber: str(
            related?.mobileNumber ??
                (primaryFlat ? client.ownerMobileNumber ?? client.ownerPhone : ""),
        ),
        ssn: str(related?.ssn ?? (primaryFlat ? client.ownerSsn : "")),
        dateOfBirth: str(related?.dateOfBirth),
        address: {
            address1: str(
                ownAddr.address1 ?? related?.address1 ?? (primaryFlat ? client.ownerAddress1 : ""),
            ),
            address2: str(
                ownAddr.address2 ?? related?.address2 ?? (primaryFlat ? client.ownerAddress2 : ""),
            ),
            city: str(ownAddr.city ?? related?.city ?? (primaryFlat ? client.ownerCity : "")),
            state: str(ownAddr.state ?? related?.state ?? (primaryFlat ? client.ownerState : "")),
            zipCode: str(
                ownAddr.zipCode ?? related?.zipCode ?? (primaryFlat ? client.ownerZipCode : ""),
            ),
        },
    };
}

/** Prefer `owners[]`, then legacy single `owner`. */
export function resolveOwnersFromClientData(client: unknown): OwnerDetail[] {
    if (!client || typeof client !== "object") return [];

    const record = client as {
        owners?: OwnerDetail[];
        owner?: OwnerDetail;
    };

    if (Array.isArray(record.owners) && record.owners.length > 0) {
        return record.owners.map(cloneOwnerDetail);
    }
    if (record.owner) {
        return [cloneOwnerDetail(record.owner)];
    }
    return [];
}

/** Route key used to load full client detail (owners relation). */
export function getClientFetchKeyFromApplicationClient(client: unknown): string | null {
    if (!client || typeof client !== "object") return null;

    const record = client as {
        clientId?: number | string | null;
        id?: string | null;
        _id?: string | null;
    };

    if (record.clientId != null && String(record.clientId).trim()) {
        return `clientId:${record.clientId}`;
    }

    const mongoId = record.id ?? record._id;
    if (mongoId != null && String(mongoId).trim()) {
        return `mongoId:${mongoId}`;
    }

    return null;
}

export function getClientFetchArg(fetchKey: string | null): string | null {
    if (!fetchKey) return null;
    if (fetchKey.startsWith("clientId:")) return fetchKey.slice("clientId:".length);
    if (fetchKey.startsWith("mongoId:")) return fetchKey.slice("mongoId:".length);
    return null;
}
