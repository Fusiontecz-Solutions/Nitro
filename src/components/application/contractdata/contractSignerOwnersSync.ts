import type { CreateClientPayload, OwnerDetail } from "@/types/clientTypes";
import type { AppDispatch } from "@/redux/store";
import { getApplicationById } from "@/redux/actions/applicationActions";
import { getClientByClientId, getClientById, updateClient } from "@/redux/actions/clientActions";
import { resetUpdateClient } from "@/redux/slices/clientSlice";
import {
    createContractOwner,
    deleteContractOwner,
    getAllContractOwners,
    updateContractOwner,
} from "@/redux/actions/contractActions";
import { ownerRowHasIdentity } from "./contractPartyCounts";
import { resolveOwnerRowsForContractPrefill } from "./contractOwnerPrefillRows";
import { resolveDocuSignSignerRole, type ContractSignerOverrideRow } from "./templateRecipients";
import { type OwnerPartyForSigner } from "./contractSignerRows";

export {
    buildContractSignerRowsFromOwnerParties,
    ensureSignerRowsFromCrmOwners,
    reconcileSignerRowsWithFreshOwners,
    type OwnerPartyForSigner,
} from "./contractSignerRows";
import { invalidateApplicationDetailCache } from "@/lib/applicationDetailCache";
import {
    getClientFetchArg,
    getClientFetchKeyFromApplicationClient,
    mapOwnerContactFromClientRow,
    resolveOwnersFromClientData,
} from "@/lib/clientOwners";
import {
    resolveApplicationUuidForUpdate,
    resolveClientIdFromApplication,
} from "./contractPrefillSourceSync";

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

export function dedupeOwnerParties(parties: OwnerPartyForSigner[]): OwnerPartyForSigner[] {
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

/** Merge full `owners[]` from client detail onto the embedded application client payload. */
export function applicationWithClientOwners(
    application: unknown,
    owners: OwnerDetail[] | null | undefined,
): unknown {
    const app = application as Record<string, unknown> | null | undefined;
    if (!app || !owners?.length) return application;
    const client = app.client as Record<string, unknown> | undefined;
    if (!client || typeof client !== "object") return application;
    return {
        ...app,
        client: {
            ...client,
            owners,
        },
    };
}

/** Client `owners[]` (or legacy flat owner fields) from the linked application. */
export function resolveClientOwnerPartiesFromApplication(
    application: unknown,
): OwnerPartyForSigner[] {
    const app = application as Record<string, unknown> | null | undefined;
    const client = app?.client;
    if (!client) return [];

    return resolveOwnersFromClientData(client)
        .map((row) => mapClientOwnerToParty(row as unknown as Record<string, unknown>))
        .filter(partyHasIdentity);
}

export function mergeOwnerPartyAtIndex(
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
 * Application client owners are source of truth; contract-owner rows fill gaps and
 * supply additional signer slots when the contract has more owners than the client.
 */
export function resolveOwnerPartiesForContractSigners(
    application: unknown,
    contractOwners: Record<string, unknown>[] | null | undefined,
    localOwnerEntries?: OwnerPartyForSigner[] | null,
): OwnerPartyForSigner[] {
    const local = localOwnerEntries?.filter(partyHasIdentity) ?? [];
    if (local.length > 0) return local.slice(0, 2);

    return resolveOwnerRowsForContractPrefill(application, contractOwners)
        .slice(0, 2)
        .map((row) => mapContractOwnerRowToParty(row))
        .filter(partyHasIdentity);
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
            contractOwners = sortContractOwnerRows(
                Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [],
            );
        } catch {
            /* ignore */
        }
    }

    let applicationForResolve = applicationData;
    const fetchKey = getClientFetchKeyFromApplicationClient(
        (applicationData as { client?: unknown } | null)?.client,
    );
    const fetchArg = getClientFetchArg(fetchKey);
    if (fetchArg) {
        try {
            const clientRes = fetchKey?.startsWith("clientId:")
                ? await dispatch(getClientByClientId(fetchArg)).unwrap()
                : await dispatch(getClientById(fetchArg)).unwrap();
            const fullClient = (clientRes as { data?: unknown })?.data ?? clientRes;
            applicationForResolve = applicationWithClientOwners(
                applicationData,
                resolveOwnersFromClientData(fullClient),
            );
        } catch {
            /* use application embed */
        }
    }

    return resolveOwnerPartiesForContractSigners(applicationForResolve, contractOwners, null);
}

export function sortContractOwnerRows(
    rows: Record<string, unknown>[],
): Record<string, unknown>[] {
    return [...rows].sort((a, b) => {
        const aT = new Date(String(a.createdAt ?? 0)).getTime();
        const bT = new Date(String(b.createdAt ?? 0)).getTime();
        return aT - bT;
    });
}

