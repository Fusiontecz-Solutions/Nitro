import { useCallback, useEffect, useMemo, useState } from "react";
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
} from "./documentTemplateMappingPrefill";

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
    /** After a successful save, parent refreshes contract + mapping list. */
    onSaved: () => void;
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
}: TemplateMappingPrefillEditDialogProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [templateRef, setTemplateRef] = useState("");
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    const editorRows = useMemo(() => {
        if (!row) return [];
        const saved = documentTemplatePrefillByMappingId[row.id] ?? {};
        return getDocumentTemplatePrefillFieldRowsForEditor({
            templateName: row.template?.name ?? null,
            templateState: row.template?.state ?? null,
            templateFrequency: row.template?.frequency ?? null,
            contract: resolvedContract,
            application: applicationData as Record<string, unknown> | null,
            agreementDate,
            savedOverridesForMapping: saved,
        });
    }, [row, documentTemplatePrefillByMappingId, resolvedContract, applicationData, agreementDate]);

    useEffect(() => {
        if (!open || !row) return;
        setTemplateRef(String(row.template?.templateId ?? "").trim());
    }, [open, row]);

    useEffect(() => {
        if (!open || !row) return;
        setFieldValues(Object.fromEntries(editorRows.map((r) => [r.id, r.value ?? ""])));
    }, [open, row?.id, editorRows]);

    const handleSave = useCallback(async () => {
        const cid = contractId != null && Number.isFinite(Number(contractId)) ? Number(contractId) : null;
        if (cid == null || !row?.id) {
            toast.error("Missing contract or mapping row.");
            return;
        }
        const nextTemplateRef = String(templateRef ?? "").trim();
        if (!nextTemplateRef) {
            toast.error("BoldSign template ID is required.");
            return;
        }
        setSaving(true);
        try {
            if (nextTemplateRef !== String(row.template?.templateId ?? "").trim()) {
                await axiosPut(`/contract/${cid}/document-template-mappings/${row.id}`, {
                    templateRef: nextTemplateRef,
                });
            }

            const nextBlob = {
                ...documentTemplatePrefillByMappingId,
                [row.id]: { ...fieldValues },
            };

            const main = { ...(mainPrefillOverrides ?? {}) } as Record<string, unknown>;
            delete main[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
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

            toast.success("Template mapping and BoldSign field overrides saved.");
            onSaved();
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
    ]);

    const titleName = row?.template?.name?.trim()
        ? row.template.name
        : row?.template?.templateId || "BoldSign template";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[90vh] w-[min(100vw-2rem,640px)] flex-col gap-0 p-0 sm:max-w-[640px]"
                onOpenAutoFocus={(e : any) => e.preventDefault()}
            >
                <DialogHeader className="shrink-0 border-b px-6 py-4">
                    <DialogTitle className="text-base">Edit template mapping — {titleName}</DialogTitle>
                    <p className="text-muted-foreground text-sm font-normal leading-snug">
                        Change the BoldSign template ID if needed, then adjust field values used when prefilling this
                        document. Values are saved on the contract under{" "}
                        <span className="font-mono text-xs">documentTemplatePrefillByMappingId</span>.
                    </p>
                </DialogHeader>
                <div className="max-h-[min(65vh,520px)] overflow-y-auto px-6 py-4">
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="tmpl-mapping-bsid" className="text-xs font-medium">
                                BoldSign template ID (GUID)
                            </Label>
                            <Input
                                id="tmpl-mapping-bsid"
                                value={templateRef}
                                onChange={(e) => setTemplateRef(e.target.value)}
                                className="font-mono text-xs"
                                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                            />
                        </div>
                        {editorRows.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                No registered field map for this template name. You can still update the template ID
                                above; add a matching entry in{" "}
                                <span className="font-mono text-xs">documentTemplateMappingPrefill.ts</span> to edit
                                fields here.
                            </p>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-1">
                                {editorRows.map((r) => (
                                    <div key={r.id} className="space-y-1.5">
                                        <Label htmlFor={`tmpl-field-${r.id}`} className="text-xs font-medium">
                                            {r.label}{" "}
                                            <span className="text-muted-foreground font-normal">({r.id})</span>
                                        </Label>
                                        <Input
                                            id={`tmpl-field-${r.id}`}
                                            value={fieldValues[r.id] ?? ""}
                                            onChange={(e) =>
                                                setFieldValues((prev) => ({ ...prev, [r.id]: e.target.value }))
                                            }
                                        />
                                    </div>
                                ))}
                            </div>
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
