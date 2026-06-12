import { useRef, useState } from "react";
import { CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DOCUMENT_REQUEST_OPTIONS } from "./RequestMissingDocumentsModal";

export type RequestedDocumentRow = {
    name: string;
    label?: string;
    status: "Complete" | "Pending";
};

function formatDocName(name: string): string {
    if (!name) return "";
    return name
        .replace(/[-_]/g, " ")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ");
}

export function getRequestedDocumentLabel(doc: { name: string; label?: string }): string {
    if (doc.label?.trim()) return doc.label.trim();
    const match = DOCUMENT_REQUEST_OPTIONS.find((opt) => opt.id === doc.name);
    if (match) return match.label;
    return formatDocName(doc.name);
}

type RequestedDocumentUploadRowsProps = {
    pending: RequestedDocumentRow[];
    completed: RequestedDocumentRow[];
    onUpload: (requestDocId: string, file: File) => Promise<void>;
};

export default function RequestedDocumentUploadRows({
    pending,
    completed,
    onUpload,
}: RequestedDocumentUploadRowsProps) {
    const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
    const [pendingName, setPendingName] = useState<Record<string, string>>({});
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);
    const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    const handlePick = async (requestKey: string, files: FileList | null) => {
        const file = files?.[0];
        if (!file) return;

        setPendingName((prev) => ({ ...prev, [requestKey]: file.name }));
        setUploadProgress((prev) => ({ ...prev, [requestKey]: 0 }));

        try {
            await onUpload(requestKey, file);
            setUploadProgress((prev) => ({ ...prev, [requestKey]: 100 }));
        } finally {
            setUploadProgress((prev) => {
                const next = { ...prev };
                delete next[requestKey];
                return next;
            });
            setPendingName((prev) => {
                const next = { ...prev };
                delete next[requestKey];
                return next;
            });
        }
    };

    if (!pending.length && !completed.length) return null;

    return (
        <div className="space-y-3 border-b px-6 py-4">
            {pending.length > 0 ? (
                <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
                        Requested documents — upload below
                    </p>
                    {pending.map((doc, index) => {
                        const requestKey = String(doc.name || `request-${index}`);
                        const label = getRequestedDocumentLabel(doc);
                        const progress = uploadProgress[requestKey];
                        const isUploading = typeof progress === "number";
                        const isDragOver = dragOverKey === requestKey;
                        const uploadingName = pendingName[requestKey];

                        return (
                            <div
                                key={`req-upload-${requestKey}`}
                                role={!isUploading ? "button" : undefined}
                                tabIndex={!isUploading ? 0 : -1}
                                onClick={() => {
                                    if (isUploading) return;
                                    inputRefs.current[requestKey]?.click();
                                }}
                                onKeyDown={(e) => {
                                    if (isUploading) return;
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        inputRefs.current[requestKey]?.click();
                                    }
                                }}
                                onDragOver={(e) => {
                                    if (isUploading) return;
                                    e.preventDefault();
                                    setDragOverKey(requestKey);
                                }}
                                onDragLeave={() => setDragOverKey((k) => (k === requestKey ? null : k))}
                                onDrop={(e) => {
                                    if (isUploading) return;
                                    e.preventDefault();
                                    setDragOverKey(null);
                                    void handlePick(requestKey, e.dataTransfer?.files ?? null);
                                }}
                                className={cn(
                                    "flex items-center justify-between rounded-xl border px-3 py-2.5 transition-colors",
                                    isUploading
                                        ? "border-blue-200 bg-blue-50"
                                        : isDragOver
                                          ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200"
                                          : "border-amber-200 bg-amber-50",
                                    !isUploading && "cursor-pointer hover:bg-amber-100/70",
                                )}
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <span
                                        className={cn(
                                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                                            isUploading
                                                ? "bg-blue-100 text-blue-700"
                                                : "bg-amber-100 text-amber-700",
                                        )}
                                    >
                                        {isUploading ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <UploadCloud className="h-3.5 w-3.5" />
                                        )}
                                    </span>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-slate-800">{label}</p>
                                        <p className="truncate text-[11px] text-slate-500">
                                            {isUploading
                                                ? uploadingName || "Uploading..."
                                                : "Drop file or click to upload (PDF, JPG, PNG)"}
                                        </p>
                                    </div>
                                </div>
                                <Input
                                    ref={(el) => {
                                        inputRefs.current[requestKey] = el;
                                    }}
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png"
                                    className="hidden"
                                    onChange={(e) => {
                                        void handlePick(requestKey, e.target.files);
                                        e.target.value = "";
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {completed.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {completed.map((doc, index) => (
                        <span
                            key={`req-done-${doc.name}-${index}`}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800"
                        >
                            <CheckCircle2 className="h-3 w-3" aria-hidden />
                            {getRequestedDocumentLabel(doc)} — uploaded
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
