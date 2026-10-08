import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "react-toastify";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { axiosGet, axiosPost } from "@/redux/axios";
import { formatDateTimeUS } from "@/lib/utils";

type ContractEmailRole = "SIGNER" | "CC" | "AGENT" | "FUNDER_CC" | "CONTRACTS_INBOX" | "SENDER";

type ContractEmailKind =
    | "signing_invite"
    | "signing_reminder"
    | "cc_copy"
    | "agent_sent_notice"
    | "signed_copy";

type ContractEmailHistoryRow = {
    id: string;
    sentAt: string;
    email: string;
    role: ContractEmailRole;
    roleDetail: string | null;
    name: string | null;
    kind: ContractEmailKind;
    subject: string;
    /** SendGrid delivery status for tracked mail, else `sent` / `failed`. */
    status: string;
    groupId: string | null;
    outboundId: string | null;
    provider: string | null;
    tracked: boolean;
    canView: boolean;
    canResend: boolean;
    deliveredAt: string | null;
    openedAt: string | null;
    openCount: number;
    failureReason: string | null;
    resendOf: string | null;
};

type ContractEmailContent = {
    id: string;
    email: string;
    subject: string;
    sentAt: string;
    status: string;
    from: string | null;
    html: string;
    attachments: string[];
};

const ROLE_LABEL: Record<ContractEmailRole, string> = {
    SIGNER: "Merchant signer",
    CC: "CC",
    AGENT: "Agent",
    FUNDER_CC: "Funder CC",
    CONTRACTS_INBOX: "Contracts inbox",
    SENDER: "Sender",
};

const ROLE_CLASS: Record<ContractEmailRole, string> = {
    SIGNER: "bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
    CC: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    AGENT: "bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
    FUNDER_CC: "bg-amber-50 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    CONTRACTS_INBOX: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    SENDER: "bg-cyan-50 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-200",
};

const KIND_LABEL: Record<ContractEmailKind, string> = {
    signing_invite: "Signing invite",
    signing_reminder: "Signing link resent",
    cc_copy: "Contract copy",
    agent_sent_notice: "Contract sent notice",
    signed_copy: "Signed contract",
};

const STATUS_LABEL: Record<string, string> = {
    sending: "Sending",
    sent: "Sent",
    delivered: "Delivered",
    opened: "Opened",
    clicked: "Clicked",
    deferred: "Deferred",
    failed: "Failed",
    bounced: "Bounced",
    dropped: "Dropped",
    spam: "Spam",
    unsubscribed: "Unsubscribed",
};

function statusClass(status: string): string {
    switch (status) {
        case "delivered":
            return "bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200";
        case "opened":
            return "bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200";
        case "clicked":
            return "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200";
        case "failed":
        case "bounced":
        case "dropped":
            return "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-200";
        case "spam":
            return "bg-orange-50 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200";
        case "deferred":
        case "sending":
            return "bg-amber-50 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
        default:
            return "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200";
    }
}

/** Hover text for the status badge: the delivery timeline, or why there is none. */
function statusTitle(row: ContractEmailHistoryRow): string {
    if (!row.tracked) {
        return row.provider === "signnow"
            ? "Sent by SignNow — delivery is not tracked here."
            : "Sent before delivery tracking was added.";
    }
    const lines: string[] = [];
    if (row.deliveredAt) lines.push(`Delivered ${formatDateTimeUS(row.deliveredAt)}`);
    if (row.openedAt) {
        lines.push(
            `Opened ${formatDateTimeUS(row.openedAt)}${row.openCount > 1 ? ` (${row.openCount} times)` : ""}`,
        );
    }
    if (row.failureReason) lines.push(row.failureReason);
    return lines.join("\n") || "Waiting for delivery events from SendGrid.";
}

function resendDisabledReason(row: ContractEmailHistoryRow): string {
    if (row.provider === "signnow") return "SignNow sent this invite — use Resend on the contract.";
    return "Sent before resending was available, so its content was not kept.";
}

/** Delivery status arrives by SendGrid webhook; refresh quietly while open. */
const POLL_MS = 15_000;

function errorMessage(error: unknown, fallback: string): string {
    const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (error as Error)?.message;
    return String(message || fallback);
}

/**
 * Every email this deal's contract sent — signing invites, resent links, CC
 * and agent copies, and the signed-contract notice — with the role each
 * recipient received it as, its delivery status, and View / Resend actions.
 */
