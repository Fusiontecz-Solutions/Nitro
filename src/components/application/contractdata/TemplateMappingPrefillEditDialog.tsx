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
import {
    updateACH,
    updateContract,
} from "@/redux/actions/contractActions";
import { toast } from "react-toastify";
import { axiosGet } from "@/redux/axios";
import type {
    BuildContractPrefillFieldsArgs,
    ContractPrefillContractRecords,
    ContractPrefillField,
} from "./Contract";
import { CONTRACT_PREFILL_COLUMN_SYNC_KEYS } from "./Contract";
import {
    ACH_PREFILL_MAPPING_ALIAS_KEY,
    achCamelPartialToAchRecordPatch,
    achTabValuesToCamelPartial,
    resolveAchSavedMappingOverrides,
} from "./achFormEditConfig";
import { upsertApplicationBankDetailFromPrefill } from "./contractPrefillSourceSync";
import { FlexAddendumInstallmentGrid } from "./FlexAddendumInstallmentGrid";
import { splitFlexInstallmentRows } from "./flexAddendumInstallmentRows";
import {
    applySharedBankDetailsToMappingBlob,
    applySharedBankDetailsToTabValues,
    extractSharedBankDetailsFromRecord,
    extractSharedBankDetailsFromTabValues,
    hasSharedBankDetails,
    mergeSharedBankDetails,
    sharedBankToCamelPartial,
    syncSiblingBankFields,
} from "./sharedBankDetails";
import {
    DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY,
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    parseDocumentTemplateEnvelopeByMappingId,
    parseDocumentTemplatePrefillByMappingId,
    applySharedDbaToFieldValues,
    applySharedDbaToMappingBlob,
    extractOnlineBankingFromTabValues,
    getDocumentTemplatePrefillFieldRowsForEditor,
    omitMappingBlobIds,
    resolveSharedDbaValue,
    usesCoordinateLayoutTemplate,
} from "./documentTemplateMappingPrefill";
import {
    EXHIBIT_C_ENTITIES_PREFILL_KEY,
    exhibitCEntitiesFromPrefill,
    exhibitCEntityFromTabValues,
    serializeExhibitCEntities,
    upsertExhibitCEntityAtIndex,
} from "./exhibitCEntityPrefill";
import {
    isAchDailyAddendumRef,
    isExhibitCFamilyAddendumRef,
    isMultiInstanceAddendumRef,
} from "./multiInstanceAddendum";

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
    /**
     * 0-based index among Exhibit C copies on this deal.
     * Index &gt; 0 starts empty and saves without overwriting other Exhibit C / shared bank.
     */
    exhibitCEntityIndex?: number;
    /**
     * Mapping ids of the extra Exhibit C copies (every Exhibit C after the first).
     * Each belongs to its own entity: never a source of the shared DBA / bank,
     * and never overwritten by them when another document is saved.
     */
    exhibitCCopyMappingIds?: readonly string[];
    /**
     * Optional title suffix (e.g. selected funder name for ACH).
     * When set, replaces the template name in the dialog title.
     */
    titleSuffix?: string | null;
    /** After a successful save, parent refreshes local prefill (no extra GET). */
    onSaved: (saved?: {
        tabValues?: Record<string, string>;
        contractPrefillOverrides?: unknown;
    }) => void;
};

type PrefillEditorGroup = {
    key: string;
    label: string | null;
    rows: ContractPrefillField[];
};

function groupPrefillEditorRows(rows: ContractPrefillField[]): PrefillEditorGroup[] {
    const groups: PrefillEditorGroup[] = [];
    for (const row of rows) {
        const key = row.group?.trim() || "";
        const last = groups[groups.length - 1];
        if (last && last.key === key) {
            last.rows.push(row);
            continue;
        }
        groups.push({
            key,
            label: key || null,
            rows: [row],
        });
    }
    return groups;
}

/**
 * Every Exhibit C mapping id for a contract (each is its own entity), for callers that do not hold
 * the addendum mapping rows (e.g. the ACH form viewer). Empty on failure.
 */
