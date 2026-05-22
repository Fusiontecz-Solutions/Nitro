import { forwardRef, useEffect, useState, type ComponentProps } from "react";
import { useForm, Controller } from "react-hook-form";
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
import { notifyFinalUnderwriterOnAssignment } from "@/redux/actions/notificationActions";
import { axiosGet } from "@/redux/axios";
import { toast } from "react-toastify";
import { formatNumberUSForInput } from "@/lib/utils";

interface ApprovedApplicationModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** When true, show "Proceed to Generate Contract" and read-only details (FINAL_UNDERWRITER only) */
    isFinalUnderwriter?: boolean;
    /** Called when FINAL_UNDERWRITER clicks Proceed to Generate Contract */
    onProceedToContract?: () => void;
    /** When true, send the "offer updated" resend template to ISO. */
    resendApprovalEmail?: boolean;
    /** Called after the FINAL_UNDERWRITER successfully confirms/updates the offer. */
    onOfferUpdated?: () => void;
}

interface ApprovalFormValues {
    requestAmount: string;
    tenure: string;
    buyRate: string;
    paybackAmount: string;
    originationFee: string;
    approvedAmount: string;
    factorRate: string;
    achFrequency: string;
}

function toUsGroupedInput(raw: string): string {
    return formatNumberUSForInput(raw);
}

interface UsCurrencyInputProps extends Omit<ComponentProps<typeof Input>, "onChange" | "value"> {
    value: string;
    onChange: (next: string) => void;
}

const UsCurrencyInput = forwardRef<HTMLInputElement, UsCurrencyInputProps>(
    function UsCurrencyInput({ value, onChange, className, ...rest }, ref) {
        return (
            <div className="relative min-w-0">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    $
                </span>
                <Input
                    {...rest}
                    ref={ref}
                    value={value}
                    onChange={(e) => onChange(toUsGroupedInput(e.target.value))}
                    className={`${className ?? ""} pl-7`}
                />
            </div>
        );
    },
);

interface UsNumberInputProps extends Omit<ComponentProps<typeof Input>, "onChange" | "value"> {
    value: string;
    onChange: (next: string) => void;
}

