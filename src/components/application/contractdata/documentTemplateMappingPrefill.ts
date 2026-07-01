import type { BuildContractPrefillFieldsArgs, ContractPrefillField } from "./Contract";
import {
    getApplicationPrimaryRecipientName,
    getContractPrefillEditDefaultsFromApplication,
    resolveAchAccountHolderNamePrefill,
    resolveBalanceTransferMerchantContext,
    resolveDisclosureBusinessNamePrefill,
    resolveDisclosureOwnerNamePrefill,
    resolveNumberOfPaymentsPrefillValue,
    resolveOfferAmountDollarsForUnderwritingFees,
    resolvePaybackAmountDollars,
    resolvePersonalClientNamePrefill,
    resolveRemittancePrefillValue,
} from "./Contract";
import {
    buildBalanceTransferSheetContractPrefillFields,
    BALANCE_TRANSFER_SHEET_TAB_LABEL_BY_KEY,
    type BalanceTransferSheetContractPrefillFields,
} from "./BALANCE_TRANSFER_SHEET_ADDENDUM";
import {
    buildKatanBuyoutBlankAddendumContractPrefillFields,
    type KatanBuyoutBlankAddendumContractPrefillFields,
} from "./KATAN_BUYOUT_BLANK_ADDENDUM";
import {
    buildKatanFlexAddendumContractPrefillFields,
    formatFlexAddendumMoneyDisplay,
    FLEX_ADDENDUM_MONEY_TAB_IDS,
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
import {
    buildCaliforniaDisclosurePage3Amounts,
    isCaliforniaDisclosureState,
} from "./california_disclosure";
import { isUtahDisclosureState } from "./daily_utah";
import {
    isNewYorkDisclosureState,
    resolveNewYorkPage1LineAmount,
    resolveNewYorkPage3LineAmount,
} from "./new_york_disclosure";

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

function readPrefillMapValue(
    byId: Map<string, { id: string; value: string }>,
    id: string,
): string {
    return str(byId.get(id)?.value);
}

function resolvePersonalClientNameFromPrefillMap(
    byId: Map<string, { id: string; value: string }>,
): string {
    return (
        readPrefillMapValue(byId, "customer_name") ||
        readPrefillMapValue(byId, "owner1_guarantor_name") ||
        readPrefillMapValue(byId, "guaranty_owner1_name") ||
        readPrefillMapValue(byId, "guaranty_guarantor1_name") ||
        readPrefillMapValue(byId, "guaranty_client_name") ||
        ""
    );
}

/** Business / legal merchant name for state disclosure tabs (not owner personal name). */
function resolveDisclosureBusinessNameFromPrefillMap(
    byId: Map<string, { id: string; value: string }>,
    contract?: Record<string, unknown> | null,
    application?: Record<string, unknown> | null,
): string {
    return (
        resolveDisclosureBusinessNamePrefill(contract, application) ||
        readPrefillMapValue(byId, "disclosure_merchant_name") ||
        readPrefillMapValue(byId, "client_legal_name") ||
        readPrefillMapValue(byId, "business_legal_name") ||
        readPrefillMapValue(byId, "merchant_legal_name") ||
        readPrefillMapValue(byId, "legal_name") ||
        readPrefillMapValue(byId, "recipient_name") ||
        readPrefillMapValue(byId, "disclosure_name") ||
        ""
    );
}

function applyDisclosureMerchantNameFields(
    byId: Map<string, { id: string; value: string }>,
    businessName: string,
): void {
    const name = String(businessName ?? "").trim();
    if (!name) return;
    for (const id of [
        "recipient_name",
        "recipient_name2",
        "disclosure_name",
        "disclosure_merchant_name",
    ] as const) {
        byId.set(id, { id, value: name });
    }
}

function shouldSkipClientNamePrefillOverwrite(
    byId: Map<string, { id: string; value: string }>,
    nextValue: string,
): boolean {
    const next = str(nextValue);
    if (!next) return true;
    const existing = readPrefillMapValue(byId, "client_name");
    const legal =
        readPrefillMapValue(byId, "client_legal_name") ||
        readPrefillMapValue(byId, "business_legal_name");
    if (!existing || !legal) return false;
    return existing !== legal && next === legal;
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
    offerDecision?: Record<string, unknown> | null;
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
    const formatValue = (id: string, value: string) =>
        FLEX_ADDENDUM_MONEY_TAB_IDS.has(id) ? formatFlexAddendumMoneyDisplay(value) : value;
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
                return { id: def.id, label: def.label, value: formatValue(def.id, computedVal) };
            }
            return { id: def.id, label: def.label, value: formatValue(def.id, fromSavedTrim) };
        }
        return {
            id: def.id,
            label: def.label,
            value: formatValue(def.id, computedVal),
        };
    });
}

