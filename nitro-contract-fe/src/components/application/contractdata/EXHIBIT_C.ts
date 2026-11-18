import type { ContractPrefillField } from "./Contract";

/** SignNow Exhibit C (ACH Authorization) unique names — `{id}_p1`. */

export interface ExhibitCContractPrefillFields {
    agreementDate?: string;
    clientLegalName?: string;
    clientName?: string;
    accountHolderName?: string;
    accountHolderDba?: string;
    accountHolderAddress?: string;
    bankName?: string;
    bankAccount?: string;
    bankRouting?: string;
    bankPortal?: string;
    bankUsername?: string;
    bankPassword?: string;
    securityQa1?: string;
    securityQa2?: string;
}

const FIELD_DEFS: Array<{
    id: keyof ExhibitCContractPrefillFields;
    label: string;
    tab: string;
    group: string;
}> = [
    { id: "agreementDate", label: "Agreement Date", tab: "agreement_date_p1", group: "Account" },
    { id: "clientLegalName", label: "Merchant Legal Name", tab: "client_legal_name_p1", group: "Account" },
    { id: "clientName", label: "Guarantor Name", tab: "client_name_p1", group: "Account" },
    { id: "accountHolderName", label: "Account Holder Name", tab: "ach_account_holder_name_p1", group: "Account" },
    { id: "accountHolderDba", label: "Account Holder DBA", tab: "ach_account_holder_dba_p1", group: "Account" },
    {
        id: "accountHolderAddress",
        label: "Account Holder Address",
        tab: "ach_account_holder_address_p1",
        group: "Account",
    },
    { id: "bankName", label: "Bank Name", tab: "ach_bank_name_p1", group: "Bank" },
    { id: "bankAccount", label: "Bank Account Number", tab: "ach_bank_account_p1", group: "Bank" },
    { id: "bankRouting", label: "Routing Number", tab: "ach_bank_routing_p1", group: "Bank" },
    { id: "bankPortal", label: "Bank Portal Website", tab: "ach_bank_portal_p1", group: "Online banking" },
    { id: "bankUsername", label: "Account Username", tab: "ach_username_p1", group: "Online banking" },
    { id: "bankPassword", label: "Bank Account Password", tab: "ach_password_p1", group: "Online banking" },
    { id: "securityQa1", label: "Security Question / Answer 1", tab: "ach_security_q1_p1", group: "Online banking" },
    { id: "securityQa2", label: "Security Question / Answer 2", tab: "ach_security_q2_p1", group: "Online banking" },
];

export function buildExhibitCContractPrefillFields(
    values: ExhibitCContractPrefillFields = {},
): ContractPrefillField[] {
    return FIELD_DEFS.map(({ id, label, tab, group }) => ({
        id: tab,
        label,
        value: String(values[id] ?? "").trim(),
        group,
    }));
}
