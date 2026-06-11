import type {
    BuildContractPrefillFieldsArgs,
    ContractPrefillContractRecords,
    ContractPrefillField,
} from "./Contract";
import {
    buildContractPrefillFieldsFromApplication,
    getContractPrefillEditDefaultsFromApplication,
    resolveBalanceTransferMerchantContext,
} from "./Contract";
import {
    buildBalanceTransferSheetContractPrefillFields,
    type BalanceTransferSheetContractPrefillFields,
} from "./BALANCE_TRANSFER_SHEET_ADDENDUM";
import { DOCUSIGN_ADDENDUM_TEMPLATE_IDS } from "./docusignAddendumTemplates";
import {
    buildWoodmereFlexAddendumContractPrefillFields,
    type WoodmereFlexAddendumContractPrefillFields,
} from "./WOODMERE_FLEX_ADDENDUM";
import {
    buildWoodmereBuyoutBlankAddendumContractPrefillFields,
    type WoodmereBuyoutBlankAddendumContractPrefillFields,
} from "./WOODMERE_BUYOUT_BLANK_ADDENDUM";
import {
    buildWoodmereFlexDatedAddendumContractPrefillFields,
    type WoodmereFlexDatedAddendumContractPrefillFields,
} from "./WOODMERE_FLEX_DATED_ADDENDUM";
import {
    buildDiscoverAdvanceEpoAddendumContractPrefillFields,
    type DiscoverAdvanceEpoAddendumContractPrefillFields,
} from "./Discover_Advance_EPO_ADDENDUM";
import {
    buildDiscoverRefiBalanceTransferAddendumContractPrefillFields,
    type DiscoverRefiBalanceTransferAddendumContractPrefillFields,
} from "./DISCOVER_REFI_BALANCE_TRANSFER_ADDENDUM";
import {
    buildStateDisclosurePrefillContextFromContract,
    getStateDisclosurePrefillFieldsByName,
    getStateDisclosurePrefillFieldsByStateFrequency,
    type StateDisclosureContext,
} from "./stateDisclosurePrefill";
import { CONTRACT_SIGNER_OVERRIDES_KEY } from "./templateRecipients";

/** Stored on `Contract.contractPrefillOverrides` alongside main prefill keys. */
export const DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY = "documentTemplatePrefillByMappingId";

/** DocuSign envelope ids per `ContractDocumentTemplateMapping.id` (e.g. standalone ACH). */
export const DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY = "documentTemplateEnvelopeByMappingId";

export type DocumentTemplateEnvelopeMeta = {
    envelopeId: string;
    status?: string;
    updatedAt?: string;
};

/** DocuSign send history for Contracts Generated table (contract + ACH envelopes). */
export const DOCUMENT_SEND_HISTORY_KEY = "documentSendHistory";

export type DocumentSendKind = "contract" | "ach";

export type DocumentSendHistoryEntry = {
    envelopeId: string;
    documentKind: DocumentSendKind;
    label: string;
    status?: string;
    updatedAt?: string;
};

export function parseDocumentSendHistory(raw: unknown): DocumentSendHistoryEntry[] {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const blob = (raw as Record<string, unknown>)[DOCUMENT_SEND_HISTORY_KEY];
    if (!Array.isArray(blob)) return [];
    const out: DocumentSendHistoryEntry[] = [];
    for (const row of blob) {
        if (!row || typeof row !== "object") continue;
        const envelopeId = String((row as Record<string, unknown>).envelopeId ?? "").trim();
        const documentKind = (row as Record<string, unknown>).documentKind;
        const label = String((row as Record<string, unknown>).label ?? "").trim();
        if (!envelopeId || (documentKind !== "contract" && documentKind !== "ach")) continue;
        const status = String((row as Record<string, unknown>).status ?? "").trim();
        const updatedAt = String((row as Record<string, unknown>).updatedAt ?? "").trim();
        out.push({
            envelopeId,
            documentKind,
            label: label || (documentKind === "ach" ? "ACH Authorization" : "Contract"),
            ...(status ? { status } : {}),
            ...(updatedAt ? { updatedAt } : {}),
        });
    }
    return out;
}

