import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/redux/store';
import {
  getApplicationActivityLogs,
  getApplicationActivityLogContent,
  type ApplicationActivityLog,
} from '@/redux/actions/applicationActivityLogActions';
import type { ActivityLogContent } from '@/redux/actions/activityLogActions';
import {
  fetchPaymentMailLogsForApplication,
  type PaymentMailLogEntry,
} from '@/pages/payment/paymentMailLogStorage';
import {
  Clock,
  Eye,
  Mail,
  Paperclip,
  User,
  FileText,
  Tag,
} from 'lucide-react';
import { cn, formatDateTimeUS } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type ApplicationSheetMailLogProps = {
  applicationId: string;
  className?: string;
  headerClassName?: string;
};

type MailLogRow = {
  id: string;
  at: string;
  recipient: string;
  subject: string;
  templateName: string | null;
  channel: string | null;
  status: string;
  attachments: string[];
  source: 'activity' | 'payment';
  activityLog?: ApplicationActivityLog;
  paymentLog?: PaymentMailLogEntry;
};

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

function channelLabel(channel: string | null | undefined): string {
  if (!channel) return '—';
  const map: Record<string, string> = {
    EMAIL: 'Email',
    TEMPLATE: 'Template',
    DOCUMENT: 'Document',
  };
  return map[channel.toUpperCase()] ?? channel;
}

function resolveActivityMailStatus(log: ApplicationActivityLog): string {
  const type = String(log.actionType ?? '').toUpperCase();
  if (type.includes('FAILED')) return 'failed';
  if (type.includes('QUEUED')) return 'queued';
  const metaStatus = log.metadata?.status;
  if (typeof metaStatus === 'string' && metaStatus.trim()) {
    return metaStatus.trim().toLowerCase();
  }
  return 'sent';
}

function extractAttachmentNames(
  log: ApplicationActivityLog,
  content?: ActivityLogContent | null,
): string[] {
  const meta = log.metadata ?? {};
  const names: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) names.push(value.trim());
  };

  push(meta.documentName);
  push(log.templateName);
  if (meta.hasLetterPdf === true) names.push('Letter PDF');

  if (Array.isArray(meta.attachments)) {
    for (const item of meta.attachments) {
      if (typeof item === 'string') push(item);
      else if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        push(row.filename);
        push(row.name);
        push(row.originalName);
      }
    }
  }

  if (content?.documentName) push(content.documentName);

  return [...new Set(names)];
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'sent') {
    return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }
  if (normalized === 'failed') {
    return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300';
  }
  if (normalized === 'queued') {
    return 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300';
  }
  return 'border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300';
}

function bodyLooksLikeHtml(body: string): boolean {
  return /<[a-z][\s\S]*>/i.test(body);
}

