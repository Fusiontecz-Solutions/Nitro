import type { ContractPrefillField } from "./Contract";

const FIELD_IDS = {
    clientName: ["client_name"],
    businessName: ["business_name"],
    clientDba: ["client_dba"],
    physicalAddress: ["physical_address"],
    date: ["date"],
    clientNameBy: ["client_name_by"],
    clientLegalName: ["client_legal_name"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

/** BoldSign prefill source values for the Balance Transfer Sheet template. */
export interface BalanceTransferSheetContractPrefillFields {
    clientName?: string;
    businessName?: string;
    clientDba?: string;
    physicalAddress?: string;
    date?: string;
    clientNameBy?: string;
    clientLegalName?: string;
}

export function buildBalanceTransferSheetContractPrefillFields({
    clientName = "",
    businessName = "",
    clientDba = "",
    physicalAddress = "",
    date: sheetDate = "",
    clientNameBy = "",
    clientLegalName = "",
}: BalanceTransferSheetContractPrefillFields = {}): ContractPrefillField[] {
    return [
        ...mapIds(FIELD_IDS.clientName, "Client Name", clientName),
        ...mapIds(FIELD_IDS.businessName, "Business Name", businessName),
        ...mapIds(FIELD_IDS.clientDba, "Client DBA", clientDba),
        ...mapIds(FIELD_IDS.physicalAddress, "Physical Address", physicalAddress),
        ...mapIds(FIELD_IDS.date, "Date", sheetDate),
        ...mapIds(FIELD_IDS.clientNameBy, "Client Name By", clientNameBy),
        ...mapIds(FIELD_IDS.clientLegalName, "Client Legal Name", clientLegalName),
    ];
}
