import type { CreateClientPayload, OwnerDetail } from "@/types/clientTypes";
import type { AppDispatch } from "@/redux/store";
import { getApplicationById } from "@/redux/actions/applicationActions";
import { getClientById, updateClient } from "@/redux/actions/clientActions";
import { resetUpdateClient } from "@/redux/slices/clientSlice";
import {
    createContractOwner,
    getAllContractOwners,
    updateContractOwner,
} from "@/redux/actions/contractActions";
import { ownerRowHasIdentity } from "./contractPartyCounts";
import {
    dedupeContractSignerRows,
    resolveDocuSignSignerRole,
    type ContractSignerOverrideRow,
} from "./templateRecipients";
import { invalidateApplicationDetailCache } from "@/lib/applicationDetailCache";
import {
    resolveApplicationUuidForUpdate,
    resolveClientIdFromApplication,
} from "./contractPrefillSourceSync";

export type OwnerPartyForSigner = {
    ownerFirstName?: string;
    ownerLastName?: string;
    ownerEmail?: string;
};

function str(v: unknown): string {
    return String(v ?? "").trim();
}

function splitPersonName(full: string): { firstName: string; lastName: string } {
    const parts = full.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: "", lastName: "" };
    if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
    return {
        firstName: parts.slice(0, -1).join(" "),
        lastName: parts[parts.length - 1]!,
    };
}

function mapContractOwnerRowToParty(row: Record<string, unknown>): OwnerPartyForSigner {
    return {
        ownerFirstName: str(row.firstName ?? row.ownerFirstName),
        ownerLastName: str(row.lastName ?? row.ownerLastName),
        ownerEmail: str(row.email ?? row.ownerEmail),
    };
}

function mapClientOwnerToParty(row: Record<string, unknown>): OwnerPartyForSigner {
    return {
        ownerFirstName: str(row.firstName ?? row.ownerFirstName),
        ownerLastName: str(row.lastName ?? row.ownerLastName),
        ownerEmail: str(row.email ?? row.ownerEmail),
    };
}

function dedupeOwnerParties(parties: OwnerPartyForSigner[]): OwnerPartyForSigner[] {
    const seen = new Set<string>();
    const out: OwnerPartyForSigner[] = [];
    for (const party of parties) {
        if (!partyHasIdentity(party)) continue;
        const email = str(party.ownerEmail).toLowerCase();
        const name = `${str(party.ownerFirstName)} ${str(party.ownerLastName)}`
            .trim()
            .toLowerCase();
        const key = email || (name ? `name:${name}` : "");
        if (key) {
            if (seen.has(key)) continue;
            seen.add(key);
        }
        out.push(party);
    }
    return out;
}

function partyHasIdentity(party: OwnerPartyForSigner | undefined): boolean {
    if (!party) return false;
    return ownerRowHasIdentity({
        firstName: party.ownerFirstName,
        lastName: party.ownerLastName,
        email: party.ownerEmail,
        ownerFirstName: party.ownerFirstName,
        ownerLastName: party.ownerLastName,
        ownerEmail: party.ownerEmail,
    });
}

/** Client `owners[]` (or legacy flat owner fields) from the linked application. */
export function resolveClientOwnerPartiesFromApplication(
    application: unknown,
): OwnerPartyForSigner[] {
    const app = application as Record<string, unknown> | null | undefined;
    const client = app?.client as Record<string, unknown> | undefined;
    if (!client) return [];

    const related = client.owners;
    if (Array.isArray(related) && related.length) {
        return dedupeOwnerParties(
            related
                .map((row) => mapClientOwnerToParty(row as Record<string, unknown>))
                .filter(partyHasIdentity),
        );
    }

    const own = (client.owner ?? {}) as Record<string, unknown>;
    const flat: OwnerPartyForSigner = {
        ownerFirstName: str(client.ownerFirstName ?? own.firstName),
        ownerLastName: str(client.ownerLastName ?? own.lastName),
        ownerEmail: str(client.ownerEmail ?? own.email ?? client.businessEmail),
    };
    return partyHasIdentity(flat) ? [flat] : [];
}

