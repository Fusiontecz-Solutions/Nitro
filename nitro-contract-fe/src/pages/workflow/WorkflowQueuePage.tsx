import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PaginationState } from "@tanstack/react-table";
import { toast } from "react-toastify";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { resolveEffectiveRole } from "@/lib/sessionRole";
import { canActAsUnderwriter, roleCan, PERMISSIONS } from "@/lib/roleAccess";
import {
  claimApplication,
  fetchWorkflowQueue,
  type WorkflowBucket,
  type WorkflowListItem,
  type WorkflowScope,
} from "@/lib/workflowApi";
import { bucketDefsForScope, defaultBucketForScope } from "@/constants/workflowBuckets";
import WorkflowQueueTable from "@/components/workflow/WorkflowQueueTable";
import { useWorkflowScope } from "@/hooks/useWorkflowScope";
import Applications from "@/pages/applications/Applications";

export default function WorkflowQueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [searchParams] = useSearchParams();
  const { scope, canSwitch, setScope } = useWorkflowScope();
  const role = resolveEffectiveRole(undefined);
  const buckets = bucketDefsForScope(scope);

  const bucketParam = searchParams.get("bucket") as WorkflowBucket | null;
  const bucket: WorkflowBucket =
    bucketParam && buckets.some((b) => b.key === bucketParam) ? bucketParam : defaultBucketForScope(scope);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [bucket, search, scope]);

  /** Agent "All applications" reuses the Super Admin applications page (server scopes rows to the Agent). */
  const useApplicationsPage = scope === "agent" && bucket === "all";

  const queue = useQuery({
    queryKey: ["workflow-queue", scope, bucket, search, pagination.pageIndex, pagination.pageSize],
    queryFn: () =>
      fetchWorkflowQueue({
        scope,
        bucket,
        search: search || undefined,
        page: pagination.pageIndex + 1,
        limit: pagination.pageSize,
      }),
    placeholderData: keepPreviousData,
    enabled: !useApplicationsPage,
  });

  // Whenever this list loads fresh rows, recount the sidebar badges so the bucket
  // count never disagrees with the list the user is looking at.
  useEffect(() => {
    if (!queue.dataUpdatedAt) return;
    void queryClient.invalidateQueries({ queryKey: ["workflow-summary"] });
  }, [queue.dataUpdatedAt, queryClient]);

  const handleClaim = async (row: WorkflowListItem) => {
    setClaimingId(row.id);
    try {
      await claimApplication(row.id);
      toast.success("Application claimed — it is assigned to you.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workflow-queue"] }),
        queryClient.invalidateQueries({ queryKey: ["workflow-summary"] }),
      ]);
      navigate(`/application-details/${row.applicationId}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to claim application");
      void queryClient.invalidateQueries({ queryKey: ["workflow-queue"] });
    } finally {
      setClaimingId(null);
    }
  };

  const activeDef = useMemo(() => buckets.find((b) => b.key === bucket), [buckets, bucket]);
  const canClaim = scope === "underwriter" && bucket === "incoming" && roleCan(role, PERMISSIONS.UNDERWRITING_CLAIM) && canActAsUnderwriter(role);
  const data = queue.data;

  if (useApplicationsPage) return <Applications />;

  return (
    <div className="min-h-screen bg-background">
      <div
        className={cn(
          "flex flex-col gap-3 px-6 py-5 md:flex-row md:items-center md:justify-between",
          isDark ? "bg-[#141517]" : "bg-white",
        )}
      >
        <div className="relative flex w-full items-center rounded-md border border-input bg-card md:max-w-[520px]">
          <Search className="absolute left-3 size-4 text-muted-foreground" />
          <Input
            placeholder="Search deal, business, owner or ISO"
            className="h-10 border-0 bg-transparent pl-9 focus-visible:ring-0 focus-visible:ring-offset-0"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          {canSwitch ? (
            <div className="inline-flex rounded-md border border-border bg-muted/60 p-0.5 text-xs font-medium">
              {(["agent", "underwriter"] as WorkflowScope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={cn(
                    "rounded px-3 py-1.5 capitalize transition",
                    scope === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {s} workflow
                </button>
              ))}
            </div>
          ) : null}
          {roleCan(role, PERMISSIONS.APPLICATION_CREATE) && scope === "agent" ? (
            <Button
              className="gap-2 border-none bg-[image:var(--brand-gradient)] px-4 text-sm text-white shadow-none hover:opacity-90"
              onClick={() => navigate("/create-applications")}
            >
              <Plus className="size-4" /> New Application
            </Button>
          ) : null}
        </div>
      </div>

      <div className="px-6">
        <div
          className={cn(
            "mt-5 rounded-[5px] border shadow-[0px_4px_20px_0px_#00000005] transition-all duration-300",
            isDark ? "border-[#374151] bg-[#141517]" : "border-[#FDFDFD] bg-card",
          )}
        >
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-t-[5px] px-4 py-2 md:px-5",
              isDark ? "bg-[#2A2B2F]" : "bg-[#F9FAFD]",
            )}
          >
            <span className="inline-flex items-center gap-2 font-roboto text-[1rem] font-semibold uppercase tracking-wide text-foreground">
              {activeDef?.label ?? "Applications"}
            </span>
            <span className="text-xs text-muted-foreground">{activeDef?.description}</span>
          </div>
          {queue.error ? (
            <p className="px-6 py-6 text-sm text-destructive">{(queue.error as Error).message}</p>
          ) : (
            <WorkflowQueueTable
              scope={scope}
              bucket={bucket}
              rows={data?.items ?? []}
              loading={queue.isLoading || queue.isFetching}
              totalItems={data?.pagination.total}
              pageCount={data?.pagination.totalPages}
              pagination={pagination}
              onPaginationChange={setPagination}
              onClaim={canClaim ? (row) => void handleClaim(row) : undefined}
              claimingId={claimingId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