/** Comma-grouped numeric input (rates, fees) without a currency symbol. */
const UsNumberInput = forwardRef<HTMLInputElement, UsNumberInputProps>(
    function UsNumberInput({ value, onChange, className, ...rest }, ref) {
        return (
            <Input
                {...rest}
                ref={ref}
                value={value}
                onChange={(e) => onChange(toUsGroupedInput(e.target.value))}
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

    const { control, handleSubmit, formState: { errors }, reset } = useForm<ApprovalFormValues>({
        defaultValues: {
            requestAmount: "",
            tenure: "",
            // Buy rate should always start at 1 (editable by user)
            buyRate: "1",
            paybackAmount: "",
            originationFee: "",
            approvedAmount: "",
            factorRate: "",
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
    const [offerDecisionLoading, setOfferDecisionLoading] = useState(false);

    // Fetch offer decision when modal opens and we have an application
    useEffect(() => {
        const fetchOfferDecision = async () => {
            if (!open || !applicationId) return;
            try {
                setOfferDecisionLoading(true);
                const res = await axiosGet("/offer-decisions", {
                    params: { application: applicationId },
                });
                const apiData = (res.data && res.data.data) || null;

                if (!apiData) {
                    reset({
                        requestAmount:
                            applicationData?.loanAmount != null
                                ? toUsGroupedInput(String(applicationData.loanAmount))
                                : "",
                        tenure: "",
                        buyRate: toUsGroupedInput("1"),
                        paybackAmount: "",
                        originationFee: "",
                        approvedAmount: "",
                        factorRate: "",
                        // Default ACH / Frequency so the required rule does not block submit
                        achFrequency: "Daily",
                    });
                    return;
                }

                const offer = apiData.offer ?? null;
                const rate = apiData.rate ?? null;
                const term = apiData.term ?? null;

                let computedPayback: string = "";
                const offerNum = typeof offer === "number" ? offer : Number(offer ?? 0);
                const rateNum = typeof rate === "number" ? rate : Number(rate ?? 0);
                if (offerNum > 0 && rateNum > 0) {
                    // Payback amount should be shown as a whole number (no decimals).
                    computedPayback = String(Math.round(offerNum * rateNum));
                }

                reset({
                    requestAmount:
                        applicationData?.loanAmount != null
                            ? toUsGroupedInput(String(applicationData.loanAmount))
                            : "",
                    tenure: term != null ? `${term} Payments` : "",
                    // Always default buy rate to 1; user can change it manually
                    buyRate: toUsGroupedInput("1"),
                    paybackAmount: computedPayback ? toUsGroupedInput(computedPayback) : "",
                    originationFee:
                        apiData.fees != null ? toUsGroupedInput(String(apiData.fees)) : "",
                    approvedAmount: offer != null ? toUsGroupedInput(String(offer)) : "",
                    // Factor rate can still reflect backend rate if present
                    factorRate: rate != null ? toUsGroupedInput(String(rate)) : "",
                    // Use saved frequency if present, otherwise default to Daily
                    achFrequency: apiData.frequency || "Daily",
                });
            } catch (error) {
                console.error("Failed to load offer decision for modal:", error);
                reset({
                    requestAmount:
                        applicationData?.loanAmount != null
                            ? toUsGroupedInput(String(applicationData.loanAmount))
                            : "",
                    tenure: "",
                    buyRate: toUsGroupedInput("1"),
                    paybackAmount: "",
                    originationFee: "",
                    approvedAmount: "",
                    factorRate: "",
                    // Fallback default
                    achFrequency: "Daily",
                });
            } finally {
                setOfferDecisionLoading(false);
            }
        };

        fetchOfferDecision();
    }, [open, applicationId, applicationData?.loanAmount, reset]);

    const onSubmit = async (data: ApprovalFormValues) => {
        if (!applicationUuid || !applicationId) {
            console.error("No application ID available");
            onOpenChange(false);
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

    const inputClass = `${isDark ? 'bg-muted border-gray-700 text-gray-200' : 'bg-white'} px-3 py-2 rounded-sm outline-none`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className={`text-xl font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                        {isFinalUnderwriter ? "Approved Application" : "Send application to Final-underwriter"}
                    </DialogTitle>
                    <DialogDescription className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        {isFinalUnderwriter
                            ? "Review and confirm the approval details."
                            : "Review loan terms, then send this application to the Final Underwriter."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Requested & Approval Loan Details Section */}
                    <div className={`${isDark ? 'bg-[#262827]' : 'bg-green-50'} p-6 rounded-lg`}>
                        <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'} mb-4`}>
                            Requested & Approval Loan Details
                        </h3>

                        {offerDecisionLoading ? (
                            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Loading approval details…</p>
                        ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left Column - Requested Details (editable) */}
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-black'}`}>
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
                                                className={inputClass}
                                                placeholder="e.g. 250,000"
                                                inputMode="decimal"
                                                autoComplete="off"
                                            />
                                        )}
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-black'}`}>
                                        Term <span className="text-red-500">*</span>
                                    </Label>
                                    <Controller
                                        control={control}
                                        name="tenure"
                                        rules={{ required: "Tenure is required" }}
                                        render={({ field }) => (
                                            <>
                                                <Input
                                                    {...field}
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
                                    <Label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-black'}`}>
                                        Buy Rate
                                    </Label>
                                    <Controller
                                        control={control}
                                        name="buyRate"
                                        render={({ field }) => (
                                            <UsNumberInput
                                                ref={field.ref}
                                                name={field.name}
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                onChange={field.onChange}
                                                className={inputClass}
                                                placeholder="e.g. 8.5"
                                                inputMode="decimal"
                                                autoComplete="off"
                                            />
                                        )}
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-black'}`}>
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
                                                className={inputClass}
                                                placeholder="e.g. 337,500"
                                                inputMode="decimal"
                                                autoComplete="off"
                                            />
                                        )}
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <Label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-black'}`}>
                                        Origination Fee
                                    </Label>
                                    <Controller
                                        control={control}
                                        name="originationFee"
                                        render={({ field }) => (
                                            <UsNumberInput
                                                ref={field.ref}
                                                name={field.name}
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                onChange={field.onChange}
                                                className={inputClass}
                                                placeholder="e.g. 2.5 or 10"
                                                inputMode="decimal"
                                                autoComplete="off"
                                            />
                                        )}
                                    />
                                </div>
                            </div>

                            {/* Right Column - Approval Details (editable) */}
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-black'}`}>
                                        Approved Amount* <span className="text-red-500">*</span>
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
                                                    className={inputClass}
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
                                    <Label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-black'}`}>
                                        Factor Rate
                                    </Label>
                                    <Controller
                                        control={control}
                                        name="factorRate"
                                        render={({ field }) => (
                                            <UsNumberInput
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
                                    <Label className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-black'}`}>
                                        ACH / Frequency* <span className="text-red-500">*</span>
                                    </Label>
                                    <Controller
                                        control={control}
                                        name="achFrequency"
                                        rules={{ required: "ACH / Frequency is required" }}
                                        render={({ field }) => (
                                            <>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                >
                                                    <SelectTrigger className={`rounded-sm outline-none px-3 py-2 w-full ${isDark ? 'bg-muted border-gray-700 text-gray-200' : 'bg-white'}`}>
                                                        <SelectValue placeholder="Daily" />
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
                            </div>
                        </div>
                        )}
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between gap-3 pt-4 ">
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
                                        onOfferUpdated?.();
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
                            disabled={offerDecisionLoading || isSubmitting}
                            className="bg-green-600 hover:bg-green-700 text-white px-6"
                        >
                            {offerDecisionLoading || isSubmitting ? "Processing…" : "Send"}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            onClick={handleSubmit(onSubmit)}
                            disabled={offerDecisionLoading || isSubmitting}
                            className="bg-green-600 hover:bg-green-700 cursor-pointer text-white px-6"
                        >
                            {isSubmitting
                                ? "Sending…"
                                : offerDecisionLoading
                                    ? "Loading…"
                                    : "Send to Final-Underwriter"}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ApprovedApplicationModal;

