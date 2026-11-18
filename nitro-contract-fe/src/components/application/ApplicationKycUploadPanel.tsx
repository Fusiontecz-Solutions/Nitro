import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { toast } from "react-toastify";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import {
    getApplicationByApplicationId,
    syncApplicationKycPrefill,
    uploadApplicationKycDocuments,
} from "@/redux/actions/applicationActions";
import { invalidateApplicationDetailCache } from "@/lib/applicationDetailCache";
import { cn } from "@/lib/utils";
import { normalizeDocumentSlug } from "@/constants/documentRequestTypes";
import type { Application, ApplicationFiles } from "@/types/applicationTypes";
import type { OwnerDetail } from "@/types/clientTypes";
import KycExtractionReviewCard from "./contractdata/KycExtractionReviewCard";
import {
    finalizeKycExtractionForSync,
    kycExtractionHasReadableFields,
    parseKycExtractionsFromUploadResponse,
    type KycExtractionResult,
    type KycUploadSlot,
} from "./contractdata/kycDocumentPrefill";

type SlotConfig = {
    slot: KycUploadSlot;
    documentType: "driverLicense" | "voidedCheck";
    ownerIndex: 1 | 2;
    label: string;
    slug: string;
};

type PendingKyc = {
    extraction: KycExtractionResult;
    synced: boolean;
};

const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png"];

function ownerDisplayName(owner?: OwnerDetail | null, fallback = ""): string {
    const name = [owner?.firstName, owner?.lastName].filter(Boolean).join(" ").trim();
    return name || fallback;
}

function resolveOwners(application?: Application | null): OwnerDetail[] {
    const client = application?.client;
    if (!client || typeof client === "string") return [];
    if (Array.isArray(client.owners) && client.owners.length) return client.owners;
    if (client.owner && (client.owner.firstName || client.owner.lastName)) {
        return [client.owner as OwnerDetail];
    }
    return [];
}

function resolveOwnerCount(owners: OwnerDetail[]): 1 | 2 {
    const named = owners.filter((o) => String(o.firstName || "").trim() || String(o.lastName || "").trim());
    return named.length >= 2 ? 2 : 1;
}

function buildSlots(owners: OwnerDetail[]): SlotConfig[] {
    const ownerCount = resolveOwnerCount(owners);
    const owner1Name = ownerDisplayName(owners[0], "Owner 1");
    const owner2Name = ownerDisplayName(owners[1], "Owner 2");
    const slots: SlotConfig[] = [
        {
            slot: "driverLicense",
            documentType: "driverLicense",
            ownerIndex: 1,
            label: ownerCount === 2 ? `${owner1Name} — Driver's License` : "Driver's License",
            slug: "driver-license",
        },
    ];
    if (ownerCount === 2) {
        slots.push({
            slot: "driverLicenseOwner2",
            documentType: "driverLicense",
            ownerIndex: 2,
            label: `${owner2Name} — Driver's License`,
            slug: "driver-license-owner-2",
        });
    }
    slots.push({
        slot: "voidedCheck",
        documentType: "voidedCheck",
        ownerIndex: 1,
        label: "Voided Check",
        slug: "voided-check",
    });
    return slots;
}

type ApplicationKycUploadPanelProps = {
    application: Application;
    files: ApplicationFiles[];
    readOnly?: boolean;
};

