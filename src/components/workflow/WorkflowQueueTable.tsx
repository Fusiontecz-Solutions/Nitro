import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { motion } from "framer-motion";
import { EyeIcon, Hand, TrendingUp } from "lucide-react";
import { DataTableContent, DataTablePagination, DataTableSortHeader } from "@/components/DataTable";
import ApplicationProgressBar from "@/components/application/ApplicationProgressBar";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate, formatDateTimeUS } from "@/lib/utils";
import type { WorkflowBucket, WorkflowListItem, WorkflowScope } from "@/lib/workflowApi";
import WorkflowStatusBadge from "./WorkflowStatusBadge";

type ExtraColumn = "iso" | "underwriter" | "agent" | "offer";

/**
 * Stage-specific columns shown between REQUEST AMOUNT and CURRENT STATE.
 * Everything else (layout, headers, badges, dates, progress, view) matches the Applications list.
 */
function extraColumnsFor(scope: WorkflowScope, bucket?: WorkflowBucket | string): ExtraColumn[] {
  if (scope === "agent") {
    switch (bucket) {
      case "drafts":
        return ["iso"];
      case "awaiting_my_approval":
      case "sent_to_iso":
      case "contract_pending":
        return ["iso", "underwriter", "offer"];
      default:
        return ["iso", "underwriter"];
    }
  }
  switch (bucket) {
    case "needs_re_review":
    case "sent_to_agent":
    case "completed":
      return ["agent", "iso", "offer"];
    default:
      return ["agent", "iso"];
  }
}

const headerLabel = (label: string) => (
  <span className="font-medium uppercase tracking-wide whitespace-nowrap text-foreground">{label}</span>
);

