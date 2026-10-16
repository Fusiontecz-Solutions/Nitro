import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, MessageSquareText } from "lucide-react";
import { axiosGet } from "@/redux/axios";
import { cn, formatDateTimeUS } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { stripGmailMessageNoteMarker } from "@/lib/formatActionRequired";

/** Activity-log actions whose `metadata.note` is a hand-off message between Agent and Underwriter. */
const HANDOFF_ACTIONS: Record<string, { from: string; to: string }> = {
  SUBMITTED_TO_UNDERWRITING: { from: "Agent", to: "Underwriter" },
  SENT_TO_AGENT_APPROVAL: { from: "Underwriter", to: "Agent" },
  RETURNED_TO_UNDERWRITER: { from: "Agent", to: "Underwriter" },
};

type ActivityLogRow = {
  id: string;
  actionType: string;
  userName: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

type WorkflowNote = {
  id: string;
  from: string;
  to: string;
  author: string | null;
  text: string;
  createdAt: string | null;
};

const workflowNotesQueryKey = (applicationRef: string | number | null | undefined) => [
  "workflow-notes",
  String(applicationRef ?? ""),
];

async function fetchWorkflowNotes(applicationRef: string | number): Promise<WorkflowNote[]> {
  const res = await axiosGet(`/applications/${applicationRef}/activity-logs`, { skipCache: true } as any);
  const rows = (res?.data?.data ?? []) as ActivityLogRow[];
  return rows
    .filter((r) => HANDOFF_ACTIONS[r.actionType] && String(r.metadata?.note ?? "").trim())
    .map((r) => ({
      id: r.id,
      ...HANDOFF_ACTIONS[r.actionType],
      author: r.userName,
      text: String(r.metadata?.note ?? "").trim(),
      createdAt: r.createdAt,
    }));
}

/**
 * Notes exchanged when the deal moves between Agent and Underwriter (Send to Agent / Return to
 * Underwriter), plus the Agent's intake "Notes for underwriting". Newest first.
 */
export default function WorkflowNotesPanel({
  applicationRef,
  intakeNote,
  intakeAuthor,
  intakeCreatedAt,
  className,
}: {
  applicationRef: string | number | null | undefined;
  /** `Application.note` — the Agent's "Notes for underwriting" from the create form. */
  intakeNote?: string | null;
  intakeAuthor?: string | null;
  intakeCreatedAt?: string | null;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const query = useQuery({
    queryKey: workflowNotesQueryKey(applicationRef),
    queryFn: () => fetchWorkflowNotes(applicationRef as string | number),
    enabled: applicationRef != null && String(applicationRef) !== "",
    staleTime: 15_000,
  });

  const notes: WorkflowNote[] = [...(query.data ?? [])];
  // Gmail auto-created deals carry an internal `gmail-msg:<id>` marker in the note — never show it.
  const intake = stripGmailMessageNoteMarker(intakeNote);
  if (intake) {
    notes.push({
      id: "intake-note",
      from: "Agent",
      to: "Underwriter",
      author: intakeAuthor ?? null,
      text: intake,
      createdAt: intakeCreatedAt ?? null,
    });
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-[220px] flex-col overflow-hidden rounded-2xl border shadow-md",
        isDark ? "border-slate-700 bg-[#141517]" : "border-slate-200 bg-white",
        className,
      )}
    >
      <div className="flex items-center gap-2 bg-[#bcdcf1] px-5 py-3 text-lg font-bold tracking-wider text-slate-800 dark:bg-[#1e3a52] dark:text-slate-100">
        <MessageSquareText className="size-5" />
        WORKFLOW NOTES
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: 460 }}>
        {query.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading notes…
          </div>
        ) : notes.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No notes yet. Notes added when the deal is sent between the Agent and the Underwriter show here.
          </p>
        ) : (
          notes.map((n) => (
            <div
              key={n.id}
              className={cn(
                "rounded-xl border p-3",
                n.from === "Underwriter"
                  ? "border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/30"
                  : "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30",
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{n.from}</span>
                <ArrowRight className="size-3" />
                <span>{n.to}</span>
                {n.id === "intake-note" ? <span className="normal-case">· Notes for underwriting</span> : null}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-foreground">{n.text}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {[n.author, n.createdAt ? formatDateTimeUS(n.createdAt, "") : null].filter(Boolean).join(" · ")}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
