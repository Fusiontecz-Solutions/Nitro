import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/redux/store';
import {
  getApplicationActivityLogs,
  getApplicationActivityLogContent,
  type ApplicationActivityLog,
} from '@/redux/actions/applicationActivityLogActions';
import type { ActivityLogContent } from '@/redux/actions/activityLogActions';
import { Clock, FileText, MessageCircle, User, Mail, Eye } from 'lucide-react';
import { cn, formatDateTimeUS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ApplicationSheetActivityLogProps = {
  applicationId: string;
  className?: string;
  headerClassName?: string;
};

type FieldChange = {
  field?: string;
  label: string;
  previous?: string | null;
  current?: string | null;
};

function extractFieldChanges(metadata?: Record<string, unknown> | null): FieldChange[] {
  const raw = metadata?.changes;
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is FieldChange => {
        if (!item || typeof item !== 'object') return false;
        return typeof (item as FieldChange).label === 'string';
      })
      .map((item) => ({
        field: item.field,
        label: item.label,
        previous: item.previous ?? null,
        current: item.current ?? null,
      }));
  }

  const single = metadata?.change;
  if (single && typeof single === 'object' && typeof (single as FieldChange).label === 'string') {
    const change = single as FieldChange;
    return [
      {
        field: change.field,
        label: change.label,
        previous: change.previous ?? null,
        current: change.current ?? null,
      },
    ];
  }

  return [];
}

function extractSubActivityPreview(metadata?: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const preview = metadata.preview ?? metadata.question ?? metadata.commentType;
  if (typeof preview !== 'string' || !preview.trim()) return null;
  return preview.trim();
}

function formatChangeValue(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  return value;
}

function channelLabel(channel: string | null | undefined): string {
  if (!channel) return '';
  const map: Record<string, string> = {
    EMAIL: 'Email',
    TEMPLATE: 'Template',
    DOCUMENT: 'Document',
  };
  return map[channel.toUpperCase()] ?? channel;
}

function bodyLooksLikeHtml(body: string): boolean {
  return /<[a-z][\s\S]*>/i.test(body);
}

function isCommunicationLog(log: ApplicationActivityLog): boolean {
  const meta = log.metadata ?? {};
  const hasEmailMeta = Boolean(meta.emailSentTo || meta.template);
  return (
    log.category === 'COMMUNICATION' ||
    log.actionType?.startsWith('PAYMENT_MAIL_') ||
    log.action === 'SEND' ||
    (log.actionType === 'APPROVED' && hasEmailMeta) ||
    Boolean(log.canView && (log.channel || log.recipientName))
  );
}

