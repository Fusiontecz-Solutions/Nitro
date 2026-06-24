import { PLATFORM_LAYOUT_KEYS } from "./platformDocumentConfig";

export const KATAN_FUNDER_OPTIONS = ["Katan II", "Katan III"] as const;

export const ALLIANCE_BRIDGE_FUNDER_LABEL = "ALLIANCE BRIDGE CAPITAL";

export function isTexasContractState(state?: string | null): boolean {
    const normalized = String(state ?? "")
        .trim()
        .toLowerCase();
    return normalized === "texas" || normalized === "tx";
}

export function isAllianceBridgeFunder(funderName?: string | null): boolean {
    const normalized = String(funderName ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    if (!normalized) return false;
    return (
        normalized === "alliance bridge capital" ||
        normalized === "alliance bridge" ||
        normalized.includes("alliance bridge")
    );
}

/** Funder dropdown values for Create Contract (Texas adds Alliance Bridge). */
export function funderOptionsForState(state?: string | null): string[] {
    const base = [...KATAN_FUNDER_OPTIONS];
    if (isTexasContractState(state)) {
        return [...base, ALLIANCE_BRIDGE_FUNDER_LABEL];
    }
    return base;
}

export function resolveMainContractLayoutKey(funderName?: string | null): string {
    if (isAllianceBridgeFunder(funderName)) {
        return "alliance_bridge_contract";
    }
    return PLATFORM_LAYOUT_KEYS.contract;
}

export function contractPreviewNameForLayoutKey(layoutKey: string): string {
    if (layoutKey === "alliance_bridge_contract") {
        return "ALLIANCE BRIDGE CAPITAL.pdf";
    }
    return "Contract.pdf";
}
