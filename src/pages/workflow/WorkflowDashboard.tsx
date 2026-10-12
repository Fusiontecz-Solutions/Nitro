import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BadgeCheck,
  BookCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  FileSignature,
  MailCheck,
  LayoutGrid,
  LayoutList,
  Loader2,
  Plus,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatCurrency, formatDate, formatInt } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { resolveEffectiveRole } from "@/lib/sessionRole";
import { isSuperAdminAppRole, PERMISSIONS, roleCan, WORKFLOW_QUEUE_PATH } from "@/lib/roleAccess";
import {
  fetchWorkflowSummary,
  type WorkflowListItem,
  type WorkflowScope,
} from "@/lib/workflowApi";
import { bucketDefsForScope } from "@/constants/workflowBuckets";
import { useWorkflowScope } from "@/hooks/useWorkflowScope";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import {
  DashboardDateRangeFilter,
  type DashboardDateRangeValue,
} from "@/components/dashboard/DashboardDateRangeFilter";
import WorkflowStatusBadge from "@/components/workflow/WorkflowStatusBadge";
import WorkflowQueueTable from "@/components/workflow/WorkflowQueueTable";

/** Same key as the Applications list so the list/grid preference is shared. */
const RECENT_APPLICATIONS_VIEW_MODE_STORAGE_KEY = "applicationsListViewMode";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type TrendView = "monthly" | "yearly";

/** Katam-style colored icon + amount caption per workflow bucket. */
const BUCKET_CARD_STYLE: Record<string, { icon: ReactNode; caption: string }> = {
  all: { icon: <ClipboardList className="text-indigo-600" />, caption: "Total submitted amount" },
  drafts: { icon: <Clock className="text-amber-600" />, caption: "Total draft amount" },
  in_underwriting: { icon: <Activity className="text-orange-600" />, caption: "Total in underwriting amount" },
  awaiting_my_approval: { icon: <BadgeCheck className="text-blue-600" />, caption: "Total awaiting approval amount" },
  sent_to_iso: { icon: <MailCheck className="text-cyan-600" />, caption: "Total sent to ISO amount" },
  contract_pending: { icon: <FileSignature className="text-green-600" />, caption: "Total contract pending amount" },
  incoming: { icon: <ClipboardList className="text-indigo-600" />, caption: "Total incoming amount" },
  my_claimed: { icon: <BookCheck className="text-cyan-600" />, caption: "Total claimed amount" },
  needs_re_review: { icon: <Activity className="text-amber-600" />, caption: "Total needs re-review amount" },
  sent_to_agent: { icon: <BadgeCheck className="text-blue-600" />, caption: "Total sent to agent amount" },
  completed: { icon: <CheckCircle2 className="text-green-600" />, caption: "Total completed amount" },
};

type FunnelStage = { stage: string; value: number; percentage: number; color: string };

/** Pipeline stages per scope, built from the workflow bucket counts. */
function buildWorkflowFunnel(scope: WorkflowScope, counts: Record<string, number>) {
  const c = (k: string) => Math.max(0, counts[k] ?? 0);
  const rows =
    scope === "agent"
      ? [
          { stage: "Submitted", value: Math.max(0, c("all") - c("drafts")), color: "#3B82F6" },
          { stage: "In Underwriting", value: c("in_underwriting"), color: "#F97316" },
          { stage: "Awaiting My Approval", value: c("awaiting_my_approval"), color: "#A855F7" },
          { stage: "Sent to ISO", value: c("sent_to_iso"), color: "#06B6D4" },
          { stage: "Contract Pending", value: c("contract_pending"), color: "#10B981" },
        ]
      : [
          {
            stage: "Picked",
            value: c("my_claimed") + c("needs_re_review") + c("sent_to_agent") + c("completed"),
            color: "#3B82F6",
          },
          { stage: "Underwriting", value: c("my_claimed") + c("needs_re_review"), color: "#F97316" },
          { stage: "Sent to Agent", value: c("sent_to_agent"), color: "#A855F7" },
          { stage: "Completed", value: c("completed"), color: "#10B981" },
        ];
  const total = rows[0].value;
  const stages: FunnelStage[] = rows.map((r) => ({
    ...r,
    percentage: total > 0 ? Math.round((r.value / total) * 100) : 0,
  }));
  const done = stages[stages.length - 1].value;
  const conversionText = total > 0 ? `${Math.round((done / total) * 100)}% (${done}/${total})` : "—";
  return { stages, conversionText };
}

