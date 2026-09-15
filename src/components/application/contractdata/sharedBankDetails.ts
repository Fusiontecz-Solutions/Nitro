import type { BuildContractPrefillFieldsArgs, ContractPrefillField } from "./Contract";

export type SharedBankDetails = {
    bankName: string;
    routingNumber: string;
    accountNumber: string;
};

export type SharedBankSlot = "name" | "routing" | "account";

/** Strip SignNow uniqueness suffixes so Monthly Fee / ACH Weekly / Exhibit C share one slot. */
function normalizeBankFieldId(id: string): string {
    return String(id ?? "")
        .trim()
        .toLowerCase()
        .replace(/-/g, "_")
        .replace(/_p\d+(?:_achd|_ach)?$/i, "");
}

/**
 * Classify a template / ACH / contract field id as bank name, routing, or account.
 * Ignores portal, password, branch, fee, and transaction-count fields.
 */
export function classifyBankFieldId(id: string): SharedBankSlot | null {
    const key = normalizeBankFieldId(id);
    if (!key) return null;
    if (
        /portal|password|username|branch|transaction|number_of_transactions/.test(key)
    ) {
        return null;
    }
    if (
        key === "authorization_client_bank_name" ||
        key === "ach_authorization_account_holder_bank_name" ||
        key === "ach_bank_name" ||
        key === "authorizationclientbankname" ||
        key === "achauthorizationaccountholderbankname"
    ) {
        return "name";
    }
    if (
        key === "authorization_client_bank_routing" ||
        key === "ach_authorization_account_holder_bank_routing_number" ||
        key === "ach_bank_routing" ||
        key === "authorizationclientbankrouting" ||
        key === "achauthorizationaccountholderbankroutingnumber"
    ) {
        return "routing";
    }
    if (
        key === "authorization_client_bank_account" ||
        key === "ach_authorization_account_holder_bank_account_number" ||
        key === "ach_bank_account" ||
        key === "authorizationclientbankaccount" ||
        key === "achauthorizationaccountholderbankaccountnumber"
    ) {
        return "account";
    }
    return null;
}

function str(v: unknown): string {
    return String(v ?? "").trim();
}

export function emptySharedBankDetails(): SharedBankDetails {
    return { bankName: "", routingNumber: "", accountNumber: "" };
}

export function hasSharedBankDetails(bank: SharedBankDetails | null | undefined): boolean {
    if (!bank) return false;
    return Boolean(bank.bankName || bank.routingNumber || bank.accountNumber);
}

/** Pull bank name / routing / account out of any template tab map. */
export function extractSharedBankDetailsFromTabValues(
    values: Record<string, string> | null | undefined,
): SharedBankDetails {
    const out = emptySharedBankDetails();
    if (!values) return out;
    for (const [id, raw] of Object.entries(values)) {
        const slot = classifyBankFieldId(id);
        const value = str(raw);
        if (!slot || !value) continue;
        if (slot === "name" && !out.bankName) out.bankName = value;
        if (slot === "routing" && !out.routingNumber) out.routingNumber = value;
        if (slot === "account" && !out.accountNumber) out.accountNumber = value;
    }
    return out;
}

/** BankDetail row, ACH row, or contract camelCase / snake_case fields. */
export function extractSharedBankDetailsFromRecord(
    row: Record<string, unknown> | null | undefined,
): SharedBankDetails {
    if (!row) return emptySharedBankDetails();
    const bankName =
        str(row.bankName) ||
        str(row.authorizationClientBankName) ||
        str(row.achAuthorizationAccountHolderBankName) ||
        str(row.authorization_client_bank_name) ||
        str(row.ach_authorization_account_holder_bank_name) ||
        str(row.ach_bank_name);
    const routingNumber =
        str(row.routingNumber) ||
        str(row.authorizationClientBankRouting) ||
        str(row.achAuthorizationAccountHolderBankRoutingNumber) ||
        str(row.authorization_client_bank_routing) ||
        str(row.ach_authorization_account_holder_bank_routing_number) ||
        str(row.ach_bank_routing);
    const accountNumber =
        str(row.accountNumber) ||
        str(row.authorizationClientBankAccount) ||
        str(row.achAuthorizationAccountHolderBankAccountNumber) ||
        str(row.authorization_client_bank_account) ||
        str(row.ach_authorization_account_holder_bank_account_number) ||
        str(row.ach_bank_account);
    return { bankName, routingNumber, accountNumber };
}

export function mergeSharedBankDetails(
    ...layers: Array<SharedBankDetails | null | undefined>
): SharedBankDetails {
    const out = emptySharedBankDetails();
    for (const layer of layers) {
        if (!layer) continue;
        if (str(layer.bankName)) out.bankName = str(layer.bankName);
        if (str(layer.routingNumber)) out.routingNumber = str(layer.routingNumber);
        if (str(layer.accountNumber)) out.accountNumber = str(layer.accountNumber);
    }
    return out;
}

export function sharedBankSlotValue(bank: SharedBankDetails, slot: SharedBankSlot): string {
    if (slot === "name") return bank.bankName;
    if (slot === "routing") return bank.routingNumber;
    return bank.accountNumber;
}

