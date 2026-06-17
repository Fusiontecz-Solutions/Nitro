import { useForm, Controller } from "react-hook-form";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { Mail, Phone, AlertTriangle } from "lucide-react";
import { formatUSPhoneNumber } from "@/utils/formatPhoneNumber";
import {
    APPLICATION_REJECTION_EMAIL_SUBJECT,
    renderApplicationRejectionEmailHtml,
} from "@/pages/templates";

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
}

const REJECTION_REASON_OPTIONS = [
    "Bad balances",
    "Negative days",
    "Bouncing",
    "Returns",
    "Od fees",
    "Low rev",
    "Low rev construction",
    "Low rev trucking",
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

    // Get application data from Redux
    const { data: applicationData } = useSelector((state: RootState) => state.applicationDetail);
    const { loading: rejectLoading } = useSelector((state: RootState) => state.rejectApplication);
    const isSubmitting = onConfirm
        ? Boolean(confirmLoading)
        : rejectLoading || Boolean(confirmLoading);

    // Linked ISO — the rejection email template is delivered to this recipient.
    const iso = (applicationData as any)?.iso as
        | { name?: string; email?: string; phone?: string }
        | null
        | undefined;
    const isoName = String(iso?.name ?? '').trim();
    const isoEmail = String(iso?.email ?? '').trim();
    const isoPhone = String(iso?.phone ?? '').trim();
    const hasIsoEmail = isoEmail.length > 0;

    const { control, handleSubmit, formState: { errors }, reset } = useForm<RejectFormValues>({
        defaultValues: {
            reason: "",
        },
    });

    const handleCancel = () => {
        onOpenChange(false);
        reset();
    };

    const onSubmit = async (data: RejectFormValues) => {
        if (onConfirm) {
            try {
                await onConfirm(data.reason);
                onOpenChange(false);
                reset();
            } catch (error: any) {
                toast.error(error || 'Failed to decline application');
            }
            return;
        }

        if (!applicationData) {
            toast.error('Application data not found');
            return;
        }

        // Get application ID (support both numeric applicationId and MongoDB _id)
        const applicationId = (applicationData as any).applicationId || (applicationData as any)._id;

        if (!applicationId) {
            toast.error('Application ID not found');
            return;
        }

        try {
            const emailHtml = hasIsoEmail
                ? renderApplicationRejectionEmailHtml({
                      client_name: isoName || isoEmail,
                      primary_reason: data.reason,
                  })
                : undefined;

            await dispatch(rejectApplication({
                id: applicationId,
                reason: data.reason,
                ...(emailHtml
                    ? { emailHtml, emailSubject: APPLICATION_REJECTION_EMAIL_SUBJECT }
                    : {}),
            })).unwrap();

            if (onAfterReject) {
                await onAfterReject(data.reason);
            }

            if (hasIsoEmail) {
                toast.success(`Application rejection template sent to ISO (${isoEmail})`);
            } else {
                toast.success('Application rejected successfully');
                toast.warn('No ISO email on file — rejection template was not emailed.');
            }
            onOpenChange(false);
            reset();

            // Refetch application detail to update the UI
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
                    <DialogDescription className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        Select a reason for rejecting this application. The rejection email template will be sent to the linked ISO.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Application Details */}
                    <div className={`${isDark ? 'bg-[#282524]' : 'bg-pink-50'} p-4 rounded-lg`}>
                        <div className="grid grid-cols-2 gap-4">
                            {/* Left Column */}
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
                            {/* Right Column */}
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

                    {/* ISO Recipient — where the rejection email template is delivered */}
                    {hasIsoEmail ? (
                            <div className={`rounded-lg border p-4 ${isDark ? 'border-gray-700 bg-[#1f2937]/40' : 'border-blue-100 bg-blue-50'}`}>
                                <div className="flex items-start gap-3">
                                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-100 text-blue-600'}`}>
                                        <Mail className="h-4 w-4" strokeWidth={2} aria-hidden />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                            Rejection email will be sent to ISO
                                        </p>
                                        <p className={`mt-1 text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-black'}`}>
                                            {isoName || 'Linked ISO'}
                                        </p>
                                        <div className="mt-1 flex flex-col gap-1">
                                            <span className={`flex items-center gap-1.5 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                                <Mail className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                                                <span className="truncate">{isoEmail}</span>
                                            </span>
                                            {isoPhone ? (
                                                <span className={`flex items-center gap-1.5 text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                                    <Phone className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                                                    <span className="truncate">{formatUSPhoneNumber(isoPhone) || isoPhone}</span>
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className={`flex items-start gap-3 rounded-lg border p-4 ${isDark ? 'border-amber-500/30 bg-amber-500/10' : 'border-amber-200 bg-amber-50'}`}>
                                <AlertTriangle className={`h-4 w-4 shrink-0 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} strokeWidth={2} aria-hidden />
                                <p className={`text-sm ${isDark ? 'text-amber-200' : 'text-amber-800'}`}>
                                    No ISO email is linked to this application, so the rejection template cannot be emailed. The application will still be rejected.
                                </p>
                            </div>
                    )}

                    {/* Reason for Rejection */}
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
                                            {REJECTION_REASON_OPTIONS.map((option) => (
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

                {/* Action Buttons */}
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