export function ContractEmailHistoryDialog({
    open,
    onOpenChange,
    applicationId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    applicationId: string;
}) {
    const [rows, setRows] = useState<ContractEmailHistoryRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [roleFilter, setRoleFilter] = useState<ContractEmailRole | "ALL">("ALL");
    const [reloadKey, setReloadKey] = useState(0);
    const [resendingId, setResendingId] = useState<string | null>(null);
    const [viewing, setViewing] = useState<ContractEmailHistoryRow | null>(null);
    const [content, setContent] = useState<ContractEmailContent | null>(null);
    const [contentLoading, setContentLoading] = useState(false);
    const [contentError, setContentError] = useState<string | null>(null);

    const historyUrl = `/applications/${encodeURIComponent(applicationId)}/contract-email-history`;

    useEffect(() => {
        if (!open || !applicationId) return;
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        axiosGet(historyUrl, { skipCache: true })
            .then((res) => {
                if (cancelled) return;
                setRows((res?.data?.data ?? []) as ContractEmailHistoryRow[]);
            })
            .catch((error) => {
                if (cancelled) return;
                setRows([]);
                setLoadError(errorMessage(error, "Could not load the contract email history."));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, applicationId, historyUrl, reloadKey]);

    // Delivered / opened updates show up without clicking Refresh.
    useEffect(() => {
        if (!open || !applicationId) return;
        const timer = window.setInterval(() => {
            axiosGet(historyUrl, { skipCache: true })
                .then((res) => setRows((res?.data?.data ?? []) as ContractEmailHistoryRow[]))
                .catch(() => undefined);
        }, POLL_MS);
        return () => window.clearInterval(timer);
    }, [open, applicationId, historyUrl]);

    useEffect(() => {
        if (!viewing?.outboundId) return;
        let cancelled = false;
        setContent(null);
        setContentError(null);
        setContentLoading(true);
        axiosGet(`${historyUrl}/${encodeURIComponent(viewing.outboundId)}/content`, { skipCache: true })
            .then((res) => {
                if (!cancelled) setContent((res?.data?.data ?? null) as ContractEmailContent | null);
            })
            .catch((error) => {
                if (!cancelled) setContentError(errorMessage(error, "Could not load this email."));
            })
            .finally(() => {
                if (!cancelled) setContentLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [viewing, historyUrl]);

    const resend = useCallback(
        async (row: ContractEmailHistoryRow) => {
            const what = KIND_LABEL[row.kind] ?? "this email";
            if (!window.confirm(`Resend "${what}" to ${row.email}?`)) return;
            setResendingId(row.id);
            try {
                await axiosPost(`${historyUrl}/${encodeURIComponent(row.id)}/resend`);
                toast.success(`Email resent to ${row.email}`);
                setReloadKey((k) => k + 1);
            } catch (error) {
                toast.error(errorMessage(error, "Could not resend the email."));
            } finally {
                setResendingId(null);
            }
        },
        [historyUrl],
    );

    const roleCounts = useMemo(() => {
        const counts = new Map<ContractEmailRole, number>();
        for (const row of rows) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
        return counts;
    }, [rows]);

    const visible = roleFilter === "ALL" ? rows : rows.filter((r) => r.role === roleFilter);

    const chipClass = (active: boolean) =>
        `cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            active
                ? "border-[#2563eb] bg-[#2563eb] text-white"
                : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        }`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-6xl dark:bg-slate-900 dark:text-slate-100">
                <DialogHeader>
                    <DialogTitle>Contract email recipients</DialogTitle>
                    <DialogDescription>
                        Every email sent for this contract, newest first, with the role each
                        recipient received it as.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        className={chipClass(roleFilter === "ALL")}
                        onClick={() => setRoleFilter("ALL")}
                    >
                        All ({rows.length})
                    </button>
                    {(Object.keys(ROLE_LABEL) as ContractEmailRole[])
                        .filter((role) => roleCounts.has(role))
                        .map((role) => (
                            <button
                                key={role}
                                type="button"
                                className={chipClass(roleFilter === role)}
                                onClick={() => setRoleFilter(role)}
                            >
                                {ROLE_LABEL[role]} ({roleCounts.get(role)})
                            </button>
                        ))}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto cursor-pointer"
                        onClick={() => setReloadKey((k) => k + 1)}
                        disabled={loading}
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
                        Refresh
                    </Button>
                </div>

                {loading && !rows.length ? (
                    <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading email history…
                    </div>
                ) : loadError ? (
                    <p className="py-6 text-sm text-red-600 dark:text-red-400">{loadError}</p>
                ) : !visible.length ? (
                    <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        No contract emails recorded yet.
                    </p>
                ) : (
                    <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                <tr>
                                    <th className="px-3 py-2 font-semibold">Recipient</th>
                                    <th className="px-3 py-2 font-semibold">Role</th>
                                    <th className="px-3 py-2 font-semibold">Email</th>
                                    <th className="px-3 py-2 font-semibold">Subject</th>
                                    <th className="whitespace-nowrap px-3 py-2 font-semibold">Sent</th>
                                    <th className="px-3 py-2 font-semibold">Status</th>
                                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {visible.map((row) => (
                                    <tr key={row.id} className="align-top">
                                        <td className="px-3 py-2">
                                            <div className="break-all font-medium">{row.email}</div>
                                            {row.name ? (
                                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                                    {row.name}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_CLASS[row.role] ?? ROLE_CLASS.CC}`}
                                            >
                                                {ROLE_LABEL[row.role] ?? row.role}
                                            </span>
                                            {row.roleDetail ? (
                                                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                                    {row.roleDetail}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2">
                                            {KIND_LABEL[row.kind] ?? row.kind}
                                            {row.resendOf ? (
                                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                                    Resent
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                            {row.subject || "—"}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-400">
                                            {formatDateTimeUS(row.sentAt)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                title={statusTitle(row)}
                                                className={`inline-block cursor-default whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(row.status)}`}
                                            >
                                                {STATUS_LABEL[row.status] ?? row.status}
                                            </span>
                                            {!row.tracked ? (
                                                <div className="mt-0.5 whitespace-nowrap text-xs text-slate-400">
                                                    Not tracked
                                                </div>
                                            ) : row.failureReason ? (
                                                <div
                                                    className="mt-0.5 max-w-[12rem] truncate text-xs text-red-600 dark:text-red-400"
                                                    title={row.failureReason}
                                                >
                                                    {row.failureReason}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 cursor-pointer px-2"
                                                    disabled={!row.canView}
                                                    title={
                                                        row.canView
                                                            ? "View the email that was sent"
                                                            : "The content of this email was not kept."
                                                    }
                                                    onClick={() => setViewing(row)}
                                                >
                                                    <Eye className="h-4 w-4" aria-hidden />
                                                    <span className="sr-only">View</span>
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 cursor-pointer px-2"
                                                    disabled={!row.canResend || resendingId !== null}
                                                    title={row.canResend ? "Resend this email" : resendDisabledReason(row)}
                                                    onClick={() => void resend(row)}
                                                >
                                                    {resendingId === row.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                                    ) : (
                                                        <Send className="h-4 w-4" aria-hidden />
                                                    )}
                                                    Resend
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </DialogContent>

            <Dialog open={viewing !== null} onOpenChange={(next: boolean) => !next && setViewing(null)}>
                {/* Transparent overlay: the history dialog's overlay already dims the
                    CRM, and a second one stacked on it turned the page black. */}
                <DialogContent
                    overlayClassName="z-[10002] bg-transparent dark:bg-transparent"
                    className="z-[10003] flex h-[92vh] w-[96vw] max-w-[96vw] flex-col sm:max-w-7xl dark:bg-slate-900 dark:text-slate-100"
                >
                    <DialogHeader>
                        <DialogTitle>{content?.subject || viewing?.subject || "Email"}</DialogTitle>
                        <DialogDescription>
                            {viewing
                                ? `${KIND_LABEL[viewing.kind] ?? viewing.kind} sent to ${viewing.email}`
                                : null}
                        </DialogDescription>
                    </DialogHeader>
                    {contentLoading ? (
                        <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading email…
                        </div>
                    ) : contentError ? (
                        <p className="py-6 text-sm text-red-600 dark:text-red-400">{contentError}</p>
                    ) : content ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-3">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                                {content.from ? (
                                    <>
                                        <dt className="text-slate-500 dark:text-slate-400">From</dt>
                                        <dd className="break-all">{content.from}</dd>
                                    </>
                                ) : null}
                                <dt className="text-slate-500 dark:text-slate-400">To</dt>
                                <dd className="break-all">{content.email}</dd>
                                <dt className="text-slate-500 dark:text-slate-400">Sent</dt>
                                <dd>{formatDateTimeUS(content.sentAt)}</dd>
                                {content.attachments.length ? (
                                    <>
                                        <dt className="text-slate-500 dark:text-slate-400">Attachment</dt>
                                        <dd className="break-all">{content.attachments.join(", ")}</dd>
                                    </>
                                ) : null}
                            </dl>
                            {/* Sandboxed: the stored HTML is displayed, never run. */}
                            <iframe
                                title="Email content"
                                sandbox=""
                                srcDoc={content.html}
                                className="min-h-0 w-full flex-1 rounded-lg border border-slate-200 bg-white dark:border-slate-700"
                            />
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}

export default ContractEmailHistoryDialog;
