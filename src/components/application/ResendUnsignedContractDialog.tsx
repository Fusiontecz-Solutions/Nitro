import { useEffect, useState } from "react";
import { toast } from "react-toastify";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { axiosGet, axiosPost } from "@/redux/axios";
import { formatDateTimeUS } from "@/lib/utils";

type PortalRecipient = {
    email: string;
    name: string | null;
    role: string | null;
    emailedAt: string | null;
    completedAt: string | null;
    remindedAt: string | null;
};

type Row = PortalRecipient & { newEmail: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorMessage(error: unknown, fallback: string): string {
    const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (error as Error)?.message;
    return String(message || fallback);
}

/**
 * Resend the SAME unsigned contract — the package already on the deal, with
 * every value on it — to its signers, optionally correcting a signer's email.
 * Unlike "Resend new contract" nothing is rebuilt, archived or cleared.
 */
export function ResendUnsignedContractDialog({
    open,
    onOpenChange,
    envelopeId,
    contractLabel,
    onResent,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    envelopeId: string;
    contractLabel?: string;
    onResent?: () => void;
}) {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open || !envelopeId) return;
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        axiosGet(
            `/docusign/contract-portal-recipients?envelopeId=${encodeURIComponent(envelopeId)}`,
            { skipCache: true },
        )
            .then((res) => {
                if (cancelled) return;
                const list = (res?.data?.data?.recipients ?? []) as PortalRecipient[];
                setRows(list.map((r) => ({ ...r, newEmail: r.email })));
            })
            .catch((error) => {
                if (cancelled) return;
                setRows([]);
                setLoadError(errorMessage(error, "Could not load the signers of this contract."));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, envelopeId]);

    const changes = rows
        .filter((r) => !r.completedAt)
        .map((r) => ({ email: r.email, newEmail: r.newEmail.trim().toLowerCase() }))
        .filter((c) => c.newEmail && c.newEmail !== c.email);
    const invalid = rows.some((r) => !r.completedAt && !EMAIL_PATTERN.test(r.newEmail.trim()));
    const allSigned = rows.length > 0 && rows.every((r) => r.completedAt);

    const submit = async () => {
        if (invalid) {
            toast.error("Enter a valid email address for every signer.");
            return;
        }
        setSubmitting(true);
        try {
            const res = await axiosPost(
                "/docusign/resend-contract-portal",
                { envelopeId, recipientChanges: changes },
                { timeout: 60_000 },
            );
            const data = res?.data?.data as
                | { queued?: boolean; result?: { emailed?: string[] } }
                | undefined;
            if (data?.queued) {
                // A signer change finishes on the server; the outcome arrives as
                // a toast (PortalSendResultListener).
                toast.info(
                    "Updating the signer — the new address gets the signing link in a moment.",
                );
            } else {
                const to = (data?.result?.emailed ?? []).join(", ");
                toast.success(to ? `Signing link resent to ${to}.` : "Signing link resent.");
            }
            onResent?.();
            onOpenChange(false);
        } catch (error) {
            toast.error(errorMessage(error, "Could not resend the contract."));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(next: boolean) => !submitting && onOpenChange(next)}>
            <DialogContent className="sm:max-w-lg dark:bg-slate-900 dark:text-slate-100">
                <DialogHeader>
                    <DialogTitle>Resend unsigned contract</DialogTitle>
                    <DialogDescription>
                        Emails the signing link for {contractLabel ? `"${contractLabel}"` : "this contract"}{" "}
                        again. The same contract and all of its values are kept. Change an email
                        below to send it to a different address; the old address's link stops
                        working.
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading signers…
                    </div>
                ) : loadError ? (
                    <p className="py-4 text-sm text-red-600 dark:text-red-400">{loadError}</p>
                ) : (
                    <div className="space-y-3 py-2">
                        {rows.map((row, index) => (
                            <div
                                key={row.email}
                                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                            >
                                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                                    <span className="font-semibold uppercase tracking-wide">
                                        {row.name || row.role || `Signer ${index + 1}`}
                                    </span>
                                    {row.completedAt ? (
                                        <span className="inline-flex items-center gap-1 text-emerald-600">
                                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Signed
                                        </span>
                                    ) : row.remindedAt || row.emailedAt ? (
                                        <span>
                                            Last emailed{" "}
                                            {formatDateTimeUS(row.remindedAt || row.emailedAt || "")}
                                        </span>
                                    ) : (
                                        <span>Not emailed yet</span>
                                    )}
                                </div>
                                <Input
                                    type="email"
                                    value={row.newEmail}
                                    disabled={Boolean(row.completedAt) || submitting}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        setRows((prev) =>
                                            prev.map((r, i) => (i === index ? { ...r, newEmail: value } : r)),
                                        );
                                    }}
                                    aria-label={`Email for ${row.name || `signer ${index + 1}`}`}
                                />
                                {row.newEmail.trim().toLowerCase() !== row.email && !row.completedAt ? (
                                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                                        Was {row.email}
                                    </p>
                                ) : null}
                            </div>
                        ))}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void submit()}
                        disabled={submitting || loading || Boolean(loadError) || allSigned || !rows.length}
                    >
                        {submitting
                            ? "Resending…"
                            : changes.length
                              ? "Update signer & resend"
                              : "Resend signing link"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default ResendUnsignedContractDialog;
