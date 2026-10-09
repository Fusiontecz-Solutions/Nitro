import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import {
  AlertCircle,
  ArrowUpRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  Gauge,
  Mail,
  MailCheck,
  MousePointerClick,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { fetchSendGridUsage } from "@/redux/actions/integrationSettingsActions";
import type { SendGridUsageSummary } from "@/types/integrationSettingsTypes";
import type { RootState } from "@/redux/store";
import { isSuperAdminRole, resolveEffectiveRole } from "@/lib/sessionRole";

const QUERY_KEY = ["sendgrid-usage"] as const;

const PERIOD_UNIT: Record<string, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US");
}

function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/** Everything the tab and modal display, derived once from the API payload. */
function deriveUsage(data: SendGridUsageSummary | undefined) {
  const credits = data?.credits;
  const total = credits?.total ?? null;
  const used = credits?.used ?? null;
  const remaining = credits?.remaining ?? null;
  const freq = credits?.resetFrequency?.toLowerCase() ?? null;
  const unit = freq ? PERIOD_UNIT[freq] ?? freq : null;
  const usedPct = total && used != null ? Math.min(100, Math.max(0, (used / total) * 100)) : null;
  const tone: "ok" | "warn" | "danger" =
    usedPct == null || usedPct < 70 ? "ok" : usedPct < 90 ? "warn" : "danger";
  return {
    planName: data?.planName ?? (data?.configured === false ? "Not configured" : "SendGrid"),
    total,
    used,
    remaining,
    unit,
    periodLabel: unit === "day" ? "today" : unit ? `this ${unit}` : "this period",
    allowance: total != null ? `${fmt(total)} emails${unit ? ` / ${unit}` : ""}` : null,
    usedPct,
    tone,
    nextReset: fmtDateTime(credits?.nextReset),
    resetTime: fmtTime(credits?.nextReset),
    today: data?.today ?? null,
    fetchedAt: fmtTime(data?.fetchedAt),
  };
}

type Usage = ReturnType<typeof deriveUsage>;

const TONE_BAR: Record<Usage["tone"], string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
};

