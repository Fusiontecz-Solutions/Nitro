import type { ContractPrefillField } from "./Contract";

/** SignNow EPA Nitro Advance (Early Payoff Addendum) unique names. */

export interface EpaNitroContractPrefillFields {
    agreementDate?: string;
    clientLegalName?: string;
    epoDate1?: string;
    epoAmount1?: string;
    epoDate2?: string;
    epoAmount2?: string;
    epoDate3?: string;
    epoAmount3?: string;
    epoDate4?: string;
    epoAmount4?: string;
    epoDate5?: string;
    epoAmount5?: string;
}

const FIELD_DEFS: Array<{
    id: keyof EpaNitroContractPrefillFields;
    label: string;
    tab: string;
}> = [
    { id: "agreementDate", label: "Addendum Dated", tab: "agreement_date_p1" },
    { id: "clientLegalName", label: "Merchant Legal Name", tab: "client_legal_name_p1" },
    { id: "epoDate1", label: "Discount Period 1", tab: "epo_received_date_1_p1" },
    { id: "epoAmount1", label: "Payback Amount 1", tab: "epo_amount_received_1_p1" },
    { id: "epoDate2", label: "Discount Period 2", tab: "epo_received_date_2_p1" },
    { id: "epoAmount2", label: "Payback Amount 2", tab: "epo_amount_received_2_p1" },
    { id: "epoDate3", label: "Discount Period 3", tab: "epo_received_date_3_p1" },
    { id: "epoAmount3", label: "Payback Amount 3", tab: "epo_amount_received_3_p1" },
    { id: "epoDate4", label: "Discount Period 4", tab: "epo_received_date_4_p1" },
    { id: "epoAmount4", label: "Payback Amount 4", tab: "epo_amount_received_4_p1" },
    { id: "epoDate5", label: "Discount Period 5", tab: "epo_received_date_5_p1" },
    { id: "epoAmount5", label: "Payback Amount 5", tab: "epo_amount_received_5_p1" },
];

export function buildEpaNitroContractPrefillFields(
    values: EpaNitroContractPrefillFields = {},
): ContractPrefillField[] {
    return FIELD_DEFS.map(({ id, label, tab }) => ({
        id: tab,
        label,
        value: String(values[id] ?? "").trim(),
    }));
}
