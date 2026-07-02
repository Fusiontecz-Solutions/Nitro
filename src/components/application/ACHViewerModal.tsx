import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
    FileText,
    Landmark,
    Loader2,
    Mail,
    Pencil,
    Plus,
    Trash2,
    User,
    X,
    Building2,
} from "lucide-react";
import { toast } from "react-toastify";
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
import { cn } from "@/lib/utils";
import { axiosGet, axiosPost } from "@/redux/axios";
import { syncDocuSignEnvelopeStatus } from "./contractdata/syncDocuSignEnvelopeStatus";
import { parseApiErrorMessageFromAxios } from "./contractdata/docusignPolling";
import {
    buildAchDocuSignPrefillFieldsPayload,
    docuSignPrefillSyncToast,
    patchDocuSignPrefillFields,
    resolveAchDraftEnvelopeIdForSync,
} from "./contractdata/syncDocuSignPrefillFields";
import { watchDocuSignSenderReturn } from "./contractdata/watchDocuSignSenderReturn";
import { DocuSignSigningStatusPanel } from "./contractdata/DocuSignSigningStatusPanel";
import { resolveAchSigningStepperState } from "./contractdata/achSigningStatusStepper";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import {
    isDefaultContractCcEmail,
    loadBoldSignCcEmailList,
    mergeContractCcEmailList,
    saveBoldSignCcEmailList,
} from "./boldsignCcList";
import {
    canResendAchAuthorization,
    canSendAchAuthorization,
    canVoidAchAuthorization,
    mergeAchAuthorizationDocuSignIntoPrefill,
    mergeAchSignerOverridesIntoPrefill,
    parseAchAuthorizationDocuSignFromPrefill,
    parseAchSignerOverridesFromPrefill,
    type AchAuthorizationDocuSignCapsuleStatus,
    type AchSignerOverrideRow,
} from "./contractdata/achAuthorizationDocuSign";
import { voidBoldSignDocument } from "@/redux/actions/boldSignActions";
import { DOCUSIGN_ADDENDUM_LAYOUT_KEYS } from "./contractdata/docusignAddendumTemplates";
import {
    parseDocumentTemplatePrefillByMappingId,
    stripDocumentTemplateBlobFromPrefillOverrides,
} from "./contractdata/documentTemplateMappingPrefill";
import {
    getApplicationPrimaryRecipientName,
    getSignerRecipientEmailForContract,
    normalizeContractPrefillOverrides,
} from "./contractdata/Contract";
import { resolveFunderSupplementalDocumentLabel } from "./contractdata/platformDocumentConfig";
import { findFunderProfile, useFunderProfiles } from "@/hooks/useFunderProfiles";
import {
    ACH_FUNDER_BRAND_OPTIONS,
    type AchFunderBrand,
    inferAchFunderBrand,
    resolveAchFunderProfileName,
} from "./achFunderSelect";
import { pickContractEnvelopeDocument, isAchSigningFinished } from "./contractdata/contractSendHistory";
import { resolveDocuSignSenderReturnUrl } from "./contractdata/resolveDocuSignSenderReturnUrl";
import {
    TemplateMappingPrefillEditDialog,
    type TemplateMappingPrefillEditRow,
} from "./contractdata/TemplateMappingPrefillEditDialog";
import { formatDate } from "@/lib/utils";
import {
    DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS,
    navigateDocuSignTab,
    openDocuSignLoadingTab,
    showDocuSignTabMessage,
} from "./docusignSenderTab";
import type { DocuSignTemplateRolePayload } from "./contractdata/templateRecipients";
import {
    buildDocuSignRolesFromEditorRows,
} from "./contractdata/templateRecipients";
import { DOCUSIGN_DEFAULT_SIGNER_ROLE, normalizeDocuSignSignerRoleName } from "./contractdata/docusignTemplateConfig";
import {
    buildContractSignerRowsFromOwnerParties,
    resolveClientOwnerPartiesFromApplication,
    syncContractSignerRowsToCrm,
} from "./contractdata/contractSignerOwnersSync";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const DOCUSIGN_PRIMARY_BTN_CLASS =
    "h-9 shrink-0 cursor-pointer border-0 bg-[var(--brand)] px-6 text-white shadow-sm hover:bg-[var(--brand)]/90 focus-visible:ring-[var(--brand)]/40";

function normalizeContractStateForFunder(value: unknown): string {
    return String(value ?? "").trim();
}

type AchPdfTab = "template" | "filled";

function formatAchDisplayLabel(value?: string | null): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const normalized = raw.toLowerCase().replace(/-/g, "_");
    if (
        normalized === "ach_authorization" ||
        normalized === "ach_authorization_standalone"
    ) {
        return "ACH Authorization";
    }
    return raw
        .replace(/\s*\(standalone\)\s*/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

type AchTemplateMappingRow = {
    id: string;
    contractId: number;
    templateId: string;
    documentType: string;
    order?: number;
    template?: {
        id?: string;
        name?: string | null;
        templateId?: string;
        layoutKey?: string | null;
    } | null;
};

export type ACHViewerModalProps = {
    isOpen: boolean;
    onClose: () => void;
    contractId: number | null;
    applicationId: string | null;
    applicationData: unknown;
    fetchedContract: Record<string, unknown> | null;
    initialPdfTab?: AchPdfTab;
    readOnly?: boolean;
    onPrepareDocuSignDraft?: (payload: {
        ccEmails: string[];
        supplementalLayoutKey?: string | null;
        includeMainContract?: boolean;
        funderName?: string | null;
        funderProfileId?: string | null;
        contractState?: string | null;
        signerRoles?: DocuSignTemplateRolePayload[];
        prefillFields?: Array<{ id: string; value: string }>;
    }) => Promise<{
        envelopeId?: string;
        sendUrl?: string | null;
    } | void>;
    onReloadContract?: () => Promise<unknown>;
};

function AchInlinePdfViewer({ fileUrl }: { fileUrl: string }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageWidth, setPageWidth] = useState(640);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => {
            const w = el.clientWidth;
            if (w > 0) setPageWidth(Math.max(280, w - 16));
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
                    <div className="flex min-h-[300px] items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden />
                    </div>
                }
                error={
                    <div className="flex min-h-[300px] items-center justify-center px-4 text-center text-xs text-slate-500">
                        Could not render this PDF.
                    </div>
                }
                className="flex w-full flex-col gap-3 px-2 py-3"
            >
                {numPages
                    ? Array.from({ length: numPages }, (_, i) => (
                          <Page
                              key={i + 1}
                              pageNumber={i + 1}
                              width={pageWidth}
                              className="max-w-full bg-white shadow-md"
                              renderTextLayer
                              renderAnnotationLayer
                          />
                      ))
                    : null}
            </Document>
        </div>
    );
}

