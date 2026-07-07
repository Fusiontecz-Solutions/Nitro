import type { ClientUpdatePayload, OwnerDetail } from "@/types/clientTypes";
import type { BuildContractPrefillFieldsArgs } from "./Contract";
import {
    applyCanonicalBankFieldsToPrefill,
    resolveCanonicalBankFromPrefill,
} from "./Contract";
import type { UpdateBankDetailPayload } from "@/types/bankDetailTypes";
import { parseNumberUS } from "@/lib/utils";
import type { AppDispatch } from "@/redux/store";
import { getApplicationById } from "@/redux/actions/applicationActions";
import { updateClient } from "@/redux/actions/clientActions";
import { resetUpdateClient } from "@/redux/slices/clientSlice";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import { updateContractGuarantor } from "@/redux/actions/contractActions";
import { getBankDetails, updateBankDetail, createBankDetail } from "@/redux/actions/bankDetailActions";
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
        str(prefill.customerName) ||
        str(prefill.clientName) ||
        str(prefill.owner1GuarantorName) ||
        str(prefill.guarantyClientName) ||
        str(prefill.guarantyOwner1Name) ||
        str(prefill.guarantyGuarantor1Name)
    );
}

function resolveOwner2NameFromPrefill(prefill: Partial<BuildContractPrefillFieldsArgs>): string {
    return (
        str(prefill.merchant2Name) ||
        str(prefill.guarantyOwner2Name) ||
        str(prefill.guarantyGuarantor2Name)
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
            if (lastName) owners[1]!.lastName = lastName;
        }
        if (o2Ssn) owners[1]!.ssn = o2Ssn;
    }

    if (str(prefill.legalName)) business.name = str(prefill.legalName);
    if (str(prefill.federalTaxIdEin)) business.einNumber = str(prefill.federalTaxIdEin);
    if (str(prefill.state)) business.incorporationState = str(prefill.state);
    if (str(prefill.entityType)) business.businessEntityType = str(prefill.entityType);
    if (str(prefill.clientEmail)) {
        business.email = str(prefill.clientEmail);
        if (!str(owners[0]!.email)) owners[0]!.email = str(prefill.clientEmail);
    }
    if (str(prefill.clientPhone)) {
        business.number = str(prefill.clientPhone);
        if (!str(owners[0]!.mobileNumber)) {
            owners[0]!.mobileNumber = str(prefill.clientPhone);
        }
    }
    if (str(prefill.authorizedBusinessPhone) && !str(business.number)) {
        business.number = str(prefill.authorizedBusinessPhone);
    }
    if (str(prefill.guarantorPhone) && owners[0] && !str(owners[0].mobileNumber)) {
        owners[0].mobileNumber = str(prefill.guarantorPhone);
    }
    if (str(prefill.guarantorEmail) && owners[0] && !str(owners[0].email)) {
        owners[0].email = str(prefill.guarantorEmail);
    }
    if (str(prefill.businessAddress)) business.address!.address1 = str(prefill.businessAddress);
    if (str(prefill.businessAddressCity)) business.address!.city = str(prefill.businessAddressCity);
    if (str(prefill.businessAddressState)) business.address!.state = str(prefill.businessAddressState);
    if (str(prefill.businessAddressZip)) business.address!.zipCode = str(prefill.businessAddressZip);

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
    const frequency = str(prefill.frequency);
    const fees = parseMoney(prefill.appendixUnderwritingFees);

    if (
        offer == null &&
        totalRemit == null &&
        repayPerPeriod == null &&
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
    if (frequency) payload.frequency = frequency;
    if (fees != null) payload.fees = fees;

    if ("position" in existing && existing.position != null) payload.position = existing.position;
    if ("rate" in existing && existing.rate != null) payload.rate = existing.rate;
    if ("term" in existing && existing.term != null) payload.term = existing.term;
    if ("monthlyPayment" in existing && existing.monthlyPayment != null) {
        payload.monthlyPayment = existing.monthlyPayment;
    }
    if ("ourRemit" in existing && existing.ourRemit != null) payload.ourRemit = existing.ourRemit;

    return payload;
}

function resolveBankDetailId(
    bankDetail: Record<string, unknown> | null | undefined,
    contract?: Record<string, unknown> | null,
): string | null {
    const fromRow = bankDetail?._id ?? bankDetail?.id;
    if (fromRow != null && str(fromRow)) return String(fromRow);
    const paymentBank = contract?.paymentBank as Record<string, unknown> | null | undefined;
    const fromPayment = paymentBank?._id ?? paymentBank?.id;
    if (fromPayment != null && str(fromPayment)) return String(fromPayment);
    const fromContract = contract?.paymentBankId;
    if (fromContract != null && str(fromContract)) return String(fromContract);
    return null;
}

/**
 * Map contract prefill bank fields back onto the linked CRM BankDetail row.
 * Mirrors `bankDetailRowToPrefillPartial` in Contract.ts (BankDetail → prefill).
 */
