"use client";

import { toast } from "react-toastify";
import { useNavigate } from "react-router";
import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { generateDecisionLogicReport } from "@/redux/actions/decision-logic-actions";

const WIDGET_SCRIPT_SRC =
  "https://assets.decisionlogic.com/cdn/widgetui/widgetUI.js";

function resolveWidgetMode(): "LIVE" | "TEST" {
  const raw = String(
    import.meta.env.VITE_DECISION_LOGIC_WIDGET_MODE ?? "TEST",
  )
    .trim()
    .toUpperCase();
  return raw === "LIVE" ? "LIVE" : "TEST";
}

function resolveWidgetGuids(): { siteUserGuid: string; profileGuid: string } {
  return {
    siteUserGuid: String(
      import.meta.env.VITE_DECISION_LOGIC_SITE_USER_GUID ?? "",
    ).trim(),
    profileGuid: String(
      import.meta.env.VITE_DECISION_LOGIC_PROFILE_GUID ?? "",
    ).trim(),
  };
}

function findWidgetScriptEl(): HTMLScriptElement | undefined {
  const list = document.getElementsByTagName("script");
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.src && s.src.includes("widgetUI.js")) return s;
  }
  return undefined;
}

/** Non-empty widget `getEvent` detail (payload shapes vary by DL version). */
function hasMeaningfulWidgetDetail(detail: unknown): boolean {
  if (detail == null || detail === "") {
    return false;
  }
  console.log("detail from hasMeaningfulWidgetDetail", detail);
  if (typeof detail === "string") {
    return detail.trim().length > 0;
  }
  if (typeof detail === "number" || typeof detail === "boolean") {
    return true;
  }
  console.log("detail from hasMeaningfulWidgetDetail", detail);
  if (Array.isArray(detail)) {
    return detail.length > 0;
  }
  if (typeof detail === "object") {
    return Object.keys(detail as object).length > 0;
  }
  return false;
}

/** DL often dispatches from shadow DOM; wait for quiet period after last signal before POST. */
const WIDGET_REPORT_DEBOUNCE_MS = 2800;

const REPORT_ATTEMPTS = 4;

async function generateReportWithTransientRetry(
  finalCode: string,
  businessOwnerId: number,
  bankAccountId: number,
) {
  let last: Awaited<ReturnType<typeof generateDecisionLogicReport>> | undefined;

  console.log("finalCode from generateReportWithTransientRetry", finalCode);
  console.log("businessOwnerId from generateReportWithTransientRetry", businessOwnerId);
  console.log("bankAccountId from generateReportWithTransientRetry", bankAccountId);
  
  for (let attempt = 0; attempt < REPORT_ATTEMPTS; attempt++) {
    last = await generateDecisionLogicReport(
      finalCode,
      businessOwnerId,
      bankAccountId,
    );
    const err =
      last &&
      typeof last === "object" &&
      "error" in last &&
      typeof (last as { error?: string }).error === "string"
        ? (last as { error: string }).error
        : "";
    if (!err) {
      return last;
    }
    const soft = /not ready|pending|timeout|429|502|503|504|temporar|try again|empty|ECONNRESET|network|fetch/i.test(
      err.toLowerCase(),
    );
    if (!soft || attempt === REPORT_ATTEMPTS - 1) {
      return last;
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1200 * (attempt + 1));
    });
  }
  return last;
}

