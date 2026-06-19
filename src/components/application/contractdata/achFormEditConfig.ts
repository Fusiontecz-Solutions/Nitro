import type { BuildContractPrefillFieldsArgs } from "./Contract";

/**
 * Text tabs on `hard_rock_ach_authorization` (see in-house-crm-be manifest JSON).
 * Sign / initial / dateSigned tabs are filled in DocuSign — not editable here.
 */
export const ACH_COORDINATE_MANIFEST_TEXT_TAB_LABELS = [
    "authorization_client_name",
    "authorization_client_bank_name",
    "authorization_client_bank_routing",
    "authorization_client_bank_account",
    "authorization_client_name_print",
    "authorization_client_tax_id",
    "authorized_business_phone",
    "ach_authorization_account_holder_name",
    "ach_authorization_account_holder_dba",
    "ach_authorization_account_holder_phone",
    "ach_authorization_account_holder_address",
    "ach_authorization_account_holder_city",
    "ach_authorization_account_holder_state",
    "ach_authorization_account_holder_zip",
    "ach_authorization_account_holder_bank_name",
    "ach_authorization_account_holder_bank_branch_city",
    "ach_authorization_account_holder_bank_state",
    "ach_authorization_account_holder_bank_zip",
    "ach_authorization_account_holder_bank_routing_number",
    "ach_authorization_account_holder_bank_account_number",
    "ach_authorization_account_holder_bank_transaction_fee",
    "ach_authorization_account_holder_bank_number_of_transactions",
    "ach_authorization_concent_account_holder_name",
] as const;

type AchFormEditFieldKey = keyof Pick<
    BuildContractPrefillFieldsArgs,
    | "authorizationClientName"
    | "authorizationClientBankName"
    | "authorizationClientBankRouting"
    | "authorizationClientBankAccount"
    | "authorizationClientNamePrint"
    | "authorizationClientTaxId"
    | "authorizedBusinessPhone"
    | "achAuthorizationAccountHolderName"
    | "achAuthorizationAccountHolderDba"
    | "achAuthorizationAccountHolderPhone"
    | "achAuthorizationAccountHolderAddress"
    | "achAuthorizationAccountHolderCity"
    | "achAuthorizationAccountHolderState"
    | "achAuthorizationAccountHolderZip"
    | "achAuthorizationAccountHolderBankName"
    | "achAuthorizationAccountHolderBankBranchCity"
    | "achAuthorizationAccountHolderBankState"
    | "achAuthorizationAccountHolderBankZip"
    | "achAuthorizationAccountHolderBankRoutingNumber"
    | "achAuthorizationAccountHolderBankAccountNumber"
    | "achAuthorizationAccountHolderBankTransactionFee"
    | "achAuthorizationAccountHolderBankNumberOfTransactions"
    | "achAuthorizationConcentAccountHolderName"
>;

export type AchFormEditField = {
    key: AchFormEditFieldKey;
    label: string;
    tabLabel: (typeof ACH_COORDINATE_MANIFEST_TEXT_TAB_LABELS)[number];
};

/** Single-scroll ACH editor — one row per coordinate manifest text tab. */
export const ACH_FORM_FLAT_FIELDS: AchFormEditField[] = [
    { key: "authorizationClientName", label: "Client name", tabLabel: "authorization_client_name" },
    {
        key: "authorizationClientBankName",
        label: "Client bank name",
        tabLabel: "authorization_client_bank_name",
    },
    {
        key: "authorizationClientBankRouting",
        label: "Client bank routing",
        tabLabel: "authorization_client_bank_routing",
    },
    {
        key: "authorizationClientBankAccount",
        label: "Client bank account",
        tabLabel: "authorization_client_bank_account",
    },
    {
        key: "authorizationClientNamePrint",
        label: "Client name (print)",
        tabLabel: "authorization_client_name_print",
    },
    {
        key: "authorizationClientTaxId",
        label: "Client tax ID / EIN",
        tabLabel: "authorization_client_tax_id",
    },
    {
        key: "authorizedBusinessPhone",
        label: "Business phone",
        tabLabel: "authorized_business_phone",
    },
    {
        key: "achAuthorizationAccountHolderName",
        label: "Account holder name",
        tabLabel: "ach_authorization_account_holder_name",
    },
    {
        key: "achAuthorizationAccountHolderDba",
        label: "DBA",
        tabLabel: "ach_authorization_account_holder_dba",
    },
    {
        key: "achAuthorizationAccountHolderPhone",
        label: "Phone",
        tabLabel: "ach_authorization_account_holder_phone",
    },
    {
        key: "achAuthorizationAccountHolderAddress",
        label: "Street address",
        tabLabel: "ach_authorization_account_holder_address",
    },
    {
        key: "achAuthorizationAccountHolderCity",
        label: "City",
        tabLabel: "ach_authorization_account_holder_city",
    },
    {
        key: "achAuthorizationAccountHolderState",
        label: "State",
        tabLabel: "ach_authorization_account_holder_state",
    },
    {
        key: "achAuthorizationAccountHolderZip",
        label: "ZIP",
        tabLabel: "ach_authorization_account_holder_zip",
    },
    {
        key: "achAuthorizationAccountHolderBankName",
        label: "Bank name",
        tabLabel: "ach_authorization_account_holder_bank_name",
    },
    {
        key: "achAuthorizationAccountHolderBankBranchCity",
        label: "Bank branch city",
        tabLabel: "ach_authorization_account_holder_bank_branch_city",
    },
    {
        key: "achAuthorizationAccountHolderBankState",
        label: "Bank state",
        tabLabel: "ach_authorization_account_holder_bank_state",
    },
    {
        key: "achAuthorizationAccountHolderBankZip",
        label: "Bank ZIP",
        tabLabel: "ach_authorization_account_holder_bank_zip",
    },
    {
        key: "achAuthorizationAccountHolderBankRoutingNumber",
        label: "Routing number",
        tabLabel: "ach_authorization_account_holder_bank_routing_number",
    },
    {
        key: "achAuthorizationAccountHolderBankAccountNumber",
        label: "Account number",
        tabLabel: "ach_authorization_account_holder_bank_account_number",
    },
    {
        key: "achAuthorizationAccountHolderBankNumberOfTransactions",
        label: "NO. of transaction (term of offer)",
        tabLabel: "ach_authorization_account_holder_bank_number_of_transactions",
    },
    {
        key: "achAuthorizationAccountHolderBankTransactionFee",
        label: "Transaction fee (estimated payment)",
        tabLabel: "ach_authorization_account_holder_bank_transaction_fee",
    },
    {
        key: "achAuthorizationConcentAccountHolderName",
        label: "Consent — account holder name",
        tabLabel: "ach_authorization_concent_account_holder_name",
    },
];

export const ACH_FORM_FLAT_FIELD_KEYS = new Set(
    ACH_FORM_FLAT_FIELDS.map((f) => f.key),
) as Set<keyof BuildContractPrefillFieldsArgs>;
