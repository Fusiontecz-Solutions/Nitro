import { useEffect, useMemo, useRef, useState } from "react";

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

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";

import { useTheme } from "@/context/ThemeContext";

import { useDispatch, useSelector } from "react-redux";

import type { AppDispatch, RootState } from "@/redux/store";

import { sendDocumentRequest, getDocumentRequestsByApplication } from "@/redux/actions/notificationActions";

import type { SendDocumentRequestPayload } from "@/redux/actions/notificationActions";

import { getApplicationByApplicationId, getApplicationById } from "@/redux/actions/applicationActions";

import { toast } from "react-toastify";

import { isSentBackDocumentationRequest } from "@/lib/documentRequestMatch";

import { normalizeRoleKey } from "@/lib/sessionRole";

import { X } from "lucide-react";



export const DOCUMENT_REQUEST_OPTIONS = [

    { id: "bank-statements", label: "Bank Statements - 12 months" },

    { id: "bank-statements-mtd", label: "Bank Statements - MTD" },

    { id: "additional-id", label: "Additional ID Proof" },

    { id: "business-license", label: "Business License" },

    { id: "proof-of-address", label: "Proof of Address" },

    { id: "financial-statement", label: "Financial Statement" },

    { id: "voided-check", label: "Voided Check" },

    { id: "tax-returns", label: "Tax Returns- Last 2 Years" },

    { id: "articles-of-incorporation", label: "Articles of Incorporations" },

] as const;



interface RequestMissingDocumentsModalProps {

    open: boolean;

    onOpenChange: (open: boolean) => void;

    /** `send-back` = underwriting decision flow; `request` = contract modal (Documents step). */

    variant?: "send-back" | "request";

    onSuccess?: () => void;

}



interface SendBackFormValues {

    reason: string;

}



function isValidEmail(value: string): boolean {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

}



function normalizeEmailList(emails: string[]): string[] {

    const out = new Set<string>();

    for (const raw of emails) {

        const email = raw.trim().toLowerCase();

        if (email && isValidEmail(email)) out.add(email);

    }

    return [...out];

}