export default function ApplicationSheetMailLog({
  applicationId,
  className,
  headerClassName,
}: ApplicationSheetMailLogProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { logs, loading, error } = useSelector((state: RootState) => state.activityLogs);

  const [paymentLogs, setPaymentLogs] = useState<PaymentMailLogEntry[]>([]);
  const [paymentLoading, setPaymentLoading] = useState(false);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewContent, setViewContent] = useState<ActivityLogContent | null>(null);
  const [viewPayment, setViewPayment] = useState<PaymentMailLogEntry | null>(null);
  const [viewAttachments, setViewAttachments] = useState<string[]>([]);
  const [viewError, setViewError] = useState<string | null>(null);

  useEffect(() => {
    if (!applicationId) return;
    dispatch(getApplicationActivityLogs(applicationId));
  }, [applicationId, dispatch]);

  useEffect(() => {
    if (!applicationId) return;
    setPaymentLoading(true);
    void fetchPaymentMailLogsForApplication(applicationId)
      .then(setPaymentLogs)
      .catch(() => setPaymentLogs([]))
      .finally(() => setPaymentLoading(false));
  }, [applicationId]);

  const rows = useMemo((): MailLogRow[] => {
    const activityRows = logs
      .filter(
        (log): log is ApplicationActivityLog =>
          typeof log === 'object' &&
          log !== null &&
          'id' in log &&
          'actionDescription' in log &&
          isCommunicationLog(log as ApplicationActivityLog),
      )
      .map((log) => ({
        id: `activity-${log.id}`,
        at: log.createdAt,
        recipient: log.recipientName ?? '—',
        subject: log.subject ?? log.actionDescription ?? '—',
        templateName: log.templateName ?? null,
        channel: log.channel ?? null,
        status: resolveActivityMailStatus(log),
        attachments: extractAttachmentNames(log),
        source: 'activity' as const,
        activityLog: log,
      }));

    const paymentRows = paymentLogs.map((log) => ({
      id: `payment-${log.id}`,
      at: log.at,
      recipient: log.recipient,
      subject: log.subject,
      templateName: log.templateName,
      channel: 'TEMPLATE',
      status: log.status,
      attachments: log.templateName ? [log.templateName] : [],
      source: 'payment' as const,
      paymentLog: log,
    }));

    return [...activityRows, ...paymentRows].sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
  }, [logs, paymentLogs]);

  const openActivityView = async (log: ApplicationActivityLog) => {
    setViewOpen(true);
    setViewLoading(true);
    setViewContent(null);
    setViewPayment(null);
    setViewError(null);
    setViewAttachments(extractAttachmentNames(log));
    try {
      const content = await dispatch(
        getApplicationActivityLogContent({ applicationId, logId: log.id }),
      ).unwrap();
      setViewContent(content);
      setViewAttachments(extractAttachmentNames(log, content));
    } catch (e) {
      setViewError(typeof e === 'string' ? e : 'Failed to load mail content');
    } finally {
      setViewLoading(false);
    }
  };

  const openPaymentView = (log: PaymentMailLogEntry) => {
    setViewOpen(true);
    setViewLoading(false);
    setViewContent(null);
    setViewPayment(log);
    setViewError(null);
    setViewAttachments(log.templateName ? [log.templateName] : []);
  };

  const previewBody =
    viewPayment?.body?.trim() ?? viewContent?.body?.trim() ?? '';
  const previewIsHtml = previewBody ? bodyLooksLikeHtml(previewBody) : false;
  const isLoading = loading || paymentLoading;

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
          <h2 className="text-md flex items-center gap-2 font-semibold text-foreground/90">
            <Mail className="h-4 w-4 text-cyan-600" aria-hidden />
            Mail Log
          </h2>
          <p className="text-xs text-muted-foreground">
            Emails and templates sent for this deal — attachments and delivery status.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/70 px-3 py-1">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Most recent first
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {isLoading && (
          <p className="mb-3 text-xs text-muted-foreground">Loading mail logs…</p>
        )}
        {error && !loading && (
          <p className="mb-3 text-xs text-red-500">
            Failed to load mail logs: {error}
          </p>
        )}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No emails or templates have been logged for this application yet.
          </p>
        )}

        {rows.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">When</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead className="min-w-[140px]">Subject</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="min-w-[120px]">Attachments</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4 text-xs text-foreground">
                      {formatDateTimeUS(row.at, row.at)}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs">
                      {row.recipient}
                    </TableCell>
                    <TableCell className="max-w-[200px] whitespace-normal break-words text-xs">
                      {row.subject}
                    </TableCell>
                    <TableCell className="text-xs">
                      {channelLabel(row.channel)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.attachments.length > 0 ? (
                        <ul className="space-y-1">
                          {row.attachments.map((name) => (
                            <li
                              key={`${row.id}-${name}`}
                              className="flex items-center gap-1 text-foreground"
                            >
                              <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <span className="truncate">{name}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] font-semibold uppercase tracking-wide',
                          statusBadgeClass(row.status),
                        )}
                      >
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 cursor-pointer gap-1 text-xs"
                        onClick={() => {
                          if (row.activityLog) void openActivityView(row.activityLog);
                          else if (row.paymentLog) openPaymentView(row.paymentLog);
                        }}
                      >
                        <Eye className="size-3.5" aria-hidden />
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </div>

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="flex max-h-[92vh] w-[min(96vw,56rem)] max-w-[56rem] flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
          <div className="shrink-0 border-b border-cyan-200/60 bg-gradient-to-r from-cyan-50 via-white to-sky-50 px-6 py-5 pr-14 dark:border-cyan-900/40 dark:from-cyan-950/40 dark:via-card dark:to-sky-950/30">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-600/10 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300">
                  <Mail className="h-4 w-4" aria-hidden />
                </span>
                Mail Details
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {viewPayment?.subject ?? viewContent?.subject ?? 'Sent communication'}
              </p>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide px-6 py-5">
            {viewLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {viewError && <p className="text-sm text-red-500">{viewError}</p>}
            {!viewLoading && !viewError && (viewContent || viewPayment) && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Status
                    </p>
                    <Badge
                      variant="outline"
                      className={cn(
                        'mt-2 text-[11px] font-semibold uppercase',
                        statusBadgeClass(
                          viewPayment?.status ??
                            viewContent?.status ??
                            'sent',
                        ),
                      )}
                    >
                      {viewPayment?.status ?? viewContent?.status ?? 'sent'}
                    </Badge>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Type
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-sm font-medium text-foreground">
                      <Tag className="h-4 w-4 text-cyan-600" aria-hidden />
                      {viewPayment
                        ? 'Template'
                        : channelLabel(viewContent?.channel) || '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-4 sm:col-span-2 lg:col-span-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Recipient
                    </p>
                    <p className="mt-2 flex items-start gap-2 break-all text-sm font-medium text-foreground">
                      <User className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600" aria-hidden />
                      {viewPayment?.recipient ?? viewContent?.recipient ?? '—'}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Subject
                    </p>
                    <p className="mt-2 text-sm font-semibold leading-snug text-foreground">
                      {viewPayment?.subject ?? viewContent?.subject ?? '—'}
                    </p>
                  </div>
                  {(viewPayment?.templateName || viewContent?.templateName) && (
                    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Template
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-sm font-medium text-foreground">
                        <FileText className="h-4 w-4 text-cyan-600" aria-hidden />
                        {viewPayment?.templateName ?? viewContent?.templateName}
                      </p>
                    </div>
                  )}
                </div>

                {viewAttachments.length > 0 && (
                  <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Attachments
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {viewAttachments.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-2 rounded-full border border-cyan-200/80 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-100"
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-border/70 bg-card shadow-sm">
                  <div className="border-b border-border/60 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Message preview
                    </p>
                  </div>
                  <div className="bg-slate-50/80 p-4 dark:bg-slate-900/40">
                    {previewBody ? (
                      previewIsHtml ? (
                        <div
                          className="scrollbar-hide prose prose-sm dark:prose-invert max-h-[min(52vh,28rem)] max-w-none overflow-y-auto rounded-lg border border-border/60 bg-white p-4 shadow-inner dark:bg-card"
                          dangerouslySetInnerHTML={{ __html: previewBody }}
                        />
                      ) : (
                        <pre className="scrollbar-hide max-h-[min(52vh,28rem)] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-white p-4 text-sm leading-relaxed text-foreground shadow-inner dark:bg-card">
                          {previewBody}
                        </pre>
                      )
                    ) : (
                      <p className="rounded-lg border border-dashed border-border bg-white p-6 text-center text-sm text-muted-foreground dark:bg-card">
                        {(viewContent as { note?: string } | null)?.note ??
                          'No message body stored for this entry.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
