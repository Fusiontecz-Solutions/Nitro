import { useQuery } from "@tanstack/react-query";
import { Loader2, Mail, MessagesSquare, Reply } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchIsoEmailThread } from "@/lib/workflowApi";

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
};

/** ISO approval email history: every send + the live Gmail thread (incl. ISO replies). */
export default function IsoEmailThreadCard({ applicationUuid }: { applicationUuid: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["iso-email-thread", applicationUuid],
    queryFn: () => fetchIsoEmailThread(applicationUuid),
    enabled: Boolean(applicationUuid),
    staleTime: 30_000,
  });

  if (!applicationUuid) return null;
  if (!isLoading && !error && !data?.thread && !(data?.sends?.length ?? 0)) return null;

  return (
    <Card className="border-border">
      <CardHeader className="border-b bg-muted/40 py-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessagesSquare className="size-4" />
          ISO approval email history
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading email history…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <>
            {data?.thread ? (
              <div className="text-sm">
                <p>
                  <span className="text-muted-foreground">Thread: </span>
                  <span className="font-medium">{data.thread.subject || "—"}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.thread.mailboxEmail ? `Mailbox ${data.thread.mailboxEmail}` : null}
                  {data.thread.counterpartEmail ? ` · ISO ${data.thread.counterpartEmail}` : null}
                </p>
              </div>
            ) : null}

            {data?.messages?.length ? (
              <ol className="space-y-2">
                {data.messages.map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      "rounded-md border p-3 text-sm",
                      m.fromMailbox ? "border-border bg-card" : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        {m.fromMailbox ? <Mail className="size-3.5" /> : <Reply className="size-3.5" />}
                        {m.fromMailbox ? "Sent" : "Reply"} · {m.from}
                      </span>
                      <span>{formatDateTime(m.date)}</span>
                    </div>
                    {m.snippet ? <p className="mt-1.5 line-clamp-3 text-foreground/90">{m.snippet}</p> : null}
                  </li>
                ))}
              </ol>
            ) : data?.messagesUnavailableReason ? (
              <p className="text-xs text-muted-foreground">{data.messagesUnavailableReason}</p>
            ) : null}

            {data?.sends?.length ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sends</p>
                <ul className="divide-y rounded-md border text-sm">
                  {data.sends.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        {s.templateName || "Approval email"} → {s.recipient}
                        {s.sentBy ? <span className="text-muted-foreground"> · by {s.sentBy}</span> : null}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 font-medium",
                            s.status === "failed"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
                              : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
                          )}
                        >
                          {s.status === "failed" ? "Failed" : s.transport === "gmail" ? "Gmail" : "Sent"}
                        </span>
                        {formatDateTime(s.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
