import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useDispatch } from "react-redux";
import { Document, Page, pdfjs } from "react-pdf";
import {
    CheckCircle2,
    FileText,
    Info,
    Landmark,
    Loader2,
    Mail,
    Pencil,
    User,
    X,
} from "lucide-react";
import { toast } from "react-toastify";
import {
    Dialog,
    DialogContent,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { axiosGet, axiosPatch, axiosPost } from "@/redux/axios";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import { voidBoldSignDocument } from "@/redux/actions/boldSignActions";
import {
    loadBoldSignCcEmailList,
    saveBoldSignCcEmailList,
} from "./docusignCcList";
import {
    boldSignTemplateIsPreviewable,
    getBoldSignTemplateMappingRef,
    loadBoldSignTemplatePdfBlob,
} from "./contractdata/boldSignTemplateDocument";
import {
    canPreviewFilledOrSignedEnvelope,
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    formatDocumentSendStatusLabel,
    getDocumentSendStatusCapsuleClasses,
    isAchEnvelopeDraftLikeStatus,
    isAchEnvelopePastCcSendStep,
    isAchEnvelopeSigningFinished,
    parseDocumentSendHistory,
    parseDocumentTemplateEnvelopeByMappingId,
    parseDocumentTemplatePrefillByMappingId,
    resolveAchEnvelopeDisplayStatus,
    resolveAchPdfEnvelopeId,
    getDocumentTemplatePrefillFieldRowsForEditor,
    type DocumentTemplateEnvelopeMeta,
} from "./contractdata/documentTemplateMappingPrefill";
import {
    TemplateMappingPrefillEditDialog,
    type TemplateMappingPrefillEditRow,
} from "./contractdata/TemplateMappingPrefillEditDialog";
import {
    normalizeContractPrefillOverrides,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
} from "./contractdata/Contract";
import {
    buildDocuSignRolesFromEditorRows,
    mergeContractPrefillWithSignerOverrides,
    parseContractSignerOverridesFromPrefill,
    validateDocuSignSignerRoles,
    type ContractSignerOverrideRow,
    type DocuSignTemplateRolePayload,
} from "./contractdata/templateRecipients";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const DOCUSIGN_PRIMARY_BTN_CLASS =
    "h-9 shrink-0 cursor-pointer border-0 bg-[#276D9C] px-6 text-white shadow-sm hover:bg-[#276D9C]/90 focus-visible:ring-[#276D9C]/40";

const ACH_STATUS_POLL_MS = 20_000;

const ACH_TERMINAL_VOID_STATUSES = new Set(["revoked", "voided", "declined", "expired"]);
const ACH_DRAFT_STATUSES = new Set(["", "draft"]);
const ACH_OUT_FOR_SIGNATURE_STATUSES = new Set(["sent", "viewed", "delivered"]);

function getAchEnvelopeView(status: string, envelopeId: string) {
    const s = String(status || "").trim().toLowerCase();
    const hasEnvelope = Boolean(String(envelopeId || "").trim());
    const isDraft = !hasEnvelope || ACH_DRAFT_STATUSES.has(s);
    const isCompleted = s === "completed" || s === "signed";
    const isTerminal = ACH_TERMINAL_VOID_STATUSES.has(s);
    const isOutForSignature =
        hasEnvelope &&
        !isDraft &&
        !isCompleted &&
        !isTerminal &&
        ACH_OUT_FOR_SIGNATURE_STATUSES.has(s);
    return { isDraft, isCompleted, isTerminal, isOutForSignature, hasEnvelope };
}

function canVoidAchEnvelope(status: string, envelopeId: string): boolean {
    const view = getAchEnvelopeView(status, envelopeId);
    if (view.isCompleted) return false;
    return view.isOutForSignature;
}

function canResendAchEnvelope(status: string, envelopeId: string): boolean {
    const view = getAchEnvelopeView(status, envelopeId);
    if (view.isOutForSignature) return false;
    if (view.isCompleted) return true;
    if (view.isTerminal) return true;
    return false;
}

function canReviewAndSendAchEnvelope(status: string, envelopeId: string): boolean {
    if (canResendAchEnvelope(status, envelopeId)) return true;
    const view = getAchEnvelopeView(status, envelopeId);
    if (view.isOutForSignature) return false;
    return view.isDraft || !view.hasEnvelope;
}

type PdfPaneTab = "template" | "docusign";

export type AchDocumentTemplateMappingRow = {
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
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Opening DocuSign</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#334155}
.box{text-align:center;padding:2rem}.spin{width:40px;height:40px;border:3px solid #e2e8f0;border-top-color:#276D9C;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1rem}
@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="box"><div class="spin"></div><p>Opening DocuSign…</p></div></body></html>`);
    doc.close();
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

function formatSigningStatusLabel(raw: unknown): string {
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
    if (!k) return "Not sent";
    return formatDocumentSendStatusLabel(k);
}

function DirectPdfViewer({
    fileUrl,
    errorMessage = "Could not render this PDF in the viewer.",
}: {
    fileUrl: string;
    errorMessage?: string;
}) {
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

export interface ACHFormViewerModalProps {
    isOpen: boolean;
    onClose: () => void;
    contractId: number | null;
    applicationId: string | null;
    applicationData: unknown;
    achMapping: AchDocumentTemplateMappingRow | null;
    contract: Record<string, unknown> | null;
    contractPrefillRecords?: ContractPrefillContractRecords;
    readOnly?: boolean;
    onContractDocumentsChanged?: () => void;
    onPrepareDocuSignDraft?: (payload: {
        ccEmails: string[];
        achDocumentRef?: string | null;
        standaloneAchOnly?: boolean;
        roles?: DocuSignTemplateRolePayload[];
    }) => Promise<{
        envelopeId?: string;
        sendUrl?: string | null;
    }>;
    persistAchEnvelopeOnContract: (
        mappingId: string,
        envelopeId: string,
        status?: string,
    ) => Promise<void>;
    fetchDocuSignSenderViewUrlWithRetry: (
        envelopeId: string,
        ccForSync: string[],
        justCreated: boolean,
        rolesOverride?: DocuSignTemplateRolePayload[],
    ) => Promise<{ url: string | null; error: string | null }>;
    getSignerEmail: () => string;
    getSignerName: () => string;
}

export default function ACHFormViewerModal({
    isOpen,
    onClose,
    contractId,
    applicationId,
    applicationData,
    achMapping,
    contract,
    contractPrefillRecords,
    readOnly = false,
    onContractDocumentsChanged,
    onPrepareDocuSignDraft,
    persistAchEnvelopeOnContract,
    fetchDocuSignSenderViewUrlWithRetry,
    getSignerEmail,
    getSignerName,
}: ACHFormViewerModalProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [resolvedContract, setResolvedContract] = useState<Record<string, unknown> | null>(
        contract,
    );
    const [pdfPaneTab, setPdfPaneTab] = useState<PdfPaneTab>("template");
    const [templatePdfUrl, setTemplatePdfUrl] = useState<string | null>(null);
    const [templatePdfLoading, setTemplatePdfLoading] = useState(false);
    const [docuSignPdfUrl, setDocuSignPdfUrl] = useState<string | null>(null);
    const [docuSignPdfLoading, setDocuSignPdfLoading] = useState(false);
    const [docuSignPdfHint, setDocuSignPdfHint] = useState<string | null>(null);
    const [isSendingAch, setIsSendingAch] = useState(false);
    const [isVoidingAch, setIsVoidingAch] = useState(false);
    const [statusRefreshing, setStatusRefreshing] = useState(false);
    const [lastStatusSyncAt, setLastStatusSyncAt] = useState<Date | null>(null);
    const [prefillEditOpen, setPrefillEditOpen] = useState(false);
    const [ccEmails, setCcEmails] = useState<string[]>([]);
    const [ccEmailDraft, setCcEmailDraft] = useState("");
    const [achSigner, setAchSigner] = useState<ContractSignerOverrideRow>({
        role: "Receiver",
        name: "",
        email: "",
    });
    const [showAchSignerEditor, setShowAchSignerEditor] = useState(false);
    const [signerDraft, setSignerDraft] = useState<ContractSignerOverrideRow>({
        role: "Receiver",
        name: "",
        email: "",
    });
    const [savingSigner, setSavingSigner] = useState(false);
    const templateBlobUrlRef = useRef<string | null>(null);
    const docuSignBlobUrlRef = useRef<string | null>(null);
    const achCcEmailDeliveredRef = useRef(false);
    const lastAchStatusSyncAtRef = useRef(0);

    const documentTemplateEnvelopeByMappingId = useMemo(
        () =>
            parseDocumentTemplateEnvelopeByMappingId(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ),
        [resolvedContract],
    );

    const linkedAchEnvelope = useMemo((): DocumentTemplateEnvelopeMeta | null => {
        if (!achMapping?.id) return null;
        return documentTemplateEnvelopeByMappingId[achMapping.id] ?? null;
    }, [achMapping, documentTemplateEnvelopeByMappingId]);

    const achSendHistory = useMemo(
        () =>
            parseDocumentSendHistory(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ).filter((h) => h.documentKind === "ach"),
        [resolvedContract],
    );

    const achEnvelopeId = String(linkedAchEnvelope?.envelopeId ?? "").trim();
    const achStatus = String(linkedAchEnvelope?.status ?? "").trim();
    const achDisplayStatus = useMemo(
        () => resolveAchEnvelopeDisplayStatus(linkedAchEnvelope, achSendHistory),
        [linkedAchEnvelope, achSendHistory],
    );
    const achStatusLabel = formatDocumentSendStatusLabel(achDisplayStatus);
    const isSignedAch =
        isAchEnvelopeSigningFinished(achDisplayStatus) ||
        isAchEnvelopeSigningFinished(achStatus);
    const achPdfEnvelopeId = useMemo(
        () =>
            resolveAchPdfEnvelopeId(linkedAchEnvelope, achSendHistory, {
                preferSigned: isSignedAch,
            }),
        [linkedAchEnvelope, achSendHistory, isSignedAch],
    );
    const canPreviewDocuSignPdf = Boolean(
        achPdfEnvelopeId &&
            (canPreviewFilledOrSignedEnvelope(achStatus) ||
                canPreviewFilledOrSignedEnvelope(achDisplayStatus) ||
                isAchEnvelopeDraftLikeStatus(achStatus) ||
                isSignedAch),
    );

    const documentTemplatePrefillByMappingId = useMemo(
        () =>
            parseDocumentTemplatePrefillByMappingId(
                (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            ),
        [resolvedContract],
    );

    const mainPrefillOverridesForDialog = useMemo(() => {
        const raw = normalizeContractPrefillOverrides(
            (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                ?.contractPrefillOverrides,
        );
        if (!raw) return null;
        const o = { ...raw } as Record<string, unknown>;
        delete o[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
        return o as Partial<BuildContractPrefillFieldsArgs>;
    }, [resolvedContract]);

    const achTemplateLabel = useMemo(() => {
        const name = achMapping?.template?.name || achMapping?.templateId || "ACH Authorization";
        return String(name);
    }, [achMapping]);

    const refreshContractRow = useCallback(async () => {
        if (!applicationId && contractId == null) return null;
        try {
            let row: unknown = null;
            if (applicationId) {
                const res = await dispatch(getByApplicationIdContract(String(applicationId))).unwrap();
                row = (res as { data?: unknown })?.data ?? res;
            }
            if (row && typeof row === "object") {
                setResolvedContract(row as Record<string, unknown>);
            }
            onContractDocumentsChanged?.();
            return row as Record<string, unknown> | null;
        } catch {
            return null;
        }
    }, [applicationId, contractId, dispatch, onContractDocumentsChanged]);

    const resolveCcForSend = useCallback((): string[] => {
        const draft = ccEmailDraft.trim();
        let userCc = [...ccEmails];
        if (draft && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft)) {
            const dup = userCc.some((e) => e.toLowerCase() === draft.toLowerCase());
            if (!dup) {
                userCc = [...userCc, draft];
            }
        }
        return [...new Set(userCc.map((e) => e.trim()).filter(Boolean))];
    }, [ccEmailDraft, ccEmails]);

    const buildAchSignerRoles = useCallback((): DocuSignTemplateRolePayload[] => {
        const role = String(achSigner.role || "Receiver").trim() || "Receiver";
        const email = String(achSigner.email || "").trim();
        const name = String(achSigner.name || "").trim();
        if (!email) return [];
        return buildDocuSignRolesFromEditorRows([{ role, name, email }]);
    }, [achSigner]);

    useEffect(() => {
        if (!isOpen) {
            setShowAchSignerEditor(false);
            return;
        }
        setCcEmails(loadBoldSignCcEmailList());
        setCcEmailDraft("");

        const overrides = parseContractSignerOverridesFromPrefill(
            (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                ?.contractPrefillOverrides,
        );
        const primary = overrides?.[0];
        if (primary?.email?.trim()) {
            setAchSigner({
                role: primary.role?.trim() || "Receiver",
                name: primary.name?.trim() || "",
                email: primary.email.trim(),
            });
        } else {
            setAchSigner({
                role: "Receiver",
                name: getSignerName().trim(),
                email: getSignerEmail().trim(),
            });
        }
    }, [isOpen, resolvedContract, getSignerName, getSignerEmail]);

    const syncAchEnvelopeStatus = useCallback(
        async (silent = false, options?: { force?: boolean }) => {
            if (!achEnvelopeId || !achMapping?.id) return;
            if (isAchEnvelopeSigningFinished(achStatus)) return;

            const now = Date.now();
            if (!options?.force && now - lastAchStatusSyncAtRef.current < ACH_STATUS_POLL_MS) {
                return;
            }
            lastAchStatusSyncAtRef.current = now;

            if (!silent) setStatusRefreshing(true);
            try {
                const shouldPassCc =
                    !achCcEmailDeliveredRef.current &&
                    !isAchEnvelopePastCcSendStep(achStatus) &&
                    !isAchEnvelopePastCcSendStep(achDisplayStatus);
                const ccForSync = shouldPassCc ? resolveCcForSend() : [];
                const syncRes = await axiosPost("/docusign/sync-envelope-status", {
                    envelopeId: achEnvelopeId,
                    ...(applicationId ? { applicationId: String(applicationId) } : {}),
                    ...(ccForSync.length ? { ccEmails: ccForSync } : {}),
                });
                const ccResult = (
                    syncRes.data as
                        | {
                              ccPrefilledEmail?: {
                                  emailed?: string[];
                                  skippedReason?: string;
                              };
                          }
                        | undefined
                )?.ccPrefilledEmail;
                if (
                    ccResult?.emailed?.length ||
                    ccResult?.skippedReason === "already_emailed" ||
                    ccResult?.skippedReason === "already_sent_in_crm"
                ) {
                    achCcEmailDeliveredRef.current = true;
                }
                const syncedStatus = String(
                    (syncRes.data as { internalStatus?: string } | undefined)?.internalStatus ??
                        "",
                ).trim();
                if (syncedStatus) {
                    if (isAchEnvelopePastCcSendStep(syncedStatus)) {
                        achCcEmailDeliveredRef.current = true;
                    }
                    await persistAchEnvelopeOnContract(
                        achMapping.id,
                        achEnvelopeId,
                        syncedStatus,
                    );
                    if (
                        isAchEnvelopeSigningFinished(syncedStatus) ||
                        isAchEnvelopePastCcSendStep(syncedStatus)
                    ) {
                        setPdfPaneTab("docusign");
                    }
                } else {
                    await refreshContractRow();
                }
                setLastStatusSyncAt(new Date());
            } catch (err: unknown) {
                if (!silent) {
                    const msg =
                        (err as { response?: { data?: { message?: string } } })?.response?.data
                            ?.message || "Could not refresh ACH signing status.";
                    toast.error(String(msg));
                }
            } finally {
                if (!silent) setStatusRefreshing(false);
            }
        },
        [achEnvelopeId, achMapping?.id, achStatus, achDisplayStatus, applicationId, persistAchEnvelopeOnContract, refreshContractRow, resolveCcForSend],
    );

    const loadTemplatePdf = useCallback(async () => {
        if (!achMapping?.template || !boldSignTemplateIsPreviewable(achMapping.template)) {
            setTemplatePdfUrl(null);
            return;
        }
        setTemplatePdfLoading(true);
        try {
            const blob = await loadBoldSignTemplatePdfBlob({
                template: achMapping.template,
                axiosGet,
            });
            if (templateBlobUrlRef.current) {
                URL.revokeObjectURL(templateBlobUrlRef.current);
            }
            const url = URL.createObjectURL(blob);
            templateBlobUrlRef.current = url;
            setTemplatePdfUrl(url);
        } catch (err: unknown) {
            const msg = (err as Error)?.message || "Failed to load ACH template PDF.";
            toast.error(msg);
            setTemplatePdfUrl(null);
        } finally {
            setTemplatePdfLoading(false);
        }
    }, [achMapping]);

    const loadDocuSignPdf = useCallback(async () => {
        if (!achPdfEnvelopeId) {
            setDocuSignPdfUrl(null);
            setDocuSignPdfHint("Send the ACH form via DocuSign to preview the filled envelope.");
            return;
        }
        setDocuSignPdfLoading(true);
        setDocuSignPdfHint(null);
        try {
            const res = await axiosGet(
                `/docusign/download/${encodeURIComponent(achPdfEnvelopeId)}`,
                {
                    responseType: "blob",
                    timeout: 120000,
                },
            );
            const blob = res.data instanceof Blob ? res.data : new Blob([res.data]);
            if (!blob.size) {
                setDocuSignPdfHint("DocuSign returned an empty PDF. Try again shortly.");
                return;
            }
            if (docuSignBlobUrlRef.current) {
                URL.revokeObjectURL(docuSignBlobUrlRef.current);
            }
            const url = URL.createObjectURL(blob);
            docuSignBlobUrlRef.current = url;
            setDocuSignPdfUrl(url);
        } catch (err: unknown) {
            const msg =
                (err as { response?: { data?: { message?: string } }; message?: string })?.response
                    ?.data?.message ||
                (err as { message?: string })?.message ||
                "Could not load ACH PDF from DocuSign.";
            setDocuSignPdfHint(String(msg));
            setDocuSignPdfUrl(null);
        } finally {
            setDocuSignPdfLoading(false);
        }
    }, [achPdfEnvelopeId]);

    const syncAchPrefillToDraftEnvelope = useCallback(async () => {
        if (!achEnvelopeId || !achMapping?.id) return;
        const draftLike =
            isAchEnvelopeDraftLikeStatus(achStatus) ||
            ACH_DRAFT_STATUSES.has(achStatus.toLowerCase());
        if (!draftLike || isAchEnvelopeSigningFinished(achStatus)) return;

        const saved = documentTemplatePrefillByMappingId[achMapping.id] ?? {};
        const rows = getDocumentTemplatePrefillFieldRowsForEditor({
            templateId: achMapping.template?.templateId ?? achMapping.templateId ?? null,
            templateName: achMapping.template?.name ?? null,
            templateType: achMapping.template?.type ?? achMapping.documentType ?? null,
            templateLayoutKey: achMapping.template?.layoutKey ?? null,
            templateState: achMapping.template?.state ?? null,
            templateFrequency: achMapping.template?.frequency ?? null,
            contract: resolvedContract,
            application: applicationData as Record<string, unknown> | null,
            contractRecords: contractPrefillRecords,
            agreementDate: new Date().toLocaleDateString("en-US"),
            mainPrefillOverrides: mainPrefillOverridesForDialog ?? undefined,
            savedOverridesForMapping: saved,
        });
        const fields = rows
            .map((f) => ({ id: f.id, value: String(f.value ?? "").trim() }))
            .filter((f) => f.id && f.value);
        if (!fields.length) return;
        try {
            await axiosPatch("/docusign/prefill-fields", {
                documentId: achEnvelopeId,
                fields,
            });
            if (pdfPaneTab === "docusign") {
                void loadDocuSignPdf();
            }
        } catch (err) {
            console.warn("[DocuSign] ACH prefill sync to draft envelope failed:", err);
        }
    }, [
        achEnvelopeId,
        achMapping,
        achStatus,
        documentTemplatePrefillByMappingId,
        resolvedContract,
        applicationData,
        contractPrefillRecords,
        mainPrefillOverridesForDialog,
        pdfPaneTab,
        loadDocuSignPdf,
    ]);

    const refreshAchSigningPreview = useCallback(
        async (silent = false) => {
            if (!isAchEnvelopeSigningFinished(achStatus)) {
                await syncAchEnvelopeStatus(silent, { force: true });
            }
            await loadDocuSignPdf();
        },
        [achStatus, syncAchEnvelopeStatus, loadDocuSignPdf],
    );

    useEffect(() => {
        if (!isOpen) return;
        setResolvedContract(contract);
    }, [isOpen, contract]);

    useEffect(() => {
        if (!isOpen) return;
        void loadTemplatePdf();
    }, [isOpen, loadTemplatePdf]);

    useEffect(() => {
        if (!isOpen) return;
        if (achPdfEnvelopeId && canPreviewDocuSignPdf) {
            setPdfPaneTab("docusign");
        } else if (!achPdfEnvelopeId) {
            setPdfPaneTab("template");
        }
    }, [isOpen, achPdfEnvelopeId, canPreviewDocuSignPdf, isSignedAch]);

    useEffect(() => {
        if (!isOpen || pdfPaneTab !== "docusign") return;
        void loadDocuSignPdf();
    }, [isOpen, pdfPaneTab, loadDocuSignPdf, achPdfEnvelopeId, achDisplayStatus, achStatus]);

    useEffect(() => {
        if (!isOpen) {
            achCcEmailDeliveredRef.current = false;
            lastAchStatusSyncAtRef.current = 0;
            return;
        }
        if (isAchEnvelopePastCcSendStep(achStatus) || isAchEnvelopePastCcSendStep(achDisplayStatus)) {
            achCcEmailDeliveredRef.current = true;
        }
    }, [isOpen, achStatus, achDisplayStatus]);

    useEffect(() => {
        if (!isOpen || !achEnvelopeId) return;
        if (isAchEnvelopeSigningFinished(achStatus)) return;
        void syncAchEnvelopeStatus(true, { force: true });
        const id = window.setInterval(
            () => void syncAchEnvelopeStatus(true),
            ACH_STATUS_POLL_MS,
        );
        return () => window.clearInterval(id);
    }, [isOpen, achEnvelopeId, achStatus, syncAchEnvelopeStatus]);

    useEffect(() => {
        return () => {
            if (templateBlobUrlRef.current) {
                URL.revokeObjectURL(templateBlobUrlRef.current);
                templateBlobUrlRef.current = null;
            }
            if (docuSignBlobUrlRef.current) {
                URL.revokeObjectURL(docuSignBlobUrlRef.current);
                docuSignBlobUrlRef.current = null;
            }
        };
    }, []);

    const canVoidAch = canVoidAchEnvelope(achStatus, achEnvelopeId);
    const canResendAch = canResendAchEnvelope(achStatus, achEnvelopeId);
    const canReviewAndSendAch = canReviewAndSendAchEnvelope(achStatus, achEnvelopeId);
    const achEnvelopeView = getAchEnvelopeView(achStatus, achEnvelopeId);
    const canEditRecipients = !readOnly && !achEnvelopeView.isOutForSignature;

    const addAchCcFromDraft = () => {
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
        const next = [...ccEmails, raw];
        setCcEmails(next);
        saveBoldSignCcEmailList(next);
        setCcEmailDraft("");
    };

    const openAchSignerEditor = () => {
        if (showAchSignerEditor) {
            setShowAchSignerEditor(false);
            return;
        }
        setSignerDraft({ ...achSigner });
        setShowAchSignerEditor(true);
    };

    const saveAchSigner = async () => {
        const role = String(signerDraft.role || "Receiver").trim() || "Receiver";
        const email = String(signerDraft.email || "").trim();
        const name = String(signerDraft.name || "").trim();
        if (!email) {
            toast.error("Signer email is required.");
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            toast.error("Enter a valid signer email address.");
            return;
        }
        const row: ContractSignerOverrideRow = { role, name, email };
        const roles = buildDocuSignRolesFromEditorRows([row]);
        const validation = validateDocuSignSignerRoles(roles);
        if (!validation.valid) {
            toast.error(validation.message || "Invalid signer details.");
            return;
        }

        setSavingSigner(true);
        try {
            setAchSigner(row);
            if (contractId != null) {
                const prefillBase =
                    (resolvedContract as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides ?? null;
                const contractPrefillOverrides = mergeContractPrefillWithSignerOverrides(
                    prefillBase,
                    [row],
                );
                const updated = await dispatch(
                    updateContract({
                        id: contractId,
                        data: {
                            contractPrefillOverrides,
                            clientEmail: email,
                            ...(name ? { clientName: name } : {}),
                        },
                    }),
                ).unwrap();
                const payload = (updated as { data?: unknown })?.data ?? updated;
                if (payload && typeof payload === "object") {
                    setResolvedContract((prev) =>
                        prev && typeof prev === "object"
                            ? { ...prev, ...(payload as Record<string, unknown>), contractPrefillOverrides }
                            : (payload as Record<string, unknown>),
                    );
                }
                await refreshContractRow();
            }
            setShowAchSignerEditor(false);
            toast.success(
                achEnvelopeView.hasEnvelope && !achEnvelopeView.isOutForSignature
                    ? "Signer saved. Click Review & send again to open DocuSign with the updated signer."
                    : "Signer saved. It will be used when you review and send the ACH form.",
            );
        } catch (err: unknown) {
            const msg =
                (err as { response?: { data?: { message?: string } } })?.response?.data
                    ?.message || "Failed to save signer.";
            toast.error(String(msg));
        } finally {
            setSavingSigner(false);
        }
    };

    const handleVoidAch = async () => {
        if (readOnly || !achEnvelopeId || !achMapping?.id) return;
        const confirmed = window.confirm(
            "Void this ACH form in DocuSign? Signers will no longer be able to sign. You can send a new ACH form afterward.",
        );
        if (!confirmed) return;

        setIsVoidingAch(true);
        try {
            await dispatch(
                voidBoldSignDocument({
                    documentId: achEnvelopeId,
                    reason: "Cancelled by user from CRM",
                }),
            ).unwrap();
            await persistAchEnvelopeOnContract(achMapping.id, achEnvelopeId, "revoked");
            if (docuSignBlobUrlRef.current) {
                URL.revokeObjectURL(docuSignBlobUrlRef.current);
                docuSignBlobUrlRef.current = null;
            }
            setDocuSignPdfUrl(null);
            setDocuSignPdfHint(null);
            setPdfPaneTab("template");
            await refreshContractRow();
            toast.success(
                "ACH form voided in DocuSign. Use Review & send when you are ready to send again.",
            );
        } catch (error: unknown) {
            const msg =
                (error as { message?: string })?.message || "Failed to void ACH form in DocuSign.";
            toast.error(String(msg));
        } finally {
            setIsVoidingAch(false);
        }
    };

    const handleReviewAndSend = async () => {
        if (readOnly || !onPrepareDocuSignDraft || !achMapping) return;
        if (!canReviewAndSendAch) {
            toast.info(
                "This ACH form is already out for signature. Void it in DocuSign before sending again.",
            );
            return;
        }
        const achTemplateId = getBoldSignTemplateMappingRef(achMapping.template);
        if (!achTemplateId) {
            toast.info("ACH form template is not configured.");
            return;
        }
        if (canResendAch) {
            toast.info("Creating a new DocuSign envelope to resend the ACH form.");
        }

        let docuSignTab: Window | null = null;
        try {
            docuSignTab = window.open("about:blank", "_blank");
            if (docuSignTab) {
                try {
                    writeDocuSignLoadingTab(docuSignTab.document);
                } catch {
                    /* ignore */
                }
            }
            flushSync(() => setIsSendingAch(true));

            const userCc = [...ccEmails];
            const draft = ccEmailDraft.trim();
            if (draft && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft)) {
                const dup = userCc.some((e) => e.toLowerCase() === draft.toLowerCase());
                if (!dup) userCc.push(draft);
            }
            const dedupedCc = [...new Set(userCc.map((e) => e.trim()).filter(Boolean))];
            saveBoldSignCcEmailList(dedupedCc);
            setCcEmails(dedupedCc);
            setCcEmailDraft("");
            const toSend = dedupedCc;

            const signerRoles = buildAchSignerRoles();
            const signerValidation = validateDocuSignSignerRoles(signerRoles);
            if (!signerValidation.valid) {
                const msg =
                    signerValidation.message ||
                    "Add a signer name and email before sending the ACH form.";
                if (docuSignTab) writeDocuSignErrorTab(docuSignTab.document, msg);
                toast.error(msg);
                return;
            }

            const prepared = await onPrepareDocuSignDraft({
                ccEmails: toSend,
                achDocumentRef: achTemplateId,
                standaloneAchOnly: true,
                roles: signerRoles,
            });
            const envelopeId = String(prepared?.envelopeId ?? "").trim();
            const preparedSenderUrl = String(prepared?.sendUrl ?? "").trim() || null;
            if (!envelopeId) {
                const msg = "Could not create the ACH DocuSign draft.";
                if (docuSignTab) writeDocuSignErrorTab(docuSignTab.document, msg);
                toast.error(msg);
                return;
            }

            const senderViewResult = await fetchDocuSignSenderViewUrlWithRetry(
                envelopeId,
                dedupedCc,
                Boolean(preparedSenderUrl),
                signerRoles,
            );
            const senderUrl = senderViewResult.url || preparedSenderUrl;
            if (!senderUrl) {
                const msg =
                    senderViewResult.error ||
                    "ACH draft was created but DocuSign did not return a review URL yet.";
                if (docuSignTab) writeDocuSignErrorTab(docuSignTab.document, msg);
                toast.error(msg, { autoClose: 12000 });
                return;
            }

            await persistAchEnvelopeOnContract(
                achMapping.id,
                envelopeId,
                canResendAch ? "" : "draft",
            );
            await refreshContractRow();
            setPdfPaneTab("docusign");

            if (docuSignTab) {
                try {
                    docuSignTab.location.href = senderUrl;
                    toast.success(
                        "ACH form opened in DocuSign. Review prefilled fields, edit if needed, then click Send.",
                        { autoClose: 12000 },
                    );
                    return;
                } catch {
                    /* fall through */
                }
            }

            if (!tryOpenDocuSignSenderUrl(senderUrl)) {
                toast.info(
                    "Your browser blocked the DocuSign tab. Allow pop-ups for this site and try again.",
                    { autoClose: 12000 },
                );
                return;
            }

            toast.success(
                "ACH form opened in DocuSign. Review prefilled fields, edit if needed, then click Send.",
                { autoClose: 12000 },
            );
        } catch (error: unknown) {
            const msg =
                typeof error === "string"
                    ? error
                    : (error as Error)?.message || "Failed to prepare ACH form in DocuSign.";
            if (docuSignTab) writeDocuSignErrorTab(docuSignTab.document, msg);
            toast.error(msg);
        } finally {
            setIsSendingAch(false);
        }
    };

    if (!isOpen || !achMapping) return null;

    const statusChain = [
        { key: "SENT", label: "Sent", hint: "Envelope sent" },
        { key: "VIEWED", label: "Viewed", hint: "Signer opened" },
        { key: "SIGNED", label: "Signed", hint: "Signature captured" },
        { key: "COMPLETED", label: "Completed", hint: "All done" },
    ];
    const statusRank: Record<string, number> = {
        DRAFT: -1,
        SENT: 0,
        VIEWED: 1,
        SIGNED: 2,
        COMPLETED: 3,
    };
    const normalizedStatus = String(achDisplayStatus).trim().toUpperCase();
    const terminalStatuses = ["DECLINED", "REVOKED", "EXPIRED"];
    const isTerminal = terminalStatuses.includes(normalizedStatus);
    const showDraftOnly =
        isAchEnvelopeDraftLikeStatus(achDisplayStatus) &&
        !isAchEnvelopePastCcSendStep(achDisplayStatus);
    const activeIndex =
        showDraftOnly || isTerminal ? -1 : statusRank[normalizedStatus] ?? -1;

    return (
        <>
            <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
                <DialogContent className="flex h-[min(94vh,calc(100dvh-1.5rem))] max-h-[min(94vh,calc(100dvh-1.5rem))] min-h-0 w-[1400px] max-w-[95vw] flex-col gap-0 overflow-hidden bg-white p-0 dark:bg-slate-900 dark:text-slate-100">
                    <div className="flex shrink-0 flex-col border-b bg-white px-6 py-3 dark:border-slate-700 dark:bg-slate-900">
                        <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                            ACH Authorization — {achTemplateLabel}
                        </DialogTitle>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Preview the ACH form, edit prefilled fields, then review and send in
                            DocuSign. Status updates when DocuSign webhooks are received.
                        </p>
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
                        <div className="flex min-h-0 w-full shrink-0 flex-col gap-3 overflow-y-auto border-r border-slate-200 p-4 dark:border-slate-700 lg:w-[42%] lg:min-w-[22rem]">
                            <div className="rounded-xl border border-[#276D9C]/15 bg-white p-4 shadow-sm ring-1 ring-slate-200/80 dark:border-slate-700 dark:bg-slate-900 dark:ring-slate-700/80">
                                <div className="mb-3 flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 items-start gap-2.5">
                                        <div
                                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#276D9C]/12 text-[#276D9C]"
                                            aria-hidden
                                        >
                                            <Landmark className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-xs font-semibold uppercase tracking-wide text-[#276D9C] dark:text-[#5a9fd4]">
                                                ACH Authorization
                                            </h4>
                                            <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                                                {achTemplateLabel}
                                            </p>
                                        </div>
                                    </div>
                                    <span
                                        className={getDocumentSendStatusCapsuleClasses(
                                            achDisplayStatus,
                                        )}
                                    >
                                        {achStatusLabel}
                                    </span>
                                </div>

                                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-[#276D9C]/20 bg-gradient-to-r from-[#276D9C]/5 to-white px-2.5 py-2.5 dark:border-slate-600 dark:from-[#276D9C]/10 dark:to-slate-900/80">
                                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#276D9C] text-white shadow-sm">
                                            <FileText className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                                                {achTemplateLabel}
                                            </p>
                                            {achEnvelopeId ? (
                                                <p className="truncate text-[10px] text-slate-500">
                                                    Envelope: {achEnvelopeId}
                                                </p>
                                            ) : null}
                                        </div>
                                    </div>
                                    {!readOnly ? (
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8 shrink-0 text-slate-600 hover:bg-[#276D9C]/10 hover:text-[#276D9C]"
                                            title="Edit ACH prefill fields"
                                            onClick={() => setPrefillEditOpen(true)}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                    ) : null}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-[#276D9C]/15 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                <div className="space-y-3">
                                    <div>
                                        <div className="flex items-center justify-between gap-2">
                                            <h3 className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100">
                                                ACH Signer
                                            </h3>
                                            {!achSigner.email ? (
                                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                                                    Required before send
                                                </span>
                                            ) : null}
                                        </div>
                                        {canEditRecipients ? (
                                            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                One person signs this form. Use the pencil to edit.
                                            </p>
                                        ) : null}
                                    </div>

                                    <div
                                        className={cn(
                                            "flex items-center gap-3 rounded-xl border p-3 transition-colors",
                                            showAchSignerEditor
                                                ? "border-[#276D9C]/40 bg-[#276D9C]/5 ring-1 ring-[#276D9C]/20"
                                                : "border-[#276D9C]/10 bg-[#276D9C]/5 hover:border-[#276D9C]/25 dark:border-slate-600 dark:bg-[#276D9C]/10",
                                            canEditRecipients && "cursor-pointer",
                                        )}
                                        onClick={
                                            canEditRecipients
                                                ? () => openAchSignerEditor()
                                                : undefined
                                        }
                                        onKeyDown={
                                            canEditRecipients
                                                ? (e) => {
                                                      if (e.key === "Enter" || e.key === " ") {
                                                          e.preventDefault();
                                                          openAchSignerEditor();
                                                      }
                                                  }
                                                : undefined
                                        }
                                        role={canEditRecipients ? "button" : undefined}
                                        tabIndex={canEditRecipients ? 0 : undefined}
                                    >
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-600 shadow-sm dark:border-emerald-500/30 dark:bg-slate-900">
                                            <User className="h-4 w-4" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                {achSigner.role || "Receiver"}
                                            </p>
                                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                {achSigner.name.trim() || "Add signer name"}
                                            </p>
                                            <p className="truncate text-xs text-slate-600 dark:text-slate-400">
                                                {achSigner.email || "Add signer email"}
                                            </p>
                                        </div>
                                        {canEditRecipients ? (
                                            <button
                                                type="button"
                                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-[#276D9C]/40 hover:bg-[#276D9C]/5 hover:text-[#276D9C] dark:border-slate-600 dark:bg-slate-900"
                                                title={showAchSignerEditor ? "Close editor" : "Edit signer"}
                                                aria-label={showAchSignerEditor ? "Close signer editor" : "Edit signer"}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    openAchSignerEditor();
                                                }}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                        ) : null}
                                    </div>

                                    {showAchSignerEditor && canEditRecipients ? (
                                        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-900/60">
                                            <p className="text-[11px] text-slate-600 dark:text-slate-400">
                                                Role, name, and email for the DocuSign envelope.
                                            </p>
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                <Input
                                                    placeholder="Role"
                                                    className="h-9 bg-white text-xs dark:bg-slate-950"
                                                    value={signerDraft.role}
                                                    onChange={(e) =>
                                                        setSignerDraft((prev) => ({
                                                            ...prev,
                                                            role: e.target.value,
                                                        }))
                                                    }
                                                />
                                                <Input
                                                    placeholder="Name"
                                                    className="h-9 bg-white text-xs dark:bg-slate-950"
                                                    value={signerDraft.name}
                                                    onChange={(e) =>
                                                        setSignerDraft((prev) => ({
                                                            ...prev,
                                                            name: e.target.value,
                                                        }))
                                                    }
                                                />
                                                <Input
                                                    placeholder="Email"
                                                    type="email"
                                                    autoComplete="email"
                                                    className="h-9 bg-white text-xs dark:bg-slate-950"
                                                    value={signerDraft.email}
                                                    onChange={(e) =>
                                                        setSignerDraft((prev) => ({
                                                            ...prev,
                                                            email: e.target.value,
                                                        }))
                                                    }
                                                />
                                            </div>
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 text-xs text-slate-500"
                                                    disabled={savingSigner}
                                                    onClick={() => setShowAchSignerEditor(false)}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="h-8 bg-[#3B8BD1] px-4 text-xs text-white hover:bg-[#2d6fad]"
                                                    disabled={
                                                        savingSigner ||
                                                        !String(signerDraft.role || "").trim()
                                                    }
                                                    onClick={() => void saveAchSigner()}
                                                >
                                                    {savingSigner ? "Saving..." : "Save"}
                                                </Button>
                                            </div>
                                        </div>
                                    ) : null}

                                    <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700">
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#276D9C] dark:text-[#5a9fd4]">
                                            <Mail className="h-3 w-3" aria-hidden />
                                            CC (copy only — not a signer)
                                        </span>
                                        <div className="flex flex-wrap gap-1.5">
                                            {ccEmails.length === 0 ? (
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                                    No CC recipients — add one below if needed.
                                                </span>
                                            ) : null}
                                            {ccEmails.map((email) => (
                                                <span
                                                    key={email}
                                                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#276D9C]/20 bg-[#276D9C]/8 px-2.5 py-0.5 text-xs font-medium text-slate-800 shadow-sm dark:border-[#276D9C]/30 dark:bg-[#276D9C]/15 dark:text-slate-100"
                                                >
                                                    <Mail className="h-3 w-3 shrink-0 text-[#276D9C] opacity-80" aria-hidden />
                                                    <span className="max-w-[220px] truncate" title={email}>
                                                        {email}
                                                    </span>
                                                    {canEditRecipients ? (
                                                        <button
                                                            type="button"
                                                            className="shrink-0 rounded p-0.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                                                            aria-label={`Remove ${email}`}
                                                            onClick={() => {
                                                                const next = ccEmails.filter((e) => e !== email);
                                                                setCcEmails(next);
                                                                saveBoldSignCcEmailList(next);
                                                            }}
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    ) : null}
                                                </span>
                                            ))}
                                        </div>
                                        {canEditRecipients ? (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Input
                                                    type="email"
                                                    autoComplete="email"
                                                    placeholder="name@company.com"
                                                    value={ccEmailDraft}
                                                    onChange={(e) => setCcEmailDraft(e.target.value)}
                                                    className="h-8 max-w-xs bg-white text-xs dark:bg-slate-950"
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
                                                    className="h-8 border-[#276D9C]/30 text-xs text-[#276D9C] hover:bg-[#276D9C]/10"
                                                    onClick={addAchCcFromDraft}
                                                >
                                                    Add CC
                                                </Button>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-[#276D9C]/15 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950">
                                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                                    <div className="flex items-start gap-2">
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#276D9C]/10 text-[#276D9C]">
                                            <Info className="h-4 w-4" aria-hidden />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                ACH signing status
                                            </h3>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                Updated via DocuSign webhooks (viewed, signed,
                                                completed).
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8 text-xs"
                                        disabled={statusRefreshing || !achPdfEnvelopeId}
                                        onClick={() => void refreshAchSigningPreview(false)}
                                    >
                                        {statusRefreshing ? (
                                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        ) : null}
                                        Refresh
                                    </Button>
                                </div>

                                <div className="space-y-3">
                                    <span className="inline-flex items-center rounded-full bg-[#276D9C]/12 px-3 py-1 text-xs font-semibold text-[#276D9C]">
                                        {formatSigningStatusLabel(
                                            showDraftOnly ? "DRAFT" : normalizedStatus,
                                        )}
                                    </span>
                                    {lastStatusSyncAt ? (
                                        <p className="text-[10px] text-slate-400">
                                            Last synced {lastStatusSyncAt.toLocaleTimeString()}
                                        </p>
                                    ) : null}
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-900/60">
                                        <div className="flex items-start">
                                            {statusChain.map((step, index) => {
                                                const isDone = activeIndex >= index;
                                                const isCurrent = activeIndex === index;
                                                return (
                                                    <Fragment key={step.key}>
                                                        <div className="flex min-w-[70px] flex-1 flex-col items-center text-center">
                                                            <div
                                                                className={cn(
                                                                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold",
                                                                    isDone
                                                                        ? "border-[#276D9C] bg-[#276D9C] text-white"
                                                                        : "border-slate-300 bg-white text-slate-400",
                                                                )}
                                                            >
                                                                {isDone ? (
                                                                    <CheckCircle2
                                                                        className="h-4 w-4"
                                                                        aria-hidden
                                                                    />
                                                                ) : (
                                                                    index + 1
                                                                )}
                                                            </div>
                                                            <div className="mt-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                                                                {step.label}
                                                            </div>
                                                            <div
                                                                className={cn(
                                                                    "mt-0.5 text-[10px]",
                                                                    isCurrent
                                                                        ? "text-[#276D9C]"
                                                                        : "text-slate-400",
                                                                )}
                                                            >
                                                                {step.hint}
                                                            </div>
                                                        </div>
                                                        {index < statusChain.length - 1 ? (
                                                            <div
                                                                className={cn(
                                                                    "mt-4 h-0.5 w-8 shrink-0 rounded-full",
                                                                    activeIndex > index
                                                                        ? "bg-[#276D9C]"
                                                                        : "bg-slate-200",
                                                                )}
                                                            />
                                                        ) : null}
                                                    </Fragment>
                                                );
                                            })}
                                        </div>
                                        {isTerminal ? (
                                            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                                                Signing ended:{" "}
                                                {formatSigningStatusLabel(normalizedStatus)}.
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                        </div>

                        <div className="relative flex min-h-0 w-full min-w-0 flex-col gap-2 bg-slate-700 p-3 lg:w-[58%] lg:max-w-[58%]">
                            <div
                                className="flex shrink-0 rounded-lg border border-slate-600 bg-slate-800/80 p-0.5"
                                role="tablist"
                            >
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={pdfPaneTab === "template"}
                                    className={cn(
                                        "flex-1 rounded-md px-3 py-1.5 text-center text-[11px] font-semibold transition-colors",
                                        pdfPaneTab === "template"
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-300 hover:text-white",
                                    )}
                                    onClick={() => setPdfPaneTab("template")}
                                >
                                    ACH template
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={pdfPaneTab === "docusign"}
                                    disabled={!achPdfEnvelopeId}
                                    className={cn(
                                        "flex-1 rounded-md px-3 py-1.5 text-center text-[11px] font-semibold transition-colors disabled:opacity-40",
                                        pdfPaneTab === "docusign"
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-300 hover:text-white",
                                    )}
                                    onClick={() => setPdfPaneTab("docusign")}
                                >
                                    {isSignedAch ? "Signed ACH form" : "DocuSign envelope"}
                                </button>
                            </div>
                            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded bg-white shadow-2xl">
                                {pdfPaneTab === "template" ? (
                                    templatePdfLoading ? (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <Loader2 className="h-8 w-8 animate-spin text-[#276D9C]" />
                                        </div>
                                    ) : templatePdfUrl ? (
                                        <DirectPdfViewer fileUrl={templatePdfUrl} />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-slate-500">
                                            ACH template PDF is not available.
                                        </div>
                                    )
                                ) : docuSignPdfLoading ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-slate-500">
                                        <Loader2 className="h-6 w-6 animate-spin text-[#276D9C]" />
                                        Loading ACH form from DocuSign…
                                    </div>
                                ) : docuSignPdfUrl ? (
                                    <DirectPdfViewer fileUrl={docuSignPdfUrl} />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-slate-500">
                                        {docuSignPdfHint ||
                                            "Send the ACH form via DocuSign to preview the filled envelope here."}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-6 py-3 dark:border-slate-700">
                        <Button type="button" variant="ghost" className="h-9 shrink-0" onClick={onClose}>
                            Close
                        </Button>
                        {!readOnly && canVoidAch ? (
                            <Button
                                type="button"
                                variant="outline"
                                className="h-9 shrink-0 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                                disabled={isVoidingAch || isSendingAch}
                                onClick={() => void handleVoidAch()}
                            >
                                {isVoidingAch ? "Voiding ACH form…" : "Void last ACH document"}
                            </Button>
                        ) : null}
                        {!readOnly && canResendAch ? (
                            <Button
                                type="button"
                                variant="default"
                                className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                disabled={isSendingAch || isVoidingAch || !onPrepareDocuSignDraft}
                                onClick={() => void handleReviewAndSend()}
                            >
                                {isSendingAch ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Preparing DocuSign…
                                    </>
                                ) : (
                                    "Resend ACH form"
                                )}
                            </Button>
                        ) : null}
                        {!readOnly && canReviewAndSendAch && !canResendAch ? (
                            <Button
                                type="button"
                                variant="default"
                                className={DOCUSIGN_PRIMARY_BTN_CLASS}
                                disabled={isSendingAch || isVoidingAch || !onPrepareDocuSignDraft}
                                onClick={() => void handleReviewAndSend()}
                            >
                                {isSendingAch ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Preparing DocuSign…
                                    </>
                                ) : (
                                    "Review & send ACH form"
                                )}
                            </Button>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

            <TemplateMappingPrefillEditDialog
                open={prefillEditOpen}
                onOpenChange={setPrefillEditOpen}
                row={achMapping as TemplateMappingPrefillEditRow}
                contractId={contractId}
                applicationUuid={applicationId}
                applicationData={applicationData}
                resolvedContract={resolvedContract}
                contractRecords={contractPrefillRecords}
                agreementDate={new Date().toLocaleDateString("en-US")}
                documentTemplatePrefillByMappingId={documentTemplatePrefillByMappingId}
                mainPrefillOverrides={mainPrefillOverridesForDialog}
                onSaved={() => {
                    void refreshContractRow().then(() => {
                        void syncAchPrefillToDraftEnvelope();
                    });
                    if (pdfPaneTab === "template") void loadTemplatePdf();
                }}
            />

        </>
    );
}
