import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { axiosGet, axiosPost } from "@/redux/axios";
import { Button } from "@/components/ui/button";

/**
 * Merchant signing portal for contracts emailed through SendGrid.
 *
 * The emailed link is token-authenticated (no CRM login). Clicking "Review &
 * Sign" in the email lands here and the SignNow session is minted immediately,
 * so the merchant goes straight into the document instead of pressing a second
 * "Review & Sign" button. The session is still minted on arrival rather than at
 * send time, so a link sitting in an inbox cannot carry an expired session.
 */

type PortalSummary = {
    envelopeId: string;
    email: string;
    status: string | null;
    sentAt: string | null;
    merchantName: string | null;
    funderName: string | null;
};

function messageFrom(error: unknown, fallback: string): string {
    const res = (error as { response?: { data?: { message?: string } } })?.response;
    return res?.data?.message || (error as Error)?.message || fallback;
}

export default function SigningPortalPage() {
    const { envelopeId = "" } = useParams<{ envelopeId: string }>();
    const [searchParams] = useSearchParams();
    const token = (searchParams.get("token") ?? "").trim();
    const email = (searchParams.get("email") ?? "").trim().toLowerCase();

    const justCompleted = (searchParams.get("completed") ?? "") === "1";

    const [summary, setSummary] = useState<PortalSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [signing, setSigning] = useState(!justCompleted);

    // StrictMode mounts effects twice in development; minting two SignNow
    // sessions for one click would invalidate the first one.
    const autoStarted = useRef(false);

    /**
     * SignNow returns here with `completed=1` after this signer finishes. Report
     * it so the next signer in order is emailed — signing is sequential, so the
     * following signer is only invited once this one is done.
     */
    useEffect(() => {
        if (!justCompleted || !token || !email) return;
        void (async () => {
            try {
                await axiosPost(
                    `/public/signing-portal/${encodeURIComponent(envelopeId)}/completed`,
                    { token, email },
                );
            } catch {
                // The next signer is also released when they (or CRM) reopen the
                // portal, so a failed callback does not strand the contract.
            }
        })();
    }, [justCompleted, envelopeId, token, email]);

    /**
     * Loaded only so the error screen can name the deal. It must not gate the
     * redirect — the merchant should not wait on it.
     */
    useEffect(() => {
        if (justCompleted || !token || !email) return;
        let cancelled = false;
        void (async () => {
            try {
                const res = await axiosGet(
                    `/public/signing-portal/${encodeURIComponent(envelopeId)}/summary`,
                    { params: { token, email } },
                );
                const data = (res as { data?: { data?: PortalSummary } })?.data?.data ?? null;
                if (!cancelled) setSummary(data);
            } catch {
                // The link mint below reports the real failure.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [justCompleted, envelopeId, token, email]);

    const startSigning = useCallback(async () => {
        setSigning(true);
        setError(null);
        try {
            if (!token || !email) {
                throw new Error(
                    "This signing link is incomplete. Please open it directly from your email.",
                );
            }
            const res = await axiosPost(
                `/public/signing-portal/${encodeURIComponent(envelopeId)}/link`,
                { token, email },
            );
            const url = String(
                (res as { data?: { data?: { url?: string } } })?.data?.data?.url ?? "",
            ).trim();
            if (!url) throw new Error("No signing session was returned. Please try again.");
            window.location.replace(url);
        } catch (err) {
            setError(messageFrom(err, "Unable to open the signing session."));
            setSigning(false);
        }
    }, [envelopeId, token, email]);

    // Go straight into SignNow on arrival from the email.
    useEffect(() => {
        if (justCompleted || autoStarted.current) return;
        autoStarted.current = true;
        void startSigning();
    }, [justCompleted, startSigning]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
            <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm">
                {justCompleted ? (
                    <div className="space-y-3 text-center">
                        <h1 className="text-lg font-semibold text-slate-900">
                            Thank you — your signature is recorded
                        </h1>
                        <p className="text-sm leading-relaxed text-slate-600">
                            Nothing else is needed from you. If another signer is on this
                            agreement, we have just emailed them their link.
                        </p>
                        <p className="text-xs text-slate-500">
                            You can close this page.
                        </p>
                    </div>
                ) : error ? (
                    <div className="space-y-4 text-center">
                        <h1 className="text-lg font-semibold text-slate-900">
                            This link can&apos;t be opened
                        </h1>
                        {summary?.merchantName ? (
                            <p className="text-sm text-slate-600">{summary.merchantName}</p>
                        ) : null}
                        <p className="text-sm leading-relaxed text-slate-600">{error}</p>
                        <Button
                            type="button"
                            onClick={() => void startSigning()}
                            disabled={signing}
                            className="w-full"
                        >
                            Try again
                        </Button>
                        <p className="text-xs text-slate-500">
                            If this keeps happening, reply to the email you received and ask
                            for a new signing link.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4 text-center">
                        <div className="flex items-center justify-center gap-2 text-slate-600">
                            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                            <span>Opening your agreement in SignNow…</span>
                        </div>
                        {summary?.merchantName ? (
                            <p className="text-sm text-slate-600">{summary.merchantName}</p>
                        ) : null}
                        <p className="text-xs text-slate-500">
                            Signing as {summary?.email || email}. Please don&apos;t close this
                            window.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
