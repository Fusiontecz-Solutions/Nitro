import type {
    BuildContractPrefillFieldsArgs,
    ContractPrefillContractRecords,
    ContractPrefillField,
} from "./Contract";
import {
    buildWoodmereFlexAddendumContractPrefillFields,
    formatFlexAddendumMoneyDisplay,
    type WoodmereFlexAddendumContractPrefillFields,
} from "./WOODMERE_FLEX_ADDENDUM";
import {
    buildContractPrefillFieldsFromApplication,
    getApplicationPrimaryRecipientName,
    getContractPrefillEditDefaultsFromApplication,
    resolveBalanceTransferMerchantContext,
    resolveContractBusinessLegalNameForPrefill,
    resolveOfferAmountDollarsForUnderwritingFees,
    resolveRemittancePrefillValue,
} from "./Contract";
import {
    buildBalanceTransferSheetContractPrefillFields,
    formatFunderNameWithDealIdPrefix,
    type BalanceTransferSheetContractPrefillFields,
} from "./BALANCE_TRANSFER_SHEET_ADDENDUM";
import { DOCUSIGN_ADDENDUM_TEMPLATE_IDS } from "./docusignAddendumTemplates";
import {
    isAchAuthorizationLayoutKey,
    isPlatformLayoutKey,
    PLATFORM_DISCLOSURE_FUNDER_NAME,
    PLATFORM_LAYOUT_KEYS,
} from "./platformDocumentConfig";
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
    buildPrePaymentAddendumContractPrefillFields,
    type PrePaymentAddendumContractPrefillFields,
} from "./PRE_PAYMENT_ADDENDUM";
import {
    buildDiscoverRefiBalanceTransferAddendumContractPrefillFields,
    type DiscoverRefiBalanceTransferAddendumContractPrefillFields,
} from "./DISCOVER_REFI_BALANCE_TRANSFER_ADDENDUM";
import {
    buildCaseTakeoverAddendumContractPrefillFields,
    type CaseTakeoverAddendumContractPrefillFields,
} from "./CASE_TAKEOVER_ADDENDUM";
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
import {
    ACH_AUTHORIZATION_EDITABLE_FIELD_IDS,
    ACH_AUTHORIZATION_FIELD_LABELS,
    ACH_PREFILL_MAPPING_ALIAS_KEY,
    resolveAchSavedMappingOverrides,
} from "./achFormEditConfig";
import { CONTRACT_SIGNER_OVERRIDES_KEY } from "./templateRecipients";