function partyRowFromOwner(party: OwnerPartyForSigner | undefined, index = 0): ContractSignerOverrideRow {
    const name = party
        ? `${str(party.ownerFirstName)} ${str(party.ownerLastName)}`.trim()
        : "";
    const email = party ? str(party.ownerEmail) : "";
    return {
        role: resolveDocuSignSignerRole(index === 0 ? undefined : "Owner 2"),
        name: name || (email ? email.split("@")[0] : ""),
        email,
    };
}

/** Pad signer editor rows — one row per owner slot (up to 2), without email dedupe. */
export function mergeContractSignerEditorRows(
    currentRows: ContractSignerOverrideRow[],
    suggestedRows: ContractSignerOverrideRow[],
    targetCount: number,
    ownerParties?: OwnerPartyForSigner[],
): ContractSignerOverrideRow[] {
    const count = Math.min(2, Math.max(1, targetCount));
    const parties = (ownerParties ?? []).slice(0, count);
    const suggested = suggestedRows.slice(0, count);
    const out: ContractSignerOverrideRow[] = [];

    for (let i = 0; i < count; i++) {
        const current = currentRows[i];
        const suggest = suggested[i];
        const party = partyRowFromOwner(parties[i], i);
        out.push({
            role: resolveDocuSignSignerRole(
                current?.role || suggest?.role || party.role,
            ),
            name: str(current?.name) || str(suggest?.name) || str(party.name),
            email: str(current?.email) || str(suggest?.email) || str(party.email),
        });
    }

    return out;
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
        const contact = mapOwnerContactFromClientRow(related, client, index);
        return {
            firstName: str(party.ownerFirstName ?? related?.firstName),
            middleName: str(related?.middleName),
            lastName: str(party.ownerLastName ?? related?.lastName),
            email: str(party.ownerEmail ?? related?.email),
            mobileNumber: contact.mobileNumber,
            dateOfBirth: contact.dateOfBirth,
            ssn: contact.ssn,
            ficoScore: (related?.ficoScore as string | number) ?? "",
            ownershipStartDate: str(related?.ownershipStartDate),
            ownershipPercentage: (related?.ownershipPercentage as string | number) ?? "",
            address: contact.address,
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
    const sorted = sortContractOwnerRows(existingOwners);
    for (let i = 0; i < signerRows.length; i++) {
        const row = signerRows[i]!;
        const email = str(row.email);
        const { firstName, lastName } = splitPersonName(row.name);
        if (!email && !firstName && !lastName) continue;

        const data = {
            contractId,
            firstName: firstName || "Owner",
            /** Placeholder only for required contract-owner column — never use slot index. */
            lastName: lastName || "—",
            email: email || undefined,
        };

        const existing = sorted[i];
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

    /** Remove stale Owner 2+ contract rows when Signer 2 was removed. */
    for (let i = sorted.length - 1; i >= signerRows.length; i--) {
        const oid = Number(sorted[i]?.id);
        if (Number.isFinite(oid) && oid > 0) {
            try {
                await dispatch(deleteContractOwner(oid)).unwrap();
            } catch {
                /* ignore delete failures */
            }
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
        sortContractOwnerRows(
            Array.isArray(existingContractOwners) ? existingContractOwners : [],
        ),
        rows,
    );

    const clientId = resolveClientIdFromApplication(applicationData);
    if (!clientId) return;

    let base = await fetchClientPayloadForUpdate(dispatch, clientId, applicationData);
    if (!base) return;

    const fetchKey = getClientFetchKeyFromApplicationClient(
        (applicationData as { client?: unknown } | null)?.client,
    );
    const fetchArg = getClientFetchArg(fetchKey);
    if (fetchArg) {
        try {
            const clientRes = fetchKey?.startsWith("clientId:")
                ? await dispatch(getClientByClientId(fetchArg)).unwrap()
                : await dispatch(getClientById(fetchArg)).unwrap();
            const fullClient = (clientRes as { data?: unknown })?.data ?? clientRes;
            const fullOwners = resolveOwnersFromClientData(fullClient);
            if (fullOwners.length > 0) {
                const refreshed = await fetchClientPayloadForUpdate(
                    dispatch,
                    clientId,
                    applicationWithClientOwners(applicationData, fullOwners),
                );
                if (refreshed) base = refreshed;
            }
        } catch {
            /* use base from initial fetch */
        }
    }

    while (base.owners.length < rows.length) {
        base.owners.push(emptyOwnerDetail());
    }
    /** Signer 1 → Owner 1, Signer 2 → Owner 2; drop extra CRM owners when Signer 2 is removed. */
    if (base.owners.length > rows.length) {
        base.owners = base.owners.slice(0, Math.max(1, rows.length));
    }

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i]!;
        const email = str(row.email);
        const { firstName, lastName } = splitPersonName(row.name);
        const owner = base.owners[i]!;
        if (firstName || lastName || str(row.name)) {
            owner.firstName = firstName || str(row.name) || owner.firstName;
            // Always write lastName so single-token signer names clear stale "2"/"1" leftovers.
            owner.lastName = lastName === "—" ? "" : lastName;
        }
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
