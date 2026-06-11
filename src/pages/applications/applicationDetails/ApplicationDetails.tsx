import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LazyTabContent } from "@/components/application/LazyTabContent";
import { Button } from "@/components/ui/button";
import ApplicationSummary from "@/components/application/ApplicationSummary";
import AgentDealIsoTag from "@/components/application/AgentDealIsoTag";
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
} from "@/redux/actions/applicationActions";
import {
    isNumericApplicationRouteParam,
    routeParamMatchesApplication,
} from "@/lib/applicationRouteMatch";
import { hydrateApplicationDetailFromCache } from "@/redux/slices/applicationSlice";
import {
  buildDetailHydrationPayload,
  findApplicationListRowForRoute,
  getCachedApplicationDetail,
} from "@/lib/applicationDetailCache";
import type { Application } from "@/types/applicationTypes";
import { useTheme } from "@/context/ThemeContext";
import type { user } from "@/redux/slices/authSlice";
import { toast } from "react-toastify";
import { Final } from "@/pages/case/Final";
import { FundingCall } from "@/pages/case/FundingCall";
import { Disbursement } from "@/pages/case/Disbursment";
import { useTabRouting, type TabOption } from "@/hooks/useTabRouting";
import {
    canOpenDisbursementTab,
    inferOperationsListStatusFromApplication,
    normalizeOperationsDashboardStatusParam,
    operationsDashboardStatusTitle,
    OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
} from "@/constants/operationsDashboardApplications";
import { getFundingCalls } from "@/redux/actions/fundingCallActions";
import {
    getOperationsTabsForDashboardEntry,
    isOperationsPipelineTabBehindDealStage,
    SUPER_ADMIN_PIPELINE_TABS,
} from "@/constants/operationsPipelineTabs";
import { useTabAccess } from "@/hooks/useTabAccess.ts";
import FinalUnderwriterApplicationSummary from "@/components/application/FinalUnderwriterApplicationSummary";
import ApplicationSheetActivityLog from "@/components/application/ApplicationSheetActivityLog";
import { ChevronLeft, ChevronRight, ScrollText, Lock } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { getStageAccessForApplication } from "@/lib/applicationStageAccess";
import { canRoleEditDecisionMakingTab } from "@/lib/decisionMakingAccess";
import { normalizeRoleKey } from "@/lib/sessionRole";


