import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "react-toastify";

import { axiosGet, axiosPost } from "@/redux/axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type AvochatoTicket = {
  id?: string;
  contact?: string;
  status?: string;
  created_at?: number;
};

type AvochatoContact = {
  id?: string;
  name?: string;
  phone?: string;
};

type AvochatoEvent = Record<string, unknown>;

function digitsOnly(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

function last10(s: string): string {
  const d = digitsOnly(s);
  return d.length <= 10 ? d : d.slice(-10);
}

function eventTimeMs(ev: AvochatoEvent): number {
  const raw = Number(ev.sent_at ?? ev.created_at ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 1e12 ? raw : raw * 1000;
}

function formatShortTime(ms: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

async function fetchJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const res = await axiosGet(path, { params });
  const body = res.data as { success?: boolean; message?: string };
  if (body && body.success === false) {
    throw new Error(typeof body.message === "string" ? body.message : "Request failed");
  }
  return res.data as T;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type Props = {
  /** E.164 or raw numbers from the application — used to highlight / auto-select a matching ticket. */
  matchPhones: string[];
};

export function AvochatoSmsInboxPanel({ matchPhones }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [subdomain, setSubdomain] = useState("");
  const [tickets, setTickets] = useState<AvochatoTicket[]>([]);
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [ticketHasMore, setTicketHasMore] = useState(true);
  const [contactsById, setContactsById] = useState<Record<string, AvochatoContact>>({});
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [events, setEvents] = useState<AvochatoEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [compose, setCompose] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const subdomainTrim = subdomain.trim();

  const matchLast10 = useMemo(() => {
    const set = new Set<string>();
    for (const p of matchPhones) {
      const t = last10(p);
      if (t.length >= 10) set.add(t);
    }
    return set;
  }, [matchPhones]);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetchJson<{ success?: boolean; configured?: boolean }>("/avochato-messaging/status");
      setConfigured(!!r?.configured);
    } catch {
      setConfigured(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const loadTickets = useCallback(
    async (page: number, append: boolean) => {
      setTicketLoading(true);
      try {
        const r = await fetchJson<{
          success?: boolean;
          data?: { tickets?: AvochatoTicket[]; total_count?: number };
        }>("/avochato-messaging/tickets", {
          page,
          ...(subdomainTrim ? { subdomain: subdomainTrim } : {}),
        });
        const list = Array.isArray(r?.data?.tickets) ? r.data!.tickets! : [];
        const filtered = list.filter((t) => t?.id);
        let mergedCount = 0;
        setTickets((prev) => {
          let next: AvochatoTicket[];
          if (!append) {
            next = filtered;
          } else {
            const seen = new Set(prev.map((t) => String(t.id)));
            next = [...prev, ...filtered.filter((t) => !seen.has(String(t.id)))];
          }
          mergedCount = next.length;
          return next;
        });
        const total = typeof r?.data?.total_count === "number" ? r.data!.total_count! : null;
        if (total != null) {
          setTicketHasMore(mergedCount < total);
        } else {
          setTicketHasMore(filtered.length >= 30);
        }
        setTicketPage(page);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not load Avochato tickets";
        toast.error(msg);
        if (!append) setTickets([]);
      } finally {
        setTicketLoading(false);
      }
    },
    [subdomainTrim],
  );

  useEffect(() => {
    if (configured !== true) return;
    setTickets([]);
    setContactsById({});
    setTicketHasMore(true);
    setSelectedTicketId(null);
    void loadTickets(1, false);
  }, [configured, subdomainTrim, loadTickets]);

  const contactIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tickets) {
      const c = String(t.contact ?? "").trim();
      if (c) ids.add(c);
    }
    return [...ids].sort().join(",");
  }, [tickets]);

  useEffect(() => {
    if (configured !== true || !contactIdsKey) return;
    const contactIds = contactIdsKey.split(",").filter(Boolean);
    let cancelled = false;
    (async () => {
      const merged: Record<string, AvochatoContact> = {};
      for (const group of chunk(contactIds, 25)) {
        try {
          const r = await fetchJson<{ success?: boolean; data?: { contacts?: AvochatoContact[] } }>(
            "/avochato-messaging/contacts",
            {
              ids: group.join(","),
              ...(subdomainTrim ? { subdomain: subdomainTrim } : {}),
            },
          );
          const list = Array.isArray(r?.data?.contacts) ? r.data!.contacts! : [];
          for (const c of list) {
            const id = String(c?.id ?? "").trim();
            if (id) merged[id] = c;
          }
        } catch {
          /* ignore partial */
        }
      }
      if (!cancelled) setContactsById((prev) => ({ ...prev, ...merged }));
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, contactIdsKey, subdomainTrim]);

  const loadConversation = useCallback(
    async (ticketId: string) => {
      setEventsLoading(true);
      try {
        const r = await fetchJson<{ success?: boolean; data?: { events?: AvochatoEvent[] } }>(
          `/avochato-messaging/tickets/${encodeURIComponent(ticketId)}/conversation`,
          subdomainTrim ? { subdomain: subdomainTrim } : {},
        );
        const list = Array.isArray(r?.data?.events) ? r.data!.events! : [];
        setEvents(list);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not load conversation";
        toast.error(msg);
        setEvents([]);
      } finally {
        setEventsLoading(false);
      }
    },
    [subdomainTrim],
  );

  useEffect(() => {
    if (!selectedTicketId) {
      setEvents([]);
      return;
    }
    void loadConversation(selectedTicketId);
  }, [selectedTicketId, loadConversation]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events, selectedTicketId]);

  useEffect(() => {
    if (configured !== true || selectedTicketId || tickets.length === 0) return;
    for (const t of tickets) {
      const tid = String(t.id ?? "").trim();
      const cid = String(t.contact ?? "").trim();
      if (!tid || !cid) continue;
      const phone = String(contactsById[cid]?.phone ?? "").trim();
      if (phone && matchLast10.has(last10(phone))) {
        setSelectedTicketId(tid);
        break;
      }
    }
  }, [configured, tickets, contactsById, matchLast10, selectedTicketId]);

  const selectedContact = useMemo(() => {
    if (!selectedTicketId) return null;
    const ticket = tickets.find((x) => String(x.id) === selectedTicketId);
    const cid = String(ticket?.contact ?? "").trim();
    if (!cid) return null;
    return contactsById[cid] ?? null;
  }, [selectedTicketId, tickets, contactsById]);

  const sendMessage = async () => {
    const phone = String(selectedContact?.phone ?? "").trim();
    const text = compose.trim();
    if (!selectedTicketId) {
      toast.error("Select a conversation first.");
      return;
    }
    if (!phone) {
      toast.error("This ticket has no contact phone in Avochato.");
      return;
    }
    if (!text) return;
    setSendLoading(true);
    try {
      await axiosPost("/avochato-messaging/messages", {
        phone,
        message: text,
        markAddressed: true,
        ...(subdomainTrim ? { subdomain: subdomainTrim } : {}),
      });
      setCompose("");
      toast.success("Message sent");
      await loadConversation(selectedTicketId);
    } catch (e: unknown) {
      const data = (e as { response?: { data?: { message?: string } } })?.response?.data;
      toast.error(typeof data?.message === "string" ? data.message : "Send failed");
    } finally {
      setSendLoading(false);
    }
  };

  if (configured === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        Checking Avochato…
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
        Avochato SMS inbox is unavailable until the API sets{" "}
        <span className="font-mono text-foreground/90">AVOCHATO_AUTH_ID</span> and{" "}
        <span className="font-mono text-foreground/90">AVOCHATO_AUTH_SECRET</span> (same credentials as voice).
        Use the offline draft below to copy text or open the device SMS app.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid max-w-md gap-1.5">
          <label htmlFor="avo-sms-subdomain" className="text-xs font-medium text-muted-foreground">
            Inbox subdomain (optional)
          </label>
          <Input
            id="avo-sms-subdomain"
            placeholder="Override default inbox from server env"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
            className="h-9 bg-background text-sm dark:bg-white/[0.04]"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 dark:border-white/15"
          disabled={ticketLoading}
          onClick={() => {
            setTickets([]);
            setTicketHasMore(true);
            void loadTickets(1, false);
          }}
        >
          <RefreshCw className={cn("size-4", ticketLoading && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </div>

      <div className="flex min-h-[420px] max-h-[min(70vh,640px)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm ring-1 ring-inset ring-border/30 dark:border-white/10 dark:bg-white/[0.03] dark:ring-white/10 md:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-border/60 dark:border-white/10 md:w-[min(100%,320px)] md:border-b-0 md:border-r">
          <div className="border-b border-border/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground dark:border-white/10">
            Conversations
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {ticketLoading && tickets.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading…
              </div>
            ) : tickets.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No tickets in this inbox.</p>
            ) : (
              <ul className="divide-y divide-border/50 dark:divide-white/10">
                {tickets.map((t) => {
                  const id = String(t.id ?? "");
                  const cid = String(t.contact ?? "");
                  const c = cid ? contactsById[cid] : undefined;
                  const title =
                    [c?.name, c?.phone].map((x) => String(x ?? "").trim()).find(Boolean) ?? "Conversation";
                  const sub = String(c?.phone ?? "").trim();
                  const active = id === selectedTicketId;
                  const created = typeof t.created_at === "number" ? formatShortTime(t.created_at * 1000) : "";
                  const matched = sub && matchLast10.has(last10(sub));
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setSelectedTicketId(id)}
                        className={cn(
                          "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition-colors",
                          active
                            ? "bg-[#276D9C]/12 text-foreground dark:bg-[#276D9C]/20"
                            : "hover:bg-muted/50 dark:hover:bg-white/[0.04]",
                        )}
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {matched ? (
                            <span
                              className="size-1.5 shrink-0 rounded-full bg-[#276D9C]"
                              title="Matches this deal’s phone"
                              aria-hidden
                            />
                          ) : null}
                          <span className="truncate">{title}</span>
                        </span>
                        {sub ? <span className="truncate font-mono text-xs text-muted-foreground">{sub}</span> : null}
                        <span className="text-[11px] text-muted-foreground">
                          {String(t.status ?? "—")}
                          {created ? ` · ${created}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {ticketHasMore ? (
            <div className="border-t border-border/60 p-2 dark:border-white/10">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                disabled={ticketLoading}
                onClick={() => void loadTickets(ticketPage + 1, true)}
              >
                {ticketLoading ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!selectedTicketId ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              Select a conversation to view messages.
            </div>
          ) : (
            <>
              <div className="border-b border-border/60 px-4 py-2 dark:border-white/10">
                <p className="text-sm font-semibold text-foreground">
                  {String(selectedContact?.name ?? selectedContact?.phone ?? "Conversation")}
                </p>
                {selectedContact?.phone ? (
                  <p className="font-mono text-xs text-muted-foreground">{selectedContact.phone}</p>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {eventsLoading ? (
                  <div className="flex justify-center py-8 text-muted-foreground">
                    <Loader2 className="size-6 animate-spin" aria-hidden />
                  </div>
                ) : (
                  events.map((ev, idx) => {
                    const type = String(ev.element_type ?? "");
                    const key = String(ev.event_id ?? ev.uuid ?? idx);
                    if (type === "SmsMessage") {
                      const dir = String(ev.direction ?? "");
                      const outbound = dir === "out";
                      const text = String(ev.message ?? "");
                      const ts = eventTimeMs(ev);
                      return (
                        <div key={key} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                          <div
                            className={cn(
                              "max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                              outbound
                                ? "rounded-br-md bg-[#276D9C] text-white"
                                : "rounded-bl-md border border-border/60 bg-muted/40 text-foreground dark:border-white/10 dark:bg-white/[0.06]",
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{text || "—"}</p>
                            <p
                              className={cn(
                                "mt-1 text-[10px]",
                                outbound ? "text-white/80" : "text-muted-foreground",
                              )}
                            >
                              {formatShortTime(ts)}
                              {String(ev.status ?? "") ? ` · ${String(ev.status)}` : ""}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    if (type === "Call") {
                      const dur = Number(ev.duration ?? 0);
                      const from = String(ev.call_from ?? "");
                      const to = String(ev.call_to ?? "");
                      const ts = eventTimeMs(ev);
                      return (
                        <div
                          key={key}
                          className="mx-auto max-w-[95%] rounded-lg border border-dashed border-border/70 bg-muted/20 px-2 py-1.5 text-center text-[11px] text-muted-foreground dark:border-white/15 dark:bg-white/[0.04]"
                        >
                          Call {String(ev.direction ?? "")}{" "}
                          {dur ? `· ${dur}s` : ""}
                          {(from || to) && (
                            <span className="block font-mono text-[10px] opacity-90">
                              {from} → {to}
                            </span>
                          )}
                          {ts ? <span className="block opacity-80">{formatShortTime(ts)}</span> : null}
                        </div>
                      );
                    }
                    if (type === "StatusChange") {
                      return (
                        <div key={key} className="text-center text-[11px] text-muted-foreground">
                          Status: {String(ev.status ?? "—")}
                        </div>
                      );
                    }
                    return null;
                  })
                )}
                <div ref={threadEndRef} />
              </div>
              <div className="border-t border-border/60 bg-background/80 p-3 backdrop-blur-sm dark:border-white/10 dark:bg-black/20">
                <Textarea
                  placeholder={selectedContact?.phone ? "Type a message…" : "No phone on this contact"}
                  value={compose}
                  onChange={(e) => setCompose(e.target.value)}
                  disabled={!selectedContact?.phone || sendLoading}
                  rows={3}
                  className="mb-2 min-h-[72px] resize-none bg-background text-sm dark:bg-white/[0.04]"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="gap-2 bg-[#276D9C] hover:bg-[#215a84]"
                    disabled={!compose.trim() || sendLoading || !selectedContact?.phone}
                    onClick={() => void sendMessage()}
                  >
                    {sendLoading ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="size-4" aria-hidden />
                    )}
                    Send
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
