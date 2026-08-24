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
    { id: "purchase_price", label: "Remaining balance" },
    {
        id: "funder_name_with_deal_prefix",
        label: "Funder name (Deal ID prefix)",
    },
    { id: "deal_id_prefix", label: "Deal ID prefix" },
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
    funderNameWithDealPrefix?: string;
    dealIdPrefix?: string;
}

export function formatFunderNameWithDealIdPrefix(
    funderName?: string | null,
    dealIdPrefix?: string | null,
    displayName?: string | null,
): string {
    const name = String(displayName || funderName || "").trim();
    const prefix = String(dealIdPrefix || "").trim();
    if (!name && !prefix) return "";
    if (!name) return `("${prefix}")`;
    if (!prefix) return name;
    return `${name} ("${prefix}")`;
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
    funderNameWithDealPrefix = "",
    dealIdPrefix = "",
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
        funder_name_with_deal_prefix: funderNameWithDealPrefix,
        deal_id_prefix: dealIdPrefix,
    };
    return BALANCE_TRANSFER_SHEET_FIELD_DEFS.map(({ id, label }) => ({
        id,
        label,
        value: String(values[id] ?? "").trim().toUpperCase(),
    }));
}
