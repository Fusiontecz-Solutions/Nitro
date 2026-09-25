import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LazyTabContent } from "@/components/application/LazyTabContent";
import { Button } from "@/components/ui/button";
import ApplicationSummary from "@/components/application/ApplicationSummary";
import ApplicationBasicDetails from "@/components/application/ApplicationBasicDetails";
import CommentSection from "@/components/application/CommentSection";
import UploadedDocuments from "@/components/application/UploadedDocuments";
import ContractTab from "@/components/application/ContractTab";
import BankAnalysis from "@/components/application/BankAnalysis";
import BackgroundCheckTab from "@/components/application/BackgroundCheckTab";

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
  invalidateApplicationDetailCache,
  isApplicationDetailFetchFresh,
} from "@/lib/applicationDetailCache";
import { invalidateHttpGetCacheForResource } from "@/lib/httpGetCache";
import { useContractSigningStatusRealtime } from "@/hooks/useContractSigningStatusRealtime";
import { isFinalUnderwriterWorkflowQueue } from "@/lib/applicationWorkflowState";
import { useTheme } from "@/context/ThemeContext";
import type { user } from "@/redux/slices/authSlice";
import { toast } from "react-toastify";
import { useTabRouting, type TabOption } from "@/hooks/useTabRouting";
import {
    inferOperationsListStatusFromApplication,
    normalizeOperationsDashboardStatusParam,
    OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
} from "@/constants/operationsDashboardApplications";
import {
    getOperationsPipelineStageTabId,
    isOperationsPipelineTabBehindDealStage,
    SUPER_ADMIN_PIPELINE_TABS,
} from "@/constants/operationsPipelineTabs";
import { useTabAccess } from "@/hooks/useTabAccess.ts";
import FinalUnderwriterApplicationSummary from "@/components/application/FinalUnderwriterApplicationSummary";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getStageAccessForApplication } from "@/lib/applicationStageAccess";
import ApplicationProgressBar from "@/components/application/ApplicationProgressBar";
import { HorizontalScrollFade } from "@/components/ui/horizontal-scroll-fade";
import { normalizeRoleKey, resolveEffectiveRole } from "@/lib/sessionRole";


