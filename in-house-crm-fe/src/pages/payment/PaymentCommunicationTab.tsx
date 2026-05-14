import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Copy, Loader2, MessageSquare, Phone } from "lucide-react";
import { toast } from "react-toastify";

import type { RootState } from "@/redux/store";
import { AvochatoCallSurface } from "@/components/voice/AvochatoCallSurface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { normalizeE164 } from "@/voice/useAvochatoVoice";
import { AvochatoSmsInboxPanel } from "@/components/payment/AvochatoSmsInboxPanel";

type CommMode = "sms" | "calling";

function pickDefaultPhones(app: unknown): {
  ownerMobile: string;
  businessNumber: string;
  preferred: string;
} {
  const row = app as {
    client?: {
      owner?: { mobileNumber?: string };
      business?: { number?: string };
    };
  } | null;
  const ownerMobile = String(row?.client?.owner?.mobileNumber ?? "").trim();
  const businessNumber = String(row?.client?.business?.number ?? "").trim();
  const preferred = ownerMobile || businessNumber;
  return { ownerMobile, businessNumber, preferred };
}

export default function PaymentCommunicationTab() {
  const { loading, data: applicationData, error } = useSelector(
    (state: RootState) => state.applicationDetail,
  );

  const [mode, setMode] = useState<CommMode>("sms");
  const [smsPhone, setSmsPhone] = useState("");
  const [smsBody, setSmsBody] = useState("");

  const { ownerMobile, businessNumber, preferred } = useMemo(
    () => pickDefaultPhones(applicationData),
    [applicationData],
  );

  const matchPhones = useMemo(() => {
    const list: string[] = [];
    for (const raw of [ownerMobile, businessNumber]) {
      const n = normalizeE164(raw) || String(raw).trim();
      if (n) list.push(n);
    }
    return list;
  }, [ownerMobile, businessNumber]);
  useEffect(() => {
    if (!preferred) return;
    setSmsPhone((prev) => (prev.trim() ? prev : preferred));
  }, [preferred]);

  const businessName = useMemo(() => {
    const app = applicationData as { client?: { business?: { name?: string } } } | null;
    return String(app?.client?.business?.name ?? "").trim();
  }, [applicationData]);

  const ownerLabel = useMemo(() => {
    const app = applicationData as {
      client?: { owner?: { firstName?: string; lastName?: string } };
    } | null;
    const o = app?.client?.owner;
    const name = `${o?.firstName ?? ""} ${o?.lastName ?? ""}`.trim();
    return name || "Owner";
  }, [applicationData]);

  const copySmsDraft = async () => {
    const to = normalizeE164(smsPhone) || smsPhone.trim();
    if (!to) {
      toast.error("Enter a phone number first.");
      return;
    }
    const body = smsBody.trim();
    const block = body ? `To: ${to}\n\n${body}` : `To: ${to}`;
    try {
      await navigator.clipboard.writeText(block);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy — check browser permissions.");
    }
  };

  const smsDeviceHref = useMemo(() => {
    const to = normalizeE164(smsPhone);
    if (!to) return null;
    const body = smsBody.trim();
    const q = body ? `?body=${encodeURIComponent(body)}` : "";
    return `sms:${to}${q}`;
  }, [smsPhone, smsBody]);

  if (loading && !applicationData) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        <span>Loading application…</span>
      </div>
    );
  }

  if (error && !applicationData) {
    return (
      <p className="py-8 text-center text-destructive" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Communication</h2>
        <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
          SMS uses Avochato when the API is configured (inbox + history in the CRM). You can still copy a
          draft or call when needed. Phone numbers default from the application when available.
        </p>
      </div>

      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1 dark:border-white/10 dark:bg-white/[0.04]">
        <button
          type="button"
          onClick={() => setMode("sms")}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors sm:px-4 ${
            mode === "sms"
              ? "bg-[#276D9C] text-white shadow-sm"
              : "text-muted-foreground hover:bg-background hover:text-foreground dark:hover:bg-white/[0.06]"
          }`}
        >
          <MessageSquare className="size-3.5 shrink-0 opacity-90" aria-hidden />
          SMS
        </button>
        <button
          type="button"
          onClick={() => setMode("calling")}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors sm:px-4 ${
            mode === "calling"
              ? "bg-[#276D9C] text-white shadow-sm"
              : "text-muted-foreground hover:bg-background hover:text-foreground dark:hover:bg-white/[0.06]"
          }`}
        >
          <Phone className="size-3.5 shrink-0 opacity-90" aria-hidden />
          Calling
        </button>
      </div>

      {mode === "sms" && (
        <div className="space-y-5">
          <AvochatoSmsInboxPanel matchPhones={matchPhones} />

          <div className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm ring-1 ring-inset ring-border/30 dark:border-white/10 dark:bg-white/[0.03] dark:ring-white/10 sm:p-5">
          <div className="mb-4 flex flex-col gap-1 border-b border-border/60 pb-4 dark:border-white/10">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              SMS draft (offline)
            </p>
            <p className="text-sm text-foreground">
              {businessName ? (
                <>
                  <span className="font-medium">{businessName}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-muted-foreground">{ownerLabel}</span>
                </>
              ) : (
                <span className="text-muted-foreground">{ownerLabel}</span>
              )}
            </p>
            {(ownerMobile || businessNumber) && (
              <dl className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                {ownerMobile ? (
                  <div>
                    <dt className="inline font-medium text-foreground/80">Owner mobile</dt>{" "}
                    <dd className="inline">{ownerMobile}</dd>
                  </div>
                ) : null}
                {businessNumber ? (
                  <div>
                    <dt className="inline font-medium text-foreground/80">Business number</dt>{" "}
                    <dd className="inline">{businessNumber}</dd>
                  </div>
                ) : null}
              </dl>
            )}
          </div>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="payment-sms-phone" className="text-sm font-medium text-foreground">
                Phone number
              </label>
              <Input
                id="payment-sms-phone"
                placeholder="+14155552671 or 4155552671"
                value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                autoComplete="tel"
                className="bg-background dark:bg-white/[0.04]"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="payment-sms-body" className="text-sm font-medium text-foreground">
                Message
              </label>
              <Textarea
                id="payment-sms-body"
                placeholder="Write your SMS…"
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                rows={5}
                className="min-h-[120px] resize-y bg-background dark:bg-white/[0.04]"
              />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Compose here, then copy into Avochato or your SMS tool. On a phone or compatible desktop
              app, you can open the device SMS composer when a number is valid.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="default"
                className="gap-2 bg-[#276D9C] hover:bg-[#215a84]"
                onClick={() => void copySmsDraft()}
              >
                <Copy className="size-4" aria-hidden />
                Copy draft
              </Button>
              {smsDeviceHref ? (
                <Button
                  type="button"
                  variant="outline"
                  className="dark:border-white/15 dark:hover:bg-white/[0.06]"
                  asChild
                >
                  <a href={smsDeviceHref}>Open SMS app</a>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        </div>
      )}

      {mode === "calling" && (
        <div className="space-y-5">
          <div className="flex flex-col gap-2 border-b border-border/50 pb-4 dark:border-white/[0.06]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#276D9C] dark:text-[#5AACEA]">
              Voice link
            </p>
            <p className="text-sm font-medium text-foreground">Calling from this deal</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Dial or paste a number, then place the call. HTTPS or localhost; microphone required. Defaults to
              owner mobile, then business number when present.
            </p>
            {preferred ? (
              <p className="text-xs text-muted-foreground">
                Default: <span className="font-mono text-foreground/90">{preferred}</span>
              </p>
            ) : (
              <p className="text-xs text-amber-800 dark:text-amber-400/90">
                No phone on file for this deal — dial manually or paste a number.
              </p>
            )}
          </div>
          <AvochatoCallSurface defaultPhone={preferred} isActive={mode === "calling"} embedded />
        </div>
      )}
    </div>
  );
}
