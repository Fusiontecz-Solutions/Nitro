import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/context/ThemeContext";
import type { AppDispatch, RootState } from "@/redux/store";
import { getIsos } from "@/redux/actions/isoActions";
import { updateApplication } from "@/redux/actions/applicationActions";
import { toast } from "react-toastify";
import { Building2, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

type AgentDealIsoTagProps = {
    applicationId?: string | null;
};

/**
 * Agent-only: tag an ISO on the current deal when none is set.
 * Compact strip above Business Profile on application detail.
 */
export default function AgentDealIsoTag({ applicationId }: AgentDealIsoTagProps) {
    const dispatch = useDispatch<AppDispatch>();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const { loading: fetchLoading, data: applicationData } = useSelector(
        (state: RootState) => state.applicationDetail,
    );

    const normalizedApplicationId =
        applicationId === null || applicationId === undefined ? null : String(applicationId);

    const dataApplicationId = (applicationData as { applicationId?: unknown })?.applicationId;
    const dataId = (applicationData as { _id?: unknown })?._id;

    const appIdMatch =
        !normalizedApplicationId || !applicationData
            ? true
            : String(dataId ?? "") === normalizedApplicationId ||
              String(dataApplicationId ?? "") === normalizedApplicationId;

    const showDynamicData = appIdMatch && Boolean(applicationData);

    const hasIso = useMemo(() => {
        if (!showDynamicData || !applicationData) return false;
        const row = applicationData as unknown as Record<string, unknown>;
        const iso = row.iso as Record<string, unknown> | null | undefined;
        const isoIdRaw = row.isoId;
        const isoTagged =
            iso &&
            typeof iso === "object" &&
            Boolean(
                (typeof iso.name === "string" && iso.name.trim()) ||
                    (typeof iso.email === "string" && iso.email.trim()) ||
                    iso.id ||
                    iso._id,
            );
        const rawId =
            isoIdRaw != null && String(isoIdRaw).trim() !== "" ? String(isoIdRaw).trim() : "";
        return isoTagged || rawId.length > 0;
    }, [showDynamicData, applicationData]);

    const appRow = applicationData as unknown as Record<string, unknown> | null;
    const targetApplicationId = String(
        normalizedApplicationId ||
            (appRow?.id as string | undefined) ||
            (appRow?._id as string | undefined) ||
            (appRow != null && appRow.applicationId != null
                ? String(appRow.applicationId)
                : "") ||
            "",
    );

    const { list: isoList, listLoading: isoListLoading, listError: isoListError } = useSelector(
        (state: RootState) => state.iso,
    );
    const [taggingIso, setTaggingIso] = useState(false);
    const taggingIsoRef = useRef(false);

    useEffect(() => {
        if (!showDynamicData || hasIso) return;
        void dispatch(getIsos());
    }, [dispatch, hasIso, showDynamicData]);

    const sortedIsos = useMemo(() => {
        return [...isoList].sort((a, b) =>
            String(a.name || "").localeCompare(String(b.name || ""), undefined, {
                sensitivity: "base",
            }),
        );
    }, [isoList]);

    const handleAgentPickIso = useCallback(
        async (isoId: string) => {
            if (!isoId?.trim() || !targetApplicationId) return;
            if (taggingIsoRef.current) return;
            taggingIsoRef.current = true;
            setTaggingIso(true);
            try {
                await dispatch(
                    updateApplication({
                        id: targetApplicationId,
                        data: { isoId: isoId.trim() },
                    }),
                ).unwrap();
                toast.success("ISO linked to this deal.");
            } catch (err: unknown) {
                const msg =
                    typeof err === "string"
                        ? err
                        : err && typeof err === "object" && "message" in err
                          ? String((err as { message?: string }).message)
                          : "Failed to tag ISO";
                toast.error(msg || "Failed to tag ISO");
            } finally {
                taggingIsoRef.current = false;
                setTaggingIso(false);
            }
        },
        [dispatch, targetApplicationId],
    );

    const linkedIso = useMemo(() => {
        if (!showDynamicData || !applicationData) return { name: "", email: "" };
        const row = applicationData as unknown as Record<string, unknown>;
        if (!row.iso || typeof row.iso !== "object") return { name: "", email: "" };
        const iso = row.iso as Record<string, unknown>;
        const name = typeof iso.name === "string" ? iso.name.trim() : "";
        const email = typeof iso.email === "string" ? iso.email.trim() : "";
        return { name, email };
    }, [applicationData, showDynamicData]);

    if (!showDynamicData) return null;

    const shell = cn(
        "mb-6 flex flex-col gap-3 rounded-xl border p-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4",
        isDark
            ? "border-white/10 bg-gradient-to-br from-zinc-900/90 to-zinc-950/95 ring-1 ring-white/5"
            : "border-slate-200/90 bg-gradient-to-br from-white via-slate-50/80 to-slate-100/40 ring-1 ring-slate-900/[0.04]",
    );

    const iconWrap = (tone: "linked" | "link") =>
        cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            tone === "linked"
                ? isDark
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-emerald-500/[0.12] text-emerald-700"
                : isDark
                  ? "bg-sky-500/15 text-sky-400"
                  : "bg-sky-500/[0.12] text-sky-700",
        );

    return (
        <div className={shell}>
            {fetchLoading ? (
                <div className="flex w-full items-center gap-3">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
                    <Skeleton className="h-9 flex-1 max-w-md rounded-lg" />
                </div>
            ) : hasIso ? (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className={iconWrap("linked")}>
                        <Building2 className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p
                            className={cn(
                                "text-[11px] font-semibold uppercase tracking-[0.14em]",
                                isDark ? "text-zinc-500" : "text-slate-500",
                            )}
                        >
                            ISO
                        </p>
                        <p
                            className={cn(
                                "truncate text-sm font-semibold leading-tight",
                                isDark ? "text-zinc-100" : "text-slate-900",
                            )}
                        >
                            {linkedIso.name || linkedIso.email || "Linked"}
                        </p>
                        {linkedIso.name && linkedIso.email ? (
                            <p
                                className={cn(
                                    "truncate text-xs leading-snug",
                                    isDark ? "text-zinc-400" : "text-slate-600",
                                )}
                            >
                                {linkedIso.email}
                            </p>
                        ) : null}
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                        <div className={iconWrap("link")}>
                            <Link2 className="h-5 w-5" aria-hidden />
                        </div>
                        <div className="min-w-0 pt-0.5 sm:pt-0">
                            <p
                                className={cn(
                                    "text-sm font-semibold leading-tight",
                                    isDark ? "text-zinc-100" : "text-slate-900",
                                )}
                            >
                                Link ISO
                            </p>
                            <p
                                className={cn(
                                    "mt-0.5 text-xs leading-snug",
                                    isDark ? "text-zinc-500" : "text-slate-600",
                                )}
                            >
                                Attach an independent sales org to this deal.
                            </p>
                        </div>
                    </div>
                    <div className="w-full shrink-0 sm:w-[min(100%,18rem)]">
                        {isoListError ? (
                            <p className="text-xs text-destructive">{isoListError}</p>
                        ) : sortedIsos.length === 0 && !isoListLoading ? (
                            <p
                                className={cn(
                                    "text-xs",
                                    isDark ? "text-zinc-500" : "text-muted-foreground",
                                )}
                            >
                                No ISOs in the system yet.
                            </p>
                        ) : (
                            <Select
                                disabled={
                                    taggingIso ||
                                    !targetApplicationId ||
                                    (isoListLoading && sortedIsos.length === 0)
                                }
                                onValueChange={(v: string) => void handleAgentPickIso(v)}
                            >
                                <SelectTrigger
                                    size="sm"
                                    className={cn(
                                        "h-9 w-full rounded-lg border font-medium shadow-none transition-colors",
                                        isDark
                                            ? "border-white/10 bg-zinc-900/80 hover:bg-zinc-900"
                                            : "border-slate-200 bg-white hover:bg-slate-50",
                                    )}
                                >
                                    <SelectValue
                                        placeholder={
                                            isoListLoading && sortedIsos.length === 0
                                                ? "Loading…"
                                                : "Choose ISO…"
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent className="z-[10060] max-h-72 rounded-lg">
                                    {sortedIsos.map((iso) => (
                                        <SelectItem key={iso.id} value={iso.id}>
                                            {iso.name}
                                            {iso.email ? ` — ${iso.email}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {taggingIso ? (
                            <p
                                className={cn(
                                    "mt-1.5 text-[11px]",
                                    isDark ? "text-zinc-500" : "text-muted-foreground",
                                )}
                            >
                                Saving…
                            </p>
                        ) : null}
                    </div>
                </>
            )}
        </div>
    );
}
