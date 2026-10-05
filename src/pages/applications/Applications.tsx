import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Plus,
  Clock,
  Loader2,
  AlertCircle,
  Trash2,
  Undo2,
  EyeIcon,
  LayoutGrid,
  LayoutList,
  ArrowLeft,
  TrendingUp,
  CheckCircle2,
  FileInput,
  Send,
} from "lucide-react";
import ApplicationProgressBar from "@/components/application/ApplicationProgressBar";
import { motion } from "framer-motion";
import { useLocation, useNavigate } from "react-router";
import { useState, useMemo, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import {
  claimUnderwriterDeal,
  getApplications,
  getApplicationStats,
  deleteApplication,
  permanentlyDeleteApplication,
  restoreApplication,
  extractBusinessDetails,
} from "@/redux/actions/applicationActions";
import {
  resetDeleteApplication,
} from "@/redux/slices/applicationSlice";
import { fetchOperationsDashboardSummary } from "@/redux/actions/operationsDashboardActions";

import { toast } from "react-toastify";
import type { Application, GetApplicationsParams } from "@/types/applicationTypes";
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type PaginationState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { DataTableContent, DataTablePagination, DataTableSortHeader } from "@/components/DataTable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { user } from "@/redux/slices/authSlice";
import { useTheme } from "@/context/ThemeContext";
import {
  cn,
  formatCurrency,
  formatDate as formatDateUtil,
  formatDateTimeUS as formatDateTimeUSUtil,
  formatInt,
} from "@/lib/utils";
import ApplicationDetailsSheet from "@/components/application/ApplicationDetailsSheet";
import { getClientByClientId } from "@/redux/actions/clientActions";
import {
  normalizeOperationsDashboardStatusParam,
  OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
  OPERATIONS_DASHBOARD_PER_ROW_STATUS_FILTERS,
  inferOperationsListStatusFromApplication,
  operationsDashboardStatusTitle,
} from "@/constants/operationsDashboardApplications";
import {
  buildOperationsPipelineApplicationsUrl,
  buildUnderwriterPipelineApplicationsUrl,
} from "@/constants/dashboardApplicationsNavigation";
import {
  applicationsListParamsCacheKey,
  invalidateApplicationsListCache,
  markApplicationsCreatedRefresh,
} from "@/lib/applicationsListCache";
import { invalidateDashboardData } from "@/lib/invalidateDashboardData";
import { useApplicationsListQuery } from "@/hooks/useApplicationsListQuery";
import {
  parseApplicationsListRouteFilters,
  parseUnderwriterClaimFromSearch,
  poolTabFromUnderwriterClaim,
  underwriterClaimFromPoolTab,
  type ScrubberPoolTab,
  type UnderwriterClaimParam,
  buildApplicationsListParams,
  applicationsListSortFromTable,
} from "@/lib/applicationsListParams";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { prefetchApplicationDetail } from "@/lib/applicationDetailCache";
import { getOperationsPipelineStageTabId } from "@/constants/operationsPipelineTabs";
import { getApplicationQueueBadgeClass as getSharedApplicationQueueBadgeClass } from "@/lib/applicationQueueBadge";
import { getApplicationSummaryStatusLabel } from "@/lib/applicationSummaryStatus";
import {
  canViewApplicationApprovedAmount,
} from "@/lib/applicationClaimLabel";
import { getApplicationBusinessDisplayName } from "@/lib/applicationBusinessDisplayName";
import { resolveApplicationRequestAmount } from "@/lib/applicationLoanAmount";
import { ApplicationStatusFilterDropdown } from "@/components/application/ApplicationStatusFilterDropdown";
import {
  normalizeRoleKey,
  resolveEffectiveRole,
} from "@/lib/sessionRole";
import { getApplicationApprovedAmount } from "@/lib/applicationOfferAmount";
import {
  getReinitiateContractIsoDecisionLabel,
  isIsoUpdatedOfferApproved,
} from "@/lib/contractReinitiation";
import { formatFinalApprovalSourceLabel } from "@/lib/finalApprovalSource";
import FinalApprovalSourceBadge from "@/components/application/FinalApprovalSourceBadge";
import { CornerSummaryCard } from "@/pages/commissionPortal/CornerSummaryCard";
import { isShellPrefetchFresh } from "@/lib/prefetchFreshness";
import SendLetterModal from "@/pages/letterGenerator/SendLetterModal";

type ApplicationsSummaryCard = {
  label: string;
  value: number;
  helper: string;
  subtitle?: string;
  icon: ReactNode;
  operationsStatus: string;
};

/** List/table: imported `dealId` when set, otherwise business `applicationId`. */
function getApplicationDealIdDisplay(app: Application): string {
  const raw = app.dealId?.trim();
  if (raw) return raw;
  if (app.applicationId != null) return String(app.applicationId);
  return "-";
}

const APPLICATIONS_VIEW_MODE_STORAGE_KEY = "applicationsListViewMode";

export type ApplicationsProps = {
  /** Letter generator: same table as Applications; row opens send-letter flow. */
  mode?: "default" | "letterGenerator";
};

const Applications = ({ mode = "default" }: ApplicationsProps) => {
  const isLetterGeneratorMode = mode === "letterGenerator";
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionRoleKey = normalizeRoleKey(localStorage.getItem("role") || "");
  const loginData = useSelector((state: RootState) => state.login.data);
  const loginUser = loginData?.user;
  const effectiveRoleKey = normalizeRoleKey(resolveEffectiveRole(loginUser));
  /** Ops/admin + Scrubbing — show approved offer amount alongside request amount. */
  const showApprovedAmountColumn = canViewApplicationApprovedAmount(effectiveRoleKey);

  const getApplicationClientId = useCallback((application: Application): string | null => {
    const client = application?.client;
    if (!client) return null;
    if (typeof client === "string") return client;
    if (client.clientId != null) return String(client.clientId);
    if (client._id) return String(client._id);
    return null;
  }, []);

  const prefetchClientForApplication = useCallback(
    async (application: Application) => {
      const clientId = getApplicationClientId(application);
      if (clientId) {
        try {
          await dispatch(getClientByClientId(clientId)).unwrap();
        } catch {
          // Open drawer/modal even if prefetch fails; component handles fallback loading state.
        }
      }
    },
    [dispatch, getApplicationClientId],
  );

  const handleOpenApplicationDetails = useCallback(
    async (application: Application) => {
      await prefetchClientForApplication(application);
      setViewApplication(application);
    },
    [prefetchClientForApplication],
  );

  const isOperationsDashboardView =
    new URLSearchParams(location.search).get("fromDashboard") === "operations";

  const showUwDealPoolUi =
    sessionRoleKey === "SCRUBBING" && !isOperationsDashboardView;

  // Local state (URL-derived defaults avoid a blank frame before the first list fetch)
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 350);
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    parseApplicationsListRouteFilters(location.search).statusFilter,
  );
  const [dashboardStateFilter, setDashboardStateFilter] = useState<string>(() =>
    parseApplicationsListRouteFilters(location.search).dashboardStateFilter,
  );

  const isRecentlyDeletedView = useMemo(() => {
    return (
      isOperationsDashboardView &&
      normalizeOperationsDashboardStatusParam(dashboardStateFilter) ===
        "Recently_Deleted"
    );
  }, [isOperationsDashboardView, dashboardStateFilter]);

  const [isListFilterInitialized, setIsListFilterInitialized] = useState(true);
  /** Scrubber inbox: Queue / Claimed / My deals. */
  const [underwriterPoolTab, setUnderwriterPoolTab] = useState<ScrubberPoolTab>(
    () => poolTabFromUnderwriterClaim(parseUnderwriterClaimFromSearch(location.search)),
  );
  const resolveUwClaimParam = useCallback((): UnderwriterClaimParam => {
    return underwriterClaimFromPoolTab(underwriterPoolTab, sessionRoleKey);
  }, [sessionRoleKey, underwriterPoolTab]);
  const [claimBusyAppId, setClaimBusyAppId] = useState<string | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [permanentDeleteLoading, setPermanentDeleteLoading] = useState(false);
  const [sendLetterApplication, setSendLetterApplication] =
    useState<Application | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isExtractingPDF, setIsExtractingPDF] = useState(false);
  const [showAlreadyExistsDialog, setShowAlreadyExistsDialog] = useState(false);
  const [alreadyExistsMessage] = useState<{
    client?: boolean;
    application?: boolean;
  }>({});
  const [partialExtractedData, setPartialExtractedData] = useState<{
    business: Record<string, unknown>;
    owner: Record<string, unknown>;
  } | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const isBulkDeleteRef = useRef(false);
  const fetchApplicationsRef = useRef<(() => Promise<void>) | null>(null);

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState({});
  const [expandedProgressRowId, setExpandedProgressRowId] = useState<
    string | null
  >(null);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [selectedApplicationIds, setSelectedApplicationIds] = useState<string[]>([]);
  const [viewApplication, setViewApplication] = useState<Application | null>(null);
  const [listViewMode, setListViewMode] = useState<"list" | "grid">(() => {
    if (typeof window === "undefined") return "list";
    try {
      const stored = localStorage.getItem(APPLICATIONS_VIEW_MODE_STORAGE_KEY);
      return stored === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(APPLICATIONS_VIEW_MODE_STORAGE_KEY, listViewMode);
    } catch {
      /* ignore */
    }
  }, [listViewMode]);

  // Redux state
  const {
    loading,
    isRefreshing,
    data: applications,
    pagination: apiPagination,
    error,
  } = useSelector((state: RootState) => state.applications);

  const {
    loading: deleteLoading,
    success: deleteSuccess,
    error: deleteError,
  } = useSelector((state: RootState) => state.deleteApplication);

  const {
    summaryCounts,
    summaryAmounts,
    caseStageCounts,
    caseStageAmounts,
    summaryLoading,
    summaryRefreshing,
    hasLoadedSummaryOnce,
    lastSummaryFetchedAt,
  } = useSelector((state: RootState) => state.operationsDashboard);
  const statsLastFetchedAt = useSelector(
    (state: RootState) => state.applicationStats.lastFetchedAt,
  );
  const statsData = useSelector((state: RootState) => state.applicationStats.data);

  const summaryPrefetchFresh =
    hasLoadedSummaryOnce && isShellPrefetchFresh(lastSummaryFetchedAt);
  const statCardsShowSkeleton =
    !hasLoadedSummaryOnce || (summaryLoading && !summaryRefreshing);

  useQuery({
    queryKey: ["operations-dashboard-summary", sessionRoleKey],
    queryFn: async () => dispatch(fetchOperationsDashboardSummary()).unwrap(),
    enabled: !isOperationsDashboardView && !summaryPrefetchFresh,
    staleTime: 60_000,
    refetchOnMount: !summaryPrefetchFresh,
    refetchOnWindowFocus: false,
  });

  // Handle PDF file selection
  const handlePDFFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        if (file.type !== "application/pdf") {
          toast.error("Please select a PDF file");
          return;
        }
        setPdfFile(file);
      }
    },
    [],
  );

  // Handle PDF extraction
  const handleExtractBusinessDetails = useCallback(async () => {
    if (!pdfFile) {
      toast.error("Please select a PDF file first");
      return;
    }

    setIsExtractingPDF(true);
    try {
      const result = (await dispatch(extractBusinessDetails(pdfFile) as any)) as {
        payload?: any;
        meta: { requestStatus: "fulfilled" | "rejected" };
      };

      if (result.meta.requestStatus !== "fulfilled") {
        toast.error(
          (result as any)?.payload ||
          "Failed to extract business details from PDF",
        );
        return;
      }

      const rawPayload = result.payload || {};
      const data = rawPayload.data || rawPayload;

      if (!data) {
        toast.error("No data could be extracted from the PDF");
        return;
      }

      const business = data.business || {};
      const owner = data.owner || {};

      const prefilledClientData = {
        business: {
          name: business.business_name || "",
          email: business.email || "",
          number: business.business_telephone || business.telephone || "",
          website: business.website || business.bussiness_website || "",
          incorporationDate: business.incorporation_date || "",
          incorporationState:
            business.incorporation_state || business.state || "",
          businessEntityType:
            business.type_of_entity || business.business_entity_type || "",
          einNumber: business.ein_number || "",
          monthlyRevenue:
            business.business_monthly_revenue ||
            business.gross_annual_sales ||
            "",
          address: {
            address1: business.business_address || "",
            address2: "",
            city: business.business_city || business.city || "",
            state: business.business_state || business.state || "",
            zipCode: business.business_zip || business.zip || "",
          },
        },
        owner: {
          firstName: owner.owner_first_name || "",
          middleName: owner.owner_middle_name || "",
          lastName: owner.owner_last_name || "",
          email: owner.owner_email || "",
          mobileNumber: owner.phone || owner.owner_home || "",
          dateOfBirth: owner.date_of_birth || "",
          ssn: owner.ssn || "",
          ficoScore: owner.fico_score || "",
          ownershipStartDate: owner.ownership_start_date || "",
          ownershipPercentage: owner.ownership_percentage || "",
          address: {
            address1: owner.owner_home_address || "",
            address2: "",
            city: owner.owner_city || "",
            state: owner.owner_state || "",
            zipCode: owner.owner_zip || "",
          },
        },
      };

      toast.success("PDF parsed. Prefilling client form...");

      // Navigate directly to Create Client with prefilled data
      navigate("/create-clients", { state: { prefilledClientData } });

      setPdfFile(null);
      if (pdfInputRef.current) {
        pdfInputRef.current.value = "";
      }
    } catch (error) {
      toast.error("Failed to extract business details");
    } finally {
      setIsExtractingPDF(false);
    }
  }, [pdfFile, dispatch, navigate]);

  // Format date (Month Day, Year)
  const formatDate = useCallback((dateString?: string) => {
    return formatDateUtil(dateString ?? "", "-");
  }, []);

  const formatDateTime = useCallback((dateString?: string) => {
    return formatDateTimeUSUtil(dateString ?? "", "-");
  }, []);

  const getApplicationQueueLabel = useCallback((application: Application): string => {
    return getApplicationSummaryStatusLabel(application);
  }, []);

  const getApplicationQueueBadgeClass = useCallback(
    (queueLabel: string) => getSharedApplicationQueueBadgeClass(queueLabel),
    [],
  );

  const handleNavigateToApplication = useCallback(
    (app: Application, options?: { tab?: string }) => {
      const role = (localStorage.getItem("role") || "").toUpperCase();
      const usePipelineTabs =
        role === "OPERATIONS" ||
        role === "SUPER_ADMIN" ||
        role === "SUPERADMIN";
      const id =
        app.applicationId != null ? String(app.applicationId) : app._id;
      const qs = new URLSearchParams();
      if (
        usePipelineTabs &&
        dashboardStateFilter &&
        dashboardStateFilter !== OPERATIONS_APPLICATIONS_LIST_ALL_QUERY &&
        dashboardStateFilter.toLowerCase() !== "all"
      ) {
        qs.set("operationsStatus", dashboardStateFilter);
      }
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      let tab = options?.tab;

      // Contract-workflow sidebar deep-links
      const workflow = new URLSearchParams(location.search).get("workflow");
      if (!tab && workflow === "offer") tab = "decision-making";
      if (!tab && (workflow === "contract" || workflow === "ach")) tab = "contract";

      if (
        !tab &&
        usePipelineTabs &&
        dashboardStateFilter &&
        dashboardStateFilter !== OPERATIONS_APPLICATIONS_LIST_ALL_QUERY &&
        dashboardStateFilter.toLowerCase() !== "all"
      ) {
        const normalizedStatus =
          normalizeOperationsDashboardStatusParam(dashboardStateFilter);
        if (normalizedStatus) {
          tab = getOperationsPipelineStageTabId(normalizedStatus);
        }
      }
      const tabSegment = tab ? `/${tab}` : "";
      navigate(`/application-details/${id}${tabSegment}${suffix}`, {
        state: { applicationPreview: app },
      });
    },
    [dashboardStateFilter, navigate, location.search],
  );

  const handleUwClaimDeal = useCallback(
    async (app: Application) => {
      const id = app._id ?? (app as { id?: string }).id;
      if (!id) return;
      try {
        setClaimBusyAppId(String(id));
        await dispatch(claimUnderwriterDeal({ applicationId: String(id) })).unwrap();
        toast.success("Deal claimed");
        void dispatch(fetchOperationsDashboardSummary());
        handleNavigateToApplication(app, { tab: "decision-making" });
      } catch (e: unknown) {
        const msg =
          typeof e === "string"
            ? e
            : (e as { payload?: string })?.payload ||
              (e as { message?: string })?.message ||
              "Could not claim this deal";
        toast.error(msg);
      } finally {
        setClaimBusyAppId(null);
      }
    },
    [dispatch, handleNavigateToApplication],
  );

  const handlePrefetchApplicationDetail = useCallback((app: Application) => {
    const id =
      app.applicationId != null ? String(app.applicationId) : String(app._id ?? "");
    if (id) prefetchApplicationDetail(id);
    void import("@/pages/applications/applicationDetails/ApplicationDetails");
  }, []);

  const handleToggleApplicationProgress = useCallback((rowId: string) => {
    setExpandedProgressRowId((prev) => (prev === rowId ? null : rowId));
  }, []);

  const showReinitiateContractIsoDecisionColumn = useMemo(() => {
    const normalizedStatus = normalizeOperationsDashboardStatusParam(dashboardStateFilter);
    return (
      (effectiveRoleKey === "SUPER_ADMIN" || effectiveRoleKey === "OPERATIONS") &&
      normalizedStatus === "Reinitiate_Contract"
    );
  }, [dashboardStateFilter, effectiveRoleKey]);

  const showFinalApprovalSourceColumn = useMemo(() => {
    const normalizedStatus = normalizeOperationsDashboardStatusParam(dashboardStateFilter);
    return (
      (effectiveRoleKey === "SUPER_ADMIN" || effectiveRoleKey === "OPERATIONS") &&
      normalizedStatus === "Final_Approval"
    );
  }, [dashboardStateFilter, effectiveRoleKey]);

  const handleRestoreApplications = useCallback(
    async (ids: string[]) => {
      const validIds = ids.filter(
        (id) => typeof id === "string" && id.length > 0 && id !== "undefined",
      );
      if (validIds.length === 0) return;

      const confirmed = window.confirm(
        validIds.length === 1
          ? "Restore this application to its previous state?"
          : `Restore ${validIds.length} selected application(s) to their previous state?`,
      );
      if (!confirmed) return;

      setRestoreLoading(true);
      try {
        await Promise.all(
          validIds.map((id) => dispatch(restoreApplication(id)).unwrap()),
        );
        toast.success(
          validIds.length === 1
            ? "Application restored to previous state!"
            : `${validIds.length} applications restored to previous state!`,
        );
        setRowSelection({});
        void fetchApplicationsRef.current?.();
        dispatch(getApplicationStats());
        void dispatch(fetchOperationsDashboardSummary());
      } catch (err: unknown) {
        const message =
          typeof err === "string"
            ? err
            : err && typeof err === "object" && "message" in err
              ? String((err as { message: string }).message)
              : "Failed to restore application(s)";
        toast.error(message);
        void fetchApplicationsRef.current?.();
      } finally {
        setRestoreLoading(false);
      }
    },
    [dispatch],
  );

  // Define columns
  const columns: ColumnDef<Application>[] = useMemo(() => {
    const selectColumn: ColumnDef<Application> = {
      id: "select",
      size: 48,
      header: ({ table }) => (
        <input
          type="checkbox"
          className="size-4 rounded border-border text-blue-600 cursor-pointer"
          checked={table.getIsAllPageRowsSelected()}
          ref={(input) => {
            if (input) {
              input.indeterminate = table.getIsSomePageRowsSelected();
            }
          }}
          onChange={(e) => table.toggleAllPageRowsSelected(e.target.checked)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="size-4 rounded border-gray-300 text-blue-600 cursor-pointer"
          checked={row.getIsSelected()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => row.toggleSelected(e.target.checked)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    };

    const bodyColumns: ColumnDef<Application>[] = [
      {
        id: "dealId",
        size: 100,
        accessorFn: (row) => getApplicationDealIdDisplay(row),
        enableSorting: true,
        header: ({ column }) => (
          <DataTableSortHeader column={column} label="DEAL ID" />
        ),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {getApplicationDealIdDisplay(row.original)}
          </span>
        ),
      },
      {
        id: "businessName",
        size: 160,
        maxSize: 180,
        accessorFn: (row) => getApplicationBusinessDisplayName(row),
        enableSorting: true,
        header: ({ column }) => (
          <DataTableSortHeader column={column} label="BUSINESS NAME" />
        ),
        cell: ({ row }) => (
          <span className="block truncate text-foreground" title={getApplicationBusinessDisplayName(row.original)}>
            {getApplicationBusinessDisplayName(row.original)}
          </span>
        ),
      },
      {
        id: "seeProgress",
        size: 88,
        maxSize: 96,
        header: () => (
          <span className="font-medium text-foreground uppercase tracking-wide whitespace-nowrap">
            Progress
          </span>
        ),
        cell: ({ row }) => {
          const isOpen = expandedProgressRowId === row.id;
          return (
            <motion.button
              type="button"
              data-row-click-ignore
              onClick={(e) => {
                e.stopPropagation();
                handleToggleApplicationProgress(row.id);
              }}
              className={cn(
                "inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50",
                isOpen
                  ? "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-md shadow-amber-500/30"
                  : "bg-amber-50 text-amber-500 hover:bg-amber-100 hover:text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950/60",
              )}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: "spring", stiffness: 420, damping: 24 }}
              aria-label={
                isOpen
                  ? "Hide application progress"
                  : "See application progress"
              }
              aria-expanded={isOpen}
              title={isOpen ? "Hide progress" : "See progress"}
            >
              <TrendingUp
                className="h-5 w-5 drop-shadow-sm"
                strokeWidth={2.75}
                aria-hidden
              />
            </motion.button>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: "loanAmount",
        size: 160,
        accessorFn: (row) => resolveApplicationRequestAmount(row),
        enableSorting: true,
        header: ({ column }) => (
          <DataTableSortHeader column={column} label="Request Amount" />
        ),
        cell: ({ row }) => {
          const loanAmount = resolveApplicationRequestAmount(row.original);
          if (loanAmount == null) {
            return <span className="text-foreground">-</span>;
          }
          return (
            <span className="text-foreground">
              {formatCurrency(loanAmount)}
            </span>
          );
        },
      },
      ...(showApprovedAmountColumn
        ? ([
          {
            id: "approvedAmount",
            size: 170,
            accessorFn: (row) => getApplicationApprovedAmount(row),
            header: () => (
              <span className="font-medium text-foreground uppercase tracking-wide">
                Approved Amount
              </span>
            ),
            cell: ({ row }) => {
              const approvedAmount = getApplicationApprovedAmount(row.original);
              if (approvedAmount == null) {
                return <span className="text-foreground">-</span>;
              }
              return (
                <span className="text-foreground">
                  {formatCurrency(approvedAmount)}
                </span>
              );
            },
          },
        ] satisfies ColumnDef<Application>[])
        : []),
      ...(showReinitiateContractIsoDecisionColumn
        ? ([
          {
            id: "isoDecision",
            size: 140,
            accessorFn: (row) => getReinitiateContractIsoDecisionLabel(row),
            header: () => (
              <span className="font-medium text-foreground uppercase tracking-wide whitespace-nowrap">
                ISO Decision
              </span>
            ),
            cell: ({ row }) => {
              const label = getReinitiateContractIsoDecisionLabel(row.original);
              const isApproved = label === "Approved";
              return (
                <span
                  className={
                    isApproved
                      ? "font-medium text-green-700 dark:text-green-400"
                      : "text-foreground"
                  }
                >
                  {label}
                </span>
              );
            },
            enableSorting: false,
          },
        ] satisfies ColumnDef<Application>[])
        : []),
      ...(showFinalApprovalSourceColumn
        ? ([
          {
            id: "finalApprovalSource",
            size: 150,
            minSize: 130,
            accessorFn: (row) =>
              formatFinalApprovalSourceLabel(row.finalApprovalSource) ?? "",
            header: () => (
              <span className="font-medium text-foreground uppercase tracking-wide whitespace-nowrap">
                Source
              </span>
            ),
            cell: ({ row }) => {
              const label = formatFinalApprovalSourceLabel(
                row.original.finalApprovalSource,
              );
              if (!label) {
                return <span className="text-foreground">-</span>;
              }
              return (
                <FinalApprovalSourceBadge
                  source={row.original.finalApprovalSource}
                  variant="compact"
                />
              );
            },
            enableSorting: false,
          },
        ] satisfies ColumnDef<Application>[])
        : []),
      // {
      //     accessorKey: 'priority',
      //     header: ({ column }) => (
      //         <div className="flex items-center gap-2">
      //             <span className="font-medium text-foreground">PRIORITY</span>
      //             <Button
      //                 variant="ghost"
      //                 className="p-0 h-auto font-medium text-foreground hover:bg-transparent hover:text-foreground cursor-pointer"
      //                 onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      //             >
      //                 <ArrowUpDown className=" h-3 w-3" />
      //             </Button>
      //         </div>
      //     ),
      //     cell: ({ row }) => {
      //         const priority = row.original.priority
      //         return (
      //             <span
      //                 className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${priority === 'Urgent'
      //                     ? 'bg-red-100 text-red-700'
      //                     : priority === 'High'
      //                         ? 'bg-orange-100 text-orange-700'
      //                         : priority === 'Medium'
      //                             ? 'bg-yellow-100 text-yellow-700'
      //                             : 'bg-muted/50 text-foreground'
      //                     }`}
      //             >
      //                 {priority || '-'}
      //             </span>
      //         )
      //     },
      // },
      // {
      //     accessorKey: 'type',
      //     header: 'TYPE',
      //     cell: ({ row }) => <span className="text-foreground capitalize">{row.original.type || '-'}</span>,
      // },
      {
        id: "status",
        size: 170,
        accessorFn: (row) =>
          getApplicationQueueLabel(row),
        enableSorting: true,
        header: ({ column }) => (
          <DataTableSortHeader column={column} label="Current State" />
        ),
        cell: ({ row }) => {
          let queueLabel = getApplicationQueueLabel(row.original);

          if (isOperationsDashboardView && dashboardStateFilter) {
            const normalized = normalizeOperationsDashboardStatusParam(
              dashboardStateFilter,
            );
            if (
              normalized &&
              OPERATIONS_DASHBOARD_PER_ROW_STATUS_FILTERS.has(normalized)
            ) {
              const inferred = inferOperationsListStatusFromApplication(
                row.original.currentQueue ?? row.original.queue,
                {
                  explicitStatus: row.original.status,
                  currentState:
                    row.original.currentState ?? row.original.state,
                },
              );
              if (inferred) {
                queueLabel = operationsDashboardStatusTitle(inferred);
              }
            } else if (normalized) {
              queueLabel = operationsDashboardStatusTitle(normalized);
            }
          }

          return (
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${getApplicationQueueBadgeClass(queueLabel)}`}
            >
              {queueLabel}
            </span>
          );
        },
      },
      {
        id: "createdAt",
        size: 170,
        accessorKey: "createdAt",
        enableSorting: true,
        header: ({ column }) => (
          <DataTableSortHeader column={column} label="CREATED AT" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "lastModifiedAt",
        size: 170,
        accessorKey: "updatedAt",
        enableSorting: true,
        header: ({ column }) => (
          <DataTableSortHeader column={column} label="Last Modified Date" />
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {formatDate(row.original.updatedAt ?? row.original.createdAt)}
          </span>
        ),
      },
      ...(showUwDealPoolUi && underwriterPoolTab === "queue"
        ? ([
          {
            id: "uwClaim",
            size: 110,
            header: () => (
              <span className="font-medium text-foreground uppercase tracking-wide">
                CLAIM
              </span>
            ),
            cell: ({ row }) => {
              const app = row.original;
              const appUuid =
                app._id ?? (app as { id?: string }).id ?? "";
              const busy = claimBusyAppId === String(appUuid);
              return (
                <div
                  className="flex justify-start"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    disabled={!appUuid || busy}
                    onClick={() => void handleUwClaimDeal(app)}
                  >
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      "Claim"
                    )}
                  </Button>
                </div>
              );
            },
            enableSorting: false,
            enableHiding: false,
          },
        ] satisfies ColumnDef<Application>[])
        : []),
      ...(isRecentlyDeletedView
        ? ([
          {
            id: "deletedAt",
            size: 160,
            accessorFn: (row) => row.deletedAt ?? "",
            header: () => (
              <span className="font-medium text-foreground uppercase tracking-wide">
                Deleted On
              </span>
            ),
            cell: ({ row }) => (
              <span className="text-foreground text-sm">
                {row.original.deletedAt
                  ? formatDateTime(row.original.deletedAt)
                  : "—"}
              </span>
            ),
            enableSorting: true,
          },
          {
            id: "recentlyDeletedActions",
            size: 220,
            header: () => (
              <span className="font-medium text-foreground uppercase tracking-wide">
                Actions
              </span>
            ),
            cell: ({ row }) => {
              const app = row.original;
              const appUuid =
                app._id ?? (app as { id?: string }).id ?? "";
              return (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1"
                    disabled={!appUuid}
                    loading={restoreLoading}
                    onClick={() => handleRestoreApplications([String(appUuid)])}
                  >
                    <Undo2 className="size-3.5" />
                    Revert
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-8 text-xs gap-1"
                    disabled={!appUuid}
                    loading={permanentDeleteLoading}
                    onClick={() => {
                      const confirmed = window.confirm(
                        "Permanently delete this application? This cannot be undone.",
                      );
                      if (!confirmed || !appUuid) return;
                      setPermanentDeleteLoading(true);
                      void dispatch(permanentlyDeleteApplication(String(appUuid)))
                        .unwrap()
                        .then(() => {
                          toast.success("Application permanently deleted!");
                          void fetchApplicationsRef.current?.();
                          dispatch(getApplicationStats());
                        })
                        .catch((err: unknown) => {
                          const message =
                            typeof err === "string"
                              ? err
                              : "Failed to permanently delete application";
                          toast.error(message);
                        })
                        .finally(() => setPermanentDeleteLoading(false));
                    }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </div>
              );
            },
            enableSorting: false,
            enableHiding: false,
          },
        ] satisfies ColumnDef<Application>[])
        : []),
      ...(isLetterGeneratorMode
        ? ([
            {
              id: "sendLetter",
              size: 140,
              header: () => (
                <span className="font-medium text-foreground uppercase tracking-wide">
                  Action
                </span>
              ),
              cell: ({ row }) => (
                <div
                  className="flex justify-start"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="success"
                    className="h-8 gap-1.5 cursor-pointer"
                    onClick={() => setSendLetterApplication(row.original)}
                  >
                    <Send className="size-3.5" />
                    Send Letter
                  </Button>
                </div>
              ),
              enableSorting: false,
              enableHiding: false,
            },
          ] satisfies ColumnDef<Application>[])
        : []),
      {
        id: "view",
        size: 72,
        header: () => (
          <span className="flex w-full justify-center font-medium text-foreground uppercase tracking-wide">
            VIEW
          </span>
        ),
        cell: ({ row }) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenApplicationDetails(row.original);
            }}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-transparent text-[var(--brand)] hover:bg-transparent hover:text-[var(--brand-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30 cursor-pointer"
            aria-label="View application in drawer"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-current bg-transparent text-xs font-bold">
              <EyeIcon className="h-4 w-4" />
            </span>
          </button>
        ),
        enableSorting: false,
        enableHiding: false,
      },
    ];

    return [selectColumn, ...bodyColumns];
  }, [
    formatDate,
    formatDateTime,
    getApplicationQueueBadgeClass,
    getApplicationBusinessDisplayName,
    getApplicationQueueLabel,
    handleNavigateToApplication,
    handleOpenApplicationDetails,
    expandedProgressRowId,
    handleToggleApplicationProgress,
    showUwDealPoolUi,
    showApprovedAmountColumn,
    showReinitiateContractIsoDecisionColumn,
    showFinalApprovalSourceColumn,
    underwriterPoolTab,
    claimBusyAppId,
    handleUwClaimDeal,
    effectiveRoleKey,
    isOperationsDashboardView,
    dashboardStateFilter,
    isRecentlyDeletedView,
    handleRestoreApplications,
    restoreLoading,
    permanentDeleteLoading,
    dispatch,
    isLetterGeneratorMode,
  ]);

  const totalItems = apiPagination?.total ?? applications?.length ?? 0;
  const pageCount =
    apiPagination?.totalPages ??
    (Math.ceil(totalItems / pagination.pageSize) || 1);

  const table = useReactTable({
    data: applications ?? [],
    columns,
    pageCount,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination,
    },
    getRowId: (row) => {
      const rid = row._id ?? (row as { id?: string }).id;
      if (rid) return String(rid);
      return row.applicationId != null
        ? `missing-uuid-app-${row.applicationId}`
        : "missing-uuid-row";
    },
  });

  // Keep selected application IDs (_id) in state for bulk delete
  useEffect(() => {
    setSelectedApplicationIds(Object.keys(rowSelection));
  }, [rowSelection]);

  // Normalize operations-dashboard / URL `operationsStatus` to API values.
  const normalizeDashboardState = useCallback((value: string) => {
    const mapped = normalizeOperationsDashboardStatusParam(value);
    return mapped ?? value.trim();
  }, []);

  const listRequestParamsForKey = useMemo((): GetApplicationsParams => {
    const sort = applicationsListSortFromTable(sorting);
    if (showUwDealPoolUi) {
      return buildApplicationsListParams({
        pageIndex: pagination.pageIndex,
        pageSize: pagination.pageSize,
        searchTerm: debouncedSearchTerm,
        dashboardStateFilter: "",
        statusFilter: "all",
        underwriterClaim: resolveUwClaimParam(),
        ...sort,
      });
    }
    return buildApplicationsListParams({
      pageIndex: pagination.pageIndex,
      pageSize: pagination.pageSize,
      searchTerm: debouncedSearchTerm,
      dashboardStateFilter,
      statusFilter,
      underwriterFilter: "all",
      useDashboardStageFilter: isOperationsDashboardView,
      ...sort,
    });
  }, [
    dashboardStateFilter,
    statusFilter,
    isOperationsDashboardView,
    showUwDealPoolUi,
    underwriterPoolTab,
    resolveUwClaimParam,
    pagination.pageIndex,
    pagination.pageSize,
    debouncedSearchTerm,
    sorting,
  ]);

  const listFetchParams = useMemo(
    (): GetApplicationsParams => ({
      ...listRequestParamsForKey,
    }),
    [listRequestParamsForKey],
  );

  const listFetchKey = useMemo(
    () => applicationsListParamsCacheKey(listFetchParams),
    [listFetchParams],
  );

  useEffect(() => {
    setExpandedProgressRowId(null);
  }, [pagination.pageIndex, listFetchKey]);

  useApplicationsListQuery(listFetchParams, {
    enabled: isListFilterInitialized,
  });

  const fetchApplications = useCallback(async () => {
    invalidateApplicationsListCache();
    await dispatch(
      getApplications({ ...listFetchParams, skipListCache: true }),
    ).unwrap();
  }, [dispatch, listFetchParams]);

  fetchApplicationsRef.current = fetchApplications;

  /** After create/update, drop caches once — React Query remount/invalidation reloads the table. */
  useEffect(() => {
    if (!isListFilterInitialized) return;
    const refreshList = Boolean(
      (location.state as { refreshApplicationsList?: boolean } | null)
        ?.refreshApplicationsList,
    );
    if (!refreshList) return;
    // Mark create-refresh so socket `application_created` does not immediately
    // re-invalidate list/stats (avoids duplicate GETs right after navigate).
    markApplicationsCreatedRefresh();
    invalidateApplicationsListCache();
    invalidateDashboardData(dispatch);
    navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: {} },
    );
  }, [
    dispatch,
    isListFilterInitialized,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);

  // Initialize list filter from dashboard query params
  useEffect(() => {
    const query = new URLSearchParams(location.search);

    const uwClaim = query.get("underwriterClaim");
    if (uwClaim === "unclaimed" || uwClaim === "claimed" || uwClaim === "mine") {
      setUnderwriterPoolTab(poolTabFromUnderwriterClaim(uwClaim));
      setDashboardStateFilter("");
      setStatusFilter("all");

      if (pagination.pageIndex !== 0) {
        setPagination((prev) => ({ ...prev, pageIndex: 0 }));
        return;
      }

      setIsListFilterInitialized(true);
      return;
    }

    const operationsStatusFromQuery =
      query.get("operationsStatus") || query.get("currentState");
    const fromDashboard = query.get("fromDashboard");

    if (fromDashboard === "operations" && operationsStatusFromQuery) {
      const normalizedState = normalizeDashboardState(operationsStatusFromQuery);
      setDashboardStateFilter(normalizedState);
      setStatusFilter("all");

      if (pagination.pageIndex !== 0) {
        setPagination((prev) => ({ ...prev, pageIndex: 0 }));
        return;
      }

      setIsListFilterInitialized(true);
      return;
    }

    setDashboardStateFilter("");
    setStatusFilter("all");

    if (pagination.pageIndex !== 0) {
      setPagination((prev) => ({ ...prev, pageIndex: 0 }));
      return;
    }

    setIsListFilterInitialized(true);
  }, [location.search, normalizeDashboardState]);

  // Complete dashboard-filter initialization after pagination is reset to first page.
  useEffect(() => {
    if (isListFilterInitialized) return;
    if (!dashboardStateFilter) return;
    if (pagination.pageIndex !== 0) return;
    setIsListFilterInitialized(true);
  }, [isListFilterInitialized, dashboardStateFilter, pagination.pageIndex]);

  const handleBulkDelete = useCallback(async () => {
    const idsToDelete = selectedApplicationIds.filter(
      (id) => typeof id === "string" && id.length > 0 && id !== "undefined",
    );
    if (idsToDelete.length === 0) return;
    const confirmed = window.confirm(
      `Move ${idsToDelete.length} selected application(s) to Recently Deleted?`,
    );
    if (!confirmed) return;

    isBulkDeleteRef.current = true;
    try {
      await Promise.all(
        idsToDelete.map((id) => dispatch(deleteApplication(id)).unwrap()),
      );
      toast.success(
        idsToDelete.length === 1
          ? "Application moved to Recently Deleted!"
          : `${idsToDelete.length} applications moved to Recently Deleted!`,
      );
      dispatch(resetDeleteApplication());
      setRowSelection({});
      if (
        viewApplication &&
        idsToDelete.includes(
          String(viewApplication._id ?? (viewApplication as { id?: string }).id ?? ""),
        )
      ) {
        setViewApplication(null);
      }
      fetchApplications();
      dispatch(getApplicationStats());
      void dispatch(fetchOperationsDashboardSummary());
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to delete some applications";
      toast.error(message);
      dispatch(resetDeleteApplication());
      fetchApplications();
      setRowSelection({});
    } finally {
      isBulkDeleteRef.current = false;
    }
  }, [
    selectedApplicationIds,
    dispatch,
    fetchApplications,
    viewApplication,
    sessionRoleKey,
  ]);

  const handleBulkPermanentDelete = useCallback(async () => {
    const idsToDelete = selectedApplicationIds.filter(
      (id) => typeof id === "string" && id.length > 0 && id !== "undefined",
    );
    if (idsToDelete.length === 0) return;
    const confirmed = window.confirm(
      `Permanently delete ${idsToDelete.length} selected application(s)? This cannot be undone.`,
    );
    if (!confirmed) return;

    setPermanentDeleteLoading(true);
    try {
      await Promise.all(
        idsToDelete.map((id) => dispatch(permanentlyDeleteApplication(id)).unwrap()),
      );
      toast.success(
        idsToDelete.length === 1
          ? "Application permanently deleted!"
          : `${idsToDelete.length} applications permanently deleted!`,
      );
      setRowSelection({});
      if (
        viewApplication &&
        idsToDelete.includes(
          String(viewApplication._id ?? (viewApplication as { id?: string }).id ?? ""),
        )
      ) {
        setViewApplication(null);
      }
      fetchApplications();
      dispatch(getApplicationStats());
    } catch (err: unknown) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Failed to permanently delete some applications";
      toast.error(message);
      fetchApplications();
      setRowSelection({});
    } finally {
      setPermanentDeleteLoading(false);
    }
  }, [
    selectedApplicationIds,
    dispatch,
    fetchApplications,
    viewApplication,
    sessionRoleKey,
  ]);

  // Fetch stats only when the shell snapshot is stale.
  useEffect(() => {
    if (statsData && isShellPrefetchFresh(statsLastFetchedAt)) return;
    dispatch(getApplicationStats());
  }, [dispatch, statsData, statsLastFetchedAt]);

  // Handle delete success/error (single delete only; bulk delete shows one toast in handleBulkDelete)
  useEffect(() => {
    if (deleteSuccess) {
      if (isBulkDeleteRef.current) {
        dispatch(resetDeleteApplication());
        return;
      }
      toast.success("Application moved to Recently Deleted!");
      dispatch(resetDeleteApplication());
      fetchApplications();
      dispatch(getApplicationStats());
      void dispatch(fetchOperationsDashboardSummary());
    }
    if (deleteError) {
      toast.error(deleteError);
      dispatch(resetDeleteApplication());
    }
  }, [
    deleteSuccess,
    deleteError,
    dispatch,
    fetchApplications,
    sessionRoleKey,
  ]);

  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [searchTerm]);

  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
    setRowSelection({});
  }, [dashboardStateFilter, statusFilter, underwriterPoolTab]);

  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [sorting]);

  // static -----------------------------------------------
  const [user, setUser] = useState<user>();

  useEffect(() => {
    setUser(loginData?.user);
    if (!loginData?.user) {
      const storedUser = localStorage.getItem("user");
      if (storedUser) {
        setUser(JSON.parse(storedUser));
      }
    }
  }, [loginData, loading]);

  const userRole = resolveEffectiveRole(user);
  const roleKey = normalizeRoleKey(userRole);
  const isSuperAdmin = roleKey === "SUPER_ADMIN";
  const canCreateNewApplication =
    roleKey === "AGENT" || isSuperAdmin;
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const sectionShadowClass =
    "shadow-[0px_10px_28px_0px_rgba(2,6,23,0.10)]";

  const showStatusFilterDropdown =
    !isOperationsDashboardView && !showUwDealPoolUi;

  const showOperationsFilterBack =
    Boolean(dashboardStateFilter) &&
    dashboardStateFilter !== OPERATIONS_APPLICATIONS_LIST_ALL_QUERY &&
    dashboardStateFilter.toLowerCase() !== "all";

  const operationsHeadingTitle = useMemo(() => {
    if (!isOperationsDashboardView) return "";
    if (
      !dashboardStateFilter ||
      dashboardStateFilter === OPERATIONS_APPLICATIONS_LIST_ALL_QUERY ||
      dashboardStateFilter.toLowerCase() === "all"
    ) {
      return "ALL APPLICATIONS";
    }
    const normalizedStatus = normalizeOperationsDashboardStatusParam(dashboardStateFilter);
    if (normalizedStatus === "Contract_Generated") {
      return "Contract Generated Application";
    }
    if (normalizedStatus === "Contract_Sent" || normalizedStatus === "Contract_Out") {
      return "Contract Sent Application";
    }
    if (normalizedStatus === "Contract_Cancelled") {
      return "Contract Cancelled Application";
    }
    if (normalizedStatus === "Contract_Signed") {
      return "Contract Signed Application";
    }
    if (normalizedStatus === "Reinitiate_Contract") {
      return "Contract Pending Application";
    }
    if (normalizedStatus === "Contracted") {
      return "CONTRACT APPLICATIONS";
    }
    if (normalizedStatus === "Recently_Deleted") {
      return "RECENTLY DELETED APPLICATIONS";
    }
    const label = normalizedStatus
      ? operationsDashboardStatusTitle(normalizedStatus)
      : dashboardStateFilter;
    return `${label.toUpperCase()} APPLICATIONS`;
  }, [dashboardStateFilter, isOperationsDashboardView]);

  const handleOperationsPipelineBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  /** Same contract-workflow KPI tiles as OperationsDashboard. */
  const summaryCards: ApplicationsSummaryCard[] = useMemo(
    () => [
      {
        label: "Total Applications",
        value: summaryCounts.totalCases,
        helper: "All applications",
        subtitle: "Including all stages",
        icon: <LayoutList className="w-6 h-6 text-emerald-500" />,
        operationsStatus: OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
      },
      {
        label: "Contract Pending",
        value: caseStageCounts.Contract_Pending ?? summaryCounts.contractPending ?? 0,
        helper: "Awaiting contract generation",
        icon: <Clock className="w-6 h-6 text-sky-500" />,
        operationsStatus: "Contract_Pending",
      },
      {
        label: "Contract Sent",
        value: caseStageCounts.Contract_Sent ?? summaryCounts.contractsOut ?? 0,
        helper: "Contracts sent for signature",
        icon: <FileInput className="w-6 h-6 text-emerald-500" />,
        operationsStatus: "Contract_Sent",
      },
      {
        label: "Contract Signed",
        value: caseStageCounts.Contract_Signed ?? summaryCounts.signedContracts ?? 0,
        helper: "Contract signed applications",
        icon: <CheckCircle2 className="w-6 h-6 text-amber-500" />,
        operationsStatus: "Contract_Signed",
      },
    ],
    [
      caseStageCounts.Contract_Pending,
      caseStageCounts.Contract_Sent,
      caseStageCounts.Contract_Signed,
      summaryCounts.contractPending,
      summaryCounts.contractsOut,
      summaryCounts.signedContracts,
      summaryCounts.totalCases,
    ],
  );

  const getSummaryCardAmount = useCallback(
    (card: ApplicationsSummaryCard) => {
      switch (card.operationsStatus) {
        case "Contract_Pending":
          return summaryAmounts.contractPending ?? caseStageAmounts.Contract_Pending ?? 0;
        case "Contract_Sent":
          return summaryAmounts.contractsOut ?? caseStageAmounts.Contract_Sent ?? 0;
        case "Contract_Signed":
          return summaryAmounts.signedContracts ?? caseStageAmounts.Contract_Signed ?? 0;
        default:
          return 0;
      }
    },
    [caseStageAmounts, summaryAmounts],
  );

  const handleSummaryCardClick = useCallback(
    (card: ApplicationsSummaryCard) => {
      navigate(buildOperationsPipelineApplicationsUrl(card.operationsStatus));
    },
    [navigate],
  );

  const contractWorkflow = useMemo(() => {
    const w = new URLSearchParams(location.search).get("workflow");
    if (w === "offer" || w === "contract" || w === "ach") return w;
    return null;
  }, [location.search]);

  const contractWorkflowTitle = useMemo(() => {
    switch (contractWorkflow) {
      case "offer":
        return "Create Offer";
      case "contract":
        return "Create Contract";
      case "ach":
        return "Send ACH Form";
      default:
        return null;
    }
  }, [contractWorkflow]);

  const contractWorkflowHint = useMemo(() => {
    switch (contractWorkflow) {
      case "offer":
        return "Select an application to create or send a terms offer (Create Offer tab).";
      case "contract":
        return "Select an application to generate and send the contract.";
      case "ach":
        return "Select an application to send the ACH authorization form from the Contract tab.";
      default:
        return null;
    }
  }, [contractWorkflow]);

  return (
    <div
      className="min-h-screen bg-background p-4 md:p-6"
    >
      {!isOperationsDashboardView && (
        <div
          className={`flex items-center justify-between p-6 rounded-lg shadow-[0px_4px_20px_0px_#00000005] ${isDark ? "bg-[#141517]" : "bg-white"
            }`}
        >
          <div>
            <h1 className="text-[1.3rem] font-semibold text-foreground uppercase">
              {isLetterGeneratorMode
                ? "Letter Generator"
                : contractWorkflowTitle
                ? contractWorkflowTitle
                : showUwDealPoolUi
                ? "Create Offer applications"
                : "Add Application"}
            </h1>
            {isLetterGeneratorMode ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Choose a deal and send a Zero Balance or Payoff letter.
              </p>
            ) : contractWorkflowHint ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {contractWorkflowHint}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 ${isLetterGeneratorMode ? "hidden" : ""}`}>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handlePDFFileSelect}
              />

              {pdfFile && (
                <Button
                  className="px-4 py-2 gap-2 bg-[image:var(--brand-gradient)] text-white hover:opacity-90 cursor-pointer"
                  onClick={handleExtractBusinessDetails}
                  loading={isExtractingPDF}
                >
                  Upload File
                </Button>
              )}
            </div>
            {!isLetterGeneratorMode && canCreateNewApplication && (
              <Button
                className="px-4 py-2 gap-2 bg-[image:var(--brand-gradient)] text-white hover:opacity-90 cursor-pointer"
                onClick={() => navigate("/create-applications")}
              >
                <Plus className="size-4" />
                New Application
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Stats — same contract-stage cards as OperationsDashboard */}
      {!isOperationsDashboardView && !isLetterGeneratorMode && (
        <section className="mt-6 mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => {
            const countNum = card.value;
            const countSuffix = countNum === 1 ? "Application" : "Applications";
            return (
              <div
                key={card.label}
                role={statCardsShowSkeleton ? undefined : "button"}
                tabIndex={statCardsShowSkeleton ? -1 : 0}
                aria-busy={statCardsShowSkeleton}
                onKeyDown={(e) => {
                  if (statCardsShowSkeleton) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSummaryCardClick(card);
                  }
                }}
                onClick={() => {
                  if (statCardsShowSkeleton) return;
                  handleSummaryCardClick(card);
                }}
                className={`h-full overflow-hidden rounded-xl text-left transition hover:ring-2 hover:ring-[var(--brand)]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 ${sectionShadowClass} ${
                  statCardsShowSkeleton ? "cursor-default" : "cursor-pointer"
                }`}
              >
                <CornerSummaryCard
                  isDark={isDark}
                  title={card.label.toUpperCase()}
                  subtitle={card.subtitle}
                  icon={card.icon}
                  iconSize={22}
                  isLoading={statCardsShowSkeleton}
                  countValue={formatInt(card.value, { fallback: "0" })}
                  countSuffix={countSuffix}
                  footLeft={card.helper}
                  amountValue={formatCurrency(getSummaryCardAmount(card))}
                />
              </div>
            );
          })}
        </section>
      )}

      {isOperationsDashboardView && (
        <section
          className={`rounded-lg border p-4 md:p-5 shadow-[0px_4px_20px_0px_#00000005] ${isDark ? "bg-[#141517] border-[#374151]" : "bg-white border-[#F0F4F8]"
            }`}
        >
          <h1 className="text-[1.2rem] font-semibold text-foreground font-roboto uppercase tracking-wide">
            {operationsHeadingTitle}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and manage applications for this selected status.
          </p>
        </section>
      )}

      <div className="relative z-10 mt-4 flex flex-col lg:flex-row items-stretch lg:items-center gap-3 justify-between">
        <div className="flex flex-wrap items-center gap-3 w-full lg:flex-1 lg:min-w-0">
          {showOperationsFilterBack && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0 bg-card text-muted-foreground"
              onClick={handleOperationsPipelineBack}
              aria-label="Go back"
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}
          {!isLetterGeneratorMode && !isOperationsDashboardView && showUwDealPoolUi ? (
            <div
              className="flex rounded-md border border-border overflow-hidden bg-muted/40 dark:bg-muted/25 shrink-0 p-0.5 gap-0.5"
              role="tablist"
              aria-label="Create Offer deal pool"
            >
              <Button
                type="button"
                variant={underwriterPoolTab === "queue" ? "default" : "ghost"}
                className={cn(
                  "h-9 min-w-[5.5rem] rounded-sm px-3 shadow-none gap-1.5",
                  underwriterPoolTab !== "queue" &&
                    "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setUnderwriterPoolTab("queue");
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }));
                  navigate(
                    buildUnderwriterPipelineApplicationsUrl({
                      underwriterClaim: "unclaimed",
                    }),
                    { replace: true },
                  );
                }}
                aria-pressed={underwriterPoolTab === "queue"}
              >
                <span className="text-xs font-medium sm:text-sm">Queue</span>
              </Button>
              <Button
                type="button"
                variant={underwriterPoolTab === "claimed" ? "default" : "ghost"}
                className={cn(
                  "h-9 min-w-[5.5rem] rounded-sm px-3 shadow-none gap-1.5",
                  underwriterPoolTab !== "claimed" &&
                    "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setUnderwriterPoolTab("claimed");
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }));
                  navigate(
                    buildUnderwriterPipelineApplicationsUrl({
                      underwriterClaim: "claimed",
                    }),
                    { replace: true },
                  );
                }}
                aria-pressed={underwriterPoolTab === "claimed"}
              >
                <span className="text-xs font-medium sm:text-sm">Claimed</span>
              </Button>
              <Button
                type="button"
                variant={underwriterPoolTab === "my" ? "default" : "ghost"}
                className={cn(
                  "h-9 min-w-[5.5rem] rounded-sm px-3 gap-1.5 shadow-none",
                  underwriterPoolTab !== "my" &&
                    "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setUnderwriterPoolTab("my");
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }));
                  navigate(
                    buildUnderwriterPipelineApplicationsUrl({
                      underwriterClaim: "mine",
                    }),
                    { replace: true },
                  );
                }}
                aria-pressed={underwriterPoolTab === "my"}
              >
                <span className="text-xs font-medium sm:text-sm">My Deals</span>
              </Button>
            </div>
          ) : null}
          {showStatusFilterDropdown ? (
            <ApplicationStatusFilterDropdown
              value={statusFilter}
              onChange={(next) => {
                setStatusFilter(next);
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
            />
          ) : null}
          <div className="relative min-w-[12rem] flex-1 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by Deal ID, Name, Email, ISO..."
              className="pl-9 h-10 w-full bg-card"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div
          className="flex items-center gap-2 shrink-0"
          role="group"
          aria-label="Applications display layout"
        >
          <span className="text-xs text-muted-foreground hidden sm:inline">
            View
          </span>
          <div className="flex rounded-md border border-border overflow-hidden bg-card">
            <Button
              type="button"
              variant={listViewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="h-10 sm:h-9 rounded-none px-3 gap-1.5 shadow-none"
              onClick={() => setListViewMode("list")}
              aria-pressed={listViewMode === "list"}
              title="List view"
            >
              <LayoutList className="size-4 shrink-0" />
              <span className="text-xs font-medium">List</span>
            </Button>
            <Button
              type="button"
              variant={listViewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="h-10 sm:h-9 rounded-none px-3 gap-1.5 border-l border-border shadow-none"
              onClick={() => setListViewMode("grid")}
              aria-pressed={listViewMode === "grid"}
              title="Grid view"
            >
              <LayoutGrid className="size-4 shrink-0" />
              <span className="text-xs font-medium">Grid</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
          {error}
        </div>
      )}

      {/* Table Card */}
      <div
        className={`mt-5 rounded-[5px] border shadow-[0px_4px_20px_0px_#00000005] transition-all duration-300 ${isDark ? "bg-[#141517] border-[#374151]" : "bg-card border-[#FDFDFD]"
          }`}
      >
        <div
          className={`px-4 md:px-5 py-2 rounded-t-[5px] flex flex-wrap items-center justify-between gap-3 ${isDark ? "bg-[#2A2B2F]" : "bg-[#F9FAFD]"
            }`}
        >
          <span className="font-semibold text-[1rem] text-foreground font-roboto inline-flex items-center gap-2 uppercase tracking-wide">
            {isLetterGeneratorMode ? "Deals" : "Applications"}
            {isRefreshing ? (
              <Loader2
                className="size-4 animate-spin text-muted-foreground shrink-0"
                aria-label="Updating list"
              />
            ) : null}
          </span>
          <div className="flex flex-wrap items-center gap-3 ml-auto">
            {listViewMode === "grid" && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="size-4 rounded border-border text-blue-600 cursor-pointer"
                  checked={table.getIsAllPageRowsSelected()}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = table.getIsSomePageRowsSelected();
                    }
                  }}
                  onChange={(e) =>
                    table.toggleAllPageRowsSelected(e.target.checked)
                  }
                  aria-label="Select all on this page"
                />
                <span className="hidden sm:inline">Select page</span>
              </label>
            )}
            {isRecentlyDeletedView ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 cursor-pointer text-xs shrink-0"
                  disabled={
                    selectedApplicationIds.length === 0
                  }
                  loading={restoreLoading}
                  onClick={() =>
                    handleRestoreApplications(selectedApplicationIds)
                  }
                >
                  <Undo2 className="size-3" />
                  Revert
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1 cursor-pointer text-xs shrink-0"
                  disabled={
                    selectedApplicationIds.length === 0
                  }
                  loading={permanentDeleteLoading}
                  onClick={() => handleBulkPermanentDelete()}
                >
                  <Trash2 className="size-3" />
                  Delete Permanently
                </Button>
              </>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1 cursor-pointer text-xs shrink-0"
                disabled={selectedApplicationIds.length === 0}
                loading={deleteLoading}
                onClick={handleBulkDelete}
              >
                <Trash2 className="size-3" />
                Delete
              </Button>
            )}
          </div>
        </div>
        <div
          className={`p-1 transition-opacity duration-300 ${isRefreshing ? "opacity-85" : "opacity-100"
            }`}
        >
          {listViewMode === "list" ? (
            <div className="overflow-x-auto overflow-y-auto rounded-xl [scrollbar-gutter:stable]">
              <DataTableContent
                table={table}
                fixedLayout
                loading={loading && !(applications?.length)}
                loadingMessage="Loading applications..."
                emptyMessage={
                  debouncedSearchTerm.trim()
                    ? "No matching applications"
                    : "No applications found"
                }
                emptySubMessage={
                  debouncedSearchTerm.trim()
                    ? "Try a different search term"
                    : "Try adjusting your search or filter criteria"
                }
                onRowClick={(row) =>
                  isLetterGeneratorMode
                    ? setSendLetterApplication(row.original)
                    : handleNavigateToApplication(row.original)
                }
                onRowMouseEnter={(row) =>
                  handlePrefetchApplicationDetail(row.original)
                }
                isRowExpanded={(row) => expandedProgressRowId === row.id}
                renderExpandedRow={(row) => (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{
                      height: { duration: 0.32, ease: [0.4, 0, 0.2, 1] },
                      opacity: { duration: 0.22, ease: "easeOut" },
                    }}
                    className="overflow-hidden"
                  >
                    <motion.div
                      initial={{ y: -8 }}
                      animate={{ y: 0 }}
                      exit={{ y: -8 }}
                      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                      className="border-t border-amber-200/50 bg-gradient-to-b from-amber-50/50 via-white to-white px-4 py-4 dark:border-amber-900/30 dark:from-amber-950/20 dark:via-slate-950/40 dark:to-slate-950/20 sm:px-6"
                    >
                      <ApplicationProgressBar
                        application={row.original}
                        className="shadow-sm"
                      />
                    </motion.div>
                  </motion.div>
                )}
              />
            </div>
          ) : loading && !(applications?.length) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-3 md:p-4 animate-pulse">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-4 space-y-3 ${isDark
                    ? "bg-[#1a1b1e] border-[#374151]"
                    : "bg-card border-[#F0F0F0]"
                    }`}
                >
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/3 rounded bg-muted" />
                  <div className="h-3 w-5/6 rounded bg-muted" />
                  <div className="h-3 w-2/5 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : !applications?.length ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-xl">
              <p className="font-medium text-[#687182]">No applications found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Try adjusting your search or filter criteria
              </p>
            </div>
          ) : (
            <div className="p-3 md:p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {table.getRowModel().rows.map((row) => {
                  const app = row.original;
                  const queueLabel = getApplicationQueueLabel(app);
                  const loanAmount = resolveApplicationRequestAmount(app);
                  const approvedAmount = showApprovedAmountColumn
                    ? getApplicationApprovedAmount(app)
                    : null;
                  return (
                    <div
                      key={row.id}
                      role="group"
                      tabIndex={0}
                      onMouseEnter={() => handlePrefetchApplicationDetail(app)}
                      onClick={() =>
                        isLetterGeneratorMode
                          ? setSendLetterApplication(app)
                          : handleNavigateToApplication(app)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (isLetterGeneratorMode) {
                            setSendLetterApplication(app);
                          } else {
                            handleNavigateToApplication(app);
                          }
                        }
                      }}
                      aria-label={`Open application ${getApplicationDealIdDisplay(app)} (${app._id})`}
                      className={`rounded-lg border shadow-sm flex flex-col gap-3 p-4 text-left transition hover:ring-2 hover:ring-[var(--brand)]/20 cursor-pointer ${isDark
                        ? "bg-[#1a1b1e] border-[#374151]"
                        : "bg-card border-[#F0F0F0]"
                        } ${row.getIsSelected() ? "ring-2 ring-blue-400/60" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <div
                            className="shrink-0 pt-0.5"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="size-4 rounded border-border text-blue-600 cursor-pointer"
                              checked={row.getIsSelected()}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                row.toggleSelected(e.target.checked)
                              }
                              aria-label={`Select application ${getApplicationDealIdDisplay(app)} (${app._id})`}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-foreground truncate">
                              {getApplicationBusinessDisplayName(app)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Deal ID{" "}
                              <span className="text-sky-600 font-medium">
                                {getApplicationDealIdDisplay(app)}
                              </span>
                            </p>
                          </div>
                        </div>
                        <div
                          className="flex shrink-0 items-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {isLetterGeneratorMode ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="success"
                              className="h-8 gap-1.5 cursor-pointer"
                              onClick={() => setSendLetterApplication(app)}
                            >
                              <Send className="size-3.5" />
                              Send
                            </Button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              void handleOpenApplicationDetails(app);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)]/10"
                            aria-label="View application in drawer"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>
                          <span className="text-foreground/80">Request: </span>
                          {loanAmount == null
                            ? "—"
                            : formatCurrency(loanAmount)}
                        </p>
                        {showApprovedAmountColumn && (
                          <p>
                            <span className="text-foreground/80">Approved: </span>
                            {approvedAmount == null
                              ? "—"
                              : formatCurrency(approvedAmount)}
                          </p>
                        )}
                        {showReinitiateContractIsoDecisionColumn ? (
                          <p>
                            <span className="text-foreground/80">ISO Decision: </span>
                            <span
                              className={
                                isIsoUpdatedOfferApproved(app)
                                  ? "font-medium text-green-700 dark:text-green-400"
                                  : "text-foreground"
                              }
                            >
                              {getReinitiateContractIsoDecisionLabel(app)}
                            </span>
                          </p>
                        ) : null}
                        {showFinalApprovalSourceColumn ? (
                          <p>
                            <span className="text-foreground/80">Source: </span>
                            {formatFinalApprovalSourceLabel(app.finalApprovalSource) ? (
                              <FinalApprovalSourceBadge
                                source={app.finalApprovalSource}
                                variant="compact"
                              />
                            ) : (
                              <span className="text-foreground">-</span>
                            )}
                          </p>
                        ) : null}
                        <p>
                          <span className="text-foreground/80">Created: </span>
                          {formatDateTime(app.createdAt)}
                        </p>
                      </div>
                      <div className="pt-1 border-t border-border/60">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getApplicationQueueBadgeClass(queueLabel)}`}
                        >
                          {queueLabel}
                        </span>
                      </div>
                      {showUwDealPoolUi && underwriterPoolTab === "queue" ? (
                        <div
                          className="pt-2 flex justify-start gap-2"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            disabled={
                              !(app._id ?? (app as { id?: string }).id) ||
                              claimBusyAppId ===
                                String(
                                  app._id ??
                                    (app as { id?: string }).id ??
                                    "",
                                )
                            }
                            onClick={() => void handleUwClaimDeal(app)}
                          >
                            {claimBusyAppId ===
                            String(
                              app._id ??
                                (app as { id?: string }).id ??
                                "",
                            ) ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              "Claim"
                            )}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Pagination */}
        {applications && applications.length > 0 && (
          <DataTablePagination
            table={table}
            totalItems={totalItems}
            showSelectedCount={false}
          />
        )}
      </div>

      <ApplicationDetailsSheet
        application={viewApplication}
        open={!!viewApplication}
        onOpenChange={(open) => {
          if (!open) setViewApplication(null);
        }}
      />

      {/* Sweet-alert style dialog when client or application already exists */}
      <Dialog
        open={showAlreadyExistsDialog}
        onOpenChange={setShowAlreadyExistsDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
              </div>
              <DialogTitle className="text-left">Already Exists</DialogTitle>
            </div>
            <DialogDescription className="text-left pt-1">
              {alreadyExistsMessage.client && alreadyExistsMessage.application
                ? "This client and application already exist in the system. The existing records are shown in the list below."
                : alreadyExistsMessage.client
                  ? "This client already exists in the system. A new application was linked to the existing client."
                  : "This application already exists for this client. The PDF was attached to the existing application."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              onClick={() => setShowAlreadyExistsDialog(false)}
              className="bg-[image:var(--brand-gradient)] text-white hover:opacity-90"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog showing extracted PDF data when some required fields were missing */}
      <Dialog
        open={!!partialExtractedData}
        onOpenChange={(open: boolean) => !open && setPartialExtractedData(null)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-left">Extracted Data from PDF</DialogTitle>
            <DialogDescription className="text-left">
              The following data was extracted. Some required fields were missing—please complete the form manually using &quot;New Application&quot; and copy values as needed.
            </DialogDescription>
          </DialogHeader>
          {partialExtractedData && (
            <div className="grid gap-4 py-2">
              <div>
                <h4 className="font-semibold text-sm text-foreground mb-2">Business</h4>
                <ul className="text-sm space-y-1 text-muted-foreground bg-muted/50 rounded-md p-3">
                  {Object.entries(partialExtractedData.business).map(([key, value]) =>
                    value != null && String(value).trim() !== "" ? (
                      <li key={key}>
                        <span className="font-medium text-foreground">{key}:</span> {String(value)}
                      </li>
                    ) : null
                  )}
                  {Object.keys(partialExtractedData.business).length === 0 && (
                    <li className="text-muted-foreground">No business fields extracted.</li>
                  )}
                </ul>
              </div>
              <div>
                <h4 className="font-semibold text-sm text-foreground mb-2">Owner</h4>
                <ul className="text-sm space-y-1 text-muted-foreground bg-muted/50 rounded-md p-3">
                  {Object.entries(partialExtractedData.owner).map(([key, value]) =>
                    value != null && String(value).trim() !== "" ? (
                      <li key={key}>
                        <span className="font-medium text-foreground">{key}:</span> {String(value)}
                      </li>
                    ) : null
                  )}
                  {Object.keys(partialExtractedData.owner).length === 0 && (
                    <li className="text-muted-foreground">No owner fields extracted.</li>
                  )}
                </ul>
              </div>
            </div>
          )}
          <DialogFooter className="sm:justify-end">
            {canCreateNewApplication && (
              <Button
                type="button"
                onClick={() => {
                  setPartialExtractedData(null);
                  navigate("/create-applications");
                }}
                className="bg-[image:var(--brand-gradient)] text-white hover:opacity-90"
              >
                Open New Application
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => setPartialExtractedData(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SendLetterModal
        open={Boolean(sendLetterApplication)}
        application={sendLetterApplication}
        onOpenChange={(open) => {
          if (!open) setSendLetterApplication(null);
        }}
      />
    </div>
  );
};

export default Applications;
