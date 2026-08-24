import { useEffect } from "react";

const SIGNNOW_EMBEDDED_MESSAGE_SOURCE = "nitro-signnow-embedded";

/** Loaded inside the SignNow iframe after Finish / Close. Notifies the CRM parent. */
export default function SignNowEmbeddedCompletePage() {
    useEffect(() => {
        const payload = { source: SIGNNOW_EMBEDDED_MESSAGE_SOURCE, event: "complete" };
        const target = window.opener ?? window.parent;
        if (target && target !== window) {
            try {
                target.postMessage(payload, window.location.origin);
            } catch {
                target.postMessage(payload, "*");
            }
        }
        if (window.opener) {
            window.close();
        }
    }, []);

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
                <p className="text-lg font-semibold text-slate-900">Review complete</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    Returning to Nitro Advance. Send via SignNow to email the merchant.
                </p>
            </div>
        </div>
    );
}