export function upsertDocumentSendHistory(
    existing: DocumentSendHistoryEntry[],
    entry: DocumentSendHistoryEntry,
): DocumentSendHistoryEntry[] {
    const idx = existing.findIndex((e) => e.envelopeId === entry.envelopeId);
    if (idx >= 0) {
        const next = [...existing];
        next[idx] = { ...next[idx], ...entry };
        return next;
    }
    return [...existing, entry];
}

export function formatDocumentSendStatusLabel(status?: string | null): string {
    const s = String(status ?? "").trim().toLowerCase();
    if (!s) return "Generated";
    if (s === "completed" || s === "signed") return "Signed";
    if (s === "sent" || s === "delivered") return "Sent";
    if (s === "viewed") return "Viewed";
    if (s === "draft" || s === "created") return "Draft";
    if (s === "revoked" || s === "voided") return "Voided";
    if (s === "declined") return "Declined";
    if (s === "expired") return "Expired";
    return s.toUpperCase();
}

export function isDocumentSendEntryViewable(status?: string | null): boolean {
    const s = String(status ?? "").trim().toLowerCase();
    return s === "completed" || s === "signed";
}

const DUMMY = ".";

function str(v: unknown): string {
    return String(v ?? "").trim();
}

function normalizeKey(value: string | null | undefined): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

function disclosureDummyContext(): StateDisclosureContext {
    const d = (): string => DUMMY;
    return {
        fundingProvided: d(),
        fundingDisbursed: d(),
        feesDeducted: d(),
        totalRepayment: d(),
        totalDollarCost: d(),
        financeCharge: d(),
        estimatedPayment: d(),
        estimatedAnnualPercentageRate: d(),
        averageMonthlyIncome: d(),
        paymentExceededPercent: d(),
        estimatedTerm: d(),
        estimatedNumberOfPayments: d(),
        prepayment: d(),
        recipientName: d(),
        recipientAddress: d(),
        signatureDate: d(),
        prepaymentReceivedByDate: d(),
        prepaymentDiscountAmount: d(),
    };
}

/** Same merge order as Deal Review / main contract prefill edit (app → contract row → saved overrides). */
function buildEffectiveContractForTemplatePrefill(options: {
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
}): Record<string, unknown> {
    const contract = options.contract ?? {};
    const merged = getContractPrefillEditDefaultsFromApplication(options.application ?? null, {
        agreementDate: options.agreementDate,
        contractRecords: { contract },
    });
    return {
        ...merged,
        ...contract,
        ...(options.mainPrefillOverrides ?? {}),
    };
}

function mergeFieldRows(
    allDefs: ContractPrefillField[],
    computed: ContractPrefillField[],
    savedForRow: Record<string, string> | null | undefined,
): ContractPrefillField[] {
    const computedById = new Map(computed.map((f) => [f.id, f]));
    const saved = savedForRow ?? {};
    return allDefs.map((def) => {
        const fromSaved = saved[def.id];
        if (fromSaved !== undefined && String(fromSaved).trim() !== "") {
            return { id: def.id, label: def.label, value: String(fromSaved).trim() };
        }
        return {
            id: def.id,
            label: def.label,
            value: computedById.get(def.id)?.value ?? "",
        };
    });
}

function stateDisclosureAllDefs(
    name: string | null | undefined,
    state: string | null | undefined,
    frequency: string | null | undefined,
): ContractPrefillField[] {
    const dummy = disclosureDummyContext();
    const byName = getStateDisclosurePrefillFieldsByName(name, dummy);
    if (byName.length > 0) return byName;
    return getStateDisclosurePrefillFieldsByStateFrequency({
        state,
        frequency,
        context: dummy,
    });
}

