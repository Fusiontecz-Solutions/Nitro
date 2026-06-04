import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/redux/store';
import { getApplicationActivityLogs } from '@/redux/actions/applicationActivityLogActions';
import { Clock, FileText, MessageCircle, User } from 'lucide-react';
import { cn, formatDateTimeUS } from '@/lib/utils';

type ApplicationSheetActivityLogProps = {
  applicationId: string;
  /** Merged onto the root container (e.g. `h-full min-h-0 flex-1` for a side panel). */
  className?: string;
  /** Extra classes on the header row (e.g. `pr-14` when a sheet close button sits top-right). */
  headerClassName?: string;
};

export default function ApplicationSheetActivityLog({
  applicationId,
  className,
  headerClassName,
}: ApplicationSheetActivityLogProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { logs, loading, error } = useSelector((state: RootState) => state.activityLogs);

  useEffect(() => {
    if (!applicationId) return;
    dispatch(getApplicationActivityLogs(applicationId));
  }, [applicationId, dispatch]);

  const formatTimestamp = (iso: string) => formatDateTimeUS(iso, iso);

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col bg-background',
        className,
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between border-b border-border/60 bg-muted/40 px-6 pb-3',
          headerClassName,
        )}
      >
        <div className="space-y-0.5">
          <h2 className="text-md font-semibold text-foreground/90 flex items-center gap-2">
            Audit Log
          </h2>
          <p className="text-xs text-muted-foreground">
            Queue movements, remarks, and system events for this deal.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-secondary/70 px-3 py-1 border border-border/60">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
            Most recent first
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && (
          <p className="text-xs text-muted-foreground mb-3">Loading activity logs...</p>
        )}
        {error && !loading && (
          <p className="text-xs text-red-500 mb-3">Failed to load activity logs: {error}</p>
        )}
        {!loading && !error && logs.length === 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            No activity has been recorded for this application yet.
          </p>
        )}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[0.58rem] top-2 bottom-0 w-px bg-border/60" />

          <div className="space-y-6">
            {logs.map((log, index) => (
              <div key={(log as any).id ?? (log as any)._id ?? index} className="relative flex items-start gap-4">
                {/* Timeline dot */}
                <div className="relative z-10 mt-1">
                  <div className="w-5 h-5 rounded-full border-2 border-background ring-2 ring-offset-0 ring-primary/40 bg-primary flex items-center justify-center">
                    <span className="block w-1.5 h-1.5 rounded-full bg-background" />
                  </div>
                </div>

                {/* Card */}
                <div className="flex-1 bg-secondary/40 border border-border/60 rounded-xl p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{formatTimestamp((log as any).createdAt)}</span>
                      </div>

                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <FileText className="w-4 h-4 text-primary" />
                        <span>{(log as any).actionDescription}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-slate-500" />
                          <span>
                            {(log as any).userName || 'System'}{' '}
                            {(log as any).userRole
                              ? `(${String((log as any).userRole).toString().replace(/_/g, ' ').toLowerCase()})`
                              : ''}
                          </span>
                        </span>
                        <span className="h-3 w-px bg-border/70" />
                        <span className="inline-flex items-center gap-1">
                          <MessageCircle className="w-3.5 h-3.5 text-slate-500" />
                          <span>{(log as any).currentStatus}</span>
                        </span>
                      </div>
                    </div>

                    <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.14em] border bg-slate-50 text-slate-700 border-slate-200">
                      {(log as any).actionType}
                    </span>
                  </div>

                  {(log as any).metadata?.reason && (
                    <p className="mt-3 text-sm text-foreground/80 leading-relaxed">
                      {(log as any).metadata.reason}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}