import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
    FileText,
    Landmark,
    Loader2,
    Pencil,
    RefreshCw,
} from "lucide-react";
import { toast } from "react-toastify";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { axiosGet, axiosPost } from "@/redux/axios";
import { syncDocuSignEnvelopeStatus } from "./contractdata/syncDocuSignEnvelopeStatus";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract } from "@/redux/actions/contractActions";
import { mergeContractCcEmailList } from "./boldsignCcList";
import {
    achCapsuleClassName,
    canResendAchAuthorization,
    canVoidAchAuthorization,
    formatAchAuthorizationCapsuleLabel,
    mergeAchAuthorizationDocuSignIntoPrefill,
    parseAchAuthorizationDocuSignFromPrefill,
    type AchAuthorizationDocuSignCapsuleStatus,
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
import { PLATFORM_LAYOUT_KEYS, supplementalOptionLabel } from "./contractdata/platformDocumentConfig";
import { resolveDocuSignSenderReturnUrl } from "./contractdata/resolveDocuSignSenderReturnUrl";
import {
    TemplateMappingPrefillEditDialog,
    type TemplateMappingPrefillEditRow,
} from "./contractdata/TemplateMappingPrefillEditDialog";
import { formatDate, formatDateTimeUS } from "@/lib/utils";
import {
    DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS,
    navigateDocuSignTab,
    openDocuSignLoadingTab,
    showDocuSignTabMessage,
} from "./docusignSenderTab";
import type { DocuSignTemplateRolePayload } from "./contractdata/templateRecipients";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const DOCUSIGN_PRIMARY_BTN_CLASS =
    "h-9 shrink-0 cursor-pointer border-0 bg-[#276D9C] px-6 text-white shadow-sm hover:bg-[#276D9C]/90 focus-visible:ring-[#276D9C]/40";

type AchPdfTab = "template" | "filled";

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
            if (w > 0) setPageWidth(Math.max(280, w - 24));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div ref={wrapRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-slate-100 dark:bg-slate-950">
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
                className="flex w-full flex-col items-center gap-3 py-3"
            >
                {numPages
                    ? Array.from({ length: numPages }, (_, i) => (
                          <Page
                              key={i + 1}
                              pageNumber={i + 1}
                              width={pageWidth}
                              className="bg-white shadow-md"
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
    const [isVoiding, setIsVoiding] = useState(false);
    const [sessionEnvelopeId, setSessionEnvelopeId] = useState<string | null>(null);
    const modalWasOpenRef = useRef(false);

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

    const achAuthorizationDocuSign = useMemo(
        () =>
            parseAchAuthorizationDocuSignFromPrefill(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ),
        [resolvedContract],
    );

    const achCapsuleStatus: AchAuthorizationDocuSignCapsuleStatus =
        achAuthorizationDocuSign?.status ?? "DRAFT";

    const linkedEnvelopeId = useMemo(() => {
        const fromDb = String(achAuthorizationDocuSign?.envelopeId ?? "").trim();
        if (fromDb) return fromDb;
        return String(sessionEnvelopeId ?? "").trim() || null;
    }, [achAuthorizationDocuSign?.envelopeId, sessionEnvelopeId]);

    const hasFilledPdf = Boolean(linkedEnvelopeId);
    const isSigned = achCapsuleStatus === "SIGNED";
    const isVoided = achCapsuleStatus === "VOIDED";
    const showStatusCapsule =
        hasFilledPdf && achCapsuleStatus !== "DRAFT" && achCapsuleStatus !== "VOIDED"
            ? true
            : isVoided;
    const canVoidAch =
        !readOnly && canVoidAchAuthorization(achAuthorizationDocuSign, sessionEnvelopeId);
    const canResendAch =
        !readOnly &&
        Boolean(onPrepareDocuSignDraft) &&
        canResendAchAuthorization(achAuthorizationDocuSign, sessionEnvelopeId);
    const canContinueDraft =
        !readOnly &&
        Boolean(onPrepareDocuSignDraft) &&
        hasFilledPdf &&
        achCapsuleStatus === "DRAFT";
    const canInitialSend =
        !readOnly && Boolean(onPrepareDocuSignDraft) && !hasFilledPdf;
    const canReviewAndSend = canResendAch || canContinueDraft || canInitialSend;

    const templateLabel = useMemo(() => {
        const key = String(
            linkedAchMapping?.template?.layoutKey ??
                linkedAchMapping?.template?.templateId ??
                PLATFORM_LAYOUT_KEYS.achAuthorization,
        ).trim();
        return (
            linkedAchMapping?.template?.name ||
            supplementalOptionLabel(key) ||
            "ACH Authorization"
        );
    }, [linkedAchMapping]);

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
        const templateRef = String(
            linkedAchMapping?.template?.layoutKey ??
                linkedAchMapping?.template?.templateId ??
                DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION,
        ).trim();
        if (!templateRef) return;
        setTemplatePdfLoading(true);
        try {
            const response = await axiosGet(
                `/docusign/template/${encodeURIComponent(templateRef)}/download`,
                { responseType: "blob" },
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
    }, [linkedAchMapping, revokeBlob]);

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
            } catch {
                setFilledPdfHint(
                    isSigned
                        ? "Could not load signed ACH PDF."
                        : "Filled PDF is not ready yet. Refresh after sending from DocuSign.",
                );
            } finally {
                if (!options?.silent) setFilledPdfLoading(false);
            }
        },
        [linkedEnvelopeId, revokeBlob, isSigned],
    );

    const mergeAchEnvelopeIntoLocalContract = useCallback(
        (envelopeId: string, status: AchAuthorizationDocuSignCapsuleStatus = "DRAFT") => {
            setResolvedContract((prev) => {
                if (!prev || typeof prev !== "object") return prev;
                return {
                    ...prev,
                    contractPrefillOverrides: mergeAchAuthorizationDocuSignIntoPrefill(
                        (prev as { contractPrefillOverrides?: unknown }).contractPrefillOverrides,
                        { envelopeId, status },
                    ),
                };
            });
        },
        [],
    );

    const refreshAchStatus = useCallback(
        async (silent?: boolean, options?: { force?: boolean }) => {
            const eid = String(linkedEnvelopeId ?? "").trim();
            if (!eid) return;
            if (!silent) setStatusRefreshing(true);
            let syncError: string | null = null;
            try {
                const result = await syncDocuSignEnvelopeStatus(eid, {
                    applicationId: applicationId ?? undefined,
                    contractId,
                    force: options?.force ?? !silent,
                    silent,
                });
                if (result.rateLimited && !silent) {
                    syncError =
                        "DocuSign rate limit reached. Wait a moment and try Update status again.";
                }
            } catch (err: unknown) {
                syncError =
                    err instanceof Error
                        ? err.message
                        : String(
                              (err as { response?: { data?: { message?: string } }; message?: string })
                                  ?.response?.data?.message ||
                                  "Could not refresh ACH status.",
                          );
            } finally {
                try {
                    await reloadContractLocal();
                    await loadFilledPdf(eid, { silent: true });
                } catch {
                    /* still surface sync error below */
                }
                if (!silent && syncError) {
                    toast.error(syncError);
                }
                if (!silent) setStatusRefreshing(false);
            }
        },
        [applicationId, contractId, linkedEnvelopeId, reloadContractLocal, loadFilledPdf],
    );

    const handleManualStatusUpdate = useCallback(async () => {
        setStatusRefreshing(true);
        let syncError: string | null = null;
        try {
            const contract = await reloadContractLocal();
            const fromDb = parseAchAuthorizationDocuSignFromPrefill(
                contract?.contractPrefillOverrides,
            )?.envelopeId;
            const eid =
                String(fromDb ?? sessionEnvelopeId ?? linkedEnvelopeId ?? "").trim() || null;
            if (!eid) {
                toast.info(
                    "No ACH envelope linked yet. Use Review & send in DocuSign to create one.",
                );
                return;
            }
            if (!fromDb && eid === sessionEnvelopeId) {
                setSessionEnvelopeId(eid);
            }
            try {
                const result = await syncDocuSignEnvelopeStatus(eid, {
                    applicationId: applicationId ?? undefined,
                    contractId,
                    force: true,
                });
                if (result.rateLimited) {
                    syncError =
                        "DocuSign rate limit reached. Wait a few seconds and try again.";
                }
            } catch (err: unknown) {
                syncError =
                    err instanceof Error
                        ? err.message
                        : String(
                              (err as { response?: { data?: { message?: string } }; message?: string })
                                  ?.response?.data?.message ||
                                  "Could not sync status from DocuSign.",
                          );
            }
            await reloadContractLocal();
            await loadFilledPdf(eid, { silent: true });
            if (syncError) {
                toast.error(syncError);
            } else {
                toast.success("ACH status updated.");
            }
        } finally {
            setStatusRefreshing(false);
        }
    }, [
        applicationId,
        linkedEnvelopeId,
        loadFilledPdf,
        reloadContractLocal,
        sessionEnvelopeId,
    ]);

    const fetchSenderViewWithRetry = useCallback(
        async (envelopeId: string, ccEmails: string[], justCreated: boolean) => {
            const delays = justCreated
                ? DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS.justCreated
                : DOCUSIGN_SENDER_VIEW_RETRY_DELAYS_MS.existing;
            const returnUrl = resolveDocuSignSenderReturnUrl();
            const signerEmail = getSignerRecipientEmailForContract(applicationData, resolvedContract).trim();
            const signerName = getApplicationPrimaryRecipientName(applicationData);
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
        [applicationData, applicationId, resolvedContract],
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
            toast.success("ACH form voided in DocuSign. Use Resend ACH form when you are ready.");
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
            const ccEmails = mergeContractCcEmailList([]);
            let envelopeId = String(linkedEnvelopeId ?? "").trim();
            let preparedSendUrl: string | null = null;
            const reuseExistingEnvelope =
                !options?.forceNewEnvelope &&
                Boolean(envelopeId) &&
                achCapsuleStatus === "DRAFT";

            if (!reuseExistingEnvelope) {
                const prepared = await onPrepareDocuSignDraft({
                    ccEmails,
                    supplementalLayoutKey:
                        DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE,
                    includeMainContract: false,
                });
                envelopeId = String(prepared?.envelopeId ?? "").trim();
                preparedSendUrl = String(prepared?.sendUrl ?? "").trim() || null;
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
                ccEmails,
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
            return;
        }
        if (!modalWasOpenRef.current) {
            modalWasOpenRef.current = true;
            setPdfTab(initialPdfTab);
            setDocuSignOpenUrl(null);
        }
        setResolvedContract(fetchedContract);
    }, [isOpen, fetchedContract, initialPdfTab]);

    useEffect(() => {
        if (!isOpen || contractId == null) return;
        void fetchTemplateMappings();
    }, [isOpen, contractId, fetchTemplateMappings]);

    useEffect(() => {
        if (!isOpen || mappingLoading) return;
        void loadTemplatePdf();
    }, [isOpen, mappingLoading, linkedAchMapping, loadTemplatePdf]);

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

    if (!isOpen) return null;

    const activePdfUrl = pdfTab === "filled" ? filledPdfUrl : templatePdfUrl;
    const activePdfLoading = pdfTab === "filled" ? filledPdfLoading : templatePdfLoading;

    const prefillEditRow: TemplateMappingPrefillEditRow | null = linkedAchMapping
        ? {
              id: linkedAchMapping.id,
              contractId: linkedAchMapping.contractId,
              templateId: String(
                  linkedAchMapping.template?.templateId ?? linkedAchMapping.templateId ?? "",
              ),
              documentType: String(linkedAchMapping.documentType || "ach"),
              template: linkedAchMapping.template ?? null,
          }
        : null;

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <DialogContent className="flex h-[min(94vh,calc(100dvh-1.5rem))] max-h-[min(94vh,calc(100dvh-1.5rem))] min-h-0 w-[1200px] max-w-[95vw] flex-col gap-0 overflow-hidden bg-white p-0 dark:bg-slate-900">
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-4 dark:border-slate-700">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-600/12 text-teal-700 dark:text-teal-300">
                                <Landmark className="h-5 w-5" aria-hidden />
                            </div>
                            <div className="min-w-0">
                                <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                    ACH Authorization
                                </DialogTitle>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Review prefilled fields, then send via DocuSign.
                                </p>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {showStatusCapsule ? (
                                <span
                                    className={cn(
                                        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                                        achCapsuleClassName(achCapsuleStatus),
                                    )}
                                >
                                    {formatAchAuthorizationCapsuleLabel(achCapsuleStatus)}
                                </span>
                            ) : isVoided ? (
                                <span
                                    className={cn(
                                        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                                        achCapsuleClassName("VOIDED"),
                                    )}
                                >
                                    Voided
                                </span>
                            ) : (
                                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300">
                                    {hasFilledPdf ? "Draft" : "Not sent"}
                                </span>
                            )}
                            {hasFilledPdf && !isSigned && !isVoided ? (
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8"
                                    title="Refresh ACH status"
                                    disabled={statusRefreshing}
                                    onClick={() => void refreshAchStatus(false)}
                                >
                                    <RefreshCw
                                        className={cn(
                                            "h-4 w-4",
                                            statusRefreshing && "animate-spin",
                                        )}
                                    />
                                </Button>
                            ) : null}
                        </div>
                    </div>

                    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
                        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2 bg-slate-700 p-3">
                            <div className="flex shrink-0 items-center gap-2">
                            <div
                                className="flex min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-800/80 p-0.5"
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
                                    Template PDF
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
                                    {isSigned ? "Signed PDF" : "Filled PDF"}
                                </button>
                            </div>
                            </div>
                            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded bg-white shadow-2xl">
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

                        <div className="flex min-h-0 flex-col overflow-y-auto p-4">
                            <div className="rounded-xl border border-[#276D9C]/15 bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:bg-slate-900">
                                <div className="mb-3 flex items-start gap-2.5">
                                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-600 text-white">
                                        <FileText className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                        <h4 className="text-xs font-semibold uppercase tracking-wide text-[#276D9C]">
                                            ACH Form
                                        </h4>
                                        <p className="mt-0.5 truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                            {mappingLoading ? "Loading…" : templateLabel}
                                        </p>
                                    </div>
                                </div>
                                {!readOnly && linkedAchMapping ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-xs"
                                        onClick={() => setAchPrefillEditOpen(true)}
                                    >
                                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                        Edit prefill fields
                                    </Button>
                                ) : null}
                            </div>

                            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                                <div className="flex items-center justify-between gap-2">
                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                                        Signing status
                                    </h4>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 shrink-0 text-[11px]"
                                        disabled={statusRefreshing}
                                        onClick={() => void handleManualStatusUpdate()}
                                    >
                                        <RefreshCw
                                            className={cn(
                                                "mr-1.5 h-3 w-3",
                                                statusRefreshing && "animate-spin",
                                            )}
                                        />
                                        Update status
                                    </Button>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <span
                                        className={cn(
                                            "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                                            hasFilledPdf && achCapsuleStatus !== "DRAFT"
                                                ? achCapsuleClassName(achCapsuleStatus)
                                                : "bg-slate-200 text-slate-700 ring-slate-300 dark:bg-slate-700 dark:text-slate-200",
                                        )}
                                    >
                                        {hasFilledPdf
                                            ? achCapsuleStatus === "DRAFT"
                                                ? "Draft"
                                                : achCapsuleStatus === "VOIDED"
                                                  ? "Voided"
                                                  : formatAchAuthorizationCapsuleLabel(
                                                        achCapsuleStatus,
                                                    )
                                            : "Not sent"}
                                    </span>
                                </div>
                                <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                                    {isSigned
                                        ? "ACH authorization is fully signed. Void is not available; use Resend to create a new form if needed."
                                        : isVoided
                                          ? "Previous ACH envelope was voided. Use Resend ACH form to send a new one."
                                          : achCapsuleStatus === "VIEWED"
                                            ? "Signer has viewed the ACH form."
                                            : achCapsuleStatus === "SENT"
                                              ? "ACH form was sent and is awaiting signature."
                                              : hasFilledPdf
                                                ? "Draft is ready in DocuSign. Click Send in DocuSign to email the signer."
                                                : "Not sent yet. Use Review & send to open DocuSign."}
                                </p>
                                {achAuthorizationDocuSign?.sentAt ? (
                                    <p className="mt-2 text-[11px] text-slate-500">
                                        Sent:{" "}
                                        {formatDateTimeUS(achAuthorizationDocuSign.sentAt, "—")}
                                    </p>
                                ) : null}
                                <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                                    The Contract tab refreshes status periodically. After sending in
                                    DocuSign, click Update status if the badge looks stale.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-6 py-3 dark:border-slate-700">
                        <div className="min-w-0 text-xs text-amber-800 dark:text-amber-200">
                            {docuSignOpenUrl ? (
                                <span>
                                    Pop-up blocked. Click Open DocuSign to continue in a new tab.
                                </span>
                            ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button variant="ghost" className="h-9" onClick={onClose}>
                                Close
                            </Button>
                            {canVoidAch ? (
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
                            {docuSignOpenUrl && canReviewAndSend ? (
                                <Button
                                    type="button"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    onClick={() => {
                                        const url = docuSignOpenUrl;
                                        if (!url) return;
                                        if (navigateDocuSignTab(null, url)) {
                                            setDocuSignOpenUrl(null);
                                        }
                                    }}
                                >
                                    Open DocuSign
                                </Button>
                            ) : null}
                            {canReviewAndSend && !docuSignOpenUrl ? (
                                <Button
                                    type="button"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                    disabled={isSending || mappingLoading || isVoiding}
                                    onClick={() =>
                                        void handleReviewInDocuSign({
                                            forceNewEnvelope: canResendAch && !canContinueDraft,
                                        })
                                    }
                                >
                                    {isSending ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Preparing DocuSign…
                                        </span>
                                    ) : canResendAch && !canContinueDraft ? (
                                        "Resend ACH form"
                                    ) : canContinueDraft ? (
                                        "Continue in DocuSign"
                                    ) : (
                                        "Review & send in DocuSign"
                                    )}
                                </Button>
                            ) : null}
                            {isSigned ? (
                                <Button
                                    type="button"
                                    className={DOCUSIGN_PRIMARY_BTN_CLASS}
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
                onSaved={() => {
                    void fetchTemplateMappings();
                    void reloadContractLocal();
                }}
            />
        </>
    );
}
