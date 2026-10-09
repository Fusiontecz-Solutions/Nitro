import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmailPlanButton } from "@/pages/settings/EmailPlanSettings";
import { useParams } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { store, type AppDispatch, type RootState } from "@/redux/store";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import {
    getApplicationById,
    reinitiateContract,
    updateApplication,
} from "@/redux/actions/applicationActions";
import { patchApplicationDetail } from "@/redux/slices/applicationSlice";
import { refreshApplicationDetailFromServer } from "@/lib/refreshApplicationDetail";
import { applicationNeedsContractReinitiation } from "@/lib/contractReinitiation";
import { isContractSignedApplication } from "@/lib/applicationWorkflowState";
import { isApplicationUuid } from "@/lib/paymentDealApplicationId";
import {
    OFFER_DECISION_UPDATED_EVENT,
    emitOfferDecisionUpdated,
    offerDecisionUpdateMatchesApplication,
} from "@/lib/offerDecisionSync";
import {
    createContract,
    getBoldSignTemplates,
    getAllACH,
    getAllAddendum,
    getAllContractGuarantors,
    getAllContractOwners,
    getAllEPO,
    getByApplicationIdContract,
    getByIdContract,
    updateContract,
} from "@/redux/actions/contractActions";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import {
    mergeAndSendDocuSignEnvelope,
    voidBoldSignDocument,
} from "@/redux/actions/boldSignActions";
import { mergeWithDefaultCcEmails } from "./docusignCcList";
import {
    logSignNowFeTiming,
    markSignNowReviewHttpResponse,
    markSignNowReviewRequestStart,
} from "@/utils/signnowTiming";
import { funderNamesEquivalent, formatFunderSelectLabel, useFunderProfiles } from "@/hooks/useFunderProfiles";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import AddendumModal, { type AddendumEntry } from "./AddendumModal";
import EPOModal, { type EPOEntry } from "./EPOModal";
import ACHModal, { type ACHEntry } from "./ACHModal";
import GuarantorModal, { type GuarantorEntry } from "./GuarantorModal";
import OwnerModal, { type OwnerEntry } from "./OwnerModal";
import BusinessInfoModal from "./BusinessInfoModal";
import type { TermsOffer } from "@/types/termsOfferTypes";
import { toast } from "react-toastify";
import { Ban, Eye, FileText, Landmark, Loader2, Mail, MailPlus, RefreshCw } from "lucide-react";
import {
    filterBankDetailsForApplication,
} from "@/lib/bankDetailUtils";
import PDFViewerModal from "./PDFViewerModal";
import { ResendUnsignedContractDialog } from "./ResendUnsignedContractDialog";
import { ContractEmailHistoryDialog } from "./ContractEmailHistoryDialog";
import PDFViewerDocsModal from "./PDFViewerDocsModal";
import ACHFormViewerModal from "./ACHFormViewerModal";
import { axiosDelete, axiosGet, axiosPost } from "@/redux/axios";
import {
    fetchMainContractTemplatePreview,
    getLastSignNowAgreementError,
    isSignNowContractUiEnabled,
    isSignNowEnvelopeId,
    isSignNowLoginWebappUrl,
    NITRO_ADVANCE_CONTRACT_PREVIEW_NAME,
    sanitizeContractPreviewName,
    signNowEmbeddedReturnUrl,
} from "./contractdata/contractTemplatePreview";
// import { US_STATES } from "@/constants/usStates";
import {
    buildContractPrefillFieldsFromApplication,
    CONTRACT_PREFILL_OVERRIDES_SECTION,
    getSignerRecipientEmailForContract,
    getApplicationPrimaryRecipientName,
    resolveBalanceTransferMerchantContext,
    mergeContractPrefillOverrideLayers,
    normalizeContractPrefillOverrides,
    parseNoteStructuredSection,
    applySeparatedAddressPrefillFields,
    applyClientPersonNamePrefillFields,
    applyLiveOfferSyncToPrefillPartial,
    applyTexasContractUsdMoneyToPrefillFields,
    computeNetToMerchantDollars,
    resolveIncludeWireFeePreference,
    contractPrefillFieldsToPartial,
    contractPrefillToContractColumnUpdate,
    mergeSyncedPartialIntoPrefillFields,
    resolveContractBusinessLegalNameForPrefill,
    uppercaseContractDocumentPrefillFields,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
    type ContractPrefillField,
} from "./contractdata/Contract";
import {
    applyDocumentTemplateMappingPrefillOverrides,
    DOCUMENT_SEND_HISTORY_KEY,
    DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY,
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    isAchEnvelopeDraftLikeStatus,
    LAST_ACH_SENT_FUNDER_KEY,
    mergeStateDisclosurePrefillFallback,
    mergeSignNowSupplementalPrefillFallback,
    parseDocumentSendHistory,
    parseDocumentTemplateEnvelopeByMappingId,
    parseDocumentTemplatePrefillByMappingId,
    parseLastAchSentFunder,
    stripDocumentTemplateBlobFromPrefillOverrides,
    upsertDocumentSendHistory,
} from "./contractdata/documentTemplateMappingPrefill";
import { expandAddendumRefsAllowingDuplicates } from "./contractdata/multiInstanceAddendum";
import {
    EXHIBIT_C_ENTITIES_PREFILL_KEY,
    mergeExhibitCEntitiesForSignNowSend,
    serializeExhibitCEntities,
} from "./contractdata/exhibitCEntityPrefill";
import {
    achCamelPartialToTabValues,
    ACH_PREFILL_MAPPING_ALIAS_KEY,
    resolveAchSavedMappingOverrides,
} from "./contractdata/achFormEditConfig";
import {
    achCapsuleClassName,
    mapInternalEnvelopeStatusToAchCapsule,
    mergeAchAuthorizationDocuSignIntoPrefill,
    parseAchAuthorizationDocuSignFromPrefill,
    type AchAuthorizationDocuSignCapsuleStatus,
} from "./contractdata/achAuthorizationDocuSign";
import {
    buildContractSendTableRows,
    hasEverSentMainContract,
    canVoidContractSendTableRow,
    formatAchTableStatusLabel,
    getContractSendRowTermsSnapshot,
    isAchSigningFinished,
    isContractFullySigned,
    isContractVoidedOrTerminal,
    isContractOutForSignature,
    mergeMainContractSendPackageIntoPrefill,
    pickContractEnvelopeDocument,
    pickPreservedDocuSignEnvelopeMetaFromPrefill,
    readContractCcSignedNotice,
    resolveContractSendRowFunderAuth,
    type ContractSendTableRow,
} from "./contractdata/contractSendHistory";
import { syncDocuSignEnvelopeStatus } from "./contractdata/syncDocuSignEnvelopeStatus";
import { isDocuSignPollingLimitError } from "./contractdata/docusignPolling";
import { useContractSigningStatusRealtime } from "@/hooks/useContractSigningStatusRealtime";
import { syncContractPrefillToSourceRecords } from "./contractdata/contractPrefillSourceSync";
import {
    buildAchFormEnvelopeEmailSubject,
    buildPackageEnvelopeEmailMessage,
    buildPackageEnvelopeEmailSubject,
    type ContractSendPackageSelection,
} from "./contractdata/contractSendPackage";
import {
    formatStandalonePackageTableStatusLabel,
    isStandalonePackageSigningFinished,
    mergeStandalonePackageDocuSignIntoPrefill,
    parseStandalonePackageDocuSignFromPrefill,
    type StandalonePackageDocuSignCapsuleStatus,
} from "./contractdata/standalonePackageDocuSign";
import {
    buildDocuSignEnvelopeEmailSubject,
    DOCUSIGN_EMAIL_LENDER_NAME,
} from "./contractdata/docusignTemplateConfig";
import { formatFunderNameWithDealIdPrefix } from "./contractdata/BALANCE_TRANSFER_SHEET_ADDENDUM";
import { applyFunderDisclosureContactPrefill } from "./contractdata/funderDisclosureContact";
import {
    CONTRACT_SIGNER_OVERRIDES_KEY,
    buildDocuSignRolesFromEditorRows,
    parseContractSignerOverridesFromPrefill,
    parseBoldSignTemplateRolesFromRecipientsPayload,
    resolveDocuSignRolesForEnvelopeSend,
    type DocuSignTemplateRolePayload,
} from "./contractdata/templateRecipients";
import {
    applyPrimaryGuarantorNamesToPrefillFields,
    applySecondOwnerNameToPrefillFields,
    clearParty2PrefillFieldPayload,
    collapseDocuSignRolesToSignerSlots,
    resolveActiveOwnerCount,
    resolveOwnerRowFullName,
    resolveSecondOwnerSignerName,
} from "./contractdata/contractPartyCounts";
import { resolveOwnerRowsForContractPrefill } from "./contractdata/contractOwnerPrefillRows";
import {
    applicationWithClientOwners,
    ensureSignerRowsFromCrmOwners,
    resolveOwnerPartiesForContractSigners,
} from "./contractdata/contractSignerOwnersSync";
import { useApplicationClientOwners } from "@/hooks/useApplicationClientOwners";
import {
    formatCurrency,
    formatCurrencyFull,
    formatDateMonthDayYear,
    formatDateTimeUS,
    formatNumberUSForInput,
    parseNumberUS,
    type DateInput,
} from "@/lib/utils";
import {
    resolveOfferDecisionFeesRaw,
    resolveOfferDecisionFundedAmount,
    resolveOfferFeeAmountForDeal,
} from "@/lib/offerDecisionFees";
import {
    deriveOfferRepaymentStack,
    parseTerm,
    resolveOfferFactorRate,
    resolveOfferPayback,
} from "@/lib/offerRepaymentCalculations";
import {
    boldSignTemplateIsPreviewable,
    getBoldSignTemplateMappingRef,
} from "./contractdata/boldSignTemplateDocument";
import {
    getPlatformSignerRoleRows,
    isAchAuthorizationLayoutKey,
    PLATFORM_LAYOUT_KEYS,
} from "./contractdata/platformDocumentConfig";

type AchDocumentTemplateMappingRow = {
    id: string;
    contractId: number;
    templateId: string;
    documentType: string;
    order: number;
    template?: {
        id: string;
        name?: string;
        type?: string;
        templateId?: string;
        pdfUrl?: string;
        layoutKey?: string;
    } | null;
};

const DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS = {
    existing: [0, 800, 1600, 2600],
    justCreated: [400, 1100, 2200, 3400],
} as const;

function formatContractCurrency(value: number | string | null | undefined) {
    return formatCurrency(value, { fallback: "—" });
}

const parseMaybeNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const n = typeof value === "number" ? value : parseNumberUS(value);
    return Number.isFinite(n) ? n : null;
};

const CONTRACT_VALUES_SECTION = "CONTRACT_VALUES";

function formatContractTableStatusLabel(
    contractStatus: unknown,
    documentStatus?: unknown,
    hasEnvelope?: boolean,
): string {
    if (!hasEnvelope) return "Pending";
    const ds = String(documentStatus ?? "").trim().toLowerCase();
    const cs = String(contractStatus ?? "").trim().toUpperCase();
    if (ds === "completed" || cs === "COMPLETED") return "Completed";
    if (ds === "signed" || cs === "SIGNED") return "Signed";
    if (ds === "viewed" || ds === "delivered" || cs === "VIEWED") return "Viewed";
    if (ds === "sent" || cs === "SENT") return "Sent";
    // Drafts are excluded from Contracts Generated; never show Draft here.
    if (ds === "draft" || ds === "created" || cs === "DRAFT") return "Pending";
    if (cs === "GENERATED") return "Generated";
    if (
        ds === "revoked" ||
        ds === "voided" ||
        cs === "REVOKED" ||
        cs === "VOIDED"
    ) {
        return "Voided";
    }
    if (ds === "declined" || cs === "DECLINED") return "Declined";
    if (ds === "expired" || cs === "EXPIRED") return "Expired";
    return cs
        ? cs
              .replace(/_/g, " ")
              .toLowerCase()
              .replace(/\b\w/g, (c) => c.toUpperCase())
        : "Pending";
}

function contractStatusToCapsuleStatus(
    contractStatus: unknown,
    documentStatus?: unknown,
): AchAuthorizationDocuSignCapsuleStatus {
    const label = formatContractTableStatusLabel(contractStatus, documentStatus, true);
    if (label === "Signed" || label === "Completed") return "SIGNED";
    if (label === "Viewed") return "VIEWED";
    if (label === "Sent") return "SENT";
    if (label === "Voided" || label === "Declined" || label === "Expired") return "VOIDED";
    return "DRAFT";
}

function formatTableSentAt(value: unknown): string {
    return formatDateTimeUS(value as DateInput, "—");
}

/** DocuSign when signers are rejected; show success toast instead of raw validation noise. */
function isDocuSignMissingSignerMessage(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes("minimum one signer") ||
        m.includes("one signer is needed") ||
        m.includes('"signers"') ||
        (m.includes("boldsign validation error") && m.includes("signer")) ||
        (m.includes("docusign error") && m.includes("signer"))
    );
}

/** Legacy `sendViewOption: "Prepare"` caused DocuSign 400; treat like soft-success for toast UX. */
function isDocuSignSendViewOptionPageViewError(message: string): boolean {
    const m = message.toLowerCase();
    return m.includes("sendviewoption") && m.includes("pageviewoption");
}

const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseStructuredSection = <T,>(note: string, sectionLabel: string): T | null => {
    if (!note || !sectionLabel) return null;
    const sectionPattern = new RegExp(
        `\\[${escapeRegExp(sectionLabel)}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\n\\[[^\\]]+\\]\\s*\\n|$)`,
        "g",
    );
    let match: RegExpExecArray | null = null;
    let lastPayload = "";
    while ((match = sectionPattern.exec(note)) !== null) {
        lastPayload = String(match[1] || "").trim();
    }
    if (!lastPayload) return null;
    try {
        return JSON.parse(lastPayload) as T;
    } catch {
        return null;
    }
};

const upsertStructuredSection = (
    existingNote: string,
    sectionLabel: string,
    payload: unknown,
) => {
    const serialized = JSON.stringify(payload);
    const blockRegex = new RegExp(
        `(?:\\n\\n)?\\[${escapeRegExp(sectionLabel)}\\]\\s*\\n[\\s\\S]*?(?=(?:\\n\\n\\[[^\\]]+\\]\\s*\\n)|$)`,
        "g",
    );
    const stripped = String(existingNote || "").replace(blockRegex, "").trim();
    const nextBlock = `[${sectionLabel}]\n${serialized}`;
    return stripped ? `${stripped}\n\n${nextBlock}` : nextBlock;
};

type PersistedContractValues = {
    amountFinancedInput: string;
    recipientFundsInput: string;
    financeChargeInput: string;
    estimatedTotalPaymentInput: string;
    paymentTotalInput: string;
    estimatedMonthlyCostInput: string;
    estimatedPaymentInput: string;
    frequencyInput: string;
    numberOfPaymentsInput: string;
    termLengthInput: string;
};

interface ContractTabProps {
    /** When true, hide all edit/generate actions (Agent view) */
    readOnly?: boolean;
    /**
     * True while the Contract tab is the selected tab. The tab stays mounted
     * after its first visit, so this is what tells it the user came back.
     */
    active?: boolean;
}

/** CRM-only re-read of a SignNow contract awaiting signature (no SignNow calls). */
const CONTRACT_STATUS_FALLBACK_POLL_MS = 5_000;

/** Waits before re-trying a contract lookup that failed for a transient reason. */
const CONTRACT_LOOKUP_RETRY_DELAYS_MS = [1_500, 4_000];

