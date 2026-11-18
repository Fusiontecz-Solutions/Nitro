import { useCallback, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AutoCreatePdfBundle = {
    /** One or more PDFs/images selected together (application + DL + voided check). */
    files: File[];
};

type GuessedKind = "application" | "driverLicense" | "voidedCheck" | "other";

type AutoCreateFromPdfPanelProps = {
    isDark?: boolean;
    loading?: boolean;
    onSubmit: (bundle: AutoCreatePdfBundle) => void | Promise<void>;
};

function isAllowedFile(file: File): boolean {
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    return (
        type.includes("pdf") ||
        type.includes("jpeg") ||
        type.includes("jpg") ||
        type.includes("png") ||
        name.endsWith(".pdf") ||
        name.endsWith(".jpg") ||
        name.endsWith(".jpeg") ||
        name.endsWith(".png")
    );
}

function guessKind(file: File): GuessedKind {
    const base = file.name.toLowerCase().replace(/\.[^.]+$/, "");
    if (
        /\bvoid(?:ed)?\b/.test(base) ||
        /\bcheck\b/.test(base) ||
        /\bach\b/.test(base) ||
        /\bbank\b/.test(base)
    ) {
        return "voidedCheck";
    }
    if (
        /\bdl\b/.test(base) ||
        /\bdriver'?s?\b/.test(base) ||
        /\blicen[cs]e\b/.test(base) ||
        /\bstate[_\s-]?id\b/.test(base)
    ) {
        return "driverLicense";
    }
    if (
        /\bapplication\b/.test(base) ||
        /\bfunding\b/.test(base) ||
        /\bnitro\b/.test(base) ||
        /\badvance\b/.test(base) ||
        /\bmca\b/.test(base) ||
        /\bloan\b/.test(base) ||
        file.name.toLowerCase().endsWith(".pdf")
    ) {
        return "application";
    }
    return "other";
}

function kindLabel(kind: GuessedKind): string {
    switch (kind) {
        case "application":
            return "Application";
        case "driverLicense":
            return "Driver's license";
        case "voidedCheck":
            return "Voided check";
        default:
            return "Document";
    }
}

function kindBadgeClass(kind: GuessedKind): string {
    switch (kind) {
        case "application":
            return "bg-sky-100 text-sky-800";
        case "driverLicense":
            return "bg-amber-100 text-amber-800";
        case "voidedCheck":
            return "bg-violet-100 text-violet-800";
        default:
            return "bg-slate-100 text-slate-700";
    }
}

function formatBytes(size: number): string {
    if (!size || size < 1024) return `${size || 0} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AutoCreateFromPdfPanel({
    isDark = false,
    loading = false,
    onSubmit,
}: AutoCreateFromPdfPanelProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const rows = useMemo(
        () => files.map((file) => ({ file, kind: guessKind(file) })),
        [files],
    );

    const addFiles = useCallback((incoming: FileList | File[] | null | undefined) => {
        if (!incoming || !incoming.length) return;
        const next = Array.from(incoming).filter(isAllowedFile);
        if (!next.length) {
            setError("Please select PDF, JPG, or PNG files");
            return;
        }
        setError(null);
        setFiles((prev) => {
            const seen = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
            const merged = [...prev];
            for (const file of next) {
                const key = `${file.name}:${file.size}:${file.lastModified}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(file);
            }
            return merged;
        });
    }, []);

    const removeAt = useCallback((index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const handleSubmit = useCallback(async () => {
        if (!files.length) {
            setError("Select one or more PDFs (application, driver license, voided check)");
            return;
        }
        const hasPdf = files.some(
            (f) =>
                f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
        );
        if (!hasPdf) {
            setError("Include at least one application PDF in the selection");
            return;
        }
        setError(null);
        await onSubmit({ files });
    }, [files, onSubmit]);

    return (
        <section
            className={cn(
                "space-y-3 rounded-lg border p-4",
                isDark
                    ? "border-[#374151] bg-[#1a1b1e]"
                    : "border-slate-200 bg-slate-50",
            )}
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3
                        className={cn(
                            "text-sm font-semibold uppercase tracking-wide",
                            isDark ? "text-slate-100" : "text-slate-800",
                        )}
                    >
                        Auto-create from PDFs
                    </h3>
                    <p
                        className={cn(
                            "text-[11px]",
                            isDark ? "text-slate-400" : "text-slate-500",
                        )}
                    >
                        Select all PDFs once — application, driver&apos;s licenses, and voided
                        check. We classify each file and map owners automatically.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className="h-9 whitespace-nowrap gap-2 border border-[var(--brand)] text-[var(--brand)] bg-transparent hover:bg-transparent hover:text-[var(--brand)]/90"
                    onClick={() => void handleSubmit()}
                    disabled={loading || files.length === 0}
                >
                    {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <FileText className="h-4 w-4" />
                    )}
                    {loading
                        ? "Extracting…"
                        : files.length > 0
                          ? `Auto-Create (${files.length} files)`
                          : "Auto-Create from PDF"}
                </Button>
            </div>

            <input
                ref={inputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                className="hidden"
                onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                }}
            />

            <div
                role="button"
                tabIndex={loading ? -1 : 0}
                onClick={() => {
                    if (loading) return;
                    inputRef.current?.click();
                }}
                onKeyDown={(e) => {
                    if (loading) return;
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        inputRef.current?.click();
                    }
                }}
                onDragOver={(e) => {
                    if (loading) return;
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    if (loading) return;
                    e.preventDefault();
                    setDragOver(false);
                    addFiles(e.dataTransfer.files);
                }}
                className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition-colors",
                    dragOver
                        ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200"
                        : isDark
                          ? "border-slate-600 bg-[#141517] hover:border-[var(--brand)]/60"
                          : "border-slate-300 bg-white hover:border-[var(--brand)]/60 hover:bg-slate-50",
                    loading && "pointer-events-none opacity-70",
                )}
            >
                <span
                    className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full",
                        isDark ? "bg-sky-950 text-sky-300" : "bg-sky-100 text-sky-700",
                    )}
                >
                    <UploadCloud className="h-5 w-5" />
                </span>
                <div>
                    <p
                        className={cn(
                            "text-sm font-medium",
                            isDark ? "text-slate-100" : "text-slate-800",
                        )}
                    >
                        Click to choose multiple PDFs
                    </p>
                    <p className="text-[11px] text-slate-500">
                        Or drag & drop application + DL + voided check together
                    </p>
                </div>
            </div>

            {rows.length > 0 ? (
                <ul className="space-y-2">
                    {rows.map(({ file, kind }, index) => (
                        <li
                            key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                            className={cn(
                                "flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5",
                                "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
                            )}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                                <div className="min-w-0">
                                    <p
                                        className={cn(
                                            "truncate text-sm font-medium",
                                            isDark ? "text-slate-100" : "text-slate-800",
                                        )}
                                    >
                                        {file.name}
                                    </p>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                                        <span
                                            className={cn(
                                                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                                                kindBadgeClass(kind),
                                            )}
                                        >
                                            {kindLabel(kind)}
                                        </span>
                                        <span className="text-[11px] text-slate-500">
                                            {formatBytes(file.size)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {!loading ? (
                                <button
                                    type="button"
                                    aria-label={`Remove ${file.name}`}
                                    className="rounded p-0.5 text-slate-500 hover:bg-slate-200/80 hover:text-slate-800"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        removeAt(index);
                                    }}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : null}

            {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </section>
    );
}