export default function ACHViewerModal({
    isOpen,
    onClose,
    contractId,
    applicationId,
    applicationData,
    fetchedContract,
    initialPdfTab = "template",
    readOnly = false,
    onPrepareDocuSignDraft,
    onReloadContract,
}: ACHViewerModalProps) {
    const dispatch = useDispatch<AppDispatch>();

    const [resolvedContract, setResolvedContract] = useState<Record<string, unknown> | null>(
        fetchedContract,
    );
    const [pdfTab, setPdfTab] = useState<AchPdfTab>(initialPdfTab);
    const [templatePdfUrl, setTemplatePdfUrl] = useState<string | null>(null);
    const [filledPdfUrl, setFilledPdfUrl] = useState<string | null>(null);
    const [templatePdfLoading, setTemplatePdfLoading] = useState(false);
    const [filledPdfLoading, setFilledPdfLoading] = useState(false);
    const [filledPdfHint, setFilledPdfHint] = useState<string | null>(null);
    const [linkedAchMapping, setLinkedAchMapping] = useState<AchTemplateMappingRow | null>(null);
    const [mappingLoading, setMappingLoading] = useState(false);
    const [achPrefillEditOpen, setAchPrefillEditOpen] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [docuSignOpenUrl, setDocuSignOpenUrl] = useState<string | null>(null);
    const [statusRefreshing, setStatusRefreshing] = useState(false);
    const [achSyncError, setAchSyncError] = useState<string | null>(null);
    const [isVoiding, setIsVoiding] = useState(false);
    const [sessionEnvelopeId, setSessionEnvelopeId] = useState<string | null>(null);
    const [lastSigningStatusSyncAt, setLastSigningStatusSyncAt] = useState<Date | null>(null);
    const modalWasOpenRef = useRef(false);
    const [ccEmails, setCcEmails] = useState<string[]>([]);
    const [ccEmailDraft, setCcEmailDraft] = useState("");
    const [achSignerOverrides, setAchSignerOverrides] = useState<AchSignerOverrideRow[] | null>(
        null,
    );
    const [showAchSignerEditor, setShowAchSignerEditor] = useState(false);
    const [achSignerEditorRows, setAchSignerEditorRows] = useState<
        { id: string; role: string; name: string; email: string }[]
    >([{ id: "tmp-1", role: "", name: "", email: "" }]);
    const [savingAchSigners, setSavingAchSigners] = useState(false);
    const ccEmailsRef = useRef<string[]>([]);
    const docusignSenderReturnWatchCleanupRef = useRef<(() => void) | null>(null);

    const contractState = useMemo(
        () => normalizeContractStateForFunder((resolvedContract as { state?: unknown } | null)?.state),
        [resolvedContract],
    );
    const {
        funders,
        findFunder,
    } = useFunderProfiles(contractState || null);
    const [selectedAchBrand, setSelectedAchBrand] = useState<AchFunderBrand>("katan");

    const resolvedAchFunderName = useMemo(
        () => resolveAchFunderProfileName(selectedAchBrand, funders, contractState || null),
        [selectedAchBrand, funders, contractState],
    );

    const selectedAchFunderProfileId = useMemo(() => {
        const profile =
            findFunder(resolvedAchFunderName) ??
            findFunderProfile(funders, resolvedAchFunderName, null);
        return profile?.id ? String(profile.id).trim() : "";
    }, [findFunder, funders, resolvedAchFunderName]);

    const achPreviewLayoutKey = DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE;

    const achTemplateLayoutKey = useMemo(() => {
        return String(
            linkedAchMapping?.template?.layoutKey ??
                linkedAchMapping?.template?.templateId ??
                DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE,
        ).trim();
    }, [linkedAchMapping]);

    ccEmailsRef.current = mergeContractCcEmailList(
        ccEmails,
        resolvedAchFunderName,
        funders,
        contractState || null,
    );

    const contractPrefillFromDb = useMemo(
        () =>
            normalizeContractPrefillOverrides(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ),
        [resolvedContract],
    );

    const documentTemplatePrefillByMappingId = useMemo(
        () =>
            parseDocumentTemplatePrefillByMappingId(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ),
        [resolvedContract],
    );

    const mainContractEnvelopeId = useMemo(
        () => String(pickContractEnvelopeDocument(resolvedContract)?.envelopeId ?? "").trim() || null,
        [resolvedContract],
    );

    const achAuthorizationDocuSign = useMemo(
        () =>
            parseAchAuthorizationDocuSignFromPrefill(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
                { excludeEnvelopeId: mainContractEnvelopeId },
            ),
        [resolvedContract, mainContractEnvelopeId],
    );

    const achCapsuleStatus: AchAuthorizationDocuSignCapsuleStatus =
        achAuthorizationDocuSign?.status ?? "DRAFT";
    const achCapsuleStatusRef = useRef(achCapsuleStatus);
    achCapsuleStatusRef.current = achCapsuleStatus;

    const linkedEnvelopeId = useMemo(() => {
        const fromDb = String(achAuthorizationDocuSign?.envelopeId ?? "").trim();
        if (fromDb && fromDb !== mainContractEnvelopeId) return fromDb;
        const session = String(sessionEnvelopeId ?? "").trim();
        if (session && session !== mainContractEnvelopeId) return session;
        return null;
    }, [achAuthorizationDocuSign?.envelopeId, sessionEnvelopeId, mainContractEnvelopeId]);

    const hasFilledPdf = Boolean(linkedEnvelopeId);
    const isSigned = achCapsuleStatus === "SIGNED";
    const isVoided = achCapsuleStatus === "VOIDED";
    const canVoidAch =
        !readOnly && canVoidAchAuthorization(achAuthorizationDocuSign, sessionEnvelopeId);
    const canResendAch =
        !readOnly &&
        Boolean(onPrepareDocuSignDraft) &&
        canResendAchAuthorization(achAuthorizationDocuSign, sessionEnvelopeId);
    const canSendAchAfterVoid =
        !readOnly &&
        Boolean(onPrepareDocuSignDraft) &&
        canSendAchAuthorization(achAuthorizationDocuSign, sessionEnvelopeId);
    const canContinueDraft =
        !readOnly &&
        Boolean(onPrepareDocuSignDraft) &&
        hasFilledPdf &&
        achCapsuleStatus === "DRAFT";
    const canInitialSend =
        !readOnly &&
        Boolean(onPrepareDocuSignDraft) &&
        canSendAchAfterVoid &&
        !hasFilledPdf;
    const canReviewAndSend = canContinueDraft || canInitialSend;

    const achDownloadFunderName = useMemo(() => {
        const fromMeta = String(achAuthorizationDocuSign?.funderName ?? "").trim();
        if (fromMeta) return fromMeta;
        return String(resolvedAchFunderName || "").trim();
    }, [achAuthorizationDocuSign?.funderName, resolvedAchFunderName]);

    const canEditAchRecipients =
        !readOnly &&
        !isSigned &&
        achCapsuleStatus !== "SENT" &&
        achCapsuleStatus !== "VIEWED";

    /** Funder can change before resend (signed/voided) or on first send; locked while out for signature. */
    const canEditAchFunder =
        !readOnly && achCapsuleStatus !== "SENT" && achCapsuleStatus !== "VIEWED";

    const suggestedAchSignerRows = useMemo(
        () => buildContractSignerRowsFromOwnerParties(
            resolveClientOwnerPartiesFromApplication(applicationData),
        ),
        [applicationData],
    );

    const defaultAchSignerRow = useMemo((): AchSignerOverrideRow => {
        const primary = suggestedAchSignerRows[0];
        if (primary?.email) {
            return {
                role: DOCUSIGN_DEFAULT_SIGNER_ROLE,
                name: primary.name,
                email: primary.email,
            };
        }
        return {
            role: DOCUSIGN_DEFAULT_SIGNER_ROLE,
            name: getApplicationPrimaryRecipientName(applicationData),
            email: getSignerRecipientEmailForContract(applicationData, resolvedContract).trim(),
        };
    }, [applicationData, resolvedContract, suggestedAchSignerRows]);

    const achSummarySigners = useMemo((): AchSignerOverrideRow[] => {
        if (achSignerOverrides?.length) return achSignerOverrides;
        if (!defaultAchSignerRow.email) return [];
        return [defaultAchSignerRow];
    }, [achSignerOverrides, defaultAchSignerRow]);

    const buildAchSignerRolesForSend = useCallback((): DocuSignTemplateRolePayload[] => {
        const rows = achSignerOverrides?.length ? achSignerOverrides : achSummarySigners;
        return buildDocuSignRolesFromEditorRows(rows);
    }, [achSignerOverrides, achSummarySigners]);

    const achSigningStepper = useMemo(
        () => resolveAchSigningStepperState(achCapsuleStatus, hasFilledPdf),
        [achCapsuleStatus, hasFilledPdf],
    );

    const achCrmUpdatedAt =
        achAuthorizationDocuSign?.updatedAt ??
        (resolvedContract as { updatedAt?: unknown } | null)?.updatedAt ??
        null;

    const templateLabel = useMemo(() => {
        const funderProfile = findFunder(resolvedAchFunderName);
        const fromMapping = linkedAchMapping?.template?.name?.trim();
        const raw =
            resolveFunderSupplementalDocumentLabel(achTemplateLayoutKey, {
                funderProfile: funderProfile ?? null,
                storedTemplateName: fromMapping ?? null,
            }) || "ACH Authorization";
        return formatAchDisplayLabel(raw) || "ACH Authorization";
    }, [achTemplateLayoutKey, findFunder, linkedAchMapping, resolvedAchFunderName]);

    const achDocumentSubtitle = useMemo(() => {
        if (mappingLoading) return "Loading…";
        if (templateLabel && templateLabel !== "ACH Authorization") return templateLabel;
        const profile = findFunder(resolvedAchFunderName);
        return (
            profile?.displayName?.trim() ||
            profile?.name?.trim() ||
            resolvedAchFunderName.trim() ||
            "ACH Authorization"
        );
    }, [findFunder, mappingLoading, resolvedAchFunderName, templateLabel]);

    const headerEntityLabel = useMemo(() => {
        if (!templateLabel || templateLabel === "ACH Authorization") return null;
        const withoutAchSuffix = templateLabel
            .replace(/\s*[-–]\s*ACH\s+Authorization\s*$/i, "")
            .trim();
        if (withoutAchSuffix && withoutAchSuffix.toLowerCase() !== "ach authorization") {
            return withoutAchSuffix;
        }
        return templateLabel;
    }, [templateLabel]);

    const showVoidButton = canVoidAch && !docuSignOpenUrl;
    const showSendAfterVoidButton =
        isVoided &&
        !docuSignOpenUrl &&
        Boolean(onPrepareDocuSignDraft) &&
        (canResendAch || canInitialSend) &&
        !canContinueDraft;
    const showResendAfterSignedButton = isSigned && canResendAch && !docuSignOpenUrl;
    const showReviewAndSendButton =
        !isVoided &&
        (canInitialSend || canContinueDraft) &&
        !docuSignOpenUrl &&
        !isSigned;
    const showOpenDocuSignInFooter =
        Boolean(docuSignOpenUrl) && canReviewAndSend && !isSigned && !isVoided;

    const revokeBlob = useCallback((url: string | null) => {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    }, []);

    const reloadContractLocal = useCallback(async (): Promise<Record<string, unknown> | null> => {
        if (onReloadContract) {
            const next = await onReloadContract();
            if (next && typeof next === "object") {
                setResolvedContract(next as Record<string, unknown>);
                return next as Record<string, unknown>;
            }
            return null;
        }
        if (!applicationId) return null;
        const res = await dispatch(getByApplicationIdContract(String(applicationId))).unwrap();
        const contract = (res as { data?: unknown })?.data ?? res;
        if (contract && typeof contract === "object") {
            setResolvedContract(contract as Record<string, unknown>);
            return contract as Record<string, unknown>;
        }
        return null;
    }, [applicationId, dispatch, onReloadContract]);

    const fetchTemplateMappings = useCallback(async () => {
        if (contractId == null) return;
        setMappingLoading(true);
        try {
            const res = await axiosGet(`/contract/${contractId}/document-template-mappings`);
            const rows = (res?.data?.data ?? []) as AchTemplateMappingRow[];
            const achRows = rows.filter(
                (row) => String(row.documentType ?? "").toLowerCase() === "ach",
            );
            const primary =
                achRows.length > 0
                    ? [...achRows].sort(
                          (a, b) => Number(b.order ?? 0) - Number(a.order ?? 0),
                      )[0]
                    : null;
            setLinkedAchMapping(primary ?? null);
        } catch (err) {
            console.warn("[ACHViewerModal] template mappings:", err);
            setLinkedAchMapping(null);
        } finally {
            setMappingLoading(false);
        }
    }, [contractId]);

    const loadTemplatePdf = useCallback(async () => {
        const templateRef = achPreviewLayoutKey;
        if (!templateRef) return;
        const funderName = String(resolvedAchFunderName || "").trim();
        const funderProfileId = selectedAchFunderProfileId;
        setTemplatePdfLoading(true);
        try {
            const response = await axiosGet(
                `/docusign/template/${encodeURIComponent(templateRef)}/download`,
                {
                    responseType: "blob",
                    params: {
                        ...(funderProfileId ? { funderProfileId } : {}),
                        ...(funderName ? { funderName } : {}),
                        ...(contractState ? { state: contractState } : {}),
                    },
                },
            );
            const blob =
                response?.data instanceof Blob
                    ? response.data
                    : new Blob([response?.data], { type: "application/pdf" });
            if (!blob.size) {
                toast.error("ACH template PDF is empty.");
                return;
            }
            const url = URL.createObjectURL(blob);
            setTemplatePdfUrl((prev) => {
                revokeBlob(prev);
                return url;
            });
        } catch {
            toast.error("Failed to load ACH template PDF.");
        } finally {
            setTemplatePdfLoading(false);
        }
    }, [
        achPreviewLayoutKey,
        contractState,
        revokeBlob,
        resolvedAchFunderName,
        selectedAchFunderProfileId,
    ]);

    const loadFilledPdf = useCallback(
        async (envelopeId?: string | null, options?: { silent?: boolean }) => {
            const eid = String(envelopeId ?? linkedEnvelopeId ?? "").trim();
            if (!eid) {
                setFilledPdfHint("No DocuSign envelope yet. Review and send to create a filled PDF.");
                return;
            }
            if (!options?.silent) setFilledPdfLoading(true);
            setFilledPdfHint(null);
            try {
                const res = await axiosGet(`/docusign/download/${encodeURIComponent(eid)}`, {
                    responseType: "blob",
                    timeout: 120000,
                    params: {
                        ...(applicationId ? { applicationId: String(applicationId) } : {}),
                        ...(contractId != null ? { contractId } : {}),
                        ...(achDownloadFunderName ? { funderName: achDownloadFunderName } : {}),
                    },
                });
                const blob =
                    res.data instanceof Blob
                        ? res.data
                        : new Blob([res.data], { type: "application/pdf" });
                if (!blob.size) {
                    setFilledPdfHint("DocuSign returned an empty PDF. Try again shortly.");
                    return;
                }
                const url = URL.createObjectURL(blob);
                setFilledPdfUrl((prev) => {
                    revokeBlob(prev);
                    return url;
                });
            } catch (err) {
                const apiMessage = await parseApiErrorMessageFromAxios(err);
                setFilledPdfHint(
                    isSigned
                        ? apiMessage || "Could not load signed ACH PDF."
                        : apiMessage ||
                              "Filled PDF is not ready yet. Refresh after sending from DocuSign.",
                );
            } finally {
                if (!options?.silent) setFilledPdfLoading(false);
            }
        },
        [
            achDownloadFunderName,
            applicationId,
            contractId,
            linkedEnvelopeId,
            revokeBlob,
            isSigned,
        ],
    );

    const syncPrefillToDraftEnvelope = useCallback(
        async (contractOverride?: Record<string, unknown> | null) => {
            const contract = contractOverride ?? resolvedContract;
            const envelopeId = resolveAchDraftEnvelopeIdForSync({
                achCapsuleStatus: achCapsuleStatusRef.current,
                achEnvelopeId: parseAchAuthorizationDocuSignFromPrefill(
                    (contract as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides,
                    { excludeEnvelopeId: mainContractEnvelopeId },
                )?.envelopeId,
                sessionEnvelopeId,
                mainContractEnvelopeId,
            });
            if (!envelopeId) return;

            const mappingBlob = parseDocumentTemplatePrefillByMappingId(
                (contract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            );
            const fields = buildAchDocuSignPrefillFieldsPayload({
                contract,
                application: applicationData as Record<string, unknown> | null,
                linkedAchMapping,
                contractPrefillOverridesRaw: (contract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
                achLayoutKey: achTemplateLayoutKey,
                documentTemplatePrefillByMappingId: mappingBlob,
            });
            if (!fields.length) return;

            try {
                const result = await patchDocuSignPrefillFields(envelopeId, fields);
                docuSignPrefillSyncToast(result, { hasDraftEnvelope: true });
                void loadFilledPdf(envelopeId, { silent: true });
            } catch (err) {
                console.warn("[ACH DocuSign] prefill sync to draft envelope failed:", err);
                toast.warning(
                    "ACH prefill saved in CRM, but the DocuSign draft could not be updated. Use Review & send to refresh the draft.",
                );
            }
        },
        [
            achTemplateLayoutKey,
            applicationData,
            linkedAchMapping,
            loadFilledPdf,
            mainContractEnvelopeId,
            resolvedContract,
            sessionEnvelopeId,
        ],
    );

    const mergeAchEnvelopeIntoLocalContract = useCallback(
        (
            envelopeId: string,
            status: AchAuthorizationDocuSignCapsuleStatus = "DRAFT",
            funderName?: string | null,
        ) => {
            setResolvedContract((prev) => {
                if (!prev || typeof prev !== "object") return prev;
                return {
                    ...prev,
                    contractPrefillOverrides: mergeAchAuthorizationDocuSignIntoPrefill(
                        (prev as { contractPrefillOverrides?: unknown }).contractPrefillOverrides,
                        {
                            envelopeId,
                            status,
                            funderName:
                                String(funderName ?? achDownloadFunderName ?? "").trim() || null,
                        },
                    ),
                };
            });
        },
        [achDownloadFunderName],
    );

    const refreshAchStatus = useCallback(
        async (silent?: boolean, options?: { force?: boolean }) => {
            const eid = String(linkedEnvelopeId ?? "").trim();
            if (!eid) return;
            if (isAchSigningFinished(achCapsuleStatus)) {
                if (!silent) setAchSyncError(null);
                if (options?.force) {
                    await loadFilledPdf(eid, { silent: true });
                }
                return;
            }
            if (!silent) setStatusRefreshing(true);
            try {
                const result = await syncDocuSignEnvelopeStatus(eid, {
                    applicationId: applicationId ?? undefined,
                    contractId,
                    funderName: achDownloadFunderName || undefined,
                    force: options?.force ?? !silent,
                    silent,
                    envelopeLabel: "ACH authorization",
                });
                const achStatus = (
                    result.data as { achAuthorizationStatus?: AchAuthorizationDocuSignCapsuleStatus }
                )?.achAuthorizationStatus;
                if (achStatus) {
                    mergeAchEnvelopeIntoLocalContract(eid, achStatus);
                }
                if (result.rateLimited) {
                    const msg =
                        "DocuSign polling limit reached for ACH. Wait a few minutes or rely on webhook updates.";
                    setAchSyncError(msg);
                    if (!silent) toast.warning(msg);
                } else {
                    setAchSyncError(null);
                    setLastSigningStatusSyncAt(new Date());
                }
            } catch (err: unknown) {
                const msg =
                    err instanceof Error
                        ? err.message
                        : "Could not refresh ACH status.";
                setAchSyncError(msg);
                if (!silent) toast.error(msg);
            } finally {
                try {
                    await reloadContractLocal();
                    await loadFilledPdf(eid, { silent: true });
                } catch {
                    /* still surface sync error below */
                }
                if (!silent) setStatusRefreshing(false);
            }
        },
        [
            applicationId,
            achCapsuleStatus,
            contractId,
            linkedEnvelopeId,
            reloadContractLocal,
            loadFilledPdf,
            mergeAchEnvelopeIntoLocalContract,
        ],
    );

    const handleManualStatusUpdate = useCallback(async () => {
        await refreshAchStatus(false, { force: true });
    }, [refreshAchStatus]);

    const beginAchSenderReturnStatusWatch = useCallback(() => {
        docusignSenderReturnWatchCleanupRef.current?.();
        docusignSenderReturnWatchCleanupRef.current = watchDocuSignSenderReturn({
            onReturn: () => refreshAchStatus(true, { force: true }),
            shouldStop: () => isAchSigningFinished(achCapsuleStatusRef.current),
        });
    }, [refreshAchStatus]);

    const openAchSignerEditor = useCallback(() => {
        if (achSummarySigners.length) {
            setAchSignerEditorRows(
                achSummarySigners.map((row, idx) => ({
                    id: String(idx + 1),
                    role: row.role,
                    name: row.name,
                    email: row.email,
                })),
            );
        } else {
            setAchSignerEditorRows([
                {
                    id: "1",
                    role: defaultAchSignerRow.role,
                    name: defaultAchSignerRow.name,
                    email: defaultAchSignerRow.email,
                },
            ]);
        }
        setShowAchSignerEditor(true);
    }, [achSummarySigners, defaultAchSignerRow]);

    const addAchCcFromDraft = useCallback(() => {
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
        const next = mergeContractCcEmailList(
            [...ccEmails, raw],
            resolvedAchFunderName,
            funders,
            contractState || null,
        );
        setCcEmails(next);
        saveBoldSignCcEmailList(next);
        setCcEmailDraft("");
    }, [ccEmailDraft, ccEmails, funders, resolvedAchFunderName, contractState]);

    const saveAchSigners = useCallback(async () => {
        const rows = achSignerEditorRows
            .filter((r) => r.email.trim())
            .map((r) => ({
                role: DOCUSIGN_DEFAULT_SIGNER_ROLE,
                name: r.name.trim(),
                email: r.email.trim(),
            }));
        const roles = buildDocuSignRolesFromEditorRows(rows);
        if (!roles.length) {
            toast.error("Enter an email for at least one signer.");
            return;
        }
        if (rows.some((r) => r.role && !r.email)) {
            toast.error("Every signer role needs an email address.");
            return;
        }
        if (contractId == null) {
            toast.error("Contract is required to save ACH signers.");
            return;
        }

        setSavingAchSigners(true);
        try {
            const prefillBase =
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides ?? contractPrefillFromDb;
            const contractPrefillOverrides = mergeAchSignerOverridesIntoPrefill(prefillBase, rows);
            const updated = await dispatch(
                updateContract({
                    id: contractId,
                    data: { contractPrefillOverrides },
                }),
            ).unwrap();
            const payload = (updated as { data?: unknown })?.data ?? updated;
            setResolvedContract((prev) =>
                prev && typeof prev === "object"
                    ? {
                          ...prev,
                          ...(payload as Record<string, unknown>),
                          contractPrefillOverrides,
                      }
                    : (payload as Record<string, unknown>),
            );
            setAchSignerOverrides(rows);
            setShowAchSignerEditor(false);

            if (contractId != null) {
                try {
                    await syncContractSignerRowsToCrm({
                        dispatch,
                        contractId,
                        applicationData,
                        signerRows: rows,
                    });
                } catch (syncOwnerErr: unknown) {
                    console.error(syncOwnerErr);
                    toast.warn(
                        "ACH signers saved on the contract, but owner records could not be synced to CRM.",
                    );
                }
            }

            const draftEnvelopeId = String(linkedEnvelopeId ?? "").trim();
            if (draftEnvelopeId && achCapsuleStatus === "DRAFT") {
                try {
                    await axiosPost("/docusign/sync-envelope-cc", {
                        envelopeId: draftEnvelopeId,
                        roles,
                        ccEmails: ccEmailsRef.current,
                        ...(applicationId ? { applicationId: String(applicationId) } : {}),
                        signerEmail: roles[0]?.signerEmail,
                        signerName: roles[0]?.signerName,
                    });
                    toast.success("ACH signers updated on this DocuSign draft.");
                } catch (syncErr: unknown) {
                    const syncMsg =
                        (syncErr as { response?: { data?: { message?: string } }; message?: string })
                            ?.response?.data?.message ||
                        (syncErr as { message?: string })?.message ||
                        "";
                    toast.warning(
                        syncMsg
                            ? `Signers saved in CRM. DocuSign draft could not be updated: ${syncMsg}`
                            : "Signers saved in CRM. Review & send to apply them on a new DocuSign draft.",
                    );
                }
            } else {
                toast.success("ACH signers saved. They will be used when you Review & send.");
            }
        } catch (err: unknown) {
            const msg =
                typeof err === "string"
                    ? err
                    : String((err as { message?: string })?.message || "Failed to save ACH signers.");
            toast.error(msg);
        } finally {
            setSavingAchSigners(false);
        }
    }, [
        achSignerEditorRows,
        achCapsuleStatus,
        applicationId,
        contractId,
        contractPrefillFromDb,
        dispatch,
        linkedEnvelopeId,
        resolvedContract,
    ]);

    const fetchSenderViewWithRetry = useCallback(
        async (envelopeId: string, ccEmails: string[], justCreated: boolean) => {
            const delays = justCreated
                ? DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS.justCreated
                : DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS.existing;
            const returnUrl = resolveDocuSignSenderReturnUrl();
            const roles = buildAchSignerRolesForSend();
            const signerEmail =
                roles[0]?.signerEmail?.trim() ||
                getSignerRecipientEmailForContract(applicationData, resolvedContract).trim();
            const signerName =
                roles[0]?.signerName?.trim() ||
                getApplicationPrimaryRecipientName(applicationData);
            let lastError = "";
            for (const delay of delays) {
                if (delay > 0) await new Promise((r) => setTimeout(r, delay));
                try {
                    const res = await axiosPost("/docusign/sender-view", {
                        envelopeId,
                        returnUrl,
                        ccEmails,
                        ...(applicationId ? { applicationId: String(applicationId) } : {}),
                        ...(signerEmail ? { signerEmail, signerName } : {}),
                    });
                    const url = String((res as { data?: { url?: string } })?.data?.url ?? "").trim();
                    if (url) return { url, error: null };
                } catch (err: unknown) {
                    lastError =
                        (err as { response?: { data?: { message?: string } }; message?: string })
                            ?.response?.data?.message ||
                        (err as { message?: string })?.message ||
                        "Could not load DocuSign review URL.";
                }
            }
            return { url: null, error: lastError };
        },
        [applicationData, applicationId, buildAchSignerRolesForSend, resolvedContract],
    );

    const resetAchFilledPreview = useCallback(() => {
        setFilledPdfUrl((prev) => {
            revokeBlob(prev);
            return null;
        });
        setFilledPdfHint(null);
    }, [revokeBlob]);

    const handleVoidAch = async () => {
        const envelopeId = String(linkedEnvelopeId ?? "").trim();
        if (!envelopeId || isVoiding || readOnly) return;
        const confirmed = window.confirm(
            "Void this ACH form in DocuSign? Signers will no longer be able to sign. You can resend a new form afterward.",
        );
        if (!confirmed) return;

        setIsVoiding(true);
        try {
            await dispatch(
                voidBoldSignDocument({
                    documentId: envelopeId,
                    reason: "Voided by user from CRM",
                }),
            ).unwrap();
            setSessionEnvelopeId(null);
            setDocuSignOpenUrl(null);
            resetAchFilledPreview();
            setPdfTab("template");
            await reloadContractLocal();
            toast.success("ACH form voided in DocuSign. You can send a new ACH form when you are ready.");
        } catch (err: unknown) {
            const msg =
                typeof err === "string"
                    ? err
                    : String(
                          (err as { message?: string })?.message || "Failed to void ACH form.",
                      );
            toast.error(msg);
        } finally {
            setIsVoiding(false);
        }
    };

    const handleReviewInDocuSign = async (options?: { forceNewEnvelope?: boolean }) => {
        if (!onPrepareDocuSignDraft || isSending) return;

        const docuSignTab = openDocuSignLoadingTab();
        if (!docuSignTab) {
            toast.warning("Allow pop-ups for this site so DocuSign can open in a new tab.", {
                autoClose: 8000,
            });
        }

        setIsSending(true);
        try {
            const draft = ccEmailDraft.trim();
            let toSend = [...ccEmails];
            if (draft && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft)) {
                const dup = toSend.some((e) => e.toLowerCase() === draft.toLowerCase());
                if (!dup) {
                    toSend = [...toSend, draft];
                }
            }
            const ccEmailsToSend = mergeContractCcEmailList(
                [...new Set(toSend.map((e) => e.trim()).filter(Boolean))],
                resolvedAchFunderName,
                funders,
                contractState || null,
            );
            saveBoldSignCcEmailList(ccEmailsToSend);
            setCcEmails(ccEmailsToSend);
            setCcEmailDraft("");

            const signerRoles = buildAchSignerRolesForSend();
            if (!signerRoles.length || !signerRoles[0]?.signerEmail?.trim()) {
                const msg = "Add an ACH signer with a valid email before sending.";
                toast.error(msg);
                showDocuSignTabMessage(docuSignTab, "Could not open DocuSign", msg);
                setShowAchSignerEditor(true);
                return;
            }

            let envelopeId = String(linkedEnvelopeId ?? "").trim();
            let preparedSendUrl: string | null = null;
            const reuseExistingEnvelope =
                !options?.forceNewEnvelope &&
                Boolean(envelopeId) &&
                achCapsuleStatus === "DRAFT";

            if (!reuseExistingEnvelope) {
                const prepared = await onPrepareDocuSignDraft({
                    ccEmails: ccEmailsToSend,
                    supplementalLayoutKey:
                        DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE,
                    includeMainContract: false,
                    funderName: resolvedAchFunderName.trim() || null,
                    funderProfileId: selectedAchFunderProfileId || null,
                    contractState: contractState || null,
                    signerRoles,
                });
                envelopeId = String(prepared?.envelopeId ?? "").trim();
                preparedSendUrl = String(prepared?.sendUrl ?? "").trim() || null;
                await reloadContractLocal();
            } else {
                try {
                    await axiosPost("/docusign/sync-envelope-cc", {
                        envelopeId,
                        roles: signerRoles,
                        ccEmails: ccEmailsToSend,
                        ...(applicationId ? { applicationId: String(applicationId) } : {}),
                        signerEmail: signerRoles[0]?.signerEmail,
                        signerName: signerRoles[0]?.signerName,
                    });
                } catch {
                    /* sender-view still receives ccEmails */
                }
            }

            if (!envelopeId) {
                const msg = "Could not create the ACH DocuSign draft.";
                toast.error(msg);
                showDocuSignTabMessage(docuSignTab, "Could not open DocuSign", msg);
                return;
            }

            setSessionEnvelopeId(envelopeId);
            mergeAchEnvelopeIntoLocalContract(envelopeId, "DRAFT");
            setPdfTab("filled");

            const senderViewResult = await fetchSenderViewWithRetry(
                envelopeId,
                ccEmailsToSend,
                !reuseExistingEnvelope,
            );
            const senderUrl = senderViewResult.url || preparedSendUrl || null;

            if (!senderUrl) {
                const msg =
                    senderViewResult.error ||
                    "ACH draft was created but DocuSign did not return a review URL yet.";
                toast.error(msg, { autoClose: 12000 });
                showDocuSignTabMessage(docuSignTab, "Could not open DocuSign", msg);
                return;
            }

            const opened = navigateDocuSignTab(docuSignTab, senderUrl);
            beginAchSenderReturnStatusWatch();
            if (!opened) {
                setDocuSignOpenUrl(senderUrl);
                toast.info(
                    "Pop-up blocked. Click Open DocuSign below (or allow pop-ups for this site).",
                    { autoClose: 12000 },
                );
            } else {
                setDocuSignOpenUrl(null);
                toast.success(
                    "ACH authorization opened in DocuSign. Review the form and click Send to email the signer.",
                    { autoClose: 12000 },
                );
            }

            await reloadContractLocal();
            void loadFilledPdf(envelopeId);
            void refreshAchStatus(true, { force: true });
        } catch (error) {
            console.error("Failed to open ACH in DocuSign:", error);
            showDocuSignTabMessage(
                docuSignTab,
                "Could not open DocuSign",
                "Something went wrong while preparing the ACH draft.",
            );
            toast.error("Failed to open ACH authorization in DocuSign.");
        } finally {
            setIsSending(false);
        }
    };

    useEffect(() => {
        if (!isOpen) {
            modalWasOpenRef.current = false;
            docusignSenderReturnWatchCleanupRef.current?.();
            docusignSenderReturnWatchCleanupRef.current = null;
            return;
        }
        if (!modalWasOpenRef.current) {
            modalWasOpenRef.current = true;
            setPdfTab(initialPdfTab);
            setDocuSignOpenUrl(null);
            setCcEmailDraft("");
            setShowAchSignerEditor(false);
            const storedAchFunder = parseAchAuthorizationDocuSignFromPrefill(
                (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
                { excludeEnvelopeId: mainContractEnvelopeId },
            )?.funderName;
            setSelectedAchBrand(
                inferAchFunderBrand(
                    storedAchFunder,
                    funders,
                    normalizeContractStateForFunder(
                        (fetchedContract as { state?: unknown } | null)?.state,
                    ),
                ),
            );
        }
        setResolvedContract(fetchedContract);
        setAchSignerOverrides(
            parseAchSignerOverridesFromPrefill(
                (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ),
        );
    }, [isOpen, fetchedContract, funders, initialPdfTab, mainContractEnvelopeId]);

    useEffect(() => {
        if (!isOpen) return;
        setCcEmails(
            loadBoldSignCcEmailList(resolvedAchFunderName, funders, contractState || null),
        );
    }, [isOpen, resolvedAchFunderName, funders, contractState]);

    useEffect(() => {
        if (!isOpen || contractId == null) return;
        void fetchTemplateMappings();
    }, [isOpen, contractId, fetchTemplateMappings]);

    useEffect(() => {
        if (!isOpen || mappingLoading) return;
        void loadTemplatePdf();
    }, [isOpen, mappingLoading, achPreviewLayoutKey, resolvedAchFunderName, selectedAchBrand, selectedAchFunderProfileId, loadTemplatePdf]);

    useEffect(() => {
        if (!isOpen || !linkedEnvelopeId) return;
        setPdfTab((prev) => (prev === "template" && initialPdfTab === "filled" ? "filled" : prev));
        void loadFilledPdf(linkedEnvelopeId);
    }, [isOpen, linkedEnvelopeId, loadFilledPdf, initialPdfTab]);

    useEffect(() => {
        return () => {
            revokeBlob(templatePdfUrl);
            revokeBlob(filledPdfUrl);
        };
    }, [templatePdfUrl, filledPdfUrl, revokeBlob]);

    const prefillEditRow: TemplateMappingPrefillEditRow | null = useMemo(() => {
        if (contractId == null) return null;
        if (linkedAchMapping) {
            return {
                id: linkedAchMapping.id,
                contractId: linkedAchMapping.contractId,
                templateId: String(
                    linkedAchMapping.template?.templateId ?? linkedAchMapping.templateId ?? "",
                ),
                documentType: String(linkedAchMapping.documentType || "ach"),
                template: linkedAchMapping.template ?? null,
            };
        }
        return {
            id: "ach-form-standalone",
            contractId,
            templateId: DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE,
            documentType: "ach",
            template: {
                templateId: DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE,
                name: formatAchDisplayLabel(
                    resolveFunderSupplementalDocumentLabel(
                        DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE,
                        { funderProfile: findFunder(resolvedAchFunderName) ?? null },
                    ),
                ) || "ACH Authorization",
            },
        };
    }, [contractId, findFunder, linkedAchMapping, resolvedAchFunderName]);

    if (!isOpen) return null;

    const activePdfUrl = pdfTab === "filled" ? filledPdfUrl : templatePdfUrl;
    const activePdfLoading = pdfTab === "filled" ? filledPdfLoading : templatePdfLoading;

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
                <DialogContent className="flex h-[min(94vh,calc(100dvh-1.5rem))] max-h-[min(94vh,calc(100dvh-1.5rem))] min-h-0 w-[1280px] max-w-[96vw] flex-col gap-0 overflow-hidden bg-white p-0 dark:bg-slate-900">
                    <div className="shrink-0 border-b border-slate-200 px-6 py-4 dark:border-slate-700">
                        <DialogTitle className="text-base font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
                            ACH Authorization
                            {headerEntityLabel ? (
                                <span className="font-semibold normal-case text-slate-600 dark:text-slate-300">
                                    {" "}
                                    — {headerEntityLabel}
                                </span>
                            ) : null}
                        </DialogTitle>
                        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                            Preview the ACH form, edit prefilled fields, then review and send in
                            DocuSign. Status updates when DocuSign webhooks are received.
                        </p>
                    </div>

                    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(400px,44%)_minmax(0,56%)]">
                        <div className="flex min-h-0 shrink-0 flex-col gap-4 overflow-y-auto border-r border-slate-200 p-4 dark:border-slate-700">
                            {!readOnly ? (
                                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/50">
                                    <label
                                        className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300"
                                        htmlFor="ach-viewer-funder-select"
                                    >
                                        <Building2
                                            className="h-3.5 w-3.5 text-[var(--brand)]"
                                            aria-hidden
                                        />
                                        ACH funder
                                    </label>
                                    <Select
                                        value={selectedAchBrand}
                                        disabled={!canEditAchFunder}
                                        onValueChange={(value: AchFunderBrand) => {
                                            setSelectedAchBrand(value);
                                            setTemplatePdfUrl((prev) => {
                                                revokeBlob(prev);
                                                return null;
                                            });
                                            const nextFunder = resolveAchFunderProfileName(
                                                value,
                                                funders,
                                                contractState || null,
                                            );
                                            setCcEmails(
                                                loadBoldSignCcEmailList(
                                                    nextFunder,
                                                    funders,
                                                    contractState || null,
                                                ),
                                            );
                                            if (
                                                linkedEnvelopeId &&
                                                (achCapsuleStatus === "DRAFT" ||
                                                    isSigned ||
                                                    isVoided)
                                            ) {
                                                toast.info(
                                                    isSigned || isVoided
                                                        ? "Funder changed. Click Resend ACH form (or Send ACH form) to create a new DocuSign envelope with the selected funder."
                                                        : "Funder changed. Use Resend ACH form to create a new DocuSign draft with the selected funder's PDF.",
                                                );
                                            }
                                        }}
                                    >
                                        <SelectTrigger
                                            id="ach-viewer-funder-select"
                                            className="h-10 w-full rounded-md border border-[var(--brand)]/20 bg-background px-3 py-2 text-sm shadow-sm focus:ring-[var(--brand)]/25 disabled:opacity-60 dark:border-slate-600"
                                        >
                                            <SelectValue placeholder="Select funder" />
                                        </SelectTrigger>
                                        <SelectContent position="popper" className="z-[10100] max-h-72">
                                            {ACH_FUNDER_BRAND_OPTIONS.map((f) => (
                                                <SelectItem key={f.value} value={f.value}>
                                                    {f.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : null}

                            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/50">
                                <div className="mb-4 flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 items-start gap-2.5">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]">
                                            <Landmark className="h-4 w-4" aria-hidden />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
                                                ACH Authorization
                                            </h4>
                                            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                                {achDocumentSubtitle}
                                            </p>
                                        </div>
                                    </div>
                                    <span
                                        className={cn(
                                            "shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                            achSigningStepper.badgeClassName,
                                        )}
                                    >
                                        {achSigningStepper.statusLabel}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/60">
                                    <FileText
                                        className="h-4 w-4 shrink-0 text-[var(--brand)]"
                                        aria-hidden
                                    />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                        {achDocumentSubtitle}
                                    </span>
                                    {!readOnly && prefillEditRow ? (
                                        <button
                                            type="button"
                                            title="Edit ACH form fields"
                                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-[var(--brand)] dark:hover:bg-slate-800"
                                            onClick={() => setAchPrefillEditOpen(true)}
                                        >
                                            <Pencil className="h-4 w-4" aria-hidden />
                                        </button>
                                    ) : null}
                                </div>

                            </div>

                            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/50">
                                <div className="mb-3 flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[#5a9fd4]">
                                        <User className="h-3.5 w-3.5" aria-hidden />
                                        ACH signer
                                    </span>
                                    {canEditAchRecipients ? (
                                        <button
                                            type="button"
                                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-[var(--brand)]/40 hover:bg-[var(--brand)]/5 hover:text-[var(--brand)] dark:border-slate-600 dark:bg-slate-900"
                                            title="Change ACH signer"
                                            aria-label="Change ACH signer"
                                            onClick={openAchSignerEditor}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                    ) : null}
                                </div>
                                {achSummarySigners.length ? (
                                    <div className="space-y-2">
                                        {achSummarySigners.map((signer, idx) => (
                                            <div
                                                key={`${signer.role}-${idx}`}
                                                className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/60"
                                            >
                                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)]/10 text-[var(--brand)]">
                                                    <User className="h-4 w-4" aria-hidden />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                                        {normalizeDocuSignSignerRoleName(signer.role)}
                                                    </p>
                                                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                                        {signer.name || "—"}
                                                    </p>
                                                    <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                                                        {signer.email}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-4 text-center dark:border-slate-700 dark:bg-slate-900/40">
                                        <p className="text-xs text-slate-600 dark:text-slate-400">
                                            No signer email on file. Add a recipient before sending.
                                        </p>
                                        {canEditAchRecipients ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="mt-2 h-8 text-xs border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/5"
                                                onClick={openAchSignerEditor}
                                            >
                                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                                                Add signer
                                            </Button>
                                        ) : null}
                                    </div>
                                )}

                                {showAchSignerEditor && canEditAchRecipients ? (
                                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-[11px] leading-snug text-slate-500">
                                                Updates apply to this ACH send only.
                                            </p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs text-blue-600 gap-1"
                                                onClick={() =>
                                                    setAchSignerEditorRows((prev) => [
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
                                                <Plus className="h-3.5 w-3.5" /> Add
                                            </Button>
                                        </div>
                                        {achSignerEditorRows.map((entry, idx) => (
                                            <div key={entry.id} className="flex items-start gap-2">
                                                <span className="mt-2.5 w-5 shrink-0 text-center text-[10px] font-bold text-slate-400">
                                                    {idx + 1}
                                                </span>
                                                <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                                                    <Input
                                                        placeholder="Signer"
                                                        className="h-9 text-xs bg-slate-50"
                                                        value={DOCUSIGN_DEFAULT_SIGNER_ROLE}
                                                        readOnly
                                                        disabled
                                                    />
                                                    <Input
                                                        placeholder="Signer name"
                                                        className="h-9 text-xs"
                                                        value={entry.name}
                                                        onChange={(e) =>
                                                            setAchSignerEditorRows((prev) =>
                                                                prev.map((x) =>
                                                                    x.id === entry.id
                                                                        ? { ...x, name: e.target.value }
                                                                        : x,
                                                                ),
                                                            )
                                                        }
                                                    />
                                                    <Input
                                                        placeholder="Signer email"
                                                        className="h-9 text-xs"
                                                        type="email"
                                                        value={entry.email}
                                                        onChange={(e) =>
                                                            setAchSignerEditorRows((prev) =>
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
                                                    className="mt-2 text-slate-400 transition-colors hover:text-red-500"
                                                    disabled={achSignerEditorRows.length <= 1}
                                                    onClick={() =>
                                                        setAchSignerEditorRows((prev) =>
                                                            prev.filter((x) => x.id !== entry.id),
                                                        )
                                                    }
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}
                                        <div className="flex items-center justify-end gap-2 pt-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 text-xs text-slate-500"
                                                onClick={() => setShowAchSignerEditor(false)}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="h-8 bg-[var(--brand)] px-6 text-xs text-white hover:bg-[var(--brand-hover)]"
                                                disabled={
                                                    savingAchSigners ||
                                                    achSignerEditorRows.every((r) => !r.email.trim())
                                                }
                                                onClick={() => void saveAchSigners()}
                                            >
                                                {savingAchSigners ? "Saving…" : "Save signers"}
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/50">
                                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[#5a9fd4]">
                                    <Mail className="h-3.5 w-3.5" aria-hidden />
                                    CC (copy only — not a signer)
                                </span>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {ccEmails.map((email) => {
                                        const isDefaultCc = isDefaultContractCcEmail(email);
                                        return (
                                            <span
                                                key={email}
                                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--brand)]/20 bg-[var(--brand)]/8 px-2.5 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:border-[var(--brand)]/30 dark:bg-[var(--brand)]/15 dark:text-slate-100"
                                            >
                                                <Mail
                                                    className="h-3 w-3 shrink-0 text-[var(--brand)] opacity-80"
                                                    aria-hidden
                                                />
                                                <span className="max-w-[220px] truncate" title={email}>
                                                    {email}
                                                </span>
                                                {!isDefaultCc && canEditAchRecipients ? (
                                                    <button
                                                        type="button"
                                                        className="shrink-0 rounded p-0.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                                                        aria-label={`Remove ${email}`}
                                                        onClick={() => {
                                                            const next = mergeContractCcEmailList(
                                                                ccEmails.filter((e) => e !== email),
                                                                resolvedAchFunderName,
                                                                funders,
                                                                contractState || null,
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
                                {canEditAchRecipients ? (
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <Input
                                            type="email"
                                            autoComplete="email"
                                            placeholder="name@company.com"
                                            value={ccEmailDraft}
                                            onChange={(e) => setCcEmailDraft(e.target.value)}
                                            className="h-9 max-w-xs bg-white dark:bg-slate-950"
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    addAchCcFromDraft();
                                                }
                                            }}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-9 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                            onClick={addAchCcFromDraft}
                                        >
                                            Add CC
                                        </Button>
                                    </div>
                                ) : null}
                            </div>

                            <div className="shrink-0">
                                <DocuSignSigningStatusPanel
                                    title="ACH signing status"
                                    description="Updated via DocuSign webhooks (viewed, signed, completed)."
                                    statusLabel={achSigningStepper.statusLabel}
                                    badgeClassName={achSigningStepper.badgeClassName}
                                    activeIndex={achSigningStepper.activeIndex}
                                    isTerminal={achSigningStepper.isTerminal}
                                    terminalMessage={achSigningStepper.terminalMessage}
                                    onRefresh={() => void handleManualStatusUpdate()}
                                    refreshing={statusRefreshing}
                                    refreshDisabled={!hasFilledPdf && !linkedEnvelopeId}
                                    refreshInHeader
                                    lastCheckedAt={lastSigningStatusSyncAt}
                                    crmUpdatedAt={
                                        achCrmUpdatedAt != null ? String(achCrmUpdatedAt) : null
                                    }
                                    syncError={achSyncError}
                                />
                            </div>
                        </div>

                        <div className="relative flex min-h-0 min-w-0 flex-col gap-3 bg-slate-700 p-4">
                            <div
                                className="flex w-full shrink-0 rounded-lg border border-slate-600 bg-slate-800/80 p-0.5"
                                role="tablist"
                                aria-label="ACH PDF preview"
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={pdfTab === "template"}
                                    className={cn(
                                        "flex-1 rounded-md px-3 py-1.5 text-center text-[11px] font-semibold transition-colors",
                                        pdfTab === "template"
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-300 hover:text-white",
                                    )}
                                    onClick={() => setPdfTab("template")}
                                >
                                    ACH template
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={pdfTab === "filled"}
                                    className={cn(
                                        "flex-1 rounded-md px-3 py-1.5 text-center text-[11px] font-semibold transition-colors",
                                        pdfTab === "filled"
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-300 hover:text-white",
                                        !hasFilledPdf && "pointer-events-none opacity-40",
                                    )}
                                    disabled={!hasFilledPdf}
                                    onClick={() => {
                                        setPdfTab("filled");
                                        void loadFilledPdf();
                                    }}
                                >
                                    DocuSign envelope
                                </button>
                            </div>
                            <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
                                {activePdfLoading ? (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                                    </div>
                                ) : activePdfUrl ? (
                                    <AchInlinePdfViewer fileUrl={activePdfUrl} />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-500">
                                        {filledPdfHint ||
                                            (pdfTab === "filled"
                                                ? "Send via DocuSign to preview the filled ACH form here."
                                                : "Loading template…")}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-3 dark:border-slate-700">
                        <div className="min-w-0 flex-1 text-xs text-amber-800 dark:text-amber-200">
                            {docuSignOpenUrl ? (
                                <span>
                                    Pop-up blocked. Click Open DocuSign or allow pop-ups for this
                                    site.
                                </span>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button variant="ghost" className="h-9" onClick={onClose}>
                                Close
                            </Button>
                            {showVoidButton ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
                                    disabled={isVoiding || isSending}
                                    onClick={() => void handleVoidAch()}
                                >
                                    {isVoiding ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Voiding…
                                        </span>
                                    ) : (
                                        "Void ACH form"
                                    )}
                                </Button>
                            ) : null}
                            {showSendAfterVoidButton ? (
                                <Button
                                    type="button"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    disabled={isSending || mappingLoading || isVoiding}
                                    onClick={() =>
                                        void handleReviewInDocuSign({ forceNewEnvelope: true })
                                    }
                                >
                                    {isSending ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Preparing DocuSign…
                                        </span>
                                    ) : (
                                        "Send ACH form"
                                    )}
                                </Button>
                            ) : null}
                            {showResendAfterSignedButton ? (
                                <Button
                                    type="button"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    disabled={isSending || mappingLoading || isVoiding}
                                    onClick={() =>
                                        void handleReviewInDocuSign({ forceNewEnvelope: true })
                                    }
                                >
                                    {isSending ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Preparing DocuSign…
                                        </span>
                                    ) : (
                                        "Resend ACH form"
                                    )}
                                </Button>
                            ) : null}
                            {showOpenDocuSignInFooter ? (
                                <Button
                                    type="button"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={() => {
                                        const url = docuSignOpenUrl;
                                        if (!url) return;
                                        if (navigateDocuSignTab(null, url)) {
                                            setDocuSignOpenUrl(null);
                                            beginAchSenderReturnStatusWatch();
                                        }
                                    }}
                                >
                                    Open DocuSign
                                </Button>
                            ) : null}
                            {showReviewAndSendButton ? (
                                <Button
                                    type="button"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    disabled={isSending || mappingLoading || isVoiding}
                                    onClick={() =>
                                        void handleReviewInDocuSign({ forceNewEnvelope: false })
                                    }
                                >
                                    {isSending ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Preparing DocuSign…
                                        </span>
                                    ) : canContinueDraft ? (
                                        "Continue in DocuSign"
                                    ) : (
                                        "Review & send ACH form"
                                    )}
                                </Button>
                            ) : null}
                            {isSigned ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9"
                                    onClick={onClose}
                                >
                                    Done
                                </Button>
                            ) : null}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <TemplateMappingPrefillEditDialog
                open={achPrefillEditOpen}
                onOpenChange={setAchPrefillEditOpen}
                row={prefillEditRow}
                contractId={contractId}
                applicationUuid={applicationId}
                applicationData={applicationData}
                resolvedContract={resolvedContract}
                agreementDate={formatDate(new Date())}
                documentTemplatePrefillByMappingId={documentTemplatePrefillByMappingId}
                mainPrefillOverrides={
                    contractPrefillFromDb
                        ? (stripDocumentTemplateBlobFromPrefillOverrides(
                              contractPrefillFromDb as Record<string, unknown>,
                          ) as typeof contractPrefillFromDb)
                        : null
                }
                bankDetail={null}
                addendumOnly
                prefillDocumentKind="ach_form"
                onSaved={async () => {
                    await fetchTemplateMappings();
                    const contract = await reloadContractLocal();
                    await syncPrefillToDraftEnvelope(contract);
                }}
            />
        </>
    );
}
