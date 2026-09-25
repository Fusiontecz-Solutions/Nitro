import { useEffect, useMemo } from "react";
import { axiosPost } from "@/redux/axios";

const SIGNNOW_EMBEDDED_MESSAGE_SOURCE = "nitro-signnow-embedded";

const hasCrmSession = () => {
    try {
        return Boolean(localStorage.getItem("token") || sessionStorage.getItem("token"));
    } catch {
        return false;
    }
};

type ReviewOutcome = "finish" | "close" | "decline" | "unknown";

function readOutcome(): { envelopeId: string; outcome: ReviewOutcome } {
    const params = new URLSearchParams(window.location.search);
    const raw = String(params.get("event") || "").trim().toLowerCase();
    const outcome: ReviewOutcome =
        raw === "finish" || raw === "close" || raw === "decline" ? raw : "unknown";
    return { envelopeId: String(params.get("envelopeId") || "").trim(), outcome };
}

/**
 * SignNow sends the review tab here after the preparer leaves the review.
 *
 * Each outcome has its own `event`: only `finish` marks the review done. It is
 * recorded on the CRM server first (a database write, no SignNow call), so the
 * CRM shows "Send via SignNow" even if its own tab was refreshed or closed
 * meanwhile; then the CRM tab is told and this tab closes.
 */
export default function SignNowEmbeddedCompletePage() {
    const { envelopeId, outcome } = useMemo(readOutcome, []);

    useEffect(() => {
        if (outcome !== "finish") return;
        let cancelled = false;
        const notifyCrm = () => {
            const payload = { source: SIGNNOW_EMBEDDED_MESSAGE_SOURCE, event: "complete" };
            const target = window.opener ?? window.parent;
            if (!target || target === window) return;
            try {
                target.postMessage(payload, window.location.origin);
            } catch {
                /* The CRM tab reads the server state when it regains focus. */
            }
        };
        const record =
            envelopeId && hasCrmSession()
                ? axiosPost("/docusign/signnow-review-finished", { envelopeId }).catch(() => undefined)
                : Promise.resolve(undefined);
        // Close only after the server has the Finish — closing first would abort it.
        void record.finally(() => {
            if (cancelled) return;
            notifyCrm();
            if (window.opener) window.close();
        });
        return () => {
            cancelled = true;
        };
    }, [envelopeId, outcome]);

    const finished = outcome === "finish";
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
                <p className="text-lg font-semibold text-slate-900">
                    {finished ? "Review complete" : "Review not finished"}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {finished
                        ? "Returning to Nitro Advance. Send via SignNow to email the merchant."
                        : "The SignNow review was closed before Finish. Go back to the Nitro Advance tab and click Open SignNow tab to finish it."}
                </p>
            </div>
        </div>
    );
}
