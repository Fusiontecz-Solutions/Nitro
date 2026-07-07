import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import { axiosPut } from "@/redux/axios";
import { toast } from "react-toastify";
import type { BuildContractPrefillFieldsArgs } from "./Contract";
import {
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    getDocumentTemplatePrefillFieldRowsForEditor,
    hasAddendumPrefillFieldMap,
    isAchAuthorizationPrefillTemplate,
    normalizeAddendumSavedFieldValuesForPersistence,
} from "./documentTemplateMappingPrefill";
import { KATAN_ACH_AUTHORIZATION_PREFILL_FIELD_IDS } from "./KATAN_ACH_AUTHORIZATION_ADDENDUM";
import { cn } from "@/lib/utils";

function achFormPrefillTitleName(templateName: string): string {
    const cleaned = String(templateName ?? "")
        .trim()
        .replace(/\s*[-–]\s*ACH\s+Authorization\s*$/i, "")
        .trim();
    if (cleaned && cleaned.toLowerCase() !== "ach authorization") return cleaned;
    return "ACH Form";
}

/** Fields that span both columns in the addendum prefill editor (2-col layout). */
const ADDENDUM_PREFILL_FULL_WIDTH_FIELD_IDS = new Set([
    "achAuthorizationAccountHolderName",
    "achAuthorizationAccountHolderAddress",
    "achAuthorizationAccountHolderBankName",
    "achAuthorizationConcentAccountHolderName",
    "authorizationClientBankName",
    "authorizationClientName",
    "authorizationClientNamePrint",
]);

function addendumPrefillFieldColSpan(fieldId: string): 1 | 2 {
    if (ADDENDUM_PREFILL_FULL_WIDTH_FIELD_IDS.has(fieldId)) return 2;
    const k = fieldId.toLowerCase();
    if (
        (k.includes("address") || k.includes("street") || k.includes("mailing")) &&
        !k.includes("city") &&
        !k.includes("state") &&
        !k.includes("zip")
    ) {
        return 2;
    }
    return 1;
}

export type TemplateMappingPrefillEditRow = {
    id: string;
    contractId: number;
    templateId: string;
    documentType: string;
    template?: {
        id?: string;
        name?: string | null;
        type?: string;
        state?: string | null;
        frequency?: string | null;
        templateId?: string;
        layoutKey?: string | null;
    } | null;
};

type TemplateMappingPrefillEditDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    row: TemplateMappingPrefillEditRow | null;
    /** CRM `Contract.id`. */
    contractId: number | null;
    applicationUuid?: string | null;
    applicationData: unknown;
    resolvedContract: Record<string, unknown> | null;
    /** Agreement / disclosure date default (e.g. today). */
    agreementDate: string;
    /** Full map: mapping row id → BoldSign field id → value. */
    documentTemplatePrefillByMappingId: Record<string, Record<string, string>>;
    /** Main contract prefill overrides (without document mapping blob); merged on save. */
    mainPrefillOverrides: Partial<BuildContractPrefillFieldsArgs> | null;
    /** After a successful save, parent refreshes contract + mapping list (may sync DocuSign). */
    onSaved: () => void | Promise<void>;
    /** Supplemental-doc flow: edit field values only (hide template GUID editor). */
    addendumOnly?: boolean;
    /** When set with `addendumOnly`, controls dialog copy (ACH form vs addendum). */
    prefillDocumentKind?: "ach_form" | "addendum";
    bankDetail?: Record<string, unknown> | null;
};

