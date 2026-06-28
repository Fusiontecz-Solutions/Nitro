import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import {
  getApplicationDuplicates,
  type DuplicateApplication,
} from "@/redux/actions/applicationDedupeActions";
import { clearDedupe } from "@/redux/slices/dedupeSlice";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

function duplicateApplicationHref(dup: DuplicateApplication): string | null {
  if (dup.applicationId != null && String(dup.applicationId).trim() !== "") {
    return `/application-details/${dup.applicationId}`;
  }
  if (dup.id) return `/application-details/${dup.id}`;
  return null;
}

type ApplicationSheetDedupeProps = {
  applicationId: string;
  /** Close the sheet when navigating to another application (optional). */
  onNavigateAway?: () => void;
};

export default function ApplicationSheetDudep({
  applicationId,
  onNavigateAway,
}: ApplicationSheetDedupeProps) {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { data, loading, error } = useSelector((state: RootState) => state.applicationDedupe);

  useEffect(() => {
    if (!applicationId) return;
    dispatch(clearDedupe());
    dispatch(getApplicationDuplicates(applicationId));
  }, [applicationId, dispatch]);

  const isForbidden = error?.toLowerCase().includes("forbidden");

  const openDuplicateDeal = (dup: DuplicateApplication) => {
    const href = duplicateApplicationHref(dup);
    if (!href) return;
    onNavigateAway?.();
    navigate(href);
  };

  if (isForbidden) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Dupes view is only visible to Scrubbing and Admins.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {loading && <p className="text-sm text-muted-foreground">Checking for duplicate applications...</p>}
      {!loading && !error && data.length === 0 && (
        <p className="text-sm text-muted-foreground">No previous duplicate applications found for this business.</p>
      )}
      {error && !loading && !isForbidden && (
        <p className="text-sm text-red-500">Failed to load duplicate applications: {error}</p>
      )}

      {data.length > 0 && (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              This application has previously been submitted.
            </p>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Duplicate Applications History
            </p>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border/60 bg-secondary/30">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/60">
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 text-left">Application ID</th>
                  <th className="px-4 py-2 text-left">Business Name</th>
                  <th className="px-4 py-2 text-left">Agent</th>
                  <th className="px-4 py-2 text-left">EIN</th>
                  <th className="px-4 py-2 text-left">SSN</th>
                  <th className="px-4 py-2 text-left">Match With</th>
                  <th className="px-4 py-2 text-left">Date Submitted</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Funded Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.map((dup) => {
                  const navigable = duplicateApplicationHref(dup) != null;
                  return (
                    <tr
                      key={dup.id}
                      className={cn(
                        "border-t border-border/40 transition-colors hover:bg-secondary/40",
                        navigable && "cursor-pointer group"
                      )}
                      tabIndex={navigable ? 0 : undefined}
                      onClick={navigable ? () => openDuplicateDeal(dup) : undefined}
                      onKeyDown={
                        navigable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openDuplicateDeal(dup);
                              }
                            }
                          : undefined
                      }
                    >
                      <td className="px-4 py-2 font-mono text-xs text-foreground/80">
                        {navigable ? (
                          <span className="text-primary underline-offset-2 group-hover:underline font-mono text-xs">
                            {dup.applicationId != null
                              ? String(dup.applicationId)
                              : "Open"}
                          </span>
                        ) : (
                          (dup.applicationId ?? "-")
                        )}
                      </td>
                      <td className="px-4 py-2">{dup.businessName || "-"}</td>
                      <td className="px-4 py-2">{dup.agentName || "-"}</td>
                      <td className="px-4 py-2">{dup.businessEinNumber || "-"}</td>
                      <td className="px-4 py-2">{dup.ownerSsn || "-"}</td>
                      <td className="px-4 py-2">
                        {dup.matchWith && dup.matchWith.length > 0 ? dup.matchWith.join(", ") : "-"}
                      </td>
                      <td className="px-4 py-2">
                        {formatDate(dup.submittedAt, "—")}
                      </td>
                      <td className="px-4 py-2">{dup.status}</td>
                      <td className="px-4 py-2 text-left">
                        {typeof dup.fundedAmount === "number"
                          ? formatCurrency(dup.fundedAmount)
                          : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