export default function ApplicationKycUploadPanel({
    application,
    files,
    readOnly = false,
}: ApplicationKycUploadPanelProps) {
    const dispatch: AppDispatch = useDispatch();
    const owners = useMemo(() => resolveOwners(application), [application]);
    const slots = useMemo(() => buildSlots(owners), [owners]);
    const inputRefs = useRef<Record<KycUploadSlot, HTMLInputElement | null>>({
        driverLicense: null,
        driverLicenseOwner2: null,
        voidedCheck: null,
    });

    const [pendingBySlot, setPendingBySlot] = useState<Partial<Record<KycUploadSlot, PendingKyc>>>(() => {
        const initial: Partial<Record<KycUploadSlot, PendingKyc>> = {};
        const saved = application.kycPrefill?.slots ?? {};
        for (const [key, value] of Object.entries(saved)) {
            if (!value) continue;
            const slot = (value.slot || key) as KycUploadSlot;
            initial[slot] = {
                synced: Boolean(value.syncedAt),
                extraction: {
                    documentType: value.documentType,
                    ownerIndex: value.ownerIndex,
                    slot,
                    fileId: value.fileId,
                    fileName: value.fileName,
                    fileUrl: value.fileUrl,
                    keyData: value.keyData,
                    contractPrefill: value.contractPrefill,
                    panels: value.panels as KycExtractionResult["panels"],
                },
            };
        }
        return initial;
    });

    useEffect(() => {
        const saved = application.kycPrefill?.slots ?? {};
        setPendingBySlot((prev) => {
            const next = { ...prev };
            for (const [key, value] of Object.entries(saved)) {
                if (!value) continue;
                const slot = (value.slot || key) as KycUploadSlot;
                if (next[slot]) continue;
                next[slot] = {
                    synced: Boolean(value.syncedAt),
                    extraction: {
                        documentType: value.documentType,
                        ownerIndex: value.ownerIndex,
                        slot,
                        fileId: value.fileId,
                        fileName: value.fileName,
                        fileUrl: value.fileUrl,
                        keyData: value.keyData,
                        contractPrefill: value.contractPrefill,
                        panels: value.panels as KycExtractionResult["panels"],
                    },
                };
            }
            return next;
        });
    }, [application.kycPrefill]);

    const [progressBySlot, setProgressBySlot] = useState<Partial<Record<KycUploadSlot, number>>>({});
    const [pendingNameBySlot, setPendingNameBySlot] = useState<Partial<Record<KycUploadSlot, string>>>({});
    const [dragOverSlot, setDragOverSlot] = useState<KycUploadSlot | null>(null);
    const [syncingSlot, setSyncingSlot] = useState<KycUploadSlot | null>(null);

    const uploadedBySlug = useMemo(() => {
        const map = new Map<string, ApplicationFiles>();
        for (const file of files) {
            const slug = normalizeDocumentSlug(file.requestedDocumentSlug || file.documentType);
            if (slug && !map.has(slug)) map.set(slug, file);
        }
        return map;
    }, [files]);

    const refreshApplication = async () => {
        const refreshKey = application.applicationId ?? application._id;
        if (!refreshKey) return;
        invalidateApplicationDetailCache(String(refreshKey));
        await dispatch(getApplicationByApplicationId(String(refreshKey)));
    };

    const handleUpload = async (slot: SlotConfig, file: File) => {
        if (readOnly) return;
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        if (!ALLOWED_EXT.includes(ext)) {
            toast.error("Upload a PDF, JPG, or PNG.");
            return;
        }
        if (!application._id) {
            toast.error("Application ID not found");
            return;
        }

        setPendingNameBySlot((prev) => ({ ...prev, [slot.slot]: file.name }));
        setProgressBySlot((prev) => ({ ...prev, [slot.slot]: 0 }));

        try {
            const uploadResult = await dispatch(
                uploadApplicationKycDocuments({
                    id: application._id,
                    filesByType: { [slot.slot]: file },
                    onUploadProgress: (event) => {
                        const total = Number(event?.total || 0);
                        const loaded = Number(event?.loaded || 0);
                        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
                        setProgressBySlot((prev) => ({
                            ...prev,
                            [slot.slot]: Math.min(99, Math.max(prev[slot.slot] ?? 0, pct)),
                        }));
                    },
                }),
            ).unwrap();

            const extractions = parseKycExtractionsFromUploadResponse(uploadResult);
            const extraction =
                extractions.find(
                    (row) =>
                        row.slot === slot.slot ||
                        (row.documentType === slot.documentType &&
                            (row.ownerIndex ?? 1) === slot.ownerIndex),
                ) ?? extractions[0];

            if (extraction) {
                setPendingBySlot((prev) => ({
                    ...prev,
                    [slot.slot]: {
                        extraction: {
                            ...extraction,
                            documentType: slot.documentType,
                            ownerIndex: slot.ownerIndex,
                            slot: slot.slot,
                        },
                        synced: false,
                    },
                }));
                if (extraction.error) {
                    toast.warn(`Scan failed: ${extraction.error}`);
                } else if (kycExtractionHasReadableFields(extraction)) {
                    toast.info("Scanned — review fields, then sync to save.");
                } else {
                    toast.warn("Uploaded, but no readable fields were found.");
                }
            }

            setProgressBySlot((prev) => ({ ...prev, [slot.slot]: 100 }));
            await refreshApplication();
        } catch (error: unknown) {
            const message =
                typeof error === "string"
                    ? error
                    : error instanceof Error
                      ? error.message
                      : "Failed to upload document";
            toast.error(message);
        } finally {
            setProgressBySlot((prev) => {
                const next = { ...prev };
                delete next[slot.slot];
                return next;
            });
            setPendingNameBySlot((prev) => {
                const next = { ...prev };
                delete next[slot.slot];
                return next;
            });
        }
    };

    const handleSync = async (slot: SlotConfig) => {
        const pending = pendingBySlot[slot.slot];
        if (!pending || pending.synced || !application._id) return;
        const finalized = finalizeKycExtractionForSync({
            ...pending.extraction,
            documentType: slot.documentType,
            ownerIndex: slot.ownerIndex,
            slot: slot.slot,
        });
        if (!kycExtractionHasReadableFields(finalized)) {
            toast.warn("No readable fields to sync. Edit the card or re-upload.");
            return;
        }
        setSyncingSlot(slot.slot);
        try {
            await dispatch(
                syncApplicationKycPrefill({
                    id: application._id,
                    extraction: {
                        documentType: slot.documentType,
                        slot: slot.slot,
                        ownerIndex: slot.ownerIndex,
                        contractPrefill: finalized.contractPrefill,
                        panels: finalized.panels as Record<string, unknown>,
                        keyData: finalized.keyData,
                        fileId: finalized.fileId,
                        fileName: finalized.fileName,
                        fileUrl: finalized.fileUrl,
                    },
                }),
            ).unwrap();
            setPendingBySlot((prev) => ({
                ...prev,
                [slot.slot]: { extraction: finalized, synced: true },
            }));
            await refreshApplication();
            toast.success("Saved — these values will auto-fill later fields.");
        } catch (error: unknown) {
            const message =
                typeof error === "string"
                    ? error
                    : error instanceof Error
                      ? error.message
                      : "Failed to sync extracted data";
            toast.error(message);
        } finally {
            setSyncingSlot(null);
        }
    };

    return (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-[#374151] dark:bg-[#1a1b1e]">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                        Identity & bank documents
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Drag & drop or click — scan starts automatically. Sync to save values for later prefill.
                    </p>
                </div>
            </div>

            <div className="space-y-2">
                {slots.map((slot) => {
                    const uploaded = uploadedBySlug.get(slot.slug);
                    const progress = progressBySlot[slot.slot];
                    const isUploading = typeof progress === "number";
                    const isUploaded = Boolean(uploaded) && !isUploading;
                    const isDragOver = dragOverSlot === slot.slot;
                    const disabled = readOnly;

                    return (
                        <div key={slot.slot}>
                            <input
                                ref={(el) => {
                                    inputRefs.current[slot.slot] = el;
                                }}
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    e.target.value = "";
                                    if (file) void handleUpload(slot, file);
                                }}
                            />
                            <div
                                role={!isUploaded && !isUploading && !disabled ? "button" : undefined}
                                tabIndex={!isUploaded && !isUploading && !disabled ? 0 : -1}
                                onClick={() => {
                                    if (isUploaded || isUploading || disabled) return;
                                    inputRefs.current[slot.slot]?.click();
                                }}
                                onKeyDown={(e) => {
                                    if (isUploaded || isUploading || disabled) return;
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        inputRefs.current[slot.slot]?.click();
                                    }
                                }}
                                onDragOver={(e) => {
                                    if (isUploaded || isUploading || disabled) return;
                                    e.preventDefault();
                                    setDragOverSlot(slot.slot);
                                }}
                                onDragLeave={() =>
                                    setDragOverSlot((prev) => (prev === slot.slot ? null : prev))
                                }
                                onDrop={(e) => {
                                    if (isUploaded || isUploading || disabled) return;
                                    e.preventDefault();
                                    setDragOverSlot(null);
                                    const file = e.dataTransfer.files?.[0];
                                    if (file) void handleUpload(slot, file);
                                }}
                                className={cn(
                                    "relative flex items-center justify-between rounded-2xl border px-3 py-2.5 transition-colors",
                                    isUploaded
                                        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
                                        : isUploading
                                          ? "border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30"
                                          : isDragOver
                                            ? "border-blue-400 bg-blue-50 ring-2 ring-blue-200"
                                            : "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20",
                                    !isUploaded && !isUploading && !disabled && "cursor-pointer hover:bg-amber-100/70",
                                    disabled && !isUploaded && "opacity-60",
                                )}
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    {!isUploaded && (
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
                                    )}
                                    {isUploaded && (
                                        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                                            {slot.label}
                                        </p>
                                        <p className="truncate text-[11px] text-slate-500">
                                            {isUploaded
                                                ? uploaded?.originalName || "Uploaded"
                                                : isUploading
                                                  ? pendingNameBySlot[slot.slot] || "Uploading…"
                                                  : "PDF, JPG, or PNG"}
                                        </p>
                                    </div>
                                </div>
                                {isUploaded && !readOnly && (
                                    <button
                                        type="button"
                                        className="text-[11px] font-medium text-slate-600 underline-offset-2 hover:underline"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            inputRefs.current[slot.slot]?.click();
                                        }}
                                    >
                                        Replace
                                    </button>
                                )}
                                {isUploading && (
                                    <div className="pointer-events-none absolute inset-x-3 bottom-1 h-1 overflow-hidden rounded-full bg-blue-100">
                                        <div
                                            className="h-full rounded-full bg-blue-500 transition-[width] duration-200"
                                            style={{ width: `${progress ?? 0}%` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="grid gap-3 lg:grid-cols-1">
                {slots.map((slot) => {
                    const pending = pendingBySlot[slot.slot];
                    if (!pending) return null;
                    return (
                        <KycExtractionReviewCard
                            key={`kyc-${slot.slot}`}
                            documentKey={slot.documentType}
                            title={slot.label}
                            extraction={pending.extraction}
                            synced={pending.synced}
                            syncing={syncingSlot === slot.slot}
                            onChange={(next) =>
                                setPendingBySlot((prev) => ({
                                    ...prev,
                                    [slot.slot]: {
                                        extraction: { ...next, ownerIndex: slot.ownerIndex, slot: slot.slot },
                                        synced: false,
                                    },
                                }))
                            }
                            onSync={() => void handleSync(slot)}
                        />
                    );
                })}
            </div>
        </section>
    );
}
