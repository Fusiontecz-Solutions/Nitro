import { forwardRef, useEffect, useRef, useState, type ComponentProps } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTheme } from "@/context/ThemeContext";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { updateApplicationQueue, updateApplication, sendApprovalEmail } from "@/redux/actions/applicationActions";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import { notifyFinalUnderwriterOnAssignment } from "@/redux/actions/notificationActions";
import { axiosGet, axiosPost } from "@/redux/axios";
import { toast } from "react-toastify";
import {
    formatFactorRateUS,
    formatNumberUS,
    formatNumberUSForInput,
    parseNumberUS,
} from "@/lib/utils";
} from "@/lib/utils";
import {
    deriveOfferRepaymentStack,
    type OfferRepaymentStack,
} from "@/lib/offerRepaymentCalculations";
import { emitOfferDecisionUpdated } from "@/lib/offerDecisionSync";
import { feesPercentToDollarsFromFunded } from "@/lib/offerDecisionFees";
import { DollarSign, Pencil } from "lucide-react";
import ComplianceChecksQuestionnaire, {
    type ComplianceChecksProgress,
} from "./ComplianceChecksQuestionnaire";
import { getComplianceChecks } from "@/redux/actions/complianceCheckActions";
import AgentDealIsoTag from "./AgentDealIsoTag";

const ORIGINATION_FEE_FIXED = "10";

interface ApprovalFormValues {
    requestAmount: string;
    tenure: string;
    paybackAmount: string;
    originationFee: string;
    approvedAmount: string;
    factorRate: string;
    repay: string;
    monthlyRepayment: string;
    achFrequency: string;
}

/** Label for the term count field that mirrors tenure (e.g. Daily → "For day"). */
function getFrequencyPeriodLabel(frequency: string): string {
    switch (frequency) {
        case "Weekly":
            return "For week";
        case "Bi-Weekly":
            return "For bi-week";
        case "Monthly":
            return "For month";
        default:
            return "For day";
    }
}

function parseTermFromTenure(tenure: string): string | null {
    const t = tenure.trim();
    if (!t) return null;
    const match = t.match(/^(\d+)/);
    return match ? match[1] : t;
}

/** Currency display: full calculated value with thousands separators and .00 cents. */
function formatMoneyField(value: unknown): string {
    if (value === null || value === undefined || value === "") return "";
    const num = typeof value === "number" ? value : parseNumberUS(value);
    if (!Number.isFinite(num) || num <= 0) return "";
    return formatNumberUS(num);
}

function stackToCalculatedFormFields(stack: OfferRepaymentStack): Pick<
    ApprovalFormValues,
    "paybackAmount" | "repay" | "monthlyRepayment"
> {
    return {
        paybackAmount: formatMoneyField(stack.payback),
        repay: formatMoneyField(stack.perPeriodPayment),
        monthlyRepayment: formatMoneyField(stack.monthlyPayment),
    };
}

/**
 * Payback / repay / monthly from current offer drivers only.
 * Payback = offer × rate; repay = payback ÷ term; monthly from frequency (OfferDecisionToggle).
 */
function deriveCalculatedFieldsFromDrivers(values: {
    approvedAmount: string;
    factorRate: string;
    tenure: string;
    achFrequency: string;
}): Pick<ApprovalFormValues, "paybackAmount" | "repay" | "monthlyRepayment"> | null {
    const termStr = parseTermFromTenure(values.tenure) ?? "";
    if (!termStr) return null;

    const stack = deriveOfferRepaymentStack({
        advance: parseNumberUS(values.approvedAmount),
        factorRate: parseNumberUS(values.factorRate),
        term: termStr,
        frequency: values.achFrequency || "Daily",
    });
    if (!stack) return null;
    return stackToCalculatedFormFields(stack);
}

function applyCalculatedFieldsToStack(
    apiOffer: unknown,
    apiRate: unknown,
    termLabel: string,
    frequency: string,
): Pick<ApprovalFormValues, "paybackAmount" | "repay" | "monthlyRepayment"> {
    const empty = { paybackAmount: "", repay: "", monthlyRepayment: "" };
    if (!termLabel) return empty;

    const derived = deriveCalculatedFieldsFromDrivers({
        approvedAmount:
            apiOffer != null ? formatMoneyField(apiOffer) : "",
        factorRate: apiRate != null ? formatFactorRateUS(apiRate) : "",
        tenure: termLabel,
        achFrequency: frequency,
    });
    return derived ?? empty;
}

