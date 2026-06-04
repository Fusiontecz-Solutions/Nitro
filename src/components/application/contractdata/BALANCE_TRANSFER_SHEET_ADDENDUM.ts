import type { ContractPrefillField } from "./Contract";

/** DocuSign Data Labels on `KATAN LLC - BALANCE TRANSFER SHEET` (one id per tab). */
export interface BalanceTransferSheetContractPrefillFields {
    businessAddress?: string;
    businessAddressCity?: string;
    businessAddressState?: string;
    businessAddressZip?: string;
    businessLegalName?: string;
    clientLegalName?: string;
    clientNameBy?: string;
    dba?: string;
    merchantLegalName?: string;
    purchasePrice?: string;
}

const FIELD_DEFS: Array<{ id: keyof BalanceTransferSheetContractPrefillFields; label: string }> = [
    { id: "merchantLegalName", label: "Merchant legal name" },
    { id: "businessLegalName", label: "Business legal name" },
    { id: "dba", label: "DBA" },
    { id: "clientNameBy", label: "Client name (by)" },
    { id: "clientLegalName", label: "Client legal name" },
    { id: "businessAddress", label: "Business street" },
    { id: "businessAddressCity", label: "Business city" },
    { id: "businessAddressState", label: "Business state" },
    { id: "businessAddressZip", label: "Business ZIP" },
    { id: "purchasePrice", label: "Purchase / payback amount" },
];

/** Map CRM field key → DocuSign tab label (same string for this template). */
export const BALANCE_TRANSFER_SHEET_TAB_LABEL_BY_KEY: Record<
    keyof BalanceTransferSheetContractPrefillFields,
    string
> = Object.fromEntries(FIELD_DEFS.map((f) => [f.id, f.id])) as Record<
    keyof BalanceTransferSheetContractPrefillFields,
    string
>;

export function buildBalanceTransferSheetContractPrefillFields(
    values: BalanceTransferSheetContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label } of FIELD_DEFS) {
        const v = String(values[id] ?? "").trim();
        out.push({ id: BALANCE_TRANSFER_SHEET_TAB_LABEL_BY_KEY[id], label, value: v });
    }
    return out;
}