async function fetchExhibitCCopyMappingIds(contractId: number): Promise<string[]> {
    try {
        const res = await axiosGet(`/contract/${contractId}/document-template-mappings`);
        const rows = (res?.data?.data ?? []) as Array<{
            id?: unknown;
            order?: unknown;
            template?: {
                name?: string | null;
                layoutKey?: string | null;
                templateId?: string | null;
            } | null;
        }>;
        return rows
            .filter((r) =>
                isExhibitCFamilyAddendumRef(
                    r.template?.layoutKey || r.template?.templateId || "",
                    r.template?.name,
                ),
            )
            .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
            .map((r) => String(r.id ?? "").trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

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
    exhibitCEntityIndex = 0,
    exhibitCCopyMappingIds,
    titleSuffix = null,
    onSaved,
}: TemplateMappingPrefillEditDialogProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    /** Only hydrate once per open/row — contract status polls must not wipe in-progress edits. */
    const hydratedSessionKeyRef = useRef<string | null>(null);

    const coordinateLayout = usesCoordinateLayoutTemplate(row);
    const isAchDailyRow = Boolean(
        row &&
            isAchDailyAddendumRef(
                row.template?.layoutKey || row.template?.templateId || "",
                row.template?.name,
            ),
    );
    const isExhibitCRow = Boolean(
        row &&
            !isAchDailyRow &&
            isMultiInstanceAddendumRef(
                row.template?.layoutKey || row.template?.templateId || "",
                row.template?.name,
            ),
    );
    // Every Exhibit C copy saves only its own mapping + entity slot — never overwrite siblings.
    // ACH Daily is a separate template (same field ids) and must not use Exhibit C entity slots.
    const isolateExhibitCInstance = isExhibitCRow;

    const editorRows = useMemo(() => {
        if (!row) return [];
        const saved = coordinateLayout
            ? resolveAchSavedMappingOverrides(documentTemplatePrefillByMappingId, row.id)
            : (documentTemplatePrefillByMappingId[row.id] ?? {});
        return getDocumentTemplatePrefillFieldRowsForEditor({
            templateId: row.template?.templateId ?? null,
            templateName: row.template?.name ?? null,
            templateType: row.template?.type ?? row.documentType ?? null,
            templateLayoutKey: row.template?.layoutKey ?? null,
            templateState: row.template?.state ?? null,
            templateFrequency: row.template?.frequency ?? null,
            fallbackState:
                String((resolvedContract as { state?: unknown } | null)?.state ?? "").trim() || null,
            fallbackFrequency:
                String(
                    (resolvedContract as { disclosureFrequency?: unknown } | null)
                        ?.disclosureFrequency ?? "",
                ).trim() || null,
            documentType: row.documentType ?? null,
            contract: resolvedContract,
            application: applicationData as Record<string, unknown> | null,
            contractRecords,
            agreementDate,
            mainPrefillOverrides: mainPrefillOverrides ?? undefined,
            siblingPrefillByMappingId: omitMappingBlobIds(
                documentTemplatePrefillByMappingId,
                exhibitCCopyMappingIds,
            ),
            savedOverridesForMapping: saved,
            bankDetail: contractRecords?.bankDetail ?? null,
            ach: (contractRecords?.ach as Record<string, unknown> | null) ?? null,
            exhibitCEntityIndex,
        });
    }, [
        row,
        coordinateLayout,
        documentTemplatePrefillByMappingId,
        resolvedContract,
        applicationData,
        contractRecords,
        agreementDate,
        mainPrefillOverrides,
        exhibitCEntityIndex,
        exhibitCCopyMappingIds,
    ]);

    const groupedEditorRows = useMemo(() => groupPrefillEditorRows(editorRows), [editorRows]);

    useEffect(() => {
        if (!open || !row) {
            hydratedSessionKeyRef.current = null;
            return;
        }
        const sessionKey = `${String(row.id)}:${exhibitCEntityIndex}`;
        if (hydratedSessionKeyRef.current === sessionKey) return;
        if (editorRows.length === 0) return;
        hydratedSessionKeyRef.current = sessionKey;
        const fromRows = Object.fromEntries(editorRows.map((r) => [r.id, r.value ?? ""]));
        if (isolateExhibitCInstance) {
            // Extra Exhibit C: only this mapping's saved values — no shared DBA seed.
            setFieldValues(fromRows);
            return;
        }
        const sharedDba = resolveSharedDbaValue({
            mainPrefill: mainPrefillOverrides ?? null,
            contract: resolvedContract,
            mappingBlobs: omitMappingBlobIds(
                documentTemplatePrefillByMappingId,
                exhibitCCopyMappingIds,
            ),
        });
        setFieldValues(
            applySharedDbaToFieldValues(fromRows, sharedDba, {
                emptyOnly: true,
                knownIds: editorRows.map((r) => String(r.id)),
            }),
        );
    }, [open, row?.id, editorRows, exhibitCEntityIndex, isolateExhibitCInstance]);

    const handleSave = useCallback(async () => {
        const cid = contractId != null && Number.isFinite(Number(contractId)) ? Number(contractId) : null;
        if (cid == null || !row?.id) {
            toast.error("Missing contract or mapping row.");
            return;
        }
        setSaving(true);
        try {
            const rawOverrides =
                resolvedContract?.contractPrefillOverrides &&
                typeof resolvedContract.contractPrefillOverrides === "object" &&
                !Array.isArray(resolvedContract.contractPrefillOverrides)
                    ? {
                          ...(resolvedContract.contractPrefillOverrides as Record<
                              string,
                              unknown
                          >),
                      }
                    : {};

            const existingBlob = parseDocumentTemplatePrefillByMappingId(rawOverrides);
            const envelopeBlob = parseDocumentTemplateEnvelopeByMappingId(rawOverrides);

            const tabValues = { ...fieldValues };
            // Balance Transfer Remaining Balance must map to the CRM-scoped DocuSign
            // label (balance_transfer_purchase_price) — never overwrite main RPA purchase_price.
            const remainingBalance = String(
                tabValues.purchase_price ?? tabValues.balance_transfer_purchase_price ?? "",
            ).trim();
            if (remainingBalance) {
                const layoutKey = String(row.template?.layoutKey ?? "").trim().toLowerCase();
                const templateName = String(row.template?.name ?? "").toLowerCase();
                const isBalanceTransfer =
                    layoutKey === "balance_transfer" ||
                    layoutKey.endsWith("_balance_transfer") ||
                    templateName.includes("balance transfer");
                if (isBalanceTransfer) {
                    tabValues.purchase_price = remainingBalance;
                    tabValues.balance_transfer_purchase_price = remainingBalance;
                }
            }

            let nextBlob: Record<string, Record<string, string>> = {
                ...existingBlob,
                ...documentTemplatePrefillByMappingId,
                [row.id]: tabValues,
            };

            // Extra Exhibit C copies: write only this mapping + entity slot.
            // Do not push bank/DBA into sibling mappings or main ACH columns.
            if (isolateExhibitCInstance) {
                const existingEntities = exhibitCEntitiesFromPrefill(rawOverrides);
                const entityForSlot = exhibitCEntityFromTabValues(
                    tabValues,
                    existingEntities[exhibitCEntityIndex] ?? null,
                );
                const exhibitCSerialized = serializeExhibitCEntities(
                    upsertExhibitCEntityAtIndex(existingEntities, exhibitCEntityIndex, entityForSlot),
                );
                const main = { ...rawOverrides } as Record<string, unknown>;
                delete main[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
                delete main[DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY];
                if (exhibitCSerialized) {
                    main[EXHIBIT_C_ENTITIES_PREFILL_KEY] = exhibitCSerialized;
                } else {
                    delete main[EXHIBIT_C_ENTITIES_PREFILL_KEY];
                }
                const contractPrefillOverrides: Record<string, unknown> = {
                    ...main,
                    [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: nextBlob,
                    ...(Object.keys(envelopeBlob).length
                        ? { [DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY]: envelopeBlob }
                        : {}),
                };
                const result = await dispatch(
                    updateContract({
                        id: cid,
                        data: { contractPrefillOverrides },
                    }),
                ).unwrap();
                const savedPayload =
                    (result as { data?: Record<string, unknown> })?.data ?? result;
                const savedOverrides =
                    savedPayload &&
                    typeof savedPayload === "object" &&
                    "contractPrefillOverrides" in savedPayload
                        ? (savedPayload as { contractPrefillOverrides?: unknown })
                              .contractPrefillOverrides
                        : contractPrefillOverrides;
                toast.success("Exhibit C prefill saved (this copy only).");
                onSaved({
                    tabValues,
                    contractPrefillOverrides: savedOverrides,
                });
                onOpenChange(false);
                return;
            }

            const sharedBank = mergeSharedBankDetails(
                extractSharedBankDetailsFromRecord(contractRecords?.bankDetail ?? null),
                extractSharedBankDetailsFromRecord(
                    (contractRecords?.ach as Record<string, unknown> | null) ?? null,
                ),
                extractSharedBankDetailsFromTabValues(tabValues),
            );
            if (hasSharedBankDetails(sharedBank)) {
                Object.assign(tabValues, applySharedBankDetailsToTabValues(tabValues, sharedBank));
                nextBlob[row.id] = tabValues;
            }

            // Every Exhibit C tab on the contract, not only the ones in the current
            // send selection: a funder's copy (Obsidian's, stored as a bare SignNow
            // id) can be missing from that list, and its tab then took this
            // addendum's DBA / bank.
            const copyIds = Array.from(
                new Set([
                    ...(exhibitCCopyMappingIds ?? []),
                    ...(await fetchExhibitCCopyMappingIds(cid)),
                ]),
            );
            const sharedDba = resolveSharedDbaValue({
                mainPrefill: { ...(mainPrefillOverrides ?? {}), ...tabValues },
                contract: resolvedContract,
                mappingBlobs: omitMappingBlobIds(
                    {
                        ...existingBlob,
                        ...documentTemplatePrefillByMappingId,
                        [row.id]: tabValues,
                    },
                    copyIds,
                ),
            });
            // Extra Exhibit C copies keep their own entity's DBA / bank untouched.
            const isolatedCopyRows = Object.fromEntries(
                copyIds
                    .filter((id) => id !== row.id && nextBlob[id])
                    .map((id) => [id, nextBlob[id]] as const),
            );
            if (sharedDba) {
                nextBlob = applySharedDbaToMappingBlob(nextBlob, sharedDba);
                nextBlob[row.id] = applySharedDbaToFieldValues(tabValues, sharedDba);
            }
            if (hasSharedBankDetails(sharedBank)) {
                nextBlob = applySharedBankDetailsToMappingBlob(nextBlob, sharedBank);
            }
            nextBlob = { ...nextBlob, ...isolatedCopyRows };

            const achCamel = coordinateLayout ? achTabValuesToCamelPartial(tabValues) : null;
            const bankCamel = hasSharedBankDetails(sharedBank)
                ? sharedBankToCamelPartial(sharedBank)
                : null;
            if (coordinateLayout && achCamel) {
                // Survive synthetic → real mapping id swaps.
                nextBlob = {
                    ...nextBlob,
                    [ACH_PREFILL_MAPPING_ALIAS_KEY]: tabValues,
                };
            }

            // Exhibit C entities are left as they are: this is another document's
            // tab, and rebuilding slot 0 from it is what overwrote Exhibit C #1.
            const main = { ...rawOverrides } as Record<string, unknown>;
            delete main[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
            delete main[DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY];

            const contractPrefillOverrides: Record<string, unknown> = {
                ...main,
                ...(achCamel ?? {}),
                ...(bankCamel ?? {}),
                ...(sharedDba
                    ? {
                          doingBusinessAs: sharedDba,
                          achAuthorizationAccountHolderDba: sharedDba,
                      }
                    : {}),
                ...extractOnlineBankingFromTabValues(tabValues),
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: nextBlob,
                ...(Object.keys(envelopeBlob).length
                    ? { [DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY]: envelopeBlob }
                    : {}),
            };

            const columnSync: Record<string, string> = {};
            const columnSource = { ...(achCamel ?? {}), ...(bankCamel ?? {}) };
            for (const key of CONTRACT_PREFILL_COLUMN_SYNC_KEYS) {
                if (!(key in columnSource)) continue;
                columnSync[key] = String(columnSource[key] ?? "");
            }

            const result = await dispatch(
                updateContract({
                    id: cid,
                    data: {
                        contractPrefillOverrides,
                        ...columnSync,
                    },
                }),
            ).unwrap();
            const savedPayload = (result as { data?: Record<string, unknown> })?.data ?? result;
            const savedOverrides =
                savedPayload &&
                typeof savedPayload === "object" &&
                "contractPrefillOverrides" in savedPayload
                    ? (savedPayload as { contractPrefillOverrides?: unknown }).contractPrefillOverrides
                    : contractPrefillOverrides;

            const achPatchSource = coordinateLayout ? achCamel : null;
            if (achPatchSource) {
                const achId = Number(
                    (contractRecords?.ach as { id?: unknown } | null | undefined)?.id,
                );
                if (Number.isFinite(achId) && achId > 0) {
                    const achPatch = achCamelPartialToAchRecordPatch(achPatchSource);
                    const hasAchData = Object.values(achPatch).some(Boolean);
                    const achRow =
                        (contractRecords?.ach as Record<string, unknown> | null | undefined) ??
                        null;
                    const achChanged = Object.entries(achPatch).some(([key, value]) => {
                        if (!value) return false;
                        return String(achRow?.[key] ?? "").trim() !== String(value).trim();
                    });
                    if (hasAchData && achChanged) {
                        try {
                            await dispatch(
                                updateACH({ id: achId, data: achPatch }),
                            ).unwrap();
                        } catch (achErr) {
                            console.warn("[ACH] Failed to sync Info Required ACH row:", achErr);
                        }
                    }
                }
            }

            const existingBank = mergeSharedBankDetails(
                extractSharedBankDetailsFromRecord(contractRecords?.bankDetail ?? null),
                extractSharedBankDetailsFromRecord(
                    (contractRecords?.ach as Record<string, unknown> | null) ?? null,
                ),
            );
            const bankChanged =
                Boolean(bankCamel) &&
                hasSharedBankDetails(sharedBank) &&
                (sharedBank.bankName !== existingBank.bankName ||
                    sharedBank.routingNumber !== existingBank.routingNumber ||
                    sharedBank.accountNumber !== existingBank.accountNumber);
            if (bankChanged && bankCamel) {
                try {
                    await upsertApplicationBankDetailFromPrefill({
                        dispatch,
                        applicationUuid,
                        applicationData,
                        prefill: bankCamel,
                        bankDetail: (contractRecords?.bankDetail as Record<string, unknown> | null) ?? null,
                    });
                } catch (bankErr) {
                    console.warn("[Bank] Failed to persist shared bank details:", bankErr);
                }
            }

            toast.success(
                coordinateLayout
                    ? "ACH form field values saved."
                    : "Template mapping saved.",
            );
            onSaved({
                tabValues: coordinateLayout ? tabValues : undefined,
                contractPrefillOverrides: savedOverrides ?? contractPrefillOverrides,
            });
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
        resolvedContract,
        contractRecords,
        dispatch,
        applicationUuid,
        applicationData,
        onSaved,
        onOpenChange,
        isolateExhibitCInstance,
        exhibitCEntityIndex,
        exhibitCCopyMappingIds,
    ]);

    const overrideTitle = String(titleSuffix ?? "").trim();
    const titleName = overrideTitle
        ? overrideTitle
        : isAchDailyRow
          ? "ACH Daily"
          : row?.template?.name?.trim()
            ? row.template.name
            : coordinateLayout
              ? "ACH authorization"
              : row?.template?.templateId || "DocuSign template";

    const dialogTitle = coordinateLayout
        ? `Edit ACH form — ${titleName}`
        : isAchDailyRow
          ? `Edit ACH Daily — ${titleName}`
          : `Edit template mapping — ${titleName}`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[90vh] w-[min(100vw-2rem,960px)] flex-col gap-0 p-0 sm:max-w-[960px]"
                onOpenAutoFocus={(e: any) => e.preventDefault()}
            >
                <DialogHeader className="shrink-0 border-b px-6 py-4">
                    <DialogTitle className="text-base">{dialogTitle}</DialogTitle>
                    {!coordinateLayout ? (
                        <p className="text-muted-foreground text-sm font-normal leading-snug">
                            {isAchDailyRow
                                ? "ACH Daily has its own prefilled data, taken from this deal's ACH and bank records. It shares only the SignNow widget names with Exhibit C, so Exhibit C's account holder and bank never appear here. Edits apply only to this ACH Daily document."
                                : isExhibitCRow
                                  ? "All Exhibit C copies use the same field map. Prefill comes from this copy’s entity (send-order Exhibit C / Exhibit C (2) / …) — not from other copies or stale mapping text."
                                  : "Adjust field values used when prefilling this document. Bank name, routing, and account are stored on the application and auto-filled on every contract document."}
                        </p>
                    ) : null}
                </DialogHeader>
                <div className="max-h-[min(65vh,520px)] overflow-y-auto px-6 py-4">
                    <div className="space-y-4">
                        {editorRows.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                No registered field map for this template. For state disclosures, set
                                BoldSignTemplate{" "}
                                <span className="font-mono text-xs">type=disclosure</span> with{" "}
                                <span className="font-mono text-xs">state</span> (e.g.{" "}
                                <span className="font-mono text-xs">florida</span>) and{" "}
                                <span className="font-mono text-xs">frequency</span> (
                                <span className="font-mono text-xs">daily</span> /{" "}
                                <span className="font-mono text-xs">weekly</span>), or name like{" "}
                                <span className="font-mono text-xs">daily_florida</span>. For ACH, ensure{" "}
                                <span className="font-mono text-xs">type=ach</span> or a layout key containing{" "}
                                <span className="font-mono text-xs">ach_authorization</span>.
                            </p>
                        ) : (
                            <div className="space-y-5">
                                {groupedEditorRows.map((group, groupIndex) => (
                                    <div
                                        key={`${groupIndex}-${group.key || "ungrouped"}`}
                                        className="space-y-3"
                                    >
                                        {group.label ? (
                                            <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                                                {group.label}
                                            </p>
                                        ) : null}
                                        {(() => {
                                            const { installmentRows, otherRows } =
                                                splitFlexInstallmentRows(group.rows);
                                            return (
                                                <>
                                                    {installmentRows.length > 0 ? (
                                                        <FlexAddendumInstallmentGrid
                                                            rows={installmentRows}
                                                            values={fieldValues}
                                                            idPrefix="tmpl-field-"
                                                            onChange={(id, next) =>
                                                                setFieldValues((prev) =>
                                                                    syncSiblingBankFields(prev, id, next),
                                                                )
                                                            }
                                                        />
                                                    ) : null}
                                                    {otherRows.length > 0 ? (
                                                        <div className="grid gap-3 sm:grid-cols-2">
                                                            {otherRows.map((r) => (
                                                                <div key={r.id} className="space-y-1.5">
                                                                    <Label
                                                                        htmlFor={`tmpl-field-${r.id}`}
                                                                        className="text-xs font-medium"
                                                                    >
                                                                        {r.label}
                                                                    </Label>
                                                                    <Input
                                                                        id={`tmpl-field-${r.id}`}
                                                                        value={fieldValues[r.id] ?? ""}
                                                                        onChange={(e) => {
                                                                            const next = e.target.value;
                                                                            setFieldValues((prev) =>
                                                                                syncSiblingBankFields(
                                                                                    prev,
                                                                                    r.id,
                                                                                    next,
                                                                                ),
                                                                            );
                                                                        }}
                                                                    />
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                </>
                                            );
                                        })()}
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