function mergeOwnerPartyAtIndex(
    contractParty: OwnerPartyForSigner | undefined,
    clientParty: OwnerPartyForSigner | undefined,
): OwnerPartyForSigner | null {
    /** Application client owners are source of truth; contract rows only fill gaps. */
    const merged: OwnerPartyForSigner = {
        ownerFirstName: str(clientParty?.ownerFirstName) || str(contractParty?.ownerFirstName),
        ownerLastName: str(clientParty?.ownerLastName) || str(contractParty?.ownerLastName),
        ownerEmail: str(clientParty?.ownerEmail) || str(contractParty?.ownerEmail),
    };
    return partyHasIdentity(merged) ? merged : null;
}

function mergeOwnerRowAtIndex(
    contractRow: Record<string, unknown> | undefined,
    clientRow: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
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
        ssn: str(
            clientRow?.ssn ??
                clientRow?.ssnNumber ??
                contractRow?.ssn ??
                contractRow?.ssnNumber,
        ),
        ssnNumber: str(
            clientRow?.ssnNumber ??
                clientRow?.ssn ??
                contractRow?.ssnNumber ??
                contractRow?.ssn,
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
    };
    return ownerRowHasIdentity(merged) ? merged : null;
}

/**
 * Full owner rows (name, email, SSN, driver license) for contract prefill.
 * Application `client.owners[]` is source of truth; contract-owner API rows fill gaps.
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
            return related
                .map((row, i) =>
                    mergeOwnerRowAtIndex(
                        fromContract[i] as Record<string, unknown> | undefined,
                        row as Record<string, unknown>,
                    ),
                )
                .filter((row): row is Record<string, unknown> => row != null);
        }

        const own = (client.owner ?? {}) as Record<string, unknown>;
        const flat = mergeOwnerRowAtIndex(fromContract[0], {
            firstName: client.ownerFirstName ?? own.firstName,
            lastName: client.ownerLastName ?? own.lastName,
            email: client.ownerEmail ?? own.email ?? client.businessEmail,
            ssn: client.ownerSsn ?? own.ssn,
            driverLicense: client.driverLicense ?? own.driverLicense,
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

export function ownerPartiesFingerprint(parties: OwnerPartyForSigner[]): string {
    return JSON.stringify(
        parties.map((p) => ({
            firstName: str(p.ownerFirstName).toLowerCase(),
            lastName: str(p.ownerLastName).toLowerCase(),
            email: str(p.ownerEmail).toLowerCase(),
        })),
    );
}

/**
 * Contract-owner rows win when present; otherwise fall back to application client owners.
 * Local Info Required edits (owner panel) override when they carry identity.
 */
export function resolveOwnerPartiesForContractSigners(
    application: unknown,
    contractOwners: Record<string, unknown>[] | null | undefined,
    localOwnerEntries?: OwnerPartyForSigner[] | null,
): OwnerPartyForSigner[] {
    const local = localOwnerEntries?.filter(partyHasIdentity) ?? [];

    const fromContract = (Array.isArray(contractOwners) ? contractOwners : [])
        .map(mapContractOwnerRowToParty)
        .filter(partyHasIdentity);

    const fromClient = resolveClientOwnerPartiesFromApplication(application);

    if (local.length > 0) return dedupeOwnerParties(local);

    if (fromClient.length > 0) {
        return dedupeOwnerParties(
            fromClient.map((clientParty, i) => {
                const row = mergeOwnerPartyAtIndex(fromContract[i], clientParty);
                return row ?? clientParty;
            }),
        );
    }

    return dedupeOwnerParties(fromContract);
}

/** One signer row per application owner (name + email from CRM). */
export function buildContractSignerRowsFromOwnerParties(
    owners: OwnerPartyForSigner[],
): ContractSignerOverrideRow[] {
    return dedupeContractSignerRows(
        dedupeOwnerParties(owners).map((o) => {
            const name = `${str(o.ownerFirstName)} ${str(o.ownerLastName)}`.trim();
            const email = str(o.ownerEmail);
            return {
                role: resolveDocuSignSignerRole(),
                name: name || (email ? email.split("@")[0] : ""),
                email,
            };
        }),
    );
}

/**
 * Prefer live CRM owner rows over saved contract signer overrides (stale prefill).
 * Saved rows only fill slots where CRM has no owner data.
 */