export function TemplateMappingPrefillEditDialog({
    open,
    onOpenChange,
    row,
    contractId,
    applicationUuid = null,
    applicationData,
    resolvedContract,
    agreementDate,
    documentTemplatePrefillByMappingId,
    mainPrefillOverrides,
    onSaved,
    addendumOnly = false,
    prefillDocumentKind,
    bankDetail = null,
}: TemplateMappingPrefillEditDialogProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [templateRef, setTemplateRef] = useState("");
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    const templateGuid = String(
        row?.template?.layoutKey ?? row?.template?.templateId ?? row?.templateId ?? "",
    ).trim();
    const isAchFormPrefill =
        prefillDocumentKind === "ach_form" ||
        (prefillDocumentKind !== "addendum" &&
            isAchAuthorizationPrefillTemplate(templateGuid, row?.template?.name ?? null));

    const editorRows = useMemo(() => {
        if (!row) return [];
        const saved = documentTemplatePrefillByMappingId[row.id] ?? {};
        return getDocumentTemplatePrefillFieldRowsForEditor({
            templateId: row.template?.layoutKey ?? row.template?.templateId ?? row.templateId ?? null,
            templateLayoutKey: row.template?.layoutKey ?? null,
            templateName: row.template?.name ?? null,
            templateState: row.template?.state ?? null,
            templateFrequency: row.template?.frequency ?? null,
            documentType: row.documentType ?? null,
            prefillDocumentKind: isAchFormPrefill ? "ach_form" : prefillDocumentKind ?? null,
            contract: resolvedContract,
            application: applicationData as Record<string, unknown> | null,
            agreementDate,
            mainPrefillOverrides: mainPrefillOverrides ?? undefined,
            savedOverridesForMapping: saved,
            bankDetail,
        });
    }, [
        row,
        documentTemplatePrefillByMappingId,
        resolvedContract,
        applicationData,
        agreementDate,
        mainPrefillOverrides,
        bankDetail,
        isAchFormPrefill,
        prefillDocumentKind,
    ]);

    useEffect(() => {
        if (!open || !row) return;
        setTemplateRef(
            String(row.template?.layoutKey ?? row.template?.templateId ?? "").trim(),
        );
    }, [open, row]);

    const seededMappingIdRef = useRef<{ rowId: string; seeded: boolean } | null>(null);

    useEffect(() => {
        if (!open || !row) {
            seededMappingIdRef.current = null;
            return;
        }
        if (editorRows.length === 0) return;
        const prev = seededMappingIdRef.current;
        if (prev?.rowId === row.id && prev.seeded) return;
        seededMappingIdRef.current = { rowId: row.id, seeded: true };
        setFieldValues(Object.fromEntries(editorRows.map((r) => [r.id, r.value ?? ""])));
    }, [open, row, editorRows]);

    const titleName = row?.template?.name?.trim()
        ? row.template.name
        : row?.template?.layoutKey || row?.template?.templateId || "document";

    const supportsPrefill =
        isAchFormPrefill ||
        hasAddendumPrefillFieldMap(
            templateGuid,
            row?.template?.name ?? null,
            row?.template?.layoutKey ?? templateGuid,
        );
    const supplementalPrefillTitle = isAchFormPrefill
        ? `Edit ACH form prefill — ${achFormPrefillTitleName(titleName)}`
        : `Edit addendum prefill — ${titleName}`;
    const supplementalPrefillSavedToast = isAchFormPrefill
        ? "ACH form prefill values saved."
        : "Addendum prefill values saved.";
    const supplementalPrefillMissingMapMessage = isAchFormPrefill
        ? "No registered field map for this ACH form document."
        : "No registered field map for this addendum document.";

    const handleSave = useCallback(async () => {
        const cid = contractId != null && Number.isFinite(Number(contractId)) ? Number(contractId) : null;
        if (cid == null || !row?.id) {
            toast.error("Missing contract or mapping row.");
            return;
        }
        const nextTemplateRef = addendumOnly
            ? String(
                  row.template?.layoutKey ??
                      row.template?.templateId ??
                      row.templateId ??
                      "",
              ).trim()
            : String(templateRef ?? "").trim();
        if (!nextTemplateRef) {
            toast.error("Document reference is required.");
            return;
        }
        setSaving(true);
        try {
            if (
                !addendumOnly &&
                nextTemplateRef !==
                    String(row.template?.layoutKey ?? row.template?.templateId ?? "").trim()
            ) {
                await axiosPut(`/contract/${cid}/document-template-mappings/${row.id}`, {
                    templateRef: nextTemplateRef,
                });
            }

            const scopedAddendumFields =
                addendumOnly && prefillDocumentKind === "addendum"
                    ? normalizeAddendumSavedFieldValuesForPersistence(
                          {
                              templateId: row.template?.templateId ?? row.templateId ?? null,
                              templateName: row.template?.name ?? null,
                              templateLayoutKey: row.template?.layoutKey ?? null,
                          },
                          fieldValues,
                      )
                    : fieldValues;

            const nextBlob = {
                ...documentTemplatePrefillByMappingId,
                [row.id]: { ...scopedAddendumFields },
            };

            const main = { ...(mainPrefillOverrides ?? {}) } as Record<string, unknown>;
            delete main[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];

            if (isAchFormPrefill) {
                for (const id of KATAN_ACH_AUTHORIZATION_PREFILL_FIELD_IDS) {
                    if (fieldValues[id] !== undefined) {
                        main[id] = fieldValues[id];
                    }
                }
            }

            const contractPrefillOverrides = {
                ...main,
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: nextBlob,
            };

            await dispatch(
                updateContract({
                    id: cid,
                    data: { contractPrefillOverrides },
                }),
            ).unwrap();

            const appKey = String(applicationUuid ?? "").trim();
            if (appKey) {
                try {
                    await dispatch(getByApplicationIdContract(appKey)).unwrap();
                } catch {
                    /* ignore */
                }
            }

            toast.success(
                addendumOnly
                    ? supplementalPrefillSavedToast
                    : "Template mapping and DocuSign field overrides saved.",
            );
            await Promise.resolve(onSaved());
            onOpenChange(false);
        } catch (e: unknown) {
            console.error(e);
            const msg =
                e && typeof e === "object" && "message" in e
                    ? String((e as { message?: string }).message)
                    : "Failed to save.";
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    }, [
        contractId,
        row,
        templateRef,
        fieldValues,
        documentTemplatePrefillByMappingId,
        mainPrefillOverrides,
        dispatch,
        applicationUuid,
        onSaved,
        onOpenChange,
        addendumOnly,
        supplementalPrefillSavedToast,
        isAchFormPrefill,
    ]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={cn(
                    "flex max-h-[90vh] flex-col gap-0 p-0",
                    addendumOnly
                        ? "w-[min(100vw-2rem,768px)] sm:max-w-[768px]"
                        : "w-[min(100vw-2rem,640px)] sm:max-w-[640px]",
                )}
                onOpenAutoFocus={(e : any) => e.preventDefault()}
            >
                <DialogHeader className="shrink-0 border-b px-6 py-4">
                    <DialogTitle className="text-base">
                        {addendumOnly ? supplementalPrefillTitle : `Edit document mapping — ${titleName}`}
                    </DialogTitle>
                </DialogHeader>
                <div className="max-h-[min(65vh,520px)] overflow-y-auto px-6 py-4">
                    <div className="space-y-4">
                        {!addendumOnly ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="tmpl-mapping-ref" className="text-xs font-medium">
                                Document reference (layout key or CRM row id)
                            </Label>
                            <Input
                                id="tmpl-mapping-ref"
                                value={templateRef}
                                onChange={(e) => setTemplateRef(e.target.value)}
                                className="font-mono text-xs"
                                placeholder="flex_addendum or disclosure row id"
                            />
                        </div>
                        ) : null}
                        {editorRows.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                {supportsPrefill
                                    ? "Loading field definitions…"
                                    : supplementalPrefillMissingMapMessage}
                            </p>
                        ) : (
                            <>
                            {/balance/i.test(titleName) && /transfer/i.test(titleName) ? (
                                <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs leading-relaxed">
                                    In DocuSign, set each field&apos;s <strong>Data Label</strong> to the id in
                                    parentheses below (e.g. <span className="font-mono">business_name</span>,{" "}
                                    <span className="font-mono">client_name</span>,{" "}
                                    <span className="font-mono">client_dba</span>). Labels like
                                    &quot;Merchant Legal Name&quot; also work if they normalize to{" "}
                                    <span className="font-mono">merchant_legal_name</span> or{" "}
                                    <span className="font-mono">client_name</span>.
                                </p>
                            ) : null}
                            <div
                                className={cn(
                                    "grid gap-3",
                                    addendumOnly ? "sm:grid-cols-2" : "sm:grid-cols-1",
                                )}
                            >
                                {editorRows.map((r) => {
                                    const colSpan = addendumOnly
                                        ? addendumPrefillFieldColSpan(r.id)
                                        : 1;
                                    return (
                                        <div
                                            key={r.id}
                                            className={cn(
                                                "space-y-1.5",
                                                colSpan === 2 && "sm:col-span-2",
                                            )}
                                        >
                                            <Label
                                                htmlFor={`tmpl-field-${r.id}`}
                                                className="text-xs font-medium"
                                            >
                                                {r.label}
                                            </Label>
                                            <Input
                                                id={`tmpl-field-${r.id}`}
                                                value={fieldValues[r.id] ?? ""}
                                                onChange={(e) =>
                                                    setFieldValues((prev) => ({
                                                        ...prev,
                                                        [r.id]: e.target.value,
                                                    }))
                                                }
                                                className="h-9 text-sm"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                            </>
                        )}
                    </div>
                </div>
                <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4">
                    <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" disabled={saving || !row} onClick={() => void handleSave()}>
                        {saving ? "Saving…" : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
