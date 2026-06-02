import type { ContractPrefillField } from "./Contract";

/** DocuSign Data Labels on WOODMERE LLC — Balance Transfer Sheet. */
export const BALANCE_TRANSFER_SHEET_FIELD_DEFS = [
    { id: "merchant_legal_name", label: "Merchant legal name" },
    { id: "business_legal_name", label: "Business legal name" },
    { id: "client_legal_name", label: "Client legal name" },
    { id: "client_name_by", label: "Client name by" },
    { id: "dba", label: "DBA" },
    { id: "business_address", label: "Business address" },
    { id: "business_address_city", label: "Business address city" },
    { id: "business_address_state", label: "Business address state" },
    { id: "business_address_zip", label: "Business address ZIP" },
    { id: "purchase_price", label: "Purchase price" },
] as const;

/** DocuSign prefill source values for the Balance Transfer Sheet template. */
export interface BalanceTransferSheetContractPrefillFields {
    merchantLegalName?: string;
    businessLegalName?: string;
    clientLegalName?: string;
    clientNameBy?: string;
    dba?: string;
    businessAddress?: string;
    businessAddressCity?: string;
    businessAddressState?: string;
    businessAddressZip?: string;
    purchasePrice?: string;
}

export function buildBalanceTransferSheetContractPrefillFields({
    merchantLegalName = "",
    businessLegalName = "",
    clientLegalName = "",
    clientNameBy = "",
    dba = "",
    businessAddress = "",
    businessAddressCity = "",
    businessAddressState = "",
    businessAddressZip = "",
    purchasePrice = "",
}: BalanceTransferSheetContractPrefillFields = {}): ContractPrefillField[] {
    const values: Record<string, string> = {
        merchant_legal_name: merchantLegalName,
        business_legal_name: businessLegalName,
        client_legal_name: clientLegalName,
        client_name_by: clientNameBy,
        dba,
        business_address: businessAddress,
        business_address_city: businessAddressCity,
        business_address_state: businessAddressState,
        business_address_zip: businessAddressZip,
        purchase_price: purchasePrice,
    };
    return BALANCE_TRANSFER_SHEET_FIELD_DEFS.map(({ id, label }) => ({
        id,
        label,
        value: String(values[id] ?? "").trim(),
    }));
}
