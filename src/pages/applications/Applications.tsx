import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Plus,
  BadgeCheck,
  CircleDollarSign,
  XCircle,
  Clock,
  Loader2,
  AlertCircle,
  Trash2,
  EyeIcon,
  LayoutGrid,
  LayoutList,
  ArrowLeft,
  Activity,
  Upload,
  Download,
  TrendingUp,
} from "lucide-react";
import ApplicationProgressBar from "@/components/application/ApplicationProgressBar";
import { motion } from "framer-motion";
import { CornerSummaryCard } from "@/pages/commissionPortal/CornerSummaryCard";
import { useLocation, useNavigate } from "react-router";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import {
  claimUnderwriterDeal,
  getApplications,
  getApplicationStats,
  deleteApplication,
  extractBusinessDetails,
  normalizeApplicationStatsData,
} from "@/redux/actions/applicationActions";
import type { ApplicationStatsData } from "@/redux/actions/applicationActions";
import {
  hydrateApplicationsListFromCache,
  resetDeleteApplication,
} from "@/redux/slices/applicationSlice";

import { toast } from "react-toastify";
import type { Application, GetApplicationsParams } from "@/types/applicationTypes";
import {
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type PaginationState,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { DataTableContent, DataTablePagination } from "@/components/DataTable";
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
import { cn, formatCurrency, formatDate as formatDateUtil } from "@/lib/utils";
import { axiosGet, axiosPostFormData } from "@/redux/axios";
import ApplicationDetailsSheet from "@/components/application/ApplicationDetailsSheet";
import { getClientByClientId } from "@/redux/actions/clientActions";
import {
  inferOperationsListStatusFromApplication,
  normalizeOperationsDashboardStatusParam,
  OPERATIONS_APPLICATIONS_LIST_ALL_QUERY,
  OPERATIONS_DASHBOARD_PER_ROW_STATUS_FILTERS,
  operationsDashboardStatusTitle,
} from "@/constants/operationsDashboardApplications";
import {
  buildApplicationsBrowseUrl,
  statCardTitleToApplicationsQuery,
} from "@/constants/dashboardApplicationsNavigation";
import {
  applicationsListParamsCacheKey,
  getCachedApplicationsList,
} from "@/lib/applicationsListCache";
import { useApplicationsListQuery } from "@/hooks/useApplicationsListQuery";
import {
  parseApplicationsListRouteFilters,
  buildApplicationsListParams,
  applicationsListSortFromTable,
  APPLICATIONS_LIST_DEFAULT_SORT,
} from "@/lib/applicationsListParams";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { prefetchApplicationsList } from "@/lib/applicationsListCache";
import { prefetchApplicationDetail } from "@/lib/applicationDetailCache";
import { getContractWorkflowQueueBadgeClass } from "@/lib/contractOutQueueBadge";
import { formatDealPipelineCurrentStateLabel } from "@/lib/dealPipelineCurrentState";
import {
  downloadFailedBulkUploadRows,
  type BulkImportRowError,
} from "@/lib/bulkUploadErrors";
import {
  CONTRACT_SIGNED_QUEUE_BADGE_CLASS,
  isContractSignedQueueBadgeLabel,
} from "@/lib/contractSignedQueueBadge";
import { getApplicationBusinessDisplayName } from "@/lib/applicationBusinessDisplayName";
import { ApplicationTypeFilterDropdown } from "@/components/application/ApplicationTypeFilterDropdown";
import { ApplicationPriorityFilterDropdown } from "@/components/application/ApplicationPriorityFilterDropdown";
import { ApplicationStatusFilterDropdown } from "@/components/application/ApplicationStatusFilterDropdown";
import {
  normalizeRoleKey,
  resolveEffectiveRole,
} from "@/lib/sessionRole";

/** List/table: imported `dealId` when set, otherwise business `applicationId`. */
function getApplicationDealIdDisplay(app: Application): string {
  const raw = app.dealId?.trim();
  if (raw) return raw;
  if (app.applicationId != null) return String(app.applicationId);
  return "-";
}

/** Populated from `GET /applications` include `claimedByUnderwriter` (name/email). */
function formatUnderwriterClaimLabel(
  app: Application,
  viewerUserId?: string | null,
): string {
  const claimer = app.claimedByUnderwriter;
  if (!app.claimedByUnderwriterId && !claimer) return "—";
  const claimUuid =
    app.claimedByUnderwriterId ??
    (typeof claimer === "object" && claimer
      ? String(claimer.id ?? claimer._id ?? "")
      : "");
  if (
    viewerUserId &&
    claimUuid &&
    String(viewerUserId) === String(claimUuid)
  ) {
    return "You";
  }
  if (claimer && typeof claimer === "object") {
    const fn = (claimer.firstName ?? "").trim();
    const ln = (claimer.lastName ?? "").trim();
    const full = [fn, ln].filter(Boolean).join(" ");
    if (full) return full;
    if (claimer.email?.trim()) return claimer.email.trim();
  }
  return "—";
}

const APPLICATIONS_VIEW_MODE_STORAGE_KEY = "applicationsListViewMode";

/** Calendar bounds for the month before “today” (`YYYY-MM-DD`), used for stats “last month” deltas. */
function getPreviousCalendarMonthDateBoundaries(): { startDate: string; endDate: string } {
  const now = new Date();
  let year = now.getFullYear();
  let monthIndex = now.getMonth() - 1;
  if (monthIndex < 0) {
    monthIndex = 11;
    year -= 1;
  }
  const formatYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0);
  return { startDate: formatYmd(start), endDate: formatYmd(end) };
}

function getApplicationsStatCardIcon(title: string) {
  switch (title) {
    case "Funded":
    case "Funded Deals":
      return <CircleDollarSign size={16} className="text-green-500" aria-hidden />;
    case "Approved":
      return <BadgeCheck size={16} className="text-[#49A8E8]" aria-hidden />;
    case "Rejected":
      return <XCircle size={16} className="text-rose-500" aria-hidden />;
    case "Pending":
      return <Clock size={16} className="text-sky-500" aria-hidden />;
    case "In Progress":
      return <Activity size={16} className="text-[#49A8E8]" aria-hidden />;
    default:
      return <BadgeCheck size={16} className="text-[#49A8E8]" aria-hidden />;
  }
}