function resolveMainContractBusinessNameFromPrefill(
    byId: Map<string, { id: string; value: string }>,
): string {
    const businessKeys = [
        "legal_name",
        "client_legal_name",
        "security_business_name",
        "business_legal_name",
        "merchant_legal_name",
        "authorization_application",
    ];
    for (const key of businessKeys) {
        const value = String(byId.get(key)?.value || "").trim();
        if (value && !/^\d+$/.test(value.replace(/\s/g, ""))) return value;
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
    /** Funder used for this ACH send (standalone ACH envelopes). */
    funderName?: string;
    funderProfileId?: string;
};

/** Last ACH funder chosen/sent — used to default the ACH Form modal dropdown. */
export const LAST_ACH_SENT_FUNDER_KEY = "lastAchSentFunder";

export type LastAchSentFunderMeta = {
    funderName: string;
    funderProfileId?: string;
    envelopeId?: string;
    updatedAt?: string;
};

export function parseLastAchSentFunder(raw: unknown): LastAchSentFunderMeta | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const blob = (raw as Record<string, unknown>)[LAST_ACH_SENT_FUNDER_KEY];
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return null;
    const o = blob as Record<string, unknown>;
    const funderName = String(o.funderName ?? "").trim();
    if (!funderName) return null;
    const funderProfileId = String(o.funderProfileId ?? "").trim();
    const envelopeId = String(o.envelopeId ?? "").trim();
    const updatedAt = String(o.updatedAt ?? "").trim();
    return {
        funderName,
        ...(funderProfileId ? { funderProfileId } : {}),
        ...(envelopeId ? { envelopeId } : {}),
        ...(updatedAt ? { updatedAt } : {}),
    };
}

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
        const funderName = String((row as Record<string, unknown>).funderName ?? "").trim();
        const funderProfileId = String(
            (row as Record<string, unknown>).funderProfileId ?? "",
        ).trim();
        out.push({
            envelopeId,
            documentKind,
            label: label || (documentKind === "ach" ? "ACH Authorization" : "Contract"),
            ...(status ? { status } : {}),
            ...(updatedAt ? { updatedAt } : {}),
            ...(funderName ? { funderName } : {}),
            ...(funderProfileId ? { funderProfileId } : {}),
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

/**
 * Resolve the ACH envelope meta for the modal/status UI.
 * Prefer the live mapping id, then the stable `ach_authorization` alias, then
 * any ACH entry in the envelope blob / send history (survives mapping-id swaps).
 */
export function resolveAchLinkedEnvelopeMeta(args: {
    mappingId?: string | null;
    envelopeByMappingId: Record<string, DocumentTemplateEnvelopeMeta>;
    sendHistory?: DocumentSendHistoryEntry[];
    /** Optional capsule from `achAuthorizationDocuSign` (Contracts Generated source). */
    capsule?: { envelopeId?: string | null; status?: string | null; updatedAt?: string | null } | null;
}): DocumentTemplateEnvelopeMeta | null {
    const byId = args.envelopeByMappingId ?? {};
    const mappingId = String(args.mappingId ?? "").trim();
    if (mappingId && byId[mappingId]?.envelopeId) {
        return byId[mappingId];
    }
    const alias = byId[ACH_PREFILL_MAPPING_ALIAS_KEY];
    if (alias?.envelopeId) return alias;

    const capsuleId = String(args.capsule?.envelopeId ?? "").trim();
    if (capsuleId) {
        return {
            envelopeId: capsuleId,
            status: String(args.capsule?.status ?? "").trim() || undefined,
            updatedAt: String(args.capsule?.updatedAt ?? "").trim() || undefined,
        };
    }

    for (const meta of Object.values(byId)) {
        if (String(meta?.envelopeId ?? "").trim()) return meta;
    }

    const achHistory = (args.sendHistory ?? []).filter((h) => h.documentKind === "ach");
    const latest = [...achHistory]
        .filter((h) => String(h.envelopeId ?? "").trim())
        .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    if (latest.length > 0) {
        return {
            envelopeId: String(latest[0].envelopeId).trim(),
            status: String(latest[0].status ?? "").trim() || undefined,
            updatedAt: String(latest[0].updatedAt ?? "").trim() || undefined,
        };
    }
    return null;
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
        funderAddress: d(),
        funderPhone: d(),
        funderEmail: d(),
        dealIdPrefix: d(),
        recipientAddress: d(),
        signatureDate: d(),
        prepaymentReceivedByDate: d(),
        prepaymentDiscountAmount: d(),
        paymentFrequency: d(),
    };
}

/** Parse `state_disclosure_dailyFlorida` / `daily_florida` into state + frequency. */
function parseStateFrequencyFromDisclosureRef(
    ref?: string | null,
): { state: string | null; frequency: string | null } {
    const raw = String(ref ?? "")
        .trim()
        .replace(/[\s-]+/g, "_");
    if (!raw) return { state: null, frequency: null };

    let key = raw;
    if (key.toLowerCase().startsWith("state_disclosure_")) {
        key = key.slice("state_disclosure_".length);
    }

    const freqMatch = key.match(/^(daily|weekly|monthly)[_]?(.+)$/i);
    if (!freqMatch) return { state: null, frequency: null };
    const frequency = freqMatch[1].toLowerCase();
    let statePart = String(freqMatch[2] ?? "")
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase()
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
    if (statePart === "newyork" || statePart === "new_york") statePart = "new_york";
    return { state: statePart || null, frequency };
}

function resolveDisclosureStateAndFrequency(options: {
    templateState?: string | null;
    templateFrequency?: string | null;
    fallbackState?: string | null;
    fallbackFrequency?: string | null;
    templateLayoutKey?: string | null;
    templateName?: string | null;
    contract?: Record<string, unknown> | null;
}): { state: string | null; frequency: string | null } {
    const contract = options.contract ?? {};
    let state =
        String(options.templateState ?? options.fallbackState ?? contract.state ?? "").trim() ||
        null;
    let frequency =
        String(
            options.templateFrequency ??
                options.fallbackFrequency ??
                (contract as Record<string, unknown>).disclosureFrequency ??
                "",
        ).trim() || null;

    if (!state || !frequency) {
        const fromLayout = parseStateFrequencyFromDisclosureRef(options.templateLayoutKey);
        const fromName = parseStateFrequencyFromDisclosureRef(options.templateName);
        state = state || fromLayout.state || fromName.state;
        frequency = frequency || fromLayout.frequency || fromName.frequency;
    }
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
        addendumDate: DUMMY,
        agreementDate: DUMMY,
        merchantName: DUMMY,
        clientName: DUMMY,
        businessName2: DUMMY,
        installmentDay1: "1",
        installmentDay2: "16",
        dailyPayment1: DUMMY,
        receivablePurchase1: DUMMY,
        dailyPayment2: DUMMY,
        receivablePurchase2: DUMMY,
        funderName: DUMMY,
        dealIdPrefix: DUMMY,
    };
}

