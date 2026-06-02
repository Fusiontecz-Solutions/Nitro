import type { ContractPrefillField } from "./Contract";

export const WOODMERE_FLEX_FIELD_DEFS = [
    { id: "client_legal_name", label: "Client legal name" },
    { id: "client_name", label: "Client name" },
] as const;

/** DocuSign prefill source values for the Woodmere Flex Addendum template. */
export interface WoodmereFlexAddendumContractPrefillFields {
    clientLegalName?: string;
    clientName?: string;
}

export function buildWoodmereFlexAddendumContractPrefillFields({
    clientLegalName = "",
    clientName = "",
}: WoodmereFlexAddendumContractPrefillFields = {}): ContractPrefillField[] {
    return [
        { id: "client_legal_name", label: "Client legal name", value: String(clientLegalName).trim() },
        { id: "client_name", label: "Client name", value: String(clientName).trim() },
    ];
}
