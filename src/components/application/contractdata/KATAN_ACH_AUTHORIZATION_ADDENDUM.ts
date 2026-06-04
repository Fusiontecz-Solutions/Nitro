import type { ContractPrefillField } from "./Contract";

/** DocuSign Data Labels on `KATAN LLC - ACH Authorization` (text tabs only). */
export interface KatanAchAuthorizationAddendumPrefillFields {
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
    achAuthorizationConcentAccountHolderName?: string;
    authorizationClientBankName?: string;
    authorizationClientBankRouting?: string;
    authorizationClientBankAccount?: string;
    authorizationClientName?: string;
    authorizationClientNamePrint?: string;
    authorizationClientTaxId?: string;
    authorizedBusinessPhone?: string;
}

const FIELD_DEFS: Array<{ id: keyof KatanAchAuthorizationAddendumPrefillFields; label: string }> = [
    { id: "achAuthorizationAccountHolderName", label: "Account holder business name" },
    { id: "achAuthorizationAccountHolderDba", label: "Account holder DBA" },
    { id: "achAuthorizationAccountHolderPhone", label: "Account holder phone" },
    { id: "achAuthorizationAccountHolderAddress", label: "Account holder street" },
    { id: "achAuthorizationAccountHolderCity", label: "Account holder city" },
    { id: "achAuthorizationAccountHolderState", label: "Account holder state" },
    { id: "achAuthorizationAccountHolderZip", label: "Account holder ZIP" },
    { id: "achAuthorizationAccountHolderBankName", label: "Bank name" },
    { id: "achAuthorizationAccountHolderBankBranchCity", label: "Bank branch city" },
    { id: "achAuthorizationAccountHolderBankState", label: "Bank state" },
    { id: "achAuthorizationAccountHolderBankZip", label: "Bank ZIP" },
    { id: "achAuthorizationAccountHolderBankRoutingNumber", label: "Routing number" },
    { id: "achAuthorizationAccountHolderBankAccountNumber", label: "Account number" },
    { id: "achAuthorizationAccountHolderBankTransactionFee", label: "Transaction fee" },
    { id: "achAuthorizationConcentAccountHolderName", label: "Consent account holder name" },
    { id: "authorizationClientBankName", label: "Authorization bank name" },
    { id: "authorizationClientBankRouting", label: "Authorization routing" },
    { id: "authorizationClientBankAccount", label: "Authorization account" },
    { id: "authorizationClientName", label: "Authorization business name" },
    { id: "authorizationClientNamePrint", label: "Authorization business name (print)" },
    { id: "authorizationClientTaxId", label: "Authorization tax ID" },
    { id: "authorizedBusinessPhone", label: "Authorized business phone" },
];

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
