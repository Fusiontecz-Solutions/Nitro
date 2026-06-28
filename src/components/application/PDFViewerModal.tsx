import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
    AlertCircle,
    BadgeCheck,
    Building2,
    Calculator,
    CheckCircle2,
    Clock,
    Download,
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
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
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
import { US_STATES } from "@/constants/usStates";
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
    // deleteContractOwner,
    // deleteContractGuarantor,
    deleteUploadedContractDocument,
    getUploadedContractDocumentById,
    getUploadedContractDocuments,
    uploadContractDocuments,
    updateUploadedContractDocument,
    assignKatanDealIdForContract,
    updateContract,
    getByApplicationIdContract,
    getByIdContract,
    type UpdateContractData,
} from "@/redux/actions/contractActions";
import { getApplicationById } from "@/redux/actions/applicationActions";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import { toast } from "react-toastify";
import {
    buildContractPrefillFieldsFromApplication,
    contractPrefillToContractColumnUpdate,
    mergeContractPrefillOverrideLayers,
    categorizeDealReviewPrefillFieldId,
    dealReviewPrefillSubsection,
    overlaySavedAppendixFeeOnPrefillFields,
    prepareDealReviewPrefillDisplay,
    CONTRACT_PREFILL_OVERRIDES_SECTION,
    getApplicationPrimaryRecipientName,
    getSignerRecipientEmailForContract,
    resolveEffectiveDocuSignSignerEmail,
    parseNoteStructuredSection,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
    type ContractPrefillField,
    normalizeDisclosureTemplateFrequencyKey,
    resolveDealDisclosureFrequencyKey,
} from "./contractdata/Contract";
import {
    applyKycPanelsToAchEntries,
    applyKycPanelsToGuarantorEntries,
    applyKycPanelsToOwnerEntries,
    mergeKycExtractionIntoPrefill,
    parseKycExtractionsFromUploadResponse,
    type KycExtractionResult,
} from "./contractdata/kycDocumentPrefill";
import { cn, formatDate, formatDateTimeUS } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
import { voidBoldSignDocument } from "@/redux/actions/boldSignActions";
import {
    canSendMainContract,
    canVoidMainContract,
    isContractFullySigned,
    isContractSigningFinished,
    isContractVoidedOrTerminal,
    pickContractEnvelopeDocument,
} from "./contractdata/contractSendHistory";
import { DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS } from "./contractdata/docusignPolling";
import { syncDocuSignEnvelopeStatus } from "./contractdata/syncDocuSignEnvelopeStatus";
import { watchDocuSignSenderReturn } from "./contractdata/watchDocuSignSenderReturn";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import {
    OFFER_DECISION_UPDATED_EVENT,
    offerDecisionUpdateMatchesApplication,
} from "@/lib/offerDecisionSync";
import {
    isDefaultContractCcEmail,
    loadBoldSignCcEmailList,
    mergeContractCcEmailList,
    saveBoldSignCcEmailList,
} from "./boldsignCcList";
import { ContractPrefillEditForm } from "./contractdata/ContractPrefillEditForm";
import {
    TemplateMappingPrefillEditDialog,
    type TemplateMappingPrefillEditRow,
} from "./contractdata/TemplateMappingPrefillEditDialog";
import { DisclosureCalculationModal } from "./contractdata/DisclosureCalculationModal";
import {
    buildDisclosureCalculatorInputsFromSources,
    extractMonthlyRevenuesFromBankAnalyses,
} from "./contractdata/disclosureAprCalculator";
import { mapDisclosureMetricsToEditorFieldOverrides } from "./contractdata/disclosureEditorFields";
import RequestMissingDocumentsModal from "./RequestMissingDocumentsModal";
import { RequestedDocumentsPanel } from "./RequestedDocumentsPanel";
import { getDocumentRequestsByApplication } from "@/redux/actions/notificationActions";
import { ExhibitACompaniesSummarySection } from "./contractdata/ExhibitACompaniesSummarySection";
import {
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    applyDocumentTemplateMappingPrefillOverrides,
    buildExpandedDisclosurePrefillFieldsForMapping,
    hasAddendumPrefillFieldMap,
    mergeExpandedDisclosurePrefillIntoPayload,
    parseDocumentTemplatePrefillByMappingId,
    stripDocumentTemplateBlobFromPrefillOverrides,
} from "./contractdata/documentTemplateMappingPrefill";
import { DOCUSIGN_DEFAULT_SIGNER_ROLE } from "./contractdata/docusignTemplateConfig";
import {
    contractSendPackageFingerprint,
    canSendWithoutMainContract,
    resolveEffectiveSendPackage,
    validateContractSendPackage,
    type ContractSendPackageSelection,
} from "./contractdata/contractSendPackage";
import { Checkbox } from "@/components/ui/checkbox";
import {
    CONTRACT_ADDENDUM_DOCUMENT_OPTIONS,
    getPlatformSignerRoleRows,
    isAchAuthorizationLayoutKey,
    isPlatformLayoutKey,
    supplementalOptionLabel,
} from "./contractdata/platformDocumentConfig";
import { funderAvailableForContractState, useFunderProfiles } from "@/hooks/useFunderProfiles";
import { clearParty2PrefillFieldPayload, resolveActiveOwnerCount } from "./contractdata/contractPartyCounts";
import {
    buildContractSignerRowsFromOwnerParties,
    fetchFreshOwnerPartiesForContractSigners,
    mergeContractSignerEditorRows,
    reconcileSignerRowsWithFreshOwners,
    resolveOwnerPartiesForContractSigners,
    syncContractSignerRowsToCrm,
} from "./contractdata/contractSignerOwnersSync";
import { invalidateApplicationDetailCache } from "@/lib/applicationDetailCache";
import {
    isApplicationUuid,
    resolvePrismaApplicationUuid,
} from "@/lib/paymentDealApplicationId";
import { resolveDocuSignSenderReturnUrl } from "./contractdata/resolveDocuSignSenderReturnUrl";
import {
    getTemplateRoleEmailFromRow,
    getTemplateRoleLabel,
    getTemplateRoleNameFromRow,
    buildBoldSignRolesFromTemplateRecipients,
    buildDocuSignRolesFromEditorRows,
    buildSuggestedContractSignerRows,
    contractSignerOverridesFingerprint,
    getContractSignerValidationMessage,
    mergeContractPrefillWithSignerOverrides,
    parseContractSignerOverridesFromPrefill,
    dedupeContractSignerRows,
    resolveDocuSignSignerRole,
    suggestedRowsToSummaryTemplateRoles,
    type ContractSignerOverrideRow,
    type DocuSignTemplateRolePayload,
} from "./contractdata/templateRecipients";
import { axiosDelete, axiosGet, axiosPatch, axiosPost } from "@/redux/axios";

const DOCUSIGN_PRIMARY_BTN_CLASS =
    "h-9 shrink-0 cursor-pointer border-0 bg-[var(--brand)] px-6 text-white shadow-sm hover:bg-[var(--brand)]/90 focus-visible:ring-[var(--brand)]/40";

/** Fingerprint of saved prefill used to invalidate a reused DocuSign draft after edits. */
function docuSignPrefillDraftFingerprint(input: {
    contractPrefillOverrides: Partial<BuildContractPrefillFieldsArgs> | null;
    documentTemplatePrefillByMappingId: Record<string, Record<string, string>>;
}): string {
    return JSON.stringify({
        o: input.contractPrefillOverrides ?? null,
        d: input.documentTemplatePrefillByMappingId ?? {},
    });
}

const DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS = {
    /** Reused envelope — sender view is usually ready immediately. */
    existing: [0, 800, 1600, 2600],
    /** New envelope — DocuSign may need a moment before sender view is available. */
    justCreated: [400, 1100, 2200, 3400],
} as const;

const DOCUSIGN_LOADING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Opening DocuSign…</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: linear-gradient(160deg, #f8fafc 0%, #e8f2f8 45%, #f1f5f9 100%);
      color: #0f172a;
    }
    .card { text-align: center; padding: 2.5rem 2rem; max-width: 22rem; }
    .spinner {
      width: 3rem;
      height: 3rem;
      margin: 0 auto 1.25rem;
      border: 3px solid #A962CD33;
      border-top-color: #A962CD;
      border-radius: 50%;
      animation: spin 0.85s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 1.125rem; font-weight: 600; margin: 0 0 0.5rem; }
    p { margin: 0; font-size: 0.875rem; line-height: 1.5; color: #475569; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner" aria-hidden="true"></div>
    <h1>Opening DocuSign</h1>
    <p>Preparing your contract for review. This tab will load DocuSign in a moment.</p>
  </div>
</body>
</html>`;

/** Open blank tab + loading UI in the same synchronous turn as the user click. */
function openDocuSignLoadingTab(): Window | null {
    if (typeof window === "undefined") return null;
    const tab = window.open("about:blank", "_blank");
    if (!tab) return null;
    try {
        tab.opener = null;
    } catch {
        /* ignore */
    }
    try {
        tab.document.open();
        tab.document.write(DOCUSIGN_LOADING_PAGE_HTML);
        tab.document.close();
    } catch {
        try {
            tab.location.href = `data:text/html;charset=utf-8,${encodeURIComponent(DOCUSIGN_LOADING_PAGE_HTML)}`;
        } catch {
            /* ignore */
        }
    }
    return tab;
}

function escapeHtmlForDocuSignTab(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function showDocuSignTabMessage(tab: Window | null, title: string, message: string): void {
    if (!tab || tab.closed) return;
    const safeTitle = escapeHtmlForDocuSignTab(title);
    const safeMessage = escapeHtmlForDocuSignTab(message);
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${safeTitle}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;padding:1.5rem;}
  .card{max-width:24rem;text-align:center;}
  h1{font-size:1.125rem;margin:0 0 .75rem;}
  p{margin:0;font-size:.875rem;line-height:1.5;color:#475569;}
</style></head><body><div class="card"><h1>${safeTitle}</h1><p>${safeMessage}</p></div></body></html>`;
    try {
        tab.location.href = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    } catch {
        try {
            tab.close();
        } catch {
            /* ignore */
        }
    }
}

function navigateDocuSignTab(tab: Window | null, senderUrl: string): boolean {
    if (tab && !tab.closed) {
        try {
            tab.location.href = senderUrl;
            return true;
        } catch {
            /* fall through */
        }
    }
    const opened = window.open(senderUrl, "_blank");
    if (!opened) return false;
    try {
        opened.opener = null;
    } catch {
        /* ignore */
    }
    return true;
}

interface PDFViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    fileUrl: string | null;
    fileName?: string;
    contractId?: number | null;
    applicationId?: string | null;
    layout?: "contract";
    /** Create DocuSign draft (prefill, do not email signers). */
    onPrepareDocuSignDraft?: (payload: {
        ccEmails: string[];
        supplementalLayoutKey?: string | null;
        /** CRM BoldSignTemplate row ids (e.g. state disclosure) merged after addendum. */
        supplementalDocumentRefs?: string[];
  /** When false, send supplemental document only (standalone ACH). */
  includeMainContract?: boolean;
  /** Platform layout key for the main contract PDF. */
  mainContractLayoutKey?: string | null;
  /** Which documents are included in this envelope. */
        sendPackage?: ContractSendPackageSelection;
        funderName?: string | null;
        signerRoles?: DocuSignTemplateRolePayload[];
        /** Current Deal Review values — always applied on each Review & send open. */
        prefillFields?: Array<{ id: string; value: string }>;
    }) => void | Promise<
        void | {
            envelopeId?: string;
            prefillTabsApplied?: number;
            prefillFieldCount?: number;
            sendUrl?: string | null;
        }
    >;
    prefillFieldsPreview?: Array<{ id: string; label?: string; value: string }>;
    // Backward compatibility while migrating existing callers.
    onSendToDocusign?: (ccEmails: string[]) => void;
    templateId?: string | null;
    initialRightPaneTab?: "template" | "prefilled";
}

function contractMappingLayoutKey(
    row: Pick<ContractDocumentTemplateMappingRow, "template" | "templateId"> | null | undefined,
): string {
    return String(
        row?.template?.layoutKey ?? row?.template?.templateId ?? row?.templateId ?? "",
    )
        .trim()
        .toLowerCase();
}

function isAchContractMappingRow(row: ContractDocumentTemplateMappingRow): boolean {
    const docType = String(row.documentType || "").toLowerCase();
    if (docType === "ach") return true;
    return isAchAuthorizationLayoutKey(contractMappingLayoutKey(row));
}

function isNonAchAddendumMappingRow(row: ContractDocumentTemplateMappingRow): boolean {
    const docType = String(row.documentType || "").toLowerCase();
    if (docType !== "addendum") return false;
    return !isAchAuthorizationLayoutKey(contractMappingLayoutKey(row));
}

function isDisclosureMappingRow(row: ContractDocumentTemplateMappingRow): boolean {
    return String(row.documentType || "").toLowerCase() === "disclosure";
}

function normalizeStateForTemplateLookup(state: string): string {
    return String(state ?? "").trim().toLowerCase();
}

function normalizeFrequencyForTemplateLookup(frequency: string): string {
    return normalizeDisclosureTemplateFrequencyKey(frequency);
}

type DisclosureTemplateLookupRow = {
    id?: string;
    name?: string | null;
    frequency?: string | null;
    pdfUrl?: string | null;
};

