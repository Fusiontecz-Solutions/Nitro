import { useState, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { rejectApplication, getApplicationByApplicationId, getApplicationById } from "@/redux/actions/applicationActions";
import { toast } from "react-toastify";

interface RejectApplicationModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface RejectFormValues {
    reason: string;
}

const RejectApplicationModal = ({ open, onOpenChange }: RejectApplicationModalProps) => {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const dispatch = useDispatch<AppDispatch>();
    const [files, setFiles] = useState<File[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const maxChars = 500;

    // Get application data from Redux
    const { data: applicationData } = useSelector((state: RootState) => state.applicationDetail);
    const { loading: rejectLoading } = useSelector((state: RootState) => state.rejectApplication);

    const { control, handleSubmit, formState: { errors }, watch, reset } = useForm<RejectFormValues>({
        defaultValues: {
            reason: "",
        },
    });

    const reasonText = watch("reason") || "";

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files);
            setFiles((prev) => [...prev, ...selectedFiles]);
        }
    };

    const handleRemoveFile = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.dataTransfer.files) {
            const droppedFiles = Array.from(e.dataTransfer.files);
            setFiles((prev) => [...prev, ...droppedFiles]);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    const handleCancel = () => {
        onOpenChange(false);
        reset();
        setFiles([]);
    };

    const onSubmit = async (data: RejectFormValues) => {
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
            await dispatch(rejectApplication({
                id: applicationId,
                reason: data.reason,
            })).unwrap();

            toast.success('Application rejected successfully');
            onOpenChange(false);
            reset();
            setFiles([]);
            
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
                        Please provide a detailed reason for rejecting this application.
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

                    {/* Reason for Rejection */}
                    <div className="space-y-2">
                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                            Reason for Rejection <span className="text-red-500">*</span>
                        </Label>
                        <Controller
                            control={control}
                            name="reason"
                            rules={{
                                required: "Reason for rejection is required",
                                maxLength: {
                                    value: maxChars,
                                    message: `Reason must not exceed ${maxChars} characters`,
                                },
                            }}
                            render={({ field }) => (
                                <>
                                    <Textarea
                                        {...field}
                                        placeholder="Please provide a detailed explanation for why this application is being rejected..."
                                        className={`min-h-[120px] resize-none px-3 py-2 rounded-sm outline-none ${isDark ? 'bg-muted border-gray-700 text-gray-200' : 'bg-white'}`}
                                        maxLength={maxChars}
                                    />
                                    <div className="flex justify-between items-center">
                                        {errors.reason && (
                                            <p className="text-xs text-red-500">{errors.reason.message}</p>
                                        )}
                                        <p className={`text-xs ml-auto ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {reasonText.length}/{maxChars} characters
                                        </p>
                                    </div>
                                </>
                            )}
                        />
                    </div>

                    {/* Attach Supporting Documents */}
                    <div className="space-y-2">
                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                            Attach Supporting Documents (Optional)
                        </Label>
                        <div
                            className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors ${isDark ? '' : 'hover:bg-red-50/50 border-[#DC331D]'}`}
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {files.length > 0 ? (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        {files.map((file, index) => (
                                            <div
                                                key={index}
                                                className={`inline-flex items-center gap-2 px-3 py-2 rounded-md border text-sm shadow-sm ${isDark ? 'bg-muted border-gray-700' : 'bg-white border-gray-300'}`}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <FileText className={`h-4 w-4 shrink-0 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
                                                <span className={`max-w-[200px] truncate ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{file.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveFile(index);
                                                    }}
                                                    className={`ml-1 transition-colors shrink-0 ${isDark ? 'text-gray-500 hover:text-red-500' : 'text-gray-400 hover:text-red-600'}`}
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <div className={`pt-2 border-t mt-2 ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                                        <p className={`text-xs text-center ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                            Click to add more files
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center">
                                    <p className={`text-sm mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                        Click to upload supporting documents
                                    </p>
                                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                                        PDF, DOC, DOCX, JPG, PNG, <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>(Max 10MB)</span>
                                    </p>
                                </div>
                            )}
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                        </div>
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
                        disabled={rejectLoading}
                        className="bg-red-600 hover:bg-red-700 flex-1 rounded-sm py-4 text-white px-6 disabled:opacity-50"
                    >
                        {rejectLoading ? 'Submitting...' : 'Submit Request'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default RejectApplicationModal;