function buildApprovalFormFromApi(
    apiData: Record<string, unknown> | null,
    loanAmount: number | null | undefined,
): ApprovalFormValues {
    const offer = apiData?.offer ?? null;
    const rate = apiData?.rate ?? null;
    const term = apiData?.term ?? null;

    const termLabel =
        term != null && String(term).trim() !== ""
            ? `${String(term).replace(/\s*payments?/i, "").trim()}`
            : "";

    const frequency = (apiData?.frequency as string) || "Daily";

    // Always derive from offer × rate (do not use totalRemit — may be leverage % or stale).
    const { paybackAmount, repay, monthlyRepayment } =
        termLabel && offer != null && rate != null
            ? applyCalculatedFieldsToStack(offer, rate, termLabel, frequency)
            : { paybackAmount: "", repay: "", monthlyRepayment: "" };

    return {
        requestAmount:
            loanAmount != null ? formatMoneyField(loanAmount) : "",
        tenure: termLabel,
        paybackAmount,
        originationFee: ORIGINATION_FEE_FIXED,
        approvedAmount: offer != null ? formatMoneyField(offer) : "",
        factorRate: rate != null ? formatFactorRateUS(rate) : "",
        repay,
        monthlyRepayment,
        achFrequency: frequency,
    };
}

function readOnlyFieldLabelClass(isDark: boolean): string {
    return `text-sm font-medium ${isDark ? "text-gray-500" : "text-gray-500"}`;
}

/** Shared control height — matches default Input (h-9) across the form grid. */
const FIELD_CONTROL_H = "h-9";

function readOnlyFieldValueClass(isDark: boolean): string {
    return `${FIELD_CONTROL_H} rounded-sm border px-3 text-sm leading-9 cursor-default select-none ${
        isDark
            ? "border-gray-700/60 bg-muted/20 text-gray-400"
            : "border-gray-200 bg-gray-100 text-gray-500"
    }`;
}

function readOnlyPlainInputClass(isDark: boolean): string {
    return `${FIELD_CONTROL_H} px-3 rounded-sm text-sm leading-9 outline-none cursor-not-allowed select-none ${
        isDark
            ? "border border-gray-700/60 bg-muted/20 text-gray-400"
            : "border border-gray-200 bg-gray-100 text-gray-500"
    }`;
}

function currencyFieldWrapperClass(isDark: boolean, muted = false): string {
    if (muted) {
        return `cursor-not-allowed select-none ${
            isDark
                ? "border border-gray-700/60 bg-muted/20 text-gray-400"
                : "border border-gray-200 bg-gray-100 text-gray-500"
        }`;
    }
    return isDark
        ? "border border-gray-700 bg-muted text-gray-200"
        : "border border-gray-200 bg-white text-gray-900";
}

/** Lucide dollar icon — readable in light/dark; softer when field is muted (calculated/read-only). */
function dollarIconClass(isDark: boolean, muted = false): string {
    if (muted) {
        return isDark ? "text-gray-500" : "text-gray-400";
    }
    return isDark ? "text-gray-400" : "text-gray-500";
}

/** Compact icon column — no extra padding; keeps row height aligned with other fields. */
const CURRENCY_ICON_SLOT_W = "w-7 shrink-0";

function DollarSignIcon({
    isDark,
    muted = false,
    className,
}: {
    isDark: boolean;
    muted?: boolean;
    className?: string;
}) {
    return (
        <DollarSign
            className={`h-3.5 w-3.5 shrink-0 ${dollarIconClass(isDark, muted)} ${className ?? ""}`}
            strokeWidth={2}
            aria-hidden
        />
    );
}

function ReadOnlyDetailField({
    label,
    value,
    required,
    isDark,
    prefix,
    /** When false, uses full-contrast styling (e.g. required fields user may edit after clicking Edit). */
    muted = true,
    /** Shows a leading $ for dollar amount fields. */
    currency = false,
}: {
    label: string;
    value: string;
    required?: boolean;
    isDark: boolean;
    prefix?: string;
    muted?: boolean;
    currency?: boolean;
}) {
    const hasValue = Boolean(value?.trim());
    const display = hasValue ? `${prefix ?? ""}${value}` : "—";
    const labelClass = muted
        ? readOnlyFieldLabelClass(isDark)
        : `text-sm font-medium ${isDark ? "text-gray-300" : "text-black"}`;
    const valueClass = muted
        ? readOnlyFieldValueClass(isDark)
        : `${FIELD_CONTROL_H} rounded-sm border px-3 text-sm leading-9 ${
              isDark
                  ? "border-gray-700 bg-muted/50 text-gray-200"
                  : "border-gray-200 bg-white text-gray-900"
          }`;

    return (
        <div className="space-y-1.5">
            <Label className={labelClass}>
                {label}
                {required ? <span className="text-red-500"> *</span> : null}
            </Label>
            {currency && hasValue ? (
                <div
                    className={`${valueClass} flex ${FIELD_CONTROL_H} items-center overflow-hidden p-0 tabular-nums`}
                >
                    <span
                        className={`inline-flex ${FIELD_CONTROL_H} items-center justify-center ${CURRENCY_ICON_SLOT_W}`}
                    >
                        <DollarSignIcon isDark={isDark} muted={muted} />
                    </span>
                    <span className="min-w-0 flex-1 truncate px-2 leading-9">{display}</span>
                </div>
            ) : (
                <p className={valueClass}>{display}</p>
            )}
        </div>
    );
}