function stateDisclosureComputed(
    name: string | null | undefined,
    state: string | null | undefined,
    frequency: string | null | undefined,
    context: StateDisclosureContext,
): ContractPrefillField[] {
    const byName = getStateDisclosurePrefillFieldsByName(name, context);
    if (byName.length > 0) return byName;
    return getStateDisclosurePrefillFieldsByStateFrequency({
        state,
        frequency,
        context,
    });
}

function dotBalanceTransfer(): BalanceTransferSheetContractPrefillFields {
    return {
        merchantLegalName: DUMMY,
        businessLegalName: DUMMY,
        clientLegalName: DUMMY,
        clientNameBy: DUMMY,
        dba: DUMMY,
        businessAddress: DUMMY,
        businessAddressCity: DUMMY,
        businessAddressState: DUMMY,
        businessAddressZip: DUMMY,
        purchasePrice: DUMMY,
    };
}

function dotWoodmereFlex(): WoodmereFlexAddendumContractPrefillFields {
    return {
        clientLegalName: DUMMY,
        clientName: DUMMY,
    };
}

function buildBalanceTransferComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
    application: Record<string, unknown> | null,
): ContractPrefillField[] {
    const c = contract ?? {};
    const overrides = (c.contractPrefillOverrides as Record<string, unknown> | undefined) ?? {};
    const merchant = resolveBalanceTransferMerchantContext(contract, application, {
        recipientName: sctx.recipientName,
        recipientAddress: sctx.recipientAddress,
    });
    const purchasePrice =
        str(c.purchasePrice) ||
        str(c.purchaseAmount) ||
        str(overrides.purchasePrice) ||
        str(overrides.purchaseAmount) ||
        "";
    return buildBalanceTransferSheetContractPrefillFields({
        merchantLegalName: merchant.clientLegalName,
        businessLegalName: merchant.businessName,
        clientLegalName: merchant.clientLegalName,
        clientNameBy: merchant.clientNameBy,
        dba: merchant.clientDba,
        businessAddress: str(c.businessAddress) || str(overrides.businessAddress),
        businessAddressCity: str(c.businessAddressCity) || str(overrides.businessAddressCity),
        businessAddressState: str(c.businessAddressState) || str(overrides.businessAddressState),
        businessAddressZip: str(c.businessAddressZip) || str(overrides.businessAddressZip),
        purchasePrice,
    });
}

function buildWoodmereFlexComputed(contract: Record<string, unknown> | null, sctx: StateDisclosureContext): ContractPrefillField[] {
    const c = contract ?? {};
    const personName = str(c.customerName) || str(c.clientName) || sctx.recipientName;
    return buildWoodmereFlexAddendumContractPrefillFields({
        clientLegalName: str(c.legalName) || sctx.recipientName,
        clientName: personName,
    });
}

function buildWoodmereBuyoutComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
): ContractPrefillField[] {
    const c = contract ?? {};
    return buildWoodmereBuyoutBlankAddendumContractPrefillFields({
        addendumEnteredDate: sctx.signatureDate,
        addendumAgreementDate: sctx.signatureDate,
        clientName: sctx.recipientName,
        agreeName: sctx.recipientName,
        advanceRemit: sctx.estimatedPayment,
        agreementTo: str(c.authorizationApplication),
        amountOfDirecltyDisbursed: sctx.fundingDisbursed,
        transferFundTo: "",
        nameOfBank: str(c.authorizationClientBankName),
        abaRouting: str(c.authorizationClientBankRouting),
        checkingAccount: str(c.authorizationClientBankAccount),
        transferAmount: sctx.totalRepayment,
        ownerName: sctx.recipientName,
    });
}