export function reconcileSignerRowsWithFreshOwners(
    saved: ContractSignerOverrideRow[] | null | undefined,
    fresh: ContractSignerOverrideRow[],
): ContractSignerOverrideRow[] {
    const freshDeduped = dedupeContractSignerRows(fresh);
    if (!saved?.length) {
        return freshDeduped;
    }

    const savedDeduped = dedupeContractSignerRows(saved);
    const out: ContractSignerOverrideRow[] = [];
    for (let i = 0; i < savedDeduped.length; i++) {
        const persisted = savedDeduped[i]!;
        const live = freshDeduped[i];
        out.push({
            role: resolveDocuSignSignerRole(persisted.role || live?.role),
            name: str(live?.name) || str(persisted.name),
            email: str(live?.email) || str(persisted.email),
        });
    }
    return out.length ? out : freshDeduped;
}

/** Refetch application + contract owners; returns latest owner parties for signers. */
export async function fetchFreshOwnerPartiesForContractSigners(
    dispatch: AppDispatch,
    applicationId: string,
    contractId: number | null | undefined,
): Promise<OwnerPartyForSigner[]> {
    invalidateApplicationDetailCache(applicationId);

    let applicationData: unknown = null;
    try {
        const res = await dispatch(getApplicationById(applicationId)).unwrap();
        applicationData = (res as { data?: unknown })?.data ?? res;
    } catch {
        /* use redux state fallback */
    }

    let contractOwners: Record<string, unknown>[] = [];
    if (contractId != null && Number.isFinite(contractId)) {
        try {
            const res = await dispatch(getAllContractOwners({ contractId })).unwrap();
            const rows = (res as { data?: unknown })?.data ?? res;
            contractOwners = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
        } catch {
            /* ignore */
        }
    }

    return resolveOwnerPartiesForContractSigners(applicationData, contractOwners, null);
}

function partyRowFromOwner(party: OwnerPartyForSigner | undefined): ContractSignerOverrideRow {
    const name = party
        ? `${str(party.ownerFirstName)} ${str(party.ownerLastName)}`.trim()
        : "";
    const email = party ? str(party.ownerEmail) : "";
    return {
        role: resolveDocuSignSignerRole(),
        name: name || (email ? email.split("@")[0] : ""),
        email,
    };
}

/** Pad signer editor rows — empty slots autofill from linked application owners. */
export function mergeContractSignerEditorRows(
    currentRows: ContractSignerOverrideRow[],
    suggestedRows: ContractSignerOverrideRow[],
    targetCount: number,
    ownerParties?: OwnerPartyForSigner[],
): ContractSignerOverrideRow[] {
    const dedupedSuggested = dedupeContractSignerRows(suggestedRows);
    const dedupedOwners = ownerParties ? dedupeOwnerParties(ownerParties) : [];
    const count = Math.max(1, targetCount);
    const base = currentRows.length ? currentRows : dedupedSuggested;
    const out = [...base];

    while (out.length < count) {
        const idx = out.length;
        const fromSuggested = dedupedSuggested[idx];
        const fromParty = partyRowFromOwner(dedupedOwners[idx]);
        if (fromSuggested?.email || fromSuggested?.name) {
            out.push(fromSuggested);
        } else if (fromParty.email || fromParty.name) {
            out.push(fromParty);
        } else {
            out.push({
                role: resolveDocuSignSignerRole(),
                name: "",
                email: "",
            });
        }
    }

    for (let i = 0; i < out.length; i++) {
        const party = dedupedOwners[i];
        if (!party) continue;
        const fill = partyRowFromOwner(party);
        if (!str(out[i]!.name) && fill.name) out[i]!.name = fill.name;
        if (!str(out[i]!.email) && fill.email) out[i]!.email = fill.email;
    }

    return dedupeContractSignerRows(out.slice(0, count));
}

