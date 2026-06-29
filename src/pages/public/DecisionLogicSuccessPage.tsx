import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import DecisionLogicInfo from "@/components/client/decision-logic/decision-logic-info-section";
import { fetchDecisionLogicReport } from "@/redux/actions/decision-logic-actions";

function pickBestReportRow(raw: unknown): any | null {
  const rows = Array.isArray(raw) ? raw : [];
  if (!rows.length) return null;
  const checking = rows.find((r: any) => String(r?.accountType || "").toUpperCase() === "CHECKING");
  if (checking) return checking;
  return rows[0] ?? null;
}

export default function DecisionLogicSuccessPage() {
  const [searchParams] = useSearchParams();
  const businessOwnerId = useMemo(
    () => Number(searchParams.get("businessOwnerId") ?? 0),
    [searchParams],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportRow, setReportRow] = useState<any | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!Number.isFinite(businessOwnerId) || businessOwnerId <= 0) {
        if (!cancelled) {
          setError("Missing business owner id for report retrieval.");
          setLoading(false);
        }
        return;
      }

      const response = await fetchDecisionLogicReport(0, businessOwnerId);
      if (cancelled) return;
      if ((response as { error?: string })?.error) {
        setError(String((response as { error?: string }).error || "Failed to fetch Decision Logic report."));
        setLoading(false);
        return;
      }

      const rows = (response as { data?: unknown })?.data;
      const best = pickBestReportRow(rows);
      setReportRow(best);
      setLoading(false);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [businessOwnerId]);

  return (
    <div className="min-h-screen p-6 bg-slate-50">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 p-4">
          <h1 className="text-lg font-semibold text-green-700">Bank verification completed</h1>
          <p className="mt-1 text-sm text-green-700">
            Decision Logic finished processing. Report data is shown below.
          </p>
        </div>

        {loading ? (
          <div className="rounded-lg border bg-white p-4 text-sm text-slate-600">
            Loading Decision Logic report...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : reportRow ? (
          <DecisionLogicInfo data={reportRow} />
        ) : (
          <div className="rounded-lg border bg-white p-4 text-sm text-slate-600">
            No Decision Logic report found yet for this owner.
          </div>
        )}
      </div>
    </div>
  );
}
