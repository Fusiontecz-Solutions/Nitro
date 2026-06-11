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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/context/ThemeContext";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { sendDocumentRequest, getDocumentRequestsByApplication } from "@/redux/actions/notificationActions";
import type { SendDocumentRequestPayload } from "@/redux/actions/notificationActions";
import { getApplicationByApplicationId, getApplicationById } from "@/redux/actions/applicationActions";
import { toast } from "react-toastify";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type RequestMissingDocumentsVariant = "request" | "send-back";

interface RequestMissingDocumentsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    variant?: RequestMissingDocumentsVariant;
    onSuccess?: () => void;
}

interface RequestFormValues {
    reason: string;
    isoEmail: string;
}

const documentOptions = [
    { id: "bank-statements", label: "Bank Statements - 12 months" },
    { id: "additional-id", label: "Additional ID Proof" },
    { id: "business-license", label: "Business License" },
    { id: "proof-of-address", label: "Proof of Address" },
    { id: "financial-statement", label: "Financial Statement" },
    { id: "voided-check", label: "Voided Check" },
    { id: "tax-returns", label: "Tax Returns - Last 2 Years" },
    { id: "articles-of-incorporation", label: "Articles of Incorporations" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RequestMissingDocumentsModal = ({
    open,
    onOpenChange,
    variant = "send-back",
    onSuccess,
}: RequestMissingDocumentsModalProps) => {
    const isRequestVariant = variant === "request";
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const dispatch = useDispatch<AppDispatch>();
    const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
    const [requestAdditional, setRequestAdditional] = useState(false);
    const [additionalToEmails, setAdditionalToEmails] = useState<string[]>([]);
    const [ccEmails, setCcEmails] = useState<string[]>([]);
    const [additionalToDraft, setAdditionalToDraft] = useState("");
    const [ccDraft, setCcDraft] = useState("");
    const isoEmailTouchedRef = useRef(false);
    const maxChars = 500;

    const { data: applicationData } = useSelector((state: RootState) => state.applicationDetail);
    const { loading: sendRequestLoading } = useSelector((state: RootState) => state.sendDocumentRequest);
    const currentUserRole = useSelector(
        (state: RootState) =>
            state.login?.data?.user?.role || localStorage.getItem("role") || "",
    );
    const isFinalUnderwriter = String(currentUserRole).toUpperCase() === "FINAL_UNDERWRITER";

    const linkedIso = (applicationData as any)?.iso;
    const hasLinkedIso = Boolean(linkedIso?.id || linkedIso?._id);
    const linkedIsoEmail = String(linkedIso?.email || "").trim();

    const { control, handleSubmit, formState: { errors }, watch, reset, setValue } = useForm<RequestFormValues>({
        defaultValues: {
            reason: "",
            isoEmail: "",
        },
    });

    const reasonText = watch("reason") || "";

    const resetFormState = () => {
        reset({ reason: "", isoEmail: "" });
        setSelectedDocuments([]);
        setRequestAdditional(false);
        setAdditionalToEmails([]);
        setCcEmails([]);
        setAdditionalToDraft("");
        setCcDraft("");
        isoEmailTouchedRef.current = false;
    };

    useEffect(() => {
        if (!open) {
            resetFormState();
            return;
        }
        isoEmailTouchedRef.current = false;
        setAdditionalToEmails([]);
        setCcEmails([]);
        setAdditionalToDraft("");
        setCcDraft("");
        if (isRequestVariant && linkedIsoEmail) {
            setValue("isoEmail", linkedIsoEmail);
        } else if (isRequestVariant) {
            setValue("isoEmail", "");
        }
    }, [open, isRequestVariant, linkedIsoEmail, setValue]);

    useEffect(() => {
        if (!open || !isRequestVariant || isoEmailTouchedRef.current) return;
        if (linkedIsoEmail) {
            setValue("isoEmail", linkedIsoEmail);
        }
    }, [open, isRequestVariant, linkedIsoEmail, setValue]);

    const setDocumentSelected = (documentId: string, selected: boolean) => {
        setSelectedDocuments((prev) => {
            if (selected) {
                return prev.includes(documentId) ? prev : [...prev, documentId];
            }
            return prev.filter((id) => id !== documentId);
        });
    };

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

    const removeEmailFromList = (email: string, list: string[], setList: (next: string[]) => void) => {
        setList(list.filter((e) => e !== email));
    };

    const onSubmit = async (data: RequestFormValues) => {
        if (!applicationData) {
            toast.error("Application data not found");
            return;
        }

        if (selectedDocuments.length === 0 && !requestAdditional) {
            toast.error("Select at least one document type or Request Additional Documents");
            return;
        }

        if (isRequestVariant) {
            const primaryEmail = data.isoEmail?.trim() || "";
            if (!primaryEmail && additionalToEmails.length === 0) {
                toast.error("Enter an ISO email or add at least one Additional To address");
                return;
            }
            if (primaryEmail && !EMAIL_PATTERN.test(primaryEmail)) {
                toast.error("Enter a valid ISO email address");
                return;
            }
        }

        const applicationId = (applicationData as any).applicationId || (applicationData as any)._id;
        if (!applicationId) {
            toast.error("Application ID not found");
            return;
        }

        try {
            const payload: SendDocumentRequestPayload = {
                applicationId: String(applicationId),
                requestedDocuments: selectedDocuments,
                requestAdditional,
                reason: data.reason?.trim() || undefined,
            };

            if (isRequestVariant) {
                payload.isoEmail = data.isoEmail?.trim() || "";
                if (additionalToEmails.length > 0) {
                    payload.additionalToEmails = additionalToEmails;
                }
                if (ccEmails.length > 0) {
                    payload.ccEmails = ccEmails;
                }
            }

            const result = await dispatch(sendDocumentRequest(payload)).unwrap();
            const emailSent = Boolean((result as any)?.emailSent);

            if (emailSent) {
                toast.success("Document request emailed to ISO via SendGrid and logged in CRM.");
            } else if (isRequestVariant) {
                toast.success((result as any)?.message || "Document request sent successfully");
            } else {
                toast.success("Document request sent successfully to agent");
            }

            resetFormState();
            onOpenChange(false);

            const responseApplication = (result as any)?.application;
            if (!responseApplication) {
                try {
                    if ((applicationData as any)?.applicationId) {
                        await dispatch(
                            getApplicationByApplicationId(String((applicationData as any).applicationId)),
                        );
                    } else if ((applicationData as any)?._id) {
                        await dispatch(getApplicationById((applicationData as any)._id));
                    }
                } catch {
                    /* ignore refetch errors */
                }
            }

            const docLookupId =
                (applicationData as any)?.applicationId ??
                (applicationData as any)?._id ??
                (applicationData as any)?.id;
            if (docLookupId != null) {
                await dispatch(getDocumentRequestsByApplication(docLookupId));
            }

            onSuccess?.();
        } catch (error: any) {
            const errPayload =
                typeof error === "object" && error !== null && "message" in error ? error : { message: String(error) };
            const message = errPayload.message || "Failed to send document request";
            if (errPayload.emailSent === false || errPayload.status === 502) {
                toast.error(message);
            } else {
                toast.error(message);
            }
        }
    };

    const handleCancel = () => {
        onOpenChange(false);
        resetFormState();
    };

    const businessName =
        (applicationData as any)?.client?.business?.name ||
        ((applicationData as any)?.client?.owner?.firstName &&
        (applicationData as any)?.client?.owner?.lastName
            ? `${(applicationData as any).client.owner.firstName} ${(applicationData as any).client.owner.lastName}`
            : "N/A");

    const borrowerName =
        (applicationData as any)?.client?.owner?.firstName &&
        (applicationData as any)?.client?.owner?.lastName
            ? `${(applicationData as any).client.owner.firstName} ${(applicationData as any).client.owner.lastName}`
            : "N/A";

    const isoName = linkedIso?.name || "N/A";

    const isoEmailHelper = (() => {
        if (!isRequestVariant) return null;
        if (hasLinkedIso && linkedIsoEmail) {
            return "Prefilled from the linked ISO record. Edit if needed.";
        }
        if (hasLinkedIso && !linkedIsoEmail) {
            return "Linked ISO has no email on file — enter one below.";
        }
        return "No ISO is linked to this application. Enter a recipient email to send the document request.";
    })();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="z-[10250] flex max-h-[min(90vh,820px)] w-full max-w-[640px] flex-col gap-0 overflow-hidden p-0"
                overlayClassName="z-[10249]"
            >
                <div className="shrink-0 border-b px-6 py-4 dark:border-gray-700">
                    <DialogHeader className="space-y-1.5 text-left">
                        <DialogTitle className={`text-lg font-semibold ${isDark ? "text-gray-100" : "text-slate-900"}`}>
                            {isRequestVariant ? "Request Documents" : "Send Back for Documentation"}
                        </DialogTitle>
                        <DialogDescription className={`text-sm ${isDark ? "text-gray-400" : "text-slate-600"}`}>
                            {isRequestVariant
                                ? "Select documents to request from the ISO and send the request by email."
                                : "Please provide a detailed reason for sending this application back for documentation."}
                        </DialogDescription>
                    </DialogHeader>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
                    <div
                        className={cn(
                            "rounded-lg border p-4",
                            isDark ? "border-gray-700 bg-[#282524]" : "border-amber-200/80 bg-amber-50",
                        )}
                    >
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                            <div>
                                <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"} mb-1`}>
                                    Application ID
                                </p>
                                <p className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                    {(applicationData as any)?.applicationId
                                        ? `LN-${(applicationData as any).applicationId}`
                                        : "N/A"}
                                </p>
                            </div>
                            {isRequestVariant ? (
                                <div>
                                    <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"} mb-1`}>ISO</p>
                                    <p className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                        {isoName}
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"} mb-1`}>
                                        Contact
                                    </p>
                                    <p className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                        {(applicationData as any)?.client?.business?.email ||
                                            (applicationData as any)?.client?.owner?.email ||
                                            "N/A"}
                                    </p>
                                </div>
                            )}
                            <div>
                                <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"} mb-1`}>Business</p>
                                <p className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                    {businessName}
                                </p>
                            </div>
                            <div>
                                <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-600"} mb-1`}>Borrower</p>
                                <p className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                    {borrowerName}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-slate-900"}`}>
                            Select Required Documents
                        </Label>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {documentOptions.map((doc) => {
                                const isSelected = selectedDocuments.includes(doc.id);
                                return (
                                    <label
                                        key={doc.id}
                                        className={cn(
                                            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                                            isSelected
                                                ? isDark
                                                    ? "border-[#276D9C]/50 bg-[#276D9C]/10"
                                                    : "border-[#276D9C]/40 bg-[#276D9C]/5"
                                                : isDark
                                                  ? "border-gray-700 bg-transparent hover:bg-gray-800/50"
                                                  : "border-slate-200 bg-white hover:bg-slate-50",
                                        )}
                                    >
                                        <Checkbox
                                            checked={isSelected}
                                            className="mt-0.5 size-4 shrink-0"
                                            onCheckedChange={(checked: boolean | "indeterminate") =>
                                                setDocumentSelected(doc.id, checked === true)
                                            }
                                        />
                                        <span
                                            className={cn(
                                                "text-sm leading-snug",
                                                isDark ? "text-gray-200" : "text-slate-800",
                                            )}
                                        >
                                            {doc.label}
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                        <p className={`text-xs ${isDark ? "text-gray-400" : "text-slate-500"}`}>
                            {selectedDocuments.length} document{selectedDocuments.length === 1 ? "" : "s"} selected
                            {requestAdditional ? " (+ additional)" : ""}
                        </p>
                    </div>

                    <label
                        className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5",
                            requestAdditional
                                ? isDark
                                    ? "border-[#276D9C]/50 bg-[#276D9C]/10"
                                    : "border-[#276D9C]/40 bg-[#276D9C]/5"
                                : isDark
                                  ? "border-gray-700"
                                  : "border-slate-200",
                        )}
                    >
                        <Checkbox
                            checked={requestAdditional}
                            className="size-4 shrink-0"
                            onCheckedChange={(checked: boolean | "indeterminate") =>
                                setRequestAdditional(checked === true)
                            }
                        />
                        <span className={`text-sm ${isDark ? "text-gray-200" : "text-slate-800"}`}>
                            Request Additional Documents
                        </span>
                    </label>

                    {isRequestVariant ? (
                        <div className="space-y-2">
                            <Label className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                Optional Note for ISO
                            </Label>
                            <Controller
                                control={control}
                                name="reason"
                                rules={{
                                    maxLength: {
                                        value: maxChars,
                                        message: `Note must not exceed ${maxChars} characters`,
                                    },
                                }}
                                render={({ field }) => (
                                    <>
                                        <Textarea
                                            {...field}
                                            placeholder="Optional note to include in the ISO email..."
                                            className={`min-h-[80px] resize-none px-3 py-2 rounded-sm outline-none ${isDark ? "bg-muted border-gray-700 text-gray-200" : "bg-white"}`}
                                            maxLength={maxChars}
                                        />
                                        <p className={`text-xs ml-auto ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                                            {reasonText.length}/{maxChars} characters
                                        </p>
                                    </>
                                )}
                            />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                Reason for Send Back for Documentation{" "}
                                {isFinalUnderwriter ? <span className="text-red-500">*</span> : null}
                            </Label>
                            <Controller
                                control={control}
                                name="reason"
                                rules={{
                                    required: isFinalUnderwriter
                                        ? "Reason for send back is required"
                                        : false,
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
                                            className={`min-h-[120px] resize-none px-3 py-2 rounded-sm outline-none ${isDark ? "bg-muted border-gray-700 text-gray-200" : "bg-white"}`}
                                            maxLength={maxChars}
                                        />
                                        <div className="flex justify-between items-center">
                                            {errors.reason && (
                                                <p className="text-xs text-red-500">{errors.reason.message}</p>
                                            )}
                                            <p className={`text-xs ml-auto ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                                                {reasonText.length}/{maxChars} characters
                                            </p>
                                        </div>
                                    </>
                                )}
                            />
                        </div>
                    )}

                    {isRequestVariant ? (
                        <>
                            <div className="space-y-2">
                                <Label className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                    ISO email (To) <span className="text-red-500">*</span>
                                </Label>
                                <Controller
                                    control={control}
                                    name="isoEmail"
                                    rules={{
                                        validate: (value) => {
                                            const trimmed = String(value || "").trim();
                                            if (trimmed && !EMAIL_PATTERN.test(trimmed)) {
                                                return "Enter a valid email address";
                                            }
                                            if (!trimmed && additionalToEmails.length === 0) {
                                                return "ISO email or Additional To is required";
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
                                            {isoEmailHelper ? (
                                                <p className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>
                                                    {isoEmailHelper}
                                                </p>
                                            ) : null}
                                        </>
                                    )}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                    Additional To
                                </Label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {additionalToEmails.map((email) => (
                                        <span
                                            key={email}
                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${isDark ? "border-gray-600 bg-gray-800" : "border-gray-200 bg-gray-50"}`}
                                        >
                                            {email}
                                            <button
                                                type="button"
                                                className="text-gray-500 hover:text-red-600"
                                                onClick={() =>
                                                    removeEmailFromList(email, additionalToEmails, setAdditionalToEmails)
                                                }
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        type="email"
                                        placeholder="extra@example.com"
                                        value={additionalToDraft}
                                        onChange={(e) => setAdditionalToDraft(e.target.value)}
                                        className={isDark ? "bg-muted border-gray-700" : ""}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                addEmailToList(
                                                    additionalToDraft,
                                                    additionalToEmails,
                                                    setAdditionalToEmails,
                                                    () => setAdditionalToDraft(""),
                                                );
                                            }
                                        }}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            addEmailToList(
                                                additionalToDraft,
                                                additionalToEmails,
                                                setAdditionalToEmails,
                                                () => setAdditionalToDraft(""),
                                            )
                                        }
                                    >
                                        Add
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label className={`text-sm font-semibold ${isDark ? "text-gray-200" : "text-black"}`}>
                                    CC
                                </Label>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {ccEmails.map((email) => (
                                        <span
                                            key={email}
                                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${isDark ? "border-gray-600 bg-gray-800" : "border-gray-200 bg-gray-50"}`}
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
                            </div>
                        </>
                    ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-3 border-t px-6 py-4 dark:border-gray-700">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        className={cn(
                            "h-10 flex-1 rounded-md",
                            isDark
                                ? "border-gray-700 bg-muted text-gray-300 hover:bg-gray-700"
                                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                        )}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSubmit(onSubmit)}
                        disabled={sendRequestLoading}
                        className="h-10 flex-1 rounded-md bg-[#CA8A03] px-6 text-white hover:bg-[#CA8A03]/90 disabled:opacity-50"
                    >
                        {sendRequestLoading
                            ? "Submitting..."
                            : isRequestVariant
                              ? "Send Request"
                              : "Submit Request"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default RequestMissingDocumentsModal;