interface ApprovedApplicationModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** When true, show "Proceed to Generate Contract" and read-only details (FINAL_UNDERWRITER only) */
    isFinalUnderwriter?: boolean;
    /** Called when FINAL_UNDERWRITER clicks Proceed to Generate Contract */
    onProceedToContract?: () => void;
    /** When true, send the "offer updated" resend template to ISO. */
    resendApprovalEmail?: boolean;
    /** Called after offer-decision is saved (e.g. Final Underwriter refresh for resend-mail state). */
    onOfferUpdated?: () => void;
}

function formatCurrencyInputLive(raw: string): string {
    return formatNumberUSForInput(raw);
}

/** On blur, lock amount fields to en-US currency with two decimal places (e.g. 12,000.00). */
function formatCurrencyInputCommit(raw: string): string {
    const num = parseNumberUS(raw);
    if (!Number.isFinite(num)) return "";
    return formatNumberUS(num);
}

interface UsCurrencyInputProps extends Omit<ComponentProps<typeof Input>, "onChange" | "value"> {
    value: string;
    onChange: (next: string) => void;
    isDark?: boolean;
    /** Softer $ color for calculated / non-editable amount fields. */
    muted?: boolean;
}

const UsCurrencyInput = forwardRef<HTMLInputElement, UsCurrencyInputProps>(
    function UsCurrencyInput(
        { value, onChange, className, isDark = false, muted = false, onBlur, readOnly, ...rest },
        ref,
    ) {
        return (
            <div
                className={`flex ${FIELD_CONTROL_H} w-full min-w-0 items-center overflow-hidden rounded-sm border outline-none ${className ?? ""}`}
            >
                <span
                    className={`inline-flex ${FIELD_CONTROL_H} items-center justify-center ${CURRENCY_ICON_SLOT_W}`}
                    aria-hidden
                >
                    <DollarSignIcon isDark={isDark} muted={muted} />
                </span>
                <Input
                    {...rest}
                    ref={ref}
                    readOnly={readOnly}
                    value={value}
                    onChange={(e) => onChange(formatCurrencyInputLive(e.target.value))}
                    onBlur={(e) => {
                        onBlur?.(e);
                        const committed = formatCurrencyInputCommit(value);
                        if (committed !== value) {
                            onChange(committed);
                        }
                    }}
                    className={`${FIELD_CONTROL_H} flex-1 min-w-0 rounded-none border-0 bg-transparent py-0 pl-2 pr-3 text-sm tabular-nums shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 ${readOnly ? "cursor-default" : ""}`}
                />
            </div>
        );
    },
);

interface UsNumberInputProps extends Omit<ComponentProps<typeof Input>, "onChange" | "value"> {
    value: string;
    onChange: (next: string) => void;
}

/** Factor rate input — preserves fractional precision (not forced to .00). */
const UsRateInput = forwardRef<HTMLInputElement, UsNumberInputProps>(
    function UsRateInput({ value, onChange, className, onBlur, ...rest }, ref) {
        return (
            <Input
                {...rest}
                ref={ref}
                value={value}
                onChange={(e) => onChange(formatNumberUSForInput(e.target.value))}
                onBlur={(e) => {
                    onBlur?.(e);
                    const committed = formatRateUSCommit(value);
                    if (committed !== value) {
                        onChange(committed);
                    }
                }}
                className={className}
            />
        );
    },
);