function mapApiOwnerToDetail(owner: Record<string, unknown> | OwnerDetail): OwnerDetail {
    const addr = (owner.address ?? {}) as Record<string, unknown>;
    return {
        firstName: str(owner.firstName),
        middleName: str(owner.middleName),
        lastName: str(owner.lastName),
        email: str(owner.email),
        mobileNumber: str(owner.mobileNumber),
        dateOfBirth: str(owner.dateOfBirth),
        ssn: str(owner.ssn),
        ficoScore: (owner.ficoScore as string | number) ?? "",
        ownershipStartDate: str(owner.ownershipStartDate),
        ownershipPercentage: (owner.ownershipPercentage as string | number) ?? "",
        address: {
            address1: str(addr.address1),
            address2: str(addr.address2),
            city: str(addr.city),
            state: str(addr.state),
            zipCode: str(addr.zipCode),
        },
    };
}

function emptyOwnerDetail(): OwnerDetail {
    return {
        firstName: "",
        middleName: "",
        lastName: "",
        email: "",
        mobileNumber: "",
        dateOfBirth: "",
        ssn: "",
        ficoScore: "",
        ownershipStartDate: "",
        ownershipPercentage: "",
        address: {
            address1: "",
            address2: "",
            city: "",
            state: "",
            zipCode: "",
        },
    };
}

async function fetchClientPayloadForUpdate(
    dispatch: AppDispatch,
    clientId: string,
    application: unknown,
): Promise<CreateClientPayload | null> {
    try {
        const res = await dispatch(getClientById(clientId)).unwrap();
        const client = (res as { data?: Record<string, unknown> })?.data ?? res;
        if (client && typeof client === "object") {
            const biz = (client.business ?? {}) as Record<string, unknown>;
            const addr = (biz.address ?? {}) as Record<string, unknown>;
            const owners = Array.isArray(client.owners) && client.owners.length > 0
                ? client.owners.map((row: Record<string, unknown>) => mapApiOwnerToDetail(row))
                : client.owner
                  ? [mapApiOwnerToDetail(client.owner as Record<string, unknown>)]
                  : [emptyOwnerDetail()];

            return {
                business: {
                    name: str(biz.name),
                    email: str(biz.email),
                    number: str(biz.number),
                    website: str(biz.website),
                    incorporationDate: str(biz.incorporationDate),
                    incorporationState: str(biz.incorporationState),
                    businessEntityType: str(biz.businessEntityType),
                    einNumber: str(biz.einNumber),
                    monthlyRevenue: (biz.monthlyRevenue as string | number) ?? "",
                    address: {
                        address1: str(addr.address1),
                        address2: str(addr.address2),
                        city: str(addr.city),
                        state: str(addr.state),
                        zipCode: str(addr.zipCode),
                    },
                },
                owners,
                owner: owners[0]!,
            };
        }
    } catch {
        /* fall back to embedded application client */
    }

    return buildClientPayloadFromApplication(application);
}

function buildClientPayloadFromApplication(application: unknown): CreateClientPayload | null {
    const app = application as Record<string, unknown> | null | undefined;
    const client = app?.client as Record<string, unknown> | undefined;
    if (!client) return null;

    const biz = (client.business ?? {}) as Record<string, unknown>;
    const addr = (biz.address ?? {}) as Record<string, unknown>;
    const ownerParties = resolveClientOwnerPartiesFromApplication(application);
    const mapOwnerDetail = (party: OwnerPartyForSigner, index: number) => {
        const related = Array.isArray(client.owners)
            ? (client.owners[index] as Record<string, unknown> | undefined)
            : index === 0
              ? ((client.owner ?? {}) as Record<string, unknown>)
              : undefined;
        const ownAddr = (related?.address ?? {}) as Record<string, unknown>;
        return {
            firstName: str(party.ownerFirstName ?? related?.firstName),
            middleName: str(related?.middleName),
            lastName: str(party.ownerLastName ?? related?.lastName),
            email: str(party.ownerEmail ?? related?.email),
            mobileNumber: str(
                related?.mobileNumber ?? client.ownerMobileNumber ?? client.ownerPhone,
            ),
            dateOfBirth: str(related?.dateOfBirth),
            ssn: str(related?.ssn ?? client.ownerSsn),
            ficoScore: (related?.ficoScore as string | number) ?? "",
            ownershipStartDate: str(related?.ownershipStartDate),
            ownershipPercentage: (related?.ownershipPercentage as string | number) ?? "",
            address: {
                address1: str(ownAddr.address1),
                address2: str(ownAddr.address2),
                city: str(ownAddr.city),
                state: str(ownAddr.state),
                zipCode: str(ownAddr.zipCode),
            },
        };
    };

    const owners =
        ownerParties.length > 0
            ? ownerParties.map(mapOwnerDetail)
            : [mapOwnerDetail({ ownerFirstName: "", ownerLastName: "", ownerEmail: "" }, 0)];

    return {
        business: {
            name: str(client.businessName ?? biz.name),
            email: str(client.businessEmail ?? biz.email),
            number: str(client.businessNumber ?? client.businessPhone ?? biz.number),
            website: str(biz.website),
            incorporationDate: str(biz.incorporationDate),
            incorporationState: str(
                client.businessIncorporationState ??
                    biz.incorporationState ??
                    client.stateOfIncorporation,
            ),
            businessEntityType: str(client.businessEntityType ?? biz.businessEntityType),
            einNumber: str(
                client.businessEinNumber ?? client.federalTaxIdEin ?? client.ein ?? biz.einNumber,
            ),
            monthlyRevenue: (biz.monthlyRevenue as string | number) ?? "",
            address: {
                address1: str(client.businessAddress1 ?? addr.address1),
                address2: str(client.businessAddress2 ?? addr.address2),
                city: str(client.businessCity ?? addr.city),
                state: str(client.businessState ?? addr.state),
                zipCode: str(client.businessZipCode ?? addr.zipCode ?? client.businessZip),
            },
        },
        owners,
        owner: owners[0]!,
    };
}

