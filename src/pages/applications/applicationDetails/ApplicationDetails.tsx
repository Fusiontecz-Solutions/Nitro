import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import ApplicationSummary from "@/components/application/ApplicationSummary";
import ApplicationBasicDetails from "@/components/application/ApplicationBasicDetails";
import CommentSection from "@/components/application/CommentSection";
import UploadedDocuments from "@/components/application/UploadedDocuments";
import Approval from "@/components/application/Approval";
import RequiredDocument from "@/components/application/RequiredDocument";
import BankAnalysisTable from "@/components/application/BankAnalysisTable";
import BankAnalysis from "@/components/application/BankAnalysis";
import ChecksAndDecision from "@/components/application/ChecksAndDecision";
import ContractTab from "@/components/application/ContractTab";
import ComplianceChecks from "@/components/application/ComplianceChecks";
import DecisionMakeFinalValues from "@/components/application/DecisionMakeFinalValues";
import EligibilityAnalysis from "@/components/application/EligibilityAnalysis";

import { CasesDashboard } from "@/pages/case/CasesDashboard";
import { EXTERNAL_LINKS } from "@/config/externalLinks";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import {
  getApplicationByApplicationId,
  getApplicationById,
  updateApplicationQueue,
  claimUnderwriterDeal,
} from "@/redux/actions/applicationActions";
import {
  isNumericApplicationRouteParam,
  routeParamMatchesApplication,
} from "@/lib/applicationRouteMatch";
import { clearApplicationDetail } from "@/redux/slices/applicationSlice";
import { useTheme } from "@/context/ThemeContext";
import type { user } from "@/redux/slices/authSlice";
import { toast } from "react-toastify";
import { Final } from "@/pages/case/Final";
import { FundingCall } from "@/pages/case/FundingCall";
import { Disbursement } from "@/pages/case/Disbursment";
import { useTabRouting } from "@/hooks/useTabRouting";
import {
  inferOperationsListStatusFromApplication,
  normalizeOperationsDashboardStatusParam,
  OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
} from "@/constants/operationsDashboardApplications";
import { getOperationsTabsForDashboardEntry } from "@/constants/operationsPipelineTabs";
import { useTabAccess } from "@/hooks/useTabAccess.ts";
import FinalUnderwriterApplicationSummary from "@/components/application/FinalUnderwriterApplicationSummary";
import ApplicationSheetActivityLog from "@/components/application/ApplicationSheetActivityLog";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";


