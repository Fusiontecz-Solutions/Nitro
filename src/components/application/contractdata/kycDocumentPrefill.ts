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

export function mergeKycExtractionIntoPrefill(
    current: Partial<BuildContractPrefillFieldsArgs> | null | undefined,
    extraction: KycExtractionResult | null | undefined,
): Partial<BuildContractPrefillFieldsArgs> | null {
    if (!extraction?.contractPrefill || extraction.error) {
        return current ?? null;
    }
    const merged = mergeContractPrefillOverrideLayers(
        current,
        extraction.contractPrefill as Partial<BuildContractPrefillFieldsArgs>,
    );
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
    return [patchIfEmpty(first, patch as unknown as Record<string, unknown>), ...rest];
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
    return [patchIfEmpty(first, patch as unknown as Record<string, unknown>), ...rest];
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
    return [patchIfEmpty(first, patch as unknown as Record<string, unknown>), ...rest];
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