export function buildBankDetailUpdateFromPrefill(
    prefill: Partial<BuildContractPrefillFieldsArgs>,
): UpdateBankDetailPayload | null {
    const canonical = resolveCanonicalBankFromPrefill(
        applyCanonicalBankFieldsToPrefill(prefill),
    );
    const { bankName, accountNumber, routingNumber } = canonical;

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
    bankDetail?: Record<string, unknown> | null;
    contract?: Record<string, unknown> | null;
};

async function syncContractGuarantorsFromPrefill(
    dispatch: AppDispatch,
    contractGuarantors: Record<string, unknown>[] | null | undefined,
    prefill: Partial<BuildContractPrefillFieldsArgs>,
): Promise<void> {
    const rows = Array.isArray(contractGuarantors) ? contractGuarantors : [];
    const patches: Array<{
        row: Record<string, unknown> | undefined;
        name: string;
        ssn: string;
        driverLicense: string;
    }> = [
        {
            row: rows[0],
            name: resolveOwner1NameFromPrefill(prefill),
            ssn: resolveOwner1SsFromPrefill(prefill),
            driverLicense:
                str(prefill.guarantySsDriverLicense) ||
                str(prefill.guarantyOwner1DriverLicense) ||
                str(prefill.guarantyGuarantor1DriverLicense),
        },
        {
            row: rows[1],
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
        if (!patch.name && !patch.ssn && !patch.driverLicense) continue;

        const data: Record<string, unknown> = {};
        if (patch.ssn) data.ssn = patch.ssn;
        if (patch.driverLicense) data.driverLicense = patch.driverLicense;
        if (patch.name) {
            const { firstName, lastName } = splitPersonName(patch.name);
            if (firstName) data.firstName = firstName;
            if (lastName) data.lastName = lastName;
        }
        await dispatch(
            updateContractGuarantor({
                id: id as number | string,
                data,
            }),
        ).unwrap();
    }
}

/**
 * Persist offer-decision and client/application fields edited via contract prefill
 * so Deal Review and other screens read the same values after reload.
 */
export async function syncContractPrefillToSourceRecords({
    dispatch,
    applicationData,
    applicationUuid = null,
    prefill,
    offerDecision = null,
    contractGuarantors = null,
    bankDetail = null,
    contract = null,
}: SyncContractPrefillSourceRecordsArgs): Promise<void> {
    const normalizedPrefill = applyCanonicalBankFieldsToPrefill(prefill);
    const offerAppId =
        resolveApplicationIdForOfferDecision(applicationData) ??
        (str(applicationUuid) || null);
    const appUuid =
        str(applicationUuid) || resolveApplicationUuidForUpdate(applicationData) || null;
    const clientId = resolveClientIdFromApplication(applicationData);
    const bankDetailId = resolveBankDetailId(bankDetail, contract);

    const tasks: Promise<unknown>[] = [];

    const offerPayload = buildOfferDecisionUpsertFromPrefill(normalizedPrefill, offerDecision);
    if (offerPayload && offerAppId) {
        tasks.push(
            axiosPost("/offer-decisions", {
                applicationId: offerAppId,
                ...offerPayload,
            }).then(() => {
                emitOfferDecisionUpdated(offerAppId);
                return dispatch(getOfferDecisionByApplication(offerAppId)).unwrap();
            }),
        );
    }

    const clientPayload = buildClientUpdateFromPrefill(normalizedPrefill, applicationData);
    if (clientPayload && clientId) {
        tasks.push(
            dispatch(
                updateClient({
                    id: clientId,
                    data: clientPayload,
                }),
            ).unwrap(),
        );
    }

    if (contractGuarantors?.length) {
        tasks.push(syncContractGuarantorsFromPrefill(dispatch, contractGuarantors, normalizedPrefill));
    }

    const bankPayload = buildBankDetailUpdateFromPrefill(normalizedPrefill);
    if (bankPayload && appUuid) {
        if (bankDetailId) {
            tasks.push(
                dispatch(
                    updateBankDetail({
                        id: bankDetailId,
                        data: bankPayload,
                    }),
                )
                    .unwrap()
                    .then(() => dispatch(getBankDetails({ application: appUuid })).unwrap()),
            );
        } else if (bankPayload.accountNumber) {
            tasks.push(
                dispatch(
                    createBankDetail({
                        application: appUuid,
                        bankName: bankPayload.bankName || "Bank",
                        accountNumber: bankPayload.accountNumber,
                        routingNumber: bankPayload.routingNumber,
                    }),
                )
                    .unwrap()
                    .then(() => dispatch(getBankDetails({ application: appUuid })).unwrap()),
            );
        }
    }

    if (tasks.length === 0) {
        if (appUuid) {
            await dispatch(getApplicationById(appUuid)).unwrap();
        }
        return;
    }

    const results = await Promise.allSettled(tasks);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
        console.warn("[ContractPrefillEditForm] source record sync partial failure:", failures);
        throw new Error(
            "Contract prefill saved, but some application or offer fields could not be synced. Refresh and try again.",
        );
    }

    if (clientId) {
        dispatch(resetUpdateClient());
    }
    if (appUuid) {
        await dispatch(getApplicationById(appUuid)).unwrap();
    }
}