async function syncContractOwnerRecords(
    dispatch: AppDispatch,
    contractId: number,
    existingOwners: Record<string, unknown>[],
    signerRows: ContractSignerOverrideRow[],
): Promise<void> {
    for (let i = 0; i < signerRows.length; i++) {
        const row = signerRows[i]!;
        const email = str(row.email);
        const { firstName, lastName } = splitPersonName(row.name);
        if (!email && !firstName && !lastName) continue;

        const data = {
            contractId,
            firstName: firstName || "Owner",
            lastName: lastName || String(i + 1),
            email: email || undefined,
        };

        const existing = existingOwners[i];
        const existingId = existing?.id;
        if (existingId != null && String(existingId).trim() !== "") {
            await dispatch(
                updateContractOwner({
                    id: existingId as number | string,
                    data,
                }),
            ).unwrap();
        } else {
            await dispatch(createContractOwner(data)).unwrap();
        }
    }
    await dispatch(getAllContractOwners({ contractId })).unwrap();
}

/**
 * Persist contract signer name/email edits onto contract-owner rows and the linked client CRM record.
 */
export async function syncContractSignerRowsToCrm(args: {
    dispatch: AppDispatch;
    contractId: number;
    applicationData: unknown;
    signerRows: ContractSignerOverrideRow[];
    existingContractOwners?: Record<string, unknown>[] | null;
}): Promise<void> {
    const { dispatch, contractId, applicationData, signerRows, existingContractOwners } = args;
    const rows = signerRows.filter((r) => str(r.email) || str(r.name));
    if (!rows.length) return;

    await syncContractOwnerRecords(
        dispatch,
        contractId,
        Array.isArray(existingContractOwners) ? existingContractOwners : [],
        rows,
    );

    const clientId = resolveClientIdFromApplication(applicationData);
    if (!clientId) return;

    const base = await fetchClientPayloadForUpdate(dispatch, clientId, applicationData);
    if (!base) return;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const email = str(row.email);
        const { firstName, lastName } = splitPersonName(row.name);
        if (!base.owners[i]) {
            base.owners.push(emptyOwnerDetail());
        }
        const owner = base.owners[i]!;
        if (firstName) owner.firstName = firstName;
        if (lastName) owner.lastName = lastName;
        if (email) owner.email = email;
    }

    base.owner = base.owners[0]!;
    const primaryEmail = str(rows[0]?.email);
    if (primaryEmail && !str(base.business.email)) {
        base.business.email = primaryEmail;
    }

    await dispatch(updateClient({ id: clientId, data: base })).unwrap();
    dispatch(resetUpdateClient());

    const appUuid = resolveApplicationUuidForUpdate(applicationData);
    if (appUuid) {
        invalidateApplicationDetailCache(appUuid);
        await dispatch(getApplicationById(appUuid)).unwrap();
    }
}