function inferFrequencyFromDisclosureTemplateRow(
    row: DisclosureTemplateLookupRow,
): string {
    const explicit = String(row.frequency ?? "").trim();
    if (explicit) {
        return normalizeFrequencyForTemplateLookup(explicit);
    }
    const name = String(row.name ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if (!name) return "";
    if (
        name.startsWith("weekly_") ||
        name.endsWith("_weekly") ||
        name.includes("_weekly_")
    ) {
        return "weekly";
    }
    if (name.startsWith("daily_") || name.endsWith("_daily") || name.includes("_daily_")) {
        return "daily";
    }
    if (name.includes("biweekly") || name.includes("bi_weekly")) return "biweekly";
    if (name.startsWith("monthly_") || name.endsWith("_monthly")) return "monthly";
    return "";
}

function pickDisclosureTemplateForFrequency(
    rows: DisclosureTemplateLookupRow[],
    frequency: string,
): DisclosureTemplateLookupRow | undefined {
    const expected = normalizeFrequencyForTemplateLookup(frequency);
    const withPdf = rows.filter((row) => String(row?.pdfUrl ?? "").trim());
    return withPdf.find((row) => {
        const rowFreq = inferFrequencyFromDisclosureTemplateRow(row);
        return Boolean(rowFreq) && rowFreq === expected;
    });
}

/** Resolve linked disclosure template frequency from DB column or template name (e.g. weekly_texas). */
function inferFrequencyFromDisclosureTemplate(
    row: Pick<ContractDocumentTemplateMappingRow, "template"> | null | undefined,
): string {
    const explicit = String(row?.template?.frequency ?? "").trim();
    if (explicit) {
        return normalizeFrequencyForTemplateLookup(explicit);
    }
    const name = String(row?.template?.name ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
    if (!name) return "";
    if (
        name.startsWith("weekly_") ||
        name.endsWith("_weekly") ||
        name.includes("_weekly_")
    ) {
        return "weekly";
    }
    if (name.startsWith("daily_") || name.endsWith("_daily") || name.includes("_daily_")) {
        return "daily";
    }
    if (name.includes("biweekly") || name.includes("bi_weekly")) return "biweekly";
    if (name.startsWith("monthly_") || name.endsWith("_monthly")) return "monthly";
    return "";
}

function formatDropdownLabel(raw: unknown): string {
    const input = String(raw ?? "").trim();
    if (!input) return "";
    const noExt = input.replace(/\.pdf$/i, "");
    const normalized = noExt
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return "";
    return normalized
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

function formatDisclosureTemplateLabel(row: ContractDocumentTemplateMappingRow | null): string {
    if (!row) return "State disclosure";
    const name = String(row.template?.name ?? "").trim();
    if (name) return formatDropdownLabel(name.replace(/_/g, " "));
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
        type?: string;
        state?: string | null;
        frequency?: string | null;
        templateId?: string;
        layoutKey?: string | null;
        pdfUrl?: string | null;
    } | null;
};

const DEFAULT_FUNDER_OPTIONS = ["Katan II", "Katan III"] as const;
type InfoPanelId = "addendum" | "ach" | "epo" | "owner" | "guarantor";

function pickUsStateForSelect(value: unknown): string {
    const v = String(value ?? "").trim();
    if (!v) return "";
    const exact = US_STATES.find((s) => s === v);
    if (exact) return exact;
    return US_STATES.find((s) => s.toLowerCase() === v.toLowerCase()) ?? "";
}

function disclosureMappingMatchesState(
    row: ContractDocumentTemplateMappingRow | null | undefined,
    state: string,
): boolean {
    if (!row) return false;
    const picked = normalizeStateForTemplateLookup(pickUsStateForSelect(state));
    if (!picked) return false;
    const templateState = normalizeStateForTemplateLookup(row.template?.state ?? "");
    return Boolean(templateState) && templateState === picked;
}

function disclosureMappingMatchesFrequency(
    row: ContractDocumentTemplateMappingRow | null | undefined,
    frequency: string,
): boolean {
    if (!row) return false;
    const expected = normalizeFrequencyForTemplateLookup(frequency);
    if (!expected) return false;
    const templateFreq = inferFrequencyFromDisclosureTemplate(row);
    if (!templateFreq) return false;
    return expected === templateFreq;
}

function pickFunderForSelect(value: unknown, options: readonly string[]): string {
    const v = String(value ?? "").trim();
    if (!v) return "";
    const exact = options.find((s) => s === v);
    if (exact) return exact;
    return options.find((s) => s.toLowerCase() === v.toLowerCase()) ?? "";
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

/**
 * Map a stored/normalized entity type value back to the label the client actually
 * selected (LLC, S-Corp, ...). Falls back to the BoldSign value with underscores
 * replaced by spaces for anything unrecognized.
 */
function entityTypeDisplayLabel(raw: string): string {
    const key = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const byKey: Record<string, string> = {
        "limited liability company": "LLC",
        llc: "LLC",
        corporation: "Corporation",
        partnership: "Partnership",
        "sole proprietorship": "Sole Proprietorship",
        "s corporation": "S-Corp",
        "s corp": "S-Corp",
        scorp: "S-Corp",
        "c corporation": "C-Corp",
        "c corp": "C-Corp",
        ccorp: "C-Corp",
        "non profit": "Non-Profit",
        nonprofit: "Non-Profit",
        other: "Other",
    };
    if (byKey[key]) return byKey[key];
    return raw.replace(/_/g, " ");
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

    // Entity type values are normalized to the BoldSign dropdown format (e.g.
    // "Limited_Liability_Company") for sending, but the client record stores short
    // labels (LLC, S-Corp, ...). Map back to the client's value for the Deal Review panel.
    if (key.includes("entity_type") || key.includes("type_of_entity") || key.includes("entitytype")) {
        return entityTypeDisplayLabel(s);
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
 * Voided / terminal envelopes are not treated as in-flight (allows send again).
 */
function isContractAlreadySent(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
    sentStepUnlocked = false,
): boolean {
    if (isContractVoidedOrTerminal(
        contract?.status,
        pickContractEnvelopeDocument(contract)?.status,
    )) {
        return false;
    }
    if (isContractFullySigned(
        contract?.status,
        pickContractEnvelopeDocument(contract)?.status,
    )) {
        return true;
    }
    if (sentStepUnlocked || sessionSentAt) return true;
    if (isContractStatusAtLeastSent(contract?.status)) return true;
    const doc = pickContractEnvelopeDocument(contract);
    if (!doc) return false;
    if (doc.sentAt) return true;
    const docStatus = String(doc.status ?? "").trim().toLowerCase();
    if (DOCUSIGN_DOC_DRAFT_STATUSES.has(docStatus)) {
        if (isContractStatusAtLeastSent(contract?.status)) return true;
        return false;
    }
    if (DOCUSIGN_DOC_SENT_STATUSES.has(docStatus)) return true;
    return false;
}

function envelopeDocStatusIsTerminal(doc: Record<string, unknown> | null | undefined): boolean {
    const s = String(doc?.status ?? "").trim().toLowerCase();
    return ["revoked", "voided", "declined", "expired", "completed"].includes(s);
}

function canCancelDocuSignContract(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
): boolean {
    return canVoidMainContract(contract, sessionSentAt);
}

function canReviewAndSendToDocuSign(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
    sentStepUnlocked = false,
): boolean {
    if (!canSendMainContract(contract, sessionSentAt)) return false;
    if (isContractAlreadySent(contract, sessionSentAt, sentStepUnlocked)) return false;
    return true;
}

/** DocuSign envelope id only when the contract is still an editable draft. */
function resolveDraftEnvelopeIdForSync(
    contract: Record<string, unknown> | null | undefined,
    sessionSentAt: Date | null,
    sessionEnvelopeId: string | null,
): string | null {
    if (isContractAlreadySent(contract, sessionSentAt)) return null;
    const doc = pickContractEnvelopeDocument(contract);
    if (envelopeDocStatusIsTerminal(doc)) return null;
    const docStatus = String(doc?.status ?? "").trim().toLowerCase();
    if (docStatus && DOCUSIGN_DOC_SENT_STATUSES.has(docStatus)) return null;
    const id = String(sessionEnvelopeId || doc?.envelopeId || "").trim();
    return id || null;
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

type PdfRightPaneTab = "template" | "docusign";

function sentStepStorageKey(contractId: number | null, applicationUuid: string | null): string | null {
    if (contractId != null && Number.isFinite(contractId)) return `contract-sent-step:${contractId}`;
    if (applicationUuid) return `contract-sent-step:app:${applicationUuid}`;
    return null;
}

function readPersistedSentStepUnlocked(key: string | null): boolean {
    if (!key || typeof window === "undefined") return false;
    try {
        return sessionStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

function persistSentStepUnlocked(key: string | null) {
    if (!key || typeof window === "undefined") return;
    try {
        sessionStorage.setItem(key, "1");
    } catch {
        /* ignore */
    }
}

function clearPersistedSentStepUnlocked(key: string | null) {
    if (!key || typeof window === "undefined") return;
    try {
        sessionStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

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
    // Second signer slot must have its own email — never copy the primary client email.
    if (/owner\s*2|signer\s*2|guarantor\s*2/.test(rl)) return bs;
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
function isCloudinaryAssetUrl(url: string): boolean {
    return /^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\//.test(url.trim());
}

function DirectPdfViewer({ fileUrl, errorMessage = "Could not render this PDF in the viewer." }: { fileUrl: string; errorMessage?: string }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageWidth, setPageWidth] = useState(640);

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
            <Document
                file={fileUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
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
        </div>
    );
}

async function parseApiErrorMessageFromAxios(error: unknown): Promise<string> {
    const e = error as {
        response?: { data?: unknown };
        message?: string;
    };
    const data = e?.response?.data;
    if (data instanceof Blob) {
        try {
            const text = await data.text();
            try {
                const j = JSON.parse(text) as { message?: string };
                return String(j?.message ?? text).trim() || "Request failed";
            } catch {
                return text.trim() || "Request failed";
            }
        } catch {
            return "Request failed";
        }
    }
    if (data && typeof data === "object" && "message" in data) {
        return String((data as { message?: string }).message ?? e?.message ?? "Request failed");
    }
    return String(e?.message ?? "Request failed");
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
}: PDFViewerModalProps) => {
    const dispatch = useDispatch<AppDispatch>();
    const { data: loginData } = useSelector((state: RootState) => state.login);
    const userRole = String(
        (loginData as { user?: { role?: string } } | null)?.user?.role ||
            localStorage.getItem("role") ||
            "",
    ).toUpperCase();
    const canRequestDocumentsFromContract =
        Boolean(onPrepareDocuSignDraft) &&
        ["SCRUBBING", "UNDERWRITER", "SUPER_ADMIN", "OPERATIONS"].includes(userRole);
    const [requestDocumentsModalOpen, setRequestDocumentsModalOpen] = useState(false);
    const [ccEmails, setCcEmails] = useState<string[]>([]);
    const [ccEmailDraft, setCcEmailDraft] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [isCancellingContract, setIsCancellingContract] = useState(false);
    /** Set when the browser blocks `window.open` after the draft URL is ready — user opens via button click. */
    const [docuSignOpenUrl, setDocuSignOpenUrl] = useState<string | null>(null);
    const docuSignSendInFlightRef = useRef(false);
    type ContractWizardStep = "documents" | "info" | "summary" | "sent";
    const [activeStep, setActiveStep] = useState<ContractWizardStep>("documents");
    const [sentAt, setSentAt] = useState<Date | null>(null);
    const [sentStepUnlocked, setSentStepUnlocked] = useState(false);
    const sentStepUnlockedRef = useRef(false);
    const [sentCcEmails, setSentCcEmails] = useState<string[]>([]);
    /** True only while user clicks Refresh on the Sent-step signing status card. */
    const [signingStatusRefreshing, setSigningStatusRefreshing] = useState(false);
    const [docuSignSyncError, setDocuSignSyncError] = useState<string | null>(null);
    /** When the UI last loaded signing status from CRM (and optional DocuSign sync). */
    const [lastSigningStatusSyncAt, setLastSigningStatusSyncAt] = useState<Date | null>(null);
    /** After user explicitly opens Documents during this modal session, stop auto-switching Documents → Sent. */
    const didSuggestSentTabThisOpenRef = useRef(false);
    const stepSequence: ContractWizardStep[] = ["documents", "info", "summary", "sent"];
    const activeStepIndex = stepSequence.indexOf(activeStep);
    const canGoPreviousStep = activeStepIndex > 0;
    const canGoNextStep = activeStep === "documents" || activeStep === "info";
    const goToPreviousStep = () => {
        if (!canGoPreviousStep) return;
        const prev = stepSequence[activeStepIndex - 1];
        if (prev === "documents") didSuggestSentTabThisOpenRef.current = true;
        setActiveStep(prev);
    };
    const goToNextStep = () => {
        if (!canGoNextStep) return;
        setActiveStep(stepSequence[activeStepIndex + 1]);
    };
    const [selectedState, setSelectedState] = useState<string>("");
    const [selectedFunder, setSelectedFunder] = useState<string>("");
    const {
        funderOptions,
        resolveLayoutKey,
        previewNameFor,
        assignsDealId,
        findFunder,
    } = useFunderProfiles(selectedState);
    const [savingContractMeta, setSavingContractMeta] = useState(false);
    const [contractPrefillEditOpen, setContractPrefillEditOpen] = useState(false);
    const [addendumPrefillEditOpen, setAddendumPrefillEditOpen] = useState(false);
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

    /** Includes state-specific funders (Texas → Alliance Bridge) and any saved value. */
    const funderSelectOptions = useMemo(() => {
        const base = funderOptions;
        const cur = String(selectedFunder || "").trim();
        if (cur && !base.some((x) => x.toLowerCase() === cur.toLowerCase())) {
            return [...base, cur];
        }
        return base;
    }, [funderOptions, selectedFunder]);
    const [contractPreviewUrl, setContractPreviewUrl] = useState<string | null>(null);
    const [contractPreviewName, setContractPreviewName] = useState<string>("Contract.pdf");
    const effectiveContractPreviewUrl = contractPreviewUrl || fileUrl;
    const effectiveContractPreviewName = contractPreviewName || fileName || "Contract.pdf";

    useEffect(() => {
        if (!isOpen) {
            setContractPreviewUrl(null);
            return;
        }
        const layoutKey = resolveLayoutKey(selectedFunder);
        let cancelled = false;
        void (async () => {
            try {
                const res = await axiosGet("/contract-templates/latest", {
                    params: { layoutKey },
                });
                const data = (
                    res as { data?: { data?: { url?: string; originalName?: string } } }
                )?.data?.data;
                if (cancelled) return;
                if (data?.url) {
                    setContractPreviewUrl(data.url);
                    setContractPreviewName(
                        data.originalName || previewNameFor(selectedFunder),
                    );
                    return;
                }
            } catch {
                /* fall through */
            }
            if (!cancelled) {
                setContractPreviewUrl(fileUrl);
                setContractPreviewName(fileName || previewNameFor(selectedFunder));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen, selectedFunder, fileUrl, fileName, resolveLayoutKey, previewNameFor]);
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
    const sessionEnvelopeHydratedRef = useRef(false);

    useEffect(() => {
        if (!isOpen) {
            setSessionEnvelopeId(null);
            sessionEnvelopeHydratedRef.current = false;
            return;
        }
        if (sessionEnvelopeHydratedRef.current) return;
        if (!contractPrefillLoaded && !resolvedContract) return;
        sessionEnvelopeHydratedRef.current = true;
        const draftEnvelopeId = resolveDraftEnvelopeIdForSync(
            resolvedContract,
            sentAt,
            null,
        );
        if (draftEnvelopeId) setSessionEnvelopeId(draftEnvelopeId);
    }, [isOpen, resolvedContract, contractPrefillLoaded, sentAt]);

    type RequiredDocumentKey =
        | "voidedCheck"
        | "driverLicense"
    // | "bankStatement"
    // | "utilityBill";
    const [documentUrls, setDocumentUrls] = useState<{
        voidedCheck?: string;
        driverLicense?: string;
        bankStatement?: string;
        utilityBill?: string;
    }>({});
    const [activePreview, setActivePreview] = useState<null | "voidedCheck" | "driverLicense" | "bankStatement" | "utilityBill">(null);
    const voidedCheckRef = useRef<HTMLInputElement>(null);
    const driverLicenseRef = useRef<HTMLInputElement>(null);
    // const bankStatementRef = useRef<HTMLInputElement>(null);
    // const utilityBillRef = useRef<HTMLInputElement>(null);
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
        () => templateMappings.filter(isNonAchAddendumMappingRow),
        [templateMappings],
    );

    const achTemplateMappings = useMemo(
        () => templateMappings.filter(isAchContractMappingRow),
        [templateMappings],
    );

    const disclosureTemplateMappings = useMemo(
        () => templateMappings.filter(isDisclosureMappingRow),
        [templateMappings],
    );

    /** Canonical linked addendum (highest `order`); merge uses at most one non-ACH DocuSign template. */
    const linkedAddendumMapping = useMemo(() => {
        if (!addendumTemplateMappings.length) return null;
        return [...addendumTemplateMappings].sort(
            (a, b) => Number(b.order ?? 0) - Number(a.order ?? 0),
        )[0];
    }, [addendumTemplateMappings]);

    /** State disclosure merged at the bottom of the contract package. */
    const linkedDisclosureMapping = useMemo(() => {
        if (!disclosureTemplateMappings.length) return null;
        return [...disclosureTemplateMappings].sort(
            (a, b) => Number(b.order ?? 0) - Number(a.order ?? 0),
        )[0];
    }, [disclosureTemplateMappings]);

    const linkedDisclosureMatchesSelectedState = useMemo(
        () => disclosureMappingMatchesState(linkedDisclosureMapping, selectedState),
        [linkedDisclosureMapping, selectedState],
    );

    const [documentTemplatePrefillByMappingId, setDocumentTemplatePrefillByMappingId] = useState<
        Record<string, Record<string, string>>
    >({});
    const [loadingTemplateMappings, setLoadingTemplateMappings] = useState(false);
    const [linkingDisclosureTemplate, setLinkingDisclosureTemplate] = useState(false);
    const [disclosureCalcModalOpen, setDisclosureCalcModalOpen] = useState(false);
    const [disclosureCalcBankAnalyses, setDisclosureCalcBankAnalyses] = useState<unknown>(null);
    const [loadingDisclosureCalcBankAnalysis, setLoadingDisclosureCalcBankAnalysis] =
        useState(false);
    const [savingDisclosureCalculation, setSavingDisclosureCalculation] = useState(false);
    const [previewingTemplateId, setPreviewingTemplateId] = useState<string | null>(null);
    const templatePreviewBlobUrlRef = useRef<string | null>(null);
    const inlinePreviewBlobUrlRef = useRef<string | null>(null);
    const [loadingInlinePreview, setLoadingInlinePreview] = useState(false);
    /** `bs:<boldSignTemplateGuid>` | `up:<uploadedFileId>` | `` */
    const [selectedAddendumOption, setSelectedAddendumOption] = useState<string>("");
    /** Main contract in envelope — default on; addendum/disclosure auto-merge when configured below. */
    const [includeMainContractInSend, setIncludeMainContractInSend] = useState(true);

    const configuredAddendumLayoutKey = useMemo((): string | null => {
        const opt = String(selectedAddendumOption || "").trim();
        if (opt.startsWith("up:")) return null;
        if (opt.startsWith("lk:")) return opt.slice(3).trim() || null;
        const fromMapping = String(
            linkedAddendumMapping?.template?.layoutKey ??
                linkedAddendumMapping?.template?.templateId ??
                linkedAddendumMapping?.templateId ??
                "",
        ).trim();
        return isPlatformLayoutKey(fromMapping) ? fromMapping : null;
    }, [selectedAddendumOption, linkedAddendumMapping]);

    const configuredDisclosureRef = useMemo((): string | null => {
        if (!linkedDisclosureMapping || !linkedDisclosureMatchesSelectedState) return null;
        const rowId = String(linkedDisclosureMapping?.template?.id ?? "").trim();
        return rowId || null;
    }, [linkedDisclosureMapping, linkedDisclosureMatchesSelectedState]);

    const canSendWithoutContract = useMemo(
        () => canSendWithoutMainContract(configuredAddendumLayoutKey, configuredDisclosureRef),
        [configuredAddendumLayoutKey, configuredDisclosureRef],
    );

    useEffect(() => {
        if (!canSendWithoutContract) {
            setIncludeMainContractInSend(true);
        }
    }, [canSendWithoutContract]);

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
    /** CRM-only client email (contract + application client). */
    const primaryClientRecipientEmail = useMemo(
        () => getSignerRecipientEmailForContract(applicationData, resolvedContract),
        [applicationData, resolvedContract],
    );

    const offerDecisionState = useSelector((state: RootState) => state.offerDecision);
    const offerDecisionData = offerDecisionState?.data ?? null;
    const offerDecisionLoading = Boolean(offerDecisionState?.loading);
    const termsOffersState = useSelector((state: RootState) => state.termsOffers);
    const latestTermsOffer =
        Array.isArray(termsOffersState?.data) && termsOffersState.data[0]
            ? (termsOffersState.data[0] as unknown as Record<string, unknown>)
            : null;

    const contractDisclosureFrequency = useMemo(() => {
        return resolveDealDisclosureFrequencyKey({
            offerDecision: (offerDecisionData as Record<string, unknown> | null) ?? null,
            contract: resolvedContract,
            application: applicationData as Record<string, unknown> | null,
            termsOffer: latestTermsOffer,
            offerDecisionLoaded: !offerDecisionLoading,
        });
    }, [
        offerDecisionData,
        resolvedContract,
        applicationData,
        latestTermsOffer,
        offerDecisionLoading,
    ]);

    const disclosureCalculatorSeedInputs = useMemo(
        () =>
            buildDisclosureCalculatorInputsFromSources({
                state: selectedState,
                application: applicationData as Record<string, unknown> | null,
                contract: resolvedContract,
                offerDecision: (offerDecisionData as Record<string, unknown> | null) ?? null,
            }),
        [selectedState, applicationData, resolvedContract, offerDecisionData],
    );

    const disclosureCalcBankMonthlyRevenues = useMemo(
        () => extractMonthlyRevenuesFromBankAnalyses(disclosureCalcBankAnalyses),
        [disclosureCalcBankAnalyses],
    );
    const achListState = useSelector((state: RootState) => state.achList);
    const epoListState = useSelector((state: RootState) => state.epoList);
    const addendumListState = useSelector((state: RootState) => state.addendumList);
    const ownerListState = useSelector((state: RootState) => state.contractOwnerList);
    const guarantorListState = useSelector((state: RootState) => state.contractGuarantorList);
    const bankDetailsListState = useSelector((state: RootState) => state.bankDetails);

    const contractOwnerRows = useMemo(
        () => (Array.isArray(ownerListState.data) ? ownerListState.data : []),
        [ownerListState.data],
    );

    /** Owners from contract CRM rows, application client, or live Info Required edits. */
    const resolvedOwnerParties = useMemo(
        () =>
            resolveOwnerPartiesForContractSigners(
                applicationData,
                contractOwnerRows,
                activeInfoPanel === "owner" ? ownerEntries : null,
            ),
        [applicationData, contractOwnerRows, activeInfoPanel, ownerEntries],
    );

    /** DocuSign/BoldSign template roles for Summary (top-level `roles`, not `raw.roles`). */
    const suggestedContractSignerRows = useMemo(() => {
        const fromOwners = buildContractSignerRowsFromOwnerParties(resolvedOwnerParties);
        if (fromOwners.length > 0) return fromOwners;
        return buildSuggestedContractSignerRows({
            clientName: getApplicationPrimaryRecipientName(applicationData),
            clientEmail: primaryClientRecipientEmail,
            owners: resolvedOwnerParties,
            guarantors: guarantorEntries,
        });
    }, [
        applicationData,
        primaryClientRecipientEmail,
        resolvedOwnerParties,
        guarantorEntries,
    ]);

    /** Live CRM owners win over stale saved contract signer overrides. */
    const effectiveContractSignerRows = useMemo(
        () =>
            reconcileSignerRowsWithFreshOwners(
                contractSignerOverrides,
                suggestedContractSignerRows,
            ),
        [contractSignerOverrides, suggestedContractSignerRows],
    );

    const applicationOwnerSignerCount = resolvedOwnerParties.length;

    const activeOwnerCount = useMemo(
        () =>
            Math.max(
                applicationOwnerSignerCount,
                resolveActiveOwnerCount({
                    owners: resolvedOwnerParties.map((o) => ({
                        email: String(o.ownerEmail || "").trim(),
                        firstName: String(o.ownerFirstName || "").trim(),
                        lastName: String(o.ownerLastName || "").trim(),
                    })),
                    guarantors: guarantorEntries.map((g) => ({
                        email: String((g as { guarantorEmail?: string }).guarantorEmail || "").trim(),
                        firstName: String((g as { guarantorFirstName?: string }).guarantorFirstName || "").trim(),
                        lastName: String((g as { guarantorLastName?: string }).guarantorLastName || "").trim(),
                    })),
                    signerRoles: suggestedContractSignerRows.map((r) => ({
                        signerRole: r.role,
                        signerEmail: r.email,
                    })),
                }),
            ),
        [applicationOwnerSignerCount, resolvedOwnerParties, guarantorEntries, suggestedContractSignerRows],
    );

    const templateRoleRowsForSigner = useMemo(
        () => getPlatformSignerRoleRows(activeOwnerCount),
        [activeOwnerCount],
    );

    /** Signing email for DocuSign (includes template default when CRM client email is blank). */
    const docuSignSignerEmail = useMemo(
        () =>
            resolveEffectiveDocuSignSignerEmail(
                applicationData,
                resolvedContract,
                templateRoleRowsForSigner,
                resolvedOwnerParties
                    .map((o) => String(o.ownerEmail || "").trim())
                    .filter(Boolean),
            ),
        [
            applicationData,
            resolvedContract,
            templateRoleRowsForSigner,
            resolvedOwnerParties,
        ],
    );

    const summaryTemplateRoles = useMemo(() => {
        if (effectiveContractSignerRows.length > 0) {
            return suggestedRowsToSummaryTemplateRoles(effectiveContractSignerRows);
        }
        if (templateRoleRowsForSigner.length > 0) return templateRoleRowsForSigner;
        const signerEmail = docuSignSignerEmail.email.trim();
        if (!signerEmail) return [];
        return [
            {
                roleName: DOCUSIGN_DEFAULT_SIGNER_ROLE,
                signerEmail: signerEmail,
                signerName: "",
                roleIndex: 1,
            },
        ];
    }, [
        effectiveContractSignerRows,
        templateRoleRowsForSigner,
        docuSignSignerEmail.email,
    ]);

    const hasSavedSignerOverrides = Boolean(contractSignerOverrides?.length);

    /**
     * Summary cards are built from `effectiveContractSignerRows`, which already carry
     * the correct per-owner email (each owner row from the linked client). Those rows
     * must be displayed as-is — otherwise `mergeBoldSignRoleSignerEmail` collapses every
     * generic "Signer" role to the primary CRM email and all owners show the same address.
     */
    const summaryRolesCarryOwnerEmails =
        hasSavedSignerOverrides || effectiveContractSignerRows.length > 0;

    const uploadedDocs = Array.isArray(uploadedDocsState.data)
        ? uploadedDocsState.data
        : [];
    const sourceApplicationPdf = useMemo(() => {
        const files = Array.isArray((applicationData as any)?.files)
            ? (applicationData as any).files
            : [];
        if (!files.length) return null;
        const preferred = files.find((f: any) => {
            const name = String(f?.originalName || f?.fileName || "").toLowerCase();
            const type = String(f?.mimeType || f?.documentType || f?.type || "").toLowerCase();
            return (
                (type.includes("pdf") || name.includes(".pdf")) &&
                (name.includes("application") || name.includes("business"))
            );
        });
        const fallbackPdf = files.find((f: any) => {
            const name = String(f?.originalName || f?.fileName || "").toLowerCase();
            const type = String(f?.mimeType || "").toLowerCase();
            return type.includes("pdf") || name.includes(".pdf");
        });
        const row = preferred || fallbackPdf;
        if (!row) return null;
        const url = String(row?.url || row?.fileUrl || row?.downloadUrl || "").trim();
        if (!url) return null;
        return {
            name: String(row?.originalName || row?.fileName || "Application PDF"),
            url,
        };
    }, [applicationData]);
    const normalizeDocumentTypeKey = (value: unknown): string =>
        String(value ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "");
    const documentTypeByKey: Record<RequiredDocumentKey, string> = {
        voidedCheck: "Voided Check",
        driverLicense: "Driver License",
        // bankStatement: "Bank Statement",
        // utilityBill: "Utility Bill",
    };
    const requiredDocumentRows: { key: RequiredDocumentKey; label: string; inputRef: React.RefObject<HTMLInputElement | null> }[] = [
        { key: "driverLicense", label: "Driver's License", inputRef: driverLicenseRef },
        { key: "voidedCheck", label: "Voided Check", inputRef: voidedCheckRef },
        // { key: "bankStatement", label: "Bank Statement", inputRef: bankStatementRef },
        // { key: "utilityBill", label: "Utility Bill", inputRef: utilityBillRef },
    ];
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
    const addendumTemplateOptions = CONTRACT_ADDENDUM_DOCUMENT_OPTIONS;
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
        const fromData = resolvePrismaApplicationUuid(
            applicationData as { id?: unknown; _id?: unknown } | undefined,
        );
        if (fromData) return fromData;
        const fromProp = applicationId?.trim();
        if (fromProp && isApplicationUuid(fromProp)) return fromProp;
        return null;
    }, [applicationId, applicationData]);

    const businessApplicationId = useMemo(() => {
        const d = applicationData as { applicationId?: string | number } | undefined;
        const fromData = d?.applicationId;
        if (fromData != null && String(fromData).trim()) return fromData;
        const fromProp = applicationId?.trim();
        if (fromProp && /^\d+$/.test(fromProp)) return fromProp;
        return null;
    }, [applicationData, applicationId]);

    const applicationUuidForUpload = useMemo(() => {
        const d = applicationData as { _id?: string; id?: string } | undefined;
        return String(d?._id ?? d?.id ?? "").trim() || null;
    }, [applicationData]);

    const contractPrefillRecords: ContractPrefillContractRecords = useMemo(() => {
        const firstRow = (data: unknown): Record<string, unknown> | null =>
            Array.isArray(data) && data.length ? (data[0] as Record<string, unknown>) : null;
        const rows = Array.isArray(bankDetailsListState.data) ? bankDetailsListState.data : [];
        const latestBankDetail =
            rows.length > 0
                ? [...rows].sort((a, b) => {
                      const aT = new Date(
                          (a as { updatedAt?: string; createdAt?: string }).updatedAt ??
                              (a as { createdAt?: string }).createdAt ??
                              0,
                      ).getTime();
                      const bT = new Date(
                          (b as { updatedAt?: string; createdAt?: string }).updatedAt ??
                              (b as { createdAt?: string }).createdAt ??
                              0,
                      ).getTime();
                      return bT - aT;
                  })[0]
                : null;
        const contractRow = resolvedContract as Record<string, unknown> | null;
        const mergedContract =
            contractRow && typeof contractRow === "object"
                ? (() => {
                      const o = mergeContractPrefillOverrideLayers(
                          stripDocumentTemplateBlobFromPrefillOverrides(
                              contractRow.contractPrefillOverrides,
                          ),
                          contractPrefillFromDb,
                      );
                      return Object.keys(o).length > 0 ? { ...contractRow, ...o } : contractRow;
                  })()
                : null;
        return {
            contract: mergedContract,
            ach: firstRow(achListState.data),
            addendum: firstRow(addendumListState.data),
            epo: firstRow(epoListState.data),
            owners: Array.isArray(ownerListState.data) ? ownerListState.data : [],
            guarantors: Array.isArray(guarantorListState.data) ? guarantorListState.data : [],
            bankDetail: latestBankDetail as Record<string, unknown> | null,
        };
    }, [
        achListState.data,
        addendumListState.data,
        epoListState.data,
        ownerListState.data,
        guarantorListState.data,
        resolvedContract,
        contractPrefillFromDb,
        bankDetailsListState.data,
    ]);

    const contractPrefillOverrides = useMemo(() => {
        const fromNote = parseNoteStructuredSection<Partial<BuildContractPrefillFieldsArgs>>(
            String((applicationData as { note?: string } | null | undefined)?.note || ""),
            CONTRACT_PREFILL_OVERRIDES_SECTION,
        );
        if (!contractPrefillLoaded) return fromNote ?? undefined;
        const merged = mergeContractPrefillOverrideLayers(
            fromNote,
            stripDocumentTemplateBlobFromPrefillOverrides(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ),
            contractPrefillFromDb,
        );
        return Object.keys(merged).length > 0 ? merged : undefined;
    }, [applicationData, contractPrefillFromDb, contractPrefillLoaded, resolvedContract]);

    const prefillDraftFingerprint = useMemo(
        () =>
            docuSignPrefillDraftFingerprint({
                contractPrefillOverrides: contractPrefillFromDb,
                documentTemplatePrefillByMappingId,
            }),
        [contractPrefillFromDb, documentTemplatePrefillByMappingId],
    );

    const canEditContractPrefill = useMemo(
        () => Boolean(applicationIdForLookup),
        [applicationIdForLookup],
    );

    /** Step 4 (Sent) only — no DocuSign PDF tab on Documents / Info / Summary. */
    const showDocuSignContractTab = useMemo(
        () =>
            activeStep === "sent" &&
            isContractAlreadySent(resolvedContract, sentAt, sentStepUnlocked),
        [activeStep, resolvedContract, sentAt, sentStepUnlocked],
    );

    /** Application client/businessInfo + contract ACH/addendum/EPO/owners/guarantors + optional preview overrides. */
    const dealReviewFields = useMemo(() => {
        const effectiveOverrides = mergeContractPrefillOverrideLayers(
            contractPrefillOverrides,
            contractPrefillLoaded ? contractPrefillFromDb : null,
        );
        const fromApp = buildContractPrefillFieldsFromApplication(applicationData, {
            agreementDate: formatDate(new Date()),
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
        const withSavedFees = overlaySavedAppendixFeeOnPrefillFields(
            mergedList,
            effectiveOverrides,
            {
                application: applicationData as Record<string, unknown> | undefined,
                contract: contractPrefillRecords.contract ?? null,
                offerDecision: (offerDecisionData as Record<string, unknown> | null) ?? null,
            },
        );
        return prepareDealReviewPrefillDisplay(withSavedFees);
    }, [
        applicationData,
        prefillFieldsPreview,
        contractPrefillRecords,
        contractPrefillOverrides,
        contractPrefillFromDb,
        contractPrefillLoaded,
        offerDecisionData,
    ]);

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
        return [
            row("Decision", od.decision),
            row("Position", od.position),
            row("Offer amount", firstOf("offer", "approvedAmount")),
            row("Rate", od.rate),
            row("Term", firstOf("term", "termLength")),
            row("Frequency", od.frequency),
            row("Repay per period", firstOf("repayPerPeriod", "paymentAmount")),
            row("Monthly payment", od.monthlyPayment),
            row("Fees", od.fees),
            row("Our remit", od.ourRemit),
            row("Total remit", firstOf("totalRemit", "paybackAmount")),
            row("Commission", od.commissionAmount),
            row("Number of payments", firstOf("numberOfPayments", "paymentsTerms")),
            row("Notes", od.notes),
            row("Decline reason", od.declineReason),
        ];
    }, [offerDecisionData]);

    useEffect(() => {
        if (!isOpen || !applicationIdForLookup) return;
        invalidateApplicationDetailCache(applicationIdForLookup);
        void dispatch(getApplicationById(applicationIdForLookup));
        void dispatch(getOfferDecisionByApplication(applicationIdForLookup));
        void dispatch(getTermsOffers({ application: applicationIdForLookup }));
        void dispatch(getBankDetails({ application: applicationIdForLookup }));
    }, [isOpen, applicationIdForLookup, dispatch]);

    /** Re-fetch offer decision when saved elsewhere (e.g. Offer Decision toggle) while viewer is open. */
    useEffect(() => {
        if (!isOpen || !applicationIdForLookup) return;
        const onOfferDecisionUpdated = (event: Event) => {
            const detail = (event as CustomEvent<{ applicationId?: string }>).detail;
            if (
                !offerDecisionUpdateMatchesApplication(
                    detail?.applicationId,
                    applicationIdForLookup,
                )
            ) {
                return;
            }
            disclosureAutoLinkKeyRef.current = "";
            void dispatch(getOfferDecisionByApplication(applicationIdForLookup));
            void dispatch(getTermsOffers({ application: applicationIdForLookup }));
        };
        window.addEventListener(OFFER_DECISION_UPDATED_EVENT, onOfferDecisionUpdated);
        return () => {
            window.removeEventListener(OFFER_DECISION_UPDATED_EVENT, onOfferDecisionUpdated);
        };
    }, [isOpen, applicationIdForLookup, dispatch]);

    useEffect(() => {
        if (!isOpen) {
            setResolvedContractId(null);
            setSelectedState("");
            setSelectedFunder("");
            setContractPrefillFromDb(null);
            setContractPrefillLoaded(false);
            setDocumentTemplatePrefillByMappingId({});
            setSelectedAddendumOption("");
            setIncludeMainContractInSend(true);
            setSessionEnvelopeId(null);
            setDocuSignOpenUrl(null);
            setContractSignerOverrides(null);
            setShowRecipientEditor(false);
            draftPreparedAddendumIdRef.current = undefined;
            draftPreparedCcRef.current = null;
            draftPreparedPrefillFingerprintRef.current = null;
            draftPreparedSignerRolesRef.current = null;
            draftPreparedOwnerCountRef.current = null;
            draftPreparedPackageFingerprintRef.current = null;
            prefilledPdfCachedForEnvelopeRef.current = null;
            prefilledBoldSignPdfUrlRef.current = null;
            return;
        }
        setContractPrefillLoaded(false);
        const propId = Number(contractId);
        const appId = applicationIdForLookup;
        const applyContractMeta = (contract: unknown) => {
            const c = contract as { state?: unknown; funderName?: unknown; contractPrefillOverrides?: unknown } | null;
            setResolvedContract(c && typeof c === "object" ? (c as Record<string, unknown>) : null);
            let stateForSelect = pickUsStateForSelect(c?.state);
            if (!stateForSelect && applicationData) {
                const ad = applicationData as Record<string, unknown>;
                const bi0 = Array.isArray(ad.businessInfo)
                    ? (ad.businessInfo[0] as Record<string, unknown>)
                    : undefined;
                const client = ad.client as Record<string, unknown> | undefined;
                stateForSelect = pickUsStateForSelect(client?.state ?? bi0?.state);
            }
            setSelectedState(stateForSelect);
            const rawFunder = String(c?.funderName ?? "").trim();
            setSelectedFunder(
                pickFunderForSelect(rawFunder, DEFAULT_FUNDER_OPTIONS) || rawFunder,
            );
            setContractPrefillFromDb(
                stripDocumentTemplateBlobFromPrefillOverrides(c?.contractPrefillOverrides),
            );
            setDocumentTemplatePrefillByMappingId(parseDocumentTemplatePrefillByMappingId(c?.contractPrefillOverrides));
            setContractSignerOverrides(
                parseContractSignerOverridesFromPrefill(c?.contractPrefillOverrides),
            );
            setContractPrefillLoaded(true);
        };

        if (!appId) {
            setResolvedContractId(Number.isFinite(propId) ? propId : null);
            if (!Number.isFinite(propId)) {
                setResolvedContract(null);
                setSelectedState("");
                setSelectedFunder("");
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
                        setSelectedState("");
                        setSelectedFunder("");
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
                const res = await dispatch(getByApplicationIdContract(appId)).unwrap();
                const contract = (res as any)?.data ?? res;
                const id = Number((contract as any)?.id);
                if (cancelled) return;
                applyContractMeta(contract);
                if (Number.isFinite(id)) {
                    setResolvedContractId(id);
                } else if (Number.isFinite(propId)) {
                    setResolvedContractId(propId);
                } else {
                    setResolvedContractId(null);
                }
            } catch {
                if (!cancelled) {
                    setResolvedContractId(Number.isFinite(propId) ? propId : null);
                    if (Number.isFinite(propId)) {
                        try {
                            const res2 = await dispatch(getByIdContract(propId)).unwrap();
                            const contract2 = (res2 as any)?.data ?? res2;
                            if (!cancelled) applyContractMeta(contract2);
                        } catch {
                            if (!cancelled) {
                                setResolvedContract(null);
                                setSelectedState("");
                                setSelectedFunder("");
                                setContractPrefillFromDb(null);
                                setDocumentTemplatePrefillByMappingId({});
                                setContractPrefillLoaded(true);
                            }
                        }
                    } else {
                        setResolvedContract(null);
                        setSelectedState("");
                        setSelectedFunder("");
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
    }, [isOpen, contractId, applicationIdForLookup, applicationData, dispatch]);

    const effectiveContractId = useMemo(() => {
        if (resolvedContractId != null && Number.isFinite(resolvedContractId)) {
            return resolvedContractId;
        }
        const n = Number(contractId);
        return Number.isFinite(n) ? n : null;
    }, [resolvedContractId, contractId]);

    /** Always reload owners when entering Summary so CRM edits appear immediately. */
    useEffect(() => {
        if (!isOpen || activeStep !== "summary" || !applicationIdForLookup) return;
        invalidateApplicationDetailCache(applicationIdForLookup);
        void dispatch(getApplicationById(applicationIdForLookup));
        if (effectiveContractId != null) {
            void dispatch(getAllContractOwners({ contractId: effectiveContractId }));
        }
    }, [isOpen, activeStep, applicationIdForLookup, effectiveContractId, dispatch]);

    const linkedEnvelopeId = useMemo(() => {
        const session = String(sessionEnvelopeId || "").trim();
        if (session) return session;
        const fromContract = String(
            (resolvedContract as { application?: { document?: { envelopeId?: string } } } | null)
                ?.application?.document?.envelopeId ?? "",
        ).trim();
        return fromContract || null;
    }, [sessionEnvelopeId, resolvedContract]);

    const sentStepPersistKey = useMemo(
        () => sentStepStorageKey(effectiveContractId, applicationIdForLookup),
        [effectiveContractId, applicationIdForLookup],
    );

    const canCancelSentContract = useMemo(
        () => canCancelDocuSignContract(resolvedContract, sentAt),
        [resolvedContract, sentAt],
    );
    const canReviewAndSendDocuSign = useMemo(
        () => canReviewAndSendToDocuSign(resolvedContract, sentAt, sentStepUnlocked),
        [resolvedContract, sentAt, sentStepUnlocked],
    );

    const contractIsFullySigned = useMemo(() => {
        const doc = pickContractEnvelopeDocument(resolvedContract);
        return isContractFullySigned(resolvedContract?.status, doc?.status);
    }, [resolvedContract]);

    const canResendSignedContract = useMemo(
        () => Boolean(onPrepareDocuSignDraft) && contractIsFullySigned,
        [onPrepareDocuSignDraft, contractIsFullySigned],
    );

    const contractNeedsNewEnvelope = useMemo(
        () =>
            isContractVoidedOrTerminal(
                resolvedContract?.status,
                pickContractEnvelopeDocument(resolvedContract)?.status,
            ),
        [resolvedContract],
    );

    const showResendContractButton =
        canResendSignedContract && !canCancelSentContract && !docuSignOpenUrl;

    const contractSignersValidationError = useMemo(() => {
        const roles =
            effectiveContractSignerRows.length > 0
                ? buildDocuSignRolesFromEditorRows(effectiveContractSignerRows)
                : buildBoldSignRolesFromTemplateRecipients(
                      templateRoleRowsForSigner,
                      String(docuSignSignerEmail.email || "").trim(),
                      getApplicationPrimaryRecipientName(applicationData),
                      { singleSignerOnly: false },
                  );
        return getContractSignerValidationMessage(roles, effectiveContractSignerRows);
    }, [
        applicationData,
        docuSignSignerEmail.email,
        effectiveContractSignerRows,
        templateRoleRowsForSigner,
    ]);

    /** Allow supplemental-only sends when main contract is already out for signature. */
    const canReviewAndSendCurrentPackage = useMemo(() => {
        if (!canSendWithoutContract || includeMainContractInSend) {
            return canReviewAndSendDocuSign;
        }
        return Boolean(onPrepareDocuSignDraft) && !contractSignersValidationError;
    }, [
        canSendWithoutContract,
        includeMainContractInSend,
        canReviewAndSendDocuSign,
        onPrepareDocuSignDraft,
        contractSignersValidationError,
    ]);

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
    const docuSignPdfCacheSuffixRef = useRef(docuSignPdfCacheSuffix);
    const draftPreparedAddendumIdRef = useRef<string | null | undefined>(undefined);
    const draftPreparedCcRef = useRef<string[] | null>(null);
    const draftPreparedPrefillFingerprintRef = useRef<string | null>(null);
    const draftPreparedSignerRolesRef = useRef<string | null>(null);
    const draftPreparedOwnerCountRef = useRef<number | null>(null);
    const draftPreparedPackageFingerprintRef = useRef<string | null>(null);
    const includeMainContractInSendRef = useRef(includeMainContractInSend);
    includeMainContractInSendRef.current = includeMainContractInSend;

    const signerRolesDraftFingerprint = useMemo(
        () => contractSignerOverridesFingerprint(effectiveContractSignerRows),
        [effectiveContractSignerRows],
    );

    const invalidateDocuSignDraftSession = useCallback(() => {
        setSessionEnvelopeId(null);
        draftPreparedAddendumIdRef.current = undefined;
        draftPreparedCcRef.current = null;
        draftPreparedPrefillFingerprintRef.current = null;
        draftPreparedSignerRolesRef.current = null;
        draftPreparedOwnerCountRef.current = null;
        draftPreparedPackageFingerprintRef.current = null;
    }, []);

    const openRecipientEditorFromSummary = useCallback(async () => {
        let freshParties = resolvedOwnerParties;
        if (applicationIdForLookup) {
            invalidateApplicationDetailCache(applicationIdForLookup);
            freshParties = await fetchFreshOwnerPartiesForContractSigners(
                dispatch,
                applicationIdForLookup,
                effectiveContractId,
            );
        }
        const freshSuggested = buildContractSignerRowsFromOwnerParties(freshParties);
        const liveSignerRows = reconcileSignerRowsWithFreshOwners(
            contractSignerOverrides,
            freshSuggested.length > 0
                ? freshSuggested
                : suggestedContractSignerRows,
        );

        const existing = summaryTemplateRoles;
        let editorRows: ContractSignerOverrideRow[] = [];
        if (liveSignerRows.length > 0) {
            editorRows = liveSignerRows;
        } else if (existing.length > 0) {
            editorRows = existing.map((roleRow) => {
                const row = roleRow as Record<string, unknown>;
                const role = getTemplateRoleLabel(row);
                const email = resolveSignerEmailForSummary(
                    role,
                    getTemplateRoleEmailFromRow(row),
                    docuSignSignerEmail.email,
                    hasSavedSignerOverrides,
                );
                return {
                    role: resolveDocuSignSignerRole(role),
                    name: getTemplateRoleNameFromRow(row),
                    email,
                };
            });
        } else if (suggestedContractSignerRows.length) {
            editorRows = suggestedContractSignerRows.map((row) => ({
                role: row.role,
                name: row.name,
                email: row.email,
            }));
        } else {
            editorRows = [
                {
                    role: DOCUSIGN_DEFAULT_SIGNER_ROLE,
                    name: getApplicationPrimaryRecipientName(applicationData),
                    email: primaryClientRecipientEmail,
                },
            ];
        }
        const targetSignerCount = Math.max(
            freshParties.length,
            resolvedOwnerParties.length,
            activeOwnerCount,
            liveSignerRows.length,
            dedupeContractSignerRows(editorRows).length,
            1,
        );
        const merged = mergeContractSignerEditorRows(
            editorRows,
            liveSignerRows.length ? liveSignerRows : suggestedContractSignerRows,
            targetSignerCount,
            freshParties.length ? freshParties : resolvedOwnerParties,
        );
        setRecipientEditorRows(
            merged.map((row, idx) => ({
                id: String(idx + 1),
                role: row.role,
                name: row.name,
                email: row.email,
            })),
        );
        setShowRecipientEditor(true);
    }, [
        activeOwnerCount,
        applicationData,
        applicationIdForLookup,
        contractSignerOverrides,
        dispatch,
        docuSignSignerEmail.email,
        effectiveContractId,
        hasSavedSignerOverrides,
        primaryClientRecipientEmail,
        resolvedOwnerParties,
        suggestedContractSignerRows,
        summaryTemplateRoles,
    ]);

    /** Saved signer overrides changed after a draft was prepared — force a new envelope on next send. */
    useEffect(() => {
        const prepared = draftPreparedSignerRolesRef.current;
        if (prepared == null || prepared === signerRolesDraftFingerprint) return;
        invalidateDocuSignDraftSession();
    }, [signerRolesDraftFingerprint, invalidateDocuSignDraftSession]);

    /** Saved prefill changed after a draft was prepared — force a new envelope on next Review & send. */
    useEffect(() => {
        const prepared = draftPreparedPrefillFingerprintRef.current;
        if (prepared == null || prepared === prefillDraftFingerprint) return;
        invalidateDocuSignDraftSession();
    }, [prefillDraftFingerprint, invalidateDocuSignDraftSession]);

    const sessionEnvelopeIdRef = useRef<string | null>(null);
    const startDocuSignSenderReturnWatchRef = useRef<(() => void) | null>(null);
    const docusignSenderReturnWatchCleanupRef = useRef<(() => void) | null>(null);
    const resolvedContractRef = useRef(resolvedContract);
    const ccEmailsRef = useRef<string[]>([]);
    const selectedAddendumOptionRef = useRef("");
    const linkedAddendumMappingRef = useRef<ContractDocumentTemplateMappingRow | null>(null);
    const linkedDisclosureMappingRef = useRef<ContractDocumentTemplateMappingRow | null>(null);
    const disclosureAutoLinkKeyRef = useRef("");
    const prevContractDisclosureFrequencyRef = useRef("");
    linkedEnvelopeIdRef.current = linkedEnvelopeId;
    applicationIdForLookupRef.current = applicationIdForLookup;
    ccEmailsRef.current = mergeContractCcEmailList(ccEmails);
    selectedAddendumOptionRef.current = selectedAddendumOption;
    sessionEnvelopeIdRef.current = sessionEnvelopeId;
    resolvedContractRef.current = resolvedContract;
    linkedAddendumMappingRef.current = linkedAddendumMapping;
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
                "No DocuSign envelope yet. Send the contract to DocuSign first.",
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
            /hourly_envelope_polling_limit|rate.?limit|too many requests/i.test(message);

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

        const maxAttempts = options?.maxAttempts ?? 1;

        try {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                if (prefilledLoadGenRef.current !== gen) return;
                if (attempt > 0) await sleep(4000);
                if (prefilledLoadGenRef.current !== gen) return;

                try {
                    const urlPath = envelopeId
                        ? `/docusign/download/${encodeURIComponent(envelopeId)}`
                        : `/docusign/prefilled-pdf/application/${encodeURIComponent(appId!)}`;
                    const res = await axiosGet(urlPath, {
                        responseType: "blob",
                        timeout: 120000,
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
                    if (isRateLimitError(lastError)) break;
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
                    "Could not load prefilled PDF from DocuSign. Try again in a few seconds.",
            );
        } finally {
            if (manageLoading && prefilledActiveLoadIdRef.current === loadId) {
                setPrefilledBoldSignPdfLoading(false);
            }
        }
    },
    [],
    );

    const resolveAddendumLayoutKeyForDocuSignMerge = useCallback((): string | null => {
        const opt = String(selectedAddendumOptionRef.current || "").trim();
        if (opt.startsWith("up:")) return null;
        if (opt.startsWith("lk:")) return opt.slice(3).trim() || null;
        const fromMapping = String(
            linkedAddendumMappingRef.current?.template?.layoutKey ??
                linkedAddendumMappingRef.current?.template?.templateId ??
                linkedAddendumMappingRef.current?.templateId ??
                "",
        ).trim();
        return isPlatformLayoutKey(fromMapping) ? fromMapping : null;
    }, []);

    const resolveDisclosureTemplateRefForDocuSignMerge = useCallback((): string | null => {
        const row = linkedDisclosureMappingRef.current;
        const rowId = String(row?.template?.id ?? "").trim();
        return rowId || null;
    }, []);

    const getEffectiveSendPackage = useCallback((): ContractSendPackageSelection => {
        return resolveEffectiveSendPackage({
            includeMainContractInSend: includeMainContractInSendRef.current,
            addendumLayoutKey: resolveAddendumLayoutKeyForDocuSignMerge(),
            disclosureRef: resolveDisclosureTemplateRefForDocuSignMerge(),
        });
    }, [resolveAddendumLayoutKeyForDocuSignMerge, resolveDisclosureTemplateRefForDocuSignMerge]);

    const sendPackageFingerprint = useMemo(
        () => contractSendPackageFingerprint(getEffectiveSendPackage()),
        [
            getEffectiveSendPackage,
            includeMainContractInSend,
            selectedAddendumOption,
            linkedDisclosureMapping,
            linkedDisclosureMatchesSelectedState,
            canSendWithoutContract,
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
        if (effectiveContractSignerRows.length > 0) {
            return buildDocuSignRolesFromEditorRows(effectiveContractSignerRows);
        }
        const signerEmail = String(primarySignerEmailRef.current || "").trim();
        const signerName = getApplicationPrimaryRecipientName(applicationData);
        return buildBoldSignRolesFromTemplateRecipients(
            templateRoleRowsForSigner,
            signerEmail,
            signerName,
            { singleSignerOnly: false },
        );
    }, [
        applicationData,
        effectiveContractSignerRows,
        templateRoleRowsForSigner,
    ]);

    const fetchDocuSignSenderViewUrl = useCallback(
        async (
            envelopeId: string,
            ccForSync: string[],
        ): Promise<{ url: string | null; error: string | null }> => {
            const returnUrl = resolveDocuSignSenderReturnUrl();
            const signerEmail = String(primarySignerEmailRef.current || "").trim();
            const appId = applicationIdForLookupRef.current;
            const roles = buildDocuSignRolesForSync();
            try {
                const res = await axiosPost("/docusign/sender-view", {
                    envelopeId,
                    returnUrl,
                    ccEmails: ccForSync,
                    roles,
                    ...(appId ? { applicationId: appId } : {}),
                    ...(signerEmail
                        ? {
                              signerEmail,
                              signerName: getApplicationPrimaryRecipientName(applicationData),
                          }
                        : {}),
                });
                const url = String((res as { data?: { url?: string } })?.data?.url ?? "").trim();
                return { url: url || null, error: null };
            } catch (err: unknown) {
                const ax = err as {
                    response?: { data?: { message?: string } };
                    message?: string;
                };
                const apiMessage = String(ax?.response?.data?.message ?? "").trim();
                return {
                    url: null,
                    error: apiMessage || ax?.message || "Could not load DocuSign review URL.",
                };
            }
        },
        [applicationData, buildDocuSignRolesForSync],
    );

    const fetchDocuSignSenderViewUrlWithRetry = useCallback(
        async (
            envelopeId: string,
            ccForSync: string[],
            justCreated: boolean,
        ): Promise<{ url: string | null; error: string | null }> => {
            const delays = justCreated
                ? DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS.justCreated
                : DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS.existing;
            let lastError: string | null = null;
            for (const delay of delays) {
                if (delay > 0) {
                    await new Promise((r) => setTimeout(r, delay));
                }
                const result = await fetchDocuSignSenderViewUrl(envelopeId, ccForSync);
                if (result.url) return { url: result.url, error: null };
                lastError = result.error;
            }
            return { url: null, error: lastError };
        },
        [fetchDocuSignSenderViewUrl],
    );

    /** Step 4: load DocuSign envelope PDF (sent → completed with signatures). */
    useEffect(() => {
        if (!isOpen || pdfRightPaneTab !== "docusign" || !showDocuSignContractTab) {
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

        void loadPrefilledPdfFromDocuSign(undefined, { maxAttempts: 3 });
        return () => {
            prefilledLoadGenRef.current += 1;
        };
    }, [
        isOpen,
        pdfRightPaneTab,
        showDocuSignContractTab,
        linkedEnvelopeId,
        sessionEnvelopeId,
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
            String(linkedEnvelopeIdRef.current || linkedEnvelopeId || "").trim() || null;
        const appId = applicationIdForLookupRef.current;

        if (!envelopeId && !appId) {
            toast.error("Send the contract to DocuSign first to download the filled PDF.");
            return;
        }

        setDownloadingFilledContract(true);
        try {
            const urlPath = envelopeId
                ? `/docusign/download/${encodeURIComponent(envelopeId)}`
                : `/docusign/prefilled-pdf/application/${encodeURIComponent(appId!)}`;
            const res = await axiosGet(urlPath, {
                responseType: "blob",
                timeout: 120000,
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
    }, [linkedEnvelopeId, applicationIdForLookup]);

    const persistContractStateAndFunder = useCallback(
        async (patch: { state?: string | null; funderName?: string | null }) => {
            const cid = effectiveContractId;
            if (cid == null || !Number.isFinite(cid)) {
                toast.error("Generate or open a contract before updating state and funder.");
                return;
            }
            const data: UpdateContractData = {};
            if (patch.state !== undefined) {
                data.state =
                    patch.state === "" || patch.state == null
                        ? null
                        : String(patch.state).trim();
            }
            if (patch.funderName !== undefined) {
                data.funderName =
                    patch.funderName === "" || patch.funderName == null
                        ? null
                        : String(patch.funderName).trim();
            }
            if (Object.keys(data).length === 0) {
                toast.info("Select a state or funder to save.");
                return;
            }
            try {
                setSavingContractMeta(true);
                const result = await dispatch(
                    updateContract({
                        id: cid,
                        data,
                    }),
                ).unwrap();
                const payload = (result as { data?: unknown })?.data ?? result;
                if (patch.state !== undefined) {
                    const canonicalState = pickUsStateForSelect(
                        (payload as { state?: string | null })?.state,
                    );
                    setSelectedState(
                        canonicalState ||
                            pickUsStateForSelect(patch.state) ||
                            String(patch.state ?? "").trim(),
                    );
                }
                const canonicalFunder = String(
                    (payload as { funderName?: string })?.funderName ?? "",
                ).trim();
                if (canonicalFunder) {
                    setSelectedFunder(
                        pickFunderForSelect(canonicalFunder, DEFAULT_FUNDER_OPTIONS) ||
                            canonicalFunder,
                    );
                }
                toast.success("Contract updated.");
            } catch (err: unknown) {
                const msg =
                    typeof err === "string"
                        ? err
                        : String(
                            (err as { message?: string })?.message ||
                            "Failed to update contract.",
                        );
                toast.error(msg);
            } finally {
                setSavingContractMeta(false);
            }
        },
        [effectiveContractId, dispatch],
    );

    useEffect(() => {
        if (!disclosureCalcModalOpen || !applicationIdForLookup) return;
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
    }, [disclosureCalcModalOpen, applicationIdForLookup]);

    useEffect(() => {
        if (!isOpen || !applicationData || contractPrefillLoaded) return;
        const ad = applicationData as Record<string, unknown>;
        const bi0 = Array.isArray(ad.businessInfo)
            ? (ad.businessInfo[0] as Record<string, unknown>)
            : undefined;
        const client = ad.client as Record<string, unknown> | undefined;
        const st = pickUsStateForSelect(client?.state ?? bi0?.state);
        const fd = String(bi0?.funderName ?? ad.funderName ?? "").trim();
        if (st) setSelectedState(st);
        if (fd) setSelectedFunder(fd);
    }, [isOpen, applicationData, contractPrefillLoaded]);

    // Seed CC list when the dialog opens (saved addresses only — no hardcoded defaults)
    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setCcEmails(loadBoldSignCcEmailList());
        setCcEmailDraft("");
    }, [isOpen]);

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
        if (ccEmails.some((e) => e.toLowerCase() === raw.toLowerCase())) {
            toast.info("That address is already in the CC list.");
            return;
        }
        const next = mergeContractCcEmailList([...ccEmails, raw]);
        setCcEmails(next);
        saveBoldSignCcEmailList(next);
        setCcEmailDraft("");
    };

    async function finishDocuSignReviewSend(
        docuSignTab: Window | null,
        options?: { forceNewEnvelope?: boolean },
    ) {
        try {
            flushSync(() => {
                setIsSending(true);
                setDocuSignOpenUrl(null);
            });

            if (options?.forceNewEnvelope || contractNeedsNewEnvelope) {
                setSessionEnvelopeId(null);
                linkedEnvelopeIdRef.current = null;
                sentStepUnlockedRef.current = false;
                setSentStepUnlocked(false);
                setSentAt(null);
                clearPersistedSentStepUnlocked(sentStepPersistKey);
                setActiveStep("summary");
                prefilledPdfCachedForEnvelopeRef.current = null;
                prefilledBoldSignPdfUrlRef.current = null;
            }
            const draft = ccEmailDraft.trim();
            let toSend = [...ccEmails];
            if (draft && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft)) {
                const dup = toSend.some((e) => e.toLowerCase() === draft.toLowerCase());
                if (!dup) {
                    toSend = [...toSend, draft];
                }
            }
            toSend = mergeContractCcEmailList(
                [...new Set(toSend.map((e) => e.trim()).filter(Boolean))],
            );

            saveBoldSignCcEmailList(toSend);
            setCcEmails(toSend);
            setCcEmailDraft("");

            if (onPrepareDocuSignDraft) {
                const signerValidationMsg =
                    contractSignersValidationError ||
                    getContractSignerValidationMessage(
                        buildDocuSignRolesForSync(),
                        contractSignerOverrides,
                    );
                if (signerValidationMsg) {
                    toast.error(signerValidationMsg);
                    showDocuSignTabMessage(
                        docuSignTab,
                        "Could not open DocuSign",
                        signerValidationMsg,
                    );
                    setShowRecipientEditor(true);
                    return;
                }
                if (selectedAddendumOption.startsWith("up:")) {
                    const msg =
                        "Only DocuSign addendum templates can be merged with the contract. Clear the addendum dropdown or pick a DocuSign template.";
                    toast.info(msg);
                    showDocuSignTabMessage(docuSignTab, "Could not open DocuSign", msg);
                    return;
                }

                const addendumLayoutKey = resolveAddendumLayoutKeyForDocuSignMerge();
                const disclosureRef = resolveDisclosureTemplateRefForDocuSignMerge();
                const packageSelection = getEffectiveSendPackage();
                const packageValidationMsg = validateContractSendPackage(packageSelection, {
                    addendumLayoutKey,
                    disclosureRef,
                });
                if (packageValidationMsg) {
                    toast.error(packageValidationMsg);
                    showDocuSignTabMessage(docuSignTab, "Could not open DocuSign", packageValidationMsg);
                    return;
                }

                const funderForDealId = selectedFunder.trim();
                const contractIdForDeal = effectiveContractId;
                if (
                    packageSelection.includeMainContract &&
                    contractIdForDeal != null &&
                    Number.isFinite(contractIdForDeal) &&
                    funderForDealId &&
                    !assignsDealId(funderForDealId)
                ) {
                    try {
                        const assignResult = await dispatch(
                            assignKatanDealIdForContract({
                                id: contractIdForDeal,
                                funderName: funderForDealId,
                            }),
                        ).unwrap();
                        const sync = (assignResult as {
                            data?: {
                                katanDealIdSync?: {
                                    dealId?: string;
                                    assignedNewDealId?: boolean;
                                };
                            };
                        })?.data?.katanDealIdSync;
                        if (sync?.assignedNewDealId && sync.dealId) {
                            toast.success(`Deal ID assigned: ${sync.dealId}.`);
                        }
                        if (applicationIdForLookup) {
                            void dispatch(getApplicationById(applicationIdForLookup));
                        }
                    } catch (assignErr: unknown) {
                        const assignMsg =
                            typeof assignErr === "string"
                                ? assignErr
                                : String(
                                      (assignErr as { message?: string })?.message ||
                                          "Could not assign deal id for the selected funder.",
                                  );
                        toast.error(assignMsg);
                        showDocuSignTabMessage(docuSignTab, "Could not open DocuSign", assignMsg);
                        return;
                    }
                }

                const sessionEnv = String(sessionEnvelopeId || "").trim() || null;
                const signerRolesForSend = buildDocuSignRolesForSync();
                const signerFingerprintForSend = contractSignerOverridesFingerprint(
                    effectiveContractSignerRows,
                );
                const currentOwnerCount = resolveActiveOwnerCount({
                    signerRoles: signerRolesForSend.map((r) => ({
                        signerRole: r.signerRole,
                        signerEmail: r.signerEmail,
                    })),
                });
                const prefillFieldsForDraft = buildDocuSignPrefillFieldsPayload();

                /** Always rebuild the draft so Sender View reflects current CRM prefill/signers. */
                if (sessionEnv) {
                    invalidateDocuSignPdfCache();
                }

                let envelopeId: string | null = null;

                const prepared = await onPrepareDocuSignDraft({
                    ccEmails: toSend,
                    supplementalLayoutKey: packageSelection.includeAddendum
                        ? addendumLayoutKey
                        : null,
                    supplementalDocumentRefs:
                        packageSelection.includeDisclosure && disclosureRef
                            ? [disclosureRef]
                            : [],
                    includeMainContract: packageSelection.includeMainContract,
                    sendPackage: packageSelection,
                    funderName: selectedFunder.trim() || null,
                    mainContractLayoutKey: resolveLayoutKey(selectedFunder),
                    signerRoles: signerRolesForSend,
                    prefillFields: prefillFieldsForDraft,
                });
                envelopeId =
                    String((prepared as { envelopeId?: string } | undefined)?.envelopeId ?? "").trim() ||
                    null;
                if (envelopeId) {
                    setSessionEnvelopeId(envelopeId);
                    linkedEnvelopeIdRef.current = envelopeId;
                    draftPreparedAddendumIdRef.current = packageSelection.includeAddendum
                        ? addendumLayoutKey
                        : null;
                    draftPreparedCcRef.current = [...toSend];
                    draftPreparedPrefillFingerprintRef.current = prefillDraftFingerprint;
                    draftPreparedSignerRolesRef.current = signerFingerprintForSend;
                    draftPreparedOwnerCountRef.current = currentOwnerCount;
                    draftPreparedPackageFingerprintRef.current = sendPackageFingerprint;
                }

                if (!envelopeId) {
                    const msg =
                        "Could not create the DocuSign draft. Check signers and template configuration.";
                    toast.error(msg);
                    showDocuSignTabMessage(docuSignTab, "Could not open DocuSign", msg);
                    return;
                }

                const senderViewResult = await fetchDocuSignSenderViewUrlWithRetry(
                    envelopeId,
                    toSend,
                    true,
                );
                const senderUrl = senderViewResult.url;
                if (!senderUrl) {
                    const detail = String(senderViewResult.error ?? "").trim();
                    const isGenericAxios =
                        /^request failed with status code \d+$/i.test(detail);
                    const msg =
                        detail && !isGenericAxios
                            ? detail
                            : "Draft envelope was created but DocuSign did not return a review URL yet. Wait a few seconds and click Review & send again.";
                    toast.error(msg, { autoClose: 12000 });
                    showDocuSignTabMessage(
                        docuSignTab,
                        "Could not open DocuSign",
                        msg,
                    );
                    return;
                }

                pendingCcForSentRef.current = toSend;

                const opened = navigateDocuSignTab(docuSignTab, senderUrl);
                startDocuSignSenderReturnWatchRef.current?.();
                if (!opened) {
                    setDocuSignOpenUrl(senderUrl);
                    toast.info(
                        "Your browser blocked the DocuSign tab. Click Open DocuSign below (or allow pop-ups for this site).",
                        { autoClose: 12000 },
                    );
                    return;
                }

                setDocuSignOpenUrl(null);
                toast.success(
                    toSend.length
                        ? "DocuSign opened in a new tab. Click Send to email the signer. Status updates when you return to this tab."
                        : "DocuSign opened in a new tab. Click Send there to email signers. Status updates when you return to this tab.",
                    { autoClose: 12000 },
                );
            } else if (onSendToDocusign) {
                await onSendToDocusign(toSend);
            } else {
                toast.error("DocuSign is not configured for this contract.");
            }
        } catch (error) {
            console.error("Failed to open DocuSign draft:", error);
            showDocuSignTabMessage(
                docuSignTab,
                "Could not open DocuSign",
                "Something went wrong while preparing the draft. Close this tab and try again from the contract modal.",
            );
            toast.error("Failed to open DocuSign. Please try again.");
        } finally {
            setIsSending(false);
            docuSignSendInFlightRef.current = false;
        }
    }

    const handleReviewInDocuSignClick = (options?: { forceNewEnvelope?: boolean }) => {
        if (!fileUrl || isSending || docuSignSendInFlightRef.current) return;
        const forceNewEnvelope =
            options?.forceNewEnvelope === true || contractNeedsNewEnvelope;
        const packageIncludesMainContract =
            !canSendWithoutContract || includeMainContractInSendRef.current;
        if (forceNewEnvelope) {
            if (
                packageIncludesMainContract &&
                !canResendSignedContract &&
                !canSendMainContract(resolvedContract, sentAt)
            ) {
                toast.error("This contract cannot be sent yet.");
                return;
            }
        } else if (!canReviewAndSendCurrentPackage) {
            toast.error(
                packageIncludesMainContract
                    ? "This contract is already out for signature. Void it in DocuSign before sending again."
                    : "Cannot send this document package right now.",
            );
            return;
        }
        if (contractSignersValidationError) {
            toast.error(contractSignersValidationError);
            setShowRecipientEditor(true);
            return;
        }

        docuSignSendInFlightRef.current = true;
        const docuSignTab = onPrepareDocuSignDraft ? openDocuSignLoadingTab() : null;
        if (onPrepareDocuSignDraft && !docuSignTab) {
            toast.warning(
                "Allow pop-ups for this site so DocuSign can open in a new tab.",
                { autoClose: 8000 },
            );
        }
        void finishDocuSignReviewSend(docuSignTab, {
            forceNewEnvelope:
                options?.forceNewEnvelope === true || contractNeedsNewEnvelope,
        });
    };

    /**
     * Apply Claude KYC extraction (driver license / voided check) into contract prefill + info panels.
     */
    const applyKycExtractionToModalState = useCallback(
        (extraction: KycExtractionResult) => {
            if (!extraction || extraction.error) {
                if (extraction?.error) {
                    toast.warn(`Document scan: ${extraction.error}`);
                }
                return;
            }

            setContractPrefillFromDb((prev) =>
                mergeKycExtractionIntoPrefill(prev, extraction),
            );

            if (extraction.mergedContractPrefillOverrides) {
                setResolvedContract((prev) =>
                    prev
                        ? {
                              ...prev,
                              contractPrefillOverrides: extraction.mergedContractPrefillOverrides,
                          }
                        : prev,
                );
            } else if (extraction.contractPrefill) {
                setResolvedContract((prev) => {
                    if (!prev) return prev;
                    const existing =
                        typeof prev.contractPrefillOverrides === "object" &&
                        prev.contractPrefillOverrides != null &&
                        !Array.isArray(prev.contractPrefillOverrides)
                            ? { ...(prev.contractPrefillOverrides as Record<string, unknown>) }
                            : {};
                    return {
                        ...prev,
                        contractPrefillOverrides: {
                            ...existing,
                            ...extraction.contractPrefill,
                        },
                    };
                });
            }

            if (extraction.panels?.owner) {
                setOwnerEntries((entries) =>
                    applyKycPanelsToOwnerEntries(entries, extraction.panels?.owner),
                );
            }
            if (extraction.panels?.guarantor) {
                setGuarantorEntries((entries) =>
                    applyKycPanelsToGuarantorEntries(entries, extraction.panels?.guarantor),
                );
            }
            if (extraction.panels?.ach) {
                setAchEntries((entries) =>
                    applyKycPanelsToAchEntries(entries, extraction.panels?.ach),
                );
            }

            invalidateDocuSignDraftSession();

            const hasFields =
                extraction.contractPrefill &&
                Object.keys(extraction.contractPrefill).some((k) =>
                    String(extraction.contractPrefill?.[k] ?? "").trim(),
                );
            if (!hasFields) {
                toast.warn(
                    `${extraction.documentType === "voidedCheck" ? "Voided check" : "Document"} uploaded, but no readable fields were found.`,
                );
                return;
            }

            const label =
                extraction.documentType === "driverLicense"
                    ? "Driver's license"
                    : extraction.documentType === "voidedCheck"
                      ? "Voided check"
                      : "Document";
            toast.success(`${label} scanned — contract fields updated.`);
        },
        [invalidateDocuSignDraftSession],
    );

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
                for (const extraction of kycExtractions) {
                    applyKycExtractionToModalState(extraction);
                }

                const voidedCheckApplied = kycExtractions.some(
                    (e) =>
                        e.documentType === "voidedCheck" &&
                        !e.error &&
                        e.contractPrefill &&
                        Object.keys(e.contractPrefill).length > 0,
                );
                const driverLicenseApplied = kycExtractions.some(
                    (e) =>
                        e.documentType === "driverLicense" &&
                        !e.error &&
                        e.contractPrefill &&
                        Object.keys(e.contractPrefill).length > 0,
                );
                if (
                    effectiveContractId != null &&
                    (voidedCheckApplied || driverLicenseApplied)
                ) {
                    const refreshTasks: Promise<unknown>[] = [];
                    if (voidedCheckApplied) {
                        refreshTasks.push(
                            dispatch(getAllACH({ contractId: effectiveContractId })).unwrap(),
                        );
                    }
                    if (driverLicenseApplied) {
                        refreshTasks.push(
                            dispatch(
                                getAllContractOwners({ contractId: effectiveContractId }),
                            ).unwrap(),
                            dispatch(
                                getAllContractGuarantors({ contractId: effectiveContractId }),
                            ).unwrap(),
                        );
                    }
                    const refreshed = await dispatch(
                        getByIdContract(effectiveContractId),
                    ).unwrap();
                    await Promise.all(refreshTasks);
                    const contractData =
                        (refreshed as { data?: unknown })?.data ?? refreshed;
                    if (contractData) {
                        setResolvedContract(contractData);
                        setContractPrefillFromDb(
                            stripDocumentTemplateBlobFromPrefillOverrides(
                                (contractData as { contractPrefillOverrides?: unknown })
                                    .contractPrefillOverrides,
                            ),
                        );
                    }
                }

                setUploadProgressByKey((prev) => ({ ...prev, [key]: 100 }));
                await dispatch(getUploadedContractDocuments(effectiveContractId));

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
                const docLookupId = businessApplicationId ?? applicationIdForLookup;
                if (docLookupId != null) {
                    void dispatch(getDocumentRequestsByApplication(docLookupId));
                }
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
        [dispatch, effectiveContractId, applyKycExtractionToModalState, businessApplicationId, applicationIdForLookup],
    );

    const revokeInlinePreviewBlob = useCallback(() => {
        if (inlinePreviewBlobUrlRef.current) {
            URL.revokeObjectURL(inlinePreviewBlobUrlRef.current);
            inlinePreviewBlobUrlRef.current = null;
        }
    }, []);

    const previewDocumentInPane = useCallback(
        async (remoteUrl: string, fileName = "document") => {
            const url = remoteUrl.trim();
            if (!url) return;
            try {
                setLoadingInlinePreview(true);
                let previewUrl = url;
                if (isCloudinaryAssetUrl(url)) {
                    const res = await axiosGet("/uploads/inline-preview", {
                        params: { url, name: fileName },
                        responseType: "blob",
                    });
                    const rawBlob = res.data as Blob;
                    const headerCt =
                        typeof res.headers["content-type"] === "string"
                            ? res.headers["content-type"].split(";")[0]?.trim()
                            : "";
                    const blob = new Blob([rawBlob], {
                        type: headerCt || "application/pdf",
                    });
                    revokeInlinePreviewBlob();
                    previewUrl = URL.createObjectURL(blob);
                    inlinePreviewBlobUrlRef.current = previewUrl;
                } else {
                    revokeInlinePreviewBlob();
                }
                setActivePreview(null);
                setUploadedPreviewUrl(previewUrl);
                setPdfRightPaneTab("template");
            } catch (error: any) {
                const msg =
                    error?.message || "Failed to load document preview.";
                setDocumentUploadMessage(msg);
                toast.error(msg);
            } finally {
                setLoadingInlinePreview(false);
            }
        },
        [revokeInlinePreviewBlob],
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
            const name = String(file?.fileName || file?.originalName || "Document").trim();
            await previewDocumentInPane(url, name);
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
        } catch (error: any) {
            setDocumentUploadMessage(
                error?.message || "Failed to delete uploaded document.",
            );
        } finally {
            setDeletingUploadedFileId(null);
        }
    };

    const fetchTemplateMappings = useCallback(async (options?: { silent?: boolean }) => {
        if (effectiveContractId == null) {
            setTemplateMappings([]);
            return;
        }
        const silent = options?.silent === true;
        try {
            if (!silent) setLoadingTemplateMappings(true);
            const res = await axiosGet(`/contract/${effectiveContractId}/document-template-mappings`);
            const rows = (res?.data?.data ?? []) as ContractDocumentTemplateMappingRow[];
            setTemplateMappings(Array.isArray(rows) ? rows : []);
        } catch (error: any) {
            setTemplateMappings([]);
            setDocumentUploadMessage(error?.message || "Failed to load template mappings.");
        } finally {
            if (!silent) setLoadingTemplateMappings(false);
        }
    }, [effectiveContractId]);

    const linkedAddendumPrefillEditRow = useMemo((): TemplateMappingPrefillEditRow | null => {
        if (!linkedAddendumMapping) return null;
        return {
            id: String(linkedAddendumMapping.id),
            contractId: Number(linkedAddendumMapping.contractId),
            templateId: String(
                linkedAddendumMapping.template?.templateId ??
                    linkedAddendumMapping.templateId ??
                    "",
            ),
            documentType: String(linkedAddendumMapping.documentType ?? "addendum"),
            template: linkedAddendumMapping.template ?? null,
        };
    }, [linkedAddendumMapping]);

    const linkedAddendumSupportsPrefillEdit = useMemo(
        () =>
            hasAddendumPrefillFieldMap(
                linkedAddendumMapping?.template?.templateId ??
                    linkedAddendumMapping?.templateId ??
                    null,
                linkedAddendumMapping?.template?.name ?? null,
                linkedAddendumMapping?.template?.layoutKey ?? null,
            ),
        [linkedAddendumMapping],
    );

    const lastDocuSignSyncAtRef = useRef(0);
    const contractWasSentRef = useRef(false);
    const prevContractStatusRef = useRef("");
    const pendingCcForSentRef = useRef<string[]>([]);
    const loadPrefilledPdfRef = useRef(loadPrefilledPdfFromDocuSign);
    loadPrefilledPdfRef.current = loadPrefilledPdfFromDocuSign;
    const setPdfRightPaneTabRef = useRef(setPdfRightPaneTab);
    setPdfRightPaneTabRef.current = setPdfRightPaneTab;
    const DOCUSIGN_SYNC_MIN_INTERVAL_MS = DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS;
    const DOCUSIGN_SYNC_SENT_STEP_INTERVAL_MS = DOCUSIGN_STATUS_SYNC_MIN_INTERVAL_MS;
    const contractModalWasOpenRef = useRef(false);
    const activeStepRef = useRef(activeStep);
    activeStepRef.current = activeStep;
    const sentAtRef = useRef(sentAt);
    sentAtRef.current = sentAt;

    /** Refresh contract row from CRM; optional DocuSign sync (throttled, sent contracts only). */
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
                    const res = await dispatch(getByApplicationIdContract(appId)).unwrap();
                    contract = (res as { data?: unknown })?.data ?? res;
                } else if (Number.isFinite(propId)) {
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
                    setSelectedState(pickUsStateForSelect(c.state));
                    const rawFunder = String(c.funderName ?? "").trim();
                    setSelectedFunder(pickFunderForSelect(rawFunder, DEFAULT_FUNDER_OPTIONS) || rawFunder);
                    setContractPrefillFromDb((prev) => {
                        const fromServer = stripDocumentTemplateBlobFromPrefillOverrides(
                            c.contractPrefillOverrides,
                        );
                        if (!fromServer) return prev ?? null;
                        if (!prev || Object.keys(prev).length === 0) return fromServer;
                        return mergeContractPrefillOverrideLayers(fromServer, prev);
                    });
                    setDocumentTemplatePrefillByMappingId((prev) => {
                        const fromServer = parseDocumentTemplatePrefillByMappingId(
                            c.contractPrefillOverrides,
                        );
                        if (!prev || Object.keys(prev).length === 0) return fromServer;
                        return { ...fromServer, ...prev };
                    });
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
                const alreadySent = isContractAlreadySent(c, sentAtRef.current);
                const onSentStep = activeStepRef.current === "sent";
                const wantsSync = options?.syncDocuSign === true;
                const signingFinished = isContractSigningFinished(c);
                const maySyncDocuSign =
                    wantsSync &&
                    Boolean(envelopeForSync || appId) &&
                    !signingFinished &&
                    (options?.forceDocuSignSync === true ||
                        (alreadySent && onSentStep) ||
                        (!alreadySent && Boolean(envelopeForSync)));

                if (maySyncDocuSign) {
                    const now = Date.now();
                    const syncMinInterval = onSentStep
                        ? DOCUSIGN_SYNC_SENT_STEP_INTERVAL_MS
                        : DOCUSIGN_SYNC_MIN_INTERVAL_MS;
                    if (
                        options?.forceDocuSignSync ||
                        now - lastDocuSignSyncAtRef.current >= syncMinInterval
                    ) {
                        lastDocuSignSyncAtRef.current = now;
                        try {
                            const ccForSync = pendingCcForSentRef.current.length
                                ? pendingCcForSentRef.current
                                : ccEmailsRef.current;
                            const syncRes = await syncDocuSignEnvelopeStatus(
                                envelopeForSync || "",
                                {
                                    applicationId: appId ?? undefined,
                                    contractId: Number.isFinite(Number(c.id))
                                        ? Number(c.id)
                                        : contractId,
                                    force: options?.forceDocuSignSync === true,
                                    silent: Boolean(silent),
                                    envelopeLabel: "contract",
                                    ccEmails: ccForSync.length ? ccForSync : undefined,
                                },
                            );
                            if (syncRes.rateLimited) {
                                if (!silent) {
                                    setDocuSignSyncError(
                                        "DocuSign polling limit reached for contract. Wait a few minutes or rely on webhook updates.",
                                    );
                                }
                            } else {
                                setDocuSignSyncError(null);
                            }
                            const syncData = syncRes.data as {
                                ccPrefilledEmail?: {
                                    emailed?: string[];
                                    skippedReason?: string;
                                };
                                docusignStatus?: string;
                            } | null;
                            const emailed = syncData?.ccPrefilledEmail?.emailed;
                            if (emailed?.length && !silent) {
                                toast.success(
                                    `CC copy emailed to: ${emailed.join(", ")}`,
                                );
                            } else if (
                                ccForSync.length &&
                                !silent &&
                                String(syncData?.docusignStatus ?? "").toLowerCase() === "sent"
                            ) {
                                const reason = syncData?.ccPrefilledEmail?.skippedReason;
                                if (reason === "smtp_not_configured") {
                                    toast.warning(
                                        "Contract sent in DocuSign, but CC email was not sent. Configure SENDGRID_API_KEY or SMTP on the server.",
                                        { autoClose: 10000 },
                                    );
                                }
                            }
                            c = (await fetchContractRow()) ?? c;
                        } catch (syncErr) {
                            const msg =
                                syncErr instanceof Error
                                    ? syncErr.message
                                    : "Could not refresh contract status from DocuSign.";
                            setDocuSignSyncError(msg);
                            if (!silent) {
                                console.warn("[DocuSign] sync-envelope-status failed:", syncErr);
                            }
                        }
                    }
                }

                const nowSent = isContractAlreadySent(
                    c,
                    sentAtRef.current,
                    sentStepUnlockedRef.current,
                );
                const statusUpper = String(c.status ?? "").trim().toUpperCase();
                const prevStatus = prevContractStatusRef.current;

                if (nowSent && !contractWasSentRef.current) {
                    contractWasSentRef.current = true;
                    sentStepUnlockedRef.current = true;
                    setSentStepUnlocked(true);
                    const resolvedId = Number(c.id);
                    persistSentStepUnlocked(
                        sentStepStorageKey(
                            Number.isFinite(resolvedId) ? resolvedId : null,
                            appId,
                        ),
                    );
                    setSentAt(new Date());
                    const cc = pendingCcForSentRef.current.length
                        ? pendingCcForSentRef.current
                        : ccEmailsRef.current;
                    if (cc.length) setSentCcEmails(cc);
                    if (activeStepRef.current !== "sent") {
                        setActiveStep("sent");
                        didSuggestSentTabThisOpenRef.current = true;
                    }
                    setPdfRightPaneTabRef.current("docusign");
                    prefilledPdfCachedForEnvelopeRef.current = null;
                    prefilledBoldSignPdfUrlRef.current = null;
                    void loadPrefilledPdfRef.current(undefined, { maxAttempts: 3 });
                    if (!silent) {
                        toast.success(
                            "Contract sent in DocuSign. Step 4 shows signing status and the envelope PDF.",
                        );
                    }
                }

                if (
                    statusUpper === "COMPLETED" &&
                    prevStatus !== "COMPLETED" &&
                    activeStepRef.current === "sent"
                ) {
                    prefilledPdfCachedForEnvelopeRef.current = null;
                    prefilledBoldSignPdfUrlRef.current = null;
                    void loadPrefilledPdfRef.current(undefined, { maxAttempts: 3 });
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
        [applicationIdForLookup, contractId, dispatch],
    );

    const startDocuSignSenderReturnWatch = useCallback(() => {
        docusignSenderReturnWatchCleanupRef.current?.();
        docusignSenderReturnWatchCleanupRef.current = watchDocuSignSenderReturn({
            onReturn: () =>
                refreshContractSigningState(true, {
                    syncDocuSign: true,
                    forceDocuSignSync: true,
                }),
            shouldStop: () =>
                isContractSigningFinished(resolvedContractRef.current) ||
                isContractAlreadySent(
                    resolvedContractRef.current,
                    sentAtRef.current,
                    sentStepUnlockedRef.current,
                ),
        });
    }, [refreshContractSigningState]);

    startDocuSignSenderReturnWatchRef.current = startDocuSignSenderReturnWatch;

    /** Once per modal open — not on every contract row refresh (avoids sync-envelope-status storms). */
    useEffect(() => {
        if (!isOpen) {
            contractModalWasOpenRef.current = false;
            contractWasSentRef.current = false;
            prevContractStatusRef.current = "";
            pendingCcForSentRef.current = [];
            docusignSenderReturnWatchCleanupRef.current?.();
            docusignSenderReturnWatchCleanupRef.current = null;
            if (!sentStepUnlockedRef.current) {
                setSentAt(null);
            }
            return;
        }
        const persisted = readPersistedSentStepUnlocked(sentStepPersistKey);
        if (persisted) {
            sentStepUnlockedRef.current = true;
            setSentStepUnlocked(true);
            if (!sentAt) setSentAt(new Date());
        }
        if (contractModalWasOpenRef.current) return;
        contractModalWasOpenRef.current = true;
        const alreadySent = isContractAlreadySent(
            resolvedContract,
            sentAt,
            sentStepUnlockedRef.current,
        );
        contractWasSentRef.current = alreadySent;
        if (alreadySent) {
            sentStepUnlockedRef.current = true;
            setSentStepUnlocked(true);
            persistSentStepUnlocked(sentStepPersistKey);
        }
        prevContractStatusRef.current = String(resolvedContract?.status ?? "")
            .trim()
            .toUpperCase();
        void refreshContractSigningState(true, { syncDocuSign: true, forceDocuSignSync: true });
    }, [isOpen, refreshContractSigningState, resolvedContract, sentAt, sentStepPersistKey]);

    const invalidateDocuSignPdfCache = useCallback(() => {
        prefilledPdfCachedForEnvelopeRef.current = null;
        prefilledBoldSignPdfUrlRef.current = null;
    }, []);

    const buildDocuSignPrefillFieldsPayload = useCallback((): Array<{ id: string; value: string }> => {
        const base = dealReviewFields
            .map((f) => ({
                id: f.id,
                value: String(f.value ?? "").trim(),
            }))
            .filter((f) => f.id && f.value);

        const addendumLayoutKey = resolveAddendumLayoutKeyForDocuSignMerge();
        const disclosureRef = resolveDisclosureTemplateRefForDocuSignMerge();
        const packageSelection = getEffectiveSendPackage();
        const mergedLayoutKeys =
            packageSelection.includeAddendum && addendumLayoutKey ? [addendumLayoutKey] : [];
        const mergedTemplateIds =
            packageSelection.includeDisclosure && disclosureRef ? [disclosureRef] : [];

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
            mergedTemplateIds,
            mergedLayoutKeys,
            templateMappingRows: templateMappings,
            contractPrefillOverridesRaw,
            contract: resolvedContract as Record<string, unknown> | null,
            application: applicationData as unknown as Record<string, unknown> | null,
            offerDecision: (offerDecisionData as Record<string, unknown> | null) ?? null,
            agreementDate: formatDate(new Date()),
            mainPrefillOverrides: mainPrefillForTemplates,
            bankDetail: contractPrefillRecords.bankDetail ?? null,
        });

        const mappingId = linkedDisclosureMapping?.id;
        const savedOverrides =
            mappingId != null ? documentTemplatePrefillByMappingId[mappingId] ?? null : null;

        const disclosureFields = packageSelection.includeDisclosure
            ? buildExpandedDisclosurePrefillFieldsForMapping({
                  mappingRow: linkedDisclosureMapping,
                  savedOverridesForMapping: savedOverrides,
                  contract: resolvedContract as Record<string, unknown> | null,
                  application: applicationData as unknown as Record<string, unknown> | null,
                  offerDecision:
                      (offerDecisionData as Record<string, unknown> | null) ?? null,
                  agreementDate: formatDate(new Date()),
              })
            : [];

        return clearParty2PrefillFieldPayload(
            mergeExpandedDisclosurePrefillIntoPayload(payload, disclosureFields),
            activeOwnerCount,
        );
    }, [
        dealReviewFields,
        activeOwnerCount,
        getEffectiveSendPackage,
        includeMainContractInSend,
        resolveAddendumLayoutKeyForDocuSignMerge,
        resolveDisclosureTemplateRefForDocuSignMerge,
        contractPrefillOverrides,
        contractPrefillLoaded,
        contractPrefillFromDb,
        resolvedContract,
        documentTemplatePrefillByMappingId,
        templateMappings,
        applicationData,
        contractPrefillRecords.bankDetail,
        linkedDisclosureMapping,
        offerDecisionData,
    ]);

    const syncPrefillToDraftEnvelope = useCallback(async () => {
        const envelopeId = resolveDraftEnvelopeIdForSync(
            resolvedContract,
            sentAt,
            sessionEnvelopeId,
        );
        if (!envelopeId) return;
        const fields = buildDocuSignPrefillFieldsPayload();
        if (!fields.length) return;
        try {
            await axiosPatch("/docusign/prefill-fields", {
                documentId: envelopeId,
                fields,
            });
            invalidateDocuSignPdfCache();
            void loadPrefilledPdfFromDocuSign(envelopeId, { manageLoading: false });
        } catch (err) {
            console.warn("[DocuSign] prefill sync to draft envelope failed:", err);
        }
    }, [
        buildDocuSignPrefillFieldsPayload,
        resolvedContract,
        sentAt,
        sessionEnvelopeId,
        invalidateDocuSignPdfCache,
        loadPrefilledPdfFromDocuSign,
    ]);

    const reloadContractPrefillAfterAddendumSave = useCallback(async () => {
        const appId = applicationIdForLookup;
        if (!appId) return;
        try {
            const res = await dispatch(getByApplicationIdContract(appId)).unwrap();
            const contract = (res as { data?: unknown })?.data ?? res;
            const c =
                contract && typeof contract === "object"
                    ? (contract as Record<string, unknown>)
                    : null;
            if (!c) return;
            setResolvedContract(c);
            const main = stripDocumentTemplateBlobFromPrefillOverrides(c.contractPrefillOverrides);
            const mappingBlob = parseDocumentTemplatePrefillByMappingId(c.contractPrefillOverrides);
            setContractPrefillFromDb(main);
            setDocumentTemplatePrefillByMappingId(mappingBlob);
            draftPreparedPrefillFingerprintRef.current = docuSignPrefillDraftFingerprint({
                contractPrefillOverrides: main,
                documentTemplatePrefillByMappingId: mappingBlob,
            });
            queueMicrotask(() => {
                void syncPrefillToDraftEnvelope();
            });
        } catch {
            /* ignore */
        }
    }, [applicationIdForLookup, dispatch, syncPrefillToDraftEnvelope]);

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

            const contractPrefillOverrides: Record<string, unknown> = {
                ...existingOverrides,
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: priorBlob,
                estimatedAnnualPercentageRate: String(args.metrics.estimatedAnnualPercentageRate),
            };

            setSavingDisclosureCalculation(true);
            try {
                const result = await dispatch(
                    updateContract({
                        id: cid,
                        data: { contractPrefillOverrides },
                    }),
                ).unwrap();
                const payload = (result as { data?: unknown })?.data ?? result;
                const fullSaved =
                    (payload as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides ?? contractPrefillOverrides;
                setDocumentTemplatePrefillByMappingId(
                    parseDocumentTemplatePrefillByMappingId(fullSaved),
                );
                setResolvedContract((prev) =>
                    prev ? { ...prev, contractPrefillOverrides: fullSaved ?? null } : prev,
                );
                draftPreparedPrefillFingerprintRef.current = docuSignPrefillDraftFingerprint({
                    contractPrefillOverrides:
                        stripDocumentTemplateBlobFromPrefillOverrides(fullSaved) ?? null,
                    documentTemplatePrefillByMappingId:
                        parseDocumentTemplatePrefillByMappingId(fullSaved),
                });
                queueMicrotask(() => {
                    void syncPrefillToDraftEnvelope();
                });
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
            syncPrefillToDraftEnvelope,
        ],
    );

    const handleCancelContract = useCallback(async () => {
        const envelopeId = String(linkedEnvelopeId || "").trim();
        if (!envelopeId || isCancellingContract) return;
        const confirmed = window.confirm(
            "Void this contract in DocuSign? Signers will no longer be able to sign. You can send a new contract afterward.",
        );
        if (!confirmed) return;

        setIsCancellingContract(true);
        try {
            await dispatch(
                voidBoldSignDocument({
                    documentId: envelopeId,
                    reason: "Cancelled by user from CRM",
                }),
            ).unwrap();

            invalidateDocuSignDraftSession();
            setDocuSignOpenUrl(null);
            setSentAt(null);
            sentStepUnlockedRef.current = false;
            setSentStepUnlocked(false);
            if (sentStepPersistKey && typeof window !== "undefined") {
                try {
                    sessionStorage.removeItem(sentStepPersistKey);
                } catch {
                    /* ignore */
                }
            }
            contractWasSentRef.current = false;
            pendingCcForSentRef.current = [];
            invalidateDocuSignPdfCache();
            setPrefilledBoldSignPdfUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return null;
            });
            setPrefilledBoldSignPdfHint(null);

            await refreshContractSigningState(false, {
                syncDocuSign: true,
                forceDocuSignSync: true,
            });

            if (activeStepRef.current === "sent") {
                setActiveStep("summary");
            }

            toast.success(
                "Contract voided in DocuSign. Use Review & send when you are ready to send again.",
            );
        } catch (err: unknown) {
            const msg =
                typeof err === "string"
                    ? err
                    : String((err as { message?: string })?.message || "Failed to void contract.");
            toast.error(msg);
        } finally {
            setIsCancellingContract(false);
        }
    }, [
        linkedEnvelopeId,
        isCancellingContract,
        dispatch,
        invalidateDocuSignDraftSession,
        invalidateDocuSignPdfCache,
        refreshContractSigningState,
        sentStepPersistKey,
    ]);

    const forceReloadDocuSignPdfPreview = useCallback(() => {
        invalidateDocuSignPdfCache();
        if (pdfRightPaneTab !== "docusign") {
            return;
        }
        void loadPrefilledPdfFromDocuSign(undefined, { maxAttempts: 3 });
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
        if (!isContractAlreadySent(resolvedContract, sentAt, sentStepUnlocked)) return;
        if (didSuggestSentTabThisOpenRef.current) return;
        if (activeStep !== "documents") return;
        setActiveStep("sent");
        didSuggestSentTabThisOpenRef.current = true;
    }, [isOpen, activeStep, resolvedContract, sentAt, sentStepUnlocked]);

    useEffect(() => {
        if (!isOpen || !applicationIdForLookup) return;
        void dispatch(
            getDocumentRequestsByApplication(businessApplicationId ?? applicationIdForLookup),
        );
    }, [isOpen, applicationIdForLookup, businessApplicationId, dispatch]);

    /** Only one addendum DocuSign template is merged per send — replace any existing addendum mapping. */
    const setAddendumTemplateMapping = useCallback(
        async (templateRef: string | null) => {
            if (effectiveContractId == null) return;
            const ref = String(templateRef || "").trim();
            try {
                const res = await axiosGet(
                    `/contract/${effectiveContractId}/document-template-mappings`,
                );
                const rows = (res?.data?.data ?? []) as ContractDocumentTemplateMappingRow[];
                const addendumRows = rows.filter(isNonAchAddendumMappingRow);
                if (!ref) {
                    if (addendumRows.length === 0) {
                        setSelectedAddendumOption("");
                        return;
                    }
                } else if (
                    addendumRows.length === 1 &&
                    mappingMatchesTemplateRef(addendumRows[0], ref)
                ) {
                    setSelectedAddendumOption(`lk:${ref}`);
                    return;
                }
                await Promise.all(
                    addendumRows.map((row) =>
                        axiosDelete(
                            `/contract/${effectiveContractId}/document-template-mappings/${row.id}`,
                        ),
                    ),
                );
                if (ref) {
                    await axiosPost(`/contract/${effectiveContractId}/document-template-mappings`, {
                        documentType: "addendum",
                        templateRef: ref,
                    });
                    setSelectedAddendumOption(`lk:${ref}`);
                } else {
                    setSelectedAddendumOption("");
                }
                await fetchTemplateMappings({ silent: true });
            } catch (error: any) {
                setDocumentUploadMessage(
                    error?.message || "Failed to update addendum template.",
                );
            }
        },
        [effectiveContractId, fetchTemplateMappings],
    );

    const lookupDisclosureTemplateRef = useCallback(
        async (state: string, frequency: string): Promise<string | null> => {
            const normalizedFrequency = normalizeFrequencyForTemplateLookup(frequency);
            const params = new URLSearchParams({
                type: "disclosure",
                state: normalizeStateForTemplateLookup(state),
                frequency: normalizedFrequency,
            });
            const res = await axiosGet(`/contract/templates?${params.toString()}`);
            const rows = (res?.data?.data ?? []) as DisclosureTemplateLookupRow[];
            const match = Array.isArray(rows)
                ? pickDisclosureTemplateForFrequency(rows, normalizedFrequency)
                : undefined;
            return match?.id ? String(match.id) : null;
        },
        [],
    );

    /** One state disclosure per send — replace any existing disclosure mapping. */
    const setDisclosureTemplateMapping = useCallback(
        async (templateRef: string | null) => {
            if (effectiveContractId == null) return;
            const ref = String(templateRef || "").trim();
            try {
                const res = await axiosGet(
                    `/contract/${effectiveContractId}/document-template-mappings`,
                );
                const rows = (res?.data?.data ?? []) as ContractDocumentTemplateMappingRow[];
                const disclosureRows = rows.filter(isDisclosureMappingRow);
                if (!ref) {
                    if (disclosureRows.length === 0) return;
                } else if (
                    disclosureRows.length === 1 &&
                    mappingMatchesTemplateRef(disclosureRows[0], ref)
                ) {
                    return;
                }
                await Promise.all(
                    disclosureRows.map((row) =>
                        axiosDelete(
                            `/contract/${effectiveContractId}/document-template-mappings/${row.id}`,
                        ),
                    ),
                );
                if (ref) {
                    await axiosPost(`/contract/${effectiveContractId}/document-template-mappings`, {
                        documentType: "disclosure",
                        templateRef: ref,
                    });
                }
                await fetchTemplateMappings({ silent: true });
            } catch (error: any) {
                setDocumentUploadMessage(
                    error?.message || "Failed to update state disclosure template.",
                );
            }
        },
        [effectiveContractId, fetchTemplateMappings],
    );

    const syncDisclosureTemplateForState = useCallback(
        async (state: string, options?: { silent?: boolean }) => {
            const picked = pickUsStateForSelect(state);
            if (!picked) {
                if (linkedDisclosureMappingRef.current) {
                    await setDisclosureTemplateMapping(null);
                }
                return;
            }
            if (effectiveContractId == null) return;
            if (!contractDisclosureFrequency) return;
            try {
                setLinkingDisclosureTemplate(true);
                const templateRef = await lookupDisclosureTemplateRef(
                    picked,
                    contractDisclosureFrequency,
                );
                const current = linkedDisclosureMappingRef.current;
                const currentTemplateId = current ? mappingTemplateRowId(current) : "";
                const frequencyMatches =
                    current != null &&
                    disclosureMappingMatchesFrequency(current, contractDisclosureFrequency);
                if (!templateRef && !current) return;
                if (templateRef && currentTemplateId === templateRef && frequencyMatches) return;
                if (!templateRef) {
                    await setDisclosureTemplateMapping(null);
                    if (!options?.silent) {
                        toast.info(`No disclosure PDF configured for ${picked}.`);
                    }
                    return;
                }
                await setDisclosureTemplateMapping(templateRef);
            } catch (error: any) {
                setDocumentUploadMessage(
                    error?.message || "Failed to link state disclosure template.",
                );
            } finally {
                setLinkingDisclosureTemplate(false);
            }
        },
        [
            contractDisclosureFrequency,
            effectiveContractId,
            lookupDisclosureTemplateRef,
            setDisclosureTemplateMapping,
        ],
    );

    /** Link disclosure once when reopening a contract that already has a saved state. */
    useEffect(() => {
        if (!isOpen) {
            disclosureAutoLinkKeyRef.current = "";
            return;
        }
        if (effectiveContractId == null || loadingTemplateMappings) return;
        if (offerDecisionLoading || !contractDisclosureFrequency) return;
        const picked = pickUsStateForSelect(selectedState);
        if (!picked) return;
        if (
            linkedDisclosureMapping &&
            disclosureMappingMatchesState(linkedDisclosureMapping, picked) &&
            disclosureMappingMatchesFrequency(
                linkedDisclosureMapping,
                contractDisclosureFrequency,
            )
        ) {
            return;
        }
        const key = `${effectiveContractId}:${picked}:${contractDisclosureFrequency}`;
        if (disclosureAutoLinkKeyRef.current === key) return;
        disclosureAutoLinkKeyRef.current = key;
        void syncDisclosureTemplateForState(picked, { silent: true });
    }, [
        isOpen,
        effectiveContractId,
        loadingTemplateMappings,
        selectedState,
        contractDisclosureFrequency,
        linkedDisclosureMapping,
        syncDisclosureTemplateForState,
        offerDecisionLoading,
    ]);

    /** When deal frequency changes, invalidate cached auto-link and swap disclosure template. */
    useEffect(() => {
        if (!isOpen) {
            prevContractDisclosureFrequencyRef.current = "";
            return;
        }
        if (offerDecisionLoading || !contractDisclosureFrequency) return;
        const prev = prevContractDisclosureFrequencyRef.current;
        if (prev && prev !== contractDisclosureFrequency) {
            disclosureAutoLinkKeyRef.current = "";
            const picked = pickUsStateForSelect(selectedState);
            if (picked && effectiveContractId != null && !loadingTemplateMappings) {
                void syncDisclosureTemplateForState(picked, { silent: true });
            }
        }
        prevContractDisclosureFrequencyRef.current = contractDisclosureFrequency;
    }, [
        isOpen,
        offerDecisionLoading,
        contractDisclosureFrequency,
        selectedState,
        effectiveContractId,
        loadingTemplateMappings,
        syncDisclosureTemplateForState,
    ]);

    const handlePreviewBoldSignTemplate = useCallback(
        async (row: ContractDocumentTemplateMappingRow) => {
            const templateRef = String(
                row?.template?.layoutKey ||
                    row?.template?.templateId ||
                    row?.template?.id ||
                    row?.templateId ||
                    "",
            ).trim();
            const platformKey = isPlatformLayoutKey(templateRef) ? templateRef : null;
            const crmRowId = String(row?.template?.id ?? "").trim();
            const downloadRef = platformKey || crmRowId || templateRef;
            if (!downloadRef) {
                setDocumentUploadMessage("This mapping has no downloadable template.");
                return;
            }
            try {
                setPreviewingTemplateId(String(row.id));
                const response = await axiosGet(
                    `/docusign/template/${encodeURIComponent(downloadRef)}/download`,
                    { responseType: "blob" },
                );
                const blob =
                    response?.data instanceof Blob
                        ? response.data
                        : new Blob([response?.data], { type: "application/pdf" });
                if (templatePreviewBlobUrlRef.current) {
                    URL.revokeObjectURL(templatePreviewBlobUrlRef.current);
                }
                const url = URL.createObjectURL(blob);
                templatePreviewBlobUrlRef.current = url;
                setActivePreview(null);
                setUploadedPreviewUrl(url);
                if (String(row.documentType || "").toLowerCase() === "addendum" && platformKey) {
                    setSelectedAddendumOption(`lk:${platformKey}`);
                }
                const label =
                    row?.template?.name ||
                    (platformKey ? supplementalOptionLabel(platformKey) : null) ||
                    formatDisclosureTemplateLabel(row) ||
                    "Template";
                setDocumentUploadMessage(`Showing template: ${formatDropdownLabel(label)}`);
            } catch (error: any) {
                const apiMsg =
                    error?.response?.data?.message ||
                    error?.message ||
                    "Failed to load template PDF.";
                setDocumentUploadMessage(apiMsg);
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
            if (inlinePreviewBlobUrlRef.current) {
                URL.revokeObjectURL(inlinePreviewBlobUrlRef.current);
                inlinePreviewBlobUrlRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (isOpen) return;
        revokeInlinePreviewBlob();
        setUploadedPreviewUrl(null);
        setLoadingInlinePreview(false);
    }, [isOpen, revokeInlinePreviewBlob]);

    // Legacy contracts may have multiple addendum rows — keep one linked to the dropdown.
    const addendumExtrasCleanupKeyRef = useRef("");
    useEffect(() => {
        if (!isOpen || effectiveContractId == null || loadingTemplateMappings) return;
        if (addendumTemplateMappings.length <= 1) {
            addendumExtrasCleanupKeyRef.current = "";
            const row = linkedAddendumMapping;
            if (!row) {
                if (selectedAddendumOption.startsWith("lk:")) {
                    setSelectedAddendumOption("");
                }
                return;
            }
            const layoutKey = String(
                row?.template?.layoutKey || row?.template?.templateId || "",
            ).trim();
            if (!layoutKey) return;
            const next = `lk:${layoutKey}`;
            if (selectedAddendumOption !== next && !selectedAddendumOption.startsWith("up:")) {
                setSelectedAddendumOption(next);
            }
            return;
        }
        const primary = linkedAddendumMapping;
        const primaryRef = String(
            primary?.template?.layoutKey || primary?.template?.templateId || "",
        ).trim();
        const extras = addendumTemplateMappings.filter((row) => row.id !== primary?.id);
        const extraAch = achTemplateMappings.length > 1 ? achTemplateMappings.slice(1) : [];
        const cleanupKey = `${effectiveContractId}:${extras.map((r) => r.id).join(",")}:${extraAch.map((r) => r.id).join(",")}`;
        if (addendumExtrasCleanupKeyRef.current === cleanupKey) return;
        addendumExtrasCleanupKeyRef.current = cleanupKey;
        void (async () => {
            try {
                await Promise.all(
                    [...extras, ...extraAch].map((row) =>
                        axiosDelete(
                            `/contract/${effectiveContractId}/document-template-mappings/${row.id}`,
                        ),
                    ),
                );
                if (primaryRef) {
                    setSelectedAddendumOption(`lk:${primaryRef}`);
                }
                await fetchTemplateMappings({ silent: true });
            } catch {
                addendumExtrasCleanupKeyRef.current = "";
            }
        })();
    }, [
        isOpen,
        effectiveContractId,
        loadingTemplateMappings,
        addendumTemplateMappings,
        achTemplateMappings,
        linkedAddendumMapping,
        fetchTemplateMappings,
    ]);

    // Reset preview to contract when leaving Documents tab
    useEffect(() => {
        if (activeStep !== "documents") {
            setActivePreview(null);
            revokeInlinePreviewBlob();
            setUploadedPreviewUrl(null);
        }
    }, [activeStep, revokeInlinePreviewBlob]);

    useEffect(() => {
        if (!isOpen || effectiveContractId == null) return;
        dispatch(getUploadedContractDocuments(effectiveContractId));
    }, [effectiveContractId, dispatch, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        void fetchTemplateMappings();
    }, [isOpen, fetchTemplateMappings]);

    // Pre-fetch related records by contractId for Info/Summary panels
    useEffect(() => {
        if (!isOpen || (activeStep !== "info" && activeStep !== "summary") || effectiveContractId == null) return;
        const id = effectiveContractId;
        dispatch(getAllAddendum({ contractId: id }));
        dispatch(getAllACH({ contractId: id }));
        dispatch(getAllEPO({ contractId: id }));
        dispatch(getAllContractOwners({ contractId: id }));
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

    if (!isOpen || !effectiveContractPreviewUrl) return null;

    const currentPreviewUrl =
        (activeStep === "documents" || activeStep === "info" || activeStep === "summary") && uploadedPreviewUrl
            ? uploadedPreviewUrl
            : activeStep === "documents" && activePreview && documentUrls[activePreview]
                ? documentUrls[activePreview]
                : effectiveContractPreviewUrl;

    return (
        <>
            <Dialog open={isOpen} onOpenChange={onClose}>
                <DialogContent className="flex h-[min(94vh,calc(100dvh-1.5rem))] max-h-[min(94vh,calc(100dvh-1.5rem))] min-h-0 w-[1400px] max-w-[95vw] flex-col gap-0 overflow-hidden bg-white p-0 dark:bg-slate-900 dark:text-slate-100">

                    {/* 1. Header with Stepper & Title */}
                    <div className="flex shrink-0 flex-col border-b bg-white px-6 py-3 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-4">
                            <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                Create Contract — {effectiveContractPreviewName || fileName || "Double A Landscaping & Supply"}
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
                                const canOpenSentStep = isContractAlreadySent(
                                    resolvedContract,
                                    sentAt,
                                    sentStepUnlocked,
                                );

                                const circleDone = "w-5 h-5 shrink-0 rounded-full border-2 border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)] flex items-center justify-center text-[10px]";
                                const circleCurrent = "w-5 h-5 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-semibold";
                                const circlePending = "w-5 h-5 shrink-0 rounded-full border border-slate-300 text-slate-500 flex items-center justify-center text-[10px]";

                                return (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                didSuggestSentTabThisOpenRef.current = true;
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
                                            onClick={() => setActiveStep("info")}
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

                    {/* 2. Split Main Body — flex-1 consumes all space between header and footer (gap-0 on dialog) */}
                    <div className="flex min-h-0 flex-1 flex-row overflow-hidden">

                        {/* Left Column: Form Controls + floating step nav */}
                        <div className="relative flex min-h-0 w-[45%] min-w-0 flex-col overflow-hidden border-r bg-white dark:border-slate-700 dark:bg-slate-900">
                            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">

                                {/* Dynamic Section Heading */}
                                <section>
                                    {activeStep === "info" ? (
                                        <div className="mb-1 flex items-start gap-3 rounded-xl border border-[var(--brand)]/20 bg-gradient-to-r from-[var(--brand)]/8 via-white to-slate-50/90 px-4 py-3 shadow-sm dark:border-[var(--brand)]/25 dark:from-[var(--brand)]/15 dark:via-slate-900 dark:to-slate-900">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-white shadow-md shadow-[var(--brand)]/25">
                                                <ScrollText className="h-5 w-5" aria-hidden />
                                            </div>
                                            <div className="min-w-0 pt-0.5">
                                                <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                                                    Info Required
                                                </h2>
                                                <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-400">
                                                    Link DocuSign templates, set contract state and funder, then capture
                                                    addendum and ACH details for sending.
                                                </p>
                                            </div>
                                        </div>
                                    ) : activeStep === "sent" ? (
                                        <div className="mb-1 flex items-start gap-3 rounded-xl border border-[var(--brand)]/20 bg-gradient-to-r from-[var(--brand)]/8 via-white to-slate-50/90 px-4 py-3 shadow-sm dark:border-[var(--brand)]/25 dark:from-[var(--brand)]/15 dark:via-slate-900 dark:to-slate-900">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand)] text-white shadow-md shadow-[var(--brand)]/25">
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
                                    <section className="space-y-4">
                                        <div className="flex flex-wrap items-center gap-3">
                                            {canRequestDocumentsFromContract ? (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-9 shrink-0 gap-2 rounded-md border-[#CA8A03] bg-white px-4 text-[#CA8A03] shadow-sm hover:bg-amber-50 dark:border-amber-600 dark:bg-slate-900 dark:text-amber-400 dark:hover:bg-amber-950/30"
                                                    onClick={() => setRequestDocumentsModalOpen(true)}
                                                >
                                                    <Send className="h-4 w-4" aria-hidden />
                                                    Request documents
                                                </Button>
                                            ) : null}
                                            <p className="min-w-0 flex-1 text-right text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                                Drag &amp; drop or click — uploads start automatically.
                                            </p>
                                        </div>

                                        {canRequestDocumentsFromContract ? (
                                            <RequestedDocumentsPanel
                                                compact
                                                applicationLookupId={
                                                    businessApplicationId ?? applicationIdForLookup
                                                }
                                                applicationUuid={applicationUuidForUpload}
                                                businessApplicationId={businessApplicationId}
                                                contractId={effectiveContractId}
                                                onUploadContractDocument={async (contractUploadKey, file) => {
                                                    const key =
                                                        contractUploadKey === "voidedCheck"
                                                            ? "voidedCheck"
                                                            : "driverLicense";
                                                    await autoUploadDocumentFile(key, file);
                                                }}
                                                onViewDocument={(url, fileName) => {
                                                    void previewDocumentInPane(url, fileName);
                                                }}
                                            />
                                        ) : null}

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
                                        {documentUploadMessage && (
                                            <p className="pt-1 text-xs text-slate-600">{documentUploadMessage}</p>
                                        )}
                                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                                            <div className="mb-2 flex items-center justify-between">
                                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 ">
                                                    Source Application PDF
                                                </p>
                                            </div>
                                            <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2.5 py-2">
                                                <div className="min-w-0 pr-2">
                                                    <p className="truncate text-xs font-medium text-slate-800">
                                                        Application PDF
                                                    </p>
                                                    <p className="truncate text-[11px] text-slate-500">
                                                        {sourceApplicationPdf?.name || "Not found"}
                                                    </p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7 cursor-pointer"
                                                    title="View source application PDF"
                                                    disabled={!sourceApplicationPdf?.url}
                                                    onClick={() => {
                                                        if (!sourceApplicationPdf?.url) {
                                                            setDocumentUploadMessage("Application PDF is not available.");
                                                            return;
                                                        }
                                                        void previewDocumentInPane(
                                                            sourceApplicationPdf.url,
                                                            sourceApplicationPdf.name,
                                                        );
                                                    }}
                                                >
                                                    <Eye className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
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
                                        <div className="rounded-xl border border-[#276D9C]/20 bg-gradient-to-br from-[#276D9C]/5 to-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:from-slate-900 dark:to-slate-900 dark:ring-slate-700/80">
                                            <div className="mb-3 flex items-start gap-2.5">
                                                <div
                                                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#276D9C]/12 text-[#276D9C]"
                                                    aria-hidden
                                                >
                                                    <FileText className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[#276D9C] dark:text-[#5a9fd4]">
                                                        Send options
                                                    </h4>
                                                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                        {includeMainContractInSend
                                                            ? "Main contract is included. Selected addendum and linked state disclosure merge automatically."
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

                                        {/* Addendum document picker */}
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
                                                        <label className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[#5a9fd4]">
                                                            Addendum Document
                                                        </label>
                                                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            One addendum per send. Field placement comes from code layouts; PDF from Cloudinary (DB).
                                                        </p>
                                                    </div>
                                                </div>
                                                {selectedAddendumOption && (
                                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200/80 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-800/50">
                                                        <CheckCircle2 className="h-3 w-3" aria-hidden />
                                                        Selected
                                                    </span>
                                                )}
                                            </div>
                                            <select
                                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand)]/20 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                                                value={selectedAddendumOption}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setUploadedPreviewUrl(null);
                                                    if (value.startsWith("lk:")) {
                                                        const templateRef = value.slice(3).trim();
                                                        void setAddendumTemplateMapping(
                                                            templateRef || null,
                                                        );
                                                        return;
                                                    }
                                                    if (value.startsWith("up:")) {
                                                        setSelectedAddendumOption(value);
                                                        return;
                                                    }
                                                    void setAddendumTemplateMapping(null);
                                                }}
                                            >
                                                <option value="">Select addendum</option>
                                                {addendumTemplateOptions.map((option) => (
                                                    <option
                                                        key={`lk-${option.layoutKey}`}
                                                        value={`lk:${option.layoutKey}`}
                                                    >
                                                        {option.label}
                                                    </option>
                                                ))}
                                                {addendumDocs.length > 0 ? (
                                                    <optgroup label="Uploaded PDFs (preview only — not merged in DocuSign)">
                                                        {addendumDocs.map((file: any) => (
                                                            <option
                                                                key={`up-${String(file?.id || "")}`}
                                                                value={`up:${String(file?.id || "")}`}
                                                            >
                                                                {formatDropdownLabel(
                                                                    file?.fileName ||
                                                                    file?.documentType ||
                                                                    "Uploaded addendum",
                                                                ) || "Uploaded Addendum"}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                ) : null}
                                            </select>
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
                                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[#5a9fd4]">
                                                        Contract Meta
                                                    </h4>
                                                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                        Used for CRM reporting and contract metadata.
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                                <div className="space-y-1.5">
                                                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300" htmlFor="pdf-viewer-contract-state-info">
                                                        <MapPin className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />
                                                        Select State
                                                    </label>
                                                    <Select
                                                        value={selectedState || undefined}
                                                        disabled={savingContractMeta}
                                                        onValueChange={(v: string) => {
                                                            setSelectedState(v);
                                                            const picked = pickUsStateForSelect(v);
                                                            const currentFunder = findFunder(selectedFunder);
                                                            const funderInvalidForState =
                                                                Boolean(selectedFunder) &&
                                                                Boolean(currentFunder) &&
                                                                Boolean(pickUsStateForSelect(v)) &&
                                                                !funderAvailableForContractState(
                                                                    currentFunder!,
                                                                    pickUsStateForSelect(v),
                                                                );
                                                            if (funderInvalidForState) {
                                                                setSelectedFunder("");
                                                                if (effectiveContractId != null) {
                                                                    void persistContractStateAndFunder({
                                                                        state: v,
                                                                        funderName: "",
                                                                    });
                                                                }
                                                            }
                                                            if (
                                                                effectiveContractId != null &&
                                                                picked
                                                            ) {
                                                                disclosureAutoLinkKeyRef.current = `${effectiveContractId}:${picked}:${contractDisclosureFrequency}`;
                                                            } else {
                                                                disclosureAutoLinkKeyRef.current = "";
                                                            }
                                                            if (effectiveContractId == null) return;
                                                            void persistContractStateAndFunder({
                                                                state: v,
                                                            });
                                                            void syncDisclosureTemplateForState(v);
                                                        }}
                                                    >
                                                        <SelectTrigger
                                                            id="pdf-viewer-contract-state-info"
                                                            className="h-10 w-full rounded-md border border-[var(--brand)]/20 bg-background px-3 py-2 text-sm shadow-sm focus:ring-[var(--brand)]/25 disabled:opacity-60 dark:border-slate-600"
                                                        >
                                                            <SelectValue placeholder="Select state" />
                                                        </SelectTrigger>
                                                        <SelectContent position="popper" className="z-[10100] max-h-72">
                                                            {US_STATES.map((s) => (
                                                                <SelectItem key={s} value={s}>
                                                                    {s}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300" htmlFor="pdf-viewer-contract-funder-info">
                                                        <Building2 className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden />
                                                        Select Funder
                                                    </label>
                                                    <Select
                                                        value={selectedFunder || undefined}
                                                        disabled={savingContractMeta}
                                                        onValueChange={(v: string) => {
                                                            setSelectedFunder(v);
                                                            if (effectiveContractId != null) {
                                                                void persistContractStateAndFunder({ funderName: v });
                                                            }
                                                        }}
                                                    >
                                                        <SelectTrigger
                                                            id="pdf-viewer-contract-funder-info"
                                                            className="h-10 w-full rounded-md border border-[var(--brand)]/20 bg-background px-3 py-2 text-sm shadow-sm focus:ring-[var(--brand)]/25 disabled:opacity-60 dark:border-slate-600"
                                                        >
                                                            <SelectValue placeholder="Select funder" />
                                                        </SelectTrigger>
                                                        <SelectContent position="popper" className="z-[10100] max-h-72">
                                                            {funderSelectOptions.map((f) => (
                                                                <SelectItem key={f} value={f}>
                                                                    {f === "Katan II"
                                                                        ? "Katan 2"
                                                                        : f === "Katan III"
                                                                          ? "Katan 3"
                                                                          : f}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
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
                                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[#5a9fd4]">
                                                            State disclosure
                                                        </h4>
                                                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            Linked from the selected state and merged when available.
                                                        </p>
                                                    </div>
                                                </div>
                                                {linkingDisclosureTemplate ? (
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
                                                {linkingDisclosureTemplate ? (
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
                                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[#5a9fd4]">
                                                            Addendum
                                                        </h4>
                                                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            DocuSign addendum template merged when you send the contract.
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
                                                DocuSign templates
                                            </p>
                                            <div className="space-y-2">
                                                {linkedAddendumMapping ? (
                                                            <div
                                                                key={linkedAddendumMapping.id}
                                                                className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200/90 bg-gradient-to-r from-indigo-50/80 to-white px-2.5 py-2.5 shadow-sm transition-colors dark:border-slate-600 dark:from-indigo-950/25 dark:to-slate-900/80"
                                                            >
                                                                <div className="flex min-w-0 flex-1 items-center gap-2.5 pr-2">
                                                                    <div
                                                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm"
                                                                        aria-hidden
                                                                    >
                                                                        <FileText className="h-4 w-4" />
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                                            <span className="inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200">
                                                                                Addendum
                                                                            </span>
                                                                        </div>
                                                                        <p className="mt-1 truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                                                            {formatDropdownLabel(
                                                                                linkedAddendumMapping?.template?.name ||
                                                                                supplementalOptionLabel(
                                                                                    String(
                                                                                        linkedAddendumMapping?.template?.layoutKey ||
                                                                                            linkedAddendumMapping?.template?.templateId ||
                                                                                            "",
                                                                                    ),
                                                                                ) ||
                                                                                "Template",
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
                                                                        title="View template PDF"
                                                                        disabled={
                                                                            previewingTemplateId ===
                                                                            String(linkedAddendumMapping.id)
                                                                        }
                                                                        onClick={() =>
                                                                            void handlePreviewBoldSignTemplate(
                                                                                linkedAddendumMapping,
                                                                            )
                                                                        }
                                                                    >
                                                                        {previewingTemplateId ===
                                                                        String(linkedAddendumMapping.id) ? (
                                                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                        ) : (
                                                                            <Eye className="h-3.5 w-3.5" />
                                                                        )}
                                                                    </Button>
                                                                    {linkedAddendumSupportsPrefillEdit ? (
                                                                        <Button
                                                                            type="button"
                                                                            size="icon"
                                                                            variant="ghost"
                                                                            className="h-8 w-8 cursor-pointer text-slate-600 hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-950/40"
                                                                            title="Edit addendum prefill"
                                                                            onClick={() =>
                                                                                setAddendumPrefillEditOpen(true)
                                                                            }
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
                                                                        onClick={() =>
                                                                            void setAddendumTemplateMapping(null)
                                                                        }
                                                                    >
                                                                        <Trash2 className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                ) : (
                                                    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 py-6 text-center dark:border-slate-600 dark:bg-slate-800/30">
                                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand)]/10 text-[var(--brand)]">
                                                            <Layers className="h-5 w-5" aria-hidden />
                                                        </div>
                                                        <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                                                            No addendum template linked yet.
                                                        </p>
                                                        <p className="max-w-[240px] text-[10px] text-slate-500">
                                                            Pick an addendum template above to merge with the contract.
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
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[#5a9fd4]">
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
                                                                className="border-[var(--brand)]/60 data-[state=checked]:bg-[var(--brand)] data-[state=checked]:border-[var(--brand)]"
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
                                                    <Button type="button" className="h-8 cursor-pointer bg-[var(--brand)] px-6 text-xs text-white hover:bg-[var(--brand)]/90" onClick={saveActivePanel}>
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

                                {/* Summary: signers, Exhibit A, Deal Review (single section — avoids extra gap between blocks) */}
                                {activeStep === "summary" && (
                                    <section className="space-y-4">
                                        <div className="space-y-3">
                                            {/* Section Header */}
                                            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                                                <h3 className="text-sm font-bold text-slate-800 tracking-tight">Contract Signers</h3>
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                                        {summaryTemplateRoles.length} Total Recipients
                                                    </span>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 text-xs border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/5"
                                                        onClick={openRecipientEditorFromSummary}
                                                    >
                                                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                                                        Add signer
                                                    </Button>
                                                </div>
                                            </div>

                                            {contractSignersValidationError ? (
                                                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                                    {contractSignersValidationError}
                                                </p>
                                            ) : null}

                                            <div className="grid gap-3">
                                                {summaryTemplateRoles.map((r, index) => {
                                                    const roleRow = r as Record<string, unknown>;
                                                    const roleLabel = getTemplateRoleLabel(roleRow);
                                                    const mergedEmail = resolveSignerEmailForSummary(
                                                        roleLabel,
                                                        getTemplateRoleEmailFromRow(roleRow),
                                                        docuSignSignerEmail.email,
                                                        summaryRolesCarryOwnerEmails,
                                                    );
                                                    const signer = {
                                                        role: roleLabel || `Role-${index + 1}`,
                                                        name: getTemplateRoleNameFromRow(roleRow),
                                                        email: mergedEmail,
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
                                                                        {(
                                                                            !hasSavedSignerOverrides &&
                                                                            signer.role === "Client"
                                                                                ? (
                                                                                    ownerEntries
                                                                                        .map((entry) =>
                                                                                            `${String(entry.ownerFirstName || "").trim()} ${String(entry.ownerLastName || "").trim()}`.trim(),
                                                                                        )
                                                                                        .find(Boolean) ||
                                                                                    `${String((applicationData as any)?.client?.ownerFirstName || (applicationData as any)?.client?.owner?.firstName || "").trim()} ${String((applicationData as any)?.client?.ownerLastName || (applicationData as any)?.client?.owner?.lastName || "").trim()}`.trim() ||
                                                                                    signer.name
                                                                                )
                                                                                : signer.name
                                                                        ) || "Awaiting Name..."}
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
                                                                        openRecipientEditorFromSummary();
                                                                    }}
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {summaryTemplateRoles.length === 0 ? (
                                                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center">
                                                    <p className="text-xs text-slate-600">
                                                        No contract signers yet. Add a recipient with a role and email
                                                        before reviewing in DocuSign.
                                                    </p>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 text-xs border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/5"
                                                        onClick={openRecipientEditorFromSummary}
                                                    >
                                                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                                                        Add Recipient
                                                    </Button>
                                                </div>
                                            ) : null}

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
                                            {/* ── Recipient Editor Panel ────────────────────────── */}
                                            {showRecipientEditor && (
                                                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4 shadow-sm">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                                                                Edit signers for this contract
                                                            </h4>
                                                            <p className="mt-1 text-[11px] leading-snug text-slate-500">
                                                                Updates apply to this send only. The DocuSign template is not
                                                                modified — all recipients use the Signer role.
                                                            </p>
                                                        </div>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 text-xs text-blue-600 gap-1"
                                                            onClick={() =>
                                                                setRecipientEditorRows((prev) => [
                                                                    ...prev,
                                                                    {
                                                                        id: String(Date.now()),
                                                                        role: DOCUSIGN_DEFAULT_SIGNER_ROLE,
                                                                        name: "",
                                                                        email: "",
                                                                    },
                                                                ])
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
                                                                        placeholder="Signer"
                                                                        className="h-9 text-xs bg-slate-50"
                                                                        value={DOCUSIGN_DEFAULT_SIGNER_ROLE}
                                                                        readOnly
                                                                        disabled
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
                                                            className="h-8 text-xs bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white px-6"
                                                            disabled={
                                                                savingContractRecipients ||
                                                                recipientEditorRows.every((r) => !r.email.trim())
                                                            }
                                                            onClick={async () => {
                                                                const rows = dedupeContractSignerRows(
                                                                    recipientEditorRows
                                                                        .filter((r) => r.email.trim())
                                                                        .map((r) => ({
                                                                            role: resolveDocuSignSignerRole(),
                                                                            name: r.name.trim(),
                                                                            email: r.email.trim(),
                                                                        })),
                                                                );
                                                                const roles =
                                                                    buildDocuSignRolesFromEditorRows(rows);
                                                                if (!roles.length) {
                                                                    toast.error(
                                                                        "Enter an email for at least one signer.",
                                                                    );
                                                                    return;
                                                                }
                                                                const missingEmail = rows.some(
                                                                    (r) => !r.email,
                                                                );
                                                                if (missingEmail) {
                                                                    toast.error(
                                                                        "Every signer role needs an email address.",
                                                                    );
                                                                    return;
                                                                }
                                                                setSavingContractRecipients(true);
                                                                try {
                                                                    const appId =
                                                                        applicationIdForLookupRef.current;
                                                                    const fp =
                                                                        contractSignerOverridesFingerprint(
                                                                            rows,
                                                                        );
                                                                    const cid = effectiveContractId;
                                                                    if (cid != null) {
                                                                        const prefillBase =
                                                                            (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                                                                                ?.contractPrefillOverrides ??
                                                                            contractPrefillFromDb;
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
                                                                    }
                                                                    setContractSignerOverrides(rows);
                                                                    draftPreparedSignerRolesRef.current = fp;

                                                                    if (cid != null) {
                                                                        try {
                                                                            await syncContractSignerRowsToCrm({
                                                                                dispatch,
                                                                                contractId: cid,
                                                                                applicationData,
                                                                                signerRows: rows,
                                                                                existingContractOwners: contractOwnerRows,
                                                                            });
                                                                        } catch (syncOwnerErr: unknown) {
                                                                            console.error(syncOwnerErr);
                                                                            toast.warn(
                                                                                "Signers saved on the contract, but owner records could not be synced to CRM.",
                                                                            );
                                                                        }
                                                                    }

                                                                    const draftEnvelopeId =
                                                                        resolveDraftEnvelopeIdForSync(
                                                                            resolvedContract,
                                                                            sentAt,
                                                                            sessionEnvelopeIdRef.current,
                                                                        );
                                                                    if (draftEnvelopeId) {
                                                                        try {
                                                                            await axiosPost(
                                                                                "/docusign/sync-envelope-cc",
                                                                                {
                                                                                    envelopeId: draftEnvelopeId,
                                                                                    roles,
                                                                                    ccEmails: ccEmailsRef.current,
                                                                                    ...(appId
                                                                                        ? { applicationId: appId }
                                                                                        : {}),
                                                                                    signerEmail:
                                                                                        roles[0]?.signerEmail,
                                                                                    signerName:
                                                                                        roles[0]?.signerName,
                                                                                },
                                                                            );
                                                                            toast.success(
                                                                                "Signers updated on this DocuSign draft.",
                                                                            );
                                                                        } catch (syncErr: unknown) {
                                                                            invalidateDocuSignDraftSession();
                                                                            const syncMsg =
                                                                                await parseApiErrorMessageFromAxios(
                                                                                    syncErr,
                                                                                );
                                                                            toast.warning(
                                                                                syncMsg
                                                                                    ? `Signers saved in CRM. DocuSign draft could not be updated: ${syncMsg}`
                                                                                    : "Signers saved in CRM. Click Review & send to apply them on a new DocuSign draft.",
                                                                            );
                                                                        }
                                                                    } else {
                                                                        invalidateDocuSignDraftSession();
                                                                        toast.success(
                                                                            "Signers saved. They will be used when you Review & send.",
                                                                        );
                                                                    }
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

                                        <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                                        <ExhibitACompaniesSummarySection
                                            contractId={effectiveContractId}
                                            applicationUuid={applicationIdForLookup}
                                            canEdit={canEditContractPrefill}
                                            prefillOverridesReady={contractPrefillLoaded}
                                            persistedPrefillOverrides={
                                                contractPrefillLoaded ? contractPrefillFromDb : undefined
                                            }
                                            documentTemplatePrefillByMappingId={
                                                documentTemplatePrefillByMappingId
                                            }
                                            onPersistedPrefillChange={(next) => {
                                                setContractPrefillFromDb(next ?? null);
                                                draftPreparedPrefillFingerprintRef.current =
                                                    docuSignPrefillDraftFingerprint({
                                                        contractPrefillOverrides: next ?? null,
                                                        documentTemplatePrefillByMappingId,
                                                    });
                                                queueMicrotask(() => {
                                                    void syncPrefillToDraftEnvelope();
                                                });
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

                                        <div className="space-y-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                                                    Deal Review
                                                </h3>
                                                <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                                    CRM values for your DocuSign field labels. Use Edit prefill fields to
                                                    adjust contract and linked addendum values before Review &amp; send.
                                                </p>
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
                                                const renderFieldRow = (field: (typeof effectiveFields)[number]) => (
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
                                                );
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

                                        {canEditContractPrefill ? (
                                            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/90 pt-4 dark:border-slate-600">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 border-[var(--brand)]/30 bg-white hover:bg-[var(--brand)]/5 dark:bg-slate-950"
                                                    onClick={() => setContractPrefillEditOpen(true)}
                                                >
                                                    <ScrollText className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                                                    Edit prefill fields
                                                </Button>
                                            </div>
                                        ) : null}

                                        </div>

                                    </section>
                                )}

                                {activeStep === "sent" && (
                                    <section className="space-y-4">
                                        <div className="overflow-hidden rounded-2xl border border-[var(--brand)]/20 bg-white shadow-sm dark:border-[var(--brand)]/25 dark:bg-slate-950">
                                            <div className="bg-gradient-to-r from-[var(--brand)] to-[#1f83b4] px-5 py-5 text-white">
                                                <div className="flex items-start gap-3">
                                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
                                                        <CheckCircle2 className="h-7 w-7" aria-hidden />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-semibold uppercase tracking-wide text-white/80">
                                                            Sent successfully
                                                        </p>
                                                        <h3 className="mt-1 text-lg font-semibold tracking-tight">
                                                            {String(resolvedContract?.status ?? "").toUpperCase() ===
                                                            "COMPLETED"
                                                                ? "Contract fully signed"
                                                                : "Contract is on its way for signature"}
                                                        </h3>
                                                        <p className="mt-1 text-sm leading-relaxed text-white/85">
                                                            {String(resolvedContract?.status ?? "").toUpperCase() ===
                                                            "COMPLETED"
                                                                ? "All signers completed. The PDF on the right includes signatures."
                                                                : "The DocuSign envelope was sent. Use Refresh to check signing status from DocuSign."}
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
                                                        {fileName || "Contract PDF"}
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
                                                const status = String(resolvedContract?.status ?? "").trim().toUpperCase();
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
                                                                {formatContractSigningStatusLabel(resolvedContract?.status)}
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
                                                                                            ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-sm shadow-[var(--brand)]/25"
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
                                                                                        activeIndex > index ? "bg-[var(--brand)]" : "bg-slate-200 dark:bg-slate-700",
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
                                                            {docuSignSyncError ? (
                                                                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                                                                    {docuSignSyncError}
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
                                                    title={signingStatusRefreshing ? "Refreshing…" : "Refresh status"}
                                                    disabled={
                                                        signingStatusRefreshing ||
                                                        (!applicationIdForLookup && !Number.isFinite(Number(contractId)))
                                                    }
                                                    onClick={() => {
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


                                    </section>
                                )}
                                <div
                                    className="mt-2 flex items-center"
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
                                            className="ml-auto h-9 rounded-sm bg-[var(--brand)] px-4 text-sm text-white hover:bg-[var(--brand)]/90"
                                            onClick={goToNextStep}
                                        >
                                            Next
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Right column: full-height PDF viewer; switch template vs BoldSign prefilled */}
                        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2 bg-slate-700 p-3">
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
                            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded bg-white shadow-2xl">
                                {pdfRightPaneTab === "template" ? (
                                    loadingInlinePreview ? (
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white px-4 text-center text-xs text-slate-500">
                                            <Loader2 className="h-6 w-6 animate-spin text-[var(--brand)]" aria-hidden />
                                            <span>Loading document preview…</span>
                                        </div>
                                    ) : (
                                        <DirectPdfViewer
                                            key={currentPreviewUrl}
                                            fileUrl={currentPreviewUrl}
                                            errorMessage="Could not render this PDF. Please check that the PDF URL is reachable and allows browser access."
                                        />
                                    )
                                ) : prefilledBoldSignPdfLoading ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white px-4 text-center text-xs text-slate-500">
                                        <Loader2 className="h-6 w-6 animate-spin text-[var(--brand)]" aria-hidden />
                                        <span>Loading contract from DocuSign…</span>
                                    </div>
                                ) : prefilledBoldSignPdfUrl ? (
                                    <DirectPdfViewer fileUrl={prefilledBoldSignPdfUrl} />
                                ) : (
                                    <div className="absolute inset-0 flex min-h-[200px] items-center justify-center bg-white px-4 text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                        {prefilledBoldSignPdfHint
                                            ? prefilledBoldSignPdfHint
                                              : "DocuSign PDF appears on step 4 (Sent) after the envelope is sent."}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>

                    {/* 3. Global Footer — CC + send (shrink-0 + compact so PDF pane keeps maximum height) */}
                    <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--brand)]/10 bg-gradient-to-r from-slate-50/90 via-white to-[var(--brand)]/5 px-6 py-3 dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-[var(--brand)]/10 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
                        <div className="min-w-0 flex-1 space-y-2">
                            <p className="text-[11px] text-slate-600 dark:text-slate-300">
                                <span className="font-semibold text-[var(--brand)] dark:text-[#5a9fd4]">
                                    Must sign (DocuSign signer):
                                </span>{" "}
                                {docuSignSignerEmail.email ? (
                                    <>
                                        <span className="font-medium">{docuSignSignerEmail.email}</span>
                                        {docuSignSignerEmail.source === "template" ? (
                                            <span className="text-slate-500">
                                                {" "}
                                                (from DocuSign template — save client email on contract to
                                                persist in CRM)
                                            </span>
                                        ) : null}
                                    </>
                                ) : (
                                    <span className="text-amber-700 dark:text-amber-300">
                                        No signing email — set on application/contract or DocuSign template.
                                        CC list below is copy-only, not the signer.
                                    </span>
                                )}
                            </p>
                            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[#5a9fd4]">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand)]/12">
                                        <Mail className="h-3.5 w-3.5" aria-hidden />
                                    </span>
                                    CC (copy only — not a signer)
                                </span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {ccEmails.map((email) => {
                                    const isDefaultCc = isDefaultContractCcEmail(email);
                                    return (
                                    <span
                                        key={email}
                                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--brand)]/20 bg-[var(--brand)]/8 px-2.5 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:border-[var(--brand)]/30 dark:bg-[var(--brand)]/15 dark:text-slate-100"
                                    >
                                        <Mail className="h-3 w-3 shrink-0 text-[var(--brand)] opacity-80" aria-hidden />
                                        <span className="max-w-[220px] truncate" title={email}>
                                            {email}
                                        </span>
                                        {!isDefaultCc ? (
                                        <button
                                            type="button"
                                            className="shrink-0 rounded p-0.5 text-slate-500 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-red-400"
                                            aria-label={`Remove ${email}`}
                                            disabled={canCancelSentContract || isCancellingContract}
                                            onClick={() => {
                                                const next = mergeContractCcEmailList(
                                                    ccEmails.filter((e) => e !== email),
                                                );
                                                setCcEmails(next);
                                                saveBoldSignCcEmailList(next);
                                            }}
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                        ) : null}
                                    </span>
                                    );
                                })}
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
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2 border-t border-slate-100 pt-2 dark:border-slate-700 lg:border-t-0 lg:pt-0">
                            {docuSignOpenUrl && activeStep !== "sent" ? (
                                <p className="max-w-md text-right text-xs text-amber-800 dark:text-amber-200">
                                    Pop-up blocked. Click Open DocuSign to continue in a new tab.
                                </p>
                            ) : null}
                            <div className="flex items-center justify-end gap-2">
                            <Button variant="ghost" className="h-9" onClick={onClose}>
                                Close
                            </Button>
                            {canCancelSentContract ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={() => void handleCancelContract()}
                                    disabled={isCancellingContract || !linkedEnvelopeId}
                                >
                                    {isCancellingContract ? "Voiding contract…" : "Void Contract"}
                                </Button>
                            ) : null}
                            {activeStep === "sent" && !canCancelSentContract && !showResendContractButton ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={onClose}
                                >
                                    Done
                                </Button>
                            ) : null}
                            {showResendContractButton ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    disabled={
                                        isSending ||
                                        isCancellingContract ||
                                        Boolean(contractSignersValidationError)
                                    }
                                    onClick={() =>
                                        handleReviewInDocuSignClick({ forceNewEnvelope: true })
                                    }
                                >
                                    {isSending ? "Preparing DocuSign…" : "Resend contract"}
                                </Button>
                            ) : null}
                            {canReviewAndSendCurrentPackage && docuSignOpenUrl ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    disabled={Boolean(contractSignersValidationError)}
                                    onClick={() => {
                                        if (contractSignersValidationError) {
                                            toast.error(contractSignersValidationError);
                                            setShowRecipientEditor(true);
                                            return;
                                        }
                                        const url = docuSignOpenUrl;
                                        if (!url) return;
                                        if (navigateDocuSignTab(null, url)) {
                                            setDocuSignOpenUrl(null);
                                            startDocuSignSenderReturnWatchRef.current?.();
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
                                >
                                    Open DocuSign
                                </Button>
                            ) : null}
                            {canReviewAndSendCurrentPackage && !docuSignOpenUrl ? (
                                <Button
                                    type="button"
                                    variant="default"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={() => handleReviewInDocuSignClick()}
                                    disabled={
                                        isSending ||
                                        isCancellingContract ||
                                        Boolean(contractSignersValidationError)
                                    }
                                >
                                    {isSending
                                        ? "Preparing DocuSign…"
                                        : contractNeedsNewEnvelope &&
                                            (includeMainContractInSend || !canSendWithoutContract)
                                          ? "Send contract in DocuSign"
                                          : includeMainContractInSend || !canSendWithoutContract
                                            ? "Review & send in DocuSign"
                                            : "Review & send documents in DocuSign"}
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
                    draftPreparedPrefillFingerprintRef.current =
                        docuSignPrefillDraftFingerprint({
                            contractPrefillOverrides: main,
                            documentTemplatePrefillByMappingId,
                        });
                    queueMicrotask(() => {
                        void syncPrefillToDraftEnvelope();
                    });
                }}
                onPersistedPrefillFullChange={(full) => {
                    setDocumentTemplatePrefillByMappingId(parseDocumentTemplatePrefillByMappingId(full));
                    const main =
                        stripDocumentTemplateBlobFromPrefillOverrides(full) ?? null;
                    setContractPrefillFromDb(main);
                    setContractSignerOverrides(parseContractSignerOverridesFromPrefill(full));
                    setResolvedContract((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  ...(main ? contractPrefillToContractColumnUpdate(main) : {}),
                                  contractPrefillOverrides: full ?? null,
                              }
                            : prev,
                    );
                    draftPreparedPrefillFingerprintRef.current =
                        docuSignPrefillDraftFingerprint({
                            contractPrefillOverrides: main,
                            documentTemplatePrefillByMappingId:
                                parseDocumentTemplatePrefillByMappingId(full),
                        });
                    queueMicrotask(() => {
                        void syncPrefillToDraftEnvelope();
                    });
                }}
                contractRecords={contractPrefillRecords}
                agreementDatePlaceholder={formatDate(new Date())}
                offerDecision={(offerDecisionData as Record<string, unknown> | null) ?? null}
                readOnly={!canEditContractPrefill}
                additionalContractPrefillJson={{
                    [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: documentTemplatePrefillByMappingId,
                }}
                linkedAddendumMapping={linkedAddendumMapping}
                linkedDisclosureMapping={linkedDisclosureMapping}
                contractDisclosureState={selectedState}
                contractDisclosureFrequency={contractDisclosureFrequency}
                resolvedContract={resolvedContract}
                contractSignerOverrides={effectiveContractSignerRows}
                onSourceRecordsSynced={() => {
                    if (applicationIdForLookup) {
                        void dispatch(getBankDetails({ application: applicationIdForLookup }));
                    }
                }}
            />
            <TemplateMappingPrefillEditDialog
                open={addendumPrefillEditOpen}
                onOpenChange={setAddendumPrefillEditOpen}
                row={linkedAddendumPrefillEditRow}
                contractId={effectiveContractId}
                applicationUuid={applicationIdForLookup}
                applicationData={applicationData}
                resolvedContract={resolvedContract}
                agreementDate={formatDate(new Date())}
                documentTemplatePrefillByMappingId={documentTemplatePrefillByMappingId}
                mainPrefillOverrides={contractPrefillLoaded ? contractPrefillFromDb : null}
                bankDetail={contractPrefillRecords.bankDetail ?? null}
                addendumOnly
                prefillDocumentKind="addendum"
                onSaved={() => {
                    void reloadContractPrefillAfterAddendumSave();
                }}
            />
            <RequestMissingDocumentsModal
                open={requestDocumentsModalOpen}
                onOpenChange={setRequestDocumentsModalOpen}
                onSuccess={() => {
                    if (applicationIdForLookup) {
                        void dispatch(
                            getDocumentRequestsByApplication(
                                businessApplicationId ?? applicationIdForLookup,
                            ),
                        );
                    }
                }}
            />
            <DisclosureCalculationModal
                open={disclosureCalcModalOpen}
                onOpenChange={(nextOpen) => {
                    setDisclosureCalcModalOpen(nextOpen);
                    if (!nextOpen) setDisclosureCalcBankAnalyses(null);
                }}
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
                onApply={applyDisclosureCalculation}
            />
        </>
    );
};

export default PDFViewerModal;