/** Role-scoped application table (Agent / Underwriter queues + dashboard "recent"), styled like Applications. */
export default function WorkflowQueueTable({
  scope,
  bucket,
  rows,
  loading,
  totalItems,
  pageCount,
  pagination,
  onPaginationChange,
  onClaim,
  claimingId,
  showPagination = true,
  emptyMessage = "No applications found",
}: {
  scope: WorkflowScope;
  /** Active queue bucket — decides the stage-specific columns. */
  bucket?: WorkflowBucket | string;
  rows: WorkflowListItem[];
  loading: boolean;
  totalItems?: number;
  pageCount?: number;
  pagination?: PaginationState;
  onPaginationChange?: (next: PaginationState) => void;
  /** Underwriter pool: claim straight from the list. */
  onClaim?: (row: WorkflowListItem) => void;
  claimingId?: string | null;
  showPagination?: boolean;
  emptyMessage?: string;
}) {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expandedProgressRowId, setExpandedProgressRowId] = useState<string | null>(null);

  const openApplication = useCallback(
    (row: WorkflowListItem) => navigate(`/application-details/${row.applicationId}`),
    [navigate],
  );

  const columns = useMemo<ColumnDef<WorkflowListItem>[]>(() => {
    const extraDefs: Record<ExtraColumn, ColumnDef<WorkflowListItem>> = {
      iso: {
        id: "iso",
        size: 150,
        accessorFn: (row) => row.iso?.name ?? "",
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="ISO" />,
        cell: ({ row }) => (
          <span className="block truncate text-foreground" title={row.original.iso?.name ?? ""}>
            {row.original.iso?.name || "-"}
          </span>
        ),
      },
      underwriter: {
        id: "underwriter",
        size: 150,
        accessorFn: (row) => row.underwriter?.name ?? row.approvedBy?.name ?? "",
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="UNDERWRITER" />,
        cell: ({ row }) => (
          <span className="block truncate text-foreground">
            {row.original.underwriter?.name || row.original.approvedBy?.name || "Unclaimed"}
          </span>
        ),
      },
      agent: {
        id: "agent",
        size: 150,
        accessorFn: (row) => row.agent?.name ?? "",
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="AGENT" />,
        cell: ({ row }) => <span className="block truncate text-foreground">{row.original.agent?.name || "-"}</span>,
      },
      offer: {
        id: "offerAmount",
        size: 150,
        accessorFn: (row) => row.offerAmount ?? -1,
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="OFFER AMOUNT" />,
        cell: ({ row }) => (
          <span className="text-foreground">
            {row.original.offerAmount == null ? "-" : formatCurrency(row.original.offerAmount)}
          </span>
        ),
      },
    };

    const cols: ColumnDef<WorkflowListItem>[] = [
      {
        id: "dealId",
        size: 100,
        accessorFn: (row) => row.dealId || String(row.applicationId),
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="DEAL ID" />,
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.dealId || row.original.applicationId}</span>
        ),
      },
      {
        id: "businessName",
        size: 170,
        accessorFn: (row) => row.businessName ?? "",
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="BUSINESS NAME" />,
        cell: ({ row }) => (
          <span className="block truncate text-foreground" title={row.original.businessName ?? ""}>
            {row.original.businessName || "-"}
          </span>
        ),
      },
      {
        id: "seeProgress",
        size: 88,
        enableSorting: false,
        header: () => headerLabel("Progress"),
        cell: ({ row }) => {
          const isOpen = expandedProgressRowId === row.id;
          return (
            <motion.button
              type="button"
              data-row-click-ignore
              onClick={(e) => {
                e.stopPropagation();
                setExpandedProgressRowId((prev) => (prev === row.id ? null : row.id));
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
              aria-label={isOpen ? "Hide application progress" : "See application progress"}
              aria-expanded={isOpen}
              title={isOpen ? "Hide progress" : "See progress"}
            >
              <TrendingUp className="h-5 w-5 drop-shadow-sm" strokeWidth={2.75} aria-hidden />
            </motion.button>
          );
        },
      },
      {
        id: "loanAmount",
        size: 150,
        accessorFn: (row) => row.loanAmount ?? -1,
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="Request Amount" />,
        cell: ({ row }) => (
          <span className="text-foreground">
            {row.original.loanAmount == null ? "-" : formatCurrency(row.original.loanAmount)}
          </span>
        ),
      },
      ...extraColumnsFor(scope, bucket).map((key) => extraDefs[key]),
      {
        id: "currentQueue",
        size: 170,
        accessorFn: (row) => row.currentQueue ?? "",
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="CURRENT STATE" />,
        cell: ({ row }) => <WorkflowStatusBadge queue={row.original.currentQueue} />,
      },
      {
        id: "createdAt",
        size: 170,
        accessorKey: "createdAt",
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="CREATED AT" />,
        cell: ({ row }) => <span className="text-foreground">{formatDateTimeUS(row.original.createdAt, "-")}</span>,
      },
      {
        id: "lastModifiedAt",
        size: 150,
        accessorFn: (row) => row.updatedAt ?? row.createdAt,
        enableSorting: true,
        header: ({ column }) => <DataTableSortHeader column={column} label="Last Modified Date" />,
        cell: ({ row }) => (
          <span className="text-foreground">{formatDate(row.original.updatedAt ?? row.original.createdAt, "-")}</span>
        ),
      },
    ];

    if (onClaim) {
      cols.push({
        id: "claim",
        size: 110,
        enableSorting: false,
        header: () => headerLabel("Action"),
        cell: ({ row }) =>
          !row.original.underwriter ? (
            <div data-row-click-ignore>
              <Button
                size="sm"
                className="h-8 gap-1"
                loading={claimingId === row.original.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onClaim(row.original);
                }}
              >
                <Hand className="size-3.5" /> Claim
              </Button>
            </div>
          ) : null,
      });
    }

    cols.push({
      id: "view",
      size: 72,
      enableSorting: false,
      header: () => (
        <span className="flex w-full justify-center font-medium uppercase tracking-wide text-foreground">VIEW</span>
      ),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openApplication(row.original);
          }}
          className="mx-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-transparent text-[var(--brand)] hover:text-[var(--brand-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/30"
          aria-label="View application details"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-current bg-transparent text-xs font-bold">
            <EyeIcon className="h-4 w-4" />
          </span>
        </button>
      ),
    });

    return cols;
  }, [scope, bucket, onClaim, claimingId, expandedProgressRowId, openApplication]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    manualPagination: true,
    pageCount: pageCount ?? 1,
    state: { sorting, ...(pagination ? { pagination } : {}) },
    getRowId: (row) => row.id,
    onPaginationChange: (updater) => {
      if (!pagination || !onPaginationChange) return;
      onPaginationChange(typeof updater === "function" ? updater(pagination) : updater);
    },
  });

  return (
    <>
      <div className="p-1">
        <div className="overflow-x-auto overflow-y-auto rounded-xl [scrollbar-gutter:stable]">
          <DataTableContent
            table={table}
            fixedLayout
            loading={loading && rows.length === 0}
            loadingMessage="Loading applications..."
            emptyMessage={emptyMessage}
            onRowClick={(row) => openApplication(row.original)}
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
                <div className="border-t border-amber-200/50 bg-gradient-to-b from-amber-50/50 via-white to-white px-4 py-4 dark:border-amber-900/30 dark:from-amber-950/20 dark:via-slate-950/40 dark:to-slate-950/20 sm:px-6">
                  <ApplicationProgressBar application={row.original} className="shadow-sm" />
                </div>
              </motion.div>
            )}
          />
        </div>
      </div>
      {showPagination && rows.length > 0 ? (
        <DataTablePagination table={table} totalItems={totalItems} showSelectedCount={false} />
      ) : null}
    </>
  );
}
