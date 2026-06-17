import type { ContractPrefillField } from "./Contract";

/** DocuSign Data Labels on `KATAN LLC - ACH Authorization` (text tabs only). */
export interface KatanAchAuthorizationAddendumPrefillFields {
    authorizationClientName?: string;
    authorizationClientBankName?: string;
    authorizationClientBankRouting?: string;
    authorizationClientBankAccount?: string;
    authorizationClientNamePrint?: string;
    authorizationClientTaxId?: string;
    authorizedBusinessPhone?: string;
    achAuthorizationAccountHolderName?: string;
    achAuthorizationAccountHolderDba?: string;
    achAuthorizationAccountHolderPhone?: string;
    achAuthorizationAccountHolderAddress?: string;
    achAuthorizationAccountHolderCity?: string;
    achAuthorizationAccountHolderState?: string;
    achAuthorizationAccountHolderZip?: string;
    achAuthorizationAccountHolderBankName?: string;
    achAuthorizationAccountHolderBankBranchCity?: string;
    achAuthorizationAccountHolderBankState?: string;
    achAuthorizationAccountHolderBankZip?: string;
    achAuthorizationAccountHolderBankRoutingNumber?: string;
    achAuthorizationAccountHolderBankAccountNumber?: string;
    achAuthorizationAccountHolderBankTransactionFee?: string;
    /** Term of offer — number of payments / transactions. */
    achAuthorizationAccountHolderBankNumberOfTransactions?: string;
    achAuthorizationConcentAccountHolderName?: string;
}

/** Field order matches the ACH form PDF (page 1 direct deposit, then page 2 ACH authorization). */
const FIELD_DEFS: Array<{ id: keyof KatanAchAuthorizationAddendumPrefillFields; label: string }> = [
    { id: "authorizationClientName", label: "Seller's Name" },
    { id: "authorizationClientBankName", label: "Name of Bank" },
    { id: "authorizationClientBankRouting", label: "ABA Transit/Routing #" },
    { id: "authorizationClientBankAccount", label: "Checking Account" },
    { id: "authorizationClientNamePrint", label: "Print Name" },
    { id: "authorizationClientTaxId", label: "Seller's Tax ID" },
    { id: "authorizedBusinessPhone", label: "Authorized Business Phone Number" },
    { id: "achAuthorizationAccountHolderName", label: "Account Holder Name" },
    {
        id: "achAuthorizationAccountHolderDba",
        label: "Account Holder DBA Name (If Business Account)",
    },
    { id: "achAuthorizationAccountHolderPhone", label: "Account Holder Phone" },
    { id: "achAuthorizationAccountHolderAddress", label: "Account Holder Address" },
    { id: "achAuthorizationAccountHolderCity", label: "City" },
    { id: "achAuthorizationAccountHolderState", label: "ST" },
    { id: "achAuthorizationAccountHolderZip", label: "Zip" },
    { id: "achAuthorizationAccountHolderBankName", label: "Account Holders Bank Name" },
    { id: "achAuthorizationAccountHolderBankBranchCity", label: "Branch City" },
    { id: "achAuthorizationAccountHolderBankState", label: "ST (bank)" },
    { id: "achAuthorizationAccountHolderBankZip", label: "Zip (bank)" },
    { id: "achAuthorizationAccountHolderBankRoutingNumber", label: "Bank Routing Number (9 digits)" },
    { id: "achAuthorizationAccountHolderBankAccountNumber", label: "Bank Account Number" },
    { id: "achAuthorizationAccountHolderBankNumberOfTransactions", label: "NO. of transaction" },
    { id: "achAuthorizationAccountHolderBankTransactionFee", label: "Transaction fee" },
    { id: "achAuthorizationConcentAccountHolderName", label: "Name/Title of Account Holder" },
];

export const KATAN_ACH_AUTHORIZATION_PREFILL_FIELD_IDS = FIELD_DEFS.map((f) => f.id);

export function buildKatanAchAuthorizationAddendumPrefillFields(
    values: KatanAchAuthorizationAddendumPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [];
    for (const { id, label } of FIELD_DEFS) {
        const v = String(values[id] ?? "").trim();
        out.push({ id, label, value: v });
    }
    return out;
}
