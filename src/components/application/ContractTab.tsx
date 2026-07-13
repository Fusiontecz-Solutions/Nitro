import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { store, type AppDispatch, type RootState } from "@/redux/store";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import {
    getApplicationByApplicationId,
    getApplicationById,
    updateApplication,
} from "@/redux/actions/applicationActions";
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
    getDocuSignTemplateRecipients,
    mergeAndSendDocuSignEnvelope,
    voidBoldSignDocument,
} from "@/redux/actions/boldSignActions";
import { mergeWithDefaultCcEmails } from "./docusignCcList";
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
import { Ban, FileText, Info, Landmark, Loader2, RefreshCw } from "lucide-react";
import {
    filterBankDetailsForApplication,
} from "@/lib/bankDetailUtils";
import PDFViewerModal from "./PDFViewerModal";
import PDFViewerDocsModal from "./PDFViewerDocsModal";
import ACHFormViewerModal from "./ACHFormViewerModal";
import { axiosDelete, axiosGet, axiosPost } from "@/redux/axios";
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
    applyCanonicalBusinessAddressPrefillFields,
    applyClientPersonNamePrefillFields,
    contractPrefillFieldsToPartial,
    contractPrefillToContractColumnUpdate,
    mergeSyncedPartialIntoPrefillFields,
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
    parseDocumentSendHistory,
    parseDocumentTemplateEnvelopeByMappingId,
    parseLastAchSentFunder,
    stripDocumentTemplateBlobFromPrefillOverrides,
    upsertDocumentSendHistory,
} from "./contractdata/documentTemplateMappingPrefill";
import {
    achCapsuleClassName,
    parseAchAuthorizationDocuSignFromPrefill,
    type AchAuthorizationDocuSignCapsuleStatus,
} from "./contractdata/achAuthorizationDocuSign";
import {
    buildContractSendTableRows,
    canVoidContractSendTableRow,
    formatAchTableStatusLabel,
    isAchSigningFinished,
    isContractFullySigned,
    isContractVoidedOrTerminal,
    pickContractEnvelopeDocument,
    type ContractSendTableRow,
} from "./contractdata/contractSendHistory";
import { syncDocuSignEnvelopeStatus } from "./contractdata/syncDocuSignEnvelopeStatus";
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
import {
    formatCurrency,
    formatCurrencyFull,
    formatDate,
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
    if (ds === "completed" || cs === "COMPLETED" || cs === "SIGNED") return "Signed";
    if (ds === "viewed" || ds === "delivered" || cs === "VIEWED") return "Viewed";
    if (ds === "sent" || cs === "SENT") return "Sent";
    if (ds === "draft" || ds === "created" || cs === "DRAFT") return "Draft";
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
    if (label === "Signed") return "SIGNED";
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
}

