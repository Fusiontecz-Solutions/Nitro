import { useMemo } from "react";
import { Download, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BackgroundCheckFormState, BackgroundCheckStatus } from "./backgroundCheckTypes";

type BackgroundCheckSidebarProps = {
  merchantName: string;
  checkIds: string[];
  checks: BackgroundCheckFormState;
  savedAt?: string | null;
  saving?: boolean;
  downloadingPdf?: boolean;
  onSaveAll?: () => void;
  onDownloadPdf?: () => void;
};

function countByStatus(
  checks: BackgroundCheckFormState,
  checkIds: string[],
  status: BackgroundCheckStatus,
): number {
  return checkIds.filter((id) => checks[id]?.status === status).length;
}

function CircularProgress({ percent }: { percent: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative mx-auto h-[108px] w-[108px]">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 108 108" aria-hidden>
        <circle cx="54" cy="54" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="10" />
        <circle
          cx="54"
          cy="54"
          r={radius}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-300"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold text-[#111827]">{percent}%</span>
      </div>
    </div>
  );
}

function formatSavedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function BackgroundCheckSidebar({
  merchantName,
  checkIds,
  checks,
  savedAt,
  saving = false,
  downloadingPdf = false,
  onSaveAll,
  onDownloadPdf,
}: BackgroundCheckSidebarProps) {
  const completed = useMemo(
    () => checkIds.filter((id) => checks[id]?.status != null).length,
    [checkIds, checks],
  );
  const total = checkIds.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const passCount = countByStatus(checks, checkIds, "pass");
  const failCount = countByStatus(checks, checkIds, "fail");
  const flagCount = countByStatus(checks, checkIds, "flag");
  const naCount = countByStatus(checks, checkIds, "na");

  const resultRows = [
    { label: "Pass", count: passCount, color: "bg-[#16A34A]" },
    { label: "Fail", count: failCount, color: "bg-[#DC2626]" },
    { label: "Flag", count: flagCount, color: "bg-[#EA580C]" },
    { label: "N/A", count: naCount, color: "bg-[#9CA3AF]" },
  ];

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="rounded-md border border-[#E5E7EB] bg-white px-4 py-5 shadow-[0px_4px_20px_0px_#00000005]">
        <p className="text-sm font-semibold text-[#111827]">Completion Progress</p>
        <div className="mt-4">
          <CircularProgress percent={percent} />
        </div>
        <p className="mt-3 text-center text-sm font-medium text-[#111827]">
          {merchantName || "Merchant"}
        </p>
        <p className="mt-1 text-center text-xs text-[#6B7280]">
          {completed} of {total} complete
        </p>
      </div>

      <div className="rounded-md border border-[#E5E7EB] bg-white px-4 py-4 shadow-[0px_4px_20px_0px_#00000005]">
        <p className="text-xs font-bold tracking-wide text-[#6B7280]">RESULTS</p>
        <div className="mt-3 space-y-2.5">
          {resultRows.map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <span className="w-10 text-xs font-medium text-[#374151]">{row.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E5E7EB]">
                <div
                  className={cn("h-full rounded-full transition-all", row.color)}
                  style={{
                    width: total > 0 ? `${Math.max((row.count / total) * 100, row.count > 0 ? 12 : 0)}%` : "0%",
                  }}
                />
              </div>
              <span className="w-4 text-right text-xs font-semibold text-[#111827]">
                {row.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-[#E5E7EB] bg-white px-4 py-4 shadow-[0px_4px_20px_0px_#00000005]">
        <p className="text-sm font-semibold text-[#111827]">Save & Export</p>
        {savedAt ? (
          <p className="mt-1 text-[11px] text-[#6B7280]">
            Last saved {formatSavedAt(savedAt)}
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-[#6B7280]">
            Save all checks, notes, and attachments.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          <Button
            type="button"
            className="h-10 w-full bg-gradient-to-r from-[var(--brand)] to-[#6366F1] text-white hover:opacity-95"
            disabled={saving || downloadingPdf}
            onClick={onSaveAll}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" aria-hidden />
                Save
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full"
            disabled={saving || downloadingPdf}
            onClick={onDownloadPdf}
          >
            {downloadingPdf ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Preparing PDF…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" aria-hidden />
                Download PDF
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