function dotWoodmereBuyout(): WoodmereBuyoutBlankAddendumContractPrefillFields {
    return {
        addendumEnteredDate: DUMMY,
        addendumAgreementDate: DUMMY,
        clientName: DUMMY,
        agreeName: DUMMY,
        advanceRemit: DUMMY,
        agreementTo: DUMMY,
        amountOfDirecltyDisbursed: DUMMY,
        transferFundTo: DUMMY,
        nameOfBank: DUMMY,
        abaRouting: DUMMY,
        checkingAccount: DUMMY,
        transferAmount: DUMMY,
        ownerName: DUMMY,
    };
}

function buildWoodmereFlexDatedComputed(contract: Record<string, unknown> | null, sctx: StateDisclosureContext): ContractPrefillField[] {
    const c = contract ?? {};
    const personName = str(c.customerName) || str(c.clientName) || sctx.recipientName;
    return buildWoodmereFlexDatedAddendumContractPrefillFields({
        addendumDated: sctx.signatureDate,
        agreementDate: sctx.signatureDate,
        clientNameAddendum: personName,
        clientName: personName,
    });
}

function dotWoodmereFlexDated(): WoodmereFlexDatedAddendumContractPrefillFields {
    return {
        addendumDated: DUMMY,
        agreementDate: DUMMY,
        clientNameAddendum: DUMMY,
        clientName: DUMMY,
    };
}