/** Legacy balance-transfer saves used `client_legal_name` (same id as contract page 1). */
function normalizeBalanceTransferSavedOverrides(
    savedForRow: Record<string, string> | null | undefined,
): Record<string, string> {
    const saved = { ...(savedForRow ?? {}) };
    const btKey = BALANCE_TRANSFER_SHEET_TAB_LABEL_BY_KEY.clientLegalName;
    const legacy = str(saved.client_legal_name);
    const businessLegal = str(saved.business_legal_name);
    if (!str(saved[btKey]) && legacy) {
        if (!businessLegal || legacy.toLowerCase() !== businessLegal.toLowerCase()) {
            saved[btKey] = legacy;
        }
    }
    delete saved.client_legal_name;
    return saved;
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
        dateOfNewSecuredAgreement: DUMMY,
        dateOfPreviousSecuredAgreement: DUMMY,
        remainingRtrBalance: DUMMY,
        merchantLegalName: DUMMY,
        businessLegalName: DUMMY,
        dba: DUMMY,
        clientNameBy: DUMMY,
        clientLegalName: DUMMY,
        businessAddress: DUMMY,
        businessAddressCity: DUMMY,
        businessAddressState: DUMMY,
        businessAddressZip: DUMMY,
    };
}

function formatBalanceTransferLetterDate(value: unknown): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(raw)) return raw;
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return raw.replace(/\//g, "-");
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const y = raw.slice(0, 4);
        const m = raw.slice(5, 7);
        const d = raw.slice(8, 10);
        return `${m}-${d}-${y}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    const y = String(parsed.getFullYear());
    return `${m}-${d}-${y}`;
}

function formatBalanceTransferMoney(value: unknown): string {
    const n = Number(String(value ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n)) return String(value ?? "").trim();
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n);
}

function resolveRefinanceAmountDollars(
    contract: Record<string, unknown> | null,
    application: Record<string, unknown> | null,
): number | null {
    const c = contract ?? {};
    const offer = (c.offer ?? null) as Record<string, unknown> | null;
    const odRoot = application?.offerDecision as Record<string, unknown> | undefined;
    const candidates = [
        offer?.refinanceAmount,
        offer?.RefinanceAmount,
        odRoot?.refinanceAmount,
        odRoot?.RefinanceAmount,
        c.refinanceAmount,
        c.RefinanceAmount,
    ];
    for (const raw of candidates) {
        const n = Number(String(raw ?? "").replace(/[$,\s]/g, ""));
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}

function buildBalanceTransferComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
    application: Record<string, unknown> | null,
): ContractPrefillField[] {
    const c = contract ?? {};
    const merchant = resolveBalanceTransferMerchantContext(contract, application, {
        recipientName: sctx.ownerName,
        recipientAddress: sctx.recipientAddress,
    });
    const refinanceAmount = resolveRefinanceAmountDollars(c, application);
    const agreementDate =
        formatBalanceTransferLetterDate(sctx.signatureDate) ||
        formatBalanceTransferLetterDate(str(c.agreement_date)) ||
        formatBalanceTransferLetterDate(str(c.agreementDate));
    const remainingRtr =
        str(c.remainingRtrBalance) ||
        str(c.remaining_rtr_balance) ||
        str(c.remainingRtr) ||
        (refinanceAmount != null ? formatBalanceTransferMoney(refinanceAmount) : "");
    return buildBalanceTransferSheetContractPrefillFields({
        dateOfNewSecuredAgreement: agreementDate,
        dateOfPreviousSecuredAgreement: agreementDate,
        remainingRtrBalance: remainingRtr,
        merchantLegalName: merchant.clientLegalName,
        businessLegalName: merchant.businessName,
        dba: merchant.clientDba,
        clientNameBy: merchant.clientNameBy,
        clientLegalName: merchant.clientLegalName,
        businessAddress: str(c.businessAddress) || merchant.physicalAddress,
        businessAddressCity: str(c.businessAddressCity),
        businessAddressState: str(c.businessAddressState),
        businessAddressZip: str(c.businessAddressZip),
    });
}

function buildKatanBuyoutComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
): ContractPrefillField[] {
    const c = contract ?? {};
    const ownerName = sctx.ownerName || "";
    return buildKatanBuyoutBlankAddendumContractPrefillFields({
        addendumEnteredDate: sctx.signatureDate,
        addendumAgreementDate: sctx.signatureDate,
        clientName: ownerName,
        agreeName: ownerName,
        advanceRemit: sctx.estimatedPayment,
        agreementTo: str(c.authorizationApplication),
        amountOfDirecltyDisbursed: sctx.fundingDisbursed,
        transferFundTo: "",
        nameOfBank: str(c.authorizationClientBankName),
        abaRouting: str(c.authorizationClientBankRouting),
        checkingAccount: str(c.authorizationClientBankAccount),
        transferAmount: sctx.totalRepayment,
        ownerName,
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
    const legal = str(c.legalName) || str(c.clientLegalName) || "";
    const primaryRecipient = getApplicationPrimaryRecipientName(app);
    const clientName =
        resolvePersonalClientNamePrefill(
            {
                ...c,
                customerName:
                    str(c.customerName) ||
                    str(c.owner1GuarantorName) ||
                    primaryRecipient,
                legalName: legal,
            },
            "clientName",
        ) ||
        primaryRecipient ||
        "";
    const agreementDate =
        str(c.agreement_date) ||
        sctx.signatureDate ||
        str(c.agreementDate) ||
        "";
    const addendumDate = str(c.addendum_date) || agreementDate;
    const legacyDailyPayment =
        str(c.daily_payment) ||
        str(c.remittance) ||
        resolveRemittancePrefillValue({ application: app ?? undefined, contract, offerDecision });
    const offerAmountNum = resolveOfferAmountDollarsForUnderwritingFees({
        contract,
        application: app ?? undefined,
        offerDecision,
    });
    const offerAmountStr =
        offerAmountNum !== undefined && offerAmountNum > 0
            ? formatFlexAddendumMoneyDisplay(String(offerAmountNum))
            : str(offerDecision?.offer) || str(c.approvedAmount) || "";
    const dailyPayment1 =
        str(c.daily_payment_1) ||
        str(c.dailyPayment1) ||
        legacyDailyPayment;
    const receivablePurchase1 =
        str(c.receivable_purchase_1) ||
        str(c.receivablePurchase1) ||
        str(c.receivable_purchase) ||
        str(c.receivablePurchase) ||
        offerAmountStr;
    const dailyPayment2 =
        str(c.daily_payment_2) || str(c.dailyPayment2) || dailyPayment1;
    const receivablePurchase2 =
        str(c.receivable_purchase_2) ||
        str(c.receivablePurchase2) ||
        receivablePurchase1;
    return buildKatanFlexAddendumContractPrefillFields({
        addendumDate,
        agreementDate,
        merchantName: legal,
        clientName,
        dailyPayment1,
        receivablePurchase1,
        dailyPayment2,
        receivablePurchase2,
    });
}

function dotKatanFlex(): KatanFlexAddendumContractPrefillFields {
    return {
        addendumDate: DUMMY,
        agreementDate: DUMMY,
        merchantName: DUMMY,
        clientName: DUMMY,
        installmentDay1: "1",
        installmentDay2: "16",
        dailyPayment1: DUMMY,
        receivablePurchase1: DUMMY,
        dailyPayment2: DUMMY,
        receivablePurchase2: DUMMY,
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
    const transactionFee = offerDecision
        ? resolveRemittancePrefillValue(sources)
        : str(c.achAuthorizationAccountHolderBankTransactionFee) ||
          resolveRemittancePrefillValue(sources);
    const numberOfTransactions = offerDecision
        ? resolveNumberOfPaymentsPrefillValue(sources)
        : str(c.achAuthorizationAccountHolderBankNumberOfTransactions) ||
          resolveNumberOfPaymentsPrefillValue(sources);
    const achOwnerName =
        resolveDisclosureOwnerNamePrefill(c, application) ||
        resolveAchAccountHolderNamePrefill(c, "achAuthorizationAccountHolderName");
    return buildKatanAchAuthorizationAddendumPrefillFields({
        authorizationClientName: str(c.authorizationClientName),
        authorizationClientBankName: str(c.authorizationClientBankName),
        authorizationClientBankRouting: str(c.authorizationClientBankRouting),
        authorizationClientBankAccount: str(c.authorizationClientBankAccount),
        authorizationClientNamePrint: str(c.authorizationClientNamePrint),
        authorizationClientTaxId: str(c.authorizationClientTaxId),
        authorizedBusinessPhone: str(c.authorizedBusinessPhone),
        achAuthorizationAccountHolderName: achOwnerName,
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
        achAuthorizationConcentAccountHolderName:
            achOwnerName ||
            resolveAchAccountHolderNamePrefill(c, "achAuthorizationConcentAccountHolderName"),
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
    const paybackNum = resolvePaybackAmountDollars({ contract: c, offerDecision: offer });
    const total = paybackNum ?? Number(c.purchasePrice ?? offer?.paybackAmount);
    if (Number.isFinite(total)) {
        p60 = payFmt(total * (60 / 100));
        p90 = payFmt(total * (90 / 100));
        p120 = payFmt(total * (120 / 100));
    }
    return buildDiscoverAdvanceEpoAddendumContractPrefillFields({
        loanAgreementDated: sctx.signatureDate,
        borrowerName: sctx.ownerName,
        payingToDiscoverAgent60: p60,
        payingToDiscoverAgent90: p90,
        payingToDiscoverAgent120: p120,
        printBorrowerName1: str(c.clientName) || sctx.ownerName,
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
        borrowerName: sctx.ownerName,
        borrowerPay: sctx.estimatedPayment,
        financialDate: sctx.signatureDate,
        previousFinancingDirectlyTo: "",
        borrowerName1: str(c.clientName) || sctx.ownerName,
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
    offerDecision?: Record<string, unknown> | null;
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
        offerDecision: options.offerDecision ?? null,
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
    offerDecision?: Record<string, unknown> | null;
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
        offerDecision: options.offerDecision ?? null,
        agreementDate: options.agreementDate,
    });
    const all = addendumAllDefs(addendum);
    const computed = addendumComputed(
        addendum,
        effectiveContract,
        sctx,
        options.application ?? null,
    );
    const savedOverrides =
        addendum === "balance_transfer_sheet"
            ? normalizeBalanceTransferSavedOverrides(options.savedOverridesForMapping)
            : options.savedOverridesForMapping;
    return mergeFieldRows(all, computed, savedOverrides);
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
    offerDecision?: Record<string, unknown> | null;
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
        offerDecision: options.offerDecision ?? null,
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
    offerDecision?: Record<string, unknown> | null;
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
            args.offerDecision?.frequency ??
                (effectiveContract as Record<string, unknown>).disclosureFrequency ??
                (effectiveContract.offer as Record<string, unknown> | null | undefined)
                    ?.frequency,
        ),
        contract: effectiveContract,
    });
    if (!state || !frequency || !hasStateDisclosurePrefillRegistry(state, frequency)) {
        return args.payload;
    }

    const sctx = buildStateDisclosurePrefillContextFromContract({
        contract: effectiveContract,
        application: args.application ?? null,
        offerDecision: args.offerDecision ?? null,
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
    const businessName = String(
        sctx.recipientName ||
            resolveDisclosureBusinessNameFromPrefillMap(
                byId,
                effectiveContract,
                args.application ?? null,
            ) ||
            "",
    ).trim();
    applyDisclosureMerchantNameFields(byId, businessName);
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

/** Post-process expanded disclosure PDF fields for CA/NY page-3 math and term days. */
function applyCaliforniaNewYorkDisclosureExpandedOverrides(args: {
    templateState: string;
    expanded: Record<string, string>;
    raw: Record<string, string>;
}): void {
    const { expanded, raw } = args;
    const templateState = String(args.templateState ?? "").trim();

    if (isCaliforniaDisclosureState(templateState)) {
        const recipientFunds = String(
            raw.disclosure_recipient_funds ?? expanded.disclosure_recipient_funds ?? "",
        ).trim();
        const brokerFee = String(
            raw.disclosure_broker_fee ?? expanded.disclosure_broker_fee ?? "0.00",
        ).trim();
        const fundingProvided = String(
            raw.disclosure_amount_financed ??
                expanded.funding_provided ??
                expanded.disclosure_amount_financed ??
                "",
        ).trim();
        const page3Line1 = resolveNewYorkPage3LineAmount(
            raw.disclosure_page3_line_1 ?? expanded.disclosure_page3_line_1,
        );
        const page3Line2 = resolveNewYorkPage3LineAmount(
            raw.disclosure_page3_line_2 ?? expanded.disclosure_page3_line_2,
        );
        const page3 = buildCaliforniaDisclosurePage3Amounts({
            recipientFunds,
            page3Line1,
            page3Line2,
            brokerFee,
            fundingProvided,
        });
        if (recipientFunds) expanded.disclosure_recipient_funds = recipientFunds;
        expanded.disclosure_broker_fee = brokerFee || "0.00";
        expanded.disclosure_page3_line_1 = page3Line1;
        expanded.disclosure_page3_line_2 = page3Line2;
        expanded.disclosure_page3_subtotal = page3.page3Subtotal;
        expanded.disclosure_page3_net = page3.page3Net;
        const paymentTotal = String(
            raw.disclosure_total_payment ?? expanded.disclosure_total_payment ?? "",
        ).trim();
        if (paymentTotal) expanded.payment_total = paymentTotal;
        const monthlyCost = String(
            raw.disclosure_monthly_cost ?? expanded.disclosure_monthly_cost ?? "",
        ).trim();
        if (monthlyCost) expanded.estimated_monthly_cost = monthlyCost;
        const termDays = String(
            raw.disclosure_term_days ?? expanded.disclosure_term_days ?? "",
        ).trim();
        if (termDays) {
            expanded.disclosure_term_days = termDays;
            expanded.estimated_term = termDays;
        }
        const estimatedPayment = String(
            raw.disclosure_estimated_payment ?? expanded.estimated_payment ?? "",
        ).trim();
        if (estimatedPayment) expanded.estimated_payment = estimatedPayment;
    }

    if (isNewYorkDisclosureState(templateState)) {
        expanded.disclosure_page1_line_1 = resolveNewYorkPage1LineAmount(
            raw.disclosure_page1_line_1 ?? expanded.disclosure_page1_line_1,
        );
        const recipientFunds = String(
            raw.disclosure_recipient_funds ?? expanded.disclosure_recipient_funds ?? "",
        ).trim();
        const brokerFee = String(
            raw.disclosure_broker_fee ?? expanded.disclosure_broker_fee ?? "0.00",
        ).trim();
        const fundingProvided = String(
            raw.disclosure_amount_financed ??
                expanded.funding_provided ??
                expanded.disclosure_amount_financed ??
                "",
        ).trim();
        const page3Line1 = resolveNewYorkPage3LineAmount(
            raw.disclosure_page3_line_1 ?? expanded.disclosure_page3_line_1,
        );
        const page3Line2 = resolveNewYorkPage3LineAmount(
            raw.disclosure_page3_line_2 ?? expanded.disclosure_page3_line_2,
        );
        const page3 = buildCaliforniaDisclosurePage3Amounts({
            recipientFunds,
            page3Line1,
            page3Line2,
            brokerFee,
            fundingProvided,
        });
        expanded.disclosure_page3_line_1 = page3Line1;
        expanded.disclosure_page3_line_2 = page3Line2;
        if (recipientFunds) expanded.disclosure_recipient_funds = recipientFunds;
        expanded.disclosure_broker_fee = brokerFee || "0.00";
        expanded.disclosure_page3_subtotal = page3.page3Subtotal;
        expanded.disclosure_page3_net = page3.page3Net;
        const termDays = String(
            raw.disclosure_term_days ?? expanded.disclosure_term_days ?? "",
        ).trim();
        if (termDays) {
            expanded.disclosure_term_days = termDays;
            expanded.estimated_term = termDays;
        }
        const estimatedPayment = String(
            raw.disclosure_estimated_payment ?? expanded.estimated_payment ?? "",
        ).trim();
        if (estimatedPayment) expanded.estimated_payment = estimatedPayment;
        const avgMonthlyRevenue = String(
            raw.disclosure_avg_monthly_revenue ??
                expanded.disclosure_avg_monthly_revenue ??
                expanded.avarage_monthly_income ??
                "",
        ).trim();
        if (avgMonthlyRevenue) {
            expanded.disclosure_avg_monthly_revenue = avgMonthlyRevenue;
            expanded.avarage_monthly_income = avgMonthlyRevenue;
        }
        const monthlyCost = String(
            raw.disclosure_monthly_cost ?? expanded.disclosure_monthly_cost ?? "",
        ).trim();
        if (monthlyCost) expanded.estimated_monthly_cost = monthlyCost;
        const paymentTotal = String(
            raw.disclosure_total_payment ?? expanded.disclosure_total_payment ?? "",
        ).trim();
        if (paymentTotal) expanded.payment_total = paymentTotal;
    }
}

/** Expand one linked disclosure mapping row → PDF tab ids (e.g. `total_dollar_cost`). */
export function buildExpandedDisclosurePrefillFieldsForMapping(args: {
    mappingRow: DisclosureMappingRow | null | undefined;
    savedOverridesForMapping?: Record<string, string> | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    offerDecision?: Record<string, unknown> | null;
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
        offerDecision: args.offerDecision ?? null,
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
    const raw = args.savedOverridesForMapping ?? {};
    if (isUtahDisclosureState(templateState)) {
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

    applyCaliforniaNewYorkDisclosureExpandedOverrides({
        templateState,
        expanded,
        raw,
    });

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
        // Contract page 1 offer amount must stay gross advance — never overwrite from disclosure net fields.
        if (field.id === "purchase_amount") continue;
        const existing = byId.get(field.id);
        const existingNum = parsePrefillMoneyForMerge(existing?.value);
        const incomingNum = parsePrefillMoneyForMerge(v);
        // Main contract origination fee — never replace with disclosure broker fee defaults (0.00).
        if (field.id === "appendix_underwriting_fees" && incomingNum === 0) {
            continue;
        }
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
    offerDecision?: Record<string, unknown> | null;
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
            offerDecision: args.offerDecision ?? null,
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
            ? (() => {
                  const expanded = expandDisclosureEditorValuesToPdfFields(editorValues);
                  applyCaliforniaNewYorkDisclosureExpandedOverrides({
                      templateState: String(row.template?.state ?? "").trim(),
                      expanded,
                      raw: (perMap ?? {}) as Record<string, string>,
                  });
                  return expanded;
              })()
            : editorValues;
        const addendumKind = resolveTemplateRefsForAddendumKind({
            templateId: templateId || tid || layoutKey,
            templateName: row.template?.name ?? null,
            templateLayoutKey: layoutKey || null,
        });
        const normalizedAddendumFields =
            addendumKind === "balance_transfer_sheet"
                ? normalizeBalanceTransferSavedOverrides(fieldsToMerge)
                : fieldsToMerge;
        for (const [id, value] of Object.entries(normalizedAddendumFields)) {
            const v = String(value ?? "").trim();
            if (!v) continue;
            if (id === "client_legal_name") continue;
            if (
                id === "balance_transfer_client_legal_name" &&
                v === readPrefillMapValue(byId, "client_legal_name")
            ) {
                continue;
            }
            if (id === "client_name" && shouldSkipClientNamePrefillOverwrite(byId, v)) continue;
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
        const businessName = String(
            resolveDisclosureBusinessNameFromPrefillMap(
                byId,
                args.contract ?? null,
                args.application ?? null,
            ) ||
                readPrefillMapValue(byId, "recipient_name") ||
                readPrefillMapValue(byId, "disclosure_merchant_name") ||
                "",
        ).trim();
        applyDisclosureMerchantNameFields(byId, businessName);
    }

    if (!disclosureMerged) {
        const personalClientName = resolvePersonalClientNameFromPrefillMap(byId);
        const legalClientName =
            readPrefillMapValue(byId, "client_legal_name") ||
            readPrefillMapValue(byId, "business_legal_name");
        const currentClientName = readPrefillMapValue(byId, "client_name");
        if (
            personalClientName &&
            legalClientName &&
            currentClientName &&
            currentClientName === legalClientName
        ) {
            byId.set("client_name", { id: "client_name", value: personalClientName });
        }
    }

    return Array.from(byId.values());
}
