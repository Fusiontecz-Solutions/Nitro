import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
    Eye,
    FileText,
    Landmark,
    Loader2,
    Pencil,
} from "lucide-react";
import { toast } from "react-toastify";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { axiosGet, axiosPost } from "@/redux/axios";
import { syncDocuSignEnvelopeStatus } from "./contractdata/syncDocuSignEnvelopeStatus";
import { DocuSignSigningStatusPanel } from "./contractdata/DocuSignSigningStatusPanel";
import { resolveAchSigningStepperState } from "./contractdata/achSigningStatusStepper";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract } from "@/redux/actions/contractActions";
import { mergeContractCcEmailList } from "./boldsignCcList";
import {
    canResendAchAuthorization,
    canVoidAchAuthorization,
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
import { formatDate } from "@/lib/utils";
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
    const [isVoiding, setIsVoiding] = useState(false);
    const [sessionEnvelopeId, setSessionEnvelopeId] = useState<string | null>(null);
    const [lastSigningStatusSyncAt, setLastSigningStatusSyncAt] = useState<Date | null>(null);
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

    const achSigningStepper = useMemo(
        () => resolveAchSigningStepperState(achCapsuleStatus, hasFilledPdf),
        [achCapsuleStatus, hasFilledPdf],
    );

    const achCrmUpdatedAt =
        achAuthorizationDocuSign?.updatedAt ??
        (resolvedContract as { updatedAt?: unknown } | null)?.updatedAt ??
        null;

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

    const showResendButton =
        canResendAch && !canContinueDraft && !docuSignOpenUrl && !isSigned;
    const showReviewAndSendButton =
        (canInitialSend || canContinueDraft) && !docuSignOpenUrl && !isSigned;
    const showOpenDocuSignInFooter =
        Boolean(docuSignOpenUrl) && canReviewAndSend && !isSigned;

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
                if (!syncError) {
                    setLastSigningStatusSyncAt(new Date());
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
                setLastSigningStatusSyncAt(new Date());
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
                            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/50">
                                <div className="mb-4 flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 items-start gap-2.5">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#276D9C]/10 text-[#276D9C]">
                                            <Landmark className="h-4 w-4" aria-hidden />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
                                                ACH Authorization
                                            </h4>
                                            <p className="mt-0.5 truncate text-[11px] font-medium text-slate-600 dark:text-slate-300">
                                                {mappingLoading ? "Loading…" : templateLabel}
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
                                        className="h-4 w-4 shrink-0 text-[#276D9C]"
                                        aria-hidden
                                    />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                                        {mappingLoading ? "Loading…" : templateLabel}
                                    </span>
                                    <button
                                        type="button"
                                        title="View ACH template"
                                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-[#276D9C] dark:hover:bg-slate-800"
                                        onClick={() => setPdfTab("template")}
                                    >
                                        <Eye className="h-4 w-4" aria-hidden />
                                    </button>
                                    {!readOnly && linkedAchMapping ? (
                                        <button
                                            type="button"
                                            title="Edit prefill fields"
                                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-[#276D9C] dark:hover:bg-slate-800"
                                            onClick={() => setAchPrefillEditOpen(true)}
                                        >
                                            <Pencil className="h-4 w-4" aria-hidden />
                                        </button>
                                    ) : null}
                                </div>

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
                            {showResendButton ? (
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