function buildDiscoverEpoComputed(contract: Record<string, unknown> | null, sctx: StateDisclosureContext): ContractPrefillField[] {
    const c = contract ?? {};
    const offer = (c.offer ?? null) as Record<string, unknown> | null;
    const payFmt = (n: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
    let p60 = "";
    let p90 = "";
    let p120 = "";
    const total = Number(c.purchasePrice ?? offer?.totalRemit ?? offer?.paybackAmount);
    if (Number.isFinite(total)) {
        p60 = payFmt(total * (60 / 100));
        p90 = payFmt(total * (90 / 100));
        p120 = payFmt(total * (120 / 100));
    }
    return buildDiscoverAdvanceEpoAddendumContractPrefillFields({
        loanAgreementDated: sctx.signatureDate,
        borrowerName: sctx.recipientName,
        payingToDiscoverAgent60: p60,
        payingToDiscoverAgent90: p90,
        payingToDiscoverAgent120: p120,
        printBorrowerName1: str(c.clientName) || sctx.recipientName,
        printBorrowerTitle1: str(c["ownerTitle"]),
        printBorrowerName2: str(c["owner1GuarantorName"]),
        printBorrowerTitle2: "",
    });
}

function dotDiscoverEpo(): DiscoverAdvanceEpoAddendumContractPrefillFields {
    return {
        loanAgreementDated: DUMMY,
        borrowerName: DUMMY,
        payingToDiscoverAgent60: DUMMY,
        payingToDiscoverAgent90: DUMMY,
        payingToDiscoverAgent120: DUMMY,
        printBorrowerName1: DUMMY,
        printBorrowerTitle1: DUMMY,
        printBorrowerName2: DUMMY,
        printBorrowerTitle2: DUMMY,
    };
}

function buildDiscoverRefiComputed(contract: Record<string, unknown> | null, sctx: StateDisclosureContext): ContractPrefillField[] {
    const c = contract ?? {};
    return buildDiscoverRefiBalanceTransferAddendumContractPrefillFields({
        loanAgreementDated: sctx.signatureDate,
        borrowerName: sctx.recipientName,
        borrowerPay: sctx.estimatedPayment,
        financialDate: sctx.signatureDate,
        previousFinancingDirectlyTo: "",
        borrowerName1: str(c.clientName) || sctx.recipientName,
        borrowerTitle1: str(c["ownerTitle"]),
    });
}

function dotDiscoverRefi(): DiscoverRefiBalanceTransferAddendumContractPrefillFields {
    return {
        loanAgreementDated: DUMMY,
        borrowerName: DUMMY,
        borrowerPay: DUMMY,
        financialDate: DUMMY,
        previousFinancingDirectlyTo: DUMMY,
        borrowerName1: DUMMY,
        borrowerTitle1: DUMMY,
    };
}

function matches(norm: string, ...needles: string[]): boolean {
    return needles.every((n) => norm.includes(n));
}

type AddendumKind =
    | "balance_transfer_sheet"
    | "woodmere_flex"
    | "woodmere_buyout_blank"
    | "woodmere_flex_dated"
    | "discover_epo"
    | "discover_refi_balance";

const ADDENDUM_GUID = Object.fromEntries(
    Object.entries(DOCUSIGN_ADDENDUM_TEMPLATE_IDS).map(([k, v]) => [k, String(v).trim().toLowerCase()]),
) as Record<keyof typeof DOCUSIGN_ADDENDUM_TEMPLATE_IDS, string>;

function resolveAddendumKind(
    templateId?: string | null,
    normName = "",
): AddendumKind | null {
    const tid = String(templateId ?? "").trim().toLowerCase();
    if (tid === ADDENDUM_GUID.WOODMERE_FLEX) return "woodmere_flex";
    if (tid === ADDENDUM_GUID.WOODMERE_BALANCE_TRANSFER_SHEET) return "balance_transfer_sheet";
    if (matches(normName, "balance", "transfer") && normName.includes("sheet")) return "balance_transfer_sheet";
    if (normName.includes("woodmere") && normName.includes("flex") && (normName.includes("dated") || normName.includes("agreement")))
        return "woodmere_flex_dated";
    if (normName.includes("woodmere") && normName.includes("flex")) return "woodmere_flex";
    if (normName.includes("buyout") && normName.includes("blank")) return "woodmere_buyout_blank";
    if (normName.includes("discover") && normName.includes("epo")) return "discover_epo";
    if (normName.includes("discover") && (normName.includes("refi") || normName.includes("balance_transfer")))
        return "discover_refi_balance";
    return null;
}

/** True when this DocuSign addendum template has a registered prefill field map (edit in contract prefill modal). */
export function hasAddendumPrefillFieldMap(
    templateId?: string | null,
    templateName?: string | null,
): boolean {
    return resolveAddendumKind(templateId, normalizeKey(templateName ?? "")) != null;
}

/** Remove per-mapping addendum blob so main contract prefill forms do not treat it as flat keys. */
export function stripDocumentTemplateBlobFromPrefillOverrides<
    T extends Record<string, unknown> | null | undefined,
>(raw: T): T {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const o = { ...raw } as Record<string, unknown>;
    delete o[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
    delete o[DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY];
    delete o[DOCUMENT_SEND_HISTORY_KEY];
    delete o[CONTRACT_SIGNER_OVERRIDES_KEY];
    return o as T;
}

function addendumAllDefs(kind: AddendumKind): ContractPrefillField[] {
    switch (kind) {
        case "balance_transfer_sheet":
            return buildBalanceTransferSheetContractPrefillFields(dotBalanceTransfer());
        case "woodmere_flex":
            return buildWoodmereFlexAddendumContractPrefillFields(dotWoodmereFlex());
        case "woodmere_buyout_blank":
            return buildWoodmereBuyoutBlankAddendumContractPrefillFields(dotWoodmereBuyout());
        case "woodmere_flex_dated":
            return buildWoodmereFlexDatedAddendumContractPrefillFields(dotWoodmereFlexDated());
        case "discover_epo":
            return buildDiscoverAdvanceEpoAddendumContractPrefillFields(dotDiscoverEpo());
        case "discover_refi_balance":
            return buildDiscoverRefiBalanceTransferAddendumContractPrefillFields(dotDiscoverRefi());
        default:
            return [];
    }
}

function addendumComputed(
    kind: AddendumKind,
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
    application: Record<string, unknown> | null,
): ContractPrefillField[] {
    switch (kind) {
        case "balance_transfer_sheet":
            return buildBalanceTransferComputed(contract, sctx, application);
        case "woodmere_flex":
            return buildWoodmereFlexComputed(contract, sctx);
        case "woodmere_buyout_blank":
            return buildWoodmereBuyoutComputed(contract, sctx);
        case "woodmere_flex_dated":
            return buildWoodmereFlexDatedComputed(contract, sctx);
        case "discover_epo":
            return buildDiscoverEpoComputed(contract, sctx);
        case "discover_refi_balance":
            return buildDiscoverRefiComputed(contract, sctx);
        default:
            return [];
    }
}

export function parseDocumentTemplatePrefillByMappingId(raw: unknown): Record<string, Record<string, string>> {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const blob = (raw as Record<string, unknown>)[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return {};
    const out: Record<string, Record<string, string>> = {};
    for (const [mappingId, row] of Object.entries(blob)) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const inner: Record<string, string> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
            inner[k] = String(v ?? "");
        }
        out[mappingId] = inner;
    }
    return out;
}

export function parseDocumentTemplateEnvelopeByMappingId(
    raw: unknown,
): Record<string, DocumentTemplateEnvelopeMeta> {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const blob = (raw as Record<string, unknown>)[DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY];
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return {};
    const out: Record<string, DocumentTemplateEnvelopeMeta> = {};
    for (const [mappingId, row] of Object.entries(blob)) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const envelopeId = String((row as Record<string, unknown>).envelopeId ?? "").trim();
        if (!envelopeId) continue;
        const status = String((row as Record<string, unknown>).status ?? "").trim();
        const updatedAt = String((row as Record<string, unknown>).updatedAt ?? "").trim();
        out[mappingId] = {
            envelopeId,
            ...(status ? { status } : {}),
            ...(updatedAt ? { updatedAt } : {}),
        };
    }
    return out;
}