export default function DecisionLogicExecutor({
  requestCode,
  businessOwnerId,
  bankAccountId,
}: {
  requestCode: string;
  businessOwnerId: number;
  bankAccountId: number;
}) {
  const navigate = useNavigate();
  const widgetMode = resolveWidgetMode();
  const widgetGuids = resolveWidgetGuids();

  const [widgetLoaded, setWidgetLoaded] = useState(false);
  const [widgetLoadError, setWidgetLoadError] = useState("");
  const reportSubmittedRef = useRef(false);
  const reportDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let settled = false;
    let timeoutId = 0;

    const clearTimer = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = 0;
    };

    const markReady = () => {
      if (settled || cancelled) return;
      settled = true;
      clearTimer();
      setWidgetLoaded(true);
      setWidgetLoadError("");
    };

    const markError = (msg: string) => {
      if (settled || cancelled) return;
      settled = true;
      clearTimer();
      setWidgetLoadError(msg);
    };

    if (
      typeof customElements !== "undefined" &&
      customElements.get("widget-ui")
    ) {
      markReady();
      return () => {
        cancelled = true;
        clearTimer();
      };
    }

    const existing = findWidgetScriptEl();
    if (existing?.dataset.dlWidgetReady === "1") {
      markReady();
      return () => {
        cancelled = true;
        clearTimer();
      };
    }

    const onScriptLoad = (el: HTMLScriptElement) => {
      el.dataset.dlWidgetReady = "1";
      markReady();
    };

    if (existing) {
      existing.addEventListener("load", () => onScriptLoad(existing), {
        once: true,
      });
      existing.addEventListener(
        "error",
        () => markError("Unable to load Decision Logic widget script."),
        { once: true },
      );
      window.setTimeout(() => {
        if (
          !cancelled &&
          !settled &&
          typeof customElements !== "undefined" &&
          customElements.get("widget-ui")
        ) {
          onScriptLoad(existing);
        }
      }, 0);
    } else {
      const script = document.createElement("script");
      script.src = WIDGET_SCRIPT_SRC;
      script.async = true;
      script.onload = () => onScriptLoad(script);
      script.onerror = () =>
        markError("Unable to load Decision Logic widget script.");
      document.body.appendChild(script);
    }

    queueMicrotask(() => {
      if (
        !cancelled &&
        !settled &&
        typeof customElements !== "undefined" &&
        customElements.get("widget-ui")
      ) {
        const el = findWidgetScriptEl();
        if (el) el.dataset.dlWidgetReady = "1";
        markReady();
      }
    });

    timeoutId = window.setTimeout(() => {
      if (!cancelled && !settled) {
        markError("Decision Logic widget took too long to load.");
      }
    }, 20000);

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, []);

  const flushSaveReport = useCallback(async () => {
    if (reportSubmittedRef.current) {
      return;
    }
    reportSubmittedRef.current = true;
    console.log("reportSubmittedRef from flushSaveReport",reportSubmittedRef.current);
    console.log("requestCode from flushSaveReport", requestCode);
    console.log("businessOwnerId from flushSaveReport", businessOwnerId);
    console.log("bankAccountId from flushSaveReport", bankAccountId);

    try {
      const finalCode = requestCode.trim();
      if (!finalCode) {
        throw new Error("Decision Logic did not return a request code.");
      }

      const response = await generateReportWithTransientRetry(
        finalCode,
        businessOwnerId,
        bankAccountId,
      );
      if (response && typeof response === "object" && "error" in response) {
        const errMsg = (response as { error?: string }).error;
        if (errMsg) throw new Error(errMsg);
      }

      toast.success(
        (response as { message?: string })?.message ||
          "Decision Logic report saved.",
      );
      navigate(
        `/decision-logic/success?businessOwnerId=${encodeURIComponent(
          String(businessOwnerId),
        )}`,
      );
    } catch (error) {
      reportSubmittedRef.current = false;
      if (error instanceof Error) toast.error(error.message);
      else {
        toast.error(
          "An unknown error occurred while generating the report.",
        );
      }
    }
  }, [bankAccountId, businessOwnerId, navigate, requestCode]);

  const scheduleSaveReportFromWidgetSignal = useCallback(
    (detail: unknown) => {
      console.log("detail from scheduleSaveReportFromWidgetSignal", detail);
      if (!hasMeaningfulWidgetDetail(detail)) {
        return;
      }
      if (reportSubmittedRef.current) {
        return;
      }
      if (reportDebounceRef.current) {
        window.clearTimeout(reportDebounceRef.current);
      }
      reportDebounceRef.current = window.setTimeout(() => {
        reportDebounceRef.current = null;
        void flushSaveReport();
      }, WIDGET_REPORT_DEBOUNCE_MS);
    },
    [flushSaveReport],
  );

  /**
   * Listen on `document` in capture phase: DL widget often emits `getEvent` from shadow DOM;
   * those events may not reach a listener on `<widget-ui>` alone.
   */
  useEffect(() => {
    if (!widgetLoaded) return;
    const host = document.getElementById("widget3");
    if (!host) return;

    const onGetEventCapture = (e: Event) => {
      if (!(e instanceof CustomEvent)) {
        return;
      }
      const path =
        typeof e.composedPath === "function" ? e.composedPath() : [];
      if (!path.includes(host)) {
        return;
      }
      scheduleSaveReportFromWidgetSignal(e.detail);
    };

    const onHostGetEvent = (e: Event) => {
      if (!(e instanceof CustomEvent)) {
        return;
      }
      scheduleSaveReportFromWidgetSignal(e.detail);
    };

    document.addEventListener("getEvent", onGetEventCapture, true);
    host.addEventListener("getEvent", onHostGetEvent);

    return () => {
      document.removeEventListener("getEvent", onGetEventCapture, true);
      host.removeEventListener("getEvent", onHostGetEvent);
      if (reportDebounceRef.current) {
        window.clearTimeout(reportDebounceRef.current);
        reportDebounceRef.current = null;
      }
    };
  }, [widgetLoaded, scheduleSaveReportFromWidgetSignal]);

  /** Expand widget host + shadow iframe to match layout (Decision Logic defaults to a small width). */
  useLayoutEffect(() => {
    if (!widgetLoaded) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;

    const applySizes = () => {
      if (cancelled) return;
      const shell = document.getElementById("widgetHeight");
      const host = document.getElementById("widget3");
      if (!shell || !host) return;

      const shellH = Math.max(320, Math.floor(shell.getBoundingClientRect().height));
      host.style.display = "block";
      host.style.width = "100%";
      host.style.maxWidth = "100%";
      host.style.boxSizing = "border-box";
      host.style.minHeight = `${shellH}px`;

      const root = host.shadowRoot;
      if (!root) return;
      const iframe = root.querySelector("iframe");
      if (iframe instanceof HTMLIFrameElement) {
        iframe.style.width = "100%";
        iframe.style.maxWidth = "100%";
        iframe.style.minHeight = `${shellH}px`;
        iframe.style.height = "auto";
        iframe.style.border = "0";
        iframe.style.display = "block";
      }
    };

    applySizes();
    const t1 = window.setTimeout(applySizes, 120);
    const t2 = window.setTimeout(applySizes, 500);
    const shell = document.getElementById("widgetHeight");
    if (shell && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => applySizes());
      ro.observe(shell);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro?.disconnect();
    };
  }, [widgetLoaded]);

  useEffect(() => {
    if (!widgetLoaded) return;
  
    console.log("⏳ Fallback timer started...");
  
    const timer = setTimeout(() => {
      console.log("🚀 Fallback triggered → calling report");
      flushSaveReport();
    }, 12000); // 12 sec after widget loads
  
    return () => clearTimeout(timer);
  }, [widgetLoaded, flushSaveReport]);

  const widgetProps: Record<string, string> = {
    id: "widget3",
    request_code: requestCode,
    widget_mode: widgetMode,
  };
  if (widgetGuids.siteUserGuid) {
    widgetProps.site_user_guid = widgetGuids.siteUserGuid;
  }
  if (widgetGuids.profileGuid) {
    widgetProps.profile_guid = widgetGuids.profileGuid;
  }

  const showEnvHint =
    !widgetGuids.siteUserGuid || !widgetGuids.profileGuid;

  return (
    <div className="dl-widget-page flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-slate-100 antialiased">
      <header className="shrink-0 bg-[#276D9C] shadow-[0_1px_0_rgba(0,0,0,0.08)]">
        <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 md:px-8">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white ring-1 ring-white/25">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="font-roboto text-lg font-semibold tracking-tight text-white sm:text-xl">
                Bank verification
              </h1>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-white/90">
                Securely connect your financial institution using DecisionLogic. Complete every
                step in the workspace below — your session is encrypted in transit.
              </p>
            </div>
          </div>
          <span className="inline-flex w-fit shrink-0 self-start rounded-md bg-white/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white ring-1 ring-white/25 sm:self-center">
            {widgetMode === "LIVE" ? "Live" : "Test"} environment
          </span>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-1 flex-col px-3 py-4 sm:px-5 sm:py-5 md:px-8 md:py-6">
          <div className="widget_section flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_12px_40px_-12px_rgba(15,23,42,0.12)]">
            {(widgetLoadError || showEnvHint) && (
              <div className="shrink-0 space-y-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-6">
                {widgetLoadError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                    <p className="font-medium">Widget could not load</p>
                    <p className="mt-1">{widgetLoadError}</p>
                    <p className="mt-2 text-xs text-red-700/90">
                      Request code: {requestCode ? `${requestCode.slice(0, 8)}…` : "—"} · Mode:{" "}
                      {widgetMode}
                    </p>
                  </div>
                ) : null}
                {showEnvHint ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-950">
                    Set <code className="rounded bg-amber-100/80 px-1 font-mono text-[0.7rem]">VITE_DECISION_LOGIC_SITE_USER_GUID</code>{" "}
                    and{" "}
                    <code className="rounded bg-amber-100/80 px-1 font-mono text-[0.7rem]">VITE_DECISION_LOGIC_PROFILE_GUID</code> in
                    the frontend <code className="font-mono text-[0.7rem]">.env</code> (same as{" "}
                    <code className="font-mono text-[0.7rem]">SITE_USER_GUID</code> /{" "}
                    <code className="font-mono text-[0.7rem]">PROFILE_GUID</code> on the API).
                  </div>
                ) : null}
              </div>
            )}

            <div
              id="widgetHeight"
              className="dl-widget-host widget_section flex min-h-0 flex-1 flex-col"
            >
              {widgetLoaded ? (
                createElement("widget-ui", widgetProps)
              ) : (
                <div className="flex min-h-[50dvh] flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                  <Loader2
                    className="h-10 w-10 animate-spin text-[#276D9C]"
                    aria-hidden
                  />
                  <div>
                    <p className="font-roboto text-base font-medium text-slate-800">
                      Loading secure widget
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      This may take a few seconds. Do not close this window.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
