import { useEffect, useRef, useState } from "react";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/context/ThemeContext";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { rejectApplication, getApplicationByApplicationId, getApplicationById } from "@/redux/actions/applicationActions";
import { toast } from "react-toastify";
import { Mail, Phone, AlertTriangle, X } from "lucide-react";
import { formatUSPhoneNumber } from "@/utils/formatPhoneNumber";
import {
    buildApplicationRejectionEmailSubject,
    renderApplicationRejectionEmailHtml,
} from "@/pages/templates";
import { normalizeRoleKey, resolveEffectiveRole } from "@/lib/sessionRole";

interface RejectApplicationModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Custom submit that skips rejectApplication API (legacy). Prefer onAfterReject. */
    onConfirm?: (reason: string) => Promise<void>;
    /** Runs after rejectApplication succeeds (e.g. record funding call outcome). */
    onAfterReject?: (reason: string) => Promise<void>;
    confirmLoading?: boolean;
}

interface RejectFormValues {
    reason: string;
    isoEmail: string;
}

const REJECTION_REASON_OPTIONS = [
    "Bad balances",
    "Negative days",
    "Bouncing",
    "Returns",
    "Od fees",
    "Low revenue",
    "Low revenue construction",
    "Low revenue trucking",
    "No active position",
    "Not enough MCA history",
    "Behind reverse",
    "Leverage",
    "Recovery in file",
    "Recent default",
    "Active settlement",
    "Behind recent deals",
    "Low recent funding",
    "Behind scam company",
] as const;

