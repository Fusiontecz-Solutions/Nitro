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
import { toast } from "react-toastify";
import type {
    BuildContractPrefillFieldsArgs,
    ContractPrefillContractRecords,
} from "./Contract";
import {
    DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY,
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    parseDocumentTemplateEnvelopeByMappingId,
    getDocumentTemplatePrefillFieldRowsForEditor,
    usesCoordinateLayoutTemplate,
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
        layoutKey?: string | null;
        state?: string | null;
        frequency?: string | null;
        templateId?: string;
        pdfUrl?: string | null;
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
    contractRecords?: ContractPrefillContractRecords;
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
    contractRecords,
    agreementDate,
    documentTemplatePrefillByMappingId,
    mainPrefillOverrides,
    onSaved,
}: TemplateMappingPrefillEditDialogProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    const coordinateLayout = usesCoordinateLayoutTemplate(row);

    const editorRows = useMemo(() => {
        if (!row) return [];
        const saved = documentTemplatePrefillByMappingId[row.id] ?? {};
        return getDocumentTemplatePrefillFieldRowsForEditor({
            templateId: row.template?.templateId ?? null,
            templateName: row.template?.name ?? null,
            templateType: row.template?.type ?? row.documentType ?? null,
            templateLayoutKey: row.template?.layoutKey ?? null,
            templateState: row.template?.state ?? null,
            templateFrequency: row.template?.frequency ?? null,
            contract: resolvedContract,
            application: applicationData as Record<string, unknown> | null,
            contractRecords,
            agreementDate,
            mainPrefillOverrides: mainPrefillOverrides ?? undefined,
            savedOverridesForMapping: saved,
        });
    }, [
        row,
        documentTemplatePrefillByMappingId,
        resolvedContract,
        applicationData,
        contractRecords,
        agreementDate,
        mainPrefillOverrides,
    ]);

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
        setSaving(true);
        try {
            const nextBlob = {
                ...documentTemplatePrefillByMappingId,
                [row.id]: { ...fieldValues },
            };

            const main = { ...(mainPrefillOverrides ?? {}) } as Record<string, unknown>;
            delete main[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
            delete main[DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY];
            const envelopeBlob = parseDocumentTemplateEnvelopeByMappingId(
                resolvedContract?.contractPrefillOverrides,
            );
            const contractPrefillOverrides = {
                ...main,
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: nextBlob,
                ...(Object.keys(envelopeBlob).length
                    ? { [DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY]: envelopeBlob }
                    : {}),
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
                coordinateLayout
                    ? "ACH form field values saved."
                    : "Template mapping and DocuSign field overrides saved.",
            );
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
        coordinateLayout,
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
        : coordinateLayout
          ? "ACH authorization"
          : row?.template?.templateId || "DocuSign template";

    const dialogTitle = coordinateLayout
        ? `Edit ACH form — ${titleName}`
        : `Edit template mapping — ${titleName}`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[90vh] w-[min(100vw-2rem,960px)] flex-col gap-0 p-0 sm:max-w-[960px]"
                onOpenAutoFocus={(e : any) => e.preventDefault()}
            >
                <DialogHeader className="shrink-0 border-b px-6 py-4">
                    <DialogTitle className="text-base">{dialogTitle}</DialogTitle>
                    {!coordinateLayout ? (
                        <p className="text-muted-foreground text-sm font-normal leading-snug">
                            Adjust field values used when prefilling this document. Values are saved on the
                            contract.
                        </p>
                    ) : null}
                </DialogHeader>
                <div className="max-h-[min(65vh,520px)] overflow-y-auto px-6 py-4">
                    <div className="space-y-4">
                        {editorRows.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                No registered field map for this template. For ACH, ensure BoldSignTemplate has{" "}
                                <span className="font-mono text-xs">type=ach</span>,{" "}
                                <span className="font-mono text-xs">layoutKey=ach_authorization</span>, and{" "}
                                <span className="font-mono text-xs">pdfUrl</span> set.
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
                            <div className="grid gap-3 sm:grid-cols-2">
                                {editorRows.map((r) => (
                                    <div key={r.id} className="space-y-1.5">
                                        <Label htmlFor={`tmpl-field-${r.id}`} className="text-xs font-medium">
                                            {r.label}
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
