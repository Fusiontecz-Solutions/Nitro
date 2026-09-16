import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Loader2 } from "lucide-react";
import { axiosGet, axiosPost } from "@/redux/axios";
import { Button } from "@/components/ui/button";

/**
 * Merchant signing portal for contracts emailed through SendGrid.
 *
 * The emailed link is token-authenticated (no CRM login). The SignNow signing
 * session is minted when the merchant clicks Review & Sign, not at send time, so
 * a link sitting in an inbox cannot carry an already-expired SignNow session.
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
    const [loading, setLoading] = useState(true);
    const [signing, setSigning] = useState(false);

    /**
     * SignNow returns here with `completed=1` after this signer finishes. Report
     * it so the next signer in order is emailed — signing is sequential, so the
     * following signer is only invited once this one is done.
     */
    useEffect(() => {
        if (!justCompleted || !token || !email) return;
        let cancelled = false;
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
            if (cancelled) return;
        })();
        return () => {
            cancelled = true;
        };
    }, [justCompleted, envelopeId, token, email]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                if (!token || !email) {
                    throw new Error(
                        "This signing link is incomplete. Please open it directly from your email.",
                    );
                }
                const res = await axiosGet(
                    `/public/signing-portal/${encodeURIComponent(envelopeId)}/summary`,
                    { params: { token, email } },
                );
                const data = (res as { data?: { data?: PortalSummary } })?.data?.data ?? null;
                if (!cancelled) setSummary(data);
            } catch (err) {
                if (!cancelled) setError(messageFrom(err, "Unable to open this signing link."));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [envelopeId, token, email]);

    const startSigning = useCallback(async () => {
        setSigning(true);
        setError(null);
        try {
            const res = await axiosPost(
                `/public/signing-portal/${encodeURIComponent(envelopeId)}/link`,
                { token, email },
            );
            const url = String(
                (res as { data?: { data?: { url?: string } } })?.data?.data?.url ?? "",
            ).trim();
            if (!url) throw new Error("No signing session was returned. Please try again.");
            window.location.href = url;
        } catch (err) {
            setError(messageFrom(err, "Unable to open the signing session."));
            setSigning(false);
        }
    }, [envelopeId, token, email]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
            <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-slate-600">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        <span>Loading your contract…</span>
                    </div>
                ) : error ? (
                    <div className="space-y-3 text-center">
                        <h1 className="text-lg font-semibold text-slate-900">
                            This link can&apos;t be opened
                        </h1>
                        <p className="text-sm leading-relaxed text-slate-600">{error}</p>
                        <p className="text-xs text-slate-500">
                            Reply to the email you received and ask for a new signing link.
                        </p>
                    </div>
                ) : justCompleted ? (
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
                ) : (
                    <div className="space-y-5">
                        <div className="space-y-1">
                            <h1 className="text-xl font-semibold text-slate-900">
                                Your agreement is ready to sign
                            </h1>
                            {summary?.merchantName ? (
                                <p className="text-sm text-slate-600">{summary.merchantName}</p>
                            ) : null}
                            {summary?.funderName ? (
                                <p className="text-sm text-slate-500">with {summary.funderName}</p>
                            ) : null}
                        </div>
                        <p className="text-sm leading-relaxed text-slate-600">
                            Signing opens securely in SignNow. You only need to review and sign —
                            your details are already filled in.
                        </p>
                        <Button
                            type="button"
                            onClick={() => void startSigning()}
                            disabled={signing}
                            className="w-full"
                        >
                            {signing ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                                    Opening…
                                </>
                            ) : (
                                "Review & Sign"
                            )}
                        </Button>
                        <p className="text-center text-xs text-slate-500">
                            Signing as {summary?.email || email}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
