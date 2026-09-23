import type { ClientUpdatePayload, OwnerDetail } from "@/types/clientTypes";
import type { BuildContractPrefillFieldsArgs } from "./Contract";
import { sanitizePaymentFrequencyForPersist } from "./Contract";
import type { UpdateBankDetailPayload } from "@/types/bankDetailTypes";
import { parseNumberUS } from "@/lib/utils";
import type { AppDispatch } from "@/redux/store";
import { getClientById, updateClient } from "@/redux/actions/clientActions";
import { resetUpdateClient } from "@/redux/slices/clientSlice";
import {
    updateACH,
    updateContractGuarantor,
    updateContractOwner,
} from "@/redux/actions/contractActions";
import {
    createBankDetail,
    getBankDetails,
    updateBankDetail,
} from "@/redux/actions/bankDetailActions";
import { axiosPost } from "@/redux/axios";
import { emitOfferDecisionUpdated } from "@/lib/offerDecisionSync";

function str(v: unknown): string {
    return String(v ?? "").trim();
}

function parseMoney(v: unknown): number | null {
    if (v == null || v === "") return null;
    const n = parseNumberUS(v);
    return Number.isFinite(n) ? n : null;
}

function numericishEq(a: unknown, b: unknown): boolean {
    const na = parseMoney(a);
    const nb = parseMoney(b);
    if (na != null && nb != null) return na === nb;
    return str(a) === str(b);
}

function digitsEq(a: unknown, b: unknown): boolean {
    const da = str(a).replace(/\D/g, "");
    const db = str(b).replace(/\D/g, "");
    if (da && db) return da === db;
    return str(a) === str(b);
}

function recordPatchUnchanged(
    existing: Record<string, unknown> | null | undefined,
    patch: Record<string, unknown>,
): boolean {
    if (!existing) return false;
    for (const [key, raw] of Object.entries(patch)) {
        if (raw == null || str(raw) === "") continue;
        const next = str(raw);
        const prev = str(existing[key]);
        if (key === "frequency") {
            if (
                sanitizePaymentFrequencyForPersist(next) !==
                sanitizePaymentFrequencyForPersist(prev)
            ) {
                return false;
            }
            continue;
        }
        if (
            key === "offer" ||
            key === "totalRemit" ||
            key === "repayPerPeriod" ||
            key === "refinanceAmount" ||
            key === "fees" ||
            key === "paymentAmount"
        ) {
            if (!numericishEq(next, prev)) return false;
            continue;
        }
        if (prev !== next) return false;
    }
    return true;
}

function partyPatchUnchanged(
    row: Record<string, unknown> | null | undefined,
    data: Record<string, unknown>,
): boolean {
    if (!row) return false;
    const aliases: Record<string, string[]> = {
        ssn: ["ssn", "ssnNumber"],
        driverLicense: ["driverLicense", "driverLicenseNumber"],
        address: ["address", "address1"],
    };
    for (const [key, raw] of Object.entries(data)) {
        if (raw == null || str(raw) === "") continue;
        const next = str(raw);
        const keys = aliases[key] ?? [key];
        const prev = keys.map((k) => str(row[k])).find(Boolean) ?? "";
        if (key === "ssn") {
            if (!digitsEq(next, prev)) return false;
            continue;
        }
        if (prev !== next) return false;
    }
    return true;
}

function offerPayloadUnchanged(
    payload: Record<string, unknown>,
    existing: Record<string, unknown> | null | undefined,
): boolean {
    if (!existing) return false;
    if (
        str(payload.decision).toLowerCase() &&
        str(payload.decision).toLowerCase() !== str(existing.decision).toLowerCase() &&
        str(existing.decision)
    ) {
        return false;
    }
    if ("offer" in payload && !numericishEq(payload.offer, existing.offer ?? existing.approvedAmount)) {
        return false;
    }
    if ("totalRemit" in payload && !numericishEq(payload.totalRemit, existing.totalRemit)) {
        return false;
    }
    if (
        "repayPerPeriod" in payload &&
        !numericishEq(payload.repayPerPeriod, existing.repayPerPeriod ?? existing.paymentAmount)
    ) {
        return false;
    }
    if (
        "refinanceAmount" in payload &&
        !numericishEq(payload.refinanceAmount, existing.refinanceAmount ?? existing.RefinanceAmount)
    ) {
        return false;
    }
    if ("fees" in payload && !numericishEq(payload.fees, existing.fees)) {
        return false;
    }
    if (
        "frequency" in payload &&
        sanitizePaymentFrequencyForPersist(payload.frequency) !==
            sanitizePaymentFrequencyForPersist(existing.frequency)
    ) {
        return false;
    }
    return true;
}