function currentUsDate(): string {
    return new Intl.DateTimeFormat("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
    }).format(new Date());
}

function buildPrePaymentAddendumComputed(
    contract: Record<string, unknown> | null,
    application: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
): ContractPrefillField[] {
    const c = contract ?? {};
    const sellerName =
        resolveContractBusinessLegalNameForPrefill(c, application) ||
        sctx.recipientName ||
        "";
    const guarantorName =
        str(c.owner1GuarantorName) ||
        str(c.guarantorName) ||
        str(c.customerName) ||
        str(c.clientName) ||
        getApplicationPrimaryRecipientName(application) ||
        "";
    return buildPrePaymentAddendumContractPrefillFields({
        agreementDate: currentUsDate(),
        sellerName,
        guarantorName,
        businessDays: str(c.prePaymentBusinessDays),
        discountPercentage: str(c.prePaymentDiscountPercentage),
        printedName: guarantorName,
    });
}

function dotPrePaymentAddendum(): PrePaymentAddendumContractPrefillFields {
    return {
        agreementDate: DUMMY,
        sellerName: DUMMY,
        guarantorName: DUMMY,
        businessDays: DUMMY,
        discountPercentage: DUMMY,
        printedName: DUMMY,
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
    // Remaining Balance is NOT main-contract payback (purchasePrice). Prefer explicit BT
    // remaining-balance overrides; leave blank for the mapping editor when unset.
    const purchasePrice =
        str(overrides.balance_transfer_purchase_price) ||
        str(overrides.remainingBalance) ||
        str(overrides.remaining_balance) ||
        "";
    const funderNameWithDealPrefix = formatFunderNameWithDealIdPrefix(
        str(c.funderName) || str(overrides.funderName),
        str(c.dealIdPrefix) || str(overrides.dealIdPrefix),
        str(c.funderDisplayName) || str(overrides.funderDisplayName),
    );
    const dealIdPrefix =
        str(c.dealIdPrefix) || str(overrides.dealIdPrefix) || "";
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
        funderNameWithDealPrefix,
        dealIdPrefix,
    });
}

function buildWoodmereFlexComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
    application?: Record<string, unknown> | null,
): ContractPrefillField[] {
    const c = contract ?? {};
    const app = application ?? null;
    const overrides = (c.contractPrefillOverrides as Record<string, unknown> | undefined) ?? {};
    const offerDecision =
        (app?.offerDecision as Record<string, unknown> | undefined) ??
        (app?.OfferDecision as Record<string, unknown> | undefined) ??
        (c.offer as Record<string, unknown> | undefined) ??
        null;
    const legal =
        str(c.legalName) ||
        str(c.clientLegalName) ||
        sctx.recipientName ||
        "";
    const primaryRecipient = getApplicationPrimaryRecipientName(app);
    const clientName =
        str(c.customerName) ||
        str(c.clientName) ||
        str(c.owner1GuarantorName) ||
        primaryRecipient ||
        sctx.recipientName ||
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
        resolveRemittancePrefillValue({
            application: app ?? undefined,
            contract,
            offerDecision,
        });
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
    const businessName2 =
        str(c.merchant2Name) ||
        str(c.owner2GuarantorName) ||
        str(c.merchant2_name) ||
        str(c.owner2_guarantor_name) ||
        str(c.business_name_2) ||
        "";
    const funderName =
        str(c.funderDisplayName) ||
        str(overrides.funderDisplayName) ||
        str(c.funderName) ||
        str(overrides.funderName);
    const dealIdPrefix = str(c.dealIdPrefix) || str(overrides.dealIdPrefix);
    return buildWoodmereFlexAddendumContractPrefillFields({
        addendumDate,
        agreementDate,
        merchantName: legal,
        clientName,
        businessName2,
        dailyPayment1,
        receivablePurchase1,
        dailyPayment2,
        receivablePurchase2,
        funderName,
        dealIdPrefix,
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

function buildCaseTakeoverAddendumComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
): ContractPrefillField[] {
    const c = contract ?? {};
    const fromCtx = str(sctx.funderName);
    const funderName =
        str(c.funderName) ||
        str(c["funder_name"]) ||
        (fromCtx &&
        fromCtx.toLowerCase() !== PLATFORM_DISCLOSURE_FUNDER_NAME.toLowerCase()
            ? fromCtx
            : "") ||
        "";
    return buildCaseTakeoverAddendumContractPrefillFields({
        funderName,
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

function dotCaseTakeoverAddendum(): CaseTakeoverAddendumContractPrefillFields {
    return {
        funderName: DUMMY,
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
    | "case_takeover_addendum"
    | "woodmere_flex"
    | "pre_payment_addendum"
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
    layoutKey?: string | null,
): AddendumKind | null {
    const tid = String(templateId ?? "").trim().toLowerCase();
    const lk = String(layoutKey ?? "").trim().toLowerCase();
    const key = lk || tid;
    if (
        key === PLATFORM_LAYOUT_KEYS.flexAddendum ||
        key.endsWith("_flex_addendum")
    ) {
        return "woodmere_flex";
    }
    if (
        key === PLATFORM_LAYOUT_KEYS.prePaymentAddendum ||
        key.endsWith("_pre_payment_addendum")
    ) {
        return "pre_payment_addendum";
    }
    // Must run before balance_transfer — legacy key ends with `_balance_transfer`.
    if (
        key === PLATFORM_LAYOUT_KEYS.caseTakeoverAddendum ||
        key.endsWith("_case_takeover_addendum") ||
        key === "case_takeover_balance_transfer" ||
        key.endsWith("_case_takeover_balance_transfer")
    ) {
        return "case_takeover_addendum";
    }
    if (
        key === PLATFORM_LAYOUT_KEYS.balanceTransfer ||
        key.endsWith("_balance_transfer")
    ) {
        return "balance_transfer_sheet";
    }
    if (tid === ADDENDUM_GUID.WOODMERE_FLEX) return "woodmere_flex";
    if (tid === ADDENDUM_GUID.WOODMERE_BALANCE_TRANSFER_SHEET) return "balance_transfer_sheet";
    if (matches(normName, "case", "takeover")) return "case_takeover_addendum";
    if (matches(normName, "balance", "transfer") && !normName.includes("discover") && !normName.includes("refi"))
        return "balance_transfer_sheet";
    if (normName.includes("woodmere") && normName.includes("flex") && (normName.includes("dated") || normName.includes("agreement")))
        return "woodmere_flex_dated";
    if (normName.includes("woodmere") && normName.includes("flex")) return "woodmere_flex";
    if (normName.includes("flex") && !normName.includes("dated")) return "woodmere_flex";
    if (
        (normName.includes("pre_payment") || normName.includes("prepayment")) &&
        normName.includes("addendum")
    )
        return "pre_payment_addendum";
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
    templateLayoutKey?: string | null,
): boolean {
    const { state, frequency } = resolveDisclosureStateAndFrequency({
        templateState,
        templateFrequency,
        fallbackState,
        fallbackFrequency,
        templateLayoutKey,
        templateName,
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
    layoutKey?: string | null,
): boolean {
    return (
        resolveAddendumKind(
            templateId,
            normalizeKey(templateName ?? ""),
            layoutKey,
        ) != null
    );
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
    delete o[LAST_ACH_SENT_FUNDER_KEY];
    delete o[CONTRACT_SIGNER_OVERRIDES_KEY];
    return o as T;
}

function addendumAllDefs(kind: AddendumKind): ContractPrefillField[] {
    switch (kind) {
        case "balance_transfer_sheet":
            return buildBalanceTransferSheetContractPrefillFields(dotBalanceTransfer());
        case "case_takeover_addendum":
            return buildCaseTakeoverAddendumContractPrefillFields(dotCaseTakeoverAddendum());
        case "woodmere_flex":
            return buildWoodmereFlexAddendumContractPrefillFields(dotWoodmereFlex());
        case "pre_payment_addendum":
            return buildPrePaymentAddendumContractPrefillFields(dotPrePaymentAddendum());
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
        case "case_takeover_addendum":
            return buildCaseTakeoverAddendumComputed(contract, sctx);
        case "woodmere_flex":
            return buildWoodmereFlexComputed(contract, sctx, application);
        case "pre_payment_addendum":
            return buildPrePaymentAddendumComputed(contract, application, sctx);
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

/** State disclosure template merged with the contract (Florida, Georgia, etc.). */
export const LINKED_DOCUSIGN_DISCLOSURE_SECTION_ID = "linked_docusign_disclosure";
export const LINKED_DOCUSIGN_ACH_SECTION_ID = "linked_docusign_ach";

/**
 * Text Data Labels from `ach_authorization*.layout.json` (excludes DocuSign date/sign tabs).
 * Source of truth: `achFormEditConfig.ts`.
 */
export function usesCoordinateLayoutTemplate(row: {
    documentType?: string | null;
    template?: {
        type?: string | null;
        layoutKey?: string | null;
        pdfUrl?: string | null;
        templateId?: string | null;
        name?: string | null;
    } | null;
} | null): boolean {
    if (!row) return false;
    const docType = normalizeKey(row.documentType ?? "");
    const type = normalizeKey(row.template?.type ?? "");
    const layoutKey = String(row.template?.layoutKey ?? "").trim();
    if (docType === "ach" || type === "ach") return true;
    if (isAchAuthorizationLayoutKey(layoutKey)) return true;
    return resolveAchAuthorizationTemplate(type, row.template?.name, layoutKey);
}

function resolveAchAuthorizationTemplate(
    templateType?: string | null,
    templateName?: string | null,
    layoutKey?: string | null,
): boolean {
    const typeNorm = normalizeKey(templateType ?? "");
    const nameNorm = normalizeKey(templateName ?? "");
    if (typeNorm === "ach") return true;
    if (isAchAuthorizationLayoutKey(layoutKey)) return true;
    // Avoid matching unrelated templates that merely mention "ach" in the name.
    return (
        nameNorm.includes("ach_authorization") ||
        nameNorm.includes("ach authorization") ||
        (nameNorm.includes("ach") && nameNorm.includes("authorization"))
    );
}

function achAuthorizationAllDefs(): ContractPrefillField[] {
    return ACH_AUTHORIZATION_EDITABLE_FIELD_IDS.map((id) => ({
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
    const allowed = new Set<string>(ACH_AUTHORIZATION_EDITABLE_FIELD_IDS);
    const byId = new Map(computed.filter((f) => allowed.has(f.id)).map((f) => [f.id, f]));
    // Preserve layout placement order for the Edit ACH form modal.
    return ACH_AUTHORIZATION_EDITABLE_FIELD_IDS.map((id) => {
        const row = byId.get(id);
        return {
            id,
            label: ACH_AUTHORIZATION_FIELD_LABELS[id] || id.replace(/_/g, " "),
            value: row?.value ?? "",
        };
    });
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
        templateLayoutKey: options.templateLayoutKey,
        templateName: options.templateName,
        contract: effectiveContract,
    });
    const templateId = options.templateId;

    // Explicit disclosure rows must use the disclosure catalog / PDF data labels
    // (same as Katan) — never fall through to ACH/addendum name matching.
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

    // ACH must win over disclosure matching: state+frequency alone would otherwise
    // return Page 3 / disclosure fields for every template on a disclosure deal.
    if (
        docType === "ach" ||
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

    // Addendums must also win over disclosure matching for the same reason.
    const norm = normalizeKey(name ?? "");
    const addendum = resolveAddendumKind(
        templateId,
        norm,
        options.templateLayoutKey,
    );
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

/**
 * Main RPA / Verify Prefill money tabs. Disclosure + addendum expansion must not
 * overwrite these when already set — shared envelope value maps feed the main contract PDF.
 */
const MAIN_CONTRACT_PROTECTED_MONEY_FIELD_IDS = new Set(
    [
        "purchase_price",
        "purchasePrice",
        "purchase_amount",
        "purchaseAmount",
        "remittance",
        "net_to_merchant",
        "NetFundProvided",
        "frequency",
        "paymentTerms",
        "purchase_percent",
        "specified_percentage",
        "appendix_underwriting_fees",
        "underwriter_fee",
        "underwriterfee",
        "underwriter_fees",
        "ach_authorization_account_holder_bank_transaction_fee",
        "ach_authorization_account_holder_bank_number_of_transactions",
        "addendum_dated_principal_owner_amount",
        "addendum_dated_principal_owner_amount2",
    ].map((id) => id.toLowerCase()),
);

function isMainContractProtectedMoneyFieldId(id: string): boolean {
    return MAIN_CONTRACT_PROTECTED_MONEY_FIELD_IDS.has(
        String(id || "")
            .trim()
            .toLowerCase(),
    );
}

/** Upsert unless this is a protected main-contract money id that already has a value. */
function upsertPrefillFieldValuePreserveMainMoney(
    byId: Map<string, ContractPrefillField>,
    id: string,
    value: string,
): void {
    const key = String(id || "").trim();
    const v = String(value ?? "").trim();
    if (!key || !v) return;
    if (isMainContractProtectedMoneyFieldId(key)) {
        const existing = String(byId.get(key)?.value ?? "").trim();
        if (existing) return;
    }
    upsertPrefillFieldValue(byId, key, v);
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
        const perMap =
            String(row.documentType || "").toLowerCase() === "ach" ||
            isAchAuthorizationLayoutKey(layoutKey) ||
            normalizeKey(row.template?.type ?? "") === "ach"
                ? resolveAchSavedMappingOverrides(blob, row.id)
                : (blob[row.id] ?? null);
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
            savedOverridesForMapping: perMap,
            bankDetail: args.bankDetail ?? null,
            documentType: row.documentType ?? null,
        });
        const isDisclosureRow =
            String(row.documentType || "").toLowerCase() === "disclosure";
        const editorValues: Record<string, string> = {};
        for (const field of computedRows) {
            // Only force platform disclosure funder name on disclosure PDFs —
            // Case Takeover / other addenda must keep the selected funder.
            const v =
                isDisclosureRow && field.id === "funder_name"
                    ? PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase()
                    : String(field.value ?? "").trim();
            if (!v) continue;
            editorValues[field.id] = v;
        }
        const fieldsToMerge = isDisclosureRow
            ? expandDisclosureEditorValuesToPdfFields(editorValues)
            : editorValues;
        for (const [id, value] of Object.entries(fieldsToMerge)) {
            upsertPrefillFieldValuePreserveMainMoney(byId, id, String(value ?? ""));
        }
        const addendumKind = resolveAddendumKind(
            templateId || tid || null,
            normalizeKey(row.template?.name ?? ""),
            layoutKey || null,
        );
        if (addendumKind === "balance_transfer_sheet") {
            const remaining = String(
                fieldsToMerge.purchase_price ??
                    fieldsToMerge.balance_transfer_purchase_price ??
                    perMap?.purchase_price ??
                    perMap?.balance_transfer_purchase_price ??
                    "",
            ).trim();
            if (remaining) {
                // Never clobber main RPA purchase_price (payback) with BT remaining balance.
                upsertPrefillFieldValue(byId, "balance_transfer_purchase_price", remaining);
                // Keep bare purchase_price on the mapping payload for editor round-trips only
                // when main payback is absent — otherwise leave main purchase_price alone.
                const mainPayback = String(byId.get("purchase_price")?.value ?? "").trim();
                if (!mainPayback) {
                    upsertPrefillFieldValue(byId, "purchase_price", remaining);
                }
            }
        }
    }

    const disclosureMerged = args.templateMappingRows.some((row) => {
        const templateRowId = String(row.template?.id ?? "").trim();
        return (
            String(row.documentType || "").toLowerCase() === "disclosure" &&
            Boolean(templateRowId && mergedSet.has(templateRowId))
        );
    });
    const caseTakeoverMerged = args.templateMappingRows.some((row) => {
        const layoutKey = String(row.template?.layoutKey ?? row.template?.templateId ?? "")
            .trim()
            .toLowerCase();
        const templateRowId = String(row.template?.id ?? "").trim();
        const included =
            (layoutKey && mergedSet.has(String(row.template?.layoutKey ?? "").trim())) ||
            (layoutKey && mergedSet.has(layoutKey)) ||
            (templateRowId && mergedSet.has(templateRowId)) ||
            [...mergedSet].some((k) => String(k).toLowerCase().includes("case_takeover"));
        return included && layoutKey.includes("case_takeover");
    }) || [...mergedSet].some((k) => String(k).toLowerCase().includes("case_takeover"));

    if (disclosureMerged) {
        // Do not overwrite shared `funder_name` with Woodmere when Case Takeover is
        // also merged — that addendum needs the selected funder (e.g. EJM).
        if (!caseTakeoverMerged) {
            upsertPrefillFieldValue(
                byId,
                "funder_name",
                PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
            );
        }
        const merchant = resolveMainContractBusinessNameFromPrefill(byId);
        if (merchant) {
            upsertPrefillFieldValue(byId, "client_name", merchant);
            upsertPrefillFieldValue(byId, "recipient_name", merchant);
            upsertPrefillFieldValue(byId, "disclosure_name", merchant);
            upsertPrefillFieldValue(byId, "disclosure_merchant_name", merchant);
        }
    }

    if (caseTakeoverMerged) {
        const selectedFunder = String(
            (args.contract as Record<string, unknown> | null | undefined)?.funderName ??
                (args.mainPrefillOverrides as Record<string, unknown> | null | undefined)
                    ?.funderName ??
                "",
        ).trim();
        if (selectedFunder) {
            upsertPrefillFieldValue(byId, "funder_name", selectedFunder);
            upsertPrefillFieldValue(
                byId,
                "case_takeover_addendum_funder_name",
                selectedFunder,
            );
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
    if (!state || !frequency || !hasStateDisclosurePrefillRegistry(null, state, frequency)) {
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
    const hasCaseTakeover = supplementalIds.some((ref) =>
        /case_takeover/i.test(ref),
    );
    // Case Takeover needs the selected funder on shared `funder_name` — do not
    // overwrite with the platform disclosure name (Woodmere).
    if (!hasCaseTakeover) {
        upsertPrefillFieldValue(
            byId,
            "funder_name",
            PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        );
    }
    const merchant =
        resolveMainContractBusinessNameFromPrefill(byId) ||
        resolveContractBusinessLegalNameForPrefill(
            effectiveContract,
            args.application ?? null,
        ) ||
        String(sctx.recipientName || "").trim();
    if (merchant) {
        upsertPrefillFieldValue(byId, "client_name", merchant);
        upsertPrefillFieldValue(byId, "recipient_name", merchant);
        upsertPrefillFieldValue(byId, "disclosure_name", merchant);
        upsertPrefillFieldValue(byId, "disclosure_merchant_name", merchant);
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
            "payment_terms_percent",
            "payment_exceed_percent",
            "disclosure_payment_terms",
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
        const id = String(field.id ?? "").trim();
        const v = String(field.value ?? "").trim();
        if (!id || !v) continue;
        // Cadence-only slots: never let disclosure % (e.g. "0.00%") overwrite Daily/Weekly.
        const idNorm = id.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
            (idNorm === "frequency" || idNorm === "paymentterms") &&
            /%/.test(v)
        ) {
            continue;
        }
        // Disclosure must not overwrite shared `funder_name` when Case Takeover (or
        // another addendum) already set the selected funder via its scoped CRM key.
        if (
            id === "funder_name" &&
            (byId.has("case_takeover_addendum_funder_name") ||
                [...byId.keys()].some((k) =>
                    String(k).toLowerCase().includes("case_takeover"),
                ))
        ) {
            continue;
        }
        const existing = byId.get(id);
        const existingVal = String(existing?.value ?? "").trim();
        // Verify Prefill / Final Calculation money on the main RPA must win over
        // disclosure calculator aliases (purchase_price, remittance, etc.).
        if (isMainContractProtectedMoneyFieldId(id) && existingVal) {
            continue;
        }
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
            id,
            existing
                ? { ...existing, value: v }
                : { id, value: v, label: String(field.label ?? "").trim() },
        );
    }
    return Array.from(byId.values());
}