const ApplicationDetails = () => {
    const { applicationId } = useParams<{ applicationId: string; tab?: string }>()
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const [sendingToUnderwriter, setSendingToUnderwriter] = useState(false);
    const [agentSentToUnderwriter, setAgentSentToUnderwriter] = useState(false);
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
    const activityLogApplicationId =
        applicationUuid != null ? String(applicationUuid) : "";


    const resolvedApplicationId =
        (applicationData as any)?.applicationId ??
        (applicationData as any)?._id ??
        applicationId ??
        null;
    /** UUID or numeric applicationId — backend accepts either for PATCH `/applications/:id/queue`. */
    const queueUpdateApplicationRef =
        activityLogApplicationId ||
        (resolvedApplicationId != null ? String(resolvedApplicationId) : "") ||
        (applicationId ? String(applicationId) : "");

    useEffect(() => {
        setUser(data?.user)
        if (!data?.user) {
            const storedUser = localStorage.getItem('user')
            if (storedUser) {
                setUser(JSON.parse(storedUser))
            }
        }
    }, [data, loading])

    const userRole = resolveEffectiveRole(user);
    const roleKey = normalizeRoleKey(userRole);
    const isSuperAdmin = roleKey === "SUPER_ADMIN";
    const isUnderwriter = roleKey === 'SCRUBBING' || roleKey === 'UNDERWRITER';
    const isFinalUnderwriter = roleKey === 'UNDERWRITER';
    const isAgent = roleKey === 'AGENT';
    /** Operations + Super Admin use the same contract-workflow tab strip and `?operationsStatus=` depth rules. */
    const useOperationsPipelineTabs =
        roleKey === "OPERATIONS" || roleKey === "SUPER_ADMIN";
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
     * SUPER_ADMIN / OPERATIONS use the contract-workflow strip (Overview → Contract).
     * OPERATIONS early tabs stay read-only via `isOperationsReadOnlyPipelineTab`.
     */
    const effectiveOperationsStatus = useMemo(() => {
        if (!useOperationsPipelineTabs) return null;
        const trimmedOpsStatus = operationsStatusQueryRaw?.trim() ?? "";
        /** Same as Operations: browsing Applications / “all” without a stage should show the full pipeline strip. */
        const operationsOpenedWithoutStageFilter =
            (roleKey === "OPERATIONS" || roleKey === "SUPER_ADMIN") &&
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

    // Determine tabs based on status and user role (contract workflow only).
    const getTabs = () => {
        const isCompleted = status?.toLowerCase() === 'completed';
        const isApprovedStatus = explicitStatus?.toLowerCase() === 'approved';
        const isApprovedQueue = typeof queue === 'string' && queue.toLowerCase() === 'approved';
        const queueNorm = typeof queue === 'string' ? queue.trim().toLowerCase() : '';
        const isSentToFinalUnderwriter = isFinalUnderwriterWorkflowQueue(queue);
        /** After "Generate contract", queue moves here — keep CONTRACT tab so FUW is not locked out. */
        const isContractedQueue =
            queueNorm === 'contracted' ||
            queueNorm === 'contract pending' ||
            queueNorm === 'contract generated' ||
            queueNorm === 'contract sent' ||
            queueNorm === 'contract cancelled' ||
            queueNorm === 'contract signed' ||
            queueNorm === 'contract out' ||
            queueNorm === 'contracts out';

        if (isFinalUnderwriter || isUnderwriter) {
            return [...SUPER_ADMIN_PIPELINE_TABS];
        }

        // - Before sending to Underwriter: show only first two tabs (Overview, Documents)
        // - After sending / Completed / Approved / Contracted: show all four contract tabs
        if (
            isCompleted ||
            isSentToFinalUnderwriter ||
            isApprovedStatus ||
            isApprovedQueue ||
            isContractedQueue
        ) {
            return [...SUPER_ADMIN_PIPELINE_TABS];
        }

        return [
            { id: "overview", label: "OVERVIEW" },
            { id: "documents", label: "DOCUMENTS" },
        ];
    };

    const tabs = useMemo((): TabOption[] => {
        if (useOperationsPipelineTabs) {
            return [...SUPER_ADMIN_PIPELINE_TABS];
        }
        return getTabs();
    }, [
        useOperationsPipelineTabs,
        status,
        explicitStatus,
        queue,
        isFinalUnderwriter,
        isUnderwriter,
    ]);

    const tabsForOperationsUi = tabs;

    const defaultTabForRouting = useMemo(() => {
        if (useOperationsPipelineTabs && effectiveOperationsStatus) {
            const stageTab = getOperationsPipelineStageTabId(
                effectiveOperationsStatus,
            );
            if (tabs.some((t) => t.id === stageTab)) return stageTab;
        }
        return tabs[0]?.id ?? "overview";
    }, [tabs, useOperationsPipelineTabs, effectiveOperationsStatus]);

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

    /**
     * A SignNow/DocuSign webhook moves the deal (e.g. to Contract Signed) with no
     * action from this tab. The header reads `currentState` from the detail
     * record, so drop every cached copy of it and fetch it again — otherwise the
     * fresh-cache short-circuit serves the old stage until a manual refresh.
     */
    useContractSigningStatusRealtime(applicationUuid, () => {
        invalidateApplicationDetailCache(String(applicationUuid));
        if (applicationId) invalidateApplicationDetailCache(applicationId);
        const numericId = (applicationData as any)?.applicationId;
        if (numericId != null) invalidateApplicationDetailCache(String(numericId));
        invalidateHttpGetCacheForResource("applications");
        refetchApplicationDetail();
    });

    const { activeTab, handleTabChange } = useTabRouting(
        tabs,
        applicationId,
        defaultTabForRouting,
        { isTabsReady, clampInvalidUrlTab: true },
    );

    const handleOperationsTabChange = useCallback(
        (next: string) => {
            handleTabChange(next);
        },
        [handleTabChange],
    );


    const OPERATIONS_READ_ONLY_PIPELINE_TAB_IDS = useMemo(
        () =>
            new Set([
                "overview",
                "documents",
                "contract",
                "decision-making",
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
        roleKey === "SCRUBBING" ||
        roleKey === "UNDERWRITER";
    const isViewOnlyBrowse =
        searchParams.get("viewOnly") === "1" && !isWorkflowRole;

    const stageAccess = useMemo(
        () => getStageAccessForApplication(applicationData as any, roleKey, {
            viewOnlyBrowse: false,
        }),
        [applicationData, roleKey],
    );
    const isStagePreview = stageAccess.isPreview;
    const isOperationsReadOnlyPipelineTab =
        (useOperationsPipelineTabs &&
            (OPERATIONS_READ_ONLY_PIPELINE_TAB_IDS.has(activeTab) ||
                isOperationsTabBehindCurrentDeal)) ||
        isViewOnlyBrowse ||
        isStagePreview;
    /**
     * Documents tab upload/delete: workflow roles (Agent, Scrubbing) keep upload even in
     * stage-preview; Super Admin keeps upload on Documents. Operations pipeline early tabs
     * stay view-only for OPERATIONS only.
     */
    const uploadedDocumentsReadOnly =
        (useOperationsPipelineTabs &&
            roleKey === "OPERATIONS" &&
            (OPERATIONS_READ_ONLY_PIPELINE_TAB_IDS.has(activeTab) ||
                isOperationsTabBehindCurrentDeal)) ||
        isViewOnlyBrowse;
    /** Super Admin may edit on any pipeline tab (including past stages). */
    const superAdminPipelineEditOverride = isSuperAdmin && !isViewOnlyBrowse;
    /** Most pipeline stages: no edits for Operations on past tabs / view-only browse / workflow preview. */
    const pipelineStageReadOnly =
        !superAdminPipelineEditOverride &&
        (isOperationsReadOnlyPipelineTab || isViewOnlyBrowse || isStagePreview);
    /** OPERATIONS may comment; block composer for `?viewOnly=1` browse links and stage-preview viewers. */
    const commentsReadOnly = isViewOnlyBrowse || isStagePreview;
    const normalizeWorkflowToken = (value: unknown) =>
        String(value ?? "")
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
    const queueKey = normalizeWorkflowToken(queue);
    const stateNorm = normalizeWorkflowToken(
        currentState || status || statsCurrentState || "",
    );
    /** Past agent intake — do not offer "Send to Scrubbing". (Do not include `review`; backend still treats Review as agent-side.) */
    const postAgentIntakeQueues = new Set([
        "scrubbing",
        "underwriting",
        "final review",
        "final scrubbing",
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
    /** Agent intake only — Super Admin / Admin / Operations must not send from Documents. */
    const canActSendToUnderwriter = isAgent;
    const canShowSendToUnderwriterButton =
        canActSendToUnderwriter &&
        !isViewOnlyBrowse &&
        !isStagePreview &&
        isPreUnderwriterStage &&
        !agentSentToUnderwriter &&
        Boolean(queueUpdateApplicationRef) &&
        !applicationDetailLoading;

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
                    className="min-w-[8rem] disabled:opacity-40"
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
    const initialDetailRequestRef = useRef<string | null>(null);
    useEffect(() => {
        applicationDetailRef.current = applicationData;
    }, [applicationData]);

    useEffect(() => {
        setAgentSentToUnderwriter(false);
    }, [applicationId]);

    useEffect(() => {
        if (!applicationId) return;

        const preview = (location.state as { applicationPreview?: { applicationId?: string; _id?: string; id?: string } } | null)
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

        // Only warm from detail cache when there is no list/preview row — stale cache must not
        // overwrite a fresher applications-table `currentQueue`.
        if (!seed) {
            const cachedBody = getCachedApplicationDetail(applicationId);
            const cachedPayload = buildDetailHydrationPayload(cachedBody);
            if (
                cachedPayload &&
                !routeParamMatchesApplication(applicationId, applicationDetailRef.current)
            ) {
                dispatch(hydrateApplicationDetailFromCache(cachedBody));
            }
        }

    }, [applicationId, applicationsListRows, dispatch, location.state]);

    // Fetch separately from cache/list hydration. A fulfilled request patches the applications
    // list, so including that list in this effect would create a request -> list update loop.
    useEffect(() => {
        if (!applicationId) return;
        const requestKey = String(applicationId).trim();
        if (
            initialDetailRequestRef.current === requestKey ||
            isApplicationDetailFetchFresh(requestKey)
        ) {
            return;
        }
        const current = applicationDetailRef.current;
        if (current && routeParamMatchesApplication(requestKey, current)) {
            initialDetailRequestRef.current = requestKey;
            if (isApplicationDetailFetchFresh(requestKey)) return;
        }
        initialDetailRequestRef.current = requestKey;

        if (isNumericApplicationRouteParam(requestKey)) {
            void dispatch(getApplicationByApplicationId(requestKey));
        } else {
            void dispatch(getApplicationById(requestKey));
        }
    }, [applicationId, dispatch]);

    const handleSendToUnderwriter = async () => {
        if (!queueUpdateApplicationRef) {
            toast.error("Application ID is missing. Please refresh the page and try again.");
            return;
        }
        setSendingToUnderwriter(true);
        const toastId = toast.loading("Sending application for Create Offer...");
        try {
            await dispatch(
                updateApplicationQueue({
                    id: queueUpdateApplicationRef,
                    data: { currentQueue: "Scrubbing" },
                }),
            ).unwrap();
            setAgentSentToUnderwriter(true);
            toast.update(toastId, {
                render: "Application has been sent for Create Offer.",
                type: "success",
                isLoading: false,
                autoClose: 2500,
            });
            refetchApplicationDetail();
        } catch (error) {
            console.error("Failed to send application for Create Offer:", error);
            const apiMessage =
                typeof error === "string" && error.trim()
                    ? error.trim()
                    : "Failed to send application for Create Offer. Please try again.";
            toast.update(toastId, {
                render: apiMessage,
                type: "error",
                isLoading: false,
                autoClose: 6000,
            });
        } finally {
            setSendingToUnderwriter(false);
        }
    };




    return (
        <div
            className={`min-h-screen bg-background p-4 md:p-6 transition-opacity duration-300 ${
                applicationDetailRefreshing ? "opacity-90" : "opacity-100"
            }`}
        >
            <div className="mx-auto min-w-0 max-w-screen-2xl">
                {applicationAligned ? (
                    <ApplicationProgressBar
                        application={applicationData as any}
                        className="mb-6"
                    />
                ) : null}
                {isFinalUnderwriter ? (
                    /* UNDERWRITER: 1) Tab row (tabs + links) 2) Application Summary below tabs 3) Tab content */
                    <Tabs key={applicationId} value={activeTab} onValueChange={handleTabChange} className="w-full">
                        {/* Row 1: Tabs (left) + Links (right) */}
                        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <HorizontalScrollFade className="min-w-0 w-full flex-1" scrollKey={activeTab}>
                            <TabsList className="bg-transparent cursor-pointer p-0 h-auto flex w-max flex-nowrap items-center shrink-0">
                                {tabs.map((tab, index) => {
                                    const isActive = activeTab === tab.id;
                                    const isFirst = index === 0;
                                    const isLast = index === tabs.length - 1;
                                    const zIndex = isActive ? 10 : tabs.length - index;
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
                                                className={`relative cursor-pointer whitespace-nowrap px-5 py-2.5 text-xs font-bold border-0 shadow-none rounded-none sm:px-6 sm:text-sm lg:px-8 data-[state=active]:shadow-none ${isActive ? "tab-pipeline-active" : ""}`}
                                                style={{
                                                    ...(isActive
                                                        ? { color: "#FFFFFF" }
                                                        : { backgroundColor: '#E8F0FE', color: '#0D2478' }),
                                                    clipPath: triggerClip,
                                                }}
                                            >
                                                {tab.label}
                                            </TabsTrigger>
                                        </div>
                                    );
                                })}
                            </TabsList>
                            </HorizontalScrollFade>
                        </div>
                        {/* Row 2: Application Summary (same five-column layout as all roles) */}
                        <FinalUnderwriterApplicationSummary
                            applicationId={applicationId}
                            onBack={() => navigate(-1)}
                        />
                        {canRenderTabContent ? (
                            <>
                                <LazyTabContent activeTab={activeTab} value="overview" className="mt-6">
                                    <ApplicationBasicDetails applicationId={applicationId} />
                                </LazyTabContent>
                                <LazyTabContent activeTab={activeTab} value="documents" className="mt-6">
                                    <UploadedDocuments readOnly={uploadedDocumentsReadOnly} />
                                </LazyTabContent>
                                <LazyTabContent activeTab={activeTab} value="decision-making" className="mt-6">
                                    <ApplicationSummary onBack={() => navigate(-1)} />
                                    <BankAnalysis
                                        readOnly={pipelineStageReadOnly}
                                        enableCreate={!pipelineStageReadOnly}
                                        showBankStatementUpload={false}
                                    />
                                </LazyTabContent>
                                <LazyTabContent activeTab={activeTab} value="background-check" className="mt-6">
                                    <BackgroundCheckTab />
                                </LazyTabContent>
                                <LazyTabContent activeTab={activeTab} value="contract" className="mt-6">
                                    <ContractTab readOnly={isAgent || isViewOnlyBrowse} />
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
                            <div className="mt-6 flex min-h-[420px] items-center justify-center rounded-lg border border-border bg-card p-10 shadow-[0px_4px_20px_0px_rgba(0,0,0,0.06)] dark:shadow-[0px_4px_24px_0px_rgba(0,0,0,0.35)]">
                                <div className="flex flex-col items-center gap-3 text-center">
                                    <span className="inline-block h-8 w-8 border-2 border-slate-300 border-t-[var(--brand)] rounded-full animate-spin" />
                                    <p className="text-sm font-semibold text-foreground">Loading application details…</p>
                                    <p className="text-xs text-muted-foreground">Please wait while business and owner information loads.</p>
                                </div>
                            </div>
                        )}
                        {tabStepFooter}
                    </Tabs>
                ) : null}
                {!isFinalUnderwriter && (
                    <Tabs
                        key={applicationId}
                        value={activeTab}
                        onValueChange={
                            useOperationsPipelineTabs
                                ? handleOperationsTabChange
                                : handleTabChange
                        }
                        className="w-full"
                    >
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <HorizontalScrollFade className="min-w-0 w-full flex-1" scrollKey={activeTab}>
                            <TabsList className="bg-transparent cursor-pointer p-0 h-auto flex w-max flex-nowrap items-center shrink-0">
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
                                                className={`relative whitespace-nowrap px-5 py-2 text-xs font-bold border-0 shadow-none transition-all duration-200 rounded-none sm:px-6 sm:text-sm lg:px-8 data-[state=active]:shadow-none ${isDisabled
                                                        ? "cursor-not-allowed opacity-45"
                                                        : "cursor-pointer"
                                                    } ${isActive ? "tab-pipeline-active" : ""}`}
                                                style={{
                                                    ...(isActive
                                                        ? { color: "#FFFFFF" }
                                                        : {
                                                            backgroundColor: isDark ? '#1C2436' : '#E8F0FE',
                                                            color: isDark ? '#93B4FF' : '#0D2478',
                                                        }),
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
                            </HorizontalScrollFade>
                        </div>

                        {canRenderTabContent ? (
                            <>
                            <LazyTabContent activeTab={activeTab} value="overview" className="mt-6">
                                    <>
                                        <ApplicationSummary applicationId={applicationId} onBack={() => navigate(-1)} />
                                        <ApplicationBasicDetails applicationId={applicationId} />
                                        {canShowSendToUnderwriterButton ? (
                                            <div className="flex justify-end mb-4">
                                                <Button
                                                    type="button"
                                                    variant="default"
                                                    onClick={handleSendToUnderwriter}
                                                    disabled={sendingToUnderwriter}
                                                    className="mt-4 disabled:opacity-40"
                                                >
                                                    {sendingToUnderwriter ? "Sending..." : "Send to Create Offer"}
                                                </Button>
                                            </div>
                                        ) : null}
                                        <div className="mt-6"><CommentSection isUnderwriter={isUnderwriter} readOnly={commentsReadOnly} /></div>
                                    </>
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="documents" className="mt-6">
                                    <ApplicationSummary applicationId={applicationId} onBack={() => navigate(-1)} />

                                    <UploadedDocuments readOnly={uploadedDocumentsReadOnly} />
                                    {canShowSendToUnderwriterButton ? (
                                        <div className="flex justify-end mb-4">
                                            <Button
                                                type="button"
                                                variant="default"
                                                onClick={handleSendToUnderwriter}
                                                disabled={sendingToUnderwriter}
                                                className="mt-4 disabled:opacity-40"
                                            >
                                                {sendingToUnderwriter ? "Sending..." : "Send to Create Offer"}
                                            </Button>
                                        </div>
                                    ) : null}
                                    <div className="mt-6"><CommentSection readOnly={commentsReadOnly} /></div>
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="decision-making" className="mt-6">
                                    <ApplicationSummary onBack={() => navigate(-1)} />
                                    <BankAnalysis
                                        readOnly={pipelineStageReadOnly}
                                        enableCreate={!pipelineStageReadOnly}
                                        showBankStatementUpload={false}
                                    />
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="background-check" className="mt-6">
                                    <BackgroundCheckTab />
                            </LazyTabContent>

                            <LazyTabContent activeTab={activeTab} value="contract" className="mt-6">
                                    <ContractTab readOnly={isAgent || isViewOnlyBrowse} />
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
                            <div className="mt-6 flex min-h-[420px] items-center justify-center rounded-lg border border-border bg-card p-10 shadow-[0px_4px_20px_0px_rgba(0,0,0,0.06)] dark:shadow-[0px_4px_24px_0px_rgba(0,0,0,0.35)]">
                                <div className="flex flex-col items-center gap-3 text-center">
                                    <span className="inline-block h-8 w-8 border-2 border-slate-300 border-t-[var(--brand)] rounded-full animate-spin" />
                                    <p className="text-sm font-semibold text-foreground">Loading application details…</p>
                                    <p className="text-xs text-muted-foreground">Please wait while business and owner information loads.</p>
                                </div>
                            </div>
                        )}
                        {tabStepFooter}
                    </Tabs>
                )}
            </div>
        </div>
    );
};

export default ApplicationDetails;
