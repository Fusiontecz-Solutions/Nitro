import type { BuildContractPrefillFieldsArgs, ContractPrefillField } from "./Contract";
import {
    getContractPrefillEditDefaultsFromApplication,
    resolveBalanceTransferMerchantContext,
    resolveNumberOfPaymentsPrefillValue,
    resolveRemittancePrefillValue,
} from "./Contract";
import {
    buildBalanceTransferSheetContractPrefillFields,
    type BalanceTransferSheetContractPrefillFields,
} from "./BALANCE_TRANSFER_SHEET_ADDENDUM";
import {
    buildKatanBuyoutBlankAddendumContractPrefillFields,
    type KatanBuyoutBlankAddendumContractPrefillFields,
} from "./KATAN_BUYOUT_BLANK_ADDENDUM";
import {
    buildKatanFlexAddendumContractPrefillFields,
    type KatanFlexAddendumContractPrefillFields,
} from "./KATAN_FLEX_ADDENDUM";
import {
    buildDiscoverAdvanceEpoAddendumContractPrefillFields,
    type DiscoverAdvanceEpoAddendumContractPrefillFields,
} from "./Discover_Advance_EPO_ADDENDUM";
import {
    buildDiscoverRefiBalanceTransferAddendumContractPrefillFields,
    type DiscoverRefiBalanceTransferAddendumContractPrefillFields,
} from "./DISCOVER_REFI_BALANCE_TRANSFER_ADDENDUM";
import {
    buildKatanAchAuthorizationAddendumPrefillFields,
    type KatanAchAuthorizationAddendumPrefillFields,
} from "./KATAN_ACH_AUTHORIZATION_ADDENDUM";
import {
    DOCUSIGN_ADDENDUM_LAYOUT_KEYS,
    isKnownKatanAddendumLayoutKey,
    normalizeDocusignTemplateId,
} from "./docusignAddendumTemplates";
import {
    buildStateDisclosurePrefillContextFromContract,
    getStateDisclosureEditorFieldDefinitions,
    getStateDisclosurePrefillFieldsByName,
    getStateDisclosurePrefillFieldsByStateFrequency,
    hasStateDisclosurePrefillRegistry,
    resolveStateDisclosureRegistryKey,
    type StateDisclosureContext,
} from "./stateDisclosurePrefill";
import {
    buildDisclosureEditorFieldsFromContext,
    collapsePdfFieldsToDisclosureEditorValues,
    expandDisclosureEditorValuesToPdfFields,
} from "./disclosureEditorFields";
import { isUtahDisclosureState } from "./daily_utah";

import { ACH_AUTHORIZATION_DOCUSIGN_KEY } from "./achAuthorizationDocuSign";
import { isPlatformLayoutKey, PLATFORM_DISCLOSURE_FUNDER_NAME } from "./platformDocumentConfig";
import { CONTRACT_SIGNER_OVERRIDES_KEY } from "./templateRecipients";

/** Stored on `Contract.contractPrefillOverrides` alongside main prefill keys. */
export const DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY = "documentTemplatePrefillByMappingId";

/** Main prefill form fields only — excludes reserved blobs on `contractPrefillOverrides`. */
export function stripDocumentTemplateBlobFromPrefillOverrides(
    raw: unknown,
): Partial<BuildContractPrefillFieldsArgs> | null {
    if (raw == null) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = { ...(raw as Record<string, unknown>) };
    delete o[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
    delete o[CONTRACT_SIGNER_OVERRIDES_KEY];
    delete o[ACH_AUTHORIZATION_DOCUSIGN_KEY];
    return o as Partial<BuildContractPrefillFieldsArgs>;
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
        amountBusinessFund: d(),
        fundingDisbursed: d(),
        feesDeducted: d(),
        totalRepayment: d(),
        totalDollarCost: d(),
        financeCharge: d(),
        estimatedPayment: d(),
        estimatedAnnualPercentageRate: d(),
        averageMonthlyIncome: d(),
        paymentExceededPercent: d(),
        percentOfBusinessIncome: d(),
        estimatedTerm: d(),
        estimatedNumberOfPayments: d(),
        prepayment: d(),
        recipientName: d(),
        funderName: PLATFORM_DISCLOSURE_FUNDER_NAME,
        recipientAddress: d(),
        signatureDate: d(),
        prepaymentReceivedByDate: d(),
        prepaymentDiscountAmount: d(),
        paymentFrequency: d(),
    };
}