/** Copy canonical bank values onto every bank field already present in a tab map. */
export function applySharedBankDetailsToTabValues(
    values: Record<string, string>,
    bank: SharedBankDetails,
): Record<string, string> {
    if (!hasSharedBankDetails(bank)) return { ...values };
    const out = { ...values };
    for (const id of Object.keys(out)) {
        const slot = classifyBankFieldId(id);
        if (!slot) continue;
        const next = sharedBankSlotValue(bank, slot);
        if (next) out[id] = next;
    }
    return out;
}

/** Same as tab values, for every saved mapping blob so other documents pick up the bank. */
export function applySharedBankDetailsToMappingBlob(
    blob: Record<string, Record<string, string>>,
    bank: SharedBankDetails,
): Record<string, Record<string, string>> {
    if (!hasSharedBankDetails(bank)) return blob;
    const out: Record<string, Record<string, string>> = {};
    for (const [mappingId, row] of Object.entries(blob)) {
        out[mappingId] =
            row && typeof row === "object" ? applySharedBankDetailsToTabValues(row, bank) : {};
    }
    return out;
}

export function sharedBankToCamelPartial(
    bank: SharedBankDetails,
): Partial<BuildContractPrefillFieldsArgs> {
    const out: Partial<BuildContractPrefillFieldsArgs> = {};
    if (bank.bankName) {
        out.authorizationClientBankName = bank.bankName;
        out.achAuthorizationAccountHolderBankName = bank.bankName;
    }
    if (bank.routingNumber) {
        out.authorizationClientBankRouting = bank.routingNumber;
        out.achAuthorizationAccountHolderBankRoutingNumber = bank.routingNumber;
    }
    if (bank.accountNumber) {
        out.authorizationClientBankAccount = bank.accountNumber;
        out.achAuthorizationAccountHolderBankAccountNumber = bank.accountNumber;
    }
    return out;
}

export function extractSharedBankDetailsFromPrefill(
    prefill: Partial<BuildContractPrefillFieldsArgs> | null | undefined,
): SharedBankDetails {
    if (!prefill) return emptySharedBankDetails();
    return {
        bankName:
            str(prefill.authorizationClientBankName) ||
            str(prefill.achAuthorizationAccountHolderBankName),
        routingNumber:
            str(prefill.authorizationClientBankRouting) ||
            str(prefill.achAuthorizationAccountHolderBankRoutingNumber),
        accountNumber:
            str(prefill.authorizationClientBankAccount) ||
            str(prefill.achAuthorizationAccountHolderBankAccountNumber),
    };
}

/**
 * Prefer the application BankDetail (and contract / ACH copies) over per-document
 * saved overrides so one stored bank fills Monthly Fee, ACH, Exhibit C, etc.
 */
export function bankSlotFromRecords(
    records: Array<Record<string, unknown> | null | undefined>,
    index: number,
): SharedBankDetails {
    const seen = new Set<string>();
    const banks: SharedBankDetails[] = [];
    for (const row of records) {
        const bank = extractSharedBankDetailsFromRecord(row ?? null);
        if (!hasSharedBankDetails(bank)) continue;
        const key = `${bank.bankName}|${bank.routingNumber}|${bank.accountNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        banks.push(bank);
    }
    return banks[index] ?? emptySharedBankDetails();
}

export function overlayCanonicalBankOnPrefillRows(
    rows: ContractPrefillField[],
    sources: {
        bankDetail?: Record<string, unknown> | null;
        ach?: Record<string, unknown> | null;
        contract?: Record<string, unknown> | null;
        mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    },
): ContractPrefillField[] {
    const paymentBank =
        sources.contract?.paymentBank && typeof sources.contract.paymentBank === "object"
            ? (sources.contract.paymentBank as Record<string, unknown>)
            : null;
    const bank = mergeSharedBankDetails(
        extractSharedBankDetailsFromRecord(sources.ach ?? null),
        extractSharedBankDetailsFromPrefill(sources.mainPrefillOverrides ?? null),
        extractSharedBankDetailsFromRecord(sources.contract ?? null),
        extractSharedBankDetailsFromRecord(paymentBank),
        extractSharedBankDetailsFromRecord(sources.bankDetail ?? null),
    );
    if (!hasSharedBankDetails(bank) || rows.length === 0) return rows;
    return rows.map((row) => {
        const slot = classifyBankFieldId(row.id);
        if (!slot) return row;
        const next = sharedBankSlotValue(bank, slot);
        if (!next) return row;
        return { ...row, value: next };
    });
}

/** Keep duplicate bank fields in the same editor (ACH page 1 + page 2) in lockstep. */
export function syncSiblingBankFields(
    values: Record<string, string>,
    changedId: string,
    nextValue: string,
): Record<string, string> {
    const slot = classifyBankFieldId(changedId);
    const out = { ...values, [changedId]: nextValue };
    if (!slot) return out;
    for (const id of Object.keys(out)) {
        if (id === changedId) continue;
        if (classifyBankFieldId(id) === slot) out[id] = nextValue;
    }
    return out;
}