/**
 * Rows for the template-mapping editor: every BoldSign field id for this template, labels from builders,
 * values from CRM-derived defaults merged with optional saved overrides for this mapping row.
 */
export const LINKED_DOCUSIGN_ADDENDUM_SECTION_ID = "linked_docusign_addendum";
export const LINKED_DOCUSIGN_ACH_SECTION_ID = "linked_docusign_ach";

/** Field ids on `ach_authorization.layout.json` — keep in sync with backend layout. */
const ACH_AUTHORIZATION_LAYOUT_FIELD_IDS = [
    "ach_authorization_account_holder_address",
    "ach_authorization_account_holder_bank_account_number",
    "ach_authorization_account_holder_bank_branch_city",
    "ach_authorization_account_holder_bank_name",
    "ach_authorization_account_holder_bank_routing_number",
    "ach_authorization_account_holder_bank_state",
    "ach_authorization_account_holder_bank_transaction_fee",
    "ach_authorization_account_holder_bank_zip",
    "ach_authorization_account_holder_city",
    "ach_authorization_account_holder_dba",
    "ach_authorization_account_holder_name",
    "ach_authorization_account_holder_phone",
    "ach_authorization_account_holder_state",
    "ach_authorization_account_holder_zip",
    "ach_authorization_concent_account_holder_name",
    "authorization_client_bank_account",
    "authorization_client_bank_name",
    "authorization_client_bank_routing",
    "authorization_client_name",
    "authorization_client_name_print",
    "authorization_client_tax_id",
    "authorized_business_phone",
    "signature_date",
] as const;