const TONE_PILL: Record<Usage["tone"], string> = {
  ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const TONE_LABEL: Record<Usage["tone"], string> = {
  ok: "Healthy",
  warn: "Running low",
  danger: "Almost out",
};

function UsageBar({ usage }: { usage: Usage }) {
  if (usage.usedPct == null) return null;
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${TONE_BAR[usage.tone]} transition-all duration-500`}
          style={{ width: `${Math.max(usage.usedPct, 1.5)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>
          {fmt(usage.used)} used {usage.periodLabel}
        </span>
        <span>{fmt(usage.remaining)} left</span>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      {loading ? (
        <span className="mt-2 block h-7 w-16 rounded-md bg-muted/70 animate-pulse" aria-hidden />
      ) : (
        <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      )}
      {!loading && hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CheckRow({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-sm text-foreground">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        <CheckCircle2 className="size-3.5" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </li>
  );
}

function PlanDetailsDialog({
  open,
  onOpenChange,
  usage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usage: Usage;
}) {
  const t = usage.today;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl p-0 sm:rounded-2xl">
        <div className="bg-gradient-to-b from-muted/70 to-background px-6 pt-7 pb-6">
          <div className="rounded-2xl border border-border/70 bg-background/80 p-5 shadow-sm backdrop-blur">
            <DialogDescription className="text-xs text-muted-foreground">
              Email delivery powered by SendGrid
            </DialogDescription>
            <DialogTitle className="mt-1 text-4xl font-semibold tracking-tight text-foreground">
              {usage.planName}
            </DialogTitle>
            <div className="mt-5 flex items-center justify-center gap-2 rounded-full bg-muted px-4 py-2.5 text-sm font-medium text-foreground">
              <Gauge className="size-4" />
              {usage.allowance ?? "Allowance unavailable"}
            </div>
          </div>
        </div>

        <div className="space-y-6 px-6 pb-6">
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Your plan includes
            </p>
            <ul className="space-y-3">
              {usage.allowance ? <CheckRow>{usage.allowance}</CheckRow> : null}
              {usage.unit ? (
                <CheckRow>
                  Credits reset every {usage.unit}
                  {usage.resetTime ? ` at ${usage.resetTime}` : ""}
                </CheckRow>
              ) : null}
              <CheckRow>Open &amp; click tracking</CheckRow>
              <CheckRow>Bounce, block &amp; spam reporting</CheckRow>
            </ul>
          </div>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Usage {usage.periodLabel}
            </p>
            <UsageBar usage={usage} />
            <ul className="mt-4 space-y-3">
              <CheckRow>
                <b className="tabular-nums">{fmt(t?.requests)}</b> emails sent ·{" "}
                <b className="tabular-nums">{fmt(t?.delivered)}</b> delivered
              </CheckRow>
              <CheckRow>
                <b className="tabular-nums">{fmt(usage.remaining)}</b> of {fmt(usage.total)} credits left
              </CheckRow>
              <CheckRow>
                <b className="tabular-nums">{fmt(t?.opens)}</b> unique opens ·{" "}
                <b className="tabular-nums">{fmt(t?.clicks)}</b> clicks
              </CheckRow>
              <CheckRow>
                <b className="tabular-nums">{fmt(t?.bounces)}</b> bounced ·{" "}
                <b className="tabular-nums">{fmt(t?.blocks)}</b> blocked ·{" "}
                <b className="tabular-nums">{fmt(t?.spamReports)}</b> spam reports
              </CheckRow>
              {usage.nextReset ? <CheckRow>Next reset {usage.nextReset}</CheckRow> : null}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact "Email Plan" button (Contract tab) that opens the plan details modal.
 * Renders nothing for non-super-admins — the usage endpoint is super-admin only.
 */
export function EmailPlanButton({ className = "" }: { className?: string }) {
  const loginUser = useSelector((state: RootState) => state.login?.data?.user);
  const canView = isSuperAdminRole(resolveEffectiveRole(loginUser));
  const [open, setOpen] = useState(false);
  const { data, isFetching } = useQuery<SendGridUsageSummary>({
    queryKey: QUERY_KEY,
    queryFn: () => fetchSendGridUsage(),
    staleTime: 60_000,
    enabled: canView,
    retry: 1,
  });
  if (!canView) return null;
  const usage = deriveUsage(data);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!data && isFetching}
        className={`h-10 gap-2 rounded-md bg-background px-4 font-medium cursor-pointer ${className}`}
      >
        <Mail className="size-4 text-[var(--brand)]" />
        <span>{usage.planName}</span>
        {usage.remaining != null ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${TONE_PILL[usage.tone]}`}
          >
            {fmt(usage.remaining)} left
          </span>
        ) : null}
      </Button>
      <PlanDetailsDialog open={open} onOpenChange={setOpen} usage={usage} />
    </>
  );
}

/** Settings → Email Plan: SendGrid plan, credits left and today's send volume. */
export default function EmailPlanSettings() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { data, isLoading, isError, error } = useQuery<SendGridUsageSummary>({
    queryKey: QUERY_KEY,
    queryFn: () => fetchSendGridUsage(),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
  const usage = deriveUsage(data);
  const t = usage.today;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(QUERY_KEY, await fetchSendGridUsage(true));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-border py-0">
        <div className="relative bg-[image:var(--brand-gradient)] px-6 py-6 text-white">
          <Sparkles className="pointer-events-none absolute -right-4 -top-4 size-32 opacity-10" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
                <Mail className="size-6" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-white/80">SendGrid email plan</p>
                {isLoading ? (
                  <span className="mt-1 block h-8 w-36 rounded-md bg-white/25 animate-pulse" aria-hidden />
                ) : (
                  <h2 className="text-3xl font-semibold tracking-tight">{usage.planName}</h2>
                )}
                {usage.allowance ? <p className="mt-0.5 text-sm text-white/85">{usage.allowance}</p> : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="gap-1.5 bg-white/15 text-white hover:bg-white/25 border-0"
                onClick={handleRefresh}
                disabled={refreshing || isLoading}
              >
                <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-1.5 bg-white text-foreground hover:bg-white/90"
                onClick={() => setDetailsOpen(true)}
                disabled={isLoading || !data}
              >
                View plan details
                <ArrowUpRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <CardContent className="space-y-5 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Credit usage {usage.periodLabel}</span>
              {usage.usedPct != null ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_PILL[usage.tone]}`}>
                  {TONE_LABEL[usage.tone]} · {usage.usedPct.toFixed(0)}%
                </span>
              ) : null}
            </div>
            {usage.nextReset ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarClock className="size-3.5" />
                Resets {usage.nextReset}
              </span>
            ) : null}
          </div>
          {isLoading ? (
            <span className="block h-2.5 w-full rounded-full bg-muted animate-pulse" aria-hidden />
          ) : (
            <UsageBar usage={usage} />
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              icon={<Send className="size-4 text-sky-500" />}
              label="Sent today"
              value={fmt(t?.requests)}
              hint={t ? `${fmt(t.delivered)} delivered` : undefined}
              loading={isLoading}
            />
            <StatTile
              icon={<MailCheck className="size-4 text-emerald-500" />}
              label="Credits left"
              value={fmt(usage.remaining)}
              hint={usage.total != null ? `of ${fmt(usage.total)} ${usage.periodLabel}` : undefined}
              loading={isLoading}
            />
            <StatTile
              icon={<MousePointerClick className="size-4 text-violet-500" />}
              label="Opens / clicks today"
              value={t ? `${fmt(t.opens)} / ${fmt(t.clicks)}` : "—"}
              loading={isLoading}
            />
            <StatTile
              icon={<Ban className="size-4 text-rose-500" />}
              label="Bounced / blocked today"
              value={t ? `${fmt(t.bounces)} / ${fmt(t.blocks)}` : "—"}
              hint={t?.spamReports ? `${fmt(t.spamReports)} spam reports` : undefined}
              loading={isLoading}
            />
          </div>

          {(isError || (data?.warnings?.length ?? 0) > 0) && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {isError ? <AlertCircle className="mt-px size-3.5 shrink-0" /> : <ShieldAlert className="mt-px size-3.5 shrink-0" />}
              <span>
                {isError
                  ? `Could not load SendGrid usage: ${error instanceof Error ? error.message : "request failed"}`
                  : data!.warnings.join(" · ")}
              </span>
            </div>
          )}

          {usage.fetchedAt ? (
            <p className="text-[11px] text-muted-foreground">
              Live from SendGrid · updated {usage.fetchedAt} · SendGrid counts days in UTC
            </p>
          ) : null}
        </CardContent>
      </Card>

      <PlanDetailsDialog open={detailsOpen} onOpenChange={setDetailsOpen} usage={usage} />
    </div>
  );
}
