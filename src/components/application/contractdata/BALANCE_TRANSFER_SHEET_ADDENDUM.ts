import type { ContractPrefillField } from "./Contract";

/** Include DocuSign/BoldSign tab labels used on Woodmere Balance Transfer templates. */
const FIELD_IDS = {
    clientName: ["client_name", "merchant_legal_name", "merchantlegalname"],
    businessName: ["business_name", "business_legal_name", "businesslegalname"],
    clientDba: ["client_dba", "dba", "doing_business_as"],
    physicalAddress: ["physical_address", "physicaladdress"],
    date: ["date", "signature_date", "agreement_date"],
    clientNameBy: ["client_name_by", "merchant_name", "merchantname", "customer_name"],
    clientLegalName: ["client_legal_name", "legal_name", "legalname"],
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