const ACH_AUTHORIZATION_FIELD_LABELS: Record<string, string> = {
    ach_authorization_account_holder_name: "Account holder name",
    ach_authorization_account_holder_dba: "DBA",
    ach_authorization_account_holder_phone: "Phone",
    ach_authorization_account_holder_address: "Street address",
    ach_authorization_account_holder_city: "City",
    ach_authorization_account_holder_state: "State",
    ach_authorization_account_holder_zip: "ZIP",
    ach_authorization_account_holder_bank_name: "Bank name",
    ach_authorization_account_holder_bank_branch_city: "Bank branch city",
    ach_authorization_account_holder_bank_state: "Bank state",
    ach_authorization_account_holder_bank_zip: "Bank ZIP",
    ach_authorization_account_holder_bank_routing_number: "Routing number",
    ach_authorization_account_holder_bank_account_number: "Account number",
    ach_authorization_account_holder_bank_transaction_fee: "Transaction fee",
    ach_authorization_concent_account_holder_name: "Consent — account holder name",
    authorization_client_bank_account: "Client bank account",
    authorization_client_bank_name: "Client bank name",
    authorization_client_bank_routing: "Client bank routing",
    authorization_client_name: "Client name",
    authorization_client_name_print: "Client name (print)",
    authorization_client_tax_id: "Client tax ID / EIN",
    authorized_business_phone: "Business phone",
    signature_date: "Signature date",
};

export function usesCoordinateLayoutTemplate(row: {
    documentType?: string | null;
    template?: {
        type?: string | null;
        layoutKey?: string | null;
        pdfUrl?: string | null;
        templateId?: string | null;
    } | null;
} | null): boolean {
    if (!row) return false;
    const docType = normalizeKey(row.documentType ?? "");
    const type = normalizeKey(row.template?.type ?? "");
    const layoutKey = String(row.template?.layoutKey ?? "").trim();
    const pdfUrl = String(row.template?.pdfUrl ?? "").trim();
    if (docType === "ach" || type === "ach" || layoutKey === "ach_authorization") return true;
    if (layoutKey && pdfUrl) return true;
    return false;
}

function resolveAchAuthorizationTemplate(
    templateType?: string | null,
    templateName?: string | null,
    layoutKey?: string | null,
): boolean {
    const typeNorm = normalizeKey(templateType ?? "");
    const layoutNorm = normalizeKey(layoutKey ?? "");
    const nameNorm = normalizeKey(templateName ?? "");
    return (
        typeNorm === "ach" ||
        layoutNorm === "ach_authorization" ||
        nameNorm.includes("ach")
    );
}

function achAuthorizationAllDefs(): ContractPrefillField[] {
    return ACH_AUTHORIZATION_LAYOUT_FIELD_IDS.map((id) => ({
        id,
        label: ACH_AUTHORIZATION_FIELD_LABELS[id] || id.replace(/_/g, " "),
        value: "",
    }));
}

function achAuthorizationComputed(
    contract: Record<string, unknown> | null,
    application: Record<string, unknown> | null,
    agreementDate?: string,
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null,
    contractRecords?: ContractPrefillContractRecords | null,
): ContractPrefillField[] {
    const effectiveContract = buildEffectiveContractForTemplatePrefill({
        contract,
        application,
        agreementDate,
        mainPrefillOverrides,
    });
    const computed = buildContractPrefillFieldsFromApplication(application, {
        agreementDate,
        contractRecords: {
            contract: effectiveContract,
            ach: contractRecords?.ach ?? null,
            bankDetail: contractRecords?.bankDetail,
        },
    });
    const allowed = new Set<string>(ACH_AUTHORIZATION_LAYOUT_FIELD_IDS);
    const rows = computed.filter((f) => allowed.has(f.id));
    if (!rows.some((f) => f.id === "signature_date" && str(f.value))) {
        const dateRow = rows.find((f) => f.id === "signature_date");
        if (dateRow && agreementDate) {
            dateRow.value = agreementDate;
        }
    }
    return rows;
}