const ApplicationDetails = () => {
    const { applicationId } = useParams<{ applicationId: string; tab?: string }>()
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [sendingToUnderwriter, setSendingToUnderwriter] = useState(false);
    const [agentSentToUnderwriter, setAgentSentToUnderwriter] = useState(false);
    const [auditLogOpen, setAuditLogOpen] = useState(false);
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    const dispatch = useDispatch<AppDispatch>();

    const [user, setUser] = useState<user>()
    const { loading, data } = useSelector((state: RootState) => state.login)

    const {
        loading: applicationDetailLoading,
        isRefreshing: applicationDetailRefreshing,
        data: applicationData,
        error: applicationDetailError,
    } = useSelector((state: RootState) => state.applicationDetail);
    const applicationsListRows = useSelector(
        (state: RootState) => state.applications.data,
    );

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
    const roleKey = normalizeRoleKey(userRole);
    const isSuperAdmin = roleKey === "SUPER_ADMIN";
    const isFundingUploaderRole =
        roleKey === "SUPER_ADMIN" ||
        roleKey === "UNDERWRITER" ||
        roleKey === "FINAL_UNDERWRITER";
    const isUnderwriter = roleKey === 'UNDERWRITER' || roleKey === 'FINAL_UNDERWRITER';
    const isFinalUnderwriter = roleKey === 'FINAL_UNDERWRITER';
    const isAgent = roleKey === 'AGENT';
    const isAdmin = roleKey === "ADMIN";
    const canEditIsoDetails =
        isSuperAdmin || isAgent || roleKey === "OPERATIONS";
    const hideBusinessProfileOnDecisionMakingTab =
        roleKey === "UNDERWRITER" ||
        roleKey === "OPERATIONS" ||
        isAdmin ||
        roleKey === "SUPER_ADMIN";
    /** Operations, Admin, and Super Admin use the funding-pipeline tab strip and `?operationsStatus=` depth rules. */
    const useOperationsPipelineTabs =
        roleKey === 'OPERATIONS' ||
        isAdmin ||
        roleKey === 'SUPER_ADMIN';

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
     * SUPER_ADMIN always sees the full pipeline strip (Overview → Disbursement), ignoring stage trim.
     * OPERATIONS opening from the main Applications list (no stage query, or `all`) sees the full
     * strip for that stage set; Operations early tabs stay read-only via `isOperationsReadOnlyPipelineTab`.
     */
    const effectiveOperationsStatus = useMemo(() => {
        if (!useOperationsPipelineTabs) return null;
        const trimmedOpsStatus = operationsStatusQueryRaw?.trim() ?? "";
        /** Same as Operations: browsing Applications / “all” without a stage should show the full pipeline strip. */
        const operationsOpenedWithoutStageFilter =
            (roleKey === "OPERATIONS" ||
                isAdmin ||
                roleKey === "SUPER_ADMIN") &&
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

        // UNDERWRITER (not final): full underwriter tabs
        if (isUnderwriter) {
            return [
                { id: "overview", label: "OVERVIEW" },
                { id: "documents", label: "DOCUMENTS" },
                { id: "bank-analysis", label: "BANK ANALYSIS" },
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

    const tabs = useMemo((): TabOption[] => {
        let list: TabOption[];
        if (useOperationsPipelineTabs) {
            list = isSuperAdmin || isAdmin
                ? [...SUPER_ADMIN_PIPELINE_TABS]
                : getOperationsTabsForDashboardEntry(effectiveOperationsStatus);
        } else {
            list = getTabs();
        }
        return list;
    }, [
        effectiveOperationsStatus,
        useOperationsPipelineTabs,
        isSuperAdmin,
        isAdmin,
        status,
        explicitStatus,
        queue,
        currentState,
        isFinalUnderwriter,
        isUnderwriter,
    ]);

    const { data: fundingCallsForApp, loading: fundingCallsLoading } = useSelector(
        (state: RootState) => state.fundingCalls,
    );

    const latestFundingCallStatus = useMemo(() => {
        const rows = fundingCallsForApp;
        if (!Array.isArray(rows) || rows.length === 0) return null;
        const latest = rows[0] as { callStatus?: string };
        return latest?.callStatus ?? null;
    }, [fundingCallsForApp]);

    useEffect(() => {
        if (!useOperationsPipelineTabs || !resolvedApplicationId) return;
        void dispatch(
            getFundingCalls({ application: String(resolvedApplicationId) }),
        );
    }, [useOperationsPipelineTabs, resolvedApplicationId, dispatch]);

    const canSelectOperationsDisbursementTab = useMemo(
        () =>
            canOpenDisbursementTab(queue, {
                explicitStatus,
                currentState,
                latestFundingCallStatus,
            }),
        [queue, explicitStatus, currentState, latestFundingCallStatus],
    );

    const tabsForOperationsUi = useMemo(() => {
        if (!useOperationsPipelineTabs) return tabs;
        const disbursementLocked =
            !isSuperAdmin &&
            !canSelectOperationsDisbursementTab &&
            !fundingCallsLoading;
        return tabs.map((t) =>
            t.id === "disbursement" && disbursementLocked
                ? { ...t, disabled: true as const }
                : t,
        );
    }, [
        tabs,
        useOperationsPipelineTabs,
        isSuperAdmin,
        canSelectOperationsDisbursementTab,
        fundingCallsLoading,
    ]);

    const defaultTabForRouting = useMemo(
        () => tabs[0]?.id ?? "overview",
        [tabs],
    );

    const isLoadingCurrentApplication =
        !applicationId ||
        (applicationDetailLoading && !applicationData) ||
        (!!applicationData &&
            !routeParamMatchesApplication(applicationId, applicationData));

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

    const { activeTab, handleTabChange } = useTabRouting(
        tabs,
        applicationId,
        defaultTabForRouting,
        { isTabsReady, clampInvalidUrlTab: true },
    );

    useEffect(() => {
        if (!isTabsReady || !useOperationsPipelineTabs) return;
        if (isSuperAdmin) return;
        if (activeTab !== "disbursement") return;
        if (canSelectOperationsDisbursementTab) return;
        if (!applicationId) return;
        const fallback =
            tabs.find((t) => t.id !== "disbursement")?.id ?? defaultTabForRouting;
        handleTabChange(fallback);
    }, [
        isTabsReady,
        useOperationsPipelineTabs,
        isSuperAdmin,
        activeTab,
        canSelectOperationsDisbursementTab,
        applicationId,
        tabs,
        defaultTabForRouting,
        handleTabChange,
    ]);

    const handleOperationsTabChange = useCallback(
        (next: string) => {
            const row = tabsForOperationsUi.find((t) => t.id === next);
            if (row?.disabled) return;
            handleTabChange(next);
        },
        [tabsForOperationsUi, handleTabChange],
    );


    const OPERATIONS_READ_ONLY_PIPELINE_TAB_IDS = useMemo(
        () =>
            new Set([
                "overview",
                "documents",
                "contract",
                "approval",
            ]),
        [],
    );

    /** Loaded deal stage for Operations / Super Admin pipeline (always from app queue, not URL filter). */
    const applicationOperationsDealStatus = useMemo(() => {
        if (!useOperationsPipelineTabs || !applicationAligned) return null;
        return inferOperationsListStatusFromApplication(queue, {
            explicitStatus,
            currentState,
        });
    }, [
        useOperationsPipelineTabs,
        applicationAligned,
        queue,
        explicitStatus,
        currentState,
    ]);

    const isOperationsTabBehindCurrentDeal = useMemo(() => {
        if (!useOperationsPipelineTabs) return false;
        return isOperationsPipelineTabBehindDealStage(
            activeTab,
            applicationOperationsDealStatus,
            tabsForOperationsUi,
        );
    }, [
        useOperationsPipelineTabs,
        activeTab,
        applicationOperationsDealStatus,
        tabsForOperationsUi,
    ]);

    const isWorkflowRole =
        roleKey === "AGENT" ||
        roleKey === "UNDERWRITER" ||
        roleKey === "FINAL_UNDERWRITER";
    const isViewOnlyBrowse =
        searchParams.get("viewOnly") === "1" && !isWorkflowRole;

    const stageAccess = useMemo(
        () => getStageAccessForApplication(applicationData as any, roleKey, {
            viewOnlyBrowse: false,
        }),
        [applicationData, roleKey],
    );
    const isStagePreview = stageAccess.isPreview;
    const previewBannerReason = stageAccess.reason;
    const isOperationsReadOnlyPipelineTab =
        (useOperationsPipelineTabs &&
            (OPERATIONS_READ_ONLY_PIPELINE_TAB_IDS.has(activeTab) ||
                isOperationsTabBehindCurrentDeal)) ||
        isViewOnlyBrowse ||
        isStagePreview;
    /** Super Admin may edit offer, bank analysis, and positions on the Bank Analysis tab even when the deal has moved past that stage. */
    const superAdminBankAnalysisOverride =
        isSuperAdmin && activeTab === "bank-analysis";
    /** Super Admin may edit offer, bank analysis, and positions on Decision Making even when the deal has moved past that stage. */
    const superAdminDecisionMakingOverride =
        isSuperAdmin && activeTab === "decision-making";
    /** Most pipeline stages: no edits for Operations / Super Admin on past tabs / view-only browse / workflow preview. */
    const pipelineStageReadOnly =
        isOperationsReadOnlyPipelineTab || isViewOnlyBrowse || isStagePreview;
    const bankAnalysisTabReadOnly =
        isOperationsReadOnlyPipelineTab && !superAdminBankAnalysisOverride;
    /** Underwriter / FUW on bank-analysis or decision-making while the deal is not preview-only for their role. */
    const workflowEditorOnOwnStage =
        (roleKey === "UNDERWRITER" || roleKey === "FINAL_UNDERWRITER") &&
        !isViewOnlyBrowse &&
        !isStagePreview &&
        (activeTab === "bank-analysis" || activeTab === "decision-making");
    /** Offer, bank analysis, and positions on Decision Making for underwriting / ops / admin roles. */
    const canEditDecisionMakingFinalValues =
        canRoleEditDecisionMakingTab(roleKey) &&
        (!pipelineStageReadOnly ||
            superAdminDecisionMakingOverride ||
            workflowEditorOnOwnStage);
    const canEditBankAnalysisContent =
        canRoleEditDecisionMakingTab(roleKey) &&
        (!bankAnalysisTabReadOnly ||
            superAdminBankAnalysisOverride ||
            workflowEditorOnOwnStage);
    const showDecisionMakingBankAnalysisTable =
        canRoleEditDecisionMakingTab(roleKey);
    /** OPERATIONS may comment; block composer for `?viewOnly=1` browse links and stage-preview viewers. */
    const commentsReadOnly = isViewOnlyBrowse || isStagePreview;
    const disableDecisionMakingFundingUpload =
        isViewOnlyBrowse || isStagePreview || !isFundingUploaderRole;
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
        !isStagePreview &&
        isPreUnderwriterStage &&
        !agentSentToUnderwriter;

    const changeTabScrollTop = useCallback(
        (tabId: string) => {
            if (useOperationsPipelineTabs) {
                const target = tabsForOperationsUi.find((t) => t.id === tabId);
                if (target?.disabled) return;
            }
            handleTabChange(tabId);
            requestAnimationFrame(() => {
                window.scrollTo({ top: 0, left: 0, behavior: "auto" });
            });
        },
        [useOperationsPipelineTabs, tabsForOperationsUi, handleTabChange],
    );

    const { isAllowed, fallbackComponent } = useTabAccess(tabs, activeTab);
    const canRenderTabContent = isTabsReady && isAllowed;
    const showAccessDenied = isTabsReady && !isAllowed;

    const tabStepFooter = useMemo(() => {
        if (!canRenderTabContent || tabsForOperationsUi.length < 2) return null;
        const ui = tabsForOperationsUi;
        const idx = ui.findIndex((t) => t.id === activeTab);
        if (idx < 0) return null;
        let prevTab: (typeof ui)[number] | null = null;
        for (let i = idx - 1; i >= 0; i--) {
            if (!ui[i]?.disabled) {
                prevTab = ui[i]!;
                break;
            }
        }
        let nextTab: (typeof ui)[number] | null = null;
        for (let i = idx + 1; i < ui.length; i++) {
            if (!ui[i]?.disabled) {
                nextTab = ui[i]!;
                break;
            }
        }
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
    }, [canRenderTabContent, tabsForOperationsUi, activeTab, changeTabScrollTop]);

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

        const preview = (location.state as { applicationPreview?: Application } | null)
            ?.applicationPreview;
        const fromList = findApplicationListRowForRoute(
            applicationId,
            applicationsListRows,
        );
        const seed =
            preview && routeParamMatchesApplication(applicationId, preview)
                ? preview
                : fromList;
        if (
            seed &&
            !routeParamMatchesApplication(applicationId, applicationDetailRef.current)
        ) {
            dispatch(hydrateApplicationDetailFromCache({ success: true, data: seed }));
        }

        const cachedBody = getCachedApplicationDetail(applicationId);
        const cachedPayload = buildDetailHydrationPayload(cachedBody);
        if (
            cachedPayload &&
            !routeParamMatchesApplication(applicationId, applicationDetailRef.current)
        ) {
            dispatch(hydrateApplicationDetailFromCache(cachedBody));
        }

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
    }, [applicationId, applicationsListRows, dispatch, location.state]);

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




    const pipelineTabHeaderRowClass =
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4";
    const pipelineTabScrollerClass =
        "min-w-0 overflow-x-auto overscroll-x-contain";
    const pipelineTabLinksSlotClass =
        "flex shrink-0 items-center justify-end gap-4 pl-2";

    const externalLinksRow = (
        <div className="flex shrink-0 items-center justify-end gap-4 flex-nowrap">
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
                    Activity log
                </Button>
            ) : null}
            {EXTERNAL_LINKS.map((link) => (
                <a
                    key={link.label}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="whitespace-nowrap text-sm font-semibold text-[#3B8BD1] underline"
                >
                    {link.label}
                </a>
            ))}
        </div>
    );

    const opsPastStageLabel = applicationOperationsDealStatus
        ? operationsDashboardStatusTitle(applicationOperationsDealStatus)
        : null;

    const previewBanner =
        (isStagePreview || isOperationsTabBehindCurrentDeal) &&
        !superAdminBankAnalysisOverride ? (
            <div
                role="status"
                aria-live="polite"
                className="mb-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/70 dark:from-slate-900/70 dark:via-slate-900/40 dark:to-slate-900/70"
            >
                <span
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-[#276D9C] shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300"
                    aria-hidden
                >
                    <Lock className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            Read-only preview
                        </p>
                        {isStagePreview && stageAccess.nextStageLabel ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#276D9C]/15 bg-[#276D9C]/[0.07] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#276D9C] dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-300">
                                Now with {stageAccess.nextStageLabel}
                            </span>
                        ) : null}
                        {isOperationsTabBehindCurrentDeal && opsPastStageLabel ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#276D9C]/15 bg-[#276D9C]/[0.07] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#276D9C] dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-300">
                                Deal at {opsPastStageLabel}
                            </span>
                        ) : null}
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        {isStagePreview
                            ? previewBannerReason ??
                              "This deal has moved past your stage. Editing and workflow actions are disabled for your role."
                            : `This tab is view-only because the application is already at ${opsPastStageLabel ?? "a later stage"}.`}
                    </p>
                </div>
            </div>
        ) : null;

    return (
        <div
            className={`min-h-screen bg-background p-4 md:p-6 transition-opacity duration-300 ${
                applicationDetailRefreshing ? "opacity-90" : "opacity-100"
            }`}
        >
            <div className="max-w-screen-2xl mx-auto">
                {previewBanner}
                {isFinalUnderwriter ? (
                    /* FINAL_UNDERWRITER: 1) Tab row (tabs + links) 2) Application Summary below tabs 3) Tab content */
                    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                        {/* Row 1: Tabs (left) + Links (right) */}
                        <div className={`mb-4 ${pipelineTabHeaderRowClass}`}>
                            <div className={pipelineTabScrollerClass}>
                            <TabsList className="bg-transparent cursor-pointer p-0 h-auto flex w-max items-center">
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
                            </div>
                            <div className={pipelineTabLinksSlotClass}>
                                {externalLinksRow}
                            </div>
                        </div>
                        {/* Row 2: Application Summary (same five-column layout as all roles) */}
                        <FinalUnderwriterApplicationSummary
                            applicationId={applicationId}
                            onBack={() => navigate(-1)}
                        />
                        {activeTab !== "eligibility-analysis" ? (
                            <AgentDealIsoTag applicationId={applicationId} alwaysEditable={canEditIsoDetails} />
                        ) : null}
                        {/* Row 3: Tab content (Decision Making or Contract) */}
                        {canRenderTabContent ? (
                            <>
                                <LazyTabContent activeTab={activeTab} value="eligibility-analysis" className="mt-6">
                                    <EligibilityAnalysis />
                                </LazyTabContent>
                                <LazyTabContent activeTab={activeTab} value="overview" className="mt-6">
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
                                            allowOfferEdit={!isStagePreview}
                                            allowPositionsEdit={!isStagePreview}
                                            onSummaryMetricsChange={handleSummaryMetricsChange}
                                            betweenOfferAndPositions={
                                                <BankAnalysisTable
                                                    applicationId={applicationId}
                                                    disableDelete
                                                    readOnly={isStagePreview}
                                                    disableCreate={isStagePreview}
                                                />
                                            }
                                        />
                                    </div>
                                    <div className="flex flex-row gap-4 w-full mt-10 items-stretch">
                                        <ChecksAndDecision
                                            isFinalUnderwriter={true}
                                            previewMode={isStagePreview}
                                            onProceedToContract={() => handleTabChange("contract")}
                                        />
                                        <div className="w-[50%]"><CommentSection readOnly={commentsReadOnly} /></div>
                                    </div>
                                </LazyTabContent>
                                <LazyTabContent activeTab={activeTab} value="contract" className="mt-6">
                                    <ContractTab readOnly />
                                </LazyTabContent>
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
                    <Tabs
                        value={activeTab}
                        onValueChange={
                            useOperationsPipelineTabs
                                ? handleOperationsTabChange
                                : handleTabChange
                        }
                        className="w-full"
                    >
                        <div className={pipelineTabHeaderRowClass}>
                            <div className={pipelineTabScrollerClass}>
                            <TabsList className="bg-transparent cursor-pointer p-0 h-auto flex w-max items-center">
                                {tabsForOperationsUi.map((tab, index) => {
                                    const isActive = activeTab === tab.id;
                                    const isDisabled = Boolean(tab.disabled);
                                    const isFirst = index === 0;
                                    const isLast = index === tabsForOperationsUi.length - 1;

                                    // Calculate z-index - active tab should be on top, earlier tabs have higher z-index
                                    const zIndex = isActive ? 10 : tabsForOperationsUi.length - index;

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
                                                disabled={isDisabled}
                                                className={`relative px-8 py-2 text-sm font-bold border-0 shadow-none transition-all duration-200 rounded-none ${isDisabled
                                                        ? "cursor-not-allowed opacity-45"
                                                        : "cursor-pointer"
                                                    }`}
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
                            </div>
                            <div className={pipelineTabLinksSlotClass}>
                                {externalLinksRow}
                            </div>
                        </div>

                        {canRenderTabContent ? (
                            <>
	                            <LazyTabContent activeTab={activeTab} value="overview" className="mt-6">
                                    <>
                                        <ApplicationSummary applicationId={applicationId} onBack={() => navigate(-1)} />
                                        <AgentDealIsoTag applicationId={applicationId} alwaysEditable={canEditIsoDetails} />
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
                                        <div className="mt-6"><CommentSection isUnderwriter={isUnderwriter} readOnly={commentsReadOnly} /></div>
                                    </>
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="documents" className="mt-6">
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
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="approval" className="mt-6">
                                    <Approval readOnly={pipelineStageReadOnly} />
                                    <div className="mt-6"><CommentSection styles="flex-row" readOnly={commentsReadOnly} /></div>
                                    <RequiredDocument readOnly={isOperationsReadOnlyPipelineTab} />
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="contract" className="mt-6">
                                    <ContractTab readOnly={isAgent || isViewOnlyBrowse} />
                            </LazyTabContent>

                                {/* -------------------------------------------------------------- */}
                                {/* OPERATIONS specific tabs */}
                            <LazyTabContent activeTab={activeTab} value="doc-request-contract" className="mt-6">
                                    <CasesDashboard applicationId={resolvedApplicationId} />
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="final" className="mt-6">
                                    <Final
                                        applicationId={applicationId}
                                        onBack={() => navigate(-1)}
                                    />
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="funding-call" className="mt-6">
                                    <FundingCall
                                        applicationId={resolvedApplicationId}
                                        onSaved={() => {
                                            refetchApplicationDetail();
                                            if (resolvedApplicationId != null) {
                                                void dispatch(
                                                    getFundingCalls({
                                                        application: String(
                                                            resolvedApplicationId,
                                                        ),
                                                    }),
                                                );
                                            }
                                        }}
                                    />
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="disbursement" className="mt-6">
                                    <Disbursement
                                        applicationId={resolvedApplicationId ?? undefined}
                                        summaryApplicationId={applicationId}
                                        applicationRecordId={applicationUuid}
                                        currentQueue={queue}
                                        onBack={() => navigate(-1)}
                                    />
                            </LazyTabContent>
                                {/* -------------------------------------------------------------- */}

                            <LazyTabContent activeTab={activeTab} value="bank-analysis" className="mt-6">
                                    <ApplicationSummary onBack={() => navigate(-1)} />
                                    <BankAnalysis
                                        readOnly={!canEditBankAnalysisContent}
                                        enableCreate={canEditBankAnalysisContent}
                                    />
                                    <RequiredDocument isBankAnalysis={true} readOnly={!canEditBankAnalysisContent} />
                                    <div className="mt-6"><CommentSection readOnly={commentsReadOnly} /></div>
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="eligibility-analysis" className="mt-6">
                                    <ApplicationSummary onBack={() => navigate(-1)} />
                                    <EligibilityAnalysis />
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="checks" className="mt-6">
                                    <ApplicationSummary onBack={() => navigate(-1)} />
                                    <ComplianceChecks />
                                    <div className="mt-6"><CommentSection readOnly={commentsReadOnly} /></div>
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="decision-making" className="mt-6">
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
                                            allowOfferEdit={canEditDecisionMakingFinalValues}
                                            allowPositionsEdit={canEditDecisionMakingFinalValues}
                                            betweenOfferAndPositions={
                                                showDecisionMakingBankAnalysisTable ? (
                                                    <BankAnalysisTable
                                                        applicationId={applicationId}
                                                        disableDelete={!canEditDecisionMakingFinalValues}
                                                        readOnly={!canEditDecisionMakingFinalValues}
                                                        disableCreate={!canEditDecisionMakingFinalValues}
                                                    />
                                                ) : (
                                                    <BankAnalysisTable
                                                        showOnlyTotals
                                                        readOnly
                                                    />
                                                )
                                            }
                                        />
                                    </div>
                                    <div className="flex flex-row mt-6 gap-4 w-full items-stretch">
                                        <ChecksAndDecision
                                            hideUnderwritingDecision={roleKey === "OPERATIONS"}
                                            canSendApprovalMailToIso={superAdminDecisionMakingOverride}
                                            previewMode={
                                                (isStagePreview ||
                                                    isOperationsTabBehindCurrentDeal) &&
                                                !superAdminDecisionMakingOverride
                                            }
                                        />
                                        <div className="w-[50%]"><CommentSection readOnly={commentsReadOnly} /></div>
                                    </div>
                            </LazyTabContent>
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
                        aria-label="Activity log"
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
