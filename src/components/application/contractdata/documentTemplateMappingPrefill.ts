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
import { isPlatformLayoutKey, PLATFORM_DISCLOSURE_FUNDER_NAME } from "./platformDocumentConfig";
import { CONTRACT_SIGNER_OVERRIDES_KEY } from "./templateRecipients";

function resolveMainContractPersonNameFromPrefill(
    byId: Map<string, { id: string; value: string }>,
): string {
    const personKeys = [
        "owner1_guarantor_name",
        "guaranty_owner1_name",
        "guaranty_guarantor1_name",
        "guaranty_client_name",
        "security_guarantor",
        "client_name",
    ];
    for (const key of personKeys) {
        const value = String(byId.get(key)?.value || "").trim();
        if (value) return value;
    }
    return "";
}

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

const ACH_DRAFT_LIKE_STATUSES = new Set(["", "draft", "created"]);

export function isAchEnvelopeDraftLikeStatus(status?: string | null): boolean {
    return ACH_DRAFT_LIKE_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export function isAchEnvelopeSigningFinished(status?: string | null): boolean {
    const s = String(status ?? "").trim().toLowerCase();
    return ["completed", "signed", "declined", "revoked", "expired", "voided"].includes(s);
}

/** True when CC PDF was already sent (or envelope is past the first-send step). */
export function isAchEnvelopePastCcSendStep(status?: string | null): boolean {
    const s = String(status ?? "").trim().toLowerCase();
    return ["sent", "delivered", "viewed", "signed", "completed"].includes(s);
}

/**
 * ACH UI status: "Draft" only before the first send. On resend, while the new envelope
 * is still unsent in DocuSign, show the last known status from send history.
 */
export function resolveAchEnvelopeDisplayStatus(
    meta: DocumentTemplateEnvelopeMeta | null | undefined,
    sendHistory: DocumentSendHistoryEntry[] = [],
): string {
    const envelopeId = String(meta?.envelopeId ?? "").trim();
    const raw = String(meta?.status ?? "").trim();
    const achHistory = sendHistory.filter((h) => h.documentKind === "ach");
    const latestNonDraft = (rows: DocumentSendHistoryEntry[]) =>
        [...rows]
            .filter((h) => h.status && !isAchEnvelopeDraftLikeStatus(h.status))
            .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

    if (!envelopeId) {
        const latest = latestNonDraft(achHistory);
        if (latest.length > 0) return String(latest[0].status).trim();
        return "draft";
    }

    if (!isAchEnvelopeDraftLikeStatus(raw)) return raw;

    const selfHistory = latestNonDraft(achHistory.filter((h) => h.envelopeId === envelopeId));
    if (selfHistory.length > 0) return String(selfHistory[0].status).trim();

    const priorOther = latestNonDraft(achHistory.filter((h) => h.envelopeId !== envelopeId));
    if (priorOther.length > 0) return String(priorOther[0].status).trim();

    return raw || "draft";
}

/** DocuSign envelope id to load in the PDF pane (may differ from current when resend is in progress). */
export function resolveAchPdfEnvelopeId(
    meta: DocumentTemplateEnvelopeMeta | null | undefined,
    sendHistory: DocumentSendHistoryEntry[] = [],
    options?: { preferSigned?: boolean },
): string {
    const envelopeId = String(meta?.envelopeId ?? "").trim();
    const raw = String(meta?.status ?? "").trim();
    const achHistory = sendHistory.filter((h) => h.documentKind === "ach");
    const latestRows = (
        rows: DocumentSendHistoryEntry[],
        predicate: (h: DocumentSendHistoryEntry) => boolean,
    ) =>
        [...rows]
            .filter((h) => h.envelopeId && predicate(h))
            .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

    if (options?.preferSigned) {
        if (isAchEnvelopeSigningFinished(raw) && envelopeId) return envelopeId;
        const signedRows = latestRows(achHistory, (h) =>
            isAchEnvelopeSigningFinished(h.status),
        );
        if (signedRows.length > 0) return String(signedRows[0].envelopeId).trim();
    }

    const latestNonDraft = (rows: DocumentSendHistoryEntry[]) =>
        latestRows(rows, (h) => Boolean(h.status && !isAchEnvelopeDraftLikeStatus(h.status)));

    if (!envelopeId) {
        const latest = latestNonDraft(achHistory);
        return latest.length > 0 ? String(latest[0].envelopeId).trim() : "";
    }

    if (!isAchEnvelopeDraftLikeStatus(raw)) return envelopeId;

    const selfHistory = latestNonDraft(achHistory.filter((h) => h.envelopeId === envelopeId));
    if (selfHistory.length > 0) return envelopeId;

    const priorOther = latestNonDraft(achHistory.filter((h) => h.envelopeId !== envelopeId));
    if (priorOther.length > 0) return String(priorOther[0].envelopeId).trim();

    return envelopeId;
}

/** True when the ACH form has never been sent (initial draft only). */
export function isInitialAchDraft(
    meta: DocumentTemplateEnvelopeMeta | null | undefined,
    sendHistory: DocumentSendHistoryEntry[] = [],
): boolean {
    const raw = String(meta?.status ?? "").trim();
    const hasAnySentAch = sendHistory.some(
        (h) => h.documentKind === "ach" && h.status && !isAchEnvelopeDraftLikeStatus(h.status),
    );
    if (hasAnySentAch) return false;
    const envelopeId = String(meta?.envelopeId ?? "").trim();
    if (!envelopeId) return true;
    return isAchEnvelopeDraftLikeStatus(raw);
}

export function resolveAchHistoryEntryDisplayStatus(
    entry: DocumentSendHistoryEntry,
    allHistory: DocumentSendHistoryEntry[],
): string {
    if (entry.documentKind !== "ach") return String(entry.status ?? "").trim();
    return resolveAchEnvelopeDisplayStatus(
        {
            envelopeId: entry.envelopeId,
            status: entry.status,
            updatedAt: entry.updatedAt,
        },
        allHistory,
    );
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

/** Tailwind classes for Sent / Viewed / Signed status capsules on ACH and contract rows. */
export function getDocumentSendStatusCapsuleClasses(status?: string | null): string {
    const label = formatDocumentSendStatusLabel(status);
    const base =
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";
    switch (label) {
        case "Signed":
            return `${base} border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-200`;
        case "Viewed":
            return `${base} border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800/50 dark:bg-blue-950/40 dark:text-blue-200`;
        case "Sent":
            return `${base} border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-200`;
        case "Draft":
            return `${base} border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300`;
        case "Voided":
        case "Declined":
        case "Expired":
            return `${base} border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200`;
        default:
            return `${base} border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200`;
    }
}

export function canPreviewFilledOrSignedEnvelope(status?: string | null): boolean {
    const s = String(status ?? "").trim().toLowerCase();
    return ["sent", "delivered", "viewed", "signed", "completed"].includes(s);
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
    "ach_authorization_account_holder_bank_number_of_transactions",
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
    ach_authorization_account_holder_bank_number_of_transactions: "NO. of transaction",
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
    /** Contract / UI state when the template row has no `state` column set. */
    fallbackState?: string | null;
    /** Offer payment frequency when the template row has no `frequency` column set. */
    fallbackFrequency?: string | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    contractRecords?: ContractPrefillContractRecords | null;
    agreementDate?: string;
    /** Main contract prefill overrides (excludes per-mapping blob); same source as Deal Review. */
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    savedOverridesForMapping?: Record<string, string> | null;
    bankDetail?: Record<string, unknown> | null;
    documentType?: string | null;
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
    const templateId = options.templateId;

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

function upsertPrefillFieldValue(
    byId: Map<string, ContractPrefillField>,
    id: string,
    value: string,
): void {
    const v = String(value ?? "").trim();
    if (!v) return;
    const existing = byId.get(id);
    byId.set(id, existing ? { ...existing, value: v } : { id, value: v, label: "" });
}

export function applyDocumentTemplateMappingPrefillOverrides(args: {
    prefillFieldsPayload: ContractPrefillField[];
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
            type?: string | null;
        } | null;
    }>;
    contractPrefillOverridesRaw: unknown;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    bankDetail?: Record<string, unknown> | null;
}): ContractPrefillField[] {
    const blob = parseDocumentTemplatePrefillByMappingId(args.contractPrefillOverridesRaw);
    const mergedSet = new Set([
        ...args.mergedTemplateIds.map((x) => String(x).trim()).filter(Boolean),
        ...(args.mergedLayoutKeys || []).map((x) => String(x).trim()).filter(Boolean),
    ]);
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
            templateType: row.template?.type ?? null,
            templateLayoutKey: layoutKey || null,
            templateState: row.template?.state ?? null,
            templateFrequency: row.template?.frequency ?? null,
            contract: args.contract ?? null,
            application: args.application ?? null,
            agreementDate: args.agreementDate,
            mainPrefillOverrides: args.mainPrefillOverrides,
            savedOverridesForMapping: perMap ?? null,
            bankDetail: args.bankDetail ?? null,
            documentType: row.documentType ?? null,
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
            upsertPrefillFieldValue(byId, id, String(value ?? ""));
        }
    }

    const disclosureMerged = args.templateMappingRows.some((row) => {
        const templateRowId = String(row.template?.id ?? "").trim();
        return (
            String(row.documentType || "").toLowerCase() === "disclosure" &&
            Boolean(templateRowId && mergedSet.has(templateRowId))
        );
    });
    if (disclosureMerged) {
        upsertPrefillFieldValue(
            byId,
            "funder_name",
            PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        );
        const merchant = resolveMainContractPersonNameFromPrefill(byId);
        if (merchant) {
            upsertPrefillFieldValue(byId, "client_name", merchant);
        }
    }

    return Array.from(byId.values());
}