export default function ContractTab({
    readOnly = false,
    active = true,
}: ContractTabProps = {}) {
    const { applicationId } = useParams<{ applicationId: string }>();
    const dispatch = useDispatch<AppDispatch>();
    const { data: applicationData } = useSelector(
        (state: RootState) => state.applicationDetail,
    );
    const { owners: applicationClientOwners } = useApplicationClientOwners(
        (applicationData as { client?: unknown } | null)?.client ?? null,
    );
    const applicationForPrefill = useMemo(
        () => applicationWithClientOwners(applicationData, applicationClientOwners),
        [applicationData, applicationClientOwners],
    );
    const { data: termsOffers, loading: termsOffersLoading, loadedForApplicationId: termsLoadedFor } = useSelector(
        (state: RootState) => state.termsOffers,
    );
    const { data: offerDecision, loading: offerDecisionLoading, loadedForApplicationId: offerLoadedFor } = useSelector(
        (state: RootState) => state.offerDecision,
    );
    const { data: loginData } = useSelector((state: RootState) => state.login);
    const { data: bankDetailsList, loadedForApplicationId: bankDetailsLoadedFor } = useSelector(
        (state: RootState) => state.bankDetails,
    );
    const achListState = useSelector((state: RootState) => state.achList);
    const boldSignTemplatesState = useSelector((state: RootState) => state.boldSignTemplates);
    const boldSignTemplates = Array.isArray(boldSignTemplatesState.data)
        ? boldSignTemplatesState.data
        : [];
    const addendumListState = useSelector((state: RootState) => state.addendumList);
    const epoListState = useSelector((state: RootState) => state.epoList);
    const contractOwnerListState = useSelector((state: RootState) => state.contractOwnerList);
    const contractGuarantorListState = useSelector(
        (state: RootState) => state.contractGuarantorList,
    );
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const userRoleRaw =
        (loginData as any)?.user?.role ||
        (typeof window !== "undefined" ? localStorage.getItem("role") : "") ||
        "";
    const roleKey = String(userRoleRaw || "").replace(/-/g, "_").toUpperCase();
    const applicationTypeRaw = (applicationData as any)?.type || "";
    const isBypassApplication =
        String(applicationTypeRaw || "").trim().toUpperCase() === "BYPASS";
    const isOperationsBypassEditable = roleKey === "OPERATIONS" && isBypassApplication;
    const isReadOnly = readOnly && !isOperationsBypassEditable;

    // const [addendum, setAddendum] = useState(true);
    // const [epo, setEpo] = useState(false);
    // const [ach, setAch] = useState(false);
    // const [guarantor, setGuarantor] = useState(false);
    // const [owner, setOwner] = useState(false);
    const [businessInfoModalOpen, setBusinessInfoModalOpen] = useState(false);
    const [addendumModalOpen, setAddendumModalOpen] = useState(false);
    const [epoModalOpen, setEPOModalOpen] = useState(false);
    const [achModalOpen, setACHModalOpen] = useState(false);
    const [guarantorModalOpen, setGuarantorModalOpen] = useState(false);
    const [ownerModalOpen, setOwnerModalOpen] = useState(false);
    const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
    const [pdfViewerInitialRightPaneTab, setPdfViewerInitialRightPaneTab] = useState<"template" | "prefilled">("template");
    const [achTemplateMappings, setAchTemplateMappings] = useState<AchDocumentTemplateMappingRow[]>([]);
    const [loadingAchMappings, setLoadingAchMappings] = useState(false);
    const [achViewerOpen, setAchViewerOpen] = useState(false);
    const [, setPreparingAchViewer] = useState(false);
    /** Which Info Required ACH row feeds the ACH Form modal (first / last picked). */
    const [selectedAchRecordId, setSelectedAchRecordId] = useState<string | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfName, setPdfName] = useState<string>("Contract.pdf");
    const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
    const [globalTemplateUrl, setGlobalTemplateUrl] = useState<string | null>(
        null,
    );
    const globalTemplateUrlRef = useRef<string | null>(null);
    globalTemplateUrlRef.current = globalTemplateUrl;
    const contractLookupDoneRef = useRef(false);
    const [globalTemplateName, setGlobalTemplateName] = useState<string | null>(
        null,
    );
    const [creatingEnvelope, setCreatingEnvelope] = useState(false);
    const [loadingContractPreview, setLoadingContractPreview] = useState(false);
    const [regeneratingContract, setRegeneratingContract] = useState(false);
    const [viewingSignedContract, setViewingSignedContract] = useState(false);
    const [viewingSignedEnvelopeId, setViewingSignedEnvelopeId] = useState<string | null>(null);
    const [voidingContract, setVoidingContract] = useState(false);
    /** Row whose "Resend unsigned contract" dialog is open — same package, values kept. */
    const [resendUnsignedRow, setResendUnsignedRow] = useState<{
        envelopeId: string;
        label: string;
    } | null>(null);
    const [viewingAchDocument, setViewingAchDocument] = useState(false);
    const [refreshingSigningStatus, setRefreshingSigningStatus] = useState(false);
    const [contractSyncError, setContractSyncError] = useState<string | null>(null);
    const [achSyncError, setAchSyncError] = useState<string | null>(null);
    const [packageSyncError, setPackageSyncError] = useState<string | null>(null);
    const [signedPdfPreviewOpen, setSignedPdfPreviewOpen] = useState(false);
    const [signedPdfPreviewUrl, setSignedPdfPreviewUrl] = useState<string | null>(null);
    const [signedPdfPreviewName, setSignedPdfPreviewName] = useState("Signed contract.pdf");
    const [fetchedContract, setFetchedContract] = useState<any | null>(null);
    const contractStateForFunders = String(
        (fetchedContract as { state?: string | null } | null)?.state ?? "",
    ).trim();
    const [contractSupportDataEnabled, setContractSupportDataEnabled] = useState(false);
    const enableContractSupportData = useCallback(() => {
        setContractSupportDataEnabled(true);
    }, []);
    const { resolveLayoutKey, findFunder, findFunderById } = useFunderProfiles(
        contractStateForFunders || null,
        { enabled: contractSupportDataEnabled },
    );

    const persistContractFunderMeta = useCallback(
        async (
            contractId: number,
            patch: { funderName?: string | null; state?: string | null },
            contractRow?: Record<string, unknown> | null,
        ) => {
            const row =
                contractRow ??
                (fetchedContract && typeof fetchedContract === "object"
                    ? (fetchedContract as Record<string, unknown>)
                    : null);
            const data: { funderName?: string | null; state?: string | null } = {};
            if (patch.funderName !== undefined) {
                const next =
                    patch.funderName === "" || patch.funderName == null
                        ? null
                        : String(patch.funderName).trim();
                const db = String((row as { funderName?: unknown } | null)?.funderName ?? "").trim();
                if (!funderNamesEquivalent(next, db)) {
                    data.funderName = next;
                }
            }
            if (patch.state !== undefined) {
                const next =
                    patch.state === "" || patch.state == null
                        ? null
                        : String(patch.state).trim();
                const db = String((row as { state?: unknown } | null)?.state ?? "").trim();
                if (next !== db) {
                    data.state = next;
                }
            }
            if (!Object.keys(data).length) return;
            try {
                const res = await dispatch(
                    updateContract({ id: contractId, data }),
                ).unwrap();
                const updated =
                    (res as { data?: Record<string, unknown> } | null)?.data ??
                    (res as Record<string, unknown> | null);
                if (updated && typeof updated === "object") {
                    setFetchedContract(updated);
                } else {
                    setFetchedContract((prev: Record<string, unknown> | null) =>
                        prev && typeof prev === "object" ? { ...prev, ...data } : prev,
                    );
                }
            } catch (err) {
                console.warn("[ContractTab] persist funder/state skipped:", err);
            }
        },
        [dispatch, fetchedContract],
    );

    const appId =
        applicationId ??
        (applicationData as { _id?: string; id?: string })?.id ??
        (applicationData as { _id?: string })?._id;
    // Prefer Application.id (UUID). URL `:applicationId` is often the display Int (e.g. 1115).
    const applicationUuid = useMemo(() => {
        const fromData = String(
            (applicationData as { _id?: string; id?: string } | null)?._id ??
                (applicationData as { id?: string } | null)?.id ??
                "",
        ).trim();
        if (fromData && isApplicationUuid(fromData)) return fromData;
        const fromRoute = String(applicationId ?? "").trim();
        if (fromRoute && isApplicationUuid(fromRoute)) return fromRoute;
        // Backend now accepts numeric display ids; keep as fallback for early loads.
        return fromData || fromRoute || (appId ? String(appId) : null);
    }, [applicationData, applicationId, appId]);

    const alreadyLoadedForApp = useCallback(
        (loadedFor: string | null | undefined) => {
            const loaded = String(loadedFor ?? "").trim();
            if (!loaded) return false;
            const keys = [
                applicationUuid,
                appId,
                (applicationData as { applicationId?: number | string } | null)?.applicationId,
            ];
            return keys.some((key) => key != null && String(key).trim() === loaded);
        },
        [applicationUuid, appId, applicationData],
    );
    useEffect(() => {
        const termsApplicationKey = applicationUuid ?? appId;
        if (!termsApplicationKey) return;
        if (alreadyLoadedForApp(termsLoadedFor)) return;
        if (alreadyLoadedForApp(offerLoadedFor) && offerDecision) return;
        dispatch(getTermsOffers({ application: String(termsApplicationKey) }));
    }, [
        applicationUuid,
        appId,
        dispatch,
        termsLoadedFor,
        offerLoadedFor,
        offerDecision,
        alreadyLoadedForApp,
    ]);

    // Load existing contract by application so "Contracts Generated" can show
    // persisted backend data even before creating/selecting a contract in this session.
    useEffect(() => {
        // A response for the previous deal must never land on this one.
        let cancelled = false;
        const fetchByApplication = async () => {
            if (!applicationUuid) {
                setFetchedContract(null);
                setSelectedContractId(null);
                contractLookupDoneRef.current = true;
                return;
            }
            let res: unknown;
            for (let attempt = 0; ; attempt += 1) {
                try {
                    res = await dispatch(
                        getByApplicationIdContract({
                            applicationId: String(applicationUuid),
                            fresh: true,
                        }),
                    ).unwrap();
                    break;
                } catch (err) {
                    if (cancelled) return;
                    // 404 "Contract not found": this deal simply has no contract yet.
                    if (/not found/i.test(String(err ?? ""))) {
                        setFetchedContract(null);
                        setSelectedContractId(null);
                        contractLookupDoneRef.current = true;
                        return;
                    }
                    // A transient failure (pool timeout, 5xx, network) used to read as
                    // "no contract" until a manual refresh. Retry; if it still fails,
                    // leave the lookup marked not-done so Generate re-checks for the
                    // existing contract instead of creating a second one.
                    if (attempt >= CONTRACT_LOOKUP_RETRY_DELAYS_MS.length) {
                        setFetchedContract(null);
                        setSelectedContractId(null);
                        return;
                    }
                    await new Promise((resolve) =>
                        setTimeout(resolve, CONTRACT_LOOKUP_RETRY_DELAYS_MS[attempt]),
                    );
                    if (cancelled) return;
                }
            }
            if (cancelled) return;
            try {
                let contract = (res as any)?.data ?? res ?? null;
                setFetchedContract(contract);
                const contractId = Number((contract as any)?.id);
                setSelectedContractId(Number.isFinite(contractId) && contractId > 0 ? contractId : null);

                const envelopeId = String(
                    (contract as { application?: { document?: { envelopeId?: string } } })
                        ?.application?.document?.envelopeId ?? "",
                ).trim();
                const docStatus = String(
                    (contract as { application?: { document?: { status?: string } } })
                        ?.application?.document?.status ?? "",
                )
                    .trim()
                    .toLowerCase();
                const contractStatus = String(
                    (contract as { status?: unknown })?.status ?? "",
                )
                    .trim()
                    .toUpperCase();
                const looksSent = docStatus === "sent" || contractStatus === "SENT";
                if (looksSent && isSignNowEnvelopeId(envelopeId)) {
                    const existingEnv = String(
                        (applicationData as { document?: { envelopeId?: string } } | null)
                            ?.document?.envelopeId ?? "",
                    ).trim();
                    if (!existingEnv) {
                        refreshApplicationDetailFromServer(dispatch, String(applicationUuid));
                    }
                }
            } catch {
                setFetchedContract(null);
                setSelectedContractId(null);
            } finally {
                contractLookupDoneRef.current = true;
            }
        };

        contractLookupDoneRef.current = false;
        void fetchByApplication();
        return () => {
            cancelled = true;
        };
    }, [dispatch, applicationUuid]);

    // Fetch created contract details by id when available
    useEffect(() => {
        const fetchById = async () => {
            if (!selectedContractId) return;
            const alreadyLoaded = Number((fetchedContract as { id?: unknown } | null)?.id);
            if (alreadyLoaded === selectedContractId) return;
            try {
                const res = await dispatch(getByIdContract(Number(selectedContractId))).unwrap();
                setFetchedContract((res as any)?.data ?? res ?? null);
            } catch {
                setFetchedContract(null);
            }
        };
        void fetchById();
        // Skip duplicate get-by-id when get-by-application already loaded this row.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dispatch, selectedContractId]);

    useEffect(() => {
        if (!contractSupportDataEnabled || !selectedContractId) return;
        const id = selectedContractId;
        void dispatch(getAllACH({ contractId: id }));
        void dispatch(getAllAddendum({ contractId: id }));
        void dispatch(getAllEPO({ contractId: id }));
        void dispatch(getAllContractOwners({ contractId: id }));
        void dispatch(getAllContractGuarantors({ contractId: id }));
    }, [dispatch, selectedContractId, contractSupportDataEnabled]);

    const templatesFetchAttemptedRef = useRef(false);
    useEffect(() => {
        if (!contractSupportDataEnabled) return;
        if (templatesFetchAttemptedRef.current) return;
        if (boldSignTemplatesState.loading) return;
        if (Array.isArray(boldSignTemplatesState.data) && boldSignTemplatesState.data.length > 0) {
            templatesFetchAttemptedRef.current = true;
            return;
        }
        templatesFetchAttemptedRef.current = true;
        void dispatch(getBoldSignTemplates({}));
    }, [
        dispatch,
        contractSupportDataEnabled,
        boldSignTemplatesState.loading,
        boldSignTemplatesState.data,
    ]);

    const fetchAchTemplateMappings = useCallback(
        async (contractIdOverride?: number): Promise<AchDocumentTemplateMappingRow[]> => {
            const contractId = contractIdOverride ?? selectedContractId;
            if (!contractId) {
                setAchTemplateMappings([]);
                return [];
            }
            try {
                setLoadingAchMappings(true);
                const res = await axiosGet(
                    `/contract/${contractId}/document-template-mappings`,
                );
                const rows = (res?.data?.data ?? []) as AchDocumentTemplateMappingRow[];
                const achRows = Array.isArray(rows)
                    ? rows.filter((row) => String(row.documentType || "").toLowerCase() === "ach")
                    : [];
                setAchTemplateMappings(achRows);
                return achRows;
            } catch {
                setAchTemplateMappings([]);
                return [];
            } finally {
                setLoadingAchMappings(false);
            }
        },
        [selectedContractId],
    );

    useEffect(() => {
        if (!contractSupportDataEnabled) return;
        void fetchAchTemplateMappings();
    }, [fetchAchTemplateMappings, contractSupportDataEnabled]);

    const achTemplateOptions = useMemo(
        () =>
            boldSignTemplates.filter((template: { type?: string; name?: string; layoutKey?: string }) => {
                const typeText = String(template?.type || "").toLowerCase();
                const nameText = String(template?.name || "").toLowerCase();
                const layoutKey = String(template?.layoutKey || "").toLowerCase();
                return (
                    typeText === "ach" ||
                    layoutKey === "ach_authorization" ||
                    (nameText.includes("ach") && !nameText.includes("attach"))
                );
            }),
        [boldSignTemplates],
    );

    const primaryAchTemplate = useMemo(() => {
        const previewable = achTemplateOptions.filter((template) =>
            boldSignTemplateIsPreviewable(template),
        );
        const platformFirst = previewable.find((template) => {
            const layoutKey = String(template?.layoutKey || "").toLowerCase();
            const templateId = String(template?.templateId || "").toLowerCase();
            if (layoutKey.startsWith("funder_") || templateId.startsWith("funder_")) {
                return false;
            }
            return (
                layoutKey === "ach_authorization" ||
                layoutKey === "ach_authorization_standalone" ||
                layoutKey === "ach_authorization_texas" ||
                layoutKey === "woodmere_ach_authorization"
            );
        });
        return platformFirst ?? previewable[0] ?? null;
    }, [achTemplateOptions]);

    const linkedAchMapping = useMemo(() => {
        if (!achTemplateMappings.length) return null;
        return [...achTemplateMappings].sort(
            (a, b) => Number(b.order ?? 0) - Number(a.order ?? 0),
        )[0];
    }, [achTemplateMappings]);

    /** ACH template for the viewer — uses contract mapping when present, else the global ACH template. */
    const effectiveAchMapping = useMemo((): AchDocumentTemplateMappingRow | null => {
        if (linkedAchMapping) return linkedAchMapping;
        const template = primaryAchTemplate;
        if (!template || !boldSignTemplateIsPreviewable(template)) return null;
        const ref = getBoldSignTemplateMappingRef(template);
        if (!ref) return null;
        const templateId = String(template.id ?? ref);
        return {
            id: `ach-template-${ref}`,
            contractId: Number(selectedContractId) || 0,
            templateId,
            documentType: "ach",
            order: 0,
            template: {
                id: templateId,
                name: template.name,
                type: template.type,
                templateId: template.templateId,
                pdfUrl: template.pdfUrl,
                layoutKey: template.layoutKey,
            },
        };
    }, [linkedAchMapping, primaryAchTemplate, selectedContractId]);

    const ensureAchTemplateMapping = useCallback(
        async (templateRef: string | null) => {
            if (!selectedContractId) return;
            const ref = String(templateRef || "").trim();
            try {
                const res = await axiosGet(
                    `/contract/${selectedContractId}/document-template-mappings`,
                );
                const rows = (res?.data?.data ?? []) as AchDocumentTemplateMappingRow[];
                const achRows = rows.filter(
                    (row) => String(row.documentType || "").toLowerCase() === "ach",
                );
                await Promise.all(
                    achRows.map((row) =>
                        axiosDelete(
                            `/contract/${selectedContractId}/document-template-mappings/${row.id}`,
                        ),
                    ),
                );
                if (ref) {
                    await axiosPost(`/contract/${selectedContractId}/document-template-mappings`, {
                        documentType: "ach",
                        templateRef: ref,
                    });
                }
                await fetchAchTemplateMappings();
            } catch (error: unknown) {
                const msg =
                    (error as { message?: string })?.message ||
                    "Failed to link ACH template to contract.";
                toast.error(msg);
            }
        },
        [selectedContractId, fetchAchTemplateMappings],
    );

    useEffect(() => {
        if (!contractSupportDataEnabled) return;
        if (!selectedContractId || loadingAchMappings || linkedAchMapping) return;
        const ref = getBoldSignTemplateMappingRef(primaryAchTemplate);
        if (!ref) return;
        void ensureAchTemplateMapping(ref);
    }, [
        contractSupportDataEnabled,
        selectedContractId,
        loadingAchMappings,
        linkedAchMapping,
        primaryAchTemplate,
        ensureAchTemplateMapping,
    ]);

    const bankDetailApplicationKeys = useMemo(
        () => [
            applicationUuid,
            (applicationData as { applicationId?: number })?.applicationId,
            appId,
        ],
        [applicationUuid, applicationData, appId],
    );

    const bankDetailsForApplication = useMemo(
        () => filterBankDetailsForApplication(bankDetailsList, bankDetailApplicationKeys),
        [bankDetailsList, bankDetailApplicationKeys],
    );

    const achRecordRows = useMemo((): Record<string, unknown>[] => {
        const data = achListState.data;
        return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    }, [achListState.data]);

    const achFormSelectionStorageKey = useMemo(
        () =>
            selectedContractId != null
                ? `achFormSelectedRecordId:${selectedContractId}`
                : null,
        [selectedContractId],
    );

    useEffect(() => {
        if (!achRecordRows.length) {
            setSelectedAchRecordId(null);
            return;
        }
        const ids = achRecordRows.map((row) => String(row.id ?? "").trim()).filter(Boolean);
        if (!ids.length) {
            setSelectedAchRecordId(null);
            return;
        }
        let preferred: string | null = null;
        if (achFormSelectionStorageKey && typeof window !== "undefined") {
            try {
                const stored = String(
                    window.sessionStorage.getItem(achFormSelectionStorageKey) || "",
                ).trim();
                if (stored && ids.includes(stored)) preferred = stored;
            } catch {
                /* ignore */
            }
        }
        setSelectedAchRecordId((prev) => {
            if (prev && ids.includes(prev)) return prev;
            return preferred ?? ids[0];
        });
    }, [achRecordRows, achFormSelectionStorageKey]);

    const handleSelectedAchRecordIdChange = useCallback(
        (nextId: string) => {
            const id = String(nextId || "").trim();
            if (!id) return;
            setSelectedAchRecordId(id);
            if (achFormSelectionStorageKey && typeof window !== "undefined") {
                try {
                    window.sessionStorage.setItem(achFormSelectionStorageKey, id);
                } catch {
                    /* ignore */
                }
            }
        },
        [achFormSelectionStorageKey],
    );

    const contractPrefillRecords: ContractPrefillContractRecords = useMemo(() => {
        const firstRow = (data: unknown): Record<string, unknown> | null =>
            Array.isArray(data) && data.length ? (data[0] as Record<string, unknown>) : null;
        const rows = bankDetailsForApplication;
        const latestBank =
            rows.length > 0
                ? [...rows].sort((a, b) => {
                      const ta = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
                      const tb = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
                      return ta - tb;
                  })[0]
                : null;
        const selectedAch =
            (selectedAchRecordId
                ? achRecordRows.find((row) => String(row.id ?? "").trim() === selectedAchRecordId)
                : null) ??
            achRecordRows[0] ??
            null;
        return {
            contract: fetchedContract && typeof fetchedContract === "object" ? fetchedContract : null,
            ach: selectedAch,
            bankDetail: latestBank
                ? {
                      _id: latestBank._id,
                      id: latestBank._id ?? (latestBank as { id?: string }).id,
                      bankName: latestBank.bankName,
                      accountNumber: latestBank.accountNumber,
                      routingNumber: latestBank.routingNumber,
                  }
                : null,
            addendum: firstRow(addendumListState.data),
            epo: firstRow(epoListState.data),
            owners: resolveOwnerRowsForContractPrefill(
                applicationForPrefill,
                Array.isArray(contractOwnerListState.data)
                    ? contractOwnerListState.data
                    : [],
            ),
            guarantors: Array.isArray(contractGuarantorListState.data)
                ? contractGuarantorListState.data
                : [],
        };
    }, [
        achRecordRows,
        selectedAchRecordId,
        addendumListState.data,
        epoListState.data,
        contractOwnerListState.data,
        contractGuarantorListState.data,
        fetchedContract,
        bankDetailsForApplication,
        applicationForPrefill,
    ]);

    useEffect(() => {
        if (!appId) return;
        if (alreadyLoadedForApp(offerLoadedFor)) return;
        dispatch(getOfferDecisionByApplication(String(appId)));
    }, [appId, dispatch, offerLoadedFor, alreadyLoadedForApp]);

    // Refresh offer / prefill when Live Offer is saved elsewhere (scrubbing Offer Decision).
    useEffect(() => {
        const matchId = applicationUuid ?? appId;
        if (!matchId) return;
        const onOfferDecisionUpdated = (event: Event) => {
            const detail = (
                event as CustomEvent<{ applicationId?: string; skipRefetch?: boolean }>
            ).detail;
            if (
                !offerDecisionUpdateMatchesApplication(detail?.applicationId, matchId) &&
                !offerDecisionUpdateMatchesApplication(detail?.applicationId, appId)
            ) {
                return;
            }
            if (detail?.skipRefetch) return;
            void dispatch(getOfferDecisionByApplication(String(matchId)));
            void dispatch(getTermsOffers({ application: String(matchId) }));
        };
        window.addEventListener(OFFER_DECISION_UPDATED_EVENT, onOfferDecisionUpdated);
        return () => {
            window.removeEventListener(OFFER_DECISION_UPDATED_EVENT, onOfferDecisionUpdated);
        };
    }, [applicationUuid, appId, dispatch]);

    useEffect(() => {
        if (!contractSupportDataEnabled) return;
        if (!applicationUuid) return;
        if (alreadyLoadedForApp(bankDetailsLoadedFor)) return;
        dispatch(getBankDetails({ application: String(applicationUuid) }));
    }, [
        applicationUuid,
        dispatch,
        bankDetailsLoadedFor,
        alreadyLoadedForApp,
        contractSupportDataEnabled,
    ]);

    // Note: BoldSign callback is handled in RootLayout.tsx to ensure it runs on every page load

    const latestTermsOffer: TermsOffer | undefined = termsOffers?.[0];

    const effectiveTermsOffer = useMemo((): TermsOffer | undefined => {
        const normalize = (raw: unknown): TermsOffer | undefined => {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
            const row = raw as Record<string, unknown>;
            const id = String(row._id ?? row.id ?? "");
            return { ...(row as unknown as TermsOffer), _id: id || String(row._id ?? "") };
        };
        return (
            latestTermsOffer ??
            normalize((fetchedContract as { termsOffers?: unknown[] } | null)?.termsOffers?.[0]) ??
            normalize(
                (fetchedContract as { application?: { termsOffers?: unknown[] } } | null)
                    ?.application?.termsOffers?.[0],
            )
        );
    }, [latestTermsOffer, fetchedContract]);

    const needsContractReinitiation = applicationNeedsContractReinitiation(
        applicationData as Record<string, unknown> | null,
    );

    const hasGeneratedContract = useMemo(() => {
        const fetchedId = Number((fetchedContract as { id?: unknown } | null)?.id);
        if (Number.isFinite(fetchedId) && fetchedId > 0) return true;
        return Number.isFinite(Number(selectedContractId)) && Number(selectedContractId) > 0;
    }, [fetchedContract, selectedContractId]);

    const contractEnvelopeDocument = useMemo(
        () =>
            pickContractEnvelopeDocument(
                fetchedContract as Record<string, unknown> | null | undefined,
            ),
        [fetchedContract],
    );

    const mainContractEnvelopeId = useMemo(
        () => String(contractEnvelopeDocument?.envelopeId ?? "").trim() || null,
        [contractEnvelopeDocument],
    );

    const achAuthorizationDocuSign = useMemo(
        () =>
            parseAchAuthorizationDocuSignFromPrefill(
                (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
                { excludeEnvelopeId: mainContractEnvelopeId },
            ),
        [fetchedContract, mainContractEnvelopeId],
    );

    const standalonePackageDocuSign = useMemo(
        () =>
            parseStandalonePackageDocuSignFromPrefill(
                (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
                { excludeEnvelopeId: mainContractEnvelopeId },
            ),
        [fetchedContract, mainContractEnvelopeId],
    );

    const packageCapsuleStatus: StandalonePackageDocuSignCapsuleStatus =
        standalonePackageDocuSign?.status ?? "DRAFT";

    const achCapsuleStatus: AchAuthorizationDocuSignCapsuleStatus =
        achAuthorizationDocuSign?.status ?? "DRAFT";

    const contractFullySigned = isContractFullySigned(
        (fetchedContract as { status?: unknown } | null)?.status,
        contractEnvelopeDocument?.status,
    );

    const ccSignedNotice = useMemo(
        () => readContractCcSignedNotice(contractEnvelopeDocument),
        [contractEnvelopeDocument],
    );
    const ccSignedNoticeSent = Boolean(ccSignedNotice.sentAt);
    const [emailHistoryOpen, setEmailHistoryOpen] = useState(false);

    // The signed-copy email to the CC list goes out in the background right after
    // the signing platform reports completion, so the status that first shows the
    // contract as signed usually predates it. Re-read the contract once shortly
    // after so the checkbox ticks itself without a page reload.
    const ccNoticeRecheckedForAppRef = useRef<string | null>(null);
    useEffect(() => {
        if (!applicationUuid || !contractFullySigned || ccSignedNoticeSent) return;
        if (!ccSignedNotice.ccEmails.length) return;
        if (ccNoticeRecheckedForAppRef.current === applicationUuid) return;
        ccNoticeRecheckedForAppRef.current = applicationUuid;
        const timer = window.setTimeout(() => {
            void dispatch(
                getByApplicationIdContract({
                    applicationId: String(applicationUuid),
                    fresh: true,
                }),
            )
                .unwrap()
                .then((res) => {
                    const contract = (res as any)?.data ?? res ?? null;
                    if (contract) setFetchedContract(contract);
                })
                .catch(() => undefined);
        }, 15000);
        return () => window.clearTimeout(timer);
    }, [
        applicationUuid,
        contractFullySigned,
        ccSignedNoticeSent,
        ccSignedNotice.ccEmails.length,
        dispatch,
    ]);

    const signedWorkflowSyncedForAppRef = useRef<string | null>(null);
    useEffect(() => {
        if (!applicationUuid || !contractFullySigned) return;
        if (signedWorkflowSyncedForAppRef.current === applicationUuid) return;
        if (isContractSignedApplication(applicationData as Record<string, unknown> | null)) {
            signedWorkflowSyncedForAppRef.current = applicationUuid;
            return;
        }
        signedWorkflowSyncedForAppRef.current = applicationUuid;
        refreshApplicationDetailFromServer(dispatch, String(applicationUuid));
    }, [applicationUuid, applicationData, contractFullySigned, dispatch]);

    const contractRecordForActions =
        fetchedContract && typeof fetchedContract === "object"
            ? (fetchedContract as Record<string, unknown>)
            : null;

    const contractSendTableRows = useMemo(
        () =>
            buildContractSendTableRows(
                fetchedContract && typeof fetchedContract === "object"
                    ? (fetchedContract as Record<string, unknown>)
                    : null,
            ),
        [fetchedContract],
    );

    /**
     * The merchant has been sent a main-contract envelope at some point. Draft rows never
     * reach this table, so any main-contract row — current or archived — means a package
     * went out, which is when "Resend New Contract" becomes available.
     *
     * Archived rows have to count: a resend deletes the Document row and moves the send
     * into `contractSendHistory`, so requiring `isCurrent` hid the button on exactly the
     * deals that had just been resent and still needed another attempt.
     */
    const hasSentContract = useMemo(
        () => hasEverSentMainContract(contractRecordForActions),
        [contractRecordForActions],
    );

    const offerRecord =
        offerDecision != null && typeof offerDecision === "object"
            ? (offerDecision as Record<string, unknown>)
            : null;

    const decisionFrequency = String(
        offerRecord?.frequency ?? effectiveTermsOffer?.frequency ?? "",
    );

    const paymentsPerMonth =
        decisionFrequency === "Daily"
            ? 20
            : decisionFrequency === "Weekly"
              ? 4
              : decisionFrequency === "Bi-Weekly" || decisionFrequency === "BiWeekly"
                ? 2
                : decisionFrequency === "Monthly"
                  ? 1
                  : 0;

    const approvedAmount =
        resolveOfferDecisionFundedAmount(offerRecord) ??
        parseMaybeNumber(offerRecord?.offer) ??
        effectiveTermsOffer?.approvedAmount ??
        0;

    const factorRate = resolveOfferFactorRate({
        offerDecisionRate: parseMaybeNumber(offerRecord?.rate),
        termsFactorRate: effectiveTermsOffer?.factorRate,
        fallback: 1.499,
    });

    const paymentTermStr =
        offerRecord?.term != null ? String(offerRecord.term).trim() : "";
    const paymentTermCount = paymentTermStr ? parseTerm(paymentTermStr) : NaN;

    const termLength =
        parseMaybeNumber(offerRecord?.termLength) ??
        effectiveTermsOffer?.termLength ??
        (Number.isFinite(paymentTermCount) &&
        paymentTermCount > 0 &&
        paymentsPerMonth > 0
            ? Math.round(paymentTermCount / paymentsPerMonth)
            : 0);

    const feesRaw = resolveOfferDecisionFeesRaw(offerRecord);
    const commissionAmount = resolveOfferFeeAmountForDeal({
        fundedAmount: approvedAmount,
        factorRate,
        feesRaw,
        termsCommissionPercent: effectiveTermsOffer?.commissionPercent,
        applicationCommissionPercentage: (applicationData as { commissionPercentage?: unknown })
            ?.commissionPercentage,
    });

    const paybackAmount = resolveOfferPayback(approvedAmount, factorRate, {
        termsPaybackAmount: effectiveTermsOffer?.paybackAmount,
        offerPaybackAmount: parseMaybeNumber(offerRecord?.paybackAmount),
        totalRemit: parseMaybeNumber(offerRecord?.totalRemit),
    });

    const repaymentStack =
        approvedAmount > 0 && paymentTermStr
            ? deriveOfferRepaymentStack({
                  advance: approvedAmount,
                  factorRate,
                  term: paymentTermStr,
                  frequency: decisionFrequency || "Daily",
              })
            : null;

    const numberOfPayments =
        parseMaybeNumber(offerRecord?.numberOfPayments) ??
        (Number.isFinite(paymentTermCount) && paymentTermCount > 0
            ? paymentTermCount
            : termLength > 0 && paymentsPerMonth > 0
              ? termLength * paymentsPerMonth
              : effectiveTermsOffer?.numberOfPayments ?? 0);

    const rawPaymentAmount =
        parseMaybeNumber(offerRecord?.repayPerPeriod) ??
        parseMaybeNumber(offerRecord?.paymentAmount) ??
        parseMaybeNumber(offerRecord?.daysWeeks) ??
        effectiveTermsOffer?.paymentAmount ??
        0;

    const amountFinanced = approvedAmount;
    const refinanceAmountNum = parseMaybeNumber(offerRecord?.refinanceAmount) ?? 0;
    const recipientFunds =
        computeNetToMerchantDollars({
            application: applicationData as unknown as Record<string, unknown> | undefined,
            offerDecision: offerRecord,
            /**
             * Only the wire-fee preference — passing the whole contract would also let its
             * stored amounts outrank the live offer this tab is built from.
             */
            prefill: {
                includeWireFee: resolveIncludeWireFeePreference(
                    undefined,
                    contractRecordForActions,
                )
                    ? "true"
                    : "false",
            },
        }) ?? Math.max(0, approvedAmount - commissionAmount - refinanceAmountNum);
    const feeAmount = commissionAmount;
    const estimatedTotalPayment = repaymentStack?.payback ?? paybackAmount;
    /** Guide: Finance Charge = Total Payback − Contract Amount (not origination fee). */
    const financeChargeAmount =
        estimatedTotalPayment > 0 && amountFinanced > 0
            ? Math.max(
                  0,
                  Math.round((estimatedTotalPayment - amountFinanced) * 100) / 100,
              )
            : 0;

    const ensureAchTemplateLinked = useCallback(
        async (contractId: number) => {
            const res = await axiosGet(`/contract/${contractId}/document-template-mappings`);
            const rows = (res?.data?.data ?? []) as Array<{
                id: string;
                documentType?: string;
                template?: { layoutKey?: string; templateId?: string } | null;
                templateId?: string;
            }>;
            const achRows = rows.filter((row) => {
                const docType = String(row.documentType ?? "").toLowerCase();
                if (docType === "ach") return true;
                const key = String(
                    row.template?.layoutKey ?? row.template?.templateId ?? row.templateId ?? "",
                )
                    .trim()
                    .toLowerCase();
                return isAchAuthorizationLayoutKey(key);
            });
            await Promise.all(
                achRows.slice(1).map((row) =>
                    axiosDelete(`/contract/${contractId}/document-template-mappings/${row.id}`),
                ),
            );
            if (achRows.length > 0) return;
            const templateRef =
                getBoldSignTemplateMappingRef(primaryAchTemplate) ??
                "ach_authorization";
            await axiosPost(`/contract/${contractId}/document-template-mappings`, {
                documentType: "ach",
                templateRef,
            });
        },
        [primaryAchTemplate],
    );

    const ensureContractRecordForAch = useCallback(async (): Promise<number> => {
        const fromSelection = Number(selectedContractId);
        if (Number.isFinite(fromSelection) && fromSelection > 0) return fromSelection;

        const fromFetched = Number((fetchedContract as { id?: unknown } | null)?.id);
        if (Number.isFinite(fromFetched) && fromFetched > 0) {
            setSelectedContractId(fromFetched);
            return fromFetched;
        }

        if (!applicationUuid) {
            throw new Error("Application is required to send the ACH form.");
        }

        const anyApp = applicationData as unknown as Record<string, unknown>;
        const userFromRedux = loginData?.user as { _id?: string; id?: string } | undefined;
        const userFromStorage = (() => {
            if (typeof window === "undefined") return null;
            try {
                return JSON.parse(localStorage.getItem("user") || "null") as {
                    _id?: string;
                    id?: string;
                } | null;
            } catch {
                return null;
            }
        })();
        const createdById =
            userFromRedux?._id ||
            userFromRedux?.id ||
            userFromStorage?._id ||
            userFromStorage?.id ||
            "";
        const offerIdRaw =
            (offerDecision as { id?: unknown; _id?: unknown } | null)?.id ??
            (offerDecision as { id?: unknown; _id?: unknown } | null)?._id;
        const referringIsoId = parseMaybeNumber(
            anyApp?.referringIsoId ??
                (anyApp?.referringISO as { id?: unknown } | undefined)?.id ??
                (anyApp?.referringIso as { id?: unknown } | undefined)?.id,
        );
        const paymentTermsId = parseMaybeNumber(
            (offerDecision as { paymentTermsId?: unknown } | null)?.paymentTermsId ??
                anyApp?.paymentTermsId,
        );
        const paymentBankIdRaw =
            anyApp?.paymentBankId ??
            (anyApp?.paymentBank as { id?: unknown } | undefined)?.id ??
            (anyApp?.bankDetail as { id?: unknown } | undefined)?.id;

        const createRes = await dispatch(
            createContract({
                applicationId: String(applicationUuid),
                clientId:
                    (anyApp?.clientId as string | undefined) ??
                    ((anyApp?.client as { _id?: string; id?: string } | undefined)?._id ||
                        (anyApp?.client as { _id?: string; id?: string } | undefined)?.id),
                referringIsoId: referringIsoId ?? undefined,
                salesRepId: parseMaybeNumber(anyApp?.salesRepId) ?? undefined,
                offerId: offerIdRaw ? String(offerIdRaw) : undefined,
                contractLenght: termLength != null ? Number(termLength) : undefined,
                approvedAmount: approvedAmount != null ? Number(approvedAmount) : undefined,
                totalAmount:
                    estimatedTotalPayment != null ? Number(estimatedTotalPayment) : undefined,
                status: "DRAFT",
                createdById: createdById || undefined,
                paymentTermsId: paymentTermsId ?? undefined,
                paymentBankId: paymentBankIdRaw ? String(paymentBankIdRaw) : undefined,
            }),
        ).unwrap();

        const createdContract =
            (createRes as { data?: Record<string, unknown> } | null)?.data ??
            (createRes as Record<string, unknown> | null);
        let contractId = Number((createdContract as { id?: unknown } | null)?.id);
        if (!Number.isFinite(contractId) || contractId <= 0) {
            const byApp = await dispatch(
                getByApplicationIdContract(String(applicationUuid)),
            ).unwrap();
            const contract = (byApp as { data?: Record<string, unknown> } | null)?.data ?? byApp;
            contractId = Number((contract as { id?: unknown } | null)?.id);
            if (contract && typeof contract === "object") {
                setFetchedContract(contract);
            }
        } else if (createdContract && typeof createdContract === "object") {
            setFetchedContract(createdContract);
        }

        if (!Number.isFinite(contractId) || contractId <= 0) {
            throw new Error("Could not create a contract record for this application.");
        }

        setSelectedContractId(contractId);
        return contractId;
    }, [
        applicationData,
        applicationUuid,
        approvedAmount,
        dispatch,
        estimatedTotalPayment,
        fetchedContract,
        loginData?.user,
        offerDecision,
        selectedContractId,
        termLength,
    ]);

    const estimatedPayment =
        repaymentStack?.perPeriodPayment ??
        (numberOfPayments > 0
            ? Number((estimatedTotalPayment / numberOfPayments).toFixed(2))
            : rawPaymentAmount);

    let lastPayment = estimatedPayment;
    let paymentTotal = estimatedPayment * numberOfPayments;

    if (numberOfPayments > 0) {
        const diff = Number((estimatedTotalPayment - paymentTotal).toFixed(2));
        if (Math.abs(diff) >= 0.01) {
            lastPayment = Number((estimatedPayment + diff).toFixed(2));
            paymentTotal = estimatedPayment * (numberOfPayments - 1) + lastPayment;
        }
    }

    const estimatedMonthlyCost =
        repaymentStack?.monthlyPayment ??
        (estimatedPayment > 0 && paymentsPerMonth > 0
            ? Number((estimatedPayment * paymentsPerMonth).toFixed(2))
            : 0);

    const contractTableMetrics = useMemo(() => {
        const offerDecisionRate = parseMaybeNumber(offerRecord?.rate);
        const buyRateFromOfferDecision =
            offerDecisionRate != null &&
            offerDecisionRate > 0 &&
            offerDecisionRate < 2
                ? offerDecisionRate
                : null;

        const buyRate =
            effectiveTermsOffer?.buyRate ?? buyRateFromOfferDecision ?? null;
        const upsell =
            effectiveTermsOffer?.percentOfGross ??
            effectiveTermsOffer?.commissionPercent ??
            parseMaybeNumber(
                (applicationData as { commissionPercentage?: unknown })
                    ?.commissionPercentage,
            );
        const factor = effectiveTermsOffer?.factorRate ?? factorRate;

        const perPeriodPayment =
            parseMaybeNumber(fetchedContract?.offer?.repayPerPeriod) ??
            repaymentStack?.perPeriodPayment ??
            parseMaybeNumber(offerRecord?.repayPerPeriod) ??
            effectiveTermsOffer?.paymentAmount ??
            estimatedPayment;

        const formatRatePercent = (value: number | null | undefined) => {
            if (value == null || !Number.isFinite(value)) return "—";
            return `${value}%`;
        };

        const formatFactor = (value: number | null | undefined) => {
            if (value == null || !Number.isFinite(value)) return "—";
            return String(value);
        };

        return {
            buyRate: formatRatePercent(buyRate ?? undefined),
            upsell: formatRatePercent(upsell ?? undefined),
            factor: formatFactor(factor ?? undefined),
            perPeriodPayment,
        };
    }, [
        applicationData,
        estimatedPayment,
        effectiveTermsOffer,
        factorRate,
        fetchedContract,
        offerRecord,
        repaymentStack,
    ]);

    // Local editable copies for Final Calculation fields
    const [amountFinancedInput, setAmountFinancedInput] = useState<string>("");
    const [recipientFundsInput, setRecipientFundsInput] = useState<string>("");
    const [refinanceAmountInput, setRefinanceAmountInput] = useState<string>("");
    const [financeChargeInput, setFinanceChargeInput] = useState<string>("");
    const [estimatedTotalPaymentInput, setEstimatedTotalPaymentInput] =
        useState<string>("");
    const [paymentTotalInput, setPaymentTotalInput] = useState<string>("");
    const [estimatedMonthlyCostInput, setEstimatedMonthlyCostInput] =
        useState<string>("");
    const [estimatedPaymentInput, setEstimatedPaymentInput] =
        useState<string>("");
    const [frequencyInput, setFrequencyInput] = useState<string>("");
    const [numberOfPaymentsInput, setNumberOfPaymentsInput] =
        useState<string>("");
    const [termLengthInput, setTermLengthInput] = useState<string>("");
    const [savingContractValues, setSavingContractValues] = useState(false);
    const [isEditingContractValues, setIsEditingContractValues] = useState(false);
    const [savedContractValuesSnapshot, setSavedContractValuesSnapshot] =
        useState<PersistedContractValues | null>(null);

    const getCurrentContractValues = (): PersistedContractValues => ({
        amountFinancedInput,
        recipientFundsInput,
        financeChargeInput,
        estimatedTotalPaymentInput,
        paymentTotalInput,
        estimatedMonthlyCostInput,
        estimatedPaymentInput,
        frequencyInput,
        numberOfPaymentsInput,
        termLengthInput,
    });

    const formatRefinanceAmountDisplay = (raw: unknown): string => {
        const n = parseMaybeNumber(raw);
        if (n == null) return "";
        return formatCurrencyFull(n);
    };

    useEffect(() => {
        // Prefer persisted contract values from backend note; fallback to computed defaults.
        const note = String((applicationData as any)?.note || "");
        const persisted = parseStructuredSection<PersistedContractValues>(
            note,
            CONTRACT_VALUES_SECTION,
        );

        if (persisted) {
            setAmountFinancedInput(String(persisted.amountFinancedInput || ""));
            setRecipientFundsInput(
                String(persisted.recipientFundsInput || "").trim() ||
                    (recipientFunds ? formatCurrencyFull(recipientFunds) : ""),
            );
            setRefinanceAmountInput(formatRefinanceAmountDisplay(offerRecord?.refinanceAmount));
            setFinanceChargeInput(
                financeChargeAmount
                    ? formatCurrencyFull(financeChargeAmount)
                    : String(persisted.financeChargeInput || "").trim(),
            );
            setEstimatedTotalPaymentInput(
                String(persisted.estimatedTotalPaymentInput || ""),
            );
            setPaymentTotalInput(String(persisted.paymentTotalInput || ""));
            setEstimatedMonthlyCostInput(
                String(persisted.estimatedMonthlyCostInput || ""),
            );
            setEstimatedPaymentInput(String(persisted.estimatedPaymentInput || ""));
            setFrequencyInput(String(persisted.frequencyInput || ""));
            setNumberOfPaymentsInput(String(persisted.numberOfPaymentsInput || ""));
            setTermLengthInput(String(persisted.termLengthInput || ""));
            setIsEditingContractValues(false);
            setSavedContractValuesSnapshot(persisted);
            return;
        }

        setIsEditingContractValues(false);
        setSavedContractValuesSnapshot(null);
        setAmountFinancedInput(amountFinanced ? formatCurrencyFull(amountFinanced) : "");
        setRecipientFundsInput(recipientFunds ? formatCurrencyFull(recipientFunds) : "");
        setRefinanceAmountInput(formatRefinanceAmountDisplay(offerRecord?.refinanceAmount));
        setFinanceChargeInput(
            financeChargeAmount ? formatCurrencyFull(financeChargeAmount) : "",
        );
        setEstimatedTotalPaymentInput(
            estimatedTotalPayment ? formatCurrencyFull(estimatedTotalPayment) : "",
        );
        setPaymentTotalInput(paymentTotal ? formatCurrencyFull(paymentTotal) : "");
        setEstimatedMonthlyCostInput(
            estimatedMonthlyCost ? formatCurrencyFull(estimatedMonthlyCost) : "",
        );
        setEstimatedPaymentInput(
            estimatedPayment ? formatCurrencyFull(estimatedPayment) : "",
        );
        setFrequencyInput(decisionFrequency || "");
        setNumberOfPaymentsInput(numberOfPayments ? String(numberOfPayments) : "");
        setTermLengthInput(termLength ? String(termLength) : "");
    }, [
        applicationData,
        amountFinanced,
        recipientFunds,
        financeChargeAmount,
        feeAmount,
        estimatedTotalPayment,
        paymentTotal,
        estimatedMonthlyCost,
        estimatedPayment,
        decisionFrequency,
        numberOfPayments,
        termLength,
        offerRecord?.refinanceAmount,
    ]);

    useEffect(() => {
        // Cached local template only — SignNow / latest-template fetch waits until Preview.
        if (typeof window === "undefined") return;
        try {
            const raw = localStorage.getItem("globalContractTemplate");
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const storedName = String(parsed?.originalName || "");
            if (/pcm|preferred\s*capital/i.test(storedName)) return;
            if (parsed?.url) {
                globalTemplateUrlRef.current = parsed.url as string;
                setGlobalTemplateUrl(parsed.url as string);
                setGlobalTemplateName(
                    sanitizeContractPreviewName(storedName || "Contract.pdf"),
                );
            }
        } catch {
            /* ignore */
        }
    }, []);

    const ensureContractPreviewUrl = async (options?: {
        showButtonSpinner?: boolean;
    }): Promise<string | null> => {
        const cached = globalTemplateUrlRef.current;
        if (cached) return cached;
        const showSpinner = options?.showButtonSpinner !== false;
        if (showSpinner) setLoadingContractPreview(true);
        try {
            const preview = await fetchMainContractTemplatePreview({
                layoutKey: PLATFORM_LAYOUT_KEYS.contract,
                previewName: NITRO_ADVANCE_CONTRACT_PREVIEW_NAME,
            });
            if (!preview?.url) return null;
            globalTemplateUrlRef.current = preview.url;
            setGlobalTemplateUrl(preview.url);
            setGlobalTemplateName(sanitizeContractPreviewName(preview.name));
            return preview.url;
        } finally {
            if (showSpinner) setLoadingContractPreview(false);
        }
    };

    /**
     * Open the PDF viewer for any existing contract on this application — regardless of status.
     * Re-opening a contract that has advanced past DRAFT (SENT/VIEWED/SIGNED/COMPLETED via BoldSign
     * webhooks) must NOT trigger a fresh `createContract` call, because the upsert would overwrite
     * the webhook-driven status back to DRAFT and break the signing flow.
     */
    const openContractViewerImmediately = (options?: {
        contract?: Record<string, unknown> | null;
        rightPaneTab?: "template" | "prefilled";
    }) => {
        const contract = options?.contract ?? null;
        const linkedEnvelopeId = String(
            (contract as { application?: { document?: { envelopeId?: string } } } | null)
                ?.application?.document?.envelopeId ?? "",
        ).trim();
        setPdfName(
            sanitizeContractPreviewName(
                globalTemplateName || NITRO_ADVANCE_CONTRACT_PREVIEW_NAME,
            ),
        );
        setPdfViewerInitialRightPaneTab(
            options?.rightPaneTab ?? (linkedEnvelopeId ? "prefilled" : "template"),
        );
        enableContractSupportData();
        const cachedUrl = globalTemplateUrlRef.current;
        if (cachedUrl) setPdfUrl(cachedUrl);
        setPdfViewerOpen(true);
        void ensureContractPreviewUrl({ showButtonSpinner: false }).then((url) => {
            if (url) setPdfUrl(url);
        });
    };

    const tryOpenExistingDraftViewer = async (): Promise<boolean> => {
        if (!applicationUuid) return false;

        let contract = fetchedContract;
        let byAppContractId = Number((contract as { id?: unknown } | null)?.id);
        if (!Number.isFinite(byAppContractId) || byAppContractId <= 0) {
            try {
                const byApp = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                contract = (byApp as any)?.data ?? byApp;
                byAppContractId = Number((contract as any)?.id);
            } catch {
                return false;
            }
        }
        if (!Number.isFinite(byAppContractId) || byAppContractId <= 0) {
            return false;
        }

        setSelectedContractId(byAppContractId);
        setFetchedContract(contract);
        openContractViewerImmediately({
            contract:
                contract && typeof contract === "object"
                    ? (contract as Record<string, unknown>)
                    : null,
        });
        return true;
    };

    const closeSignedPdfPreview = () => {
        setSignedPdfPreviewOpen(false);
        setSignedPdfPreviewUrl((prev) => {
            if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
            return null;
        });
    };

    const refreshFetchedContract = async () => {
        if (!applicationUuid) return;
        try {
            const res = await dispatch(
                getByApplicationIdContract(String(applicationUuid)),
            ).unwrap();
            const contract = (res as { data?: unknown })?.data ?? res ?? null;
            setFetchedContract(contract);
            const contractId = Number((contract as { id?: unknown })?.id);
            setSelectedContractId(Number.isFinite(contractId) && contractId > 0 ? contractId : null);
        } catch {
            /* ignore */
        }
    };

    const handleViewSignedContract = async (envelopeIdOverride?: string) => {
        if (!applicationUuid) {
            toast.error("Missing application ID.");
            return;
        }

        const envelopeKey = String(envelopeIdOverride ?? "").trim() || null;
        setViewingSignedEnvelopeId(envelopeKey);
        setViewingSignedContract(true);
        try {
            let contract = fetchedContract;
            if (!contract) {
                const byApp = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                contract = (byApp as { data?: unknown })?.data ?? byApp;
                setFetchedContract(contract);
            }

            const contractId = Number((contract as { id?: unknown })?.id);
            if (!Number.isFinite(contractId) || contractId <= 0) {
                toast.info("No contract is available to view.");
                return;
            }

            const envelopeId = String(
                envelopeIdOverride ??
                    (contract as { application?: { document?: { envelopeId?: string } } })
                        ?.application?.document?.envelopeId ??
                    "",
            ).trim();
            if (!envelopeId) {
                toast.error(
                    "No DocuSign envelope found. Refresh contract status after signing completes.",
                );
                return;
            }

            const contractRecord = contract as Record<string, unknown>;
            const sendRows = buildContractSendTableRows(contractRecord);
            const matchingRow =
                sendRows.find(
                    (row) => String(row.envelopeId ?? "").trim() === envelopeId,
                ) ?? null;
            const funderAuth = matchingRow
                ? resolveContractSendRowFunderAuth(contractRecord, matchingRow)
                : {
                      funderName: String(
                          (contract as { funderName?: unknown })?.funderName ?? "",
                      ).trim(),
                      contractState: String(
                          (contract as { state?: unknown })?.state ?? "",
                      ).trim(),
                  };

            const res = await axiosGet(
                `/docusign/download/${encodeURIComponent(envelopeId)}`,
                {
                    responseType: "blob",
                    timeout: 120000,
                    params: {
                        ...(applicationUuid
                            ? { applicationId: String(applicationUuid) }
                            : {}),
                        ...(Number.isFinite(contractId) && contractId > 0
                            ? { contractId }
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
                },
            );
            const blob =
                res.data instanceof Blob
                    ? res.data
                    : new Blob([res.data], { type: "application/pdf" });
            if (!blob.size) {
                toast.error("DocuSign returned an empty PDF.");
                return;
            }

            const objectUrl = URL.createObjectURL(blob);
            const fileLabel = String(
                (applicationData as { applicationId?: unknown })?.applicationId ??
                    applicationUuid,
            ).replace(/[^\w.-]+/g, "_");
            const fileName = `contract-${fileLabel}.pdf`;

            setSignedPdfPreviewUrl((prev) => {
                if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
                return objectUrl;
            });
            setSignedPdfPreviewName(fileName);
            setSignedPdfPreviewOpen(true);
        } catch (err: unknown) {
            const msg =
                (err as { response?: { data?: { message?: string } }; message?: string })
                    ?.response?.data?.message ||
                (err as { message?: string })?.message ||
                "Could not load the contract document.";
            toast.error(String(msg));
        } finally {
            setViewingSignedContract(false);
            setViewingSignedEnvelopeId(null);
        }
    };

    const reloadFetchedContract = useCallback(async () => {
        if (!applicationUuid) return null;
        const res = await dispatch(
            getByApplicationIdContract({ applicationId: String(applicationUuid), fresh: true }),
        ).unwrap();
        const contract = (res as { data?: unknown })?.data ?? res ?? null;
        setFetchedContract(contract);
        const contractId = Number((contract as { id?: unknown })?.id);
        if (Number.isFinite(contractId)) setSelectedContractId(contractId);
        return contract;
    }, [applicationUuid, dispatch]);

    /**
     * The header, progress bar and pipeline stage come from the application
     * detail, not the contract. Reload it whenever the contract's signing state
     * moves, so the deal shows Contract Signed without a page reload.
     */
    const refreshApplicationStage = useCallback(() => {
        refreshApplicationDetailFromServer(dispatch, applicationId, [
            applicationUuid,
            (applicationData as { applicationId?: string | number } | null)?.applicationId,
        ]);
    }, [dispatch, applicationId, applicationUuid, applicationData]);

    const refreshContractEnvelopeStatus = useCallback(
        async (silent?: boolean, options?: { force?: boolean; envelopeId?: string | null }) => {
            const currentEnvelopeId = String(contractEnvelopeDocument?.envelopeId ?? "").trim();
            // A superseded send row refreshes its own envelope; the backend records the
            // result on that send's history entry, not on the current contract.
            const rowEnvelopeId = String(options?.envelopeId ?? "").trim();
            const isSupersededSend = Boolean(rowEnvelopeId) && rowEnvelopeId !== currentEnvelopeId;
            const mainEnvelopeId = isSupersededSend ? rowEnvelopeId : currentEnvelopeId;
            if (!mainEnvelopeId || (!isSupersededSend && contractFullySigned)) {
                if (!silent) setContractSyncError(null);
                return;
            }
            if (isSignNowContractUiEnabled() && !isSignNowEnvelopeId(mainEnvelopeId)) {
                if (!silent) setContractSyncError(null);
                return;
            }

            if (!silent) setRefreshingSigningStatus(true);
            const appId = applicationUuid ? String(applicationUuid) : undefined;
            try {
                const result = await syncDocuSignEnvelopeStatus(mainEnvelopeId, {
                    applicationId: appId,
                    contractId: selectedContractId,
                    force: options?.force,
                    silent,
                    signingFinished: isSupersededSend ? false : contractFullySigned,
                });
                if (result.rateLimited) {
                    if (!silent) {
                        setContractSyncError(
                            "DocuSign polling limit reached for contract. Wait a few minutes or rely on webhook updates.",
                        );
                    }
                } else {
                    setContractSyncError(null);
                }
            } catch (err: unknown) {
                const msg =
                    err instanceof Error ? err.message : "Could not refresh contract status.";
                setContractSyncError(msg);
                if (!silent) toast.error(msg);
            } finally {
                try {
                    await reloadFetchedContract();
                } catch {
                    /* partial sync still useful */
                }
                refreshApplicationStage();
                if (!silent) setRefreshingSigningStatus(false);
            }
        },
        [
            applicationUuid,
            contractEnvelopeDocument?.envelopeId,
            contractFullySigned,
            reloadFetchedContract,
            refreshApplicationStage,
            selectedContractId,
        ],
    );

    const refreshAchEnvelopeStatus = useCallback(
        async (
            silent?: boolean,
            options?: { force?: boolean; envelopeId?: string | null },
        ) => {
            const prefill = (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                ?.contractPrefillOverrides;
            const envelopeBlob = parseDocumentTemplateEnvelopeByMappingId(prefill);
            const aliasId = String(
                envelopeBlob[ACH_PREFILL_MAPPING_ALIAS_KEY]?.envelopeId ?? "",
            ).trim();
            const historyAch = parseDocumentSendHistory(prefill)
                .filter((h) => h.documentKind === "ach")
                .sort((a, b) =>
                    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
                );
            const historyId = String(historyAch[0]?.envelopeId ?? "").trim();
            const achEnvelopeId =
                String(options?.envelopeId ?? "").trim() ||
                String(achAuthorizationDocuSign?.envelopeId ?? "").trim() ||
                aliasId ||
                historyId;
            const mainEnvelopeId = String(contractEnvelopeDocument?.envelopeId ?? "").trim();
            if (!achEnvelopeId || achEnvelopeId === mainEnvelopeId) {
                if (!silent) setAchSyncError(null);
                return;
            }
            if (isSignNowContractUiEnabled() && !isSignNowEnvelopeId(achEnvelopeId)) {
                if (!silent) setAchSyncError(null);
                return;
            }
            const resolvedCapsuleStatus = mapInternalEnvelopeStatusToAchCapsule(
                historyAch.find((h) => String(h.envelopeId ?? "").trim() === achEnvelopeId)
                    ?.status ??
                    envelopeBlob[ACH_PREFILL_MAPPING_ALIAS_KEY]?.status ??
                    achCapsuleStatus,
            );
            if (isAchSigningFinished(resolvedCapsuleStatus)) {
                if (!silent) setAchSyncError(null);
                return;
            }

            if (!silent) setRefreshingSigningStatus(true);
            const appId = applicationUuid ? String(applicationUuid) : undefined;
            try {
                const result = await syncDocuSignEnvelopeStatus(achEnvelopeId, {
                    applicationId: appId,
                    contractId: selectedContractId,
                    force: options?.force,
                    silent,
                    signingFinished: isAchSigningFinished(resolvedCapsuleStatus),
                });
                if (result.rateLimited) {
                    if (!silent) {
                        setAchSyncError(
                            "DocuSign polling limit reached for ACH. Wait a few minutes or rely on webhook updates.",
                        );
                    }
                } else {
                    setAchSyncError(null);
                }
            } catch (err: unknown) {
                const msg =
                    err instanceof Error ? err.message : "Could not refresh ACH status.";
                setAchSyncError(msg);
                if (!silent) toast.error(msg);
            } finally {
                try {
                    await reloadFetchedContract();
                } catch {
                    /* partial sync still useful */
                }
                if (!silent) setRefreshingSigningStatus(false);
            }
        },
        [
            achAuthorizationDocuSign?.envelopeId,
            achCapsuleStatus,
            applicationUuid,
            contractEnvelopeDocument?.envelopeId,
            fetchedContract,
            reloadFetchedContract,
            selectedContractId,
        ],
    );

    const refreshPackageEnvelopeStatus = useCallback(
        async (silent?: boolean, options?: { force?: boolean }) => {
            const packageEnvelopeId = String(standalonePackageDocuSign?.envelopeId ?? "").trim();
            const mainEnvelopeId = String(contractEnvelopeDocument?.envelopeId ?? "").trim();
            if (!packageEnvelopeId || packageEnvelopeId === mainEnvelopeId) {
                if (!silent) setPackageSyncError(null);
                return;
            }
            if (isSignNowContractUiEnabled() && !isSignNowEnvelopeId(packageEnvelopeId)) {
                if (!silent) setPackageSyncError(null);
                return;
            }
            if (isStandalonePackageSigningFinished(packageCapsuleStatus)) {
                if (!silent) setPackageSyncError(null);
                return;
            }

            if (!silent) setRefreshingSigningStatus(true);
            const appId = applicationUuid ? String(applicationUuid) : undefined;
            try {
                const result = await syncDocuSignEnvelopeStatus(packageEnvelopeId, {
                    applicationId: appId,
                    contractId: selectedContractId,
                    force: options?.force,
                    silent,
                    signingFinished: isStandalonePackageSigningFinished(packageCapsuleStatus),
                });
                if (result.rateLimited) {
                    if (!silent) {
                        setPackageSyncError(
                            "DocuSign polling limit reached for supplemental documents. Wait a few minutes or rely on webhook updates.",
                        );
                    }
                } else {
                    setPackageSyncError(null);
                }
            } catch (err: unknown) {
                const msg =
                    err instanceof Error
                        ? err.message
                        : "Could not refresh supplemental document status.";
                setPackageSyncError(msg);
                if (!silent) toast.error(msg);
            } finally {
                try {
                    await reloadFetchedContract();
                } catch {
                    /* partial sync still useful */
                }
                if (!silent) setRefreshingSigningStatus(false);
            }
        },
        [
            applicationUuid,
            contractEnvelopeDocument?.envelopeId,
            packageCapsuleStatus,
            reloadFetchedContract,
            selectedContractId,
            standalonePackageDocuSign?.envelopeId,
        ],
    );

    /** Instant UI when DocuSign Connect webhook updates envelope status. */
    useContractSigningStatusRealtime(applicationUuid, () => {
        void reloadFetchedContract();
    });

    /**
     * Safety net for a missed socket push: while a SignNow contract is out for
     * signature — or signed but its CC copy not yet sent — re-read the contract
     * from the CRM every few seconds. This only reads the CRM database; the
     * backend status job is what asks SignNow. When the signed state or the CC
     * notice flips, the application stage is reloaded too.
     */
    const awaitingSignNowUpdate =
        Boolean(mainContractEnvelopeId) &&
        isSignNowEnvelopeId(String(mainContractEnvelopeId)) &&
        (isContractOutForSignature(fetchedContract as Record<string, unknown> | null) ||
            (contractFullySigned && ccSignedNotice.ccEmails.length > 0 && !ccSignedNoticeSent));
    const signingSnapshotRef = useRef({ signed: contractFullySigned, ccSent: ccSignedNoticeSent });
    useEffect(() => {
        const previous = signingSnapshotRef.current;
        signingSnapshotRef.current = { signed: contractFullySigned, ccSent: ccSignedNoticeSent };
        if (
            (contractFullySigned && !previous.signed) ||
            (ccSignedNoticeSent && !previous.ccSent)
        ) {
            refreshApplicationStage();
        }
    }, [contractFullySigned, ccSignedNoticeSent, refreshApplicationStage]);
    useEffect(() => {
        if (!awaitingSignNowUpdate) return;
        const timer = window.setInterval(() => {
            if (document.visibilityState !== "visible") return;
            void reloadFetchedContract().catch(() => {
                /* next tick retries */
            });
        }, CONTRACT_STATUS_FALLBACK_POLL_MS);
        return () => window.clearInterval(timer);
    }, [awaitingSignNowUpdate, reloadFetchedContract]);

    /**
     * Coming back to the Contract tab re-reads the contract from the CRM, so the
     * Contracts Generated rows and the CC notice reflect what the backend wrote
     * while the user was on another tab. The first visit is covered by the
     * mount fetch above.
     */
    const wasActiveRef = useRef(active);
    useEffect(() => {
        const cameBack = active && !wasActiveRef.current;
        wasActiveRef.current = active;
        if (!cameBack || !applicationUuid) return;
        void reloadFetchedContract().catch(() => {
            /* keep the rows already on screen */
        });
    }, [active, applicationUuid, reloadFetchedContract]);

    /** Header refresh: re-read only the Contracts Generated section (CRM only, no SignNow call). */
    const [refreshingContractsTable, setRefreshingContractsTable] = useState(false);
    const handleRefreshContractsGenerated = useCallback(async () => {
        if (!applicationUuid) return;
        setRefreshingContractsTable(true);
        try {
            await reloadFetchedContract();
        } catch (err: unknown) {
            toast.error(
                typeof err === "string" && err ? err : "Could not refresh contracts.",
            );
        } finally {
            setRefreshingContractsTable(false);
        }
    }, [applicationUuid, reloadFetchedContract]);

    const handleVoidSentEnvelopeRow = async (row: ContractSendTableRow) => {
        const envelopeId = String(row.envelopeId ?? "").trim();
        if (
            !envelopeId ||
            voidingContract ||
            !canVoidContractSendTableRow(contractRecordForActions, row)
        ) {
            return;
        }
        const providerLabel = isSignNowEnvelopeId(envelopeId) || isSignNowContractUiEnabled()
            ? "SignNow"
            : "DocuSign";
        const confirmed = window.confirm(
            `Void "${row.label}" in ${providerLabel}? Signers will no longer be able to sign this document.`,
        );
        if (!confirmed) return;

        setVoidingContract(true);
        try {
            const funderAuth = resolveContractSendRowFunderAuth(contractRecordForActions, row);
            await dispatch(
                voidBoldSignDocument({
                    documentId: envelopeId,
                    reason: "Voided by user from CRM",
                    ...(applicationUuid ? { applicationId: String(applicationUuid) } : {}),
                    ...(selectedContractId != null ? { contractId: selectedContractId } : {}),
                    ...funderAuth,
                }),
            ).unwrap();
            await reloadFetchedContract();
            toast.success(`${row.label} voided in ${providerLabel}.`);
        } catch (err: unknown) {
            const msg =
                typeof err === "string"
                    ? err
                    : String(
                          (err as { message?: string })?.message || "Failed to void document.",
                      );
            toast.error(msg);
        } finally {
            setVoidingContract(false);
        }
    };

    const handleViewAchDocument = async () => {
        const envelopeId = String(achAuthorizationDocuSign?.envelopeId ?? "").trim();
        if (!envelopeId) {
            toast.info("ACH authorization has not been sent via DocuSign yet.");
            return;
        }
        setViewingAchDocument(true);
        try {
            await openAchViewer();
        } finally {
            setViewingAchDocument(false);
        }
    };

    /**
     * `forceNew` is passed by "Resend New Contract": the deal already has a contract row and
     * a sent envelope, so the "re-open what exists" shortcuts below must be skipped and a
     * fresh draft built from the current offer / application / owner values instead.
     */
    const startContractGeneration = async (options?: { forceNew?: boolean }) => {
        const forceNew = options?.forceNew === true;
        enableContractSupportData();
        if (isReadOnly) {
            const opened = await tryOpenExistingDraftViewer();
            if (!opened) {
                toast.info("No contract draft is available to view.");
            }
            return;
        }

        if (creatingEnvelope || regeneratingContract) return;

        if (!applicationUuid) {
            toast.error("Application is missing.");
            return;
        }

        const existingLocalId = Number(
            (fetchedContract as { id?: unknown } | null)?.id ?? selectedContractId,
        );
        const hasLocalContract = Number.isFinite(existingLocalId) && existingLocalId > 0;

        if (needsContractReinitiation) {
            setRegeneratingContract(true);
            try {
                await dispatch(reinitiateContract(String(applicationUuid))).unwrap();
                const byApp = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                const contract = (byApp as { data?: Record<string, unknown> } | null)?.data ?? byApp;
                if (contract && typeof contract === "object") {
                    setFetchedContract(contract);
                    const contractId = Number((contract as { id?: unknown }).id);
                    setSelectedContractId(Number.isFinite(contractId) && contractId > 0 ? contractId : null);
                }
                dispatch(
                    patchApplicationDetail({
                        currentQueue: "Contract Generated",
                        currentState: "CONTRACT_GENERATED",
                        statsCurrentState: "CONTRACT_GENERATED",
                    }),
                );
            } catch (error: unknown) {
                const message =
                    typeof error === "string"
                        ? error
                        : (error as { message?: string })?.message ||
                          "Failed to archive the prior contract before generating a new one.";
                toast.error(String(message));
                return;
            } finally {
                setRegeneratingContract(false);
            }
        } else if (hasLocalContract && !forceNew) {
            // Re-open without waiting on createContract so SENT/VIEWED/SIGNED is never reset to DRAFT.
            openContractViewerImmediately({
                contract:
                    fetchedContract && typeof fetchedContract === "object"
                        ? (fetchedContract as Record<string, unknown>)
                        : null,
            });
            return;
        } else if (!forceNew && !contractLookupDoneRef.current) {
            const reopenedExisting = await tryOpenExistingDraftViewer();
            if (reopenedExisting) return;
        }

        const anyApp = applicationData as any;
        openContractViewerImmediately({ rightPaneTab: "template" });

        const userFromRedux = loginData?.user as { _id?: string; id?: string } | undefined;
        const userFromStorage = (() => {
            if (typeof window === "undefined") return null;
            try {
                return JSON.parse(localStorage.getItem("user") || "null") as {
                    _id?: string;
                    id?: string;
                } | null;
            } catch {
                return null;
            }
        })();

        const createdById =
            userFromRedux?._id ||
            userFromRedux?.id ||
            userFromStorage?._id ||
            userFromStorage?.id ||
            "";
        const offerIdRaw =
            (offerDecision as any)?.id ??
            (offerDecision as any)?._id;
        const referringIsoId = parseMaybeNumber(
            anyApp?.referringIsoId ??
            anyApp?.referringISO?.id ??
            anyApp?.referringIso?.id,
        );
        const paymentTermsId = parseMaybeNumber(
            (offerDecision as any)?.paymentTermsId ??
            anyApp?.paymentTermsId,
        );
        const paymentBankIdRaw =
            anyApp?.paymentBankId ??
            anyApp?.paymentBank?.id ??
            anyApp?.bankDetail?.id;

        setCreatingEnvelope(true);
        try {
            const created = await dispatch(
                createContract({
                    applicationId: String(applicationUuid),
                    clientId: anyApp?.clientId ?? anyApp?.client?._id ?? anyApp?.client?.id,
                    referringIsoId: referringIsoId ?? undefined,
                    salesRepId: parseMaybeNumber(anyApp?.salesRepId) ?? undefined,
                    offerId: offerIdRaw ? String(offerIdRaw) : undefined,
                    contractLenght:
                        termLength != null ? Number(termLength) : undefined,
                    approvedAmount:
                        approvedAmount != null ? Number(approvedAmount) : undefined,
                    totalAmount:
                        estimatedTotalPayment != null
                            ? Number(estimatedTotalPayment)
                            : undefined,
                    status: "DRAFT",
                    createdById: createdById || undefined,
                    paymentTermsId: paymentTermsId ?? undefined,
                    paymentBankId: paymentBankIdRaw
                        ? String(paymentBankIdRaw)
                        : undefined,
                }),
            ).unwrap();

            const createdRow =
                (created as { data?: Record<string, unknown> } | null)?.data ?? created;
            const createdId = Number((createdRow as { id?: unknown } | null)?.id);
            if (Number.isFinite(createdId) && createdId > 0) {
                setSelectedContractId(createdId);
                if (createdRow && typeof createdRow === "object") {
                    setFetchedContract(createdRow);
                }
            } else {
                try {
                    const byApp = await dispatch(
                        getByApplicationIdContract(String(applicationUuid)),
                    ).unwrap();
                    const contract = (byApp as any)?.data ?? byApp;
                    const byAppContractId = Number((contract as any)?.id);
                    setSelectedContractId(
                        Number.isFinite(byAppContractId) && byAppContractId > 0
                            ? byAppContractId
                            : null,
                    );
                    if (contract && typeof contract === "object") {
                        setFetchedContract(contract);
                    }
                } catch {
                    /* contract id may already be set from create response */
                }
            }

            const numericAppId = anyApp?.applicationId;
            if (numericAppId != null || applicationUuid) {
                dispatch(
                    patchApplicationDetail({
                        currentQueue: "Contract Generated",
                        currentState: "CONTRACT_GENERATED",
                        statsCurrentState: "CONTRACT_GENERATED",
                    }),
                );
            }

            if (!globalTemplateUrlRef.current) {
                const templateUrl = await ensureContractPreviewUrl({ showButtonSpinner: false });
                if (templateUrl) {
                    setPdfUrl(templateUrl);
                } else {
                    toast.error(
                        getLastSignNowAgreementError() ||
                            "Could not load the Nitro Advance agreement. Check SignNow credentials and the document-group template ID on the server.",
                    );
                }
            }
        } catch (error: any) {
            // `createContract` is a thunk that rejects via `rejectWithValue(<string>)`, so
            // `.unwrap()` throws a plain string. Fall back to object shapes for other errors.
            const message =
                typeof error === "string"
                    ? error
                    : error?.response?.data?.message ||
                      error?.message ||
                      "Failed to create contract.";
            toast.error(String(message));
        } finally {
            setCreatingEnvelope(false);
        }
    };

    const handleGenerateContract = () => {
        void startContractGeneration();
    };

    /**
     * Archive the contract that is already out, then run the whole generate flow again from
     * the top. The backend drops every cached prefill value with it, so an offer, business
     * or owner detail edited since the first send is what the new SignNow package carries —
     * previously the replacement reused the stored values and went out with the old terms.
     * The prior send stays in Contracts Generated as a history row.
     */
    const handleResendNewContract = async () => {
        if (isReadOnly || !applicationUuid) return;
        if (creatingEnvelope || regeneratingContract) return;
        if (
            typeof window !== "undefined" &&
            !window.confirm(
                "Start a new contract? The contract already sent will be archived in Contracts Generated, and the new one is built from the current offer, application and owner details. Values edited by hand on the prefill form are discarded.",
            )
        ) {
            return;
        }

        setRegeneratingContract(true);
        try {
            await dispatch(
                reinitiateContract({ applicationId: String(applicationUuid), resend: true }),
            ).unwrap();
            // Pull the archived/reset contract and the live application back before rebuilding,
            // so the new draft is seeded from current data rather than the pre-resend cache.
            await dispatch(getApplicationById(String(applicationUuid)));
            const byApp = await dispatch(
                getByApplicationIdContract(String(applicationUuid)),
            ).unwrap();
            const contract = (byApp as { data?: Record<string, unknown> } | null)?.data ?? byApp;
            if (contract && typeof contract === "object") {
                setFetchedContract(contract);
                const contractId = Number((contract as { id?: unknown }).id);
                setSelectedContractId(
                    Number.isFinite(contractId) && contractId > 0 ? contractId : null,
                );
            }
        } catch (error: unknown) {
            const message =
                typeof error === "string"
                    ? error
                    : (error as { message?: string })?.message ||
                      "Failed to archive the sent contract before starting a new one.";
            toast.error(String(message));
            return;
        } finally {
            setRegeneratingContract(false);
        }

        await startContractGeneration({ forceNew: true });
    };

    const getPrimaryRecipientEmail = () =>
        getSignerRecipientEmailForContract(applicationData, fetchedContract);

    const buildPrefillFields = (contractRow?: Record<string, unknown> | null) => {
        const source =
            contractRow ??
            (fetchedContract && typeof fetchedContract === "object"
                ? (fetchedContract as Record<string, unknown>)
                : null);
        const fromContract = stripDocumentTemplateBlobFromPrefillOverrides(
            normalizeContractPrefillOverrides(
                (source as { contractPrefillOverrides?: unknown } | null)?.contractPrefillOverrides,
            ) ?? null,
        );
        const note = String((applicationData as { note?: string })?.note || "");
        const fromNote = parseNoteStructuredSection<Partial<BuildContractPrefillFieldsArgs>>(
            note,
            CONTRACT_PREFILL_OVERRIDES_SECTION,
        );
        const mergedOverrides = mergeContractPrefillOverrideLayers(fromNote, fromContract);
        const overrides =
            Object.keys(mergedOverrides).length > 0 ? mergedOverrides : undefined;
        const recordsForBuild: ContractPrefillContractRecords | undefined = selectedContractId
            ? {
                  ...contractPrefillRecords,
                  contract: source,
              }
            : undefined;
        return buildContractPrefillFieldsFromApplication(applicationForPrefill, {
            agreementDate: formatDateMonthDayYear(new Date()),
            contractRecords: recordsForBuild,
            overrides,
            offerDecision: (offerDecision as Record<string, unknown> | null) ?? null,
        });
    };

    const getPrimaryRecipientName = () =>
        getApplicationPrimaryRecipientName(applicationData);

    const runDocuSignEnvelope = async (
        sendPayload: {
            ccEmails: string[];
            /** CRM document-template row id for optional addendum PDF. */
            addendumDocumentRef?: string | null;
            /** Multiple addendum template refs merged into the envelope (preferred). */
            addendumDocumentRefs?: string[] | null;
            /** @deprecated use addendumDocumentRef */
            addendumBoldSignTemplateId?: string | null;
            /** CRM document-template row id for state disclosure PDF. */
            disclosureDocumentRef?: string | null;
            /** CRM document-template row id for optional ACH PDF. */
            achDocumentRef?: string | null;
            /** When true, envelope contains only the ACH form (no main contract PDF). */
            standaloneAchOnly?: boolean;
            /** When false, send supplemental docs only (no main contract PDF). */
            includeMainContract?: boolean;
            /** Create Contract — which documents are in this envelope. */
            sendPackage?: ContractSendPackageSelection;
            roles?: DocuSignTemplateRolePayload[];
            /** Current funder from contract modal (may not be persisted yet). */
            funderName?: string | null;
            /** CRM funder profile id — resolves funder-specific addendum/disclosure PDFs. */
            funderProfileId?: string | null;
            /** Contract state from modal (may not be persisted yet). */
            contractState?: string | null;
            /** Main contract layout key (Harbor `contract` or `funder_<uuid>`). */
            mainContractLayoutKey?: string | null;
            /** Deal Review values from the contract modal (latest UI state). */
            prefillFields?: Array<{ id: string; value: string }>;
            /**
             * Live "$25 wire fee" preference from the contract modal. It is not a
             * document field, so it cannot ride along in `prefillFields`; without it the
             * money re-sync below falls back to the contract row and silently re-adds $25.
             */
            includeWireFee?: unknown;
            /** Correlation id for SignNow Review timing logs only. */
            timingRequestId?: string;
        },
        options: { autoSend: boolean; suppressSuccessToast?: boolean },
    ): Promise<{
        envelopeId: string;
        prefillTabsApplied?: number;
        prefillFieldCount?: number;
        sendUrl?: string | null;
        embeddedInviteUrl?: string | null;
    }> => {
        enableContractSupportData();
        const failDocuSignEnvelope = (message: string): never => {
            toast.error(message);
            throw new Error(message);
        };

        // `addendumDocumentRef` / `addendumBoldSignTemplateId` are the legacy
        // single-addendum fields and callers still send them alongside the array,
        // where they repeat `addendumDocumentRefs[0]`. Concatenating both used to
        // duplicate that first ref; expandAddendumRefsAllowingDuplicates() silently
        // collapsed the copy for every addendum except Exhibit C, which is allowed
        // to repeat — so SignNow attached an unrequested "Exhibit C (2)".
        // The array wins whenever it is present; the legacy field is the fallback.
        const addendumRefsFromArray = (sendPayload.addendumDocumentRefs || [])
            .map((r) => String(r || "").trim())
            .filter(Boolean);
        const legacyAddendumRef = String(
            sendPayload.addendumDocumentRef ?? sendPayload.addendumBoldSignTemplateId ?? "",
        ).trim();
        const addendumDocumentRefs = addendumRefsFromArray.length
            ? addendumRefsFromArray
            : [legacyAddendumRef].filter(Boolean);
        const disclosureDocumentRef = String(sendPayload.disclosureDocumentRef ?? "").trim();
        const achDocumentRef = String(sendPayload.achDocumentRef ?? "").trim();
        const standaloneAchOnly = sendPayload.standaloneAchOnly === true;
        const includeMainContract = sendPayload.includeMainContract !== false;

        if (achDocumentRef && !standaloneAchOnly) {
            failDocuSignEnvelope(
                "ACH forms are sent individually only. Use Send ACH Form on the Contract tab.",
            );
        }

        if (!applicationUuid) {
            failDocuSignEnvelope("Application is required to send via DocuSign.");
        }
        if (standaloneAchOnly) {
            if (!achDocumentRef) {
                failDocuSignEnvelope("Select an ACH template before sending.");
            }
        } else if (
            includeMainContract &&
            !globalTemplateUrl &&
            !isSignNowContractUiEnabled()
        ) {
            failDocuSignEnvelope(
                "No contract template uploaded. Please upload it from the Final Underwriter dashboard.",
            );
        } else if (!includeMainContract) {
            const supplementalOnlyRefs = [...addendumDocumentRefs, disclosureDocumentRef].filter(
                Boolean,
            );
            if (!supplementalOnlyRefs.length) {
                failDocuSignEnvelope(
                    "Select at least one addendum or state disclosure to send without the main contract.",
                );
            }
        }

        const sendPackageSelection: ContractSendPackageSelection | undefined =
            sendPayload.sendPackage ??
            (standaloneAchOnly
                ? undefined
                : includeMainContract
                  ? {
                        includeMainContract: true,
                        includeAddendum: addendumDocumentRefs.length > 0,
                        includeDisclosure: Boolean(disclosureDocumentRef),
                    }
                  : {
                        includeMainContract: false,
                        includeAddendum: addendumDocumentRefs.length > 0,
                        includeDisclosure: Boolean(disclosureDocumentRef),
                    });

        const userCcEmails = (sendPayload.ccEmails || [])
            .map((e) => String(e).trim())
            .filter(Boolean);
        const resolvedFunderForCc = String(sendPayload.funderName ?? "").trim();
        const funderProfileForSend =
            (sendPayload.funderProfileId
                ? findFunderById(String(sendPayload.funderProfileId).trim())
                : null) ??
            (resolvedFunderForCc ? findFunder(resolvedFunderForCc) : null);
        const envelopeFunderLabel =
            String(resolvedFunderForCc || "").trim() ||
            formatFunderSelectLabel(funderProfileForSend ?? undefined) ||
            DOCUSIGN_EMAIL_LENDER_NAME;
        const funderDefaultCcEmail =
            String(funderProfileForSend?.docusignDefaultCcEmail ?? "").trim() ||
            String(funderProfileForSend?.defaultCcEmail ?? "").trim() ||
            null;
        const effectiveCcEmails = mergeWithDefaultCcEmails(userCcEmails, {
            funderDefaultCcEmail,
        });

        const applicationSignerEmail = getPrimaryRecipientEmail().trim();
        const applicationSignerName = getPrimaryRecipientName();

        setCreatingEnvelope(true);
        try {
            let recipientsPayload: unknown = null;
            const cachedRecipients = store.getState().boldSign?.templateRecipients ?? null;
            const cachedRolesEarly =
                parseBoldSignTemplateRolesFromRecipientsPayload(cachedRecipients);
            if (cachedRolesEarly.length > 0) {
                recipientsPayload = cachedRecipients;
            } else {
                // Platform layouts: roles from code — no DocuSign /templates/.../recipients.
                const ownerRowsForSlots = resolveOwnerRowsForContractPrefill(
                    applicationForPrefill,
                    Array.isArray(contractOwnerListState.data)
                        ? contractOwnerListState.data
                        : [],
                );
                recipientsPayload = {
                    success: true,
                    source: "platform-layout",
                    roles: getPlatformSignerRoleRows(Math.max(1, ownerRowsForSlots.length || 1)),
                };
            }

            let templateRoles =
                parseBoldSignTemplateRolesFromRecipientsPayload(
                    recipientsPayload,
                );
            if (templateRoles.length === 0) {
                const cached =
                    store.getState().boldSign?.templateRecipients ?? null;
                templateRoles =
                    parseBoldSignTemplateRolesFromRecipientsPayload(cached);
            }

            let latestContract: any = fetchedContract;
            const openSignNowFast =
                isSignNowContractUiEnabled() && !standaloneAchOnly;
            /**
             * Always re-read the contract row before building the send payload.
             *
             * `fetchedContract` is ContractTab state; saving Verify Prefill happens inside
             * PDFViewerModal and only refreshes that modal's copy, so this row can be an
             * older snapshot. Everything below (prefill build, the live-offer money
             * re-sync, signer overrides) keys off it, which is how an unchecked $25 wire
             * fee and a corrected Net Amount came back as the pre-edit values in SignNow.
             * The SignNow fast path used to skip this GET for latency; the DB row is the
             * source of truth for contract generation, so it pays the one request.
             */
            try {
                // `fresh`: an Info Required / addendum save made moments ago must be
                // what Review builds from, not the cached pre-save row.
                const refreshed = await dispatch(
                    getByApplicationIdContract({
                        applicationId: String(applicationUuid),
                        fresh: true,
                    }),
                ).unwrap();
                const c = (refreshed as any)?.data ?? refreshed;
                if (c) {
                    latestContract = c;
                    setFetchedContract(c);
                }
            } catch {
                /* use fetchedContract */
            }

            const contractNumericIdForPersist = Number((latestContract as { id?: unknown })?.id);
            if (
                !openSignNowFast &&
                Number.isFinite(contractNumericIdForPersist) &&
                contractNumericIdForPersist > 0
            ) {
                const persistFunder = persistContractFunderMeta(
                    contractNumericIdForPersist,
                    {
                        funderName: sendPayload.funderName,
                        state: sendPayload.contractState,
                    },
                    latestContract as Record<string, unknown>,
                );
                await persistFunder;
                try {
                    const refreshedAfterMeta = await dispatch(
                        getByApplicationIdContract({
                            applicationId: String(applicationUuid),
                            fresh: true,
                        }),
                    ).unwrap();
                    const refreshedContract =
                        (refreshedAfterMeta as { data?: unknown })?.data ?? refreshedAfterMeta;
                    if (refreshedContract) {
                        latestContract = refreshedContract;
                        setFetchedContract(refreshedContract);
                    }
                } catch {
                    /* use latestContract */
                }
            }

            const signerOverridesFromContract = parseContractSignerOverridesFromPrefill(
                (latestContract as { contractPrefillOverrides?: unknown })
                    ?.contractPrefillOverrides,
            );

            let roles = resolveDocuSignRolesForEnvelopeSend({
                payloadRoles: sendPayload.roles,
                contractSignerOverrides: signerOverridesFromContract,
                templateRoles,
                applicationSignerEmail,
                applicationSignerName,
            });

            const ownerRows = resolveOwnerRowsForContractPrefill(
                applicationForPrefill,
                Array.isArray(contractOwnerListState.data)
                    ? contractOwnerListState.data
                    : [],
            );
            const ownerParties = resolveOwnerPartiesForContractSigners(
                applicationForPrefill,
                Array.isArray(contractOwnerListState.data)
                    ? contractOwnerListState.data
                    : [],
                null,
            );
            const ensuredSignerRows = ensureSignerRowsFromCrmOwners(
                roles.map((r) => ({
                    role: r.signerRole,
                    name: r.signerName,
                    email: r.signerEmail,
                })),
                ownerParties,
            );
            if (ensuredSignerRows.length) {
                roles = buildDocuSignRolesFromEditorRows(ensuredSignerRows);
            }
            /** Application owners keep Seller #2 / Guarantor #2 when a second owner exists. */
            const ownerCount = resolveActiveOwnerCount({
                owners: ownerRows,
                signerRoles: roles,
            });
            const secondOwnerNameBeforeCollapse = resolveSecondOwnerSignerName(
                roles,
                ownerCount,
                ownerRows,
            );
            roles = collapseDocuSignRolesToSignerSlots(roles, ownerCount, ownerRows);

            if (roles.length === 0) {
                failDocuSignEnvelope(
                    "Could not resolve any DocuSign signers. Add a client email on this application.",
                );
            }

            const missingEmailIndexes = roles
                .map((role, i) =>
                    String(role.signerEmail || "").trim() ? -1 : i,
                )
                .filter((i) => i >= 0);
            if (missingEmailIndexes.length > 0) {
                failDocuSignEnvelope(
                    `Signer role(s) missing email (roles ${missingEmailIndexes
                        .map((i) => i + 1)
                        .join(
                            ", ",
                        )}). Add signer emails in CRM (Manage Signers) or a client email on this application.`,
                );
            }

            const primarySignerEmail = String(roles[0]?.signerEmail || "").trim();
            let prefillFieldsPayload: ContractPrefillField[] = buildPrefillFields(latestContract);
            if (sendPayload.prefillFields?.length) {
                const overlay = new Map(
                    sendPayload.prefillFields
                        .filter((f) => String(f.id || "").trim() && String(f.value || "").trim())
                        .map((f) => [String(f.id).trim(), String(f.value).trim()]),
                );
                prefillFieldsPayload = prefillFieldsPayload.map((field) =>
                    overlay.has(field.id)
                        ? { ...field, value: overlay.get(field.id)! }
                        : field,
                );
                for (const [id, value] of overlay.entries()) {
                    if (!prefillFieldsPayload.some((field) => field.id === id)) {
                        prefillFieldsPayload.push({ id, label: id, value });
                    }
                }
            }
            /**
             * Final Calculation / live OfferDecision money must match Verify Prefill on every
             * DocuSign data label — re-sync after modal overlay in case base rebuild was stale.
             */
            {
                const includeWireFeeForSend = resolveIncludeWireFeePreference(
                    sendPayload.includeWireFee,
                    (latestContract as Record<string, unknown> | null | undefined) ?? null,
                )
                    ? "true"
                    : "false";
                const moneySynced = applyLiveOfferSyncToPrefillPartial(
                    contractPrefillFieldsToPartial(prefillFieldsPayload, {
                        includeWireFee: includeWireFeeForSend,
                    }),
                    applicationData,
                    (offerDecision as Record<string, unknown> | null) ?? null,
                    {
                        contract:
                            (latestContract as Record<string, unknown> | null | undefined) ?? null,
                        /**
                         * `prefillFields` carries document ids only, so the partial never has
                         * `includeWireFee`. Left unset this overlay resolved the preference as
                         * "on", re-added $25 to origination, and — because the result then
                         * differed from the saved Net Amount — force-overwrote the corrected
                         * net that Verify Prefill had just persisted.
                         */
                        includeWireFee: includeWireFeeForSend,
                    },
                );
                prefillFieldsPayload = mergeSyncedPartialIntoPrefillFields(
                    prefillFieldsPayload,
                    moneySynced,
                );
            }
            if (primarySignerEmail) {
                prefillFieldsPayload = prefillFieldsPayload.map((field) =>
                    field.id === "client_email" || field.id === "customer_email"
                        ? { ...field, value: primarySignerEmail }
                        : field,
                );
            }

            const redirectUrlDocusign = isSignNowContractUiEnabled()
                ? signNowEmbeddedReturnUrl()
                : typeof window !== "undefined"
                  ? window.location.href
                  : "https://www.docusign.com";

            const docuSignClientName =
                resolveBalanceTransferMerchantContext(latestContract, applicationData)
                    .clientName.trim() ||
                applicationSignerName.trim() ||
                "Client";
            const docuSignBusinessName =
                resolveBalanceTransferMerchantContext(latestContract, applicationData)
                    .businessName.trim() || docuSignClientName;
            const docuSignEmailSubject = standaloneAchOnly
                ? buildAchFormEnvelopeEmailSubject(
                      docuSignBusinessName,
                      approvedAmount,
                      envelopeFunderLabel,
                  )
                : sendPackageSelection
                  ? buildPackageEnvelopeEmailSubject(
                        docuSignBusinessName,
                        sendPackageSelection,
                        approvedAmount,
                        envelopeFunderLabel,
                    )
                  : buildDocuSignEnvelopeEmailSubject(
                        docuSignClientName,
                        approvedAmount,
                        envelopeFunderLabel,
                    );
            const docuSignEmailMessage = standaloneAchOnly
                ? `Please review and sign the ACH authorization form with ${envelopeFunderLabel}.`
                : sendPackageSelection
                  ? buildPackageEnvelopeEmailMessage(
                        docuSignBusinessName,
                        sendPackageSelection,
                        envelopeFunderLabel,
                    )
                  : `Please review and sign your agreement with ${envelopeFunderLabel}.`;

            // Keep Exhibit C × N (same layout key / template id). Set() was collapsing
            // duplicates so SignNow only attached one Exhibit C.
            const supplementalDocumentRefs = standaloneAchOnly
                ? []
                : expandAddendumRefsAllowingDuplicates([
                      ...addendumDocumentRefs,
                      disclosureDocumentRef,
                  ].filter(Boolean));
            const mergedTemplateIdsForPrefill = standaloneAchOnly
                ? [achDocumentRef]
                : supplementalDocumentRefs;

            const firstOwnerFromDb = ownerRows[0] as {
                firstName?: string;
                lastName?: string;
                ssnNumber?: string;
                ssn?: string;
                driverLicenseNumber?: string;
                driverLicense?: string;
            } | undefined;
            const secondOwnerFromDb = ownerRows[1] as {
                firstName?: string;
                lastName?: string;
                email?: string;
                ownerEmail?: string;
                mobileNumber?: string;
                phone?: string;
                mobile?: string;
                address1?: string;
                address?: string | { address1?: string; city?: string; state?: string; zipCode?: string };
                city?: string;
                state?: string;
                zip?: string;
                zipCode?: string;
                ssnNumber?: string;
                ssn?: string;
                driverLicenseNumber?: string;
                driverLicense?: string;
            } | undefined;
            const secondOwnerAddr =
                secondOwnerFromDb?.address && typeof secondOwnerFromDb.address === "object"
                    ? secondOwnerFromDb.address
                    : null;
            const secondOwnerContact = {
                secondOwnerEmail: String(
                    secondOwnerFromDb?.email || secondOwnerFromDb?.ownerEmail || "",
                ).trim(),
                secondOwnerPhone: String(
                    secondOwnerFromDb?.mobileNumber ||
                        secondOwnerFromDb?.phone ||
                        secondOwnerFromDb?.mobile ||
                        "",
                ).trim(),
                secondOwnerAddress: [
                    String(
                        secondOwnerFromDb?.address1 ||
                            secondOwnerAddr?.address1 ||
                            (typeof secondOwnerFromDb?.address === "string"
                                ? secondOwnerFromDb.address
                                : ""),
                    ).trim(),
                    String(secondOwnerFromDb?.city || secondOwnerAddr?.city || "").trim(),
                    String(secondOwnerFromDb?.state || secondOwnerAddr?.state || "").trim(),
                    String(
                        secondOwnerFromDb?.zip ||
                            secondOwnerFromDb?.zipCode ||
                            secondOwnerAddr?.zipCode ||
                            "",
                    ).trim(),
                ]
                    .filter(Boolean)
                    .join(", "),
                secondOwnerTitle: "OWNER" as const,
            };
            const primaryOwnerName =
                `${String(firstOwnerFromDb?.firstName || "").trim()} ${String(firstOwnerFromDb?.lastName || "").trim()}`.trim() ||
                docuSignClientName;
            prefillFieldsPayload = applyPrimaryGuarantorNamesToPrefillFields(
                prefillFieldsPayload,
                primaryOwnerName,
                {
                    primarySs: String(
                        firstOwnerFromDb?.ssnNumber || firstOwnerFromDb?.ssn || "",
                    ).trim(),
                    primaryDriverLicense: String(
                        firstOwnerFromDb?.driverLicenseNumber ||
                            firstOwnerFromDb?.driverLicense ||
                            "",
                    ).trim(),
                },
            );

            const secondOwnerName =
                secondOwnerNameBeforeCollapse ||
                String(
                    roles.find((r) => /owner\s*2/i.test(String(r.signerRole || "")))?.signerName ||
                        "",
                ).trim() ||
                resolveOwnerRowFullName(secondOwnerFromDb);
            prefillFieldsPayload = applySecondOwnerNameToPrefillFields(prefillFieldsPayload, {
                ownerCount,
                secondOwnerName,
                secondOwnerSs: String(
                    secondOwnerFromDb?.ssnNumber || secondOwnerFromDb?.ssn || "",
                ).trim(),
                secondOwnerDriverLicense: String(
                    secondOwnerFromDb?.driverLicenseNumber ||
                        secondOwnerFromDb?.driverLicense ||
                        "",
                ).trim(),
                ...secondOwnerContact,
            });
            prefillFieldsPayload = clearParty2PrefillFieldPayload(
                prefillFieldsPayload,
                ownerCount,
            );

            try {
                const contractNumericId = Number((latestContract as { id?: unknown })?.id);
                const rawOverrides = (latestContract as { contractPrefillOverrides?: unknown })
                    ?.contractPrefillOverrides;
                const mainOverrides = normalizeContractPrefillOverrides(rawOverrides);
                const mainPrefillForTemplates = mainOverrides
                    ? (() => {
                          const o = { ...mainOverrides } as Record<string, unknown>;
                          delete o[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
                          return o as Partial<BuildContractPrefillFieldsArgs>;
                      })()
                    : null;
                let mapRows: Array<{
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
                }> = [];
                if (Number.isFinite(contractNumericId)) {
                    const mapRes = await axiosGet(
                        `/contract/${contractNumericId}/document-template-mappings`,
                    );
                    mapRows = (mapRes?.data?.data ?? []) as typeof mapRows;
                    const mergedLayoutKeysForPrefill = supplementalDocumentRefs.filter((ref) =>
                        /balance_transfer|flex_addendum|pre_payment_addendum|ach_authorization|ach_daily|ach_weekly|exhibit_c|exhibit_a|payoff_addendum|monthly_fee|\bepa\b|signnow_disclosure/i.test(
                            ref,
                        ),
                    );
                    prefillFieldsPayload = applyDocumentTemplateMappingPrefillOverrides({
                        prefillFieldsPayload,
                        mergedTemplateIds: mergedTemplateIdsForPrefill,
                        mergedLayoutKeys: mergedLayoutKeysForPrefill,
                        templateMappingRows: Array.isArray(mapRows) ? mapRows : [],
                        contractPrefillOverridesRaw: rawOverrides,
                        contract: latestContract as Record<string, unknown>,
                        application: applicationData as unknown as Record<string, unknown>,
                        agreementDate: formatDateMonthDayYear(new Date()),
                        mainPrefillOverrides: mainPrefillForTemplates,
                        bankDetail: contractPrefillRecords.bankDetail ?? null,
                        ach: contractPrefillRecords.ach ?? null,
                    });
                }

                // Standalone ACH: always apply the stable ACH edit alias + camelCase overrides.
                // Platform ACH often has no contract mapping row, so the loop above skips them.
                if (standaloneAchOnly) {
                    const achBlob = parseDocumentTemplatePrefillByMappingId(rawOverrides);
                    const achSaved = resolveAchSavedMappingOverrides(achBlob, null);
                    const achFromCamel = achCamelPartialToTabValues(mainPrefillForTemplates);
                    const achTabs = { ...achFromCamel, ...achSaved };
                    // These signature-block fields are canonical and must not be
                    // replaced by stale manually saved ACH values.
                    for (const id of [
                        "authorization_client_signer_name",
                        "authorization_client_name_print",
                    ] as const) {
                        const canonicalValue = String(achFromCamel[id] ?? "").trim();
                        if (canonicalValue) achTabs[id] = canonicalValue;
                    }
                    const byId = new Map(
                        prefillFieldsPayload.map((f) => [f.id, { ...f }]),
                    );
                    for (const [id, value] of Object.entries(achTabs)) {
                        const v = String(value ?? "").trim();
                        if (!id || !v) continue;
                        const existing = byId.get(id);
                        byId.set(
                            id,
                            existing
                                ? { ...existing, value: v }
                                : { id, label: id, value: v },
                        );
                        // Also seed CRM-scoped envelope labels used after coordinate scoping.
                        const texas = /ach_authorization_texas|texas_ach/i.test(achDocumentRef);
                        const scopedId = `${texas ? "ach_form_texas_" : "ach_form_"}${id}`;
                        if (!byId.has(scopedId)) {
                            byId.set(scopedId, { id: scopedId, label: scopedId, value: v });
                        }
                    }
                    prefillFieldsPayload = Array.from(byId.values());
                }

                prefillFieldsPayload = mergeStateDisclosurePrefillFallback({
                    payload: prefillFieldsPayload,
                    supplementalRefs: supplementalDocumentRefs,
                    contract: latestContract as Record<string, unknown>,
                    application: applicationData as unknown as Record<string, unknown>,
                    agreementDate: formatDateMonthDayYear(new Date()),
                    mainPrefillOverrides: mainPrefillForTemplates,
                    contractPrefillOverridesRaw: rawOverrides,
                    templateMappingRows: mapRows,
                    bankDetail: contractPrefillRecords.bankDetail ?? null,
                    ach: contractPrefillRecords.ach ?? null,
                });
                prefillFieldsPayload = mergeSignNowSupplementalPrefillFallback({
                    payload: prefillFieldsPayload,
                    supplementalRefs: supplementalDocumentRefs,
                    contract: latestContract as Record<string, unknown>,
                    application: applicationData as unknown as Record<string, unknown>,
                    agreementDate: formatDateMonthDayYear(new Date()),
                    mainPrefillOverrides: mainPrefillForTemplates,
                    contractPrefillOverridesRaw: rawOverrides,
                    templateMappingRows: mapRows,
                    bankDetail: contractPrefillRecords.bankDetail ?? null,
                    ach: contractPrefillRecords.ach ?? null,
                });
                const exhibitCJson = serializeExhibitCEntities(
                    mergeExhibitCEntitiesForSignNowSend({
                        rawOverrides,
                        mappingRows: mapRows,
                    }),
                );
                if (exhibitCJson) {
                    const existingEntities = prefillFieldsPayload.find(
                        (f) => f.id === EXHIBIT_C_ENTITIES_PREFILL_KEY,
                    );
                    if (existingEntities) {
                        existingEntities.value = exhibitCJson;
                    } else {
                        prefillFieldsPayload.push({
                            id: EXHIBIT_C_ENTITIES_PREFILL_KEY,
                            label: "Exhibit C entities",
                            value: exhibitCJson,
                        });
                    }
                }
            } catch (mapErr) {
                console.warn("[ContractTab] document template mapping prefill skipped:", mapErr);
            }

            if (!standaloneAchOnly && includeMainContract) {
                prefillFieldsPayload = applyPrimaryGuarantorNamesToPrefillFields(
                    prefillFieldsPayload,
                    primaryOwnerName,
                    {
                        primarySs: String(
                            firstOwnerFromDb?.ssnNumber || firstOwnerFromDb?.ssn || "",
                        ).trim(),
                        primaryDriverLicense: String(
                            firstOwnerFromDb?.driverLicenseNumber ||
                                firstOwnerFromDb?.driverLicense ||
                                "",
                        ).trim(),
                    },
                );
                prefillFieldsPayload = applySecondOwnerNameToPrefillFields(prefillFieldsPayload, {
                    ownerCount,
                    secondOwnerName:
                        secondOwnerNameBeforeCollapse ||
                        String(
                            roles.find((r) => /owner\s*2/i.test(String(r.signerRole || "")))
                                ?.signerName || "",
                        ).trim() ||
                        resolveOwnerRowFullName(secondOwnerFromDb),
                    secondOwnerSs: String(
                        secondOwnerFromDb?.ssnNumber || secondOwnerFromDb?.ssn || "",
                    ).trim(),
                    secondOwnerDriverLicense: String(
                        secondOwnerFromDb?.driverLicenseNumber ||
                            secondOwnerFromDb?.driverLicense ||
                            "",
                    ).trim(),
                    ...secondOwnerContact,
                });
                prefillFieldsPayload = clearParty2PrefillFieldPayload(
                    prefillFieldsPayload,
                    ownerCount,
                );

                const syncedPartial = applySeparatedAddressPrefillFields(
                    applyClientPersonNamePrefillFields(
                        // Keep the saved "$25 wire fee" preference: this partial is persisted
                        // back onto the contract, so a wrong un-grossing sticks.
                        contractPrefillFieldsToPartial(prefillFieldsPayload, {
                            includeWireFee: resolveIncludeWireFeePreference(
                                sendPayload.includeWireFee,
                                (latestContract as Record<string, unknown> | null | undefined) ??
                                    null,
                            )
                                ? "true"
                                : "false",
                        }),
                        applicationData,
                    ),
                    applicationData,
                );
                prefillFieldsPayload = mergeSyncedPartialIntoPrefillFields(
                    prefillFieldsPayload,
                    syncedPartial,
                );

                const contractNumericIdPersist = Number((latestContract as { id?: unknown })?.id);
                if (
                    !openSignNowFast &&
                    Number.isFinite(contractNumericIdPersist) &&
                    contractNumericIdPersist > 0
                ) {
                    const persistPrefill = async () => {
                        const rawOverrides = (latestContract as { contractPrefillOverrides?: unknown })
                            ?.contractPrefillOverrides;
                        const mainOverrides = stripDocumentTemplateBlobFromPrefillOverrides(
                            normalizeContractPrefillOverrides(rawOverrides) ?? {},
                        ) as Record<string, unknown>;
                        const columnUpdate = contractPrefillToContractColumnUpdate(syncedPartial);
                        const nextOverrides = {
                            ...pickPreservedDocuSignEnvelopeMetaFromPrefill(rawOverrides),
                            ...mergeContractPrefillOverrideLayers(
                                mainOverrides as Partial<BuildContractPrefillFieldsArgs>,
                                syncedPartial,
                            ),
                        };
                        await dispatch(
                            updateContract({
                                id: contractNumericIdPersist,
                                data: {
                                    ...columnUpdate,
                                    approvedAmount:
                                        approvedAmount != null
                                            ? Number(approvedAmount)
                                            : undefined,
                                    totalAmount:
                                        estimatedTotalPayment != null
                                            ? Number(estimatedTotalPayment)
                                            : undefined,
                                    contractPrefillOverrides: nextOverrides,
                                },
                            }),
                        ).unwrap();
                        setFetchedContract({
                            ...(latestContract as Record<string, unknown>),
                            ...columnUpdate,
                            approvedAmount:
                                approvedAmount != null
                                    ? Number(approvedAmount)
                                    : (latestContract as { approvedAmount?: unknown })
                                          ?.approvedAmount,
                            totalAmount:
                                estimatedTotalPayment != null
                                    ? Number(estimatedTotalPayment)
                                    : (latestContract as { totalAmount?: unknown })
                                          ?.totalAmount,
                            contractPrefillOverrides: nextOverrides,
                        });
                        await syncContractPrefillToSourceRecords({
                            dispatch,
                            applicationData,
                            applicationUuid: String(applicationUuid || ""),
                            prefill: syncedPartial,
                            offerDecision:
                                (offerDecision as Record<string, unknown> | null) ?? null,
                            contractGuarantors: contractPrefillRecords.guarantors ?? null,
                            contractOwners: contractPrefillRecords.owners ?? null,
                            contractAch:
                                (contractPrefillRecords.ach as Record<string, unknown> | null) ??
                                null,
                            bankDetail: contractPrefillRecords.bankDetail ?? null,
                        });
                    };
                    try {
                        await persistPrefill();
                    } catch (persistErr) {
                        console.warn("[ContractTab] persist synced contract prefill failed:", persistErr);
                    }
                }
            }

            const contractNumericIdForSend = Number((latestContract as { id?: unknown })?.id);
            const resolvedFunderName =
                sendPayload.funderName ??
                (latestContract as { funderName?: string | null })?.funderName ??
                null;
            const contractStateForSend =
                String(sendPayload.contractState ?? "").trim() ||
                String((latestContract as { state?: string | null })?.state ?? "").trim() ||
                undefined;
            const mainContractLayoutKey =
                String(sendPayload.mainContractLayoutKey ?? "").trim() ||
                resolveLayoutKey(
                    resolvedFunderName,
                    sendPayload.funderProfileId,
                );
            const funderProfileForPrefill =
                funderProfileForSend ??
                (sendPayload.funderProfileId
                    ? findFunderById(String(sendPayload.funderProfileId).trim())
                    : null) ??
                (resolvedFunderName ? findFunder(String(resolvedFunderName).trim()) : null);
            const funderPlainName = formatFunderSelectLabel(
                funderProfileForPrefill ?? undefined,
            );
            applyFunderDisclosureContactPrefill(
                prefillFieldsPayload,
                funderProfileForPrefill,
                { funderDisplayName: funderPlainName || resolvedFunderName },
            );
            const funderNameWithDealPrefix = formatFunderNameWithDealIdPrefix(
                funderProfileForPrefill?.name ?? resolvedFunderName,
                funderProfileForPrefill?.dealIdPrefix,
                funderProfileForPrefill?.displayName,
            );
            if (funderNameWithDealPrefix) {
                const existing = prefillFieldsPayload.find(
                    (f) => f.id === "funder_name_with_deal_prefix",
                );
                if (existing) {
                    existing.value = funderNameWithDealPrefix;
                } else {
                    prefillFieldsPayload.push({
                        id: "funder_name_with_deal_prefix",
                        label: "Funder name (Deal ID prefix)",
                        value: funderNameWithDealPrefix,
                    });
                }
            }
            const caseTakeoverInPackage = (supplementalDocumentRefs || []).some((ref) =>
                /case_takeover/i.test(String(ref || "")),
            );
            if (caseTakeoverInPackage && (funderPlainName || resolvedFunderName)) {
                const selectedLabel =
                    String(funderPlainName || resolvedFunderName || "").trim();
                for (const id of ["case_takeover_addendum_funder_name", "funder_name"] as const) {
                    const existing = prefillFieldsPayload.find((f) => f.id === id);
                    if (existing) {
                        existing.value = selectedLabel;
                    } else {
                        prefillFieldsPayload.push({
                            id,
                            label: id === "funder_name" ? "Funder name" : "Funder Name",
                            value: selectedLabel,
                        });
                    }
                }
            }
            prefillFieldsPayload = applyTexasContractUsdMoneyToPrefillFields(
                prefillFieldsPayload,
                {
                    funderName:
                        funderProfileForPrefill?.name ||
                        resolvedFunderName ||
                        funderPlainName,
                    state: contractStateForSend,
                    layoutKey: mainContractLayoutKey,
                },
            );
            const dealBusinessName = resolveContractBusinessLegalNameForPrefill(
                latestContract as Record<string, unknown>,
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
                    const existing = prefillFieldsPayload.find((f) => f.id === id);
                    if (existing) existing.value = dealBusinessName;
                    else {
                        prefillFieldsPayload.push({
                            id,
                            label: id,
                            value: dealBusinessName,
                        });
                    }
                }
            }
            const todayPrefillDate = `${String(new Date().getMonth() + 1).padStart(2, "0")}/${String(new Date().getDate()).padStart(2, "0")}/${new Date().getFullYear()}`;
            const sendDayDateIds = [
                "agreement_date",
                "agreement_date_p1",
                "signature_date",
                "signature_date2",
                "signature1_date",
                "signature2_date",
                "disclosure_date",
                "disclosure_date2",
                "remittance_start_date",
            ] as const;
            for (const id of sendDayDateIds) {
                const existing = prefillFieldsPayload.find((f) => f.id === id);
                if (existing) {
                    existing.value = todayPrefillDate;
                } else {
                    prefillFieldsPayload.push({
                        id,
                        label: id,
                        value: todayPrefillDate,
                    });
                }
            }
            for (const field of prefillFieldsPayload) {
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
            prefillFieldsPayload = uppercaseContractDocumentPrefillFields(prefillFieldsPayload);
            const mergeRequest = {
                ...(standaloneAchOnly
                    ? {
                          standaloneDocumentRefs: [achDocumentRef],
                          skipApplicationEnvelopeLink: true,
                          // Required so backend links into achAuthorizationDocuSign (not package).
                          includeMainContract: false,
                          funderName: resolvedFunderName
                              ? String(resolvedFunderName).trim()
                              : undefined,
                          funderProfileId: sendPayload.funderProfileId
                              ? String(sendPayload.funderProfileId).trim()
                              : undefined,
                          contractState: contractStateForSend,
                      }
                    : {
                          supplementalDocumentRefs,
                          includeMainContract,
                          mainContractLayoutKey,
                          funderName: resolvedFunderName ? String(resolvedFunderName).trim() : undefined,
                          funderProfileId: sendPayload.funderProfileId
                              ? String(sendPayload.funderProfileId).trim()
                              : undefined,
                          contractState: contractStateForSend,
                          ...(sendPackageSelection ? { sendPackage: sendPackageSelection } : {}),
                          ...(!includeMainContract ? { skipApplicationEnvelopeLink: true } : {}),
                      }),
                ownerCount,
                roles,
                prefillFields: prefillFieldsPayload,
                applicationId: String(applicationUuid),
                contractId:
                    Number.isFinite(contractNumericIdForSend) && contractNumericIdForSend > 0
                        ? contractNumericIdForSend
                        : undefined,
                redirectUrl: redirectUrlDocusign,
                showToolbar: true,
                sendViewOption: "PreparePage",
                showSaveButton: true,
                showSendButton: true,
                showPreviewButton: true,
                showNavigationButtons: true,
                ccEmails: effectiveCcEmails,
                autoSend: options.autoSend,
                title: docuSignEmailSubject,
                message: docuSignEmailMessage,
                ...(String(sendPayload.timingRequestId || "").trim()
                    ? { timingRequestId: String(sendPayload.timingRequestId).trim() }
                    : {}),
                /**
                 * The live "$25 wire fee" checkbox. It is a deal-level preference, not a
                 * document field, so it cannot ride along in `prefillFields` — and the
                 * server otherwise resolves it from the contract row, which still says
                 * "on" until the prefill editor has been saved. Sending it keeps TOTAL
                 * FEES and NET AMOUNT on every document in step with the box.
                 *
                 * The fallback is the row re-read above, as for the money re-sync:
                 * `contractRecordForActions` is this render's snapshot and can predate
                 * an unchecked box saved in the modal, and the server saves this value
                 * back onto the contract, so a stale "on" here also outlived Review.
                 */
                includeWireFee: resolveIncludeWireFeePreference(
                    sendPayload.includeWireFee,
                    (latestContract as Record<string, unknown> | null | undefined) ?? null,
                )
                    ? "true"
                    : "false",
            };
            console.log(
                standaloneAchOnly
                    ? "[ContractTab] DocuSign layout send (standalone ACH):"
                    : "[ContractTab] DocuSign layout send (contract PDF + optional supplemental docs):",
                mergeRequest,
            );
            const timingRequestId = String(sendPayload.timingRequestId || "").trim();
            if (timingRequestId) markSignNowReviewRequestStart(timingRequestId);
            let sendResponse: unknown;
            try {
                sendResponse = await dispatch(
                    mergeAndSendDocuSignEnvelope(mergeRequest),
                ).unwrap();
            } finally {
                if (timingRequestId) markSignNowReviewHttpResponse(timingRequestId);
            }
            console.log("[ContractTab] DocuSign layout send response:", sendResponse);

            const documentId =
                (sendResponse as any)?.envelopeId ||
                (sendResponse as any)?.documentId ||
                (sendResponse as any)?.data?.envelopeId ||
                (sendResponse as any)?.data?.documentId ||
                (sendResponse as any)?.id;
            const rawSenderUrl =
                (sendResponse as any)?.embeddedEditorUrl ||
                (sendResponse as any)?.data?.embeddedEditorUrl ||
                (sendResponse as any)?.embeddedInviteUrl ||
                (sendResponse as any)?.data?.embeddedInviteUrl ||
                (sendResponse as any)?.sendUrl ||
                (sendResponse as any)?.data?.sendUrl ||
                (sendResponse as any)?.url;
            const senderUrl = isSignNowLoginWebappUrl(String(rawSenderUrl || ""))
                ? null
                : rawSenderUrl;

            if (!documentId) {
                failDocuSignEnvelope("DocuSign did not return a document ID.");
            }

            if (
                !standaloneAchOnly &&
                !includeMainContract &&
                sendPackageSelection
            ) {
                const contractNumericId = Number((latestContract as { id?: unknown })?.id);
                if (Number.isFinite(contractNumericId) && contractNumericId > 0) {
                    try {
                        const prefillBase =
                            (latestContract as { contractPrefillOverrides?: unknown } | null)
                                ?.contractPrefillOverrides ?? null;
                        const contractPrefillOverrides = mergeStandalonePackageDocuSignIntoPrefill(
                            prefillBase,
                            {
                                envelopeId: String(documentId),
                                package: {
                                    includeMainContract: sendPackageSelection.includeMainContract,
                                    includeAddendum: sendPackageSelection.includeAddendum,
                                    includeDisclosure: sendPackageSelection.includeDisclosure,
                                },
                            },
                        );
                        const updated = await dispatch(
                            updateContract({
                                id: contractNumericId,
                                data: { contractPrefillOverrides },
                            }),
                        ).unwrap();
                        const payload = (updated as { data?: unknown })?.data ?? updated;
                        setFetchedContract({
                            ...(latestContract as Record<string, unknown>),
                            ...(payload as Record<string, unknown>),
                            contractPrefillOverrides,
                        });
                    } catch (persistErr) {
                        console.warn(
                            "[ContractTab] persist standalone package DocuSign failed:",
                            persistErr,
                        );
                    }
                }
            } else if (
                !standaloneAchOnly &&
                includeMainContract &&
                sendPackageSelection
            ) {
                const contractNumericId = Number((latestContract as { id?: unknown })?.id);
                if (Number.isFinite(contractNumericId) && contractNumericId > 0) {
                    try {
                        const prefillBase =
                            (latestContract as { contractPrefillOverrides?: unknown } | null)
                                ?.contractPrefillOverrides ?? null;
                        const contractPrefillOverrides = mergeMainContractSendPackageIntoPrefill(
                            prefillBase,
                            {
                                envelopeId: String(documentId),
                                includeMainContract: sendPackageSelection.includeMainContract,
                                includeAddendum: sendPackageSelection.includeAddendum,
                                includeDisclosure: sendPackageSelection.includeDisclosure,
                            },
                        );
                        const updated = await dispatch(
                            updateContract({
                                id: contractNumericId,
                                data: { contractPrefillOverrides },
                            }),
                        ).unwrap();
                        const payload = (updated as { data?: unknown })?.data ?? updated;
                        setFetchedContract({
                            ...(latestContract as Record<string, unknown>),
                            ...(payload as Record<string, unknown>),
                            contractPrefillOverrides,
                        });
                    } catch (persistErr) {
                        console.warn(
                            "[ContractTab] persist main contract send package failed:",
                            persistErr,
                        );
                    }
                }
            }

            const envelopeStatus = (sendResponse as { data?: { envelopeStatus?: string } })
                ?.data?.envelopeStatus;
            const autoSent =
                envelopeStatus === "sent" ||
                (sendResponse as { data?: { autoSend?: boolean } })?.data?.autoSend === true;

            const recipientList = roles
                .map((r) => String(r.signerEmail || "").trim())
                .filter(Boolean)
                .join(", ");

            const contractStateRaw = String(latestContract?.state ?? "").trim();
            const mergeNote = supplementalDocumentRefs.length
                ? ` Contract${contractStateRaw ? ` (${contractStateRaw})` : ""} with ${supplementalDocumentRefs.length} supplemental document(s).`
                : "";
            const prefillApplied = (sendResponse as { data?: { prefillTabsApplied?: number } })
                ?.data?.prefillTabsApplied;
            const prefillAttempted = (sendResponse as { data?: { prefillFieldCount?: number } })
                ?.data?.prefillFieldCount;
            const prefillNote =
                prefillApplied != null && prefillApplied > 0
                    ? ` ${prefillApplied} field(s) prefilled.`
                    : "";
            if (
                prefillAttempted != null &&
                prefillAttempted > 0 &&
                (prefillApplied == null || prefillApplied === 0)
            ) {
                toast.warning(
                    "Contract sent, but DocuSign field labels did not match CRM prefill ids. Signer may need to fill fields manually. Check template Data Labels in DocuSign Admin.",
                    { autoClose: 8000 },
                );
            }

            if (!options.autoSend && !options.suppressSuccessToast) {
                toast.success(
                    recipientList
                        ? `DocuSign draft is ready.${mergeNote}${prefillNote} Signer(s): ${recipientList}.`
                        : `DocuSign draft is ready.${mergeNote}${prefillNote}`,
                );
            } else if (
                !autoSent &&
                senderUrl &&
                !options.suppressSuccessToast &&
                !isSignNowContractUiEnabled() &&
                typeof window !== "undefined"
            ) {
                window.open(senderUrl, "_blank", "noopener,noreferrer");
                toast.success(
                    recipientList
                        ? `Draft opened in DocuSign.${mergeNote}${prefillNote} Review and click Send in DocuSign to email signers. Signer(s): ${recipientList}.`
                        : `Draft opened in DocuSign.${mergeNote}${prefillNote} Review and click Send in DocuSign to email signers.`,
                );
            } else if (autoSent && !options.suppressSuccessToast) {
                const via = isSignNowContractUiEnabled() ? "SignNow" : "DocuSign";
                toast.success(
                    recipientList
                        ? `Contract sent via ${via}.${mergeNote}${prefillNote} Signing email sent to: ${recipientList}.`
                        : `Contract sent via ${via}.${mergeNote}${prefillNote}`,
                );
            } else if (!senderUrl && !options.suppressSuccessToast) {
                toast.success(
                    autoSent
                        ? `Contract sent via ${isSignNowContractUiEnabled() ? "SignNow" : "DocuSign"}.${mergeNote}${prefillNote}`
                        : "Envelope created, but no DocuSign review URL was returned.",
                );
            }

            return {
                envelopeId: String(documentId),
                prefillTabsApplied:
                    (sendResponse as { data?: { prefillTabsApplied?: number } })?.data
                        ?.prefillTabsApplied,
                prefillFieldCount:
                    (sendResponse as { data?: { prefillFieldCount?: number } })?.data
                        ?.prefillFieldCount,
                sendUrl: senderUrl ? String(senderUrl) : null,
                embeddedInviteUrl: senderUrl ? String(senderUrl) : null,
            };
        } catch (error: unknown) {
            const raw =
                typeof error === "string"
                    ? error
                    : (error as { payload?: unknown })?.payload ??
                    (error as { response?: { data?: { message?: string } } })
                        ?.response?.data?.message ??
                    (error as Error)?.message ??
                    "Failed to send template via DocuSign.";
            const msg =
                typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
            if (isDocuSignMissingSignerMessage(msg)) {
                toast.success("Contract sent successfully.");
                throw new Error(msg);
            }
            if (isDocuSignSendViewOptionPageViewError(msg)) {
                toast.success("Contract generated successfully.");
                throw new Error(msg);
            }
            return failDocuSignEnvelope(msg);
        } finally {
            setCreatingEnvelope(false);
        }
    };

    const prepareDocuSignDraft = async (payload: {
        ccEmails: string[];
        addendumDocumentRef?: string | null;
        addendumDocumentRefs?: string[] | null;
        addendumBoldSignTemplateId?: string | null;
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
        prefillFields?: Array<{ id: string; value: string }>;
        autoSend?: boolean;
        timingRequestId?: string;
    }) => {
        const result = await runDocuSignEnvelope(payload, {
            autoSend: payload.autoSend === true,
            suppressSuccessToast: true,
        });
        const envelopeId = String(result?.envelopeId ?? "").trim();
        if (!envelopeId) {
            throw new Error("DocuSign did not return an envelope ID after creating the draft.");
        }
        const persistStarted = Date.now();
        const timingRequestId = String(payload.timingRequestId || "").trim();
        const persistWork = async () => {
            if (payload.standaloneAchOnly || payload.includeMainContract === false) return;
            const cid = Number((fetchedContract as { id?: unknown })?.id);
            if (!Number.isFinite(cid) || cid <= 0) return;
            await persistContractFunderMeta(cid, {
                funderName: payload.funderName,
                state: payload.contractState,
            });
            try {
                const raw =
                    normalizeContractPrefillOverrides(
                        (fetchedContract as { contractPrefillOverrides?: unknown })
                            ?.contractPrefillOverrides,
                    ) ?? {};
                const main = stripDocumentTemplateBlobFromPrefillOverrides(
                    raw,
                ) as Record<string, unknown>;
                const sendHistory = upsertDocumentSendHistory(
                    parseDocumentSendHistory(raw),
                    {
                        envelopeId,
                        documentKind: "contract",
                        label: "Contract",
                        status: payload.autoSend === true ? "sent" : "draft",
                        updatedAt: new Date().toISOString(),
                    },
                );
                const envelopeBlob = parseDocumentTemplateEnvelopeByMappingId(raw);
                const prefillBlob = (raw as Record<string, unknown>)[
                    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY
                ];
                await dispatch(
                    updateContract({
                        id: cid,
                        data: {
                            contractPrefillOverrides: {
                                ...pickPreservedDocuSignEnvelopeMetaFromPrefill(raw),
                                ...main,
                                ...(prefillBlob != null
                                    ? {
                                          [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]:
                                              prefillBlob,
                                      }
                                    : {}),
                                ...(Object.keys(envelopeBlob).length
                                    ? {
                                          [DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY]:
                                              envelopeBlob,
                                      }
                                    : {}),
                                [DOCUMENT_SEND_HISTORY_KEY]: sendHistory,
                            },
                        },
                    }),
                ).unwrap();
                void refreshFetchedContract();
            } catch (historyErr) {
                console.warn("[ContractTab] contract send history save skipped:", historyErr);
            }
        };
        void persistWork()
            .catch((err) => {
                console.warn("[ContractTab] contract persist after SignNow URL failed:", err);
            })
            .finally(() => {
                if (payload.autoSend === true) refreshApplicationStage();
                if (timingRequestId) {
                    logSignNowFeTiming(
                        timingRequestId,
                        "frontend-persist-after-response",
                        Date.now() - persistStarted,
                    );
                }
            });
        return {
            envelopeId,
            prefillTabsApplied: result.prefillTabsApplied,
            prefillFieldCount: result.prefillFieldCount,
            sendUrl: result.sendUrl ?? result.embeddedInviteUrl ?? null,
            embeddedInviteUrl: result.embeddedInviteUrl ?? result.sendUrl ?? null,
        };
    };

    const persistAchEnvelopeOnContract = useCallback(
        async (
            mappingId: string,
            envelopeId: string,
            status = "draft",
            funderMeta?: { funderName?: string | null; funderProfileId?: string | null } | null,
        ) => {
            const cid = selectedContractId;
            if (cid == null || !Number.isFinite(Number(cid))) return;
            const eid = String(envelopeId ?? "").trim();
            if (!eid) return;

            // Always load the latest contract row so envelope status updates cannot
            // clobber a just-saved Signer 2 (stripDocumentTemplateBlob removes overrides).
            let latestPrefill: unknown =
                (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides;
            try {
                const res = await dispatch(getByIdContract(Number(cid))).unwrap();
                const row = (res as { data?: unknown })?.data ?? res;
                if (row && typeof row === "object") {
                    setFetchedContract(row);
                    latestPrefill = (row as { contractPrefillOverrides?: unknown })
                        .contractPrefillOverrides;
                }
            } catch {
                /* fall back to in-memory fetchedContract */
            }

            const rawOverrides = normalizeContractPrefillOverrides(latestPrefill) ?? {};
            const main = stripDocumentTemplateBlobFromPrefillOverrides(
                rawOverrides,
            ) as Record<string, unknown>;
            const preservedSigners = parseContractSignerOverridesFromPrefill(rawOverrides);
            const statusTrim = String(status ?? "").trim();
            const updatedAt = new Date().toISOString();
            const previousEnvelopeBlob = parseDocumentTemplateEnvelopeByMappingId(rawOverrides);
            const previousMeta =
                previousEnvelopeBlob[mappingId] ??
                previousEnvelopeBlob[ACH_PREFILL_MAPPING_ALIAS_KEY];
            let sendHistory = parseDocumentSendHistory(rawOverrides);
            const previousEnvelopeId = String(previousMeta?.envelopeId ?? "").trim();
            const previousStatus = String(previousMeta?.status ?? "").trim();
            const funderName = String(funderMeta?.funderName ?? "").trim();
            const funderProfileId = String(funderMeta?.funderProfileId ?? "").trim();
            const funderFields = {
                ...(funderName ? { funderName } : {}),
                ...(funderProfileId ? { funderProfileId } : {}),
            };
            if (
                previousEnvelopeId &&
                previousEnvelopeId !== eid &&
                previousStatus &&
                !isAchEnvelopeDraftLikeStatus(previousStatus)
            ) {
                sendHistory = upsertDocumentSendHistory(sendHistory, {
                    envelopeId: previousEnvelopeId,
                    documentKind: "ach",
                    label: "ACH Authorization",
                    status: previousStatus,
                    updatedAt: String(previousMeta?.updatedAt ?? updatedAt),
                    ...funderFields,
                });
            }
            const envelopeMeta = {
                envelopeId: eid,
                ...(statusTrim ? { status: statusTrim } : {}),
                updatedAt,
            };
            // Persist under both the live mapping id and a stable alias so status
            // survives synthetic → DB mapping id swaps.
            const nextEnvelopeBlob = {
                ...previousEnvelopeBlob,
                [mappingId]: envelopeMeta,
                [ACH_PREFILL_MAPPING_ALIAS_KEY]: envelopeMeta,
            };
            if (statusTrim) {
                sendHistory = upsertDocumentSendHistory(sendHistory, {
                    envelopeId: eid,
                    documentKind: "ach",
                    label: "ACH Authorization",
                    status: statusTrim,
                    updatedAt,
                    ...funderFields,
                });
            }
            const prefillBlob = (rawOverrides as Record<string, unknown>)[
                DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY
            ];
            const priorLastAch = parseLastAchSentFunder(rawOverrides);
            const nextLastAch =
                funderName
                    ? {
                          funderName,
                          ...(funderProfileId ? { funderProfileId } : {}),
                          envelopeId: eid,
                          updatedAt,
                      }
                    : priorLastAch;

            // Also keep the Contracts Generated capsule in sync (table reads this).
            const capsuleStatus = statusTrim
                ? mapInternalEnvelopeStatusToAchCapsule(statusTrim)
                : undefined;
            const withCapsule = mergeAchAuthorizationDocuSignIntoPrefill(
                {
                    ...pickPreservedDocuSignEnvelopeMetaFromPrefill(rawOverrides),
                    ...main,
                    ...(preservedSigners?.length
                        ? { [CONTRACT_SIGNER_OVERRIDES_KEY]: preservedSigners }
                        : {}),
                    ...(prefillBlob != null
                        ? {
                              [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: prefillBlob,
                          }
                        : {}),
                    [DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY]: nextEnvelopeBlob,
                    [DOCUMENT_SEND_HISTORY_KEY]: sendHistory,
                    ...(nextLastAch ? { [LAST_ACH_SENT_FUNDER_KEY]: nextLastAch } : {}),
                },
                {
                    envelopeId: eid,
                    ...(capsuleStatus ? { status: capsuleStatus } : {}),
                    updatedAt,
                },
            );

            await dispatch(
                updateContract({
                    id: Number(cid),
                    data: {
                        contractPrefillOverrides: withCapsule,
                    },
                }),
            ).unwrap();
            await refreshFetchedContract();
        },
        [selectedContractId, fetchedContract, dispatch],
    );

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
            const signerEmail = getPrimaryRecipientEmail().trim();
            const funderName = String(
                (fetchedContract as { funderName?: unknown } | null)?.funderName ?? "",
            ).trim();
            const contractState = String(
                (fetchedContract as { state?: unknown } | null)?.state ?? "",
            ).trim();
            const contractIdNum = Number(selectedContractId);
            try {
                const res = await axiosPost("/docusign/sender-view", {
                    envelopeId,
                    returnUrl,
                    ccEmails: [...new Set(ccForSync.map((e) => e.trim()).filter(Boolean))],
                    ...(rolesOverride?.length ? { roles: rolesOverride } : {}),
                    ...(applicationUuid ? { applicationId: String(applicationUuid) } : {}),
                    ...(Number.isFinite(contractIdNum) && contractIdNum > 0
                        ? { contractId: contractIdNum }
                        : {}),
                    ...(funderName ? { funderName } : {}),
                    ...(contractState ? { contractState } : {}),
                    ...(signerEmail
                        ? {
                              signerEmail,
                              signerName: getPrimaryRecipientName(),
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
        [applicationUuid, applicationData, fetchedContract, selectedContractId],
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

    const openAchViewer = async () => {
        if (!applicationUuid) {
            toast.error("Application is required to send the ACH form.");
            return;
        }
        setPreparingAchViewer(true);
        try {
            const contractId = await ensureContractRecordForAch();
            await ensureAchTemplateLinked(contractId);
            await fetchAchTemplateMappings(contractId);
            setAchViewerOpen(true);
        } catch (error) {
            console.error("Failed to prepare ACH viewer:", error);
            const message =
                typeof error === "string"
                    ? error
                    : (error as { response?: { data?: { message?: string } }; message?: string })
                          ?.response?.data?.message ||
                      (error as { message?: string })?.message ||
                      "Could not open ACH form viewer.";
            toast.error(String(message));
        } finally {
            setPreparingAchViewer(false);
        }
    };

    const appendStructuredNote = (sectionLabel: string, payload: unknown) => {
        const existingNote = (applicationData as any)?.note ?? "";
        const serialized = JSON.stringify(payload);
        const sectionHeader = `[${sectionLabel}]`;
        if (!existingNote) {
            return `${sectionHeader}\n${serialized}`;
        }
        return `${existingNote}\n\n${sectionHeader}\n${serialized}`;
    };

    /** Editable calculation fields; disabled styling applies when read-only and values are not yet shown as the saved grid. */
    const calculationInputClass = isDark
        ? "bg-muted border-gray-700 text-gray-200"
        : "bg-white border-[#D1D5DB]";
    const contractsCardClass = isDark
        ? "rounded-xl border overflow-hidden bg-[#1F2021] border-[#374151] shadow-sm"
        : "rounded-xl border overflow-hidden bg-white border-[#E5E7EB] shadow-sm";
    const contractsHeaderClass = isDark
        ? "px-6 py-4 text-base font-semibold text-gray-100 border-b border-[#374151] bg-[#111827]"
        : "px-6 py-4 text-base font-semibold text-[#1F2937] border-b border-[#D1D5DB] bg-[#E8F0F8]";
    const tableHeaderRowClass = isDark
        ? "border-[#374151] bg-[#242526] hover:bg-[#242526]"
        : "border-[#E5E7EB] bg-[#F8FAFC] hover:bg-[#F8FAFC]";
    const tableHeaderCellClass = isDark
        ? "text-[11px] uppercase tracking-wide font-semibold text-gray-400 h-11"
        : "text-[11px] uppercase tracking-wide font-semibold text-[#687182] h-11";
    const tableRowClass = isDark
        ? "border-[#374151] hover:bg-[#2A2C2D]/60 transition-colors"
        : "border-[#EEF2F7] hover:bg-[#F8FAFC] transition-colors";
    const tableCellClass = isDark ? "text-gray-200" : "text-[#334155]";
    const statusBadgeClass = isDark
        ? "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
        : "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200";

    const isContractValuesReadOnly = isReadOnly || !isEditingContractValues;
    /** Read-only summary grid by default; field inputs only while editing. */
    const showSavedContractGrid = !isEditingContractValues;

    const brandActionButtonClass = isDark
        ? "text-[#5AACEA] hover:bg-[#5AACEA]/10"
        : "text-[var(--brand)] hover:bg-[var(--brand)]/10";

    const renderContractSendTableRow = (row: ContractSendTableRow) => {
        const isAchRow = row.rowType === "ach";
        const isPackageRow = row.rowType === "package";
        const isContractRow = row.rowType === "contract";
        const isNonContractDocument =
            row.documentKind === "addendum" ||
            row.documentKind === "disclosure" ||
            row.documentKind === "ach" ||
            row.documentKind === "package";
        const isSupplementalRow = isAchRow || isPackageRow || isNonContractDocument;
        const rowStatusLabel = isAchRow
            ? formatAchTableStatusLabel({
                  envelopeId: row.envelopeId,
                  status: row.achStatus,
              })
            : isPackageRow
              ? formatStandalonePackageTableStatusLabel(row.packageStatus, row.envelopeId)
              : formatContractTableStatusLabel(
                    row.contractStatus,
                    row.documentStatus,
                    Boolean(row.envelopeId),
                );
        const rowCapsuleStatus: AchAuthorizationDocuSignCapsuleStatus = isAchRow
            ? (row.achStatus ?? "DRAFT")
            : isPackageRow
              ? ((row.packageStatus ?? "DRAFT") as AchAuthorizationDocuSignCapsuleStatus)
              : contractStatusToCapsuleStatus(row.contractStatus, row.documentStatus);
        const rowFullySigned = isAchRow
            ? row.achStatus === "SIGNED"
            : isPackageRow
              ? row.packageStatus === "SIGNED"
              : isContractFullySigned(row.contractStatus, row.documentStatus);
        const rowSentAtDisplay = formatTableSentAt(row.sentAt);
        const rowEnvelopeId = String(row.envelopeId ?? "").trim();
        const snap = !isSupplementalRow ? getContractSendRowTermsSnapshot(row) : null;
        const rowProgram =
            snap?.approvedAmount != null
                ? snap.approvedAmount
                : (fetchedContract?.offer?.offer ?? fetchedContract?.program ?? "—");
        const rowTerm =
            snap?.term != null && String(snap.term).trim()
                ? String(snap.term)
                : snap?.contractLength != null
                  ? snap.contractLength
                  : (fetchedContract?.offer?.term ?? "—");
        const rowPosition =
            snap?.position != null && String(snap.position).trim()
                ? String(snap.position)
                : "1";
        const rowAdvance =
            snap?.approvedAmount != null
                ? snap.approvedAmount
                : fetchedContract?.approvedAmount;
        const rowPayback =
            snap?.paybackAmount != null
                ? snap.paybackAmount
                : snap?.totalAmount != null
                  ? snap.totalAmount
                  : (fetchedContract?.totalAmount ?? fetchedContract?.offer?.totalRemit);
        const rowPaymentAmount =
            snap?.paymentAmount != null
                ? snap.paymentAmount
                : contractTableMetrics.perPeriodPayment;
        const formatSnapRate = (value: number | null | undefined) => {
            if (value == null || !Number.isFinite(value)) return null;
            return `${value}%`;
        };
        const rowBuyRate =
            formatSnapRate(snap?.buyRate ?? null) ?? contractTableMetrics.buyRate;
        const rowUpsell =
            formatSnapRate(snap?.percentOfGross ?? null) ?? contractTableMetrics.upsell;
        const rowFactor =
            snap?.factorRate != null && Number.isFinite(snap.factorRate)
                ? String(snap.factorRate)
                : contractTableMetrics.factor;
        // One void control per envelope when addendum + disclosure share a package send.
        const isPrimaryVoidRowForEnvelope =
            !rowEnvelopeId ||
            contractSendTableRows.find((r) => String(r.envelopeId ?? "").trim() === rowEnvelopeId)
                ?.key === row.key;
        const rowCanVoid =
            !isReadOnly &&
            isPrimaryVoidRowForEnvelope &&
            canVoidContractSendTableRow(contractRecordForActions, row);
        // Same-contract resend: any SignNow contract send still out for signature.
        // Superseded sends are offered too; the backend rejects them when no signing
        // queue is left to resend from.
        const rowCanResendUnsigned =
            !isReadOnly &&
            !isAchRow &&
            !isPackageRow &&
            isPrimaryVoidRowForEnvelope &&
            Boolean(rowEnvelopeId) &&
            isSignNowEnvelopeId(rowEnvelopeId) &&
            Boolean(row.sentAt) &&
            rowCapsuleStatus !== "DRAFT" &&
            !rowFullySigned &&
            !isContractVoidedOrTerminal(row.contractStatus, row.documentStatus);
        const rowIsVoided = isAchRow
            ? row.achStatus === "VOIDED"
            : isPackageRow
              ? row.packageStatus === "VOIDED"
              : isContractVoidedOrTerminal(row.contractStatus, row.documentStatus);
        const rowSyncError = isAchRow
            ? achSyncError
            : isPackageRow
              ? packageSyncError
              : contractSyncError;
        const isViewingRow = isAchRow
            ? viewingAchDocument
            : viewingSignedContract &&
              (viewingSignedEnvelopeId
                  ? viewingSignedEnvelopeId === rowEnvelopeId
                  : row.isCurrent);
        const viewDocumentTitle = isAchRow
            ? rowFullySigned
                ? "View signed ACH form"
                : rowIsVoided
                  ? "View voided ACH form"
                  : "View ACH form"
            : isPackageRow
              ? rowFullySigned
                  ? "View signed supplemental documents"
                  : rowIsVoided
                    ? "View voided supplemental documents"
                    : "View supplemental documents"
              : rowFullySigned
                ? "View signed contract"
                : rowIsVoided
                  ? "View voided contract"
                  : "View contract";
        const handleViewRowDocument = () => {
            if (isAchRow) {
                void (row.isCurrent
                    ? handleViewAchDocument()
                    : handleViewSignedContract(rowEnvelopeId));
                return;
            }
            void handleViewSignedContract(rowEnvelopeId);
        };

        return (
            <TableRow key={row.key} className={tableRowClass}>
                <TableCell className={tableCellClass}>
                    <span className="inline-flex items-center gap-1.5">
                        {isAchRow ? (
                            <Landmark
                                className="h-3.5 w-3.5 shrink-0 text-teal-700 dark:text-teal-300"
                                aria-hidden
                            />
                        ) : isPackageRow ? (
                            <FileText
                                className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300"
                                aria-hidden
                            />
                        ) : (
                            <FileText
                                className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-[#5AACEA]" : "text-[var(--brand)]"}`}
                                aria-hidden
                            />
                        )}
                        {rowEnvelopeId ? (
                            <button
                                type="button"
                                onClick={handleViewRowDocument}
                                disabled={isViewingRow}
                                title={viewDocumentTitle}
                                className={`text-left underline-offset-2 hover:underline disabled:opacity-60 ${
                                    isDark
                                        ? "text-[#5AACEA] hover:text-[#7BBDEF]"
                                        : "text-[var(--brand)] hover:text-[var(--brand)]/80"
                                }`}
                            >
                                {row.label}
                            </button>
                        ) : (
                            row.label
                        )}
                    </span>
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : rowProgram}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : rowTerm}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : rowPosition}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : formatContractCurrency(rowAdvance)}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : formatContractCurrency(rowPayback)}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : formatContractCurrency(rowPaymentAmount)}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : rowBuyRate}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : rowUpsell}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : rowFactor}
                </TableCell>
                <TableCell>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                            <span
                                className={
                                    rowEnvelopeId && rowCapsuleStatus !== "DRAFT"
                                        ? `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${achCapsuleClassName(rowCapsuleStatus)}`
                                        : statusBadgeClass
                                }
                            >
                                {rowStatusLabel}
                            </span>
                            {rowEnvelopeId ? (
                                <>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleViewRowDocument}
                                        disabled={isViewingRow}
                                        className={`h-7 w-7 shrink-0 ${brandActionButtonClass}`}
                                        title={viewDocumentTitle}
                                    >
                                        {isViewingRow ? (
                                            <Loader2
                                                className="h-3.5 w-3.5 animate-spin"
                                                aria-hidden
                                            />
                                        ) : (
                                            <Eye className="h-3.5 w-3.5" aria-hidden />
                                        )}
                                    </Button>
                                    {(row.isCurrent || isContractRow) &&
                                    !rowFullySigned &&
                                    !rowIsVoided ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                                void (isAchRow
                                                    ? refreshAchEnvelopeStatus(false, {
                                                          force: true,
                                                          envelopeId: rowEnvelopeId,
                                                      })
                                                    : isPackageRow
                                                      ? refreshPackageEnvelopeStatus(false, {
                                                            force: true,
                                                        })
                                                      : refreshContractEnvelopeStatus(false, {
                                                            force: true,
                                                            envelopeId: rowEnvelopeId,
                                                        }))
                                            }
                                            disabled={refreshingSigningStatus}
                                            className={`h-7 w-7 shrink-0 ${brandActionButtonClass}`}
                                            title={
                                                isAchRow
                                                    ? "Refresh ACH status"
                                                    : isPackageRow
                                                      ? "Refresh supplemental document status"
                                                      : "Refresh contract status"
                                            }
                                        >
                                            <RefreshCw
                                                className={`h-3.5 w-3.5 ${refreshingSigningStatus ? "animate-spin" : ""}`}
                                                aria-hidden
                                            />
                                        </Button>
                                    ) : null}
                                    {rowCanResendUnsigned ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                                setResendUnsignedRow({
                                                    envelopeId: rowEnvelopeId,
                                                    label: row.label,
                                                })
                                            }
                                            className={`h-7 w-7 shrink-0 ${brandActionButtonClass}`}
                                            title="Resend unsigned contract"
                                            aria-label={`Resend unsigned ${row.label}`}
                                        >
                                            <MailPlus className="h-3.5 w-3.5" aria-hidden />
                                        </Button>
                                    ) : null}
                                    {rowCanVoid ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => void handleVoidSentEnvelopeRow(row)}
                                            disabled={voidingContract}
                                            className={`h-7 w-7 shrink-0 ${isDark
                                                ? "text-red-400 hover:bg-red-500/10"
                                                : "text-red-600 hover:bg-red-50"
                                                }`}
                                            title={`Void ${row.label}`}
                                        >
                                            {voidingContract ? (
                                                <Loader2
                                                    className="h-3.5 w-3.5 animate-spin"
                                                    aria-hidden
                                                />
                                            ) : (
                                                <Ban className="h-3.5 w-3.5" aria-hidden />
                                            )}
                                        </Button>
                                    ) : null}
                                </>
                            ) : null}
                        </div>
                        {rowSyncError ? (
                            <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-300">
                                {rowSyncError}
                            </p>
                        ) : null}
                    </div>
                </TableCell>
                <TableCell
                    className={`${tableCellClass} text-xs tabular-nums whitespace-nowrap`}
                >
                    {rowSentAtDisplay}
                </TableCell>
            </TableRow>
        );
    };

    const calculationSummaryFields = [
        { label: "Amount Financed", value: amountFinancedInput },
        { label: "REFI Amount", value: refinanceAmountInput },
        { label: "Recipient Funds", value: recipientFundsInput },
        { label: "Finance Charge", value: financeChargeInput },
        { label: "Estimated Total Payment Amount", value: estimatedTotalPaymentInput },
        { label: "Payment Total", value: paymentTotalInput },
        { label: "Estimated Monthly Cost", value: estimatedMonthlyCostInput },
        { label: "Estimated Payments", value: estimatedPaymentInput },
        { label: "Payments Terms", value: numberOfPaymentsInput },
        { label: "Frequency", value: frequencyInput },
        { label: "Estimated Term (months)", value: termLengthInput },
    ];

    const handleSaveContractValues = async () => {
        if (!applicationUuid) {
            toast.error("Cannot save contract values: missing application ID.");
            return;
        }
        setSavingContractValues(true);
        try {
            const payload: PersistedContractValues = getCurrentContractValues();
            const existingNote = String((applicationData as any)?.note || "");
            const note = upsertStructuredSection(
                existingNote,
                CONTRACT_VALUES_SECTION,
                payload,
            );
            await dispatch(
                updateApplication({
                    id: String(applicationUuid),
                    data: { note },
                }),
            ).unwrap();

            const nextRefinance = parseNumberUS(refinanceAmountInput);
            const prevRefinance = parseMaybeNumber(offerRecord?.refinanceAmount) ?? null;
            const refinanceChanged =
                (nextRefinance == null && prevRefinance != null && prevRefinance !== 0) ||
                (nextRefinance != null &&
                    (prevRefinance == null || Math.abs(nextRefinance - prevRefinance) > 0.009));
            if (refinanceChanged) {
                const offerPayload: Record<string, unknown> = {
                    applicationId: applicationUuid,
                    decision:
                        String(offerRecord?.decision ?? "approved").toLowerCase() === "declined"
                            ? "declined"
                            : "approved",
                    refinanceAmount: nextRefinance ?? 0,
                };
                if (offerRecord?.offer != null) offerPayload.offer = offerRecord.offer;
                if (offerRecord?.rate != null) offerPayload.rate = offerRecord.rate;
                if (offerRecord?.term != null) offerPayload.term = offerRecord.term;
                if (offerRecord?.frequency != null) offerPayload.frequency = offerRecord.frequency;
                if (offerRecord?.fees != null) offerPayload.fees = offerRecord.fees;
                if (offerRecord?.repayPerPeriod != null) {
                    offerPayload.repayPerPeriod = offerRecord.repayPerPeriod;
                }
                if (offerRecord?.monthlyPayment != null) {
                    offerPayload.monthlyPayment = offerRecord.monthlyPayment;
                }
                if (offerRecord?.position != null) offerPayload.position = offerRecord.position;
                await axiosPost("/offer-decisions", offerPayload);
                emitOfferDecisionUpdated(applicationUuid);
                await dispatch(getOfferDecisionByApplication(applicationUuid)).unwrap();
            }

            setIsEditingContractValues(false);
            setSavedContractValuesSnapshot(payload);
            toast.success("Contract values saved.");
        } catch (err) {
            console.error("Failed to save contract values:", err);
            toast.error("Failed to save contract values.");
        } finally {
            setSavingContractValues(false);
        }
    };

    const handleEditContractValues = () => {
        setSavedContractValuesSnapshot(getCurrentContractValues());
        setIsEditingContractValues(true);
    };

    const handleCancelContractValuesEdit = () => {
        if (savedContractValuesSnapshot) {
            setAmountFinancedInput(savedContractValuesSnapshot.amountFinancedInput || "");
            setRecipientFundsInput(savedContractValuesSnapshot.recipientFundsInput || "");
            setRefinanceAmountInput(formatRefinanceAmountDisplay(offerRecord?.refinanceAmount));
            setFinanceChargeInput(savedContractValuesSnapshot.financeChargeInput || "");
            setEstimatedTotalPaymentInput(
                savedContractValuesSnapshot.estimatedTotalPaymentInput || "",
            );
            setPaymentTotalInput(savedContractValuesSnapshot.paymentTotalInput || "");
            setEstimatedMonthlyCostInput(
                savedContractValuesSnapshot.estimatedMonthlyCostInput || "",
            );
            setEstimatedPaymentInput(savedContractValuesSnapshot.estimatedPaymentInput || "");
            setFrequencyInput(savedContractValuesSnapshot.frequencyInput || "");
            setNumberOfPaymentsInput(
                savedContractValuesSnapshot.numberOfPaymentsInput || "",
            );
            setTermLengthInput(savedContractValuesSnapshot.termLengthInput || "");
        }
        setIsEditingContractValues(false);
    };

    return (
        <div className="space-y-6">
            {/* Contract Filter Section - Light blue-grey background */}
            <div
                className={`rounded-lg border p-6 ${isDark ? "bg-[#1F2021] border-[#374151]" : "bg-[#E8F0F8] border-[#D1D5DB]"}`}
            >
                <div className="flex flex-wrap items-end justify-between gap-6">
                    <div className="flex flex-wrap items-end gap-6">
                        <EmailPlanButton />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button
                            type="button"
                            onClick={handleGenerateContract}
                            loading={creatingEnvelope || regeneratingContract || loadingContractPreview}
                            className="rounded-md bg-[image:var(--brand-gradient)] text-white hover:opacity-90 cursor-pointer  px-6 py-2 h-10 font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            {creatingEnvelope || regeneratingContract || loadingContractPreview
                                ? loadingContractPreview
                                    ? "Loading contract..."
                                    : regeneratingContract
                                    ? "Reinitiating contract..."
                                    : "Generating contract..."
                                : needsContractReinitiation
                                  ? "Regenerate Contract"
                                  : isReadOnly || hasGeneratedContract
                                    ? "View Contract"
                                    : "Generate Contract"}
                        </Button>

                        {!isReadOnly && hasSentContract && !needsContractReinitiation ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => void handleResendNewContract()}
                                disabled={creatingEnvelope || regeneratingContract}
                                title="Archive the contract already sent and build a new one from the current offer, application and owner details"
                                className={`rounded-md px-6 py-2 h-10 font-medium cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed ${
                                    isDark
                                        ? "border-[#5AACEA] text-[#5AACEA] hover:bg-[#5AACEA]/10"
                                        : "border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                }`}
                            >
                                Resend New Contract
                            </Button>
                        ) : null}

                    </div>
                </div>

            </div>

            {/* Final Calculations - White background */}
            <div
                className={`rounded-lg border p-6 ${isDark ? "bg-[#1F2021] border-[#374151]" : "bg-white border-[#D1D5DB]"}`}
            >
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h3
                        className={`text-base font-semibold ${isDark ? "text-gray-200" : "text-[#374151]"}`}
                    >
                        Final Calculation
                    </h3>
                    {!isReadOnly && !isEditingContractValues && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleEditContractValues}
                            className="h-9 px-4 bg-[image:var(--brand-gradient)] text-white hover:opacity-90 cursor-pointer"
                        >
                            Edit Values
                        </Button>
                    )}
                </div>
                {!isReadOnly && isEditingContractValues && (
                    <div className="mb-4 text-xs text-[#687182]">
                        Editing is enabled. Update values and save.
                    </div>
                )}
                {offerDecisionLoading || (offerDecision == null && termsOffersLoading) ? (
                    <p
                        className={`text-sm ${isDark ? "text-white/70" : "text-[#687182]"}`}
                    >
                        Loading…
                    </p>
                ) : showSavedContractGrid ? (
                    <div className={`border rounded-lg overflow-hidden ${isDark ? "border-[#374151]" : "border-[#D1D5DB] bg-white"}`}>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                            {calculationSummaryFields.map((field) => (
                                <div
                                    key={field.label}
                                    className={`min-h-[56px] px-4 py-3 border-b md:border-r md:[&:nth-child(3n)]:border-r-0 ${isDark
                                        ? "border-[#374151] bg-[#1F2021] text-gray-200"
                                        : "border-[#E5E7EB] bg-white text-[#0F172A]"
                                        }`}
                                >
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span
                                            className={`shrink-0 font-normal ${isDark ? "text-gray-400" : "text-[#4B5563]"}`}
                                        >
                                            {field.label}
                                        </span>
                                        <span
                                            className={`text-right text-[15px] font-bold tabular-nums ${isDark ? "text-gray-100" : "text-[#1E3A8A]"}`}
                                        >
                                            {String(field.value || "").trim() || "—"}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div
                        className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${isReadOnly ? "[&_label]:opacity-60" : ""}`}
                    >

                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Amount Financed
                            </Label>
                            <Input
                                value={amountFinancedInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    const next = formatted ? `$ ${formatted}` : "";
                                    setAmountFinancedInput(next);
                                    const offer = parseNumberUS(next);
                                    const payback =
                                        parseNumberUS(estimatedTotalPaymentInput) ??
                                        estimatedTotalPayment;
                                    if (
                                        offer != null &&
                                        Number.isFinite(offer) &&
                                        payback != null &&
                                        Number.isFinite(payback)
                                    ) {
                                        const nextFc = Math.max(
                                            0,
                                            Math.round((payback - offer) * 100) / 100,
                                        );
                                        setFinanceChargeInput(
                                            nextFc ? formatCurrencyFull(nextFc) : "",
                                        );
                                    }
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                REFI Amount
                            </Label>
                            <Input
                                value={refinanceAmountInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    const next = formatted ? `$ ${formatted}` : "";
                                    setRefinanceAmountInput(next);
                                    const offer = parseNumberUS(amountFinancedInput) ?? approvedAmount;
                                    const fees = feeAmount;
                                    const refi = parseNumberUS(next) ?? 0;
                                    if (offer != null && Number.isFinite(offer)) {
                                        const nextRecipient = Math.max(
                                            0,
                                            Math.round((offer - (fees || 0) - refi) * 100) / 100,
                                        );
                                        setRecipientFundsInput(
                                            nextRecipient
                                                ? formatCurrencyFull(nextRecipient)
                                                : "$ 0.00",
                                        );
                                    }
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Recipient Funds
                            </Label>
                            <Input
                                value={recipientFundsInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setRecipientFundsInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        {/* <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Annual Percentage Rate
                            </Label>
              <Input
                value={aprInput}
                onChange={(e) => setAprInput(e.target.value)}
                className={calculationInputClass}
              />
                        </div> */}
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Finance Charge
                            </Label>
                            <Input
                                value={financeChargeInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setFinanceChargeInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Total Payment Amount
                            </Label>
                            <Input
                                value={estimatedTotalPaymentInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    const next = formatted ? `$ ${formatted}` : "";
                                    setEstimatedTotalPaymentInput(next);
                                    setPaymentTotalInput(next);
                                    const payback = parseNumberUS(next);
                                    const offer =
                                        parseNumberUS(amountFinancedInput) ?? approvedAmount;
                                    if (
                                        payback != null &&
                                        Number.isFinite(payback) &&
                                        offer != null &&
                                        Number.isFinite(offer)
                                    ) {
                                        const nextFc = Math.max(
                                            0,
                                            Math.round((payback - offer) * 100) / 100,
                                        );
                                        setFinanceChargeInput(
                                            nextFc ? formatCurrencyFull(nextFc) : "",
                                        );
                                    }
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Payment Total
                            </Label>
                            <Input
                                value={paymentTotalInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setPaymentTotalInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Monthly Cost
                            </Label>
                            <Input
                                value={estimatedMonthlyCostInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setEstimatedMonthlyCostInput(
                                        formatted ? `$ ${formatted}` : "",
                                    );
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Payments
                            </Label>
                            <Input
                                value={estimatedPaymentInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setEstimatedPaymentInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Payments Terms
                            </Label>
                            <Input
                                value={numberOfPaymentsInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => setNumberOfPaymentsInput(e.target.value)}
                                className={calculationInputClass}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Frequency
                            </Label>
                            <Select
                                value={frequencyInput}
                                onValueChange={(value: string) => setFrequencyInput(value)}
                                disabled={isContractValuesReadOnly}
                            >
                                <SelectTrigger className={`w-full justify-between ${calculationInputClass}`}>
                                    <SelectValue placeholder="Select frequency" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Daily">Daily</SelectItem>
                                    <SelectItem value="Weekly">Weekly</SelectItem>
                                    <SelectItem value="Monthly">Monthly</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Term (months)
                            </Label>
                            <Input
                                value={termLengthInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => setTermLengthInput(e.target.value)}
                                className={calculationInputClass}
                            />
                        </div>

                    </div>
                )}
                {!isReadOnly && isEditingContractValues && (
                    <div className="mt-6 flex items-center justify-end gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancelContractValuesEdit}
                            disabled={savingContractValues}
                            className="h-9 px-4"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={handleSaveContractValues}
                            loading={savingContractValues}
                            className="h-9 px-4 bg-[image:var(--brand-gradient)] text-white hover:opacity-90"
                        >
                            {savingContractValues ? "Saving..." : "Save Values"}
                        </Button>
                    </div>
                )}
            </div>

            {/* Contracts Generated Table */}
            <div className={contractsCardClass} aria-busy={refreshingContractsTable}>
                <div className={`${contractsHeaderClass} flex items-center justify-between gap-3`}>
                    <h3>Contracts Generated</h3>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRefreshContractsGenerated()}
                        disabled={refreshingContractsTable || !applicationUuid}
                        className={`h-8 shrink-0 gap-1.5 px-2.5 text-xs font-medium ${brandActionButtonClass}`}
                        title="Refresh contracts and CC notification status"
                    >
                        <RefreshCw
                            className={`h-3.5 w-3.5 ${refreshingContractsTable ? "animate-spin" : ""}`}
                            aria-hidden
                        />
                        {refreshingContractsTable ? "Refreshing..." : "Refresh"}
                    </Button>
                </div>
                <div
                    className={`overflow-x-auto transition-opacity ${refreshingContractsTable ? "pointer-events-none opacity-60" : ""}`}
                >
                    <Table>
                        <TableHeader>
                            <TableRow className={tableHeaderRowClass}>
                                <TableHead className={tableHeaderCellClass}>
                                    DOCUMENT
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    PROGRAM
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    EST. TERM
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    POSITIONS
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    ADVANCE
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    PAYBACK
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    PAYMENT AMOUNT
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    BUY RATE
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    UPSELL
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    FACTOR
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    STATUS
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    SENT
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {contractSendTableRows.length > 0 ? (
                                contractSendTableRows.map(renderContractSendTableRow)
                            ) : hasGeneratedContract ? (
                                <TableRow className={tableRowClass}>
                                    <TableCell
                                        colSpan={12}
                                        className={`text-center py-8 ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                                    >
                                        No DocuSign sends yet. Rows appear here after a
                                        contract, addendum, disclosure, or ACH form is sent
                                        (each document listed separately). Sent, viewed,
                                        signed, completed, and voided stays visible; drafts
                                        are hidden.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                <TableRow className={tableRowClass}>
                                    <TableCell
                                        colSpan={12}
                                        className={`text-center py-8 ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                                    >
                                        No contracts generated yet.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
                {contractSendTableRows.length > 0 && applicationUuid ? (
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <button
                            type="button"
                            onClick={() => setEmailHistoryOpen(true)}
                            className={`inline-flex cursor-pointer items-center gap-2 text-sm font-medium hover:underline ${isDark ? "text-blue-300" : "text-[#2563eb]"}`}
                        >
                            <Mail className="h-4 w-4" aria-hidden />
                            View email recipients
                        </button>
                        <span className={`text-xs ${isDark ? "text-emerald-300" : "text-emerald-600"}`}>
                            ← Click to see who received each email, its delivery status, and to view
                            or resend it.
                        </span>
                        <ContractEmailHistoryDialog
                            open={emailHistoryOpen}
                            onOpenChange={setEmailHistoryOpen}
                            applicationId={String(applicationUuid)}
                        />
                    </div>
                ) : null}
            </div>

            {/* Addendum, EPO, ACH Modals - not rendered in readOnly */}
            {!isReadOnly && (
                <>
                    <BusinessInfoModal
                        open={businessInfoModalOpen}
                        onOpenChange={setBusinessInfoModalOpen}
                        applicationId={applicationUuid}
                    />
                    <AddendumModal
                        open={addendumModalOpen}
                        onOpenChange={setAddendumModalOpen}
                        applicationId={appId}
                        onSave={async (data: AddendumEntry[]) => {
                            if (!applicationUuid) {
                                console.error("No application ID available to save Addendum");
                                toast.error("Cannot save Addendum: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("ADDENDUM", data);
                                await dispatch(
                                    updateApplication({ id: applicationUuid, data: { note } }),
                                ).unwrap();
                            } catch (err) {
                                console.error("Failed to save Addendum:", err);
                                toast.error("Failed to save Addendum details.");
                            }
                        }}
                    />
                    <EPOModal
                        open={epoModalOpen}
                        onOpenChange={setEPOModalOpen}
                        applicationId={appId}
                        onSave={async (data: EPOEntry[]) => {
                            if (!applicationUuid) {
                                console.error("No application ID available to save EPO");
                                toast.error("Cannot save EPO: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("EPO", data);
                                await dispatch(
                                    updateApplication({ id: applicationUuid, data: { note } }),
                                ).unwrap();
                            } catch (err) {
                                console.error("Failed to save EPO:", err);
                                toast.error("Failed to save EPO details.");
                            }
                        }}
                    />
                    <ACHModal
                        open={achModalOpen}
                        onOpenChange={setACHModalOpen}
                        applicationId={appId}
                        onSave={async (data: ACHEntry[]) => {
                            if (!applicationUuid) {
                                console.error("No application ID available to save ACH");
                                toast.error("Cannot save ACH: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("ACH", data);
                                await dispatch(
                                    updateApplication({ id: applicationUuid, data: { note } }),
                                ).unwrap();
                            } catch (err) {
                                console.error("Failed to save ACH:", err);
                                toast.error("Failed to save ACH details.");
                            }
                        }}
                    />
                    <GuarantorModal
                        open={guarantorModalOpen}
                        onOpenChange={setGuarantorModalOpen}
                        onSave={async (data: GuarantorEntry) => {
                            if (!applicationUuid) {
                                toast.error("Cannot save Guarantor: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("GUARANTOR", data);
                                await dispatch(updateApplication({ id: applicationUuid, data: { note } })).unwrap();
                            } catch (err) {
                                console.error("Failed to save Guarantor:", err);
                                toast.error("Failed to save Guarantor details.");
                            }
                        }}
                    />
                    <OwnerModal
                        open={ownerModalOpen}
                        onOpenChange={setOwnerModalOpen}
                        onSave={async (data: OwnerEntry) => {
                            if (!applicationUuid) {
                                toast.error("Cannot save Owner: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("OWNER", data);
                                await dispatch(updateApplication({ id: applicationUuid, data: { note } })).unwrap();
                            } catch (err) {
                                console.error("Failed to save Owner:", err);
                                toast.error("Failed to save Owner details.");
                            }
                        }}
                    />
                </>
            )}

            {/* Mark as Funded Button - hidden in readOnly */}
            {!isReadOnly && (
                <div className="flex justify-end">
                    <Button
                        disabled
                        variant="outline"
                        className={`px-6 ${isDark ? "border-gray-600 text-gray-400 opacity-60" : "border-gray-300 text-gray-500"}`}
                    >
                        Mark as Funded
                    </Button>
                </div>
            )}

            {/* Document Viewer for generated contract */}

            <ACHFormViewerModal
                isOpen={achViewerOpen}
                onClose={() => {
                    setAchViewerOpen(false);
                    void refreshFetchedContract();
                    refreshApplicationStage();
                }}
                contractId={selectedContractId}
                applicationId={applicationUuid ? String(applicationUuid) : null}
                applicationData={applicationData}
                achMapping={effectiveAchMapping}
                contract={
                    fetchedContract && typeof fetchedContract === "object"
                        ? (fetchedContract as Record<string, unknown>)
                        : null
                }
                contractPrefillRecords={contractPrefillRecords}
                achRecordOptions={achRecordRows}
                selectedAchRecordId={selectedAchRecordId}
                onSelectedAchRecordIdChange={handleSelectedAchRecordIdChange}
                readOnly={isReadOnly}
                onContractDocumentsChanged={() => void refreshFetchedContract()}
                onPrepareDocuSignDraft={
                    isReadOnly ? undefined : (payload) => prepareDocuSignDraft(payload)
                }
                persistAchEnvelopeOnContract={persistAchEnvelopeOnContract}
                fetchDocuSignSenderViewUrlWithRetry={fetchDocuSignSenderViewUrlWithRetry}
                getSignerEmail={getPrimaryRecipientEmail}
                getSignerName={getPrimaryRecipientName}
            />

            <ResendUnsignedContractDialog
                open={Boolean(resendUnsignedRow)}
                onOpenChange={(open) => {
                    if (!open) setResendUnsignedRow(null);
                }}
                envelopeId={resendUnsignedRow?.envelopeId ?? ""}
                contractLabel={resendUnsignedRow?.label}
                onResent={() => void refreshContractEnvelopeStatus(false, { force: true })}
            />
            <PDFViewerModal
                isOpen={pdfViewerOpen}
                onClose={() => {
                    setPdfViewerOpen(false);
                    setPdfViewerInitialRightPaneTab("template");
                    void refreshFetchedContract();
                    // A send inside the viewer moves the deal to Contract Sent;
                    // the progress bar reads the application, not the contract.
                    refreshApplicationStage();
                }}
                onContractDocumentsChanged={() => void refreshFetchedContract()}
                fileUrl={pdfUrl}
                fileName={pdfName}
                contractId={selectedContractId}
                applicationId={applicationUuid ? String(applicationUuid) : null}
                templateId={null}
                initialRightPaneTab={pdfViewerInitialRightPaneTab}
                onPrepareDocuSignDraft={
                    isReadOnly ? undefined : (payload) => prepareDocuSignDraft(payload)
                }
            />

            <PDFViewerDocsModal
                isOpen={signedPdfPreviewOpen}
                onClose={closeSignedPdfPreview}
                fileUrl={signedPdfPreviewUrl}
                fileName={signedPdfPreviewName}
                showPrintButton
            />

        </div>
    );
}