export default function ContractTab({
    readOnly = false,
}: ContractTabProps = {}) {
    const { applicationId } = useParams<{ applicationId: string }>();
    const dispatch = useDispatch<AppDispatch>();
    const { data: applicationData } = useSelector(
        (state: RootState) => state.applicationDetail,
    );
    const { data: termsOffers, loading: termsOffersLoading } = useSelector(
        (state: RootState) => state.termsOffers,
    );
    const { data: offerDecision, loading: offerDecisionLoading } = useSelector(
        (state: RootState) => state.offerDecision,
    );
    const { data: loginData } = useSelector((state: RootState) => state.login);
    const { data: bankDetailsList } = useSelector(
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
    const [preparingAchViewer, setPreparingAchViewer] = useState(false);
    /** Which Info Required ACH row feeds the ACH Form modal (first / last picked). */
    const [selectedAchRecordId, setSelectedAchRecordId] = useState<string | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfName, setPdfName] = useState<string>("Contract.pdf");
    const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
    const [globalTemplateUrl, setGlobalTemplateUrl] = useState<string | null>(
        null,
    );
    const [globalTemplateName, setGlobalTemplateName] = useState<string | null>(
        null,
    );
    const [creatingEnvelope, setCreatingEnvelope] = useState(false);
    const [viewingSignedContract, setViewingSignedContract] = useState(false);
    const [viewingSignedEnvelopeId, setViewingSignedEnvelopeId] = useState<string | null>(null);
    const [voidingContract, setVoidingContract] = useState(false);
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
    const { resolveLayoutKey, findFunder, findFunderById } = useFunderProfiles(contractStateForFunders || null);

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
    const applicationUuid =
        (applicationData as any)?._id ?? (applicationData as any)?.id ?? appId;
    useEffect(() => {
        const termsApplicationKey = applicationUuid ?? appId;
        if (termsApplicationKey) {
            dispatch(getTermsOffers({ application: String(termsApplicationKey) }));
        }
    }, [applicationUuid, appId, dispatch]);

    // Load existing contract by application so "Contracts Generated" can show
    // persisted backend data even before creating/selecting a contract in this session.
    useEffect(() => {
        const fetchByApplication = async () => {
            if (!applicationUuid) {
                setFetchedContract(null);
                setSelectedContractId(null);
                return;
            }
            try {
                const res = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                const contract = (res as any)?.data ?? res ?? null;
                setFetchedContract(contract);
                const contractId = Number((contract as any)?.id);
                setSelectedContractId(Number.isFinite(contractId) ? contractId : null);
            } catch {
                setFetchedContract(null);
                setSelectedContractId(null);
            }
        };

        fetchByApplication();
    }, [dispatch, applicationUuid]);

    // Fetch created contract details by id when available
    useEffect(() => {
        const fetchById = async () => {
            if (!selectedContractId) return;
            try {
                const res = await dispatch(getByIdContract(Number(selectedContractId))).unwrap();
                console.log("fetched contract", res);
                setFetchedContract((res as any)?.data ?? res ?? null);
            } catch {
                setFetchedContract(null);
            }
        };
        fetchById();
    }, [dispatch, selectedContractId]);

    useEffect(() => {
        if (!selectedContractId) return;
        const id = selectedContractId;
        void dispatch(getAllACH({ contractId: id }));
        void dispatch(getAllAddendum({ contractId: id }));
        void dispatch(getAllEPO({ contractId: id }));
        void dispatch(getAllContractOwners({ contractId: id }));
        void dispatch(getAllContractGuarantors({ contractId: id }));
    }, [dispatch, selectedContractId]);

    useEffect(() => {
        void dispatch(getBoldSignTemplates({}));
    }, [dispatch]);

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
        void fetchAchTemplateMappings();
    }, [fetchAchTemplateMappings]);

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
        if (!selectedContractId || loadingAchMappings || linkedAchMapping) return;
        const ref = getBoldSignTemplateMappingRef(primaryAchTemplate);
        if (!ref) return;
        void ensureAchTemplateMapping(ref);
    }, [
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
                      bankName: latestBank.bankName,
                      accountNumber: latestBank.accountNumber,
                      routingNumber: latestBank.routingNumber,
                  }
                : null,
            addendum: firstRow(addendumListState.data),
            epo: firstRow(epoListState.data),
            owners: Array.isArray(contractOwnerListState.data)
                ? contractOwnerListState.data
                : [],
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
    ]);

    useEffect(() => {
        if (!appId) return;
        dispatch(getOfferDecisionByApplication(String(appId)));
    }, [appId, dispatch]);

    useEffect(() => {
        if (!applicationUuid) return;
        dispatch(getBankDetails({ application: String(applicationUuid) }));
    }, [applicationUuid, dispatch]);

    useEffect(() => {
        if (!applicationUuid) return;
        const refreshBankDetails = () => {
            if (document.visibilityState === "visible") {
                void dispatch(getBankDetails({ application: String(applicationUuid) }));
            }
        };
        window.addEventListener("focus", refreshBankDetails);
        document.addEventListener("visibilitychange", refreshBankDetails);
        return () => {
            window.removeEventListener("focus", refreshBankDetails);
            document.removeEventListener("visibilitychange", refreshBankDetails);
        };
    }, [applicationUuid, dispatch]);

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

    const contractsForTable = termsOffers ?? [];
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

    const offerRecord =
        offerDecision != null && typeof offerDecision === "object"
            ? (offerDecision as Record<string, unknown>)
            : null;

    const decisionFrequency = String(
        offerRecord?.frequency ?? effectiveTermsOffer?.frequency ?? "",
    );

    const paymentsPerMonth =
        decisionFrequency === "Daily"
            ? 22
            : decisionFrequency === "Weekly"
                ? 4
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
    const recipientFunds = approvedAmount - commissionAmount;
    const feeAmount = commissionAmount;

    const estimatedTotalPayment = repaymentStack?.payback ?? paybackAmount;

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
                PLATFORM_LAYOUT_KEYS.achAuthorization;
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
            (offerDecision as { id?: unknown; _id?: unknown } | null)?._id ??
            latestTermsOffer?._id;
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
        latestTermsOffer?._id,
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
    const [contractValuesSaved, setContractValuesSaved] = useState(false);
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
                recipientFunds ? formatCurrencyFull(recipientFunds) : "",
            );
            setFinanceChargeInput(feeAmount ? formatCurrencyFull(feeAmount) : "");
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
            setContractValuesSaved(true);
            setIsEditingContractValues(false);
            setSavedContractValuesSnapshot(persisted);
            return;
        }

        setContractValuesSaved(false);
        setIsEditingContractValues(false);
        setSavedContractValuesSnapshot(null);
        setAmountFinancedInput(amountFinanced ? formatCurrencyFull(amountFinanced) : "");
        setRecipientFundsInput(recipientFunds ? formatCurrencyFull(recipientFunds) : "");
        setFinanceChargeInput(feeAmount ? formatCurrencyFull(feeAmount) : "");
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
        feeAmount,
        estimatedTotalPayment,
        paymentTotal,
        estimatedMonthlyCost,
        estimatedPayment,
        decisionFrequency,
        numberOfPayments,
        termLength,
    ]);

    useEffect(() => {
        // Load system-wide contract template (uploaded by Final Underwriter dashboard)
        const fetchTemplate = async () => {
            try {
                const response = await axiosGet("/contract-templates/latest");
                const data = response.data?.data;
                if (data?.url) {
                    const template = {
                        url: data.url as string,
                        originalName: (data.originalName as string) || "Contract.pdf",
                    };
                    setGlobalTemplateUrl(template.url);
                    setGlobalTemplateName(template.originalName);
                    if (typeof window !== "undefined") {
                        localStorage.setItem(
                            "globalContractTemplate",
                            JSON.stringify(template),
                        );
                    }
                    return;
                }
            } catch (error) {
                console.error("Failed to fetch latest contract template:", error);
            }

            if (typeof window === "undefined") return;
            try {
                const raw = localStorage.getItem("globalContractTemplate");
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (parsed?.url) {
                    setGlobalTemplateUrl(parsed.url as string);
                    setGlobalTemplateName(
                        (parsed.originalName as string) || "Contract.pdf",
                    );
                }
            } catch (err) {
                console.error(
                    "Failed to read global contract template from storage:",
                    err,
                );
            }
        };

        fetchTemplate();
    }, []);

    /**
     * Open the PDF viewer for any existing contract on this application — regardless of status.
     * Re-opening a contract that has advanced past DRAFT (SENT/VIEWED/SIGNED/COMPLETED via BoldSign
     * webhooks) must NOT trigger a fresh `createContract` call, because the upsert would overwrite
     * the webhook-driven status back to DRAFT and break the signing flow.
     */
    const tryOpenExistingDraftViewer = async (): Promise<boolean> => {
        if (!applicationUuid) return false;
        const templateUrl = globalTemplateUrl;
        if (!templateUrl) return false;
        try {
            const byApp = await dispatch(
                getByApplicationIdContract(String(applicationUuid)),
            ).unwrap();
            const contract = (byApp as any)?.data ?? byApp;
            const byAppContractId = Number((contract as any)?.id);
            if (!Number.isFinite(byAppContractId) || byAppContractId <= 0) {
                return false;
            }
            setSelectedContractId(byAppContractId);
            setFetchedContract(contract);
            setPdfUrl(templateUrl);
            setPdfName(globalTemplateName || "Contract.pdf");
            const linkedEnvelopeId = String(
                (contract as any)?.application?.document?.envelopeId ?? "",
            ).trim();
            setPdfViewerInitialRightPaneTab(linkedEnvelopeId ? "prefilled" : "template");
            setPdfViewerOpen(true);
            return true;
        } catch {
            return false;
        }
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
            setSelectedContractId(Number.isFinite(contractId) ? contractId : null);
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

            if (!envelopeIdOverride) {
                const documentStatus = (contract as { application?: { document?: { status?: string } } })
                    ?.application?.document?.status;
                if (!isContractFullySigned((contract as { status?: unknown })?.status, documentStatus)) {
                    toast.info("The contract is not fully signed yet.");
                    return;
                }
            }

            const res = await axiosGet(
                `/docusign/download/${encodeURIComponent(envelopeId)}`,
                { responseType: "blob", timeout: 120000 },
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
            const fileName = `signed-contract-${fileLabel}.pdf`;

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
                "Could not load the signed contract.";
            toast.error(String(msg));
        } finally {
            setViewingSignedContract(false);
            setViewingSignedEnvelopeId(null);
        }
    };

    const reloadFetchedContract = useCallback(async () => {
        if (!applicationUuid) return null;
        const res = await dispatch(getByApplicationIdContract(String(applicationUuid))).unwrap();
        const contract = (res as { data?: unknown })?.data ?? res ?? null;
        setFetchedContract(contract);
        const contractId = Number((contract as { id?: unknown })?.id);
        if (Number.isFinite(contractId)) setSelectedContractId(contractId);
        return contract;
    }, [applicationUuid, dispatch]);

    const refreshContractEnvelopeStatus = useCallback(
        async (silent?: boolean, options?: { force?: boolean }) => {
            const mainEnvelopeId = String(contractEnvelopeDocument?.envelopeId ?? "").trim();
            if (!mainEnvelopeId || contractFullySigned) {
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
                if (!silent) setRefreshingSigningStatus(false);
            }
        },
        [
            applicationUuid,
            contractEnvelopeDocument?.envelopeId,
            contractFullySigned,
            reloadFetchedContract,
            selectedContractId,
        ],
    );

    const refreshAchEnvelopeStatus = useCallback(
        async (silent?: boolean, options?: { force?: boolean }) => {
            const achEnvelopeId = String(achAuthorizationDocuSign?.envelopeId ?? "").trim();
            const mainEnvelopeId = String(contractEnvelopeDocument?.envelopeId ?? "").trim();
            if (!achEnvelopeId || achEnvelopeId === mainEnvelopeId) {
                if (!silent) setAchSyncError(null);
                return;
            }
            if (isAchSigningFinished(achCapsuleStatus)) {
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

    const refreshSigningStatusesOnContractTab = useCallback(
        async (silent?: boolean, options?: { force?: boolean }) => {
            await refreshContractEnvelopeStatus(silent, options);
            await refreshAchEnvelopeStatus(silent, options);
            await refreshPackageEnvelopeStatus(silent, options);
        },
        [
            refreshAchEnvelopeStatus,
            refreshContractEnvelopeStatus,
            refreshPackageEnvelopeStatus,
        ],
    );

    const handleVoidSentEnvelopeRow = async (row: ContractSendTableRow) => {
        const envelopeId = String(row.envelopeId ?? "").trim();
        if (
            !envelopeId ||
            voidingContract ||
            !canVoidContractSendTableRow(contractRecordForActions, row)
        ) {
            return;
        }
        const confirmed = window.confirm(
            `Void "${row.label}" in DocuSign? Signers will no longer be able to sign this document.`,
        );
        if (!confirmed) return;

        setVoidingContract(true);
        try {
            await dispatch(
                voidBoldSignDocument({
                    documentId: envelopeId,
                    reason: "Voided by user from CRM",
                }),
            ).unwrap();
            await refreshSigningStatusesOnContractTab(false, { force: true });
            toast.success(`${row.label} voided in DocuSign.`);
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

    /** Draft created — Contract Generated (not sent until DocuSign envelope is delivered). */
    const persistContractGeneratedStage = async () => {
        if (!applicationUuid) return;
        try {
            await dispatch(
                updateApplication({
                    id: String(applicationUuid),
                    data: {
                        currentQueue: "Contract Generated",
                        currentState: "Contract Generated",
                    },
                }),
            ).unwrap();
        } catch (err) {
            console.error(
                "Failed to set application currentQueue/currentState to Contract Generated:",
                err,
            );
        }
    };

    const handleGenerateContract = async () => {
        if (isReadOnly) {
            const opened = await tryOpenExistingDraftViewer();
            if (!opened) {
                toast.info("No contract draft is available to view.");
            }
            return;
        }

        if (!globalTemplateUrl || !applicationUuid) {
            toast.error(
                "No contract template uploaded. Please upload it from the Final Underwriter dashboard.",
            );
            return;
        }

        // Re-open existing contract before any DB-mutating createContract call so a webhook-driven
        // status (SENT/VIEWED/SIGNED/COMPLETED) is never clobbered back to DRAFT by the upsert.
        const reopenedExisting = await tryOpenExistingDraftViewer();
        if (reopenedExisting) return;

        const anyApp = applicationData as any;

        await persistContractGeneratedStage();

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
            (offerDecision as any)?._id ??
            latestTermsOffer?._id;
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
            await dispatch(
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

            const numericAppId = anyApp?.applicationId;
            if (numericAppId != null && String(numericAppId).trim() !== "" && !Number.isNaN(Number(numericAppId))) {
                void dispatch(getApplicationByApplicationId(Number(numericAppId)));
            } else if (applicationUuid) {
                void dispatch(getApplicationById(String(applicationUuid)));
            }

            try {
                const byApp = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                const contract = (byApp as any)?.data ?? byApp;
                const byAppContractId = Number((contract as any)?.id);
                setSelectedContractId(Number.isFinite(byAppContractId) ? byAppContractId : null);
            } catch {
                /* contract id may already be set from create response */
            }
            setPdfUrl(globalTemplateUrl);
            setPdfName(globalTemplateName || "Contract.pdf");
            setPdfViewerInitialRightPaneTab("template");
            setPdfViewerOpen(true);
        } catch (error: any) {
            const message =
                error?.response?.data?.message ||
                error?.message ||
                "Failed to create contract.";
            toast.error(String(message));
        } finally {
            setCreatingEnvelope(false);
        }
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
        return buildContractPrefillFieldsFromApplication(applicationData, {
            agreementDate: formatDate(new Date()),
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
            /** Main contract layout key (Woodmere vs Texas Funding Group). */
            mainContractLayoutKey?: string | null;
        },
        options: { autoSend: boolean; suppressSuccessToast?: boolean },
    ): Promise<{
        envelopeId: string;
        prefillTabsApplied?: number;
        prefillFieldCount?: number;
        sendUrl?: string | null;
    }> => {
        const failDocuSignEnvelope = (message: string): never => {
            toast.error(message);
            throw new Error(message);
        };

        const addendumDocumentRef = String(
            sendPayload.addendumDocumentRef ?? sendPayload.addendumBoldSignTemplateId ?? "",
        ).trim();
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
        } else if (includeMainContract && !globalTemplateUrl) {
            failDocuSignEnvelope(
                "No contract template uploaded. Please upload it from the Final Underwriter dashboard.",
            );
        } else if (!includeMainContract) {
            const supplementalOnlyRefs = [addendumDocumentRef, disclosureDocumentRef].filter(
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
                        includeAddendum: Boolean(addendumDocumentRef),
                        includeDisclosure: Boolean(disclosureDocumentRef),
                    }
                  : {
                        includeMainContract: false,
                        includeAddendum: Boolean(addendumDocumentRef),
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
            String(funderProfileForSend?.defaultCcEmail ?? "").trim() || null;
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
                try {
                    recipientsPayload = await dispatch(
                        getDocuSignTemplateRecipients(undefined),
                    ).unwrap();
                } catch {
                    // Fall back to application-only signers if the role list is unavailable.
                }
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
            try {
                const refreshed = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
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
            if (Number.isFinite(contractNumericIdForPersist) && contractNumericIdForPersist > 0) {
                await persistContractFunderMeta(
                    contractNumericIdForPersist,
                    {
                        funderName: sendPayload.funderName,
                        state: sendPayload.contractState,
                    },
                    latestContract as Record<string, unknown>,
                );
                try {
                    const refreshedAfterMeta = await dispatch(
                        getByApplicationIdContract(String(applicationUuid)),
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

            const ownerRows = Array.isArray(contractOwnerListState.data)
                ? contractOwnerListState.data
                : [];
            const ownerCountResolved = resolveActiveOwnerCount({
                owners: ownerRows,
                signerRoles: roles,
            });
            /** ACH authorization is always a single-signer envelope. */
            const ownerCount = standaloneAchOnly ? 1 : ownerCountResolved;
            const secondOwnerNameBeforeCollapse = resolveSecondOwnerSignerName(
                roles,
                ownerCount,
                ownerRows,
            );
            roles = collapseDocuSignRolesToSignerSlots(roles, ownerCount);

            if (roles.length === 0) {
                failDocuSignEnvelope(
                    "Could not resolve any DocuSign signers. Add a client email on this application or configure default signer emails on the DocuSign template.",
                );
            }

            const missingEmailIndexes = roles
                .map((role, i) =>
                    String(role.signerEmail || "").trim() ? -1 : i,
                )
                .filter((i) => i >= 0);
            if (missingEmailIndexes.length > 0) {
                failDocuSignEnvelope(
                    `DocuSign template has signer role(s) without an email (roles ${missingEmailIndexes
                        .map((i) => i + 1)
                        .join(
                            ", ",
                        )}). Set default signer emails on the template in DocuSign, or add a client email on this application for the first signer.`,
                );
            }

            const primarySignerEmail = String(roles[0]?.signerEmail || "").trim();
            let prefillFieldsPayload: ContractPrefillField[] = buildPrefillFields(latestContract);
            if (primarySignerEmail) {
                prefillFieldsPayload = prefillFieldsPayload.map((field) =>
                    field.id === "client_email" || field.id === "customer_email"
                        ? { ...field, value: primarySignerEmail }
                        : field,
                );
            }

            const redirectUrlDocusign =
                typeof window !== "undefined"
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

            const supplementalDocumentRefs = standaloneAchOnly
                ? []
                : [addendumDocumentRef, disclosureDocumentRef].filter(Boolean);
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
                ssnNumber?: string;
                ssn?: string;
                driverLicenseNumber?: string;
                driverLicense?: string;
            } | undefined;
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
                if (Number.isFinite(contractNumericId) && mergedTemplateIdsForPrefill.length > 0) {
                    const mapRes = await axiosGet(
                        `/contract/${contractNumericId}/document-template-mappings`,
                    );
                    const mapRows = (mapRes?.data?.data ?? []) as Array<{
                        id: string;
                        template?: {
                            templateId?: string;
                            name?: string | null;
                            state?: string | null;
                            frequency?: string | null;
                        } | null;
                    }>;
                    prefillFieldsPayload = applyDocumentTemplateMappingPrefillOverrides({
                        prefillFieldsPayload,
                        mergedTemplateIds: mergedTemplateIdsForPrefill,
                        templateMappingRows: Array.isArray(mapRows) ? mapRows : [],
                        contractPrefillOverridesRaw: rawOverrides,
                        contract: latestContract as Record<string, unknown>,
                        application: applicationData as unknown as Record<string, unknown>,
                        agreementDate: formatDate(new Date()),
                        mainPrefillOverrides: mainPrefillForTemplates,
                    });
                }

                prefillFieldsPayload = mergeStateDisclosurePrefillFallback({
                    payload: prefillFieldsPayload,
                    supplementalRefs: supplementalDocumentRefs,
                    contract: latestContract as Record<string, unknown>,
                    application: applicationData as unknown as Record<string, unknown>,
                    agreementDate: formatDate(new Date()),
                    mainPrefillOverrides: mainPrefillForTemplates,
                });
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
                });
                prefillFieldsPayload = clearParty2PrefillFieldPayload(
                    prefillFieldsPayload,
                    ownerCount,
                );

                const syncedPartial = applyCanonicalBusinessAddressPrefillFields(
                    applyClientPersonNamePrefillFields(
                        contractPrefillFieldsToPartial(prefillFieldsPayload),
                        applicationData,
                    ),
                );
                prefillFieldsPayload = mergeSyncedPartialIntoPrefillFields(
                    prefillFieldsPayload,
                    syncedPartial,
                );

                const contractNumericIdPersist = Number((latestContract as { id?: unknown })?.id);
                if (Number.isFinite(contractNumericIdPersist) && contractNumericIdPersist > 0) {
                    try {
                        const rawOverrides = (latestContract as { contractPrefillOverrides?: unknown })
                            ?.contractPrefillOverrides;
                        const mainOverrides = stripDocumentTemplateBlobFromPrefillOverrides(
                            normalizeContractPrefillOverrides(rawOverrides) ?? {},
                        ) as Record<string, unknown>;
                        const columnUpdate = contractPrefillToContractColumnUpdate(syncedPartial);
                        const nextOverrides = mergeContractPrefillOverrideLayers(
                            mainOverrides as Partial<BuildContractPrefillFieldsArgs>,
                            syncedPartial,
                        );
                        await dispatch(
                            updateContract({
                                id: contractNumericIdPersist,
                                data: {
                                    ...columnUpdate,
                                    contractPrefillOverrides: nextOverrides,
                                },
                            }),
                        ).unwrap();
                        setFetchedContract({
                            ...(latestContract as Record<string, unknown>),
                            ...columnUpdate,
                            contractPrefillOverrides: nextOverrides,
                        });
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
            const mergeRequest = {
                ...(standaloneAchOnly
                    ? {
                          standaloneDocumentRefs: [achDocumentRef],
                          skipApplicationEnvelopeLink: true,
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
            };
            console.log(
                standaloneAchOnly
                    ? "[ContractTab] DocuSign layout send (standalone ACH):"
                    : "[ContractTab] DocuSign layout send (contract PDF + optional supplemental docs):",
                mergeRequest,
            );
            const sendResponse = await dispatch(
                mergeAndSendDocuSignEnvelope(mergeRequest),
            ).unwrap();
            console.log("[ContractTab] DocuSign layout send response:", sendResponse);

            const documentId =
                (sendResponse as any)?.envelopeId ||
                (sendResponse as any)?.documentId ||
                (sendResponse as any)?.data?.envelopeId ||
                (sendResponse as any)?.data?.documentId ||
                (sendResponse as any)?.id;
            const senderUrl =
                (sendResponse as any)?.sendUrl ||
                (sendResponse as any)?.data?.sendUrl ||
                (sendResponse as any)?.url;

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
                typeof window !== "undefined"
            ) {
                window.open(senderUrl, "_blank", "noopener,noreferrer");
                toast.success(
                    recipientList
                        ? `Draft opened in DocuSign.${mergeNote}${prefillNote} Review and click Send in DocuSign to email signers. Signer(s): ${recipientList}.`
                        : `Draft opened in DocuSign.${mergeNote}${prefillNote} Review and click Send in DocuSign to email signers.`,
                );
            } else if (autoSent) {
                toast.success(
                    recipientList
                        ? `Contract sent via DocuSign.${mergeNote}${prefillNote} Signing email sent to: ${recipientList}.`
                        : `Contract sent via DocuSign.${mergeNote}${prefillNote}`,
                );
            } else if (!senderUrl) {
                toast.success(
                    autoSent
                        ? `Contract sent via DocuSign.${mergeNote}${prefillNote}`
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
    }) => {
        const result = await runDocuSignEnvelope(payload, {
            autoSend: false,
            suppressSuccessToast: true,
        });
        const envelopeId = String(result?.envelopeId ?? "").trim();
        if (!envelopeId) {
            throw new Error("DocuSign did not return an envelope ID after creating the draft.");
        }
        if (!payload.standaloneAchOnly && payload.includeMainContract !== false) {
            const cid = Number((fetchedContract as { id?: unknown })?.id);
            if (Number.isFinite(cid) && cid > 0) {
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
                            status: "draft",
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
            }
        }
        return {
            envelopeId,
            prefillTabsApplied: result.prefillTabsApplied,
            prefillFieldCount: result.prefillFieldCount,
            sendUrl: result.sendUrl ?? null,
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
            const rawOverrides =
                normalizeContractPrefillOverrides(
                    (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                        ?.contractPrefillOverrides,
                ) ?? {};
            const main = stripDocumentTemplateBlobFromPrefillOverrides(
                rawOverrides,
            ) as Record<string, unknown>;
            const statusTrim = String(status ?? "").trim();
            const updatedAt = new Date().toISOString();
            const previousEnvelopeBlob = parseDocumentTemplateEnvelopeByMappingId(rawOverrides);
            const previousMeta = previousEnvelopeBlob[mappingId];
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
                previousEnvelopeId !== envelopeId &&
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
            const nextEnvelopeBlob = {
                ...previousEnvelopeBlob,
                [mappingId]: {
                    envelopeId,
                    ...(statusTrim ? { status: statusTrim } : {}),
                    updatedAt,
                },
            };
            if (statusTrim) {
                sendHistory = upsertDocumentSendHistory(sendHistory, {
                    envelopeId,
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
                          envelopeId,
                          updatedAt,
                      }
                    : priorLastAch;
            await dispatch(
                updateContract({
                    id: Number(cid),
                    data: {
                        contractPrefillOverrides: {
                            ...main,
                            ...(prefillBlob != null
                                ? {
                                      [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: prefillBlob,
                                  }
                                : {}),
                            [DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY]: nextEnvelopeBlob,
                            [DOCUMENT_SEND_HISTORY_KEY]: sendHistory,
                            ...(nextLastAch
                                ? { [LAST_ACH_SENT_FUNDER_KEY]: nextLastAch }
                                : {}),
                        },
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
            const returnUrl =
                typeof window !== "undefined"
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
                const url = String((res as { data?: { url?: string } })?.data?.url ?? "").trim();
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
                if (result.error) lastError = result.error;
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
    /** Saved grid for anyone when values are persisted (incl. Operations read-only) — avoids disabled-input fade. */
    const showSavedContractGrid = contractValuesSaved;

    const brandActionButtonClass = isDark
        ? "text-[#5AACEA] hover:bg-[#5AACEA]/10"
        : "text-[#276D9C] hover:bg-[#276D9C]/10";

    const renderContractSendTableRow = (row: ContractSendTableRow) => {
        const isAchRow = row.rowType === "ach";
        const isPackageRow = row.rowType === "package";
        const isSupplementalRow = isAchRow || isPackageRow;
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
        const rowCanVoid =
            !isReadOnly &&
            canVoidContractSendTableRow(contractRecordForActions, row);
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
                                className={`h-3.5 w-3.5 shrink-0 ${isDark ? "text-[#5AACEA]" : "text-[#276D9C]"}`}
                                aria-hidden
                            />
                        )}
                        {row.label}
                    </span>
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : (fetchedContract?.offer?.offer ??
                              fetchedContract?.program ??
                              "—")}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : (fetchedContract?.offer?.term ?? "—")}
                </TableCell>
                <TableCell className={tableCellClass}>{isSupplementalRow ? "—" : "1"}</TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : formatContractCurrency(fetchedContract?.approvedAmount)}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : formatContractCurrency(
                              fetchedContract?.totalAmount ?? fetchedContract?.offer?.totalRemit,
                          )}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : formatContractCurrency(contractTableMetrics.perPeriodPayment)}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : contractTableMetrics.buyRate}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : contractTableMetrics.upsell}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : contractTableMetrics.factor}
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
                                    {rowFullySigned || (isSupplementalRow && rowEnvelopeId) ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                                isAchRow
                                                    ? void (row.isCurrent
                                                          ? handleViewAchDocument()
                                                          : handleViewSignedContract(rowEnvelopeId))
                                                    : void handleViewSignedContract(
                                                          row.isCurrent && !isPackageRow
                                                              ? undefined
                                                              : rowEnvelopeId,
                                                      )
                                            }
                                            disabled={isViewingRow}
                                            className={`h-7 w-7 shrink-0 ${brandActionButtonClass}`}
                                            title={
                                                isAchRow
                                                    ? rowFullySigned
                                                        ? "View signed ACH form"
                                                        : "View filled ACH form"
                                                    : isPackageRow
                                                      ? rowFullySigned
                                                          ? "View signed supplemental documents"
                                                          : "View supplemental documents"
                                                      : "View signed contract"
                                            }
                                        >
                                            {isViewingRow ? (
                                                <Loader2
                                                    className="h-3.5 w-3.5 animate-spin"
                                                    aria-hidden
                                                />
                                            ) : (
                                                <Info className="h-3.5 w-3.5" aria-hidden />
                                            )}
                                        </Button>
                                    ) : null}
                                    {row.isCurrent && !rowFullySigned && !rowIsVoided ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                                void (isAchRow
                                                    ? refreshAchEnvelopeStatus(false, {
                                                          force: true,
                                                      })
                                                    : isPackageRow
                                                      ? refreshPackageEnvelopeStatus(false, {
                                                            force: true,
                                                        })
                                                      : refreshContractEnvelopeStatus(false, {
                                                            force: true,
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
            setContractValuesSaved(true);
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
        setContractValuesSaved(false);
    };

    const handleCancelContractValuesEdit = () => {
        if (savedContractValuesSnapshot) {
            setAmountFinancedInput(savedContractValuesSnapshot.amountFinancedInput || "");
            setRecipientFundsInput(savedContractValuesSnapshot.recipientFundsInput || "");
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
        setContractValuesSaved(true);
    };

    return (
        <div className="space-y-6">
            {/* Contract Filter Section - Light blue-grey background */}
            <div
                className={`rounded-lg border p-6 ${isDark ? "bg-[#1F2021] border-[#374151]" : "bg-[#E8F0F8] border-[#D1D5DB]"}`}
            >
                <div className="flex flex-wrap items-end justify-between gap-6">
                    <div className="flex flex-wrap items-end gap-6">

                    </div>
                    <div className="flex items-center gap-3">
                        {!isReadOnly && applicationUuid ? (
                            <Button
                                type="button"
                                onClick={() => void openAchViewer()}
                                disabled={creatingEnvelope || preparingAchViewer}
                                className="rounded-md bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer px-6 py-2 h-10 font-medium disabled:opacity-70 disabled:cursor-not-allowed"
                            >
                                {preparingAchViewer ? (
                                    <span className="inline-flex items-center gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Opening ACH form...
                                    </span>
                                ) : (
                                    "Send ACH Form"
                                )}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            onClick={handleGenerateContract}
                            disabled={creatingEnvelope}
                            className="rounded-md bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer  px-6 py-2 h-10 font-medium disabled:opacity-70 disabled:cursor-not-allowed"


                        >
                            {creatingEnvelope ? (
                                <span className="inline-flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Generating contract...
                                </span>
                            ) : isReadOnly || hasGeneratedContract ? (
                                "View Contract"
                            ) : (
                                "Generate Contract"
                            )}
                        </Button>

                    </div>
                </div>

            </div>

            {/* Final Calculations - White background */}
            <div
                className={`rounded-lg border p-6 ${isDark ? "bg-[#1F2021] border-[#374151]" : "bg-white border-[#D1D5DB]"}`}
            >
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h3
                        className={`text-base font-semibold ${isDark ? "text-gray-200" : "text-[#374151]"} ${isReadOnly && !contractValuesSaved ? "opacity-70" : ""}`}
                    >
                        Final Calculation
                    </h3>
                    {!isReadOnly && !isEditingContractValues && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleEditContractValues}
                            className="h-9 px-4 bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer"
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
                                    setAmountFinancedInput(formatted ? `$ ${formatted}` : "");
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
                                    setEstimatedTotalPaymentInput(
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
                            disabled={savingContractValues}
                            className="h-9 px-4 bg-[#276D9C] text-white hover:bg-[#276D9C]/90"
                        >
                            {savingContractValues ? "Saving..." : "Save Values"}
                        </Button>
                    </div>
                )}
            </div>

            {/* Contracts Generated Table */}
            <div className={contractsCardClass}>
                <h3 className={contractsHeaderClass}>Contracts Generated</h3>
                <div className="overflow-x-auto">
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
                            {(!hasGeneratedContract && contractsForTable.length === 0) ? (
                                <TableRow className={tableRowClass}>
                                    <TableCell
                                        colSpan={11}
                                        className={`text-center py-8 ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                                    >
                                        No contracts generated yet.
                                    </TableCell>
                                </TableRow>
                            ) : contractSendTableRows.length > 0 ? (
                                contractSendTableRows.map(renderContractSendTableRow)
                            ) : hasGeneratedContract ? (
                                <TableRow className={tableRowClass}>
                                    <TableCell
                                        colSpan={11}
                                        className={`text-center py-8 ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                                    >
                                        No DocuSign sends yet. Rows appear here after a
                                        contract, addendum, disclosure, or ACH form is sent from
                                        DocuSign (not while still in draft).
                                    </TableCell>
                                </TableRow>
                            ) : (
                                contractsForTable.map((offer) => (
                                    <TableRow
                                        key={offer._id}
                                        className={tableRowClass}
                                    >
                                        <TableCell className={tableCellClass}>
                                            {offer.position || "—"}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {offer.termLength ?? "—"}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            1
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {formatContractCurrency(offer.approvedAmount)}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {formatContractCurrency(offer.paybackAmount)}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {formatContractCurrency(
                                                offer.paymentAmount ??
                                                    contractTableMetrics.perPeriodPayment,
                                            )}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {offer.buyRate != null
                                                ? `${offer.buyRate}%`
                                                : contractTableMetrics.buyRate}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {offer.percentOfGross != null
                                                ? `${offer.percentOfGross}%`
                                                : contractTableMetrics.upsell}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {offer.factorRate != null
                                                ? String(offer.factorRate)
                                                : contractTableMetrics.factor}
                                        </TableCell>
                                        <TableCell>
                                            <span className={statusBadgeClass}>
                                                Generated
                                            </span>
                                        </TableCell>
                                        <TableCell className={tableCellClass}>—</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
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

            <PDFViewerModal
                isOpen={pdfViewerOpen}
                onClose={() => {
                    setPdfViewerOpen(false);
                    setPdfViewerInitialRightPaneTab("template");
                    void refreshFetchedContract();
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