const ApprovedApplicationModal = ({
    open,
    onOpenChange,
    isFinalUnderwriter,
    onProceedToContract,
    resendApprovalEmail,
    onOfferUpdated,
}: ApprovedApplicationModalProps) => {
    const dispatch = useDispatch<AppDispatch>();
    const { data: applicationData } = useSelector((state: RootState) => state.applicationDetail);
    const { data: loginData } = useSelector((state: RootState) => state.login);

    const { control, handleSubmit, formState: { errors }, reset, setValue, getValues } = useForm<ApprovalFormValues>({
        mode: "onSubmit",
        defaultValues: {
            requestAmount: "",
            tenure: "",
            paybackAmount: "",
            originationFee: ORIGINATION_FEE_FIXED,
            approvedAmount: "",
            factorRate: "",
            repay: "",
            monthlyRepayment: "",
            achFrequency: "",
        },
    });

    // Align application identifier resolution with BankAnalysis / ApplicationDetails:
    // prefer business numeric applicationId, then fall back to MongoDB _id.
    const applicationId =
        (applicationData as any)?.applicationId ??
        (applicationData as any)?._id ??
        null;
    const applicationUuid =
        (applicationData as any)?._id ??
        (applicationData as any)?.id ??
        null;

    const currentUser = (loginData as any)?.user;
    const underwriterName =
        currentUser && (currentUser.firstName || currentUser.lastName)
            ? `${currentUser.firstName || ""} ${currentUser.lastName || ""}`.trim()
            : "Underwriter";

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isUpdatingOffer, setIsUpdatingOffer] = useState(false);
    const [offerDecisionLoading, setOfferDecisionLoading] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [persistedDecision, setPersistedDecision] = useState<"approved" | "declined">("approved");
    const editSnapshotRef = useRef<ApprovalFormValues | null>(null);
    /** Fields not edited in this modal but must be preserved on offer-decision save. */
    const offerPreserveRef = useRef<{
        position: string | null;
        ourRemit: number | null;
    }>({ position: null, ourRemit: null });
    const [checksProgress, setChecksProgress] = useState<ComplianceChecksProgress>({
        completed: 0,
        total: 6,
        flagsRaised: 0,
        allComplete: false,
    });

    const complianceApplicationId =
        applicationUuid ??
        (applicationData as { applicationId?: string | number })?.applicationId?.toString() ??
        (applicationId != null ? String(applicationId) : null);

    const loadOfferDecision = async () => {
        if (!open || !applicationId) return;
        try {
            setOfferDecisionLoading(true);
            const res = await axiosGet("/offer-decisions", {
                params: { application: applicationId },
            });
            const apiData = (res.data && res.data.data) || null;

            offerPreserveRef.current = {
                position:
                    apiData?.position != null && String(apiData.position).trim() !== ""
                        ? String(apiData.position)
                        : null,
                ourRemit: (() => {
                    const n = parseNumberUS(apiData?.ourRemit);
                    return Number.isFinite(n) ? n : null;
                })(),
            };

            setPersistedDecision(
                apiData?.decision === "declined" ? "declined" : "approved",
            );

            const formValues = buildApprovalFormFromApi(
                apiData,
                applicationData?.loanAmount,
            );
            reset(formValues);
            editSnapshotRef.current = formValues;
        } catch (error) {
            console.error("Failed to load offer decision for modal:", error);
            offerPreserveRef.current = { position: null, ourRemit: null };
            const fallback = buildApprovalFormFromApi(
                null,
                applicationData?.loanAmount,
            );
            reset(fallback);
            editSnapshotRef.current = fallback;
            setPersistedDecision("approved");
        } finally {
            setOfferDecisionLoading(false);
        }
    };

    useEffect(() => {
        if (!open) {
            setIsEditMode(false);
            return;
        }
        void loadOfferDecision();
        if (!isFinalUnderwriter && complianceApplicationId) {
            dispatch(getComplianceChecks({ application: complianceApplicationId }));
        }
    }, [open, applicationId, applicationData?.loanAmount, isFinalUnderwriter, complianceApplicationId, dispatch]);

    const handleStartEdit = () => {
        editSnapshotRef.current = getValues();
        setValue("originationFee", ORIGINATION_FEE_FIXED, { shouldDirty: false });
        setIsEditMode(true);
    };

    const syncDerivedFieldsInEditMode = (drivers: {
        approvedAmount: string;
        factorRate: string;
        tenure: string;
        achFrequency: string;
    }) => {
        const derived = deriveCalculatedFieldsFromDrivers(drivers);
        const empty = { paybackAmount: "", repay: "", monthlyRepayment: "" };
        const next = derived ?? empty;

        setValue("paybackAmount", next.paybackAmount, {
            shouldDirty: true,
            shouldValidate: false,
        });
        setValue("repay", next.repay, {
            shouldDirty: true,
            shouldValidate: false,
        });
        setValue("monthlyRepayment", next.monthlyRepayment, {
            shouldDirty: true,
            shouldValidate: false,
        });
    };

    const handleCancelEdit = () => {
        if (editSnapshotRef.current) {
            reset(editSnapshotRef.current);
        }
        setIsEditMode(false);
    };

    const handleUpdateOffer = handleSubmit(async (data) => {
        if (!applicationId) {
            toast.error("Missing application id. Please reload and try again.");
            return;
        }
        setIsUpdatingOffer(true);
        const toastId = toast.loading("Updating offer details...");
        try {
            const feesDollars = feesPercentToDollarsFromFunded(
                data.approvedAmount,
                ORIGINATION_FEE_FIXED,
            );

            const offerNum = parseNumberUS(data.approvedAmount);
            const rateNum = parseNumberUS(data.factorRate);
            const termStr = parseTermFromTenure(data.tenure) ?? "";
            const repaymentStack =
                offerNum > 0 && rateNum > 0 && termStr
                    ? deriveOfferRepaymentStack({
                          advance: offerNum,
                          factorRate: rateNum,
                          term: termStr,
                          frequency: data.achFrequency || "Daily",
                      })
                    : null;

            const derivedForSave = deriveCalculatedFieldsFromDrivers({
                approvedAmount: data.approvedAmount,
                factorRate: data.factorRate,
                tenure: data.tenure,
                achFrequency: data.achFrequency,
            });

            const paybackSaved =
                repaymentStack?.payback ??
                (parseNumberUS(derivedForSave?.paybackAmount ?? data.paybackAmount) ||
                    null);

            const saveRes = await axiosPost("/offer-decisions", {
                applicationId,
                decision: persistedDecision,
                position: offerPreserveRef.current.position,
                ourRemit: offerPreserveRef.current.ourRemit,
                offer: offerNum > 0 ? offerNum : null,
                rate: rateNum > 0 ? rateNum : null,
                term: termStr || null,
                frequency: data.achFrequency || null,
                fees: feesDollars,
                totalRemit: paybackSaved,
                repayPerPeriod:
                    repaymentStack && repaymentStack.perPeriodPayment > 0
                        ? repaymentStack.perPeriodPayment
                        : null,
                monthlyPayment:
                    repaymentStack && repaymentStack.monthlyPayment > 0
                        ? repaymentStack.monthlyPayment
                        : null,
            });

            const saved = (saveRes?.data && saveRes.data.data) || null;
            if (saved) {
                offerPreserveRef.current = {
                    position:
                        saved.position != null && String(saved.position).trim() !== ""
                            ? String(saved.position)
                            : offerPreserveRef.current.position,
                    ourRemit: (() => {
                        const n = parseNumberUS(saved.ourRemit);
                        return Number.isFinite(n) ? n : offerPreserveRef.current.ourRemit;
                    })(),
                };
            }

            emitOfferDecisionUpdated(applicationId);
            await dispatch(getOfferDecisionByApplication(String(applicationId))).unwrap();
            onOfferUpdated?.();

            const refreshedDerived =
                derivedForSave ??
                (repaymentStack
                    ? stackToCalculatedFormFields(repaymentStack)
                    : null);

            const refreshed = {
                ...data,
                paybackAmount: refreshedDerived?.paybackAmount ?? data.paybackAmount,
                repay: refreshedDerived?.repay ?? data.repay,
                monthlyRepayment:
                    refreshedDerived?.monthlyRepayment ?? data.monthlyRepayment,
                originationFee: ORIGINATION_FEE_FIXED,
            };
            reset(refreshed);
            editSnapshotRef.current = refreshed;
            setIsEditMode(false);

            toast.update(toastId, {
                render: "Offer details updated successfully.",
                type: "success",
                isLoading: false,
                autoClose: 3000,
            });
        } catch (error) {
            console.error("Failed to update offer decision:", error);
            toast.update(toastId, {
                render: "Failed to update offer details. Please try again.",
                type: "error",
                isLoading: false,
                autoClose: 4000,
            });
        } finally {
            setIsUpdatingOffer(false);
        }
    });

    const onSubmit = async (data: ApprovalFormValues) => {
        if (!applicationUuid || !applicationId) {
            console.error("No application ID available");
            onOpenChange(false);
            return;
        }
        if (!checksProgress.allComplete) {
            toast.error(
                `Please complete all compliance checks (${checksProgress.completed} of ${checksProgress.total} answered).`,
            );
            return;
        }
        setIsSubmitting(true);
        const toastId = toast.loading("Sending application to Final Underwriter...");
        try {
            await dispatch(updateApplicationQueue({
                id: applicationUuid,
                data: { currentQueue: "Final Underwriter" },
            })).unwrap();
            await dispatch(updateApplication({
                id: applicationUuid,
                data: {
                    status: "Sent to Final Underwriter",
                    underwriterApproval: true,
                    approvedAt: new Date().toISOString(),
                },
            })).unwrap();

            // Trigger in-app + email notification for Final Underwriter
            try {
                await dispatch(
                    notifyFinalUnderwriterOnAssignment({
                        applicationId,
                        underwriterName,
                    })
                ).unwrap();
            } catch (notifyError) {
                console.error("Failed to notify Final Underwriter:", notifyError);
            }

            toast.update(toastId, {
                render: "Application has been sent to Final Underwriter and they have been notified.",
                type: "success",
                isLoading: false,
                autoClose: 3000,
            });
            onOpenChange(false);
        } catch (err) {
            console.error("Failed to send to Final Underwriter:", err);
            toast.update(toastId, {
                render: "Failed to send application to Final Underwriter. Please try again.",
                type: "error",
                isLoading: false,
                autoClose: 4000,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";

    const inputClass = `${FIELD_CONTROL_H} ${isDark ? "bg-muted border-gray-700 text-gray-200" : "bg-white border-gray-200"} px-3 py-0 text-sm rounded-sm outline-none`;

    const loanFieldsGridClass = isFinalUnderwriter
        ? "grid grid-cols-2 gap-x-4 gap-y-3"
        : "grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4";

    const loanDetailsPanelClass = isFinalUnderwriter
        ? `${isDark ? "bg-[#262827]" : "bg-green-50"} p-4 rounded-lg`
        : `${isDark ? "bg-[#262827]" : "bg-green-50"} p-6 rounded-lg`;

    const formValues = useWatch({ control });
    const watchedApprovedAmount = useWatch({ control, name: "approvedAmount" });
    const watchedFactorRate = useWatch({ control, name: "factorRate" });
    const watchedTenure = useWatch({ control, name: "tenure" });
    const watchedAchFrequency = useWatch({ control, name: "achFrequency" });

    useEffect(() => {
        if (!isEditMode) return;

        syncDerivedFieldsInEditMode({
            approvedAmount: watchedApprovedAmount ?? "",
            factorRate: watchedFactorRate ?? "",
            tenure: watchedTenure ?? "",
            achFrequency: watchedAchFrequency ?? "",
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only recalc when user-editable drivers change
    }, [
        isEditMode,
        watchedApprovedAmount,
        watchedFactorRate,
        watchedTenure,
        watchedAchFrequency,
    ]);

    const frequencyPeriodLabel = getFrequencyPeriodLabel(
        formValues.achFrequency ?? watchedAchFrequency ?? "",
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className={
                    isFinalUnderwriter
                        ? "sm:max-w-2xl w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto flex flex-col gap-3"
                        : "sm:max-w-6xl max-h-[min(88vh,780px)] overflow-hidden flex flex-col"
                }
            >
                <DialogHeader>
                    <DialogTitle className={`text-xl font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                        {isFinalUnderwriter ? "Approved Application" : "Send application to Final-underwriter"}
                    </DialogTitle>
                    <DialogDescription className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        {isFinalUnderwriter
                            ? "Review loan terms, update the offer if needed, then send the approval email to the ISO."
                            : "Review loan terms, complete compliance checks, then send this application to the Final Underwriter."}
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                    {isFinalUnderwriter ? (
                        <AgentDealIsoTag
                            applicationId={
                                applicationId != null ? String(applicationId) : undefined
                            }
                            alwaysEditable={false}
                            variant="compact"
                        />
                    ) : null}
                    <div
                        className={
                            isFinalUnderwriter
                                ? "space-y-0"
                                : "grid grid-cols-1 lg:grid-cols-2 gap-4 items-start"
                        }
                    >
                    {/* Requested & Approval Loan Details — left column */}
                    <div className={loanDetailsPanelClass}>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                                Requested & Approval Loan Details
                            </h3>
                            {!isEditMode && !offerDecisionLoading ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleStartEdit}
                                    className={`gap-2 ${isDark ? 'border-gray-600 bg-muted text-gray-200 hover:bg-gray-700' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'}`}
                                >
                                    <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                    Edit
                                </Button>
                            ) : null}
                        </div>

                        {offerDecisionLoading ? (
                            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Loading approval details…</p>
                        ) : !isEditMode ? (
                            <div className={loanFieldsGridClass}>
                                <ReadOnlyDetailField
                                    label="Request Amount"
                                    value={formValues.requestAmount ?? ""}
                                    isDark={isDark}
                                    currency
                                />
                                <ReadOnlyDetailField
                                    label="Approved Amount"
                                    value={formValues.approvedAmount ?? ""}
                                    required
                                    isDark={isDark}
                                    muted={false}
                                    currency
                                />
                                <ReadOnlyDetailField
                                    label="Factor Rate"
                                    value={formValues.factorRate ?? ""}
                                    isDark={isDark}
                                    muted={false}
                                />
                                <ReadOnlyDetailField
                                    label="Payback Amount"
                                    value={formValues.paybackAmount ?? ""}
                                    isDark={isDark}
                                    currency
                                />
                                <ReadOnlyDetailField
                                    label="Term"
                                    value={formValues.tenure ?? ""}
                                    required
                                    isDark={isDark}
                                    muted={false}
                                />
                                <ReadOnlyDetailField
                                    label="Repay"
                                    value={formValues.repay ?? ""}
                                    isDark={isDark}
                                    currency
                                />
                                <ReadOnlyDetailField
                                    label="Monthly Repayment"
                                    value={formValues.monthlyRepayment ?? ""}
                                    isDark={isDark}
                                    currency
                                />
                                <ReadOnlyDetailField
                                    label="ACH / Frequency"
                                    value={formValues.achFrequency ?? ""}
                                    required
                                    isDark={isDark}
                                    muted={false}
                                />
                                <ReadOnlyDetailField
                                    label={frequencyPeriodLabel}
                                    value={formValues.tenure ?? ""}
                                    isDark={isDark}
                                />
                            </div>
                        ) : (
                        <>
                        <div className={loanFieldsGridClass}>
                            <div className="space-y-1.5">
                                <Label className={readOnlyFieldLabelClass(isDark)}>
                                    Request Amount
                                </Label>
                                <Controller
                                    control={control}
                                    name="requestAmount"
                                    render={({ field }) => (
                                        <UsCurrencyInput
                                            ref={field.ref}
                                            name={field.name}
                                            value={field.value}
                                            onBlur={field.onBlur}
                                            onChange={field.onChange}
                                            isDark={isDark}
                                            muted
                                            readOnly
                                            tabIndex={-1}
                                            className={currencyFieldWrapperClass(isDark, true)}
                                            placeholder="e.g. 250,000"
                                            inputMode="decimal"
                                            autoComplete="off"
                                        />
                                    )}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-black"}`}>
                                    Approved Amount <span className="text-red-500">*</span>
                                </Label>
                                <Controller
                                    control={control}
                                    name="approvedAmount"
                                    rules={{ required: "Approved amount is required" }}
                                    render={({ field }) => (
                                        <>
                                            <UsCurrencyInput
                                                ref={field.ref}
                                                name={field.name}
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                onChange={field.onChange}
                                                isDark={isDark}
                                                className={currencyFieldWrapperClass(isDark)}
                                                placeholder="e.g. 250,000"
                                                inputMode="decimal"
                                                autoComplete="off"
                                            />
                                            {errors.approvedAmount && (
                                                <p className="text-xs text-red-500">{errors.approvedAmount.message}</p>
                                            )}
                                        </>
                                    )}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-black"}`}>
                                    Factor Rate
                                </Label>
                                <Controller
                                    control={control}
                                    name="factorRate"
                                    render={({ field }) => (
                                        <UsRateInput
                                            ref={field.ref}
                                            name={field.name}
                                            value={field.value}
                                            onBlur={field.onBlur}
                                            onChange={field.onChange}
                                            className={inputClass}
                                            placeholder="e.g. 1.32"
                                            inputMode="decimal"
                                            autoComplete="off"
                                        />
                                    )}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className={readOnlyFieldLabelClass(isDark)}>
                                    Payback Amount
                                </Label>
                                <Controller
                                    control={control}
                                    name="paybackAmount"
                                    render={({ field }) => (
                                        <UsCurrencyInput
                                            ref={field.ref}
                                            name={field.name}
                                            value={field.value}
                                            onBlur={field.onBlur}
                                            onChange={field.onChange}
                                            isDark={isDark}
                                            muted
                                            readOnly
                                            tabIndex={-1}
                                            className={currencyFieldWrapperClass(isDark, true)}
                                            placeholder="Calculated from approved × factor rate"
                                            inputMode="decimal"
                                            autoComplete="off"
                                        />
                                    )}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-black"}`}>
                                    Term <span className="text-red-500">*</span>
                                </Label>
                                <Controller
                                    control={control}
                                    name="tenure"
                                    rules={{ required: "Tenure is required" }}
                                    render={({ field }) => (
                                        <>
                                            <Input
                                                ref={field.ref}
                                                name={field.name}
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                onChange={field.onChange}
                                                className={inputClass}
                                                placeholder="e.g No. Of payments"
                                            />
                                            {errors.tenure && (
                                                <p className="text-xs text-red-500">{errors.tenure.message}</p>
                                            )}
                                        </>
                                    )}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className={readOnlyFieldLabelClass(isDark)}>
                                    Repay
                                </Label>
                                <Controller
                                    control={control}
                                    name="repay"
                                    render={({ field }) => (
                                        <UsCurrencyInput
                                            ref={field.ref}
                                            name={field.name}
                                            value={field.value}
                                            onBlur={field.onBlur}
                                            onChange={field.onChange}
                                            isDark={isDark}
                                            muted
                                            readOnly
                                            tabIndex={-1}
                                            className={currencyFieldWrapperClass(isDark, true)}
                                            placeholder="Calculated from offer, rate, term & frequency"
                                            inputMode="decimal"
                                            autoComplete="off"
                                        />
                                    )}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className={readOnlyFieldLabelClass(isDark)}>
                                    Monthly Repayment
                                </Label>
                                <Controller
                                    control={control}
                                    name="monthlyRepayment"
                                    render={({ field }) => (
                                        <UsCurrencyInput
                                            ref={field.ref}
                                            name={field.name}
                                            value={field.value}
                                            onBlur={field.onBlur}
                                            onChange={field.onChange}
                                            isDark={isDark}
                                            muted
                                            readOnly
                                            tabIndex={-1}
                                            className={currencyFieldWrapperClass(isDark, true)}
                                            placeholder="Calculated from offer, rate, term & frequency"
                                            inputMode="decimal"
                                            autoComplete="off"
                                        />
                                    )}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-black"}`}>
                                    ACH / Frequency <span className="text-red-500">*</span>
                                </Label>
                                <Controller
                                    control={control}
                                    name="achFrequency"
                                    rules={{ required: "ACH / Frequency is required" }}
                                    render={({ field }) => (
                                        <>
                                            <Select
                                                onValueChange={field.onChange}
                                                value={field.value || undefined}
                                            >
                                                <SelectTrigger className={`${FIELD_CONTROL_H} w-full cursor-pointer rounded-sm px-3 py-0 text-sm outline-none disabled:cursor-not-allowed ${isDark ? "bg-muted border-gray-700 text-gray-200" : "bg-white border-gray-200"}`}>
                                                    <SelectValue placeholder="Select frequency" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Daily">Daily</SelectItem>
                                                    <SelectItem value="Weekly">Weekly</SelectItem>
                                                    <SelectItem value="Bi-Weekly">Bi-Weekly</SelectItem>
                                                    <SelectItem value="Monthly">Monthly</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {errors.achFrequency && (
                                                <p className="text-xs text-red-500">{errors.achFrequency.message}</p>
                                            )}
                                        </>
                                    )}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label className={readOnlyFieldLabelClass(isDark)}>
                                    {frequencyPeriodLabel}
                                </Label>
                                <Input
                                    value={watchedTenure ?? ""}
                                    readOnly
                                    tabIndex={-1}
                                    className={readOnlyPlainInputClass(isDark)}
                                    placeholder="Same as term"
                                />
                            </div>

                            <Controller
                                control={control}
                                name="originationFee"
                                render={({ field }) => (
                                    <input type="hidden" {...field} value={ORIGINATION_FEE_FIXED} />
                                )}
                            />
                        </div>
                        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-border/60 pt-4">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleCancelEdit}
                                disabled={isUpdatingOffer}
                                className={`px-6 ${isDark ? 'border-gray-600 bg-muted text-gray-300' : 'border-gray-300 bg-white text-gray-700'}`}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                onClick={() => void handleUpdateOffer()}
                                disabled={isUpdatingOffer}
                                className="cursor-pointer bg-[#3B8BD1] px-6 text-white hover:bg-[#3B8BD1]/90 disabled:cursor-not-allowed"
                            >
                                {isUpdatingOffer ? "Updating…" : "Update"}
                            </Button>
                        </div>
                        </>
                        )}
                    </div>

                    {!isFinalUnderwriter ? (
                        <div
                            className={`rounded-lg p-5 ${
                                isDark
                                    ? "bg-[#262827] lg:border-l lg:border-gray-700"
                                    : "bg-white lg:border-l lg:border-gray-200 shadow-sm"
                            }`}
                        >
                            <h3
                                className={`text-sm font-semibold mb-1 ${
                                    isDark ? "text-gray-200" : "text-black"
                                }`}
                            >
                                Compliance Checks
                            </h3>
                            <p
                                className={`text-xs mb-4 shrink-0 ${
                                    isDark ? "text-gray-400" : "text-gray-600"
                                }`}
                            >
                                Answer each question before sending. Selecting
                                &quot;Yes&quot; requires details.
                            </p>
                            <ComplianceChecksQuestionnaire
                                applicationId={complianceApplicationId}
                                compact
                                onProgressChange={setChecksProgress}
                            />
                        </div>
                    ) : null}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 pt-4">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className={`px-6 border-gray-300 ${isDark ? 'bg-muted border-gray-700 text-gray-300 hover:bg-gray-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    {isFinalUnderwriter ? (
                        <Button
                            type="button"
                            onClick={async () => {
                                if (!applicationUuid) {
                                    onProceedToContract?.();
                                    onOpenChange(false);
                                    return;
                                }
                                setIsSubmitting(true);
                                const toastId = toast.loading(
                                    resendApprovalEmail
                                        ? "Sending updated offer email to ISO..."
                                        : "Sending approval email to ISO..."
                                );
                                try {
                                    try {
                                        await dispatch(
                                            sendApprovalEmail({
                                                applicationId: applicationUuid,
                                                resend: !!resendApprovalEmail,
                                            })
                                        ).unwrap();
                                        toast.update(toastId, {
                                            render: resendApprovalEmail
                                                ? "Updated offer email sent to the linked ISO when that ISO has an email on file."
                                                : "Approval email sent to the linked ISO when that ISO has an email on file.",
                                            type: "success",
                                            isLoading: false,
                                            autoClose: 3000,
                                        });
                                    } catch (emailError) {
                                        console.error("Failed to send approval email:", emailError);
                                        toast.update(toastId, {
                                            render: resendApprovalEmail
                                                ? "The ISO updated-offer email could not be sent (link an ISO with email, check SMTP, or try again)."
                                                : "The ISO approval email could not be sent (link an ISO with email, check SMTP, or try again).",
                                            type: "warning",
                                            isLoading: false,
                                            autoClose: 5000,
                                        });
                                    }

                                    onProceedToContract?.();
                                    onOpenChange(false);
                                } finally {
                                    setIsSubmitting(false);
                                }
                            }}
                            disabled={
                                offerDecisionLoading ||
                                isSubmitting ||
                                isEditMode ||
                                isUpdatingOffer
                            }
                            className="cursor-pointer bg-green-600 px-6 text-white hover:bg-green-700 disabled:cursor-not-allowed"
                        >
                            {offerDecisionLoading || isSubmitting
                                ? "Processing…"
                                : isUpdatingOffer
                                  ? "Updating…"
                                  : isEditMode
                                    ? "Save offer changes first"
                                    : resendApprovalEmail
                                      ? "Resend approval mail"
                                      : "Send approval mail"}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            onClick={handleSubmit(onSubmit)}
                            disabled={
                                offerDecisionLoading ||
                                isSubmitting ||
                                isEditMode ||
                                isUpdatingOffer ||
                                !checksProgress.allComplete
                            }
                            className="cursor-pointer bg-green-600 px-6 text-white hover:bg-green-700 disabled:cursor-not-allowed"
                        >
                            {isSubmitting
                                ? "Sending…"
                                : offerDecisionLoading
                                    ? "Loading…"
                                    : !checksProgress.allComplete
                                      ? `Complete checks (${checksProgress.completed}/${checksProgress.total})`
                                      : "Send to Final-Underwriter"}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ApprovedApplicationModal;