/** Scrubber (SCRUBBING role) — limited decline reasons only. */
const SCRUBBER_REJECTION_REASON_OPTIONS = [
    "Low revenue",
    "NSF Days",
    "1st position",
] as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RejectApplicationModal = ({
    open,
    onOpenChange,
    onConfirm,
    onAfterReject,
    confirmLoading,
}: RejectApplicationModalProps) => {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const dispatch = useDispatch<AppDispatch>();

    const { data: applicationData } = useSelector((state: RootState) => state.applicationDetail);
    const { loading: rejectLoading } = useSelector((state: RootState) => state.rejectApplication);
    const loginUserRole = useSelector(
        (state: RootState) => state.login.data?.user?.role,
    );
    const viewerRoleKey = normalizeRoleKey(
        resolveEffectiveRole({ role: loginUserRole }),
    );
    const isScrubberRole = viewerRoleKey === "SCRUBBING";
    const rejectionReasonOptions = isScrubberRole
        ? SCRUBBER_REJECTION_REASON_OPTIONS
        : REJECTION_REASON_OPTIONS;
    const isSubmitting = onConfirm
        ? Boolean(confirmLoading)
        : rejectLoading || Boolean(confirmLoading);

    const iso = (applicationData as any)?.iso as
        | { name?: string; email?: string; phone?: string }
        | null
        | undefined;
    const hasLinkedIso = Boolean(iso?.name || iso?.email || iso?.phone);
    const isoName = String(iso?.name ?? '').trim();
    const linkedIsoEmail = String(iso?.email ?? '').trim();
    const isoPhone = String(iso?.phone ?? '').trim();

    const client = (applicationData as any)?.client;
    const clientEmail = String(
        client?.business?.email || client?.owner?.email || '',
    ).trim();

    const [ccEmails, setCcEmails] = useState<string[]>([]);
    const [ccDraft, setCcDraft] = useState("");
    const isoEmailTouchedRef = useRef(false);
    const wasOpenRef = useRef(false);

    const { control, handleSubmit, formState: { errors }, reset, setValue } = useForm<RejectFormValues>({
        defaultValues: {
            reason: "",
            isoEmail: "",
        },
    });

    const resetFormState = () => {
        reset({ reason: "", isoEmail: "" });
        setCcEmails([]);
        setCcDraft("");
        isoEmailTouchedRef.current = false;
    };

    /** Merge chip list + any address still typed in the CC field (not yet added). */
    const resolveCcRecipientsForSend = (
        recipientEmail: string,
    ): { emails: string[]; draftError?: string } => {
        const merged = [...ccEmails];
        const trimmedDraft = ccDraft.trim();
        if (trimmedDraft) {
            if (!EMAIL_PATTERN.test(trimmedDraft)) {
                return {
                    emails: [],
                    draftError: "Enter a valid CC email address or clear the CC field before declining",
                };
            }
            if (!merged.some((e) => e.toLowerCase() === trimmedDraft.toLowerCase())) {
                merged.push(trimmedDraft);
            }
        }
        return {
            emails: merged.filter(
                (e) => e.toLowerCase() !== recipientEmail.toLowerCase(),
            ),
        };
    };

    useEffect(() => {
        if (!open) {
            if (wasOpenRef.current) {
                resetFormState();
            }
            wasOpenRef.current = false;
            return;
        }

        if (!wasOpenRef.current) {
            isoEmailTouchedRef.current = false;
            const prefillCc =
                clientEmail && EMAIL_PATTERN.test(clientEmail) ? [clientEmail] : [];
            setCcEmails(prefillCc);
            setCcDraft("");
            setValue("isoEmail", linkedIsoEmail || "");
        }

        wasOpenRef.current = true;
    }, [open, linkedIsoEmail, clientEmail, setValue]);

    useEffect(() => {
        if (!open || isoEmailTouchedRef.current) return;
        if (linkedIsoEmail) {
            setValue("isoEmail", linkedIsoEmail);
        }
    }, [open, linkedIsoEmail, setValue]);

    const addEmailToList = (
        raw: string,
        list: string[],
        setList: (next: string[]) => void,
        clearDraft: () => void,
    ) => {
        const email = raw.trim();
        if (!email) return;
        if (!EMAIL_PATTERN.test(email)) {
            toast.error("Enter a valid email address");
            return;
        }
        if (list.some((e) => e.toLowerCase() === email.toLowerCase())) {
            toast.warning("Email already added");
            return;
        }
        setList([...list, email]);
        clearDraft();
    };

    const removeEmailFromList = (
        email: string,
        list: string[],
        setList: (next: string[]) => void,
    ) => {
        setList(list.filter((e) => e !== email));
    };

    const handleCancel = () => {
        onOpenChange(false);
        resetFormState();
    };

    const isoEmailHelper = (() => {
        if (hasLinkedIso && linkedIsoEmail) {
            return "Prefilled from the linked ISO record. Edit if needed.";
        }
        if (hasLinkedIso && !linkedIsoEmail) {
            return "Linked ISO has no email on file — enter one below.";
        }
        return "Enter the ISO email that should receive the rejection template.";
    })();

    const onSubmit = async (data: RejectFormValues) => {
        if (onConfirm) {
            try {
                await onConfirm(data.reason);
                onOpenChange(false);
                resetFormState();
            } catch (error: any) {
                toast.error(error || 'Failed to decline application');
            }
            return;
        }

        if (!applicationData) {
            toast.error('Application data not found');
            return;
        }

        const recipientEmail = data.isoEmail?.trim() || "";
        if (!recipientEmail) {
            toast.error("Enter an ISO email address for the rejection template");
            return;
        }
        if (!EMAIL_PATTERN.test(recipientEmail)) {
            toast.error("Enter a valid ISO email address");
            return;

        }

        const applicationId = (applicationData as any).applicationId || (applicationData as any)._id;

        if (!applicationId) {
            toast.error('Application ID not found');
            return;
        }

        try {
            const ccResolution = resolveCcRecipientsForSend(recipientEmail);
            if (ccResolution.draftError) {
                toast.error(ccResolution.draftError);
                return;
            }
            const ccForSend = ccResolution.emails;

            const emailHtml = renderApplicationRejectionEmailHtml({
                client_name: isoName || recipientEmail,
                primary_reason: data.reason,
            });

            const businessName = String(
                (applicationData as any)?.client?.business?.name ||
                    (applicationData as any)?.client?.businessName ||
                    "",
            ).trim();

            const result = await dispatch(rejectApplication({
                id: applicationId,
                reason: data.reason,
                isoEmail: recipientEmail,
                ccEmails: ccForSend,
                emailHtml,
                emailSubject: buildApplicationRejectionEmailSubject(businessName),
            })).unwrap();

            if (onAfterReject) {
                await onAfterReject(data.reason);
            }

            const ccErrors = Array.isArray(result?.ccErrors) ? result.ccErrors : [];
            const emailedCc = Array.isArray(result?.emailedCc) ? result.emailedCc : [];
            const ccFailed =
                ccForSend.length > 0 &&
                (ccErrors.length > 0 || emailedCc.length < ccForSend.length);
            if (ccFailed) {
                const undelivered = ccForSend.filter(
                    (e) => !emailedCc.some((sent: string) => sent.toLowerCase() === e.toLowerCase()),
                );
                const failureDetail =
                    ccErrors.length > 0
                        ? ccErrors.join("; ")
                        : undelivered.join(", ");
                toast.warning(
                    `Decline sent to ISO ${recipientEmail}${emailedCc.length ? `; CC delivered to ${emailedCc.join(", ")}` : ""}. CC not delivered to: ${failureDetail}`,
                );
            } else if (emailedCc.length > 0) {
                toast.success(
                    `Application rejection template sent to ISO ${recipientEmail} and CC ${emailedCc.join(", ")}`,
                );
            } else {
                toast.success(`Application rejection template sent to ${recipientEmail}`);
            }

            onOpenChange(false);
            resetFormState();

            if ((applicationData as any)?.applicationId) {
                await dispatch(getApplicationByApplicationId(String((applicationData as any).applicationId)));
            } else if ((applicationData as any)?._id) {
                await dispatch(getApplicationById((applicationData as any)._id));
            }
        } catch (error: any) {
            toast.error(error || 'Failed to reject application');
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="">
                <DialogHeader>
                    <DialogTitle className={`text-xl font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                        Reject Application
                    </DialogTitle>
                    <DialogDescription className={`text-xs leading-relaxed ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        Select a rejection reason. The email goes to the ISO — edit the recipient or CC below. ISO replies stay in the submission thread; CC gets a separate message.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className={`${isDark ? 'bg-[#282524]' : 'bg-pink-50'} p-4 rounded-lg`}>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-4">
                                <div>
                                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Application ID</p>
                                    <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                                        {(applicationData as any)?.applicationId ? `LN-${(applicationData as any).applicationId}` : 'N/A'}
                                    </p>
                                </div>
                                <div>
                                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Business</p>
                                    <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                                        {(applicationData as any)?.client?.business?.name || 
                                         ((applicationData as any)?.client?.owner?.firstName && (applicationData as any)?.client?.owner?.lastName
                                            ? `${(applicationData as any).client.owner.firstName} ${(applicationData as any).client.owner.lastName}`
                                            : 'N/A')}
                                    </p>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <div>
                                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Borrower</p>
                                    <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                                        {(applicationData as any)?.client?.owner?.firstName && (applicationData as any)?.client?.owner?.lastName
                                            ? `${(applicationData as any).client.owner.firstName} ${(applicationData as any).client.owner.lastName}`
                                            : 'N/A'}
                                    </p>
                                </div>
                                <div>
                                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Requested Amount</p>
                                    <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                                        {(applicationData as any)?.requestedAmount || 'N/A'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {hasLinkedIso ? (
                        <div className={`rounded-lg border p-4 ${isDark ? 'border-gray-700 bg-[#1f2937]/40' : 'border-blue-100 bg-blue-50'}`}>
                            <div className="flex items-start gap-3">
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-100 text-blue-600'}`}>
                                    <Mail className="h-4 w-4" strokeWidth={2} aria-hidden />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                        Linked ISO
                                    </p>
                                    <p className={`mt-1 text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-black'}`}>
                                        {isoName || 'Linked ISO'}
                                    </p>
                                    {isoPhone ? (
                                        <span className={`mt-1 flex items-center gap-1.5 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                            <Phone className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                                            <span className="truncate">{formatUSPhoneNumber(isoPhone) || isoPhone}</span>
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className={`flex items-start gap-3 rounded-lg border p-4 ${isDark ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
                            <AlertTriangle className={`h-4 w-4 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} strokeWidth={2} aria-hidden />
                            <p className={`text-sm ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
                                No ISO is linked to this application. Enter a recipient email below to send the rejection template.
                            </p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                            ISO email (To) <span className="text-red-500">*</span>
                        </Label>
                        <Controller
                            control={control}
                            name="isoEmail"
                            rules={{
                                required: "ISO email is required",
                                validate: (value) => {
                                    const trimmed = String(value || "").trim();
                                    if (!trimmed) return "ISO email is required";
                                    if (!EMAIL_PATTERN.test(trimmed)) {
                                        return "Enter a valid email address";
                                    }
                                    return true;
                                },
                            }}
                            render={({ field }) => (
                                <>
                                    <Input
                                        {...field}
                                        type="email"
                                        placeholder="Enter ISO email"
                                        className={isDark ? "bg-muted border-gray-700" : ""}
                                        onChange={(e) => {
                                            isoEmailTouchedRef.current = true;
                                            field.onChange(e);
                                        }}
                                    />
                                    {errors.isoEmail && (
                                        <p className="text-xs text-red-500">{errors.isoEmail.message}</p>
                                    )}
                                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        {isoEmailHelper}
                                    </p>
                                </>
                            )}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                            CC
                        </Label>
                        <div className="mb-2 flex flex-wrap gap-2">
                            {ccEmails.map((email) => (
                                <span
                                    key={email}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${isDark ? 'border-gray-600 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}
                                >
                                    {email}
                                    <button
                                        type="button"
                                        className="text-gray-500 hover:text-red-600"
                                        onClick={() => removeEmailFromList(email, ccEmails, setCcEmails)}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <Input
                                type="email"
                                placeholder="cc@example.com"
                                value={ccDraft}
                                onChange={(e) => setCcDraft(e.target.value)}
                                className={isDark ? "bg-muted border-gray-700" : ""}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        addEmailToList(ccDraft, ccEmails, setCcEmails, () => setCcDraft(""));
                                    }
                                }}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    addEmailToList(ccDraft, ccEmails, setCcEmails, () => setCcDraft(""))
                                }
                            >
                                Add
                            </Button>
                        </div>
                        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            Press Enter or Add for each CC address. Any valid address left in the field is included when you decline.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                            Reason for Rejection <span className="text-red-500">*</span>
                        </Label>
                        <Controller
                            control={control}
                            name="reason"
                            rules={{ required: "Reason for rejection is required" }}
                            render={({ field }) => (
                                <>
                                    <Select
                                        onValueChange={field.onChange}
                                        value={field.value || undefined}
                                    >
                                        <SelectTrigger
                                            className={`h-10 w-full rounded-sm px-3 py-0 text-sm outline-none ${isDark ? 'bg-muted border-gray-700 text-gray-200' : 'bg-white border-gray-200'}`}
                                        >
                                            <SelectValue placeholder="Select a rejection reason" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {rejectionReasonOptions.map((option) => (
                                                <SelectItem key={option} value={option}>
                                                    {option}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {errors.reason && (
                                        <p className="text-xs text-red-500">{errors.reason.message}</p>
                                    )}
                                </>
                            )}
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between gap-3 w-full">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        className={`px-6 border-gray-300 flex-1 rounded-sm py-4 ${isDark ? 'bg-muted border-gray-700 text-gray-300 hover:bg-gray-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSubmit(onSubmit)}
                        disabled={isSubmitting}
                        className="bg-red-600 hover:bg-red-700 flex-1 rounded-sm py-4 text-white px-6 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Declining...' : 'Decline Application'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default RejectApplicationModal;