function ownerFingerprint(owner: Partial<OwnerDetail> | OwnerDetail): string {
    return [
        str(owner.firstName),
        str(owner.lastName),
        str(owner.ssn).replace(/\D/g, ""),
        str(owner.email),
        str(owner.mobileNumber),
        str(owner.address?.address1),
        str(owner.address?.city),
        str(owner.address?.state),
        str(owner.address?.zipCode),
    ].join("|");
}

function clientPayloadUnchanged(
    next: ClientUpdatePayload,
    existing: ReturnType<typeof existingClientPayload>,
): boolean {
    if (!existing || !next.business) return false;
    const b = next.business;
    const e = existing.business;
    if (str(b.name) !== str(e.name)) return false;
    if (str(b.einNumber) !== str(e.einNumber)) return false;
    if (str(b.email) !== str(e.email)) return false;
    if (str(b.number) !== str(e.number)) return false;
    if (str(b.businessEntityType) !== str(e.businessEntityType)) return false;
    if (str(b.incorporationState) !== str(e.incorporationState)) return false;
    if (str(b.address?.address1) !== str(e.address?.address1)) return false;
    if (str(b.address?.city) !== str(e.address?.city)) return false;
    if (str(b.address?.state) !== str(e.address?.state)) return false;
    if (str(b.address?.zipCode) !== str(e.address?.zipCode)) return false;
    const nextOwners = next.owners?.length ? next.owners : next.owner ? [next.owner] : [];
    const prevOwners = existing.owners.length ? existing.owners : [existing.owner];
    if (nextOwners.length !== prevOwners.length) return false;
    return nextOwners.every(
        (row, i) => ownerFingerprint(row) === ownerFingerprint(prevOwners[i]!),
    );
}

/** Same resolution as OfferDecisionToggle / approval modal. */
export function resolveApplicationIdForOfferDecision(anyApp: unknown): string | null {
    const a = anyApp as Record<string, unknown> | null | undefined;
    if (!a) return null;
    const id = a.applicationId ?? a._id ?? a.id;
    return id != null && str(id) ? String(id) : null;
}

export function resolveApplicationUuidForUpdate(anyApp: unknown): string | null {
    const a = anyApp as Record<string, unknown> | null | undefined;
    if (!a) return null;
    const id = a._id ?? a.id;
    return id != null && str(id) ? String(id) : null;
}