const Applications = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const location = useLocation();
  const sessionRoleKey = normalizeRoleKey(localStorage.getItem("role") || "");

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
    sessionRoleKey === "UNDERWRITER" && !isOperationsDashboardView;

  // Local state (URL-derived defaults avoid a blank frame before the first list fetch)
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 350);
  const [statusFilter, setStatusFilter] = useState<string>(() =>
    parseApplicationsListRouteFilters(location.search).statusFilter,
  );
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [dashboardStateFilter, setDashboardStateFilter] = useState<string>(() =>
    parseApplicationsListRouteFilters(location.search).dashboardStateFilter,
  );
  const [isListFilterInitialized, setIsListFilterInitialized] = useState(true);
  /** Primary underwriter inbox: unclaimed pool vs deals you claimed (Underwriter queue only). */
  const [underwriterPoolTab, setUnderwriterPoolTab] = useState<"queue" | "my">(
    "queue",
  );
  /** Underwriters should not see which colleague claimed a deal (admin/ops visibility only). */
  const showClaimedByColumn = sessionRoleKey !== "UNDERWRITER";
  const [claimBusyAppId, setClaimBusyAppId] = useState<string | null>(null);
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
  const bulkUploadInputRef = useRef<HTMLInputElement>(null);
  const bulkUploadSourceFileRef = useRef<File | null>(null);
  const [showBulkUploadErrorsDialog, setShowBulkUploadErrorsDialog] =
    useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{
    status: "idle" | "processing" | "completed" | "failed";
    totalRows: number;
    processedRows: number;
    successCount: number;
    updatedCount: number;
    failedCount: number;
    message?: string;
    errors: BulkImportRowError[];
  }>({
    status: "idle",
    totalRows: 0,
    processedRows: 0,
    successCount: 0,
    updatedCount: 0,
    failedCount: 0,
    errors: [],
  });
  const isBulkDeleteRef = useRef(false);

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
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
  const [prevMonthStats, setPrevMonthStats] =
    useState<ApplicationStatsData | null>(null);
  /** Stats scoped to Queue / My deals (Underwriter inbox only); avoids overwriting global Redux stats. */
  const [uwDealPoolStats, setUwDealPoolStats] =
    useState<ApplicationStatsData | null>(null);
  const [uwDealPoolPrevStats, setUwDealPoolPrevStats] =
    useState<ApplicationStatsData | null>(null);
  const [viewApplication, setViewApplication] = useState<Application | null>(null);
  const [isNavigatingToBrowse, setIsNavigatingToBrowse] = useState(false);
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

  const { data: statsData } = useSelector(
    (state: RootState) => state.applicationStats,
  );

  const {
    loading: deleteLoading,
    success: deleteSuccess,
    error: deleteError,
  } = useSelector((state: RootState) => state.deleteApplication);

  const loginData = useSelector((state: RootState) => state.login.data);
  const loginUser = loginData?.user;
  const currentUserIdForClaim = loginUser?._id ?? "";

  const fetchUwDealPoolStats = useCallback(
    async (signal?: AbortSignal) => {
      if (!showUwDealPoolUi) return;
      const claim = underwriterPoolTab === "queue" ? "unclaimed" : "mine";
      const { startDate, endDate } = getPreviousCalendarMonthDateBoundaries();
      const config = signal ? { signal } : undefined;
      const [curRes, prevRes] = await Promise.all([
        axiosGet(
          `/applications/stats?underwriterClaim=${encodeURIComponent(claim)}`,
          config,
        ),
        axiosGet(
          `/applications/stats?underwriterClaim=${encodeURIComponent(
            claim,
          )}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
          config,
        ),
      ]);
      const curRaw = curRes.data as { data?: unknown };
      const prevRaw = prevRes.data as { data?: unknown };
      setUwDealPoolStats(
        normalizeApplicationStatsData(curRaw?.data ?? curRes.data),
      );
      setUwDealPoolPrevStats(
        normalizeApplicationStatsData(prevRaw?.data ?? prevRes.data),
      );
    },
    [showUwDealPoolUi, underwriterPoolTab],
  );

  useEffect(() => {
    if (!showUwDealPoolUi) {
      setUwDealPoolStats(null);
      setUwDealPoolPrevStats(null);
      return;
    }
    setUwDealPoolStats(null);
    setUwDealPoolPrevStats(null);
    const ac = new AbortController();
    void fetchUwDealPoolStats(ac.signal).catch((err: unknown) => {
      if (ac.signal.aborted) return;
      console.error("Failed to fetch underwriter pool application stats", err);
      setUwDealPoolStats(null);
      setUwDealPoolPrevStats(null);
    });
    return () => ac.abort();
  }, [showUwDealPoolUi, underwriterPoolTab, fetchUwDealPoolStats]);

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

  // Get client email helper
  const getClientEmail = useCallback((client: Application["client"]) => {
    if (typeof client === "string") return "-";
    return client?.business?.email || client?.owner?.email || "-";
  }, []);

  const getApplicationIsoLabel = useCallback((application: Application): string => {
    const iso = application.iso;
    if (!iso || typeof iso !== "object") return "-";
    const name = iso.name?.trim();
    if (name) return name;
    const email = iso.email?.trim();
    if (email) return email;
    return "-";
  }, []);

  const getApplicationQueueLabel = useCallback((application: Application): string => {
    const stRaw = application.currentState ?? application.state;
    const stStr = String(stRaw ?? "").trim();
    /** "Final Underwriter-Approved" badge only when state explicitly includes approved (not from queue alone). */
    const hasApprovedInCurrentState = /\bapproved\b/i.test(stStr);

    if (hasApprovedInCurrentState) {
      return "Final Underwriter-Approved";
    }

    const q = application.currentQueue || application.queue;
    if (q == null || String(q).trim() === "") {
      return "-";
    }
    const raw = String(q).trim();

    if (raw.toLowerCase() === "new") {
      const creator = application.createdBy as
        | { id?: string; _id?: string; role?: string }
        | string
        | undefined;
      const referring = application.referringAgent as
        | { id?: string; _id?: string }
        | string
        | undefined;

      const creatorRole =
        typeof creator === "object" && creator?.role != null
          ? String(creator.role).toUpperCase().replace(/-/g, "_")
          : "";
      if (creatorRole === "AGENT") return "Agent";

      const creatorId =
        typeof creator === "object" && creator
          ? String(creator.id ?? creator._id ?? "")
          : "";
      const referringId =
        typeof referring === "object" && referring
          ? String(referring.id ?? referring._id ?? "")
          : "";
      if (creatorId && referringId && creatorId === referringId) return "Agent";

      return raw;
    }

    /** Use `currentQueue` only — do not fall back to `currentState` (Pending / In Progress). */
    const pipelineLabel = formatDealPipelineCurrentStateLabel({
      currentQueue: raw,
      queue: raw,
    });
    return pipelineLabel === "—" ? raw : pipelineLabel;
  }, []);

  const getApplicationQueueBadgeClass = useCallback((queueLabel: string) => {
    const contractWorkflowClass = getContractWorkflowQueueBadgeClass(queueLabel);
    if (contractWorkflowClass) return contractWorkflowClass;
    if (isContractSignedQueueBadgeLabel(queueLabel)) {
      return CONTRACT_SIGNED_QUEUE_BADGE_CLASS;
    }
    const n = queueLabel.toLowerCase();
    if (n === "final underwriter-approved") {
      return "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200";
    }
    if (n === "funded" || n === "disbursement") {
      return "bg-green-100 text-green-700";
    }
    if (n === "approved" || n === "contracted") {
      return "bg-blue-100 text-blue-700";
    }
    if (n === "declined") {
      return "bg-red-100 text-red-700";
    }
    if (
      n === "underwriting" ||
      n === "underwriter" ||
      n === "review" ||
      n === "final review" ||
      n === "final underwriter" ||
      n === "final" ||
      n === "funding call"
    ) {
      return "bg-sky-100 text-sky-800";
    }
    if (n === "-") {
      return "bg-muted/50 text-foreground";
    }
    return "bg-yellow-100 text-yellow-700";
  }, []);

  const handleUwClaimDeal = useCallback(
    async (app: Application) => {
      const id = app._id ?? (app as { id?: string }).id;
      if (!id) return;
      try {
        setClaimBusyAppId(String(id));
        await dispatch(claimUnderwriterDeal({ applicationId: String(id) })).unwrap();
        toast.success("Deal claimed");
        if (showUwDealPoolUi) {
          void fetchUwDealPoolStats().catch((err: unknown) => {
            console.error("Failed to refresh underwriter pool stats after claim", err);
          });
        }
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
    [dispatch, fetchUwDealPoolStats, showUwDealPoolUi],
  );

  const handleNavigateToApplication = useCallback(
    (app: Application) => {
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
      navigate(`/application-details/${id}${suffix}`, {
        state: { applicationPreview: app },
      });
    },
    [dashboardStateFilter, navigate],
  );

  const handlePrefetchApplicationDetail = useCallback((app: Application) => {
    const id =
      app.applicationId != null ? String(app.applicationId) : String(app._id ?? "");
    if (id) prefetchApplicationDetail(id);
  }, []);

  const handleToggleApplicationProgress = useCallback((rowId: string) => {
    setExpandedProgressRowId((prev) => (prev === rowId ? null : rowId));
  }, []);

  // Define columns
  const columns: ColumnDef<Application>[] = useMemo(() => {
    const selectColumn: ColumnDef<Application> = {
      id: "select",
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
        accessorFn: (row) => getApplicationDealIdDisplay(row),
        enableSorting: true,
        header: ({ column }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              DEAL ID
            </span>
            {/* <Button
                        variant="ghost"
                        className="p-0 h-auto font-medium text-foreground hover:bg-transparent hover:text-foreground cursor-pointer"
                        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                    >
                        <ArrowUpDown className=" h-3 w-3" />
                    </Button> */}
          </div>
        ),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">
            {getApplicationDealIdDisplay(row.original)}
          </span>
        ),
      },
      {
        id: "businessName",
        accessorFn: (row) => getApplicationBusinessDisplayName(row),
        header: ({ column }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              BUSINESS NAME
            </span>
            {/* <Button
                        variant="ghost"
                        className="p-0 h-auto font-medium text-foreground hover:bg-transparent hover:text-foreground cursor-pointer"
                        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                    >
                        <ArrowUpDown className=" h-3 w-3" />
                    </Button> */}
          </div>
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {getApplicationBusinessDisplayName(row.original)}
          </span>
        ),
      },
      {
        id: "email",
        accessorFn: (row) => getClientEmail(row.client),
        header: ({ column }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              EMAIL
            </span>
            {/* <Button
                        variant="ghost"
                        className="p-0 h-auto font-medium text-foreground hover:bg-transparent hover:text-foreground cursor-pointer"
                        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                    >
                        <ArrowUpDown className=" h-3 w-3" />
                    </Button> */}
          </div>
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {getClientEmail(row.original.client)}
          </span>
        ),
      },
      {
        id: "seeProgress",
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
        id: "iso",
        accessorFn: (row) => getApplicationIsoLabel(row),
        header: () => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              ISO
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {getApplicationIsoLabel(row.original)}
          </span>
        ),
      },
      {
        id: "loanAmount",
        accessorFn: (row) => row.loanAmount,
        header: ({ column }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              Loan Amount
            </span>
          </div>
        ),
        cell: ({ row }) => {
          const loanAmount = row.original.loanAmount;
          if (loanAmount == null) {
            return <span className="text-foreground">-</span>;
          }
          return (
            <span className="text-foreground">
              {formatCurrency(Number(loanAmount) || 0)}
            </span>
          );
        },
      },
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
        accessorKey: "status",
        header: ({ column }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              Current State
            </span>
            {/* <Button
                        variant="ghost"
                        className="p-0 h-auto font-medium text-foreground hover:bg-transparent hover:text-foreground cursor-pointer"
                        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                    >
                        <ArrowUpDown className="h-3 w-3" />
                    </Button> */}
          </div>
        ),
        cell: ({ row }) => {
          let queueLabel = getApplicationQueueLabel(row.original);

          /**
           * When navigating from the Operations dashboard (e.g. clicking the
           * "Funded" / "Disbursement" stat cards), the list is already scoped
           * to a single operations stage via `dashboardStateFilter`. In that
           * context, show the normalized operations stage label so users see
           * "Funded" applications instead of the underlying workflow queue
           * such as "Contracted".
           */
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
        accessorKey: "createdAt",
        enableSorting: true,
        header: ({ column }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              CREATED AT
            </span>
            {/* <Button
                        variant="ghost"
                        className="p-0 h-auto font-medium text-foreground hover:bg-transparent hover:text-foreground cursor-pointer"
                        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                    >
                        <ArrowUpDown className="h-3 w-3" />
                    </Button> */}
          </div>
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: "lastModifiedAt",
        header: ({ column }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              Last Modified Date
            </span>
            {/* <Button
                        variant="ghost"
                        className="p-0 h-auto font-medium text-foreground hover:bg-transparent hover:text-foreground cursor-pointer"
                        onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
                    >
                        <ArrowUpDown className="h-3 w-3" />
                    </Button> */}
          </div>
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
      ...(showClaimedByColumn
        ? ([
          {
            id: "claimedByUnderwriter",
            header: () => (
              <span className="font-medium text-foreground uppercase tracking-wide">
                CLAIMED BY
              </span>
            ),
            cell: ({ row }) => (
              <span className="text-foreground text-sm max-w-[10rem] truncate">
                {formatUnderwriterClaimLabel(
                  row.original,
                  currentUserIdForClaim,
                )}
              </span>
            ),
            enableSorting: false,
          },
        ] satisfies ColumnDef<Application>[])
        : []),
      ...(showUwDealPoolUi && underwriterPoolTab === "queue"
        ? ([
          {
            id: "uwClaim",
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
                  className="flex justify-end"
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
      {
        id: "view",
        header: () => (
          <span className="font-medium text-foreground uppercase tracking-wide">
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
            className="flex items-center justify-center text-[#276D9C] hover:text-[#1b4e6f] cursor-pointer"
            aria-label="View application in drawer"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-current text-xs font-bold">
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
    getApplicationQueueBadgeClass,
    getApplicationIsoLabel,
    getApplicationBusinessDisplayName,
    getClientEmail,
    getApplicationQueueLabel,
    handleOpenApplicationDetails,
    expandedProgressRowId,
    handleToggleApplicationProgress,
    showUwDealPoolUi,
    showClaimedByColumn,
    underwriterPoolTab,
    currentUserIdForClaim,
    claimBusyAppId,
    handleUwClaimDeal,
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
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
    manualPagination: true,
    state: {
      sorting,
      columnFilters,
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
        underwriterClaim:
          underwriterPoolTab === "queue" ? "unclaimed" : "mine",
        ...sort,
      });
    }
    return buildApplicationsListParams({
      pageIndex: pagination.pageIndex,
      pageSize: pagination.pageSize,
      searchTerm: debouncedSearchTerm,
      dashboardStateFilter,
      statusFilter,
      typeFilter,
      priorityFilter,
    });
  }, [
    dashboardStateFilter,
    statusFilter,
    typeFilter,
    priorityFilter,
    showUwDealPoolUi,
    underwriterPoolTab,
    pagination.pageIndex,
    pagination.pageSize,
    debouncedSearchTerm,
    sorting,
  ]);

  const listFetchParams = useMemo(
    (): GetApplicationsParams => listRequestParamsForKey,
    [listRequestParamsForKey],
  );

  const listFetchKey = useMemo(
    () => applicationsListParamsCacheKey(listFetchParams),
    [listFetchParams],
  );

  useEffect(() => {
    setExpandedProgressRowId(null);
  }, [pagination.pageIndex, listFetchKey]);

  const applicationsListQuery = useApplicationsListQuery(listFetchParams, {
    enabled: isListFilterInitialized,
  });

  const fetchApplications = useCallback(async () => {
    await applicationsListQuery.refetch();
  }, [applicationsListQuery]);

  /** Sync one-time refresh flag cleanup after query-triggered fetch. */
  useEffect(() => {
    if (!isListFilterInitialized) return;
    const refreshList = Boolean(
      (location.state as { refreshApplicationsList?: boolean } | null)
        ?.refreshApplicationsList,
    );
    if (refreshList) {
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: {} },
      );
    }
  }, [
    fetchApplications,
    isListFilterInitialized,
    listFetchKey,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);

  /** Warm cache only for the active list filter (DB-filtered key). No bulk stage prefetch. */
  useEffect(() => {
    if (!isListFilterInitialized) return;
    prefetchApplicationsList(listFetchParams);
    // listFetchKey encodes operationsStatus / queue / search — one request per filter change
  }, [isListFilterInitialized, listFetchKey, listFetchParams]);

  // Initialize list filter from dashboard query params
  useEffect(() => {
    const query = new URLSearchParams(location.search);
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
      `Are you sure you want to delete ${idsToDelete.length} selected application(s)?`,
    );
    if (!confirmed) return;

    isBulkDeleteRef.current = true;
    try {
      await Promise.all(
        idsToDelete.map((id) => dispatch(deleteApplication(id)).unwrap()),
      );
      toast.success(
        idsToDelete.length === 1
          ? "Application deleted successfully!"
          : `${idsToDelete.length} applications deleted successfully!`,
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
      if (showUwDealPoolUi) {
        void fetchUwDealPoolStats().catch((err: unknown) => {
          console.error("Failed to refresh underwriter pool stats after delete", err);
        });
      }
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
    showUwDealPoolUi,
    fetchUwDealPoolStats,
  ]);

  // Fetch stats for dashboard
  useEffect(() => {
    dispatch(getApplicationStats());
  }, [dispatch]);

  // Handle delete success/error (single delete only; bulk delete shows one toast in handleBulkDelete)
  useEffect(() => {
    if (deleteSuccess) {
      if (isBulkDeleteRef.current) {
        dispatch(resetDeleteApplication());
        return;
      }
      toast.success("Application deleted successfully!");
      dispatch(resetDeleteApplication());
      fetchApplications();
      dispatch(getApplicationStats());
      if (showUwDealPoolUi) {
        void fetchUwDealPoolStats().catch((err: unknown) => {
          console.error(
            "Failed to refresh underwriter pool stats after delete",
            err,
          );
        });
      }
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
    showUwDealPoolUi,
    fetchUwDealPoolStats,
  ]);

  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [searchTerm, typeFilter, priorityFilter]);

  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
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

  useEffect(() => {
    const { startDate, endDate } = getPreviousCalendarMonthDateBoundaries();

    const fetchPrevStats = async () => {
      try {
        const queryParams = new URLSearchParams();
        queryParams.append("startDate", startDate);
        queryParams.append("endDate", endDate);

        const url = `/applications/stats${queryParams.toString() ? `?${queryParams.toString()}` : ""
          }`;
        const response = await axiosGet(url);
        const payload = response.data as any;
        const data = (payload?.data ?? payload) as ApplicationStatsData;
        setPrevMonthStats(data);
      } catch (error) {
        console.error("Failed to fetch previous month application stats", error);
        setPrevMonthStats(null);
      }
    };

    fetchPrevStats();
  }, []);

  const userRole = resolveEffectiveRole(user);
  const roleKey = normalizeRoleKey(userRole);
  const isSuperAdmin = roleKey === "SUPER_ADMIN";
  const canCreateNewApplication =
    roleKey === "AGENT" || isSuperAdmin;
  const isUnderwriterRole =
    roleKey === "UNDERWRITER" || roleKey === "FINAL_UNDERWRITER";
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const handleBulkUploadFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const lowerName = file.name.toLowerCase();
      const isValidFile =
        lowerName.endsWith(".csv") ||
        lowerName.endsWith(".xlsx") ||
        lowerName.endsWith(".xls");

      if (!isValidFile) {
        toast.error("Please upload a valid Excel/CSV file (.csv, .xlsx, .xls).");
        e.target.value = "";
        return;
      }

      const resetInput = () => {
        e.target.value = "";
      };

      try {
        bulkUploadSourceFileRef.current = file;
        setShowBulkUploadErrorsDialog(false);
        setBulkUploadProgress({
          status: "processing",
          totalRows: 0,
          processedRows: 0,
          successCount: 0,
          updatedCount: 0,
          failedCount: 0,
          message: "Upload started...",
          errors: [],
        });

        const formData = new FormData();
        formData.append("file", file);
        const startRes = await axiosPostFormData(
          "/applications/bulk-upload-excel/start",
          formData,
          { timeout: 120000 },
        );
        const jobId = startRes?.data?.data?.jobId as string | undefined;
        if (!jobId) {
          throw new Error("Bulk upload job could not be started.");
        }

        // Polling design notes:
        // - No hard attempts cap. The job lives on the server (sliding TTL) and the sheet may
        //   contain thousands of rows; we keep polling until the server reports terminal status.
        // - Transient poll failures (network blip, brief 5xx) MUST NOT mark the upload as failed —
        //   the BE is likely still working. We tolerate a generous run of consecutive poll
        //   failures and only give up if the BE truly seems unreachable for an extended period.
        // - We also bail out if the BE makes no progress for a long stretch (stuck job).
        const POLL_INTERVAL_MS = 2000;
        const MAX_CONSECUTIVE_POLL_FAILURES = 30; // ~1 min of full outage
        const NO_PROGRESS_TIMEOUT_MS = 1000 * 60 * 15; // 15 min with zero forward motion
        let consecutiveFailures = 0;
        let lastProgressMs = Date.now();
        let lastProcessedRows = -1;
        let finished = false;

        while (!finished) {
          await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));

          let progress: any = null;
          try {
            const progressRes = await axiosGet(
              `/applications/bulk-upload-excel/progress/${encodeURIComponent(jobId)}`,
            );
            progress = progressRes?.data?.data;
            consecutiveFailures = 0;
          } catch (pollErr) {
            consecutiveFailures += 1;
            console.warn(
              `[Bulk upload] progress poll failed (${consecutiveFailures}/${MAX_CONSECUTIVE_POLL_FAILURES})`,
              pollErr,
            );
            if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
              throw new Error(
                "Lost contact with the server while the bulk upload was running. Please check the applications list — the import may still be in progress on the server.",
              );
            }
            continue;
          }

          if (!progress) {
            // Server hasn't published the first heartbeat yet; keep waiting without resetting
            // the no-progress timer.
            continue;
          }

          const processedRows = Number(progress.processedRows) || 0;
          if (processedRows !== lastProcessedRows) {
            lastProcessedRows = processedRows;
            lastProgressMs = Date.now();
          }

          const rowErrors: BulkImportRowError[] = Array.isArray(progress.errors)
            ? progress.errors.map((err: BulkImportRowError) => ({
                excelRowNumber: Number(err.excelRowNumber) || 0,
                message: String(err.message ?? "Unknown error"),
                dealId: err.dealId ?? null,
                dealName: err.dealName ?? null,
              }))
            : [];

          setBulkUploadProgress({
            status: progress.status,
            totalRows: Number(progress.totalRows) || 0,
            processedRows,
            successCount: Number(progress.successCount) || 0,
            updatedCount: Number(progress.updatedCount) || 0,
            failedCount: Number(progress.failedCount) || 0,
            message: progress.message,
            errors: rowErrors,
          });

          if (progress.status === "completed") {
            const insertedNum = Number(progress.successCount) || 0;
            const updatedNum = Number(progress.updatedCount) || 0;
            const totalNum = Number(progress.totalRows) || 0;
            const fallbackMessage =
              insertedNum === 0 && updatedNum === 0
                ? `No applications were imported from ${totalNum} row(s).`
                : `Inserted ${insertedNum}, updated ${updatedNum} of ${totalNum} row(s).`;
            toast.success(progress.message || fallbackMessage);
            if (rowErrors.length) {
              setShowBulkUploadErrorsDialog(true);
              toast.warning(
                `${rowErrors.length} row(s) could not be imported. Review the failure report to fix and re-upload.`,
              );
            }
            await applicationsListQuery.refetch();
            finished = true;
            break;
          }

          if (progress.status === "failed") {
            throw new Error(progress.message || "Bulk upload failed.");
          }

          if (Date.now() - lastProgressMs > NO_PROGRESS_TIMEOUT_MS) {
            throw new Error(
              "Bulk upload appears stuck (no progress for 15 minutes). The job may still be running on the server — check the applications list before retrying.",
            );
          }
        }
      } catch (err: unknown) {
        const msg =
          typeof err === "string"
            ? err
            : err && typeof err === "object" && "message" in err
              ? String((err as { message?: string }).message)
              : "Bulk upload failed.";
        setBulkUploadProgress((prev) => ({
          ...prev,
          status: "failed",
          message: msg,
        }));
        toast.error(msg);
      } finally {
        resetInput();
      }
    },
    [applicationsListQuery],
  );

  const handleDownloadFailedBulkRows = useCallback(async () => {
    const sourceFile = bulkUploadSourceFileRef.current;
    const { errors } = bulkUploadProgress;
    if (!sourceFile) {
      toast.error("Original upload file is no longer available. Re-upload the full file.");
      return;
    }
    if (!errors.length) {
      toast.error("No failed rows to export.");
      return;
    }
    try {
      await downloadFailedBulkUploadRows(sourceFile, errors);
      toast.success("Failed rows downloaded. Fix the issues and re-upload this file.");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : "Failed to export rows.";
      toast.error(msg);
    }
  }, [bulkUploadProgress]);

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
    if (normalizedStatus === "Contracted") {
      return "CONTRACT APPLICATIONS";
    }
    const label = normalizedStatus
      ? operationsDashboardStatusTitle(normalizedStatus)
      : dashboardStateFilter;
    return `${label.toUpperCase()} APPLICATIONS`;
  }, [dashboardStateFilter, isOperationsDashboardView]);

  const handleOperationsPipelineBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const getBrowseQueryFromStatCard = useCallback(
    (
      title: string,
    ): {
      statsBucket?: string;
      currentQueue?: string;
      underwriterClaim?: "unclaimed" | "mine";
    } => {
      let q: { statsBucket?: string; currentQueue?: string };

      if (title === "Total Application Assigned") {
        if (roleKey === "FINAL_UNDERWRITER") {
          q = { currentQueue: "Final Underwriter" };
        } else {
          q = {};
        }
      } else if (title === "Total Deals Picked") {
        q = {};
      } else {
        q = statCardTitleToApplicationsQuery(title);
      }

      if (showUwDealPoolUi) {
        return {
          ...q,
          underwriterClaim:
            underwriterPoolTab === "queue" ? "unclaimed" : "mine",
        };
      }
      return q;
    },
    [roleKey, showUwDealPoolUi, underwriterPoolTab],
  );

  const prefetchBrowseFromStatCard = useCallback(
    (title: string) => {
      const q = getBrowseQueryFromStatCard(title);
      prefetchApplicationsList({
        page: 1,
        limit: 10,
        ...APPLICATIONS_LIST_DEFAULT_SORT,
        lite: true,
        ...q,
      });
    },
    [getBrowseQueryFromStatCard],
  );

  // Stats data (dynamic from API)
  const stats = useMemo(() => {
    const s = showUwDealPoolUi ? uwDealPoolStats : statsData;
    const prev = showUwDealPoolUi ? uwDealPoolPrevStats : prevMonthStats;
    const fmt = (n: number) => formatCurrency(n);

    const buildBucket = (
      count: number,
      total: number,
      prevTotal: number | null | undefined,
    ) => {
      const currentTotal = total ?? 0;
      const previousTotal = prevTotal ?? 0;

      let changePercent: number | null = null;

      if (previousTotal > 0) {
        changePercent = ((currentTotal - previousTotal) / previousTotal) * 100;
      } else if (currentTotal > 0) {
        changePercent = 100;
      } else if (previousTotal === 0 && currentTotal === 0) {
        changePercent = 0;
      }

      let changeLabel = "No change from last month";
      let changeClass = "text-muted-foreground";

      if (typeof changePercent === "number") {
        const rounded = Math.round(Math.abs(changePercent));
        const sign =
          changePercent > 0 ? "+" : changePercent < 0 ? "-" : "";

        if (changePercent > 0) {
          changeClass = "text-emerald-600";
        } else if (changePercent < 0) {
          changeClass = "text-rose-600";
        }

        changeLabel = `${sign}${rounded}% from last month`;
      }

      return {
        value: String(count),
        money: fmt(currentTotal),
        changePercent,
        changeLabel,
        changeClass,
      };
    };
    if (isUnderwriterRole) {
      return [
        {
          title: "Pending",
          footLeft: "Total Pending Amount",
          icon: getApplicationsStatCardIcon("Pending"),
          ...buildBucket(
            s?.workflowPending?.count ?? 0,
            s?.workflowPending?.totalAmount ?? 0,
            prev?.workflowPending?.totalAmount,
          ),
        },
        {
          title: "In Progress",
          footLeft: "Total In Progress Amount",
          icon: getApplicationsStatCardIcon("In Progress"),
          ...buildBucket(
            s?.workflowInProgress?.count ?? 0,
            s?.workflowInProgress?.totalAmount ?? 0,
            prev?.workflowInProgress?.totalAmount,
          ),
        },
        {
          title: "Funded",
          footLeft: "Total Funded Amount",
          icon: getApplicationsStatCardIcon("Funded"),
          ...buildBucket(
            s?.funded?.count ?? 0,
            s?.funded?.totalAmount ?? 0,
            prev?.funded?.totalAmount,
          ),
        },
        {
          title: "Approved",
          footLeft: "Total Approved Amount",
          icon: getApplicationsStatCardIcon("Approved"),
          ...buildBucket(
            s?.approved?.count ?? 0,
            s?.approved?.totalAmount ?? 0,
            prev?.approved?.totalAmount,
          ),
        },
        {
          title: "Rejected",
          footLeft: "Total Rejected Amount",
          icon: getApplicationsStatCardIcon("Rejected"),
          ...buildBucket(
            s?.rejected?.count ?? 0,
            s?.rejected?.totalAmount ?? 0,
            prev?.rejected?.totalAmount,
          ),
        },
      ];
    }
    return [
      {
        title: "Funded",
        footLeft: "Total Funded Amount",
        icon: getApplicationsStatCardIcon("Funded"),
        ...buildBucket(
          s?.funded?.count ?? 0,
          s?.funded?.totalAmount ?? 0,
          prev?.funded?.totalAmount,
        ),
      },
      {
        title: "Approved",
        footLeft: "Total Approved Amount",
        icon: getApplicationsStatCardIcon("Approved"),
        ...buildBucket(
          s?.approved?.count ?? 0,
          s?.approved?.totalAmount ?? 0,
          prev?.approved?.totalAmount,
        ),
      },
      {
        title: "Rejected",
        footLeft: "Total Rejected Amount",
        icon: getApplicationsStatCardIcon("Rejected"),
        ...buildBucket(
          s?.rejected?.count ?? 0,
          s?.rejected?.totalAmount ?? 0,
          prev?.rejected?.totalAmount,
        ),
      },
      {
        title: "Pending",
        footLeft: "Total Pending Amount",
        icon: getApplicationsStatCardIcon("Pending"),
        ...buildBucket(
          s?.workflowPending?.count ?? 0,
          s?.workflowPending?.totalAmount ?? 0,
          prev?.workflowPending?.totalAmount,
        ),
      },
    ];
  }, [
    isUnderwriterRole,
    showUwDealPoolUi,
    statsData,
    prevMonthStats,
    uwDealPoolStats,
    uwDealPoolPrevStats,
  ]);

  const statsGridCols =
    stats.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4";

  return (
    <div
      className="min-h-screen bg-background p-4 md:p-6"
    >
      {!isOperationsDashboardView && (
        <div
          className={`flex items-center justify-between p-6 rounded-lg shadow-[0px_4px_20px_0px_#00000005] ${isDark ? "bg-[#141517]" : "bg-white"
            }`}
        >
          <h1 className="text-[1.3rem] font-semibold text-foreground uppercase">
            {showUwDealPoolUi ? "Underwriter applications" : "All Applications"}
          </h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handlePDFFileSelect}
              />
              <input
                ref={bulkUploadInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleBulkUploadFileSelect}
              />

              {pdfFile && (
                <Button
                  className="px-4 py-2 gap-2 bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer"
                  onClick={handleExtractBusinessDetails}
                  disabled={isExtractingPDF}
                >
                  {isExtractingPDF && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Upload File
                </Button>
              )}
              {isSuperAdmin && (
                <div className="flex flex-col items-start gap-1">
                  <Button
                    className="px-4   py-2 gap-2 bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer disabled:cursor-not-allowed"
                    onClick={() => bulkUploadInputRef.current?.click()}
                    disabled={bulkUploadProgress.status === "processing"}
                  >
                    {bulkUploadProgress.status === "processing" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                    {bulkUploadProgress.status === "processing"
                      ? "Uploading..."
                      : "Bulk Upload Application"}
                  </Button>
                  {bulkUploadProgress.status !== "idle" && (
                    <div className="text-xs text-muted-foreground">
                      <p>
                        Processed {bulkUploadProgress.processedRows}/
                        {bulkUploadProgress.totalRows || "?"} | Inserted{" "}
                        {bulkUploadProgress.successCount} | Updated{" "}
                        {bulkUploadProgress.updatedCount} | Failed{" "}
                        {bulkUploadProgress.failedCount}
                      </p>
                      {bulkUploadProgress.errors.length > 0 && (
                        <button
                          type="button"
                          className="mt-0.5 text-[#276D9C] hover:underline cursor-pointer"
                          onClick={() => setShowBulkUploadErrorsDialog(true)}
                        >
                          View {bulkUploadProgress.errors.length} failed row
                          {bulkUploadProgress.errors.length === 1 ? "" : "s"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            {canCreateNewApplication && (
              <Button
                className="px-4 py-2 gap-2 bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer"
                onClick={() => navigate("/create-applications")}
              >
                <Plus className="size-4" />
                New Application
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Stats — layout matches commission portal MonthHistoryCommission (CornerSummaryCard) */}
      {!isOperationsDashboardView && (
        <section
          className={`mt-6 mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 ${statsGridCols} transition-opacity duration-200 ${isNavigatingToBrowse ? "opacity-80 pointer-events-none" : "opacity-100"
            }`}
        >
          {stats.map((c, i) => {
            const countNum = Number.parseInt(c.value, 10);
            const countSuffix =
              Number.isFinite(countNum) && countNum === 1
                ? "Application"
                : "Applications";
            return (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    (e.currentTarget as HTMLDivElement).click();
                  }
                }}
                onClick={() => {
                  setIsNavigatingToBrowse(true);
                  const q = getBrowseQueryFromStatCard(c.title);
                  const browseParams: GetApplicationsParams = {
                    page: 1,
                    limit: 10,
                    ...APPLICATIONS_LIST_DEFAULT_SORT,
                    lite: true,
                    ...q,
                  };
                  const browseCacheKey = applicationsListParamsCacheKey(browseParams);
                  const cachedBrowse = getCachedApplicationsList(browseCacheKey) as
                    | { data?: Application[]; pagination?: unknown }
                    | Application[]
                    | undefined;
                  if (cachedBrowse) {
                    dispatch(hydrateApplicationsListFromCache(cachedBrowse));
                  } else if (applications?.length) {
                    dispatch(
                      hydrateApplicationsListFromCache({
                        data: applications,
                        pagination: apiPagination,
                      }),
                    );
                  }
                  dispatch(
                    getApplications(browseParams),
                  );
                  window.setTimeout(() => {
                    navigate(
                      buildApplicationsBrowseUrl({
                        statsBucket: q.statsBucket,
                        currentQueue: q.currentQueue,
                        underwriterClaim: q.underwriterClaim,
                      }),
                    );
                  }, 90);
                }}
                onMouseEnter={() => prefetchBrowseFromStatCard(c.title)}
                onFocus={() => prefetchBrowseFromStatCard(c.title)}
                className="h-full cursor-pointer rounded-xl transform-gpu transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99] hover:ring-2 hover:ring-[#276D9C]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#276D9C]/40"
              >
                <CornerSummaryCard
                  isDark={isDark}
                  title={c.title.toUpperCase()}
                  icon={c.icon}
                  iconSize={24}
                  countValue={c.value}
                  countSuffix={countSuffix}
                  footLeft={c.footLeft}
                  // footNote={c.changeLabel}
                  footNoteClassName={c.changeClass}
                  amountValue={c.money}
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
        <div className="flex items-center gap-3 w-full lg:max-w-[680px]">
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
          {!isOperationsDashboardView && showUwDealPoolUi ? (
            <div
              className="flex rounded-md border border-border overflow-hidden bg-muted/40 dark:bg-muted/25 shrink-0 p-0.5 gap-0.5"
              role="tablist"
              aria-label="Underwriter deal pool"
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
                }}
                aria-pressed={underwriterPoolTab === "queue"}
              >
                <span className="text-xs font-medium sm:text-sm">Queue</span>
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
                }}
                aria-pressed={underwriterPoolTab === "my"}
              >
                <span className="text-xs font-medium sm:text-sm">My deals</span>
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
          <ApplicationTypeFilterDropdown
            value={typeFilter}
            onChange={(next) => {
              setTypeFilter(next);
              setPagination((prev) => ({ ...prev, pageIndex: 0 }));
            }}
          />
          <ApplicationPriorityFilterDropdown
            value={priorityFilter}
            onChange={(next) => {
              setPriorityFilter(next);
              setPagination((prev) => ({ ...prev, pageIndex: 0 }));
            }}
          />
          <div className="relative min-w-[12rem] flex-1">
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
            Applications
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
            <Button
              variant="destructive"
              size="sm"
              className="gap-1 cursor-pointer text-xs shrink-0"
              disabled={selectedApplicationIds.length === 0 || deleteLoading}
              onClick={handleBulkDelete}
            >
              <Trash2 className="size-3" />
              Delete
            </Button>
          </div>
        </div>
        <div
          className={`p-1 transition-opacity duration-300 ${isRefreshing ? "opacity-85" : "opacity-100"
            }`}
        >
          {listViewMode === "list" ? (
            <div className="overflow-x-auto overflow-y-auto rounded-xl [scrollbar-gutter:stable] min-h-[min(32rem,65vh)] max-lg:min-h-[min(24rem,55vh)]">
              <DataTableContent
                table={table}
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
                onRowClick={(row) => handleNavigateToApplication(row.original)}
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
            <div className="p-3 md:p-4 min-h-[min(32rem,65vh)] max-lg:min-h-[min(24rem,55vh)]">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {table.getRowModel().rows.map((row) => {
                  const app = row.original;
                  const queueLabel = getApplicationQueueLabel(app);
                  const loanAmount = app.loanAmount;
                  return (
                    <div
                      key={row.id}
                      role="group"
                      tabIndex={0}
                      onMouseEnter={() => handlePrefetchApplicationDetail(app)}
                      onClick={() => handleNavigateToApplication(app)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleNavigateToApplication(app);
                        }
                      }}
                      aria-label={`Open application ${getApplicationDealIdDisplay(app)} (${app._id})`}
                      className={`rounded-lg border shadow-sm flex flex-col gap-3 p-4 text-left transition hover:ring-2 hover:ring-[#276D9C]/20 cursor-pointer ${isDark
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
                          <button
                            type="button"
                            onClick={() => void handleOpenApplicationDetails(app)}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-[#276D9C] text-[#276D9C] hover:bg-[#276D9C]/10"
                            aria-label="View application in drawer"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p className="truncate" title={getClientEmail(app.client)}>
                          {getClientEmail(app.client)}
                        </p>
                        <p className="truncate" title={getApplicationIsoLabel(app)}>
                          <span className="text-foreground/80">ISO: </span>
                          {getApplicationIsoLabel(app)}
                        </p>
                        {showClaimedByColumn && (
                          <p
                            className="truncate"
                            title={formatUnderwriterClaimLabel(
                              app,
                              currentUserIdForClaim,
                            )}
                          >
                            <span className="text-foreground/80">
                              Claimed by:{" "}
                            </span>
                            <span className="text-foreground">
                              {formatUnderwriterClaimLabel(
                                app,
                                currentUserIdForClaim,
                              )}
                            </span>
                          </p>
                        )}
                        <p>
                          <span className="text-foreground/80">Loan: </span>
                          {loanAmount == null
                            ? "—"
                            : formatCurrency(Number(loanAmount) || 0)}
                        </p>
                        <p>
                          <span className="text-foreground/80">Created: </span>
                          {formatDate(app.createdAt)}
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
                          className="pt-2 flex justify-end gap-2"
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
              className="bg-[#276D9C] text-white hover:bg-[#276D9C]/90"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk upload failure report */}
      <Dialog
        open={showBulkUploadErrorsDialog}
        onOpenChange={setShowBulkUploadErrorsDialog}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500" />
              </div>
              <div>
                <DialogTitle className="text-left">
                  Bulk Upload — Failed Rows
                </DialogTitle>
                <DialogDescription className="text-left pt-1">
                  {bulkUploadProgress.errors.length} row
                  {bulkUploadProgress.errors.length === 1 ? "" : "s"} could not
                  be imported. Fix the issues below, then download the failed
                  rows and re-upload that file.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="overflow-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr className="text-left">
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">
                    Excel Row
                  </th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">
                    Deal ID
                  </th>
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">
                    Deal Name
                  </th>
                  <th className="px-3 py-2 font-semibold">Error</th>
                </tr>
              </thead>
              <tbody>
                {bulkUploadProgress.errors.map((err, idx) => (
                  <tr
                    key={`${err.excelRowNumber}-${idx}`}
                    className="border-t even:bg-muted/30"
                  >
                    <td className="px-3 py-2 whitespace-nowrap font-medium">
                      {err.excelRowNumber > 0 ? err.excelRowNumber : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {err.dealId?.trim() || "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap max-w-[180px] truncate">
                      {err.dealName?.trim() || "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {err.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter className="sm:justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={handleDownloadFailedBulkRows}
              disabled={!bulkUploadSourceFileRef.current}
            >
              <Download className="size-4" />
              Download failed rows
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowBulkUploadErrorsDialog(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                className="bg-[#276D9C] text-white hover:bg-[#276D9C]/90 gap-2"
                onClick={() => {
                  setShowBulkUploadErrorsDialog(false);
                  bulkUploadInputRef.current?.click();
                }}
              >
                <Upload className="size-4" />
                Re-upload
              </Button>
            </div>
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
                className="bg-[#276D9C] text-white hover:bg-[#276D9C]/90"
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
    </div>
  );
};

export default Applications;
