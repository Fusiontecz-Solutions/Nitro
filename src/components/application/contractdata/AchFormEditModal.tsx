import { useCallback, useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import {
    applyLiveBankDetailsToPrefillMerge,
    finalizeContractPrefillMoneyFields,
    getContractPrefillEditDefaultsFromApplication,
    normalizeContractPrefillOverrides,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
} from "./Contract";
import { DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY } from "./documentTemplateMappingPrefill";
import { ACH_FORM_FLAT_FIELDS, ACH_FORM_FLAT_FIELD_KEYS } from "./achFormEditConfig";

type LegacySnakeCasePrefillKey =
    | "ach_authorization_bank_portal_website"
    | "ach_authorization_username"
    | "ach_authorization_password"
    | "ach_authorization_security_question1"
    | "ach_authorization_security_answer1"
    | "ach_authorization_security_question2"
    | "ach_authorization_security_answer2"
    | "ach_authorization_security_question3"
    | "ach_authorization_security_answer3"
    | "ach_authorization_other_infomation";
type ContractPrefillFormFieldKey = Exclude<keyof BuildContractPrefillFieldsArgs, LegacySnakeCasePrefillKey>;

type FieldErrors = Partial<Record<keyof BuildContractPrefillFieldsArgs, string>>;

function emptyValuesRecord(): Record<keyof BuildContractPrefillFieldsArgs, string> {
    const out = {} as Record<keyof BuildContractPrefillFieldsArgs, string>;
    for (const field of ACH_FORM_FLAT_FIELDS) {
        out[field.key] = "";
    }
    return out;
}

function mergeFormState(
    base: Partial<BuildContractPrefillFieldsArgs>,
): Record<keyof BuildContractPrefillFieldsArgs, string> {
    const rec = emptyValuesRecord();
    for (const field of ACH_FORM_FLAT_FIELDS) {
        const v = base[field.key];
        rec[field.key] = v === undefined || v === null ? "" : String(v);
    }
    return rec;
}

function toPayload(
    values: Record<keyof BuildContractPrefillFieldsArgs, string>,
): Partial<BuildContractPrefillFieldsArgs> {
    const out: Partial<BuildContractPrefillFieldsArgs> = {};
    for (const field of ACH_FORM_FLAT_FIELDS) {
        (out as Record<string, string>)[field.key] = values[field.key] ?? "";
    }
    return out;
}

function parsePositiveContractId(id: number | string | null | undefined): number | null {
    if (id === null || id === undefined) return null;
    const n = typeof id === "number" ? id : Number(String(id).trim());
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
    return n;
}

function trimField(
    values: Record<keyof BuildContractPrefillFieldsArgs, string>,
    key: keyof BuildContractPrefillFieldsArgs,
) {
    return String(values[key] ?? "").trim();
}

function validateAchFields(
    values: Record<keyof BuildContractPrefillFieldsArgs, string>,
): FieldErrors {
    const err: FieldErrors = {};

    const validatePhone = (value: string): string | null => {
        if (!value) return null;
        const digits = value.replace(/\D/g, "");
        return digits.length >= 10 ? null : "Enter a phone number with at least 10 digits.";
    };
    const validateEin = (value: string): string | null => {
        if (!value) return null;
        const digits = value.replace(/\D/g, "");
        return digits.length === 9 ? null : "EIN / tax ID must be 9 digits.";
    };
    const validateRouting = (value: string): string | null => {
        if (!value) return null;
        const digits = value.replace(/\D/g, "");
        return digits.length === 9 ? null : "Routing number must be exactly 9 digits.";
    };
    const validateUsZip = (value: string): string | null => {
        if (!value) return null;
        return /^\d{5}(-\d{4})?$/.test(value) ? null : "Use 12345 or 12345-6789 for ZIP.";
    };
    const validateMoney = (value: string): string | null => {
        if (!value) return null;
        const cleaned = String(value).replace(/[^0-9.-]/g, "");
        if (cleaned === "" || cleaned === "-" || cleaned === ".") return "Enter a valid number.";
        const n = Number(cleaned);
        return Number.isFinite(n) ? null : "Enter a valid number.";
    };
    const validateTwoLetterState = (value: string): string | null => {
        if (value.length !== 2) return null;
        return /^[A-Za-z]{2}$/.test(value) ? null : "Use a two-letter state code.";
    };

    const phoneKeys: (keyof BuildContractPrefillFieldsArgs)[] = [
        "achAuthorizationAccountHolderPhone",
        "authorizedBusinessPhone",
    ];
    const routingKeys: (keyof BuildContractPrefillFieldsArgs)[] = [
        "achAuthorizationAccountHolderBankRoutingNumber",
        "authorizationClientBankRouting",
    ];
    const zipKeys: (keyof BuildContractPrefillFieldsArgs)[] = [
        "achAuthorizationAccountHolderZip",
        "achAuthorizationAccountHolderBankZip",
    ];
    const stateKeys: (keyof BuildContractPrefillFieldsArgs)[] = [
        "achAuthorizationAccountHolderState",
        "achAuthorizationAccountHolderBankState",
    ];

    for (const key of phoneKeys) {
        if (!ACH_FORM_FLAT_FIELD_KEYS.has(key)) continue;
        const msg = validatePhone(trimField(values, key));
        if (msg) err[key] = msg;
    }
    if (ACH_FORM_FLAT_FIELD_KEYS.has("authorizationClientTaxId")) {
        const msg = validateEin(trimField(values, "authorizationClientTaxId"));
        if (msg) err.authorizationClientTaxId = msg;
    }
    for (const key of routingKeys) {
        if (!ACH_FORM_FLAT_FIELD_KEYS.has(key)) continue;
        const msg = validateRouting(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of zipKeys) {
        if (!ACH_FORM_FLAT_FIELD_KEYS.has(key)) continue;
        const msg = validateUsZip(trimField(values, key));
        if (msg) err[key] = msg;
    }
    if (ACH_FORM_FLAT_FIELD_KEYS.has("achAuthorizationAccountHolderBankTransactionFee")) {
        const msg = validateMoney(trimField(values, "achAuthorizationAccountHolderBankTransactionFee"));
        if (msg) err.achAuthorizationAccountHolderBankTransactionFee = msg;
    }
    if (ACH_FORM_FLAT_FIELD_KEYS.has("achAuthorizationAccountHolderBankNumberOfTransactions")) {
        const raw = trimField(values, "achAuthorizationAccountHolderBankNumberOfTransactions");
        if (raw && !/^\d+$/.test(raw.replace(/\s/g, ""))) {
            err.achAuthorizationAccountHolderBankNumberOfTransactions =
                "Enter a whole number (term of offer / payment count).";
        }
    }
    for (const key of stateKeys) {
        if (!ACH_FORM_FLAT_FIELD_KEYS.has(key)) continue;
        const msg = validateTwoLetterState(trimField(values, key));
        if (msg) err[key] = msg;
    }

    return err;
}

function isPasswordKey(key: keyof BuildContractPrefillFieldsArgs): boolean {
    return key === "achAuthorizationPassword";
}

export type AchFormEditModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    templateLabel: string;
    applicationData: unknown;
    contractId: number | string | null;
    applicationUuid?: string | null;
    persistedPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    prefillOverridesReady?: boolean;
    contractRecords?: ContractPrefillContractRecords;
    offerDecision?: Record<string, unknown> | null;
    agreementDatePlaceholder?: string;
    readOnly?: boolean;
    additionalContractPrefillJson?: Record<string, unknown> | null;
    onSaved?: (next: Partial<BuildContractPrefillFieldsArgs> | null) => void;
    onReloadContract?: () => Promise<unknown>;
};

export function AchFormEditModal({
    open,
    onOpenChange,
    templateLabel,
    applicationData,
    contractId,
    applicationUuid = null,
    persistedPrefillOverrides,
    prefillOverridesReady = true,
    contractRecords,
    offerDecision = null,
    agreementDatePlaceholder = "",
    readOnly = false,
    additionalContractPrefillJson = null,
    onSaved,
    onReloadContract,
}: AchFormEditModalProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [values, setValues] = useState<Record<keyof BuildContractPrefillFieldsArgs, string>>(
        emptyValuesRecord,
    );
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const hydratePersistAfterLoadRef = useRef(false);

    const resetFromSources = useCallback(() => {
        const defaults = getContractPrefillEditDefaultsFromApplication(applicationData, {
            agreementDate: agreementDatePlaceholder,
            contractRecords,
            offerDecision,
        });
        const persisted =
            persistedPrefillOverrides === undefined
                ? ({} as Partial<BuildContractPrefillFieldsArgs>)
                : (normalizeContractPrefillOverrides(persistedPrefillOverrides) ??
                  ({} as Partial<BuildContractPrefillFieldsArgs>));
        const merged = applyLiveBankDetailsToPrefillMerge(
            defaults,
            finalizeContractPrefillMoneyFields(
                { ...defaults, ...persisted },
                {
                    application: applicationData as Record<string, unknown> | undefined,
                    contract: contractRecords?.contract ?? null,
                    offerDecision: offerDecision ?? null,
                },
            ),
        );
        setValues(mergeFormState(merged));
        setFieldErrors({});
    }, [
        applicationData,
        contractRecords,
        agreementDatePlaceholder,
        persistedPrefillOverrides,
        offerDecision,
    ]);

    const resetFromSourcesRef = useRef(resetFromSources);
    resetFromSourcesRef.current = resetFromSources;

    useEffect(() => {
        if (!open) {
            hydratePersistAfterLoadRef.current = false;
            return;
        }
        hydratePersistAfterLoadRef.current =
            !prefillOverridesReady || persistedPrefillOverrides === undefined;
        resetFromSourcesRef.current();
    }, [open]);

    useEffect(() => {
        if (
            !open ||
            !prefillOverridesReady ||
            persistedPrefillOverrides === undefined ||
            !hydratePersistAfterLoadRef.current
        ) {
            return;
        }
        hydratePersistAfterLoadRef.current = false;
        resetFromSourcesRef.current();
    }, [open, prefillOverridesReady, persistedPrefillOverrides]);

    useEffect(() => {
        if (!open) setFieldErrors({});
    }, [open]);

    const setField = (key: ContractPrefillFormFieldKey, v: string) => {
        setValues((prev) => ({ ...prev, [key]: v }));
        setFieldErrors((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const handleSave = async () => {
        const cid = parsePositiveContractId(contractId);
        if (cid == null) {
            toast.error("Cannot save: open or create a contract for this application first.");
            return;
        }
        const validation = validateAchFields(values);
        if (Object.keys(validation).length > 0) {
            setFieldErrors(validation);
            const count = Object.keys(validation).length;
            toast.error(
                count === 1
                    ? "Fix the highlighted field, then save again."
                    : `Fix ${count} highlighted fields, then save again.`,
            );
            return;
        }
        setFieldErrors({});
        setSaving(true);
        try {
            const payload = toPayload(values);
            const existingBlob =
                additionalContractPrefillJson &&
                typeof additionalContractPrefillJson === "object" &&
                !Array.isArray(additionalContractPrefillJson) &&
                additionalContractPrefillJson[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] != null &&
                typeof additionalContractPrefillJson[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] ===
                    "object"
                    ? {
                          ...(additionalContractPrefillJson[
                              DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY
                          ] as Record<string, Record<string, string>>),
                      }
                    : {};
            const existingFull =
                additionalContractPrefillJson &&
                typeof additionalContractPrefillJson === "object" &&
                !Array.isArray(additionalContractPrefillJson)
                    ? { ...(additionalContractPrefillJson as Record<string, unknown>) }
                    : {};
            const contractPrefillOverrides: Record<string, unknown> = {
                ...existingFull,
                ...(payload as Record<string, unknown>),
            };
            if (Object.keys(existingBlob).length > 0) {
                contractPrefillOverrides[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] = existingBlob;
            }
            await dispatch(
                updateContract({
                    id: cid,
                    data: { contractPrefillOverrides },
                }),
            ).unwrap();
            onSaved?.(payload);
            if (applicationUuid) {
                try {
                    await dispatch(getByApplicationIdContract(String(applicationUuid))).unwrap();
                } catch {
                    /* ignore */
                }
            }
            await onReloadContract?.();
            toast.success("ACH form fields saved.");
            onOpenChange(false);
        } catch (e) {
            console.error(e);
            toast.error("Failed to save ACH form fields.");
        } finally {
            setSaving(false);
        }
    };

    const titleSuffix = String(templateLabel ?? "").trim() || "ACH Authorization";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[92vh] w-[min(100vw-2rem,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]"
                onOpenAutoFocus={(e: Event) => e.preventDefault()}
            >
                <DialogHeader className="shrink-0 border-b border-slate-200 px-6 py-4 dark:border-slate-700">
                    <DialogTitle className="text-left text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
                        Edit ACH form — {titleSuffix.toUpperCase()}
                    </DialogTitle>
                </DialogHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        {ACH_FORM_FLAT_FIELDS.map((field) => (
                            <div key={field.key} className="space-y-1.5">
                                <Label
                                    htmlFor={`ach-edit-${field.key}`}
                                    className="text-xs font-medium text-slate-600 dark:text-slate-400"
                                >
                                    {field.label}
                                </Label>
                                <Input
                                    id={`ach-edit-${field.key}`}
                                    type={isPasswordKey(field.key) ? "password" : "text"}
                                    autoComplete={
                                        isPasswordKey(field.key) ? "new-password" : undefined
                                    }
                                    value={values[field.key] ?? ""}
                                    onChange={(e) => setField(field.key, e.target.value)}
                                    disabled={readOnly}
                                    aria-invalid={Boolean(fieldErrors[field.key])}
                                    className={cn(
                                        "h-9 bg-slate-50 text-sm dark:bg-slate-900",
                                        fieldErrors[field.key] &&
                                            "border-destructive focus-visible:ring-destructive",
                                    )}
                                />
                                {fieldErrors[field.key] ? (
                                    <p className="text-destructive text-xs" role="alert">
                                        {fieldErrors[field.key]}
                                    </p>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>

                <DialogFooter className="shrink-0 gap-2 border-t border-slate-200 px-6 py-4 sm:justify-end dark:border-slate-700">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    {!readOnly ? (
                        <Button
                            type="button"
                            className="bg-[#276D9C] text-white hover:bg-[#276D9C]/90"
                            onClick={() => void handleSave()}
                            disabled={saving || parsePositiveContractId(contractId) == null}
                        >
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