function resolveDisclosureStateAndFrequency(options: {
    templateState?: string | null;
    templateFrequency?: string | null;
    fallbackState?: string | null;
    fallbackFrequency?: string | null;
    contract?: Record<string, unknown> | null;
}): { state: string | null; frequency: string | null } {
    const contract = options.contract ?? {};
    const state =
        String(options.templateState ?? options.fallbackState ?? contract.state ?? "").trim() ||
        null;
    const frequency =
        String(
            options.templateFrequency ??
                options.fallbackFrequency ??
                (contract as Record<string, unknown>).disclosureFrequency ??
                "",
        ).trim() || null;
    return { state, frequency };
}

/** Same merge order as Deal Review / main contract prefill edit (app → contract row → saved overrides). */
function buildEffectiveContractForTemplatePrefill(options: {
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    bankDetail?: Record<string, unknown> | null;
}): Record<string, unknown> {
    const contract = options.contract ?? {};
    const merged = getContractPrefillEditDefaultsFromApplication(options.application ?? null, {
        agreementDate: options.agreementDate,
        contractRecords: { contract, bankDetail: options.bankDetail ?? null },
    });
    return {
        ...merged,
        ...contract,
        ...(options.mainPrefillOverrides ?? {}),
    };
}

function applyPlatformDisclosureFunderName(fields: ContractPrefillField[]): ContractPrefillField[] {
    return fields.map((field) =>
        field.id === "funder_name"
            ? { ...field, value: PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase() }
            : field,
    );
}

function parsePrefillMoneyForMerge(value: unknown): number | undefined {
    const raw = String(value ?? "").trim();
    if (!raw) return undefined;
    const n = Number.parseFloat(raw.replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
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
        const fromSavedTrim =
            fromSaved !== undefined ? String(fromSaved).trim() : "";
        const computedVal = String(computedById.get(def.id)?.value ?? "").trim();
        if (fromSavedTrim !== "") {
            const savedNum = parsePrefillMoneyForMerge(fromSavedTrim);
            const computedNum = parsePrefillMoneyForMerge(computedVal);
            if (
                savedNum === 0 &&
                computedNum !== undefined &&
                computedNum > 0
            ) {
                return { id: def.id, label: def.label, value: computedVal };
            }
            return { id: def.id, label: def.label, value: fromSavedTrim };
        }
        return {
            id: def.id,
            label: def.label,
            value: computedVal,
        };
    });
}

function stateDisclosureAllDefs(
    name: string | null | undefined,
    state: string | null | undefined,
    frequency: string | null | undefined,
): ContractPrefillField[] {
    const fromEditor = getStateDisclosureEditorFieldDefinitions(name, state, frequency);
    if (fromEditor.length > 0) return fromEditor;

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
    const key = resolveStateDisclosureRegistryKey(name, state, frequency);
    if (key) return buildDisclosureEditorFieldsFromContext(context);

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
        dba: DUMMY,
        clientNameBy: DUMMY,
        clientLegalName: DUMMY,
        businessAddress: DUMMY,
        businessAddressCity: DUMMY,
        businessAddressState: DUMMY,
        businessAddressZip: DUMMY,
        purchasePrice: DUMMY,
    };
}

function buildBalanceTransferComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
    application: Record<string, unknown> | null,
): ContractPrefillField[] {
    const c = contract ?? {};
    const merchant = resolveBalanceTransferMerchantContext(contract, application, {
        recipientName: sctx.recipientName,
        recipientAddress: sctx.recipientAddress,
    });
    const offer = (c.offer ?? null) as Record<string, unknown> | null;
    const purchasePrice =
        str(c.purchasePrice) ||
        str(c.purchaseAmount) ||
        str(offer?.totalRemit) ||
        str(offer?.paybackAmount);
    return buildBalanceTransferSheetContractPrefillFields({
        merchantLegalName: merchant.clientName,
        businessLegalName: merchant.businessName,
        dba: merchant.clientDba,
        clientNameBy: merchant.clientNameBy,
        clientLegalName: merchant.clientLegalName,
        businessAddress: str(c.businessAddress) || merchant.physicalAddress,
        businessAddressCity: str(c.businessAddressCity),
        businessAddressState: str(c.businessAddressState),
        businessAddressZip: str(c.businessAddressZip),
        purchasePrice,
    });
}

function buildKatanBuyoutComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
): ContractPrefillField[] {
    const c = contract ?? {};
    return buildKatanBuyoutBlankAddendumContractPrefillFields({
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

function dotKatanBuyout(): KatanBuyoutBlankAddendumContractPrefillFields {
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

function buildKatanFlexComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
    application?: Record<string, unknown> | null,
): ContractPrefillField[] {
    const c = contract ?? {};
    const app = application ?? null;
    const offerDecision =
        (app?.offerDecision as Record<string, unknown> | undefined) ??
        (app?.OfferDecision as Record<string, unknown> | undefined) ??
        (c.offer as Record<string, unknown> | undefined) ??
        null;
    const legal = str(c.legalName) || str(c.clientLegalName) || sctx.recipientName;
    const agreementDate =
        str(c.agreement_date) ||
        sctx.signatureDate ||
        str(c.agreementDate) ||
        "";
    const addendumDate = str(c.addendum_date) || agreementDate;
    const dailyPayment =
        str(c.daily_payment) ||
        str(c.remittance) ||
        resolveRemittancePrefillValue({ application: app ?? undefined, contract, offerDecision });
    return buildKatanFlexAddendumContractPrefillFields({
        addendumDate,
        agreementDate,
        merchantName: legal,
        dailyPayment,
    });
}

function dotKatanFlex(): KatanFlexAddendumContractPrefillFields {
    return {
        addendumDate: DUMMY,
        agreementDate: DUMMY,
        merchantName: DUMMY,
        dailyPayment: DUMMY,
    };
}

function dotKatanAch(): KatanAchAuthorizationAddendumPrefillFields {
    const d = DUMMY;
    return {
        authorizationClientName: d,
        authorizationClientBankName: d,
        authorizationClientBankRouting: d,
        authorizationClientBankAccount: d,
        authorizationClientNamePrint: d,
        authorizationClientTaxId: d,
        authorizedBusinessPhone: d,
        achAuthorizationAccountHolderName: d,
        achAuthorizationAccountHolderDba: d,
        achAuthorizationAccountHolderPhone: d,
        achAuthorizationAccountHolderAddress: d,
        achAuthorizationAccountHolderCity: d,
        achAuthorizationAccountHolderState: d,
        achAuthorizationAccountHolderZip: d,
        achAuthorizationAccountHolderBankName: d,
        achAuthorizationAccountHolderBankBranchCity: d,
        achAuthorizationAccountHolderBankState: d,
        achAuthorizationAccountHolderBankZip: d,
        achAuthorizationAccountHolderBankRoutingNumber: d,
        achAuthorizationAccountHolderBankAccountNumber: d,
        achAuthorizationAccountHolderBankTransactionFee: d,
        achAuthorizationAccountHolderBankNumberOfTransactions: d,
        achAuthorizationConcentAccountHolderName: d,
    };
}

function buildKatanAchComputed(
    contract: Record<string, unknown> | null,
    application: Record<string, unknown> | null,
): ContractPrefillField[] {
    const c = contract ?? {};
    const app = application ?? {};
    const offerDecision =
        (app.offerDecision as Record<string, unknown> | undefined) ??
        (app.OfferDecision as Record<string, unknown> | undefined) ??
        null;
    const sources = {
        application,
        contract,
        offerDecision,
    };
    const transactionFee =
        str(c.achAuthorizationAccountHolderBankTransactionFee) ||
        resolveRemittancePrefillValue(sources);
    const numberOfTransactions =
        str(c.achAuthorizationAccountHolderBankNumberOfTransactions) ||
        resolveNumberOfPaymentsPrefillValue(sources);
    return buildKatanAchAuthorizationAddendumPrefillFields({
        authorizationClientName: str(c.authorizationClientName),
        authorizationClientBankName: str(c.authorizationClientBankName),
        authorizationClientBankRouting: str(c.authorizationClientBankRouting),
        authorizationClientBankAccount: str(c.authorizationClientBankAccount),
        authorizationClientNamePrint: str(c.authorizationClientNamePrint),
        authorizationClientTaxId: str(c.authorizationClientTaxId),
        authorizedBusinessPhone: str(c.authorizedBusinessPhone),
        achAuthorizationAccountHolderName: str(c.achAuthorizationAccountHolderName),
        achAuthorizationAccountHolderDba: str(c.achAuthorizationAccountHolderDba),
        achAuthorizationAccountHolderPhone: str(c.achAuthorizationAccountHolderPhone),
        achAuthorizationAccountHolderAddress: str(c.achAuthorizationAccountHolderAddress),
        achAuthorizationAccountHolderCity: str(c.achAuthorizationAccountHolderCity),
        achAuthorizationAccountHolderState: str(c.achAuthorizationAccountHolderState),
        achAuthorizationAccountHolderZip: str(c.achAuthorizationAccountHolderZip),
        achAuthorizationAccountHolderBankName: str(c.achAuthorizationAccountHolderBankName),
        achAuthorizationAccountHolderBankBranchCity: str(c.achAuthorizationAccountHolderBankBranchCity),
        achAuthorizationAccountHolderBankState: str(c.achAuthorizationAccountHolderBankState),
        achAuthorizationAccountHolderBankZip: str(c.achAuthorizationAccountHolderBankZip),
        achAuthorizationAccountHolderBankRoutingNumber: str(c.achAuthorizationAccountHolderBankRoutingNumber),
        achAuthorizationAccountHolderBankAccountNumber: str(c.achAuthorizationAccountHolderBankAccountNumber),
        achAuthorizationAccountHolderBankTransactionFee: transactionFee,
        achAuthorizationAccountHolderBankNumberOfTransactions: numberOfTransactions,
        achAuthorizationConcentAccountHolderName: str(c.achAuthorizationConcentAccountHolderName),
    });
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
    | "katan_buyout_blank"
    | "katan_flex"
    | "katan_ach_authorization"
    | "discover_epo"
    | "discover_refi_balance";

function resolveAddendumKindFromLayoutKey(layoutKey?: string | null): AddendumKind | null {
    const key = normalizeDocusignTemplateId(layoutKey);
    if (key === DOCUSIGN_ADDENDUM_LAYOUT_KEYS.BALANCE_TRANSFER_SHEET) return "balance_transfer_sheet";
    if (key === DOCUSIGN_ADDENDUM_LAYOUT_KEYS.FLEX_ADDENDUM) return "katan_flex";
    if (key === DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION) return "katan_ach_authorization";
    if (key === DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE) {
        return "katan_ach_authorization";
    }
    return null;
}

/** Legacy DocuSign template GUID for Katan ACH Authorization PDF. */
const LEGACY_KATAN_ACH_TEMPLATE_ID = "15a61a5b-af2f-41cb-aaad-68bded7ffa3e";
/** Legacy DocuSign template GUID for Katan Capital Flex Addendum PDF. */
const LEGACY_KATAN_FLEX_ADDENDUM_TEMPLATE_ID = "c2a0e972-2cb1-48fe-b4fe-a4088e1056de";

function resolveAddendumKind(normName: string, templateId?: string | null): AddendumKind | null {
    if (isKnownKatanAddendumLayoutKey(templateId)) {
        const fromKey = resolveAddendumKindFromLayoutKey(templateId);
        if (fromKey) return fromKey;
    }
    const tid = normalizeDocusignTemplateId(templateId);
    if (tid === DOCUSIGN_ADDENDUM_LAYOUT_KEYS.BALANCE_TRANSFER_SHEET) return "balance_transfer_sheet";
    if (tid === DOCUSIGN_ADDENDUM_LAYOUT_KEYS.FLEX_ADDENDUM) return "katan_flex";
    if (tid === LEGACY_KATAN_FLEX_ADDENDUM_TEMPLATE_ID) return "katan_flex";
    if (tid === DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION) return "katan_ach_authorization";
    if (tid === LEGACY_KATAN_ACH_TEMPLATE_ID) return "katan_ach_authorization";

    if (matches(normName, "balance", "transfer") && normName.includes("sheet")) return "balance_transfer_sheet";
    if (normName.includes("buyout") && normName.includes("blank")) return "katan_buyout_blank";
    if (normName.includes("flex")) return "katan_flex";
    if (normName.includes("ach") && normName.includes("authorization")) return "katan_ach_authorization";
    if (normName.includes("katan") && normName.includes("llc") && normName.includes("ach")) {
        return "katan_ach_authorization";
    }
    if (normName.includes("katan") && normName.includes("ach")) return "katan_ach_authorization";
    if (normName.includes("discover") && normName.includes("epo")) return "discover_epo";
    if (normName.includes("discover") && (normName.includes("refi") || normName.includes("balance_transfer")))
        return "discover_refi_balance";
    return null;
}

export function isAchAuthorizationPrefillTemplate(
    templateId?: string | null,
    templateName?: string | null,
): boolean {
    const kind = resolveAddendumKind(normalizeKey(templateName ?? ""), templateId);
    return kind === "katan_ach_authorization";
}

function isAchFormPrefillEditorContext(options: {
    templateId?: string | null;
    templateName?: string | null;
    documentType?: string | null;
    prefillDocumentKind?: "ach_form" | "addendum" | null;
}): boolean {
    if (options.prefillDocumentKind === "ach_form") return true;
    if (String(options.documentType ?? "").trim().toLowerCase() === "ach") return true;
    return isAchAuthorizationPrefillTemplate(options.templateId, options.templateName);
}

/** ACH form editor rows — only fields that map to the 2-page Katan ACH PDF (never disclosure fields). */
export function getKatanAchAuthorizationPrefillFieldRowsForEditor(options: {
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    savedOverridesForMapping?: Record<string, string> | null;
    bankDetail?: Record<string, unknown> | null;
}): ContractPrefillField[] {
    const effectiveContract = buildEffectiveContractForTemplatePrefill({
        contract: options.contract ?? null,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
        mainPrefillOverrides: options.mainPrefillOverrides,
        bankDetail: options.bankDetail ?? null,
    });
    const sctx = buildStateDisclosurePrefillContextFromContract({
        contract: effectiveContract,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
    });
    const all = addendumAllDefs("katan_ach_authorization");
    const computed = addendumComputed(
        "katan_ach_authorization",
        effectiveContract,
        sctx,
        options.application ?? null,
    );
    return mergeFieldRows(all, computed, options.savedOverridesForMapping);
}

function resolveTemplateRefsForAddendumKind(options: {
    templateId?: string | null;
    templateName?: string | null;
    templateLayoutKey?: string | null;
}): AddendumKind | null {
    const norm = normalizeKey(options.templateName ?? "");
    const refs = [
        options.templateLayoutKey,
        options.templateId,
    ]
        .map((r) => String(r ?? "").trim())
        .filter(Boolean);
    for (const ref of refs) {
        const kind = resolveAddendumKind(norm, ref);
        if (kind) return kind;
    }
    if (norm.includes("flex")) return "katan_flex";
    return resolveAddendumKind(norm, options.templateId);
}

function tryAddendumPrefillFieldRowsForEditor(options: {
    templateId?: string | null;
    templateName?: string | null;
    templateLayoutKey?: string | null;
    documentType?: string | null;
    prefillDocumentKind?: "ach_form" | "addendum" | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    savedOverridesForMapping?: Record<string, string> | null;
    bankDetail?: Record<string, unknown> | null;
}): ContractPrefillField[] | null {
    const docType = String(options.documentType ?? "").toLowerCase();
    const isAddendumDoc =
        options.prefillDocumentKind === "addendum" || docType === "addendum";
    const addendum = resolveTemplateRefsForAddendumKind(options);
    if (!addendum && !isAddendumDoc) return null;
    if (!addendum) return [];

    const effectiveContract = buildEffectiveContractForTemplatePrefill({
        contract: options.contract ?? null,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
        mainPrefillOverrides: options.mainPrefillOverrides,
        bankDetail: options.bankDetail ?? null,
    });
    const sctx = buildStateDisclosurePrefillContextFromContract({
        contract: effectiveContract,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
    });
    const all = addendumAllDefs(addendum);
    const computed = addendumComputed(
        addendum,
        effectiveContract,
        sctx,
        options.application ?? null,
    );
    return mergeFieldRows(all, computed, options.savedOverridesForMapping);
}

/** Whether the addendum prefill editor has registered fields for this document layout. */
export function hasAddendumPrefillFieldMap(
    templateId?: string | null,
    templateName?: string | null,
    templateLayoutKey?: string | null,
): boolean {
    return (
        resolveTemplateRefsForAddendumKind({
            templateId: templateLayoutKey ?? templateId,
            templateName,
            templateLayoutKey,
        }) != null
    );
}

export function hasStateDisclosurePrefillFieldMap(
    templateName?: string | null,
    templateState?: string | null,
    templateFrequency?: string | null,
    fallbackState?: string | null,
    fallbackFrequency?: string | null,
): boolean {
    const { state, frequency } = resolveDisclosureStateAndFrequency({
        templateState,
        templateFrequency,
        fallbackState,
        fallbackFrequency,
    });
    return hasStateDisclosurePrefillRegistry(templateName, state, frequency);
}

/** Whether the template-mapping editor has registered fields (addendum or state disclosure). */
export function hasDocumentTemplatePrefillFieldMap(
    templateId?: string | null,
    templateName?: string | null,
    templateState?: string | null,
    templateFrequency?: string | null,
    fallbackState?: string | null,
    fallbackFrequency?: string | null,
): boolean {
    return (
        hasAddendumPrefillFieldMap(templateId, templateName) ||
        hasStateDisclosurePrefillFieldMap(
            templateName,
            templateState,
            templateFrequency,
            fallbackState,
            fallbackFrequency,
        )
    );
}

function addendumAllDefs(kind: AddendumKind): ContractPrefillField[] {
    switch (kind) {
        case "balance_transfer_sheet":
            return buildBalanceTransferSheetContractPrefillFields(dotBalanceTransfer());
        case "katan_buyout_blank":
            return buildKatanBuyoutBlankAddendumContractPrefillFields(dotKatanBuyout());
        case "katan_flex":
            return buildKatanFlexAddendumContractPrefillFields(dotKatanFlex());
        case "katan_ach_authorization":
            return buildKatanAchAuthorizationAddendumPrefillFields(dotKatanAch());
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
        case "katan_buyout_blank":
            return buildKatanBuyoutComputed(contract, sctx);
        case "katan_flex":
            return buildKatanFlexComputed(contract, sctx, application);
        case "katan_ach_authorization":
            return buildKatanAchComputed(contract, application);
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

/**
 * Rows for the template-mapping editor: every BoldSign field id for this template, labels from builders,
 * values from CRM-derived defaults merged with optional saved overrides for this mapping row.
 */
export function getDocumentTemplatePrefillFieldRowsForEditor(options: {
    templateId?: string | null;
    templateName?: string | null;
    templateLayoutKey?: string | null;
    templateState?: string | null;
    templateFrequency?: string | null;
    /** Contract / UI state when the template row has no `state` column set. */
    fallbackState?: string | null;
    /** Offer payment frequency when the template row has no `frequency` column set. */
    fallbackFrequency?: string | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    /** Main contract prefill overrides (excludes per-mapping blob); same source as Deal Review. */
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    savedOverridesForMapping?: Record<string, string> | null;
    bankDetail?: Record<string, unknown> | null;
    documentType?: string | null;
    prefillDocumentKind?: "ach_form" | "addendum" | null;
}): ContractPrefillField[] {
    if (isAchFormPrefillEditorContext(options)) {
        return getKatanAchAuthorizationPrefillFieldRowsForEditor(options);
    }

    const addendumRows = tryAddendumPrefillFieldRowsForEditor(options);
    if (addendumRows != null) return addendumRows;

    const effectiveContract = buildEffectiveContractForTemplatePrefill({
        contract: options.contract ?? null,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
        mainPrefillOverrides: options.mainPrefillOverrides,
        bankDetail: options.bankDetail ?? null,
    });

    const sctx = buildStateDisclosurePrefillContextFromContract({
        contract: effectiveContract,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
    });

    const name = options.templateName;
    const docType = String(options.documentType ?? "").toLowerCase();
    const isDisclosureDoc = docType === "disclosure";
    const { state, frequency } = resolveDisclosureStateAndFrequency({
        templateState: options.templateState,
        templateFrequency: options.templateFrequency,
        fallbackState: options.fallbackState,
        fallbackFrequency: options.fallbackFrequency,
        contract: effectiveContract,
    });

    if (isDisclosureDoc) {
        const stAll = stateDisclosureAllDefs(name, state, frequency);
        if (stAll.length > 0) {
            const computed = stateDisclosureComputed(name, state, frequency, sctx);
            const savedCollapsed = collapsePdfFieldsToDisclosureEditorValues(
                options.savedOverridesForMapping,
            );
            return applyPlatformDisclosureFunderName(
                mergeFieldRows(stAll, computed, savedCollapsed),
            );
        }
    }

    const fromEditor = getStateDisclosureEditorFieldDefinitions(name, state, frequency);
    if (fromEditor.length > 0) {
        const computed = stateDisclosureComputed(name, state, frequency, sctx);
        const savedCollapsed = collapsePdfFieldsToDisclosureEditorValues(
            options.savedOverridesForMapping,
        );
        return applyPlatformDisclosureFunderName(
            mergeFieldRows(fromEditor, computed, savedCollapsed),
        );
    }

    return [];
}

/** Ensures disclosure merchant + funder names are on the send payload when a CRM disclosure PDF is merged. */
export function mergeStateDisclosurePrefillFallback(args: {
    payload: Array<{ id: string; value: string }>;
    supplementalRefs: string[];
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    bankDetail?: Record<string, unknown> | null;
}): Array<{ id: string; value: string }> {
    const supplementalIds = (args.supplementalRefs || [])
        .map((x) => String(x).trim())
        .filter(Boolean);
    const hasCrmDisclosurePdf = supplementalIds.some((ref) => !isPlatformLayoutKey(ref));
    if (!hasCrmDisclosurePdf) return args.payload;

    const effectiveContract = buildEffectiveContractForTemplatePrefill({
        contract: args.contract ?? null,
        application: args.application ?? null,
        agreementDate: args.agreementDate,
        mainPrefillOverrides: args.mainPrefillOverrides,
        bankDetail: args.bankDetail ?? null,
    });

    const { state, frequency } = resolveDisclosureStateAndFrequency({
        fallbackState: str(effectiveContract.state),
        fallbackFrequency: str(
            (effectiveContract as Record<string, unknown>).disclosureFrequency ??
                (effectiveContract.offer as Record<string, unknown> | null | undefined)?.frequency,
        ),
        contract: effectiveContract,
    });
    if (!state || !frequency || !hasStateDisclosurePrefillRegistry(state, frequency)) {
        return args.payload;
    }

    const sctx = buildStateDisclosurePrefillContextFromContract({
        contract: effectiveContract,
        application: args.application ?? null,
        agreementDate: args.agreementDate,
    });
    const fields = getStateDisclosurePrefillFieldsByStateFrequency({
        state,
        frequency,
        context: sctx,
    });
    if (!fields.length) return args.payload;

    const byId = new Map(args.payload.map((f) => [f.id, { ...f }]));
    for (const field of fields) {
        const v = String(field.value ?? "").trim();
        if (!v) continue;
        const existing = byId.get(field.id);
        const existingNum = parsePrefillMoneyForMerge(existing?.value);
        // Never clobber calculator-applied amounts (e.g. total_dollar_cost) with contract-derived 0.00.
        if (existingNum !== undefined && existingNum > 0) continue;
        // Utah broker fee tab: keep explicit values including $0.00 (not origination fees).
        if (
            field.id === "appendix_underwriting_fees" &&
            existing !== undefined &&
            String(existing.value ?? "").trim() !== ""
        ) {
            continue;
        }
        byId.set(field.id, { id: field.id, value: v });
    }
    byId.set("funder_name", {
        id: "funder_name",
        value: PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
    });
    const merchant = String(
        byId.get("client_name")?.value ||
            byId.get("client_legal_name")?.value ||
            sctx.recipientName ||
            "",
    ).trim();
    if (merchant) {
        byId.set("client_name", { id: "client_name", value: merchant });
    }
    return Array.from(byId.values());
}

type DisclosureMappingRow = {
    id: string;
    documentType?: string | null;
    template?: {
        id?: string;
        templateId?: string;
        layoutKey?: string | null;
        name?: string | null;
        state?: string | null;
        frequency?: string | null;
    } | null;
};

/** Expand one linked disclosure mapping row → PDF tab ids (e.g. `total_dollar_cost`). */
export function buildExpandedDisclosurePrefillFieldsForMapping(args: {
    mappingRow: DisclosureMappingRow | null | undefined;
    savedOverridesForMapping?: Record<string, string> | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    bankDetail?: Record<string, unknown> | null;
}): Array<{ id: string; value: string }> {
    const row = args.mappingRow;
    if (!row || String(row.documentType || "").toLowerCase() !== "disclosure") {
        return [];
    }

    const templateId = String(row.template?.id ?? "").trim();
    const tid = String(row.template?.templateId ?? "").trim();
    const layoutKey = String(row.template?.layoutKey ?? "").trim();

    const computedRows = getDocumentTemplatePrefillFieldRowsForEditor({
        templateId: templateId || tid || layoutKey,
        templateName: row.template?.name ?? null,
        templateState: row.template?.state ?? null,
        templateFrequency: row.template?.frequency ?? null,
        contract: args.contract ?? null,
        application: args.application ?? null,
        agreementDate: args.agreementDate,
        mainPrefillOverrides: args.mainPrefillOverrides,
        savedOverridesForMapping: args.savedOverridesForMapping ?? null,
        bankDetail: args.bankDetail ?? null,
    });

    const editorValues: Record<string, string> = {};
    for (const field of computedRows) {
        const v =
            field.id === "funder_name"
                ? PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase()
                : String(field.value ?? "").trim();
        if (!v) continue;
        editorValues[field.id] = v;
    }

    const expanded = expandDisclosureEditorValuesToPdfFields(editorValues);

    const templateState = String(row.template?.state ?? "").trim();
    if (isUtahDisclosureState(templateState)) {
        const raw = args.savedOverridesForMapping ?? {};
        const brokerFee = String(
            raw.disclosure_broker_fee ?? expanded.appendix_underwriting_fees ?? "",
        ).trim();
        if (brokerFee) {
            expanded.appendix_underwriting_fees = brokerFee;
        }
        const utahPdfKeys = [
            "purchase_amount",
            "net_to_merchant",
            "purchase_price",
            "finance_charge",
            "remittance",
            "monthly_income",
            "frequency",
        ] as const;
        for (const key of utahPdfKeys) {
            const fromRaw = String(raw[key] ?? "").trim();
            if (fromRaw) expanded[key] = fromRaw;
        }
    }

    return Object.entries(expanded)
        .map(([id, value]) => ({ id, value: String(value ?? "").trim() }))
        .filter((f) => f.id && f.value);
}

/** Merge expanded disclosure PDF fields into a DocuSign prefill payload (by field id). */
export function mergeExpandedDisclosurePrefillIntoPayload(
    payload: Array<{ id: string; value: string }>,
    disclosureFields: Array<{ id: string; value: string }>,
): Array<{ id: string; value: string }> {
    if (!disclosureFields.length) return payload;
    const byId = new Map(payload.map((f) => [f.id, { ...f }]));
    for (const field of disclosureFields) {
        const v = String(field.value ?? "").trim();
        if (!v) continue;
        const existing = byId.get(field.id);
        const existingNum = parsePrefillMoneyForMerge(existing?.value);
        const incomingNum = parsePrefillMoneyForMerge(v);
        if (
            existingNum !== undefined &&
            existingNum > 0 &&
            incomingNum !== undefined &&
            incomingNum === 0
        ) {
            continue;
        }
        byId.set(field.id, { id: field.id, value: v });
    }
    return Array.from(byId.values());
}

export function applyDocumentTemplateMappingPrefillOverrides(args: {
    prefillFieldsPayload: Array<{ id: string; value: string }>;
    mergedTemplateIds: string[];
    mergedLayoutKeys?: string[];
    templateMappingRows: Array<{
        id: string;
        documentType?: string | null;
        template?: {
            id?: string;
            templateId?: string;
            layoutKey?: string | null;
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
    bankDetail?: Record<string, unknown> | null;
}): Array<{ id: string; value: string }> {
    const blob = parseDocumentTemplatePrefillByMappingId(args.contractPrefillOverridesRaw);
    const mergedSet = new Set([
        ...args.mergedTemplateIds.map((x) => String(x).trim()).filter(Boolean),
        ...(args.mergedLayoutKeys || []).map((x) => String(x).trim()).filter(Boolean),
    ]);
    if (mergedSet.has(DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE)) {
        mergedSet.add(DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION);
    }
    const byId = new Map(args.prefillFieldsPayload.map((f) => [f.id, { ...f }]));

    for (const row of args.templateMappingRows) {
        const layoutKey = String(row.template?.layoutKey ?? "").trim();
        const tid = String(row.template?.templateId ?? "").trim();
        const templateId = String(row.template?.id ?? "").trim();
        const included =
            (layoutKey && mergedSet.has(layoutKey)) ||
            (tid && mergedSet.has(tid)) ||
            (templateId && mergedSet.has(templateId));
        if (!included) continue;
        const perMap = blob[row.id];
        const computedRows = getDocumentTemplatePrefillFieldRowsForEditor({
            templateId: templateId || tid || layoutKey,
            templateName: row.template?.name ?? null,
            templateState: row.template?.state ?? null,
            templateFrequency: row.template?.frequency ?? null,
            contract: args.contract ?? null,
            application: args.application ?? null,
            agreementDate: args.agreementDate,
            mainPrefillOverrides: args.mainPrefillOverrides,
            savedOverridesForMapping: perMap ?? null,
            bankDetail: args.bankDetail ?? null,
        });
        const isDisclosureRow =
            String(row.documentType || "").toLowerCase() === "disclosure";
        const editorValues: Record<string, string> = {};
        for (const field of computedRows) {
            const v =
                field.id === "funder_name"
                    ? PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase()
                    : String(field.value ?? "").trim();
            if (!v) continue;
            editorValues[field.id] = v;
        }
        const fieldsToMerge = isDisclosureRow
            ? expandDisclosureEditorValuesToPdfFields(editorValues)
            : editorValues;
        for (const [id, value] of Object.entries(fieldsToMerge)) {
            const v = String(value ?? "").trim();
            if (!v) continue;
            byId.set(id, { id, value: v });
        }
    }

    const disclosureMerged = args.templateMappingRows.some((row) => {
        const templateId = String(row.template?.id ?? "").trim();
        return (
            String(row.documentType || "").toLowerCase() === "disclosure" &&
            Boolean(templateId && mergedSet.has(templateId))
        );
    });
    if (disclosureMerged) {
        byId.set("funder_name", {
            id: "funder_name",
            value: PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        });
        const merchant = String(
            byId.get("client_name")?.value ||
                byId.get("client_legal_name")?.value ||
                byId.get("business_legal_name")?.value ||
                "",
        ).trim();
        if (merchant) {
            byId.set("client_name", { id: "client_name", value: merchant });
        }
    }

    return Array.from(byId.values());
}