/** Pipeline funnel card: stages fill the middle; conversion rate is pinned to the bottom bar. */
function ApplicationPipelineFunnelCard({
  isDark,
  className = "",
  stages,
  conversionText,
}: {
  isDark: boolean;
  className?: string;
  stages: FunnelStage[];
  conversionText: string;
}) {
  return (
    <div
      className={`flex min-h-[320px] flex-col overflow-hidden rounded-xl border shadow-md ${isDark ? "border-slate-700/80 bg-[#141517]" : "border-slate-200/90 bg-white"} ${className}`}
    >
      <div
        className={`flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4 ${isDark ? "border-white/10" : "border-slate-100"}`}
      >
        <h3 className={`text-[11px] font-bold uppercase tracking-[0.14em] ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Application Pipeline Funnel
        </h3>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-5 pt-1">
        <div className="flex flex-1 flex-col justify-center gap-5 pb-2">
          {stages.map((item, index) => {
            const pct = Math.min(100, Math.max(0, Math.round(item.percentage)));
            const showZeroCap = pct === 0 && item.value === 0;
            const fillPct = showZeroCap ? 0 : Math.min(100, Math.max(pct, 5));
            const tight = !showZeroCap && fillPct < 22;
            const pctLabel = pct === 0 ? `${String(pct).padStart(2, "0")}%` : `${pct}%`;
            return (
              <div key={`${item.stage}-${index}`} className="flex items-center gap-3 sm:gap-4">
                <div className="w-[124px] shrink-0 text-[12px] font-medium leading-snug text-foreground sm:w-[148px] dark:text-slate-100">
                  {item.stage}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`relative h-8 w-full overflow-hidden rounded-full ${isDark ? "bg-white/[0.08]" : "bg-slate-100"}`}>
                    {showZeroCap ? (
                      <div
                        className="absolute left-0 top-0 z-[1] flex h-8 w-8 items-center justify-center rounded-l-full rounded-r-none shadow-sm ring-1 ring-black/5"
                        style={{ backgroundColor: item.color }}
                        aria-hidden
                      >
                        <span className="text-[10px] font-semibold tabular-nums leading-none text-white">{pctLabel}</span>
                      </div>
                    ) : (
                      <div
                        className={`flex h-full min-h-8 items-center bg-transparent ${fillPct >= 100 ? "rounded-full" : "rounded-l-full rounded-r-none"} ${tight ? "justify-between px-2" : "justify-between px-3"}`}
                        style={{ width: `${fillPct}%`, backgroundColor: item.color, transition: "width 0.35s ease" }}
                      >
                        <span className="text-[11px] font-semibold tabular-nums text-white drop-shadow-sm">
                          {formatInt(item.value)}
                        </span>
                        <span className="text-[11px] font-semibold tabular-nums text-white drop-shadow-sm">{pctLabel}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`mt-auto flex shrink-0 items-center justify-between gap-4 border-t px-5 py-4 ${isDark ? "border-white/10 bg-[#1c1d21]" : "border-slate-100 bg-[#eef3ff]"}`}
      >
        <span className="text-sm font-semibold tracking-tight text-foreground">Conversion Rate</span>
        <span className="text-sm font-bold tabular-nums text-foreground">{conversionText}</span>
      </div>
    </div>
  );
}

/** Agent / Underwriter dashboard (Super Admin sees it as workflow oversight). Layout follows Katam. */
export default function WorkflowDashboard() {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { scope, canSwitch, setScope } = useWorkflowScope();
  const role = resolveEffectiveRole(undefined);
  /** Super Admin switches scope like oversight but also acts in both seats. */
  const actsInWorkflow = !canSwitch || isSuperAdminAppRole(role);

  // Queues are "what is on my plate", so the default window is all time.
  const [dateRange, setDateRange] = useState<DashboardDateRangeValue>({ startDate: "", endDate: "" });
  const [trendView, setTrendView] = useState<TrendView>("monthly");
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    try {
      return localStorage.getItem(RECENT_APPLICATIONS_VIEW_MODE_STORAGE_KEY) === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(RECENT_APPLICATIONS_VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      /* storage unavailable */
    }
  }, [viewMode]);

  const summary = useQuery({
    queryKey: ["workflow-summary", scope, dateRange.startDate, dateRange.endDate],
    queryFn: () => fetchWorkflowSummary(scope, dateRange),
    staleTime: 30_000,
  });


  const buckets = bucketDefsForScope(scope);
  const counts = useMemo(() => summary.data?.counts ?? {}, [summary.data?.counts]);
  const amounts = summary.data?.amounts ?? {};
  const actionBucket = scope === "agent" ? "awaiting_my_approval" : "incoming";
  const actionCount = counts[actionBucket] ?? 0;

  const openBucket = useCallback(
    (bucket: string) =>
      navigate(`${WORKFLOW_QUEUE_PATH}?${new URLSearchParams({ ...(canSwitch ? { scope } : {}), bucket }).toString()}`),
    [navigate, canSwitch, scope],
  );

  const openApplication = useCallback(
    (app: WorkflowListItem) => navigate(`/application-details/${app.applicationId}`),
    [navigate],
  );

  const funnel = useMemo(() => buildWorkflowFunnel(scope, counts), [scope, counts]);

  const trendData = useMemo(() => {
    const rows = summary.data?.trend ?? [];
    if (trendView === "monthly") {
      return rows.map((r) => {
        const [y, m] = r.dateKey.split("-");
        return { ...r, name: `${MONTH_SHORT[Number(m) - 1] ?? m} ${y.slice(2)}` };
      });
    }
    const byYear = new Map<string, { submitted: number; approved: number }>();
    for (const r of rows) {
      const y = r.dateKey.slice(0, 4);
      const e = byYear.get(y) ?? { submitted: 0, approved: 0 };
      e.submitted += r.submitted;
      e.approved += r.approved;
      byYear.set(y, e);
    }
    return Array.from(byYear.entries()).map(([y, v]) => ({ ...v, dateKey: y, name: y }));
  }, [summary.data?.trend, trendView]);

  const trendChartYMax = useMemo(() => {
    let max = 0;
    for (const p of trendData) max = Math.max(max, p.submitted, p.approved);
    if (max <= 0) return 1;
    const padded = max * 1.12;
    const step =
      padded >= 1_000_000 ? 100_000 : padded >= 100_000 ? 10_000 : padded >= 10_000 ? 1_000 : padded >= 1_000 ? 100 : 10;
    return Math.max(Math.ceil(padded / step) * step, step);
  }, [trendData]);

  const recent = summary.data?.recent ?? [];
  const brandButtonClass =
    "h-9 gap-2 border-[var(--brand)] bg-[var(--brand)] text-white hover:bg-[var(--brand)]/90 hover:text-white";
  const axisColor = isDark ? "#FFFFFF" : "#000000";

  return (
    <main className="flex-1 px-6 py-6 md:px-8">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">
          {!actsInWorkflow ? "Workflow oversight" : scope === "agent" ? "Agent Dashboard" : "Underwriter Dashboard"}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          {canSwitch ? (
            <div className="inline-flex rounded-md border border-border bg-muted/60 p-0.5 text-xs font-medium">
              {(["agent", "underwriter"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={cn(
                    "rounded px-3 py-1.5 capitalize transition",
                    scope === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {s}s
                </button>
              ))}
            </div>
          ) : null}
          {scope === "agent" && roleCan(role, PERMISSIONS.APPLICATION_CREATE) && actsInWorkflow ? (
            <Button variant="outline" className={brandButtonClass} onClick={() => navigate("/create-applications")}>
              <Plus className="size-4" />
              <span className="text-sm font-semibold">New Application</span>
            </Button>
          ) : null}
          {scope === "underwriter" && actsInWorkflow ? (
            <Button variant="outline" className={brandButtonClass} onClick={() => openBucket("incoming")}>
              <span className="text-sm font-semibold">View Incoming Queue</span>
            </Button>
          ) : null}
          <DashboardDateRangeFilter startDate={dateRange.startDate} endDate={dateRange.endDate} onApply={setDateRange} />
        </div>
      </div>


      {summary.error ? (
        <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive" role="alert">
          {(summary.error as Error).message}
        </p>
      ) : null}

      {actsInWorkflow && actionCount > 0 ? (
        <button
          type="button"
          onClick={() => openBucket(actionBucket)}
          className="mt-6 flex w-full items-center justify-between gap-4 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/5 p-4 text-left transition hover:bg-[var(--brand)]/10"
        >
          <span className="font-medium text-foreground">
            {scope === "agent"
              ? `${actionCount} application${actionCount === 1 ? "" : "s"} waiting for your approval`
              : `${actionCount} application${actionCount === 1 ? "" : "s"} ready to claim`}
          </span>
          <span className="text-sm font-medium text-[var(--brand)]">Open queue →</span>
        </button>
      ) : null}

      {/* KPI cards */}
      {/* 5 cards per row (Katam layout); any extra cards wrap to the next row. */}
      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        {buckets.map((b) => (
          <div
            key={b.key}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openBucket(b.key);
              }
            }}
            onClick={() => openBucket(b.key)}
            className="h-full cursor-pointer rounded-xl transition hover:ring-2 hover:ring-[var(--brand)]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
          >
            <DashboardStatCard
              isDark={isDark}
              title={b.label}
              isLoading={summary.isLoading}
              countValue={String(counts[b.key] ?? 0)}
              countSuffix="Submissions"
              footLeft={BUCKET_CARD_STYLE[b.key]?.caption ?? "Total amount"}
              amountValue={formatCurrency(amounts[b.key] ?? 0)}
              icon={BUCKET_CARD_STYLE[b.key]?.icon ?? <b.icon className="text-[#3B82F6]" />}
              iconSize={24}
            />
          </div>
        ))}
      </section>

      {/* Charts: trend ~70% + pipeline funnel ~30% */}
      <section className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[7fr_3fr]">
        <div
          className={`h-full min-h-[350px] min-w-0 rounded-md border p-5 shadow-lg ${isDark ? "border-[#374151] bg-[#141517]" : "border-[#FDFDFD] bg-card"}`}
        >
          <div className="flex items-center justify-between gap-4">
            <h3 className="font-semibold text-foreground">{trendView === "monthly" ? "Monthly" : "Yearly"} Trend</h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-[#76B7E2]" />
                <span className="text-sm text-muted-foreground">Approved</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-[var(--brand)]" />
                <span className="text-sm text-muted-foreground">Submitted</span>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-8 gap-2 text-sm">
                  {trendView === "monthly" ? "Monthly" : "Yearly"}
                  <ChevronDown className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setTrendView("monthly")}>Monthly</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTrendView("yearly")}>Yearly</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mt-10 h-[210px]">
            {trendData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {summary.isLoading ? "Loading…" : "No applications in this range"}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendData} barCategoryGap={20} barGap={0} margin={{ top: 5, right: 5, bottom: 5, left: 30 }}>
                  <CartesianGrid vertical={false} horizontal={false} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tickLine={false} axisLine fontSize={12} stroke={axisColor} tick={{ fill: axisColor }} />
                  <YAxis
                    tickLine={false}
                    axisLine
                    stroke={axisColor}
                    fontSize={12}
                    tick={{ fill: axisColor }}
                    label={{ value: "Amount", angle: -90, position: "insideLeft", offset: -20, style: { textAnchor: "middle" } }}
                    tickFormatter={(value) => formatCurrency(value as number)}
                    domain={[0, trendChartYMax]}
                    tickCount={6}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(0, 0, 0, 0.05)" }}
                    content={({ payload, label }) => (
                      <div className="rounded-md bg-card p-2 shadow-md">
                        <p className="font-medium text-foreground">{label}</p>
                        {payload?.map((entry, index) => (
                          <p key={index} className="text-sm">
                            <span style={{ color: entry.color }}>{entry.name}:</span>{" "}
                            <span className="text-foreground">{formatCurrency(entry.value as number)}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  />
                  <Bar dataKey="submitted" name="Submitted" fill="var(--brand)" radius={[3, 3, 0, 0]} barSize={12} />
                  <Bar dataKey="approved" name="Approved" fill="#76B7E2" radius={[3, 3, 0, 0]} barSize={12} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
            <div className="mt-2 flex justify-center text-muted-foreground">{trendView === "monthly" ? "Months" : "Years"}</div>
          </div>
        </div>

        <ApplicationPipelineFunnelCard
          isDark={isDark}
          className="min-h-[350px] min-w-0"
          stages={funnel.stages}
          conversionText={funnel.conversionText}
        />
      </section>

      {/* Recent applications */}
      <section className="mt-6">
        <div className={`rounded-[5px] border shadow-lg ${isDark ? "border-[#374151] bg-[#141517]" : "border-[#FDFDFD] bg-card"}`}>
          <div
            className={`flex flex-wrap items-center justify-between gap-3 rounded-t-[5px] px-4 py-2 md:px-5 ${isDark ? "bg-[#2A2B2F]" : "bg-[#F9FAFD]"}`}
          >
            <span className="text-[1rem] font-semibold uppercase text-foreground">Recent Applications</span>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Applications display layout">
                <span className="hidden text-xs text-muted-foreground sm:inline">View</span>
                <div className="flex overflow-hidden rounded-md border border-border bg-card">
                  <Button
                    type="button"
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-10 gap-1.5 rounded-none px-3 shadow-none sm:h-9"
                    onClick={() => setViewMode("list")}
                    aria-pressed={viewMode === "list"}
                  >
                    <LayoutList className="size-4 shrink-0" />
                    <span className="text-xs font-medium">List</span>
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === "grid" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-10 gap-1.5 rounded-none border-l border-border px-3 shadow-none sm:h-9"
                    onClick={() => setViewMode("grid")}
                    aria-pressed={viewMode === "grid"}
                  >
                    <LayoutGrid className="size-4 shrink-0" />
                    <span className="text-xs font-medium">Grid</span>
                  </Button>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => openBucket(scope === "agent" ? "all" : "incoming")}>
                View all
              </Button>
            </div>
          </div>
          {viewMode === "list" ? (
            /* Same table as the Applications list and the workflow queues. */
            <WorkflowQueueTable
              scope={scope}
              rows={recent}
              loading={summary.isLoading}
              showPagination={false}
              emptyMessage={scope === "agent" ? "No applications yet — create your first one." : "No applications found"}
            />
          ) : (
          <div className="p-1">
            <div className="overflow-x-auto rounded-xl">
              {summary.isLoading && recent.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 shrink-0 animate-spin text-primary" />
                  <span className="ml-2 text-muted-foreground">Loading applications...</span>
                </div>
              ) : recent.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl px-4 py-16 text-center">
                  <p className="font-medium text-muted-foreground">No applications found</p>
                </div>
              ) : (
                <div className="p-3 md:p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {recent.map((app) => (
                      <div
                        key={app.id}
                        role="group"
                        tabIndex={0}
                        aria-label={`Open application ${app.applicationId}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openApplication(app);
                          }
                        }}
                        onClick={() => openApplication(app)}
                        className={`flex cursor-pointer flex-col gap-3 rounded-lg border p-4 text-left shadow-sm transition hover:ring-2 hover:ring-[var(--brand)]/20 ${isDark ? "border-[#374151] bg-[#1a1b1e]" : "border-[#F0F0F0] bg-card"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-foreground">{app.businessName || "—"}</p>
                            <p className="truncate text-xs text-muted-foreground">{app.dealId || app.applicationId}</p>
                          </div>
                          <WorkflowStatusBadge queue={app.currentQueue} />
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-muted-foreground">Loan amount</p>
                            <p className="font-medium text-foreground">{app.loanAmount == null ? "-" : formatCurrency(app.loanAmount)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Last modified</p>
                            <p className="font-medium text-foreground">{formatDate(app.updatedAt ?? app.createdAt, "-")}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </section>
    </main>
  );
}