export function getDocumentTemplatePrefillFieldRowsForEditor(options: {
    templateId?: string | null;
    templateName?: string | null;
    templateType?: string | null;
    templateLayoutKey?: string | null;
    templateState?: string | null;
    templateFrequency?: string | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    contractRecords?: ContractPrefillContractRecords | null;
    agreementDate?: string;
    /** Main contract prefill overrides (excludes per-mapping blob); same source as Deal Review. */
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    savedOverridesForMapping?: Record<string, string> | null;
}): ContractPrefillField[] {
    const effectiveContract = buildEffectiveContractForTemplatePrefill({
        contract: options.contract ?? null,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
        mainPrefillOverrides: options.mainPrefillOverrides,
    });

    const sctx = buildStateDisclosurePrefillContextFromContract({
        contract: effectiveContract,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
    });

    const name = options.templateName;
    const state = options.templateState;
    const frequency = options.templateFrequency;
    const templateId = options.templateId;

    const stAll = stateDisclosureAllDefs(name, state, frequency);
    if (stAll.length > 0) {
        const computed = stateDisclosureComputed(name, state, frequency, sctx);
        return mergeFieldRows(stAll, computed, options.savedOverridesForMapping);
    }

    const norm = normalizeKey(name ?? "");
    const addendum = resolveAddendumKind(templateId, norm);
    if (addendum) {
        const all = addendumAllDefs(addendum);
        const computed = addendumComputed(
            addendum,
            effectiveContract,
            sctx,
            options.application ?? null,
        );
        return mergeFieldRows(all, computed, options.savedOverridesForMapping);
    }

    if (
        resolveAchAuthorizationTemplate(
            options.templateType,
            name,
            options.templateLayoutKey,
        )
    ) {
        const all = achAuthorizationAllDefs();
        const computed = achAuthorizationComputed(
            effectiveContract,
            options.application ?? null,
            options.agreementDate,
            options.mainPrefillOverrides,
            options.contractRecords ?? null,
        );
        return mergeFieldRows(all, computed, options.savedOverridesForMapping);
    }

    return [];
}

export function applyDocumentTemplateMappingPrefillOverrides(args: {
    prefillFieldsPayload: Array<{ id: string; value: string }>;
    mergedTemplateIds: string[];
    templateMappingRows: Array<{
        id: string;
        template?: {
            templateId?: string;
            name?: string | null;
            state?: string | null;
            frequency?: string | null;
        } | null;
    }>;
    contractPrefillOverridesRaw: unknown;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
}): Array<{ id: string; value: string }> {
    const blob = parseDocumentTemplatePrefillByMappingId(args.contractPrefillOverridesRaw);
    const mergedSet = new Set(args.mergedTemplateIds.map((x) => String(x).trim()).filter(Boolean));
    const byId = new Map(args.prefillFieldsPayload.map((f) => [f.id, { ...f }]));

    for (const row of args.templateMappingRows) {
        const templateRowId = String(
            (row.template as { id?: string } | null | undefined)?.id ?? "",
        ).trim();
        const legacyTemplateId = String(row.template?.templateId ?? "").trim();
        const matchesMerged =
            (templateRowId && mergedSet.has(templateRowId)) ||
            (legacyTemplateId && mergedSet.has(legacyTemplateId));
        if (!matchesMerged) continue;
        const perMap = blob[row.id];
        const computedRows = getDocumentTemplatePrefillFieldRowsForEditor({
            templateId: row.template?.templateId ?? null,
            templateName: row.template?.name ?? null,
            templateType: (row.template as { type?: string } | null | undefined)?.type ?? null,
            templateLayoutKey:
                (row.template as { layoutKey?: string } | null | undefined)?.layoutKey ?? null,
            templateState: row.template?.state ?? null,
            templateFrequency: row.template?.frequency ?? null,
            contract: args.contract ?? null,
            application: args.application ?? null,
            agreementDate: args.agreementDate,
            mainPrefillOverrides: args.mainPrefillOverrides,
            savedOverridesForMapping: perMap ?? null,
        });
        for (const field of computedRows) {
            const v = String(field.value ?? "").trim();
            if (!v) continue;
            byId.set(field.id, { id: field.id, value: v });
        }
    }
    return Array.from(byId.values());
}
