import type { BuildContractPrefillFieldsArgs } from "./Contract";
import { mergeContractPrefillOverrideLayers } from "./Contract";

export type KycDocumentType = "driverLicense" | "voidedCheck";

export interface KycPanelOwnerPatch {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
}

export interface KycPanelGuarantorPatch {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    driverLicenseNumber: string;
}

export interface KycPanelAchPatch {
    bankName: string;
    fullNameOnAccount: string;
    accountNumber: string;
    routingNumber: string;
    dba: string;
    address: string;
    city: string;
    state: string;
    zip: string;
}

export interface KycExtractionResult {
    documentType?: KycDocumentType;
    keyData?: Record<string, string>;
    contractPrefill?: Record<string, string>;
    panels?: {
        owner?: KycPanelOwnerPatch;
        guarantor?: KycPanelGuarantorPatch;
        ach?: KycPanelAchPatch;
    };
    mergedContractPrefillOverrides?: Record<string, unknown>;
    error?: string;
}

function str(v: unknown): string {
    return v == null ? "" : String(v).trim();
}

function patchIfEmpty<T extends Record<string, unknown>>(
    base: T,
    patch: Record<string, unknown>,
): T {
    const out = { ...base };
    for (const [key, val] of Object.entries(patch)) {
        if (str(val) && !str(out[key as keyof T])) {
            (out as Record<string, unknown>)[key] = val;
        }
    }
    return out;
}

/** Bank prefill keys populated from voided-check scans — always overwrite stale values. */
const VOIDED_CHECK_BANK_PREFILL_KEYS = [
    "authorizationClientBankName",
    "authorizationClientBankAccount",
    "authorizationClientBankRouting",
    "achAuthorizationAccountHolderBankName",
    "achAuthorizationAccountHolderBankAccountNumber",
    "achAuthorizationAccountHolderBankRoutingNumber",
    "achAuthorizationAccountHolderName",
    "achAuthorizationConcentAccountHolderName",
    "achAuthorizationAccountHolderDba",
    "achAuthorizationAccountHolderAddress",
    "achAuthorizationAccountHolderCity",
    "achAuthorizationAccountHolderState",
    "achAuthorizationAccountHolderZip",
    "achAuthorizationAccountHolderBankBranchCity",
    "achAuthorizationAccountHolderBankState",
    "achAuthorizationAccountHolderBankZip",
    "legalName",
    "authorizationClientName",
    "authorizationClientNamePrint",
    "authorizationApplication",
    "doingBusinessAs",
    "businessAddress",
    "businessAddressCity",
    "businessAddressState",
    "businessAddressZip",
    "securityBusinessName",
    "securityDoingBusinessAs",
    "securityBusinessAddress",
    "securityBusinessAddressCity",
    "securityBusinessAddressState",
    "securityBusinessAddressZip",
] as const satisfies readonly (keyof BuildContractPrefillFieldsArgs)[];

export function mergeKycExtractionIntoPrefill(
    current: Partial<BuildContractPrefillFieldsArgs> | null | undefined,
    extraction: KycExtractionResult | null | undefined,
): Partial<BuildContractPrefillFieldsArgs> | null {
    if (!extraction?.contractPrefill || extraction.error) {
        return current ?? null;
    }
    const patch = extraction.contractPrefill as Partial<BuildContractPrefillFieldsArgs>;
    if (extraction.documentType === "voidedCheck") {
        const base = { ...(current ?? {}) } as Partial<BuildContractPrefillFieldsArgs>;
        for (const key of VOIDED_CHECK_BANK_PREFILL_KEYS) {
            const val = str(patch[key]);
            if (val) {
                (base as Record<string, unknown>)[key] = val;
            }
        }
        for (const [key, val] of Object.entries(patch)) {
            if (str(val)) {
                (base as Record<string, unknown>)[key] = val;
            }
        }
        return Object.keys(base).length ? base : null;
    }
    const merged = mergeContractPrefillOverrideLayers(current, patch);
    return Object.keys(merged).length ? merged : null;
}

export function applyKycPanelsToOwnerEntries<
    T extends {
        ownerFirstName: string;
        ownerLastName: string;
        ownerAddress: string;
        city: string;
        state: string;
        zipCode: string;
    },
>(entries: T[], patch?: KycPanelOwnerPatch): T[] {
    if (!patch || !entries.length) return entries;
    const [first, ...rest] = entries;
    return [
        patchIfEmpty(first, {
            ownerFirstName: patch.firstName,
            ownerLastName: patch.lastName,
            ownerAddress: patch.address,
            city: patch.city,
            state: patch.state,
            zipCode: patch.zipCode,
        }),
        ...rest,
    ];
}

export function applyKycPanelsToGuarantorEntries<
    T extends {
        guarantorFirstName: string;
        guarantorLastName: string;
        guarantorAddress: string;
        city: string;
        state: string;
        zipCode: string;
        driverLicenseNumber: string;
    },
>(entries: T[], patch?: KycPanelGuarantorPatch): T[] {
    if (!patch || !entries.length) return entries;
    const [first, ...rest] = entries;
    return [
        patchIfEmpty(first, {
            guarantorFirstName: patch.firstName,
            guarantorLastName: patch.lastName,
            guarantorAddress: patch.address,
            city: patch.city,
            state: patch.state,
            zipCode: patch.zipCode,
            driverLicenseNumber: patch.driverLicenseNumber,
        }),
        ...rest,
    ];
}

export function applyKycPanelsToAchEntries<
    T extends {
        bankName: string;
        fullNameOnAccount: string;
        accountNumber: string;
        routingNumber: string;
        dba: string;
        address: string;
        city: string;
        state: string;
        zip: string;
    },
>(entries: T[], patch?: KycPanelAchPatch): T[] {
    if (!patch || !entries.length) return entries;
    const [first, ...rest] = entries;
    const out = { ...first };
    for (const [key, val] of Object.entries(patch)) {
        if (str(val)) {
            (out as Record<string, unknown>)[key] = val;
        }
    }
    return [out, ...rest];
}

export function parseKycExtractionsFromUploadResponse(
    payload: unknown,
): KycExtractionResult[] {
    if (!payload || typeof payload !== "object") return [];
    const root = payload as Record<string, unknown>;
    const direct = root.kycExtractions;
    if (Array.isArray(direct)) {
        return direct as KycExtractionResult[];
    }
    const data = root.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
        const nested = (data as Record<string, unknown>).kycExtractions;
        if (Array.isArray(nested)) {
            return nested as KycExtractionResult[];
        }
    }
    return [];
}
