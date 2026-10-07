import {
    Fragment,
    memo,
    startTransition,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { flushSync } from "react-dom";
import {
    AlertCircle,
    BadgeCheck,
    Building2,
    Calculator,
    CheckCircle2,
    ChevronDown,
    Clock,
    Download,
    ExternalLink,
    Eye,
    FileSignature,
    FileText,
    Info,
    Landmark,
    Layers,
    Loader2,
    Mail,
    MapPin,
    MoreVertical,
    Pencil,
    Plus,
    RefreshCw,
    ScrollText,
    Send,
    Trash2,
    UploadCloud,
    User,
    X,
} from "lucide-react";
import { Document, Page } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "@/lib/pdfjsWorker";
import { useDispatch, useSelector } from "react-redux";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SearchableStateSelect, pickUsStateForSelect } from "@/components/ui/searchable-state-select";
import {
    funderNamesForContractState,
    findFunderProfile,
    normalizeLegacyFunderName,
    pickFunderForSelect,
} from "@/constants/contractFunder";
import {
    funderAvailableForContractState,
    funderNamesEquivalent,
    formatFunderSelectLabel,
    findFunderProfileById,
    isTexasFundingGroupFunderProfile,
    isWoodmereFunderProfile,
    persistedFunderProfileIdForApi,
    resolveDefaultFunderNameForState,
    resolveFunderSwitchOnStateChange,
    useFunderProfiles,
} from "@/hooks/useFunderProfiles";
import { fetchLatestContractTemplate } from "@/utils/contractTemplate";
import { loadPdfBlobUrlForViewer } from "@/utils/cloudinaryPdfUrl";
import {
    resolveAddendumDocumentsLayoutFunderId,
    resolveDisclosureDocumentsLayoutFunderId,
} from "@/utils/funderDocumentSource";
import {
    funderDisclosureLayoutKeyForState,
    isPlatformScopedBoldSignTemplateRow,
} from "@/utils/funderLayoutKeys";
import { fetchMainContractTemplatePreview, isPreferredCapitalBranding, NITRO_ADVANCE_CONTRACT_PREVIEW_NAME, sanitizeContractPreviewName } from "./contractdata/contractTemplatePreview";
import { fetchDocuSignTemplateIdForFunder } from "@/utils/contractDocuSignTemplate";
import type { AppDispatch, RootState } from "@/redux/store";
import {
    getAllACH,
    getAllAddendum,
    getAllContractGuarantors,
    getAllContractOwners,
    getAllEPO,
    createACH,
    updateACH,
    createAddendum,
    updateAddendum,
    createEPO,
    updateEPO,
    createContractOwner,
    updateContractOwner,
    createContractGuarantor,
    updateContractGuarantor,
    // deleteACH,
    // deleteEPO,
    // deleteAddendum,
    // deleteContractGuarantor,
    deleteUploadedContractDocument,
    getBoldSignTemplates,
    getUploadedContractDocumentById,
    getUploadedContractDocuments,
    uploadContractDocuments,
    updateUploadedContractDocument,
    updateContract,
    getByApplicationIdContract,
    getByIdContract,
    type UpdateContractData,
} from "@/redux/actions/contractActions";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import { getDocumentRequestsByApplication, removeDocumentRequest } from "@/redux/actions/notificationActions";
import { toast } from "react-toastify";
import {
    buildContractPrefillFieldsFromApplication,
    contractPrefillToContractColumnUpdate,
    mergeContractPrefillOverrideLayers,
    categorizeDealReviewPrefillFieldId,
    dealReviewPrefillSubsection,
    overlaySavedAppendixFeeOnPrefillFields,
    prepareDealReviewPrefillDisplay,
    applyTexasContractUsdMoneyToPrefillFields,
    uppercaseContractDocumentPrefillFields,
    resolveContractBusinessLegalNameForPrefill,
    CONTRACT_PREFILL_OVERRIDES_SECTION,
    getApplicationPrimaryRecipientName,
    resolveEffectiveDocuSignSignerEmail,
    normalizeContractPrefillOverrides,
    parseNoteStructuredSection,
    coercePaymentFrequencyLabel,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
    type ContractPrefillField,
} from "./contractdata/Contract";
import {
    parseKycExtractionsFromUploadResponse,
    kycExtractionHasReadableFields,
} from "./contractdata/kycDocumentPrefill";
import { cn, formatDate, formatDateMonthDayYear, formatDateTimeUS } from "@/lib/utils";
import { findApplicationFileForDocumentRequest } from "@/lib/documentRequestMatch";
import { normalizeRoleKey } from "@/lib/sessionRole";
import { isApplicationUuid } from "@/lib/paymentDealApplicationId";
import {
    filterBankDetailsForApplication,
    hasCompleteBankDetailRow,
} from "@/lib/bankDetailUtils";
import RequestedDocumentUploadRows, {
    getRequestedDocumentLabel,
} from "./RequestedDocumentUploadRows";
import {
    uploadApplicationDocuments,
    getApplicationById,
    getApplicationByApplicationId,
    reinitiateContract as reinitiateContractAction,
} from "@/redux/actions/applicationActions";
import { invalidateApplicationDetailCache } from "@/lib/applicationDetailCache";
import { refreshApplicationDetailFromServer } from "@/lib/refreshApplicationDetail";
import { resolveOfferDecisionFeesDisplayDollars } from "@/lib/offerDecisionFees";
import {
    resolveApplicationUuidForUpdate,
    syncContractPrefillToSourceRecords,
} from "./contractdata/contractPrefillSourceSync";

/** Primary DocuSign actions in the contract modal footer (matches Review & send / Done). */
const DOCUSIGN_PRIMARY_BTN_CLASS =
    "h-9 shrink-0 cursor-pointer border-0 bg-[image:var(--brand-gradient)] px-6 text-white shadow-sm hover:opacity-90 focus-visible:ring-[var(--brand)]/40";
import {
    voidBoldSignDocument,
} from "@/redux/actions/boldSignActions";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import {
    OFFER_DECISION_UPDATED_EVENT,
    offerDecisionUpdateMatchesApplication,
} from "@/lib/offerDecisionSync";
import {
    collectKnownFunderDefaultCcEmails,
    isReservedContractCcEmail,
    loadBoldSignCcEmailList,
    mergeWithDefaultCcEmails,
    normalizeCcEmailToken,
    parseFunderDefaultCcEmails,
    resolveContractDefaultCcEmails,
    saveBoldSignCcEmailList,
    setTenantDefaultContractCcEmail,
} from "./docusignCcList";
import {
    fetchContractCcDefaults,
    type ContractCcDefaults,
} from "@/redux/actions/integrationSettingsActions";
import { ContractPrefillEditForm } from "./contractdata/ContractPrefillEditForm";
import { ExhibitACompaniesSummarySection } from "./contractdata/ExhibitACompaniesSummarySection";
import { TemplateMappingPrefillEditDialog } from "./contractdata/TemplateMappingPrefillEditDialog";
import { DisclosureCalculationModal } from "./contractdata/DisclosureCalculationModal";
import { SpaCalculationModal } from "./contractdata/SpaCalculationModal";
import { persistCalculatedPurchasePercent } from "./contractdata/spaPrefillSync";
import {
    buildDisclosureCalculatorInputsFromSources,
    DISCLOSURE_MONTHLY_REVENUES_KEY,
    extractMonthlyRevenuesFromBankAnalyses,
} from "./contractdata/disclosureAprCalculator";
import { resolveWantedAddendumKinds } from "./contractdata/disclosureDocumentRules";
import { mapDisclosureMetricsToEditorFieldOverrides } from "./contractdata/disclosureEditorFields";
import { normalizeBoldSignTemplateStateKey } from "./contractdata/stateDisclosureManifestKey";
import { applyFunderDisclosureContactPrefill } from "./contractdata/funderDisclosureContact";
import { formatFunderNameWithDealIdPrefix } from "./contractdata/BALANCE_TRANSFER_SHEET_ADDENDUM";
import {
    applyDocumentTemplateMappingPrefillOverrides,
    buildExpandedDisclosurePrefillFieldsForMapping,
    DOCUMENT_SEND_HISTORY_KEY,
    DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY,
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    hasAddendumPrefillFieldMap,
    mergeExpandedDisclosurePrefillIntoPayload,
    mergeSignNowSupplementalPrefillFallback,
    parseDocumentSendHistory,
    parseDocumentTemplateEnvelopeByMappingId,
    parseDocumentTemplatePrefillByMappingId,
    stripDocumentTemplateBlobFromPrefillOverrides,
    upsertDocumentSendHistory,
} from "./contractdata/documentTemplateMappingPrefill";
import {
    EXHIBIT_C_ENTITIES_PREFILL_KEY,
    mergeExhibitCEntitiesForSignNowSend,
    serializeExhibitCEntities,
} from "./contractdata/exhibitCEntityPrefill";
import {
    docuSignPrefillSyncToast,
    patchDocuSignPrefillFields,
} from "./contractdata/syncDocuSignPrefillFields";
import {
    DOCUSIGN_CRM_STATUS_POLL_MS,
    DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS,
    DOCUSIGN_WEBHOOK_STALE_MS,
    isDocuSignPollingLimitError,
    shouldFallbackPollDocuSign,
} from "./contractdata/docusignPolling";
import { useContractSigningStatusRealtime } from "@/hooks/useContractSigningStatusRealtime";
import {
    CONTRACT_ADDENDUM_DOCUMENT_OPTIONS,
    getPlatformSignerRoleRows,
    isPlatformLayoutKey,
    PLATFORM_PRIMARY_SIGNER_ROLE,
    supplementalOptionLabel,
} from "./contractdata/platformDocumentConfig";
import {
    isSignNowAddendumLayoutKey,
    isSignNowDisclosureLayoutKey,
    SIGNNOW_ACH_DAILY_LAYOUT_KEY,
    SIGNNOW_DISCLOSURE_LAYOUT_KEY,
} from "./contractdata/signnowAddendumTemplates";
import {
    extractSignNowTemplateId,
    funderOwnsSignNowAddendumRef,
    funderSignNowAddendumOptions,
    funderSignNowDisclosureOptions,
    isSignNowTemplateIdToken,
    knownAddendumLayoutKeyFromName,
    matchFunderSignNowAddendumOption,
    resolveFunderAddendumDisplayName,
    resolveSignNowDisclosureOption,
} from "@/utils/signnowTemplateLink";
import {
    beginSignNowReviewTiming,
    markSignNowReviewEmbedSet,
    newSignNowTimingRequestId,
} from "@/utils/signnowTiming";
import {
    contractSendPackageFingerprint,
    canSendWithoutMainContract,
    resolveEffectiveSendPackage,
    validateContractSendPackage,
    type ContractSendPackageSelection,
} from "./contractdata/contractSendPackage";
import {
    buildContractSendTableRows,
    canVoidContractSendTableRow,
    canVoidMainContract,
    getContractSendTableRowStatusLabel,
    isContractSendTableRowFullySigned,
    isContractSigningFinished,
    pickPreservedDocuSignEnvelopeMetaFromPrefill,
    resolveContractSendRowFunderAuth,
    type ContractSendTableRow,
} from "./contractdata/contractSendHistory";
import { Checkbox } from "@/components/ui/checkbox";
import { AddendumSendOrderBoard } from "./AddendumSendOrderBoard";
import { ResendUnsignedContractDialog } from "./ResendUnsignedContractDialog";
import {
    DEFAULT_DOCUSIGN_TEMPLATE_ID,
} from "./contractdata/docusignTemplateConfig";
import {
    isSignNowContractUiEnabled,
    isSignNowEmbeddedCompleteMessage,
    isSignNowEnvelopeId,
    isSignNowLoginWebappUrl,
    signNowEmbeddedReturnUrl,
} from "./contractdata/contractTemplatePreview";
import {
    countAddendumRefOccurrences,
    expandAddendumRefsAllowingDuplicates,
    findExhibitCOptionRef,
    canonicalAddendumDedupKey,
    isAchDailyAddendumRef,
    isAchWeeklyAddendumRef,
    isExhibitCFamilyAddendumRef,
    isMultiInstanceAddendumRef,
    labelForAddendumInstance,
    labelForExhibitCFamilyInstance,
    MULTI_INSTANCE_ADDENDUM_MAX,
    sameAddendumPickerRef,
    setAddendumRefCount,
} from "./contractdata/multiInstanceAddendum";

const SIGNNOW_REVIEW_TOAST_ID = "signnow-review-hint";
const SIGNNOW_REVIEW_COMPLETE_TOAST_ID = "signnow-review-complete";
/** How often the locked screen re-reads the saved review state (CRM database only). */
const SIGNNOW_REVIEW_POLL_MS = 4000;
/** Named window for the Owner Review tab, so a reopen reuses the same tab. */
const SIGNNOW_REVIEW_TAB_NAME = "nitro-signnow-review";
/** Slower cadence once the review has been open a while. */
const SIGNNOW_REVIEW_POLL_SLOW_MS = 12000;
const SIGNNOW_REVIEW_POLL_BACKOFF_AFTER_MS = 3 * 60 * 1000;
/** Quiet period on the Summary step before the SignNow package is pre-warmed. */
const SIGNNOW_PREWARM_IDLE_MS = 2500;
/** Hard cap on background package copies per modal session (daily document limit). */
const SIGNNOW_PREWARM_MAX_PER_SESSION = 2;
import {
    getTemplateRoleEmailFromRow,
    getTemplateRoleLabel,
    getTemplateRoleNameFromRow,
    buildBoldSignRolesFromTemplateRecipients,
    buildContractPartySignerRows,
    buildDocuSignRolesFromEditorRows,
    buildSignerEditorRows,
    contractSignerOverridesFingerprint,
    mergeContractPrefillWithSignerOverrides,
    mergeApplicationDataIntoSignerRoles,
    parseBoldSignTemplateRolesFromRecipientsPayload,
    parseContractSignerOverridesFromPrefill,
    CONTRACT_SIGNER_OVERRIDES_KEY,
    suggestNextTemplateSignerRole,
    validateDocuSignSignerRoles,
    type ContractSignerOverrideRow,
    type DocuSignTemplateRolePayload,
} from "./contractdata/templateRecipients";
import { resolveActiveOwnerCount, clearParty2PrefillFieldPayload, collapseDocuSignRolesToSignerSlots, applyPrimaryGuarantorNamesToPrefillFields, applySecondOwnerNameToPrefillFields, resolveOwnerRowFullName, resolveSecondOwnerSignerName } from "./contractdata/contractPartyCounts";
import { resolveOwnerRowsForContractPrefill } from "./contractdata/contractOwnerPrefillRows";
import {
    applicationWithClientOwners,
    ensureSignerRowsFromCrmOwners,
    resolveOwnerPartiesForContractSigners,
    syncContractSignerRowsToCrm,
} from "./contractdata/contractSignerOwnersSync";
import { useApplicationClientOwners } from "@/hooks/useApplicationClientOwners";
import {
    boldSignTemplateIsPreviewable,
    getAddendumDropdownRef,
    getBoldSignTemplateMappingRef,
    loadBoldSignTemplatePdfBlob,
} from "./contractdata/boldSignTemplateDocument";
import { axiosDelete, axiosGet, axiosPost, axiosPut } from "@/redux/axios";

/** Fingerprint of saved prefill + live offer money — patch open DocuSign draft when either changes. */
function docuSignPrefillDraftFingerprint(input: {
    contractPrefillOverrides: Partial<BuildContractPrefillFieldsArgs> | null;
    documentTemplatePrefillByMappingId: Record<string, Record<string, string>>;
    offerDecisionMoneyKey?: string | null;
}): string {
    return JSON.stringify({
        o: input.contractPrefillOverrides ?? null,
        d: input.documentTemplatePrefillByMappingId ?? {},
        od: input.offerDecisionMoneyKey ?? "",
    });
}

function offerDecisionMoneyFingerprint(od: Record<string, unknown> | null | undefined): string {
    if (!od || typeof od !== "object") return "";
    return [
        od.offer,
        od.approvedAmount,
        od.rate,
        od.term,
        od.termLength,
        od.frequency,
        od.repayPerPeriod,
        od.paymentAmount,
        od.totalRemit,
        od.fees,
        od.numberOfPayments,
        od.paymentsTerms,
        od.monthlyPayment,
        od.ourRemit,
        od.refinanceAmount,
        od.commissionAmount,
        od.updatedAt,
    ]
        .map((v) => String(v ?? ""))
        .join("|");
}

const DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS = {
    /** Reused envelope — sender view is usually ready immediately. */
    existing: [0, 800, 1600, 2600],
    /** New envelope — DocuSign may need a moment before sender view is available. */
    justCreated: [400, 1100, 2200, 3400],
} as const;

/**
 * Open DocuSign in a new tab. Do not pass `noopener` on open — it returns `null` even when
 * the tab opened, which wrongly triggered the pop-up-blocked fallback and a second button.
 */
function tryOpenDocuSignSenderUrl(senderUrl: string): boolean {
    const opened = window.open(senderUrl, "_blank");
    if (!opened) return false;
    try {
        opened.opener = null;
    } catch {
        /* ignore */
    }
    return true;
}

function writeDocuSignLoadingTab(doc: Document): void {
    const provider =
        String(import.meta.env.VITE_SIGNNOW_ENABLED || "").toLowerCase() === "true"
            ? "SignNow"
            : "DocuSign";
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Opening ${provider}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#334155}
.box{text-align:center;padding:2rem}.spin{width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:var(--brand);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1rem}
@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spin"></div><p>Opening ${provider}…</p></div></body></html>`);
    doc.close();
}

/**
 * Placeholder for the review tab while the package is prepared. The server only
 * mints the SignNow link once every document reads back with its CRM values, so
 * this page can stay up for several seconds — it says why instead of "Opening…".
 */
function writeSignNowPreparingTab(doc: Document): void {
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Preparing documents…</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#334155}
.box{text-align:center;padding:2rem;max-width:30rem}.spin{width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:var(--brand);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1rem}
.hint{font-size:.875rem;color:#64748b}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spin"></div>
<p><strong>Preparing documents…</strong></p><p class="hint">Filling and validating the Disclosure, Contract and Addendum fields. SignNow opens here once every field is confirmed.</p></div></body></html>`);
    doc.close();
}

/** What the Review button is waiting on before SignNow may open. */
type SignNowPreparePhase = "preparing" | "validating";

function resolveDealStateFromApplication(applicationData: unknown): string {
    const ad = applicationData as Record<string, unknown> | null | undefined;
    if (!ad || typeof ad !== "object") return "";
    const bi0 = Array.isArray(ad.businessInfo)
        ? (ad.businessInfo[0] as Record<string, unknown>)
        : undefined;
    const client = ad.client as Record<string, unknown> | undefined;
    const biz = (client?.business ?? {}) as Record<string, unknown>;
    const addr = (biz.address ?? {}) as Record<string, unknown>;
    return pickUsStateForSelect(
        addr.state ?? client?.businessState ?? client?.state ?? bi0?.state,
    );
}

function writeDocuSignErrorTab(doc: Document, message: string): void {
    const safe = String(message)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>DocuSign</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fef2f2;color:#991b1b;padding:1rem}
.box{max-width:28rem;text-align:center}</style></head><body><div class="box"><p><strong>Could not open DocuSign</strong></p><p>${safe}</p></div></body></html>`);
    doc.close();
}

interface PDFViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Called after contract / ACH DocuSign envelope metadata is saved on the contract row. */
    onContractDocumentsChanged?: () => void;
    fileUrl: string | null;
    fileName?: string;
    contractId?: number | null;
    applicationId?: string | null;
    layout?: "contract";
    /** Create DocuSign draft (prefill, do not email signers). */
    onPrepareDocuSignDraft?: (payload: {
        ccEmails: string[];
        addendumDocumentRef?: string | null;
        addendumDocumentRefs?: string[] | null;
        addendumBoldSignTemplateId?: string | null;
        /** CRM BoldSignTemplate row id (state disclosure) merged after addendum. */
        disclosureDocumentRef?: string | null;
        achDocumentRef?: string | null;
        standaloneAchOnly?: boolean;
        includeMainContract?: boolean;
        sendPackage?: ContractSendPackageSelection;
        roles?: DocuSignTemplateRolePayload[];
        funderName?: string | null;
        funderProfileId?: string | null;
        contractState?: string | null;
        mainContractLayoutKey?: string | null;
        /** Current Deal Review values — always applied on each Review & send open. */
        prefillFields?: Array<{ id: string; value: string }>;
        /** Live "$25 wire fee" preference — not a document field, so it is passed separately. */
        includeWireFee?: unknown;
        /** SignNow: false opens an in-CRM review iframe; true emails signers immediately. */
        autoSend?: boolean;
        /** Correlation id for SignNow Review timing logs only. */
        timingRequestId?: string;
    }) => void | Promise<
        void | {
            envelopeId?: string;
            prefillTabsApplied?: number;
            prefillFieldCount?: number;
            sendUrl?: string | null;
            embeddedInviteUrl?: string | null;
        }
    >;
    prefillFieldsPreview?: Array<{ id: string; label?: string; value: string }>;
    // Backward compatibility while migrating existing callers.
    onSendToDocusign?: (ccEmails: string[]) => void;
    templateId?: string | null;
    initialRightPaneTab?: "template" | "prefilled";
}

type ContractDocumentTemplateMappingRow = {
    id: string;
    contractId: number;
    templateId: string;
    documentType: string;
    order: number;
    createdAt?: string;
    template?: {
        id: string;
        name?: string;
        title?: string;
        templateName?: string;
        type?: string;
        state?: string | null;
        templateId?: string;
        pdfUrl?: string;
        layoutKey?: string;
    } | null;
};

type InfoPanelId = "addendum" | "ach" | "epo" | "owner" | "guarantor";

function sameOrderedStrings(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function addendumMappingTemplateRef(
    row: ContractDocumentTemplateMappingRow | null | undefined,
): string {
    if (!row) return "";
    return (
        getAddendumDropdownRef(row.template) ||
        getBoldSignTemplateMappingRef(row.template) ||
        ""
    );
}

function isDisclosureMappingRow(row: ContractDocumentTemplateMappingRow): boolean {
    return String(row.documentType || "").toLowerCase() === "disclosure";
}

function disclosureMappingIsSignNowPermanent(
    row: ContractDocumentTemplateMappingRow | null | undefined,
): boolean {
    if (!row) return false;
    return isSignNowDisclosureLayoutKey(
        row.template?.layoutKey || row.template?.templateId || row.templateId || "",
    );
}

function normalizeStateForTemplateLookup(state: string): string {
    return String(state ?? "").trim().toLowerCase();
}

function normalizeFrequencyForTemplateLookup(frequency: string): string {
    const f = String(frequency ?? "").trim().toLowerCase();
    if (f.startsWith("week")) return "weekly";
    if (f.startsWith("day")) return "daily";
    if (f.startsWith("month")) return "monthly";
    return f || "daily";
}

function formatDisclosureTemplateLabel(row: ContractDocumentTemplateMappingRow | null): string {
    if (!row) return "State disclosure";
    const name = String(row.template?.name ?? "").trim();
    if (name) {
        const noExt = name.replace(/\.pdf$/i, "");
        return noExt
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(" ");
    }
    const state = String(row.template?.state ?? "").trim();
    if (state) {
        return state
            .split(/[\s_]+/)
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }
    return "State disclosure";
}

function mappingTemplateRowId(
    row: Pick<ContractDocumentTemplateMappingRow, "template" | "templateId"> | null | undefined,
): string {
    return String(row?.template?.id ?? row?.templateId ?? "").trim();
}

function mappingMatchesTemplateRef(
    row: ContractDocumentTemplateMappingRow,
    templateRef: string,
): boolean {
    const ref = String(templateRef || "").trim();
    if (!ref) return false;
    const layoutKey = String(row.template?.layoutKey ?? "").trim();
    const templateId = String(row.template?.templateId ?? "").trim();
    const rowId = mappingTemplateRowId(row);
    return ref === layoutKey || ref === templateId || ref === rowId;
}

/** Canonical state key for disclosure matching (ca/california, ny/new york/newyork). */
function disclosureStateMatchKey(state: string): string {
    return (
        normalizeBoldSignTemplateStateKey(pickUsStateForSelect(state) || state) ||
        normalizeStateForTemplateLookup(state).replace(/[\s_-]+/g, "")
    );
}

function disclosureTemplateBlobMatchesState(
    template: {
        name?: string | null;
        layoutKey?: string | null;
        templateId?: string | null;
    } | null | undefined,
    stateKey: string,
): boolean {
    if (!stateKey) return false;
    const blob = `${String(template?.name ?? "")} ${String(template?.layoutKey ?? "")} ${String(template?.templateId ?? "")}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");
    if (!blob.replace(/_/g, "")) return false;

    const needles = new Set<string>([
        stateKey,
        stateKey.replace(/\s+/g, ""),
        stateKey.replace(/\s+/g, "_"),
    ]);
    // Short postal codes only as delimited tokens (avoid "ca" matching "california" twice).
    const postalByKey: Record<string, string> = {
        california: "ca",
        newyork: "ny",
        connecticut: "ct",
        florida: "fl",
        georgia: "ga",
        kansas: "ks",
        utah: "ut",
        virginia: "va",
        missouri: "mo",
        louisiana: "la",
        texas: "tx",
    };
    const postal = postalByKey[stateKey];
    if (postal) needles.add(postal);

    for (const token of needles) {
        if (!token) continue;
        if (token.length <= 2) {
            if (
                blob.includes(`_${token}_`) ||
                blob.startsWith(`${token}_`) ||
                blob.endsWith(`_${token}`) ||
                blob === token
            ) {
                return true;
            }
            continue;
        }
        const slug = token.replace(/\s+/g, "_");
        if (
            blob.includes(`_${slug}_`) ||
            blob.startsWith(`${slug}_`) ||
            blob.endsWith(`_${slug}`) ||
            blob.includes(slug)
        ) {
            return true;
        }
    }
    return false;
}

function isDisclosureCatalogRow(row: {
    type?: string | null;
    layoutKey?: string | null;
    templateId?: string | null;
    name?: string | null;
} | null | undefined): boolean {
    if (!row) return false;
    if (String(row.type || "").trim().toLowerCase() === "disclosure") return true;
    return templateLayoutKeyToken(row).includes("disclosure");
}

function isPersistedFunderUuid(id: string | null | undefined): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        String(id ?? "").trim(),
    );
}

function disclosureMappingMatchesState(
    row: ContractDocumentTemplateMappingRow | null | undefined,
    state: string,
): boolean {
    if (!row) return false;
    const picked = disclosureStateMatchKey(state);
    if (!picked) return false;
    const templateState = disclosureStateMatchKey(String(row.template?.state ?? ""));
    if (templateState && templateState === picked) return true;
    // Platform / legacy rows sometimes omit `state` but encode it in name/layoutKey.
    if (disclosureTemplateBlobMatchesState(row.template, picked)) return true;
    return disclosureTemplateBlobMatchesState(
        {
            name: row.template?.name,
            layoutKey: row.template?.layoutKey ?? row.templateId,
            templateId: row.template?.templateId ?? row.templateId,
        },
        picked,
    );
}

function templateLayoutKeyToken(template: {
    layoutKey?: string | null;
    templateId?: string | null;
} | null | undefined): string {
    return String(template?.layoutKey ?? template?.templateId ?? "")
        .trim()
        .toLowerCase();
}

/** True when template is an addendum (not ACH) for the contract addendum picker. */
function isContractAddendumTemplateRow(template: {
    type?: string | null;
    name?: string | null;
    title?: string | null;
    templateName?: string | null;
    layoutKey?: string | null;
    templateId?: string | null;
} | null | undefined): boolean {
    if (!template) return false;
    const key = templateLayoutKeyToken(template);
    const typeText = String(template.type || "").toLowerCase();
    const nameText = String(
        template.name || template.title || template.templateName || "",
    ).toLowerCase();
    if (isSignNowAddendumLayoutKey(key) || key === "ach_daily" || key === "ach_weekly" || key === "exhibit_c" || key === "exhibit_a" || key === "payoff_addendum" || key === "epa" || key === "monthly_fee") {
        if (key === "flex_addendum" || key.endsWith("_flex_addendum")) {
            return true;
        }
        return isSignNowContractUiEnabled();
    }
    if (
        key.includes("ach_authorization") ||
        typeText === "ach" ||
        typeText === "ach_authorization" ||
        (nameText.includes("ach") && nameText.includes("authorization"))
    ) {
        return false;
    }
    if (
        key === "flex_addendum" ||
        key === "pre_payment_addendum" ||
        key === "balance_transfer" ||
        key === "case_takeover_addendum" ||
        key === "case_takeover_balance_transfer" ||
        key.endsWith("_flex_addendum") ||
        key.endsWith("_pre_payment_addendum") ||
        key.endsWith("_case_takeover_addendum") ||
        key.endsWith("_case_takeover_balance_transfer") ||
        key.endsWith("_balance_transfer") ||
        key.includes("_addendum_") ||
        key.endsWith("_addendum")
    ) {
        return true;
    }
    return (
        typeText.includes("addendum") ||
        typeText === "flex_addendum" ||
        typeText === "pre_payment_addendum" ||
        typeText === "balance_transfer" ||
        typeText === "case_takeover_addendum" ||
        typeText === "case_takeover_balance_transfer" ||
        nameText.includes("addendum") ||
        nameText.includes("balance transfer") ||
        nameText.includes("case takeover")
    );
}

/**
 * Platform (`documentsSource: platform`) → non-`funder_` templates.
 * Own / shared → only `funder_{docsFunderId}_…` templates.
 */
function templateMatchesFunderDocuments(
    template: {
        layoutKey?: string | null;
        templateId?: string | null;
    } | null | undefined,
    docsLayoutFunderId: string | null,
): boolean {
    const key = templateLayoutKeyToken(template);
    if (docsLayoutFunderId) {
        const prefix = `funder_${String(docsLayoutFunderId).trim()}_`.toLowerCase();
        return key.startsWith(prefix);
    }
    return isPlatformScopedBoldSignTemplateRow({ layoutKey: key || null });
}

/** Whether an addendum dropdown ref is valid for the funder's current docs source scope. */
function isAddendumRefValidForDocsFunder(
    ref: string,
    docsLayoutFunderId: string | null,
    templates: Array<{
        layoutKey?: string | null;
        templateId?: string | null;
        type?: string | null;
        name?: string | null;
    }>,
): boolean {
    const trimmed = String(ref || "").trim();
    if (!trimmed) return false;
    if (isSignNowAddendumLayoutKey(trimmed)) return true;
    const inDb = templates.some(
        (t) =>
            isContractAddendumTemplateRow(t) &&
            templateMatchesFunderDocuments(t, docsLayoutFunderId) &&
            getAddendumDropdownRef(t) === trimmed,
    );
    if (inDb) return true;
    // Platform defaults expose synthetic Flex / Pre-Payment / BT keys (not Case Takeover).
    if (!docsLayoutFunderId) {
        return CONTRACT_ADDENDUM_DOCUMENT_OPTIONS.some(
            (opt) => opt.layoutKey === trimmed,
        );
    }
    return false;
}

/** Settings → Funders SignNow addendum links only (no hardcoded Nitro fallback). */
function withSignNowAddendumOptions(
    options: any[],
    funderProfile?: {
        signnowAddendumTemplates?: Array<{ name: string; link: string }> | null;
    } | null,
): any[] {
    if (!isSignNowContractUiEnabled()) return options;
    const existingKeys = new Set(
        options.map((t: any) => templateLayoutKeyToken(t)).filter(Boolean),
    );
    const fromFunder = funderSignNowAddendumOptions(funderProfile as any);
    const extras = fromFunder
        .filter((opt) => !existingKeys.has(opt.layoutKey) && !existingKeys.has(opt.templateId))
        .map((opt) => ({
            id: opt.id,
            // Unique per funder (SignNow template id) — avoids Nitro catalog collisions.
            layoutKey: opt.layoutKey,
            templateId: opt.templateId,
            name: opt.name,
            type: "addendum",
            pdfUrl: opt.pdfUrl,
            knownLayoutKey: opt.knownLayoutKey || undefined,
        }));
    return extras.length ? [...options, ...extras] : options;
}

function disclosureMappingMatchesFunderDocuments(
    row: ContractDocumentTemplateMappingRow | null | undefined,
    docsLayoutFunderId: string | null,
    platformDisclosureFunderId?: string | null,
    selectedFunderId?: string | null,
): boolean {
    if (!row) return false;
    if (templateMatchesFunderDocuments(row.template, docsLayoutFunderId)) return true;
    // Common Nitro Advance / platform disclosure uploads are valid for every funder
    // that falls back to that shared set (incl. Clear Capital with platform source).
    const platformId = String(platformDisclosureFunderId ?? "").trim();
    if (
        platformId &&
        platformId !== String(docsLayoutFunderId ?? "").trim() &&
        templateMatchesFunderDocuments(row.template, platformId)
    ) {
        return true;
    }
    // Disclosure PDFs owned by this funder stay valid even when docs source points
    // at the platform owner (common set uploaded under the funder's own keys).
    const ownId = String(selectedFunderId ?? "").trim();
    if (
        ownId &&
        ownId !== String(docsLayoutFunderId ?? "").trim() &&
        ownId !== platformId &&
        templateMatchesFunderDocuments(row.template, ownId)
    ) {
        return true;
    }
    return false;
}

/** Extract owning funder UUID from `funder_{uuid}_…` layout keys. */
function funderIdFromDisclosureLayoutKey(
    template: {
        layoutKey?: string | null;
        templateId?: string | null;
    } | null | undefined,
): string | null {
    const key = templateLayoutKeyToken(template);
    const match = key.match(/^funder_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_/i);
    return match?.[1] ? match[1].toLowerCase() : null;
}

function disclosureRowFrequencyToken(row: {
    frequency?: string | null;
    name?: string | null;
    layoutKey?: string | null;
    templateId?: string | null;
}): string {
    const fromField = String(row.frequency ?? "").trim();
    if (fromField) return normalizeFrequencyForTemplateLookup(fromField);
    const blob = `${String(row.name ?? "")} ${String(row.layoutKey ?? "")} ${String(row.templateId ?? "")}`.toLowerCase();
    if (blob.includes("biweek") || blob.includes("bi-week")) return "biweekly";
    if (blob.includes("week")) return "weekly";
    if (blob.includes("month")) return "monthly";
    if (blob.includes("daily") || /(?:^|[^a-z])day(?:[^a-z]|$)/.test(blob)) return "daily";
    return "";
}

function disclosureRowMatchesWantedFrequency(
    row: {
        frequency?: string | null;
        name?: string | null;
        layoutKey?: string | null;
        templateId?: string | null;
    },
    frequency: string,
): boolean {
    const wanted = normalizeFrequencyForTemplateLookup(frequency);
    const rowToken = disclosureRowFrequencyToken(row);
    // No cadence signal → not a positive frequency match (avoids picking the
    // wrong common disclosure when many shared rows exist for both funders).
    if (!rowToken) return false;
    return rowToken === wanted;
}

function pickDisclosureTemplateIdForFunder(
    rows: Array<{
        id?: string;
        pdfUrl?: string | null;
        layoutKey?: string | null;
        templateId?: string | null;
        name?: string | null;
        frequency?: string | null;
        state?: string | null;
    }>,
    docsLayoutFunderId: string | null,
    state: string,
    frequency: string,
    isRefinance = false,
    platformDisclosureFunderId?: string | null,
): string | null {
    const usable = rows.filter(
        (row) =>
            String(row?.id ?? "").trim() &&
            (String(row?.pdfUrl ?? "").trim() ||
                String(row?.layoutKey ?? row?.templateId ?? "").trim()),
    );
    if (!usable.length) return null;

    const stateMatched = usable.filter((row) => {
        const picked = disclosureStateMatchKey(state);
        if (!picked) return true;
        const rowState = disclosureStateMatchKey(String(row.state ?? ""));
        if (rowState && rowState === picked) return true;
        return disclosureTemplateBlobMatchesState(row, picked);
    });
    const statePool = stateMatched.length ? stateMatched : usable;

    const freqMatched = statePool.filter((row) =>
        disclosureRowMatchesWantedFrequency(row, frequency),
    );
    const pool = freqMatched.length ? freqMatched : statePool;

    const prefersRefiName = (row: { name?: string | null; layoutKey?: string | null; templateId?: string | null }) => {
        const blob = `${String(row.name ?? "")} ${String(row.layoutKey ?? "")} ${String(row.templateId ?? "")}`.toLowerCase();
        return blob.includes("refi") && !blob.includes("no_refi") && !blob.includes("norefi") && !blob.includes("no refi");
    };
    const prefersNoRefiName = (row: { name?: string | null; layoutKey?: string | null; templateId?: string | null }) => {
        const blob = `${String(row.name ?? "")} ${String(row.layoutKey ?? "")} ${String(row.templateId ?? "")}`.toLowerCase();
        return blob.includes("no_refi") || blob.includes("norefi") || blob.includes("no refi");
    };

    const pickFromScoped = (
        scoped: typeof pool,
        funderIdForKeys: string | null,
    ): string | null => {
        if (!scoped.length) return null;
        const byKey = (key: string) =>
            scoped.find((row) => templateLayoutKeyToken(row) === key);
        if (funderIdForKeys) {
            const exactKey = funderDisclosureLayoutKeyForState(
                funderIdForKeys,
                state,
                frequency,
                isRefinance ? "refi" : undefined,
            ).toLowerCase();
            const legacyKey = funderDisclosureLayoutKeyForState(
                funderIdForKeys,
                state,
                frequency,
            ).toLowerCase();
            const norefiKey = funderDisclosureLayoutKeyForState(
                funderIdForKeys,
                state,
                frequency,
                "norefi",
            ).toLowerCase();
            if (isRefinance) {
                const match =
                    byKey(exactKey) ??
                    scoped.find(prefersRefiName) ??
                    byKey(legacyKey) ??
                    scoped[0];
                return match?.id ? String(match.id) : null;
            }
            const match =
                byKey(norefiKey) ??
                scoped.find(prefersNoRefiName) ??
                byKey(legacyKey) ??
                scoped.find((row) => !prefersRefiName(row)) ??
                scoped[0];
            return match?.id ? String(match.id) : null;
        }
        if (isRefinance) {
            const match = scoped.find(prefersRefiName) ?? scoped[0];
            return match?.id ? String(match.id) : null;
        }
        const match =
            scoped.find(prefersNoRefiName) ??
            scoped.find((row) => !prefersRefiName(row)) ??
            scoped[0];
        return match?.id ? String(match.id) : null;
    };

    const pickForFunderId = (funderId: string | null | undefined): string | null => {
        const id = String(funderId ?? "").trim();
        if (!isPersistedFunderUuid(id)) return null;
        const prefix = `funder_${id}_`.toLowerCase();
        const scoped = pool.filter((row) => {
            const key = templateLayoutKeyToken(row);
            return key.startsWith(prefix) && key.includes("disclosure");
        });
        return pickFromScoped(scoped, id);
    };

    // 1) Selected funder's disclosure scope (own / shared / platform-owner id).
    const fromPrimary = pickForFunderId(docsLayoutFunderId);
    if (fromPrimary) return fromPrimary;

    // 2) Common Nitro Advance set — both funders share these uploads.
    const platformOwnerId = String(platformDisclosureFunderId ?? "").trim();
    if (
        platformOwnerId &&
        platformOwnerId.toLowerCase() !== String(docsLayoutFunderId ?? "").trim().toLowerCase()
    ) {
        const fromPlatformOwner = pickForFunderId(platformOwnerId);
        if (fromPlatformOwner) return fromPlatformOwner;
    }

    // 3) Legacy non-funder_ platform rows.
    const legacyPlatform = pool.filter((row) => isPlatformScopedBoldSignTemplateRow(row));
    const fromLegacy = pickFromScoped(legacyPlatform, null);
    if (fromLegacy) return fromLegacy;

    // 4) Common funder_* disclosure pack for this state — try every owning funder
    // (all states share the same owner). Prefer platform owner, then most rows.
    const ownerIds = [
        ...new Set(
            pool
                .map((row) => funderIdFromDisclosureLayoutKey(row))
                .filter((id): id is string => Boolean(id)),
        ),
    ];
    if (ownerIds.length) {
        const platformLower = platformOwnerId.toLowerCase();
        const ranked = [...ownerIds].sort((a, b) => {
            if (platformLower && a === platformLower) return -1;
            if (platformLower && b === platformLower) return 1;
            const countA = pool.filter(
                (row) => funderIdFromDisclosureLayoutKey(row) === a,
            ).length;
            const countB = pool.filter(
                (row) => funderIdFromDisclosureLayoutKey(row) === b,
            ).length;
            return countB - countA;
        });
        for (const ownerId of ranked) {
            if (
                ownerId === String(docsLayoutFunderId ?? "").trim().toLowerCase() ||
                ownerId === platformLower
            ) {
                // Already tried in steps 1–2.
                continue;
            }
            const hit = pickForFunderId(ownerId);
            if (hit) return hit;
        }
        // Last resort: retry ranked owners including ones skipped above (e.g. pdf
        // filter / refi preference differed when scoped earlier).
        for (const ownerId of ranked) {
            const hit = pickForFunderId(ownerId);
            if (hit) return hit;
        }
    }

    // 5) Any PDF for this state, regardless of funder prefix (common pack).
    if (stateMatched.length) {
        const fromAny = pickFromScoped(stateMatched, null);
        if (fromAny) return fromAny;
    }

    return null;
}

/** Addendum kinds auto-picked on Contract tab from funder uploads. */
type AutoSelectAddendumKind =
    | "addendum_p"
    | "addendum_ca"
    | "addendum_ny"
    | "addendum_va";

/**
 * Auto-select rules (multiple allowed) — Guide:
 * - REFI → Addendum P
 * - CA → Addendum CA
 * - NY → Addendum NY
 * - VA → Addendum VA
 * ACH Daily / Weekly are not auto-attached by frequency; pick them manually.
 */
function resolveWantedAutoAddendumKinds(
    state: string,
    isRefinance: boolean,
): AutoSelectAddendumKind[] {
    const picked = normalizeStateForTemplateLookup(
        pickUsStateForSelect(state) || state,
    );
    return resolveWantedAddendumKinds(
        picked,
        isRefinance,
    ) as AutoSelectAddendumKind[];
}

function resolveTemplateAutoAddendumKind(template: {
    type?: string | null;
    name?: string | null;
    layoutKey?: string | null;
    templateId?: string | null;
} | null | undefined): AutoSelectAddendumKind | null {
    if (!template) return null;
    const type = String(template.type || "").trim().toLowerCase();
    const key = templateLayoutKeyToken(template).toLowerCase();
    const name = String(template.name || "").toLowerCase();

    if (
        type === "addendum_ca" ||
        key.endsWith("_addendum_ca") ||
        key === "addendum_ca" ||
        (name.includes("addendum") &&
            (name.includes(" ca") ||
                name.endsWith(" ca") ||
                name.includes("california") ||
                /addendum[_\s-]*ca\b/.test(name)))
    ) {
        return "addendum_ca";
    }
    if (
        type === "addendum_ny" ||
        key.endsWith("_addendum_ny") ||
        key === "addendum_ny" ||
        (name.includes("addendum") &&
            (name.includes(" ny") ||
                name.includes("new york") ||
                name.includes("new_york") ||
                /addendum[_\s-]*ny\b/.test(name)))
    ) {
        return "addendum_ny";
    }
    if (
        type === "addendum_va" ||
        key.endsWith("_addendum_va") ||
        key === "addendum_va" ||
        (name.includes("addendum") &&
            (name.includes(" va") ||
                name.includes("virginia") ||
                /addendum[_\s-]*va\b/.test(name)))
    ) {
        return "addendum_va";
    }
    if (
        type === "addendum_p" ||
        key.endsWith("_addendum_p") ||
        key.endsWith("_addendum_p_refi") ||
        key === "addendum_p" ||
        /\baddendum\s*p\b/.test(name) ||
        (name.includes("addendum") && name.includes("refi") && !name.includes("ca") && !name.includes("ny") && !name.includes("va"))
    ) {
        return "addendum_p";
    }
    return null;
}

function pickAddendumTemplateRefsForKinds(
    rows: Array<{
        id?: string;
        pdfUrl?: string | null;
        layoutKey?: string | null;
        templateId?: string | null;
        name?: string | null;
        type?: string | null;
    }>,
    docsLayoutFunderId: string | null,
    kinds: AutoSelectAddendumKind[],
): string[] {
    if (!kinds.length) return [];
    const scoped = rows.filter((row) => {
        if (!isContractAddendumTemplateRow(row)) return false;
        if (!templateMatchesFunderDocuments(row, docsLayoutFunderId)) return false;
        return Boolean(String(row?.pdfUrl ?? "").trim());
    });
    const refs: string[] = [];
    for (const kind of kinds) {
        const match = scoped.find(
            (row) => resolveTemplateAutoAddendumKind(row) === kind,
        );
        const ref = match ? getAddendumDropdownRef(match) : "";
        if (ref && !refs.includes(ref)) refs.push(ref);
    }
    return refs;
}

function isRefinanceApplicationType(type: unknown): boolean {
    const t = String(type ?? "")
        .trim()
        .toLowerCase();
    return t === "refinance" || t === "refi";
}

/** Prefer application.type (Create Application); fall back to offer REFI amount. */
function applicationIsRefinance(
    application?: Record<string, unknown> | null,
    offerDecision?: Record<string, unknown> | null,
): boolean {
    if (isRefinanceApplicationType(application?.type)) return true;
    const refiRaw = offerDecision?.refinanceAmount ?? offerDecision?.RefinanceAmount;
    const refiNum =
        typeof refiRaw === "number"
            ? refiRaw
            : Number(String(refiRaw ?? "").replace(/[$,\s]/g, ""));
    return Number.isFinite(refiNum) && refiNum > 0;
}

function toUsDateDisplay(value: string): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) return raw;
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        const yyyy = raw.slice(0, 4);
        const mm = raw.slice(5, 7);
        const dd = raw.slice(8, 10);
        return `${mm}/${dd}/${yyyy}`;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return new Intl.DateTimeFormat("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        timeZone: "UTC",
    }).format(d);
}

function toUsMoneyDisplay(value: string): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.startsWith("$")) return raw;
    const n = Number(raw.replace(/[$,%\s,]/g, ""));
    if (!Number.isFinite(n)) return raw;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(n);
}

/** Server-side field encryption envelope (CRM stored sensitive bank fields). */
function isProbablyEncryptedStoredValue(raw: string): boolean {
    return raw.startsWith("enc:v1:") || raw.startsWith("enc:v2:");
}

/**
 * Deal Review / BoldSign preview should not leak ciphertext; show placeholders for ACH-style fields.
 * (Real decryption stays on the backend when needed.)
 */
function placeholderForEncryptedBankField(fieldKey: string, rawEncrypted: string): string | null {
    if (!isProbablyEncryptedStoredValue(rawEncrypted)) return null;
    const k = fieldKey.toLowerCase().replace(/\s+/g, "_");
    // Skip obvious non-numeric ACH labels (still encrypted in DB occasionally).
    if (/\b(holder|merchant|dba|signatory|name|ein|tax|business|authorization_application)\b/i.test(fieldKey)) {
        return null;
    }
    if (k.includes("routing")) return "1234567809";
    if (
        (k.includes("account") || k.includes("_acct") || k.includes("acct_")) &&
        (k.includes("bank") || k.includes("checking") || k.includes("deposit"))
    ) {
        return "1234567890";
    }
    // Plain ids like camelCase routingNumber / accountNumber on ACH rows (if surfaced as encrypted later).
    if (k === "routingnumber" || k.endsWith("_routingnumber") || k.endsWith("_routing_number")) return "1234567809";
    if (k === "accountnumber" || k.endsWith("_accountnumber") || k.endsWith("_account_number")) return "1234567890";

    return null;
}

function formatDisplayValueForUs(fieldKey: string, value: unknown): string {
    if (value === null || value === undefined) return "—";
    const s = String(value).trim();
    if (!s) return "—";

    const ph = placeholderForEncryptedBankField(fieldKey, s);
    if (ph !== null) return ph;
    const key = fieldKey.toLowerCase();

    if (key.includes("date")) {
        return toUsDateDisplay(s);
    }

    if (
        key === "frequency" ||
        key.includes("paymentterm") ||
        key.includes("payment_term") ||
        key.includes("paymentfrequency")
    ) {
        return coercePaymentFrequencyLabel(s) || s;
    }

    const moneyLike =
        key.includes("amount") ||
        key.includes("price") ||
        key.includes("fees") ||
        key.includes("remit") ||
        key.includes("commission") ||
        key.includes("offer") ||
        key.includes("payment") ||
        key.includes("netfund") ||
        key.includes("net_fund");
    const notMoneyLike = key.includes("percent") || key.includes("rate");
    if (moneyLike && !notMoneyLike) {
        return toUsMoneyDisplay(s);
    }

    return s;
}

function formatOfferDecisionCell(label: string, value: unknown): string {
    return formatDisplayValueForUs(label, value);
}

function formatContractSigningStatusLabel(raw: unknown): string {
    const k = String(raw ?? "").trim().toUpperCase();
    const labels: Record<string, string> = {
        DRAFT: "Draft",
        SENT: "Sent — awaiting signature",
        VIEWED: "Viewed by signer",
        SIGNED: "Signed",
        COMPLETED: "Completed",
        DECLINED: "Declined",
        REVOKED: "Revoked",
        EXPIRED: "Expired",
    };
    if (labels[k]) return labels[k];
    if (!k) return "Loading…";
    return k
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isContractStatusAtLeastSent(raw: unknown): boolean {
    const k = String(raw ?? "").trim().toUpperCase();
    return ["SENT", "VIEWED", "SIGNED", "COMPLETED", "DECLINED", "REVOKED", "EXPIRED"].includes(k);
}

function pickContractEnvelopeDocument(contract: Record<string, unknown> | null | undefined) {
    const app = contract && (contract as any).application;
    const doc = app && typeof app === "object" ? (app as any).document : null;
    if (doc && typeof doc === "object") return doc as Record<string, unknown>;
    return null;
}

/**
 * One shared empty array for redux slices that may hold a non-array while loading.
 * `Array.isArray(x) ? x : []` mints a NEW [] on every render, and that identity
 * propagates through the addendum useMemo chain into AddendumSendOrderBoard,
 * whose sync effect then calls setState on every render — the render churn that
 * kept framer-motion's layout animations re-measuring the send-order list.
 */
const EMPTY_LIST: never[] = [];

const DOCUSIGN_DOC_DRAFT_STATUSES = new Set(["draft", "created"]);

const DOCUSIGN_DOC_SENT_STATUSES = new Set([
    "sent",
    "viewed",
    "signed",
    "completed",
    "delivered",
    "declined",
    "revoked",
    "expired",
]);

/**
 * True only when signers were emailed / contract left draft — not when a DocuSign draft exists.
 */
function isContractAlreadySent(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
): boolean {
    if (sessionSentAt) return true;
    const doc = pickContractEnvelopeDocument(contract);
    if (doc?.sentAt) return true;
    if (doc?.envelopeId) {
        const docStatus = String(doc.status ?? "").trim().toLowerCase();
        if (DOCUSIGN_DOC_DRAFT_STATUSES.has(docStatus)) {
            /**
             * Document row can lag after send while Contract.status / send history already show Sent
             * (Contracts Generated table). Backend only bumps Contract.status for the primary envelope.
             */
            if (isContractStatusAtLeastSent(contract?.status)) return true;
            return false;
        }
        if (DOCUSIGN_DOC_SENT_STATUSES.has(docStatus)) return true;
        return false;
    }
    return isContractStatusAtLeastSent(contract?.status);
}

/** Cache bust suffix — only draft / sent / completed (ignore viewed, delivered, etc.). */
function getDocuSignPdfCacheSuffix(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
): string {
    const doc = pickContractEnvelopeDocument(contract);
    const contractStatus = String(contract?.status ?? "").trim().toLowerCase();
    const docStatus = String(doc?.status ?? "").trim().toLowerCase();
    const completedAt = doc?.completedAt;
    if (contractStatus === "completed" || docStatus === "completed") {
        return completedAt ? `completed:${String(completedAt)}` : "completed";
    }
    if (sessionSentAt || isContractAlreadySent(contract, sessionSentAt)) {
        return "sent";
    }
    return "draft";
}

function envelopeDocStatusIsTerminal(doc: Record<string, unknown> | null): boolean {
    const docStatus = String(doc?.status ?? "").trim().toLowerCase();
    return ["revoked", "voided", "declined", "expired", "completed"].includes(docStatus);
}

/** Main contract envelope only — standalone ACH must not affect cancel / review actions. */
function getPrimaryContractEnvelopeView(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
) {
    const doc = pickContractEnvelopeDocument(contract);
    const docStatus = String(doc?.status ?? "").trim().toLowerCase();
    const hasEnvelope = Boolean(String(doc?.envelopeId ?? "").trim());
    const isDraft =
        !hasEnvelope ||
        (DOCUSIGN_DOC_DRAFT_STATUSES.has(docStatus) && !doc?.sentAt);
    const isCompleted = docStatus === "completed";
    const isTerminal = envelopeDocStatusIsTerminal(doc);
    const isOutForSignature =
        hasEnvelope &&
        !isDraft &&
        !isCompleted &&
        !isTerminal &&
        (Boolean(doc?.sentAt) ||
            ["sent", "viewed", "signed", "delivered"].includes(docStatus));
    const sessionContractActive = Boolean(sessionSentAt) && isOutForSignature;
    return {
        doc,
        docStatus,
        isDraft,
        isCompleted,
        isOutForSignature: isOutForSignature || sessionContractActive,
    };
}

/** Open DocuSign for the main contract — draft, after void, resend after signed, or send-new while out for signature. */
function canReviewAndSendToDocuSign(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
): boolean {
    if (canResendMainContract(contract, sessionSentAt)) return true;
    const { isDraft, isOutForSignature } = getPrimaryContractEnvelopeView(
        contract,
        sessionSentAt,
    );
    if (isOutForSignature) return false;
    if (isContractAlreadySent(contract, sessionSentAt)) return false;
    return isDraft || !pickContractEnvelopeDocument(contract)?.envelopeId;
}

/**
 * New envelope allowed after fully signed/voided, or while out for signature
 * (creates a new envelope without voiding the previous one).
 */
function canResendMainContract(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
): boolean {
    const view = getPrimaryContractEnvelopeView(contract, sessionSentAt);
    const contractStatus = String(contract?.status ?? "").trim().toUpperCase();
    const docStatus = view.docStatus;

    if (view.isOutForSignature) return true;

    if (view.isCompleted || contractStatus === "COMPLETED") return true;
    if (docStatus === "signed") return true;

    if (["revoked", "voided", "declined", "expired"].includes(docStatus)) return true;
    if (["REVOKED", "DECLINED", "EXPIRED"].includes(contractStatus)) return true;

    return false;
}

function resolveLatestEnvelopeStatus(
    contract: Record<string, unknown> | null | undefined,
): string {
    const doc = pickContractEnvelopeDocument(contract);
    const docStatus = String(doc?.status ?? "").trim();
    if (docStatus && !DOCUSIGN_DOC_DRAFT_STATUSES.has(docStatus.toLowerCase())) {
        return docStatus;
    }
    return String(contract?.status ?? "").trim();
}

type PdfRightPaneTab = "template" | "docusign";
/**
 * Template roles often embed placeholder `defaultSignerEmail` in BoldSign that drifts from CRM.
 * For Client / Owner / Merchant slots, prefer resolved CRM email (`Contract.clientEmail`, then Client).
 * Guarantor slots keep the template default only (do not inject merchant email).
 */
function mergeBoldSignRoleSignerEmail(roleName: unknown, boldSignDefaultEmail: unknown, crmSignerEmail: string): string {
    const rl = String(roleName ?? "").toLowerCase();
    const bs = String(boldSignDefaultEmail ?? "").trim();
    const crm = String(crmSignerEmail ?? "").trim();
    if (rl.includes("guarantor")) return bs;
    return crm || bs;
}

/** Use saved signer override emails as-is; only merge CRM email when showing template defaults. */
function resolveSignerEmailForSummary(
    roleLabel: string,
    rowEmail: string,
    crmSignerEmail: string,
    useSavedSignerOverrides: boolean,
): string {
    const saved = String(rowEmail ?? "").trim();
    if (useSavedSignerOverrides && saved) return saved;
    return mergeBoldSignRoleSignerEmail(roleLabel, saved, crmSignerEmail);
}

/** Direct PDF renderer using react-pdf (template PDF and post-send downloads). */
function DirectPdfViewer({
    fileUrl,
    fileName = "document.pdf",
    errorMessage = "Could not render this PDF in the viewer.",
}: {
    fileUrl: string;
    fileName?: string;
    errorMessage?: string;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageWidth, setPageWidth] = useState(640);
    const [resolvedFileUrl, setResolvedFileUrl] = useState<string | null>(null);
    const [resolveError, setResolveError] = useState<string | null>(null);
    const ownedBlobUrlRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setResolvedFileUrl(null);
        setResolveError(null);
        void (async () => {
            try {
                const viewUrl = await loadPdfBlobUrlForViewer(fileUrl, fileName);
                if (cancelled) {
                    URL.revokeObjectURL(viewUrl);
                    return;
                }
                if (ownedBlobUrlRef.current) {
                    URL.revokeObjectURL(ownedBlobUrlRef.current);
                }
                ownedBlobUrlRef.current = viewUrl;
                setResolvedFileUrl(viewUrl);
            } catch (error) {
                if (!cancelled) {
                    setResolveError(
                        error instanceof Error
                            ? error.message
                            : "Could not load this PDF for preview.",
                    );
                }
            }
        })();
        return () => {
            cancelled = true;
            if (ownedBlobUrlRef.current) {
                URL.revokeObjectURL(ownedBlobUrlRef.current);
                ownedBlobUrlRef.current = null;
            }
        };
    }, [fileUrl, fileName]);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => {
            const w = el.clientWidth;
            if (w > 0) setPageWidth(Math.max(280, w - 4));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div
            ref={wrapRef}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-slate-100 dark:bg-slate-950"
        >
            {!resolvedFileUrl ? (
                <div className="flex min-h-[200px] items-center justify-center">
                    {resolveError ? (
                        <p className="px-4 text-center text-xs text-slate-500">{resolveError}</p>
                    ) : (
                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden />
                    )}
                </div>
            ) : (
            <Document
                file={resolvedFileUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                onLoadError={(error) => {
                    console.error("PDF preview failed:", error);
                }}
                loading={
                    <div className="flex min-h-[200px] items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden />
                    </div>
                }
                error={
                    <div className="flex min-h-[200px] items-center justify-center px-4 text-center text-xs text-slate-500">
                        {errorMessage}
                    </div>
                }
                className="flex w-full flex-col items-center gap-3 py-3"
            >
                {numPages
                    ? Array.from({ length: numPages }, (_, i) => (
                        <Page
                            key={i + 1}
                            pageNumber={i + 1}
                            width={pageWidth}
                            className={cn("shadow-md", "bg-white")}
                            renderTextLayer
                            renderAnnotationLayer
                        />
                    ))
                    : null}
            </Document>
            )}
        </div>
    );
}

async function parseApiErrorMessageFromAxios(error: unknown): Promise<string> {
    const e = error as {
        response?: { data?: unknown };
        message?: string;
    };
    const data = e?.response?.data;
    let raw = "";
    if (data instanceof Blob) {
        try {
            const text = await data.text();
            try {
                const j = JSON.parse(text) as { message?: string };
                raw = String(j?.message ?? text).trim() || "Request failed";
            } catch {
                raw = text.trim() || "Request failed";
            }
        } catch {
            raw = "Request failed";
        }
    } else if (data && typeof data === "object" && "message" in data) {
        raw = String((data as { message?: string }).message ?? e?.message ?? "Request failed");
    } else {
        raw = String(e?.message ?? "Request failed");
    }
    if (/daily document limit exceeded/i.test(raw)) {
        return "SignNow's daily document limit is used up on this account. Click Review again to open the draft that was already created, uncheck addenda you do not need, or try again tomorrow.";
    }
    if (/timeout|ECONNABORTED/i.test(raw) || /timeout/i.test(String(e?.message || ""))) {
        return "SignNow is still preparing the contract. Wait a few seconds and click again.";
    }
    return raw;
}

function formatDropdownLabel(raw: unknown): string {
    const input = String(raw ?? "").trim();
    if (!input) return "";
    if (isSignNowTemplateIdToken(input)) return "";
    const noExt = input.replace(/\.pdf$/i, "");
    const normalized = noExt
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized || isSignNowTemplateIdToken(normalized)) return "";
    return normalized
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

function sameStringList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((item) => b.includes(item));
}

type AddendumPickerOption = { ref: string; label: string };

/** Isolated from PDFViewerModal re-renders so checkbox clicks stay instant on modal open. */
const AddendumTemplatesPicker = memo(function AddendumTemplatesPicker({
    options,
    selectedRefs,
    forceClosed,
    onToggle,
    onSetCount,
    onClear,
    onOpenChange,
}: {
    options: AddendumPickerOption[];
    selectedRefs: string[];
    forceClosed: boolean;
    onToggle: (ref: string) => void;
    onSetCount?: (ref: string, count: number) => void;
    onClear: () => void;
    onOpenChange?: (open: boolean) => void;
}) {
    const [open, setOpen] = useState(false);
    const [localSelected, setLocalSelected] = useState<string[]>(selectedRefs);
    const localSelectedRef = useRef(localSelected);
    localSelectedRef.current = localSelected;
    const rootRef = useRef<HTMLDivElement>(null);
    const ignorePropsUntilRef = useRef(0);
    const lastToggleRef = useRef<{ ref: string; at: number } | null>(null);
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;

    const setOpenAndNotify = useCallback((next: boolean) => {
        setOpen(next);
        onOpenChangeRef.current?.(next);
    }, []);

    useEffect(() => {
        if (!forceClosed) return;
        setOpenAndNotify(false);
    }, [forceClosed, setOpenAndNotify]);

    useEffect(() => {
        if (Date.now() < ignorePropsUntilRef.current) return;
        if (!sameStringList(localSelectedRef.current, selectedRefs)) {
            setLocalSelected(selectedRefs);
        }
    }, [selectedRefs]);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: MouseEvent) => {
            const el = rootRef.current;
            if (!el) return;
            if (!el.contains(event.target as Node)) setOpenAndNotify(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [open, setOpenAndNotify]);

    const toggle = (ref: string, label?: string) => {
        const now = Date.now();
        const last = lastToggleRef.current;
        if (last && last.ref === ref && now - last.at < 80) return;
        lastToggleRef.current = { ref, at: now };
        ignorePropsUntilRef.current = now + 500;
        if (isMultiInstanceAddendumRef(ref, label)) {
            const count = countAddendumRefOccurrences(localSelectedRef.current, ref);
            const nextCount = count > 0 ? 0 : 1;
            setLocalSelected((prev) => setAddendumRefCount(prev, ref, nextCount, label));
            onSetCount?.(ref, nextCount);
            return;
        }
        setLocalSelected((prev) =>
            prev.includes(ref) ? prev.filter((r) => r !== ref) : [...prev, ref],
        );
        onToggle(ref);
    };

    const adjustCount = (ref: string, delta: number, label?: string) => {
        ignorePropsUntilRef.current = Date.now() + 500;
        const current = countAddendumRefOccurrences(localSelectedRef.current, ref);
        const nextCount = Math.max(0, Math.min(MULTI_INSTANCE_ADDENDUM_MAX, current + delta));
        setLocalSelected((prev) => setAddendumRefCount(prev, ref, nextCount, label));
        onSetCount?.(ref, nextCount);
    };

    const selectedLabels = localSelected.map((ref, index) => {
        const match = options.find(
            (o) =>
                o.ref === ref ||
                (isMultiInstanceAddendumRef(ref) &&
                    isMultiInstanceAddendumRef(o.ref, o.label)),
        );
        return labelForAddendumInstance(
            match?.label || formatDropdownLabel(ref) || "Addendum",
            ref,
            localSelected,
            index,
        );
    });

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                aria-expanded={open}
                aria-haspopup="listbox"
                onClick={() => setOpenAndNotify(!open)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-xs text-slate-800 outline-none transition hover:bg-slate-50 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
            >
                <span className="min-w-0 truncate">
                    {localSelected.length === 0
                        ? "Select addendum(s)"
                        : selectedLabels.join(", ")}
                </span>
                <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
                        open ? "rotate-180" : ""
                    }`}
                    aria-hidden
                />
            </button>

            {open ? (
                <div
                    role="listbox"
                    aria-multiselectable="true"
                    className="absolute left-0 right-0 top-[calc(100%+4px)] z-[200] max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-600 dark:bg-slate-950"
                >
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Available addendums
                    </p>
                    {options.length > 0 ? (
                        options.map((opt) => {
                            const multi = isMultiInstanceAddendumRef(opt.ref, opt.label);
                            const count = countAddendumRefOccurrences(localSelected, opt.ref);
                            const checked = multi ? count > 0 : localSelected.includes(opt.ref);
                            return (
                                <div
                                    key={opt.ref}
                                    role="option"
                                    aria-selected={checked}
                                    tabIndex={0}
                                    onPointerDown={(event) => {
                                        if (
                                            multi &&
                                            (event.target as HTMLElement)?.closest?.(
                                                "[data-exhibit-c-qty]",
                                            )
                                        ) {
                                            return;
                                        }
                                        event.preventDefault();
                                        event.stopPropagation();
                                        toggle(opt.ref, opt.label);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === " " || event.key === "Enter") {
                                            event.preventDefault();
                                            toggle(opt.ref, opt.label);
                                        }
                                    }}
                                    className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-xs transition-colors ${
                                        checked
                                            ? "bg-[var(--brand)]/10 text-slate-900 dark:text-slate-100"
                                            : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-900"
                                    }`}
                                >
                                    <Checkbox
                                        checked={checked}
                                        tabIndex={-1}
                                        className="pointer-events-none"
                                    />
                                    <span className="min-w-0 flex-1 leading-snug">
                                        {opt.label}
                                        {multi && count > 1 ? (
                                            <span className="ml-1 text-[10px] font-semibold text-[var(--brand)]">
                                                ×{count}
                                            </span>
                                        ) : null}
                                    </span>
                                    {multi && checked ? (
                                        <div
                                            data-exhibit-c-qty
                                            className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--brand)]/30 bg-white px-1 py-0.5 dark:bg-slate-900"
                                            onPointerDown={(e) => e.stopPropagation()}
                                        >
                                            <button
                                                type="button"
                                                className="flex h-7 w-7 items-center justify-center rounded text-[14px] font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    adjustCount(opt.ref, -1, opt.label);
                                                }}
                                                aria-label={`Remove one ${opt.label}`}
                                            >
                                                −
                                            </button>
                                            <span className="min-w-[1.5rem] text-center text-[12px] font-bold text-[var(--brand)]">
                                                {count}
                                            </span>
                                            <button
                                                type="button"
                                                className="flex h-7 w-7 items-center justify-center rounded bg-[var(--brand)] text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-40"
                                                disabled={count >= MULTI_INSTANCE_ADDENDUM_MAX}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    adjustCount(opt.ref, 1, opt.label);
                                                }}
                                                aria-label={`Add another ${opt.label}`}
                                            >
                                                +
                                            </button>
                                        </div>
                                    ) : multi ? (
                                        <span className="text-[10px] font-medium text-slate-400">
                                            select, then +
                                        </span>
                                    ) : null}
                                </div>
                            );
                        })
                    ) : (
                        <p className="px-2 py-2 text-[11px] text-slate-500">
                            No addendum PDFs uploaded for this funder yet.
                        </p>
                    )}
                    {localSelected.length > 0 ? (
                        <button
                            type="button"
                            className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                            onClick={() => {
                                ignorePropsUntilRef.current = Date.now() + 500;
                                setLocalSelected([]);
                                onClear();
                            }}
                        >
                            Clear all addendums
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
});

/** Agent list from `/contract/agent-email` (falls back to the single `agentEmail`). */
function readAgentEmailsFromResponse(data: unknown): string[] {
    const d = (data ?? {}) as { agentEmails?: unknown; agentEmail?: unknown };
    const list = Array.isArray(d.agentEmails) ? d.agentEmails : d.agentEmail ? [d.agentEmail] : [];
    return list.map((e) => String(e ?? "").trim()).filter(Boolean);
}

const PDFViewerModal = ({
    isOpen,
    onClose,
    fileUrl,
    fileName = "Document",
    contractId = null,
    applicationId,
    layout = "contract",
    templateId = null,
    initialRightPaneTab = "template",
    onPrepareDocuSignDraft,
    prefillFieldsPreview = [],
    onSendToDocusign,
    onContractDocumentsChanged,
}: PDFViewerModalProps) => {
    const dispatch = useDispatch<AppDispatch>();
    const [effectiveTemplateId, setEffectiveTemplateId] = useState<string | null>(templateId ?? null);
    const [ccEmails, setCcEmails] = useState<string[]>([]);
    const [ccEmailDraft, setCcEmailDraft] = useState("");
    /**
     * Agents on the deal, saved on the contract. Each is emailed the package when
     * the contract is sent and the signed copy when it is signed (as the funder).
     * `agentEmailSource` is "contract" when saved here, else the referring agent.
     */
    const [agentEmails, setAgentEmails] = useState<string[]>([]);
    const [agentEmailSource, setAgentEmailSource] = useState<string>("none");
    const [agentEmailDraft, setAgentEmailDraft] = useState("");
    const [isSavingAgentEmail, setIsSavingAgentEmail] = useState(false);
    const [isSending, setIsSending] = useState(false);
    /**
     * Set from the Review click until SignNow opens (or fails): the package is
     * built and every document's fields confirmed server-side first, and the
     * button stays locked for all of it — not just once the request is sent.
     */
    const [signNowPreparePhase, setSignNowPreparePhase] =
        useState<SignNowPreparePhase | null>(null);
    /** "Send via SendGrid" — CRM signing portal, independent of the SignNow invite. */
    const [isSendingViaSendGrid, setIsSendingViaSendGrid] = useState(false);
    const sendingLockRef = useRef(false);
    const [isCancellingContract, setIsCancellingContract] = useState(false);
    const [isResendingNewContract, setIsResendingNewContract] = useState(false);
    /** "Resend unsigned contract" — same package, same values, optionally a corrected signer email. */
    const [resendUnsignedOpen, setResendUnsignedOpen] = useState(false);
    /** Set when the browser blocks `window.open` after the draft URL is ready — user opens via button click. */
    const [docuSignOpenUrl, setDocuSignOpenUrl] = useState<string | null>(null);
    const [signNowEmbedUrl, setSignNowEmbedUrl] = useState<string | null>(null);
    const [signNowReviewVisible, setSignNowReviewVisible] = useState(false);
    const [signNowReviewComplete, setSignNowReviewComplete] = useState(false);
    /**
     * Package whose Owner review the backend reports as open but not finished,
     * when this tab holds no review of its own (it was refreshed, reopened or
     * the modal remounted). Keeps the screen locked on "click Finish first"
     * instead of falling back to "Review in SignNow" and rebuilding the package.
     */
    const [persistedReviewEnvelopeId, setPersistedReviewEnvelopeId] = useState<string | null>(null);
    const [isRecordingSignNowFinish, setIsRecordingSignNowFinish] = useState(false);
    const [isReopeningSignNowTab, setIsReopeningSignNowTab] = useState(false);
    const signNowEmbedUrlRef = useRef<string | null>(null);
    const signNowReviewCompleteRef = useRef(false);
    signNowEmbedUrlRef.current = signNowEmbedUrl;
    signNowReviewCompleteRef.current = signNowReviewComplete;
    /**
     * The browser tab the Owner Review runs in.
     *
     * SignNow is no longer framed inside the CRM: its embedded editor needs its
     * own top-level origin to keep the signnow.com session, and inside an iframe
     * it fell back to the SignNow login screen. The review now opens as a real
     * tab, and the CRM keeps this handle so "Open SignNow tab" refocuses that
     * tab instead of minting a second review window.
     */
    const signNowReviewTabRef = useRef<Window | null>(null);
    const signNowCompleteToastShownRef = useRef<string | null>(null);
    /** Last minted review URL — reopen without calling SignNow prepare again. */
    const signNowCachedEmbedUrlRef = useRef<string | null>(null);
    /** Skip "send existing draft" so Review can remint after Owner finish. */
    const signNowForceFreshReviewRef = useRef(false);
    /**
     * The SignNow package the currently open (or just finished) review belongs to.
     *
     * `sessionEnvelopeId` cannot answer that on its own: `invalidateDocuSignDraftSession`
     * nulls it whenever the signer-roles fingerprint shifts, and that fingerprint moves
     * by itself when a background contract refresh lands while the review iframe is open.
     * On a first send nothing else holds the id yet — the contract the modal loaded has
     * no `document.envelopeId` until it is refetched — so losing it stopped the
     * review-status poll (Finish was never detected) and made Send report "Finish Review
     * in SignNow first — there is no contract package to send yet" for a package that
     * existed all along. Cleared when the review package is genuinely gone: modal close,
     * a completed send, or a void.
     */
    const signNowReviewEnvelopeIdRef = useRef<string | null>(null);
    /** Portal send accepted by the backend but still publishing/emailing there. */
    const pendingPortalSendEnvelopeRef = useRef<string | null>(null);
    type ContractWizardStep = "documents" | "info" | "summary" | "sent";
    const [activeStep, setActiveStep] = useState<ContractWizardStep>("documents");
    const [sentAt, setSentAt] = useState<Date | null>(null);
    /** Sticky unlock for step 4 — survives modal close until void or contract change. */
    const [sentStepUnlocked, setSentStepUnlocked] = useState(false);
    /** Selected row in Sent step when multiple envelopes were sent. */
    const [selectedSentEnvelopeKey, setSelectedSentEnvelopeKey] = useState<string | null>(null);
    const [sentCcEmails, setSentCcEmails] = useState<string[]>([]);
    /** True only while user clicks Refresh on the Sent-step signing status card. */
    const [signingStatusRefreshing, setSigningStatusRefreshing] = useState(false);
    /** When the UI last loaded signing status from CRM (and optional DocuSign sync). */
    const [lastSigningStatusSyncAt, setLastSigningStatusSyncAt] = useState<Date | null>(null);
    /** After user explicitly opens Documents during this modal session, stop auto-switching Documents → Sent. */
    const didSuggestSentTabThisOpenRef = useRef(false);
    const awaitingDocuSignSendRef = useRef(false);
    /** Close the Owner Review tab the CRM opened, if it is still ours and open. */
    const closeSignNowReviewTab = useCallback(() => {
        const tab = signNowReviewTabRef.current;
        signNowReviewTabRef.current = null;
        if (!tab) return;
        try {
            if (!tab.closed) tab.close();
        } catch {
            /* Cross-origin tab that refused to close — leave it to the user. */
        }
    }, []);
    /**
     * Point the review tab at SignNow.
     *
     * `preOpened` is the blank tab opened synchronously on the click: browsers
     * only allow `window.open` inside a user gesture, and the review URL is not
     * minted until several awaits later, so the tab is claimed first and
     * navigated once SignNow answers.
     */
    const openSignNowReviewTab = useCallback((url: string, preOpened?: Window | null) => {
        const existing = signNowReviewTabRef.current;
        let tab: Window | null =
            preOpened && !preOpened.closed
                ? preOpened
                : existing && !existing.closed
                  ? existing
                  : null;
        if (!tab) {
            tab = window.open(url, SIGNNOW_REVIEW_TAB_NAME);
            if (!tab) {
                signNowReviewTabRef.current = null;
                toast.error(
                    "Your browser blocked the SignNow tab. Allow pop-ups for this site, then click Open SignNow tab.",
                    { autoClose: 12000 },
                );
                return false;
            }
        } else {
            try {
                tab.location.href = url;
            } catch {
                tab = window.open(url, SIGNNOW_REVIEW_TAB_NAME);
            }
        }
        signNowReviewTabRef.current = tab;
        try {
            tab?.focus();
        } catch {
            /* Focus is a courtesy — the tab is open either way. */
        }
        return true;
    }, []);
    const resetSignNowReviewUi = useCallback((options?: { keepCachedEmbed?: boolean }) => {
        setSignNowEmbedUrl(null);
        setSignNowReviewVisible(false);
        setSignNowReviewComplete(false);
        closeSignNowReviewTab();
        awaitingDocuSignSendRef.current = false;
        if (!options?.keepCachedEmbed) {
            signNowCachedEmbedUrlRef.current = null;
        }
        toast.dismiss(SIGNNOW_REVIEW_TOAST_ID);
    }, [closeSignNowReviewTab]);
    const refreshContractSigningStateRef = useRef<
        (
            silent?: boolean,
            options?: { syncDocuSign?: boolean; forceDocuSignSync?: boolean },
        ) => Promise<void>
    >(() => Promise.resolve());
    const prevContractIdForSentRef = useRef<number | null | undefined>(undefined);
    const stepSequence: ContractWizardStep[] = ["documents", "info", "summary", "sent"];
    const activeStepIndex = stepSequence.indexOf(activeStep);
    const canGoPreviousStep = activeStepIndex > 0;
    const canGoNextStep = activeStep === "documents" || activeStep === "info";
    const goToPreviousStep = () => {
        if (!canGoPreviousStep) return;
        const prev = stepSequence[activeStepIndex - 1];
        if (prev === "documents") didSuggestSentTabThisOpenRef.current = true;
        if (prev === "documents" || prev === "info") {
            discardSignNowReviewForEdit();
        }
        setActiveStep(prev);
    };
    const goToNextStep = () => {
        if (!canGoNextStep) return;
        setActiveStep(stepSequence[activeStepIndex + 1]);
    };
    const [selectedState, setSelectedState] = useState<string>("");
    const [selectedFunder, setSelectedFunder] = useState<string>("");
    const [selectedFunderProfileId, setSelectedFunderProfileId] = useState<string>("");
    const contractStateForFunderSyncRef = useRef("");
    const contractPrefillLoadKeyRef = useRef("");
    const userSelectedFunderRef = useRef(false);
    const userSelectedStateRef = useRef(false);
    const {
        funders,
        funderSelectEntries,
        loading: fundersLoading,
        resolveLayoutKey,
        resolveLayoutKeyForProfile,
        previewNameFor,
        findFunder,
        findFunderById,
        resolveFunderOnStateChange,
    } = useFunderProfiles(selectedState);
    const fundersRef = useRef(funders);
    fundersRef.current = funders;
    const findFunderRef = useRef(findFunder);
    findFunderRef.current = findFunder;
    const findFunderByIdRef = useRef(findFunderById);
    findFunderByIdRef.current = findFunderById;
    const resolveLayoutKeyRef = useRef(resolveLayoutKey);
    resolveLayoutKeyRef.current = resolveLayoutKey;
    const resolveLayoutKeyForProfileRef = useRef(resolveLayoutKeyForProfile);
    resolveLayoutKeyForProfileRef.current = resolveLayoutKeyForProfile;
    const previewNameForRef = useRef(previewNameFor);
    previewNameForRef.current = previewNameFor;
    const selectedStateRef = useRef(selectedState);
    selectedStateRef.current = selectedState;
    const [activeContractTemplateName, setActiveContractTemplateName] = useState<string>("Contract.pdf");
    const [savingContractMeta, setSavingContractMeta] = useState(false);
    const [contractPrefillEditOpen, setContractPrefillEditOpen] = useState(false);
    /** Local Deal Review edits keyed by DocuSign field id (Summary step). */
    const [dealReviewDraftById, setDealReviewDraftById] = useState<Record<string, string>>({});
    const [dealReviewDraftDirty, setDealReviewDraftDirty] = useState(false);
    const prevDealReviewOfferMoneyKeyRef = useRef("");
    const dealReviewDraftFingerprintRef = useRef("");
    const [prefilledBoldSignPdfUrl, setPrefilledBoldSignPdfUrl] = useState<string | null>(null);
    const [prefilledBoldSignPdfLoading, setPrefilledBoldSignPdfLoading] = useState(false);
    const [prefilledBoldSignPdfHint, setPrefilledBoldSignPdfHint] = useState<string | null>(null);
    const [downloadingFilledContract, setDownloadingFilledContract] = useState(false);
    /** DocuSign envelope from last send or loaded contract — used before DB row is visible. */
    const [sessionEnvelopeId, setSessionEnvelopeId] = useState<string | null>(null);
    /** Right pane: template PDF, DocuSign draft prefilled (summary), or DocuSign PDF after send. */
    const [pdfRightPaneTab, setPdfRightPaneTab] = useState<PdfRightPaneTab>("template");

    useEffect(() => {
        if (!isOpen) return;
        const initial =
            initialRightPaneTab === "prefilled" ? "docusign" : "template";
        setPdfRightPaneTab(initial);
    }, [isOpen, initialRightPaneTab]);

    /**
     * The modal stays mounted between openings, so `activeStep` survived a close and the
     * wizard reopened wherever it was left — after "Resend New Contract" that meant landing
     * on Summary or Sent instead of running the package build from the top. Every opening
     * now starts at Documents; a deal whose contract is already out is moved on to Sent by
     * the effect that watches `sentStepUnlocked`, so viewing a sent contract is unchanged.
     */
    const wasOpenRef = useRef(false);
    useEffect(() => {
        const wasOpen = wasOpenRef.current;
        wasOpenRef.current = isOpen;
        if (!isOpen || wasOpen) return;
        setActiveStep("documents");
    }, [isOpen]);

    /** Includes state-specific funders and any saved profile not in the active list. */
    const funderSelectOptions = useMemo(() => {
        const base = funderSelectEntries;
        const curId = String(selectedFunderProfileId || "").trim();
        if (curId && !base.some((x) => x.value === curId)) {
            const profile = findFunderById(curId);
            if (profile) {
                return [
                    ...base,
                    {
                        value: profile.id,
                        label: formatFunderSelectLabel(profile),
                        funderName: profile.name,
                    },
                ];
            }
        }
        return base;
    }, [funderSelectEntries, selectedFunderProfileId, findFunderById]);

    const selectedFunderRef = useRef("");
    selectedFunderRef.current = String(selectedFunder || "").trim();
    const selectedFunderProfileIdRef = useRef("");
    selectedFunderProfileIdRef.current = String(selectedFunderProfileId || "").trim();

    const [previewingMainContract, setPreviewingMainContract] = useState(false);

    const selectedFunderProfile = useMemo(
        () =>
            findFunderById(selectedFunderProfileId) ??
            findFunder(selectedFunder),
        [findFunderById, findFunder, selectedFunderProfileId, selectedFunder],
    );
    const funderDisclosureOptions = useMemo(
        () => funderSignNowDisclosureOptions(selectedFunderProfile),
        [selectedFunderProfile],
    );
    const primaryFunderDisclosure = funderDisclosureOptions[0] ?? null;
    const effectiveSignNowDisclosure = useMemo(
        () => resolveSignNowDisclosureOption(selectedFunderProfile),
        [selectedFunderProfile],
    );
    const selectedFunderDefaultCcEmail = useMemo(() => {
        return (
            String(selectedFunderProfile?.docusignDefaultCcEmail ?? "").trim() ||
            String(selectedFunderProfile?.defaultCcEmail ?? "").trim() ||
            null
        );
    }, [selectedFunderProfile]);
    const [tenantContractCcDefaults, setTenantContractCcDefaults] =
        useState<ContractCcDefaults | null>(null);
    const [tenantCcDefaultsVersion, setTenantCcDefaultsVersion] = useState(0);
    const selectedFunderDefaultCcEmails = useMemo(
        () => parseFunderDefaultCcEmails(selectedFunderDefaultCcEmail),
        [selectedFunderDefaultCcEmail],
    );
    const contractCcMergeOptions = useMemo(() => {
        const knownFunderDefaultCcEmails = collectKnownFunderDefaultCcEmails(
            funders.flatMap((f) => [f.docusignDefaultCcEmail, f.defaultCcEmail]),
        );
        const apiResolved =
            tenantContractCcDefaults?.ccEmails?.length
                ? tenantContractCcDefaults.ccEmails.join(", ")
                : tenantContractCcDefaults?.resolvedCcEmail ?? null;
        return {
            // Prefer API-resolved list (DocuSign account → funder → platform).
            funderDefaultCcEmail: apiResolved || selectedFunderDefaultCcEmail,
            tenantDefaultCcEmail: tenantContractCcDefaults?.defaultCcEmail ?? null,
            knownFunderDefaultCcEmails,
        };
        // tenantCcDefaultsVersion forces refresh after setTenantDefaultContractCcEmail cache write
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFunderDefaultCcEmail, funders, tenantContractCcDefaults, tenantCcDefaultsVersion]);
    const contractDefaultCcEmails = useMemo(
        () => resolveContractDefaultCcEmails(contractCcMergeOptions),
        [contractCcMergeOptions],
    );
    const contractDefaultCcSourceLabel = useMemo(() => {
        const source = tenantContractCcDefaults?.source;
        if (source === "docusign") return "DocuSign";
        if (source === "funder") return "Funder";
        if (source === "platform") return "Default";
        if (selectedFunderProfile?.docusignDefaultCcEmail?.trim()) return "DocuSign";
        if (selectedFunderDefaultCcEmails.length > 0) return "Funder";
        return "Default";
    }, [
        tenantContractCcDefaults?.source,
        selectedFunderProfile?.docusignDefaultCcEmail,
        selectedFunderDefaultCcEmails.length,
    ]);
    const contractDefaultCcUsesFunderOverride = useMemo(() => {
        if (tenantContractCcDefaults) {
            return (
                tenantContractCcDefaults.source === "docusign" ||
                tenantContractCcDefaults.source === "funder"
            );
        }
        return Boolean(
            selectedFunderProfile?.docusignDefaultCcEmail?.trim() ||
                selectedFunderDefaultCcEmails.length > 0,
        );
    }, [
        tenantContractCcDefaults,
        selectedFunderProfile?.docusignDefaultCcEmail,
        selectedFunderDefaultCcEmails,
    ]);
    const selectedFunderDefaultCcRef = useRef<string | null>(null);
    selectedFunderDefaultCcRef.current = selectedFunderDefaultCcEmail;
    /** Canonical contract id for this application (filled after lookup below). */
    const [resolvedContractId, setResolvedContractId] = useState<number | null>(null);
    /** Prefill overrides from `Contract.contractPrefillOverrides` (null = loaded, none stored). */
    const [contractPrefillFromDb, setContractPrefillFromDb] = useState<Partial<BuildContractPrefillFieldsArgs> | null>(
        null,
    );
    /** Resolved contract payload for prefill field derivation. */
    const [resolvedContract, setResolvedContract] = useState<Record<string, unknown> | null>(null);
    /** After the first contract meta fetch for this dialog open, prefer DB overrides over legacy application note. */
    const [contractPrefillLoaded, setContractPrefillLoaded] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setSessionEnvelopeId(null);
            return;
        }
        const fromContract = String(
            (resolvedContract as { application?: { document?: { envelopeId?: string } } } | null)
                ?.application?.document?.envelopeId ?? "",
        ).trim();
        if (fromContract) setSessionEnvelopeId(fromContract);
    }, [isOpen, resolvedContract]);

    type RequiredDocumentKey =
        | "voidedCheck"
        | "driverLicense"
        | "driverLicenseOwner2"
    // | "bankStatement"
    // | "utilityBill";
    const [documentUrls, setDocumentUrls] = useState<{
        voidedCheck?: string;
        driverLicense?: string;
        driverLicenseOwner2?: string;
        bankStatement?: string;
        utilityBill?: string;
    }>({});
    const [activePreview, setActivePreview] = useState<null | "voidedCheck" | "driverLicense" | "driverLicenseOwner2" | "bankStatement" | "utilityBill">(null);
    const [documentUploadMessage, setDocumentUploadMessage] = useState("");
    /** Per-row upload progress (0–100) for auto-upload UX. Absent key means not uploading. */
    const [uploadProgressByKey, setUploadProgressByKey] = useState<
        Partial<Record<RequiredDocumentKey, number>>
    >({});
    /** Per-row pending file name shown while the upload is in flight. */
    const [pendingFileNameByKey, setPendingFileNameByKey] = useState<
        Partial<Record<RequiredDocumentKey, string>>
    >({});
    /** Currently dragged-over row, for drop-zone visual feedback. */
    const [dragOverDocKey, setDragOverDocKey] = useState<RequiredDocumentKey | null>(null);
    const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null);
    const [updatingUploadedFileId, setUpdatingUploadedFileId] = useState<string | null>(null);
    const [deletingUploadedFileId, setDeletingUploadedFileId] = useState<string | null>(null);
    const [openDocumentActionMenuId, setOpenDocumentActionMenuId] = useState<string | null>(null);
    const [templateMappings, setTemplateMappings] = useState<ContractDocumentTemplateMappingRow[]>([]);

    const addendumTemplateMappings = useMemo(
        () =>
            templateMappings.filter((row) => {
                const t = String(row.documentType || "").toLowerCase();
                return t === "addendum";
            }),
        [templateMappings],
    );

    /** Settings → Funders SignNow addenda for the selected funder (names + known layout keys). */
    const selectedFunderAddendumOptions = useMemo(
        () =>
            isSignNowContractUiEnabled()
                ? funderSignNowAddendumOptions(selectedFunderProfile)
                : [],
        [selectedFunderProfile],
    );

    /** Canonical linked addenda (position 1 first) — one row per mapping (Exhibit C may repeat). */
    const linkedAddendumMappings = useMemo(() => {
        if (!addendumTemplateMappings.length) return [];
        const sorted = [...addendumTemplateMappings].sort(
            (a, b) => Number(a.order ?? 0) - Number(b.order ?? 0),
        );
        const seenIds = new Set<string>();
        return sorted.filter((row) => {
            const rowId = String(row?.id ?? "").trim();
            if (rowId) {
                if (seenIds.has(rowId)) return false;
                seenIds.add(rowId);
            }
            // SignNow: never show another funder's linked addendum under this funder.
            if (
                isSignNowContractUiEnabled() &&
                selectedFunderAddendumOptions.length > 0 &&
                !funderOwnsSignNowAddendumRef(
                    getAddendumDropdownRef(row?.template),
                    selectedFunderAddendumOptions,
                    row?.template,
                )
            ) {
                return false;
            }
            return true;
        });
    }, [addendumTemplateMappings, selectedFunderAddendumOptions]);

    /** Primary linked addendum (for single-row UI helpers). */
    const linkedAddendumMapping = useMemo(
        () => linkedAddendumMappings[0] ?? null,
        [linkedAddendumMappings],
    );

    const disclosureCatalogTemplates = useSelector((state: RootState) =>
        Array.isArray(state.boldSignTemplates?.data) ? state.boldSignTemplates.data : [],
    );

    const disclosureTemplateMappings = useMemo(() => {
        const rows = templateMappings.filter(isDisclosureMappingRow);
        return rows.map((row) => {
            if (row.template?.state || row.template?.layoutKey || row.template?.name) {
                return row;
            }
            const tid = String(row.templateId ?? row.template?.id ?? "").trim();
            if (!tid) return row;
            const fromCatalog = (disclosureCatalogTemplates as Array<Record<string, unknown>>).find(
                (t) =>
                    isDisclosureCatalogRow(t) &&
                    (String(t?.id ?? "").trim() === tid ||
                        String(t?.layoutKey ?? "").trim() === tid ||
                        String(t?.templateId ?? "").trim() === tid),
            );
            if (!fromCatalog) return row;
            return {
                ...row,
                template: {
                    id: String(fromCatalog.id ?? tid),
                    name: fromCatalog.name as string | undefined,
                    type: fromCatalog.type as string | undefined,
                    state: (fromCatalog.state as string | null | undefined) ?? null,
                    templateId: fromCatalog.templateId as string | undefined,
                    pdfUrl: fromCatalog.pdfUrl as string | undefined,
                    layoutKey: fromCatalog.layoutKey as string | undefined,
                },
            };
        });
    }, [templateMappings, disclosureCatalogTemplates]);

    /** State disclosure merged at the bottom of the contract package. */
    const linkedDisclosureMapping = useMemo(() => {
        if (!disclosureTemplateMappings.length) return null;
        const sorted = [...disclosureTemplateMappings].sort(
            (a, b) => Number(b.order ?? 0) - Number(a.order ?? 0),
        );
        if (isSignNowContractUiEnabled()) {
            return (
                sorted.find((row) => disclosureMappingIsSignNowPermanent(row)) ??
                sorted[0] ??
                null
            );
        }
        if (!selectedState.trim()) return sorted[0];
        return (
            sorted.find((row) => disclosureMappingMatchesState(row, selectedState)) ??
            null
        );
    }, [disclosureTemplateMappings, selectedState]);

    const linkedDisclosureMatchesSelectedState = useMemo(() => {
        if (
            isSignNowContractUiEnabled() &&
            disclosureMappingIsSignNowPermanent(linkedDisclosureMapping)
        ) {
            return true;
        }
        return disclosureMappingMatchesState(linkedDisclosureMapping, selectedState);
    }, [linkedDisclosureMapping, selectedState]);

    /** `bs:<layoutOrTemplateRef>` values — multiple addenda allowed. */
    const [selectedAddendumOptions, setSelectedAddendumOptions] = useState<string[]>([]);
    const addendumDropdownOpenRef = useRef(false);
    const [addendumPickerEpoch, setAddendumPickerEpoch] = useState(0);
    const addendumAutoLinkKeyRef = useRef("");
    const addendumUserRemovedKindsRef = useRef<Set<AutoSelectAddendumKind>>(new Set());
    const addendumOptimisticRefsRef = useRef<string[] | null>(null);
    const addendumUserInteractedAtRef = useRef(0);
    /** Main contract in envelope — default on; addendum/disclosure auto-merge when configured below. */
    const [includeMainContractInSend, setIncludeMainContractInSend] = useState(true);
    /** SignNow permanent disclosure — user can uncheck to send the contract without it. */
    const [includeDisclosureInSend, setIncludeDisclosureInSend] = useState(true);

    const handleAddendumPickerOpenChange = useCallback((open: boolean) => {
        const wasOpen = addendumDropdownOpenRef.current;
        addendumDropdownOpenRef.current = open;
        if (wasOpen && !open) {
            setAddendumPickerEpoch((n) => n + 1);
        }
    }, []);

    const configuredAddendumLayoutKey = useMemo((): string | null => {
        for (const opt of selectedAddendumOptions) {
            const trimmed = String(opt || "").trim();
            if (trimmed.startsWith("up:")) continue;
            if (trimmed.startsWith("bs:")) {
                const ref = trimmed.slice(3).trim();
                if (ref) return ref;
            }
        }
        for (const row of linkedAddendumMappings) {
            const fromMapping = String(
                row?.template?.layoutKey ??
                    row?.template?.templateId ??
                    row?.templateId ??
                    "",
            ).trim();
            if (fromMapping) return fromMapping;
        }
        return null;
    }, [selectedAddendumOptions, linkedAddendumMappings]);

    const configuredDisclosureRef = useMemo((): string | null => {
        if (isSignNowContractUiEnabled()) {
            if (!includeDisclosureInSend) return null;
            return (
                effectiveSignNowDisclosure.templateId ||
                effectiveSignNowDisclosure.layoutKey ||
                SIGNNOW_DISCLOSURE_LAYOUT_KEY
            );
        }
        if (!linkedDisclosureMapping || !linkedDisclosureMatchesSelectedState) return null;
        const rowId = String(linkedDisclosureMapping?.template?.id ?? "").trim();
        return rowId || null;
    }, [
        includeDisclosureInSend,
        linkedDisclosureMapping,
        linkedDisclosureMatchesSelectedState,
        effectiveSignNowDisclosure,
    ]);

    const canSendWithoutContract = useMemo(
        () => canSendWithoutMainContract(configuredAddendumLayoutKey, configuredDisclosureRef),
        [configuredAddendumLayoutKey, configuredDisclosureRef],
    );

    useEffect(() => {
        if (!canSendWithoutContract) {
            setIncludeMainContractInSend(true);
        }
    }, [canSendWithoutContract]);

    const documentTemplateEnvelopeByMappingId = useMemo(
        () =>
            parseDocumentTemplateEnvelopeByMappingId(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ),
        [resolvedContract],
    );
    const [documentTemplatePrefillByMappingId, setDocumentTemplatePrefillByMappingId] = useState<
        Record<string, Record<string, string>>
    >({});
    /**
     * Stable across renders: the Info Required form re-seeds its Exhibit C
     * entities whenever this prop changes identity, so an inline object literal
     * threw away every unsaved entity edit on each re-render — including the one
     * the focus refresh triggers when the user comes back from the SignNow tab.
     */
    const contractPrefillEditFormAdditionalJson = useMemo(
        () => ({
            [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: documentTemplatePrefillByMappingId,
        }),
        [documentTemplatePrefillByMappingId],
    );
    const [templateMappingPrefillEditRow, setTemplateMappingPrefillEditRow] =
        useState<ContractDocumentTemplateMappingRow | null>(null);
    const [templateMappingPrefillExhibitCIndex, setTemplateMappingPrefillExhibitCIndex] =
        useState(0);
    const [loadingTemplateMappings, setLoadingTemplateMappings] = useState(false);
    const [linkingDisclosureTemplate, setLinkingDisclosureTemplate] = useState(false);
    const [disclosureCalcModalOpen, setDisclosureCalcModalOpen] = useState(false);
    const [spaCalcModalOpen, setSpaCalcModalOpen] = useState(false);
    const [savingSpaCalculation, setSavingSpaCalculation] = useState(false);
    const [disclosureCalcBankAnalyses, setDisclosureCalcBankAnalyses] = useState<unknown>(null);
    const [loadingDisclosureCalcBankAnalysis, setLoadingDisclosureCalcBankAnalysis] =
        useState(false);
    const [savingDisclosureCalculation, setSavingDisclosureCalculation] = useState(false);
    const [previewingTemplateId, setPreviewingTemplateId] = useState<string | null>(null);
    const templatePreviewBlobUrlRef = useRef<string | null>(null);
    const mainContractPreviewRequestRef = useRef(0);
    const lastAutoPreviewKeyRef = useRef("");
    const uploadedPreviewUrlRef = useRef<string | null>(null);
    uploadedPreviewUrlRef.current = uploadedPreviewUrl;
    // const [selectedPayoffLetterFileId, setSelectedPayoffLetterFileId] = useState<string>("");
    const [activeInfoPanel, setActiveInfoPanel] = useState<InfoPanelId | null>(null);
    const [, setSelectedInfoPanels] = useState<InfoPanelId[]>([]);
    const [addendumEntries, setAddendumEntries] = useState([
        {
            id: "tmp-1",
            legalName: "",
            dba: "",
            typeOfEntity: "",
            ein: "",
            mailingAddress: "",
            addendumDated: "",
            principalOwner: "",
            principalBusiness: "",
            businessLocation: "",
            principalState: "",
            principalOwnerAmount1: "",
            principalOwnerAmount2: "",
            principalOwner1Name: "",
            principalOwner1Date: "",
            principalOwner2Name: "",
            principalOwner2Date: "",
        },
    ]);
    const [achEntries, setAchEntries] = useState([
        {
            id: "tmp-1",
            bankName: "",
            fullNameOnAccount: "",
            accountNumber: "",
            routingNumber: "",
            ach_authorization_bank_portal_website: "",
            ach_authorization_username: "",
            ach_authorization_password: "",
            ach_authorization_security_question1: "",
            ach_authorization_security_answer1: "",
            ach_authorization_security_question2: "",
            ach_authorization_security_answer2: "",
            ach_authorization_security_question3: "",
            ach_authorization_security_answer3: "",
            ach_authorization_other_infomation: "",
            ach_authorization_reference_name1: "",
            ach_authorization_reference_number_1: "",
            ach_authorization_reference_relationship1: "",
            ach_authorization_reference_name2: "",
            ach_authorization_reference_number2: "",
            ach_authorization_reference_relationship2: "",
            ach_authorization_reference_name3: "",
            ach_authorization_reference_number3: "",
            ach_authorization_reference_relationship3: "",
            dba: "",
            phone: "",
            address: "",
            city: "",
            state: "",
            zip: "",
            bankBranchCity: "",
            bankState: "",
            bankZip: "",
        },
    ]);
    const [epoEntries, setEpoEntries] = useState([
        { id: "tmp-1", legalName: "", receivedDate: "" },
    ]);
    const [ownerEntries, setOwnerEntries] = useState([
        {
            id: "tmp-1",
            ownerFirstName: "",
            ownerLastName: "",
            ownerEmail: "",
            ownerPhone: "",
            ownerAddress: "",
            state: "",
            city: "",
            zipCode: "",
            ownershipPercentage: "",
        },
    ]);
    const [guarantorEntries, setGuarantorEntries] = useState([
        {
            id: "tmp-1",
            guarantorFirstName: "",
            guarantorLastName: "",
            guarantorEmail: "",
            guarantorPhone: "",
            guarantorAddress: "",
            state: "",
            city: "",
            zipCode: "",
            ssnNumber: "",
            driverLicenseNumber: "",
            typeOfEntity: "",
        },
    ]);
    const [infoPanelMessage, setInfoPanelMessage] = useState("");
    const [showRecipientEditor, setShowRecipientEditor] = useState(false);
    const [viewRecordModal, setViewRecordModal] = useState<{
        section: "addendum" | "ach" | "epo" | "owner" | "guarantor";
        title: string;
        row: any;
    } | null>(null);
    const [editRecordModal, setEditRecordModal] = useState<{
        section: "addendum" | "ach" | "epo" | "owner" | "guarantor";
        title: string;
        row: any;
    } | null>(null);
    const [recipientEditorRows, setRecipientEditorRows] = useState<
        { id: string; role: string; name: string; email: string }[]
    >([{ id: "tmp-1", role: "", name: "", email: "" }]);
    /** Saved signer emails for this contract send only (never writes DocuSign template). */
    const [contractSignerOverrides, setContractSignerOverrides] = useState<
        ContractSignerOverrideRow[] | null
    >(null);
    const [savingContractRecipients, setSavingContractRecipients] = useState(false);
    const uploadedDocsState = useSelector(
        (state: RootState) => state.uploadedContractDocuments,
    );
    const applicationData = useSelector((state: RootState) => state.applicationDetail.data as any);
    const { owners: applicationClientOwners } = useApplicationClientOwners(
        applicationData?.client ?? null,
    );
    const applicationForPrefill = useMemo(
        () => applicationWithClientOwners(applicationData, applicationClientOwners),
        [applicationData, applicationClientOwners],
    );
    const applicationDataRef = useRef(applicationData);
    applicationDataRef.current = applicationData;

    const offerDecisionState = useSelector((state: RootState) => state.offerDecision);
    const offerDecisionData = offerDecisionState?.data ?? null;
    const offerDecisionLoading = Boolean(offerDecisionState?.loading);

    const contractDisclosureFrequency = useMemo(() => {
        const offer =
            offerDecisionData != null && typeof offerDecisionData === "object"
                ? (offerDecisionData as Record<string, unknown>)
                : null;
        const contractOffer =
            resolvedContract != null && typeof resolvedContract === "object"
                ? ((resolvedContract as Record<string, unknown>).offer as Record<string, unknown> | null)
                : null;
        const application =
            applicationData != null && typeof applicationData === "object"
                ? (applicationData as Record<string, unknown>)
                : null;
        const raw = String(
            offer?.frequency ??
                contractOffer?.frequency ??
                application?.frequency ??
                "",
        ).trim();
        return normalizeFrequencyForTemplateLookup(raw);
    }, [offerDecisionData, resolvedContract, applicationData]);

    const disclosureCalculatorSeedInputs = useMemo(
        () =>
            buildDisclosureCalculatorInputsFromSources({
                state: selectedState,
                application: applicationData as Record<string, unknown> | null,
                contract: resolvedContract,
                offerDecision: (offerDecisionData as Record<string, unknown> | null) ?? null,
                bankAnalyses: disclosureCalcBankAnalyses,
                // The saved box as this modal last loaded or saved it; `resolvedContract`
                // alone can predate it. Empty falls back to the contract row.
                includeWireFee: contractPrefillLoaded
                    ? contractPrefillFromDb?.includeWireFee
                    : undefined,
            }),
        [
            selectedState,
            applicationData,
            resolvedContract,
            offerDecisionData,
            disclosureCalcBankAnalyses,
            contractPrefillLoaded,
            contractPrefillFromDb,
        ],
    );

    const disclosureCalcBankMonthlyRevenues = useMemo(
        () => extractMonthlyRevenuesFromBankAnalyses(disclosureCalcBankAnalyses),
        [disclosureCalcBankAnalyses],
    );

    const achListState = useSelector((state: RootState) => state.achList);
    const bankDetailsList = useSelector((state: RootState) => state.bankDetails.data);
    const epoListState = useSelector((state: RootState) => state.epoList);
    const addendumListState = useSelector((state: RootState) => state.addendumList);
    const ownerListState = useSelector((state: RootState) => state.contractOwnerList);
    const crmOwnerPartiesForSigners = useMemo(
        () =>
            resolveOwnerPartiesForContractSigners(
                applicationForPrefill,
                Array.isArray(ownerListState.data) ? ownerListState.data : [],
                null,
            ),
        [applicationForPrefill, ownerListState.data],
    );
    const signerSlotOwnerCount = useMemo(
        () =>
            resolveActiveOwnerCount({
                owners: applicationClientOwners as unknown as Record<string, unknown>[],
                signerRoles: contractSignerOverrides?.map((r) => ({
                    signerRole: r.role,
                    signerEmail: r.email,
                })),
            }),
        [applicationClientOwners, contractSignerOverrides],
    );
    const guarantorListState = useSelector((state: RootState) => state.contractGuarantorList);
    const boldSignTemplatesState = useSelector(
        (state: RootState) => state.boldSignTemplates,
    );
    const boldSignTemplates = Array.isArray(boldSignTemplatesState.data)
        ? boldSignTemplatesState.data
        : EMPTY_LIST;
    const boldSignTemplatesLoading = Boolean(boldSignTemplatesState.loading);
    /** True after this modal open has finished at least one templates fetch (even if empty). */
    const [boldSignTemplatesHydrated, setBoldSignTemplatesHydrated] = useState(false);
    const boldSignState = useSelector((state: RootState) => state.boldSign);
    const { data: loginData } = useSelector((state: RootState) => state.login);
    const { data: documentRequests, loading: documentRequestsLoading } = useSelector(
        (state: RootState) => state.documentRequests,
    );
    const templateRecipients = boldSignState?.templateRecipients;

    /** Platform layout slots from code — never DocuSign Admin template recipients. */
    const platformSignerRoleRows = useMemo(
        () => getPlatformSignerRoleRows(Math.max(1, signerSlotOwnerCount || 1)),
        [signerSlotOwnerCount],
    );

    const templateRoleRowsForSigner = useMemo(
        () =>
            parseBoldSignTemplateRolesFromRecipientsPayload({
                roles: platformSignerRoleRows,
                source: "platform-layout",
            }),
        [platformSignerRoleRows],
    );

    /** Signing email for DocuSign (includes template default when CRM client email is blank). */
    const docuSignSignerEmail = useMemo(
        () =>
            resolveEffectiveDocuSignSignerEmail(
                applicationData,
                resolvedContract,
                templateRoleRowsForSigner,
                ownerEntries
                    .map((o) => String((o as { ownerEmail?: string }).ownerEmail || "").trim())
                    .filter(Boolean),
            ),
        [
            applicationData,
            resolvedContract,
            templateRoleRowsForSigner,
            ownerEntries,
        ],
    );

    /** CRM client / owner / guarantor rows mapped to numbered DocuSign signer roles. */
    const applicationSignerRowsForMerge = useMemo((): ContractSignerOverrideRow[] => {
        const ownersFromCrm = crmOwnerPartiesForSigners.map((party) => ({
            firstName: String(party.ownerFirstName || "").trim(),
            lastName: String(party.ownerLastName || "").trim(),
            email: String(party.ownerEmail || "").trim(),
        }));
        const ownersFromEntries = ownerEntries.map((entry) => ({
            firstName: String(entry.ownerFirstName || "").trim(),
            lastName: String(entry.ownerLastName || "").trim(),
            email: String(entry.ownerEmail || "").trim(),
        }));
        const owners =
            ownersFromCrm.filter((o) => o.email || o.firstName || o.lastName).length >=
            ownersFromEntries.filter((o) => o.email || o.firstName || o.lastName).length
                ? ownersFromCrm
                : ownersFromEntries;
        return buildContractPartySignerRows({
            clientEmail: docuSignSignerEmail.email.trim(),
            clientName: getApplicationPrimaryRecipientName(applicationData),
            owners,
            guarantors: guarantorEntries.map((entry) => ({
                firstName: String(entry.guarantorFirstName || "").trim(),
                lastName: String(entry.guarantorLastName || "").trim(),
                email: String(entry.guarantorEmail || "").trim(),
            })),
        });
    }, [
        applicationData,
        crmOwnerPartiesForSigners,
        docuSignSignerEmail.email,
        ownerEntries,
        guarantorEntries,
    ]);

    /** DocuSign/BoldSign template roles for Summary (top-level `roles`, not `raw.roles`). */
    const summaryTemplateRoles = useMemo(() => {
        const ensuredSignerRows = ensureSignerRowsFromCrmOwners(
            contractSignerOverrides,
            crmOwnerPartiesForSigners,
        );
        if (ensuredSignerRows.length) {
            return ensuredSignerRows.map((r, idx) => ({
                roleName: r.role,
                signerEmail: r.email,
                signerName: r.name,
                roleIndex: idx + 1,
            }));
        }
        const parsed = platformSignerRoleRows.length
            ? platformSignerRoleRows
            : parseBoldSignTemplateRolesFromRecipientsPayload(templateRecipients);
        if (parsed.length > 0) {
            const merged = mergeApplicationDataIntoSignerRoles(
                buildBoldSignRolesFromTemplateRecipients(
                    parsed,
                    docuSignSignerEmail.email.trim(),
                    getApplicationPrimaryRecipientName(applicationData),
                    { singleSignerOnly: false },
                ),
                applicationSignerRowsForMerge,
            );
            return merged.map((r) => ({
                roleName: r.signerRole,
                signerEmail: r.signerEmail,
                signerName: r.signerName,
                roleIndex: r.roleIndex,
            }));
        }
        if (applicationSignerRowsForMerge.length > 0) {
            return applicationSignerRowsForMerge.map((r, idx) => ({
                roleName: r.role,
                signerEmail: r.email,
                signerName: r.name,
                roleIndex: idx + 1,
            }));
        }
        const signerEmail = docuSignSignerEmail.email.trim();
        if (!signerEmail) return [];
        return [
            {
                roleName: PLATFORM_PRIMARY_SIGNER_ROLE,
                signerEmail: signerEmail,
                signerName: getApplicationPrimaryRecipientName(applicationData),
                roleIndex: 1,
            },
        ];
    }, [
        contractSignerOverrides,
        crmOwnerPartiesForSigners,
        templateRecipients,
        platformSignerRoleRows,
        docuSignSignerEmail.email,
        applicationData,
        applicationSignerRowsForMerge,
    ]);

    const hasSavedSignerOverrides = Boolean(contractSignerOverrides?.length);

    /**
     * `contractOwnerList` is shared redux state, so before this contract's fetch
     * lands it still holds the previous contract's rows (or none). Rendering the
     * Summary signers off that stale list is what made the names/emails flip a
     * moment after the step opened, so hold the list until both the saved signer
     * overrides (prefill) and this contract's owner rows are in.
     */
    const [signerOwnersLoadedForContractId, setSignerOwnersLoadedForContractId] =
        useState<number | null>(null);

    const uploadedDocs = Array.isArray(uploadedDocsState.data)
        ? uploadedDocsState.data
        : EMPTY_LIST;
    const normalizeDocumentTypeKey = (value: unknown): string =>
        String(value ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "");
    const documentTypeByKey: Record<RequiredDocumentKey, string> = {
        voidedCheck: "Voided Check",
        driverLicense: "Driver License",
        driverLicenseOwner2: "Driver License Owner 2",
        // bankStatement: "Bank Statement",
        // utilityBill: "Utility Bill",
    };
    /** KYC DL / voided-check upload lives on the application Documents tab, not Create Contract. */
    const requiredDocumentRows: { key: RequiredDocumentKey; label: string; inputRef: React.RefObject<HTMLInputElement | null> }[] = [];
    const uploadedDocumentByTypeKey = useMemo(() => {
        const map = new Map<string, any>();
        for (const file of uploadedDocs) {
            const rawType =
                file?.documentType ||
                file?.type ||
                "";
            const key = normalizeDocumentTypeKey(rawType);
            if (key && !map.has(key)) map.set(key, file);
        }
        return map;
    }, [uploadedDocs]);
    const addendumDocsLayoutFunderId = useMemo(
        () =>
            selectedFunderProfile
                ? resolveAddendumDocumentsLayoutFunderId(selectedFunderProfile)
                : null,
        [selectedFunderProfile],
    );
    const platformDisclosureFunderId = useMemo(() => {
        const platform = funders.find((f) => isWoodmereFunderProfile(f));
        return String(platform?.id ?? "").trim() || null;
    }, [funders]);
    const platformDisclosureFunderIdRef = useRef<string | null>(null);
    platformDisclosureFunderIdRef.current = platformDisclosureFunderId;

    const disclosureDocsLayoutFunderId = useMemo(
        () =>
            selectedFunderProfile
                ? resolveDisclosureDocumentsLayoutFunderId(selectedFunderProfile, {
                      platformDisclosureFunderId,
                  })
                : null,
        [selectedFunderProfile, platformDisclosureFunderId],
    );
    const docsLayoutFunderId = addendumDocsLayoutFunderId;
    const docsLayoutFunderIdRef = useRef<string | null>(null);
    docsLayoutFunderIdRef.current = docsLayoutFunderId;
    const disclosureDocsLayoutFunderIdRef = useRef<string | null>(null);
    disclosureDocsLayoutFunderIdRef.current = disclosureDocsLayoutFunderId;
    const boldSignTemplatesRef = useRef(boldSignTemplates);
    boldSignTemplatesRef.current = boldSignTemplates;

    const addendumTemplateOptions = useMemo(() => {
        // SignNow Create Contract is funder-driven: only Settings → Funders links.
        // Never fall back to Nitro hardcoded addendums for another funder.
        if (isSignNowContractUiEnabled()) {
            if (!selectedFunderProfile) return [];
            return withSignNowAddendumOptions([], selectedFunderProfile);
        }

        const fromDb = boldSignTemplates.filter((template: any) => {
            if (!isContractAddendumTemplateRow(template)) return false;
            return templateMatchesFunderDocuments(template, docsLayoutFunderId);
        });

        if (docsLayoutFunderId) return fromDb;

        const existingKeys = new Set(
            fromDb.map((t: any) => templateLayoutKeyToken(t)).filter(Boolean),
        );
        const platformSynthetic = CONTRACT_ADDENDUM_DOCUMENT_OPTIONS.filter(
            (opt) => !existingKeys.has(opt.layoutKey),
        ).map((opt) => ({
            id: opt.layoutKey,
            layoutKey: opt.layoutKey,
            templateId: opt.layoutKey,
            name: opt.label,
            type: opt.layoutKey,
            pdfUrl: `platform://${opt.layoutKey}`,
        }));

        return [...fromDb, ...platformSynthetic];
    }, [boldSignTemplates, docsLayoutFunderId, selectedFunderProfile]);

    /** Prefer Settings layout key over a raw SignNow hex so dropdown labels stay human. */
    const resolveAddendumSelectionRef = useCallback(
        (template: {
            id?: string | null;
            name?: string | null;
            layoutKey?: string | null;
            templateId?: string | null;
        } | null | undefined): string => {
            const funderMatch = matchFunderSignNowAddendumOption(
                template,
                selectedFunderAddendumOptions,
            );
            if (funderMatch?.layoutKey) return funderMatch.layoutKey;
            if (funderMatch?.templateId) return funderMatch.templateId;
            const fromOptions = addendumTemplateOptions.find((t: any) => {
                const ref = getAddendumDropdownRef(t);
                const layoutKey = String(t?.layoutKey || "").trim().toLowerCase();
                const templateId = extractSignNowTemplateId(
                    t?.templateId || t?.id || "",
                );
                const rowRef = getAddendumDropdownRef(template);
                const rowTid = extractSignNowTemplateId(
                    template?.templateId || template?.id || "",
                );
                const rowLk = String(template?.layoutKey || "")
                    .trim()
                    .toLowerCase();
                return Boolean(
                    (rowRef && ref === rowRef) ||
                        (rowTid && (rowTid === templateId || rowTid === layoutKey)) ||
                        (rowLk && (rowLk === layoutKey || rowLk === templateId)),
                );
            });
            if (fromOptions) {
                return (
                    getAddendumDropdownRef(fromOptions) ||
                    String(fromOptions.layoutKey || fromOptions.templateId || "").trim()
                );
            }
            return getAddendumDropdownRef(template);
        },
        [selectedFunderAddendumOptions, addendumTemplateOptions],
    );

    const addendumPickerOptions = useMemo((): AddendumPickerOption[] => {
        const options: AddendumPickerOption[] = [];
        const seen = new Set<string>();
        for (const t of addendumTemplateOptions as any[]) {
            const ref = getAddendumDropdownRef(t);
            if (!ref || !boldSignTemplateIsPreviewable(t) || seen.has(ref)) continue;
            seen.add(ref);
            const rawName = resolveFunderAddendumDisplayName(
                ref,
                selectedFunderAddendumOptions,
                t?.name || t?.templateName || t?.title || null,
            );
            options.push({
                ref,
                label: formatDropdownLabel(rawName) || "Addendum",
            });
        }
        return options;
    }, [addendumTemplateOptions, selectedFunderAddendumOptions]);

    const selectedAddendumRefs = useMemo(
        () =>
            expandAddendumRefsAllowingDuplicates(
                selectedAddendumOptions
                    .filter((opt) => opt.startsWith("bs:"))
                    .map((opt) => opt.slice(3).trim())
                    .filter(Boolean),
            ),
        [selectedAddendumOptions],
    );

    const exhibitCPickerRef = useMemo(
        () => findExhibitCOptionRef(addendumPickerOptions, selectedAddendumRefs),
        [addendumPickerOptions, selectedAddendumRefs],
    );

    const exhibitCSelectedCount = useMemo(() => {
        if (!exhibitCPickerRef) return 0;
        return countAddendumRefOccurrences(selectedAddendumRefs, exhibitCPickerRef);
    }, [exhibitCPickerRef, selectedAddendumRefs]);

    const orderedLinkedAddendumMappings = useMemo(() => {
        const selectedRefs = expandAddendumRefsAllowingDuplicates(
            selectedAddendumOptions
                .map((opt) => {
                    const trimmed = String(opt || "").trim();
                    if (!trimmed.startsWith("bs:")) return "";
                    return trimmed.slice(3).trim();
                })
                .filter(Boolean),
        );

        // Instant send-order rows from the picker while CRM mappings catch up.
        // Prevents the empty "No addendum template linked yet" flash / stuck state.
        const buildPendingRow = (
            ref: string,
            index: number,
        ): ContractDocumentTemplateMappingRow => {
            const opt = addendumPickerOptions.find(
                (o) =>
                    o.ref === ref ||
                    (isMultiInstanceAddendumRef(ref) &&
                        isMultiInstanceAddendumRef(o.ref, o.label)),
            );
            const funderOpt = selectedFunderAddendumOptions.find(
                (o) =>
                    o.layoutKey === ref ||
                    o.templateId === ref ||
                    (isMultiInstanceAddendumRef(ref, opt?.label) &&
                        o.knownLayoutKey === "exhibit_c"),
            );
            const label =
                opt?.label ||
                funderOpt?.name ||
                formatDropdownLabel(ref) ||
                "Addendum";
            const templateId =
                funderOpt?.templateId ||
                (extractSignNowTemplateId(ref) || ref);
            return {
                id: `pending:${ref}:${index}`,
                contractId: 0,
                templateId,
                documentType: "addendum",
                order: index + 1,
                template: {
                    id: templateId,
                    name: label,
                    templateId,
                    layoutKey: funderOpt?.knownLayoutKey || ref,
                    pdfUrl: funderOpt?.pdfUrl || undefined,
                },
            };
        };

        if (!linkedAddendumMappings.length) {
            return selectedRefs.map((ref, index) => buildPendingRow(ref, index));
        }
        if (!selectedRefs.length) return linkedAddendumMappings;

        const used = new Set<string>();
        const usedNonMultiKinds = new Set<string>();
        const ordered: ContractDocumentTemplateMappingRow[] = [];
        for (let i = 0; i < selectedRefs.length; i++) {
            const ref = selectedRefs[i];
            const refKind = canonicalAddendumDedupKey(ref);
            const row = linkedAddendumMappings.find((candidate) => {
                if (used.has(candidate.id)) return false;
                const dropdownRef = getAddendumDropdownRef(candidate.template);
                const mappingRef = getBoldSignTemplateMappingRef(candidate.template);
                const selectionRef = resolveAddendumSelectionRef(candidate.template);
                const rowLabel = candidate.template?.name || "";
                if (
                    sameAddendumPickerRef(dropdownRef, ref) ||
                    sameAddendumPickerRef(mappingRef, ref) ||
                    sameAddendumPickerRef(selectionRef, ref)
                ) {
                    return true;
                }
                if (
                    isAchDailyAddendumRef(ref) &&
                    isAchDailyAddendumRef(
                        selectionRef || dropdownRef || mappingRef || candidate.template?.layoutKey,
                        rowLabel,
                    )
                ) {
                    return true;
                }
                if (
                    isAchWeeklyAddendumRef(ref) &&
                    isAchWeeklyAddendumRef(
                        selectionRef || dropdownRef || mappingRef || candidate.template?.layoutKey,
                        rowLabel,
                    )
                ) {
                    return true;
                }
                return (
                    isMultiInstanceAddendumRef(ref) &&
                    isMultiInstanceAddendumRef(
                        selectionRef || dropdownRef || mappingRef,
                        rowLabel,
                    )
                );
            });
            if (row) {
                used.add(row.id);
                if (refKind && !isMultiInstanceAddendumRef(ref)) {
                    usedNonMultiKinds.add(refKind);
                }
                ordered.push(row);
                continue;
            }
            // Never invent a second pending spinner for the same ACH Daily/Weekly
            // (or other single-instance) when hex + layout key both appear in selection.
            if (refKind && !isMultiInstanceAddendumRef(ref) && usedNonMultiKinds.has(refKind)) {
                continue;
            }
            if (refKind && !isMultiInstanceAddendumRef(ref)) {
                usedNonMultiKinds.add(refKind);
            }
            ordered.push(buildPendingRow(ref, i));
        }
        // Selection is the send-order source of truth — do not re-append unused
        // linked leftovers (those became stuck Ach Daily/Weekly spinner twins).
        return ordered;
    }, [
        linkedAddendumMappings,
        selectedAddendumOptions,
        resolveAddendumSelectionRef,
        addendumPickerOptions,
        selectedFunderAddendumOptions,
    ]);

    /** Mapping ids of every Exhibit C (first included) — each is its own entity. */
    const exhibitCCopyMappingIds = useMemo(
        () =>
            orderedLinkedAddendumMappings
                .filter((candidate) => {
                    // Funder-aware, like the send-order labels: a funder's Exhibit C
                    // stored as a bare SignNow id is only recognisable via its match.
                    const match = matchFunderSignNowAddendumOption(
                        candidate?.template,
                        selectedFunderAddendumOptions,
                    );
                    return isExhibitCFamilyAddendumRef(
                        match?.knownLayoutKey ||
                            match?.templateId ||
                            getAddendumDropdownRef(candidate?.template) ||
                            candidate?.template?.layoutKey,
                        match?.name || candidate?.template?.name,
                    );
                })
                .map((candidate) => String(candidate?.id ?? "").trim())
                .filter(Boolean),
        [orderedLinkedAddendumMappings, selectedFunderAddendumOptions],
    );

    const addendumDocs = uploadedDocs.filter((file: any) => {
        const text = String(
            file?.documentType || file?.fileName || "",
        ).toLowerCase();
        return text.includes("addendum");
    });
    const payoffLetterDocs = uploadedDocs.filter((file: any) => {
        const text = String(
            file?.documentType || file?.fileName || "",
        ).toLowerCase();
        return text.includes("payoff");
    });

    const applicationIdForLookup = useMemo(() => {
        const d = applicationData as { _id?: string; id?: string } | undefined;
        const fromData = String(d?._id ?? d?.id ?? "").trim();
        if (fromData && isApplicationUuid(fromData)) return fromData;
        const fromProp = applicationId?.trim() || "";
        if (fromProp && isApplicationUuid(fromProp)) return fromProp;
        // Backend accepts numeric display applicationId as fallback.
        return fromData || fromProp || null;
    }, [applicationId, applicationData]);

    useEffect(() => {
        if (!isOpen || !applicationIdForLookup) return;
        let cancelled = false;
        axiosGet(`/contract/agent-email/${encodeURIComponent(applicationIdForLookup)}`)
            .then((res) => {
                if (cancelled) return;
                setAgentEmails(readAgentEmailsFromResponse(res?.data?.data));
                setAgentEmailSource(String(res?.data?.data?.source ?? "none"));
            })
            .catch(() => {
                /* No contract yet — the agent row stays empty. */
            });
        return () => {
            cancelled = true;
        };
    }, [isOpen, applicationIdForLookup]);

    const applicationMongoId = useMemo(() => {
        const d = applicationData as { _id?: string; id?: string } | undefined;
        return String(d?._id ?? d?.id ?? "").trim() || null;
    }, [applicationData]);

    const numericApplicationId = useMemo(() => {
        const n = (applicationData as { applicationId?: number } | null)?.applicationId;
        return n != null ? String(n) : null;
    }, [applicationData]);

    const refreshApplicationDocumentsTab = useCallback(() => {
        if (numericApplicationId) {
            invalidateApplicationDetailCache(numericApplicationId);
            void dispatch(getApplicationByApplicationId(numericApplicationId));
            return;
        }
        const uuid = applicationMongoId || applicationIdForLookup;
        if (uuid) {
            invalidateApplicationDetailCache(String(uuid));
            void dispatch(getApplicationById(String(uuid)));
        }
    }, [dispatch, numericApplicationId, applicationMongoId, applicationIdForLookup]);

    const documentRequestLookupId = numericApplicationId || applicationIdForLookup;

    const requestDocsRoleKey = normalizeRoleKey(
        (loginData as { user?: { role?: string } } | null)?.user?.role ||
            (typeof window !== "undefined" ? localStorage.getItem("role") : "") ||
            "",
    );
    const showRequestDocuments =
        Boolean(onPrepareDocuSignDraft) &&
        (requestDocsRoleKey === "UNDERWRITER" ||
            requestDocsRoleKey === "FINAL_UNDERWRITER" ||
            requestDocsRoleKey === "SUPER_ADMIN" ||
            requestDocsRoleKey === "OPERATIONS");

    const pendingDocumentRequests = useMemo(
        () => (documentRequests || []).filter((doc) => doc.status === "Pending"),
        [documentRequests],
    );
    const completedDocumentRequests = useMemo(
        () => (documentRequests || []).filter((doc) => doc.status === "Complete"),
        [documentRequests],
    );

    useEffect(() => {
        if (!isOpen || !documentRequestLookupId) return;
        void dispatch(getDocumentRequestsByApplication(documentRequestLookupId));
    }, [isOpen, documentRequestLookupId, dispatch]);

    const contractPrefillRecords: ContractPrefillContractRecords = useMemo(() => {
        const firstRow = (data: unknown): Record<string, unknown> | null =>
            Array.isArray(data) && data.length ? (data[0] as Record<string, unknown>) : null;
        const bankDetailApplicationKeys = [
            applicationIdForLookup,
            applicationMongoId,
            numericApplicationId,
            (applicationData as { applicationId?: number } | null)?.applicationId,
        ];
        const filteredBanks = filterBankDetailsForApplication(
            Array.isArray(bankDetailsList) ? bankDetailsList : [],
            bankDetailApplicationKeys,
        );
        const banksOldestFirst = [...filteredBanks].sort((a, b) => {
            const ta = new Date(a.createdAt ?? a.updatedAt ?? 0).getTime();
            const tb = new Date(b.createdAt ?? b.updatedAt ?? 0).getTime();
            return ta - tb;
        });
        const mainBank =
            banksOldestFirst.find(hasCompleteBankDetailRow) ?? banksOldestFirst[0] ?? null;
        const mapBank = (bank: (typeof banksOldestFirst)[number]) => ({
            _id: bank._id,
            id: bank._id ?? (bank as { id?: string }).id,
            bankName: bank.bankName,
            accountNumber: bank.accountNumber,
            routingNumber: bank.routingNumber,
        });
        const contractRow = resolvedContract as Record<string, unknown> | null;
        const mergedContract =
            contractRow && typeof contractRow === "object"
                ? (() => {
                      const o = mergeContractPrefillOverrideLayers(
                          stripDocumentTemplateBlobFromPrefillOverrides(
                              normalizeContractPrefillOverrides(
                                  contractRow.contractPrefillOverrides,
                              ) ?? null,
                          ),
                          contractPrefillFromDb,
                      );
                      const next: Record<string, unknown> =
                          Object.keys(o).length > 0 ? { ...contractRow, ...o } : { ...contractRow };
                      if (
                          mainBank &&
                          (next.paymentBank == null || typeof next.paymentBank !== "object")
                      ) {
                          next.paymentBank = mapBank(mainBank);
                      }
                      return Object.keys(next).length > 0 ? next : contractRow;
                  })()
                : null;
        return {
            contract: mergedContract,
            ach: firstRow(achListState.data),
            achs: Array.isArray(achListState.data)
                ? (achListState.data as Record<string, unknown>[])
                : [],
            bankDetail: mainBank ? mapBank(mainBank) : null,
            bankDetails: banksOldestFirst.map(mapBank),
            addendum: firstRow(addendumListState.data),
            addendums: Array.isArray(addendumListState.data)
                ? (addendumListState.data as Record<string, unknown>[])
                : [],
            epo: firstRow(epoListState.data),
            owners: resolveOwnerRowsForContractPrefill(
                applicationForPrefill,
                Array.isArray(ownerListState.data) ? ownerListState.data : [],
            ),
            guarantors: Array.isArray(guarantorListState.data) ? guarantorListState.data : [],
        };
    }, [
        achListState.data,
        bankDetailsList,
        addendumListState.data,
        epoListState.data,
        ownerListState.data,
        guarantorListState.data,
        resolvedContract,
        contractPrefillFromDb,
        applicationIdForLookup,
        applicationMongoId,
        numericApplicationId,
        applicationData,
        applicationForPrefill,
    ]);

    const activeOwnerCountForPrefill = useMemo(
        () =>
            resolveActiveOwnerCount({
                owners: contractPrefillRecords.owners ?? null,
                signerRoles: contractSignerOverrides?.map((r) => ({
                    signerRole: r.role,
                    signerEmail: r.email,
                })),
            }),
        [contractPrefillRecords.owners, contractSignerOverrides],
    );

    const contractPrefillOverrides = useMemo(() => {
        const fromNote = parseNoteStructuredSection<Partial<BuildContractPrefillFieldsArgs>>(
            String((applicationData as { note?: string } | null | undefined)?.note || ""),
            CONTRACT_PREFILL_OVERRIDES_SECTION,
        );
        if (!contractPrefillLoaded) return fromNote ?? undefined;
        const merged = mergeContractPrefillOverrideLayers(
            fromNote,
            stripDocumentTemplateBlobFromPrefillOverrides(
                normalizeContractPrefillOverrides(
                    (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides,
                ) ?? null,
            ),
            contractPrefillFromDb,
        );
        return Object.keys(merged).length > 0 ? merged : undefined;
    }, [applicationData, contractPrefillFromDb, contractPrefillLoaded, resolvedContract]);

    const offerDecisionMoneyKey = useMemo(
        () =>
            offerDecisionMoneyFingerprint(
                (offerDecisionData as Record<string, unknown> | null) ?? null,
            ),
        [offerDecisionData],
    );

    const prefillDraftFingerprint = useMemo(
        () =>
            docuSignPrefillDraftFingerprint({
                contractPrefillOverrides: contractPrefillFromDb,
                documentTemplatePrefillByMappingId,
                offerDecisionMoneyKey,
            }),
        [contractPrefillFromDb, documentTemplatePrefillByMappingId, offerDecisionMoneyKey],
    );

    const canEditContractPrefill = useMemo(
        () => Boolean(applicationIdForLookup),
        [applicationIdForLookup],
    );

    const signNowReviewOpen = Boolean(signNowEmbedUrl && signNowReviewVisible);

    /** Step 4 (Sent) only — no DocuSign PDF tab on Documents / Info / Summary. */
    const showDocuSignContractTab = useMemo(
        () =>
            Boolean(signNowReviewOpen) ||
            (activeStep === "sent" &&
                (sentStepUnlocked || isContractAlreadySent(resolvedContract, sentAt))),
        [signNowReviewOpen, activeStep, resolvedContract, sentAt, sentStepUnlocked],
    );

    const signingFinishedForPoll = useMemo(
        () => isContractSigningFinished(resolvedContract),
        [resolvedContract],
    );

    const canReviewAndSendDocuSign = useMemo(
        () => canReviewAndSendToDocuSign(resolvedContract, sentAt),
        [resolvedContract, sentAt],
    );

    const canResendContract = useMemo(
        () => canResendMainContract(resolvedContract, sentAt),
        [resolvedContract, sentAt],
    );

    const isContractOutForSignature = useMemo(() => {
        return getPrimaryContractEnvelopeView(resolvedContract, sentAt).isOutForSignature;
    }, [resolvedContract, sentAt]);

    const latestEnvelopeStatusLabel = useMemo(
        () => formatContractSigningStatusLabel(resolveLatestEnvelopeStatus(resolvedContract)),
        [resolvedContract],
    );

    const showResendContractOnSentStep = useMemo(
        () => activeStep === "sent" && canResendContract,
        [activeStep, canResendContract],
    );

    const docuSignPrimaryActionLabel = useMemo(() => {
        if (showResendContractOnSentStep) {
            // Rebuilds the whole package from the current application / offer rather
            // than re-sending the one already on the deal.
            return "Resend new contract";
        }
        if (isSignNowContractUiEnabled()) {
            // Only a finished review can be sent. Offering Send while the review
            // was merely open is how a package went out before the Owner's Finish.
            if (signNowReviewComplete) return "Send via SignNow";
            return includeMainContractInSend || !canSendWithoutContract
                ? "Review in SignNow"
                : "Review documents in SignNow";
        }
        if (!includeMainContractInSend && canSendWithoutContract) {
            return "Review & send documents in DocuSign";
        }
        return "Review & send in DocuSign";
    }, [
        showResendContractOnSentStep,
        includeMainContractInSend,
        canSendWithoutContract,
        signNowReviewOpen,
        signNowReviewComplete,
    ]);

    const reviewSendButtonLabel = (() => {
        if (signNowPreparePhase === "validating") return "Validating document fields…";
        if (signNowPreparePhase === "preparing") return "Preparing documents…";
        if (!isSending) return docuSignPrimaryActionLabel;
        if (!isSignNowContractUiEnabled()) return "Preparing DocuSign…";
        return signNowEmbedUrl || signNowReviewComplete
            ? "Sending via SignNow…"
            : "Opening SignNow…";
    })();

    /**
     * Full CRM → DocuSign prefill list (every field id). Must NOT run through
     * `prepareDealReviewPrefillDisplay` — that dedupes for UI and drops sibling data labels.
     */
    const dealPrefillFieldsForDocuSign = useMemo(() => {
        const effectiveOverrides = mergeContractPrefillOverrideLayers(
            contractPrefillOverrides,
            contractPrefillLoaded ? contractPrefillFromDb : null,
        );
        const fromApp = buildContractPrefillFieldsFromApplication(applicationForPrefill, {
            agreementDate: formatDateMonthDayYear(new Date()),
            contractRecords: contractPrefillRecords,
            overrides:
                Object.keys(effectiveOverrides).length > 0 ? effectiveOverrides : undefined,
            offerDecision: (offerDecisionData as Record<string, unknown> | null) ?? null,
        });
        const byId = new Map<string, ContractPrefillField>();
        const order: string[] = [];
        for (const f of fromApp) {
            byId.set(f.id, f);
            order.push(f.id);
        }
        const hasSavedOverrides = Object.keys(effectiveOverrides).length > 0;
        if (!hasSavedOverrides) {
            for (const p of prefillFieldsPreview) {
                const v = String(p.value || "").trim();
                if (!v) continue;
                if (!byId.has(p.id)) order.push(p.id);
                const existing = byId.get(p.id);
                byId.set(p.id, {
                    id: p.id,
                    label: p.label || existing?.label || p.id,
                    value: v,
                });
            }
        }
        const mergedList = order.map((id) => byId.get(id)!);
        return overlaySavedAppendixFeeOnPrefillFields(
            mergedList,
            effectiveOverrides,
            {
                application: applicationData as Record<string, unknown> | undefined,
                contract: contractPrefillRecords.contract ?? null,
                offerDecision: (offerDecisionData as Record<string, unknown> | null) ?? null,
            },
        );
    }, [
        applicationData,
        applicationForPrefill,
        prefillFieldsPreview,
        contractPrefillRecords,
        contractPrefillOverrides,
        contractPrefillFromDb,
        contractPrefillLoaded,
        offerDecisionData,
    ]);

    /** Deal Review UI only — shortened labels, one row per section+label. */
    const dealReviewFields = useMemo(
        () => prepareDealReviewPrefillDisplay(dealPrefillFieldsForDocuSign),
        [dealPrefillFieldsForDocuSign],
    );

    // Initialize / sync Deal Review draft from CRM prefill.
    // Full refresh when clean; when dirty, still refresh live money fields if OfferDecision changed.
    useEffect(() => {
        if (!isOpen || activeStep !== "summary") return;
        const offerKey = offerDecisionMoneyKey;
        const offerChanged =
            Boolean(prevDealReviewOfferMoneyKeyRef.current) &&
            prevDealReviewOfferMoneyKeyRef.current !== offerKey;
        prevDealReviewOfferMoneyKeyRef.current = offerKey;

        const liveMoneyIds = new Set(
            [
                "purchase_amount",
                "purchased_amount",
                "purchase_price",
                "remittance",
                "refinance_amount",
                "frequency",
                "paymentterms",
                "net_to_merchant",
                "netfundprovided",
                "appendix_underwriting_fees",
                "ach_authorization_account_holder_bank_transaction_fee",
                "ach_authorization_account_holder_bank_number_of_transactions",
                "addendum_dated_principal_owner_amount",
                "addendum_dated_principal_owner_amount2",
            ].map((id) => id.toLowerCase()),
        );

        const fingerprint = dealReviewFields
            .map((f) => `${f.id}=${String(f.value ?? "")}`)
            .join("|");

        if (!dealReviewDraftDirty) {
            // Skip setState when values are unchanged — avoids infinite update loops.
            if (fingerprint === dealReviewDraftFingerprintRef.current) return;
            const next: Record<string, string> = {};
            for (const f of dealReviewFields) {
                next[f.id] = String(f.value ?? "");
            }
            dealReviewDraftFingerprintRef.current = fingerprint;
            setDealReviewDraftById(next);
            return;
        }

        if (offerChanged) {
            setDealReviewDraftById((prev) => {
                let changed = false;
                const merged = { ...prev };
                for (const f of dealReviewFields) {
                    const idNorm = String(f.id || "").trim().toLowerCase();
                    if (!liveMoneyIds.has(idNorm)) continue;
                    const nextVal = String(f.value ?? "");
                    if (merged[f.id] !== nextVal) {
                        merged[f.id] = nextVal;
                        changed = true;
                    }
                }
                return changed ? merged : prev;
            });
        }
    }, [
        isOpen,
        activeStep,
        dealReviewFields,
        dealReviewDraftDirty,
        offerDecisionMoneyKey,
    ]);

    useEffect(() => {
        if (!isOpen) {
            setDealReviewDraftById({});
            setDealReviewDraftDirty(false);
            prevDealReviewOfferMoneyKeyRef.current = "";
            dealReviewDraftFingerprintRef.current = "";
            setDisclosureCalcBankAnalyses(null);
        }
    }, [isOpen]);

    const offerDecisionSummaryRows = useMemo(() => {
        const od = offerDecisionData as Record<string, unknown> | null;
        if (!od) return [];
        const firstOf = (...keys: string[]): unknown => {
            for (const k of keys) {
                const v = od[k];
                if (v !== null && v !== undefined && String(v).trim() !== "") return v;
            }
            return null;
        };
        const row = (label: string, value: unknown) => ({
            label,
            value: formatOfferDecisionCell(label, value),
        });
        const feeDollars = resolveOfferDecisionFeesDisplayDollars(od, {
            applicationCommissionPercentage: (applicationData as { commissionPercentage?: unknown })
                ?.commissionPercentage,
        });
        return [
            row("Decision", od.decision),
            row("Position", od.position),
            row("Offer amount", firstOf("offer", "approvedAmount")),
            row("Factor rate", od.rate),
            row("Term", firstOf("term", "termLength")),
            row("Frequency", od.frequency),
            row("Repay per period", firstOf("repayPerPeriod", "paymentAmount")),
            row("Monthly payment", od.monthlyPayment),
            row("Fees", feeDollars > 0 ? feeDollars : od.fees),
            row("REFI Amount", firstOf("refinanceAmount", "RefinanceAmount")),
            row("Our remit", od.ourRemit),
            row("Total remit", firstOf("repayPerPeriod", "paymentAmount", "daysWeeks")),
            row("Commission", od.commissionAmount),
            row("Number of payments", firstOf("numberOfPayments", "paymentsTerms")),
            row("Notes", od.notes),
            row("Decline reason", od.declineReason),
        ];
    }, [offerDecisionData, applicationData]);

    useEffect(() => {
        if (!isOpen || !applicationIdForLookup) return;
        void dispatch(getOfferDecisionByApplication(applicationIdForLookup));
        void dispatch(getTermsOffers({ application: applicationIdForLookup }));
    }, [isOpen, applicationIdForLookup, dispatch]);

    /** Re-fetch offer decision when saved elsewhere (e.g. scrubbing Offer Decision) while viewer is open. */
    useEffect(() => {
        if (!isOpen || !applicationIdForLookup) return;
        const onOfferDecisionUpdated = (event: Event) => {
            const detail = (event as CustomEvent<{ applicationId?: string; skipRefetch?: boolean }>).detail;
            if (
                !offerDecisionUpdateMatchesApplication(
                    detail?.applicationId,
                    applicationIdForLookup,
                )
            ) {
                return;
            }
            if (detail?.skipRefetch) return;
            void dispatch(getOfferDecisionByApplication(applicationIdForLookup));
            void dispatch(getTermsOffers({ application: applicationIdForLookup }));
        };
        window.addEventListener(OFFER_DECISION_UPDATED_EVENT, onOfferDecisionUpdated);
        return () => {
            window.removeEventListener(OFFER_DECISION_UPDATED_EVENT, onOfferDecisionUpdated);
        };
    }, [isOpen, applicationIdForLookup, dispatch]);

    /** Sent step: refresh from CRM (webhook). Skip DocuSign API when SignNow is the provider. */
    useEffect(() => {
        if (!isOpen || activeStep !== "sent") return;
        void refreshContractSigningStateRef.current(true, {
            syncDocuSign: !isSignNowContractUiEnabled(),
            forceDocuSignSync: false,
        });
    }, [isOpen, activeStep]);

    useEffect(() => {
        if (!isOpen) {
            setResolvedContractId(null);
            /**
             * The row must not outlive the opening it was loaded for. The next opening judged
             * "already sent" from it before the fresh load landed, so after a resend archived
             * the envelope the wizard still treated the deal as sent and hid Review in SignNow.
             */
            setResolvedContract(null);
            addendumDropdownOpenRef.current = false;
            userSelectedFunderRef.current = false;
            userSelectedStateRef.current = false;
            setContractPrefillFromDb(null);
            setContractPrefillLoaded(false);
            setDocumentTemplatePrefillByMappingId({});
            setSessionEnvelopeId(null);
            setDocuSignOpenUrl(null);
            setContractSignerOverrides(null);
            setSignerOwnersLoadedForContractId(null);
            setShowRecipientEditor(false);
            autoSeededSignersKeyRef.current = "";
            draftPreparedAddendumIdRef.current = undefined;
            draftPreparedCcRef.current = null;
            draftPreparedPrefillFingerprintRef.current = null;
            lastPrefillSyncFailureToastKeyRef.current = null;
            draftPreparedSignerRolesRef.current = null;
            prefilledPdfCachedForEnvelopeRef.current = null;
            prefilledBoldSignPdfUrlRef.current = null;
            lastAutoPreviewKeyRef.current = "";
            uploadedPreviewUrlRef.current = null;
            setUploadedPreviewUrl(null);
            setPreviewingMainContract(false);
            signNowForceFreshReviewRef.current = false;
            signNowCachedEmbedUrlRef.current = null;
            signNowReviewEnvelopeIdRef.current = null;
            setSignNowEmbedUrl(null);
            setSignNowReviewVisible(false);
            setSignNowReviewComplete(false);
            closeSignNowReviewTab();
            signNowCompleteToastShownRef.current = null;
            awaitingDocuSignSendRef.current = false;
            toast.dismiss(SIGNNOW_REVIEW_TOAST_ID);
            return;
        }
        const propId = Number(contractId);
        const appId = applicationIdForLookup;
        const loadKey = `${appId ?? ""}:${Number.isFinite(propId) && propId > 0 ? propId : ""}`;
        const isNewContractLoad = contractPrefillLoadKeyRef.current !== loadKey;
        contractPrefillLoadKeyRef.current = loadKey;
        if (isNewContractLoad) {
            userSelectedFunderRef.current = false;
            userSelectedStateRef.current = false;
            setContractPrefillLoaded(false);
            setSelectedState("");
            setSelectedFunder("");
            setSelectedFunderProfileId("");
            setSelectedAddendumOptions([]);
            addendumOptimisticRefsRef.current = null;
            addendumAutoLinkKeyRef.current = "";
            addendumUserInteractedAtRef.current = 0;
            addendumUserRemovedKindsRef.current.clear();
        }
        const applyContractMeta = (contract: unknown) => {
            const c = contract as { state?: unknown; funderName?: unknown; contractPrefillOverrides?: unknown } | null;
            setResolvedContract(c && typeof c === "object" ? (c as Record<string, unknown>) : null);
            let stateVal = pickUsStateForSelect(c?.state);
            if (!stateVal) {
                stateVal = resolveDealStateFromApplication(applicationDataRef.current);
            }
            setSelectedState(stateVal);
            if (!userSelectedFunderRef.current) {
                /**
                 * The funder stored on the contract row wins over the platform default. It
                 * is the one the deal was last built and sent under and it survives a
                 * resend, so forcing Nitro Advance here dropped a deal funded by anyone
                 * else back to the wrong funder every time the wizard reopened.
                 */
                const rawFunder = String(c?.funderName ?? "").trim();
                const savedProfile = rawFunder
                    ? findFunderProfile(fundersRef.current, rawFunder, stateVal)
                    : null;
                if (savedProfile) {
                    setSelectedFunderProfileId(savedProfile.id);
                    setSelectedFunder(savedProfile.name);
                } else if (rawFunder) {
                    const funderName =
                        pickFunderForSelect(
                            rawFunder,
                            funderNamesForContractState(fundersRef.current, stateVal),
                        ) || rawFunder;
                    const resolvedProfile = findFunderProfile(
                        fundersRef.current,
                        funderName,
                        stateVal,
                    );
                    setSelectedFunderProfileId(resolvedProfile?.id ?? "");
                    setSelectedFunder(resolvedProfile?.name ?? funderName);
                } else {
                    const nitro = fundersRef.current.find(
                        (f) => f.isActive !== false && isWoodmereFunderProfile(f),
                    );
                    setSelectedFunderProfileId(nitro?.id ?? "");
                    setSelectedFunder(nitro?.name ?? "");
                }
            }
            setContractPrefillFromDb(
                stripDocumentTemplateBlobFromPrefillOverrides(
                    normalizeContractPrefillOverrides(c?.contractPrefillOverrides),
                ),
            );
            setDocumentTemplatePrefillByMappingId(parseDocumentTemplatePrefillByMappingId(c?.contractPrefillOverrides));
            setContractSignerOverrides(
                parseContractSignerOverridesFromPrefill(c?.contractPrefillOverrides),
            );
            setContractPrefillLoaded(true);
        };

        if (!appId) {
            setResolvedContractId(Number.isFinite(propId) && propId > 0 ? propId : null);
            if (!Number.isFinite(propId) || propId <= 0) {
                setResolvedContract(null);
                setSelectedState(resolveDealStateFromApplication(applicationDataRef.current));
                setSelectedFunder("");
                setSelectedFunderProfileId("");
                setDocumentTemplatePrefillByMappingId({});
                setContractPrefillLoaded(true);
                return;
            }
            let cancelledNoApp = false;
            void (async () => {
                try {
                    const res = await dispatch(getByIdContract(propId)).unwrap();
                    const contract = (res as any)?.data ?? res;
                    if (cancelledNoApp) return;
                    applyContractMeta(contract);
                } catch {
                    if (!cancelledNoApp) {
                        setResolvedContract(null);
                        setSelectedState(resolveDealStateFromApplication(applicationDataRef.current));
                        setSelectedFunder("");
                        setSelectedFunderProfileId("");
                        setContractPrefillFromDb(null);
                        setDocumentTemplatePrefillByMappingId({});
                        setContractPrefillLoaded(true);
                    }
                }
            })();
            return () => {
                cancelledNoApp = true;
            };
        }

        let cancelled = false;
        void (async () => {
            try {
                // `fresh`: a cached copy from before a resend still carries the archived,
                // sent envelope and would mark the new draft as already sent.
                const res = await dispatch(
                    getByApplicationIdContract({ applicationId: appId, fresh: true }),
                ).unwrap();
                const contract = (res as any)?.data ?? res;
                const id = Number((contract as any)?.id);
                if (cancelled) return;
                applyContractMeta(contract);
                if (Number.isFinite(id) && id > 0) {
                    setResolvedContractId(id);
                } else if (Number.isFinite(propId) && propId > 0) {
                    setResolvedContractId(propId);
                } else {
                    setResolvedContractId(null);
                }
            } catch {
                if (!cancelled) {
                    setResolvedContractId(Number.isFinite(propId) && propId > 0 ? propId : null);
                    if (Number.isFinite(propId) && propId > 0) {
                        try {
                            const res2 = await dispatch(getByIdContract(propId)).unwrap();
                            const contract2 = (res2 as any)?.data ?? res2;
                            if (!cancelled) applyContractMeta(contract2);
                        } catch {
                            if (!cancelled) {
                                setResolvedContract(null);
                                setSelectedState(resolveDealStateFromApplication(applicationDataRef.current));
                                setSelectedFunder("");
                                setSelectedFunderProfileId("");
                                setContractPrefillFromDb(null);
                                setDocumentTemplatePrefillByMappingId({});
                                setContractPrefillLoaded(true);
                            }
                        }
                    } else {
                        setResolvedContract(null);
                        setSelectedState(resolveDealStateFromApplication(applicationDataRef.current));
                        setSelectedFunder("");
                        setSelectedFunderProfileId("");
                        setContractPrefillFromDb(null);
                        setDocumentTemplatePrefillByMappingId({});
                        setContractPrefillLoaded(true);
                    }
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen, contractId, applicationIdForLookup, dispatch, closeSignNowReviewTab]);

    const effectiveContractId = useMemo(() => {
        if (resolvedContractId != null && Number.isFinite(resolvedContractId) && resolvedContractId > 0) {
            return resolvedContractId;
        }
        const n = Number(contractId);
        return Number.isFinite(n) && n > 0 ? n : null;
    }, [resolvedContractId, contractId]);

    /** Summary signers are only trustworthy once prefill + this contract's owners are in. */
    const summarySignersReady =
        contractPrefillLoaded &&
        (effectiveContractId == null ||
            signerOwnersLoadedForContractId === Number(effectiveContractId));

    const linkedEnvelopeId = useMemo(() => {
        const session = String(sessionEnvelopeId || "").trim();
        if (session) return session;
        const fromContract = String(
            (resolvedContract as { application?: { document?: { envelopeId?: string } } } | null)
                ?.application?.document?.envelopeId ?? "",
        ).trim();
        return fromContract || null;
    }, [sessionEnvelopeId, resolvedContract]);

    const sentEnvelopeRows = useMemo(
        () => buildContractSendTableRows(resolvedContract),
        [resolvedContract],
    );

    const selectedSentRow = useMemo((): ContractSendTableRow | null => {
        if (!sentEnvelopeRows.length) return null;
        if (selectedSentEnvelopeKey) {
            const found = sentEnvelopeRows.find((row) => row.key === selectedSentEnvelopeKey);
            if (found) return found;
        }
        const sessionEnv = String(sessionEnvelopeId || "").trim();
        if (sessionEnv) {
            const bySession = sentEnvelopeRows.find((row) => row.envelopeId === sessionEnv);
            if (bySession) return bySession;
        }
        return sentEnvelopeRows.find((row) => row.isCurrent) ?? sentEnvelopeRows[0];
    }, [sentEnvelopeRows, selectedSentEnvelopeKey, sessionEnvelopeId]);

    const sentStepPreviewEnvelopeId = useMemo(() => {
        const fromRow = String(selectedSentRow?.envelopeId ?? "").trim();
        if (fromRow) return fromRow;
        return linkedEnvelopeId;
    }, [selectedSentRow, linkedEnvelopeId]);

    /** Same-contract resend: only a SignNow contract still out for signature. */
    const canResendUnsignedContract =
        activeStep === "sent" &&
        isSignNowContractUiEnabled() &&
        isContractOutForSignature &&
        Boolean(String(selectedSentRow?.envelopeId || linkedEnvelopeId || "").trim()) &&
        !(selectedSentRow && isContractSendTableRowFullySigned(selectedSentRow));

    const canCancelSentContract = useMemo(
        () =>
            canVoidContractSendTableRow(resolvedContract, selectedSentRow, sentAt) ||
            canVoidMainContract(resolvedContract, sentAt),
        [resolvedContract, selectedSentRow, sentAt],
    );

    const canReviewAndSendCurrentPackage = useMemo(() => {
        if (isSignNowContractUiEnabled() && (signNowEmbedUrl || signNowReviewComplete)) {
            return true;
        }
        if (!canSendWithoutContract || includeMainContractInSend) {
            return canReviewAndSendDocuSign;
        }
        return Boolean(onPrepareDocuSignDraft);
    }, [
        canSendWithoutContract,
        includeMainContractInSend,
        canReviewAndSendDocuSign,
        onPrepareDocuSignDraft,
        signNowEmbedUrl,
        signNowReviewComplete,
    ]);

    const docuSignPreviewEnvelopeId =
        activeStep === "sent" ? sentStepPreviewEnvelopeId : linkedEnvelopeId;

    const docuSignPdfCacheSuffix = useMemo(
        () => getDocuSignPdfCacheSuffix(resolvedContract, sentAt),
        [resolvedContract, sentAt],
    );

    const prefilledLoadGenRef = useRef(0);
    /** Owns spinner state; stale async work must not clear a newer load's loading flag. */
    const prefilledActiveLoadIdRef = useRef(0);
    const linkedEnvelopeIdRef = useRef<string | null>(null);
    const applicationIdForLookupRef = useRef<string | null>(null);
    const prefilledPdfCachedForEnvelopeRef = useRef<string | null>(null);
    const prefilledBoldSignPdfUrlRef = useRef<string | null>(null);
    /** After DocuSign 429 for an envelope, block auto PDF reloads for ~1 hour. */
    const rateLimitedEnvelopeUntilRef = useRef<Record<string, number>>({});
    const docuSignPdfCacheSuffixRef = useRef(docuSignPdfCacheSuffix);
    const draftPreparedAddendumIdRef = useRef<string | null | undefined>(undefined);
    const draftPreparedCcRef = useRef<string[] | null>(null);
    const draftPreparedPrefillFingerprintRef = useRef<string | null>(null);
    /** Avoid repeating the same draft-sync failure toast for one fingerprint. */
    const lastPrefillSyncFailureToastKeyRef = useRef<string | null>(null);
    const draftPreparedSignerRolesRef = useRef<string | null>(null);
    const draftPreparedOwnerCountRef = useRef<number | null>(null);
    const draftPreparedPackageFingerprintRef = useRef<string | null>(null);
    /**
     * The package THIS modal session built and prefilled through a Review.
     *
     * `sessionEnvelopeId` is also seeded from the contract's linked document,
     * and after the background pre-warm that is an empty copy nobody has
     * prefilled. Review's "same draft — just reopen it" shortcut used to accept
     * that id, minted a review link on the empty copy without any prefill, and
     * the Owner finished (and the merchant received) a blank contract on every
     * funder. The shortcut is now only taken for the package recorded here.
     */
    const draftPreparedEnvelopeRef = useRef<string | null>(null);
    const autoSeededSignersKeyRef = useRef<string>("");
    const includeMainContractInSendRef = useRef(includeMainContractInSend);
    includeMainContractInSendRef.current = includeMainContractInSend;
    const includeDisclosureInSendRef = useRef(includeDisclosureInSend);
    includeDisclosureInSendRef.current = includeDisclosureInSend;

    const resolveSignerOverrideRowsForSend = useCallback((): ContractSignerOverrideRow[] => {
        if (showRecipientEditor) {
            const fromEditor = recipientEditorRows
                .filter((r) => String(r.role || "").trim())
                .map((r) => ({
                    role: r.role.trim(),
                    name: r.name.trim(),
                    email: r.email.trim(),
                }));
            if (fromEditor.length) return fromEditor;
        }
        const fromSavedOrTemplate = contractSignerOverrides?.length
            ? contractSignerOverrides
            : buildBoldSignRolesFromTemplateRecipients(
                  templateRoleRowsForSigner,
                  String(docuSignSignerEmail.email || "").trim(),
                  getApplicationPrimaryRecipientName(applicationData),
                  { singleSignerOnly: false },
              ).map((r) => ({
                  role: r.signerRole,
                  name: r.signerName,
                  email: r.signerEmail,
              }));
        return ensureSignerRowsFromCrmOwners(
            fromSavedOrTemplate,
            crmOwnerPartiesForSigners,
        );
    }, [
        showRecipientEditor,
        recipientEditorRows,
        contractSignerOverrides,
        crmOwnerPartiesForSigners,
        templateRoleRowsForSigner,
        docuSignSignerEmail.email,
        applicationData,
    ]);

    const signerRolesDraftFingerprint = useMemo(
        () => contractSignerOverridesFingerprint(resolveSignerOverrideRowsForSend()),
        [resolveSignerOverrideRowsForSend],
    );

    const invalidateDocuSignDraftSession = useCallback(() => {
        setSessionEnvelopeId(null);
        draftPreparedAddendumIdRef.current = undefined;
        draftPreparedCcRef.current = null;
        draftPreparedPrefillFingerprintRef.current = null;
        lastPrefillSyncFailureToastKeyRef.current = null;
        draftPreparedSignerRolesRef.current = null;
        draftPreparedOwnerCountRef.current = null;
        draftPreparedPackageFingerprintRef.current = null;
        draftPreparedEnvelopeRef.current = null;
    }, []);

    /** Saved signer overrides changed after a draft was prepared — force a new envelope on next send. */
    useEffect(() => {
        const prepared = draftPreparedSignerRolesRef.current;
        if (prepared == null || prepared === signerRolesDraftFingerprint) return;
        invalidateDocuSignDraftSession();
    }, [signerRolesDraftFingerprint, invalidateDocuSignDraftSession]);

    const sessionEnvelopeIdRef = useRef<string | null>(null);
    const effectiveContractIdRef = useRef<number | null>(null);
    const resolvedContractRef = useRef<Record<string, unknown> | null>(null);
    const selectedSentRowRef = useRef<ContractSendTableRow | null>(null);
    const ccEmailsRef = useRef<string[]>([]);
    const selectedAddendumOptionsRef = useRef<string[]>([]);
    const linkedAddendumMappingRef = useRef<ContractDocumentTemplateMappingRow | null>(null);
    const linkedAddendumMappingsRef = useRef<ContractDocumentTemplateMappingRow[]>([]);
    const addendumTemplateMappingsRef = useRef<ContractDocumentTemplateMappingRow[]>([]);
    const linkedDisclosureMappingRef = useRef<ContractDocumentTemplateMappingRow | null>(null);
    const disclosureAutoLinkKeyRef = useRef("");
    const disclosureSyncGenRef = useRef(0);
    const disclosureMappingsWriteChainRef = useRef<Promise<void>>(Promise.resolve());
    const addendumMappingsWriteChainRef = useRef<Promise<void>>(Promise.resolve());
    /** In-flight addendum mapping writes — blocks sync effect from overwriting optimistic UI. */
    const addendumMappingsWriteInFlightRef = useRef(0);
    const addendumPersistTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
    const flushAddendumMappingsRef = useRef<() => Promise<void>>(async () => {});
    /** Latest build of the CRM → SignNow prefill payload, callable after an `await`. */
    const buildPrefillFieldsPayloadRef = useRef<() => ContractPrefillField[]>(() => []);
    /**
     * Live "$25 wire fee" checkbox for the send calls. It is not a document field,
     * so it cannot ride along in `prefillFields`; without it the backend bakes the
     * merchant copy from the contract row and re-adds an unchecked $25.
     */
    const includeWireFeeForSendRef = useRef<unknown>(undefined);

    /**
     * Everything the SignNow package is prefilled from: the contract row with its saved
     * prefill, the document-template mappings, the disclosure link, the offer, and the
     * bank analysis the disclosure calculator reads.
     *
     * Review used to build its payload from whatever had arrived by the time the button
     * was clicked, so a click during the initial load opened SignNow with the fields
     * those loads supply (phone, fees, cadence) still empty — and only a second Review,
     * by which time the loads had finished, showed them.
     */
    const contractDataReadyForReview =
        contractPrefillLoaded &&
        !loadingTemplateMappings &&
        !linkingDisclosureTemplate &&
        !loadingDisclosureCalcBankAnalysis &&
        !offerDecisionLoading;
    const contractDataReadyRef = useRef(false);
    const contractDataReadyWaitersRef = useRef<Array<() => void>>([]);
    const releaseContractDataWaiters = useCallback(() => {
        const waiters = contractDataReadyWaitersRef.current;
        contractDataReadyWaitersRef.current = [];
        for (const resolve of waiters) resolve();
    }, []);
    useEffect(() => {
        contractDataReadyRef.current = contractDataReadyForReview;
        if (contractDataReadyForReview) releaseContractDataWaiters();
    }, [contractDataReadyForReview, releaseContractDataWaiters]);
    useEffect(() => {
        // Nothing else will settle once the modal is closed.
        if (!isOpen) releaseContractDataWaiters();
    }, [isOpen, releaseContractDataWaiters]);

    /**
     * Resolves once every load above has settled — driven by those loads completing, not
     * by a timer. Queued mapping writes drain first, because they are what refresh the
     * template-mapping rows the addendum / disclosure prefill is built from.
     */
    const waitForContractDataReady = useCallback(async () => {
        await addendumMappingsWriteChainRef.current.catch(() => undefined);
        await disclosureMappingsWriteChainRef.current.catch(() => undefined);
        if (contractDataReadyRef.current) return;
        await new Promise<void>((resolve) => {
            contractDataReadyWaitersRef.current.push(resolve);
        });
    }, []);
    linkedEnvelopeIdRef.current = linkedEnvelopeId;
    applicationIdForLookupRef.current = applicationIdForLookup;
    effectiveContractIdRef.current = effectiveContractId;
    resolvedContractRef.current = resolvedContract;
    selectedSentRowRef.current = selectedSentRow;
    ccEmailsRef.current = ccEmails;
    selectedAddendumOptionsRef.current = selectedAddendumOptions;
    sessionEnvelopeIdRef.current = sessionEnvelopeId;
    linkedAddendumMappingRef.current = linkedAddendumMapping;
    linkedAddendumMappingsRef.current = linkedAddendumMappings;
    addendumTemplateMappingsRef.current = addendumTemplateMappings;
    linkedDisclosureMappingRef.current = linkedDisclosureMapping;
    docuSignPdfCacheSuffixRef.current = docuSignPdfCacheSuffix;

    const buildDocuSignPdfCacheKey = (envelopeId: string) =>
        `${envelopeId}:${docuSignPdfCacheSuffixRef.current}`;

    const loadPrefilledPdfFromDocuSign = useCallback(
        async (
            overrideEnvelopeId?: string,
            options?: {
                generation?: number;
                manageLoading?: boolean;
                loadId?: number;
                /** Draft preview may need retries while DocuSign renders prefilled tab values. */
                maxAttempts?: number;
            },
        ) => {
        const gen = options?.generation ?? ++prefilledLoadGenRef.current;
        const manageLoading = options?.manageLoading !== false;
        const loadId =
            options?.loadId ??
            (manageLoading ? ++prefilledActiveLoadIdRef.current : prefilledActiveLoadIdRef.current);
        const envelopeId =
            String(overrideEnvelopeId || linkedEnvelopeIdRef.current || "").trim() || null;
        const appId = applicationIdForLookupRef.current;

        if (!envelopeId && !appId) {
            if (manageLoading && prefilledActiveLoadIdRef.current === loadId) {
                setPrefilledBoldSignPdfLoading(false);
            }
            setPrefilledBoldSignPdfHint(
                "No contract envelope yet. Review in SignNow to send it first.",
            );
            return;
        }

        const signNowUi = isSignNowContractUiEnabled();
        if (signNowUi && (!envelopeId || !isSignNowEnvelopeId(envelopeId))) {
            if (manageLoading && prefilledActiveLoadIdRef.current === loadId) {
                setPrefilledBoldSignPdfLoading(false);
            }
            setPrefilledBoldSignPdfHint(
                envelopeId
                    ? "This envelope is not a SignNow contract. Send via SignNow to preview the PDF."
                    : "Send the contract via SignNow to preview the filled envelope.",
            );
            return;
        }

        if (manageLoading) {
            prefilledActiveLoadIdRef.current = loadId;
            setPrefilledBoldSignPdfLoading(true);
            setPrefilledBoldSignPdfHint(null);
        }

        const sleep = (ms: number) =>
            new Promise<void>((resolve) => {
                window.setTimeout(resolve, ms);
            });

        const isRateLimitError = (message: string) =>
            /hourly_envelope_polling_limit|burst_envelope_polling|hourly_apiinvocation|apiinvocation.?limit|api.?invocation.?limit|polling.?limit|rate.?limit|cooldown is active|too many requests|status code 429|\b429\b/i.test(
                message,
            );

        let lastError = "";

        const pdfCacheKey = envelopeId ? buildDocuSignPdfCacheKey(envelopeId) : null;

        if (
            pdfCacheKey &&
            prefilledPdfCachedForEnvelopeRef.current === pdfCacheKey &&
            prefilledBoldSignPdfUrlRef.current
        ) {
            if (manageLoading && prefilledActiveLoadIdRef.current === loadId) {
                setPrefilledBoldSignPdfLoading(false);
            }
            return;
        }

        if (
            envelopeId &&
            rateLimitedEnvelopeUntilRef.current[envelopeId] &&
            rateLimitedEnvelopeUntilRef.current[envelopeId]! > Date.now()
        ) {
            if (manageLoading && prefilledActiveLoadIdRef.current === loadId) {
                setPrefilledBoldSignPdfLoading(false);
            }
            setPrefilledBoldSignPdfHint(
                "DocuSign envelope polling limit exceeded (250 GET/hour). Wait before reloading this PDF — status still updates via webhook.",
            );
            return;
        }

        // Auto-loads must not multiply DocuSign GETs (per-envelope 250/hour poll budget).
        const maxAttempts = Math.min(options?.maxAttempts ?? 1, 2);

        try {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (prefilledLoadGenRef.current !== gen) return;
                if (attempt > 0) await sleep(4000);
                if (prefilledLoadGenRef.current !== gen) return;

                try {
                    const urlPath = envelopeId
                        ? `/docusign/download/${encodeURIComponent(envelopeId)}`
                        : `/docusign/prefilled-pdf/application/${encodeURIComponent(appId!)}`;
                    const contractIdHint = effectiveContractIdRef.current;
                    const contractRecord = resolvedContractRef.current;
                    const sentRows = contractRecord
                        ? buildContractSendTableRows(contractRecord)
                        : [];
                    const matchingRow =
                        (envelopeId
                            ? sentRows.find(
                                  (row) =>
                                      String(row.envelopeId ?? "").trim() === envelopeId,
                              )
                            : null) ??
                        selectedSentRowRef.current;
                    const funderAuth =
                        envelopeId && contractRecord && matchingRow
                            ? resolveContractSendRowFunderAuth(contractRecord, matchingRow)
                            : {};
                    const res = await axiosGet(urlPath, {
                        responseType: "blob",
                        timeout: 120000,
                        ...(envelopeId
                            ? {
                                  params: {
                                      ...(appId ? { applicationId: String(appId) } : {}),
                                      ...(contractIdHint != null &&
                                      Number.isFinite(contractIdHint) &&
                                      contractIdHint > 0
                                          ? { contractId: contractIdHint }
                                          : {}),
                                      ...(funderAuth.funderName
                                          ? { funderName: funderAuth.funderName }
                                          : {}),
                                      ...(funderAuth.funderProfileId
                                          ? { funderProfileId: funderAuth.funderProfileId }
                                          : {}),
                                      ...(funderAuth.contractState
                                          ? { contractState: funderAuth.contractState }
                                          : {}),
                                  },
                              }
                            : {}),
                    });
                    if (prefilledLoadGenRef.current !== gen) return;

                    const blob = res.data as Blob;
                    if (!blob?.size) {
                        lastError = "DocuSign returned an empty PDF.";
                        continue;
                    }

                    const url = URL.createObjectURL(blob);
                    prefilledBoldSignPdfUrlRef.current = url;
                    setPrefilledBoldSignPdfUrl((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return url;
                    });
                    setPrefilledBoldSignPdfHint(null);
                    if (pdfCacheKey) {
                        prefilledPdfCachedForEnvelopeRef.current = pdfCacheKey;
                    }
                    return;
                } catch (err: unknown) {
                    lastError = await parseApiErrorMessageFromAxios(err);
                    if (isRateLimitError(lastError)) {
                        if (envelopeId) {
                            rateLimitedEnvelopeUntilRef.current[envelopeId] =
                                Date.now() + 60 * 60_000;
                        }
                        break;
                    }
                }
            }

            if (prefilledLoadGenRef.current !== gen) return;
            prefilledBoldSignPdfUrlRef.current = null;
            setPrefilledBoldSignPdfUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return null;
            });
            setPrefilledBoldSignPdfHint(
                lastError ||
                    (isSignNowEnvelopeId(envelopeId)
                        ? "Could not load the SignNow contract PDF. Try again in a few seconds."
                        : "Could not load prefilled PDF from DocuSign. Try again in a few seconds."),
            );
        } finally {
            if (manageLoading && prefilledActiveLoadIdRef.current === loadId) {
                setPrefilledBoldSignPdfLoading(false);
            }
        }
    },
    [],
    );

    const resolveAddendumTemplateIdsForDocuSignMerge = useCallback((): string[] => {
        const toSendRef = (ref: string, label?: string | null) => {
            const trimmed = String(ref || "").trim();
            if (!trimmed) return "";
            // Funder Exhibit C often uses a SignNow hex id that expand() would treat as
            // a normal addendum and collapse. Normalize unrecognized multi instances to
            // exhibit_c so N copies survive into SignNow.
            if (isMultiInstanceAddendumRef(trimmed, label)) {
                return isMultiInstanceAddendumRef(trimmed) ? trimmed : "exhibit_c";
            }
            return trimmed;
        };

        const fromSelected = selectedAddendumOptionsRef.current
            .map((opt) => {
                const trimmed = String(opt || "").trim();
                if (trimmed.startsWith("up:")) return "";
                if (!trimmed.startsWith("bs:")) return "";
                const ref = trimmed.slice(3).trim();
                const label =
                    addendumPickerOptions.find((o) => o.ref === ref)?.label ||
                    selectedFunderAddendumOptions.find(
                        (o) => o.layoutKey === ref || o.templateId === ref,
                    )?.name ||
                    null;
                return toSendRef(ref, label);
            })
            .filter(Boolean);
        if (fromSelected.length) return expandAddendumRefsAllowingDuplicates(fromSelected);

        const fromMappings = linkedAddendumMappingsRef.current
            .map((row) =>
                toSendRef(
                    getAddendumDropdownRef(row?.template) ||
                        getBoldSignTemplateMappingRef(row?.template) ||
                        "",
                    row?.template?.name || null,
                ),
            )
            .filter(Boolean);
        return expandAddendumRefsAllowingDuplicates(fromMappings);
    }, [addendumPickerOptions, selectedFunderAddendumOptions]);

    const resolveAddendumTemplateIdForDocuSignMerge = useCallback((): string | null => {
        return resolveAddendumTemplateIdsForDocuSignMerge()[0] ?? null;
    }, [resolveAddendumTemplateIdsForDocuSignMerge]);

    const resolveDisclosureTemplateRefForDocuSignMerge = useCallback((): string | null => {
        if (isSignNowContractUiEnabled()) {
            return (
                effectiveSignNowDisclosure.templateId ||
                effectiveSignNowDisclosure.layoutKey ||
                SIGNNOW_DISCLOSURE_LAYOUT_KEY
            );
        }
        const row = linkedDisclosureMappingRef.current;
        const layoutKey = String(row?.template?.layoutKey ?? "").trim();
        if (layoutKey) return layoutKey;
        const rowId = String(row?.template?.id ?? "").trim();
        return rowId || null;
    }, [effectiveSignNowDisclosure]);

    const resolveAddendumLayoutKeysForDocuSignMerge = useCallback((): string[] => {
        return resolveAddendumTemplateIdsForDocuSignMerge().filter((ref) => {
            if (isPlatformLayoutKey(ref)) return true;
            if (ref.startsWith("funder_")) return true;
            return Boolean(ref);
        });
    }, [resolveAddendumTemplateIdsForDocuSignMerge]);

    const resolveAddendumLayoutKeyForDocuSignMerge = useCallback((): string | null => {
        return resolveAddendumLayoutKeysForDocuSignMerge()[0] ?? null;
    }, [resolveAddendumLayoutKeysForDocuSignMerge]);

    const getEffectiveSendPackage = useCallback((): ContractSendPackageSelection => {
        const disclosureRef = includeDisclosureInSendRef.current
            ? resolveDisclosureTemplateRefForDocuSignMerge()
            : null;
        return resolveEffectiveSendPackage({
            includeMainContractInSend: includeMainContractInSendRef.current,
            addendumLayoutKey: resolveAddendumLayoutKeyForDocuSignMerge(),
            disclosureRef,
        });
    }, [resolveAddendumLayoutKeyForDocuSignMerge, resolveDisclosureTemplateRefForDocuSignMerge]);

    const sendPackageFingerprint = useMemo(
        () =>
            [
                contractSendPackageFingerprint(getEffectiveSendPackage()),
                resolveAddendumTemplateIdsForDocuSignMerge().join(","),
            ].join("|"),
        [
            getEffectiveSendPackage,
            includeMainContractInSend,
            includeDisclosureInSend,
            selectedAddendumOptions,
            linkedAddendumMappings,
            linkedDisclosureMapping,
            linkedDisclosureMatchesSelectedState,
            canSendWithoutContract,
            resolveAddendumTemplateIdsForDocuSignMerge,
        ],
    );

    useEffect(() => {
        const prepared = draftPreparedPackageFingerprintRef.current;
        if (prepared == null || prepared === sendPackageFingerprint) return;
        invalidateDocuSignDraftSession();
    }, [sendPackageFingerprint, invalidateDocuSignDraftSession]);

    const primarySignerEmailRef = useRef("");
    primarySignerEmailRef.current = docuSignSignerEmail.email;

    const buildDocuSignRolesForSync = useCallback((): DocuSignTemplateRolePayload[] => {
        let roles: DocuSignTemplateRolePayload[];
        const rows = resolveSignerOverrideRowsForSend();
        if (rows.length) {
            roles = buildDocuSignRolesFromEditorRows(rows);
        } else {
            const signerEmail = String(primarySignerEmailRef.current || "").trim();
            const signerName = getApplicationPrimaryRecipientName(applicationData);
            roles = mergeApplicationDataIntoSignerRoles(
                buildBoldSignRolesFromTemplateRecipients(
                    templateRoleRowsForSigner,
                    signerEmail,
                    signerName,
                    { singleSignerOnly: false },
                ),
                applicationSignerRowsForMerge.map((r) => ({
                    role: r.role,
                    name: r.name,
                    email: r.email,
                })),
            );
        }
        const ownerCount = resolveActiveOwnerCount({
            owners: contractPrefillRecords.owners ?? null,
            signerRoles: roles.map((r) => ({
                signerRole: r.signerRole,
                signerEmail: r.signerEmail,
            })),
        });
        return collapseDocuSignRolesToSignerSlots(
            roles,
            ownerCount,
            contractPrefillRecords.owners ?? null,
        );
    }, [
        resolveSignerOverrideRowsForSend,
        applicationData,
        templateRoleRowsForSigner,
        applicationSignerRowsForMerge,
        contractPrefillRecords.owners,
    ]);

    const docuSignSignerRolesForSend = useMemo(
        () => buildDocuSignRolesForSync(),
        [buildDocuSignRolesForSync],
    );

    /**
     * Copy the SignNow package in the background while the user is still on the
     * Summary step, so clicking "Review in SignNow" does not have to wait for it.
     *
     * Almost all of the Review wait is SignNow's own document-group copy, which
     * takes 25-40s and which no amount of backend tuning can shorten. `structureOnly`
     * performs exactly that copy and nothing else — no prefill, no invite, no
     * review link — and parks the result against this application. The Review
     * click then finds the warmed group and only has to prefill it and mint the
     * embed URL.
     *
     * Cost control, because every copy counts against SignNow's daily document
     * limit:
     *  - Only fires on the Summary step, after the user has settled for a moment.
     *  - At most once per package shape, and capped per modal session.
     *  - Never once a draft is already open, under review, or sent.
     * The warmed group is recorded as pristine (nothing was ever written into it),
     * so later edits to the contract do not invalidate it and it is still adopted
     * rather than replaced by a second copy.
     */
    const signNowPrewarmedFingerprintsRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        if (!isSignNowContractUiEnabled()) return;
        if (activeStep !== "summary") return;
        // ContractTab omits this prop when the contract tab is read-only, and the
        // real Review click is gated on it too.
        if (!onPrepareDocuSignDraft) return;
        if (signNowEmbedUrl || signNowReviewComplete || isSending) return;
        if (sessionEnvelopeId || linkedEnvelopeIdRef.current) return;
        if (!canReviewAndSendCurrentPackage) return;
        // A resend deliberately builds a brand new package; warming one here
        // would copy it twice against SignNow's daily document limit.
        if (isContractOutForSignature || sentAt) return;
        const applicationId = String(applicationIdForLookupRef.current || "").trim();
        if (!applicationId) return;
        const roles = buildDocuSignRolesForSync();
        if (!roles.length) return;
        const addendumTemplateIds = resolveAddendumTemplateIdsForDocuSignMerge();
        const disclosureDocumentRef = includeDisclosureInSendRef.current
            ? resolveDisclosureTemplateRefForDocuSignMerge()
            : null;
        const packageSelection = getEffectiveSendPackage();
        /**
         * Must reproduce byte for byte what ContractTab posts on the real Review,
         * because the backend keys draft reuse on the resulting package shape.
         * A payload that differs by even one supplemental ref warms a package
         * Review cannot adopt, and then Review copies a second one.
         */
        const extraFunderDisclosureRefs = disclosureDocumentRef
            ? funderDisclosureOptions
                  .slice(1)
                  .map((d) => d.templateId || d.layoutKey)
                  .filter(Boolean)
            : [];
        const supplementalDocumentRefs = expandAddendumRefsAllowingDuplicates(
            [
                ...addendumTemplateIds,
                ...extraFunderDisclosureRefs,
                disclosureDocumentRef,
            ].filter(Boolean) as string[],
        );
        const key = [
            applicationId,
            sendPackageFingerprint,
            supplementalDocumentRefs.join(","),
            packageSelection.includeMainContract ? "main" : "nomain",
        ].join("|");
        const warmed = signNowPrewarmedFingerprintsRef.current;
        if (warmed.has(key) || warmed.size >= SIGNNOW_PREWARM_MAX_PER_SESSION) return;

        let cancelled = false;
        const timer = window.setTimeout(() => {
            if (cancelled) return;
            warmed.add(key);
            void axiosPost(
                "/docusign/merge-and-send",
                {
                    applicationId,
                    roles,
                    supplementalDocumentRefs,
                    includeMainContract: packageSelection.includeMainContract,
                    mainContractLayoutKey: resolveLayoutKey(
                        selectedFunder,
                        selectedFunderProfile?.id,
                    ),
                    sendPackage: {
                        ...packageSelection,
                        includeAddendum: addendumTemplateIds.length > 0,
                        includeDisclosure: Boolean(disclosureDocumentRef),
                    },
                    funderName:
                        String(selectedFunderRef.current || selectedFunder || "").trim() ||
                        undefined,
                    funderProfileId:
                        persistedFunderProfileIdForApi(selectedFunderProfile) || undefined,
                    ...(packageSelection.includeMainContract
                        ? {}
                        : { skipApplicationEnvelopeLink: true }),
                    autoSend: false,
                    structureOnly: true,
                },
                { timeout: 300_000 },
            ).catch(() => {
                // Best effort only. A failed warm just means Review copies the
                // package itself, exactly as it did before — never surface it.
                warmed.delete(key);
            });
        }, SIGNNOW_PREWARM_IDLE_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [
        activeStep,
        onPrepareDocuSignDraft,
        isContractOutForSignature,
        sentAt,
        signNowEmbedUrl,
        signNowReviewComplete,
        isSending,
        sessionEnvelopeId,
        canReviewAndSendCurrentPackage,
        sendPackageFingerprint,
        buildDocuSignRolesForSync,
        resolveAddendumTemplateIdsForDocuSignMerge,
        resolveDisclosureTemplateRefForDocuSignMerge,
        getEffectiveSendPackage,
        funderDisclosureOptions,
        selectedFunder,
        selectedFunderProfile,
    ]);

    const openSignerEditor = useCallback(() => {
        const baseRows = buildSignerEditorRows({
            savedOverrides: contractSignerOverrides,
            templateRoles: templateRoleRowsForSigner,
            applicationSignerEmail: String(docuSignSignerEmail.email || "").trim(),
            applicationSignerName: getApplicationPrimaryRecipientName(applicationData),
            partyRows: applicationSignerRowsForMerge,
        });
        const ensured = ensureSignerRowsFromCrmOwners(
            baseRows.map((row) => ({
                role: row.role,
                name: row.name,
                email: row.email,
            })),
            crmOwnerPartiesForSigners,
        );
        setRecipientEditorRows(
            (ensured.length ? ensured : baseRows).map((row, idx) => ({
                id: String(idx + 1),
                role: row.role,
                name: row.name,
                email: row.email,
            })),
        );
        setShowRecipientEditor(true);
    }, [
        applicationData,
        applicationSignerRowsForMerge,
        contractSignerOverrides,
        crmOwnerPartiesForSigners,
        docuSignSignerEmail.email,
        templateRoleRowsForSigner,
    ]);

    useEffect(() => {
        if (!isOpen || !contractPrefillLoaded || showRecipientEditor) return;
        const cid = effectiveContractId;
        if (cid == null || !Number.isFinite(Number(cid))) return;
        if (crmOwnerPartiesForSigners.length < 2) return;
        const secondEmail = String(crmOwnerPartiesForSigners[1]?.ownerEmail || "").trim();
        if (!secondEmail) return;

        const ensured = ensureSignerRowsFromCrmOwners(
            contractSignerOverrides,
            crmOwnerPartiesForSigners,
        );
        if (ensured.length < 2 || !String(ensured[1]?.email || "").trim()) return;

        const nextFp = contractSignerOverridesFingerprint(ensured);
        const currentFp = contractSignerOverridesFingerprint(contractSignerOverrides ?? []);
        if (nextFp === currentFp) return;

        const seedKey = `${cid}:${nextFp}`;
        if (autoSeededSignersKeyRef.current === seedKey) return;
        autoSeededSignersKeyRef.current = seedKey;

        void (async () => {
            try {
                setContractSignerOverrides(ensured);
                const prefillBase =
                    stripDocumentTemplateBlobFromPrefillOverrides(
                        normalizeContractPrefillOverrides(
                            contractPrefillFromDb ??
                                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                                    ?.contractPrefillOverrides,
                        ) ?? null,
                    ) ??
                    contractPrefillFromDb ??
                    (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides;
                const nextPrefill = mergeContractPrefillWithSignerOverrides(
                    prefillBase,
                    ensured,
                );
                const updated = await dispatch(
                    updateContract({
                        id: Number(cid),
                        data: { contractPrefillOverrides: nextPrefill },
                    }),
                ).unwrap();
                const payload = (updated as { data?: unknown })?.data ?? updated;
                setResolvedContract((prev) =>
                    prev && typeof prev === "object"
                        ? {
                              ...prev,
                              ...(payload as Record<string, unknown>),
                              contractPrefillOverrides: nextPrefill,
                          }
                        : (payload as Record<string, unknown>),
                );
                setContractPrefillFromDb(
                    stripDocumentTemplateBlobFromPrefillOverrides(
                        normalizeContractPrefillOverrides(nextPrefill) ?? null,
                    ),
                );
                const ownersRes = await dispatch(
                    getAllContractOwners({ contractId: Number(cid) }),
                ).unwrap();
                const dbOwners = Array.isArray((ownersRes as { data?: unknown })?.data)
                    ? ((ownersRes as { data: unknown[] }).data as Record<string, unknown>[])
                    : [];
                await syncContractSignerRowsToCrm({
                    dispatch,
                    contractId: Number(cid),
                    applicationData: applicationDataRef.current,
                    signerRows: ensured.slice(0, 2),
                    existingContractOwners: dbOwners,
                });
            } catch {
                autoSeededSignersKeyRef.current = "";
            }
        })();
    }, [
        isOpen,
        contractPrefillLoaded,
        showRecipientEditor,
        effectiveContractId,
        crmOwnerPartiesForSigners,
        contractSignerOverrides,
        contractPrefillFromDb,
        resolvedContract,
        dispatch,
    ]);

    const fetchDocuSignSenderViewUrl = useCallback(
        async (
            envelopeId: string,
            ccForSync: string[],
            rolesOverride?: DocuSignTemplateRolePayload[],
        ): Promise<{ url: string | null; error: string | null }> => {
            const returnUrl = isSignNowContractUiEnabled()
                ? signNowEmbeddedReturnUrl()
                : typeof window !== "undefined"
                  ? window.location.href
                  : "https://www.docusign.com";
            const signerEmail = String(primarySignerEmailRef.current || "").trim();
            const appId = applicationIdForLookupRef.current;
            const roles = rolesOverride ?? buildDocuSignRolesForSync();
            const funderName = String(selectedFunderRef.current || "").trim();
            const contractState = String(
                (resolvedContract as { state?: unknown } | null)?.state ?? "",
            ).trim();
            const contractIdNum = Number(resolvedContractId ?? contractId);
            try {
                const res = await axiosPost("/docusign/sender-view", {
                    envelopeId,
                    returnUrl,
                    ccEmails: mergeWithDefaultCcEmails(ccForSync, contractCcMergeOptions),
                    roles,
                    ...(appId ? { applicationId: appId } : {}),
                    ...(Number.isFinite(contractIdNum) && contractIdNum > 0
                        ? { contractId: contractIdNum }
                        : {}),
                    ...(funderName ? { funderName } : {}),
                    ...(contractState ? { contractState } : {}),
                    ...(signerEmail
                        ? {
                              signerEmail,
                              signerName: getApplicationPrimaryRecipientName(applicationData),
                          }
                        : {}),
                });
                const url = String(
                    (res as { data?: { url?: string; embeddedEditorUrl?: string; embeddedInviteUrl?: string } })?.data
                        ?.embeddedEditorUrl ||
                    (res as { data?: { url?: string; embeddedInviteUrl?: string } })?.data
                        ?.embeddedInviteUrl ||
                        (res as { data?: { url?: string } })?.data?.url ||
                        "",
                ).trim();
                if (isSignNowLoginWebappUrl(url)) {
                    return {
                        url: null,
                        error: "SignNow returned a login page instead of an embedded review link.",
                    };
                }
                return { url: url || null, error: null };
            } catch (err: unknown) {
                const ax = err as {
                    response?: { data?: { message?: string } };
                    message?: string;
                };
                const apiMessage = String(
                    ax?.response?.data?.message || ax?.message || "",
                ).trim();
                return { url: null, error: apiMessage || null };
            }
        },
        [
            applicationData,
            buildDocuSignRolesForSync,
            contractCcMergeOptions,
            contractId,
            resolvedContract,
            resolvedContractId,
        ],
    );

    const fetchDocuSignSenderViewUrlWithRetry = useCallback(
        async (
            envelopeId: string,
            ccForSync: string[],
            justCreated: boolean,
            rolesOverride?: DocuSignTemplateRolePayload[],
        ): Promise<{ url: string | null; error: string | null }> => {
            const delays = justCreated
                ? DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS.justCreated
                : DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS.existing;
            let lastError: string | null = null;
            for (const delay of delays) {
                if (delay > 0) {
                    await new Promise((r) => setTimeout(r, delay));
                }
                const result = await fetchDocuSignSenderViewUrl(
                    envelopeId,
                    ccForSync,
                    rolesOverride,
                );
                if (result.url) return result;
                if (result.error) {
                    lastError = result.error;
                    if (isDocuSignPollingLimitError(result.error)) break;
                }
            }
            return { url: null, error: lastError };
        },
        [fetchDocuSignSenderViewUrl],
    );

    /** Step 4: load SignNow/DocuSign envelope PDF after send. */
    useEffect(() => {
        const isSignNowPreview =
            isSignNowContractUiEnabled() || isSignNowEnvelopeId(docuSignPreviewEnvelopeId);
        if (
            !isOpen ||
            pdfRightPaneTab !== "docusign" ||
            !showDocuSignContractTab ||
            (isSignNowPreview && activeStep !== "sent")
        ) {
            prefilledLoadGenRef.current += 1;
            if (!isOpen) {
                prefilledBoldSignPdfUrlRef.current = null;
                setPrefilledBoldSignPdfUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                });
                setPrefilledBoldSignPdfHint(null);
                setPrefilledBoldSignPdfLoading(false);
                prefilledPdfCachedForEnvelopeRef.current = null;
            }
            return;
        }

        void loadPrefilledPdfFromDocuSign(docuSignPreviewEnvelopeId ?? undefined);
        return () => {
            prefilledLoadGenRef.current += 1;
        };
    }, [
        isOpen,
        pdfRightPaneTab,
        showDocuSignContractTab,
        activeStep,
        docuSignPreviewEnvelopeId,
        docuSignPdfCacheSuffix,
        loadPrefilledPdfFromDocuSign,
    ]);

    useEffect(() => {
        if (!showDocuSignContractTab && pdfRightPaneTab === "docusign") {
            setPdfRightPaneTab("template");
        }
    }, [showDocuSignContractTab, pdfRightPaneTab]);

    useEffect(() => {
        if (activeStep === "sent" && showDocuSignContractTab && pdfRightPaneTab === "template") {
            setPdfRightPaneTab("docusign");
        }
    }, [activeStep, showDocuSignContractTab, pdfRightPaneTab]);

    const canDownloadFilledContract = showDocuSignContractTab;

    const downloadFilledContractPdf = useCallback(async () => {
        const envelopeId =
            String(docuSignPreviewEnvelopeId || linkedEnvelopeIdRef.current || linkedEnvelopeId || "")
                .trim() || null;
        const appId = applicationIdForLookupRef.current;

        if (!envelopeId && !appId) {
            toast.error(
                isSignNowContractUiEnabled()
                    ? "Send the contract via SignNow first to download the filled PDF."
                    : "Send the contract to DocuSign first to download the filled PDF.",
            );
            return;
        }

        if (
            isSignNowContractUiEnabled() &&
            (!envelopeId || !isSignNowEnvelopeId(envelopeId))
        ) {
            toast.error("Send the contract via SignNow first to download the filled PDF.");
            return;
        }

        setDownloadingFilledContract(true);
        try {
            const urlPath = envelopeId
                ? `/docusign/download/${encodeURIComponent(envelopeId)}`
                : `/docusign/prefilled-pdf/application/${encodeURIComponent(appId!)}`;
            const contractIdHint = effectiveContractIdRef.current;
            const contractRecord = resolvedContractRef.current;
            const sentRows = contractRecord
                ? buildContractSendTableRows(contractRecord)
                : [];
            const matchingRow =
                (envelopeId
                    ? sentRows.find(
                          (row) => String(row.envelopeId ?? "").trim() === envelopeId,
                      )
                    : null) ?? selectedSentRowRef.current;
            const funderAuth =
                envelopeId && contractRecord && matchingRow
                    ? resolveContractSendRowFunderAuth(contractRecord, matchingRow)
                    : {};
            const res = await axiosGet(urlPath, {
                responseType: "blob",
                timeout: 120000,
                ...(envelopeId
                    ? {
                          params: {
                              ...(appId ? { applicationId: String(appId) } : {}),
                              ...(contractIdHint != null &&
                              Number.isFinite(contractIdHint) &&
                              contractIdHint > 0
                                  ? { contractId: contractIdHint }
                                  : {}),
                              ...(funderAuth.funderName
                                  ? { funderName: funderAuth.funderName }
                                  : {}),
                              ...(funderAuth.funderProfileId
                                  ? { funderProfileId: funderAuth.funderProfileId }
                                  : {}),
                              ...(funderAuth.contractState
                                  ? { contractState: funderAuth.contractState }
                                  : {}),
                          },
                      }
                    : {}),
            });
            const blob =
                res.data instanceof Blob
                    ? res.data
                    : new Blob([res.data], { type: "application/pdf" });
            if (!blob.size) {
                toast.error("DocuSign returned an empty PDF.");
                return;
            }
            const fileLabel = String(
                applicationIdForLookup || envelopeId || "contract",
            ).replace(/[^\w.-]+/g, "_");
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = `filled-contract-${fileLabel}.pdf`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);
            toast.success("Filled contract download started.");
        } catch (err: unknown) {
            const msg = await parseApiErrorMessageFromAxios(err);
            toast.error(msg || "Could not download filled contract.");
        } finally {
            setDownloadingFilledContract(false);
        }
    }, [docuSignPreviewEnvelopeId, linkedEnvelopeId, applicationIdForLookup]);

    const persistContractStateAndFunder = useCallback(
        async (
            patch: { state?: string | null; funderName?: string | null },
            options?: { silent?: boolean },
        ) => {
            const cid = effectiveContractId;
            if (cid == null || !Number.isFinite(cid)) {
                if (!options?.silent) {
                    toast.error("Generate or open a contract before updating state and funder.");
                }
                return;
            }
            const data: UpdateContractData = {};
            const canonicalState =
                patch.state !== undefined
                    ? patch.state === "" || patch.state == null
                        ? null
                        : pickUsStateForSelect(String(patch.state).trim()) ||
                          String(patch.state).trim() ||
                          null
                    : undefined;
            if (canonicalState !== undefined) {
                data.state = canonicalState;
                if (canonicalState) {
                    Object.assign(
                        data,
                        contractPrefillToContractColumnUpdate({
                            /** Deal / business location state only — do not overwrite Owner 1 contact state. */
                            businessAddressState: canonicalState,
                            securityBusinessAddressState: canonicalState,
                        }),
                    );
                }
            }
            if (patch.funderName !== undefined) {
                data.funderName =
                    patch.funderName === "" || patch.funderName == null
                        ? null
                        : String(patch.funderName).trim();
            }
            if (Object.keys(data).length === 0) {
                if (!options?.silent) {
                    toast.info("Select a state or funder to save.");
                }
                return;
            }
            try {
                setSavingContractMeta(true);
                const res = await dispatch(
                    updateContract({
                        id: cid,
                        data,
                    }),
                ).unwrap();
                const updated =
                    (res as { data?: Record<string, unknown> } | null)?.data ??
                    (res as Record<string, unknown> | null);
                setResolvedContract((prev) => {
                    const base =
                        prev && typeof prev === "object"
                            ? prev
                            : updated && typeof updated === "object"
                              ? updated
                              : {};
                    return { ...base, ...data };
                });
                if (canonicalState) {
                    setContractPrefillFromDb((prev) => ({
                        ...(prev ?? {}),
                        businessAddressState: canonicalState,
                        securityBusinessAddressState: canonicalState,
                    }));
                    // Force a new DocuSign draft so envelope tabs pick up the state.
                    prefilledPdfCachedForEnvelopeRef.current = null;
                    prefilledBoldSignPdfUrlRef.current = null;
                    invalidateDocuSignDraftSession();
                    try {
                        await syncContractPrefillToSourceRecords({
                            dispatch,
                            applicationData: applicationDataRef.current,
                            applicationUuid:
                                resolveApplicationUuidForUpdate(applicationDataRef.current) ||
                                applicationIdForLookupRef.current ||
                                null,
                            prefill: { businessAddressState: canonicalState },
                        });
                    } catch (syncErr: unknown) {
                        const syncMsg =
                            typeof syncErr === "string"
                                ? syncErr
                                : String(
                                      (syncErr as { message?: string })?.message ||
                                          "Failed to sync application business state.",
                                  );
                        if (!options?.silent) {
                            toast.warning(syncMsg);
                        }
                    }
                }
                if (!options?.silent) {
                    toast.success(
                        canonicalState
                            ? "Contract and application state updated."
                            : "Contract updated.",
                    );
                }
                // Refresh application so Deal ID (with funder prefix) updates in the UI.
                const appUuid =
                    resolveApplicationUuidForUpdate(applicationDataRef.current) ||
                    applicationIdForLookupRef.current ||
                    null;
                if (appUuid && patch.funderName !== undefined) {
                    refreshApplicationDetailFromServer(dispatch, String(appUuid));
                }
            } catch (err: unknown) {
                const msg =
                    typeof err === "string"
                        ? err
                        : String(
                            (err as { message?: string })?.message ||
                            "Failed to update contract.",
                        );
                if (!options?.silent) {
                    toast.error(msg);
                }
            } finally {
                setSavingContractMeta(false);
            }
        },
        [
            effectiveContractId,
            dispatch,
            invalidateDocuSignDraftSession,
        ],
    );

    /** Flush user-selected funder to DB once a contract row exists. */
    useEffect(() => {
        if (!isOpen || effectiveContractId == null || !userSelectedFunderRef.current) return;
        const funder = String(selectedFunder || "").trim();
        if (!funder) return;
        const dbFunder = String(resolvedContract?.funderName ?? "").trim();
        if (funderNamesEquivalent(funder, dbFunder)) return;
        void persistContractStateAndFunder({ funderName: funder }, { silent: true });
    }, [
        isOpen,
        effectiveContractId,
        selectedFunder,
        resolvedContract?.funderName,
        persistContractStateAndFunder,
    ]);

    useEffect(() => {
        if (!isOpen || !contractPrefillLoaded || !selectedState.trim()) return;

        const prevState = contractStateForFunderSyncRef.current;
        contractStateForFunderSyncRef.current = selectedState;
        // Skip on initial hydration (empty → loaded state from contract).
        if (!prevState.trim()) return;
        if (prevState === selectedState) return;
        // State dropdown already applied funder switch when needed.
        if (userSelectedStateRef.current) return;
        if (userSelectedFunderRef.current) return;

        const switchedFunder = resolveFunderOnStateChange(
            selectedFunder,
            selectedState,
            prevState,
        );
        if (switchedFunder == null || switchedFunder === selectedFunder) return;

        const expectedProfile =
            funders.find(
                (f) =>
                    f.isActive !== false &&
                    (f.name === switchedFunder ||
                        funderNamesEquivalent(f.name, switchedFunder) ||
                        funderNamesEquivalent(f.displayName, switchedFunder)),
            ) ?? findFunderProfile(funders, switchedFunder, selectedState);
        setSelectedFunderProfileId(expectedProfile?.id ?? "");
        setSelectedFunder(expectedProfile?.name ?? switchedFunder);
        if (effectiveContractId != null) {
            void persistContractStateAndFunder(
                { funderName: switchedFunder },
                { silent: true },
            );
        }
    }, [
        isOpen,
        contractPrefillLoaded,
        selectedState,
        selectedFunder,
        resolveFunderOnStateChange,
        funders,
        effectiveContractId,
        persistContractStateAndFunder,
    ]);

    useEffect(() => {
        if (!isOpen || !applicationIdForLookup) return;
        let cancelled = false;
        const loadBankAnalysis = async () => {
            setLoadingDisclosureCalcBankAnalysis(true);
            try {
                const res = await axiosGet(
                    `/bank-analysis?${new URLSearchParams({
                        application: String(applicationIdForLookup),
                    }).toString()}`,
                );
                if (cancelled) return;
                const data = (res as { data?: { data?: unknown } })?.data?.data ?? res?.data;
                setDisclosureCalcBankAnalyses(data);
            } catch {
                if (!cancelled) setDisclosureCalcBankAnalyses(null);
            } finally {
                if (!cancelled) setLoadingDisclosureCalcBankAnalysis(false);
            }
        };
        void loadBankAnalysis();
        return () => {
            cancelled = true;
        };
    }, [isOpen, applicationIdForLookup]);

    useEffect(() => {
        if (!isOpen || !applicationData) return;
        const st = resolveDealStateFromApplication(applicationData);
        if (st) {
            setSelectedState((prev) => (prev.trim() ? prev : st));
        }
        const contractFunder = String(
            (resolvedContract as { funderName?: unknown } | null)?.funderName ?? "",
        ).trim();
        if (contractPrefillLoaded && contractFunder) return;
        const ad = applicationData as Record<string, unknown>;
        const bi0 = Array.isArray(ad.businessInfo)
            ? (ad.businessInfo[0] as Record<string, unknown>)
            : undefined;
        const fd = normalizeLegacyFunderName(bi0?.funderName ?? ad.funderName ?? "");
        if (fd && !selectedFunder.trim() && !selectedFunderProfileId.trim()) {
            const profile = findFunderProfile(funders, fd, st);
            if (profile) {
                setSelectedFunderProfileId(profile.id);
                setSelectedFunder(profile.name);
            } else {
                setSelectedFunder(
                    pickFunderForSelect(fd, funderNamesForContractState(funders, st)) || fd,
                );
            }
        }
    }, [
        isOpen,
        applicationData,
        funders,
        contractPrefillLoaded,
        resolvedContract,
        selectedFunder,
        selectedFunderProfileId,
    ]);

    /** After API funders replace fallbacks, rebind profile id so docs scope is correct. */
    useEffect(() => {
        if (!isOpen || fundersLoading || userSelectedFunderRef.current) return;
        const raw =
            String(selectedFunder || "").trim() ||
            String(
                (resolvedContract as { funderName?: unknown } | null)?.funderName ?? "",
            ).trim();
        if (!raw) return;
        const profile = findFunderProfile(funders, raw, selectedState);
        if (!profile) return;
        const curId = String(selectedFunderProfileId || "").trim();
        if (curId === profile.id) return;
        if (curId && !curId.startsWith("fallback-") && findFunderById(curId)) return;
        setSelectedFunderProfileId(profile.id);
        setSelectedFunder(profile.name);
    }, [
        isOpen,
        fundersLoading,
        funders,
        selectedFunder,
        selectedFunderProfileId,
        selectedState,
        resolvedContract,
        findFunderById,
    ]);

    /**
     * Default to Nitro Advance when it is the platform funder or the only option — but only
     * for a deal that has not already been built under a funder of its own.
     *
     * `Contract.funderName` survives a resend, and this effect used to overwrite it on every
     * reopen, so a deal last sent under another funder silently reverted to Nitro Advance
     * and the replacement package went out on the wrong paper.
     */
    useEffect(() => {
        if (!isOpen || fundersLoading) return;
        const nitro = funders.find(
            (f) => f.isActive !== false && isWoodmereFunderProfile(f),
        );
        const onlyOption =
            funderSelectEntries.length === 1 ? funderSelectEntries[0] : null;
        const target =
            nitro ?? (onlyOption ? findFunderById(onlyOption.value) : undefined);
        if (!target) return;
        const onlyOneFunder = funderSelectEntries.length <= 1;
        if (!onlyOneFunder && userSelectedFunderRef.current) return;
        if (!onlyOneFunder) {
            const savedFunder = String(
                (resolvedContract as { funderName?: unknown } | null)?.funderName ?? "",
            ).trim();
            const savedProfile = savedFunder
                ? findFunderProfile(funders, savedFunder, selectedState)
                : null;
            // The deal already names a funder that is not the platform default — leave it.
            if (savedFunder && !funderNamesEquivalent(savedFunder, target.name)) {
                if (!savedProfile || savedProfile.id !== target.id) return;
            }
        }
        if (
            selectedFunderProfileId === target.id &&
            selectedFunder === target.name
        ) {
            return;
        }
        selectedFunderProfileIdRef.current = target.id;
        selectedFunderRef.current = target.name;
        setSelectedFunderProfileId(target.id);
        setSelectedFunder(target.name);
    }, [
        isOpen,
        fundersLoading,
        funders,
        funderSelectEntries,
        selectedFunder,
        selectedFunderProfileId,
        selectedState,
        resolvedContract,
        findFunderById,
    ]);

    // Seed CC list when the dialog opens (user-added addresses; default CC is always merged at send).
    // Never keep signer emails in the CC list — those are recipients, not copy-only.
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const signerEmails = new Set(
            docuSignSignerRolesForSend
                .map((s) => normalizeCcEmailToken(String(s.signerEmail || "")))
                .filter(Boolean),
        );
        const loaded = loadBoldSignCcEmailList(contractCcMergeOptions);
        const cleaned = loaded.filter(
            (email) => !signerEmails.has(normalizeCcEmailToken(email)),
        );
        setCcEmails(cleaned);
        if (cleaned.length !== loaded.length) {
            saveBoldSignCcEmailList(cleaned, contractCcMergeOptions);
        }
        setCcEmailDraft("");
    }, [isOpen, contractCcMergeOptions, docuSignSignerRolesForSend]);

    // Fetch tenant contract CC defaults (platform + funder-resolved) for this book.
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        let cancelled = false;
        const funderName = String(selectedFunder || selectedFunderProfile?.name || "").trim();
        const funderProfileId = String(
            persistedFunderProfileIdForApi(selectedFunderProfile) || selectedFunderProfileId || "",
        ).trim();
        const contractIdNum = Number(resolvedContractId ?? contractId);
        const contractIdParam =
            Number.isFinite(contractIdNum) && contractIdNum > 0 ? contractIdNum : null;

        // Prefer the selected funder's profile CC immediately; avoid showing a prior funder's list.
        const profileCcEmails = parseFunderDefaultCcEmails(selectedFunderDefaultCcEmail);
        if (profileCcEmails.length) {
            setTenantDefaultContractCcEmail(profileCcEmails[0], profileCcEmails);
            setTenantContractCcDefaults({
                defaultCcEmail: null,
                resolvedCcEmail: profileCcEmails[0],
                ccEmails: profileCcEmails,
            });
            setTenantCcDefaultsVersion((v) => v + 1);
        } else {
            setTenantContractCcDefaults(null);
        }

        // Skip the slow contract-cc-defaults round trip when the funder profile
        // already has CC emails — selecting a state used to refetch this (~5s).
        if (profileCcEmails.length) {
            return () => {
                cancelled = true;
            };
        }

        void (async () => {
            try {
                const data = await fetchContractCcDefaults({
                    funderName: funderName || null,
                    funderProfileId: funderProfileId || null,
                    contractId: contractIdParam,
                });
                if (cancelled) return;
                setTenantDefaultContractCcEmail(
                    data.resolvedCcEmail ?? data.defaultCcEmail,
                    data.ccEmails,
                );
                setTenantContractCcDefaults(data);
                setTenantCcDefaultsVersion((v) => v + 1);
            } catch {
                if (cancelled) return;
                // Fail open: leave default CC empty rather than blocking send.
                if (!profileCcEmails.length) {
                    setTenantDefaultContractCcEmail(null, []);
                    setTenantContractCcDefaults(null);
                    setTenantCcDefaultsVersion((v) => v + 1);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [
        isOpen,
        selectedFunder,
        selectedFunderProfile,
        selectedFunderProfileId,
        selectedFunderDefaultCcEmail,
        resolvedContractId,
        contractId,
    ]);

    const addPdfCcFromDraft = () => {
        const raw = ccEmailDraft.trim();
        if (!raw) {
            toast.info("Enter an email address to add.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
            toast.error("Enter a valid email address.");
            return;
        }
        const rawToken = normalizeCcEmailToken(raw);
        if (
            docuSignSignerRolesForSend.some(
                (s) => normalizeCcEmailToken(String(s.signerEmail || "")) === rawToken,
            )
        ) {
            toast.info("That address is already a DocuSign signer, not a CC.");
            return;
        }
        if (
            isReservedContractCcEmail(raw, contractCcMergeOptions) ||
            ccEmails.some((e) => e.toLowerCase() === raw.toLowerCase())
        ) {
            toast.info("That address is already in the CC list.");
            return;
        }
        const next = [...ccEmails, raw];
        setCcEmails(next);
        saveBoldSignCcEmailList(next, contractCcMergeOptions);
        setCcEmailDraft("");
    };

    /** Saved agents only — a referring-agent fallback is not part of the stored list. */
    const savedAgentEmails = agentEmailSource === "contract" ? agentEmails : [];

    /** Replace the saved agent list on the contract (empty clears it). */
    const saveAgentEmails = async (next: string[], successMessage: string) => {
        if (!applicationIdForLookup) {
            toast.error("This contract is not linked to an application yet.");
            return;
        }
        setIsSavingAgentEmail(true);
        try {
            const res = await axiosPut(
                `/contract/agent-email/${encodeURIComponent(applicationIdForLookup)}`,
                { agentEmails: next },
            );
            setAgentEmails(readAgentEmailsFromResponse(res?.data?.data));
            setAgentEmailSource(String(res?.data?.data?.source ?? "none"));
            setAgentEmailDraft("");
            toast.success(successMessage);
        } catch (error) {
            const msg = await parseApiErrorMessageFromAxios(error);
            toast.error(msg || "Could not save the agent email.");
        } finally {
            setIsSavingAgentEmail(false);
        }
    };

    /** Add the typed address(es) — comma-separated is fine — to the saved agents. */
    const addAgentFromDraft = () => {
        const typed = agentEmailDraft
            .split(/[,;\s]+/)
            .map((e) => e.trim())
            .filter(Boolean);
        if (!typed.length) return;
        const invalid = typed.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
        if (invalid) {
            toast.error(`${invalid} is not a valid agent email address.`);
            return;
        }
        const known = new Set(savedAgentEmails.map((e) => e.toLowerCase()));
        const added: string[] = [];
        for (const email of typed) {
            if (known.has(email.toLowerCase())) continue;
            known.add(email.toLowerCase());
            added.push(email);
        }
        if (!added.length) {
            setAgentEmailDraft("");
            return;
        }
        void saveAgentEmails(
            [...savedAgentEmails, ...added],
            added.length > 1 ? "Agent emails saved." : "Agent email saved.",
        );
    };

    const removeAgentEmail = (email: string) => {
        void saveAgentEmails(
            savedAgentEmails.filter((e) => e.toLowerCase() !== email.toLowerCase()),
            "Agent email removed.",
        );
    };

    const voidLinkedContractEnvelope = async (envelopeId: string, reason: string) => {
        await dispatch(
            voidBoldSignDocument({
                documentId: envelopeId,
                reason,
                ...(applicationIdForLookup
                    ? { applicationId: String(applicationIdForLookup) }
                    : {}),
                ...(resolvedContractId != null ? { contractId: resolvedContractId } : {}),
                ...(resolvedContract && typeof resolvedContract === "object"
                    ? {
                          funderName: String(
                              (resolvedContract as { funderName?: unknown }).funderName ?? "",
                          ).trim(),
                          contractState: String(
                              (resolvedContract as { state?: unknown }).state ?? "",
                          ).trim(),
                      }
                    : {}),
            }),
        ).unwrap();
    };

    const handleCancelContract = async () => {
        const envelopeId = String(
            selectedSentRow?.envelopeId ||
                linkedEnvelopeIdRef.current ||
                linkedEnvelopeId ||
                "",
        ).trim();
        const providerLabel = isSignNowEnvelopeId(envelopeId) || isSignNowContractUiEnabled()
            ? "SignNow"
            : "DocuSign";
        if (!envelopeId) {
            toast.error(`No ${providerLabel} envelope is linked to this contract.`);
            return;
        }
        const voidLabel = selectedSentRow?.label?.trim() || "contract";
        const confirmed = window.confirm(
            `Void "${voidLabel}" in ${providerLabel}? Signers will no longer be able to sign. You can send a new package afterward.`,
        );
        if (!confirmed) return;

        setIsCancellingContract(true);
        try {
            await voidLinkedContractEnvelope(envelopeId, "Cancelled by user from CRM");
            invalidateDocuSignDraftSession();
            signNowReviewEnvelopeIdRef.current = null;
            setDocuSignOpenUrl(null);
            setSentStepUnlocked(false);
            setSentAt(null);
            contractWasSentRef.current = false;
            awaitingDocuSignSendRef.current = false;
            pendingCcForSentRef.current = [];
            ccEmailDeliveredRef.current = false;
            invalidateDocuSignPdfCache();
            setPrefilledBoldSignPdfUrl(null);
            setPrefilledBoldSignPdfHint(null);
            await refreshContractSigningState(false, {
                syncDocuSign: false,
                forceDocuSignSync: false,
            });
            onContractDocumentsChanged?.();
            if (activeStepRef.current === "sent") {
                setActiveStep("summary");
            }
            toast.success(
                `${voidLabel} voided in ${providerLabel}. Use Review & send when you are ready to send again.`,
            );
        } catch (error) {
            console.error(`Failed to cancel ${providerLabel} contract:`, error);
            const msg = await parseApiErrorMessageFromAxios(error);
            toast.error(msg || `Failed to void ${voidLabel} in ${providerLabel}.`);
        } finally {
            setIsCancellingContract(false);
        }
    };

    /**
     * Start a brand new contract package for a deal whose contract was already sent.
     *
     * Editing the application or re-scrubbing the offer afterwards leaves the sent package
     * describing superseded terms, and sending again from the Sent step reused that package
     * instead of rebuilding it. This archives the current envelope to send history, returns
     * the CRM contract to draft with the current offer's amounts, and drops the wizard back
     * to Info Required so the rest of the flow — Info Required → Summary → Review in
     * SignNow → Send via SignNow — runs exactly as it does for a first contract, disclosure
     * and addendums included.
     *
     * The previous envelope is not voided: use Void Contract first when the merchant must be
     * stopped from signing the old package.
     */
    const handleResendNewContract = async () => {
        const appId = String(applicationIdForLookup ?? "").trim();
        if (!appId) {
            toast.error("This contract is not linked to an application yet.");
            return;
        }
        // This rebuilds the package from scratch — users reached for it to send the
        // same contract to a corrected email and lost every value they had entered.
        const confirmed = window.confirm(
            "Start a NEW contract? The sent contract is archived and every value edited by hand " +
                "on the prefill form, addendums and signer list is cleared. The deal returns to " +
                "Contract Pending.\n\nTo send the same contract again (or to a corrected email), " +
                "cancel and use \"Resend unsigned contract\" instead.",
        );
        if (!confirmed) return;
        setIsResendingNewContract(true);
        try {
            /**
             * `resend: true` makes the backend discard every cached prefill value along with
             * the archived envelope. Without it the replacement package reused the values
             * captured at the previous send, so the addendum and state-disclosure documents
             * went back out carrying the superseded offer amounts.
             */
            await dispatch(
                reinitiateContractAction({ applicationId: appId, resend: true }),
            ).unwrap();

            // Drop every handle on the archived package before the wizard reopens, so no
            // part of the previous send can be reused or shown against the new one.
            invalidateDocuSignDraftSession();
            invalidateDocuSignPdfCache();
            resetSignNowReviewUi();
            signNowReviewEnvelopeIdRef.current = null;
            setDocuSignOpenUrl(null);
            setSessionEnvelopeId(null);
            setSentStepUnlocked(false);
            setSentAt(null);
            setSentCcEmails([]);
            /**
             * These refs are assigned during render, so the refresh below — awaited before
             * React re-renders — would otherwise still read the pre-resend values, compute
             * `nowSent` as true and snap the wizard straight back to the Sent step. Point
             * them at the state just set so the refresh sees the deal as it now is.
             */
            sentStepUnlockedRef.current = false;
            sentAtRef.current = null;
            activeStepRef.current = "documents";
            contractWasSentRef.current = false;
            awaitingDocuSignSendRef.current = false;
            pendingCcForSentRef.current = [];
            ccEmailDeliveredRef.current = false;
            prefilledPdfCachedForEnvelopeRef.current = null;
            setPrefilledBoldSignPdfUrl(null);
            setPrefilledBoldSignPdfHint(null);
            /** Review must build a new package rather than reopen the archived draft. */
            signNowForceFreshReviewRef.current = true;
            /** Step 4 is empty until the new package is sent — never bounce back to it. */
            didSuggestSentTabThisOpenRef.current = true;

            // Land on Documents straight away rather than after the refresh round trip, so
            // the user never watches the Sent step while the new draft is prepared. The
            // replacement runs the whole wizard again from step 1 — document selection
            // included — rather than resuming halfway through the previous package.
            setPdfRightPaneTab("template");
            setActiveStep("documents");

            await refreshContractSigningState(false, {
                syncDocuSign: false,
                forceDocuSignSync: false,
            });
            onContractDocumentsChanged?.();
        } catch (error) {
            console.error("Failed to start a new contract:", error);
            const msg = await parseApiErrorMessageFromAxios(error);
            toast.error(
                typeof error === "string"
                    ? error
                    : msg || "Failed to start a new contract for this application.",
            );
        } finally {
            setIsResendingNewContract(false);
        }
    };

    /**
     * Email the merchant a CRM signing-portal link through SendGrid instead of
     * letting SignNow send the invite. The package must already exist (Review
     * completed) — the portal remints a session from that same embedded invite.
     */
    const handleSendViaSendGrid = async () => {
        // The id of the package the user just reviewed comes first: a background
        // refresh during the review can null `sessionEnvelopeId`, and on a first
        // send the contract row has no envelope id yet, so reading either of
        // those alone reported "no contract package to send" after Finish.
        const envelopeId = String(
            signNowReviewEnvelopeIdRef.current ||
                sessionEnvelopeId ||
                linkedEnvelopeIdRef.current ||
                "",
        ).trim();
        if (!envelopeId) {
            toast.error(
                "Finish Review in SignNow first — there is no contract package to send yet.",
            );
            return;
        }
        if (isSignNowContractUiEnabled() && !signNowReviewCompleteRef.current) {
            // Sending before the Owner's Finish tears the review down half-way.
            toast.info("Click Finish in the SignNow tab first, then Send via SignNow.");
            return;
        }
        const roles = buildDocuSignRolesForSync();
        const validation = validateDocuSignSignerRoles(roles);
        if (!validation.valid) {
            toast.error(
                validation.message ||
                    "Add signer role names and emails in Contract Signers before sending.",
            );
            return;
        }
        const merchantLabel =
            String(
                resolveContractBusinessLegalNameForPrefill(
                    (resolvedContract as Record<string, unknown> | null) ?? {},
                    applicationData,
                ) || "",
            ).trim() || "Your funding agreement";
        if (sendingLockRef.current) return;
        /**
         * Hold the send lock for the whole request, as the SignNow invite send
         * does. It silences every review-status check this modal runs (the
         * review poll, the focus re-check, the Finish confirmation), so none of
         * them compete with SignNow while the backend commits the contract
         * values — the publish that, when it lost, left the agreement blank.
         */
        sendingLockRef.current = true;
        setIsSendingViaSendGrid(true);
        try {
            const ccForSend = mergeWithDefaultCcEmails(ccEmails, contractCcMergeOptions);
            await axiosPost("/docusign/send-contract-portal", {
                envelopeId,
                roles,
                contractLabel: merchantLabel,
                funderName: String(selectedFunderRef.current || selectedFunder || "").trim(),
                // Build the values at click time, exactly as the SignNow send
                // does. Without them the portal re-published the document using
                // whatever Owner review had written, so a contract edited after
                // review still emailed its previous amounts.
                prefillFields: buildDocuSignPrefillFieldsPayload(),
                includeWireFee: includeWireFeeForSendRef.current,
                // Copy-only recipients — the backend emails them the contract
                // package once merchants are sent (never a signer).
                ccEmails: ccForSend,
                // Saved on the contract server-side too, in case the panel's
                // own save is still in flight when Send is clicked.
                ...(savedAgentEmails.length ? { agentEmails: savedAgentEmails } : {}),
            }, {
                // The backend only validates before answering; the SignNow publish
                // and SendGrid emails finish in the background and report back
                // over the socket (see PortalSendResultListener).
                timeout: 30_000,
            });
            pendingPortalSendEnvelopeRef.current = envelopeId;
            toast.dismiss(SIGNNOW_REVIEW_COMPLETE_TOAST_ID);
            /**
             * The review is over: drop every trace of it, exactly as the SignNow
             * invite send does. Left in place, the embed URL / review-complete
             * flag read as "still waiting to send", so the Sent step never
             * treated the contract as sent and its SignNow PDF only appeared
             * after closing and reopening the modal.
             */
            resetSignNowReviewUi();
            awaitingDocuSignSendRef.current = false;
            contractWasSentRef.current = true;
            setSentStepUnlocked(true);
            setSentAt(new Date());
            setActiveStep("sent");
            setPdfRightPaneTab("docusign");
            signNowReviewEnvelopeIdRef.current = null;
            prefilledPdfCachedForEnvelopeRef.current = null;
            invalidateDocuSignPdfCache();
            onContractDocumentsChanged?.();
            // The sent package's PDF is loaded when the backend's "sent" push
            // arrives (see the realtime handler) — fetching it now would show the
            // copy from before the merchant publish finished.
            toast.success(
                "Contract is being sent — the merchant will get the signing link in a moment.",
            );
        } catch (error) {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message ||
                (error as Error)?.message ||
                "Could not email the signing link.";
            toast.error(String(message));
        } finally {
            sendingLockRef.current = false;
            setIsSendingViaSendGrid(false);
        }
    };

    const handleSend = async () => {
        const clickAt = Date.now();
        if (sendingLockRef.current || isSending) return;
        if (
            isSignNowContractUiEnabled() &&
            signNowEmbedUrl &&
            !signNowReviewVisible &&
            !signNowReviewComplete &&
            !signNowForceFreshReviewRef.current
        ) {
            setSignNowReviewVisible(true);
            setPdfRightPaneTab("docusign");
            openSignNowReviewTab(signNowEmbedUrl);
            return;
        }
        sendingLockRef.current = true;
        // A Review (not the Send of a finished one) locks the button and says so
        // from the click on: the data wait below can take a moment on its own.
        const startsSignNowReview =
            isSignNowContractUiEnabled() && !signNowReviewComplete;
        if (startsSignNowReview) {
            flushSync(() => setSignNowPreparePhase("preparing"));
        }
        await flushAddendumMappingsRef.current();
        if (!fileUrl) {
            sendingLockRef.current = false;
            setSignNowPreparePhase(null);
            return;
        }
        const packageIncludesMainContract =
            !canSendWithoutContract || includeMainContractInSendRef.current;
        const hasSignNowStandaloneSupplemental =
            !packageIncludesMainContract &&
            (resolveAddendumTemplateIdsForDocuSignMerge().some((ref) =>
                isSignNowAddendumLayoutKey(ref),
            ) ||
                (includeDisclosureInSendRef.current &&
                    isSignNowDisclosureLayoutKey(
                        resolveDisclosureTemplateRefForDocuSignMerge(),
                    )));
        const sendViaSignNowApi =
            isSignNowContractUiEnabled() &&
            (packageIncludesMainContract || hasSignNowStandaloneSupplemental);
        if (sendViaSignNowApi) {
            /**
             * Nothing is built for SignNow until the contract, its saved prefill, the
             * template mappings, the disclosure link and the bank analysis have all
             * loaded. Awaiting them here — not a delay, the loads themselves release it —
             * is what stops the first Review opening on a half-filled package.
             */
            await waitForContractDataReady();
        }
        const outForSignatureBeforeSend = getPrimaryContractEnvelopeView(
            resolvedContract,
            sentAt,
        ).isOutForSignature;
        const forceFreshSignNowReview = signNowForceFreshReviewRef.current;
        if (forceFreshSignNowReview) {
            signNowForceFreshReviewRef.current = false;
        }
        const sendingOpenSignNowDraft =
            sendViaSignNowApi &&
            Boolean(signNowReviewComplete) &&
            !forceFreshSignNowReview &&
            Boolean(
                String(
                    signNowReviewEnvelopeIdRef.current ||
                        sessionEnvelopeId ||
                        linkedEnvelopeIdRef.current ||
                        "",
                ).trim(),
            );
        if (!canReviewAndSendCurrentPackage && !sendingOpenSignNowDraft) {
            sendingLockRef.current = false;
            setSignNowPreparePhase(null);
            toast.info(
                packageIncludesMainContract
                    ? "This contract cannot be sent right now."
                    : "Cannot send this document package right now.",
            );
            return;
        }

        let docuSignTab: Window | null = null;
        /**
         * Claimed synchronously on the click — a `window.open` after the first
         * await is a pop-up block — and navigated to SignNow once the review URL
         * comes back. Closed again in `finally` if this click turned out to be a
         * send rather than a review.
         */
        let signNowReviewTab: Window | null = null;
        let signNowReviewTabConsumed = false;
        try {
            setDocuSignOpenUrl(null);
            if (!sendViaSignNowApi) {
                docuSignTab = window.open("about:blank", "_blank");
                if (docuSignTab) {
                    try {
                        writeDocuSignLoadingTab(docuSignTab.document);
                    } catch {
                        /* ignore */
                    }
                }
            } else if (!sendingOpenSignNowDraft) {
                signNowReviewTab = window.open("about:blank", SIGNNOW_REVIEW_TAB_NAME);
                if (signNowReviewTab) {
                    try {
                        writeSignNowPreparingTab(signNowReviewTab.document);
                    } catch {
                        /* ignore */
                    }
                }
            }
            flushSync(() => setIsSending(true));

            if (outForSignatureBeforeSend && !sendingOpenSignNowDraft) {
                // Start a fresh draft envelope without voiding the prior send.
                invalidateDocuSignDraftSession();
                setSessionEnvelopeId(null);
                linkedEnvelopeIdRef.current = null;
                signNowReviewEnvelopeIdRef.current = null;
                awaitingDocuSignSendRef.current = false;
                pendingCcForSentRef.current = [];
                ccEmailDeliveredRef.current = false;
                invalidateDocuSignPdfCache();
                setPrefilledBoldSignPdfUrl(null);
                setPrefilledBoldSignPdfHint(null);
                toast.info(
                    sendViaSignNowApi
                        ? "Creating a new SignNow package. Previous send was not voided."
                        : "Creating a new DocuSign draft. Previous envelope was not voided.",
                );
            }
            const draft = ccEmailDraft.trim();
            let userCc = [...ccEmails];
            if (draft && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft)) {
                const dup =
                    isReservedContractCcEmail(draft, contractCcMergeOptions) ||
                    userCc.some((e) => e.toLowerCase() === draft.toLowerCase());
                if (!dup) {
                    userCc = [...userCc, draft];
                }
            }
            userCc = [...new Set(userCc.map((e) => e.trim()).filter(Boolean))];
            const toSend = mergeWithDefaultCcEmails(userCc, contractCcMergeOptions);

            saveBoldSignCcEmailList(userCc, contractCcMergeOptions);
            setCcEmails(userCc);
            setCcEmailDraft("");

            if (onPrepareDocuSignDraft) {
                const signerRolesForSend = buildDocuSignRolesForSync();
                const signerValidation = validateDocuSignSignerRoles(signerRolesForSend);
                if (!signerValidation.valid) {
                    const msg =
                        signerValidation.message ||
                        "Add signer role names and emails in Contract Signers before sending to DocuSign.";
                    if (docuSignTab) {
                        try {
                            writeDocuSignErrorTab(docuSignTab.document, msg);
                        } catch {
                            /* ignore */
                        }
                    }
                    toast.error(msg);
                    return;
                }
                if (selectedAddendumOptions.some((o) => o.startsWith("up:"))) {
                    const msg =
                        "Only DocuSign addendum templates can be merged with the contract. Clear uploaded-PDF-only selections or pick DocuSign templates.";
                    if (docuSignTab) {
                        try {
                            writeDocuSignErrorTab(docuSignTab.document, msg);
                        } catch {
                            /* ignore */
                        }
                    }
                    toast.info(msg);
                    return;
                }

                const packageSelection = getEffectiveSendPackage();
                const addendumLayoutKey = resolveAddendumLayoutKeyForDocuSignMerge();
                const disclosureRef = resolveDisclosureTemplateRefForDocuSignMerge();
                const packageValidationMsg = validateContractSendPackage(packageSelection, {
                    addendumLayoutKey,
                    disclosureRef,
                });
                if (packageValidationMsg) {
                    if (docuSignTab) {
                        try {
                            writeDocuSignErrorTab(docuSignTab.document, packageValidationMsg);
                        } catch {
                            /* ignore */
                        }
                    }
                    toast.error(packageValidationMsg);
                    return;
                }

                const addendumTemplateIds = resolveAddendumTemplateIdsForDocuSignMerge();
                const addendumTemplateId = addendumTemplateIds[0] ?? null;
                const addendumIdsFingerprint = addendumTemplateIds.slice().sort().join(",");
                const sessionEnv = outForSignatureBeforeSend
                    ? null
                    : String(sessionEnvelopeId || "").trim() || null;
                if (
                    sendViaSignNowApi &&
                    signNowReviewComplete &&
                    !forceFreshSignNowReview
                ) {
                    const envelopeId = String(
                        signNowReviewEnvelopeIdRef.current ||
                            sessionEnvelopeId ||
                            linkedEnvelopeIdRef.current ||
                            "",
                    ).trim();
                    if (!envelopeId) {
                        toast.error(
                            "SignNow review finished, but the contract id is missing. Click Review in SignNow again.",
                        );
                        return;
                    }
                    // Drop the SignNow iframe before send so its polling XHRs
                    // do not compete with the invite bake.
                    flushSync(() => {
                        setSignNowEmbedUrl(null);
                    });
                    await axiosPost(
                        "/docusign/send-envelope",
                        {
                            envelopeId,
                            applicationId: applicationIdForLookupRef.current,
                            roles: signerRolesForSend,
                            ccEmails: toSend,
                            prefillFields: buildPrefillFieldsPayloadRef.current(),
                            includeWireFee: includeWireFeeForSendRef.current,
                            funderName:
                                String(
                                    selectedFunderRef.current || selectedFunder || "",
                                ).trim() || undefined,
                            funderProfileId:
                                persistedFunderProfileIdForApi(selectedFunderProfile) ||
                                undefined,
                            addendumDocumentRefs: addendumTemplateIds,
                            disclosureDocumentRef: includeDisclosureInSendRef.current
                                ? resolveDisclosureTemplateRefForDocuSignMerge()
                                : null,
                            sendPackage: {
                                ...getEffectiveSendPackage(),
                                includeAddendum: addendumTemplateIds.length > 0,
                                includeDisclosure: includeDisclosureInSendRef.current,
                            },
                        },
                        {
                            timeout: 300_000,
                            headers: {
                                "Idempotency-Key": envelopeId,
                            },
                        },
                    );
                    awaitingDocuSignSendRef.current = false;
                    contractWasSentRef.current = true;
                    setSentStepUnlocked(true);
                    setSentAt(new Date());
                    setActiveStep("sent");
                    setPdfRightPaneTab("docusign");
                    setSignNowReviewComplete(false);
                    signNowReviewEnvelopeIdRef.current = null;
                    onContractDocumentsChanged?.();
                    invalidateDocuSignPdfCache();
                    void refreshContractSigningStateRef.current(true, {
                        syncDocuSign: false,
                        forceDocuSignSync: false,
                    });
                    toast.success(
                        "Contract sent via SignNow. Check the merchant inbox (and spam) for the signing email. They only need to sign.",
                    );
                    return;
                }
                let signNowTimingRequestId = "";
                if (sendViaSignNowApi) {
                    signNowTimingRequestId = newSignNowTimingRequestId();
                    beginSignNowReviewTiming(signNowTimingRequestId, clickAt);
                }
                const signerFingerprintForSend = contractSignerOverridesFingerprint(
                    signerRolesForSend.map((r) => ({
                        role: r.signerRole,
                        name: r.signerName,
                        email: r.signerEmail,
                    })),
                );
                const currentOwnerCount = resolveActiveOwnerCount({
                    signerRoles: signerRolesForSend.map((r) => ({
                        signerRole: r.signerRole,
                        signerEmail: r.signerEmail,
                    })),
                });
                const isResendAfterSigned =
                    outForSignatureBeforeSend ||
                    canResendMainContract(resolvedContract, sentAt);
                const signNowFingerprintsMatch =
                    draftPreparedPackageFingerprintRef.current === sendPackageFingerprint &&
                    draftPreparedSignerRolesRef.current === signerFingerprintForSend &&
                    draftPreparedOwnerCountRef.current === currentOwnerCount &&
                    draftPreparedAddendumIdRef.current === addendumIdsFingerprint &&
                    draftPreparedPrefillFingerprintRef.current === prefillDraftFingerprint;
                if (
                    sendViaSignNowApi &&
                    sessionEnv &&
                    sessionEnv === draftPreparedEnvelopeRef.current &&
                    !isResendAfterSigned &&
                    signNowFingerprintsMatch
                ) {
                    const cached = String(signNowCachedEmbedUrlRef.current || "").trim();
                    const reuseUrl =
                        cached && !isSignNowLoginWebappUrl(cached) ? cached : "";
                    const reminted = reuseUrl
                        ? { url: reuseUrl, error: null }
                        : await fetchDocuSignSenderViewUrl(
                              sessionEnv,
                              toSend,
                              signerRolesForSend,
                          );
                    const embedUrl = String(reminted.url || "").trim();
                    if (embedUrl && !isSignNowLoginWebappUrl(embedUrl)) {
                        signNowCachedEmbedUrlRef.current = embedUrl;
                        signNowReviewEnvelopeIdRef.current = sessionEnv;
                        pendingCcForSentRef.current = toSend;
                        ccEmailDeliveredRef.current = false;
                        awaitingDocuSignSendRef.current = true;
                        setPdfRightPaneTab("docusign");
                        if (signNowTimingRequestId) {
                            markSignNowReviewEmbedSet(signNowTimingRequestId);
                        }
                        setSignNowEmbedUrl(embedUrl);
                        setSignNowReviewVisible(true);
                        setSignNowReviewComplete(false);
                        signNowReviewTabConsumed = true;
                        openSignNowReviewTab(embedUrl, signNowReviewTab);
                        return;
                    }
                }
                const canReuseSessionDraft =
                    Boolean(sessionEnv) &&
                    !sendViaSignNowApi &&
                    !isResendAfterSigned &&
                    draftPreparedPackageFingerprintRef.current === sendPackageFingerprint &&
                    draftPreparedSignerRolesRef.current === signerFingerprintForSend &&
                    draftPreparedOwnerCountRef.current === currentOwnerCount &&
                    draftPreparedAddendumIdRef.current === addendumIdsFingerprint;

                let envelopeId: string | null = null;
                let preparedSenderUrl: string | null = null;

                if (canReuseSessionDraft && sessionEnv) {
                    /** Same draft package/signers — patch latest prefill and reopen Sender View. */
                    invalidateDocuSignPdfCache();
                    if (!sendViaSignNowApi) {
                        await syncPrefillToDraftEnvelope({ envelopeId: sessionEnv });
                    }
                    envelopeId = sessionEnv;
                    draftPreparedPrefillFingerprintRef.current = prefillDraftFingerprint;
                    draftPreparedCcRef.current = [...toSend];
                } else {
                    if (sessionEnv) {
                        invalidateDocuSignPdfCache();
                    }
                    if (isResendAfterSigned) {
                        toast.info(
                            sendViaSignNowApi
                                ? "Creating a new SignNow contract to send again."
                                : "Creating a new DocuSign envelope to resend the contract.",
                        );
                    }

                    const prefillFieldsForDraft = buildPrefillFieldsPayloadRef.current().map((f) => ({
                        id: f.id,
                        value: f.value,
                    }));
                    const disclosureDocumentRef = includeDisclosureInSendRef.current
                        ? resolveDisclosureTemplateRefForDocuSignMerge()
                        : null;
                    // Extra funder Settings disclosures (beyond the primary) ride along as supplemental refs.
                    const extraFunderDisclosureRefs = disclosureDocumentRef
                        ? funderDisclosureOptions
                              .slice(1)
                              .map((d) => d.templateId || d.layoutKey)
                              .filter(Boolean)
                        : [];
                    const sendPackageForDraft: ContractSendPackageSelection = {
                        ...packageSelection,
                        includeAddendum: addendumTemplateIds.length > 0,
                        includeDisclosure: Boolean(disclosureDocumentRef),
                    };
                    if (sendViaSignNowApi) {
                        // The server prefills every document, reads each one back and
                        // only returns a review link once all their fields are filled.
                        setSignNowPreparePhase("validating");
                    }
                    const prepared = await onPrepareDocuSignDraft({
                        ccEmails: toSend,
                        // Only the legacy fallback: `addendumTemplateId` is
                        // `addendumTemplateIds[0]`, so sending both duplicated the
                        // first addendum (visible as "Exhibit C (2)" in SignNow).
                        ...(addendumTemplateIds.length
                            ? {}
                            : { addendumDocumentRef: addendumTemplateId }),
                        addendumDocumentRefs: [
                            ...addendumTemplateIds,
                            ...extraFunderDisclosureRefs,
                        ],
                        disclosureDocumentRef,
                        includeMainContract: sendPackageForDraft.includeMainContract,
                        sendPackage: sendPackageForDraft,
                        roles: signerRolesForSend,
                        funderName: selectedFunder.trim() || null,
                        funderProfileId:
                            persistedFunderProfileIdForApi(selectedFunderProfile) || null,
                        contractState: pickUsStateForSelect(selectedState) || null,
                        mainContractLayoutKey: resolveLayoutKey(
                            selectedFunder,
                            selectedFunderProfile?.id,
                        ),
                        prefillFields: prefillFieldsForDraft,
                        // Not a document field, so it cannot ride along in prefillFields.
                        // Without it the send path re-resolves the wire fee from the
                        // contract row and re-adds $25 after the box was unchecked.
                        // Read from the ref, like `prefillFields` above and like Send:
                        // this closure was captured at click time, before the awaited
                        // CRM loads, so its copy of the box could still say "on" and
                        // Review printed the disclosure $25 below what Send delivered.
                        includeWireFee: includeWireFeeForSendRef.current,
                        autoSend: false,
                        ...(signNowTimingRequestId
                            ? { timingRequestId: signNowTimingRequestId }
                            : {}),
                    });
                    envelopeId =
                        String(
                            (prepared as { envelopeId?: string } | undefined)?.envelopeId ?? "",
                        ).trim() || null;
                    preparedSenderUrl =
                        String(
                            (prepared as {
                                embeddedEditorUrl?: string | null;
                                embeddedInviteUrl?: string | null;
                                sendUrl?: string | null;
                            } | undefined)?.embeddedEditorUrl ||
                            (prepared as { embeddedInviteUrl?: string | null; sendUrl?: string | null } | undefined)
                                ?.embeddedInviteUrl ||
                                (prepared as { sendUrl?: string | null } | undefined)?.sendUrl ||
                                "",
                        ).trim() || null;
                    if (isSignNowLoginWebappUrl(preparedSenderUrl)) {
                        preparedSenderUrl = null;
                    }
                    if (envelopeId) {
                        setSessionEnvelopeId(envelopeId);
                        linkedEnvelopeIdRef.current = envelopeId;
                        draftPreparedAddendumIdRef.current = addendumIdsFingerprint;
                        draftPreparedCcRef.current = [...toSend];
                        draftPreparedPrefillFingerprintRef.current = prefillDraftFingerprint;
                        draftPreparedSignerRolesRef.current = signerFingerprintForSend;
                        draftPreparedOwnerCountRef.current = currentOwnerCount;
                        draftPreparedPackageFingerprintRef.current = sendPackageFingerprint;
                        draftPreparedEnvelopeRef.current = envelopeId;
                        if (!sendViaSignNowApi) {
                            void persistContractEnvelopeHistory(envelopeId, "draft");
                        }
                    }
                }

                if (!envelopeId) {
                    const msg = sendViaSignNowApi
                        ? "Could not send the contract. Check signer emails and SignNow configuration."
                        : "Could not create the DocuSign draft. Check signers and template configuration.";
                    if (docuSignTab) {
                        try {
                            writeDocuSignErrorTab(docuSignTab.document, msg);
                        } catch {
                            /* ignore */
                        }
                    }
                    toast.error(msg);
                    return;
                }

                if (sendViaSignNowApi) {
                    const senderViewResult = preparedSenderUrl
                        ? { url: preparedSenderUrl, error: null }
                        : await fetchDocuSignSenderViewUrl(
                              envelopeId,
                              toSend,
                              signerRolesForSend,
                          );
                    const embedUrl = String(senderViewResult.url || "").trim();
                    if (!embedUrl || isSignNowLoginWebappUrl(embedUrl)) {
                        toast.error(
                            senderViewResult.error ||
                                "Could not open SignNow in the CRM. The review link was not returned.",
                            { autoClose: 12000 },
                        );
                        return;
                    }
                    pendingCcForSentRef.current = toSend;
                    ccEmailDeliveredRef.current = false;
                    awaitingDocuSignSendRef.current = true;
                    setPdfRightPaneTab("docusign");
                    signNowCachedEmbedUrlRef.current = embedUrl;
                    signNowReviewEnvelopeIdRef.current = envelopeId;
                    if (signNowTimingRequestId) {
                        markSignNowReviewEmbedSet(signNowTimingRequestId);
                    }
                    setSignNowEmbedUrl(embedUrl);
                    setSignNowReviewVisible(true);
                    setSignNowReviewComplete(false);
                    signNowReviewTabConsumed = true;
                    openSignNowReviewTab(embedUrl, signNowReviewTab);
                    toast.info(
                        "SignNow opened in a new tab. Click Finish there, then come back and click Send via SignNow.",
                        {
                            toastId: SIGNNOW_REVIEW_TOAST_ID,
                            autoClose: 8000,
                            closeOnClick: true,
                            pauseOnHover: false,
                            pauseOnFocusLoss: false,
                        },
                    );
                    return;
                }

                const senderViewResult = preparedSenderUrl
                    ? { url: preparedSenderUrl, error: null }
                    : await fetchDocuSignSenderViewUrlWithRetry(envelopeId, toSend, true);
                const senderUrl = senderViewResult.url;
                if (!senderUrl) {
                    const msg =
                        senderViewResult.error ||
                        "Draft envelope was created but DocuSign did not return a review URL yet. Wait a few seconds and click Review & send again.";
                    if (docuSignTab) {
                        try {
                            writeDocuSignErrorTab(docuSignTab.document, msg);
                        } catch {
                            /* ignore */
                        }
                    }
                    toast.error(msg, { autoClose: 12000 });
                    return;
                }

                pendingCcForSentRef.current = toSend;
                ccEmailDeliveredRef.current = false;

                const beginAwaitingDocuSignSend = () => {
                    awaitingDocuSignSendRef.current = true;
                    void refreshContractSigningStateRef.current(true, {
                        syncDocuSign: true,
                        forceDocuSignSync: true,
                    });
                };

                if (docuSignTab) {
                    try {
                        docuSignTab.location.href = senderUrl;
                        setDocuSignOpenUrl(null);
                        beginAwaitingDocuSignSend();
                        toast.success(
                            "DocuSign opened in a new tab. Click Send there to email signers. CC addresses will receive a contract copy by email once DocuSign marks the envelope sent.",
                            { autoClose: 12000 },
                        );
                        return;
                    } catch {
                        /* fall through to popup-blocked fallback */
                    }
                }

                const opened = tryOpenDocuSignSenderUrl(senderUrl);
                if (!opened) {
                    setDocuSignOpenUrl(senderUrl);
                    beginAwaitingDocuSignSend();
                    toast.info(
                        "Your browser blocked the DocuSign tab. Click Open DocuSign below (or allow pop-ups for this site).",
                        { autoClose: 12000 },
                    );
                    return;
                }

                setDocuSignOpenUrl(null);
                beginAwaitingDocuSignSend();
                toast.success(
                    "DocuSign opened in a new tab. Click Send there to email signers. CC addresses will receive a contract copy by email once DocuSign marks the envelope sent.",
                    { autoClose: 12000 },
                );
            } else if (onSendToDocusign) {
                await onSendToDocusign(toSend);
            } else {
                const msg = "DocuSign is not configured for this contract.";
                if (docuSignTab) {
                    try {
                        writeDocuSignErrorTab(docuSignTab.document, msg);
                    } catch {
                        /* ignore */
                    }
                }
                toast.error(msg);
            }
        } catch (error) {
            console.error("Failed to open DocuSign draft:", error);
            const msg =
                (await parseApiErrorMessageFromAxios(error)) ||
                "Failed to send the contract. Try again.";
            if (docuSignTab) {
                try {
                    writeDocuSignErrorTab(docuSignTab.document, msg);
                } catch {
                    /* ignore */
                }
            }
            toast.error(msg);
        } finally {
            if (signNowReviewTab && !signNowReviewTabConsumed) {
                try {
                    if (!signNowReviewTab.closed) signNowReviewTab.close();
                } catch {
                    /* ignore */
                }
            }
            sendingLockRef.current = false;
            setSignNowPreparePhase(null);
            setIsSending(false);
        }
    };

    const handleBackToSignNow = () => {
        if (sendingLockRef.current || isSending) return;
        signNowForceFreshReviewRef.current = false;
        signNowCachedEmbedUrlRef.current = null;
        resetSignNowReviewUi({ keepCachedEmbed: true });
        void handleSend();
    };

    /**
     * The user walked back to edit the deal: the finished (or open) review no
     * longer matches what will be sent. The CRM forgets it, and so must the
     * backend — otherwise the next modal load would restore "Send via SignNow"
     * for a review of the old details.
     */
    const discardSignNowReviewForEdit = useCallback(() => {
        const envelopeId = String(
            signNowReviewEnvelopeIdRef.current || linkedEnvelopeIdRef.current || "",
        ).trim();
        const hadReview = Boolean(
            signNowReviewCompleteRef.current || signNowEmbedUrlRef.current,
        );
        signNowForceFreshReviewRef.current = false;
        resetSignNowReviewUi({ keepCachedEmbed: true });
        if (hadReview && envelopeId && isSignNowEnvelopeId(envelopeId)) {
            void axiosPost("/docusign/signnow-review-reset", { envelopeId }).catch(() => {
                /* Best-effort: the next Review mints a new link, which resets it too. */
            });
        }
    }, [resetSignNowReviewUi]);

    const handleChangeDetailsBeforeSend = () => {
        discardSignNowReviewForEdit();
        setActiveStep("info");
        toast.info("Update the contract details, then click Review in SignNow before sending.");
    };

    const markSignNowReviewComplete = useCallback(() => {
        setSignNowReviewComplete(true);
        setPersistedReviewEnvelopeId(null);
        signNowCachedEmbedUrlRef.current = null;
        awaitingDocuSignSendRef.current = false;
        // The embedded-complete page closes itself when SignNow redirects to it;
        // this covers the manual "I've clicked Finish" and the status poll.
        closeSignNowReviewTab();
        toast.dismiss(SIGNNOW_REVIEW_TOAST_ID);
        /**
         * The Finish is reported by the review tab, the lock-screen poll and the
         * focus re-check — often all three. Show the toast once per review
         * (keyed by its package, which UI resets do not clear) and under one
         * toast id, so the reports never stack two or three copies.
         */
        const reviewKey =
            String(signNowReviewEnvelopeIdRef.current || "").trim() || "current";
        if (signNowCompleteToastShownRef.current === reviewKey) return;
        signNowCompleteToastShownRef.current = reviewKey;
        toast.success(
            "SignNow review finished. Click Send via SignNow to email the merchant.",
            { toastId: SIGNNOW_REVIEW_COMPLETE_TOAST_ID },
        );
    }, [closeSignNowReviewTab]);

    useEffect(() => {
        // A newly minted review link is a new review: it may announce its Finish.
        if (signNowEmbedUrl) signNowCompleteToastShownRef.current = null;
    }, [signNowEmbedUrl]);

    /** The package the open (or restored) review belongs to. */
    const currentReviewEnvelopeId = useCallback(
        () =>
            String(
                // Only ids that belong to a review: a minted link in this tab, or a
                // review the server has on record. Never the linked document alone
                // — after a pre-warm that is an unprefilled copy.
                signNowReviewEnvelopeIdRef.current || persistedReviewEnvelopeIdRef.current || "",
            ).trim(),
        [],
    );
    const persistedReviewEnvelopeIdRef = useRef<string | null>(null);
    persistedReviewEnvelopeIdRef.current = persistedReviewEnvelopeId;

    /**
     * Restore the Owner review from the backend (CRM database only — no SignNow
     * call, so polling it costs nothing against the SignNow API budget).
     *
     * Review state used to live only in this component, so returning from the
     * SignNow tab after a refresh, a reopened modal or an expired session put
     * the footer back on "Review in SignNow" — and the next click rebuilt the
     * whole package. The backend records the review against the package:
     *   in_review        → keep the screen locked on "click Finish first";
     *   review_complete  → "Send via SignNow", however often the page reloads.
     */
    const persistedReviewSyncInFlightRef = useRef(false);
    const lastPersistedReviewSyncAtRef = useRef(0);
    const syncPersistedSignNowReview = useCallback(
        async (options: { advanceToSummary?: boolean } = {}) => {
            if (!isSignNowContractUiEnabled()) return;
            if (signNowReviewCompleteRef.current) return;
            if (sendingLockRef.current) return;
            const appId = String(applicationIdForLookupRef.current || "").trim();
            if (!appId || persistedReviewSyncInFlightRef.current) return;
            persistedReviewSyncInFlightRef.current = true;
            lastPersistedReviewSyncAtRef.current = Date.now();
            try {
                const res = await axiosGet(
                    `/docusign/signnow-review-state?applicationId=${encodeURIComponent(appId)}`,
                    { skipCache: true },
                );
                const state = res?.data as
                    | { envelopeId?: string | null; phase?: string; reviewComplete?: boolean }
                    | undefined;
                if (sendingLockRef.current || signNowReviewCompleteRef.current) return;
                const envelopeId = String(state?.envelopeId || "").trim();
                const phase = String(state?.phase || "");
                // This package was just sent from here; its review is over even
                // if the server has not marked it sent yet.
                if (envelopeId && envelopeId === pendingPortalSendEnvelopeRef.current) return;
                if (envelopeId && (phase === "in_review" || phase === "review_complete")) {
                    // The answer is for the package linked to this application;
                    // make it the one Send targets, as a review opened here would.
                    signNowReviewEnvelopeIdRef.current = envelopeId;
                    if (!linkedEnvelopeIdRef.current) linkedEnvelopeIdRef.current = envelopeId;
                    if (options.advanceToSummary) {
                        setActiveStep((step) =>
                            step === "documents" || step === "info" ? "summary" : step,
                        );
                    }
                }
                if (envelopeId && phase === "review_complete") {
                    markSignNowReviewComplete();
                    return;
                }
                if (envelopeId && phase === "in_review") {
                    setPersistedReviewEnvelopeId(envelopeId);
                    return;
                }
                // Nothing open on the server. An open review in THIS tab keeps its
                // own lock (its row may simply not be linked yet).
                setPersistedReviewEnvelopeId(null);
            } catch {
                /* Transient — the next tick, focus or modal load asks again. */
            } finally {
                persistedReviewSyncInFlightRef.current = false;
            }
        },
        [markSignNowReviewComplete],
    );

    /**
     * Record the Finish on the server, then show "Send via SignNow".
     *
     * Called when the SignNow tab reports Finish and when the preparer confirms
     * it with "I've clicked Finish". A CRM database write only.
     */
    const recordSignNowFinish = useCallback(async () => {
        const envelopeId = currentReviewEnvelopeId();
        setIsRecordingSignNowFinish(true);
        try {
            if (envelopeId && isSignNowEnvelopeId(envelopeId)) {
                await axiosPost("/docusign/signnow-review-finished", { envelopeId });
            }
        } catch {
            /* The in-tab state still moves on; the next Finish report re-records it. */
        } finally {
            setIsRecordingSignNowFinish(false);
        }
        if (envelopeId) signNowReviewEnvelopeIdRef.current = envelopeId;
        markSignNowReviewComplete();
    }, [currentReviewEnvelopeId, markSignNowReviewComplete]);

    const markSignNowReviewCompleteAndPersist = useCallback(() => {
        void recordSignNowFinish();
    }, [recordSignNowFinish]);

    /**
     * "Open SignNow tab" from the lock screen.
     *
     * Refocuses the review tab the CRM opened — found again by its window name
     * even after this page was refreshed — and only when that tab is really
     * gone asks for a fresh review link for the SAME package. It never rebuilds
     * the package, so it costs at most one SignNow call.
     */
    const focusOrReopenSignNowReviewTab = useCallback(async () => {
        const existing = signNowReviewTabRef.current;
        if (existing && !existing.closed) {
            try {
                existing.focus();
                return;
            } catch {
                /* fall through */
            }
        }
        // Synchronous, inside the click: a pop-up opened after an await is blocked.
        const named = window.open("", SIGNNOW_REVIEW_TAB_NAME);
        let alive = false;
        if (named) {
            try {
                alive = named.location.href !== "about:blank";
            } catch {
                // Cross-origin: the tab is still on signnow.com — it is the review.
                alive = true;
            }
        }
        if (named && alive) {
            signNowReviewTabRef.current = named;
            try {
                named.focus();
            } catch {
                /* already open */
            }
            return;
        }
        const envelopeId = currentReviewEnvelopeId();
        if (!envelopeId) {
            named?.close();
            toast.error("The SignNow review could not be found. Cancel the review and start it again.");
            return;
        }
        setIsReopeningSignNowTab(true);
        try {
            if (named) {
                try {
                    writeDocuSignLoadingTab(named.document);
                } catch {
                    /* ignore */
                }
            }
            const minted = await fetchDocuSignSenderViewUrl(
                envelopeId,
                mergeWithDefaultCcEmails(ccEmails, contractCcMergeOptions),
                buildDocuSignRolesForSync(),
            );
            const url = String(minted.url || "").trim();
            if (!url || isSignNowLoginWebappUrl(url)) {
                named?.close();
                toast.error(minted.error || "SignNow did not return a review link. Try again in a moment.");
                return;
            }
            signNowReviewEnvelopeIdRef.current = envelopeId;
            signNowCachedEmbedUrlRef.current = url;
            setSignNowEmbedUrl(url);
            setSignNowReviewVisible(true);
            openSignNowReviewTab(url, named);
        } finally {
            setIsReopeningSignNowTab(false);
        }
    }, [
        currentReviewEnvelopeId,
        fetchDocuSignSenderViewUrl,
        ccEmails,
        contractCcMergeOptions,
        buildDocuSignRolesForSync,
        openSignNowReviewTab,
    ]);

    /** "Cancel review" from the lock screen: drop the open review everywhere. */
    const cancelOpenSignNowReview = useCallback(() => {
        const envelopeId = currentReviewEnvelopeId();
        signNowForceFreshReviewRef.current = false;
        resetSignNowReviewUi({ keepCachedEmbed: false });
        setPersistedReviewEnvelopeId(null);
        if (envelopeId && isSignNowEnvelopeId(envelopeId)) {
            void axiosPost("/docusign/signnow-review-reset", { envelopeId }).catch(() => {
                /* The next Review mints a new link, which resets it too. */
            });
        }
    }, [currentReviewEnvelopeId, resetSignNowReviewUi]);

    // Modal open: restore an open or finished review from an earlier session / tab.
    useEffect(() => {
        if (!isOpen) {
            setPersistedReviewEnvelopeId(null);
            return;
        }
        if (!applicationIdForLookup) return;
        void syncPersistedSignNowReview({ advanceToSummary: true });
    }, [isOpen, applicationIdForLookup, syncPersistedSignNowReview]);

    // Returning to the CRM tab (from the SignNow tab or anywhere else).
    useEffect(() => {
        if (!isOpen) return;
        const onReturn = () => {
            if (document.visibilityState === "hidden") return;
            if (Date.now() - lastPersistedReviewSyncAtRef.current < 1500) return;
            void syncPersistedSignNowReview();
        };
        window.addEventListener("focus", onReturn);
        document.addEventListener("visibilitychange", onReturn);
        return () => {
            window.removeEventListener("focus", onReturn);
            document.removeEventListener("visibilitychange", onReturn);
        };
    }, [isOpen, syncPersistedSignNowReview]);

    // The review tab's completion page: only a real Finish marks the review done.
    useEffect(() => {
        if (!isOpen) return;
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (!isSignNowEmbeddedCompleteMessage(event.data)) return;
            // It already recorded the Finish on the server; this records it again
            // (idempotent) in case that request did not make it, then unlocks.
            void recordSignNowFinish();
        };
        window.addEventListener("message", onMessage);
        return () => {
            window.removeEventListener("message", onMessage);
        };
    }, [isOpen, recordSignNowFinish]);

    /** Locked while an Owner review is open (here or on the server) and not finished. */
    const signNowReviewLocked =
        isOpen &&
        isSignNowContractUiEnabled() &&
        !signNowReviewComplete &&
        !isSending &&
        !isSendingViaSendGrid &&
        Boolean(signNowEmbedUrl || persistedReviewEnvelopeId);

    /**
     * While locked, re-read the server state (CRM database only) so a Finish
     * recorded by the SignNow tab unlocks this screen even if its message was
     * lost. Previously this poll asked SignNow twice every 4 seconds through a
     * route SignNow does not have — API budget spent for no answer.
     */
    useEffect(() => {
        if (!signNowReviewLocked) return;
        let cancelled = false;
        let timer: number | undefined;
        const startedAt = Date.now();
        const nextDelay = () =>
            Date.now() - startedAt > SIGNNOW_REVIEW_POLL_BACKOFF_AFTER_MS
                ? SIGNNOW_REVIEW_POLL_SLOW_MS
                : SIGNNOW_REVIEW_POLL_MS;
        const poll = async () => {
            if (cancelled) return;
            await syncPersistedSignNowReview();
            if (!cancelled) timer = window.setTimeout(poll, nextDelay());
        };
        timer = window.setTimeout(poll, SIGNNOW_REVIEW_POLL_MS);
        return () => {
            cancelled = true;
            if (timer) window.clearTimeout(timer);
        };
    }, [signNowReviewLocked, syncPersistedSignNowReview]);

    /**
     * Auto-upload a single required document as soon as the user picks/drops it.
     * Mirrors Drive/Dropbox/DocuSign UX: selection triggers upload, progress
     * is shown inline, then the row flips to the uploaded preview/actions state.
     */
    const autoUploadDocumentFile = useCallback(
        async (key: RequiredDocumentKey, file: File) => {
            if (!file) return;

            if (effectiveContractId == null) {
                const msg = "Please select or generate a contract first.";
                setDocumentUploadMessage(msg);
                toast.error(msg);
                return;
            }

            const allowed = ["pdf", "jpg", "jpeg", "png"];
            const ext = (file.name.split(".").pop() || "").toLowerCase();
            if (!allowed.includes(ext)) {
                const msg = "Unsupported file. Please upload a PDF, JPG, or PNG.";
                setDocumentUploadMessage(msg);
                toast.error(msg);
                return;
            }

            const previewUrl = URL.createObjectURL(file);
            setDocumentUrls((u) => {
                const prevUrl = u[key];
                if (typeof prevUrl === "string" && prevUrl.startsWith("blob:")) {
                    try {
                        URL.revokeObjectURL(prevUrl);
                    } catch {
                        /* ignore */
                    }
                }
                return { ...u, [key]: previewUrl };
            });
            setPendingFileNameByKey((prev) => ({ ...prev, [key]: file.name }));
            setUploadProgressByKey((prev) => ({ ...prev, [key]: 0 }));
            setDocumentUploadMessage("");

            try {
                const uploadResult = await dispatch(
                    uploadContractDocuments({
                        contractId: effectiveContractId,
                        filesByType: { [key]: file },
                        onUploadProgress: (event) => {
                            const total = Number(event?.total || 0);
                            const loaded = Number(event?.loaded || 0);
                            const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
                            // Cap at 99 until the server response lands so the bar
                            // visibly completes only on success.
                            setUploadProgressByKey((prev) => ({
                                ...prev,
                                [key]: Math.min(99, Math.max(prev[key] ?? 0, pct)),
                            }));
                        },
                    }),
                ).unwrap();

                const kycExtractions = parseKycExtractionsFromUploadResponse(uploadResult);
                const extractionForKey = kycExtractions.find(
                    (e) =>
                        e.slot === key ||
                        e.documentType === key ||
                        (key === "voidedCheck" && e.documentType === "voidedCheck") ||
                        (key === "driverLicenseOwner2" &&
                            (e.slot === "driverLicenseOwner2" || e.ownerIndex === 2)) ||
                        (key === "driverLicense" &&
                            e.documentType === "driverLicense" &&
                            e.ownerIndex !== 2),
                );
                if (extractionForKey) {
                    if (extractionForKey.error) {
                        toast.warn(`Document scan: ${extractionForKey.error}`);
                    } else if (kycExtractionHasReadableFields(extractionForKey)) {
                        toast.info(
                            `${key === "voidedCheck" ? "Voided check" : "Driver's license"} scanned. Review extracted data on the application Documents tab.`,
                        );
                    } else {
                        toast.warn(
                            `${key === "voidedCheck" ? "Voided check" : "Driver's license"} uploaded, but no readable fields were found.`,
                        );
                    }
                }

                setUploadProgressByKey((prev) => ({ ...prev, [key]: 100 }));
                await dispatch(getUploadedContractDocuments(effectiveContractId));
                refreshApplicationDocumentsTab();

                setDocumentUrls((u) => {
                    const next = { ...u };
                    const blobUrl = next[key];
                    if (typeof blobUrl === "string" && blobUrl.startsWith("blob:")) {
                        try {
                            URL.revokeObjectURL(blobUrl);
                        } catch {
                            /* ignore */
                        }
                    }
                    delete next[key];
                    return next;
                });
                setPendingFileNameByKey((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                });
                setUploadProgressByKey((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                });
                setDocumentUploadMessage("Document uploaded successfully.");
            } catch (error: any) {
                setUploadProgressByKey((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                });
                setPendingFileNameByKey((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                });
                const msg = error?.message || "Failed to upload document.";
                setDocumentUploadMessage(msg);
                toast.error(msg);
            }
        },
        [dispatch, effectiveContractId, refreshApplicationDocumentsTab],
    );

    const autoUploadRequestedDocument = useCallback(
        async (requestDocId: string, file: File) => {
            if (!file || !requestDocId) return;

            if (!applicationMongoId) {
                toast.error("Application ID not found. Cannot upload requested document.");
                return;
            }

            const allowed = ["pdf", "jpg", "jpeg", "png"];
            const ext = (file.name.split(".").pop() || "").toLowerCase();
            if (!allowed.includes(ext)) {
                toast.error("Unsupported file. Please upload a PDF, JPG, or PNG.");
                return;
            }

            const taggedFile = new File(
                [file],
                `${requestDocId}__${file.name}`,
                { type: file.type },
            );

            try {
                await dispatch(
                    uploadApplicationDocuments({
                        id: applicationMongoId,
                        files: [taggedFile],
                    }),
                ).unwrap();

                toast.success(`${getRequestedDocumentLabel({ name: requestDocId })} uploaded.`);

                if (documentRequestLookupId) {
                    await dispatch(getDocumentRequestsByApplication(documentRequestLookupId));
                }
            } catch (error: unknown) {
                const msg =
                    typeof error === "string"
                        ? error
                        : (error as { message?: string })?.message || "Failed to upload document.";
                toast.error(msg);
                throw error;
            }
        },
        [applicationMongoId, dispatch, documentRequestLookupId],
    );

    const handleRemoveDocumentRequest = useCallback(
        async (requestDocId: string) => {
            if (!documentRequestLookupId) {
                toast.error("Application ID not found");
                return;
            }

            try {
                await dispatch(
                    removeDocumentRequest({
                        applicationId: documentRequestLookupId,
                        documentId: requestDocId,
                    }),
                ).unwrap();
                toast.success(
                    `${getRequestedDocumentLabel({ name: requestDocId })} request removed.`,
                );
                await dispatch(getDocumentRequestsByApplication(documentRequestLookupId));
            } catch (error: unknown) {
                const msg =
                    typeof error === "string"
                        ? error
                        : (error as { message?: string })?.message ||
                          "Failed to remove document request.";
                toast.error(msg);
                throw error;
            }
        },
        [dispatch, documentRequestLookupId],
    );

    const applicationFilesForDocumentRequests = useMemo(
        () =>
            Array.isArray((applicationData as { files?: unknown[] } | null)?.files)
                ? ((applicationData as { files: unknown[] }).files as Array<{
                      originalName?: string | null;
                      fileName?: string | null;
                      url?: string | null;
                      fileUrl?: string | null;
                      downloadUrl?: string | null;
                  }>)
                : [],
        [applicationData],
    );

    const canViewRequestedDocument = useCallback(
        (requestDocId: string) =>
            Boolean(
                findApplicationFileForDocumentRequest(
                    requestDocId,
                    applicationFilesForDocumentRequests,
                )?.url,
            ),
        [applicationFilesForDocumentRequests],
    );

    const handleViewRequestedDocument = useCallback(
        (requestDocId: string) => {
            const match = findApplicationFileForDocumentRequest(
                requestDocId,
                applicationFilesForDocumentRequests,
            );
            if (!match?.url) {
                setDocumentUploadMessage("No preview URL found for this document.");
                toast.error("No preview URL found for this document.");
                return;
            }
            setActivePreview(null);
            setUploadedPreviewUrl(match.url);
            setPdfRightPaneTab("template");
        },
        [applicationFilesForDocumentRequests],
    );

    const handlePreviewUploadedDocument = async (fileId: string) => {
        if (effectiveContractId == null || !fileId) return;
        try {
            const response = await dispatch(
                getUploadedContractDocumentById({ contractId: effectiveContractId, fileId }),
            ).unwrap();
            const file = (response as any)?.data ?? response;
            const url = String(file?.fileUrl || file?.downloadUrl || "").trim();
            if (!url) {
                setDocumentUploadMessage("No preview URL found for this document.");
                return;
            }
            setActivePreview(null);
            setUploadedPreviewUrl(url);
        } catch (error: any) {
            setDocumentUploadMessage(
                error?.message || "Failed to load uploaded document preview.",
            );
        }
    };

    const handleEditUploadedDocument = (fileId: string) => {
        if (effectiveContractId == null || !fileId) return;
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".pdf,.jpg,.jpeg,.png";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement)?.files?.[0];
            if (!file) return;
            try {
                setUpdatingUploadedFileId(fileId);
                await dispatch(
                    updateUploadedContractDocument({
                        contractId: effectiveContractId,
                        fileId,
                        file,
                    }),
                ).unwrap();
                setDocumentUploadMessage("Uploaded document updated successfully.");
                dispatch(getUploadedContractDocuments(effectiveContractId));
                refreshApplicationDocumentsTab();
            } catch (error: any) {
                setDocumentUploadMessage(
                    error?.message || "Failed to update uploaded document.",
                );
            } finally {
                setUpdatingUploadedFileId(null);
            }
        };
        input.click();
    };

    const handleDeleteUploadedDocument = async (fileId: string) => {
        if (effectiveContractId == null || !fileId) return;
        try {
            setDeletingUploadedFileId(fileId);
            await dispatch(
                deleteUploadedContractDocument({ contractId: effectiveContractId, fileId }),
            ).unwrap();
            if (uploadedPreviewUrl) {
                setUploadedPreviewUrl(null);
            }
            setDocumentUploadMessage("Uploaded document deleted successfully.");
            dispatch(getUploadedContractDocuments(effectiveContractId));
            refreshApplicationDocumentsTab();
        } catch (error: any) {
            setDocumentUploadMessage(
                error?.message || "Failed to delete uploaded document.",
            );
        } finally {
            setDeletingUploadedFileId(null);
        }
    };

    const fetchTemplateMappings = useCallback(async () => {
        if (effectiveContractId == null) {
            setTemplateMappings([]);
            return;
        }
        try {
            setLoadingTemplateMappings(true);
            const res = await axiosGet(
                `/contract/${effectiveContractId}/document-template-mappings`,
                { skipCache: true },
            );
            const rows = (res?.data?.data ?? res?.data ?? []) as ContractDocumentTemplateMappingRow[];
            setTemplateMappings(Array.isArray(rows) ? rows : []);
        } catch (error: any) {
            setTemplateMappings([]);
            setDocumentUploadMessage(error?.message || "Failed to load template mappings.");
        } finally {
            setLoadingTemplateMappings(false);
        }
    }, [effectiveContractId]);

    const lastDocuSignSyncAtRef = useRef(0);
    /** Last time CRM contract status changed (webhook or CRM refetch) — drives stale DocuSign fallback. */
    const lastCrmStatusChangeAtRef = useRef(Date.now());
    const contractWasSentRef = useRef(false);
    const prevContractStatusRef = useRef("");
    const pendingCcForSentRef = useRef<string[]>([]);
    /** Set when sync-envelope-status reports CC PDF was emailed (avoids spam, allows retry until success). */
    const ccEmailDeliveredRef = useRef(false);
    const loadPrefilledPdfRef = useRef(loadPrefilledPdfFromDocuSign);
    loadPrefilledPdfRef.current = loadPrefilledPdfFromDocuSign;
    const setPdfRightPaneTabRef = useRef(setPdfRightPaneTab);
    setPdfRightPaneTabRef.current = setPdfRightPaneTab;
    const contractModalWasOpenRef = useRef(false);
    const activeStepRef = useRef(activeStep);
    activeStepRef.current = activeStep;
    const sentAtRef = useRef(sentAt);
    sentAtRef.current = sentAt;
    const sentStepUnlockedRef = useRef(sentStepUnlocked);
    sentStepUnlockedRef.current = sentStepUnlocked;

    /**
     * The `sentAt` inferred from a contract row (not from a send made in this session).
     * Compared by identity so a fresh row that is no longer sent can undo only this one.
     */
    const hydratedSentAtRef = useRef<Date | null>(null);
    const hydrateSentAtFromContract = useCallback(
        (contract: Record<string, unknown> | null | undefined) => {
            if (sentAtRef.current) return;
            const docSentAt = pickContractEnvelopeDocument(contract)?.sentAt;
            const next = docSentAt ? new Date(String(docSentAt)) : new Date();
            hydratedSentAtRef.current = next;
            setSentAt(next);
        },
        [],
    );

    /**
     * Refresh contract row from CRM (webhook primary). DocuSign API sync only when forced
     * (manual Refresh) or when Connect looks stale.
     */
    const refreshContractSigningState = useCallback(
        async (
            silent?: boolean,
            options?: { syncDocuSign?: boolean; forceDocuSignSync?: boolean },
        ) => {
            const appId = applicationIdForLookup;
            const propId = Number(contractId);
            if (!silent) setSigningStatusRefreshing(true);

            const fetchContractRow = async (): Promise<Record<string, unknown> | null> => {
                let contract: unknown;
                if (appId) {
                    // `fresh`: this runs when the user comes back from the SignNow tab and
                    // replaces the per-addendum prefill state wholesale, so it must see the
                    // saved row — a cached pre-save copy is what emptied the addendums.
                    const res = await dispatch(
                        getByApplicationIdContract({ applicationId: appId, fresh: true }),
                    ).unwrap();
                    contract = (res as { data?: unknown })?.data ?? res;
                } else if (Number.isFinite(propId) && propId > 0) {
                    const res = await dispatch(getByIdContract(propId)).unwrap();
                    contract = (res as { data?: unknown })?.data ?? res;
                } else {
                    return null;
                }
                const c =
                    contract && typeof contract === "object"
                        ? (contract as Record<string, unknown>)
                        : null;
                if (c) {
                    setResolvedContract(c);
                    const id = Number(c.id);
                    if (Number.isFinite(id)) setResolvedContractId(id);
                    const stateVal =
                        pickUsStateForSelect(c.state) ||
                        resolveDealStateFromApplication(applicationDataRef.current);
                    if (stateVal && !userSelectedStateRef.current) {
                        setSelectedState(stateVal);
                    }
                    const rawFunder = String(c.funderName ?? "").trim();
                    if (!userSelectedFunderRef.current) {
                        const profile = findFunderProfile(
                            fundersRef.current,
                            rawFunder,
                            stateVal,
                        );
                        const funderName =
                            pickFunderForSelect(
                                rawFunder,
                                funderNamesForContractState(fundersRef.current, stateVal),
                            ) || rawFunder;
                        const resolvedProfile =
                            profile ??
                            findFunderProfile(fundersRef.current, funderName, stateVal);
                        setSelectedFunderProfileId(resolvedProfile?.id ?? "");
                        setSelectedFunder(resolvedProfile?.name ?? funderName);
                    }
                    setContractPrefillFromDb(
                        stripDocumentTemplateBlobFromPrefillOverrides(
                            normalizeContractPrefillOverrides(c.contractPrefillOverrides) ??
                                null,
                        ) ?? null,
                    );
                    setDocumentTemplatePrefillByMappingId(
                        parseDocumentTemplatePrefillByMappingId(c.contractPrefillOverrides),
                    );
                }
                return c;
            };

            try {
                let c = await fetchContractRow();
                if (!c) return;

                const envelopeForSync =
                    linkedEnvelopeIdRef.current ||
                    String(
                        (c as { application?: { document?: { envelopeId?: string } } })
                            ?.application?.document?.envelopeId ?? "",
                    ).trim() ||
                    null;
                const alreadySent =
                    sentStepUnlockedRef.current ||
                    isContractAlreadySent(c, sentAtRef.current);
                const onSentStep = activeStepRef.current === "sent";
                const wantsSync = options?.syncDocuSign === true;
                const contractStatus = String(c.status ?? "").trim().toUpperCase();
                const signingFinished =
                    contractStatus === "COMPLETED" ||
                    ["DECLINED", "REVOKED", "EXPIRED"].includes(contractStatus);
                const reviewingInSignNow = Boolean(
                    signNowEmbedUrlRef.current || signNowReviewCompleteRef.current,
                );
                const signNowProvider =
                    isSignNowContractUiEnabled() || isSignNowEnvelopeId(envelopeForSync);
                const webhookLooksStale =
                    reviewingInSignNow || signNowProvider
                        ? false
                        : shouldFallbackPollDocuSign({
                              force: options?.forceDocuSignSync === true,
                              signingFinished,
                              lastCrmStatusAtMs: lastCrmStatusChangeAtRef.current,
                              staleMs: DOCUSIGN_WEBHOOK_STALE_MS,
                          });
                const maySyncDocuSign =
                    !reviewingInSignNow &&
                    wantsSync &&
                    Boolean(envelopeForSync || appId) &&
                    !signingFinished &&
                    (signNowProvider
                        ? options?.forceDocuSignSync === true &&
                          isSignNowEnvelopeId(envelopeForSync)
                        : webhookLooksStale &&
                          (options?.forceDocuSignSync === true ||
                              awaitingDocuSignSendRef.current ||
                              (alreadySent && onSentStep) ||
                              (!alreadySent && Boolean(envelopeForSync))));

                if (maySyncDocuSign) {
                    const now = Date.now();
                    if (
                        options?.forceDocuSignSync ||
                        now - lastDocuSignSyncAtRef.current >= DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS
                    ) {
                        lastDocuSignSyncAtRef.current = now;
                        try {
                            const ccForSync = mergeWithDefaultCcEmails(
                                pendingCcForSentRef.current.length
                                    ? pendingCcForSentRef.current
                                    : ccEmailsRef.current,
                                { funderDefaultCcEmail: selectedFunderDefaultCcRef.current },
                            );
                            const syncRes = await axiosPost("/docusign/sync-envelope-status", {
                                ...(appId ? { applicationId: appId } : {}),
                                ...(envelopeForSync ? { envelopeId: envelopeForSync } : {}),
                                ccEmails: ccForSync,
                            });
                            const emailed = (
                                syncRes as {
                                    data?: { ccPrefilledEmail?: { emailed?: string[] } };
                                }
                            )?.data?.ccPrefilledEmail?.emailed;
                            if (emailed?.length) {
                                ccEmailDeliveredRef.current = true;
                                if (!silent) {
                                    toast.success(`CC copy emailed to: ${emailed.join(", ")}`);
                                }
                            } else if (
                                ccForSync.length &&
                                !silent &&
                                String(
                                    (
                                        syncRes as {
                                            data?: {
                                                docusignStatus?: string;
                                                ccPrefilledEmail?: {
                                                    skippedReason?: string;
                                                };
                                            };
                                        }
                                    )?.data?.docusignStatus ?? "",
                                ).toLowerCase() === "sent"
                            ) {
                                const reason = (
                                    syncRes as {
                                        data?: {
                                            ccPrefilledEmail?: { skippedReason?: string };
                                        };
                                    }
                                )?.data?.ccPrefilledEmail?.skippedReason;
                                if (reason === "smtp_not_configured") {
                                    toast.warning(
                                        "Contract sent in DocuSign, but CC email was not sent. Configure SENDGRID_API_KEY or SMTP on the server.",
                                        { autoClose: 10000 },
                                    );
                                }
                            }
                            c = (await fetchContractRow()) ?? c;
                            if (appId && isSignNowEnvelopeId(envelopeForSync)) {
                                refreshApplicationDetailFromServer(dispatch, String(appId), [
                                    numericApplicationId,
                                ]);
                            }
                            // Space fallback polls — don't call DocuSign every CRM tick once stale.
                            lastCrmStatusChangeAtRef.current = Date.now();
                        } catch (syncErr) {
                            lastCrmStatusChangeAtRef.current = Date.now();
                            if (!silent) {
                                console.warn("[DocuSign] sync-envelope-status failed:", syncErr);
                            }
                        }
                    }
                }

                const awaitingSignNowMerchantEmail = Boolean(
                    signNowEmbedUrlRef.current || signNowReviewCompleteRef.current,
                );
                /**
                 * A `sentAt` inferred from an older row (e.g. before a resend archived the
                 * envelope) short-circuits every "already sent" check, hiding Review in
                 * SignNow for good. Drop it once the fresh row shows nothing sent. A send
                 * made in this session sets its own `sentAt` and is never undone here.
                 */
                if (
                    !awaitingSignNowMerchantEmail &&
                    sentAtRef.current &&
                    sentAtRef.current === hydratedSentAtRef.current &&
                    !isContractAlreadySent(c, null)
                ) {
                    hydratedSentAtRef.current = null;
                    sentAtRef.current = null;
                    sentStepUnlockedRef.current = false;
                    contractWasSentRef.current = false;
                    setSentAt(null);
                    setSentStepUnlocked(false);
                }
                const nowSent = awaitingSignNowMerchantEmail
                    ? false
                    : sentStepUnlockedRef.current ||
                      isContractAlreadySent(c, sentAtRef.current);
                const statusUpper = String(c.status ?? "").trim().toUpperCase();
                const prevStatus = prevContractStatusRef.current;

                if (nowSent) {
                    awaitingDocuSignSendRef.current = false;
                }

                if (statusUpper && statusUpper !== prevStatus) {
                    lastCrmStatusChangeAtRef.current = Date.now();
                }

                if (nowSent && !contractWasSentRef.current) {
                    contractWasSentRef.current = true;
                    setSentStepUnlocked(true);
                    setSentAt(new Date());
                    const cc = mergeWithDefaultCcEmails(
                        pendingCcForSentRef.current.length
                            ? pendingCcForSentRef.current
                            : ccEmailsRef.current,
                        { funderDefaultCcEmail: selectedFunderDefaultCcRef.current },
                    );
                    setSentCcEmails(cc);
                    if (activeStepRef.current !== "sent") {
                        setActiveStep("sent");
                        didSuggestSentTabThisOpenRef.current = true;
                    }
                    setPdfRightPaneTabRef.current("docusign");
                    prefilledPdfCachedForEnvelopeRef.current = null;
                    prefilledBoldSignPdfUrlRef.current = null;
                    const signNowEnvelope = isSignNowEnvelopeId(
                        String(
                            linkedEnvelopeIdRef.current ||
                                sessionEnvelopeIdRef.current ||
                                "",
                        ).trim(),
                    );
                    void loadPrefilledPdfRef.current(undefined, { maxAttempts: 1 });
                    if (!silent) {
                        toast.success(
                            isSignNowContractUiEnabled() || signNowEnvelope
                                ? "Contract sent via SignNow. The merchant will get the signing email."
                                : "Contract sent in DocuSign. Step 4 shows signing status and the envelope PDF.",
                        );
                    }
                    if (!ccEmailDeliveredRef.current && cc.length > 0) {
                        // One recovery sync after CRM sees sent — webhook primary for status.
                        void refreshContractSigningState(true, {
                            syncDocuSign: !(
                                isSignNowContractUiEnabled() || signNowEnvelope
                            ),
                            forceDocuSignSync: !(
                                isSignNowContractUiEnabled() || signNowEnvelope
                            ),
                        });
                    }
                }

                if (
                    statusUpper === "COMPLETED" &&
                    prevStatus !== "COMPLETED" &&
                    activeStepRef.current === "sent"
                ) {
                    prefilledPdfCachedForEnvelopeRef.current = null;
                    prefilledBoldSignPdfUrlRef.current = null;
                    void loadPrefilledPdfRef.current(undefined, { maxAttempts: 1 });
                    if (!silent) {
                        toast.success("Contract fully signed. PDF updated with signatures.");
                    }
                }

                prevContractStatusRef.current = statusUpper;
                setLastSigningStatusSyncAt(new Date());
            } catch {
                /* ignore */
            } finally {
                if (!silent) setSigningStatusRefreshing(false);
            }
        },
        [applicationIdForLookup, contractId, dispatch, funders],
    );
    refreshContractSigningStateRef.current = refreshContractSigningState;

    /** Reset sent-step session only when switching to a different contract row. */
    useEffect(() => {
        const parsed = Number(contractId);
        const nextId =
            contractId != null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        const prevId = prevContractIdForSentRef.current;
        prevContractIdForSentRef.current = nextId;
        if (prevId === undefined || prevId === nextId) return;
        awaitingDocuSignSendRef.current = false;
        setSentStepUnlocked(false);
        setSentAt(null);
        contractWasSentRef.current = false;
    }, [contractId]);

    /** Keep step 4 in sync when contract row refresh shows Sent (e.g. Contracts Generated table). */
    useEffect(() => {
        if (!isOpen) return;
        const awaitingSignNowMerchantEmail = Boolean(
            signNowEmbedUrl || signNowReviewComplete,
        );
        if (awaitingSignNowMerchantEmail) return;
        if (!isContractAlreadySent(resolvedContract, sentAtRef.current)) return;
        if (!sentStepUnlockedRef.current) {
            setSentStepUnlocked(true);
            hydrateSentAtFromContract(resolvedContract);
        }
        contractWasSentRef.current = true;
    }, [
        isOpen,
        resolvedContract,
        hydrateSentAtFromContract,
        signNowEmbedUrl,
        signNowReviewComplete,
    ]);

    /** Once per modal open — CRM refresh only (webhook already wrote DB); DocuSign poll only if stale. */
    useEffect(() => {
        if (!isOpen) {
            contractModalWasOpenRef.current = false;
            awaitingDocuSignSendRef.current = false;
            prevContractStatusRef.current = "";
            pendingCcForSentRef.current = [];
            ccEmailDeliveredRef.current = false;
            /**
             * Every trace of "this session sent something" goes on close. It used to be held
             * back by the sticky step-4 unlock, which nothing ever cleared, so `sentAt`
             * outlived the send it belonged to. `isContractAlreadySent` short-circuits on a
             * session `sentAt`, so the next opening judged the deal sent no matter what the
             * contract row said — after a resend archived the envelope the wizard offered no
             * Review in SignNow at all, and a second resend was impossible.
             *
             * Nothing is lost: the open branch below re-derives the sent state from the
             * contract row, which is where a real send is recorded.
             */
            contractWasSentRef.current = false;
            setSentAt(null);
            setSentStepUnlocked(false);
            setSessionEnvelopeId(null);
            setSentCcEmails([]);
            return;
        }
        if (contractModalWasOpenRef.current) return;
        contractModalWasOpenRef.current = true;
        lastCrmStatusChangeAtRef.current = Date.now();
        const awaitingSignNowMerchantEmail = Boolean(
            signNowEmbedUrlRef.current || signNowReviewCompleteRef.current,
        );
        // The contract row alone decides this on a fresh open — see the close branch above.
        const alreadySent = awaitingSignNowMerchantEmail
            ? false
            : isContractAlreadySent(resolvedContract, null);
        if (alreadySent) {
            setSentStepUnlocked(true);
            hydrateSentAtFromContract(resolvedContract);
        } else {
            setSentStepUnlocked(false);
            setSentAt(null);
        }
        contractWasSentRef.current = alreadySent;
        prevContractStatusRef.current = String(resolvedContract?.status ?? "")
            .trim()
            .toUpperCase();
        void refreshContractSigningState(true, {
            syncDocuSign: !isSignNowContractUiEnabled(),
            forceDocuSignSync: false,
        });
    }, [isOpen, refreshContractSigningState, resolvedContract, hydrateSentAtFromContract]);

    const envelopeIdForSigningPoll = useMemo(
        () =>
            String(
                linkedEnvelopeId ||
                    sessionEnvelopeId ||
                    pickContractEnvelopeDocument(resolvedContract)?.envelopeId ||
                    "",
            ).trim(),
        [linkedEnvelopeId, sessionEnvelopeId, resolvedContract],
    );

    /**
     * Prefer webhooks + CRM refetch. Interval only refreshes CRM;
     * DocuSign API sync is skipped when SignNow is the contract provider.
     */
    useEffect(() => {
        if (!isOpen || signingFinishedForPoll || !envelopeIdForSigningPoll) return;
        if (isSignNowContractUiEnabled() || isSignNowEnvelopeId(envelopeIdForSigningPoll)) {
            return;
        }

        const pollId = window.setInterval(() => {
            const stale = shouldFallbackPollDocuSign({
                force: false,
                signingFinished: signingFinishedForPoll,
                lastCrmStatusAtMs: lastCrmStatusChangeAtRef.current,
                staleMs: DOCUSIGN_WEBHOOK_STALE_MS,
            });
            void refreshContractSigningState(true, {
                syncDocuSign: stale,
                forceDocuSignSync: false,
            });
        }, DOCUSIGN_CRM_STATUS_POLL_MS);
        return () => window.clearInterval(pollId);
    }, [
        isOpen,
        signingFinishedForPoll,
        envelopeIdForSigningPoll,
        refreshContractSigningState,
    ]);

    /** When user returns from DocuSign, refresh CRM immediately; skip DocuSign API for SignNow. */
    useEffect(() => {
        if (!isOpen || !envelopeIdForSigningPoll) return;
        const onFocus = () => {
            const signNowProvider =
                isSignNowContractUiEnabled() ||
                isSignNowEnvelopeId(envelopeIdForSigningPoll);
            const stale = signNowProvider
                ? false
                : shouldFallbackPollDocuSign({
                      force: false,
                      signingFinished: signingFinishedForPoll,
                      lastCrmStatusAtMs: lastCrmStatusChangeAtRef.current,
                      staleMs: DOCUSIGN_WEBHOOK_STALE_MS,
                  });
            void refreshContractSigningState(true, {
                syncDocuSign: signNowProvider
                    ? false
                    : stale || awaitingDocuSignSendRef.current,
                forceDocuSignSync: false,
            });
        };
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [isOpen, envelopeIdForSigningPoll, refreshContractSigningState, signingFinishedForPoll]);

    /** Instant UI when Connect webhook updates status (Socket.IO). */
    useContractSigningStatusRealtime(applicationIdForLookup, (payload) => {
        lastCrmStatusChangeAtRef.current = Date.now();
        const pendingEnvelopeId = pendingPortalSendEnvelopeRef.current;
        if (
            pendingEnvelopeId &&
            String(payload?.status || "").toLowerCase() === "sent" &&
            String(payload?.envelopeId || "").trim() === pendingEnvelopeId
        ) {
            // Background portal send finished: load the sent row, then its PDF.
            pendingPortalSendEnvelopeRef.current = null;
            invalidateDocuSignPdfCache();
            void refreshContractSigningStateRef
                .current(true, { syncDocuSign: false, forceDocuSignSync: false })
                .then(() => loadPrefilledPdfRef.current(undefined, { maxAttempts: 2 }));
            return;
        }
        void refreshContractSigningStateRef.current(true, { syncDocuSign: false });
    });

    const invalidateDocuSignPdfCache = useCallback(() => {
        prefilledPdfCachedForEnvelopeRef.current = null;
        prefilledBoldSignPdfUrlRef.current = null;
    }, []);

    const buildDocuSignPrefillFieldsPayload = useCallback((): ContractPrefillField[] => {
        /** Full field ids (not Deal Review display dedupe) so every DocuSign data label gets the updated value. */
        const base: ContractPrefillField[] = dealPrefillFieldsForDocuSign
            .map((f) => ({
                id: f.id,
                value: String(f.value ?? "").trim(),
                label: f.label,
            }))
            .filter((f) => f.id && f.value);

        const addendumRefs = resolveAddendumTemplateIdsForDocuSignMerge();
        const disclosureRef = resolveDisclosureTemplateRefForDocuSignMerge();
        const mergedLayoutKeys = [
            ...addendumRefs.filter(
                (ref) => isPlatformLayoutKey(ref) || ref.startsWith("funder_"),
            ),
            ...(disclosureRef && isSignNowDisclosureLayoutKey(disclosureRef)
                ? [disclosureRef]
                : []),
        ];
        const mergedTemplateIds = [
            ...addendumRefs.filter((ref) => !isPlatformLayoutKey(ref) && !ref.startsWith("funder_")),
            // Prefer layout keys for funder uploads; still pass layout-key refs as template ids when needed.
            ...addendumRefs.filter((ref) => ref.startsWith("funder_")),
            ...(disclosureRef ? [disclosureRef] : []),
        ];
        // Deduplicate while preserving order
        const seen = new Set<string>();
        const uniqueMergedTemplateIds = mergedTemplateIds.filter((id) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });

        const effectiveOverrides = mergeContractPrefillOverrideLayers(
            contractPrefillOverrides,
            contractPrefillLoaded ? contractPrefillFromDb : null,
        );
        const mainPrefillForTemplates =
            Object.keys(effectiveOverrides).length > 0 ? effectiveOverrides : null;
        const contractPrefillOverridesRaw = {
            ...(resolvedContract != null &&
            typeof resolvedContract.contractPrefillOverrides === "object" &&
            resolvedContract.contractPrefillOverrides != null &&
            !Array.isArray(resolvedContract.contractPrefillOverrides)
                ? (resolvedContract.contractPrefillOverrides as Record<string, unknown>)
                : {}),
            ...(mainPrefillForTemplates ?? {}),
            [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: documentTemplatePrefillByMappingId,
        };

        let payload = applyDocumentTemplateMappingPrefillOverrides({
            prefillFieldsPayload: base,
            mergedTemplateIds: uniqueMergedTemplateIds,
            mergedLayoutKeys,
            templateMappingRows: templateMappings,
            contractPrefillOverridesRaw,
            contract: resolvedContract as Record<string, unknown> | null,
            application: applicationData as unknown as Record<string, unknown> | null,
            agreementDate: formatDateMonthDayYear(new Date()),
            mainPrefillOverrides: mainPrefillForTemplates,
            bankDetail: contractPrefillRecords.bankDetail ?? null,
            ach: contractPrefillRecords.ach ?? null,
            bankAnalyses: disclosureCalcBankAnalyses,
        });

        const mappingId = linkedDisclosureMapping?.id;
        const fromState =
            mappingId != null ? documentTemplatePrefillByMappingId[mappingId] ?? null : null;
        const fromContract =
            mappingId != null
                ? parseDocumentTemplatePrefillByMappingId(
                      resolvedContract?.contractPrefillOverrides,
                  )[mappingId] ?? null
                : null;
        const savedOverrides =
            fromState && Object.keys(fromState).some((k) => String(fromState[k] ?? "").trim())
                ? fromState
                : fromContract;

        const disclosureFields = buildExpandedDisclosurePrefillFieldsForMapping({
            mappingRow: linkedDisclosureMapping,
            savedOverridesForMapping: savedOverrides,
            contract: resolvedContract as Record<string, unknown> | null,
            application: applicationData as unknown as Record<string, unknown> | null,
            agreementDate: formatDateMonthDayYear(new Date()),
            mainPrefillOverrides: mainPrefillForTemplates,
            bankDetail: contractPrefillRecords.bankDetail ?? null,
            ach: contractPrefillRecords.ach ?? null,
            bankAnalyses: disclosureCalcBankAnalyses,
        });

        let mergedPayload = mergeExpandedDisclosurePrefillIntoPayload(payload, disclosureFields);
        mergedPayload = mergeSignNowSupplementalPrefillFallback({
            payload: mergedPayload,
            supplementalRefs: [
                ...addendumRefs,
                ...(disclosureRef ? [disclosureRef] : []),
            ],
            contract: resolvedContract as Record<string, unknown> | null,
            application: applicationData as unknown as Record<string, unknown> | null,
            agreementDate: formatDateMonthDayYear(new Date()),
            mainPrefillOverrides: mainPrefillForTemplates,
            bankDetail: contractPrefillRecords.bankDetail ?? null,
            ach: contractPrefillRecords.ach ?? null,
            bankAnalyses: disclosureCalcBankAnalyses,
            contractPrefillOverridesRaw,
            templateMappingRows: templateMappings,
        });

        // Same as ContractTab send: selected funder wins for addendum tabs (Flex / BT / Case Takeover).
        // Disclosure merge otherwise forces platform funder name onto shared `funder_name`.
        const funderPlainName =
            formatFunderSelectLabel(selectedFunderProfile ?? undefined) ||
            String(selectedFunder || "").trim();
        applyFunderDisclosureContactPrefill(mergedPayload, selectedFunderProfile, {
            funderDisplayName: funderPlainName,
        });
        const funderNameWithDealPrefix = formatFunderNameWithDealIdPrefix(
            selectedFunderProfile?.name ?? selectedFunder,
            selectedFunderProfile?.dealIdPrefix,
            selectedFunderProfile?.displayName,
        );
        if (funderNameWithDealPrefix) {
            const existing = mergedPayload.find((f) => f.id === "funder_name_with_deal_prefix");
            if (existing) {
                existing.value = funderNameWithDealPrefix;
            } else {
                mergedPayload.push({
                    id: "funder_name_with_deal_prefix",
                    label: "Funder name (Deal ID prefix)",
                    value: funderNameWithDealPrefix,
                });
            }
        }
        const addendumKey = addendumRefs.join(" ").trim().toLowerCase();
        if (funderPlainName && /case_takeover/i.test(addendumKey)) {
            const existingScoped = mergedPayload.find(
                (f) => f.id === "case_takeover_addendum_funder_name",
            );
            if (existingScoped) {
                existingScoped.value = funderPlainName;
            } else {
                mergedPayload.push({
                    id: "case_takeover_addendum_funder_name",
                    label: "Funder Name",
                    value: funderPlainName,
                });
            }
            const existingShared = mergedPayload.find((f) => f.id === "funder_name");
            if (existingShared) {
                existingShared.value = funderPlainName;
            } else {
                mergedPayload.push({
                    id: "funder_name",
                    label: "Funder name",
                    value: funderPlainName,
                });
            }
        }

        const firstOwner = contractPrefillRecords.owners?.[0] as
            | Record<string, unknown>
            | undefined;
        const secondOwner = contractPrefillRecords.owners?.[1] as
            | Record<string, unknown>
            | undefined;
        const primaryOwnerName =
            resolveOwnerRowFullName(firstOwner) ||
            String(
                dealPrefillFieldsForDocuSign.find((f) => f.id === "owner1_guarantor_name")
                    ?.value || "",
            ).trim();
        mergedPayload = applyPrimaryGuarantorNamesToPrefillFields(
            mergedPayload,
            primaryOwnerName,
            {
                primarySs: String(firstOwner?.ssnNumber ?? firstOwner?.ssn ?? "").trim(),
                primaryDriverLicense: String(
                    firstOwner?.driverLicenseNumber ?? firstOwner?.driverLicense ?? "",
                ).trim(),
            },
        );
        if (activeOwnerCountForPrefill >= 2) {
            const signerRoles = buildDocuSignRolesForSync();
            const secondOwnerName =
                resolveSecondOwnerSignerName(
                    signerRoles,
                    activeOwnerCountForPrefill,
                    contractPrefillRecords.owners ?? null,
                ) || resolveOwnerRowFullName(secondOwner);
            mergedPayload = applySecondOwnerNameToPrefillFields(mergedPayload, {
                ownerCount: activeOwnerCountForPrefill,
                secondOwnerName,
                secondOwnerSs: String(secondOwner?.ssnNumber ?? secondOwner?.ssn ?? "").trim(),
                secondOwnerDriverLicense: String(
                    secondOwner?.driverLicenseNumber ?? secondOwner?.driverLicense ?? "",
                ).trim(),
                secondOwnerEmail: String(secondOwner?.email ?? secondOwner?.ownerEmail ?? "").trim(),
                secondOwnerPhone: String(
                    secondOwner?.mobileNumber ?? secondOwner?.phone ?? secondOwner?.mobile ?? "",
                ).trim(),
                secondOwnerAddress: [
                    String(secondOwner?.address1 ?? (typeof secondOwner?.address === "string" ? secondOwner.address : "")).trim(),
                    String(secondOwner?.city ?? "").trim(),
                    String(secondOwner?.state ?? "").trim(),
                    String(secondOwner?.zip ?? secondOwner?.zipCode ?? "").trim(),
                ].filter(Boolean).join(", "),
                secondOwnerTitle: "OWNER",
            });
        }

        const exhibitCJson = serializeExhibitCEntities(
            mergeExhibitCEntitiesForSignNowSend({
                rawOverrides: contractPrefillOverridesRaw,
                mappingRows: templateMappings,
            }),
        );
        if (exhibitCJson) {
            const existingEntities = mergedPayload.find((f) => f.id === EXHIBIT_C_ENTITIES_PREFILL_KEY);
            if (existingEntities) {
                existingEntities.value = exhibitCJson;
            } else {
                mergedPayload.push({
                    id: EXHIBIT_C_ENTITIES_PREFILL_KEY,
                    label: "Exhibit C entities",
                    value: exhibitCJson,
                });
            }
        }

        const dealBusinessName = resolveContractBusinessLegalNameForPrefill(
            (resolvedContract as Record<string, unknown>) ?? {},
            applicationData,
        );
        if (dealBusinessName) {
            for (const id of [
                "client_legal_name",
                "client_legal_name_p1",
                "legal_name",
                "business_legal_name",
                "merchant_legal_name",
                "security_business_name",
            ] as const) {
                const existing = mergedPayload.find((f) => f.id === id);
                if (existing) existing.value = dealBusinessName;
                else {
                    mergedPayload.push({
                        id,
                        label: id,
                        value: dealBusinessName,
                    });
                }
            }
        }

        const todayPrefillDate = `${String(new Date().getMonth() + 1).padStart(2, "0")}/${String(new Date().getDate()).padStart(2, "0")}/${new Date().getFullYear()}`;
        for (const id of [
            "agreement_date",
            "agreement_date_p1",
            "signature_date",
            "signature_date2",
            "signature1_date",
            "signature2_date",
            "disclosure_date",
            "disclosure_date2",
            "remittance_start_date",
        ] as const) {
            const existing = mergedPayload.find((f) => f.id === id);
            if (existing) existing.value = todayPrefillDate;
            else {
                mergedPayload.push({
                    id,
                    label: id,
                    value: todayPrefillDate,
                });
            }
        }
        for (const field of mergedPayload) {
            const id = String(field.id ?? "").toLowerCase();
            if (id.includes("previous")) continue;
            if (
                /(agreement_date|signature_date|disclosure_date|signature1_date|signature2_date|_dated)/.test(
                    id,
                )
            ) {
                field.value = todayPrefillDate;
            }
        }

        return uppercaseContractDocumentPrefillFields(
            applyTexasContractUsdMoneyToPrefillFields(
                clearParty2PrefillFieldPayload(
                    mergedPayload,
                    activeOwnerCountForPrefill,
                ),
                {
                    funderName:
                        String(selectedFunderProfile?.name ?? "").trim() ||
                        String(selectedFunder || "").trim() ||
                        formatFunderSelectLabel(selectedFunderProfile ?? undefined) ||
                        String((resolvedContract as { funderName?: unknown })?.funderName ?? "").trim(),
                    state:
                        String(selectedState || "").trim() ||
                        String((resolvedContract as { state?: unknown })?.state ?? "").trim(),
                    layoutKey: selectedFunderProfile
                        ? resolveLayoutKeyForProfile(selectedFunderProfile)
                        : "",
                },
            ),
        );
    }, [
        dealPrefillFieldsForDocuSign,
        activeOwnerCountForPrefill,
        resolveAddendumTemplateIdForDocuSignMerge,
        resolveDisclosureTemplateRefForDocuSignMerge,
        contractPrefillOverrides,
        contractPrefillLoaded,
        contractPrefillFromDb,
        resolvedContract,
        documentTemplatePrefillByMappingId,
        templateMappings,
        applicationData,
        contractPrefillRecords.bankDetail,
        contractPrefillRecords.owners,
        linkedDisclosureMapping,
        buildDocuSignRolesForSync,
        selectedFunder,
        selectedFunderProfile,
        selectedState,
        resolveLayoutKeyForProfile,
        disclosureCalcBankAnalyses,
    ]);

    /**
     * Kept pointing at the current render's builder so a caller that awaited the CRM
     * loads builds its payload from the data that arrived while it waited, rather than
     * from the closure it captured when the button was clicked.
     */
    buildPrefillFieldsPayloadRef.current = buildDocuSignPrefillFieldsPayload;
    includeWireFeeForSendRef.current = mergeContractPrefillOverrideLayers(
        contractPrefillOverrides,
        contractPrefillLoaded ? contractPrefillFromDb : null,
    ).includeWireFee;

    const syncPrefillToDraftEnvelope = useCallback(
        async (options?: { envelopeId?: string | null }) => {
            const envelopeId = String(
                options?.envelopeId ||
                    sessionEnvelopeIdRef.current ||
                    linkedEnvelopeIdRef.current ||
                    sessionEnvelopeId ||
                    linkedEnvelopeId ||
                    "",
            ).trim();
            if (!envelopeId) return;
            if (isSignNowContractUiEnabled() || isSignNowEnvelopeId(envelopeId)) return;
            const fields = buildDocuSignPrefillFieldsPayload();
            if (!fields.length) return;
            try {
                const result = await patchDocuSignPrefillFields(envelopeId, fields);
                docuSignPrefillSyncToast(result, { hasDraftEnvelope: true });
                draftPreparedPrefillFingerprintRef.current = prefillDraftFingerprint;
                lastPrefillSyncFailureToastKeyRef.current = null;
                invalidateDocuSignPdfCache();
                void loadPrefilledPdfFromDocuSign(envelopeId, {
                    manageLoading: false,
                    maxAttempts: 1,
                });
            } catch (err) {
                console.warn("[DocuSign] prefill sync to draft envelope failed:", err);
                // Still mark this fingerprint handled so the auto-sync effect does not
                // re-fire (and toast) on every callback identity change.
                draftPreparedPrefillFingerprintRef.current = prefillDraftFingerprint;
                const toastKey = `${envelopeId}:${prefillDraftFingerprint}`;
                if (lastPrefillSyncFailureToastKeyRef.current !== toastKey) {
                    lastPrefillSyncFailureToastKeyRef.current = toastKey;
                    toast.warning(
                        "Prefill saved in CRM, but the DocuSign draft could not be updated. Use Review & send to refresh the draft.",
                    );
                }
            }
        },
        [
            sessionEnvelopeId,
            linkedEnvelopeId,
            buildDocuSignPrefillFieldsPayload,
            prefillDraftFingerprint,
            invalidateDocuSignPdfCache,
            loadPrefilledPdfFromDocuSign,
        ],
    );

    const syncPrefillToDraftEnvelopeRef = useRef(syncPrefillToDraftEnvelope);
    syncPrefillToDraftEnvelopeRef.current = syncPrefillToDraftEnvelope;

    /**
     * After Deal Review / Edit Prefill saves, React state is fresh here — patch the open
     * DocuSign draft in place so Review & open and the PDF preview show the new values.
     */
    useEffect(() => {
        const prepared = draftPreparedPrefillFingerprintRef.current;
        if (prepared == null || prepared === prefillDraftFingerprint) return;
        const eid = String(
            sessionEnvelopeIdRef.current || linkedEnvelopeIdRef.current || "",
        ).trim();
        if (!eid) {
            draftPreparedPrefillFingerprintRef.current = null;
            return;
        }
        if (isSignNowContractUiEnabled()) {
            // SignNow cannot patch an already-reviewed draft in place. Drop the
            // cached embed so the next Review re-prefills instead of reopening stale fields.
            signNowCachedEmbedUrlRef.current = null;
            setSignNowEmbedUrl(null);
            setSignNowReviewVisible(false);
            closeSignNowReviewTab();
            return;
        }
        // Claim before the async call so effect re-runs from unstable callback deps
        // cannot stack the same sync + toast while a request is in flight / failed.
        draftPreparedPrefillFingerprintRef.current = prefillDraftFingerprint;
        void syncPrefillToDraftEnvelopeRef.current({ envelopeId: eid });
    }, [prefillDraftFingerprint, closeSignNowReviewTab]);

    const applyDisclosureCalculation = useCallback(
        async (args: {
            inputs: import("./contractdata/disclosureAprCalculator").DisclosureCalculatorInputs;
            metrics: import("./contractdata/disclosureAprCalculator").DisclosureCalculatorResult;
        }) => {
            const mappingId = linkedDisclosureMapping?.id;
            const cid = effectiveContractId;
            if (!mappingId || cid == null || !Number.isFinite(cid)) {
                toast.error("Link a state disclosure before applying calculated values.");
                return;
            }

            if (
                args.metrics.isRefinance &&
                (!(args.metrics.previousRefiBalance ?? 0) || !args.metrics.previousDealDate)
            ) {
                toast.error(
                    "Cannot apply California/REFI disclosure calculation: Previous Deal Date and REFI balance are required.",
                );
                return;
            }

            const fieldOverrides = mapDisclosureMetricsToEditorFieldOverrides(args.metrics, {
                merchantName:
                    args.inputs.merchantName ||
                    getApplicationPrimaryRecipientName(applicationData) ||
                    String(
                        resolvedContract?.legalName ??
                            resolvedContract?.clientName ??
                            "",
                    ).trim() ||
                    undefined,
                signatureDate: args.inputs.disbursementDate,
                state: args.inputs.state,
                inputs: args.inputs,
            });

            const priorBlob = { ...documentTemplatePrefillByMappingId };
            priorBlob[mappingId] = fieldOverrides;

            const existingOverrides =
                resolvedContract != null &&
                typeof resolvedContract.contractPrefillOverrides === "object" &&
                resolvedContract.contractPrefillOverrides != null &&
                !Array.isArray(resolvedContract.contractPrefillOverrides)
                    ? {
                          ...(resolvedContract.contractPrefillOverrides as Record<string, unknown>),
                      }
                    : {};

            const nextContractPrefillOverrides: Record<string, unknown> = {
                ...existingOverrides,
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: priorBlob,
                estimatedAnnualPercentageRate: String(args.metrics.estimatedAnnualPercentageRate),
                [DISCLOSURE_MONTHLY_REVENUES_KEY]: args.inputs.monthlyRevenues,
            };

            setSavingDisclosureCalculation(true);
            try {
                const result = await dispatch(
                    updateContract({
                        id: cid,
                        data: { contractPrefillOverrides: nextContractPrefillOverrides },
                    }),
                ).unwrap();
                const payload = (result as { data?: unknown })?.data ?? result;
                const fullSaved =
                    (payload as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides ?? nextContractPrefillOverrides;
                setDocumentTemplatePrefillByMappingId(
                    parseDocumentTemplatePrefillByMappingId(fullSaved),
                );
                setResolvedContract((prev) =>
                    prev ? { ...prev, contractPrefillOverrides: fullSaved ?? null } : prev,
                );
                toast.success("Disclosure calculation applied.");
                setDisclosureCalcModalOpen(false);
            } catch (err: unknown) {
                const msg =
                    typeof err === "string"
                        ? err
                        : String(
                              (err as { message?: string })?.message ||
                                  "Failed to save disclosure calculation.",
                          );
                toast.error(msg);
            } finally {
                setSavingDisclosureCalculation(false);
            }
        },
        [
            linkedDisclosureMapping?.id,
            effectiveContractId,
            documentTemplatePrefillByMappingId,
            resolvedContract,
            applicationData,
            dispatch,
        ],
    );

    /**
     * Saves the disclosure calculator's merchant monthly revenue on its own, the moment a
     * month is edited or removed, so it is there the next time the calculator opens and
     * survives "Regenerate Contract" (the backend keeps the key through both).
     */
    const saveDisclosureMonthlyRevenues = useCallback(
        async (revenues: number[]): Promise<boolean> => {
            const cid = effectiveContractId;
            if (cid == null || !Number.isFinite(cid)) {
                toast.error("Open a contract record before saving monthly revenue.");
                return false;
            }
            const existingOverrides =
                resolvedContract != null &&
                typeof resolvedContract.contractPrefillOverrides === "object" &&
                resolvedContract.contractPrefillOverrides != null &&
                !Array.isArray(resolvedContract.contractPrefillOverrides)
                    ? {
                          ...(resolvedContract.contractPrefillOverrides as Record<string, unknown>),
                      }
                    : {};
            const nextContractPrefillOverrides: Record<string, unknown> = {
                ...existingOverrides,
                [DISCLOSURE_MONTHLY_REVENUES_KEY]: revenues,
            };
            try {
                const result = await dispatch(
                    updateContract({
                        id: cid,
                        data: { contractPrefillOverrides: nextContractPrefillOverrides },
                    }),
                ).unwrap();
                const payload = (result as { data?: unknown })?.data ?? result;
                const fullSaved =
                    (payload as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides ?? nextContractPrefillOverrides;
                setResolvedContract((prev) =>
                    prev ? { ...prev, contractPrefillOverrides: fullSaved ?? null } : prev,
                );
                return true;
            } catch (err: unknown) {
                const msg =
                    typeof err === "string"
                        ? err
                        : String(
                              (err as { message?: string })?.message ||
                                  "Failed to save monthly revenue.",
                          );
                toast.error(msg);
                return false;
            }
        },
        [effectiveContractId, resolvedContract, dispatch],
    );

    const applySpaCalculation = useCallback(
        async (spa: string) => {
            setSavingSpaCalculation(true);
            try {
                const result = await persistCalculatedPurchasePercent({
                    dispatch,
                    contractId: effectiveContractId,
                    spa,
                    persistedPrefillOverrides: contractPrefillLoaded ? contractPrefillFromDb : null,
                    additionalContractPrefillJson: {
                        [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]:
                            documentTemplatePrefillByMappingId,
                    },
                });
                if (!result.saved || !result.mainSaved) {
                    toast.warn(
                        "SPA calculated but could not save. Open a contract record and try again.",
                    );
                    return;
                }
                const main = result.mainSaved;
                setContractPrefillFromDb(main);
                setResolvedContract((prev) =>
                    prev
                        ? {
                              ...prev,
                              ...contractPrefillToContractColumnUpdate(main),
                              contractPrefillOverrides:
                                  result.fullSaved != null
                                      ? {
                                            ...(typeof prev.contractPrefillOverrides === "object" &&
                                            prev.contractPrefillOverrides != null &&
                                            !Array.isArray(prev.contractPrefillOverrides)
                                                ? (prev.contractPrefillOverrides as Record<
                                                      string,
                                                      unknown
                                                  >)
                                                : {}),
                                            ...result.fullSaved,
                                        }
                                      : prev.contractPrefillOverrides,
                          }
                        : prev,
                );
                toast.success(`Specified percentage calculated and saved: ${spa}%`);
                setSpaCalcModalOpen(false);
            } catch (err: unknown) {
                const msg =
                    typeof err === "string"
                        ? err
                        : String(
                              (err as { message?: string })?.message ||
                                  "Failed to save specified percentage.",
                          );
                toast.error(msg);
                throw err;
            } finally {
                setSavingSpaCalculation(false);
            }
        },
        [
            dispatch,
            effectiveContractId,
            contractPrefillLoaded,
            contractPrefillFromDb,
            documentTemplatePrefillByMappingId,
        ],
    );

    const forceReloadDocuSignPdfPreview = useCallback(() => {
        invalidateDocuSignPdfCache();
        if (pdfRightPaneTab !== "docusign") {
            return;
        }
        void loadPrefilledPdfFromDocuSign(undefined, { maxAttempts: 1 });
    }, [
        invalidateDocuSignPdfCache,
        pdfRightPaneTab,
        linkedEnvelopeId,
        sessionEnvelopeId,
        loadPrefilledPdfFromDocuSign,
    ]);

    useEffect(() => {
        if (!isOpen) {
            didSuggestSentTabThisOpenRef.current = false;
            return;
        }
        if (!sentStepUnlocked && !isContractAlreadySent(resolvedContract, sentAt)) {
            /**
             * Nothing is out for signature any more — a resend archived the envelope, or the
             * jump below fired against the contract snapshot from before the refresh landed.
             * Step 4 has nothing to show, so return the wizard to step 1 rather than stranding
             * the user on an empty Sent step with no way to build the replacement package.
             */
            if (activeStep === "sent") setActiveStep("documents");
            return;
        }
        if (didSuggestSentTabThisOpenRef.current) return;
        if (activeStep !== "documents") return;
        setActiveStep("sent");
        didSuggestSentTabThisOpenRef.current = true;
    }, [isOpen, activeStep, resolvedContract, sentAt, sentStepUnlocked]);

    /** Replace addendum mappings with the given template refs (multi-select; Exhibit C may repeat). */
    const persistAddendumTemplateMappingsNow = useCallback(
        async (templateRefs: string[]) => {
            if (effectiveContractId == null) return;
            const nextRefs = expandAddendumRefsAllowingDuplicates(
                templateRefs.map((r) => String(r || "").trim()).filter(Boolean),
            );

            const applyLatestSelection = () => {
                const latestRefs = expandAddendumRefsAllowingDuplicates(
                    addendumOptimisticRefsRef.current ?? nextRefs,
                );
                const opts = latestRefs.map((ref) => `bs:${ref}`);
                selectedAddendumOptionsRef.current = opts;
                setSelectedAddendumOptions(opts);
            };

            const run = async () => {
                addendumMappingsWriteInFlightRef.current += 1;
                try {
                    const latestRefs = expandAddendumRefsAllowingDuplicates(
                        (addendumOptimisticRefsRef.current ?? nextRefs)
                            .map((r) => String(r || "").trim())
                            .filter(Boolean),
                    );
                    const addendumRows = addendumTemplateMappingsRef.current.filter(
                        (row) => String(row.documentType || "").toLowerCase() === "addendum",
                    );
                    const currentRefs = expandAddendumRefsAllowingDuplicates(
                        addendumRows
                            .map(
                                (row) =>
                                    getAddendumDropdownRef(row?.template) ||
                                    getBoldSignTemplateMappingRef(row?.template) ||
                                    "",
                            )
                            .filter(Boolean),
                    );
                    const same = sameOrderedStrings(currentRefs, latestRefs);
                    if (same) {
                        applyLatestSelection();
                        return;
                    }

                    const res = await axiosPut(
                        `/contract/${effectiveContractId}/document-template-mappings`,
                        {
                            documentType: "addendum",
                            templateRefs: latestRefs,
                        },
                    );
                    const saved = (res?.data?.data ?? res?.data ?? []) as ContractDocumentTemplateMappingRow[];
                    if (Array.isArray(saved) && saved.length >= 0) {
                        setTemplateMappings(saved);
                    } else {
                        await fetchTemplateMappings();
                    }
                    applyLatestSelection();
                } catch (error: any) {
                    setDocumentUploadMessage(
                        error?.message || "Failed to update addendum template.",
                    );
                    try {
                        await fetchTemplateMappings();
                    } catch {
                        /* ignore refetch errors */
                    }
                    if (
                        addendumMappingsWriteInFlightRef.current <= 1 &&
                        addendumOptimisticRefsRef.current &&
                        sameOrderedStrings(
                            addendumOptimisticRefsRef.current,
                            nextRefs,
                        )
                    ) {
                        const serverRefs = expandAddendumRefsAllowingDuplicates(
                            linkedAddendumMappingsRef.current
                                .map(
                                    (row) =>
                                        getAddendumDropdownRef(row?.template) ||
                                        getBoldSignTemplateMappingRef(row?.template) ||
                                        "",
                                )
                                .filter(Boolean),
                        );
                        addendumOptimisticRefsRef.current = serverRefs;
                        const opts = serverRefs.map((ref) => `bs:${ref}`);
                        selectedAddendumOptionsRef.current = opts;
                        setSelectedAddendumOptions(opts);
                    }
                } finally {
                    addendumMappingsWriteInFlightRef.current = Math.max(
                        0,
                        addendumMappingsWriteInFlightRef.current - 1,
                    );
                    if (addendumMappingsWriteInFlightRef.current === 0) {
                        const latest = addendumOptimisticRefsRef.current;
                        const isLatestIntent =
                            latest != null && sameOrderedStrings(latest, nextRefs);
                        if (latest == null || isLatestIntent) {
                            addendumOptimisticRefsRef.current = null;
                        }
                    }
                }
            };

            const queued = addendumMappingsWriteChainRef.current.then(run, run);
            addendumMappingsWriteChainRef.current = queued.then(
                () => undefined,
                () => undefined,
            );
            await queued;
        },
        [effectiveContractId, fetchTemplateMappings],
    );

    const flushPendingAddendumMappings = useCallback(async () => {
        if (addendumPersistTimerRef.current != null) {
            window.clearTimeout(addendumPersistTimerRef.current);
            addendumPersistTimerRef.current = null;
        }
        const refs = addendumOptimisticRefsRef.current;
        if (!refs || effectiveContractId == null) return;
        await persistAddendumTemplateMappingsNow(refs);
    }, [effectiveContractId, persistAddendumTemplateMappingsNow]);
    flushAddendumMappingsRef.current = flushPendingAddendumMappings;

    /** Replace addendum mappings with the given template refs (multi-select, incremental). */
    const setAddendumTemplateMappings = useCallback(
        async (templateRefs: string[], options?: { immediate?: boolean }) => {
            const nextRefs = expandAddendumRefsAllowingDuplicates(
                templateRefs.map((r) => String(r || "").trim()).filter(Boolean),
            );

            const nextOpts = nextRefs.map((ref) => `bs:${ref}`);
            addendumOptimisticRefsRef.current = nextRefs;
            selectedAddendumOptionsRef.current = nextOpts;
            setSelectedAddendumOptions(nextOpts);

            if (effectiveContractId == null) return;

            if (options?.immediate) {
                if (addendumPersistTimerRef.current != null) {
                    window.clearTimeout(addendumPersistTimerRef.current);
                    addendumPersistTimerRef.current = null;
                }
                await persistAddendumTemplateMappingsNow(nextRefs);
                return;
            }

            if (addendumPersistTimerRef.current != null) {
                window.clearTimeout(addendumPersistTimerRef.current);
            }
            addendumPersistTimerRef.current = window.setTimeout(() => {
                addendumPersistTimerRef.current = null;
                const latest = addendumOptimisticRefsRef.current ?? nextRefs;
                void persistAddendumTemplateMappingsNow(latest);
            }, 120);
        },
        [effectiveContractId, persistAddendumTemplateMappingsNow],
    );

    useEffect(() => {
        if (!isOpen || effectiveContractId == null) return;
        const refs = addendumOptimisticRefsRef.current;
        if (!refs) return;
        void persistAddendumTemplateMappingsNow(refs);
    }, [isOpen, effectiveContractId, persistAddendumTemplateMappingsNow]);

    const toggleAddendumTemplateSelection = useCallback(
        (templateRef: string) => {
            const ref = String(templateRef || "").trim();
            if (!ref) return;
            addendumUserInteractedAtRef.current = Date.now();
            const live =
                addendumOptimisticRefsRef.current ??
                (selectedAddendumOptionsRef.current.some((o) => o.startsWith("bs:"))
                    ? selectedAddendumOptionsRef.current
                          .map((opt) =>
                              opt.startsWith("bs:") ? opt.slice(3).trim() : "",
                          )
                          .filter(Boolean)
                    : resolveAddendumTemplateIdsForDocuSignMerge());
            const match = addendumTemplateOptions.find(
                (t: any) => getAddendumDropdownRef(t) === ref,
            );
            const pickerLabel =
                addendumPickerOptions.find((o) => o.ref === ref)?.label ||
                resolveFunderAddendumDisplayName(
                    ref,
                    selectedFunderAddendumOptions,
                    match?.name || match?.templateName || match?.title || null,
                );
            const removing =
                isMultiInstanceAddendumRef(ref, pickerLabel)
                    ? countAddendumRefOccurrences(live, ref) > 0
                    : live.includes(ref);
            const next = isMultiInstanceAddendumRef(ref, pickerLabel)
                ? setAddendumRefCount(live, ref, removing ? 0 : 1, pickerLabel)
                : removing
                  ? live.filter((r) => r !== ref)
                  : [...live, ref];

            const kind = resolveTemplateAutoAddendumKind(match ?? null);
            if (kind) {
                if (removing) addendumUserRemovedKindsRef.current.add(kind);
                else addendumUserRemovedKindsRef.current.delete(kind);
            }

            startTransition(() => {
                void setAddendumTemplateMappings(next, { immediate: true });
            });
        },
        [
            addendumPickerOptions,
            addendumTemplateOptions,
            resolveAddendumTemplateIdsForDocuSignMerge,
            selectedFunderAddendumOptions,
            setAddendumTemplateMappings,
        ],
    );

    const setAddendumTemplateRefCount = useCallback(
        (templateRef: string, count: number) => {
            const ref = String(templateRef || "").trim();
            if (!ref) return;
            addendumUserInteractedAtRef.current = Date.now();
            const live =
                addendumOptimisticRefsRef.current ??
                (selectedAddendumOptionsRef.current.some((o) => o.startsWith("bs:"))
                    ? selectedAddendumOptionsRef.current
                          .map((opt) =>
                              opt.startsWith("bs:") ? opt.slice(3).trim() : "",
                          )
                          .filter(Boolean)
                    : resolveAddendumTemplateIdsForDocuSignMerge());
            const match = addendumTemplateOptions.find(
                (t: any) => getAddendumDropdownRef(t) === ref,
            );
            const pickerLabel =
                addendumPickerOptions.find((o) => o.ref === ref)?.label ||
                resolveFunderAddendumDisplayName(
                    ref,
                    selectedFunderAddendumOptions,
                    match?.name || match?.templateName || match?.title || null,
                );
            const next = setAddendumRefCount(live, ref, count, pickerLabel);
            const kind = resolveTemplateAutoAddendumKind(match ?? null);
            if (kind) {
                if (count <= 0) addendumUserRemovedKindsRef.current.add(kind);
                else addendumUserRemovedKindsRef.current.delete(kind);
            }
            startTransition(() => {
                void setAddendumTemplateMappings(next, { immediate: true });
            });
        },
        [
            addendumPickerOptions,
            addendumTemplateOptions,
            resolveAddendumTemplateIdsForDocuSignMerge,
            selectedFunderAddendumOptions,
            setAddendumTemplateMappings,
        ],
    );

    const clearAllAddendumSelections = useCallback(() => {
        addendumUserInteractedAtRef.current = Date.now();
        for (const opt of selectedAddendumOptionsRef.current) {
            const tid = opt.startsWith("bs:") ? opt.slice(3) : "";
            const match = addendumTemplateOptions.find(
                (t: any) => getAddendumDropdownRef(t) === tid,
            );
            const kind = resolveTemplateAutoAddendumKind(match ?? null);
            if (kind) addendumUserRemovedKindsRef.current.add(kind);
        }
        startTransition(() => {
            void setAddendumTemplateMappings([]);
        });
    }, [addendumTemplateOptions, setAddendumTemplateMappings]);

    const reorderLinkedAddendums = useCallback(
        (nextRows: ContractDocumentTemplateMappingRow[]) => {
            const nextRefs = nextRows
                .map((row) => {
                    const pendingRef = String(row.id || "").startsWith("pending:")
                        ? String(row.id).split(":")[1] || ""
                        : "";
                    return (
                        pendingRef ||
                        resolveAddendumSelectionRef(row.template) ||
                        addendumMappingTemplateRef(row) ||
                        ""
                    );
                })
                .filter(Boolean);
            void setAddendumTemplateMappings(nextRefs, { immediate: true });
        },
        [resolveAddendumSelectionRef, setAddendumTemplateMappings],
    );

    const lookupDisclosureTemplateRef = useCallback(
        async (
            state: string,
            frequency: string,
            docsFunderId?: string | null,
            isRefinance = false,
        ): Promise<string | null> => {
            const normalizedState = normalizeStateForTemplateLookup(state);
            const normalizedFrequency = normalizeFrequencyForTemplateLookup(frequency);
            type DisclosureCatalogRow = {
                id?: string;
                name?: string | null;
                pdfUrl?: string | null;
                layoutKey?: string | null;
                templateId?: string | null;
                state?: string | null;
                frequency?: string | null;
                type?: string | null;
            };
            const mergeRows = (apiRows: DisclosureCatalogRow[]): DisclosureCatalogRow[] => {
                const merged = new Map<string, DisclosureCatalogRow>();
                const catalog = (
                    Array.isArray(boldSignTemplatesRef.current)
                        ? boldSignTemplatesRef.current
                        : []
                ).filter(isDisclosureCatalogRow) as DisclosureCatalogRow[];
                for (const row of [...catalog, ...(Array.isArray(apiRows) ? apiRows : [])]) {
                    const id = String(row?.id ?? "").trim();
                    const key =
                        id ||
                        `${templateLayoutKeyToken(row)}:${String(row?.name ?? "").trim()}`;
                    if (!key) continue;
                    const prev = merged.get(key);
                    if (!prev || String(row?.pdfUrl ?? "").trim()) merged.set(key, row);
                }
                return [...merged.values()];
            };
            const fetchRows = async (includeFrequency: boolean, includeState = true) => {
                const params = new URLSearchParams({
                    type: "disclosure",
                });
                if (includeState) params.set("state", normalizedState);
                if (includeFrequency) params.set("frequency", normalizedFrequency);
                const res = await axiosGet(`/contract/templates?${params.toString()}`);
                return (res?.data?.data ?? res?.data ?? []) as DisclosureCatalogRow[];
            };
            const layoutFunderId =
                docsFunderId !== undefined
                    ? docsFunderId
                    : disclosureDocsLayoutFunderIdRef.current;
            const pickFrom = (apiRows: DisclosureCatalogRow[]) =>
                pickDisclosureTemplateIdForFunder(
                    mergeRows(apiRows),
                    layoutFunderId,
                    state,
                    frequency,
                    isRefinance,
                    platformDisclosureFunderIdRef.current,
                );
            const fromCatalog = pickFrom([]);
            if (fromCatalog) return fromCatalog;
            try {
                const withFreq = await fetchRows(true);
                const fromFreq = pickFrom(Array.isArray(withFreq) ? withFreq : []);
                if (fromFreq) return fromFreq;
                const byState = await fetchRows(false);
                const fromState = pickFrom(Array.isArray(byState) ? byState : []);
                if (fromState) return fromState;
                const allDisclosures = await fetchRows(false, false);
                return pickFrom(Array.isArray(allDisclosures) ? allDisclosures : []);
            } catch {
                return pickFrom([]);
            }
        },
        [],
    );

    /** One state disclosure per send — replace any existing disclosure mapping. */
    const setDisclosureTemplateMapping = useCallback(
        async (
            templateRef: string | null,
            options?: { syncGen?: number },
        ) => {
            if (effectiveContractId == null) return;
            const ref = String(templateRef || "").trim();
            const syncGen = options?.syncGen;
            const run = async () => {
                if (
                    syncGen != null &&
                    syncGen !== disclosureSyncGenRef.current
                ) {
                    return;
                }
                try {
                    const res = await axiosGet(
                        `/contract/${effectiveContractId}/document-template-mappings`,
                        { skipCache: true },
                    );
                    if (
                        syncGen != null &&
                        syncGen !== disclosureSyncGenRef.current
                    ) {
                        return;
                    }
                    const rows = (res?.data?.data ?? res?.data ?? []) as ContractDocumentTemplateMappingRow[];
                    const disclosureRows = rows.filter(isDisclosureMappingRow);
                    if (!ref) {
                        if (disclosureRows.length === 0) {
                            await fetchTemplateMappings();
                            return;
                        }
                    } else if (
                        disclosureRows.length === 1 &&
                        mappingMatchesTemplateRef(disclosureRows[0], ref)
                    ) {
                        await fetchTemplateMappings();
                        return;
                    }
                    await Promise.all(
                        disclosureRows.map((row) =>
                            axiosDelete(
                                `/contract/${effectiveContractId}/document-template-mappings/${row.id}`,
                            ),
                        ),
                    );
                    if (
                        syncGen != null &&
                        syncGen !== disclosureSyncGenRef.current
                    ) {
                        return;
                    }
                    if (ref) {
                        await axiosPost(`/contract/${effectiveContractId}/document-template-mappings`, {
                            documentType: "disclosure",
                            templateRef: ref,
                        });
                    }
                    if (
                        syncGen != null &&
                        syncGen !== disclosureSyncGenRef.current
                    ) {
                        return;
                    }
                    await fetchTemplateMappings();
                } catch (error: any) {
                    setDocumentUploadMessage(
                        error?.message || "Failed to update state disclosure template.",
                    );
                }
            };

            const queued = disclosureMappingsWriteChainRef.current.then(run, run);
            disclosureMappingsWriteChainRef.current = queued.then(
                () => undefined,
                () => undefined,
            );
            await queued;
        },
        [effectiveContractId, fetchTemplateMappings],
    );

    const syncDisclosureTemplateForState = useCallback(
        async (
            state: string,
            options?: { silent?: boolean; docsLayoutFunderId?: string | null },
        ) => {
            if (effectiveContractId == null) return;
            if (isSignNowContractUiEnabled()) {
                const current = linkedDisclosureMappingRef.current;
                if (disclosureMappingIsSignNowPermanent(current)) return;
                const syncGen = ++disclosureSyncGenRef.current;
                try {
                    setLinkingDisclosureTemplate(true);
                    await setDisclosureTemplateMapping(SIGNNOW_DISCLOSURE_LAYOUT_KEY, {
                        syncGen,
                    });
                    if (syncGen === disclosureSyncGenRef.current) {
                        disclosureAutoLinkKeyRef.current = `${effectiveContractId}:signnow_disclosure`;
                    }
                } catch (error: any) {
                    if (syncGen === disclosureSyncGenRef.current) {
                        disclosureAutoLinkKeyRef.current = "";
                    }
                    setDocumentUploadMessage(
                        error?.message || "Failed to link SignNow disclosure template.",
                    );
                } finally {
                    if (syncGen === disclosureSyncGenRef.current) {
                        setLinkingDisclosureTemplate(false);
                    }
                }
                return;
            }
            const picked = pickUsStateForSelect(state);
            if (!picked) {
                // Don't clear a linked disclosure just because state hasn't hydrated yet.
                return;
            }
            if (effectiveContractId == null) return;
            const layoutFunderId =
                options?.docsLayoutFunderId !== undefined
                    ? options.docsLayoutFunderId
                    : disclosureDocsLayoutFunderIdRef.current;
            const platformOwnerId = platformDisclosureFunderIdRef.current;
            const catalogCount = (
                Array.isArray(boldSignTemplatesRef.current)
                    ? boldSignTemplatesRef.current
                    : []
            ).filter(isDisclosureCatalogRow).length;
            const syncKey = `${effectiveContractId}:${picked}:${contractDisclosureFrequency}:${layoutFunderId ?? "platform"}:${platformOwnerId ?? ""}:${catalogCount}`;
            const syncGen = ++disclosureSyncGenRef.current;
            try {
                setLinkingDisclosureTemplate(true);
                const od = offerDecisionData as Record<string, unknown> | null;
                const refiRaw = od?.refinanceAmount ?? od?.RefinanceAmount;
                const refiNum =
                    typeof refiRaw === "number"
                        ? refiRaw
                        : Number(String(refiRaw ?? "").replace(/[$,\s]/g, ""));
                const isRefinance = Number.isFinite(refiNum) && refiNum > 0;
                const templateRef = await lookupDisclosureTemplateRef(
                    picked,
                    contractDisclosureFrequency,
                    layoutFunderId,
                    isRefinance,
                );
                if (syncGen !== disclosureSyncGenRef.current) return;
                const current = linkedDisclosureMappingRef.current;
                const currentTemplateId = current ? mappingTemplateRowId(current) : "";
                if (!templateRef && !current) {
                    // Catalog is loaded (effect waits for it). Lock this key so we
                    // don't loop; catalog-count in the key retries if templates arrive later.
                    disclosureAutoLinkKeyRef.current = syncKey;
                    return;
                }
                if (
                    templateRef &&
                    currentTemplateId === templateRef &&
                    disclosureMappingMatchesState(current, picked) &&
                    disclosureMappingMatchesFunderDocuments(
                        current,
                        layoutFunderId,
                        platformDisclosureFunderIdRef.current,
                        selectedFunderProfileIdRef.current,
                    )
                ) {
                    disclosureAutoLinkKeyRef.current = syncKey;
                    return;
                }
                if (!templateRef) {
                    // Keep an existing disclosure that already matches this state.
                    // Lookup can miss while funder docs scope is still settling, or when
                    // no catalog row exists for the current filter — do not wipe on refresh.
                    if (
                        current &&
                        disclosureMappingMatchesState(current, picked)
                    ) {
                        disclosureAutoLinkKeyRef.current = syncKey;
                        return;
                    }
                    await setDisclosureTemplateMapping(null, { syncGen });
                    if (syncGen !== disclosureSyncGenRef.current) return;
                    disclosureAutoLinkKeyRef.current = syncKey;
                    if (!options?.silent) {
                        toast.info(`No disclosure PDF configured for ${picked}.`);
                    }
                    return;
                }
                await setDisclosureTemplateMapping(templateRef, { syncGen });
                if (syncGen !== disclosureSyncGenRef.current) return;
                disclosureAutoLinkKeyRef.current = syncKey;
            } catch (error: any) {
                if (syncGen === disclosureSyncGenRef.current) {
                    // Allow the effect to retry after a failed attempt.
                    disclosureAutoLinkKeyRef.current = "";
                }
                setDocumentUploadMessage(
                    error?.message || "Failed to link state disclosure template.",
                );
            } finally {
                if (syncGen === disclosureSyncGenRef.current) {
                    setLinkingDisclosureTemplate(false);
                }
            }
        },
        [
            contractDisclosureFrequency,
            effectiveContractId,
            lookupDisclosureTemplateRef,
            offerDecisionData,
            setDisclosureTemplateMapping,
        ],
    );

    /** Link disclosure once when reopening a contract that already has a saved state. */
    useEffect(() => {
        if (!isOpen) {
            disclosureAutoLinkKeyRef.current = "";
            disclosureSyncGenRef.current += 1;
            return;
        }
        if (effectiveContractId == null || loadingTemplateMappings) return;
        if (isSignNowContractUiEnabled()) {
            const key = `${effectiveContractId}:signnow_disclosure`;
            if (disclosureMappingIsSignNowPermanent(linkedDisclosureMapping)) {
                disclosureAutoLinkKeyRef.current = key;
                return;
            }
            if (disclosureAutoLinkKeyRef.current === key) return;
            disclosureAutoLinkKeyRef.current = key;
            void syncDisclosureTemplateForState(selectedState, { silent: true });
            return;
        }
        // Wait for real funder profiles + the shared disclosure catalog so
        // Nitro Advance / Clear Capital can both resolve the common pack.
        if (fundersLoading) return;
        if (!boldSignTemplatesHydrated || boldSignTemplatesLoading) return;
        const picked = pickUsStateForSelect(selectedState);
        if (!picked) return;
        const catalogCount = (Array.isArray(boldSignTemplates) ? boldSignTemplates : []).filter(
            isDisclosureCatalogRow,
        ).length;
        const docsKey = `${disclosureDocsLayoutFunderId ?? "platform"}:${platformDisclosureFunderId ?? ""}:${catalogCount}`;
        const key = `${effectiveContractId}:${picked}:${contractDisclosureFrequency}:${docsKey}`;
        if (
            linkedDisclosureMapping &&
            disclosureMappingMatchesState(linkedDisclosureMapping, picked) &&
            disclosureMappingMatchesFunderDocuments(
                linkedDisclosureMapping,
                disclosureDocsLayoutFunderId,
                platformDisclosureFunderId,
                selectedFunderProfileId,
            )
        ) {
            disclosureAutoLinkKeyRef.current = key;
            return;
        }
        if (disclosureAutoLinkKeyRef.current === key) return;
        void syncDisclosureTemplateForState(picked, {
            silent: true,
            docsLayoutFunderId: disclosureDocsLayoutFunderId,
        });
    }, [
        isOpen,
        effectiveContractId,
        loadingTemplateMappings,
        fundersLoading,
        boldSignTemplatesHydrated,
        boldSignTemplatesLoading,
        boldSignTemplates,
        selectedState,
        contractDisclosureFrequency,
        disclosureDocsLayoutFunderId,
        platformDisclosureFunderId,
        selectedFunderProfileId,
        linkedDisclosureMapping,
        syncDisclosureTemplateForState,
    ]);

    /** Auto-select funder addenda by refinance + state (P and/or CA/NY/VA). */
    const syncAddendumTemplateForApplication = useCallback(
        async (options?: {
            silent?: boolean;
            docsLayoutFunderId?: string | null;
            state?: string;
        }) => {
            if (effectiveContractId == null) return;
            const state =
                options?.state !== undefined
                    ? options.state
                    : selectedStateRef.current;
            const layoutFunderId =
                options?.docsLayoutFunderId !== undefined
                    ? options.docsLayoutFunderId
                    : docsLayoutFunderIdRef.current;
            const isRefinance = applicationIsRefinance(
                (applicationData as Record<string, unknown> | null) ?? null,
                (offerDecisionData as Record<string, unknown> | null) ?? null,
            );
            const wantedKinds = resolveWantedAutoAddendumKinds(
                state,
                isRefinance,
            ).filter((kind) => !addendumUserRemovedKindsRef.current.has(kind));
            const wantedRefs = pickAddendumTemplateRefsForKinds(
                addendumTemplateOptions,
                layoutFunderId,
                wantedKinds,
            );

            const currentMappings = linkedAddendumMappingsRef.current;
            const readLiveRefs = (): string[] => {
                const fromOptimistic = addendumOptimisticRefsRef.current;
                const fromSelected = fromOptimistic ??
                    selectedAddendumOptionsRef.current
                        .map((opt) => {
                            const trimmed = String(opt || "").trim();
                            if (!trimmed.startsWith("bs:")) return "";
                            return trimmed.slice(3).trim();
                        })
                        .filter(Boolean);
                const fromMappings = currentMappings
                    .map(
                        (row) =>
                            resolveAddendumSelectionRef(row?.template) ||
                            getAddendumDropdownRef(row?.template) ||
                            getBoldSignTemplateMappingRef(row?.template) ||
                            "",
                    )
                    .filter(Boolean);
                return expandAddendumRefsAllowingDuplicates(
                    fromSelected.length ? fromSelected : fromMappings,
                );
            };
            // Prefer the live checkbox selection — filtered linked rows can lag or hide
            // another funder's in-flight picks and look "empty" for 3–5s.
            const currentRefs = readLiveRefs();

            // Keep non-auto selections and user-added auto addenda beyond the defaults.
            const keptExtraRefs = currentRefs.filter((ref) => {
                const row = currentMappings.find(
                    (m) =>
                        resolveAddendumSelectionRef(m?.template) === ref ||
                        getAddendumDropdownRef(m?.template) === ref ||
                        getBoldSignTemplateMappingRef(m?.template) === ref ||
                        (isMultiInstanceAddendumRef(ref) &&
                            isMultiInstanceAddendumRef(
                                resolveAddendumSelectionRef(m?.template) ||
                                    getAddendumDropdownRef(m?.template) ||
                                    "",
                                m?.template?.name || m?.template?.templateName,
                            )),
                );
                const option = addendumTemplateOptions.find(
                    (t: any) =>
                        getAddendumDropdownRef(t) === ref ||
                        (isMultiInstanceAddendumRef(ref) &&
                            isMultiInstanceAddendumRef(
                                getAddendumDropdownRef(t),
                                t?.name || t?.templateName || t?.title,
                            )),
                );
                const kind = resolveTemplateAutoAddendumKind(
                    row?.template || option || null,
                );
                if (!kind) return true;
                if (addendumUserRemovedKindsRef.current.has(kind)) return false;
                if (wantedKinds.includes(kind)) return false;
                return true;
            });

            const liveRefs = readLiveRefs();
            // Keep live multi-instance counts (Exhibit C × N). Do not concat
            // keptExtraRefs + liveExtras — that doubled Exhibit C after expand.
            const manualRefs = liveRefs.filter((ref) => !wantedRefs.includes(ref));
            const nextRefs = expandAddendumRefsAllowingDuplicates([
                ...wantedRefs,
                ...manualRefs,
            ]);
            const same = sameOrderedStrings(nextRefs, liveRefs);
            const userPicking =
                addendumDropdownOpenRef.current ||
                Date.now() - addendumUserInteractedAtRef.current < 800;
            if (same) {
                if (userPicking) return;
                const nextOpts = nextRefs.map((ref) => `bs:${ref}`);
                const selected = selectedAddendumOptionsRef.current;
                const selectedSame =
                    selected.length === nextOpts.length &&
                    selected.every((o) => nextOpts.includes(o));
                if (!selectedSame) setSelectedAddendumOptions(nextOpts);
                return;
            }

            // Catalog not ready / missing PDFs: keep existing auto addenda instead of wiping.
            if (wantedKinds.length > 0 && wantedRefs.length === 0) {
                const preservedAutoRefs = currentRefs.filter((ref) => {
                    const row = currentMappings.find(
                        (m) =>
                            getAddendumDropdownRef(m?.template) === ref ||
                            getBoldSignTemplateMappingRef(m?.template) === ref,
                    );
                    const kind = resolveTemplateAutoAddendumKind(row?.template);
                    return Boolean(kind && wantedKinds.includes(kind));
                });
                if (preservedAutoRefs.length || keptExtraRefs.length) {
                    const preserveRefs = expandAddendumRefsAllowingDuplicates([
                        ...preservedAutoRefs,
                        ...keptExtraRefs,
                    ]);
                    const preserveSame = sameOrderedStrings(
                        preserveRefs,
                        currentRefs,
                    );
                    if (preserveSame) {
                        const nextOpts = preserveRefs.map((ref) => `bs:${ref}`);
                        const selected = selectedAddendumOptionsRef.current;
                        const selectedSame =
                            selected.length === nextOpts.length &&
                            selected.every((o) => nextOpts.includes(o));
                        if (!selectedSame) setSelectedAddendumOptions(nextOpts);
                        return;
                    }
                    await setAddendumTemplateMappings(preserveRefs, {
                        immediate: !userPicking,
                    });
                    return;
                }
                if (!options?.silent) {
                    toast.info(
                        `No uploaded PDF for: ${wantedKinds.map((k) => k.replace(/_/g, " ")).join(", ")}.`,
                    );
                }
                return;
            }

            if (!wantedKinds.length && !manualRefs.length) {
                if (liveRefs.length && !userPicking) {
                    await setAddendumTemplateMappings([], { immediate: true });
                }
                return;
            }

            await setAddendumTemplateMappings(nextRefs, {
                immediate: !userPicking,
            });
        },
        [
            addendumTemplateOptions,
            applicationData,
            effectiveContractId,
            offerDecisionData,
            resolveAddendumSelectionRef,
            setAddendumTemplateMappings,
        ],
    );

    useEffect(() => {
        if (!isOpen) return;
        if (addendumDropdownOpenRef.current) return;
        if (effectiveContractId == null || loadingTemplateMappings) return;
        // SignNow options come from the funder profile — don't wait on the BoldSign catalog.
        // Other providers still need funder profiles + template catalog so we don't wipe
        // funder-scoped addenda while still on fallback/platform scope.
        if (
            !isSignNowContractUiEnabled() &&
            (fundersLoading || !boldSignTemplatesHydrated || boldSignTemplatesLoading)
        ) {
            return;
        }
        // SignNow: wait for the contract's funder. Before it resolves, refs come out in their
        // raw catalog form and the linked list is unfiltered — persisting from that state
        // twinned Flex / EPA (stuck pending rows) and dropped saved addenda after a regenerate.
        if (
            isSignNowContractUiEnabled() &&
            (!contractPrefillLoaded || fundersLoading || !selectedFunderProfile)
        ) {
            return;
        }
        const isRefinance = applicationIsRefinance(
            (applicationData as Record<string, unknown> | null) ?? null,
            (offerDecisionData as Record<string, unknown> | null) ?? null,
        );
        const wanted = resolveWantedAutoAddendumKinds(
            selectedState,
            isRefinance,
        );
        const docsKey = docsLayoutFunderId ?? "platform";
        const availableKinds = addendumTemplateOptions
            .map((t) => resolveTemplateAutoAddendumKind(t))
            .filter(Boolean)
            .sort()
            .join(",");
        const appType = String(
            (applicationData as { type?: unknown } | null)?.type ?? "",
        )
            .trim()
            .toLowerCase();
        const contextKey = `${effectiveContractId}:${selectedState}:${isRefinance ? "refi" : "norefi"}:${appType}:${docsKey}`;
        const key = `${contextKey}:${wanted.join("+") || "none"}:${availableKinds}`;
        if (addendumAutoLinkKeyRef.current === key) return;
        const prev = addendumAutoLinkKeyRef.current;
        if (
            !prev ||
            !prev.startsWith(
                `${effectiveContractId}:${selectedState}:${isRefinance ? "refi" : "norefi"}:${appType}:`,
            )
        ) {
            if (Date.now() - addendumUserInteractedAtRef.current > 800) {
                addendumUserRemovedKindsRef.current.clear();
            }
        }
        addendumAutoLinkKeyRef.current = key;
        void syncAddendumTemplateForApplication({
            silent: true,
            docsLayoutFunderId,
            state: selectedState,
        });
    }, [
        isOpen,
        effectiveContractId,
        loadingTemplateMappings,
        fundersLoading,
        boldSignTemplatesHydrated,
        boldSignTemplatesLoading,
        selectedState,
        docsLayoutFunderId,
        applicationData,
        offerDecisionData,
        addendumTemplateOptions,
        addendumPickerEpoch,
        syncAddendumTemplateForApplication,
        contractPrefillLoaded,
        selectedFunderProfile,
    ]);

    const persistContractEnvelopeHistory = useCallback(
        async (envelopeId: string, status = "draft") => {
            const cid = effectiveContractId;
            if (cid == null || !Number.isFinite(Number(cid))) return;
            const rawOverrides =
                normalizeContractPrefillOverrides(
                    (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides,
                ) ?? {};
            const main = stripDocumentTemplateBlobFromPrefillOverrides(
                rawOverrides,
            ) as Record<string, unknown>;
            const signerRows = ensureSignerRowsFromCrmOwners(
                contractSignerOverrides?.length
                    ? contractSignerOverrides
                    : parseContractSignerOverridesFromPrefill(rawOverrides),
                crmOwnerPartiesForSigners,
            );
            const sendHistory = upsertDocumentSendHistory(parseDocumentSendHistory(rawOverrides), {
                envelopeId,
                documentKind: "contract",
                label: "Contract",
                status,
                updatedAt: new Date().toISOString(),
            });
            const contractPrefillOverrides = {
                ...pickPreservedDocuSignEnvelopeMetaFromPrefill(rawOverrides),
                ...main,
                ...(signerRows?.length
                    ? { [CONTRACT_SIGNER_OVERRIDES_KEY]: signerRows }
                    : {}),
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: documentTemplatePrefillByMappingId,
                [DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY]: documentTemplateEnvelopeByMappingId,
                [DOCUMENT_SEND_HISTORY_KEY]: sendHistory,
            };
            await dispatch(
                updateContract({
                    id: Number(cid),
                    data: { contractPrefillOverrides },
                }),
            ).unwrap();
            setContractPrefillFromDb(
                stripDocumentTemplateBlobFromPrefillOverrides(
                    normalizeContractPrefillOverrides(contractPrefillOverrides) ?? null,
                ),
            );
            setResolvedContract((prev) =>
                prev && typeof prev === "object"
                    ? { ...prev, contractPrefillOverrides }
                    : prev,
            );
            onContractDocumentsChanged?.();
        },
        [
            effectiveContractId,
            resolvedContract,
            contractSignerOverrides,
            crmOwnerPartiesForSigners,
            documentTemplatePrefillByMappingId,
            documentTemplateEnvelopeByMappingId,
            dispatch,
            onContractDocumentsChanged,
        ],
    );

    const loadMainContractTemplatePreview = useCallback(
        async (options?: {
            silent?: boolean;
            force?: boolean;
            funderProfileId?: string;
            funderName?: string;
        }) => {
            const profileId = String(
                options?.funderProfileId ?? selectedFunderProfileIdRef.current ?? "",
            ).trim();
            const profile =
                findFunderProfileById(fundersRef.current, profileId) ??
                (String(options?.funderName ?? selectedFunderRef.current ?? "").trim()
                    ? findFunderRef.current(options?.funderName ?? selectedFunderRef.current)
                    : undefined);
            const funderName = String(
                profile?.name ?? options?.funderName ?? selectedFunderRef.current ?? "",
            ).trim();
            if (!funderName && !isSignNowContractUiEnabled()) return;

            const state = pickUsStateForSelect(selectedStateRef.current) || undefined;
            const previewKey = `${profileId || funderName}:${state ?? ""}`;
            if (
                !options?.force &&
                lastAutoPreviewKeyRef.current === previewKey &&
                uploadedPreviewUrlRef.current
            ) {
                return;
            }

            const layoutKey = profile
                ? resolveLayoutKeyForProfileRef.current(profile)
                : resolveLayoutKeyRef.current(funderName, profileId);
            const requestId = ++mainContractPreviewRequestRef.current;
            setPreviewingMainContract(true);
            try {
                const preview = await fetchMainContractTemplatePreview({
                    layoutKey,
                    funderName,
                    funderProfileId: persistedFunderProfileIdForApi(profile),
                    state,
                    previewName: previewNameForRef.current(funderName, profileId),
                    fallbackUrl:
                        isPreferredCapitalBranding(fileName) ||
                        isPreferredCapitalBranding(fileUrl)
                            ? undefined
                            : fileUrl,
                    fallbackName: sanitizeContractPreviewName(fileName),
                    findFunder: findFunderRef.current,
                    findFunderById: findFunderByIdRef.current,
                });
                if (requestId !== mainContractPreviewRequestRef.current) return;
                if (!preview?.url) {
                    setUploadedPreviewUrl(null);
                    uploadedPreviewUrlRef.current = null;
                    lastAutoPreviewKeyRef.current = "";
                    setDocumentUploadMessage(
                        funderName
                            ? `No contract PDF configured for ${funderName}.`
                            : "Select a funder to preview the contract template.",
                    );
                    return;
                }
                if (templatePreviewBlobUrlRef.current) {
                    URL.revokeObjectURL(templatePreviewBlobUrlRef.current);
                }
                if (preview.url.startsWith("blob:")) {
                    templatePreviewBlobUrlRef.current = preview.url;
                } else {
                    templatePreviewBlobUrlRef.current = null;
                }
                lastAutoPreviewKeyRef.current = previewKey;
                setActivePreview(null);
                setUploadedPreviewUrl(preview.url);
                uploadedPreviewUrlRef.current = preview.url;
                setPdfRightPaneTab("template");
                setActiveContractTemplateName(
                    sanitizeContractPreviewName(preview.name || NITRO_ADVANCE_CONTRACT_PREVIEW_NAME),
                );
                setDocumentUploadMessage(
                    `Showing contract: ${formatDropdownLabel(preview.name)}`,
                );
                if (!options?.silent) {
                    toast.success(`Previewing ${formatDropdownLabel(preview.name)}`);
                }
            } catch (error: unknown) {
                if (requestId !== mainContractPreviewRequestRef.current) return;
                const err = error as {
                    response?: { data?: { message?: string } };
                    message?: string;
                };
                setDocumentUploadMessage(
                    err?.response?.data?.message ||
                        err?.message ||
                        "Failed to load contract template PDF.",
                );
            } finally {
                if (requestId === mainContractPreviewRequestRef.current) {
                    setPreviewingMainContract(false);
                }
            }
        },
        [fileUrl, fileName],
    );

    const handlePreviewMainContractTemplate = useCallback(() => {
        void loadMainContractTemplatePreview({ force: true });
    }, [loadMainContractTemplatePreview]);

    const scheduleMainContractTemplatePreview = useCallback(
        (funderProfileIdOverride?: string) => {
            const profileId = String(
                funderProfileIdOverride ?? selectedFunderProfileIdRef.current ?? "",
            ).trim();
            if (!profileId && !selectedFunderRef.current.trim()) return;
            lastAutoPreviewKeyRef.current = "";
            uploadedPreviewUrlRef.current = null;
            setUploadedPreviewUrl(null);
            void loadMainContractTemplatePreview({
                silent: true,
                force: true,
                funderProfileId: profileId || undefined,
                funderName: selectedFunderRef.current,
            });
        },
        [loadMainContractTemplatePreview],
    );

    useEffect(() => {
        if (!isOpen) return;
        if (
            !selectedFunderProfileId.trim() &&
            !selectedFunder.trim() &&
            !isSignNowContractUiEnabled()
        ) {
            return;
        }
        if (activeStep !== "info" && activeStep !== "summary" && activeStep !== "documents") {
            return;
        }
        // Info/Summary must always show the funder contract; Documents may keep an eye-preview.
        const forceContract = activeStep === "info" || activeStep === "summary";
        void loadMainContractTemplatePreview({ silent: true, force: forceContract });
    }, [
        isOpen,
        activeStep,
        selectedFunder,
        selectedFunderProfileId,
        selectedState,
        funders,
        loadMainContractTemplatePreview,
    ]);

    const handlePreviewBoldSignTemplate = useCallback(
        async (row: ContractDocumentTemplateMappingRow) => {
            if (!boldSignTemplateIsPreviewable(row?.template)) {
                setDocumentUploadMessage(
                    "This template has no PDF URL or DocuSign template id.",
                );
                return;
            }
            const mappingRef = getAddendumDropdownRef(row?.template);
            try {
                setPreviewingTemplateId(String(row.id));
                const blob = await loadBoldSignTemplatePdfBlob({
                    template: row?.template,
                    axiosGet,
                    funderName: selectedFunderRef.current || null,
                    funderProfileId: selectedFunderProfileIdRef.current || null,
                    state: pickUsStateForSelect(selectedStateRef.current) || null,
                });
                if (templatePreviewBlobUrlRef.current) {
                    URL.revokeObjectURL(templatePreviewBlobUrlRef.current);
                }
                const url = URL.createObjectURL(blob);
                templatePreviewBlobUrlRef.current = url;
                setActivePreview(null);
                // Mark that the right pane is an eye-preview, not the auto contract key.
                lastAutoPreviewKeyRef.current = "";
                setUploadedPreviewUrl(url);
                const docType = String(row.documentType || "").toLowerCase();
                if (docType === "addendum" && mappingRef) {
                    const opt = `bs:${mappingRef}`;
                    setSelectedAddendumOptions((prev) =>
                        prev.some(
                            (o) =>
                                o.startsWith("bs:") &&
                                sameAddendumPickerRef(o.slice(3), mappingRef),
                        )
                            ? prev
                            : [...prev, opt],
                    );
                }
                setDocumentUploadMessage(
                    `Showing template: ${formatDropdownLabel(
                        row?.template?.name ||
                            (mappingRef && isPlatformLayoutKey(mappingRef)
                                ? supplementalOptionLabel(mappingRef)
                                : null) ||
                            formatDisclosureTemplateLabel(row) ||
                            row?.templateId ||
                            "Template",
                    )}`,
                );
            } catch (error: any) {
                const apiMsg =
                    error?.response?.data?.message ||
                    error?.message ||
                    "Failed to load template PDF.";
                setDocumentUploadMessage(apiMsg);
                toast.error(apiMsg);
            } finally {
                setPreviewingTemplateId(null);
            }
        },
        [],
    );

    useEffect(() => {
        return () => {
            if (templatePreviewBlobUrlRef.current) {
                URL.revokeObjectURL(templatePreviewBlobUrlRef.current);
                templatePreviewBlobUrlRef.current = null;
            }
        };
    }, []);

    const mainPrefillOverridesForTemplateDialog = useMemo(() => {
        if (!contractPrefillFromDb) return null;
        const o = { ...contractPrefillFromDb } as Record<string, unknown>;
        delete o[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
        return o as Partial<BuildContractPrefillFieldsArgs>;
    }, [contractPrefillFromDb]);

    // Drop accidental duplicate addendum mappings that share the same template
    // (race leftovers). Exhibit C is allowed to repeat — never prune those.
    useEffect(() => {
        if (!isOpen || effectiveContractId == null || loadingTemplateMappings) return;
        const byTemplate = new Map<string, ContractDocumentTemplateMappingRow[]>();
        for (const row of addendumTemplateMappings) {
            const key =
                String(row?.template?.id ?? "").trim() ||
                String(row?.templateId ?? "").trim() ||
                getAddendumDropdownRef(row?.template) ||
                "";
            if (!key) continue;
            const list = byTemplate.get(key) ?? [];
            list.push(row);
            byTemplate.set(key, list);
        }
        const extras = [...byTemplate.entries()].flatMap(([key, list]) => {
            if (list.length <= 1) return [];
            const sample = list[0];
            const rowLabel = sample?.template?.name || "";
            const multi = isMultiInstanceAddendumRef(
                getAddendumDropdownRef(sample?.template) ||
                    sample?.template?.layoutKey ||
                    key,
                rowLabel,
            );
            // Keep every Exhibit C instance row in the DB.
            if (multi) return [];
            return list.slice(1);
        });
        if (!extras.length) return;
        void (async () => {
            try {
                await Promise.all(
                    extras.map((row) =>
                        axiosDelete(
                            `/contract/${effectiveContractId}/document-template-mappings/${row.id}`,
                        ),
                    ),
                );
                await fetchTemplateMappings();
            } catch {
                /* ignore cleanup errors */
            }
        })();
    }, [
        isOpen,
        effectiveContractId,
        loadingTemplateMappings,
        addendumTemplateMappings,
        fetchTemplateMappings,
    ]);

    // Sync dropdown multi-select from linked addendum mappings (allow multiple).
    // Drop platform addendums when the selected funder uses own/shared docs.
    useEffect(() => {
        if (!isOpen || effectiveContractId == null || loadingTemplateMappings) return;
        // Don't clobber optimistic checkbox state while a persist is in flight.
        if (
            addendumMappingsWriteInFlightRef.current > 0 ||
            addendumOptimisticRefsRef.current != null ||
            addendumDropdownOpenRef.current ||
            Date.now() - addendumUserInteractedAtRef.current < 800
        ) {
            return;
        }
        // Avoid treating funder-scoped mappings as invalid before catalog/funder hydrate.
        if (
            !isSignNowContractUiEnabled() &&
            (fundersLoading || !boldSignTemplatesHydrated || boldSignTemplatesLoading)
        ) {
            // Still restore checkbox UI from whatever mappings we already have.
            const pendingRefs = expandAddendumRefsAllowingDuplicates(
                linkedAddendumMappings
                    .map((row) => resolveAddendumSelectionRef(row?.template))
                    .filter(Boolean),
            );
            const next = pendingRefs.map((ref) => `bs:${ref}`);
            const current = selectedAddendumOptionsRef.current;
            const same = sameOrderedStrings(current, next);
            if (!same && !current.some((o) => o.startsWith("up:"))) {
                setSelectedAddendumOptions(next);
            }
            return;
        }
        // SignNow: reconcile only once the contract's funder is known. Until then every row
        // counted as "owned" and was seeded in its raw form, which twinned Flex / EPA with
        // their funder hex form, and a transient funder could delete saved mappings. The
        // board shows the saved rows meanwhile.
        if (
            isSignNowContractUiEnabled() &&
            (!contractPrefillLoaded || fundersLoading || !selectedFunderProfile)
        ) {
            return;
        }

        const validRefs: string[] = [];
        const invalidRows: ContractDocumentTemplateMappingRow[] = [];
        // Compare against raw mappings so we can delete another funder's leftovers
        // even when the visible linked list already filters them out.
        const rowsToReconcile = [...addendumTemplateMappings].sort(
            (a, b) => Number(a.order ?? 0) - Number(b.order ?? 0),
        );
        const optimisticSelectedRefs = new Set(
            selectedAddendumOptionsRef.current
                .map((o) => String(o || "").trim())
                .filter((o) => o.startsWith("bs:"))
                .map((o) => o.slice(3).trim().toLowerCase())
                .filter(Boolean),
        );
        for (const row of rowsToReconcile) {
            // Prefer this funder's unique SignNow template id as the selection ref.
            const tid = resolveAddendumSelectionRef(row?.template);
            if (!tid) continue;
            const rowLabel =
                row?.template?.name ||
                row?.template?.templateName ||
                row?.template?.title ||
                "";
            if (isSignNowContractUiEnabled()) {
                const owned =
                    selectedFunderAddendumOptions.length === 0 ||
                    funderOwnsSignNowAddendumRef(
                        tid,
                        selectedFunderAddendumOptions,
                        row?.template,
                    ) ||
                    // Keep in-flight user picks while the mapping row still points at a
                    // legacy Nitro catalog id (race that used to clear after 3–5s).
                    optimisticSelectedRefs.has(tid.toLowerCase()) ||
                    (optimisticSelectedRefs.has("exhibit_c") &&
                        isMultiInstanceAddendumRef(tid, rowLabel)) ||
                    optimisticSelectedRefs.has(
                        extractSignNowTemplateId(
                            row?.template?.templateId || row?.template?.id || "",
                        ),
                    );
                if (!owned) {
                    invalidRows.push(row);
                    continue;
                }
            } else if (
                !isAddendumRefValidForDocsFunder(
                    tid,
                    docsLayoutFunderId,
                    boldSignTemplates,
                )
            ) {
                invalidRows.push(row);
                continue;
            }
            // Exhibit C may appear N times — keep every mapping row's selection ref.
            if (isMultiInstanceAddendumRef(tid, rowLabel)) {
                validRefs.push(tid);
            } else if (
                !validRefs.some((v) => v.toLowerCase() === tid.toLowerCase())
            ) {
                validRefs.push(tid);
            }
        }

        // Also keep any optimistic SignNow selections that belong to this funder even
        // before their mapping rows finish saving.
        if (isSignNowContractUiEnabled() && selectedFunderAddendumOptions.length) {
            const optimisticList = selectedAddendumOptionsRef.current
                .map((o) => String(o || "").trim())
                .filter((o) => o.startsWith("bs:"))
                .map((o) => o.slice(3).trim())
                .filter(Boolean);
            for (const ref of optimisticList) {
                const owned =
                    funderOwnsSignNowAddendumRef(ref, selectedFunderAddendumOptions) ||
                    isMultiInstanceAddendumRef(ref);
                if (!owned) continue;
                if (isMultiInstanceAddendumRef(ref)) {
                    // Preserve each optimistic Exhibit C copy; do not collapse.
                    continue;
                }
                // Same addendum in another ref form (catalog key vs funder hex) is not a
                // second pick — pushing it built a duplicate pending row.
                if (!validRefs.some((v) => sameAddendumPickerRef(v, ref))) {
                    validRefs.push(ref);
                }
            }
            const optimisticExhibitRefs = optimisticList.filter((r) =>
                isMultiInstanceAddendumRef(r),
            );
            const mappedExhibitCount = validRefs.filter((r) =>
                isMultiInstanceAddendumRef(r),
            ).length;
            if (optimisticExhibitRefs.length > mappedExhibitCount) {
                for (
                    let i = mappedExhibitCount;
                    i < optimisticExhibitRefs.length;
                    i++
                ) {
                    validRefs.push(optimisticExhibitRefs[i]);
                }
            }
        }

        if (invalidRows.length) {
            void (async () => {
                try {
                    await Promise.all(
                        invalidRows.map((row) =>
                            axiosDelete(
                                `/contract/${effectiveContractId}/document-template-mappings/${row.id}`,
                            ),
                        ),
                    );
                    await fetchTemplateMappings();
                } catch {
                    /* ignore cleanup errors */
                }
            })();
            // Do not return early — still sync checkbox state from valid + optimistic refs
            // so a cleanup pass cannot blank the user's current selection.
        }

        const next = expandAddendumRefsAllowingDuplicates(validRefs).map(
            (ref) => `bs:${ref}`,
        );
        const current = selectedAddendumOptionsRef.current;
        const same = sameOrderedStrings(current, next);
        if (!same && !current.some((o) => o.startsWith("up:"))) {
            setSelectedAddendumOptions(next);
        }
    }, [
        isOpen,
        effectiveContractId,
        loadingTemplateMappings,
        fundersLoading,
        boldSignTemplatesHydrated,
        boldSignTemplatesLoading,
        linkedAddendumMappings,
        addendumTemplateMappings,
        fetchTemplateMappings,
        docsLayoutFunderId,
        boldSignTemplates,
        resolveAddendumSelectionRef,
        selectedFunderAddendumOptions,
        addendumPickerEpoch,
        contractPrefillLoaded,
        selectedFunderProfile,
    ]);

    const prevActiveStepRef = useRef<ContractWizardStep>(activeStep);
    // Info + Summary always show the selected funder's main contract (not addendum/disclosure eye previews).
    useEffect(() => {
        const prev = prevActiveStepRef.current;
        prevActiveStepRef.current = activeStep;
        if (prev === activeStep) return;

        if (activeStep === "info" || activeStep === "summary") {
            void flushAddendumMappingsRef.current();
            setActivePreview(null);
            lastAutoPreviewKeyRef.current = "";
            if (selectedFunderRef.current.trim() || selectedFunderProfileIdRef.current.trim()) {
                void loadMainContractTemplatePreview({ silent: true, force: true });
            }
            return;
        }

        if (prev === "documents" && activeStep !== "documents") {
            setActivePreview(null);
            setUploadedPreviewUrl(null);
            uploadedPreviewUrlRef.current = null;
            lastAutoPreviewKeyRef.current = "";
        }
    }, [activeStep, loadMainContractTemplatePreview]);

    useEffect(() => {
        if (!isOpen || effectiveContractId == null) return;
        dispatch(getUploadedContractDocuments(effectiveContractId));
    }, [effectiveContractId, dispatch, isOpen]);

    useEffect(() => {
        if (isOpen) return;
        if (addendumPersistTimerRef.current != null) {
            window.clearTimeout(addendumPersistTimerRef.current);
            addendumPersistTimerRef.current = null;
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        void fetchTemplateMappings();
    }, [isOpen, fetchTemplateMappings]);

    useEffect(() => {
        if (!isOpen) {
            setBoldSignTemplatesHydrated(false);
            return;
        }
        let cancelled = false;
        setBoldSignTemplatesHydrated(false);
        void dispatch(getBoldSignTemplates({}))
            .finally(() => {
                if (!cancelled) setBoldSignTemplatesHydrated(true);
            });
        return () => {
            cancelled = true;
        };
    }, [dispatch, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        if (isSignNowContractUiEnabled()) return;
        let cancelled = false;
        void (async () => {
            const latest = await fetchLatestContractTemplate();
            if (cancelled || !latest) return;
            setActiveContractTemplateName(
                sanitizeContractPreviewName(latest.originalName),
            );
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    // Keep effectiveTemplateId in sync with prop, then VITE_DOCUSIGN_TEMPLATE_ID, then CRM template list
    useEffect(() => {
        const fromProp = String(templateId ?? "").trim();
        if (fromProp) {
            setEffectiveTemplateId(fromProp);
            return;
        }
        if (DEFAULT_DOCUSIGN_TEMPLATE_ID) {
            setEffectiveTemplateId(DEFAULT_DOCUSIGN_TEMPLATE_ID);
            return;
        }
        setEffectiveTemplateId(null);
    }, [templateId]);

    useEffect(() => {
        if (!isOpen || !selectedFunder.trim() || String(templateId ?? "").trim()) return;
        let cancelled = false;
        void (async () => {
            const tid = await fetchDocuSignTemplateIdForFunder(selectedFunder);
            if (cancelled || !tid) return;
            setEffectiveTemplateId(tid);
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen, selectedFunder, templateId]);

    useEffect(() => {
        if (effectiveTemplateId) return;
        if (!Array.isArray(boldSignTemplates) || boldSignTemplates.length === 0) return;
        const first = boldSignTemplates[0];
        const tid = String(first?.templateId || first?.id || "").trim();
        if (tid) setEffectiveTemplateId(tid);
    }, [effectiveTemplateId, boldSignTemplates]);

    useEffect(() => {
        if (!isOpen || !applicationIdForLookup) return;
        dispatch(getBankDetails({ application: applicationIdForLookup }));
    }, [isOpen, applicationIdForLookup, dispatch]);

    // Pre-fetch related records by contractId for Info/Summary panels
    useEffect(() => {
        if (!isOpen || (activeStep !== "info" && activeStep !== "summary") || effectiveContractId == null) return;
        const id = effectiveContractId;
        dispatch(getAllAddendum({ contractId: id }));
        dispatch(getAllACH({ contractId: id }));
        dispatch(getAllEPO({ contractId: id }));
        void dispatch(getAllContractOwners({ contractId: id }))
            .unwrap()
            .catch(() => null)
            .finally(() => setSignerOwnersLoadedForContractId(id));
        dispatch(getAllContractGuarantors({ contractId: id }));
    }, [isOpen, activeStep, effectiveContractId, dispatch]);

    useEffect(() => {
        if (!activeInfoPanel || effectiveContractId == null) return;
        const id = effectiveContractId;
        if (activeInfoPanel === "addendum") {
            dispatch(getAllAddendum({ contractId: id }));
        } else if (activeInfoPanel === "ach") {
            dispatch(getAllACH({ contractId: id }));
        } else if (activeInfoPanel === "epo") {
            dispatch(getAllEPO({ contractId: id }));
        } else if (activeInfoPanel === "owner") {
            dispatch(getAllContractOwners({ contractId: id }));
        } else if (activeInfoPanel === "guarantor") {
            dispatch(getAllContractGuarantors({ contractId: id }));
        }
    }, [activeInfoPanel, effectiveContractId, dispatch]);

    // Keep editor collapsed by default on Info step.
    // It opens only when user explicitly chooses "Open Editor" from a record's Edit action.
    useEffect(() => {
        if (!activeInfoPanel) return;
        setSelectedInfoPanels((prev) =>
            prev.includes(activeInfoPanel) ? prev : [...prev, activeInfoPanel]
        );
    }, [activeInfoPanel]);

    useEffect(() => {
        if (activeInfoPanel !== "addendum") return;
        const rows = Array.isArray(addendumListState.data) ? addendumListState.data : [];
        if (!rows.length) return;
        const flattened = rows.flatMap((item: any, idx: number) => {
            const baseId = String(item?.id ?? idx + 1);
            const slots = [1, 2, 3].map((slot) => {
                const legalName = String(item?.[`legalName${slot}`] || "");
                const dba = String(item?.[`dba${slot}`] || "");
                const typeOfEntity = String(item?.[`typeOfEntity${slot}`] || "");
                const ein = String(item?.[`ein${slot}`] || "");
                const mailingAddress = String(item?.[`mailingAddress${slot}`] || "");
                const hasData = [legalName, dba, typeOfEntity, ein, mailingAddress]
                    .some((v) => v.trim() !== "");
                if (!hasData) return null;
                return {
                    id: slot === 1 ? baseId : `${baseId}-${slot}`,
                    legalName,
                    dba,
                    typeOfEntity,
                    ein,
                    mailingAddress,
                    addendumDated: slot === 1 ? String(item?.addendumDated || "") : "",
                    principalOwner: slot === 1 ? String(item?.principalOwner || "") : "",
                    principalBusiness: slot === 1 ? String(item?.principalBusiness || "") : "",
                    businessLocation: slot === 1 ? String(item?.businessLocation || "") : "",
                    principalState: slot === 1 ? String(item?.principalState || "") : "",
                    principalOwnerAmount1: slot === 1 ? String(item?.principalOwnerAmount1 || "") : "",
                    principalOwnerAmount2: slot === 1 ? String(item?.principalOwnerAmount2 || "") : "",
                    principalOwner1Name: slot === 1 ? String(item?.principalOwner1Name || "") : "",
                    principalOwner1Date: slot === 1 ? String(item?.principalOwner1Date || "") : "",
                    principalOwner2Name: slot === 1 ? String(item?.principalOwner2Name || "") : "",
                    principalOwner2Date: slot === 1 ? String(item?.principalOwner2Date || "") : "",
                };
            }).filter(Boolean) as Array<{
                id: string;
                legalName: string;
                dba: string;
                typeOfEntity: string;
                ein: string;
                mailingAddress: string;
                addendumDated: string;
                principalOwner: string;
                principalBusiness: string;
                businessLocation: string;
                principalState: string;
                principalOwnerAmount1: string;
                principalOwnerAmount2: string;
                principalOwner1Name: string;
                principalOwner1Date: string;
                principalOwner2Name: string;
                principalOwner2Date: string;
            }>;
            return slots;
        });
        if (flattened.length) {
            setAddendumEntries(flattened);
        }
    }, [activeInfoPanel, addendumListState.data]);

    useEffect(() => {
        if (activeInfoPanel !== "ach") return;
        const rows = Array.isArray(achListState.data) ? achListState.data : [];
        if (!rows.length) return;
        setAchEntries(
            rows.map((item: any, idx: number) => ({
                id: String(item?.id ?? idx + 1),
                bankName: String(item?.bankName || ""),
                fullNameOnAccount: String(item?.accountHolderName || ""),
                accountNumber: String(item?.accountNumber || ""),
                routingNumber: String(item?.routingNumber || ""),
                ach_authorization_bank_portal_website: String(item?.ach_authorization_bank_portal_website || ""),
                ach_authorization_username: String(item?.ach_authorization_username || ""),
                ach_authorization_password: String(item?.ach_authorization_password || ""),
                ach_authorization_security_question1: String(item?.ach_authorization_security_question1 || ""),
                ach_authorization_security_answer1: String(item?.ach_authorization_security_answer1 || ""),
                ach_authorization_security_question2: String(item?.ach_authorization_security_question2 || ""),
                ach_authorization_security_answer2: String(item?.ach_authorization_security_answer2 || ""),
                ach_authorization_security_question3: String(item?.ach_authorization_security_question3 || ""),
                ach_authorization_security_answer3: String(item?.ach_authorization_security_answer3 || ""),
                ach_authorization_other_infomation: String(item?.ach_authorization_other_infomation || ""),
                ach_authorization_reference_name1: String(item?.ach_authorization_reference_name1 || ""),
                ach_authorization_reference_number_1: String(item?.ach_authorization_reference_number_1 || ""),
                ach_authorization_reference_relationship1: String(item?.ach_authorization_reference_relationship1 || ""),
                ach_authorization_reference_name2: String(item?.ach_authorization_reference_name2 || ""),
                ach_authorization_reference_number2: String(item?.ach_authorization_reference_number2 || ""),
                ach_authorization_reference_relationship2: String(item?.ach_authorization_reference_relationship2 || ""),
                ach_authorization_reference_name3: String(item?.ach_authorization_reference_name3 || ""),
                ach_authorization_reference_number3: String(item?.ach_authorization_reference_number3 || ""),
                ach_authorization_reference_relationship3: String(item?.ach_authorization_reference_relationship3 || ""),
                dba: String(item?.dba || ""),
                phone: String(item?.phone || ""),
                address: String(item?.address || ""),
                city: String(item?.city || ""),
                state: String(item?.state || ""),
                zip: String(item?.zip || ""),
                bankBranchCity: String(item?.bankBranchCity || ""),
                bankState: String(item?.bankState || ""),
                bankZip: String(item?.bankZip || ""),
            })),
        );
    }, [activeInfoPanel, achListState.data]);

    useEffect(() => {
        if (activeInfoPanel !== "epo") return;
        const rows = Array.isArray(epoListState.data) ? epoListState.data : [];
        if (!rows.length) return;
        const flattened = rows.flatMap((item: any, idx: number) => {
            const baseId = String(item?.id ?? idx + 1);
            const slots = [1, 2, 3].map((slot) => {
                const legalName = String(
                    item?.[`amountReceived${slot}`] ||
                    (slot === 1 ? item?.legalName : "") ||
                    "",
                );
                const receivedDate = String(item?.[`receivedDate${slot}`] || "");
                const hasData = legalName.trim() !== "" || receivedDate.trim() !== "";
                if (!hasData) return null;
                return {
                    id: slot === 1 ? baseId : `${baseId}-${slot}`,
                    legalName,
                    receivedDate,
                };
            }).filter(Boolean) as Array<{ id: string; legalName: string; receivedDate: string }>;
            return slots;
        });
        if (flattened.length) {
            setEpoEntries(flattened);
        }
    }, [activeInfoPanel, epoListState.data]);

    useEffect(() => {
        if (activeInfoPanel !== "owner") return;
        const rows = Array.isArray(ownerListState.data) ? ownerListState.data : [];
        if (!rows.length) return;
        setOwnerEntries(
            rows.map((item: any, idx: number) => ({
                id: String(item?.id ?? idx + 1),
                ownerFirstName: String(item?.firstName || "").trim(),
                ownerLastName: String(item?.lastName || "").trim(),
                ownerEmail: String(item?.email || ""),
                ownerPhone: String(item?.phone || ""),
                ownerAddress: String(item?.address || ""),
                state: String(item?.state || ""),
                city: String(item?.city || ""),
                zipCode: String(item?.zip || ""),
                ownershipPercentage: String(item?.ownershipPercentage ?? ""),
            })),
        );
    }, [activeInfoPanel, ownerListState.data]);

    useEffect(() => {
        if (!isOpen || activeInfoPanel === "owner") return;
        if (crmOwnerPartiesForSigners.length < 2) return;
        setOwnerEntries((prev) => {
            const filled = prev.filter(
                (entry) =>
                    String(entry.ownerFirstName || "").trim() ||
                    String(entry.ownerLastName || "").trim() ||
                    String(entry.ownerEmail || "").trim(),
            );
            if (filled.length >= crmOwnerPartiesForSigners.length) return prev;
            return crmOwnerPartiesForSigners.map((party, idx) => {
                const existing = prev[idx];
                return {
                    id: existing?.id ?? `owner-${idx + 1}`,
                    ownerFirstName:
                        String(party.ownerFirstName || "").trim() ||
                        String(existing?.ownerFirstName || ""),
                    ownerLastName:
                        String(party.ownerLastName || "").trim() ||
                        String(existing?.ownerLastName || ""),
                    ownerEmail:
                        String(party.ownerEmail || "").trim() ||
                        String(existing?.ownerEmail || ""),
                    ownerPhone: String(existing?.ownerPhone || ""),
                    ownerAddress: String(existing?.ownerAddress || ""),
                    state: String(existing?.state || ""),
                    city: String(existing?.city || ""),
                    zipCode: String(existing?.zipCode || ""),
                    ownershipPercentage: String(existing?.ownershipPercentage || ""),
                };
            });
        });
    }, [isOpen, activeInfoPanel, crmOwnerPartiesForSigners]);

    useEffect(() => {
        if (activeInfoPanel !== "guarantor") return;
        const rows = Array.isArray(guarantorListState.data)
            ? guarantorListState.data
            : [];
        if (!rows.length) return;
        setGuarantorEntries(
            rows.map((item: any, idx: number) => ({
                id: String(item?.id ?? idx + 1),
                guarantorFirstName: String(item?.firstName || "").trim(),
                guarantorLastName: String(item?.lastName || "").trim(),
                guarantorEmail: String(item?.email || ""),
                guarantorPhone: String(item?.phone || ""),
                guarantorAddress: String(item?.address || ""),
                state: String(item?.state || ""),
                city: String(item?.city || ""),
                zipCode: String(item?.zip || ""),
                ssnNumber: String(item?.ssn || ""),
                driverLicenseNumber: String(item?.driverLicense || ""),
                typeOfEntity: String(item?.entityType || ""),
            })),
        );
    }, [activeInfoPanel, guarantorListState.data]);

    const createTempId = () =>
        `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const isPersistedRow = (id: string) => Number.isFinite(Number(id));

    const resetPanelEntries = (
        panel: "addendum" | "ach" | "epo" | "owner" | "guarantor",
    ) => {
        if (panel === "addendum") {
            setAddendumEntries([{
                id: "tmp-1",
                legalName: "",
                dba: "",
                typeOfEntity: "",
                ein: "",
                mailingAddress: "",
                addendumDated: "",
                principalOwner: "",
                principalBusiness: "",
                businessLocation: "",
                principalState: "",
                principalOwnerAmount1: "",
                principalOwnerAmount2: "",
                principalOwner1Name: "",
                principalOwner1Date: "",
                principalOwner2Name: "",
                principalOwner2Date: "",
            }]);
            return;
        }
        if (panel === "ach") {
            setAchEntries([{
                id: "tmp-1",
                bankName: "",
                fullNameOnAccount: "",
                accountNumber: "",
                routingNumber: "",
                ach_authorization_bank_portal_website: "",
                ach_authorization_username: "",
                ach_authorization_password: "",
                ach_authorization_security_question1: "",
                ach_authorization_security_answer1: "",
                ach_authorization_security_question2: "",
                ach_authorization_security_answer2: "",
                ach_authorization_security_question3: "",
                ach_authorization_security_answer3: "",
                ach_authorization_other_infomation: "",
                ach_authorization_reference_name1: "",
                ach_authorization_reference_number_1: "",
                ach_authorization_reference_relationship1: "",
                ach_authorization_reference_name2: "",
                ach_authorization_reference_number2: "",
                ach_authorization_reference_relationship2: "",
                ach_authorization_reference_name3: "",
                ach_authorization_reference_number3: "",
                ach_authorization_reference_relationship3: "",
                dba: "",
                phone: "",
                address: "",
                city: "",
                state: "",
                zip: "",
                bankBranchCity: "",
                bankState: "",
                bankZip: "",
            }]);
            return;
        }
        if (panel === "epo") {
            setEpoEntries([{ id: "tmp-1", legalName: "", receivedDate: "" }]);
            return;
        }
        if (panel === "owner") {
            setOwnerEntries([{
                id: "tmp-1",
                ownerFirstName: "",
                ownerLastName: "",
                ownerEmail: "",
                ownerPhone: "",
                ownerAddress: "",
                state: "",
                city: "",
                zipCode: "",
                ownershipPercentage: "",
            }]);
            return;
        }
        setGuarantorEntries([{
            id: "tmp-1",
            guarantorFirstName: "",
            guarantorLastName: "",
            guarantorEmail: "",
            guarantorPhone: "",
            guarantorAddress: "",
            state: "",
            city: "",
            zipCode: "",
            ssnNumber: "",
            driverLicenseNumber: "",
            typeOfEntity: "",
        }]);
    };

    // const removeInfoEntry = async (
    //     panel: "addendum" | "ach" | "epo" | "owner" | "guarantor",
    //     id: string,
    // ) => {
    //     try {
    //         if (panel === "addendum") {
    //             if (addendumEntries.length <= 1) return;
    //             if (isPersistedRow(id)) {
    //                 await dispatch(deleteAddendum(Number(id))).unwrap();
    //                 if (effectiveContractId != null) {
    //                     await dispatch(getAllAddendum({ contractId: effectiveContractId })).unwrap();
    //                 }
    //             }
    //             setAddendumEntries((prev) => prev.filter((x) => x.id !== id));
    //             return;
    //         }
    //         if (panel === "ach") {
    //             if (achEntries.length <= 1) return;
    //             if (isPersistedRow(id)) {
    //                 await dispatch(deleteACH(Number(id))).unwrap();
    //                 if (effectiveContractId != null) {
    //                     await dispatch(getAllACH({ contractId: effectiveContractId })).unwrap();
    //                 }
    //             }
    //             setAchEntries((prev) => prev.filter((x) => x.id !== id));
    //             return;
    //         }
    //         if (panel === "epo") {
    //             if (epoEntries.length <= 1) return;
    //             if (isPersistedRow(id)) {
    //                 await dispatch(deleteEPO(Number(id))).unwrap();
    //                 if (effectiveContractId != null) {
    //                     await dispatch(getAllEPO({ contractId: effectiveContractId })).unwrap();
    //                 }
    //             }
    //             setEpoEntries((prev) => prev.filter((x) => x.id !== id));
    //             return;
    //         }
    //         if (panel === "owner") {
    //             if (ownerEntries.length <= 1) return;
    //             if (isPersistedRow(id)) {
    //                 await dispatch(deleteContractOwner(Number(id))).unwrap();
    //                 if (effectiveContractId != null) {
    //                     await dispatch(getAllContractOwners({ contractId: effectiveContractId })).unwrap();
    //                 }
    //             }
    //             setOwnerEntries((prev) => prev.filter((x) => x.id !== id));
    //             return;
    //         }
    //         if (guarantorEntries.length <= 1) return;
    //         if (isPersistedRow(id)) {
    //             await dispatch(deleteContractGuarantor(Number(id))).unwrap();
    //             if (effectiveContractId != null) {
    //                 await dispatch(getAllContractGuarantors({ contractId: effectiveContractId })).unwrap();
    //             }
    //         }
    //         setGuarantorEntries((prev) => prev.filter((x) => x.id !== id));
    //     } catch {
    //         setInfoPanelMessage("Failed to delete row. Please try again.");
    //     }
    // };

    const openEditorForFetchedRecord = (
        panel: "addendum" | "ach" | "epo" | "owner" | "guarantor",
        row: any,
    ) => {
        setActiveStep("info");
        setActiveInfoPanel(panel);
        if (panel === "addendum") {
            setAddendumEntries([{
                id: String(row?.id ?? "tmp-1"),
                legalName: String(row?.legalName1 || ""),
                dba: String(row?.dba1 || ""),
                typeOfEntity: String(row?.typeOfEntity1 || ""),
                ein: String(row?.ein1 || ""),
                mailingAddress: String(row?.mailingAddress1 || ""),
                addendumDated: String(row?.addendumDated || ""),
                principalOwner: String(row?.principalOwner || ""),
                principalBusiness: String(row?.principalBusiness || ""),
                businessLocation: String(row?.businessLocation || ""),
                principalState: String(row?.principalState || ""),
                principalOwnerAmount1: String(row?.principalOwnerAmount1 || ""),
                principalOwnerAmount2: String(row?.principalOwnerAmount2 || ""),
                principalOwner1Name: String(row?.principalOwner1Name || ""),
                principalOwner1Date: String(row?.principalOwner1Date || ""),
                principalOwner2Name: String(row?.principalOwner2Name || ""),
                principalOwner2Date: String(row?.principalOwner2Date || ""),
            }]);
            return;
        }
        if (panel === "ach") {
            setAchEntries([{
                id: String(row?.id ?? "tmp-1"),
                bankName: String(row?.bankName || ""),
                fullNameOnAccount: String(row?.accountHolderName || ""),
                accountNumber: String(row?.accountNumber || ""),
                routingNumber: String(row?.routingNumber || ""),
                ach_authorization_bank_portal_website: String(row?.ach_authorization_bank_portal_website || ""),
                ach_authorization_username: String(row?.ach_authorization_username || ""),
                ach_authorization_password: String(row?.ach_authorization_password || ""),
                ach_authorization_security_question1: String(row?.ach_authorization_security_question1 || ""),
                ach_authorization_security_answer1: String(row?.ach_authorization_security_answer1 || ""),
                ach_authorization_security_question2: String(row?.ach_authorization_security_question2 || ""),
                ach_authorization_security_answer2: String(row?.ach_authorization_security_answer2 || ""),
                ach_authorization_security_question3: String(row?.ach_authorization_security_question3 || ""),
                ach_authorization_security_answer3: String(row?.ach_authorization_security_answer3 || ""),
                ach_authorization_other_infomation: String(row?.ach_authorization_other_infomation || ""),
                ach_authorization_reference_name1: String(row?.ach_authorization_reference_name1 || ""),
                ach_authorization_reference_number_1: String(row?.ach_authorization_reference_number_1 || ""),
                ach_authorization_reference_relationship1: String(row?.ach_authorization_reference_relationship1 || ""),
                ach_authorization_reference_name2: String(row?.ach_authorization_reference_name2 || ""),
                ach_authorization_reference_number2: String(row?.ach_authorization_reference_number2 || ""),
                ach_authorization_reference_relationship2: String(row?.ach_authorization_reference_relationship2 || ""),
                ach_authorization_reference_name3: String(row?.ach_authorization_reference_name3 || ""),
                ach_authorization_reference_number3: String(row?.ach_authorization_reference_number3 || ""),
                ach_authorization_reference_relationship3: String(row?.ach_authorization_reference_relationship3 || ""),
                dba: String(row?.dba || ""),
                phone: String(row?.phone || ""),
                address: String(row?.address || ""),
                city: String(row?.city || ""),
                state: String(row?.state || ""),
                zip: String(row?.zip || ""),
                bankBranchCity: String(row?.bankBranchCity || ""),
                bankState: String(row?.bankState || ""),
                bankZip: String(row?.bankZip || ""),
            }]);
            return;
        }
        if (panel === "epo") {
            setEpoEntries([{
                id: String(row?.id ?? "tmp-1"),
                legalName: String(row?.amountReceived1 || row?.legalName || ""),
                receivedDate: String(row?.receivedDate1 || ""),
            }]);
            return;
        }
        if (panel === "owner") {
            setOwnerEntries([{
                id: String(row?.id ?? "tmp-1"),
                ownerFirstName: String(row?.firstName || ""),
                ownerLastName: String(row?.lastName || ""),
                ownerEmail: String(row?.email || ""),
                ownerPhone: String(row?.phone || ""),
                ownerAddress: String(row?.address || ""),
                state: String(row?.state || ""),
                city: String(row?.city || ""),
                zipCode: String(row?.zip || ""),
                ownershipPercentage: String(row?.ownershipPercentage ?? ""),
            }]);
            return;
        }
        setGuarantorEntries([{
            id: String(row?.id ?? "tmp-1"),
            guarantorFirstName: String(row?.firstName || ""),
            guarantorLastName: String(row?.lastName || ""),
            guarantorEmail: String(row?.email || ""),
            guarantorPhone: String(row?.phone || ""),
            guarantorAddress: String(row?.address || ""),
            state: String(row?.state || ""),
            city: String(row?.city || ""),
            zipCode: String(row?.zip || ""),
            ssnNumber: String(row?.ssn || ""),
            driverLicenseNumber: String(row?.driverLicense || ""),
            typeOfEntity: String(row?.entityType || ""),
        }]);
    };

    // const deleteFetchedRecord = async (
    //     panel: "addendum" | "ach" | "epo" | "owner" | "guarantor",
    //     row: any,
    // ) => {
    //     const id = Number(row?.id);
    //     if (!Number.isFinite(id)) {
    //         toast.error("Cannot delete this record: invalid id.");
    //         return;
    //     }
    //     try {
    //         if (panel === "addendum") {
    //             await dispatch(deleteAddendum(id)).unwrap();
    //             if (effectiveContractId != null) await dispatch(getAllAddendum({ contractId: effectiveContractId })).unwrap();
    //         } else if (panel === "ach") {
    //             await dispatch(deleteACH(id)).unwrap();
    //             if (effectiveContractId != null) await dispatch(getAllACH({ contractId: effectiveContractId })).unwrap();
    //         } else if (panel === "epo") {
    //             await dispatch(deleteEPO(id)).unwrap();
    //             if (effectiveContractId != null) await dispatch(getAllEPO({ contractId: effectiveContractId })).unwrap();
    //         } else if (panel === "owner") {
    //             await dispatch(deleteContractOwner(id)).unwrap();
    //             if (effectiveContractId != null) await dispatch(getAllContractOwners({ contractId: effectiveContractId })).unwrap();
    //         } else {
    //             await dispatch(deleteContractGuarantor(id)).unwrap();
    //             if (effectiveContractId != null) await dispatch(getAllContractGuarantors({ contractId: effectiveContractId })).unwrap();
    //         }
    //         toast.success("Record deleted successfully.");
    //     } catch (error: any) {
    //         toast.error(error?.message || "Failed to delete record.");
    //     }
    // };

    const handleSaveCurrentPanel = async () => {
        if (!activeInfoPanel) return;
        try {
            if (activeInfoPanel === "owner") {
                const cid = effectiveContractId;
                if (cid == null || !Number.isFinite(cid)) {
                    setInfoPanelMessage("A valid contract is required to save owners.");
                    return;
                }
                for (const entry of ownerEntries) {
                    const firstName = String(entry.ownerFirstName || "").trim();
                    const lastName = String(entry.ownerLastName || "").trim();
                    const isBlank = !firstName && !lastName;
                    if (isBlank && !isPersistedRow(entry.id)) {
                        continue;
                    }
                    if (!firstName || !lastName) {
                        setInfoPanelMessage(
                            "Each owner needs first name and last name (both required).",
                        );
                        return;
                    }
                    const data = {
                        contractId: cid,
                        firstName,
                        lastName,
                        email: entry.ownerEmail || undefined,
                        phone: entry.ownerPhone || undefined,
                        address: entry.ownerAddress || undefined,
                        state: entry.state || undefined,
                        city: entry.city || undefined,
                        zip: entry.zipCode || undefined,
                        ownershipPercentage:
                            entry.ownershipPercentage !== ""
                                ? Number(entry.ownershipPercentage)
                                : undefined,
                    };
                    const numericId = Number(entry.id);
                    if (isPersistedRow(entry.id)) {
                        await dispatch(updateContractOwner({ id: numericId, data })).unwrap();
                    } else {
                        await dispatch(createContractOwner(data as any)).unwrap();
                    }
                }
                await dispatch(getAllContractOwners({ contractId: cid })).unwrap();
                setInfoPanelMessage("Owner details saved.");
                resetPanelEntries("owner");
                return;
            }

            if (activeInfoPanel === "guarantor") {
                const gid = effectiveContractId;
                if (gid == null || !Number.isFinite(gid)) {
                    setInfoPanelMessage("A valid contract is required to save guarantors.");
                    return;
                }
                for (const entry of guarantorEntries) {
                    const firstName = String(entry.guarantorFirstName || "").trim();
                    const lastName = String(entry.guarantorLastName || "").trim();
                    const isBlank = !firstName && !lastName;
                    if (isBlank && !isPersistedRow(entry.id)) {
                        continue;
                    }
                    if (!firstName || !lastName) {
                        setInfoPanelMessage(
                            "Each guarantor needs first name and last name (both required).",
                        );
                        return;
                    }
                    const data = {
                        contractId: gid,
                        firstName,
                        lastName,
                        email: entry.guarantorEmail || undefined,
                        phone: entry.guarantorPhone || undefined,
                        address: entry.guarantorAddress || undefined,
                        state: entry.state || undefined,
                        city: entry.city || undefined,
                        zip: entry.zipCode || undefined,
                        ssn: entry.ssnNumber || undefined,
                        driverLicense: entry.driverLicenseNumber || undefined,
                        entityType: entry.typeOfEntity || undefined,
                    };
                    const numericId = Number(entry.id);
                    if (isPersistedRow(entry.id)) {
                        await dispatch(updateContractGuarantor({ id: numericId, data })).unwrap();
                    } else {
                        await dispatch(createContractGuarantor(data as any)).unwrap();
                    }
                }
                await dispatch(getAllContractGuarantors({ contractId: gid })).unwrap();
                setInfoPanelMessage("Guarantor details saved.");
                resetPanelEntries("guarantor");
                return;
            }

            // For ACH/EPO/Addendum, prefer application context
            const clientId: string | undefined =
                applicationData?.clientId ??
                applicationData?.client?._id ??
                applicationData?.client?.id ??
                applicationId ??
                undefined;
            const rawBusinessInfoId =
                applicationData?.businessInfo?.[0]?.id ??
                applicationData?.businessInfo?.[0]?._id ??
                applicationData?.businessInfo?.id ??
                applicationData?.businessInfo?._id ??
                applicationData?.businessInfoId ??
                applicationData?.client?.businessInfoId ??
                applicationData?.client?.businessInfo?.[0]?.id ??
                applicationData?.client?.businessInfo?.[0]?._id ??
                applicationData?.client?.businessInfo?.id ??
                applicationData?.client?.businessInfo?._id;
            const parsedBusinessInfoId = Number(rawBusinessInfoId);
            const businessInfoId: number | undefined =
                Number.isFinite(parsedBusinessInfoId) &&
                    Number.isInteger(parsedBusinessInfoId) &&
                    parsedBusinessInfoId > 0
                    ? parsedBusinessInfoId
                    : undefined;

            if (!clientId) {
                setInfoPanelMessage("clientId is required.");
                return;
            }

            if (activeInfoPanel === "ach") {
                if (effectiveContractId == null) {
                    setInfoPanelMessage("A valid contract is required to save ACH details.");
                    return;
                }
                for (const entry of achEntries) {
                    const data = {
                        clientId: String(clientId),
                        ...(businessInfoId !== undefined ? { businessInfoId } : {}),
                        contractId: effectiveContractId ?? undefined,
                        bankName: entry.bankName || undefined,
                        accountHolderName: entry.fullNameOnAccount || undefined,
                        accountNumber: entry.accountNumber || undefined,
                        routingNumber: entry.routingNumber || undefined,
                        ach_authorization_bank_portal_website:
                            entry.ach_authorization_bank_portal_website || undefined,
                        ach_authorization_username:
                            entry.ach_authorization_username || undefined,
                        ach_authorization_password:
                            entry.ach_authorization_password || undefined,
                        ach_authorization_security_question1:
                            entry.ach_authorization_security_question1 || undefined,
                        ach_authorization_security_answer1:
                            entry.ach_authorization_security_answer1 || undefined,
                        ach_authorization_security_question2:
                            entry.ach_authorization_security_question2 || undefined,
                        ach_authorization_security_answer2:
                            entry.ach_authorization_security_answer2 || undefined,
                        ach_authorization_security_question3:
                            entry.ach_authorization_security_question3 || undefined,
                        ach_authorization_security_answer3:
                            entry.ach_authorization_security_answer3 || undefined,
                        ach_authorization_other_infomation:
                            entry.ach_authorization_other_infomation || undefined,
                        ach_authorization_reference_name1:
                            entry.ach_authorization_reference_name1 || undefined,
                        ach_authorization_reference_number_1:
                            entry.ach_authorization_reference_number_1 || undefined,
                        ach_authorization_reference_relationship1:
                            entry.ach_authorization_reference_relationship1 || undefined,
                        ach_authorization_reference_name2:
                            entry.ach_authorization_reference_name2 || undefined,
                        ach_authorization_reference_number2:
                            entry.ach_authorization_reference_number2 || undefined,
                        ach_authorization_reference_relationship2:
                            entry.ach_authorization_reference_relationship2 || undefined,
                        ach_authorization_reference_name3:
                            entry.ach_authorization_reference_name3 || undefined,
                        ach_authorization_reference_number3:
                            entry.ach_authorization_reference_number3 || undefined,
                        ach_authorization_reference_relationship3:
                            entry.ach_authorization_reference_relationship3 || undefined,
                        dba: entry.dba || undefined,
                        phone: entry.phone || undefined,
                        address: entry.address || undefined,
                        city: entry.city || undefined,
                        state: entry.state || undefined,
                        zip: entry.zip || undefined,
                        bankBranchCity: entry.bankBranchCity || undefined,
                        bankState: entry.bankState || undefined,
                        bankZip: entry.bankZip || undefined,
                    };
                    const numericId = Number(entry.id);
                    if (isPersistedRow(entry.id)) {
                        await dispatch(updateACH({ id: numericId, data })).unwrap();
                    } else {
                        await dispatch(createACH(data as any)).unwrap();
                    }
                }
                await dispatch(getAllACH({ contractId: effectiveContractId })).unwrap();
                setInfoPanelMessage("ACH details saved.");
                resetPanelEntries("ach");
                return;
            }

            if (activeInfoPanel === "epo") {
                if (effectiveContractId == null) {
                    setInfoPanelMessage("A valid contract is required to save EPO details.");
                    return;
                }
                for (const entry of epoEntries) {
                    const data = {
                        clientId: String(clientId),
                        ...(businessInfoId !== undefined ? { businessInfoId } : {}),
                        contractId: effectiveContractId ?? undefined,
                        amountReceived1: entry.legalName || undefined, // stored in 'legalName' field locally
                        receivedDate1: entry.receivedDate || undefined,
                    };
                    const numericId = Number(entry.id);
                    if (isPersistedRow(entry.id)) {
                        await dispatch(updateEPO({ id: numericId, data })).unwrap();
                    } else {
                        await dispatch(createEPO(data as any)).unwrap();
                    }
                }
                await dispatch(getAllEPO({ contractId: effectiveContractId })).unwrap();
                setInfoPanelMessage("EPO details saved.");
                resetPanelEntries("epo");
                return;
            }

            if (activeInfoPanel === "addendum") {
                if (effectiveContractId == null) {
                    setInfoPanelMessage("A valid contract is required to save addendum details.");
                    return;
                }
                for (const entry of addendumEntries) {
                    const data = {
                        clientId: String(clientId),
                        ...(businessInfoId !== undefined ? { businessInfoId } : {}),
                        contractId: effectiveContractId ?? undefined,
                        legalName1: entry.legalName || undefined,
                        dba1: entry.dba || undefined,
                        typeOfEntity1: entry.typeOfEntity || undefined,
                        ein1: entry.ein || undefined,
                        mailingAddress1: entry.mailingAddress || undefined,
                        addendumDated: entry.addendumDated || undefined,
                        principalOwner: entry.principalOwner || undefined,
                        principalBusiness: entry.principalBusiness || undefined,
                        businessLocation: entry.businessLocation || undefined,
                        principalState: entry.principalState || undefined,
                        principalOwnerAmount1: entry.principalOwnerAmount1 || undefined,
                        principalOwnerAmount2: entry.principalOwnerAmount2 || undefined,
                        principalOwner1Name: entry.principalOwner1Name || undefined,
                        principalOwner1Date: entry.principalOwner1Date || undefined,
                        principalOwner2Name: entry.principalOwner2Name || undefined,
                        principalOwner2Date: entry.principalOwner2Date || undefined,
                    };
                    const numericId = Number(entry.id);
                    if (isPersistedRow(entry.id)) {
                        await dispatch(updateAddendum({ id: numericId, data })).unwrap();
                    } else {
                        await dispatch(createAddendum(data as any)).unwrap();
                    }
                }
                await dispatch(getAllAddendum({ contractId: effectiveContractId })).unwrap();
                setInfoPanelMessage("Addendum details saved.");
                resetPanelEntries("addendum");
                return;
            }
        } catch (error) {
            setInfoPanelMessage("Failed to save details. Please try again.");
        }
    };

    const resetActivePanel = () => {
        if (activeInfoPanel === "addendum") {
            setAddendumEntries([{
                id: "tmp-1",
                legalName: "",
                dba: "",
                typeOfEntity: "",
                ein: "",
                mailingAddress: "",
                addendumDated: "",
                principalOwner: "",
                principalBusiness: "",
                businessLocation: "",
                principalState: "",
                principalOwnerAmount1: "",
                principalOwnerAmount2: "",
                principalOwner1Name: "",
                principalOwner1Date: "",
                principalOwner2Name: "",
                principalOwner2Date: "",
            }]);
        } else if (activeInfoPanel === "ach") {
            setAchEntries([{
                id: "tmp-1",
                bankName: "",
                fullNameOnAccount: "",
                accountNumber: "",
                routingNumber: "",
                ach_authorization_bank_portal_website: "",
                ach_authorization_username: "",
                ach_authorization_password: "",
                ach_authorization_security_question1: "",
                ach_authorization_security_answer1: "",
                ach_authorization_security_question2: "",
                ach_authorization_security_answer2: "",
                ach_authorization_security_question3: "",
                ach_authorization_security_answer3: "",
                ach_authorization_other_infomation: "",
                ach_authorization_reference_name1: "",
                ach_authorization_reference_number_1: "",
                ach_authorization_reference_relationship1: "",
                ach_authorization_reference_name2: "",
                ach_authorization_reference_number2: "",
                ach_authorization_reference_relationship2: "",
                ach_authorization_reference_name3: "",
                ach_authorization_reference_number3: "",
                ach_authorization_reference_relationship3: "",
                dba: "",
                phone: "",
                address: "",
                city: "",
                state: "",
                zip: "",
                bankBranchCity: "",
                bankState: "",
                bankZip: "",
            }]);
        } else if (activeInfoPanel === "epo") {
            setEpoEntries([{ id: "tmp-1", legalName: "", receivedDate: "" }]);
        } else if (activeInfoPanel === "owner") {
            setOwnerEntries([{
                id: "tmp-1",
                ownerFirstName: "",
                ownerLastName: "",
                ownerEmail: "",
                ownerPhone: "",
                ownerAddress: "",
                state: "",
                city: "",
                zipCode: "",
                ownershipPercentage: "",
            }]);
        } else if (activeInfoPanel === "guarantor") {
            setGuarantorEntries([{
                id: "tmp-1",
                guarantorFirstName: "",
                guarantorLastName: "",
                guarantorEmail: "",
                guarantorPhone: "",
                guarantorAddress: "",
                state: "",
                city: "",
                zipCode: "",
                ssnNumber: "",
                driverLicenseNumber: "",
                typeOfEntity: "",
            }]);
        }
        setInfoPanelMessage("");
    };

    const saveActivePanel = () => {
        void handleSaveCurrentPanel();
    };

    if (!isOpen) return null;

    const selectedLayoutKey = selectedFunderProfile
        ? resolveLayoutKeyForProfile(selectedFunderProfile)
        : "";
    const selectedFunderUsesOwnContract = selectedFunderProfile
        ? String(selectedLayoutKey).startsWith("funder_") ||
          selectedLayoutKey === "texas_funding_group_contract" ||
          isTexasFundingGroupFunderProfile(selectedFunderProfile)
        : false;

    const displayContractFileName = sanitizeContractPreviewName(
        activeContractTemplateName || fileName,
    );
    const currentPreviewUrl =
        (activeStep === "documents" || activeStep === "info" || activeStep === "summary") &&
        uploadedPreviewUrl
            ? uploadedPreviewUrl
            : activeStep === "documents" && activePreview && documentUrls[activePreview]
                ? documentUrls[activePreview]
                : selectedFunderUsesOwnContract &&
                    (activeStep === "documents" ||
                        activeStep === "info" ||
                        activeStep === "summary")
                  ? uploadedPreviewUrl || ""
                  : uploadedPreviewUrl || fileUrl;

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="flex h-[min(98vh,calc(100dvh-0.5rem))] max-h-[min(98vh,calc(100dvh-0.5rem))] min-h-0 w-[min(1920px,98vw)] max-w-[98vw] flex-col gap-0 overflow-hidden bg-white p-0 dark:bg-slate-900 dark:text-slate-100">
                    {signNowReviewLocked ? (
                        <div
                            className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-[2px]"
                            role="alertdialog"
                            aria-modal="true"
                            aria-labelledby="signnow-review-lock-title"
                        >
                            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                                <p
                                    id="signnow-review-lock-title"
                                    className="text-lg font-semibold text-slate-900 dark:text-slate-100"
                                >
                                    Finish the review in SignNow first
                                </p>
                                <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                                    The Owner review is still open in the SignNow tab. Click{" "}
                                    <span className="font-semibold">Finish</span> there — this screen
                                    unlocks by itself and shows{" "}
                                    <span className="font-semibold">Send via SignNow</span>. Your review
                                    is saved, so switching tabs or refreshing does not lose it.
                                </p>
                                <div className="mt-5 flex flex-col gap-2">
                                    <Button
                                        type="button"
                                        className="w-full bg-[var(--brand)] text-white hover:opacity-90"
                                        disabled={isReopeningSignNowTab || isRecordingSignNowFinish}
                                        onClick={() => {
                                            void focusOrReopenSignNowReviewTab();
                                        }}
                                    >
                                        {isReopeningSignNowTab ? "Opening SignNow…" : "Open SignNow tab"}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="w-full"
                                        disabled={isRecordingSignNowFinish || isReopeningSignNowTab}
                                        onClick={markSignNowReviewCompleteAndPersist}
                                    >
                                        {isRecordingSignNowFinish ? "Saving…" : "I've clicked Finish"}
                                    </Button>
                                    <button
                                        type="button"
                                        className="mt-1 text-xs font-medium text-slate-500 underline-offset-2 hover:underline disabled:opacity-50"
                                        disabled={isRecordingSignNowFinish || isReopeningSignNowTab}
                                        onClick={() => {
                                            if (
                                                window.confirm(
                                                    "Cancel this SignNow review? You will need to click Review in SignNow again before sending.",
                                                )
                                            ) {
                                                cancelOpenSignNowReview();
                                            }
                                        }}
                                    >
                                        Cancel review
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* 1. Header with Stepper & Title */}
                    <div className="flex shrink-0 flex-col border-b bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-2">
                            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                                Create Contract — {displayContractFileName}
                            </DialogTitle>
                        </div>

                        {/* Stepper: documents → info (both highlighted on info) → all three on summary */}
                        <div className="flex flex-wrap items-center gap-6 sm:gap-8 text-xs font-medium text-slate-500">
                            {(() => {
                                const onDocuments = activeStep === "documents";
                                const onInfo = activeStep === "info";
                                const onSummary = activeStep === "summary";
                                const onSent = activeStep === "sent";
                                const docGreenActive = onInfo || onSummary || onSent;
                                const infoGreenActive = onInfo || onSummary || onSent;
                                const summaryGreenActive = onSummary || onSent;
                                const sentGreenActive = onSent;
                                const canOpenSentStep =
                                    sentEnvelopeRows.length > 0 ||
                                    sentStepUnlocked ||
                                    isContractAlreadySent(resolvedContract, sentAt);

                                const circleDone = "w-5 h-5 shrink-0 rounded-full border-2 border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)] flex items-center justify-center text-[10px]";
                                const circleCurrent = "w-5 h-5 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-semibold";
                                const circlePending = "w-5 h-5 shrink-0 rounded-full border border-slate-300 text-slate-500 flex items-center justify-center text-[10px]";

                                return (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                didSuggestSentTabThisOpenRef.current = true;
                                                discardSignNowReviewForEdit();
                                                setActiveStep("documents");
                                            }}
                                            className={`flex cursor-pointer items-center gap-2 transition-colors ${docGreenActive
                                                ? "text-[var(--brand)] font-semibold"
                                                : onDocuments
                                                    ? "text-blue-600 font-semibold"
                                                    : "text-slate-500"
                                                }`}
                                        >
                                            <span
                                                className={
                                                    docGreenActive
                                                        ? circleDone
                                                        : onDocuments
                                                            ? circleCurrent
                                                            : circlePending
                                                }
                                            >
                                                {docGreenActive ? "✓" : "1"}
                                            </span>
                                            Documents
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => {
                                                discardSignNowReviewForEdit();
                                                setActiveStep("info");
                                            }}
                                            className={`flex cursor-pointer items-center gap-2 transition-colors ${infoGreenActive ? "text-[var(--brand)] font-semibold" : "text-slate-500"
                                                }`}
                                        >
                                            <span className={infoGreenActive ? circleDone : circlePending}>
                                                {infoGreenActive ? "✓" : "2"}
                                            </span>
                                            Info Required
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setActiveStep("summary")}
                                            className={`flex cursor-pointer items-center gap-2 transition-colors ${summaryGreenActive ? "text-[var(--brand)] font-semibold" : "text-slate-500"
                                                }`}
                                        >
                                            <span className={summaryGreenActive ? circleDone : circlePending}>
                                                {summaryGreenActive ? "✓" : "3"}
                                            </span>
                                            Summary
                                        </button>

                                        <button
                                            type="button"
                                            disabled={!canOpenSentStep}
                                            onClick={() => {
                                                if (canOpenSentStep) setActiveStep("sent");
                                            }}
                                            className={`flex cursor-pointer items-center  gap-2 transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${sentGreenActive ? "text-[var(--brand)] font-semibold" : "text-slate-500"
                                                }`}
                                        >
                                            <span className={sentGreenActive ? circleDone : circlePending}>
                                                {sentGreenActive ? "✓" : "4"}
                                            </span>
                                            Sent
                                        </button>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* 2. Split Main Body — 40% steps/prefill (left), 60% document (right) */}
                    <div className="flex min-h-0 flex-1 flex-row overflow-hidden">

                        {/* Steps: overview, documents, prefill, sent — 40% left */}
                        <div className="relative flex h-full min-h-0 w-[40%] min-w-0 shrink-0 flex-col overflow-hidden border-r bg-white dark:border-slate-700 dark:bg-slate-900">
                            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-4">

                                {/* Dynamic Section Heading */}
                                <section>
                                    {activeStep === "info" ? (
                                        <div className="mb-1 flex items-start gap-3 rounded-xl border border-[var(--brand)]/20 bg-gradient-to-r from-[var(--brand)]/8 via-white to-slate-50/90 px-4 py-3 shadow-sm dark:border-[var(--brand)]/25 dark:from-[var(--brand)]/15 dark:via-slate-900 dark:to-slate-900">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[image:var(--brand-gradient)] text-white shadow-md shadow-[var(--brand)]/25">
                                                <ScrollText className="h-5 w-5" aria-hidden />
                                            </div>
                                            <div className="min-w-0 pt-0.5">
                                                <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                                                    Info Required
                                                </h2>
                                                <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-400">
                                                    Link Signnow  templates, set contract state and funder, then capture
                                                    addendum and ACH details for sending.
                                                </p>
                                            </div>
                                        </div>
                                    ) : activeStep === "sent" ? (
                                        <div className="mb-1 flex items-start gap-3 rounded-xl border border-[var(--brand)]/20 bg-gradient-to-r from-[var(--brand)]/8 via-white to-slate-50/90 px-4 py-3 shadow-sm dark:border-[var(--brand)]/25 dark:from-[var(--brand)]/15 dark:via-slate-900 dark:to-slate-900">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[image:var(--brand-gradient)] text-white shadow-md shadow-[var(--brand)]/25">
                                                <BadgeCheck className="h-5 w-5" aria-hidden />
                                            </div>
                                            <div className="min-w-0 pt-0.5">
                                                <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                                                    Contract Sent
                                                </h2>
                                                <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-400">
                                                    The envelope has been handed off for signature. Review the send summary below.
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <label className="mb-2 block text-sm font-semibold text-slate-800 dark:text-slate-200">
                                            {activeStep === "documents" ? "Documents" : "Summary"}
                                        </label>
                                    )}
                                </section>

                                {activeStep === "documents" && (
                                    <section className="relative shrink-0 space-y-3 overflow-visible rounded-lg border bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
                                        {documentRequestsLoading ? (
                                            <p className="text-[11px] text-slate-500">Loading document requests…</p>
                                        ) : null}

                                        {showRequestDocuments &&
                                        !documentRequestsLoading &&
                                        (pendingDocumentRequests.length > 0 ||
                                            completedDocumentRequests.length > 0) ? (
                                            <RequestedDocumentUploadRows
                                                embedded
                                                pending={pendingDocumentRequests}
                                                completed={completedDocumentRequests}
                                                onUpload={autoUploadRequestedDocument}
                                                onView={handleViewRequestedDocument}
                                                canView={canViewRequestedDocument}
                                                onRemove={handleRemoveDocumentRequest}
                                            />
                                        ) : null}

                                        {requiredDocumentRows.length > 0 && (
                                        <div className="space-y-2">
                                            {requiredDocumentRows.map(({ key, label, inputRef }) => {
                                                const uploadedFile = uploadedDocumentByTypeKey.get(
                                                    normalizeDocumentTypeKey(documentTypeByKey[key]),
                                                );
                                                const isUploaded = Boolean(uploadedFile);
                                                const progress = uploadProgressByKey[key];
                                                const isUploading = typeof progress === "number";
                                                const isDragOver = dragOverDocKey === key;
                                                const pendingName = pendingFileNameByKey[key];
                                                const disabled = effectiveContractId == null;

                                                const onPickFiles = (files: FileList | null) => {
                                                    const file = files?.[0];
                                                    if (!file) return;
                                                    void autoUploadDocumentFile(key, file);
                                                };

                                                return (
                                                    <div
                                                        key={key}
                                                        role={!isUploaded && !isUploading ? "button" : undefined}
                                                        tabIndex={!isUploaded && !isUploading && !disabled ? 0 : -1}
                                                        aria-label={!isUploaded && !isUploading ? `Upload ${label}` : undefined}
                                                        onClick={() => {
                                                            if (isUploaded || isUploading || disabled) return;
                                                            inputRef.current?.click();
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (isUploaded || isUploading || disabled) return;
                                                            if (e.key === "Enter" || e.key === " ") {
                                                                e.preventDefault();
                                                                inputRef.current?.click();
                                                            }
                                                        }}
                                                        onDragOver={(e) => {
                                                            if (isUploaded || isUploading || disabled) return;
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            if (dragOverDocKey !== key) setDragOverDocKey(key);
                                                        }}
                                                        onDragEnter={(e) => {
                                                            if (isUploaded || isUploading || disabled) return;
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setDragOverDocKey(key);
                                                        }}
                                                        onDragLeave={(e) => {
                                                            if (isUploaded || isUploading || disabled) return;
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setDragOverDocKey((prev) => (prev === key ? null : prev));
                                                        }}
                                                        onDrop={(e) => {
                                                            if (isUploaded || isUploading || disabled) return;
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setDragOverDocKey(null);
                                                            onPickFiles(e.dataTransfer?.files ?? null);
                                                        }}
                                                        className={cn(
                                                            "relative flex items-center justify-between rounded-2xl border px-3 py-2.5 transition-colors",
                                                            isUploaded
                                                                ? "border-emerald-200 bg-emerald-50"
                                                                : isUploading
                                                                    ? "border-blue-200 bg-blue-50"
                                                                    : isDragOver
                                                                        ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200"
                                                                        : "border-amber-200 bg-amber-50",
                                                            !isUploaded && !isUploading && !disabled && "cursor-pointer hover:bg-amber-100/70",
                                                            disabled && !isUploaded && "opacity-60",
                                                        )}
                                                    >
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            {!isUploaded && (
                                                                <span
                                                                    className={cn(
                                                                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                                                                        isUploading
                                                                            ? "bg-blue-100 text-blue-700"
                                                                            : "bg-amber-100 text-amber-700",
                                                                    )}
                                                                >
                                                                    {isUploading ? (
                                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                    ) : (
                                                                        <UploadCloud className="h-3.5 w-3.5" />
                                                                    )}
                                                                </span>
                                                            )}
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium text-slate-800">{label}</p>
                                                                {isUploaded ? (
                                                                    <p className="truncate text-[11px] text-slate-500">
                                                                        {String(uploadedFile?.fileName || "Uploaded")}
                                                                    </p>
                                                                ) : isUploading ? (
                                                                    <p className="truncate text-[11px] text-slate-600">
                                                                        {pendingName || "Uploading..."}
                                                                    </p>
                                                                ) : (
                                                                    <p className="truncate text-[11px] text-slate-500">
                                                                        {disabled
                                                                            ? "Generate or select a contract first."
                                                                            : isDragOver
                                                                                ? "Drop file to upload"
                                                                                : "Drop file or click to upload (PDF, JPG, PNG)"}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {!isUploaded && !isUploading && (
                                                                <Input
                                                                    ref={inputRef}
                                                                    type="file"
                                                                    accept=".pdf,.jpg,.jpeg,.png"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    onChange={(e) => {
                                                                        onPickFiles(e.target.files);
                                                                        if (e.target) e.target.value = "";
                                                                    }}
                                                                    className="hidden"
                                                                    disabled={disabled}
                                                                />
                                                            )}
                                                            {isUploading ? (
                                                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                                                    {`${progress ?? 0}%`}
                                                                </span>
                                                            ) : (
                                                                <span
                                                                    className={cn(
                                                                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                                                                        isUploaded
                                                                            ? "bg-emerald-100 text-emerald-700"
                                                                            : "bg-amber-100 text-amber-700",
                                                                    )}
                                                                >
                                                                    {isUploaded ? (
                                                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                                                    ) : (
                                                                        <AlertCircle className="h-3.5 w-3.5" />
                                                                    )}
                                                                    {isUploaded ? "Uploaded" : "Missing"}
                                                                </span>
                                                            )}
                                                            {isUploaded && (
                                                                <>
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-7 w-7 text-slate-600 hover:bg-slate-200/70 cursor-pointer"
                                                                        aria-label="Document actions"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const fileId = String(uploadedFile?.id || "");
                                                                            setOpenDocumentActionMenuId((prev) => (prev === fileId ? null : fileId));
                                                                        }}
                                                                    >
                                                                        <MoreVertical className="h-4 w-4" />
                                                                    </Button>
                                                                    {openDocumentActionMenuId === String(uploadedFile?.id || "") && (
                                                                        <div className="absolute right-2 top-10 z-[10000] w-32 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                                                                            <button
                                                                                type="button"
                                                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setOpenDocumentActionMenuId(null);
                                                                                    void handlePreviewUploadedDocument(String(uploadedFile?.id || ""));
                                                                                }}
                                                                            >
                                                                                <Eye className="h-3.5 w-3.5" />
                                                                                View
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                disabled={updatingUploadedFileId === String(uploadedFile?.id || "")}
                                                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setOpenDocumentActionMenuId(null);
                                                                                    handleEditUploadedDocument(String(uploadedFile?.id || ""));
                                                                                }}
                                                                            >
                                                                                <Pencil className="h-3.5 w-3.5" />
                                                                                Edit
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                disabled={deletingUploadedFileId === String(uploadedFile?.id || "")}
                                                                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setOpenDocumentActionMenuId(null);
                                                                                    void handleDeleteUploadedDocument(String(uploadedFile?.id || ""));
                                                                                }}
                                                                            >
                                                                                <Trash2 className="h-3.5 w-3.5" />
                                                                                Delete
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                        {isUploading && (
                                                            <div className="pointer-events-none absolute inset-x-3 bottom-1 h-1 overflow-hidden rounded-full bg-blue-100">
                                                                <div
                                                                    className="h-full rounded-full bg-blue-500 transition-[width] duration-200 ease-out"
                                                                    style={{ width: `${progress ?? 0}%` }}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        )}

                                        {documentUploadMessage && (
                                            <p className="pt-1 text-xs text-slate-600">{documentUploadMessage}</p>
                                        )}
                                    </section>
                                )}

                                {activeStep === "info" && (
                                    <section className="space-y-5">
                                        {/* Section header */}
                                        {/* <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                            <div className="flex items-start gap-3">
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]">
                                                    <Info className="h-4 w-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                                                        Contract Information
                                                    </h3>
                                                    <p className="text-xs text-slate-500">
                                                        Review fetched records and fill required details for the contract.
                                                    </p>
                                                </div>
                                            </div>
                                        </div> */}

                                        {/* Stat cards */}
                                        {/* <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                                            {([
                                                { key: "addendum", label: "Addendum", state: addendumListState, accent: "from-indigo-50 to-indigo-100/40 text-indigo-600 ring-indigo-100" },
                                                { key: "ach", label: "ACH", state: achListState, accent: "from-emerald-50 to-emerald-100/40 text-emerald-600 ring-emerald-100" },
                                                { key: "epo", label: "EPO", state: epoListState, accent: "from-amber-50 to-amber-100/40 text-amber-600 ring-amber-100" },
                                                { key: "owner", label: "Owner", state: ownerListState, accent: "from-sky-50 to-sky-100/40 text-sky-600 ring-sky-100" },
                                                { key: "guarantor", label: "Guarantor", state: guarantorListState, accent: "from-rose-50 to-rose-100/40 text-rose-600 ring-rose-100" },
                                            ] as const).map((stat) => {
                                                const count = Array.isArray(stat.state.data) ? stat.state.data.length : 0;
                                                return (
                                                    <div
                                                        key={stat.key}
                                                        className={cn(
                                                            "relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br p-3 shadow-sm transition-all hover:shadow",
                                                            stat.accent,
                                                        )}
                                                    >
                                                        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-600">
                                                            {stat.label}
                                                        </p>
                                                        <p className="mt-1 text-2xl font-bold leading-none text-slate-800">
                                                            {count}
                                                        </p>
                                                        <p className="mt-1 text-[10px] text-slate-500">
                                                            {count === 1 ? "record" : "records"}
                                                        </p>
                                                    </div>
                                                );
                                            })}
                                        </div> */}

                                        {canSendWithoutContract ? (
                                            <div className="rounded-xl border border-[var(--brand)]/20 bg-gradient-to-br from-[var(--brand)]/5 to-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:from-slate-900 dark:to-slate-900 dark:ring-slate-700/80">
                                                <div className="mb-3 flex items-start gap-2.5">
                                                    <div
                                                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]"
                                                        aria-hidden
                                                    >
                                                        <FileText className="h-4 w-4" />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                                            Send options
                                                        </h4>
                                                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            {includeMainContractInSend
                                                                ? "Main contract is included. Selected addendum and linked state disclosure merge automatically."
                                                                : isSignNowContractUiEnabled()
                                                                  ? "Sending the selected addendum only (no main contract)."
                                                                  : "Sending configured addendum and/or state disclosure only (no main contract)."}
                                                        </p>
                                                    </div>
                                                </div>
                                                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200/80 bg-white px-3 py-2.5 dark:border-slate-600 dark:bg-slate-950">
                                                    <Checkbox
                                                        checked={includeMainContractInSend}
                                                        onCheckedChange={(checked: boolean | "indeterminate") =>
                                                            setIncludeMainContractInSend(checked === true)
                                                        }
                                                        className="mt-0.5"
                                                    />
                                                    <span className="min-w-0">
                                                        <span className="block text-xs font-medium text-slate-800 dark:text-slate-100">
                                                            Include main contract agreement
                                                        </span>
                                                        <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                                                            Uncheck only if you need to send addendum and/or disclosure without the contract.
                                                        </span>
                                                    </span>
                                                </label>
                                            </div>
                                        ) : null}

                                        {/* Addendum template picker (multi-select) */}
                                        <div className="rounded-xl border border-[var(--brand)]/15 bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-700/80">
                                            <div className="mb-3 flex items-start justify-between gap-2">
                                                <div className="flex min-w-0 items-start gap-2.5">
                                                    <div
                                                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]"
                                                        aria-hidden
                                                    >
                                                        <FileText className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                                            Addendum Templates
                                                        </label>
                                                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            Select one or more. Refinance auto-selects Addendum P; CA/NY/VA auto-select by state. ACH Daily / Weekly are selected manually. You can change the selection anytime.
                                                        </p>
                                                    </div>
                                                </div>
                                                {selectedAddendumOptions.length > 0 && (
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200/80 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800/50">
                                                        <CheckCircle2 className="h-3 w-3" aria-hidden />
                                                        {selectedAddendumOptions.length} selected
                                                    </span>
                                                )}
                                            </div>
                                            <AddendumTemplatesPicker
                                                options={addendumPickerOptions}
                                                selectedRefs={selectedAddendumRefs}
                                                forceClosed={!isOpen || activeStep !== "info"}
                                                onToggle={toggleAddendumTemplateSelection}
                                                onSetCount={setAddendumTemplateRefCount}
                                                onClear={clearAllAddendumSelections}
                                                onOpenChange={handleAddendumPickerOpenChange}
                                            />
                                            {exhibitCPickerRef ? (
                                                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--brand)]/20 bg-[var(--brand)]/5 px-2.5 py-2">
                                                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                                        Exhibit C copies:{" "}
                                                        <span className="font-bold text-[var(--brand)]">
                                                            {exhibitCSelectedCount}
                                                        </span>
                                                        <span className="font-normal text-slate-500">
                                                            {" "}
                                                            / {MULTI_INSTANCE_ADDENDUM_MAX}
                                                        </span>
                                                    </span>
                                                    <div className="ml-auto flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            disabled={exhibitCSelectedCount <= 0}
                                                            className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
                                                            onClick={() =>
                                                                setAddendumTemplateRefCount(
                                                                    exhibitCPickerRef,
                                                                    Math.max(0, exhibitCSelectedCount - 1),
                                                                )
                                                            }
                                                            aria-label="Remove one Exhibit C"
                                                        >
                                                            −
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={
                                                                exhibitCSelectedCount >=
                                                                MULTI_INSTANCE_ADDENDUM_MAX
                                                            }
                                                            className="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--brand)] px-2.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                                                            onClick={() =>
                                                                setAddendumTemplateRefCount(
                                                                    exhibitCPickerRef,
                                                                    Math.min(
                                                                        MULTI_INSTANCE_ADDENDUM_MAX,
                                                                        exhibitCSelectedCount + 1,
                                                                    ),
                                                                )
                                                            }
                                                            aria-label="Add another Exhibit C"
                                                        >
                                                            <Plus className="h-3.5 w-3.5" aria-hidden />
                                                            Add another Exhibit C
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}
                                            <p className="mt-1.5 text-[10px] leading-snug text-slate-500 dark:text-slate-400">
                                                Exhibit C supports multiple copies on one deal — use{" "}
                                                <span className="font-semibold">Add another Exhibit C</span>{" "}
                                                (or <span className="font-semibold">+</span> inside the
                                                dropdown) up to {MULTI_INSTANCE_ADDENDUM_MAX}.
                                            </p>
                                        </div>
                                        <div className="rounded-xl border border-[var(--brand)]/15 bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-700/80">
                                            <div className="mb-3 flex items-start gap-2.5">
                                                <div
                                                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]"
                                                    aria-hidden
                                                >
                                                    <Landmark className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                                        Contract Meta
                                                    </h4>
                                                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                        Used for CRM reporting and contract metadata. Template:{" "}
                                                        <span className="font-medium text-slate-700 dark:text-slate-300">
                                                            {sanitizeContractPreviewName(
                                                                activeContractTemplateName,
                                                            )}
                                                        </span>
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <div className="space-y-1.5">
                                                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300" htmlFor="pdf-viewer-contract-state-info">
                                                        <MapPin className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />
                                                        Select State
                                                    </label>
                                                    <SearchableStateSelect
                                                        id="pdf-viewer-contract-state-info"
                                                        value={selectedState}
                                                        disabled={savingContractMeta}
                                                        onValueChange={(v: string) => {
                                                            userSelectedStateRef.current = true;
                                                            const previousState = selectedState;
                                                            setSelectedState(v);
                                                            contractStateForFunderSyncRef.current = v;
                                                            const picked = pickUsStateForSelect(v) || v;
                                                            const activeFunders = funders.filter(
                                                                (f) => f.isActive !== false,
                                                            );
                                                            let nextFunder = selectedFunder;
                                                            let nextFunderProfileId = selectedFunderProfileId;

                                                            const switched = resolveFunderSwitchOnStateChange({
                                                                currentFunderName: selectedFunder,
                                                                previousState,
                                                                newState: picked,
                                                                funders: activeFunders,
                                                            });
                                                            if (switched) {
                                                                nextFunder = switched;
                                                                nextFunderProfileId =
                                                                    findFunderProfile(activeFunders, switched, picked)
                                                                        ?.id ?? "";
                                                            } else {
                                                                const currentFunder =
                                                                    findFunderById(selectedFunderProfileId) ??
                                                                    findFunder(selectedFunder);
                                                                if (
                                                                    (selectedFunderProfileId || selectedFunder) &&
                                                                    currentFunder &&
                                                                    picked &&
                                                                    !funderAvailableForContractState(
                                                                        currentFunder,
                                                                        picked,
                                                                    )
                                                                ) {
                                                                    const fallback =
                                                                        resolveDefaultFunderNameForState(
                                                                            activeFunders,
                                                                            picked,
                                                                        );
                                                                    nextFunder = fallback || "";
                                                                    nextFunderProfileId = fallback
                                                                        ? findFunderProfile(
                                                                              activeFunders,
                                                                              fallback,
                                                                              picked,
                                                                          )?.id ?? ""
                                                                        : "";
                                                                }
                                                            }

                                                            if (
                                                                nextFunder !== selectedFunder ||
                                                                nextFunderProfileId !== selectedFunderProfileId
                                                            ) {
                                                                selectedFunderProfileIdRef.current =
                                                                    nextFunderProfileId;
                                                                selectedFunderRef.current = nextFunder;
                                                                setSelectedFunderProfileId(nextFunderProfileId);
                                                                setSelectedFunder(nextFunder);
                                                            }
                                                            const nextFunderProfile =
                                                                (nextFunderProfileId
                                                                    ? findFunderById(nextFunderProfileId)
                                                                    : null) ??
                                                                (nextFunder
                                                                    ? findFunder(nextFunder)
                                                                    : null);
                                                            const nextDocsLayoutFunderId = nextFunderProfile
                                                                ? resolveAddendumDocumentsLayoutFunderId(
                                                                      nextFunderProfile,
                                                                  )
                                                                : null;
                                                            const nextDisclosureDocsLayoutFunderId =
                                                                nextFunderProfile
                                                                    ? resolveDisclosureDocumentsLayoutFunderId(
                                                                          nextFunderProfile,
                                                                          {
                                                                              platformDisclosureFunderId:
                                                                                  platformDisclosureFunderIdRef.current,
                                                                          },
                                                                      )
                                                                    : null;
                                                            docsLayoutFunderIdRef.current =
                                                                nextDocsLayoutFunderId;
                                                            disclosureDocsLayoutFunderIdRef.current =
                                                                nextDisclosureDocsLayoutFunderId;
                                                            if (
                                                                nextFunder !== selectedFunder ||
                                                                nextFunderProfileId !== selectedFunderProfileId
                                                            ) {
                                                                const nextFunderAddenda =
                                                                    funderSignNowAddendumOptions(
                                                                        nextFunderProfile,
                                                                    );
                                                                const kept = selectedAddendumOptions
                                                                    .map((opt) => {
                                                                        const trimmed = String(opt || "").trim();
                                                                        if (!trimmed.startsWith("bs:")) return "";
                                                                        const ref = trimmed.slice(3).trim();
                                                                        if (isSignNowContractUiEnabled()) {
                                                                            if (
                                                                                !funderOwnsSignNowAddendumRef(
                                                                                    ref,
                                                                                    nextFunderAddenda,
                                                                                )
                                                                            ) {
                                                                                return "";
                                                                            }
                                                                            const owned =
                                                                                nextFunderAddenda.find(
                                                                                    (o) =>
                                                                                        o.layoutKey ===
                                                                                            ref ||
                                                                                        extractSignNowTemplateId(
                                                                                            o.templateId ||
                                                                                                o.link,
                                                                                        ) ===
                                                                                            extractSignNowTemplateId(
                                                                                                ref,
                                                                                            ),
                                                                                );
                                                                            return (
                                                                                owned?.layoutKey ||
                                                                                owned?.templateId ||
                                                                                ref
                                                                            );
                                                                        }
                                                                        return isAddendumRefValidForDocsFunder(
                                                                            ref,
                                                                            nextDocsLayoutFunderId,
                                                                            boldSignTemplates,
                                                                        )
                                                                            ? ref
                                                                            : "";
                                                                    })
                                                                    .filter(Boolean);
                                                                void setAddendumTemplateMappings(kept);
                                                            }
                                                            // Clear so a failed/stale sync can be retried by the effect.
                                                            disclosureAutoLinkKeyRef.current = "";
                                                            if (effectiveContractId != null) {
                                                                void persistContractStateAndFunder({
                                                                    state: v,
                                                                    ...(nextFunder !== selectedFunder
                                                                        ? { funderName: nextFunder }
                                                                        : {}),
                                                                });
                                                            }
                                                            if (effectiveContractId != null) {
                                                                void syncDisclosureTemplateForState(v, {
                                                                    docsLayoutFunderId:
                                                                        nextDisclosureDocsLayoutFunderId,
                                                                });
                                                                addendumAutoLinkKeyRef.current = "";
                                                                void syncAddendumTemplateForApplication({
                                                                    silent: true,
                                                                    docsLayoutFunderId:
                                                                        nextDocsLayoutFunderId,
                                                                    state: v,
                                                                });
                                                            }
                                                        }}
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300" htmlFor="pdf-viewer-contract-funder-info">
                                                        <Building2 className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />
                                                        Select Funder
                                                    </label>
                                                    <div className="flex items-start gap-2">
                                                        <Select
                                                            value={selectedFunderProfileId || undefined}
                                                            disabled={savingContractMeta}
                                                            onValueChange={(profileId: string) => {
                                                                userSelectedFunderRef.current = true;
                                                                const profile = findFunderById(profileId);
                                                                const funderName = profile?.name ?? "";
                                                                selectedFunderProfileIdRef.current = profileId;
                                                                selectedFunderRef.current = funderName;
                                                                setSelectedFunderProfileId(profileId);
                                                                setSelectedFunder(funderName);
                                                                scheduleMainContractTemplatePreview(profileId);
                                                                const nextDocsLayoutFunderId = profile
                                                                    ? resolveAddendumDocumentsLayoutFunderId(profile)
                                                                    : null;
                                                                const nextDisclosureDocsLayoutFunderId = profile
                                                                    ? resolveDisclosureDocumentsLayoutFunderId(profile, {
                                                                          platformDisclosureFunderId:
                                                                              platformDisclosureFunderIdRef.current,
                                                                      })
                                                                    : null;
                                                                docsLayoutFunderIdRef.current =
                                                                    nextDocsLayoutFunderId;
                                                                disclosureDocsLayoutFunderIdRef.current =
                                                                    nextDisclosureDocsLayoutFunderId;
                                                                const picked =
                                                                    pickUsStateForSelect(selectedState);
                                                                if (
                                                                    effectiveContractId != null &&
                                                                    picked
                                                                ) {
                                                                    disclosureAutoLinkKeyRef.current = "";
                                                                    void syncDisclosureTemplateForState(
                                                                        picked,
                                                                        {
                                                                            docsLayoutFunderId:
                                                                                nextDisclosureDocsLayoutFunderId,
                                                                        },
                                                                    );
                                                                }
                                                                const nextFunderAddenda =
                                                                    funderSignNowAddendumOptions(profile);
                                                                const kept = selectedAddendumOptions
                                                                    .map((opt) => {
                                                                        const trimmed = String(opt || "").trim();
                                                                        if (!trimmed.startsWith("bs:")) return "";
                                                                        const ref = trimmed.slice(3).trim();
                                                                        if (isSignNowContractUiEnabled()) {
                                                                            // Only keep this funder's Settings
                                                                            // links — never Nitro/other funder
                                                                            // addenda that share layout keys.
                                                                            if (
                                                                                !funderOwnsSignNowAddendumRef(
                                                                                    ref,
                                                                                    nextFunderAddenda,
                                                                                )
                                                                            ) {
                                                                                return "";
                                                                            }
                                                                            const owned =
                                                                                nextFunderAddenda.find(
                                                                                    (o) =>
                                                                                        o.layoutKey ===
                                                                                            ref ||
                                                                                        extractSignNowTemplateId(
                                                                                            o.templateId ||
                                                                                                o.link,
                                                                                        ) ===
                                                                                            extractSignNowTemplateId(
                                                                                                ref,
                                                                                            ),
                                                                                );
                                                                            return (
                                                                                owned?.layoutKey ||
                                                                                owned?.templateId ||
                                                                                ref
                                                                            );
                                                                        }
                                                                        return isAddendumRefValidForDocsFunder(
                                                                            ref,
                                                                            nextDocsLayoutFunderId,
                                                                            boldSignTemplates,
                                                                        )
                                                                            ? ref
                                                                            : "";
                                                                    })
                                                                    .filter(Boolean);
                                                                // Always rewrite mappings on funder change so
                                                                // another funder's linked addenda are cleared.
                                                                void setAddendumTemplateMappings(kept);
                                                                addendumAutoLinkKeyRef.current = "";
                                                                if (effectiveContractId != null) {
                                                                    void persistContractStateAndFunder({
                                                                        funderName,
                                                                    });
                                                                    void syncAddendumTemplateForApplication({
                                                                        silent: true,
                                                                        docsLayoutFunderId:
                                                                            nextDocsLayoutFunderId,
                                                                        state: picked || selectedState,
                                                                    });
                                                                }
                                                            }}
                                                        >
                                                            <SelectTrigger
                                                                id="pdf-viewer-contract-funder-info"
                                                                className="h-10 min-w-0 flex-1 rounded-md border border-[var(--brand)]/20 bg-background px-3 py-2 text-sm shadow-sm focus:ring-[var(--brand)]/25 disabled:opacity-60 dark:border-slate-600"
                                                            >
                                                                <SelectValue placeholder="Select funder" />
                                                            </SelectTrigger>
                                                            <SelectContent position="popper" className="z-[10100] max-h-72">
                                                                {funderSelectOptions.map((f) => (
                                                                    <SelectItem key={f.value} value={f.value}>
                                                                        {f.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <Button
                                                            type="button"
                                                            size="icon"
                                                            variant="outline"
                                                            className="h-10 w-10 shrink-0 border-[var(--brand)]/20"
                                                            title="View contract template"
                                                            aria-label="View contract template"
                                                            disabled={!selectedFunder || previewingMainContract}
                                                            onClick={() => void handlePreviewMainContractTemplate()}
                                                        >
                                                            {previewingMainContract ? (
                                                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                                            ) : (
                                                                <Eye className="h-4 w-4" aria-hidden />
                                                            )}
                                                        </Button>
                                                    </div>
                                                    {selectedFunder ? (
                                                        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                                                            Template:{" "}
                                                            {previewNameFor(
                                                                selectedFunder,
                                                                selectedFunderProfileId,
                                                            )}
                                                        </p>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-xl border border-[var(--brand)]/15 bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-700/80">
                                            <div className="mb-3 flex items-start justify-between gap-2">
                                                <div className="flex min-w-0 items-start gap-2.5">
                                                    <div
                                                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]"
                                                        aria-hidden
                                                    >
                                                        <ScrollText className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                                            State disclosure
                                                        </h4>
                                                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            {isSignNowContractUiEnabled()
                                                                ? primaryFunderDisclosure
                                                                    ? "From Settings → Funders for the selected funder. Check to merge when sending."
                                                                    : "Platform state disclosure is included by default. Uncheck to send the agreement without it."
                                                                : "Linked from the selected state and merged at the bottom of the contract."}
                                                        </p>
                                                    </div>
                                                </div>
                                                {isSignNowContractUiEnabled() ? (
                                                    includeDisclosureInSend ? (
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200/80 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800/50">
                                                        <CheckCircle2 className="h-3 w-3" aria-hidden />
                                                        Included
                                                    </span>
                                                    ) : (
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                                                        Not included
                                                    </span>
                                                    )
                                                ) : linkingDisclosureTemplate ? (
                                                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--brand)]">
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                                        Loading
                                                    </span>
                                                ) : linkedDisclosureMapping &&
                                                  linkedDisclosureMatchesSelectedState ? (
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200/80 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800/50">
                                                        <CheckCircle2 className="h-3 w-3" aria-hidden />
                                                        Linked
                                                    </span>
                                                ) : null}
                                            </div>

                                            <div className="space-y-2">
                                                {isSignNowContractUiEnabled() ? (
                                                    <>
                                                        <div className="flex items-center justify-between gap-2 rounded-lg border border-teal-200/90 bg-gradient-to-r from-teal-50/80 to-white px-2.5 py-2.5 shadow-sm dark:border-slate-600 dark:from-teal-950/25 dark:to-slate-900/80">
                                                            <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-2">
                                                                <div
                                                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm"
                                                                    aria-hidden
                                                                >
                                                                    <ScrollText className="h-4 w-4" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                                        <span className="inline-flex rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:bg-teal-900/50 dark:text-teal-200">
                                                                            Disclosure
                                                                        </span>
                                                                    </div>
                                                                    <p className="mt-1 truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                                                        {effectiveSignNowDisclosure.name}
                                                                    </p>
                                                                    {funderDisclosureOptions.length > 1 ? (
                                                                        <p className="mt-0.5 text-[10px] text-slate-500">
                                                                            +{funderDisclosureOptions.length - 1}{" "}
                                                                            more from funder Settings
                                                                        </p>
                                                                    ) : !primaryFunderDisclosure ? (
                                                                        <p className="mt-0.5 text-[10px] text-slate-500">
                                                                            Using the platform SignNow disclosure
                                                                        </p>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                            <div className="flex shrink-0 items-center gap-0.5">
                                                                <Button
                                                                    type="button"
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 cursor-pointer text-slate-600 hover:bg-[var(--brand)]/10 hover:text-[var(--brand)]"
                                                                    title="View disclosure PDF"
                                                                    disabled={
                                                                        linkingDisclosureTemplate ||
                                                                        previewingTemplateId ===
                                                                            String(effectiveSignNowDisclosure.id)
                                                                    }
                                                                    onClick={() => {
                                                                        const disclosureRef =
                                                                            effectiveSignNowDisclosure.templateId ||
                                                                            effectiveSignNowDisclosure.layoutKey;
                                                                        const row = {
                                                                                      id: effectiveSignNowDisclosure.id,
                                                                                      contractId:
                                                                                          effectiveContractId ?? 0,
                                                                                      templateId: disclosureRef,
                                                                                      documentType: "disclosure",
                                                                                      template: {
                                                                                          name: effectiveSignNowDisclosure.name,
                                                                                          type: "disclosure",
                                                                                          layoutKey: disclosureRef,
                                                                                          templateId: disclosureRef,
                                                                                      },
                                                                                  } as ContractDocumentTemplateMappingRow;
                                                                        void handlePreviewBoldSignTemplate(row);
                                                                    }}
                                                                >
                                                                    {linkingDisclosureTemplate ||
                                                                    previewingTemplateId ===
                                                                        String(effectiveSignNowDisclosure.id) ? (
                                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                    ) : (
                                                                        <Eye className="h-3.5 w-3.5" />
                                                                    )}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200/80 bg-white px-3 py-2.5 dark:border-slate-600 dark:bg-slate-950">
                                                            <Checkbox
                                                                checked={includeDisclosureInSend}
                                                                onCheckedChange={(checked: boolean | "indeterminate") =>
                                                                    setIncludeDisclosureInSend(checked === true)
                                                                }
                                                                className="mt-0.5"
                                                            />
                                                            <span className="min-w-0">
                                                                <span className="block text-xs font-medium text-slate-800 dark:text-slate-100">
                                                                    Send disclosure with the contract
                                                                </span>
                                                                <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                                                                    Uncheck to send the agreement without this disclosure.
                                                                </span>
                                                            </span>
                                                        </label>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="h-9 w-full border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                                            onClick={() => setDisclosureCalcModalOpen(true)}
                                                        >
                                                            <Calculator className="mr-2 h-4 w-4" />
                                                            Calculate disclosure
                                                        </Button>
                                                    </>
                                                ) : linkingDisclosureTemplate ? (
                                                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--brand)]/25 bg-slate-50/80 py-6 text-center dark:border-slate-600 dark:bg-slate-800/30">
                                                        <Loader2
                                                            className="h-8 w-8 animate-spin text-[var(--brand)]"
                                                            aria-hidden
                                                        />
                                                        <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                                            {selectedState
                                                                ? `Loading disclosure for ${selectedState}…`
                                                                : "Loading disclosure…"}
                                                        </p>
                                                    </div>
                                                ) : linkedDisclosureMapping &&
                                                  linkedDisclosureMatchesSelectedState ? (
                                                    <>
                                                        <div
                                                            key={linkedDisclosureMapping.id}
                                                            className="flex items-center justify-between gap-2 rounded-lg border border-teal-200/90 bg-gradient-to-r from-teal-50/80 to-white px-2.5 py-2.5 shadow-sm transition-colors dark:border-slate-600 dark:from-teal-950/25 dark:to-slate-900/80"
                                                        >
                                                            <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-2">
                                                                <div
                                                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm"
                                                                    aria-hidden
                                                                >
                                                                    <ScrollText className="h-4 w-4" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                                        <span className="inline-flex rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-800 dark:bg-teal-900/50 dark:text-teal-200">
                                                                            Disclosure
                                                                        </span>
                                                                    </div>
                                                                    <p className="mt-1 truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                                                        {formatDropdownLabel(
                                                                            formatDisclosureTemplateLabel(
                                                                                linkedDisclosureMapping,
                                                                            ),
                                                                        )}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="flex shrink-0 items-center gap-0.5">
                                                                <Button
                                                                    type="button"
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 cursor-pointer text-slate-600 hover:bg-[var(--brand)]/10 hover:text-[var(--brand)]"
                                                                    title="View disclosure PDF"
                                                                    disabled={
                                                                        previewingTemplateId ===
                                                                        String(linkedDisclosureMapping.id)
                                                                    }
                                                                    onClick={() =>
                                                                        void handlePreviewBoldSignTemplate(
                                                                            linkedDisclosureMapping,
                                                                        )
                                                                    }
                                                                >
                                                                    {previewingTemplateId ===
                                                                    String(linkedDisclosureMapping.id) ? (
                                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                    ) : (
                                                                        <Eye className="h-3.5 w-3.5" />
                                                                    )}
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="icon"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 cursor-pointer text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                                                                    title="Remove disclosure"
                                                                    onClick={() =>
                                                                        void setDisclosureTemplateMapping(null)
                                                                    }
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="h-9 w-full border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                                            onClick={() => setDisclosureCalcModalOpen(true)}
                                                        >
                                                            <Calculator className="mr-2 h-4 w-4" />
                                                            Calculate disclosure
                                                        </Button>
                                                    </>
                                                ) : (
                                                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 py-6 text-center dark:border-slate-600 dark:bg-slate-800/30">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand)]/10 text-[var(--brand)]">
                                                            <ScrollText className="h-5 w-5" aria-hidden />
                                                        </div>
                                                        <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                                            {selectedState
                                                                ? `No disclosure linked for ${selectedState}.`
                                                                : "Select a state to link a disclosure."}
                                                        </p>
                                                        <p className="max-w-[260px] text-[10px] text-slate-500">
                                                            Upload the state PDF to Cloudinary and add a
                                                            BoldSignTemplate row with type disclosure.
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="rounded-xl border border-[var(--brand)]/15 bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-700/80">
                                            <div className="mb-3 flex items-start justify-between gap-2">
                                                <div className="flex min-w-0 items-start gap-2.5">
                                                    <div
                                                        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]"
                                                        aria-hidden
                                                    >
                                                        <Layers className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                                            Addendum
                                                        </h4>
                                                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            {isSignNowContractUiEnabled()
                                                                ? "Drag addendums to set SignNow send order. Position 1 is attached first after the contract."
                                                                : "DocuSign addendum templates merged when you send the contract."}
                                                        </p>
                                                    </div>
                                                </div>
                                                {loadingTemplateMappings ? (
                                                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--brand)]">
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                                        Loading
                                                    </span>
                                                ) : null}
                                            </div>

                                            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                <FileSignature className="h-3 w-3 text-[var(--brand)]" aria-hidden />
                                                {isSignNowContractUiEnabled()
                                                    ? "SignNow templates"
                                                    : "DocuSign templates"}
                                            </p>
                                            <div className="space-y-2">
                                                {orderedLinkedAddendumMappings.length > 0 ? (
                                                    <AddendumSendOrderBoard
                                                        items={orderedLinkedAddendumMappings}
                                                        disabled={loadingTemplateMappings}
                                                        onReorder={reorderLinkedAddendums}
                                                        renderItem={(row, index) => {
                                                        const isPending = String(row.id || "").startsWith(
                                                            "pending:",
                                                        );
                                                        const mappingRef = getAddendumDropdownRef(row?.template);
                                                        // Non-Nitro funders often persist BoldSignTemplate
                                                        // rows as generic "Addendum" — recover Settings name
                                                        // + known layout key so labels and Edit match Nitro.
                                                        const funderMatch =
                                                            matchFunderSignNowAddendumOption(
                                                                row?.template,
                                                                selectedFunderAddendumOptions,
                                                            );
                                                        const baseDisplayName =
                                                            funderMatch?.name ||
                                                            row?.template?.name ||
                                                            row?.template?.templateId ||
                                                            row?.templateId ||
                                                            "Template";
                                                        const isExhibitCCopy =
                                                            isExhibitCFamilyAddendumRef(
                                                                funderMatch?.knownLayoutKey ||
                                                                    funderMatch?.templateId ||
                                                                    mappingRef ||
                                                                    row?.template?.layoutKey,
                                                                funderMatch?.name ||
                                                                    row?.template?.name,
                                                            );
                                                        const exhibitCFamilyIndex =
                                                            orderedLinkedAddendumMappings
                                                                .slice(0, index + 1)
                                                                .filter((candidate) => {
                                                                    const match =
                                                                        matchFunderSignNowAddendumOption(
                                                                            candidate?.template,
                                                                            selectedFunderAddendumOptions,
                                                                        );
                                                                    return isExhibitCFamilyAddendumRef(
                                                                        match?.knownLayoutKey ||
                                                                            match?.templateId ||
                                                                            getAddendumDropdownRef(
                                                                                candidate?.template,
                                                                            ) ||
                                                                            candidate?.template
                                                                                ?.layoutKey,
                                                                        match?.name ||
                                                                            candidate?.template?.name,
                                                                    );
                                                                }).length;
                                                        // ACH Daily must stay "ACH Daily" — never
                                                        // rename it to Exhibit C / Exhibit C (N).
                                                        const displayName = isExhibitCCopy
                                                            ? labelForExhibitCFamilyInstance(
                                                                  exhibitCFamilyIndex,
                                                              )
                                                            : baseDisplayName;
                                                        const prefillTemplateId =
                                                            funderMatch?.templateId ||
                                                            row?.template?.templateId ||
                                                            row?.templateId ||
                                                            null;
                                                        const prefillLayoutKey =
                                                            funderMatch?.knownLayoutKey ||
                                                            knownAddendumLayoutKeyFromName(
                                                                funderMatch?.name ||
                                                                    row?.template?.name,
                                                            ) ||
                                                            (isSignNowTemplateIdToken(
                                                                funderMatch?.layoutKey,
                                                            )
                                                                ? null
                                                                : funderMatch?.layoutKey) ||
                                                            (isSignNowTemplateIdToken(
                                                                row?.template?.layoutKey,
                                                            )
                                                                ? null
                                                                : row?.template?.layoutKey) ||
                                                            null;
                                                        const prefillName =
                                                            funderMatch?.name ||
                                                            row?.template?.name ||
                                                            null;
                                                        const isAchDailyRow = isAchDailyAddendumRef(
                                                            funderMatch?.knownLayoutKey ||
                                                                prefillLayoutKey ||
                                                                mappingRef ||
                                                                row?.template?.layoutKey,
                                                            funderMatch?.name || prefillName,
                                                        );
                                                        // Prefer catalog key so the editor resolves
                                                        // ach_daily (not Exhibit C entity slots).
                                                        const editorLayoutKey = isAchDailyRow
                                                            ? SIGNNOW_ACH_DAILY_LAYOUT_KEY
                                                            : prefillLayoutKey;
                                                        const supportsPrefill =
                                                            hasAddendumPrefillFieldMap(
                                                                prefillTemplateId,
                                                                prefillName,
                                                                editorLayoutKey,
                                                            );
                                                        return (
                                                            <div
                                                                key={row.id}
                                                                className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200/90 bg-gradient-to-r from-indigo-50/80 to-white px-2.5 py-2.5 shadow-sm transition-colors dark:border-slate-600 dark:from-indigo-950/25 dark:to-slate-900/80"
                                                            >
                                                                <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-2">
                                                                    <div
                                                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-[11px] font-bold text-white shadow-sm"
                                                                        aria-hidden
                                                                    >
                                                                        {index + 1}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                                            <span className="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
                                                                                Position {index + 1}
                                                                            </span>
                                                                        </div>
                                                                        <p className="mt-1 truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                                                            {isExhibitCCopy
                                                                                ? displayName
                                                                                : formatDropdownLabel(
                                                                                      displayName,
                                                                                  ) || "Addendum"}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                <div className="flex shrink-0 items-center gap-0.5">
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-8 w-8 cursor-pointer text-slate-600 hover:bg-[var(--brand)]/10 hover:text-[var(--brand)]"
                                                                        title={
                                                                            isPending
                                                                                ? "Saving addendum link…"
                                                                                : "View template PDF"
                                                                        }
                                                                        disabled={
                                                                            isPending ||
                                                                            previewingTemplateId ===
                                                                                String(row.id)
                                                                        }
                                                                        onClick={() =>
                                                                            void handlePreviewBoldSignTemplate(
                                                                                row,
                                                                            )
                                                                        }
                                                                    >
                                                                        {previewingTemplateId ===
                                                                        String(row.id) ? (
                                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                        ) : isPending ? (
                                                                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--brand)]" />
                                                                        ) : (
                                                                            <Eye className="h-3.5 w-3.5" />
                                                                        )}
                                                                    </Button>
                                                                    {supportsPrefill && !isPending ? (
                                                                        <Button
                                                                            type="button"
                                                                            size="icon"
                                                                            variant="ghost"
                                                                            className="h-8 w-8 cursor-pointer text-slate-600 hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-950/40"
                                                                            title="Edit addendum prefill"
                                                                            onClick={() => {
                                                                                // ACH Daily must never inherit Exhibit C (2)/(3) entity slots.
                                                                                if (isAchDailyRow || !isExhibitCCopy) {
                                                                                    setTemplateMappingPrefillExhibitCIndex(
                                                                                        0,
                                                                                    );
                                                                                } else {
                                                                                    // Same funder-aware position the row label
                                                                                    // shows. Recounting without the funder match
                                                                                    // missed funder Exhibit C templates stored
                                                                                    // as a bare SignNow id (Obsidian), so every
                                                                                    // copy edited entity slot 0 — Exhibit C and
                                                                                    // Exhibit C (2) ended up with one set of values.
                                                                                    setTemplateMappingPrefillExhibitCIndex(
                                                                                        Math.max(
                                                                                            0,
                                                                                            exhibitCFamilyIndex - 1,
                                                                                        ),
                                                                                    );
                                                                                }
                                                                                setTemplateMappingPrefillEditRow({
                                                                                    ...row,
                                                                                    template: {
                                                                                        ...(row.template ?? {}),
                                                                                        id:
                                                                                            row.template?.id ??
                                                                                            row.id,
                                                                                        name: isAchDailyRow
                                                                                            ? prefillName ||
                                                                                              "ACH Daily"
                                                                                            : prefillName ??
                                                                                              row.template?.name ??
                                                                                              undefined,
                                                                                        layoutKey:
                                                                                            editorLayoutKey ??
                                                                                            undefined,
                                                                                        templateId:
                                                                                            prefillTemplateId ??
                                                                                            row.template
                                                                                                ?.templateId ??
                                                                                            undefined,
                                                                                    },
                                                                                });
                                                                            }}
                                                                        >
                                                                            <Pencil className="h-3.5 w-3.5" />
                                                                        </Button>
                                                                    ) : null}
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-8 w-8 cursor-pointer text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                                                                        title="Remove addendum"
                                                                        onClick={() => {
                                                                            const nextRefs =
                                                                                orderedLinkedAddendumMappings
                                                                                    .filter(
                                                                                        (candidate) =>
                                                                                            candidate.id !==
                                                                                            row.id,
                                                                                    )
                                                                                    .map((candidate) => {
                                                                                        const pendingRef =
                                                                                            String(
                                                                                                candidate.id ||
                                                                                                    "",
                                                                                            ).startsWith(
                                                                                                "pending:",
                                                                                            )
                                                                                                ? String(
                                                                                                      candidate.id,
                                                                                                  ).split(
                                                                                                      ":",
                                                                                                  )[1] ||
                                                                                                  ""
                                                                                                : "";
                                                                                        return (
                                                                                            pendingRef ||
                                                                                            getAddendumDropdownRef(
                                                                                                candidate.template,
                                                                                            ) ||
                                                                                            getBoldSignTemplateMappingRef(
                                                                                                candidate.template,
                                                                                            ) ||
                                                                                            ""
                                                                                        );
                                                                                    })
                                                                                    .filter(Boolean);
                                                                            void setAddendumTemplateMappings(
                                                                                nextRefs,
                                                                                { immediate: true },
                                                                            );
                                                                        }}
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        );
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 py-6 text-center dark:border-slate-600 dark:bg-slate-800/30">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand)]/10 text-[var(--brand)]">
                                                            {loadingTemplateMappings ||
                                                            addendumOptimisticRefsRef.current !=
                                                                null ? (
                                                                <Loader2
                                                                    className="h-5 w-5 animate-spin"
                                                                    aria-hidden
                                                                />
                                                            ) : (
                                                                <Layers className="h-5 w-5" aria-hidden />
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                                            {selectedAddendumOptions.some((o) =>
                                                                o.startsWith("bs:"),
                                                            )
                                                                ? "Linking addendum templates…"
                                                                : "No addendum template linked yet."}
                                                        </p>
                                                        <p className="max-w-[240px] text-[10px] text-slate-500">
                                                            Pick addendum templates in Addendum Templates
                                                            above — send order appears here right away.
                                                        </p>
                                                    </div>
                                                )}
                                            </div>

                                            {addendumDocs.length > 0 || payoffLetterDocs.length > 0 ? (
                                                <>
                                                    <p className="mb-2 mt-5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                        <FileText className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-hidden />
                                                        Uploaded PDFs
                                                    </p>
                                                    <div className="space-y-2">
                                                        {addendumDocs.map((file: any) => (
                                                            <div
                                                                key={`add-pdf-${String(file?.id || "")}`}
                                                                className="flex items-center justify-between rounded-lg border border-amber-200/80 bg-gradient-to-r from-amber-50/60 to-white px-2.5 py-2 dark:border-amber-900/40 dark:from-amber-950/20 dark:to-slate-900/80"
                                                            >
                                                                <div className="min-w-0 pr-2">
                                                                    <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                                                                        Uploaded addendum
                                                                    </p>
                                                                    <p className="truncate text-[11px] text-slate-500">
                                                                        {formatDropdownLabel(
                                                                            file?.fileName || file?.documentType || "PDF",
                                                                        )}
                                                                    </p>
                                                                </div>
                                                                <div className="flex shrink-0 items-center gap-0.5">
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-7 w-7 cursor-pointer text-slate-600 hover:bg-[var(--brand)]/10 hover:text-[var(--brand)]"
                                                                        title="View PDF"
                                                                        onClick={() =>
                                                                            void handlePreviewUploadedDocument(String(file?.id || ""))
                                                                        }
                                                                    >
                                                                        <Eye className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-7 w-7 cursor-pointer text-slate-600 hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-950/40"
                                                                        title="Replace file"
                                                                        onClick={() => handleEditUploadedDocument(String(file?.id || ""))}
                                                                    >
                                                                        <Pencil className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-7 w-7 cursor-pointer text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                                                                        title="Delete file"
                                                                        onClick={() =>
                                                                            void handleDeleteUploadedDocument(String(file?.id || ""))
                                                                        }
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {payoffLetterDocs.map((file: any) => (
                                                            <div
                                                                key={`payoff-pdf-${String(file?.id || "")}`}
                                                                className="flex items-center justify-between rounded-lg border border-sky-200/80 bg-gradient-to-r from-sky-50/60 to-white px-2.5 py-2 dark:border-sky-900/40 dark:from-sky-950/20 dark:to-slate-900/80"
                                                            >
                                                                <div className="min-w-0 pr-2">
                                                                    <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                                                                        Payoff letter (uploaded)
                                                                    </p>
                                                                    <p className="truncate text-[11px] text-slate-500">
                                                                        {formatDropdownLabel(
                                                                            file?.fileName || file?.documentType || "PDF",
                                                                        )}
                                                                    </p>
                                                                </div>
                                                                <div className="flex shrink-0 items-center gap-0.5">
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-7 w-7 cursor-pointer text-slate-600 hover:bg-[var(--brand)]/10 hover:text-[var(--brand)]"
                                                                        title="View PDF"
                                                                        onClick={() =>
                                                                            void handlePreviewUploadedDocument(String(file?.id || ""))
                                                                        }
                                                                    >
                                                                        <Eye className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-7 w-7 cursor-pointer text-slate-600 hover:bg-sky-50 hover:text-sky-800 dark:hover:bg-sky-950/40"
                                                                        title="Replace file"
                                                                        onClick={() => handleEditUploadedDocument(String(file?.id || ""))}
                                                                    >
                                                                        <Pencil className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="icon"
                                                                        variant="ghost"
                                                                        className="h-7 w-7 cursor-pointer text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                                                                        title="Delete file"
                                                                        onClick={() =>
                                                                            void handleDeleteUploadedDocument(String(file?.id || ""))
                                                                        }
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </>
                                            ) : null}
                                        </div>

                                        {/* <div className="rounded-xl border border-[var(--brand)]/15 bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-700/80">
                                            <div className="mb-3 flex items-start gap-2.5">
                                                <div
                                                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]"
                                                    aria-hidden
                                                >
                                                    <ClipboardList className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                                        Add / Edit Information
                                                    </p>
                                                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                        Open a section to capture details saved on the contract.
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                                {([
                                                    { id: "addendum", label: "Addendum", Icon: FileText },
                                                    { id: "ach", label: "ACH", Icon: Wallet },
                                                    { id: "epo", label: "EPOs", Icon: BadgeCheck },
                                                    { id: "guarantor", label: "Guarantor", Icon: Shield },
                                                ] as const).map((tab) => {
                                                    const TabIcon = tab.Icon;
                                                    const isSelected = selectedInfoPanels.includes(tab.id);
                                                    const isActive = activeInfoPanel === tab.id;
                                                    return (
                                                        <label
                                                            key={tab.id}
                                                            className={cn(
                                                                "group flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all",
                                                                isActive
                                                                    ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)] shadow-sm ring-1 ring-[var(--brand)]/30"
                                                                    : isSelected
                                                                        ? "border-[var(--brand)]/40 bg-[var(--brand)]/5 text-slate-800 dark:text-slate-200"
                                                                        : "border-slate-200 bg-white text-slate-600 hover:border-[var(--brand)]/35 hover:bg-[var(--brand)]/5 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300",
                                                            )}
                                                        >
                                                            <Checkbox
                                                                checked={isSelected}
                                                                onCheckedChange={(checked: boolean | "indeterminate") => {
                                                                    if (checked) {
                                                                        setSelectedInfoPanels((prev) =>
                                                                            prev.includes(tab.id) ? prev : [...prev, tab.id],
                                                                        );
                                                                        setActiveInfoPanel(tab.id);
                                                                        setInfoPanelMessage("");
                                                                    } else {
                                                                        setSelectedInfoPanels((prev) => {
                                                                            const next = prev.filter((id) => id !== tab.id);
                                                                            if (activeInfoPanel === tab.id) setActiveInfoPanel(null);
                                                                            setInfoPanelMessage("");
                                                                            return next;
                                                                        });
                                                                    }
                                                                }}
                                                                className="border-[var(--brand)]/60 data-[state=checked]:bg-[image:var(--brand-gradient)] data-[state=checked]:border-[var(--brand)]"
                                                            />
                                                            <TabIcon
                                                                className={cn(
                                                                    "h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100",
                                                                    isActive && "opacity-100",
                                                                )}
                                                                aria-hidden
                                                            />
                                                            <span className="truncate">{tab.label}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div> */}


                                        {activeInfoPanel && (
                                            <div className="overflow-hidden rounded-xl border border-[var(--brand)]/20 bg-white shadow-sm animate-in fade-in slide-in-from-top-1 duration-200 dark:border-slate-700 dark:bg-slate-900">
                                                <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[var(--brand)]/5 to-transparent px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]">
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </span>
                                                        <p className="text-xs font-bold uppercase tracking-wider text-[var(--brand)]">
                                                            {activeInfoPanel} Details
                                                        </p>
                                                    </div>

                                                    {(activeInfoPanel === "addendum" || activeInfoPanel === "ach" || activeInfoPanel === "epo" || activeInfoPanel === "owner" || activeInfoPanel === "guarantor") && (
                                                        <div className="flex items-center gap-2">
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-7 gap-1 text-[10px] text-[var(--brand)] hover:text-[var(--brand)]/90 hover:bg-[var(--brand)]/10 cursor-pointer"
                                                                onClick={() => {
                                                                    if (activeInfoPanel === "addendum") {
                                                                        setAddendumEntries((prev) => [...prev, {
                                                                            id: createTempId(),
                                                                            legalName: "",
                                                                            dba: "",
                                                                            typeOfEntity: "",
                                                                            ein: "",
                                                                            mailingAddress: "",
                                                                            addendumDated: "",
                                                                            principalOwner: "",
                                                                            principalBusiness: "",
                                                                            businessLocation: "",
                                                                            principalState: "",
                                                                            principalOwnerAmount1: "",
                                                                            principalOwnerAmount2: "",
                                                                            principalOwner1Name: "",
                                                                            principalOwner1Date: "",
                                                                            principalOwner2Name: "",
                                                                            principalOwner2Date: "",
                                                                        }]);
                                                                    } else if (activeInfoPanel === "ach") {
                                                                        setAchEntries((prev) => [...prev, {
                                                                            id: createTempId(),
                                                                            bankName: "",
                                                                            fullNameOnAccount: "",
                                                                            accountNumber: "",
                                                                            routingNumber: "",
                                                                            ach_authorization_bank_portal_website: "",
                                                                            ach_authorization_username: "",
                                                                            ach_authorization_password: "",
                                                                            ach_authorization_security_question1: "",
                                                                            ach_authorization_security_answer1: "",
                                                                            ach_authorization_security_question2: "",
                                                                            ach_authorization_security_answer2: "",
                                                                            ach_authorization_security_question3: "",
                                                                            ach_authorization_security_answer3: "",
                                                                            ach_authorization_other_infomation: "",
                                                                            ach_authorization_reference_name1: "",
                                                                            ach_authorization_reference_number_1: "",
                                                                            ach_authorization_reference_relationship1: "",
                                                                            ach_authorization_reference_name2: "",
                                                                            ach_authorization_reference_number2: "",
                                                                            ach_authorization_reference_relationship2: "",
                                                                            ach_authorization_reference_name3: "",
                                                                            ach_authorization_reference_number3: "",
                                                                            ach_authorization_reference_relationship3: "",
                                                                            dba: "",
                                                                            phone: "",
                                                                            address: "",
                                                                            city: "",
                                                                            state: "",
                                                                            zip: "",
                                                                            bankBranchCity: "",
                                                                            bankState: "",
                                                                            bankZip: "",
                                                                        }]);
                                                                    } else if (activeInfoPanel === "epo") {
                                                                        setEpoEntries((prev) => [...prev, { id: createTempId(), legalName: "", receivedDate: "" }]);
                                                                    } else if (activeInfoPanel === "owner") {
                                                                        setOwnerEntries((prev) =>
                                                                            prev.length >= 2
                                                                                ? prev
                                                                                : [...prev, { id: createTempId(), ownerFirstName: "", ownerLastName: "", ownerEmail: "", ownerPhone: "", ownerAddress: "", state: "", city: "", zipCode: "", ownershipPercentage: "" }],
                                                                        );
                                                                    } else {
                                                                        setGuarantorEntries((prev) =>
                                                                            prev.length >= 2
                                                                                ? prev
                                                                                : [...prev, { id: createTempId(), guarantorFirstName: "", guarantorLastName: "", guarantorEmail: "", guarantorPhone: "", guarantorAddress: "", state: "", city: "", zipCode: "", ssnNumber: "", driverLicenseNumber: "", typeOfEntity: "" }],
                                                                        );
                                                                    }
                                                                }}
                                                                disabled={
                                                                    (activeInfoPanel === "owner" && ownerEntries.length >= 2) ||
                                                                    (activeInfoPanel === "guarantor" && guarantorEntries.length >= 2)
                                                                }
                                                            >
                                                                <Plus className="h-3 w-3" />
                                                                Add Entry
                                                            </Button>

                                                        </div>
                                                    )}
                                                </div>

                                                {/* <div className="space-y-4 p-4">
                                               
                                                    {activeInfoPanel === "addendum" && addendumEntries.map((entry, idx) => (
                                                        <div key={entry.id} className="group relative space-y-4 rounded-lg border border-slate-200 bg-slate-50/30 p-4 transition-colors hover:border-slate-300">
                                                            <div className="flex items-center justify-between">
                                                                <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                                                                    Entry #{idx + 1}
                                                                </span>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-red-500 hover:bg-red-50 cursor-pointer"
                                                                    onClick={() => void removeInfoEntry("addendum", entry.id)}
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Business Identity</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                    <Input className="bg-white" placeholder="Legal Name" value={entry.legalName} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, legalName: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="DBA" value={entry.dba} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, dba: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Type of Entity" value={entry.typeOfEntity} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, typeOfEntity: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="EIN" value={entry.ein} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ein: e.target.value } : x)))} />
                                                                    <Input className="bg-white sm:col-span-2" placeholder="Mailing Address" value={entry.mailingAddress} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, mailingAddress: e.target.value } : x)))} />
                                                                </div>
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Addendum Details</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                    <Input className="bg-white" placeholder="Addendum Dated" value={entry.addendumDated} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, addendumDated: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Principal Owner" value={entry.principalOwner} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalOwner: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Principal Business" value={entry.principalBusiness} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalBusiness: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Business Location" value={entry.businessLocation} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, businessLocation: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Principal State" value={entry.principalState} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalState: e.target.value } : x)))} />
                                                                </div>
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Owner Amounts</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                    <Input className="bg-white" placeholder="Offer amount" value={entry.principalOwnerAmount1} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalOwnerAmount1: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Payback amount" value={entry.principalOwnerAmount2} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalOwnerAmount2: e.target.value } : x)))} />
                                                                </div>
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Owner Signatures</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                    <Input className="bg-white" placeholder="Owner 1 Name" value={entry.principalOwner1Name} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalOwner1Name: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Owner 1 Date" value={entry.principalOwner1Date} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalOwner1Date: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Owner 2 Name" value={entry.principalOwner2Name} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalOwner2Name: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Owner 2 Date" value={entry.principalOwner2Date} onChange={(e) => setAddendumEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, principalOwner2Date: e.target.value } : x)))} />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}

                                               
                                                    {activeInfoPanel === "ach" && achEntries.map((entry, idx) => (
                                                        <div key={entry.id} className="group relative space-y-4 rounded-lg border border-slate-200 bg-slate-50/30 p-4 transition-colors hover:border-slate-300">
                                                            <div className="flex items-center justify-between">
                                                                <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                                                                    Entry #{idx + 1}
                                                                </span>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-red-500 hover:bg-red-50 cursor-pointer"
                                                                    onClick={() => void removeInfoEntry("ach", entry.id)}
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Bank Account</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                    <Input className="bg-white" placeholder="Bank Name" value={entry.bankName} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, bankName: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Full Name on Account" value={entry.fullNameOnAccount} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, fullNameOnAccount: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Account #" value={entry.accountNumber} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, accountNumber: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Routing #" value={entry.routingNumber} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, routingNumber: e.target.value } : x)))} />
                                                                </div>
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Bank Portal Authorization</p>
                                                                <Input className="bg-white" placeholder="Bank Portal Website" value={entry.ach_authorization_bank_portal_website} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_bank_portal_website: e.target.value } : x)))} />
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                    <Input className="bg-white" placeholder="Username" value={entry.ach_authorization_username} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_username: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Password" value={entry.ach_authorization_password} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_password: e.target.value } : x)))} />
                                                                </div>
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Security Questions</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                    <Input className="bg-white" placeholder="Question 1" value={entry.ach_authorization_security_question1} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_security_question1: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Answer 1" value={entry.ach_authorization_security_answer1} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_security_answer1: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Question 2" value={entry.ach_authorization_security_question2} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_security_question2: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Answer 2" value={entry.ach_authorization_security_answer2} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_security_answer2: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Question 3" value={entry.ach_authorization_security_question3} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_security_question3: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Answer 3" value={entry.ach_authorization_security_answer3} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_security_answer3: e.target.value } : x)))} />
                                                                </div>
                                                                <Input className="bg-white" placeholder="Other Information" value={entry.ach_authorization_other_infomation} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_other_infomation: e.target.value } : x)))} />
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">References</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                                    <Input className="bg-white" placeholder="Reference 1 Name" value={entry.ach_authorization_reference_name1} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_name1: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Reference 1 Number" value={entry.ach_authorization_reference_number_1} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_number_1: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Reference 1 Relationship" value={entry.ach_authorization_reference_relationship1} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_relationship1: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Reference 2 Name" value={entry.ach_authorization_reference_name2} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_name2: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Reference 2 Number" value={entry.ach_authorization_reference_number2} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_number2: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Reference 2 Relationship" value={entry.ach_authorization_reference_relationship2} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_relationship2: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Reference 3 Name" value={entry.ach_authorization_reference_name3} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_name3: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Reference 3 Number" value={entry.ach_authorization_reference_number3} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_number3: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Reference 3 Relationship" value={entry.ach_authorization_reference_relationship3} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ach_authorization_reference_relationship3: e.target.value } : x)))} />
                                                                </div>
                                                            </div>

                                                            <div className="space-y-3">
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Account Holder Address</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                                    <Input className="bg-white" placeholder="DBA" value={entry.dba} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, dba: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Phone" value={entry.phone} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, phone: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Address" value={entry.address} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, address: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="City" value={entry.city} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, city: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="State" value={entry.state} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, state: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Zip" value={entry.zip} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, zip: e.target.value } : x)))} />
                                                                </div>
                                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Bank Branch</p>
                                                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                                    <Input className="bg-white" placeholder="Branch City" value={entry.bankBranchCity} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, bankBranchCity: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Bank State" value={entry.bankState} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, bankState: e.target.value } : x)))} />
                                                                    <Input className="bg-white" placeholder="Bank Zip" value={entry.bankZip} onChange={(e) => setAchEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, bankZip: e.target.value } : x)))} />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}

                                                    {activeInfoPanel === "epo" && epoEntries.map((entry, idx) => (
                                                        <div key={entry.id} className="group relative space-y-3 rounded-lg border border-slate-200 bg-slate-50/30 p-4 transition-colors hover:border-slate-300">
                                                            <div className="flex items-center justify-between">
                                                                <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                                                                    Entry #{idx + 1}
                                                                </span>
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 text-red-500 hover:bg-red-50 cursor-pointer"
                                                                    onClick={() => void removeInfoEntry("epo", entry.id)}
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                <Input className="bg-white" placeholder="Legal Name" value={entry.legalName} onChange={(e) => setEpoEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, legalName: e.target.value } : x)))} />
                                                                <Input className="bg-white" type="date" value={entry.receivedDate} onChange={(e) => setEpoEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, receivedDate: e.target.value } : x)))} />
                                                            </div>
                                                        </div>
                                                    ))}

                                                    {activeInfoPanel === "owner" && ownerEntries.map((entry, idx) => (
                                                        <div key={entry.id} className="group relative space-y-3 rounded-lg border border-slate-200 bg-slate-50/30 p-4">
                                                            <div className="flex items-center justify-between">
                                                                <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                                                                    <User className="h-3 w-3" />
                                                                    Owner #{idx + 1}
                                                                </span>
                                                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50 cursor-pointer" onClick={() => void removeInfoEntry("owner", entry.id)}>
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                <Input className="bg-white" placeholder="First name" value={entry.ownerFirstName} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ownerFirstName: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Last name" value={entry.ownerLastName} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ownerLastName: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Email" value={entry.ownerEmail} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ownerEmail: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Phone" value={entry.ownerPhone} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ownerPhone: e.target.value } : x)))} />
                                                                <Input className="bg-white sm:col-span-2" placeholder="Address" value={entry.ownerAddress} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ownerAddress: e.target.value } : x)))} />
                                                                <select value={entry.state} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, state: e.target.value } : x)))} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
                                                                    <option value="">Select state</option>
                                                                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                                                                </select>
                                                                <Input className="bg-white" placeholder={entry.state ? "City" : "Select state first"} disabled={!entry.state} value={entry.city} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, city: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Zip Code" value={entry.zipCode} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, zipCode: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Ownership %" value={entry.ownershipPercentage} onChange={(e) => setOwnerEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ownershipPercentage: e.target.value } : x)))} />
                                                            </div>
                                                        </div>
                                                    ))}

                                                    {activeInfoPanel === "guarantor" && guarantorEntries.map((entry, idx) => (
                                                        <div key={entry.id} className="group relative space-y-3 rounded-lg border border-slate-200 bg-slate-50/30 p-4">
                                                            <div className="flex items-center justify-between">
                                                                <span className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                                                                    <User className="h-3 w-3" />
                                                                    Guarantor #{idx + 1}
                                                                </span>
                                                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50 cursor-pointer" onClick={() => void removeInfoEntry("guarantor", entry.id)}>
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                                <Input className="bg-white" placeholder="First name" value={entry.guarantorFirstName} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, guarantorFirstName: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Last name" value={entry.guarantorLastName} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, guarantorLastName: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Email" value={entry.guarantorEmail} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, guarantorEmail: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Phone" value={entry.guarantorPhone} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, guarantorPhone: e.target.value } : x)))} />
                                                                <Input className="bg-white sm:col-span-2" placeholder="Address" value={entry.guarantorAddress} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, guarantorAddress: e.target.value } : x)))} />
                                                                <select value={entry.state} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, state: e.target.value } : x)))} className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm">
                                                                    <option value="">Select state</option>
                                                                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                                                                </select>
                                                                <Input className="bg-white" placeholder={entry.state ? "City" : "Select state first"} disabled={!entry.state} value={entry.city} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, city: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Zip Code" value={entry.zipCode} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, zipCode: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="SSN Number" value={entry.ssnNumber} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, ssnNumber: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Driver License Number" value={entry.driverLicenseNumber} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, driverLicenseNumber: e.target.value } : x)))} />
                                                                <Input className="bg-white" placeholder="Type of Entity" value={entry.typeOfEntity} onChange={(e) => setGuarantorEntries((prev) => prev.map((x) => (x.id === entry.id ? { ...x, typeOfEntity: e.target.value } : x)))} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div> */}


                                                <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                                                    {infoPanelMessage && (
                                                        <p className="mr-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--brand)]">
                                                            <Info className="h-3 w-3" />
                                                            {infoPanelMessage}
                                                        </p>
                                                    )}
                                                    <Button type="button" variant="ghost" size="sm" className="h-8 text-slate-500 cursor-pointer" onClick={resetActivePanel}>
                                                        Cancel
                                                    </Button>
                                                    <Button type="button" className="h-8 cursor-pointer bg-[image:var(--brand-gradient)] px-6 text-xs text-white hover:opacity-90" onClick={saveActivePanel}>
                                                        Save Details
                                                    </Button>
                                                </div>

                                            </div>
                                        )}
                                        {/* <div className="space-y-3">
                                            <div className="flex items-center gap-2">
                                                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                                    <Layers className="h-3.5 w-3.5" aria-hidden />
                                                </div>
                                                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                                                    Saved Records
                                                </h4>
                                                <span className="h-px flex-1 bg-gradient-to-r from-[var(--brand)]/25 to-slate-200 dark:to-slate-700" />
                                            </div>

                                        
                                            {([
                                                { key: "addendum", title: "Addendum", state: addendumListState, dot: "bg-indigo-500" },
                                                { key: "ach", title: "ACH Details", state: achListState, dot: "bg-emerald-500" },
                                                { key: "epo", title: "EPO Records", state: epoListState, dot: "bg-amber-500" },
                                                { key: "owner", title: "Owners", state: ownerListState, dot: "bg-sky-500" },
                                                { key: "guarantor", title: "Guarantors", state: guarantorListState, dot: "bg-rose-500" },
                                            ] as const).map((section) => {
                                                const count = Array.isArray(section.state.data) ? section.state.data.length : 0;
                                                return (
                                                    <div key={section.title} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                                
                                                        <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-50 to-transparent px-4 py-2.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className={cn("h-2 w-2 rounded-full", section.dot)} />
                                                                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                                                                    {section.title}
                                                                </h3>
                                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                                                    {count}
                                                                </span>
                                                            </div>
                                                        </div>

                                                      
                                                        <div className="divide-y divide-slate-100">
                                                            {Array.isArray(section.state.data) && section.state.data.length > 0 ? (
                                                                section.state.data.map((row: any, idx: number) => {
                                                                    const initial = (() => {
                                                                        if (section.key === "addendum") return (row.legalName1 || row.dba1 || "?").charAt(0);
                                                                        if (section.key === "ach") return (row.bankName || row.accountHolderName || "?").charAt(0);
                                                                        if (section.key === "epo") return (row.legalName || "E").charAt(0);
                                                                        return (row.firstName || row.lastName || "?").charAt(0);
                                                                    })().toUpperCase();
                                                                    return (
                                                                        <div key={idx} className="group flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50/70">
                                                                            <div className="flex min-w-0 flex-1 items-center gap-3">
                                                                                <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white", section.dot)}>
                                                                                    {initial || "?"}
                                                                                </div>
                                                                                <div className="min-w-0 flex-1">
                                                                                    <p className="truncate text-sm font-semibold text-slate-800">
                                                                                        {section.key === "addendum" && (row.legalName1 || row.dba1)}
                                                                                        {section.key === "ach" && (row.bankName || row.accountHolderName)}
                                                                                        {section.key === "epo" && (row.legalName || `Amount: ${row.amountReceived1}`)}
                                                                                        {(section.key === "owner" || section.key === "guarantor") &&
                                                                                            `${row.firstName || ""} ${row.lastName || ""}`.trim()}
                                                                                        {!row && "—"}
                                                                                    </p>
                                                                                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                                                                                        {section.key === "addendum" && (
                                                                                            <>
                                                                                                <span className="truncate">EIN: {row.ein1 || "—"}</span>
                                                                                                <span className="text-slate-300">•</span>
                                                                                                <span className="truncate">{row.typeOfEntity1 || "—"}</span>
                                                                                            </>
                                                                                        )}
                                                                                        {section.key === "ach" && (
                                                                                            <>
                                                                                                <span>Type: {row.accountType || "—"}</span>
                                                                                                <span className="text-slate-300">•</span>
                                                                                                <span>****{row.accountNumber?.slice(-4)}</span>
                                                                                            </>
                                                                                        )}
                                                                                        {section.key === "epo" && (
                                                                                            <span>Date: {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "—"}</span>
                                                                                        )}
                                                                                        {(section.key === "owner" || section.key === "guarantor") && (
                                                                                            <>
                                                                                                <span>{row.ownershipPercentage || "0"}%</span>
                                                                                                <span className="text-slate-300">•</span>
                                                                                                <span className="truncate">{row.email || "No Email"}</span>
                                                                                            </>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            </div>

                                                                            <div className="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                                                                                <Button
                                                                                    type="button"
                                                                                    size="icon"
                                                                                    variant="ghost"
                                                                                    title="View"
                                                                                    className="h-8 w-8 text-slate-600 hover:bg-slate-100"
                                                                                    onClick={() =>
                                                                                        setViewRecordModal({
                                                                                            section: section.key as "addendum" | "ach" | "epo" | "owner" | "guarantor",
                                                                                            title: section.title,
                                                                                            row,
                                                                                        })
                                                                                    }
                                                                                >
                                                                                    <Eye className="h-4 w-4" />
                                                                                </Button>
                                                                                <Button
                                                                                    type="button"
                                                                                    size="icon"
                                                                                    variant="ghost"
                                                                                    title="Edit"
                                                                                    className="h-8 w-8 text-slate-600 hover:bg-slate-100"
                                                                                    onClick={() =>
                                                                                        setEditRecordModal({
                                                                                            section: section.key as "addendum" | "ach" | "epo" | "owner" | "guarantor",
                                                                                            title: section.title,
                                                                                            row,
                                                                                        })
                                                                                    }
                                                                                >
                                                                                    <Pencil className="h-4 w-4" />
                                                                                </Button>
                                                                                <Button
                                                                                    type="button"
                                                                                    size="icon"
                                                                                    variant="ghost"
                                                                                    title="Delete"
                                                                                    className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-600"
                                                                                    onClick={() =>
                                                                                        void deleteFetchedRecord(
                                                                                            section.key as "addendum" | "ach" | "epo" | "owner" | "guarantor",
                                                                                            row,
                                                                                        )
                                                                                    }
                                                                                >
                                                                                    <Trash2 className="h-4 w-4" />
                                                                                </Button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })
                                                            ) : (
                                                                <div className="flex flex-col items-center justify-center gap-1 px-4 py-6 text-center">
                                                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                                                                        <Info className="h-4 w-4" />
                                                                    </div>
                                                                    <p className="text-[11px] text-slate-400">No records available</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div> */}
                                    </section>
                                )}
                                <Dialog
                                    open={!!viewRecordModal}
                                    onOpenChange={(open: boolean) => {
                                        if (!open) setViewRecordModal(null);
                                    }}
                                >
                                    <DialogContent className="sm:max-w-xl dark:bg-slate-900 dark:text-slate-100">
                                        <DialogTitle>
                                            View {viewRecordModal?.title || "Record"}
                                        </DialogTitle>
                                        <div className="max-h-[60vh] overflow-auto rounded border bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40">
                                            {viewRecordModal ? (
                                                <div className="space-y-2 text-sm">
                                                    {Object.entries(viewRecordModal.row || {}).map(([k, v]) => (
                                                        <div key={k} className="grid grid-cols-[180px_1fr] gap-2">
                                                            <span className="font-medium text-slate-600">{k}</span>
                                                            <span className="break-all text-slate-800">
                                                                {v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : null}
                                        </div>
                                    </DialogContent>
                                </Dialog>

                                <ResendUnsignedContractDialog
                                    open={resendUnsignedOpen}
                                    onOpenChange={setResendUnsignedOpen}
                                    envelopeId={sentStepPreviewEnvelopeId ?? ""}
                                    contractLabel={selectedSentRow?.label}
                                    onResent={() => onContractDocumentsChanged?.()}
                                />

                                <Dialog
                                    open={!!editRecordModal}
                                    onOpenChange={(open: boolean) => {
                                        if (!open) setEditRecordModal(null);
                                    }}
                                >
                                    <DialogContent className="sm:max-w-md dark:bg-slate-900 dark:text-slate-100">
                                        <DialogTitle>
                                            Edit {editRecordModal?.title || "Record"}
                                        </DialogTitle>
                                        <p className="text-sm text-slate-600">
                                            This will open the Info Required editor with this record prefilled.
                                        </p>
                                        <div className="flex justify-end gap-2 pt-2">
                                            <Button
                                                variant="ghost"
                                                onClick={() => setEditRecordModal(null)}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                onClick={() => {
                                                    if (!editRecordModal) return;
                                                    openEditorForFetchedRecord(
                                                        editRecordModal.section,
                                                        editRecordModal.row,
                                                    );
                                                    setEditRecordModal(null);
                                                }}
                                            >
                                                Open Editor
                                            </Button>
                                        </div>
                                    </DialogContent>
                                </Dialog>

                                {/* Recipients Section - Only in Summary */}
                                {activeStep === "summary" && (
                                    <section className="space-y-4">
                                        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Contract Recipients</h3>

                                        <div className="space-y-4">
                                            {/* Section Header */}
                                            <div className="flex items-center justify-between px-1">
                                                <h3 className="text-sm font-bold text-slate-800 tracking-tight">Contract Signers</h3>
                                                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                                    {summarySignersReady
                                                        ? `${summaryTemplateRoles.length} Total Recipients`
                                                        : "Loading recipients…"}
                                                </span>
                                            </div>

                                            <div className="grid gap-3">
                                                {!summarySignersReady
                                                    ? Array.from({ length: 2 }).map((_, i) => (
                                                          <div
                                                              key={`signer-skeleton-${i}`}
                                                              className="flex items-center gap-4 rounded-xl border border-[var(--brand)]/10 bg-[var(--brand)]/5 p-3"
                                                          >
                                                              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-200" />
                                                              <div className="flex-1 space-y-2">
                                                                  <div className="h-2.5 w-24 animate-pulse rounded bg-slate-200" />
                                                                  <div className="h-3 w-56 max-w-full animate-pulse rounded bg-slate-100" />
                                                              </div>
                                                          </div>
                                                      ))
                                                    : summaryTemplateRoles.map((r, index) => {
                                                    const roleRow = r as Record<string, unknown>;
                                                    const roleLabel =
                                                        String(roleRow.roleName || "").trim() ||
                                                        getTemplateRoleLabel(roleRow) ||
                                                        `Role-${index + 1}`;
                                                    const signer = {
                                                        role: roleLabel,
                                                        name:
                                                            String(roleRow.signerName || "").trim() ||
                                                            getTemplateRoleNameFromRow(roleRow),
                                                        email:
                                                            String(roleRow.signerEmail || "").trim() ||
                                                            resolveSignerEmailForSummary(
                                                                roleLabel,
                                                                getTemplateRoleEmailFromRow(roleRow),
                                                                docuSignSignerEmail.email,
                                                                hasSavedSignerOverrides,
                                                            ),
                                                    };
                                                    const isOwner = signer.role.toLowerCase().includes("owner");
                                                    const isGuarantor = signer.role.toLowerCase().includes("guarantor");

                                                    return (
                                                        <div
                                                            key={`${signer.role}-${index}`}
                                                            className={`group relative flex items-center gap-4 rounded-xl border p-3 transition-all hover:shadow-sm cursor-pointer ${isOwner ? "border-[var(--brand)]/10 bg-[var(--brand)]/10/30" :
                                                                isGuarantor ? "border-[var(--brand)]/10 bg-[var(--brand)]/10/30" :
                                                                    "border-[var(--brand)]/10 bg-[var(--brand)]/10/30"
                                                                }`}
                                                        >
                                                            {/* Role Icon/Avatar */}
                                                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border shadow-sm ${isOwner ? "bg-white text-blue-600 border-blue-200" :
                                                                isGuarantor ? "bg-white text-purple-600 border-purple-200" :
                                                                    "bg-white text-emerald-600 border-emerald-200"
                                                                }`}>
                                                                <User className="h-5 w-5" />
                                                            </div>

                                                            {/* Signer Details */}
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                                                        {signer.role}
                                                                    </p>
                                                                    {/* Counter for multiple owners/guarantors */}
                                                                    <span className="text-[10px] text-slate-400">#{index + 1}</span>
                                                                </div>

                                                                <div className="mt-0.5 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                                                                    <span className="text-sm font-semibold text-slate-900 truncate">
                                                                        {/* Same name source whether or not signers were saved — switching
                                                                            sources on save is what made this row change under the user. */}
                                                                        {signer.name ||
                                                                            (signer.role === "Client"
                                                                                ? ownerEntries
                                                                                      .map((entry) =>
                                                                                          `${String(entry.ownerFirstName || "").trim()} ${String(entry.ownerLastName || "").trim()}`.trim(),
                                                                                      )
                                                                                      .find(Boolean) || ""
                                                                                : "") ||
                                                                            "Awaiting Name..."}
                                                                    </span>
                                                                    <span className="hidden sm:block text-slate-300">•</span>
                                                                    <span className="text-xs text-slate-600 truncate break-all">
                                                                        {signer.email || "No email provided"}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            {/* Status Indicator */}
                                                            {/* <div className="flex flex-col items-end gap-1">
                                                                {!signer.email || !signer.name ? (
                                                                    <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-100/50 px-2 py-0.5 rounded-md">
                                                                        <AlertCircle className="h-3 w-3" /> Incomplete
                                                                    </span>
                                                                ) : (
                                                                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100/50 px-2 py-0.5 rounded-md">
                                                                        <CheckCircle2 className="h-3 w-3" /> Ready
                                                                    </span>
                                                                )}
                                                            </div> */}

                                                            {/* Quick Action (Edit recipient email) */}
                                                            <div className="ml-auto shrink-0">
                                                                <button
                                                                    type="button"
                                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-[var(--brand)]/40 hover:bg-[var(--brand)]/5 hover:text-[var(--brand)]"
                                                                    title="Edit recipient email"
                                                                    aria-label={`Edit recipient email for ${signer.role}`}
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        openSignerEditor();
                                                                    }}
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* How many signers are allowed per role (informational) */}
                                            {/* <div
                                                className="rounded-lg border border-blue-100 bg-blue-50/90 p-3"
                                                role="note"
                                            >
                                                <div className="flex gap-2.5">
                                                    <Info
                                                        className="h-4 w-4 shrink-0 text-blue-600 mt-0.5"
                                                        aria-hidden
                                                    />
                                                    <div className="min-w-0 space-y-1.5 text-[11px] leading-snug text-slate-700">
                                                        <p className="font-semibold text-slate-800">
                                                            How many signers can you have?
                                                        </p>
                                                        <ul className="space-y-1 pl-0 list-none">
                                                            <li className="flex gap-2">
                                                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                                                                <span>
                                                                    <span className="font-medium text-slate-800">Owner</span>
                                                                    {" — "}
                                                                    this workflow allows{" "}
                                                                    <strong>1 or 2</strong> owner signers (add a second owner
                                                                    in <span className="font-medium">Info Required → Owner</span>{" "}
                                                                    when needed).
                                                                </span>
                                                            </li>
                                                            <li className="flex gap-2">
                                                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
                                                                <span>
                                                                    <span className="font-medium text-slate-800">Guarantor</span>
                                                                    {" — "}
                                                                    you may have{" "}
                                                                    <strong>1 or 2</strong> guarantor signers (same place:{" "}
                                                                    <span className="font-medium">Info Required → Guarantor</span>
                                                                    ).
                                                                </span>
                                                            </li>
                                                            <li className="flex gap-2">
                                                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                                                                <span>
                                                                    <span className="font-medium text-slate-800">Client</span>
                                                                    {" — "}
                                                                    there should be <strong>exactly one</strong> client / merchant
                                                                    signer on the contract.
                                                                </span>
                                                            </li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div> */}
                                            <div className="flex items-center justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="h-8 text-xs cursor-pointer border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                                    onClick={() => {
                                                        if (showRecipientEditor) {
                                                            setShowRecipientEditor(false);
                                                            return;
                                                        }
                                                        openSignerEditor();
                                                    }}
                                                >
                                                    <Plus className="mr-1 h-3.5 w-3.5" />
                                                    {showRecipientEditor ? "Cancel" : "Manage Signers"}
                                                </Button>
                                            </div>

                                            {/* ── Recipient Editor Panel ────────────────────────── */}
                                            {showRecipientEditor && (
                                                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                                                                Edit signers for this contract
                                                            </h4>
                                                            <p className="mt-1 text-[11px] leading-snug text-slate-500">
                                                                Add every owner or guarantor who must sign. The first slot uses
                                                                your template role (e.g. Client); additional signers default to
                                                                Signer. Saved signers are
                                                                sent to DocuSign when you Review &amp; send.
                                                            </p>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 text-xs text-blue-600 gap-1"
                                                            onClick={() =>
                                                                setRecipientEditorRows((prev) => {
                                                                    const nextRole = suggestNextTemplateSignerRole(
                                                                        templateRoleRowsForSigner,
                                                                        prev.map((r) => r.role),
                                                                    );
                                                                    return [
                                                                        ...prev,
                                                                        {
                                                                            id: String(Date.now()),
                                                                            role: nextRole,
                                                                            name: "",
                                                                            email: "",
                                                                        },
                                                                    ];
                                                                })
                                                            }
                                                        >
                                                            <Plus className="h-3.5 w-3.5" /> Add Recipient
                                                        </Button>
                                                    </div>

                                                    <div className="space-y-3">
                                                        {recipientEditorRows.map((entry, idx) => (
                                                            <div
                                                                key={entry.id}
                                                                className="flex items-start gap-2"
                                                            >
                                                                <span className="mt-2.5 text-[10px] font-bold text-slate-400 w-5 shrink-0 text-center">
                                                                    {idx + 1}
                                                                </span>
                                                                <div className="grid grid-cols-3 gap-2 flex-1">
                                                                    <Input
                                                                        placeholder="Role (e.g. Owner)"
                                                                        className="h-9 text-xs"
                                                                        value={entry.role}
                                                                        onChange={(e) =>
                                                                            setRecipientEditorRows((prev) =>
                                                                                prev.map((x) =>
                                                                                    x.id === entry.id
                                                                                        ? { ...x, role: e.target.value }
                                                                                        : x,
                                                                                ),
                                                                            )
                                                                        }
                                                                    />
                                                                    <Input
                                                                        placeholder="Signer Name"
                                                                        className="h-9 text-xs"
                                                                        value={entry.name}
                                                                        onChange={(e) =>
                                                                            setRecipientEditorRows((prev) =>
                                                                                prev.map((x) =>
                                                                                    x.id === entry.id
                                                                                        ? { ...x, name: e.target.value }
                                                                                        : x,
                                                                                ),
                                                                            )
                                                                        }
                                                                    />
                                                                    <Input
                                                                        placeholder="Signer Email"
                                                                        className="h-9 text-xs"
                                                                        value={entry.email}
                                                                        onChange={(e) =>
                                                                            setRecipientEditorRows((prev) =>
                                                                                prev.map((x) =>
                                                                                    x.id === entry.id
                                                                                        ? { ...x, email: e.target.value }
                                                                                        : x,
                                                                                ),
                                                                            )
                                                                        }
                                                                    />
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    className="mt-2 text-slate-400 hover:text-red-500 transition-colors"
                                                                    disabled={recipientEditorRows.length <= 1}
                                                                    onClick={() =>
                                                                        setRecipientEditorRows((prev) =>
                                                                            prev.filter((x) => x.id !== entry.id),
                                                                        )
                                                                    }
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* Save / Cancel footer */}
                                                    <div className="flex items-center justify-end gap-2 pt-3 border-t">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 text-xs text-slate-500"
                                                            onClick={() => setShowRecipientEditor(false)}
                                                        >
                                                            Cancel
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            className="h-8 text-xs bg-[#3B8BD1] hover:bg-[#2d6fad] text-white px-6"
                                                            disabled={
                                                                savingContractRecipients ||
                                                                recipientEditorRows.every((r) => !r.role.trim())
                                                            }
                                                            onClick={async () => {
                                                                const rows = recipientEditorRows
                                                                    .filter((r) => r.role.trim())
                                                                    .map((r) => ({
                                                                        role: r.role.trim(),
                                                                        name: r.name.trim(),
                                                                        email: r.email.trim(),
                                                                    }));
                                                                const roles =
                                                                    buildDocuSignRolesFromEditorRows(rows);
                                                                if (!roles.length) {
                                                                    toast.error(
                                                                        "Enter a role name and email for at least one signer.",
                                                                    );
                                                                    return;
                                                                }
                                                                const missingEmail = rows.some(
                                                                    (r) => r.role && !r.email,
                                                                );
                                                                if (missingEmail) {
                                                                    toast.error(
                                                                        "Every signer role needs an email address.",
                                                                    );
                                                                    return;
                                                                }
                                                                setSavingContractRecipients(true);
                                                                try {
                                                                    const hadDraft = Boolean(
                                                                        String(
                                                                            sessionEnvelopeIdRef.current ||
                                                                                "",
                                                                        ).trim(),
                                                                    );
                                                                    setContractSignerOverrides(rows);
                                                                    /** Layout envelopes cannot add a 2nd signer slot via sync — always rebuild draft. */
                                                                    invalidateDocuSignDraftSession();
                                                                    const cid = effectiveContractId;
                                                                    if (cid != null) {
                                                                        const prefillBase =
                                                                        stripDocumentTemplateBlobFromPrefillOverrides(
                                                                            normalizeContractPrefillOverrides(
                                                                                contractPrefillFromDb ??
                                                                                    (resolvedContract as {
                                                                                        contractPrefillOverrides?: unknown;
                                                                                    } | null)
                                                                                        ?.contractPrefillOverrides,
                                                                            ) ?? null,
                                                                        ) ??
                                                                        contractPrefillFromDb ??
                                                                        (resolvedContract as {
                                                                            contractPrefillOverrides?: unknown;
                                                                        } | null)?.contractPrefillOverrides;
                                                                        const contractPrefillOverrides =
                                                                            mergeContractPrefillWithSignerOverrides(
                                                                                prefillBase,
                                                                                rows,
                                                                            );
                                                                        const primary = rows[0];
                                                                        const columnSync: UpdateContractData = {
                                                                            contractPrefillOverrides,
                                                                        };
                                                                        if (primary?.email) {
                                                                            columnSync.clientEmail = primary.email;
                                                                        }
                                                                        if (primary?.name) {
                                                                            columnSync.clientName = primary.name;
                                                                        }
                                                                        const updated = await dispatch(
                                                                            updateContract({
                                                                                id: cid,
                                                                                data: columnSync,
                                                                            }),
                                                                        ).unwrap();
                                                                        const payload =
                                                                            (updated as { data?: unknown })?.data ??
                                                                            updated;
                                                                        setResolvedContract((prev) =>
                                                                            prev && typeof prev === "object"
                                                                                ? {
                                                                                      ...prev,
                                                                                      ...(payload as Record<
                                                                                          string,
                                                                                          unknown
                                                                                      >),
                                                                                      contractPrefillOverrides,
                                                                                  }
                                                                                : (payload as Record<string, unknown>),
                                                                        );
                                                                        setContractPrefillFromDb(
                                                                            stripDocumentTemplateBlobFromPrefillOverrides(
                                                                                normalizeContractPrefillOverrides(
                                                                                    contractPrefillOverrides,
                                                                                ) ?? null,
                                                                            ),
                                                                        );
                                                                        const ownerCountSaved =
                                                                            resolveActiveOwnerCount({
                                                                                signerRoles:
                                                                                    buildDocuSignRolesFromEditorRows(
                                                                                        rows,
                                                                                    ),
                                                                            });
                                                                        const ownersRes =
                                                                            await dispatch(
                                                                                getAllContractOwners({
                                                                                    contractId: cid,
                                                                                }),
                                                                            ).unwrap();
                                                                        const dbOwners =
                                                                            Array.isArray(
                                                                                (
                                                                                    ownersRes as {
                                                                                        data?: unknown;
                                                                                    }
                                                                                )?.data,
                                                                            )
                                                                                ? ((
                                                                                      ownersRes as {
                                                                                          data: unknown[];
                                                                                      }
                                                                                  )
                                                                                      .data as Record<
                                                                                      string,
                                                                                      unknown
                                                                                  >[])
                                                                                : [];
                                                                        /** Signer 1 → Client Owner 1, Signer 2 → Client Owner 2. */
                                                                        await syncContractSignerRowsToCrm({
                                                                            dispatch,
                                                                            contractId: cid,
                                                                            applicationData:
                                                                                applicationDataRef.current,
                                                                            signerRows: rows.slice(
                                                                                0,
                                                                                Math.min(
                                                                                    2,
                                                                                    Math.max(
                                                                                        1,
                                                                                        ownerCountSaved,
                                                                                    ),
                                                                                ),
                                                                            ),
                                                                            existingContractOwners: dbOwners,
                                                                        });
                                                                    }
                                                                    toast.success(
                                                                        hadDraft
                                                                            ? "Signers saved. Click Review & send again to open DocuSign with the updated signers."
                                                                            : cid != null
                                                                              ? "Signers saved. They will be used when you Review & send."
                                                                              : "Signers updated for this session. They will be used when you Review & send.",
                                                                    );
                                                                    setShowRecipientEditor(false);
                                                                } catch (err: unknown) {
                                                                    const msg =
                                                                        await parseApiErrorMessageFromAxios(
                                                                            err,
                                                                        );
                                                                    toast.error(msg);
                                                                } finally {
                                                                    setSavingContractRecipients(false);
                                                                }
                                                            }}
                                                        >
                                                            {savingContractRecipients
                                                                ? "Saving..."
                                                                : "Save signers"}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* <Button variant="ghost" size="sm" className="text-blue-600 text-xs">+ Add Secondary Signer (R3)</Button> */}

                                    </section>
                                )}

                                {/* Exhibit A companies + Deal Review — Summary */}
                                {activeStep === "summary" && (
                                    <section className="mt-4 space-y-4 border-t pt-4">
                                        <div className="border p-4 rounded-lg">
                                            <ExhibitACompaniesSummarySection
                                                contractId={effectiveContractId}
                                                applicationUuid={applicationIdForLookup}
                                                canEdit={canEditContractPrefill}
                                                prefillOverridesReady={contractPrefillLoaded}
                                                persistedPrefillOverrides={
                                                    contractPrefillLoaded ? contractPrefillFromDb : undefined
                                                }
                                                applicationData={applicationData}
                                                addendum={
                                                    contractPrefillRecords.addendums?.length
                                                        ? contractPrefillRecords.addendums
                                                        : contractPrefillRecords.addendum ?? null
                                                }
                                                documentTemplatePrefillByMappingId={
                                                    documentTemplatePrefillByMappingId
                                                }
                                                onPersistedPrefillChange={(next) => {
                                                    setContractPrefillFromDb(next ?? null);
                                                }}
                                                onPersistedPrefillFullChange={(full) => {
                                                    setDocumentTemplatePrefillByMappingId(
                                                        parseDocumentTemplatePrefillByMappingId(full),
                                                    );
                                                    setResolvedContract((prev) =>
                                                        prev
                                                            ? { ...prev, contractPrefillOverrides: full ?? null }
                                                            : prev,
                                                    );
                                                }}
                                                onDraftInvalidate={invalidateDocuSignDraftSession}
                                            />
                                        </div>

                                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                            <div className="min-w-0 flex-1">
                                                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                                    Deal Review
                                                </h3>
                                                <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                                    Read-only summary of CRM values for DocuSign labels. Use Edit
                                                    prefill fields to change values, then Review &amp; send in DocuSign.
                                                </p>
                                            </div>
                                            {canEditContractPrefill ? (
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 shrink-0 gap-1.5 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                                        onClick={() => setSpaCalcModalOpen(true)}
                                                    >
                                                        <Calculator className="h-3.5 w-3.5" aria-hidden />
                                                        Calculate SPA
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 shrink-0"
                                                        onClick={() => setContractPrefillEditOpen(true)}
                                                    >
                                                        Edit prefill fields
                                                    </Button>
                                                </div>
                                            ) : null}
                                        </div>

                                        <div className="space-y-4 border p-4 rounded-lg">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-blue-600 font-bold text-[11px] uppercase">Contract Details</span>
                                                {/* <span className="text-[11px] text-slate-400">Auto-filled from contract</span> */}
                                            </div>
                                            {(() => {
                                                const effectiveFields = dealReviewFields;
                                                if (!effectiveFields.length) {
                                                    return (
                                                        <p className="text-xs text-slate-500 dark:text-slate-400 italic py-2">
                                                            No contract details to show. Ensure this application has a linked
                                                            client (business name, address, EIN, etc.) or pass prefill fields from
                                                            the contract flow.
                                                        </p>
                                                    );
                                                }
                                                const grouped: Record<string, typeof effectiveFields> = {};
                                                for (const f of effectiveFields) {
                                                    const cat = categorizeDealReviewPrefillFieldId(f.id);
                                                    if (!grouped[cat]) grouped[cat] = [];
                                                    grouped[cat].push(f);
                                                }
                                                const order = [
                                                    "General",
                                                    "Parties",
                                                    "Business Address",
                                                    "Contract Address",
                                                    "Deal Terms",
                                                    "ACH",
                                                    "Authorization",
                                                    "Addendum",
                                                    "EPOs",
                                                    "Security",
                                                    "Guarantor",
                                                    "Guaranty",
                                                    "Appendix",
                                                    "Other",
                                                ];
                                                const renderFieldRow = (field: (typeof effectiveFields)[number]) => {
                                                    const displayValue =
                                                        dealReviewDraftById[field.id] ??
                                                        String(field.value ?? "");
                                                    return (
                                                        <Fragment key={field.id}>
                                                            <div className="text-slate-500 dark:text-slate-400">
                                                                {field.label}
                                                            </div>
                                                            <div className="font-medium break-all text-slate-900 dark:text-slate-100">
                                                                {formatDisplayValueForUs(
                                                                    field.id || field.label || "",
                                                                    displayValue,
                                                                )}
                                                            </div>
                                                        </Fragment>
                                                    );
                                                };
                                                const renderCategoryBlock = (cat: string, fields: typeof effectiveFields) => {
                                                    const subGrouped: Record<string, typeof effectiveFields> = {
                                                        "": [],
                                                    };
                                                    for (const f of fields) {
                                                        const sub =
                                                            dealReviewPrefillSubsection(f.id, cat) ?? "";
                                                        if (!subGrouped[sub]) subGrouped[sub] = [];
                                                        subGrouped[sub].push(f);
                                                    }
                                                    const subOrder = [
                                                        "",
                                                        "Principal",
                                                        "Entity slots",
                                                        "Account holder",
                                                        "Bank",
                                                        "Consent",
                                                        "References",
                                                        "Online banking",
                                                        "Address",
                                                        "Contact",
                                                        "Client",
                                                        "Owner 1",
                                                        "Owner 2",
                                                        "Exhibit A companies",
                                                        "General",
                                                    ];
                                                    return (
                                                        <div key={cat}>
                                                            <div className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase mb-2">
                                                                {cat}
                                                            </div>
                                                            {subOrder
                                                                .filter((sub) => subGrouped[sub]?.length)
                                                                .map((sub) => (
                                                                    <div
                                                                        key={`${cat}-${sub || "main"}`}
                                                                        className={
                                                                            sub
                                                                                ? "mt-5 pt-3 border-t border-slate-200/90 dark:border-slate-600 mb-2"
                                                                                : "mb-2"
                                                                        }
                                                                    >
                                                                        {sub ? (
                                                                            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                                                                                {sub}
                                                                            </div>
                                                                        ) : null}
                                                                        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                                                                            {subGrouped[sub].map((field) =>
                                                                                renderFieldRow(field),
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                        </div>
                                                    );
                                                };
                                                return order
                                                    .filter((k) => grouped[k]?.length)
                                                    .map((cat) => renderCategoryBlock(cat, grouped[cat]!));
                                            })()}
                                        </div>

                                        <div className="mt-4 space-y-3 border p-4 rounded-lg">
                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                <span className="text-blue-600 font-bold text-[11px] uppercase">
                                                    Offer decision
                                                </span>
                                                {offerDecisionLoading ? (
                                                    <span className="text-[11px] text-slate-400">Loading…</span>
                                                ) : null}
                                            </div>
                                            {!applicationIdForLookup ? (
                                                <p className="text-xs text-slate-500 dark:text-slate-400 italic py-1">
                                                    Open this viewer from an application with an application ID to load offer
                                                    decision.
                                                </p>
                                            ) : offerDecisionLoading && !offerDecisionData ? (
                                                <p className="text-xs text-slate-500 dark:text-slate-400 italic py-1">
                                                    Loading offer decision…
                                                </p>
                                            ) : !offerDecisionData ? (
                                                <p className="text-xs text-slate-500 dark:text-slate-400 italic py-1">
                                                    No offer decision found for this application.
                                                </p>
                                            ) : (
                                                <div className="grid grid-cols-2 gap-y-3 text-sm">
                                                    {offerDecisionSummaryRows.map((field) => (
                                                        <Fragment key={field.label}>
                                                            <div className="text-slate-500 dark:text-slate-400">
                                                                {field.label}
                                                            </div>
                                                            <div className="font-medium break-all text-slate-900 dark:text-slate-100">
                                                                {field.value}
                                                            </div>
                                                        </Fragment>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                )}

                                {activeStep === "sent" && (
                                    <section className="space-y-4">
                                        {sentEnvelopeRows.length > 0 ? (
                                            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                                <label
                                                    htmlFor="sent-envelope-select"
                                                    className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                                                >
                                                    Sent document
                                                </label>
                                                <Select
                                                    value={selectedSentRow?.key ?? ""}
                                                    onValueChange={(value: string) => {
                                                        setSelectedSentEnvelopeKey(value);
                                                        const row = sentEnvelopeRows.find(
                                                            (item) => item.key === value,
                                                        );
                                                        if (row?.envelopeId) {
                                                            invalidateDocuSignPdfCache();
                                                            setPdfRightPaneTab("docusign");
                                                            void loadPrefilledPdfFromDocuSign(
                                                                row.envelopeId,
                                                                { maxAttempts: 1 },
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <SelectTrigger
                                                        id="sent-envelope-select"
                                                        className="h-10 w-full bg-white dark:bg-slate-900"
                                                    >
                                                        <SelectValue placeholder="Select a sent document" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {sentEnvelopeRows.map((row) => (
                                                            <SelectItem key={row.key} value={row.key}>
                                                                {row.label} —{" "}
                                                                {getContractSendTableRowStatusLabel(row)}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        ) : null}

                                        <div className="overflow-hidden rounded-2xl border border-[var(--brand)]/20 bg-white shadow-sm dark:border-[var(--brand)]/25 dark:bg-slate-950">
                                            <div className="bg-[image:var(--brand-gradient)] px-5 py-5 text-white">
                                                <div className="flex items-start gap-3">
                                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                                                        <CheckCircle2 className="h-7 w-7" aria-hidden />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-semibold uppercase tracking-wide text-white/80">
                                                            Sent successfully
                                                        </p>
                                                        <h3 className="mt-1 text-lg font-semibold tracking-tight">
                                                            {selectedSentRow &&
                                                            isContractSendTableRowFullySigned(selectedSentRow)
                                                                ? `${selectedSentRow.label} fully signed`
                                                                : `${selectedSentRow?.label ?? "Document"} is on its way for signature`}
                                                        </h3>
                                                        <p className="mt-1 text-sm leading-relaxed text-white/85">
                                                            {selectedSentRow &&
                                                            isContractSendTableRowFullySigned(selectedSentRow)
                                                                ? "All signers completed. The PDF on the right includes signatures."
                                                                : canResendContract && isContractOutForSignature
                                                                  ? "Signers have an open envelope. You can void it, or send a new contract without voiding the previous one."
                                                                  : canResendContract
                                                                    ? "All signers completed. Use Send new contract below to start a new envelope, or view the signed PDF on the right."
                                                                    : isSignNowContractUiEnabled()
                                                                        ? "The SignNow contract was sent. You can void it or send a new contract from the buttons below."
                                                                        : "The DocuSign envelope was sent. Status and contract details refresh automatically."}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid gap-3 p-4 sm:grid-cols-2">
                                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                                                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                        <FileSignature className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />
                                                        Document
                                                    </div>
                                                    <p className="break-words text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                        {displayContractFileName}
                                                    </p>
                                                    <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                                                        Status: {latestEnvelopeStatusLabel}
                                                    </p>
                                                </div>
                                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                                                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                        <Clock className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />
                                                        Sent time
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                        {(() => {
                                                            if (sentAt) return sentAt.toLocaleString();
                                                            const doc = pickContractEnvelopeDocument(resolvedContract);
                                                            const docSentAt = doc?.sentAt as string | undefined;
                                                            if (docSentAt) return formatDateTimeUS(String(docSentAt), "—");
                                                            const docUpdatedAt = doc?.updatedAt as string | undefined;
                                                            if (docUpdatedAt) return formatDateTimeUS(String(docUpdatedAt), "—");
                                                            if (resolvedContract?.updatedAt) {
                                                                return formatDateTimeUS(String(resolvedContract.updatedAt), "—");
                                                            }
                                                            return "—";
                                                        })()}
                                                    </p>
                                                </div>
                                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                                                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                        Envelope ID
                                                    </div>
                                                    <p className="break-all text-xs font-medium text-slate-900 dark:text-slate-100">
                                                        {String(
                                                            selectedSentRow?.envelopeId ??
                                                                pickContractEnvelopeDocument(resolvedContract)
                                                                    ?.envelopeId ??
                                                                linkedEnvelopeId ??
                                                                sessionEnvelopeId ??
                                                                "—",
                                                        )}
                                                    </p>
                                                </div>
                                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                                                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                        Funder / State
                                                    </div>
                                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                        {[
                                                            resolvedContract?.funderName,
                                                            selectedFunder,
                                                        ]
                                                            .map((v) => String(v ?? "").trim())
                                                            .find(Boolean) || "—"}
                                                        {" · "}
                                                        {[
                                                            resolvedContract?.state,
                                                            selectedState,
                                                        ]
                                                            .map((v) => String(v ?? "").trim())
                                                            .find(Boolean) || "—"}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-2xl border border-[var(--brand)]/15 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                            <div className="mb-3 flex items-center justify-between gap-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand)]/10 text-[var(--brand)]">
                                                        <Mail className="h-4 w-4" aria-hidden />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                            Notification Summary
                                                        </h3>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                                            Copies included with this send.
                                                        </p>
                                                    </div>
                                                </div>
                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                                    {sentCcEmails.length} CC
                                                </span>
                                            </div>

                                            {sentCcEmails.length ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {sentCcEmails.map((email) => (
                                                        <span
                                                            key={email}
                                                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--brand)]/20 bg-[var(--brand)]/8 px-2.5 py-1 text-xs font-medium text-[var(--brand)]"
                                                        >
                                                            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                                            <span className="truncate">{email}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                                                    No CC recipients were added for this send.
                                                </p>
                                            )}
                                        </div>

                                        <div className="rounded-2xl border border-[var(--brand)]/15 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                                <div className="flex items-start gap-2">
                                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)]/10 text-[var(--brand)]">
                                                        <Info className="h-4 w-4" aria-hidden />
                                                    </div>
                                                    <div>
                                                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                            Contract signing status
                                                        </h3>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                                            CRM status is updated when DocuSign webhooks are received (viewed, signed,
                                                            completed, etc.).
                                                        </p>
                                                    </div>
                                                </div>

                                            </div>
                                            {(() => {
                                                const status = String(
                                                    resolveLatestEnvelopeStatus(resolvedContract) || "",
                                                )
                                                    .trim()
                                                    .toUpperCase();
                                                const chain = [
                                                    { key: "SENT", label: "Sent", hint: "Envelope sent" },
                                                    { key: "VIEWED", label: "Viewed", hint: "Signer opened" },
                                                    { key: "SIGNED", label: "Signed", hint: "Signature captured" },
                                                    { key: "COMPLETED", label: "Completed", hint: "All done" },
                                                ];
                                                const rank: Record<string, number> = {
                                                    DRAFT: -1,
                                                    SENT: 0,
                                                    VIEWED: 1,
                                                    SIGNED: 2,
                                                    COMPLETED: 3,
                                                };
                                                const terminalStatuses = ["DECLINED", "REVOKED", "EXPIRED"];
                                                const isTerminal = terminalStatuses.includes(status);
                                                const activeIndex = isTerminal ? -1 : rank[status] ?? -1;

                                                return (
                                                    <div className="space-y-3">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="inline-flex items-center rounded-full bg-[var(--brand)]/12 px-3 py-1 text-xs font-semibold text-[var(--brand)]">
                                                                {latestEnvelopeStatusLabel}
                                                            </span>
                                                        </div>
                                                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60">
                                                            <div className="flex items-start">
                                                                {chain.map((step, index) => {
                                                                    const isDone = activeIndex >= index;
                                                                    const isCurrent = activeIndex === index;
                                                                    return (
                                                                        <Fragment key={step.key}>
                                                                            <div className="flex min-w-[70px] flex-1 flex-col items-center text-center">
                                                                                <div
                                                                                    className={cn(
                                                                                        "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                                                                                        isDone
                                                                                            ? "border-[var(--brand)] bg-[image:var(--brand-gradient)] text-white shadow-sm shadow-[var(--brand)]/25"
                                                                                            : "border-slate-300 bg-white text-slate-400 dark:border-slate-600 dark:bg-slate-950",
                                                                                    )}
                                                                                >
                                                                                    {isDone ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : index + 1}
                                                                                </div>
                                                                                <div className="mt-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                                                                    {step.label}
                                                                                </div>
                                                                                <div
                                                                                    className={cn(
                                                                                        "mt-0.5 text-[10px] leading-snug",
                                                                                        isCurrent ? "text-[var(--brand)]" : "text-slate-400",
                                                                                    )}
                                                                                >
                                                                                    {step.hint}
                                                                                </div>
                                                                            </div>
                                                                            {index < chain.length - 1 ? (
                                                                                <div
                                                                                    className={cn(
                                                                                        "mt-4 h-0.5 w-8 shrink-0 rounded-full",
                                                                                        activeIndex > index ? "bg-[image:var(--brand-gradient)]" : "bg-slate-200 dark:bg-slate-700",
                                                                                    )}
                                                                                />
                                                                            ) : null}
                                                                        </Fragment>
                                                                    );
                                                                })}
                                                            </div>
                                                            {isTerminal ? (
                                                                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                                                                    Signing flow ended with status: {formatContractSigningStatusLabel(status)}.
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                <button
                                                    type="button"
                                                    aria-label={signingStatusRefreshing ? "Refreshing status" : "Refresh status"}
                                                    title={
                                                        signingFinishedForPoll
                                                            ? "Signing is complete — status no longer polls SignNow"
                                                            : signingStatusRefreshing
                                                              ? "Refreshing…"
                                                              : "Refresh status"
                                                    }
                                                    disabled={
                                                        signingStatusRefreshing ||
                                                        signingFinishedForPoll ||
                                                        (!applicationIdForLookup && !Number.isFinite(Number(contractId)))
                                                    }
                                                    onClick={() => {
                                                        if (signingFinishedForPoll) return;
                                                        void (async () => {
                                                            await refreshContractSigningState(false, {
                                                                syncDocuSign: true,
                                                                forceDocuSignSync: true,
                                                            });
                                                            forceReloadDocuSignPdfPreview();
                                                        })();
                                                    }}
                                                    className="inline-flex cursor-pointer h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--brand)] transition-colors hover:bg-[var(--brand)]/10 disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    <RefreshCw
                                                        className={cn(
                                                            "h-3.5 w-3.5",
                                                            signingStatusRefreshing && "animate-spin",
                                                        )}
                                                        aria-hidden
                                                    />
                                                </button>
                                                <span>
                                                    Last checked:{" "}
                                                    <span className="font-medium text-slate-700 dark:text-slate-300">
                                                        {lastSigningStatusSyncAt
                                                            ? formatDateTimeUS(
                                                                  lastSigningStatusSyncAt.toISOString(),
                                                                  "Not yet",
                                                              )
                                                            : "Not yet"}
                                                    </span>
                                                    {resolvedContract?.updatedAt != null &&
                                                    String(resolvedContract.updatedAt).trim() !== "" ? (
                                                        <>
                                                            {" "}
                                                            · CRM record updated{" "}
                                                            {formatDateTimeUS(
                                                                String(resolvedContract.updatedAt),
                                                                "",
                                                            )}
                                                        </>
                                                    ) : null}
                                                </span>
                                            </p>
                                        </div>

                                        <div className="rounded-2xl border border-[var(--brand)]/15 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                            <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                Latest contract details
                                            </h3>
                                            {dealReviewFields.length > 0 ? (
                                                <div className="mb-4 grid max-h-64 grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto text-sm">
                                                    {dealReviewFields.map((field) => (
                                                        <Fragment key={field.id}>
                                                            <div className="text-slate-500 dark:text-slate-400">
                                                                {field.label}
                                                            </div>
                                                            <div className="font-medium break-all text-slate-900 dark:text-slate-100">
                                                                {formatDisplayValueForUs(
                                                                    field.id || field.label || "",
                                                                    field.value,
                                                                )}
                                                            </div>
                                                        </Fragment>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                                                    No prefill details loaded yet. Click refresh on signing status
                                                    above.
                                                </p>
                                            )}
                                            {offerDecisionSummaryRows.length > 0 ? (
                                                <>
                                                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--brand)]">
                                                        Offer decision
                                                    </h4>
                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                                        {offerDecisionSummaryRows.map((field) => (
                                                            <Fragment key={field.label}>
                                                                <div className="text-slate-500 dark:text-slate-400">
                                                                    {field.label}
                                                                </div>
                                                                <div className="font-medium break-all text-slate-900 dark:text-slate-100">
                                                                    {field.value}
                                                                </div>
                                                            </Fragment>
                                                        ))}
                                                    </div>
                                                </>
                                            ) : null}
                                        </div>

                                    </section>
                                )}
                                <div
                                    className="mt-2 flex shrink-0 items-center"
                                    role="toolbar"
                                    aria-label="Contract wizard steps"
                                >
                                    {canGoPreviousStep && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="mr-auto h-9 rounded-sm border-slate-300 px-4 text-sm dark:border-slate-600"
                                            onClick={goToPreviousStep}
                                        >
                                            Previous
                                        </Button>
                                    )}
                                    {canGoNextStep && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="ml-auto h-9 rounded-sm bg-[image:var(--brand-gradient)] px-4 text-sm text-white hover:opacity-90 disabled:opacity-60"
                                            onClick={goToNextStep}
                                        >
                                            Next
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* SignNow / contract document — 60% right */}
                        <div
                            className={`relative flex h-full min-h-0 w-[60%] min-w-0 flex-col bg-slate-700 ${
                                signNowEmbedUrl ? "gap-0 p-0" : "gap-2 p-3"
                            }`}
                        >
                            {signNowEmbedUrl ? null : (
                            <div className="flex shrink-0 items-center gap-2">
                            <div
                                className="flex min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800/80 p-0.5"
                                role="tablist"
                                aria-label="PDF preview source"
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={pdfRightPaneTab === "template"}
                                    className={`flex-1 rounded-md px-3 py-1.5 text-center text-[11px] font-semibold transition-colors ${pdfRightPaneTab === "template"
                                        ? "bg-white text-slate-900 shadow-sm"
                                        : "text-slate-300 hover:text-white"
                                        }`}
                                    onClick={() => setPdfRightPaneTab("template")}
                                >
                                    Contract template
                                </button>
                                {showDocuSignContractTab ? (
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={pdfRightPaneTab === "docusign"}
                                        className={`flex-1 rounded-md px-3 py-1.5 text-center text-[11px] font-semibold transition-colors ${pdfRightPaneTab === "docusign"
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-300 hover:text-white"
                                            }`}
                                        onClick={() => setPdfRightPaneTab("docusign")}
                                    >
                                        {String(resolvedContract?.status ?? "").toUpperCase() ===
                                        "COMPLETED"
                                            ? "Signed contract"
                                            : isSignNowContractUiEnabled()
                                              ? "SignNow contract"
                                              : "DocuSign envelope"}
                                    </button>
                                ) : null}
                            </div>
                            {canDownloadFilledContract ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 shrink-0 border-slate-500 bg-slate-800/90 text-[11px] text-white hover:bg-slate-700 hover:text-white"
                                    disabled={downloadingFilledContract}
                                    onClick={() => void downloadFilledContractPdf()}
                                >
                                    {downloadingFilledContract ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                    ) : (
                                        <Download className="h-3.5 w-3.5" aria-hidden />
                                    )}
                                </Button>
                            ) : null}
                            </div>
                            )}
                            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded bg-white shadow-2xl">
                                {signNowEmbedUrl ? (
                                    <div
                                        className={
                                            signNowReviewVisible
                                                ? "absolute inset-0 z-10 flex min-h-0 flex-col bg-white"
                                                : "hidden"
                                        }
                                    >
                                        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                                            <p className="text-[11px] font-medium text-slate-700">
                                                {signNowReviewComplete
                                                    ? "Owner review is done. Send to the merchant, go back into SignNow, or change details first."
                                                    : "SignNow is open in a separate tab. Deal fields are already filled. Click Finish there, then Send via SignNow so the merchant only has to sign."}
                                            </p>
                                            <div className="flex shrink-0 items-center gap-1.5">
                                                {signNowReviewComplete ? null : (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        className="h-7 px-2 text-[11px] font-semibold text-[var(--brand)]"
                                                        onClick={markSignNowReviewCompleteAndPersist}
                                                    >
                                                        I&apos;ve clicked Finish
                                                    </Button>
                                                )}
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="h-7 px-2 text-[11px]"
                                                    onClick={() => {
                                                        signNowForceFreshReviewRef.current = false;
                                                        setSignNowReviewVisible(false);
                                                        // Closing the pane is not a walk-back: a finished
                                                        // review stays finished (and persisted), so the
                                                        // footer keeps offering Send via SignNow.
                                                        closeSignNowReviewTab();
                                                        toast.dismiss(SIGNNOW_REVIEW_TOAST_ID);
                                                    }}
                                                >
                                                    Close review
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="relative min-h-0 flex-1">
                                            {isSending ? (
                                                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 px-6">
                                                    <div className="max-w-sm text-center">
                                                        <p className="text-sm font-semibold text-slate-900">
                                                            Sending via SignNow…
                                                        </p>
                                                        <p className="mt-2 text-xs text-slate-600">
                                                            Emailing the merchant. This can take up to a minute
                                                            for a full addenda package. Do not close this window.
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : signNowReviewComplete ? (
                                                <div className="absolute inset-0 bg-slate-100" aria-hidden />
                                            ) : (
                                                <div className="absolute inset-0 flex items-center justify-center bg-slate-50 px-6">
                                                    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
                                                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
                                                            <ExternalLink
                                                                className="h-7 w-7 text-[var(--brand)]"
                                                                aria-hidden
                                                            />
                                                        </div>
                                                        <h3 className="text-lg font-semibold text-slate-900">
                                                            SignNow opened in a new tab
                                                        </h3>
                                                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                                            Review the package there and click Finish. The deal
                                                            stays open here — the CRM switches to Send via
                                                            SignNow on its own once the review is finished.
                                                        </p>
                                                        <Button
                                                            type="button"
                                                            className="mt-6 h-11 w-full cursor-pointer border-0 bg-[image:var(--brand-gradient)] text-white hover:opacity-90"
                                                            onClick={() => openSignNowReviewTab(signNowEmbedUrl)}
                                                        >
                                                            <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                                                            Open SignNow tab
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="mt-3 h-10 w-full cursor-pointer text-sm font-medium"
                                                            onClick={markSignNowReviewCompleteAndPersist}
                                                        >
                                                            I&apos;ve clicked Finish
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                            {signNowReviewComplete ? (
                                                <div
                                                    className="absolute inset-0 z-20 flex items-center justify-center bg-slate-900 px-6"
                                                    role="dialog"
                                                    aria-label="Owner review complete"
                                                >
                                                    <div className="w-full max-w-md rounded-2xl border border-white/70 bg-white/95 p-8 text-center shadow-2xl">
                                                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                                                            <CheckCircle2
                                                                className="h-8 w-8 text-emerald-600"
                                                                aria-hidden
                                                            />
                                                        </div>
                                                        <h3 className="text-lg font-semibold text-slate-900">
                                                            Owner review complete
                                                        </h3>
                                                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                                                            Send now, or go back to change details and
                                                            review again before the merchant is emailed.
                                                        </p>
                                                        <Button
                                                            type="button"
                                                            variant="default"
                                                            className="mt-6 h-12 w-full cursor-pointer border-0 bg-[image:var(--brand-gradient)] px-8 text-base font-semibold text-white shadow-lg hover:opacity-90"
                                                            onClick={() => void handleSendViaSendGrid()}
                                                            disabled={
                                                                isSending ||
                                                                isSendingViaSendGrid ||
                                                                isCancellingContract
                                                            }
                                                        >
                                                            {isSendingViaSendGrid ? (
                                                                <Loader2
                                                                    className="mr-2 h-4 w-4 animate-spin"
                                                                    aria-hidden
                                                                />
                                                            ) : (
                                                                <Send className="mr-2 h-4 w-4" aria-hidden />
                                                            )}
                                                            {isSendingViaSendGrid
                                                                ? "Sending via SignNow…"
                                                                : "Send via SignNow"}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="mt-3 h-10 w-full cursor-pointer text-sm font-medium"
                                                            onClick={handleBackToSignNow}
                                                            disabled={
                                                                isSending ||
                                                                isSendingViaSendGrid ||
                                                                isCancellingContract
                                                            }
                                                        >
                                                            Back to SignNow
                                                        </Button>
                                                        <button
                                                            type="button"
                                                            className="mt-3 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
                                                            onClick={handleChangeDetailsBeforeSend}
                                                            disabled={
                                                                isSending ||
                                                                isSendingViaSendGrid ||
                                                                isCancellingContract
                                                            }
                                                        >
                                                            Change details first
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : null}
                                {!(signNowEmbedUrl && signNowReviewVisible) ? (
                                pdfRightPaneTab === "template" ? (
                                    currentPreviewUrl ? (
                                    <DirectPdfViewer
                                        key={`${selectedFunderProfileId || selectedFunder}:${currentPreviewUrl}`}
                                        fileUrl={currentPreviewUrl}
                                        fileName={displayContractFileName}
                                        errorMessage="Could not render this PDF. Please check that the PDF URL is reachable and allows browser access."
                                    />
                                    ) : (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white px-4 text-center text-xs text-slate-500">
                                            {previewingMainContract ||
                                            (isSignNowContractUiEnabled() &&
                                                !currentPreviewUrl &&
                                                !documentUploadMessage) ? (
                                                <>
                                                    <Loader2 className="h-6 w-6 animate-spin text-[var(--brand)]" aria-hidden />
                                                    <span>
                                                        {isSignNowContractUiEnabled()
                                                            ? "Loading contract…"
                                                            : "Loading funder contract template…"}
                                                    </span>
                                                </>
                                            ) : (
                                                <span>
                                                    {documentUploadMessage ||
                                                        (selectedFunder
                                                            ? `No contract PDF configured for ${selectedFunder}.`
                                                            : "Select a funder to preview the contract template.")}
                                                </span>
                                            )}
                                        </div>
                                    )
                                ) : prefilledBoldSignPdfLoading ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white px-4 text-center text-xs text-slate-500">
                                        <Loader2 className="h-6 w-6 animate-spin text-[var(--brand)]" aria-hidden />
                                        <span>Loading contract from {isSignNowContractUiEnabled() ? "SignNow" : "DocuSign"}…</span>
                                    </div>
                                ) : prefilledBoldSignPdfUrl ? (
                                    <DirectPdfViewer fileUrl={prefilledBoldSignPdfUrl} />
                                ) : (
                                    <div className="absolute inset-0 flex min-h-[200px] items-center justify-center bg-white px-4 text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                        {prefilledBoldSignPdfHint
                                            ? prefilledBoldSignPdfHint
                                            : isSignNowContractUiEnabled() && activeStep !== "sent"
                                              ? "Review and send the contract, then the sent SignNow package PDF will open here."
                                              : isSignNowContractUiEnabled()
                                                ? "Loading the sent SignNow contract package…"
                                                : "DocuSign PDF appears on step 4 (Sent) after the contract envelope is sent."}
                                    </div>
                                )
                                ) : null}
                            </div>
                        </div>

                    </div>

                    {/* 3. Global Footer — signers + CC + send (shrink-0 + compact so PDF pane keeps maximum height) */}
                    <div className={`flex shrink-0 flex-col gap-2 border-t border-[var(--brand)]/10 bg-gradient-to-r from-slate-50/90 via-white to-[var(--brand)]/5 px-4 py-2 dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-[var(--brand)]/10 lg:flex-row lg:items-center lg:justify-between lg:gap-4 ${signNowReviewOpen ? "py-2" : "px-6 py-3"}`}>
                        <div className="min-w-0 flex-1 space-y-2">
                            {signNowReviewOpen && signNowReviewComplete ? (
                                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                    Owner review is complete. Send via SignNow, or use Back to SignNow / Change details first if you still need to edit.
                                </p>
                            ) : signNowReviewOpen ? (
                                <p className="text-xs text-slate-600 dark:text-slate-300">
                                    If SignNow shows &quot;Document signed&quot;, click{" "}
                                    {/* <span className="font-semibold">I&apos;ve clicked Finish</span>{" "} */}
                                    or <span className="font-semibold">Send via SignNow</span> to
                                    email the merchant. They will only need to sign.
                                </p>
                            ) : (
                            <>
                            {signNowReviewComplete ? (
                                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                    SignNow review is complete. Click Send via SignNow to email the merchant — they only need to sign.
                                </p>
                            ) : null}
                            <div className="space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] font-semibold text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                        {isSignNowContractUiEnabled() ? "SignNow" : "DocuSign"} signers ({docuSignSignerRolesForSend.length}):
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 border-[var(--brand)]/30 px-2 text-[10px] text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                        disabled={canCancelSentContract || isCancellingContract}
                                        onClick={() => {
                                            setActiveStep("summary");
                                            openSignerEditor();
                                        }}
                                    >
                                        <Plus className="mr-1 h-3 w-3" />
                                        Manage Signers
                                    </Button>
                                </div>
                                {docuSignSignerRolesForSend.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                        {docuSignSignerRolesForSend.map((signer, idx) => (
                                            <span
                                                key={`${signer.signerRole}-${idx}`}
                                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-slate-100"
                                                title={signer.signerEmail || "Missing email"}
                                            >
                                                <User className="h-3 w-3 shrink-0 text-emerald-700 opacity-80" aria-hidden />
                                                <span className="font-semibold text-emerald-800 dark:text-emerald-300">
                                                    {signer.signerRole}
                                                </span>
                                                <span className="text-slate-500">•</span>
                                                <span className="max-w-[180px] truncate">
                                                    {signer.signerEmail || "No email"}
                                                </span>
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                                        No signers configured — add owners in Info Required, then use Manage
                                        Signers on the Summary step. CC list below is copy-only, not a signer.
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand)]/12">
                                        <Mail className="h-3.5 w-3.5" aria-hidden />
                                    </span>
                                    CC (copy by email on send — not a signer)
                                    {selectedFunder ? (
                                        <span className="normal-case tracking-normal text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                            · {selectedFunder}
                                        </span>
                                    ) : null}
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {contractDefaultCcEmails.map((email) => (
                                    <span
                                        key={email}
                                        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:text-slate-100 ${
                                            contractDefaultCcUsesFunderOverride
                                                ? "border-emerald-500/30 bg-emerald-500/10 dark:border-emerald-500/40 dark:bg-emerald-500/15"
                                                : "border-[var(--brand)]/30 bg-[var(--brand)]/12 dark:border-[var(--brand)]/40 dark:bg-[var(--brand)]/20"
                                        }`}
                                        title={
                                            contractDefaultCcUsesFunderOverride
                                                ? `${contractDefaultCcSourceLabel} default CC: ${email}`
                                                : `Default CC: ${email}`
                                        }
                                    >
                                        <Mail
                                            className={`h-3 w-3 shrink-0 opacity-80 ${
                                                contractDefaultCcUsesFunderOverride
                                                    ? "text-emerald-600 dark:text-emerald-400"
                                                    : "text-[var(--brand)]"
                                            }`}
                                            aria-hidden
                                        />
                                        <span className="max-w-[220px] truncate">{email}</span>
                                        <span
                                            className={`text-[10px] font-normal uppercase tracking-wide ${
                                                contractDefaultCcUsesFunderOverride
                                                    ? "text-emerald-700/80 dark:text-emerald-300/80"
                                                    : "text-[var(--brand)]/80"
                                            }`}
                                        >
                                            {contractDefaultCcSourceLabel}
                                        </span>
                                    </span>
                                ))}
                                {ccEmails.map((email) => (
                                    <span
                                        key={email}
                                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--brand)]/20 bg-[var(--brand)]/8 px-2.5 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:border-[var(--brand)]/30 dark:bg-[var(--brand)]/15 dark:text-slate-100"
                                    >
                                        <Mail className="h-3 w-3 shrink-0 text-[var(--brand)] opacity-80" aria-hidden />
                                        <span className="max-w-[220px] truncate" title={email}>
                                            {email}
                                        </span>
                                        <button
                                            type="button"
                                            className="shrink-0 rounded p-0.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 disabled:pointer-events-none disabled:opacity-40"
                                            aria-label={`Remove ${email}`}
                                            disabled={canCancelSentContract || isCancellingContract}
                                            onClick={() => {
                                                const next = ccEmails.filter((e) => e !== email);
                                                setCcEmails(next);
                                                saveBoldSignCcEmailList(next, contractCcMergeOptions);
                                            }}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    id="pdf-viewer-docusign-cc-draft"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="name@company.com"
                                    value={ccEmailDraft}
                                    onChange={(e) => setCcEmailDraft(e.target.value)}
                                    className="h-9 max-w-xs bg-white dark:bg-slate-950"
                                    disabled={canCancelSentContract || isCancellingContract}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            addPdfCcFromDraft();
                                        }
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-9 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                    disabled={canCancelSentContract || isCancellingContract}
                                    onClick={addPdfCcFromDraft}
                                >
                                    Add CC
                                </Button>
                            </div>
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand)]/12">
                                        <User className="h-3.5 w-3.5" aria-hidden />
                                    </span>
                                    Agent (emailed on send and when signed)
                                    {selectedFunder ? (
                                        <span className="normal-case tracking-normal text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                            · from {selectedFunder}
                                        </span>
                                    ) : null}
                                </span>
                            </div>
                            {agentEmails.length ? (
                                <div className="flex flex-wrap gap-1.5">
                                    {agentEmails.map((email) => (
                                        <span
                                            key={email}
                                            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-slate-100"
                                            title={`Agent: ${email}`}
                                        >
                                            <User className="h-3 w-3 shrink-0 text-amber-700 opacity-80" aria-hidden />
                                            <span className="max-w-[220px] truncate">{email}</span>
                                            <span className="text-[10px] font-normal uppercase tracking-wide text-amber-700/80 dark:text-amber-300/80">
                                                {agentEmailSource === "contract" ? "Agent" : "Referring agent"}
                                            </span>
                                            {agentEmailSource === "contract" ? (
                                                <button
                                                    type="button"
                                                    className="shrink-0 rounded p-0.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 disabled:pointer-events-none disabled:opacity-40"
                                                    aria-label={`Remove agent ${email}`}
                                                    disabled={isSavingAgentEmail || isCancellingContract}
                                                    onClick={() => removeAgentEmail(email)}
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            ) : null}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    id="pdf-viewer-agent-email-draft"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="agent@company.com"
                                    value={agentEmailDraft}
                                    onChange={(e) => setAgentEmailDraft(e.target.value)}
                                    className="h-9 max-w-xs bg-white dark:bg-slate-950"
                                    disabled={isSavingAgentEmail || isCancellingContract}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            addAgentFromDraft();
                                        }
                                    }}
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-9 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                    disabled={isSavingAgentEmail || isCancellingContract || !agentEmailDraft.trim()}
                                    onClick={addAgentFromDraft}
                                >
                                    {isSavingAgentEmail ? (
                                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                                    ) : null}
                                    Add Agent
                                </Button>
                            </div>
                            </>
                            )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2 border-t border-slate-100 pt-2 dark:border-slate-700 lg:border-t-0 lg:pt-0">
                            {docuSignOpenUrl && activeStep !== "sent" ? (
                                <p className="max-w-md text-right text-xs text-amber-800 dark:text-amber-200">
                                    Pop-up blocked. Click Open DocuSign to continue in a new tab.
                                </p>
                            ) : null}
                            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                            <Button variant="ghost" className="h-9 shrink-0" onClick={onClose}>
                                Close
                            </Button>
                            {isSignNowContractUiEnabled() &&
                            (signNowReviewOpen || signNowReviewComplete) &&
                            !(signNowReviewOpen && signNowReviewComplete) ? (
                                /* One send action only. Label stays SignNow for the user;
                                   delivery goes out through SendGrid (CRM signing portal). */
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={() => void handleSendViaSendGrid()}
                                    disabled={
                                        isSending || isSendingViaSendGrid || isCancellingContract
                                    }
                                >
                                    {isSendingViaSendGrid
                                        ? "Sending via SignNow…"
                                        : "Send via SignNow"}
                                </Button>
                            ) : isSignNowContractUiEnabled() &&
                              signNowReviewOpen &&
                              signNowReviewComplete ? null : canCancelSentContract ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={() => void handleCancelContract()}
                                    disabled={isCancellingContract || isSending}
                                >
                                    {isCancellingContract ? "Voiding contract…" : "Void Contract"}
                                </Button>
                            ) : null}
                            {/*
                              * Resend outranks the SignNow review pane: once a package has
                              * been reviewed or sent this session, that state stayed set and
                              * left the Sent step showing only Close / Void Contract, with no
                              * way to rebuild the package after the deal changed.
                              */}
                            {canResendUnsignedContract ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 shrink-0"
                                    onClick={() => setResendUnsignedOpen(true)}
                                    disabled={isSending || isCancellingContract || isResendingNewContract}
                                >
                                    Resend unsigned contract
                                </Button>
                            ) : null}
                            {showResendContractOnSentStep ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={() => void handleResendNewContract()}
                                    disabled={
                                        isSending ||
                                        isCancellingContract ||
                                        isResendingNewContract
                                    }
                                >
                                    {isResendingNewContract
                                        ? "Starting new contract…"
                                        : docuSignPrimaryActionLabel}
                                </Button>
                            ) : isSignNowContractUiEnabled() &&
                              (signNowReviewOpen || signNowReviewComplete) ? null : activeStep ===
                                  "sent" && !canCancelSentContract ? (
                                    <Button
                                        type="button"
                                        variant="default"
                                        className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                        onClick={onClose}
                                        disabled={isCancellingContract}
                                    >
                                        Done
                                    </Button>
                            ) : activeStep === "sent" && canCancelSentContract ? null : canReviewAndSendCurrentPackage && docuSignOpenUrl ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={() => {
                                        const url = docuSignOpenUrl;
                                        if (!url) return;
                                        if (tryOpenDocuSignSenderUrl(url)) {
                                            setDocuSignOpenUrl(null);
                                            toast.success(
                                                "DocuSign opened in a new tab. Click Send there when you are ready.",
                                                { autoClose: 10000 },
                                            );
                                        } else {
                                            void navigator.clipboard.writeText(url);
                                            toast.error(
                                                "Still blocked. Allow pop-ups or paste the copied link into your browser.",
                                                { autoClose: 12000 },
                                            );
                                        }
                                    }}
                                    disabled={isCancellingContract}
                                >
                                    Open DocuSign
                                </Button>
                            ) : canReviewAndSendCurrentPackage ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={handleSend}
                                    disabled={
                                        isSending ||
                                        signNowPreparePhase !== null ||
                                        isCancellingContract
                                    }
                                >
                                    {reviewSendButtonLabel}
                                </Button>
                            ) : null}
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
            <ContractPrefillEditForm
                open={contractPrefillEditOpen}
                onOpenChange={setContractPrefillEditOpen}
                applicationData={applicationData}
                contractId={effectiveContractId}
                applicationUuid={applicationIdForLookup}
                prefillOverridesReady={contractPrefillLoaded}
                persistedPrefillOverrides={contractPrefillLoaded ? contractPrefillFromDb : undefined}
                onPersistedPrefillChange={(next) => {
                    const main = next ?? null;
                    setContractPrefillFromDb(main);
                    setResolvedContract((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  ...(main ? contractPrefillToContractColumnUpdate(main) : {}),
                                  contractPrefillOverrides:
                                      main != null
                                          ? {
                                                ...(typeof prev.contractPrefillOverrides ===
                                                    "object" &&
                                                prev.contractPrefillOverrides != null &&
                                                !Array.isArray(prev.contractPrefillOverrides)
                                                    ? (prev.contractPrefillOverrides as Record<
                                                          string,
                                                          unknown
                                                      >)
                                                    : {}),
                                                ...main,
                                            }
                                          : prev.contractPrefillOverrides,
                              }
                            : prev,
                    );
                }}
                onPersistedPrefillFullChange={(main, mappingMap) => {
                    setDocumentTemplatePrefillByMappingId(mappingMap);
                    setContractPrefillFromDb(main ?? null);
                    const fullOverrides =
                        main != null || Object.keys(mappingMap).length > 0
                            ? {
                                  ...(main ?? {}),
                                  ...(Object.keys(mappingMap).length > 0
                                      ? {
                                            [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]:
                                                mappingMap,
                                        }
                                      : {}),
                              }
                            : null;
                    setResolvedContract((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  ...(main ? contractPrefillToContractColumnUpdate(main) : {}),
                                  contractPrefillOverrides: fullOverrides ?? prev.contractPrefillOverrides,
                              }
                            : prev,
                    );
                }}
                contractRecords={contractPrefillRecords}
                resolvedContract={resolvedContract}
                linkedAddendumMapping={linkedAddendumMapping}
                linkedAddendumMappings={orderedLinkedAddendumMappings}
                linkedDisclosureMapping={linkedDisclosureMapping}
                contractDisclosureState={selectedState}
                contractDisclosureFrequency={contractDisclosureFrequency}
                agreementDatePlaceholder={formatDate(new Date())}
                offerDecision={(offerDecisionData as Record<string, unknown> | null) ?? null}
                readOnly={!canEditContractPrefill}
                additionalContractPrefillJson={contractPrefillEditFormAdditionalJson}
                liveContractSignerOverrides={contractSignerOverrides}
                bankAnalyses={disclosureCalcBankAnalyses}
            />
            <TemplateMappingPrefillEditDialog
                open={templateMappingPrefillEditRow != null}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) {
                        setTemplateMappingPrefillEditRow(null);
                        setTemplateMappingPrefillExhibitCIndex(0);
                    }
                }}
                row={templateMappingPrefillEditRow}
                contractId={effectiveContractId}
                applicationUuid={applicationIdForLookup}
                applicationData={applicationData}
                resolvedContract={resolvedContract}
                contractRecords={contractPrefillRecords}
                agreementDate={formatDate(new Date())}
                documentTemplatePrefillByMappingId={documentTemplatePrefillByMappingId}
                mainPrefillOverrides={mainPrefillOverridesForTemplateDialog}
                exhibitCEntityIndex={templateMappingPrefillExhibitCIndex}
                exhibitCCopyMappingIds={exhibitCCopyMappingIds}
                onSaved={(saved) => {
                    const full = saved?.contractPrefillOverrides;
                    if (full != null) {
                        setDocumentTemplatePrefillByMappingId(
                            parseDocumentTemplatePrefillByMappingId(full),
                        );
                        setResolvedContract((prev) =>
                            prev ? { ...prev, contractPrefillOverrides: full } : prev,
                        );
                        setContractPrefillFromDb(
                            stripDocumentTemplateBlobFromPrefillOverrides(
                                normalizeContractPrefillOverrides(full),
                            ),
                        );
                    }
                }}
            />
            <DisclosureCalculationModal
                open={disclosureCalcModalOpen}
                onOpenChange={setDisclosureCalcModalOpen}
                seedInputs={disclosureCalculatorSeedInputs}
                bankMonthlyRevenues={disclosureCalcBankMonthlyRevenues}
                loadingBankAnalysis={loadingDisclosureCalcBankAnalysis}
                disclosureLabel={
                    linkedDisclosureMapping
                        ? formatDropdownLabel(
                              formatDisclosureTemplateLabel(linkedDisclosureMapping),
                          )
                        : undefined
                }
                saving={savingDisclosureCalculation}
                onSaveMonthlyRevenues={saveDisclosureMonthlyRevenues}
                onApply={applyDisclosureCalculation}
            />
            <SpaCalculationModal
                open={spaCalcModalOpen}
                onOpenChange={setSpaCalcModalOpen}
                applicationUuid={applicationIdForLookup}
                offerDecision={(offerDecisionData as Record<string, unknown> | null) ?? null}
                saving={savingSpaCalculation}
                onApply={applySpaCalculation}
            />
        </>
    );
};

export default PDFViewerModal;
