import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useSelector } from "react-redux";
import { Inbox, Mail } from "lucide-react";

import type { RootState } from "@/redux/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import {
  TEMPLATE_CATEGORY_LABELS,
  type TemplateCategory,
} from "./paymentTemplateApi";
import {
  fetchPaymentMailLogsForApplication,
  getPaymentMailLogs,
  type PaymentMailLogEntry,
  type PaymentMailLogStatus,
} from "./paymentMailLogStorage";

function decodeDealLabel(raw: string | undefined) {
  if (!raw?.trim()) return "—";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const STATUS_TABS: { id: "all" | PaymentMailLogStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "queued", label: "Queued" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
];



function statusBadgeClass(status: PaymentMailLogStatus) {
  switch (status) {
    case "sent":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
    case "failed":
      return "border-red-500/25 bg-red-500/10 text-red-700";
    default:
      return "border-amber-500/25 bg-amber-500/10 text-amber-800";
  }
}

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function normalizeMojibakeText(value: string): string {
  if (!value) return value;
  // Decode common UTF-8-as-Latin1 mojibake (e.g. "Ã¢Â€Â”" -> "—").
  if (!/[ÃÂâ]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8").decode(bytes);
    return decoded || value;
  } catch {
    return value;
  }
}

function bodyIsHtml(body: string): boolean {
  return /<\/?(?:table|html|div|p|pre|br|span|strong|ul|ol|li|td|tr)\b/i.test(
    body
  );
}

export default function MailLogs() {
  const { paymentDealId } = useParams<{ paymentDealId: string }>();
  const dealLabel = useMemo(
    () => decodeDealLabel(paymentDealId),
    [paymentDealId]
  );
  const application = useSelector(
    (s: RootState) => s.applicationDetail.data
  ) as { _id?: string } | null | undefined;
  const applicationId = application?._id ?? null;

  const [rows, setRows] = useState<PaymentMailLogEntry[]>(() =>
    getPaymentMailLogs()
  );
  const [statusFilter, setStatusFilter] = useState<
    "all" | PaymentMailLogStatus
  >("all");
  const [selectedLog, setSelectedLog] = useState<PaymentMailLogEntry | null>(
    null
  );
  const selectedBody = selectedLog?.body?.trim() || "";
  const selectedBodyIsHtml = bodyIsHtml(selectedBody);


  useEffect(() => {
    const refresh = () => {
      if (applicationId) {
        void fetchPaymentMailLogsForApplication(applicationId)
          .then(setRows)
          .catch(() => {
            setRows(
              getPaymentMailLogs().filter(
                (r) =>
                  r.dealKey === dealLabel || r.applicationId === applicationId
              )
            );
          });
        return;
      }
      setRows(getPaymentMailLogs());
    };
    refresh();
    window.addEventListener("payment-mail-log-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("payment-mail-log-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [applicationId, dealLabel]);

  let scope: "deal" | "all" = "deal";
  let query: string | undefined = undefined;
  const filtered = useMemo(() => {
    let list = rows;
    if (scope === "deal") {
      list = list.filter(
        (r) =>
          r.dealKey === dealLabel ||
          (applicationId != null && r.applicationId === applicationId)
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((r) => r.status === statusFilter);
    }
    const q = (query as any)?.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.recipient.toLowerCase().includes(q) ||
          r.subject.toLowerCase().includes(q) ||
          r.templateName.toLowerCase().includes(q) ||
          r.dealKey.toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, scope, dealLabel, applicationId, statusFilter, query]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          Mail logs
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          History of letters and emails queued or sent from the payment workspace.
          New entries appear when you send from the Letters tab.
        </p>
      </div>
{/* 
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {SCOPE_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setScope(id)}
              className={cn(
                "rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors",
                scope === id
                  ? "bg-[#276D9C] text-white shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search recipient, subject, template…"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search mail logs"
          />
        </div>
      </div> */}

      <div className="inline-flex max-w-full flex-wrap items-center gap-2">
    
        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {STATUS_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatusFilter(id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                statusFilter === id
                  ? "bg-[#276D9C] text-white shadow-sm"
                  : "text-muted-foreground hover:bg-background hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-[#276D9C]/10 text-[#276D9C]">
              <Inbox className="size-6" aria-hidden />
            </div>
            <div className="max-w-md space-y-1">
              <p className="text-sm font-semibold text-foreground">
                No mail history yet
              </p>
              <p className="text-sm text-muted-foreground">
                {scope === "deal"
                  ? "Nothing logged for this deal. Open Letters, compose a template, and send — it will show up here."
                  : "No entries across deals. Send from Letters on any payment deal to build history."}
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">When</TableHead>
                <TableHead>Deal</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead className="min-w-[180px]">Subject</TableHead>
                <TableHead className="text-left">View</TableHead>
                <TableHead className="pr-4 text-left">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-4 text-foreground">
                    {formatWhen(row.at)}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate font-medium text-foreground">
                    {row.dealKey}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-foreground">
                    {row.templateName}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-foreground">
                      <Mail className="size-3.5 shrink-0 text-muted-foreground" />
                      {
                        TEMPLATE_CATEGORY_LABELS[
                          row.category as TemplateCategory
                        ]
                      }
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {row.recipient}
                  </TableCell>
                  <TableCell className="max-w-[240px] whitespace-normal break-words text-foreground">
                    {normalizeMojibakeText(row.subject || "—")}
                  </TableCell>
                  <TableCell className="text-left">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedLog(row)}
                    >
                      View
                    </Button>
                  </TableCell>
                  <TableCell className="pr-4 text-left">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-wide",
                        statusBadgeClass(row.status)
                      )}
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} entr
          {filtered.length === 1 ? "y" : "ies"}
          {scope === "deal" ? " for this deal" : " across all deals"}.
          {applicationId
            ? " Logs are saved on the server for this application."
            : " Logs are stored in this browser only until an application is loaded."}
        </p>
      )}

      <Dialog
        open={selectedLog !== null}
        onOpenChange={(open: boolean) => {
          if (!open) setSelectedLog(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mail preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Recipient
              </p>
              <p className="break-all text-foreground">
                {selectedLog?.recipient || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Subject
              </p>
              <p className="text-foreground">
                {normalizeMojibakeText(selectedLog?.subject || "—")}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Message
              </p>
              <div className="rounded-md border border-border bg-muted/20 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                {selectedBody ? (
                  selectedBodyIsHtml ? (
                    <div
                      className="max-h-[52vh] overflow-y-auto rounded-md border border-slate-200 bg-white p-3 break-words font-sans text-slate-900 [&_table]:w-full [&_td]:align-top"
                      dangerouslySetInnerHTML={{ __html: selectedBody }}
                    />
                  ) : (
                    <pre className="max-h-[52vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-3 font-sans text-slate-900">
                      {selectedBody}
                    </pre>
                  )
                ) : (
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-3 font-sans text-slate-900">
                    No message body is available for this log.
                  </pre>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