/** Ensures disclosure merchant + funder names are on the send payload when a CRM disclosure PDF is merged. */
export function mergeStateDisclosurePrefillFallback(args: {
    payload: ContractPrefillField[];
    supplementalRefs: string[];
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    mainPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    bankDetail?: Record<string, unknown> | null;
}): ContractPrefillField[] {
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
        if (existingNum !== undefined && existingNum > 0) continue;
        if (
            field.id === "appendix_underwriting_fees" &&
            existing !== undefined &&
            String(existing.value ?? "").trim() !== ""
        ) {
            continue;
        }
        byId.set(
            field.id,
            existing
                ? { ...existing, value: v }
                : { id: field.id, value: v, label: String(field.label ?? "").trim() },
        );
    }
    upsertPrefillFieldValue(
        byId,
        "funder_name",
        PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
    );
    const merchant =
        resolveMainContractPersonNameFromPrefill(byId) ||
        String(sctx.recipientName || "").trim();
    if (merchant) {
        upsertPrefillFieldValue(byId, "client_name", merchant);
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
        documentType: "disclosure",
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
    payload: ContractPrefillField[],
    disclosureFields: Array<{ id: string; value: string; label?: string }>,
): ContractPrefillField[] {
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
        byId.set(
            field.id,
            existing
                ? { ...existing, value: v }
                : { id: field.id, value: v, label: String(field.label ?? "").trim() },
        );
    }
    return Array.from(byId.values());
}