export default function ApplicationSheetActivityLog({
  applicationId,
  className,
  headerClassName,
}: ApplicationSheetActivityLogProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { logs, loading, error } = useSelector((state: RootState) => state.activityLogs);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewContent, setViewContent] = useState<ActivityLogContent | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);

  useEffect(() => {
    if (!applicationId) return;
    dispatch(getApplicationActivityLogs(applicationId));
  }, [applicationId, dispatch]);

  const appLogs = logs.filter(
    (log): log is ApplicationActivityLog =>
      typeof log === 'object' &&
      log !== null &&
      'id' in log &&
      'actionDescription' in log,
  );

  const formatTimestamp = (iso: string) => formatDateTimeUS(iso, iso);

  const openView = async (log: ApplicationActivityLog) => {
    setViewOpen(true);
    setViewLoading(true);
    setViewContent(null);
    setViewError(null);
    try {
      const content = await dispatch(
        getApplicationActivityLogContent({ applicationId, logId: log.id }),
      ).unwrap();
      setViewContent(content);
    } catch (e) {
      setViewError(typeof e === 'string' ? e : 'Failed to load content');
    } finally {
      setViewLoading(false);
    }
  };

  const previewBody = viewContent?.body?.trim() ?? '';
  const previewIsHtml = previewBody ? bodyLooksLikeHtml(previewBody) : false;

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-1 flex-col bg-background',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between border-b border-border/60 bg-muted/40 px-6 pb-3',
          headerClassName,
        )}
      >
        <div className="space-y-0.5">
          <h2 className="text-md font-semibold text-foreground/90 flex items-center gap-2">
            Activity Log
          </h2>
          <p className="text-xs text-muted-foreground">
            Queue changes, emails, templates, and documents sent for this deal (ISO, client, merchant).
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-secondary/70 px-3 py-1 border border-border/60">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
            Most recent first
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && (
          <p className="text-xs text-muted-foreground mb-3">Loading activity logs...</p>
        )}
        {error && !loading && (
          <p className="text-xs text-red-500 mb-3">Failed to load activity logs: {error}</p>
        )}
        {!loading && !error && appLogs.length === 0 && (
          <p className="text-xs text-muted-foreground mb-3">
            No activity has been recorded for this application yet.
          </p>
        )}
        <div className="relative">
          <div className="absolute left-[0.58rem] top-2 bottom-0 w-px bg-border/60" />

          <div className="space-y-6">
            {appLogs.map((log) => {
              const isComm = isCommunicationLog(log);
              const fieldChanges = extractFieldChanges(log.metadata);
              const subActivityPreview = extractSubActivityPreview(log.metadata);
              return (
                <div key={log.id} className="relative flex items-start gap-4">
                  <div className="relative z-10 mt-1">
                    <div
                      className={cn(
                        'w-5 h-5 rounded-full border-2 border-background ring-2 ring-offset-0 flex items-center justify-center',
                        isComm ? 'ring-cyan-500/40 bg-cyan-600' : 'ring-primary/40 bg-primary',
                      )}
                    >
                      <span className="block w-1.5 h-1.5 rounded-full bg-background" />
                    </div>
                  </div>

                  <div className="flex-1 bg-secondary/40 border border-border/60 rounded-xl p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>{formatTimestamp(log.createdAt)}</span>
                        </div>

                        <div className="flex items-start gap-2 text-sm font-semibold text-foreground">
                          {isComm ? (
                            <Mail className="w-4 h-4 text-cyan-600 shrink-0 mt-0.5" />
                          ) : (
                            <FileText className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                          )}
                          <span>{log.actionDescription}</span>
                        </div>

                        {isComm && (
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            {log.channel && (
                              <span className="rounded-full bg-cyan-500/10 text-cyan-800 dark:text-cyan-300 px-2 py-0.5 font-semibold uppercase">
                                {channelLabel(log.channel)}
                              </span>
                            )}
                            {log.recipientType && (
                              <span className="rounded-full bg-slate-500/10 px-2 py-0.5 uppercase text-muted-foreground">
                                {log.recipientType}
                              </span>
                            )}
                            {log.recipientName && (
                              <span className="text-muted-foreground truncate max-w-full">
                                To: {log.recipientName}
                              </span>
                            )}
                            {log.templateName && (
                              <span className="text-muted-foreground">
                                Template: {log.templateName}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-slate-500" />
                            <span>
                              {log.userName || 'System'}{' '}
                              {log.userRole
                                ? `(${String(log.userRole).replace(/_/g, ' ').toLowerCase()})`
                                : ''}
                            </span>
                          </span>
                          {log.currentStatus && (
                            <>
                              <span className="h-3 w-px bg-border/70" />
                              <span className="inline-flex items-center gap-1">
                                <MessageCircle className="w-3.5 h-3.5 text-slate-500" />
                                <span>{log.currentStatus}</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span
                          className={cn(
                            'inline-flex items-center justify-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.1em] border',
                            isComm
                              ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                              : 'bg-slate-50 text-slate-700 border-slate-200',
                          )}
                        >
                          {log.actionType}
                        </span>
                        {log.canView && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            onClick={() => openView(log)}
                          >
                            <Eye className="size-3.5" /> View
                          </Button>
                        )}
                      </div>
                    </div>

                    {typeof log.metadata?.reason === 'string' ? (
                      <p className="mt-3 text-sm text-foreground/80 leading-relaxed">
                        {log.metadata.reason}
                      </p>
                    ) : null}

                    {subActivityPreview ? (
                      <p className="mt-3 text-sm text-foreground/80 leading-relaxed italic">
                        “{subActivityPreview}”
                      </p>
                    ) : null}

                    {fieldChanges.length > 0 ? (
                      <div className="mt-3 rounded-lg border border-border/60 bg-background/70 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2">
                          Changes
                        </p>
                        <ul className="space-y-2">
                          {fieldChanges.map((change) => (
                            <li
                              key={`${log.id}-${change.field ?? change.label}`}
                              className="text-sm text-foreground/90"
                            >
                              <span className="font-medium">{change.label}:</span>{' '}
                              <span className="text-muted-foreground">
                                {formatChangeValue(change.previous)}
                              </span>
                              <span className="mx-1 text-muted-foreground">→</span>
                              <span>{formatChangeValue(change.current)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sent communication</DialogTitle>
          </DialogHeader>
          {viewLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {viewError && <p className="text-sm text-red-500">{viewError}</p>}
          {!viewLoading && !viewError && viewContent && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Channel</p>
                  <p>{channelLabel(viewContent.channel) || '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Recipient type</p>
                  <p>{viewContent.recipientType ?? '—'}</p>
                </div>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Recipient</p>
                <p className="break-all">{viewContent.recipient ?? '—'}</p>
              </div>
              {viewContent.templateName && (
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Template</p>
                  <p>{viewContent.templateName}</p>
                </div>
              )}
              <div>
                <p className="text-xs uppercase text-muted-foreground">Subject</p>
                <p>{viewContent.subject ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Message</p>
                <div className="rounded-md border border-border bg-muted/20 p-3 mt-1">
                  {previewBody ? (
                    previewIsHtml ? (
                      <div
                        className="max-h-[50vh] overflow-y-auto prose prose-sm dark:prose-invert"
                        dangerouslySetInnerHTML={{ __html: previewBody }}
                      />
                    ) : (
                      <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap text-xs">
                        {previewBody}
                      </pre>
                    )
                  ) : (
                    <p className="text-muted-foreground text-xs">
                      {(viewContent as { note?: string }).note ??
                        'No message body stored for this entry.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
