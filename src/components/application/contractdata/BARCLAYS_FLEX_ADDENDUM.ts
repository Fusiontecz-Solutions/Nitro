import type { ContractPrefillField } from "./Contract";

/** DocuSign Data Labels on `Flex_Addendum` template. */
export interface BarclaysFlexAddendumContractPrefillFields {
    clientLegalName?: string;
    clientName?: string;
    businessName2?: string;
}

const FIELD_DEFS: Array<{ id: keyof BarclaysFlexAddendumContractPrefillFields; label: string }> = [
    { id: "clientLegalName", label: "Client legal name" },
    { id: "clientName", label: "Client name" },
    { id: "businessName2", label: "Business name 2" },
];

export const FLEX_ADDENDUM_TAB_LABEL_BY_KEY: Record<keyof BarclaysFlexAddendumContractPrefillFields, string> =
    {
        clientLegalName: "client_legal_name",
        clientName: "client_name",
        businessName2: "business_name_2",
    };

export function buildBarclaysFlexAddendumContractPrefillFields(
    values: BarclaysFlexAddendumContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label } of FIELD_DEFS) {
        const v = String(values[id] ?? "").trim();
        out.push({ id: FLEX_ADDENDUM_TAB_LABEL_BY_KEY[id], label, value: v });
    }
    return out;
}
