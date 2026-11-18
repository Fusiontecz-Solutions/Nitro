function str(v: unknown): string {
    return String(v ?? "").trim();
}

function ownerRowHasIdentity(row: Record<string, unknown> | undefined): boolean {
    if (!row) return false;
    if (str(row.email ?? row.ownerEmail ?? row.guarantorEmail)) return true;
    const first = str(row.firstName ?? row.ownerFirstName ?? row.guarantorFirstName);
    const last = str(row.lastName ?? row.ownerLastName ?? row.guarantorLastName);
    return Boolean(first || last);
}

function mergeOwnerRowAtIndex(
    contractRow: Record<string, unknown> | undefined,
    clientRow: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
    const clientAddr =
        clientRow?.address && typeof clientRow.address === "object"
            ? (clientRow.address as Record<string, unknown>)
            : null;
    const address1 = str(
        clientRow?.address1 ??
            clientAddr?.address1 ??
            (typeof clientRow?.address === "string" ? clientRow.address : undefined) ??
            contractRow?.address1 ??
            (typeof contractRow?.address === "string" ? contractRow.address : undefined),
    );
    const address2 = str(clientRow?.address2 ?? clientAddr?.address2 ?? contractRow?.address2);
    const city = str(clientRow?.city ?? clientAddr?.city ?? contractRow?.city);
    const state = str(clientRow?.state ?? clientAddr?.state ?? contractRow?.state);
    const zip = str(
        clientRow?.zip ??
            clientRow?.zipCode ??
            clientAddr?.zipCode ??
            contractRow?.zip ??
            contractRow?.zipCode,
    );
    const phone = str(
        clientRow?.mobileNumber ??
            clientRow?.phone ??
            clientRow?.mobile ??
            contractRow?.mobileNumber ??
            contractRow?.phone ??
            contractRow?.mobile,
    );
    const merged: Record<string, unknown> = {
        firstName: str(
            clientRow?.firstName ??
                clientRow?.ownerFirstName ??
                contractRow?.firstName ??
                contractRow?.ownerFirstName,
        ),
        lastName: str(
            clientRow?.lastName ??
                clientRow?.ownerLastName ??
                contractRow?.lastName ??
                contractRow?.ownerLastName,
        ),
        email: str(
            clientRow?.email ??
                clientRow?.ownerEmail ??
                contractRow?.email ??
                contractRow?.ownerEmail,
        ),
        mobileNumber: phone,
        phone,
        ssn: str(
            clientRow?.ssn ?? clientRow?.ssnNumber ?? contractRow?.ssn ?? contractRow?.ssnNumber,
        ),
        ssnNumber: str(
            clientRow?.ssnNumber ?? clientRow?.ssn ?? contractRow?.ssnNumber ?? contractRow?.ssn,
        ),
        driverLicense: str(
            clientRow?.driverLicense ??
                clientRow?.driverLicenseNumber ??
                contractRow?.driverLicense ??
                contractRow?.driverLicenseNumber,
        ),
        driverLicenseNumber: str(
            clientRow?.driverLicenseNumber ??
                clientRow?.driverLicense ??
                contractRow?.driverLicenseNumber ??
                contractRow?.driverLicense,
        ),
        address1,
        address2,
        city,
        state,
        zip,
        zipCode: zip,
        address: address1,
    };
    return ownerRowHasIdentity(merged) ? merged : null;
}

/**
 * Full owner rows (name, email, phone, SSN, address) for contract prefill.
 * Application `client.owners[]` is source of truth; contract-owner API rows fill gaps.
 *
 * Kept in this leaf module so Vite HMR is not blocked by the
 * contractPartyCounts ↔ templateRecipients cycle.
 */
export function resolveOwnerRowsForContractPrefill(
    application: unknown,
    contractOwners: Record<string, unknown>[] | null | undefined,
): Record<string, unknown>[] {
    const app = application as Record<string, unknown> | null | undefined;
    const client = app?.client as Record<string, unknown> | undefined;
    const fromContract = Array.isArray(contractOwners) ? contractOwners : [];

    if (client) {
        const related = client.owners;
        if (Array.isArray(related) && related.length) {
            const rows = related
                .map((row, i) =>
                    mergeOwnerRowAtIndex(
                        fromContract[i] as Record<string, unknown> | undefined,
                        row as Record<string, unknown>,
                    ),
                )
                .filter((row): row is Record<string, unknown> => row != null);
            for (let i = related.length; i < fromContract.length; i++) {
                const row = fromContract[i];
                if (row && ownerRowHasIdentity(row)) rows.push(row);
            }
            return rows;
        }

        const own = (client.owner ?? {}) as Record<string, unknown>;
        const ownAddr =
            own.address && typeof own.address === "object"
                ? (own.address as Record<string, unknown>)
                : {};
        const flat = mergeOwnerRowAtIndex(fromContract[0], {
            firstName: client.ownerFirstName ?? own.firstName,
            lastName: client.ownerLastName ?? own.lastName,
            email: client.ownerEmail ?? own.email ?? client.businessEmail,
            mobileNumber: client.ownerMobileNumber ?? client.ownerPhone ?? own.mobileNumber ?? own.phone,
            ssn: client.ownerSsn ?? own.ssn,
            driverLicense: client.driverLicense ?? own.driverLicense,
            address1: client.ownerAddress1 ?? own.address1 ?? ownAddr.address1,
            address2: client.ownerAddress2 ?? own.address2 ?? ownAddr.address2,
            city: client.ownerCity ?? own.city ?? ownAddr.city,
            state: client.ownerState ?? own.state ?? ownAddr.state,
            zipCode: client.ownerZipCode ?? own.zipCode ?? ownAddr.zipCode,
        });
        const rows: Record<string, unknown>[] = flat ? [flat] : [];
        for (let i = 1; i < fromContract.length; i++) {
            const row = fromContract[i];
            if (row && ownerRowHasIdentity(row)) rows.push(row);
        }
        if (rows.length) return rows;
    }

    return fromContract.filter((row) => ownerRowHasIdentity(row));
}