const ApplicationDetails = () => {
    const { applicationId } = useParams<{ applicationId: string; tab?: string }>()
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [sendingToUnderwriter, setSendingToUnderwriter] = useState(false);
    const [agentSentToUnderwriter, setAgentSentToUnderwriter] = useState(false);
    const [claimingDeal, setClaimingDeal] = useState(false);
    const [auditLogOpen, setAuditLogOpen] = useState(false);
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    const dispatch = useDispatch<AppDispatch>();
    
    const [user, setUser] = useState<user>()
    const { loading, data } = useSelector((state: RootState) => state.login)

    const {
        loading: applicationDetailLoading,
        data: applicationData,
        error: applicationDetailError,
    } = useSelector((state: RootState) => state.applicationDetail);

    // Removed debug logging to avoid slowing down render on tab refresh.





    const status = (applicationData as any)?.currentState || (applicationData as any)?.status;
    const queue = (applicationData as any)?.currentQueue || (applicationData as any)?.queue;
    const explicitStatus = (applicationData as any)?.status;
    const currentState = (applicationData as any)?.currentState as string | undefined;
    const statsCurrentState = (applicationData as any)?.statsCurrentState as string | undefined;
    const applicationUuid = (applicationData as any)?._id ?? (applicationData as any)?.id ?? null;
    /** Same Mongo id the preview sheet uses for `/applications/:id/activity-logs`. */
    const activityLogApplicationId =
        applicationUuid != null ? String(applicationUuid) : "";

    
    const resolvedApplicationId =
        (applicationData as any)?.applicationId ??
        (applicationData as any)?._id ??
        applicationId ??
        null;

    useEffect(() => {
        setUser(data?.user)
        if (!data?.user) {
        const storedUser = localStorage.getItem('user')
        if (storedUser) {
            setUser(JSON.parse(storedUser))
        }
        }
    }, [data, loading])

    const userRole = user?.role || localStorage.getItem('role') || ''
    const roleKey = String(userRole || "").replace(/-/g, "_").toUpperCase();
    const isSuperAdmin =
        roleKey === "SUPER_ADMIN" || roleKey === "SUPERADMIN";
    const isFundingUploaderRole =
        roleKey === "SUPER_ADMIN" ||
        roleKey === "SUPERADMIN" ||
        roleKey === "UNDERWRITER" ||
        roleKey === "FINAL_UNDERWRITER";
    const isUnderwriter = roleKey === 'UNDERWRITER' || roleKey === 'FINAL_UNDERWRITER';
    const isFinalUnderwriter = roleKey === 'FINAL_UNDERWRITER';
    const isAgent = roleKey === 'AGENT';
    const hideBusinessProfileOnDecisionMakingTab =
        roleKey === "UNDERWRITER" ||
        roleKey === "OPERATIONS" ||
        roleKey === "SUPER_ADMIN" ||
        roleKey === "SUPERADMIN";

    /** Same normalization as `queueKey` below — used before `normalizeWorkflowToken` is declared. */
    const uwQueueNormForClaim =
        typeof queue === "string" ? queue.trim().toLowerCase().replace(/\s+/g, " ") : "";
    const viewerUserId = String(
        user?._id ?? (user as { id?: string } | undefined)?.id ?? "",
    ).trim();
    const claimedByUnderwriterId =
        (applicationData as { claimedByUnderwriterId?: string | null } | null)?.claimedByUnderwriterId ??
        null;
    /** Primary underwriter in Underwriter queue: no other tabs or edits until claimed. */
    const underwriterQueueLocked =
        roleKey === "UNDERWRITER" &&
        uwQueueNormForClaim === "underwriter" &&
        (!claimedByUnderwriterId ||
            String(claimedByUnderwriterId) !== viewerUserId);
    /** Operations + Super Admin use the same funding-pipeline tab strip and `?operationsStatus=` depth rules. */
    const useOperationsPipelineTabs =
        roleKey === 'OPERATIONS' ||
        roleKey === 'SUPER_ADMIN' ||
        roleKey === 'SUPERADMIN';

    const operationsStatusQueryRaw = searchParams.get("operationsStatus");
    const operationsEntryStatus = useMemo(
        () =>
            normalizeOperationsDashboardStatusParam(operationsStatusQueryRaw),
        [operationsStatusQueryRaw],
    );

    const applicationAligned = Boolean(
        applicationId &&
            applicationData &&
            routeParamMatchesApplication(applicationId, applicationData),
    );

    /**
     * URL `operationsStatus` wins when set to a known stage.
     * Otherwise infer from the loaded app (e.g. deep link from Operations dashboard with a hint).
     *
     * OPERATIONS opening from the main Applications list (no stage query, or `all`) should see the
     * full tab strip including Final / Funding / Disbursement; early tabs stay read-only via
     * `isOperationsReadOnlyPipelineTab`.
     */
    const effectiveOperationsStatus = useMemo(() => {
        if (!useOperationsPipelineTabs) return null;
        const trimmedOpsStatus = operationsStatusQueryRaw?.trim() ?? "";
        const operationsOpenedWithoutStageFilter =
            roleKey === "OPERATIONS" &&
            (!trimmedOpsStatus ||
                trimmedOpsStatus.toLowerCase() ===
                    OPERATIONS_APPLICATIONS_LIST_ALL_QUERY);
        if (operationsOpenedWithoutStageFilter) {
            return null;
        }
        if (operationsEntryStatus) return operationsEntryStatus;
        if (!applicationAligned) return null;
        return inferOperationsListStatusFromApplication(queue, {
            explicitStatus,
            currentState,
        });
    }, [
        useOperationsPipelineTabs,
        roleKey,
        operationsStatusQueryRaw,
        operationsEntryStatus,
        applicationAligned,
        queue,
        explicitStatus,
        currentState,
    ]);

    const handleSummaryMetricsChange = useCallback(
        (_payload: {
            activePositions: number;
            existingLeveragePct: number;
            totalLeveragePct: number;
            loading: boolean;
        }) => {
            // Reserved for future header metrics; DecisionMakeFinalValues still reports totals.
        },
        []
    );

    // Determine tabs based on status and user role
    const getTabs = () => {
        const isCompleted = status?.toLowerCase() === 'completed';
        const isApprovedStatus = explicitStatus?.toLowerCase() === 'approved';
        const isApprovedQueue = typeof queue === 'string' && queue.toLowerCase() === 'approved';
        const queueNorm = typeof queue === 'string' ? queue.trim().toLowerCase() : '';
        const isSentToFinalUnderwriter =
            queueNorm === 'final review' || queueNorm === 'final underwriter';
        /** After "Generate contract", queue moves here — keep CONTRACT tab so FUW is not locked out. */
        const isContractedQueue =
            queueNorm === 'contracted' ||
            queueNorm === 'contract out' ||
            queueNorm === 'contracts out';
        // const stateNorm =
        //     typeof currentState === 'string' ? currentState.trim().toLowerCase() : '';
        // const isApprovedCurrentState =
        //     stateNorm === 'approved' ||
        //     stateNorm === 'completed' ||
        //     stateNorm === 'contracted';

        // FINAL_UNDERWRITER: always expose both workflow tabs.
        if (isFinalUnderwriter) {
            return [
                { id: "eligibility-analysis", label: "ELIGIBILITY ANALYSIS" },
                { id: "overview", label: "DECISION MAKING" },
            ];
        }
        
        // Primary UNDERWRITER (not Final UW): overview-only until the deal is claimed in Underwriter queue
        if (roleKey === "UNDERWRITER") {
            if (underwriterQueueLocked) {
                return [{ id: "overview", label: "OVERVIEW" }];
            }
            return [
                { id: "overview", label: "OVERVIEW" },
                { id: "documents", label: "DOCUMENTS" },
                { id: "bank-analysis", label: "BANK ANALYSIS" },
                { id: "checks", label: "CHECKS" },
                { id: "decision-making", label: "DECISION MAKING" },
            ];
        }
        
        // For non-underwriter users:
        // - Before sending to Final Underwriter: show only first two tabs (Overview, Documents)
        // - After sending (queue === "Final Review") or when Completed or when status/queue indicate Approved: show all four tabs
        if (
            isCompleted ||
            isSentToFinalUnderwriter ||
            isApprovedStatus ||
            isApprovedQueue ||
            isContractedQueue
        ) {
            return [
                { id: "overview", label: "OVERVIEW" },
                { id: "documents", label: "DOCUMENTS" },
                { id: "approval", label: "APPROVAL" },
                { id: "contract", label: "CONTRACT" },
            ];
        }
        
        return [
            { id: "overview", label: "OVERVIEW" },
            { id: "documents", label: "DOCUMENTS" },
        ];
    };

    const tabs = useMemo(() => {
        let list: { id: string; label: string }[];
        if (useOperationsPipelineTabs) {
            list = getOperationsTabsForDashboardEntry(effectiveOperationsStatus);
        } else {
            list = getTabs();
        }
        if (roleKey === "OPERATIONS") {
            list = list.filter((t) => t.id !== "bank-analysis");
        }
        return list;
    }, [
        effectiveOperationsStatus,
        useOperationsPipelineTabs,
        status,
        explicitStatus,
        queue,
        currentState,
        isFinalUnderwriter,
        isUnderwriter,
        roleKey,
        underwriterQueueLocked,
    ]);

    const defaultTabForRouting = useMemo(
        () => tabs[0]?.id ?? "overview",
        [tabs],
    );

    const isLoadingCurrentApplication =
        !applicationId ||
        applicationDetailLoading ||
        (!!applicationData &&
            !routeParamMatchesApplication(applicationId, applicationData)) ||
        (!applicationData &&
            !applicationDetailError &&
            !applicationDetailLoading);

    const showApplicationLoadError =
        Boolean(applicationDetailError) &&
        !applicationDetailLoading &&
        (!applicationData ||
            !routeParamMatchesApplication(applicationId, applicationData));

    const isTabsReady = !isLoadingCurrentApplication && !showApplicationLoadError;

    const refetchApplicationDetail = useCallback(() => {
        if (!applicationId) return;
        if (isNumericApplicationRouteParam(applicationId)) {
            void dispatch(getApplicationByApplicationId(applicationId));
        } else {
            void dispatch(getApplicationById(applicationId));
        }
    }, [applicationId, dispatch]);

    const handleClaimUnderwriterDeal = useCallback(async () => {
        if (!applicationUuid || !underwriterQueueLocked) return;
        setClaimingDeal(true);
        const toastId = toast.loading("Claiming deal…");
        try {
            await dispatch(
                claimUnderwriterDeal({ applicationId: String(applicationUuid) }),
            ).unwrap();
            toast.update(toastId, {
                render: "Deal claimed — you can continue underwriting.",
                type: "success",
                isLoading: false,
                autoClose: 2500,
            });
            refetchApplicationDetail();
        } catch (err: unknown) {
            const msg =
                (err as { message?: string })?.message ||
                "Could not claim this deal. It may already be claimed by someone else.";
            toast.update(toastId, {
                render: msg,
                type: "error",
                isLoading: false,
                autoClose: 4000,
            });
        } finally {
            setClaimingDeal(false);
        }
    }, [
        applicationUuid,
        dispatch,
        refetchApplicationDetail,
        underwriterQueueLocked,
    ]);

    const { activeTab, handleTabChange } = useTabRouting(
        tabs,
        applicationId,
        defaultTabForRouting,
        { isTabsReady, clampInvalidUrlTab: true },
    );

    /** OPERATIONS: no uploads/edits from overview through contract (later tabs unchanged). */
    const OPERATIONS_READ_ONLY_PIPELINE_TAB_IDS = useMemo(
        () =>
            new Set([
                "overview",
                "documents",
                "bank-analysis",
                "decision-making",
                "contract",
                "approval",
            ]),
        [],
    );
    const isWorkflowRole =
        roleKey === "AGENT" ||
        roleKey === "UNDERWRITER" ||
        roleKey === "FINAL_UNDERWRITER";
    const isViewOnlyBrowse =
        searchParams.get("viewOnly") === "1" && !isWorkflowRole;
    const isOperationsReadOnlyPipelineTab =
        (roleKey === "OPERATIONS" &&
            OPERATIONS_READ_ONLY_PIPELINE_TAB_IDS.has(activeTab)) ||
        isViewOnlyBrowse;
    /** Overview → contract (inclusive): no edits for Operations / view-only browse / unclaimed UW deal. */
    const pipelineStageReadOnly =
        isOperationsReadOnlyPipelineTab || isViewOnlyBrowse || underwriterQueueLocked;
    /** OPERATIONS may comment; block composer for view-only browse or unclaimed Underwriter deal. */
    const commentsReadOnly = isViewOnlyBrowse || underwriterQueueLocked;
    const disableDecisionMakingFundingUpload =
        isViewOnlyBrowse || !isFundingUploaderRole;
    const normalizeWorkflowToken = (value: unknown) =>
        String(value ?? "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    const queueKey = normalizeWorkflowToken(queue);
    const stateNorm = normalizeWorkflowToken(
        currentState || status || statsCurrentState || "",
    );
    /** Past agent intake — do not offer "Send to Underwriter". (Do not include `review`; backend still treats Review as agent-side.) */
    const postAgentIntakeQueues = new Set([
        "underwriter",
        "underwriting",
        "final review",
        "final underwriter",
        "approved",
        "contracted",
        "contract out",
        "contracts out",
        "funding call",
        "disbursment",
        "disbursement",
        "funded",
        "final",
    ]);
    const isPastAgentIntakeQueue = postAgentIntakeQueues.has(queueKey);
    const agentIntakeQueues = new Set(["new", "agent", "on hold", "review", ""]);
    const pendingLikeState =
        stateNorm === "pending" ||
        stateNorm === "draft";
    const isPreUnderwriterStage =
        !isPastAgentIntakeQueue &&
        (agentIntakeQueues.has(queueKey) || pendingLikeState);
    const canActSendToUnderwriter =
        roleKey === "AGENT" ||
        roleKey === "ADMIN" ||
        roleKey === "SUPER_ADMIN" ||
        roleKey === "OPERATIONS";
    const canShowSendToUnderwriterButton =
        canActSendToUnderwriter &&
        !isViewOnlyBrowse &&
        isPreUnderwriterStage &&
        !agentSentToUnderwriter;

    const changeTabScrollTop = useCallback(
        (tabId: string) => {
            handleTabChange(tabId);
            requestAnimationFrame(() => {
                window.scrollTo({ top: 0, left: 0, behavior: "auto" });
            });
        },
        [handleTabChange],
    );

    const { isAllowed, fallbackComponent } = useTabAccess(tabs, activeTab);
    const canRenderTabContent = isTabsReady && isAllowed;
    const showAccessDenied = isTabsReady && !isAllowed;

    const tabStepFooter = useMemo(() => {
        if (!canRenderTabContent || tabs.length < 2) return null;
        const idx = tabs.findIndex((t) => t.id === activeTab);
        if (idx < 0) return null;
        const prevTab = idx > 0 ? tabs[idx - 1] : null;
        const nextTab = idx < tabs.length - 1 ? tabs[idx + 1] : null;
        return (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6">
                <Button
                    type="button"
                    variant="outline"
                    className="min-w-[8rem]"
                    disabled={!prevTab}
                    onClick={() => prevTab && changeTabScrollTop(prevTab.id)}
                >
                    <ChevronLeft className="mr-1 h-4 w-4 shrink-0" aria-hidden />
                    Back
                </Button>
                <Button
                    type="button"
                    variant="default"
                    className="min-w-[8rem] bg-[#151357] text-white shadow-sm hover:bg-[#151357]/90 disabled:opacity-40 dark:bg-[#6BB8EA] dark:hover:bg-[#52A6DF] dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
                    disabled={!nextTab}
                    onClick={() => nextTab && changeTabScrollTop(nextTab.id)}
                >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4 shrink-0" aria-hidden />
                </Button>
            </div>
        );
    }, [canRenderTabContent, tabs, activeTab, changeTabScrollTop]);

    // Fetch application data when in edit mode.
    // Guard against redundant network calls (helps refresh/navigation latency).
    const applicationDetailRef = useRef(applicationData);
    useEffect(() => {
        applicationDetailRef.current = applicationData;
    }, [applicationData]);

    useEffect(() => {
        setAuditLogOpen(false);
    }, [applicationId]);

    useEffect(() => {
        setAgentSentToUnderwriter(false);
    }, [applicationId]);

    useEffect(() => {
        if (!applicationId) return;

        const currentData = applicationDetailRef.current;
        const shouldFetch =
            !currentData ||
            !routeParamMatchesApplication(applicationId, currentData);
        if (shouldFetch) {
            if (isNumericApplicationRouteParam(applicationId)) {
                dispatch(getApplicationByApplicationId(applicationId));
            } else {
                dispatch(getApplicationById(applicationId));
            }
        }

        return () => {
            dispatch(clearApplicationDetail());
        };
    }, [applicationId, dispatch]);

    const handleSendToUnderwriter = async () => {
        if (!applicationUuid) return;
        setSendingToUnderwriter(true);
        const toastId = toast.loading("Sending application to Underwriter...");
        try {
            await dispatch(
                updateApplicationQueue({
                    id: applicationUuid,
                    data: { currentQueue: "Underwriter" },
                }),
            ).unwrap();
            setAgentSentToUnderwriter(true);
            toast.update(toastId, {
                render: "Application has been sent to Underwriter.",
                type: "success",
                isLoading: false,
                autoClose: 2500,
            });
            refetchApplicationDetail();
        } catch (error) {
            console.error("Failed to send application to Underwriter:", error);
            toast.update(toastId, {
                render: "Failed to send application to Underwriter. Please try again.",
                type: "error",
                isLoading: false,
                autoClose: 4000,
            });
        } finally {
            setSendingToUnderwriter(false);
        }
    };




    const externalLinksRow = (
        <div className="flex items-center gap-6 flex-wrap">
            {isSuperAdmin && activityLogApplicationId ? (
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAuditLogOpen((open) => !open)}
                    aria-expanded={auditLogOpen}
                    aria-haspopup="dialog"
                    aria-pressed={auditLogOpen}
                    className="group shrink-0 gap-2 rounded-full border border-[#151357]/30 bg-gradient-to-b from-[#151357]/[0.1] to-[#151357]/[0.04] px-4 py-2 text-sm font-semibold text-[#151357] shadow-sm transition-all hover:border-[#151357]/45 hover:from-[#151357]/15 hover:to-[#151357]/08 hover:shadow-md active:scale-[0.98] dark:border-primary/35 dark:from-primary/20 dark:to-primary/8 dark:text-foreground dark:hover:border-primary/50"
                >
                    <ScrollText
                        className="h-4 w-4 shrink-0 opacity-90 transition-transform group-hover:scale-105"
                        aria-hidden
                    />
                    Audit log
                </Button>
            ) : null}
            {EXTERNAL_LINKS.map((link, i) => (
                <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col"
                >
                    <span className="text-sm font-semibold text-[#3B8BD1] underline">
                        {link.label}
                    </span>
                    <span className="text-xs text-[#687182]">
                        {i === 0 ? "Link" : "Link"}
                    </span>
                </a>
            ))}
        </div>
    );

    return (
        <div className="min-h-screen bg-background p-4 md:p-6">
            <div className="max-w-screen-2xl mx-auto">
                {isFinalUnderwriter ? (
                    /* FINAL_UNDERWRITER: 1) Tab row (tabs + links) 2) Application Summary below tabs 3) Tab content */
                    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                        {/* Row 1: Tabs (left) + Links (right) */}
                        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                            <TabsList className="bg-transparent cursor-pointer p-0 h-auto flex items-center w-full max-w-max">
                                {tabs.map((tab, index) => {
                                    const isActive = activeTab === tab.id;
                                    const isFirst = index === 0;
                                    const isLast = index === tabs.length - 1;
                                    const zIndex = isActive ? 10 : 2 - index;
                                    const clipPath = isFirst
                                        ? "polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%)"
                                        : isLast
                                            ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 18px 50%)"
                                            : "polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%, 18px 50%)";
                                    const triggerClip = isFirst
                                        ? "polygon(0 0, calc(100% - 20px) 0, calc(100% - 2px) 50%, calc(100% - 20px) 100%, 0 100%)"
                                        : isLast
                                            ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 20px 50%)"
                                            : "polygon(0 0, calc(100% - 20px) 0, calc(100% - 2px) 50%, calc(100% - 20px) 100%, 0 100%, 20px 50%)";
                                    return (
                                        <div key={tab.id} className="relative" style={{ marginLeft: isFirst ? 0 : -18, zIndex }}>
                                            <div className={`absolute inset-0 ${isDark ? 'bg-gray-600' : 'bg-white'}`} style={{ clipPath }} />
                                            <TabsTrigger
                                                value={tab.id}
                                                className="relative cursor-pointer px-8 py-2.5 text-sm font-bold border-0 shadow-none rounded-none"
                                                style={{
                                                    backgroundColor: isActive ? '#151357' : '#E8E9EC80',
                                                    color: isActive ? '#FFFFFF' : '#000000',
                                                    clipPath: triggerClip,
                                                }}
                                            >
                                                {tab.label}
                                            </TabsTrigger>
                                        </div>
                                    );
                                })}
                            </TabsList>
                            {externalLinksRow}
                        </div>
                        {/* Row 2: Application Summary (same five-column layout as all roles) */}
                        <FinalUnderwriterApplicationSummary
                            applicationId={applicationId}
                            onBack={() => navigate(-1)}
                        />
                        {/* Row 3: Tab content (Decision Making or Contract) */}
                        {canRenderTabContent ? (
                            <>
                                <TabsContent value="eligibility-analysis" className="mt-6">
                                    <EligibilityAnalysis />
                                </TabsContent>
                                <TabsContent value="overview" className="mt-6">
                                    {/* Final Underwriter decision-making view (without duplicate ApplicationSummary) */}
                                    <ApplicationBasicDetails applicationId={applicationId} />
                                    <RequiredDocument
                                        isDecisionMaking={true}
                                        readOnly={isViewOnlyBrowse}
                                        disableFundingUpload={
                                            disableDecisionMakingFundingUpload
                                        }
                                    />
                                    <div className="mt-10">
                                        <DecisionMakeFinalValues
                                            applicationId={applicationId}
                                            allowOfferEdit
                                            allowPositionsEdit
                                            onSummaryMetricsChange={handleSummaryMetricsChange}
                                            betweenOfferAndPositions={
                                                <BankAnalysisTable disableDelete disableCreate />
                                            }
                                        />
                                    </div>
                                    <div className="flex flex-row gap-4 w-full mt-10 items-stretch">
                                        <ChecksAndDecision
                                            isFinalUnderwriter={true}
                                            onProceedToContract={() => handleTabChange("contract")}
                                        />
                                        <div className="w-[50%]"><CommentSection readOnly={commentsReadOnly} /></div>
                                    </div>
                                </TabsContent>
                                <TabsContent value="contract" className="mt-6">
                                    <ContractTab readOnly />
                                </TabsContent>
                            </>
                        ) : showAccessDenied ? (
                            fallbackComponent
                        ) : showApplicationLoadError ? (
                            <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-10 text-center shadow-[0px_4px_20px_0px_rgba(0,0,0,0.06)] dark:shadow-[0px_4px_24px_0px_rgba(0,0,0,0.35)]">
                                <p className="text-sm font-medium text-destructive">
                                    {applicationDetailError}
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="mt-4"
                                    onClick={refetchApplicationDetail}
                                >
                                    Try again
                                </Button>
                            </div>
                        ) : (
                            <div className="mt-6 flex items-center justify-center rounded-lg border border-border bg-card p-10 shadow-[0px_4px_20px_0px_rgba(0,0,0,0.06)] dark:shadow-[0px_4px_24px_0px_rgba(0,0,0,0.35)]">
                                <div className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                                    <span className="inline-block h-4 w-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
                                    Loading application details...
                                </div>
                            </div>
                        )}
                        {tabStepFooter}
                    </Tabs>
                ) : null}
                {!isFinalUnderwriter && (
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                    <TabsList className="bg-transparent cursor-pointer p-0 h-auto flex items-center">
                        {tabs.map((tab, index) => {
                            const isActive = activeTab === tab.id;
                            const isFirst = index === 0;
                            const isLast = index === tabs.length - 1;

                            // Calculate z-index - active tab should be on top, earlier tabs have higher z-index
                            const zIndex = isActive ? 10 : tabs.length - index;

                            // ClipPath for the tab shape
                            const clipPath = isFirst
                                ? "polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%)"
                                : isLast
                                    ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 18px 50%)"
                                    : "polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%, 18px 50%)";

                            return (
                                <div
                                    key={tab.id}
                                    className="relative"
                                    style={{
                                        marginLeft: isFirst ? "0" : "-18px",
                                        zIndex: zIndex,
                                    }}
                                >
                                    {/* Border wrapper */}
                                    <div
                                        className={`absolute inset-0 ${isDark ? 'bg-gray-600' : 'bg-white'}`}
                                        style={{
                                            clipPath: clipPath,
                                        }}
                                    />
                                    {/* Tab content with slight inset to show border */}
                                    <TabsTrigger
                                        value={tab.id}
                                        className="relative cursor-pointer px-8 py-2 text-sm font-bold border-0 shadow-none transition-all duration-200 rounded-none"
                                        style={{
                                            backgroundColor: isDark
                                                ? (isActive ? '#5AACEA' : '#374151')
                                                : (isActive ? '#151357' : '#E8E9EC80'),
                                            color: isDark
                                                ? '#FFFFFF'
                                                : (isActive ? '#FFFFFF' : '#000000'),
                                            clipPath: isFirst
                                                ? "polygon(0 0, calc(100% - 20px) 0, calc(100% - 2px) 50%, calc(100% - 20px) 100%, 0 100%)"
                                                : isLast
                                                    ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 20px 50%)"
                                                    : "polygon(0 0, calc(100% - 20px) 0, calc(100% - 2px) 50%, calc(100% - 20px) 100%, 0 100%, 20px 50%)",
                                        }}
                                    >
                                        {tab.label}
                                    </TabsTrigger>
                                </div>
                            );
                        })}
                    </TabsList>
                    {externalLinksRow}
                    </div>

                    {canRenderTabContent ? (
                        <>
                            <TabsContent value="overview" className="mt-6">
                                <>
                                    {underwriterQueueLocked ? (
                                        <div className="mb-6 rounded-lg border border-amber-500/35 bg-amber-500/10 p-4 dark:border-amber-400/25 dark:bg-amber-500/15">
                                            <p className="text-sm font-semibold text-foreground">
                                                Claim this deal to continue
                                            </p>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Until you claim it, only this overview is available — no documents,
                                                bank analysis, checks, or decision-making. Another underwriter may have
                                                already claimed it from the queue.
                                            </p>
                                            <Button
                                                type="button"
                                                className="mt-4 bg-[#151357] text-white hover:bg-[#151357]/90 dark:bg-[#6BB8EA] dark:hover:bg-[#52A6DF]"
                                                disabled={
                                                    claimingDeal ||
                                                    !applicationUuid ||
                                                    !viewerUserId
                                                }
                                                onClick={() => void handleClaimUnderwriterDeal()}
                                            >
                                                {claimingDeal ? "Claiming…" : "Claim deal"}
                                            </Button>
                                        </div>
                                    ) : null}
                                    <ApplicationSummary applicationId={applicationId} onBack={() => navigate(-1)} />
                                    <ApplicationBasicDetails applicationId={applicationId} />
                                    {canShowSendToUnderwriterButton ? (
                                        <div className="flex justify-end mb-4">
                                            <Button
                                                type="button"
                                                onClick={handleSendToUnderwriter}
                                                disabled={sendingToUnderwriter}
                                                className="bg-[#3B8BD1] hover:bg-[#3B8BD1] text-white mt-4 px-4 py-2 text-sm font-medium rounded-md cursor-pointer disabled:opacity-40"
                                            >
                                                {sendingToUnderwriter ? "Sending..." : "Send to Underwriter"}
                                            </Button>
                                        </div>
                                    ) : null}
                                    <div className="mt-6">
                                        <CommentSection
                                            isUnderwriter={isUnderwriter}
                                            readOnly={commentsReadOnly}
                                        />
                                    </div>
                                </>
                            </TabsContent>

                            <TabsContent value="documents" className="mt-6">
                                <ApplicationSummary applicationId={applicationId} onBack={() => navigate(-1)} />
                                
                                <UploadedDocuments readOnly={isOperationsReadOnlyPipelineTab} />
                                {canShowSendToUnderwriterButton ? (
                                    <div className="flex justify-end mb-4">
                                        <Button
                                            type="button"
                                            onClick={handleSendToUnderwriter}
                                            disabled={sendingToUnderwriter}
                                            className="bg-[#3B8BD1] hover:bg-[#3B8BD1] text-white mt-4 px-4 py-2 text-sm font-medium rounded-md cursor-pointer disabled:opacity-40"
                                        >
                                            {sendingToUnderwriter ? "Sending..." : "Send to Underwriter"}
                                        </Button>
                                    </div>
                                ) : null}
                                <div className="mt-6"><CommentSection readOnly={commentsReadOnly} /></div>
                            </TabsContent>

                            <TabsContent value="approval" className="mt-6">
                                <Approval readOnly={pipelineStageReadOnly} />
                                <div className="mt-6"><CommentSection styles="flex-row" readOnly={commentsReadOnly} /></div>
                                <RequiredDocument readOnly={isOperationsReadOnlyPipelineTab} />
                            </TabsContent>

                            <TabsContent value="contract" className="mt-6">
                                <ContractTab readOnly={isAgent || isViewOnlyBrowse} />
                            </TabsContent>

                            {/* -------------------------------------------------------------- */}
                            {/* OPERATIONS specific tabs */}
                            <TabsContent value="doc-request-contract" className="mt-6">
                                <CasesDashboard applicationId={resolvedApplicationId} />
                            </TabsContent>

                            <TabsContent value="final" className="mt-6">
                                <Final
                                    applicationId={applicationId}
                                    onBack={() => navigate(-1)}
                                />
                            </TabsContent>

                            <TabsContent value="funding-call" className="mt-6">
                                <FundingCall
                                    applicationId={resolvedApplicationId}
                                    onSaved={() => {
                                        refetchApplicationDetail();
                                    }}
                                />
                            </TabsContent>

                            <TabsContent value="disbursement" className="mt-6">
                                <Disbursement
                                    applicationId={resolvedApplicationId ?? undefined}
                                    summaryApplicationId={applicationId}
                                    applicationRecordId={applicationUuid}
                                    currentQueue={queue}
                                    onBack={() => navigate(-1)}
                                />
                            </TabsContent>
                            {/* -------------------------------------------------------------- */}

                            <TabsContent value="bank-analysis" className="mt-6">
                                <ApplicationSummary onBack={() => navigate(-1)} />
                                <BankAnalysis readOnly={isOperationsReadOnlyPipelineTab} />
                                <RequiredDocument isBankAnalysis={true} readOnly={isOperationsReadOnlyPipelineTab} />
                                <div className="mt-6"><CommentSection readOnly={commentsReadOnly} /></div>
                            </TabsContent>

                            <TabsContent value="eligibility-analysis" className="mt-6">
                            <ApplicationSummary onBack={() => navigate(-1)} />
                                <EligibilityAnalysis />
                            </TabsContent>

                            <TabsContent value="checks" className="mt-6">
                                <ApplicationSummary onBack={() => navigate(-1)} />
                                <ComplianceChecks />
                                <div className="mt-6"><CommentSection readOnly={commentsReadOnly} /></div>
                            </TabsContent>

                            <TabsContent value="decision-making" className="mt-6">
                                <ApplicationSummary onBack={() => navigate(-1)} />
                                {!hideBusinessProfileOnDecisionMakingTab && (
                                    <ApplicationBasicDetails applicationId={applicationId} />
                                )}
                                <div className="flex flex-row mt-6 gap-4 w-full">
                                    <RequiredDocument
                                        isDecisionMaking={true}
                                        isBankAnalysis={false}
                                        readOnly={pipelineStageReadOnly}
                                        disableFundingUpload={
                                            disableDecisionMakingFundingUpload
                                        }
                                        hideFundingDocuments={
                                            roleKey === "OPERATIONS"
                                        }
                                    />
                                </div>
                                <div className="mt-6">
                                    <DecisionMakeFinalValues
                                        applicationId={applicationId}
                                        allowOfferEdit={
                                            isUnderwriter && !pipelineStageReadOnly
                                        }
                                        allowPositionsEdit={
                                            isUnderwriter && !pipelineStageReadOnly
                                        }
                                        positionsDisableDelete
                                        positionsDisableCreate={
                                            isUnderwriter && !pipelineStageReadOnly
                                        }
                                        betweenOfferAndPositions={
                                            isUnderwriter ? (
                                                <BankAnalysisTable
                                                    disableDelete
                                                    disableCreate={
                                                        !pipelineStageReadOnly &&
                                                        !isOperationsReadOnlyPipelineTab
                                                    }
                                                    readOnly={
                                                        pipelineStageReadOnly ||
                                                        isOperationsReadOnlyPipelineTab
                                                    }
                                                />
                                            ) : (
                                                <BankAnalysisTable
                                                    showOnlyTotals
                                                    readOnly={
                                                        pipelineStageReadOnly ||
                                                        isOperationsReadOnlyPipelineTab
                                                    }
                                                />
                                            )
                                        }
                                    />
                                </div>
                                <div className="flex flex-row mt-6 gap-4 w-full items-stretch">
                                    <ChecksAndDecision
                                        hideUnderwritingDecision={roleKey === "OPERATIONS"}
                                    />
                                    <div className="w-[50%]"><CommentSection readOnly={commentsReadOnly} /></div>
                                </div>
                            </TabsContent>
                        </>
                    ) : showAccessDenied ? (
                        fallbackComponent
                    ) : showApplicationLoadError ? (
                        <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-10 text-center shadow-[0px_4px_20px_0px_rgba(0,0,0,0.06)] dark:shadow-[0px_4px_24px_0px_rgba(0,0,0,0.35)]">
                            <p className="text-sm font-medium text-destructive">
                                {applicationDetailError}
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                className="mt-4"
                                onClick={refetchApplicationDetail}
                            >
                                Try again
                            </Button>
                        </div>
                    ) : (
                        <div className="mt-6 flex items-center justify-center rounded-lg border border-border bg-card p-10 shadow-[0px_4px_20px_0px_rgba(0,0,0,0.06)] dark:shadow-[0px_4px_24px_0px_rgba(0,0,0,0.35)]">
                            <div className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                                <span className="inline-block h-4 w-4 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
                                Loading application details...
                            </div>
                        </div>
                    )}
                    {tabStepFooter}
                </Tabs>
                )}
            </div>

            {isSuperAdmin && activityLogApplicationId ? (
                <Sheet open={auditLogOpen} onOpenChange={setAuditLogOpen}>
                    <SheetContent
                        side="right"
                        aria-label="Audit log"
                        overlayClassName="bg-black/15"
                        className="z-[9999] flex h-full w-full max-w-full flex-col gap-0 overflow-hidden border-l p-0 sm:w-[50vw] sm:max-w-[50vw]"
                    >
                        <ApplicationSheetActivityLog
                            applicationId={activityLogApplicationId}
                            className="min-h-0 flex-1"
                            headerClassName="shrink-0 pr-14 pt-10"
                        />
                    </SheetContent>
                </Sheet>
            ) : null}
        </div>
    );
};

export default ApplicationDetails;
