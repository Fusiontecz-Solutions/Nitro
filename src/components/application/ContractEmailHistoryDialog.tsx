import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { axiosGet } from "@/redux/axios";
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
    status: string;
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

function errorMessage(error: unknown, fallback: string): string {
    const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (error as Error)?.message;
    return String(message || fallback);
}

/**
 * Every email this deal's contract sent — signing invites, resent links, CC
 * and agent copies, and the signed-contract notice — with the role each
 * recipient received it as.
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

    useEffect(() => {
        if (!open || !applicationId) return;
        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        axiosGet(`/applications/${encodeURIComponent(applicationId)}/contract-email-history`, {
            skipCache: true,
        })
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
    }, [open, applicationId, reloadKey]);

    const roleCounts = useMemo(() => {
        const counts = new Map<ContractEmailRole, number>();
        for (const row of rows) counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
        return counts;
    }, [rows]);

    const visible = roleFilter === "ALL" ? rows : rows.filter((r) => r.role === roleFilter);

    const chipClass = (active: boolean) =>
        `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            active
                ? "border-[#2563eb] bg-[#2563eb] text-white"
                : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        }`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-5xl dark:bg-slate-900 dark:text-slate-100">
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
                        className="ml-auto"
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
                                            {row.status && row.status !== "sent" ? (
                                                <div className="text-xs capitalize text-red-600 dark:text-red-400">
                                                    {row.status}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                            {row.subject || "—"}
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-400">
                                            {formatDateTimeUS(row.sentAt)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

export default ContractEmailHistoryDialog;
