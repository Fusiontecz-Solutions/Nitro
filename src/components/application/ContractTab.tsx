import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { type AppDispatch, type RootState } from "@/redux/store";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import {
    getApplicationByApplicationId,
    getApplicationById,
    reinitiateContract,
    updateApplication,
} from "@/redux/actions/applicationActions";
import {
    createContract,
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
import { mergeAndSendBoldSignTemplates, voidBoldSignDocument } from "@/redux/actions/boldSignActions";
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
import { Ban, Eye, FileText, Landmark, Loader2, RefreshCw } from "lucide-react";
import PDFViewerModal from "./PDFViewerModal";
import { useFunderProfiles } from "@/hooks/useFunderProfiles";
import { fetchMainContractTemplatePreview } from "./contractdata/contractTemplatePreview";
import PDFViewerDocsModal from "./PDFViewerDocsModal";
import ACHViewerModal from "./ACHViewerModal";
import ReverseDisbursementScheduleSection from "./ReverseDisbursementScheduleSection";
import { applicationNeedsContractReinitiation, isIsoUpdatedOfferApproved } from "@/lib/contractReinitiation";
import { mergeContractCcEmailList } from "./boldsignCcList";
import { axiosDelete, axiosGet, axiosPost } from "@/redux/axios";
import { DOCUSIGN_ADDENDUM_LAYOUT_KEYS } from "./contractdata/docusignAddendumTemplates";
import { isAchAuthorizationLayoutKey } from "./contractdata/platformDocumentConfig";
import {
    achCapsuleClassName,
    mergeAchAuthorizationDocuSignIntoPrefill,
    mergeAchSignerOverridesIntoPrefill,
    parseAchAuthorizationDocuSignFromPrefill,
    parseAchSignerOverridesFromPrefill,
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
import { watchDocuSignSenderReturn } from "./contractdata/watchDocuSignSenderReturn";
// import { US_STATES } from "@/constants/usStates";
import {
    buildContractPrefillFieldsFromApplication,
    CONTRACT_PREFILL_OVERRIDES_SECTION,
    getSignerRecipientEmailForContract,
    getApplicationPrimaryRecipientName,
    normalizeContractPrefillOverrides,
    parseNoteStructuredSection,
    resolveBalanceTransferMerchantContext,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
} from "./contractdata/Contract";
import {
    applyDocumentTemplateMappingPrefillOverrides,
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    mergeStateDisclosurePrefillFallback,
} from "./contractdata/documentTemplateMappingPrefill";
import {
    buildContractEnvelopeEmailSubject,
    buildAchFormEnvelopeEmailSubject,
    CONTRACT_ENVELOPE_LENDER_NAME,
} from "./contractdata/docusignTemplateConfig";
import {
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
import { getPlatformSignerRoleRows } from "./contractdata/platformDocumentConfig";
import { resolveDocuSignSenderReturnUrl } from "./contractdata/resolveDocuSignSenderReturnUrl";
import {
    buildBoldSignRolesFromTemplateRecipients,
    buildDocuSignRolesFromEditorRows,
    contractSignerRowsFromRolePayload,
    mergeContractPrefillWithSignerOverrides,
    parseContractSignerOverridesFromPrefill,
    type DocuSignTemplateRolePayload,
} from "./contractdata/templateRecipients";
import {
    applyPrimaryGuarantorNamesToPrefillFields,
    applySecondOwnerNameToPrefillFields,
    clearParty2PrefillFieldPayload,
    resolveOwnerRowFullName,
    collapseDocuSignRolesToSignerSlots,
    resolveActiveOwnerCount,
    resolveSecondOwnerSignerName,
} from "./contractdata/contractPartyCounts";
import {
    applicationWithClientOwners,
    resolveOwnerRowsForContractPrefill,
} from "./contractdata/contractSignerOwnersSync";
import { useApplicationClientOwners } from "@/hooks/useApplicationClientOwners";
import {
    formatCurrency,
    formatCurrencyFull,
    formatDate,
    formatDateTimeUS,
    type DateInput,
    formatNumberUSForInput,
    parseNumberUS,
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
    isApplicationUuid,
    resolvePrismaApplicationUuid,
} from "@/lib/paymentDealApplicationId";

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

/** BoldSign 400 when signers are rejected; show success toast instead of raw validation noise. */
function isBoldSignMissingSignerMessage(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes("minimum one signer") ||
        m.includes("one signer is needed") ||
        m.includes('"signers"') ||
        (m.includes("boldsign validation error") && m.includes("signer")) ||
        (m.includes("docusign error") && m.includes("signer"))
    );
}

/** Legacy `sendViewOption: "Prepare"` caused BoldSign 400; treat like soft-success for toast UX. */
function isBoldSignSendViewOptionPageViewError(message: string): boolean {
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
    const applicationClient = (applicationData as { client?: unknown } | null)?.client;
    const { owners: fullClientOwners } = useApplicationClientOwners(applicationClient);
    const applicationForOwnerResolution = useMemo(
        () => applicationWithClientOwners(applicationData, fullClientOwners),
        [applicationData, fullClientOwners],
    );
    const { data: termsOffers, loading: termsOffersLoading } = useSelector(
        (state: RootState) => state.termsOffers,
    );
    const { data: offerDecision, loading: offerDecisionLoading } = useSelector(
        (state: RootState) => state.offerDecision,
    );
    const { data: loginData } = useSelector((state: RootState) => state.login);
    const userRoleRaw =
        (loginData as any)?.user?.role ||
        (typeof window !== "undefined" ? localStorage.getItem("role") : "") ||
        "";
    const roleKey = String(userRoleRaw || "").replace(/-/g, "_").toUpperCase();
    const isOpsOrSuperAdmin = roleKey === "OPERATIONS" || roleKey === "SUPER_ADMIN";
    const { data: bankDetailsList } = useSelector(
        (state: RootState) => state.bankDetails,
    );
    const achListState = useSelector((state: RootState) => state.achList);
    const addendumListState = useSelector((state: RootState) => state.addendumList);
    const epoListState = useSelector((state: RootState) => state.epoList);
    const contractOwnerListState = useSelector((state: RootState) => state.contractOwnerList);
    const contractGuarantorListState = useSelector(
        (state: RootState) => state.contractGuarantorList,
    );
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
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
    const [regeneratingContract, setRegeneratingContract] = useState(false);
    const [viewingSignedContract, setViewingSignedContract] = useState(false);
    const [viewingSignedEnvelopeId, setViewingSignedEnvelopeId] = useState<string | null>(null);
    const [voidingContract, setVoidingContract] = useState(false);
    const [signedPdfPreviewOpen, setSignedPdfPreviewOpen] = useState(false);
    const [signedPdfPreviewUrl, setSignedPdfPreviewUrl] = useState<string | null>(null);
    const [signedPdfPreviewName, setSignedPdfPreviewName] = useState("Signed contract.pdf");
    const [fetchedContract, setFetchedContract] = useState<any | null>(null);
    const contractStateForFunders = String(
        (fetchedContract as { state?: string | null } | null)?.state ?? "",
    ).trim();
    const { resolveLayoutKey, funders, previewNameFor } = useFunderProfiles(contractStateForFunders || null);
    const [viewingAchDocument, setViewingAchDocument] = useState(false);
    const [refreshingSigningStatus, setRefreshingSigningStatus] = useState(false);
    const [contractSyncError, setContractSyncError] = useState<string | null>(null);
    const [achSyncError, setAchSyncError] = useState<string | null>(null);
    const [packageSyncError, setPackageSyncError] = useState<string | null>(null);
    const [achViewerOpen, setAchViewerOpen] = useState(false);
    const [achViewerInitialTab, setAchViewerInitialTab] = useState<"template" | "filled">("template");
    const [preparingAchViewer, setPreparingAchViewer] = useState(false);

    const appId =
        applicationId ??
        (applicationData as { _id?: string; id?: string })?.id ??
        (applicationData as { _id?: string })?._id;
    const applicationUuid = useMemo(() => {
        const fromData = resolvePrismaApplicationUuid(
            applicationData as { id?: unknown; _id?: unknown } | null,
        );
        if (fromData) return fromData;
        const routeId = applicationId?.trim();
        if (routeId && isApplicationUuid(routeId)) return routeId;
        return null;
    }, [applicationData, applicationId]);
    useEffect(() => {
        const termsApplicationKey = applicationUuid ?? appId;
        if (termsApplicationKey) {
            dispatch(getTermsOffers({ application: String(termsApplicationKey) }));
        }
    }, [appId, applicationUuid, dispatch]);

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

    const contractPrefillRecords: ContractPrefillContractRecords = useMemo(() => {
        const firstRow = (data: unknown): Record<string, unknown> | null =>
            Array.isArray(data) && data.length ? (data[0] as Record<string, unknown>) : null;
        const rows = Array.isArray(bankDetailsList) ? bankDetailsList : [];
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
        return {
            contract: fetchedContract && typeof fetchedContract === "object" ? fetchedContract : null,
            ach: firstRow(achListState.data),
            addendum: firstRow(addendumListState.data),
            epo: firstRow(epoListState.data),
            owners: Array.isArray(contractOwnerListState.data)
                ? contractOwnerListState.data
                : [],
            guarantors: Array.isArray(contractGuarantorListState.data)
                ? contractGuarantorListState.data
                : [],
            bankDetail: latestBankDetail as Record<string, unknown> | null,
        };
    }, [
        achListState.data,
        addendumListState.data,
        epoListState.data,
        contractOwnerListState.data,
        contractGuarantorListState.data,
        fetchedContract,
        bankDetailsList,
    ]);

    useEffect(() => {
        if (!appId) return;
        dispatch(getOfferDecisionByApplication(String(appId)));
    }, [appId, dispatch]);

    useEffect(() => {
        if (!applicationUuid) return;
        dispatch(getBankDetails({ application: String(applicationUuid) }));
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

    const needsContractReinitiation = applicationNeedsContractReinitiation(
        applicationData as Record<string, unknown> | null,
    );
    const isoApprovedUpdatedOffer = isIsoUpdatedOfferApproved(
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

    const contractEnvelopeId = String(contractEnvelopeDocument?.envelopeId ?? "").trim();

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

    // Derive final calculations from offer decision + terms offer (aligned with OfferDecisionToggle).
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

    const estimatedTotalPayment =
        repaymentStack?.payback ?? paybackAmount;

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
        const factor =
            effectiveTermsOffer?.factorRate ??
            factorRate;

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
        // Load system-wide contract template (uploaded by Underwriter dashboard)
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

    const resolveContractTemplateForOpen = useCallback(
        async (funderName?: string | null) => {
            const name = String(
                funderName ??
                    (fetchedContract as { funderName?: string | null } | null)?.funderName ??
                    "",
            ).trim();
            const state = String(
                (fetchedContract as { state?: string | null } | null)?.state ??
                    contractStateForFunders ??
                    "",
            ).trim();
            const layoutKey = resolveLayoutKey(name || null);
            const preview = await fetchMainContractTemplatePreview({
                layoutKey,
                funderName: name || null,
                state: state || null,
                previewName: previewNameFor(name || null),
                fallbackUrl: globalTemplateUrl,
                fallbackName: globalTemplateName,
            });
            if (preview?.url) {
                return { url: preview.url, name: preview.name };
            }
            if (globalTemplateUrl) {
                return {
                    url: globalTemplateUrl,
                    name: globalTemplateName || "Contract.pdf",
                };
            }
            return null;
        },
        [
            contractStateForFunders,
            fetchedContract,
            globalTemplateName,
            globalTemplateUrl,
            previewNameFor,
            resolveLayoutKey,
        ],
    );

    /**
     * Open the PDF viewer for any existing contract on this application — regardless of status.
     * Re-opening a contract that has advanced past DRAFT (SENT/VIEWED/SIGNED/COMPLETED via BoldSign
     * webhooks) must NOT trigger a fresh `createContract` call, because the upsert would overwrite
     * the webhook-driven status back to DRAFT and break the signing flow.
     */
    const tryOpenExistingDraftViewer = async (): Promise<boolean> => {
        if (!applicationUuid) return false;
        try {
            const byApp = await dispatch(
                getByApplicationIdContract(String(applicationUuid)),
            ).unwrap();
            const contract = (byApp as any)?.data ?? byApp;
            const byAppContractId = Number((contract as any)?.id);
            if (!Number.isFinite(byAppContractId) || byAppContractId <= 0) {
                return false;
            }
            const template = await resolveContractTemplateForOpen(
                (contract as { funderName?: string | null })?.funderName,
            );
            if (!template?.url) return false;
            setSelectedContractId(byAppContractId);
            setFetchedContract(contract);
            setPdfUrl(template.url);
            setPdfName(template.name || "Contract.pdf");
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
                contract = (byApp as any)?.data ?? byApp;
                setFetchedContract(contract);
            }

            const contractId = Number((contract as any)?.id);
            if (!Number.isFinite(contractId) || contractId <= 0) {
                toast.info("No contract is available to view.");
                return;
            }

            const envelopeId = String(
                envelopeIdOverride ??
                    (contract as any)?.application?.document?.envelopeId ??
                    "",
            ).trim();
            if (!envelopeId) {
                toast.error(
                    "No DocuSign envelope found. Refresh contract status after signing completes.",
                );
                return;
            }

            if (!envelopeIdOverride) {
                const documentStatus = (contract as any)?.application?.document?.status;
                if (!isContractFullySigned((contract as any)?.status, documentStatus)) {
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
                    applicationId: applicationUuid ? String(applicationUuid) : undefined,
                    contractId: selectedContractId ?? undefined,
                    funderName:
                        (fetchedContract as { funderName?: string | null } | null)?.funderName ??
                        undefined,
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
                    envelopeLabel: "contract",
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
                    envelopeLabel: "ACH authorization",
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
                    envelopeLabel: "supplemental documents",
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

    const contractFullySignedRef = useRef(contractFullySigned);
    const achCapsuleStatusRef = useRef(achCapsuleStatus);
    const packageCapsuleStatusRef = useRef(packageCapsuleStatus);
    const contractEnvelopeIdRef = useRef(contractEnvelopeId);
    const achEnvelopeIdRef = useRef(achAuthorizationDocuSign?.envelopeId);
    const packageEnvelopeIdRef = useRef(standalonePackageDocuSign?.envelopeId);
    contractFullySignedRef.current = contractFullySigned;
    achCapsuleStatusRef.current = achCapsuleStatus;
    packageCapsuleStatusRef.current = packageCapsuleStatus;
    contractEnvelopeIdRef.current = contractEnvelopeId;
    achEnvelopeIdRef.current = achAuthorizationDocuSign?.envelopeId;
    packageEnvelopeIdRef.current = standalonePackageDocuSign?.envelopeId;

    const senderReturnWatchCleanupRef = useRef<(() => void) | null>(null);

    /** Heal standalone package rows stuck at DRAFT after DocuSign already sent/signed. */
    useEffect(() => {
        if (!applicationUuid || !hasGeneratedContract) return;
        const packageEnvId = String(standalonePackageDocuSign?.envelopeId ?? "").trim();
        const mainEnvId = mainContractEnvelopeId ?? "";
        if (
            packageEnvId &&
            packageEnvId !== mainEnvId &&
            packageCapsuleStatus === "DRAFT"
        ) {
            void refreshPackageEnvelopeStatus(true, { force: true });
        }
    }, [
        applicationUuid,
        hasGeneratedContract,
        mainContractEnvelopeId,
        packageCapsuleStatus,
        refreshPackageEnvelopeStatus,
        standalonePackageDocuSign?.envelopeId,
    ]);

    const beginSenderReturnStatusWatch = useCallback(() => {
        senderReturnWatchCleanupRef.current?.();
        senderReturnWatchCleanupRef.current = watchDocuSignSenderReturn({
            onReturn: () => refreshSigningStatusesOnContractTab(true, { force: true }),
            shouldStop: () => {
                const mainId = String(contractEnvelopeIdRef.current ?? "").trim();
                const achId = String(achEnvelopeIdRef.current ?? "").trim();
                const packageId = String(packageEnvelopeIdRef.current ?? "").trim();
                const contractPending = Boolean(mainId) && !contractFullySignedRef.current;
                const achPending =
                    Boolean(achId) &&
                    achId !== mainId &&
                    !isAchSigningFinished(achCapsuleStatusRef.current);
                const packagePending =
                    Boolean(packageId) &&
                    packageId !== mainId &&
                    !isStandalonePackageSigningFinished(packageCapsuleStatusRef.current);
                return !contractPending && !achPending && !packagePending;
            },
        });
    }, [refreshSigningStatusesOnContractTab]);

    useEffect(() => {
        if (pdfViewerOpen || achViewerOpen) {
            senderReturnWatchCleanupRef.current?.();
            senderReturnWatchCleanupRef.current = null;
            return;
        }

        const mainId = String(contractEnvelopeId ?? "").trim();
        const achId = String(achAuthorizationDocuSign?.envelopeId ?? "").trim();
        const hasPendingContract = Boolean(mainId) && !contractFullySigned;
        const hasPendingAch =
            Boolean(achId) &&
            achId !== mainId &&
            !isAchSigningFinished(achCapsuleStatus);
        if (!hasPendingContract && !hasPendingAch) {
            senderReturnWatchCleanupRef.current?.();
            senderReturnWatchCleanupRef.current = null;
            return;
        }

        beginSenderReturnStatusWatch();
        return () => {
            senderReturnWatchCleanupRef.current?.();
            senderReturnWatchCleanupRef.current = null;
        };
    }, [
        pdfViewerOpen,
        achViewerOpen,
        contractEnvelopeId,
        contractFullySigned,
        achAuthorizationDocuSign?.envelopeId,
        achCapsuleStatus,
        beginSenderReturnStatusWatch,
    ]);

    const ensureAchTemplateLinked = useCallback(async (contractId: number) => {
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
        await axiosPost(`/contract/${contractId}/document-template-mappings`, {
            documentType: "ach",
            templateRef: DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION,
        });
    }, []);

    useEffect(() => {
        const contractId = Number(selectedContractId);
        if (!Number.isFinite(contractId) || contractId <= 0) return;
        void ensureAchTemplateLinked(contractId).catch((err) => {
            console.warn("[ContractTab] ACH template auto-link skipped:", err);
        });
    }, [selectedContractId, ensureAchTemplateLinked]);

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

    const openAchViewer = async (initialTab: "template" | "filled" = "template") => {
        if (!applicationUuid) {
            toast.error("Application is required to send the ACH form.");
            return;
        }
        setPreparingAchViewer(true);
        try {
            const contractId = await ensureContractRecordForAch();
            await ensureAchTemplateLinked(contractId);
            setAchViewerInitialTab(initialTab);
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

    const handleViewAchDocument = async () => {
        const envelopeId = String(achAuthorizationDocuSign?.envelopeId ?? "").trim();
        if (!envelopeId) {
            toast.info("ACH authorization has not been sent via DocuSign yet.");
            return;
        }
        setViewingAchDocument(true);
        try {
            await openAchViewer("filled");
        } finally {
            setViewingAchDocument(false);
        }
    };

    /** Contract record created — not yet in DocuSign. Contract Sent only after send. */
    const persistContractPendingStage = async () => {
        if (!applicationUuid) return;
        try {
            await dispatch(
                updateApplication({
                    id: String(applicationUuid),
                    data: {
                        currentQueue: "Contract Pending",
                        currentState: "Contract_Pending",
                    },
                }),
            ).unwrap();
        } catch (err) {
            console.error(
                "Failed to set application currentQueue/currentState to Contract Pending:",
                err,
            );
        }
    };

    /** DocuSign draft envelope created — review before send. */
    const persistContractGeneratedStage = async () => {
        if (!applicationUuid) return;
        try {
            await dispatch(
                updateApplication({
                    id: String(applicationUuid),
                    data: {
                        currentQueue: "Contract Generated",
                        currentState: "CONTRACT_GENERATED",
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

    const showRegenerateContractButton =
        isOpsOrSuperAdmin &&
        !isReadOnly &&
        needsContractReinitiation;

    const handleRegenerateContract = async () => {
        if (!applicationUuid) {
            toast.error("Missing application ID.");
            return;
        }
        const template = await resolveContractTemplateForOpen(
            (fetchedContract as { funderName?: string | null } | null)?.funderName,
        );
        if (!template?.url) {
            toast.error(
                "No contract template uploaded. Please upload it from the Underwriter dashboard.",
            );
            return;
        }

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
                setSelectedContractId(Number.isFinite(contractId) ? contractId : null);
            }
            if (applicationUuid) {
                void dispatch(getApplicationById(String(applicationUuid)));
            }
            const reopenedTemplate = await resolveContractTemplateForOpen(
                (contract as { funderName?: string | null } | undefined)?.funderName,
            );
            setPdfUrl(reopenedTemplate?.url ?? template.url);
            setPdfName(reopenedTemplate?.name ?? template.name);
            setPdfViewerInitialRightPaneTab("template");
            setPdfViewerOpen(true);
            toast.success("Contract reinitiated. Review and send the updated contract.");
        } catch (error: unknown) {
            const message =
                typeof error === "string"
                    ? error
                    : (error as { message?: string })?.message ||
                      "Failed to reinitiate contract.";
            toast.error(String(message));
        } finally {
            setRegeneratingContract(false);
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

        if (!applicationUuid) {
            toast.error("Missing application ID.");
            return;
        }

        const template = await resolveContractTemplateForOpen(
            (fetchedContract as { funderName?: string | null } | null)?.funderName,
        );
        if (!template?.url) {
            toast.error(
                "No contract template found for the selected funder. Upload the template in Settings or pick another funder.",
            );
            return;
        }

        const awaitingFreshContractAfterIsoApproval =
            needsContractReinitiation && isoApprovedUpdatedOffer;

        if (awaitingFreshContractAfterIsoApproval) {
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
                    setSelectedContractId(Number.isFinite(contractId) ? contractId : null);
                }
                if (applicationUuid) {
                    void dispatch(getApplicationById(String(applicationUuid)));
                }
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
        } else {
            // Re-open existing contract before any DB-mutating createContract call so a webhook-driven
            // status (SENT/VIEWED/SIGNED/COMPLETED) is never clobbered back to DRAFT by the upsert.
            const reopenedExisting = await tryOpenExistingDraftViewer();
            if (reopenedExisting) return;
        }

        const anyApp = applicationData as any;

        await persistContractPendingStage();

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
            const createRes = await dispatch(
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

            const createdContract =
                (createRes as { data?: Record<string, unknown> } | null)?.data ??
                (createRes as Record<string, unknown> | null);
            if (createdContract && typeof createdContract === "object") {
                setFetchedContract(createdContract);
                const createdId = Number((createdContract as { id?: unknown }).id);
                if (Number.isFinite(createdId) && createdId > 0) {
                    setSelectedContractId(createdId);
                }
            }

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
                const contract = (byApp as { data?: Record<string, unknown> } | null)?.data ?? byApp;
                if (contract && typeof contract === "object") {
                    setFetchedContract(contract);
                    const byAppContractId = Number((contract as { id?: unknown }).id);
                    setSelectedContractId(
                        Number.isFinite(byAppContractId) ? byAppContractId : null,
                    );
                }
            } catch {
                /* create response may already have set contract state */
            }
            const openTemplate = await resolveContractTemplateForOpen(
                (fetchedContract as { funderName?: string | null } | null)?.funderName ??
                    (createdContract as { funderName?: string | null } | undefined)?.funderName,
            );
            setPdfUrl(openTemplate?.url ?? template.url);
            setPdfName(openTemplate?.name ?? template.name);
            setPdfViewerInitialRightPaneTab("template");
            setPdfViewerOpen(true);
            toast.success("Contract generated. Review and send from the contract viewer.");
        } catch (error: unknown) {
            const message =
                typeof error === "string"
                    ? error
                    : (error as { response?: { data?: { message?: string } }; message?: string })
                          ?.response?.data?.message ||
                      (error as { message?: string })?.message ||
                      "Failed to create contract.";
            toast.error(String(message));
        } finally {
            setCreatingEnvelope(false);
        }
    };

    const getPrimaryRecipientEmail = () =>
        getSignerRecipientEmailForContract(applicationData, fetchedContract);

    const buildPrefillFields = () => {
        const fromContract = normalizeContractPrefillOverrides(
            (fetchedContract as { contractPrefillOverrides?: unknown } | null)?.contractPrefillOverrides,
        );
        const note = String((applicationData as { note?: string })?.note || "");
        const fromNote = parseNoteStructuredSection<Partial<BuildContractPrefillFieldsArgs>>(
            note,
            CONTRACT_PREFILL_OVERRIDES_SECTION,
        );
        const overrides = fromContract ?? fromNote ?? undefined;
        return buildContractPrefillFieldsFromApplication(applicationData, {
            agreementDate: formatDate(new Date()),
            contractRecords: selectedContractId ? contractPrefillRecords : undefined,
            overrides,
            offerDecision: (offerDecision as Record<string, unknown> | null) ?? null,
        });
    };

    const getPrimaryRecipientName = () =>
        getApplicationPrimaryRecipientName(applicationData);

    const runDocuSignEnvelope = async (
        sendPayload: {
            ccEmails: string[];
            supplementalLayoutKey?: string | null;
            supplementalDocumentRefs?: string[];
            /** When false, send supplemental layout only (e.g. standalone ACH authorization). */
            includeMainContract?: boolean;
            /** Current funder from contract modal (may not be persisted yet). */
            funderName?: string | null;
            /** CRM funder profile id — resolves funder-specific addendum PDFs. */
            funderProfileId?: string | null;
            /** Contract state from modal (may not be persisted yet). */
            contractState?: string | null;
            /** Main contract layout key (Katan vs Alliance Bridge). */
            mainContractLayoutKey?: string | null;
            /** CRM recipient overrides for this send (does not edit DocuSign template). */
            signerRoles?: DocuSignTemplateRolePayload[];
            /** Deal Review values from the contract modal (latest UI state). */
            prefillFields?: Array<{ id: string; value: string }>;
            /** Create Contract — which documents are in this envelope. */
            sendPackage?: ContractSendPackageSelection;
        },
        options: { autoSend: boolean; suppressSuccessToast?: boolean },
    ): Promise<{
        envelopeId: string;
        prefillTabsApplied?: number;
        prefillFieldCount?: number;
        sendUrl?: string | null;
        ccPrefilledEmail?: {
            emailed?: string[];
            skippedReason?: string;
        };
    }> => {
        const failDocuSignEnvelope = (message: string): never => {
            toast.error(message);
            throw new Error(message);
        };

        const includeMainContract = sendPayload.includeMainContract !== false;
        if (includeMainContract) {
            const mainTemplate = await resolveContractTemplateForOpen(
                sendPayload.funderName ??
                    (fetchedContract as { funderName?: string | null } | null)?.funderName,
            );
            if (!mainTemplate?.url || !applicationUuid) {
                failDocuSignEnvelope(
                    "No contract template found for the selected funder. Upload the template in Settings or pick another funder.",
                );
            }
        }
        if (!applicationUuid) {
            failDocuSignEnvelope("Application is required to send via DocuSign.");
        }

        const effectiveCcEmails = mergeContractCcEmailList(
            sendPayload.ccEmails,
            sendPayload.funderName ??
                (fetchedContract as { funderName?: string | null })?.funderName ??
                null,
            funders,
            String(
                sendPayload.contractState ??
                    (fetchedContract as { state?: string | null })?.state ??
                    contractStateForFunders ??
                    "",
            ).trim() || null,
        );
        const supplementalLayoutKey = String(sendPayload.supplementalLayoutKey ?? "").trim();
        const supplementalLayoutKeys = [
            ...new Set(
                [
                    supplementalLayoutKey,
                    ...(sendPayload.supplementalDocumentRefs ?? []),
                ]
                    .map((k) => String(k).trim())
                    .filter(Boolean),
            ),
        ];
        if (!includeMainContract && supplementalLayoutKeys.length === 0) {
            failDocuSignEnvelope(
                "Select at least one addendum or state disclosure to send without the main contract.",
            );
        }

        const isAchStandaloneSend =
            !includeMainContract &&
            supplementalLayoutKeys.length === 1 &&
            supplementalLayoutKeys[0] === DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION_STANDALONE;
        const sendPackageSelection: ContractSendPackageSelection | undefined =
            sendPayload.sendPackage ??
            (includeMainContract
                ? {
                      includeMainContract: true,
                      includeAddendum: Boolean(supplementalLayoutKey),
                      includeDisclosure: (sendPayload.supplementalDocumentRefs ?? []).length > 0,
                  }
                : isAchStandaloneSend
                  ? undefined
                  : {
                        includeMainContract: false,
                        includeAddendum: Boolean(supplementalLayoutKey),
                        includeDisclosure: (sendPayload.supplementalDocumentRefs ?? []).length > 0,
                    });

        const applicationSignerEmail = getPrimaryRecipientEmail().trim();
        const applicationSignerName = getPrimaryRecipientName();

        setCreatingEnvelope(true);
        try {
            const templateRoles = getPlatformSignerRoleRows();

            const savedSignerOverrides = parseContractSignerOverridesFromPrefill(
                (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                    ?.contractPrefillOverrides,
            );
            const savedAchSignerOverrides = isAchStandaloneSend
                ? parseAchSignerOverridesFromPrefill(
                      (fetchedContract as { contractPrefillOverrides?: unknown } | null)
                          ?.contractPrefillOverrides,
                  )
                : null;

            let roles: DocuSignTemplateRolePayload[] = sendPayload.signerRoles?.length
                ? sendPayload.signerRoles
                : isAchStandaloneSend && savedAchSignerOverrides?.length
                  ? buildDocuSignRolesFromEditorRows(savedAchSignerOverrides)
                  : savedSignerOverrides?.length
                    ? buildDocuSignRolesFromEditorRows(savedSignerOverrides)
                    : buildBoldSignRolesFromTemplateRecipients(
                          templateRoles,
                          applicationSignerEmail,
                          applicationSignerName,
                          { singleSignerOnly: false },
                      );

            const ownerRows = resolveOwnerRowsForContractPrefill(
                applicationForOwnerResolution,
                [...(Array.isArray(contractOwnerListState.data)
                    ? contractOwnerListState.data
                    : [])].sort((a, b) => {
                    const aT = new Date(String(a?.createdAt ?? 0)).getTime();
                    const bT = new Date(String(b?.createdAt ?? 0)).getTime();
                    return aT - bT;
                }),
            );
            const guarantorRows = Array.isArray(contractGuarantorListState.data)
                ? contractGuarantorListState.data
                : [];
            const ownerCount = resolveActiveOwnerCount({
                owners: ownerRows,
                guarantors: guarantorRows,
                signerRoles: roles,
            });
            const secondOwnerNameBeforeCollapse = resolveSecondOwnerSignerName(
                roles,
                ownerCount,
                ownerRows,
            );
            const rolesForContractSignerPersist = [...roles];
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
            let prefillFieldsPayload = buildPrefillFields().map((field) => ({
                id: field.id,
                value: field.value,
            }));
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
                        prefillFieldsPayload.push({ id, value });
                    }
                }
            }
            if (primarySignerEmail) {
                prefillFieldsPayload = prefillFieldsPayload.map((field) =>
                    field.id === "client_email" || field.id === "customer_email"
                        ? { ...field, value: primarySignerEmail }
                        : field,
                );
            }

            const redirectUrlDocusign = resolveDocuSignSenderReturnUrl();

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

            const merchantContext = resolveBalanceTransferMerchantContext(
                latestContract as Record<string, unknown>,
                applicationData,
            );
            const docuSignClientName =
                merchantContext.clientName.trim() ||
                applicationSignerName.trim() ||
                "Client";
            const docuSignBusinessName =
                merchantContext.businessName.trim() ||
                merchantContext.clientLegalName.trim() ||
                docuSignClientName;
            const docuSignEmailSubject = isAchStandaloneSend
                ? buildAchFormEnvelopeEmailSubject(docuSignBusinessName)
                : sendPackageSelection
                  ? buildPackageEnvelopeEmailSubject(
                        docuSignBusinessName,
                        sendPackageSelection,
                        approvedAmount,
                    )
                  : buildContractEnvelopeEmailSubject(docuSignBusinessName, approvedAmount);
            const docuSignEmailMessage = isAchStandaloneSend
                ? `Please review and sign the ACH authorization for ${docuSignBusinessName}.`
                : sendPackageSelection
                  ? buildPackageEnvelopeEmailMessage(docuSignBusinessName, sendPackageSelection)
                  : `Please review and sign your agreement with ${CONTRACT_ENVELOPE_LENDER_NAME}.`;

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
                resolveOwnerRowFullName(secondOwnerFromDb) ||
                secondOwnerNameBeforeCollapse ||
                String(roles[1]?.signerName || "").trim();
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

            let mainPrefillForTemplates: Partial<BuildContractPrefillFieldsArgs> | null = null;
            try {
                const contractNumericId = Number((latestContract as { id?: unknown })?.id);
                if (Number.isFinite(contractNumericId) && supplementalLayoutKeys.length > 0) {
                    const mapRes = await axiosGet(
                        `/contract/${contractNumericId}/document-template-mappings`,
                    );
                    const mapRows = (mapRes?.data?.data ?? []) as Array<{
                        id: string;
                        documentType?: string | null;
                        template?: {
                            id?: string;
                            templateId?: string;
                            name?: string | null;
                            state?: string | null;
                            frequency?: string | null;
                        } | null;
                    }>;
                    const rawOverrides = (latestContract as { contractPrefillOverrides?: unknown })
                        ?.contractPrefillOverrides;
                    const mainOverrides = normalizeContractPrefillOverrides(rawOverrides);
                    mainPrefillForTemplates = mainOverrides
                        ? (() => {
                              const o = { ...mainOverrides } as Record<string, unknown>;
                              delete o[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
                              return o as Partial<BuildContractPrefillFieldsArgs>;
                          })()
                        : null;
                    prefillFieldsPayload = applyDocumentTemplateMappingPrefillOverrides({
                        prefillFieldsPayload,
                        mergedTemplateIds: [],
                        mergedLayoutKeys: supplementalLayoutKeys,
                        templateMappingRows: Array.isArray(mapRows) ? mapRows : [],
                        contractPrefillOverridesRaw: rawOverrides,
                        contract: latestContract as Record<string, unknown>,
                        application: applicationData as unknown as Record<string, unknown>,
                        agreementDate: formatDate(new Date()),
                        mainPrefillOverrides: mainPrefillForTemplates,
                    });
                }
            } catch (mapErr) {
                console.warn("[ContractTab] document template mapping prefill skipped:", mapErr);
            }

            prefillFieldsPayload = mergeStateDisclosurePrefillFallback({
                payload: prefillFieldsPayload,
                supplementalRefs: supplementalLayoutKeys,
                contract: latestContract as Record<string, unknown>,
                application: applicationData as unknown as Record<string, unknown>,
                agreementDate: formatDate(new Date()),
                mainPrefillOverrides: mainPrefillForTemplates,
            });

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
                resolveLayoutKey(resolvedFunderName);
            const mergeRequest = {
                supplementalLayoutKeys,
                includeMainContract,
                mainContractLayoutKey,
                funderName: resolvedFunderName ? String(resolvedFunderName).trim() : undefined,
                funderProfileId: sendPayload.funderProfileId
                    ? String(sendPayload.funderProfileId).trim()
                    : undefined,
                contractState: contractStateForSend,
                sendPackage: sendPackageSelection,
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
                title: docuSignEmailSubject,
                message: docuSignEmailMessage,
                ccEmails: effectiveCcEmails,
                autoSend: options.autoSend,
                reminderSettings: {
                    enableAutoReminder: true,
                    reminderDays: 3,
                    reminderCount: 5,
                },
            };
            console.log(
                "[ContractTab] DocuSign layout send (contract PDF + optional addendum):",
                mergeRequest,
            );
            const sendResponse = await dispatch(
                mergeAndSendBoldSignTemplates(mergeRequest),
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

            let postSendContract: typeof latestContract = latestContract;
            try {
                const refreshedAfterSend = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                const c = (refreshedAfterSend as { data?: unknown })?.data ?? refreshedAfterSend;
                if (c) postSendContract = c;
            } catch {
                /* use latestContract */
            }

            const signerRowsToPersist = contractSignerRowsFromRolePayload(
                rolesForContractSignerPersist,
            );
            const contractNumericId = Number((postSendContract as { id?: unknown })?.id);
            if (signerRowsToPersist.length > 0 && Number.isFinite(contractNumericId)) {
                try {
                    const prefillBase =
                        (postSendContract as { contractPrefillOverrides?: unknown } | null)
                            ?.contractPrefillOverrides ?? null;

                    let contractPrefillOverrides: Record<string, unknown>;
                    if (isAchStandaloneSend) {
                        contractPrefillOverrides = mergeAchSignerOverridesIntoPrefill(
                            prefillBase,
                            signerRowsToPersist.map((row) => ({
                                role: row.role,
                                name: row.name,
                                email: row.email,
                            })),
                        );
                        contractPrefillOverrides = mergeAchAuthorizationDocuSignIntoPrefill(
                            contractPrefillOverrides,
                            {
                                envelopeId: String(documentId),
                                funderName:
                                    String(
                                        sendPayload.funderName ??
                                            resolvedFunderName ??
                                            "",
                                    ).trim() || null,
                            },
                        );
                    } else if (!includeMainContract && sendPackageSelection) {
                        contractPrefillOverrides = mergeContractPrefillWithSignerOverrides(
                            prefillBase,
                            signerRowsToPersist,
                        );
                        contractPrefillOverrides = mergeStandalonePackageDocuSignIntoPrefill(
                            contractPrefillOverrides,
                            {
                                envelopeId: String(documentId),
                                package: {
                                    includeMainContract: sendPackageSelection.includeMainContract,
                                    includeAddendum: sendPackageSelection.includeAddendum,
                                    includeDisclosure: sendPackageSelection.includeDisclosure,
                                },
                            },
                        );
                    } else {
                        contractPrefillOverrides = mergeContractPrefillWithSignerOverrides(
                            prefillBase,
                            signerRowsToPersist,
                        );
                    }

                    const primary = signerRowsToPersist[0];
                    const updated = await dispatch(
                        updateContract({
                            id: contractNumericId,
                            data: {
                                contractPrefillOverrides,
                                ...(includeMainContract
                                    ? {
                                          ...(primary?.email ? { clientEmail: primary.email } : {}),
                                          ...(primary?.name ? { clientName: primary.name } : {}),
                                      }
                                    : {}),
                            },
                        }),
                    ).unwrap();
                    const payload = (updated as { data?: unknown })?.data ?? updated;
                    postSendContract = {
                        ...(postSendContract as Record<string, unknown>),
                        ...(payload as Record<string, unknown>),
                        contractPrefillOverrides,
                    };
                    latestContract = postSendContract;
                    setFetchedContract(postSendContract);
                } catch (persistErr) {
                    console.warn("[ContractTab] persist contract signers failed:", persistErr);
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
            const mergeNote = supplementalLayoutKeys.length
                ? ` Contract${contractStateRaw ? ` (${contractStateRaw})` : ""} with ${supplementalLayoutKeys.length} supplemental document(s).`
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

            const ccEmailed = (
                sendResponse as { data?: { ccPrefilledEmail?: { emailed?: string[] } } }
            )?.data?.ccPrefilledEmail?.emailed;
            if (ccEmailed?.length && !options.suppressSuccessToast) {
                toast.success(`CC copy emailed to: ${ccEmailed.join(", ")}`);
            } else if (
                effectiveCcEmails.length > 0 &&
                !options.suppressSuccessToast &&
                (sendResponse as { data?: { ccPrefilledEmail?: { skippedReason?: string } } })
                    ?.data?.ccPrefilledEmail?.skippedReason === "smtp_not_configured"
            ) {
                toast.warning(
                    "CC list saved, but prefilled contract email was not sent. Configure SENDGRID_API_KEY or SMTP on the server.",
                    { autoClose: 10000 },
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
                beginSenderReturnStatusWatch();
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

            try {
                if (autoSent && documentId) {
                    await refreshSigningStatusesOnContractTab(true, { force: true });
                }
                const refreshed = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                const c = (refreshed as { data?: unknown })?.data ?? refreshed;
                if (c) setFetchedContract(c);
            } catch {
                /* table refresh is best-effort */
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
                ccPrefilledEmail: (
                    sendResponse as { data?: { ccPrefilledEmail?: { emailed?: string[] } } }
                )?.data?.ccPrefilledEmail,
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
            if (isBoldSignMissingSignerMessage(msg)) {
                toast.success("Contract sent successfully.");
                throw new Error(msg);
            }
            if (isBoldSignSendViewOptionPageViewError(msg)) {
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
        supplementalLayoutKey?: string | null;
        supplementalDocumentRefs?: string[];
        includeMainContract?: boolean;
        funderName?: string | null;
        funderProfileId?: string | null;
        contractState?: string | null;
        mainContractLayoutKey?: string | null;
        signerRoles?: DocuSignTemplateRolePayload[];
        prefillFields?: Array<{ id: string; value: string }>;
        sendPackage?: ContractSendPackageSelection;
    }) => {
        const result = await runDocuSignEnvelope(payload, {
            autoSend: false,
            suppressSuccessToast: true,
        });
        const envelopeId = String(result?.envelopeId ?? "").trim();
        if (!envelopeId) {
            throw new Error("DocuSign did not return an envelope ID after creating the draft.");
        }
        if (payload.includeMainContract !== false) {
            await persistContractGeneratedStage();
        }
        await reloadFetchedContract();
        if (applicationUuid) {
            void dispatch(getApplicationById(String(applicationUuid)));
        }
        const ccEmailed = result.ccPrefilledEmail?.emailed;
        if (ccEmailed?.length) {
            toast.success(`CC copy emailed to: ${ccEmailed.join(", ")}`);
        } else if (
            payload.ccEmails.length > 0 &&
            result.ccPrefilledEmail?.skippedReason === "smtp_not_configured"
        ) {
            toast.warning(
                "DocuSign draft is ready, but CC prefilled email was not sent. Configure SENDGRID_API_KEY or SMTP on the server.",
                { autoClose: 10000 },
            );
        }
        return {
            envelopeId,
            prefillTabsApplied: result.prefillTabsApplied,
            prefillFieldCount: result.prefillFieldCount,
            sendUrl: result.sendUrl ?? null,
        };
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

    const renderContractSendTableRow = (row: ContractSendTableRow) => {
        const isAchRow = row.rowType === "ach";
        const isPackageRow = row.rowType === "package";
        const isSupplementalRow = isAchRow || isPackageRow;
        const isPriorMainContractRow =
            row.rowType === "contract" &&
            (!row.isCurrent || (needsContractReinitiation && row.isCurrent));
        const rowTerms = row.termsSnapshot ?? null;
        const rowDisplayLabel =
            isPriorMainContractRow && !isSupplementalRow ? "Old Contract" : row.label;
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
        const rowCanViewDocument = Boolean(rowEnvelopeId) && !rowIsVoided;

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
                                className="h-3.5 w-3.5 shrink-0 text-[var(--brand)] dark:text-[#C07BE0]"
                                aria-hidden
                            />
                        )}
                        {rowDisplayLabel}
                    </span>
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : (rowTerms?.term ??
                              (rowTerms?.contractLength != null
                                  ? String(rowTerms.contractLength)
                                  : null) ??
                              fetchedContract?.offer?.term ??
                              "—")}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow ? "—" : (rowTerms?.position ?? "1")}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : formatContractCurrency(
                              rowTerms?.approvedAmount ?? fetchedContract?.approvedAmount,
                          )}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : formatContractCurrency(
                              rowTerms?.paybackAmount ??
                                  rowTerms?.totalAmount ??
                                  fetchedContract?.totalAmount ??
                                  fetchedContract?.offer?.totalRemit,
                          )}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : formatContractCurrency(
                              rowTerms?.paymentAmount ?? contractTableMetrics.perPeriodPayment,
                          )}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : rowTerms?.buyRate != null
                          ? `${rowTerms.buyRate}%`
                          : contractTableMetrics.buyRate}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : rowTerms?.percentOfGross != null
                          ? `${rowTerms.percentOfGross}%`
                          : contractTableMetrics.upsell}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {isSupplementalRow
                        ? "—"
                        : rowTerms?.factorRate != null
                          ? String(rowTerms.factorRate)
                          : contractTableMetrics.factor}
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
                                    {rowCanViewDocument ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                                isAchRow
                                                    ? void (row.isCurrent
                                                          ? handleViewAchDocument()
                                                          : handleViewSignedContract(rowEnvelopeId))
                                                    : void handleViewSignedContract(rowEnvelopeId)
                                            }
                                            disabled={isViewingRow}
                                            className={`h-7 w-7 shrink-0 ${isDark
                                                ? "text-[#C07BE0] hover:bg-[#C07BE0]/10"
                                                : "text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                                }`}
                                            title={
                                                isAchRow
                                                    ? rowFullySigned
                                                        ? "View signed ACH form"
                                                        : "View filled ACH form"
                                                    : isPackageRow
                                                      ? rowFullySigned
                                                          ? "View signed supplemental documents"
                                                          : "View supplemental documents"
                                                      : row.isCurrent
                                                        ? "View contract"
                                                        : "View prior generated contract"
                                            }
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
                                            className={`h-7 w-7 shrink-0 ${isDark
                                                ? "text-[#C07BE0] hover:bg-[#C07BE0]/10"
                                                : "text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                                }`}
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

    const renderGeneratedContractDraftRow = () => {
        const contract = fetchedContract as Record<string, unknown> | null;
        if (!contract) return null;

        const offer =
            contract.offer != null && typeof contract.offer === "object"
                ? (contract.offer as Record<string, unknown>)
                : null;
        const contractLength =
            parseMaybeNumber(contract.contractLenght) ??
            parseMaybeNumber(contract.contractLength) ??
            termLength;
        const draftStatusLabel = mainContractEnvelopeId
            ? formatContractTableStatusLabel(
                  contract.status,
                  contractEnvelopeDocument?.status,
                  true,
              )
            : "Generated";

        return (
            <TableRow key="generated-contract-draft" className={tableRowClass}>
                <TableCell className={tableCellClass}>
                    <span className="inline-flex items-center gap-1.5">
                        <FileText
                            className="h-3.5 w-3.5 shrink-0 text-[var(--brand)] dark:text-[#C07BE0]"
                            aria-hidden
                        />
                        Contract
                    </span>
                </TableCell>
                <TableCell className={tableCellClass}>
                    {offer?.term != null
                        ? String(offer.term)
                        : contractLength != null
                          ? String(contractLength)
                          : "—"}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {offer?.position != null ? String(offer.position) : "1"}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {formatContractCurrency(parseMaybeNumber(contract.approvedAmount))}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {formatContractCurrency(
                        parseMaybeNumber(contract.totalAmount) ??
                            parseMaybeNumber(offer?.totalRemit) ??
                            parseMaybeNumber(offer?.paybackAmount),
                    )}
                </TableCell>
                <TableCell className={tableCellClass}>
                    {formatContractCurrency(contractTableMetrics.perPeriodPayment)}
                </TableCell>
                <TableCell className={tableCellClass}>{contractTableMetrics.buyRate}</TableCell>
                <TableCell className={tableCellClass}>{contractTableMetrics.upsell}</TableCell>
                <TableCell className={tableCellClass}>{contractTableMetrics.factor}</TableCell>
                <TableCell>
                    <span className={statusBadgeClass}>{draftStatusLabel}</span>
                </TableCell>
                <TableCell
                    className={`${tableCellClass} text-xs tabular-nums whitespace-nowrap`}
                >
                    —
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

    const handleViewContract = async () => {
        if (!applicationUuid) {
            toast.error("Missing application ID.");
            return;
        }
        const opened = await tryOpenExistingDraftViewer();
        if (opened) return;
        if (mainContractEnvelopeId) {
            await handleViewSignedContract(mainContractEnvelopeId);
            return;
        }
        toast.info("No contract is available to view.");
    };

    const handlePrimaryContractAction = () => {
        if (!showRegenerateContractButton) {
            if (isReadOnly || hasGeneratedContract) {
                void handleViewContract();
                return;
            }
            void handleGenerateContract();
            return;
        }
        if (needsContractReinitiation && isoApprovedUpdatedOffer) {
            void handleGenerateContract();
            return;
        }
        void handleRegenerateContract();
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
                        {hasGeneratedContract && showRegenerateContractButton ? (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => void handleViewContract()}
                                disabled={
                                    creatingEnvelope ||
                                    regeneratingContract ||
                                    viewingSignedContract
                                }
                                className={`h-10 px-6 font-medium disabled:opacity-70 disabled:cursor-not-allowed ${isDark
                                    ? "border-[#C07BE0] text-[#C07BE0] hover:bg-[#C07BE0]/10"
                                    : "border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                    }`}
                            >
                                {viewingSignedContract ? (
                                    <span className="inline-flex items-center gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Opening contract...
                                    </span>
                                ) : (
                                    "View Contract"
                                )}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant="default"
                            onClick={handlePrimaryContractAction}
                            disabled={creatingEnvelope || regeneratingContract}
                            className="h-10 px-6 font-medium disabled:opacity-70 disabled:cursor-not-allowed"


                        >
                            {creatingEnvelope || regeneratingContract ? (
                                <span className="inline-flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {regeneratingContract
                                        ? "Reinitiating contract..."
                                        : "Generating contract..."}
                                </span>
                            ) : showRegenerateContractButton ? (
                                "Regenerate Contract"
                            ) : isReadOnly || hasGeneratedContract ? (
                                "View Contract"
                            ) : (
                                "Generate Contract"
                            )}
                        </Button>
                        <Button
                            type="button"
                            onClick={() =>
                                void openAchViewer(
                                    achAuthorizationDocuSign?.envelopeId
                                        ? "filled"
                                        : "template",
                                )
                            }
                            disabled={preparingAchViewer || creatingEnvelope}
                            variant="default"
                            className="h-10 px-6 font-medium disabled:opacity-70 disabled:cursor-not-allowed"
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

                    </div>
                </div>
            </div>

            <ReverseDisbursementScheduleSection
                contractId={selectedContractId}
                fetchedContract={
                    fetchedContract && typeof fetchedContract === "object"
                        ? (fetchedContract as Record<string, unknown>)
                        : null
                }
                readOnly={isReadOnly}
                isDark={isDark}
                onSaved={reloadFetchedContract}
            />

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
                            variant="default"
                            onClick={handleEditContractValues}
                            className="h-9 px-4 cursor-pointer"
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
                            variant="default"
                            onClick={handleSaveContractValues}
                            disabled={savingContractValues}
                            className="h-9 px-4"
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
                                renderGeneratedContractDraftRow() ?? (
                                    <TableRow className={tableRowClass}>
                                        <TableCell
                                            colSpan={11}
                                            className={`text-center py-8 ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                                        >
                                            No contracts generated yet.
                                        </TableCell>
                                    </TableRow>
                                )
                            ) : (
                                <TableRow className={tableRowClass}>
                                    <TableCell
                                        colSpan={11}
                                        className={`text-center py-8 ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                                    >
                                        No contracts generated yet.
                                    </TableCell>
                                </TableRow>
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

            <PDFViewerModal
                isOpen={pdfViewerOpen}
                onClose={() => {
                    setPdfViewerOpen(false);
                    setPdfViewerInitialRightPaneTab("template");
                    void reloadFetchedContract();
                }}
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

            <ACHViewerModal
                isOpen={achViewerOpen}
                onClose={() => {
                    setAchViewerOpen(false);
                    void reloadFetchedContract();
                }}
                contractId={selectedContractId}
                applicationId={applicationUuid ? String(applicationUuid) : null}
                applicationData={applicationData}
                fetchedContract={
                    fetchedContract && typeof fetchedContract === "object"
                        ? (fetchedContract as Record<string, unknown>)
                        : null
                }
                initialPdfTab={achViewerInitialTab}
                readOnly={isReadOnly}
                onPrepareDocuSignDraft={
                    isReadOnly ? undefined : (payload) => prepareDocuSignDraft(payload)
                }
                onReloadContract={reloadFetchedContract}
            />
        </div>
    );
}
