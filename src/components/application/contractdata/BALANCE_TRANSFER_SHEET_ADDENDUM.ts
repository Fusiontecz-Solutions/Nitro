import type { ContractPrefillField } from "./Contract";
import { BALANCE_TRANSFER_SCOPE } from "./documentPrefillScope";

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
    /** Letter header — date of the new KC secured agreement (MM-DD-YYYY on PDF). */
    dateOfNewSecuredAgreement?: string;
    /** Letter header — date of the prior secured agreement being paid off. */
    dateOfPreviousSecuredAgreement?: string;
    /** Letter header — remaining RTR / payoff balance on the prior agreement. */
    remainingRtrBalance?: string;
}

const FIELD_DEFS: Array<{ id: keyof BalanceTransferSheetContractPrefillFields; label: string }> = [
    { id: "dateOfNewSecuredAgreement", label: "Date of new secured agreement" },
    { id: "dateOfPreviousSecuredAgreement", label: "Date of previous secured agreement" },
    { id: "remainingRtrBalance", label: "Remaining RTR balance" },
    { id: "merchantLegalName", label: "Merchant legal name" },
    { id: "businessLegalName", label: "Business legal name" },
    { id: "dba", label: "DBA" },
    { id: "clientNameBy", label: "Client name (by)" },
    { id: "clientLegalName", label: "Client legal name (merchant)" },
    { id: "businessAddress", label: "Business street" },
    { id: "businessAddressCity", label: "Business city" },
    { id: "businessAddressState", label: "Business state" },
    { id: "businessAddressZip", label: "Business ZIP" },
];

/** Map CRM field key → DocuSign tab label (snake_case data labels on the PDF). */
export const BALANCE_TRANSFER_SHEET_TAB_LABEL_BY_KEY: Record<
    keyof BalanceTransferSheetContractPrefillFields,
    string
> = {
    dateOfNewSecuredAgreement: `${BALANCE_TRANSFER_SCOPE}date_of_new_secured_agreement`,
    dateOfPreviousSecuredAgreement: `${BALANCE_TRANSFER_SCOPE}date_of_previous_secured_agreement`,
    remainingRtrBalance: `${BALANCE_TRANSFER_SCOPE}remaining_rtr_balance`,
    merchantLegalName: `${BALANCE_TRANSFER_SCOPE}merchant_legal_name`,
    businessLegalName: `${BALANCE_TRANSFER_SCOPE}business_legal_name`,
    dba: `${BALANCE_TRANSFER_SCOPE}dba`,
    clientNameBy: `${BALANCE_TRANSFER_SCOPE}client_name_by`,
    clientLegalName: `${BALANCE_TRANSFER_SCOPE}client_legal_name`,
    businessAddress: `${BALANCE_TRANSFER_SCOPE}business_address`,
    businessAddressCity: `${BALANCE_TRANSFER_SCOPE}business_address_city`,
    businessAddressState: `${BALANCE_TRANSFER_SCOPE}business_address_state`,
    businessAddressZip: `${BALANCE_TRANSFER_SCOPE}business_address_zip`,
};

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