export function resolveClientIdFromApplication(anyApp: unknown): string | null {
    const a = anyApp as Record<string, unknown> | null | undefined;
    if (!a) return null;
    const client = a.client as Record<string, unknown> | undefined;
    const fromClient = client?.id ?? client?._id;
    if (fromClient != null && str(fromClient)) return String(fromClient);
    const fromApp = a.clientId;
    // Prefer Mongo/UUID client ids; skip numeric application refs mistaken for clientId.
    if (fromApp != null && str(fromApp) && !/^\d+$/.test(String(fromApp))) {
        return String(fromApp);
    }
    return null;
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

function mapOwnerDetail(
    own: Record<string, unknown>,
    flat?: Record<string, unknown>,
): OwnerDetail {
    const ownAddr = (own.address ?? {}) as Record<string, unknown>;
    const c = flat ?? {};
    return {
        firstName: str(c.ownerFirstName ?? own.firstName),
        middleName: str(own.middleName),
        lastName: str(c.ownerLastName ?? own.lastName),
        email: str(c.ownerEmail ?? own.email),
        mobileNumber: str(c.ownerMobileNumber ?? own.mobileNumber ?? c.ownerPhone),
        dateOfBirth: str(own.dateOfBirth),
        ssn: str(c.ownerSsn ?? own.ssn),
        ficoScore: (own.ficoScore as string | number) ?? "",
        ownershipStartDate: str(own.ownershipStartDate),
        ownershipPercentage: (own.ownershipPercentage as string | number) ?? "",
        address: {
            address1: str(ownAddr.address1),
            address2: str(ownAddr.address2),
            city: str(ownAddr.city),
            state: str(ownAddr.state),
            zipCode: str(ownAddr.zipCode),
        },
    };
}

function cloneOwnerDetail(owner: OwnerDetail): OwnerDetail {
    return { ...owner, address: { ...owner.address } };
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

function resolveOwner1NameFromPrefill(prefill: Partial<BuildContractPrefillFieldsArgs>): string {
    return (
        str(prefill.guarantyClientName) ||
        str(prefill.guarantyOwner1Name) ||
        str(prefill.guarantyGuarantor1Name) ||
        str(prefill.owner1GuarantorName) ||
        str(prefill.authorizationClientSignerName) ||
        str(prefill.customerName) ||
        str(prefill.clientName)
    );
}

function resolveOwner2NameFromPrefill(prefill: Partial<BuildContractPrefillFieldsArgs>): string {
    return (
        str(prefill.merchant2Name) ||
        str(prefill.guarantyOwner2Name) ||
        str(prefill.guarantyGuarantor2Name) ||
        str(prefill.owner2GuarantorName)
    );
}

function resolveOwner1SsFromPrefill(prefill: Partial<BuildContractPrefillFieldsArgs>): string {
    return (
        str(prefill.guarantySs) ||
        str(prefill.guarantyOwner1Ss) ||
        str(prefill.guarantyGuarantor1Ss)
    );
}

function resolveOwner2SsFromPrefill(prefill: Partial<BuildContractPrefillFieldsArgs>): string {
    return str(prefill.guarantyOwner2Ss) || str(prefill.guarantyGuarantor2Ss);
}

function existingClientPayload(anyApp: unknown): { business: ClientUpdatePayload["business"] & object; owner: OwnerDetail; owners: OwnerDetail[] } | null {
    const a = anyApp as Record<string, unknown> | null | undefined;
    const client = a?.client as Record<string, unknown> | undefined;
    if (!client) return null;
    const biz = (client.business ?? {}) as Record<string, unknown>;
    const addr = (biz.address ?? {}) as Record<string, unknown>;
    const own = (client.owner ?? {}) as Record<string, unknown>;

    const owner = mapOwnerDetail(own, client);
    const owners: OwnerDetail[] =
        Array.isArray(client.owners) && client.owners.length > 0
            ? client.owners.map((row, index) =>
                  mapOwnerDetail(row as Record<string, unknown>, index === 0 ? client : undefined),
              )
            : [owner];

    return {
        business: {
            name: str(client.businessName ?? biz.name),
            email: str(client.businessEmail ?? biz.email),
            number: str(client.businessNumber ?? client.businessPhone ?? biz.number),
            website: str(biz.website),
            incorporationDate: str(biz.incorporationDate),
            incorporationState: str(
                client.businessIncorporationState ?? biz.incorporationState ?? client.stateOfIncorporation,
            ),
            businessEntityType: str(client.businessEntityType ?? biz.businessEntityType),
            einNumber: str(client.businessEinNumber ?? client.federalTaxIdEin ?? client.ein ?? biz.einNumber),
            monthlyRevenue: (biz.monthlyRevenue as string | number) ?? "",
            address: {
                address1: str(client.businessAddress1 ?? addr.address1),
                address2: str(client.businessAddress2 ?? addr.address2),
                city: str(client.businessCity ?? addr.city),
                state: str(client.businessState ?? addr.state),
                zipCode: str(client.businessZipCode ?? addr.zipCode ?? client.businessZip),
            },
        },
        owner,
        owners,
    };
}

/**
 * Map contract prefill fields back onto the linked client record (business + owners).
 * Sends the full `owners[]` array so owner 1 and owner 2 SSN/name edits persist to CRM.
 */
export function buildClientUpdateFromPrefill(
    prefill: Partial<BuildContractPrefillFieldsArgs>,
    anyApp: unknown,
): ClientUpdatePayload | null {
    const base = existingClientPayload(anyApp);
    if (!base) return null;

    const business = { ...base.business, address: { ...base.business.address } };
    const owners =
        base.owners.length > 0
            ? base.owners.map(cloneOwnerDetail)
            : [cloneOwnerDetail(base.owner)];

    const o1Name = resolveOwner1NameFromPrefill(prefill);
    const o1Ssn = resolveOwner1SsFromPrefill(prefill);
    const o2Name = resolveOwner2NameFromPrefill(prefill);
    const o2Ssn = resolveOwner2SsFromPrefill(prefill);

    if (o1Name) {
        const { firstName, lastName } = splitPersonName(o1Name);
        if (firstName) owners[0]!.firstName = firstName;
        if (lastName) owners[0]!.lastName = lastName;
    }
    if (o1Ssn) owners[0]!.ssn = o1Ssn;

    if (o2Name || o2Ssn) {
        if (!owners[1]) owners.push(emptyOwnerDetail());
        if (o2Name) {
            const { firstName, lastName } = splitPersonName(o2Name);
            if (firstName) owners[1]!.firstName = firstName;
            // Always write lastName so a single-token signer clears a stale prior last name.
            owners[1]!.lastName = lastName;
        }
        if (o2Ssn) owners[1]!.ssn = o2Ssn;
    }

    if (str(prefill.legalName) || str(prefill.securityBusinessName)) {
        business.name = str(prefill.legalName) || str(prefill.securityBusinessName);
    }
    if (str(prefill.federalTaxIdEin) || str(prefill.securityTaxEin)) {
        business.einNumber = str(prefill.federalTaxIdEin) || str(prefill.securityTaxEin);
    }
    if (str(prefill.state) || str(prefill.businessAddressState)) {
        business.incorporationState = str(prefill.state) || str(prefill.businessAddressState);
    }
    if (str(prefill.entityType)) business.businessEntityType = str(prefill.entityType);
    if (str(prefill.clientEmail)) {
        business.email = str(prefill.clientEmail);
        owners[0]!.email = str(prefill.clientEmail);
    }
    if (str(prefill.clientPhone)) {
        business.number = str(prefill.clientPhone);
        owners[0]!.mobileNumber = str(prefill.clientPhone);
    }
    if (str(prefill.businessAddress) || str(prefill.securityBusinessAddress)) {
        business.address!.address1 =
            str(prefill.businessAddress) || str(prefill.securityBusinessAddress);
    }
    if (str(prefill.businessAddressCity) || str(prefill.securityBusinessAddressCity)) {
        business.address!.city =
            str(prefill.businessAddressCity) || str(prefill.securityBusinessAddressCity);
    }
    if (str(prefill.businessAddressState) || str(prefill.securityBusinessAddressState)) {
        business.address!.state =
            str(prefill.businessAddressState) || str(prefill.securityBusinessAddressState);
    }
    if (str(prefill.businessAddressZip) || str(prefill.securityBusinessAddressZip)) {
        business.address!.zipCode =
            str(prefill.businessAddressZip) || str(prefill.securityBusinessAddressZip);
    }

    /** Contact / mailing + guarantor address → Owner 1 home address. */
    const ownerStreet =
        str(prefill.businessAddressContract) || str(prefill.guarantorAddress);
    const ownerCity =
        str(prefill.businessAddressContractCity) || str(prefill.guarantorAddressCity);
    const ownerState =
        str(prefill.businessAddressContractState) || str(prefill.guarantorAddressState);
    const ownerZip =
        str(prefill.businessAddressContractZip) || str(prefill.guarantorAddressZip);
    if (ownerStreet || ownerCity || ownerState || ownerZip) {
        if (!owners[0]!.address) {
            owners[0]!.address = {
                address1: "",
                address2: "",
                city: "",
                state: "",
                zipCode: "",
            };
        }
        if (ownerStreet) owners[0]!.address.address1 = ownerStreet;
        if (ownerCity) owners[0]!.address.city = ownerCity;
        if (ownerState) owners[0]!.address.state = ownerState;
        if (ownerZip) owners[0]!.address.zipCode = ownerZip;
    }

    const primaryOwner = cloneOwnerDetail(owners[0]!);

    return {
        business: business as ClientUpdatePayload["business"],
        owner: primaryOwner,
        owners,
    };
}

export function buildOfferDecisionUpsertFromPrefill(
    prefill: Partial<BuildContractPrefillFieldsArgs>,
    existingOfferDecision: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    const offer = parseMoney(prefill.purchaseAmount);
    const totalRemit = parseMoney(prefill.purchasePrice);
    const repayPerPeriod = parseMoney(prefill.remittance);
    const hasRefinanceKey = Object.prototype.hasOwnProperty.call(prefill, "refinanceAmount");
    const refinanceAmount = parseMoney(prefill.refinanceAmount);
    const frequency = sanitizePaymentFrequencyForPersist(prefill.frequency);
    const fees = parseMoney(prefill.appendixUnderwritingFees);

    if (
        offer == null &&
        totalRemit == null &&
        repayPerPeriod == null &&
        !hasRefinanceKey &&
        !frequency &&
        fees == null
    ) {
        return null;
    }

    const existing = existingOfferDecision ?? {};
    const decision =
        str(existing.decision).toLowerCase() === "declined" ? "declined" : "approved";

    const payload: Record<string, unknown> = { decision };
    if (offer != null) payload.offer = offer;
    if (totalRemit != null) payload.totalRemit = totalRemit;
    if (repayPerPeriod != null) payload.repayPerPeriod = repayPerPeriod;
    if (hasRefinanceKey) payload.refinanceAmount = refinanceAmount ?? 0;
    if (frequency) payload.frequency = frequency;
    if (fees != null) payload.fees = fees;

    if ("position" in existing && existing.position != null) payload.position = existing.position;
    // Factor rate (`OfferDecision.rate`) must stay independent of Specific Percentage /
    // SPA (`purchasePercent`). Never write SPA back onto application rate.
    if ("rate" in existing && existing.rate != null) {
        payload.rate = existing.rate;
    }
    if ("term" in existing && existing.term != null) payload.term = existing.term;
    if ("monthlyPayment" in existing && existing.monthlyPayment != null) {
        payload.monthlyPayment = existing.monthlyPayment;
    }
    if ("ourRemit" in existing && existing.ourRemit != null) payload.ourRemit = existing.ourRemit;

    return payload;
}

export function resolveBankDetailId(bankDetail: Record<string, unknown> | null | undefined): string | null {
    if (!bankDetail) return null;
    const id = bankDetail._id ?? bankDetail.id;
    return id != null && str(id) ? String(id) : null;
}

/**
 * Map contract prefill bank fields back onto the linked CRM BankDetail row.
 * Mirrors `bankDetailRowToPrefillPartial` in Contract.ts (BankDetail → prefill).
 */
export function buildBankDetailUpdateFromPrefill(
    prefill: Partial<BuildContractPrefillFieldsArgs>,
): UpdateBankDetailPayload | null {
    const bankName =
        str(prefill.authorizationClientBankName) ||
        str(prefill.achAuthorizationAccountHolderBankName);
    const accountNumber =
        str(prefill.authorizationClientBankAccount) ||
        str(prefill.achAuthorizationAccountHolderBankAccountNumber);
    const routingNumber =
        str(prefill.authorizationClientBankRouting) ||
        str(prefill.achAuthorizationAccountHolderBankRoutingNumber);

    if (!bankName && !accountNumber && !routingNumber) return null;

    const payload: UpdateBankDetailPayload = {};
    if (bankName) payload.bankName = bankName;
    if (accountNumber) payload.accountNumber = accountNumber;
    if (routingNumber) payload.routingNumber = routingNumber;
    return payload;
}

export type SyncContractPrefillSourceRecordsArgs = {
    dispatch: AppDispatch;
    applicationData: unknown;
    applicationUuid?: string | null;
    prefill: Partial<BuildContractPrefillFieldsArgs>;
    offerDecision?: Record<string, unknown> | null;
    contractGuarantors?: Record<string, unknown>[] | null;
    contractOwners?: Record<string, unknown>[] | null;
    contractAch?: Record<string, unknown> | null;
    bankDetail?: Record<string, unknown> | null;
    contract?: Record<string, unknown> | null;
};

async function syncContractPartyRowsFromPrefill(
    dispatch: AppDispatch,
    rows: Record<string, unknown>[] | null | undefined,
    prefill: Partial<BuildContractPrefillFieldsArgs>,
    kind: "guarantor" | "owner",
): Promise<void> {
    const list = Array.isArray(rows) ? rows : [];
    const patches: Array<{
        row: Record<string, unknown> | undefined;
        name: string;
        ssn: string;
        driverLicense: string;
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
    }> = [
        {
            row: list[0],
            name: resolveOwner1NameFromPrefill(prefill),
            ssn: resolveOwner1SsFromPrefill(prefill),
            driverLicense:
                str(prefill.guarantySsDriverLicense) ||
                str(prefill.guarantyOwner1DriverLicense) ||
                str(prefill.guarantyGuarantor1DriverLicense),
            address: str(prefill.businessAddressContract) || str(prefill.guarantorAddress),
            city: str(prefill.businessAddressContractCity) || str(prefill.guarantorAddressCity),
            state: str(prefill.businessAddressContractState) || str(prefill.guarantorAddressState),
            zip: str(prefill.businessAddressContractZip) || str(prefill.guarantorAddressZip),
        },
        {
            row: list[1],
            name: resolveOwner2NameFromPrefill(prefill),
            ssn: resolveOwner2SsFromPrefill(prefill),
            driverLicense:
                str(prefill.guarantyOwner2DriverLicense) ||
                str(prefill.guarantyGuarantor2DriverLicense),
        },
    ];

    for (const patch of patches) {
        const id = patch.row?.id;
        if (id == null || String(id).trim() === "") continue;
        if (
            !patch.name &&
            !patch.ssn &&
            !patch.driverLicense &&
            !patch.address &&
            !patch.city &&
            !patch.state &&
            !patch.zip
        ) {
            continue;
        }

        const data: Record<string, unknown> = {};
        if (patch.ssn) data.ssn = patch.ssn;
        if (patch.driverLicense) data.driverLicense = patch.driverLicense;
        if (patch.address) data.address = patch.address;
        if (patch.city) data.city = patch.city;
        if (patch.state) data.state = patch.state;
        if (patch.zip) data.zip = patch.zip;
        if (patch.name) {
            const { firstName, lastName } = splitPersonName(patch.name);
            if (firstName) data.firstName = firstName;
            data.lastName = lastName;
        }
        if (Object.keys(data).length === 0) continue;
        if (partyPatchUnchanged(patch.row, data)) continue;
        if (kind === "guarantor") {
            await dispatch(
                updateContractGuarantor({
                    id: id as number | string,
                    data,
                }),
            ).unwrap();
        } else {
            await dispatch(
                updateContractOwner({
                    id: id as number | string,
                    data,
                }),
            ).unwrap();
        }
    }
}

async function syncContractAchFromPrefill(
    dispatch: AppDispatch,
    ach: Record<string, unknown> | null | undefined,
    prefill: Partial<BuildContractPrefillFieldsArgs>,
): Promise<void> {
    const id = ach?.id;
    if (id == null || String(id).trim() === "") return;

    const bankName =
        str(prefill.authorizationClientBankName) ||
        str(prefill.achAuthorizationAccountHolderBankName);
    const accountNumber =
        str(prefill.authorizationClientBankAccount) ||
        str(prefill.achAuthorizationAccountHolderBankAccountNumber);
    const routingNumber =
        str(prefill.authorizationClientBankRouting) ||
        str(prefill.achAuthorizationAccountHolderBankRoutingNumber);
    const dba =
        str(prefill.doingBusinessAs) ||
        str(prefill.achAuthorizationAccountHolderDba) ||
        str(prefill.securityDoingBusinessAs);
    const phone =
        str(prefill.authorizedBusinessPhone) ||
        str(prefill.achAuthorizationAccountHolderPhone) ||
        str(prefill.clientPhone);
    const paymentAmount =
        str(prefill.remittance) ||
        str(prefill.achAuthorizationAccountHolderBankTransactionFee);
    const frequency = sanitizePaymentFrequencyForPersist(prefill.frequency);
    /**
     * The ACH account holder's address is Owner 1's home address, not the business
     * physical address — the ACH block already prints the business address on its own
     * line, so falling back to it printed the same street twice on every addendum.
     */
    const address =
        str(prefill.achAuthorizationAccountHolderAddress) ||
        str(prefill.businessAddressContract) ||
        str(prefill.guarantorAddress);
    const city =
        str(prefill.achAuthorizationAccountHolderCity) ||
        str(prefill.businessAddressContractCity) ||
        str(prefill.guarantorAddressCity);
    const state =
        str(prefill.achAuthorizationAccountHolderState) ||
        str(prefill.businessAddressContractState) ||
        str(prefill.guarantorAddressState);
    const zip =
        str(prefill.achAuthorizationAccountHolderZip) ||
        str(prefill.businessAddressContractZip) ||
        str(prefill.guarantorAddressZip);

    const data: Record<string, unknown> = {};
    if (bankName) data.bankName = bankName;
    if (accountNumber) data.accountNumber = accountNumber;
    if (routingNumber) data.routingNumber = routingNumber;
    if (dba) data.dba = dba;
    if (phone) data.phone = phone;
    if (paymentAmount) data.paymentAmount = paymentAmount;
    if (frequency) data.frequency = frequency;
    if (address) data.address = address;
    if (city) data.city = city;
    if (state) data.state = state;
    if (zip) data.zip = zip;
    const holderName =
        str(prefill.achAuthorizationAccountHolderName) ||
        str(prefill.authorizationClientName) ||
        str(prefill.legalName);
    if (holderName) data.accountHolderName = holderName;
    if (str(prefill.achAuthorizationAccountHolderBankBranchCity)) {
        data.bankBranchCity = str(prefill.achAuthorizationAccountHolderBankBranchCity);
    }
    if (str(prefill.achAuthorizationAccountHolderBankState)) {
        data.bankState = str(prefill.achAuthorizationAccountHolderBankState);
    }
    if (str(prefill.achAuthorizationAccountHolderBankZip)) {
        data.bankZip = str(prefill.achAuthorizationAccountHolderBankZip);
    }
    if (Object.keys(data).length === 0) return;
    if (recordPatchUnchanged(ach, data)) return;

    await dispatch(
        updateACH({
            id: id as number | string,
            data,
        }),
    ).unwrap();
}

export type UpsertApplicationBankDetailFromPrefillArgs = {
    dispatch: AppDispatch;
    applicationUuid?: string | null;
    applicationData?: unknown;
    prefill: Partial<BuildContractPrefillFieldsArgs>;
    bankDetail?: Record<string, unknown> | null;
};

/**
 * Create or update the application BankDetail row from contract / template prefill
 * so Monthly Fee, ACH, Exhibit C, and Overview all reuse the same stored bank.
 */
export async function upsertApplicationBankDetailFromPrefill({
    dispatch,
    applicationUuid = null,
    applicationData = null,
    prefill,
    bankDetail = null,
}: UpsertApplicationBankDetailFromPrefillArgs): Promise<void> {
    const payload = buildBankDetailUpdateFromPrefill(prefill);
    if (!payload) return;

    const appKey =
        str(applicationUuid) ||
        resolveApplicationUuidForUpdate(applicationData) ||
        resolveApplicationIdForOfferDecision(applicationData);
    let existingRow = (bankDetail as Record<string, unknown> | null) ?? null;
    let bankId = resolveBankDetailId(existingRow);

    const matchesExisting = (row: Record<string, unknown> | null | undefined) => {
        if (!row) return false;
        return (
            (!payload.bankName || str(payload.bankName) === str(row.bankName)) &&
            (!payload.accountNumber || digitsEq(payload.accountNumber, row.accountNumber)) &&
            (!payload.routingNumber || digitsEq(payload.routingNumber, row.routingNumber))
        );
    };

    if (bankId && matchesExisting(existingRow)) return;

    if (!bankId && appKey) {
        try {
            const listed = await dispatch(getBankDetails({ application: appKey })).unwrap();
            const rows = Array.isArray((listed as { data?: unknown })?.data)
                ? ((listed as { data: Record<string, unknown>[] }).data)
                : Array.isArray(listed)
                  ? (listed as Record<string, unknown>[])
                  : [];
            const latest = [...rows].sort((a, b) => {
                const ta = new Date(String(b.updatedAt ?? b.createdAt ?? 0)).getTime();
                const tb = new Date(String(a.updatedAt ?? a.createdAt ?? 0)).getTime();
                return ta - tb;
            })[0];
            existingRow = latest ?? null;
            bankId = resolveBankDetailId(existingRow);
            if (bankId && matchesExisting(existingRow)) return;
        } catch {
            /* create below if still missing */
        }
    }

    if (bankId) {
        await dispatch(
            updateBankDetail({
                id: bankId,
                data: payload,
            }),
        ).unwrap();
        return;
    }

    if (appKey && str(payload.accountNumber)) {
        await dispatch(
            createBankDetail({
                bankName: str(payload.bankName),
                accountNumber: str(payload.accountNumber),
                routingNumber: str(payload.routingNumber) || undefined,
                application: appKey,
            }),
        ).unwrap();
    }
}

/**
 * Persist offer-decision, client, bank, ACH, and owner/guarantor fields edited via
 * Verify contract prefill so application screens reload the same values.
 */
export async function syncContractPrefillToSourceRecords({
    dispatch,
    applicationData,
    applicationUuid = null,
    prefill,
    offerDecision = null,
    contractGuarantors = null,
    contractOwners = null,
    contractAch = null,
    bankDetail = null,
}: SyncContractPrefillSourceRecordsArgs): Promise<void> {
    const offerAppId =
        resolveApplicationIdForOfferDecision(applicationData) ??
        (str(applicationUuid) || null);
    const appUuid =
        str(applicationUuid) || resolveApplicationUuidForUpdate(applicationData) || null;
    let clientId = resolveClientIdFromApplication(applicationData);
    if (!clientId) {
        const app = applicationData as Record<string, unknown> | null | undefined;
        const fromApp = app?.clientId;
        if (fromApp != null && str(fromApp)) clientId = String(fromApp);
    }

    // Application detail sometimes omits nested client — fetch so business/owner updates still run.
    let appForClient = applicationData;
    if (clientId && !existingClientPayload(appForClient)) {
        try {
            const res = await dispatch(getClientById(clientId)).unwrap();
            const client = (res as { data?: unknown })?.data ?? res;
            if (client && typeof client === "object") {
                appForClient = { ...(appForClient as object), client };
            }
        } catch {
            /* continue with whatever we have */
        }
    }

    const tasks: Promise<unknown>[] = [];

    const offerPayload = buildOfferDecisionUpsertFromPrefill(prefill, offerDecision);
    if (
        offerPayload &&
        offerAppId &&
        !offerPayloadUnchanged(offerPayload, offerDecision)
    ) {
        tasks.push(
            axiosPost("/offer-decisions", {
                applicationId: offerAppId,
                ...offerPayload,
            }).then(() => {
                emitOfferDecisionUpdated(offerAppId, { skipRefetch: true });
            }),
        );
    }

    const existingClient = existingClientPayload(appForClient);
    const clientPayload = buildClientUpdateFromPrefill(prefill, appForClient);
    if (clientPayload && clientId && !clientPayloadUnchanged(clientPayload, existingClient)) {
        tasks.push(
            dispatch(
                updateClient({
                    id: clientId,
                    data: clientPayload,
                }),
            )
                .unwrap()
                .then(() => {
                    dispatch(resetUpdateClient());
                }),
        );
    }

    if (contractGuarantors?.length) {
        tasks.push(
            syncContractPartyRowsFromPrefill(dispatch, contractGuarantors, prefill, "guarantor"),
        );
    }
    if (contractOwners?.length) {
        tasks.push(syncContractPartyRowsFromPrefill(dispatch, contractOwners, prefill, "owner"));
    }
    if (contractAch) {
        tasks.push(syncContractAchFromPrefill(dispatch, contractAch, prefill));
    }

    tasks.push(
        upsertApplicationBankDetailFromPrefill({
            dispatch,
            applicationUuid: appUuid,
            applicationData,
            prefill,
            bankDetail,
        }),
    );

    if (tasks.length === 0) return;

    const results = await Promise.allSettled(tasks);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
        console.warn("[ContractPrefillEditForm] source record sync partial failure:", failures);
        throw new Error(
            "Contract prefill saved, but some application or offer fields could not be synced. Refresh and try again.",
        );
    }
}