const RequestMissingDocumentsModal = ({

    open,

    onOpenChange,

    onSuccess,

}: RequestMissingDocumentsModalProps) => {

    const { resolvedTheme } = useTheme();

    const isDark = resolvedTheme === 'dark';

    const dispatch = useDispatch<AppDispatch>();

    const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);

    const [requestAdditional, setRequestAdditional] = useState(false);

    const [isoEmail, setIsoEmail] = useState("");

    const isoEmailTouchedRef = useRef(false);

    const [additionalToEmails, setAdditionalToEmails] = useState<string[]>([]);

    const [additionalToDraft, setAdditionalToDraft] = useState("");

    const [ccEmails, setCcEmails] = useState<string[]>([]);

    const [ccDraft, setCcDraft] = useState("");

    const maxChars = 500;



    const { data: applicationData } = useSelector((state: RootState) => state.applicationDetail);

    const { data: loginData } = useSelector((state: RootState) => state.login);

    const { loading: sendRequestLoading } = useSelector((state: RootState) => state.sendDocumentRequest);

    const { data: documentRequests, loading: documentRequestsLoading } = useSelector(
        (state: RootState) => state.documentRequests,
    );

    const roleKey = normalizeRoleKey(

        (loginData as { user?: { role?: string } } | null)?.user?.role ||

            (typeof window !== "undefined" ? localStorage.getItem("role") : "") ||

            "",

    );

    const isFinalUnderwriter = roleKey === "FINAL_UNDERWRITER";

    const isRequestVariant = true;

    const documentRequestLookupId = useMemo(() => {
        const numeric = (applicationData as { applicationId?: number } | null)?.applicationId;
        if (numeric != null) return String(numeric);
        const mongo =
            (applicationData as { _id?: string; id?: string } | null)?._id ??
            (applicationData as { id?: string } | null)?.id;
        return mongo ? String(mongo) : null;
    }, [applicationData]);

    const activeRequestDocIds = useMemo(
        () =>
            new Set(
                (documentRequests || [])
                    .map((doc) => {
                        if (isSentBackDocumentationRequest(doc.name)) {
                            return "sent-back-for-documentation";
                        }
                        return String(doc.name || "").trim().toLowerCase();
                    })
                    .filter(Boolean),
            ),
        [documentRequests],
    );

    const availableDocumentOptions = useMemo(
        () => DOCUMENT_REQUEST_OPTIONS.filter((doc) => !activeRequestDocIds.has(doc.id.toLowerCase())),
        [activeRequestDocIds],
    );



    const linkedIso = useMemo(() => {

        const app = applicationData as {

            iso?: { name?: string; email?: string | null };

        } | null;

        const iso = app?.iso;

        return {

            isLinked: Boolean(iso && (iso.name || iso.email)),

            name: String(iso?.name ?? "").trim(),

            email: String(iso?.email ?? "").trim(),

        };

    }, [applicationData]);



    const { control, handleSubmit, formState: { errors }, watch, reset } = useForm<SendBackFormValues>({

        defaultValues: {

            reason: "",

        },

    });



    const reasonText = watch("reason") || "";



    useEffect(() => {

        if (!open) {

            isoEmailTouchedRef.current = false;

            return;

        }

        isoEmailTouchedRef.current = false;

        setIsoEmail(linkedIso.email);

        setAdditionalToEmails([]);

        setCcEmails([]);

        setAdditionalToDraft("");

        setCcDraft("");

        setSelectedDocuments([]);

        setRequestAdditional(false);

    }, [open]);



    useEffect(() => {

        if (!open || !documentRequestLookupId) return;

        void dispatch(getDocumentRequestsByApplication(documentRequestLookupId));

    }, [open, documentRequestLookupId, dispatch]);



    useEffect(() => {

        if (!open) return;

        setSelectedDocuments((prev) =>

            prev.filter((id) => !activeRequestDocIds.has(id.toLowerCase())),

        );

    }, [open, activeRequestDocIds]);



    useEffect(() => {

        if (!open || isoEmailTouchedRef.current) return;

        setIsoEmail(linkedIso.email);

    }, [open, linkedIso.email]);



    const handleDocumentToggle = (documentId: string) => {

        setSelectedDocuments((prev) =>

            prev.includes(documentId)

                ? prev.filter((id) => id !== documentId)

                : [...prev, documentId]

        );

    };



    const addAdditionalToEmail = () => {

        const raw = additionalToDraft.trim();

        if (!raw) {

            toast.info("Enter an email address to add.");

            return;

        }

        if (!isValidEmail(raw)) {

            toast.error("Enter a valid email address.");

            return;

        }

        const normalized = raw.toLowerCase();

        if (isoEmail.trim().toLowerCase() === normalized) {

            toast.info("That address is already the ISO recipient.");

            return;

        }

        if (additionalToEmails.some((e) => e.toLowerCase() === normalized)) {

            toast.info("That address is already in the list.");

            return;

        }

        setAdditionalToEmails((prev) => [...prev, raw.trim()]);

        setAdditionalToDraft("");

    };



    const addCcEmail = () => {

        const raw = ccDraft.trim();

        if (!raw) {

            toast.info("Enter an email address to add.");

            return;

        }

        if (!isValidEmail(raw)) {

            toast.error("Enter a valid email address.");

            return;

        }

        const normalized = raw.toLowerCase();

        if (

            isoEmail.trim().toLowerCase() === normalized ||

            additionalToEmails.some((e) => e.toLowerCase() === normalized) ||

            ccEmails.some((e) => e.toLowerCase() === normalized)

        ) {

            toast.info("That address is already in the recipient list.");

            return;

        }

        setCcEmails((prev) => [...prev, raw.trim()]);

        setCcDraft("");

    };



    const resetEmailFields = () => {

        isoEmailTouchedRef.current = false;

        setIsoEmail(linkedIso.email);

        setAdditionalToEmails([]);

        setCcEmails([]);

        setAdditionalToDraft("");

        setCcDraft("");

    };



    const onSubmit = async (data: SendBackFormValues) => {

        if (!applicationData) {

            toast.error('Application data not found');

            return;

        }



        const applicationId = (applicationData as { applicationId?: number; _id?: string }).applicationId

            || (applicationData as { _id?: string })._id;



        if (!applicationId) {

            toast.error('Application ID not found');

            return;

        }



        if (isFinalUnderwriter && !String(data.reason || "").trim()) {

            toast.error("Reason is required when sending back for documentation.");

            return;

        }



        if (

            isRequestVariant &&

            selectedDocuments.length === 0 &&

            !requestAdditional

        ) {

            toast.error("Select at least one document type or check Request Additional Documents.");

            return;

        }



        const primaryIso = isoEmail.trim();

        const extraTo = normalizeEmailList(additionalToEmails);

        const ccList = normalizeEmailList(ccEmails);



        if (isRequestVariant) {

            if (!primaryIso || !isValidEmail(primaryIso)) {

                toast.error("Enter a valid ISO email address.");

                return;

            }

        }



        try {

            const formattedApplicationId = applicationId ? String(applicationId) : null;



            if (!formattedApplicationId) {

                toast.error('Application ID is required');

                return;

            }



            const payload: SendDocumentRequestPayload = {

                applicationId: formattedApplicationId,

                requestedDocuments: selectedDocuments.length > 0 ? selectedDocuments : [],

                requestAdditional: requestAdditional,

                reason: data.reason || undefined,

            };



            if (isRequestVariant) {

                payload.isoEmail = primaryIso;

                if (extraTo.length) payload.additionalToEmails = extraTo;

                if (ccList.length) payload.ccEmails = ccList;

            }



            const result = await dispatch(sendDocumentRequest(payload)).unwrap();



            const applicationMongoId =

                (applicationData as { _id?: string; id?: string } | null)?._id ??

                (applicationData as { id?: string } | null)?.id;

            if (applicationMongoId) {

                await dispatch(getDocumentRequestsByApplication(String(applicationMongoId)));

            }



            const emailSent = Boolean((result as { emailSent?: boolean })?.emailSent);

            const emailError = String((result as { emailError?: string })?.emailError || "").trim();

            if (isRequestVariant && !emailSent) {

                toast.warn(

                    emailError

                        ? `Document request saved, but SendGrid could not send the email: ${emailError}`

                        : "Document request saved. Email was not sent — check SendGrid settings (SENDGRID_API_KEY / SENDGRID_FROM_EMAIL).",

                );

            } else {

                toast.success(

                    isRequestVariant

                        ? "Document request emailed to ISO via SendGrid and logged in CRM."

                        : "Document request sent successfully to agent",

                );

            }

            onSuccess?.();



            reset();

            setSelectedDocuments([]);

            setRequestAdditional(false);

            resetEmailFields();



            onOpenChange(false);



            const responseApplication = (result as { application?: unknown })?.application;

            if (!responseApplication) {

                try {

                    let refetchPromise;

                    if ((applicationData as { applicationId?: number }).applicationId) {

                        refetchPromise = dispatch(

                            getApplicationByApplicationId(

                                String((applicationData as { applicationId?: number }).applicationId),

                            ),

                        );

                    } else if ((applicationData as { _id?: string })._id) {

                        refetchPromise = dispatch(

                            getApplicationById((applicationData as { _id: string })._id),

                        );

                    }



                    if (refetchPromise) {

                        await refetchPromise;

                    }

                } catch (refetchError: unknown) {

                    console.error('Error refetching application:', refetchError);

                }

            }

        } catch (error: unknown) {

            const message =

                typeof error === "string"

                    ? error

                    : (error as { message?: string })?.message || "Failed to send document request";

            toast.error(message);

        }

    };



    const handleCancel = () => {

        onOpenChange(false);

        reset();

        setSelectedDocuments([]);

        setRequestAdditional(false);

        resetEmailFields();

    };



    const renderEmailChipList = (

        emails: string[],

        onRemove: (email: string) => void,

        emptyLabel: string,

    ) =>

        emails.length ? (

            <div className="flex flex-wrap gap-2">

                {emails.map((email) => (

                    <span

                        key={email}

                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${isDark ? "border-slate-600 bg-slate-800 text-slate-100" : "border-slate-300 bg-white text-slate-800"}`}

                    >

                        {email}

                        <button

                            type="button"

                            onClick={() => onRemove(email)}

                            className="rounded-full p-0.5 hover:bg-slate-200/80 dark:hover:bg-slate-700"

                            aria-label={`Remove ${email}`}

                        >

                            <X className="h-3 w-3" />

                        </button>

                    </span>

                ))}

            </div>

        ) : (

            <p className={`text-xs ${isDark ? "text-gray-500" : "text-gray-500"}`}>{emptyLabel}</p>

        );



    return (

        <Dialog open={open} onOpenChange={onOpenChange}>

            <DialogContent

                overlayClassName="z-[10249]"

                className="z-[10250] flex max-h-[min(90vh,40rem)] w-[min(100vw-2rem,36rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"

            >

                <DialogHeader className="shrink-0 space-y-1.5 border-b px-6 py-4 text-left">

                    <DialogTitle className={`text-xl font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                        {isRequestVariant ? "Request Documents" : "Send Back for Documentation"}

                    </DialogTitle>

                    <DialogDescription className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>

                        {isRequestVariant

                            ? linkedIso.isLinked

                                ? "Email the linked ISO with the document list. The ISO address is prefilled but you can edit it, add more recipients, or CC others."

                                : "No ISO is linked to this application. Enter a recipient email to send the document request."

                            : "Please provide a detailed reason for sending this application back for documentation."}

                    </DialogDescription>

                </DialogHeader>



                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">

                    <div className={`${isDark ? 'bg-[#282524]' : 'bg-amber-50'} p-4 pb-2 rounded-lg`}>

                        <div className="grid grid-cols-2 gap-2">

                            <div>

                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Application ID</p>

                                <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                                    {(applicationData as { applicationId?: number })?.applicationId

                                        ? `LN-${(applicationData as { applicationId?: number }).applicationId}`

                                        : 'N/A'}

                                </p>

                            </div>

                            <div>

                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>ISO</p>

                                <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                                    {linkedIso.name || 'Not linked'}

                                </p>

                            </div>

                            <div>

                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Business</p>

                                <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                                    {(applicationData as { client?: { business?: { name?: string }; owner?: { firstName?: string; lastName?: string } } })?.client?.business?.name ||

                                     ((applicationData as { client?: { owner?: { firstName?: string; lastName?: string } } })?.client?.owner?.firstName &&

                                        (applicationData as { client?: { owner?: { lastName?: string } } })?.client?.owner?.lastName

                                        ? `${(applicationData as { client?: { owner?: { firstName?: string } } }).client?.owner?.firstName} ${(applicationData as { client?: { owner?: { lastName?: string } } }).client?.owner?.lastName}`

                                        : 'N/A')}

                                </p>

                            </div>

                            <div>

                                <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'} mb-1`}>Borrower</p>

                                <p className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                                    {(applicationData as { client?: { owner?: { firstName?: string; lastName?: string } } })?.client?.owner?.firstName &&

                                     (applicationData as { client?: { owner?: { lastName?: string } } })?.client?.owner?.lastName

                                        ? `${(applicationData as { client?: { owner?: { firstName?: string } } }).client?.owner?.firstName} ${(applicationData as { client?: { owner?: { lastName?: string } } }).client?.owner?.lastName}`

                                        : 'N/A'}

                                </p>

                            </div>

                        </div>

                    </div>



                    {isRequestVariant ? (

                        <div className="space-y-4 rounded-lg border border-[#CA8A03]/30 bg-[#CA8A03]/5 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">

                            <div className="space-y-2">

                                <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                                    ISO email (To)

                                    <span className="text-red-500"> *</span>

                                </Label>

                                <Input

                                    type="email"

                                    value={isoEmail}

                                    onChange={(e) => {

                                        isoEmailTouchedRef.current = true;

                                        setIsoEmail(e.target.value);

                                    }}

                                    placeholder="Enter ISO email"

                                    required

                                    className={isDark ? 'bg-muted border-gray-700 text-gray-200' : 'bg-white'}

                                />

                                <p className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>

                                    {linkedIso.isLinked

                                        ? linkedIso.email

                                            ? "Prefilled from the linked ISO record. Edit if needed."

                                            : "Linked ISO has no email on file — enter one below."

                                        : "Required when no ISO is linked to this application."}

                                </p>

                            </div>



                            <div className="space-y-2">

                                <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                                    Additional To

                                </Label>

                                <div className="flex gap-2">

                                    <Input

                                        type="email"

                                        value={additionalToDraft}

                                        onChange={(e) => setAdditionalToDraft(e.target.value)}

                                        onKeyDown={(e) => {

                                            if (e.key === "Enter") {

                                                e.preventDefault();

                                                addAdditionalToEmail();

                                            }

                                        }}

                                        placeholder="Add another recipient"

                                        className={isDark ? 'bg-muted border-gray-700 text-gray-200' : 'bg-white'}

                                    />

                                    <Button type="button" variant="outline" onClick={addAdditionalToEmail}>

                                        Add

                                    </Button>

                                </div>

                                {renderEmailChipList(

                                    additionalToEmails,

                                    (email) =>

                                        setAdditionalToEmails((prev) =>

                                            prev.filter((e) => e !== email),

                                        ),

                                    "No additional recipients.",

                                )}

                            </div>



                            <div className="space-y-2">

                                <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                                    CC

                                </Label>

                                <div className="flex gap-2">

                                    <Input

                                        type="email"

                                        value={ccDraft}

                                        onChange={(e) => setCcDraft(e.target.value)}

                                        onKeyDown={(e) => {

                                            if (e.key === "Enter") {

                                                e.preventDefault();

                                                addCcEmail();

                                            }

                                        }}

                                        placeholder="Add CC email"

                                        className={isDark ? 'bg-muted border-gray-700 text-gray-200' : 'bg-white'}

                                    />

                                    <Button type="button" variant="outline" onClick={addCcEmail}>

                                        Add

                                    </Button>

                                </div>

                                {renderEmailChipList(

                                    ccEmails,

                                    (email) =>

                                        setCcEmails((prev) => prev.filter((e) => e !== email)),

                                    "No CC recipients.",

                                )}

                            </div>

                        </div>

                    ) : null}



                    <div className="space-y-2">

                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                            {isRequestVariant ? "Note for ISO" : "Reason for Send Back for Documentation"}

                            {(isFinalUnderwriter || !isRequestVariant) ? (

                                <span className="text-red-500"> *</span>

                            ) : null}

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

                                        placeholder={

                                            isRequestVariant

                                                ? "Optional instructions for the ISO (e.g. date range for bank statements)..."

                                                : "Please provide a detailed explanation for why this application is being sent back for documentation..."

                                        }

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



                    <div className="space-y-4">

                        <Label className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-black'}`}>

                            Select Required Documents

                            {isRequestVariant ? <span className="text-red-500"> *</span> : null}

                        </Label>



                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">

                            {documentRequestsLoading ? (

                                <p className={`col-span-full text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>

                                    Loading existing document requests…

                                </p>

                            ) : availableDocumentOptions.length === 0 ? (

                                <p className={`col-span-full text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}>

                                    All listed document types are already requested for this application.

                                    Remove a request from the contract documents list to request it again, or use

                                    Request Additional Documents below.

                                </p>

                            ) : (

                                availableDocumentOptions.map((doc) => (

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

                                ))

                            )}

                        </div>



                        <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>

                            {selectedDocuments.length} document(s) selected.

                            {activeRequestDocIds.size > 0 ? (

                                <span className="block mt-1">

                                    {activeRequestDocIds.size} document type(s) already requested are hidden from this list.

                                </span>

                            ) : null}

                        </p>

                    </div>



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



                <div

                    className={`flex shrink-0 items-center justify-between gap-3 border-t px-6 py-4 ${isDark ? 'border-gray-700 bg-[#1a1b1e]' : 'border-gray-200 bg-white'}`}

                >

                    <Button

                        type="button"

                        variant="outline"

                        onClick={handleCancel}

                        className={`flex-1 rounded-sm border-gray-300 px-6 py-2.5 ${isDark ? 'bg-muted border-gray-700 text-gray-300 hover:bg-gray-700' : 'bg-white text-gray-700 hover:bg-gray-50'}`}

                    >

                        Cancel

                    </Button>

                    <Button

                        type="button"

                        onClick={handleSubmit(onSubmit)}

                        disabled={sendRequestLoading}

                        className="flex-1 rounded-sm bg-[#CA8A03] px-6 py-2.5 text-white hover:bg-[#CA8A03] disabled:opacity-50"

                    >

                        {sendRequestLoading

                            ? "Submitting..."

                            : isRequestVariant

                              ? "Send request"

                              : "Submit Request"}

                    </Button>

                </div>

            </DialogContent>

        </Dialog>

    );

};



export default RequestMissingDocumentsModal;


