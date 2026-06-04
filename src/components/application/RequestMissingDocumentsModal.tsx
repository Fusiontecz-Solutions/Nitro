import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/context/ThemeContext";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { sendDocumentRequest } from "@/redux/actions/notificationActions";
import type { SendDocumentRequestPayload } from "@/redux/actions/notificationActions";
import { getApplicationByApplicationId, getApplicationById } from "@/redux/actions/applicationActions";
import { toast } from "react-toastify";

interface RequestMissingDocumentsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface SendBackFormValues {
    reason: string;
}

const documentOptions = [
    { id: "bank-statements", label: "Bank Statements - 12 months" },
    { id: "additional-id", label: "Additional ID Proof" },
    { id: "business-license", label: "Business License" },
    { id: "proof-of-address", label: "Proof of Address" },
    { id: "financial-statement", label: "Financial Statement" },
    { id: "voided-check", label: "Voided Check" },
    { id: "tax-returns", label: "Tax Returns- Last 2 Years" },
    { id: "articles-of-incorporation", label: "Articles of Incorporations" },
];

const RequestMissingDocumentsModal = ({ open, onOpenChange }: RequestMissingDocumentsModalProps) => {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const dispatch = useDispatch<AppDispatch>();
    const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
    const [requestAdditional, setRequestAdditional] = useState(false);
    const maxChars = 500;

    // Get application data from Redux
    const { data: applicationData } = useSelector((state: RootState) => state.applicationDetail);
    const { loading: sendRequestLoading } = useSelector((state: RootState) => state.sendDocumentRequest);

    const { control, handleSubmit, formState: { errors }, watch, reset } = useForm<SendBackFormValues>({
        defaultValues: {
            reason: "",
        },
    });

    const reasonText = watch("reason") || "";

    const handleDocumentToggle = (documentId: string) => {
        setSelectedDocuments((prev) =>
            prev.includes(documentId)
                ? prev.filter((id) => id !== documentId)
                : [...prev, documentId]
        );
    };

    const onSubmit = async (data: SendBackFormValues) => {
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
            // Ensure applicationId is properly formatted
            const formattedApplicationId = applicationId ? String(applicationId) : null;
            
            if (!formattedApplicationId) {
                toast.error('Application ID is required');
                return;
            }

            const payload: SendDocumentRequestPayload = {
                applicationId: formattedApplicationId,
                requestedDocuments: selectedDocuments.length > 0 ? selectedDocuments : [],
                requestAdditional: requestAdditional,
                reason: data.reason || undefined, // Include reason if provided
            };
            
            console.log('Sending document request with payload:', payload);
            const result = await dispatch(sendDocumentRequest(payload)).unwrap();

            toast.success('Document request sent successfully to agent');
            
            // Reset form
            reset();
            setSelectedDocuments([]);
            setRequestAdditional(false);
            
            // Close modal first for better UX
            onOpenChange(false);
            
            // The Redux slice will automatically update the application detail with the updated application
            // data (including the note) from the response. However, if the response doesn't include
            // the application data, we'll refetch as a fallback.
            const responseApplication = (result as any)?.application;
            if (!responseApplication) {
                // Fallback: Refetch application detail to update the UI (to show the reason in Action Required)
                try {
                    let refetchPromise;
                    if ((applicationData as any)?.applicationId) {
                        refetchPromise = dispatch(getApplicationByApplicationId(String((applicationData as any).applicationId)));
                    } else if ((applicationData as any)?._id) {
                        refetchPromise = dispatch(getApplicationById((applicationData as any)._id));
                    }
                    
                    if (refetchPromise) {
                        await refetchPromise;
                    }
                } catch (refetchError: any) {
                    console.error('Error refetching application:', refetchError);
                    // Continue anyway - the update might still be successful
                }
            }
        } catch (error: any) {
            toast.error(error || 'Failed to send document request');
        }
    };

    const handleCancel = () => {
        onOpenChange(false);
        // Reset form
        reset();
        setSelectedDocuments([]);
        setRequestAdditional(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-fit overflow-hidden">
                <DialogHeader>
                    <DialogTitle className={`text-xl font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                        Send Back for Documentation
                    </DialogTitle>
                    <DialogDescription className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                        Please provide a detailed reason for sending this application back for documentation.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Application and Borrower Information */}
                    <div className={`${isDark ? 'bg-[#282524]' : 'bg-amber-50'} p-4 pb-2 rounded-lg`}>
                        <div className="grid grid-cols-2 gap-2">
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
                            <div>
                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Borrower</p>
                                <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                                    {(applicationData as any)?.client?.owner?.firstName && (applicationData as any)?.client?.owner?.lastName
                                        ? `${(applicationData as any).client.owner.firstName} ${(applicationData as any).client.owner.lastName}`
                                        : 'N/A'}
                                </p>
                            </div>
                            <div>
                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Contact</p>
                                <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                                    {(applicationData as any)?.client?.business?.email || 
                                     (applicationData as any)?.client?.owner?.email || 
                                     'N/A'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Reason for Send Back */}
                    <div className="space-y-2">
                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                            Reason for Send Back for Documentation <span className="text-red-500">*</span>
                        </Label>
                        <Controller
                            control={control}
                            name="reason"
                            rules={{
                                required: "Reason for send back is required",
                                maxLength: {
                                    value: maxChars,
                                    message: `Reason must not exceed ${maxChars} characters`,
                                },
                            }}
                            render={({ field }) => (
                                <>
                                    <Textarea
                                        {...field}
                                        placeholder="Please provide a detailed explanation for why this application is being sent back for documentation..."
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

                    {/* Select Required Documents */}
                    <div className="space-y-4">
                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>
                            Select Required Documents <span className="text-red-500">*</span>
                        </Label>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {documentOptions.map((doc) => (
                                <div key={doc.id} className={`flex items-center space-x-2 border-1 rounded-xs px-2 py-2 ${isDark ? 'border-gray-700' : 'border-black'}`}>
                                    <Checkbox
                                        id={doc.id}
                                        checked={selectedDocuments.includes(doc.id)}
                                        onCheckedChange={() => handleDocumentToggle(doc.id)}
                                    />
                                    <Label
                                        htmlFor={doc.id}
                                        className={`text-sm font-normal cursor-pointer ${isDark ? 'text-gray-300' : 'text-black'}`}
                                    >
                                        {doc.label}
                                    </Label>
                                </div>
                            ))}
                        </div>

                        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            {selectedDocuments.length} document(s) selected.
                        </p>
                    </div>

                    {/* Request Additional Documents */}
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="request-additional"
                            checked={requestAdditional}
                            onCheckedChange={(checked: boolean | "indeterminate") => setRequestAdditional(checked === true)}
                        />
                        <Label
                            htmlFor="request-additional"
                            className={`text-sm font-normal cursor-pointer ${isDark ? 'text-gray-300' : 'text-black'}`}
                        >
                            Request Additional Documents
                        </Label>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between gap-3 w-full ">
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
                        disabled={sendRequestLoading}
                        className="bg-[#CA8A03] hover:bg-[#CA8A03] flex-1 rounded-sm py-4 text-white px-6 disabled:opacity-50"
                    >
                        {sendRequestLoading ? 'Submitting...' : 'Submit Request'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default RequestMissingDocumentsModal;

