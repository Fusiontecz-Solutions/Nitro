import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import ApprovedApplicationModal from "./ApprovedApplicationModal";
import RequestMissingDocumentsModal from "./RequestMissingDocumentsModal";
import RejectApplicationModal from "./RejectApplicationModal";
import { useTheme } from "@/context/ThemeContext";
import { useSelector, useDispatch } from "react-redux";
import type { RootState, AppDispatch } from "@/redux/store";
import { getComplianceChecks } from "@/redux/actions/complianceCheckActions";
import { getApplicationActivityLogs } from "@/redux/actions/applicationActivityLogActions";
import { Check, X } from "lucide-react";

interface ChecksAndDecisionProps {
    /** When true, Approved modal shows "Proceed to Generate Contract" (FINAL_UNDERWRITER only) */
    isFinalUnderwriter?: boolean;
    /** Super Admin on Decision Making — same ISO approval-mail CTA as Final Underwriter. */
    canSendApprovalMailToIso?: boolean;
    /** Called when FINAL_UNDERWRITER clicks Proceed to Generate Contract */
    onProceedToContract?: () => void;
    /** When true, hides the "Make Underwriting Decision" action buttons (e.g. deal pipeline read-only view). */
    hideUnderwritingDecision?: boolean;
    /** When true, hides decision actions while browsing a past workflow stage. */
    previewMode?: boolean;
}

const ChecksAndDecision = ({
    isFinalUnderwriter,
    canSendApprovalMailToIso,
    onProceedToContract,
    hideUnderwritingDecision,
    previewMode,
}: ChecksAndDecisionProps = {}) => {
    const showIsoApprovalMailFlow = Boolean(isFinalUnderwriter || canSendApprovalMailToIso);
    const showUnderwritingDecision = !hideUnderwritingDecision && !previewMode;
    const { applicationId: paramApplicationId } = useParams<{ applicationId: string }>();
    const dispatch = useDispatch<AppDispatch>();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    const applicationData = useSelector((state: RootState) => state.applicationDetail.data);
    const applicationUuid =
        (applicationData as { _id?: string; id?: string })?._id ??
        (applicationData as { id?: string })?.id ??
        null;
    const complianceApplicationId =
        paramApplicationId ??
        (applicationData as { applicationId?: string | number })?.applicationId?.toString() ??
        applicationUuid;

    // Derive application status/queue to control decision button availability
    const status = (applicationData as any)?.currentState || (applicationData as any)?.status;
    const queue = (applicationData as any)?.currentQueue || (applicationData as any)?.queue;
    const explicitStatus = (applicationData as any)?.status;
    const statusNorm = typeof status === "string" ? status.trim().toLowerCase() : "";
    const queueNorm = typeof queue === "string" ? queue.trim().toLowerCase() : "";
    const explicitStatusNorm =
        typeof explicitStatus === "string" ? explicitStatus.trim().toLowerCase() : "";

    const isCompletedStatus = statusNorm === "completed";
    const isApprovedStatus = explicitStatusNorm === "approved";
    const isApprovedQueue = queueNorm === "approved";
    const isSentToFinalUnderwriter =
        queueNorm === "final review" || queueNorm === "final underwriter";
    const isContractedQueue =
        queueNorm === "contracted" ||
        queueNorm === "contract out" ||
        queueNorm === "contracts out";

    // Once sent to Final Underwriter or approved/contracted/completed, lock the primary decision button
    const disablePrimaryDecisionButton =
        isSentToFinalUnderwriter ||
        isApprovedStatus ||
        isApprovedQueue ||
        isCompletedStatus ||
        isContractedQueue;

    // Fetch compliance checks when application is available
    useEffect(() => {
        if (complianceApplicationId) {
            dispatch(getComplianceChecks({ application: complianceApplicationId }));
        }
    }, [complianceApplicationId, dispatch]);

    // Final Underwriter view: load the saved offer decision so we can detect whether
    // the FU has already updated the offer values. That toggles the primary CTA
    // between "Approved application" (no offer change yet OR mail already sent) and
    // "Send Approval Mail to ISO" (FU updated the offer, mail not yet sent).
    useEffect(() => {
        if (showIsoApprovalMailFlow && applicationUuid) {
            dispatch(getApplicationActivityLogs(paramApplicationId ?? applicationUuid));
        }
    }, [showIsoApprovalMailFlow, applicationUuid, paramApplicationId, dispatch]);

    // Keep ISO approval-mail CTA state fresh after ISO comments / offer edits without requiring manual refresh.
    useEffect(() => {
        if (!showIsoApprovalMailFlow || !applicationUuid) return;

        const refresh = () => {
            dispatch(getApplicationActivityLogs(paramApplicationId ?? applicationUuid));
        };

        const intervalId = window.setInterval(refresh, 8000);
        const onVisibilityChange = () => {
            if (!document.hidden) refresh();
        };
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            window.clearInterval(intervalId);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [showIsoApprovalMailFlow, applicationUuid, paramApplicationId, dispatch]);

    const activityLogs = useSelector((state: RootState) => state.activityLogs.logs) as Array<{
        actionType?: string;
        actionDescription?: string;
        metadata?: Record<string, unknown> | null;
    }>;

    // Strict activity-log rule requested:
    // if approval mail already sent once, show resend CTA.
    const hasSentApprovalMailOnce = Array.isArray(activityLogs)
        ? activityLogs.some((log) => {
            const actionTypeNorm = String(log?.actionType || "").trim().toUpperCase();
            const descriptionNorm = String(log?.actionDescription || "").trim().toLowerCase();
            const templateNorm = String((log?.metadata as any)?.template || "").trim().toLowerCase();
            return (
                actionTypeNorm === "APPROVED" &&
                (templateNorm === "approval" ||
                    templateNorm === "offer-updated" ||
                    descriptionNorm.includes("sent approval email") ||
                    descriptionNorm.includes("resent updated offer email"))
            );
        })
        : false;

    // Once the approval mail has been sent for this application it must NEVER revert
    // to "Send Approval Mail to ISO". The activity-log slice is shared and can be
    // overwritten (or briefly empty) by other fetches, so we also treat any
    // application that has already advanced past approval as "mail already sent",
    // and we keep a sticky flag so a transient empty log list can't flip it back.
    const applicationAlreadyApproved =
        isApprovedStatus || isApprovedQueue || isCompletedStatus || isContractedQueue;

    const [approvalMailSentSticky, setApprovalMailSentSticky] = useState(false);

    // Reset the sticky flag whenever we switch to a different application.
    useEffect(() => {
        setApprovalMailSentSticky(false);
    }, [applicationUuid]);

    useEffect(() => {
        if (hasSentApprovalMailOnce || applicationAlreadyApproved) {
            setApprovalMailSentSticky(true);
        }
    }, [hasSentApprovalMailOnce, applicationAlreadyApproved]);

    const shouldResendApprovalMail =
        showIsoApprovalMailFlow &&
        (hasSentApprovalMailOnce || applicationAlreadyApproved || approvalMailSentSticky);

    const isoApprovalMailButtonLabel = shouldResendApprovalMail
        ? "Resend Approval Mail to ISO"
        : "Send Approval Mail to ISO";

    const isoApprovalMailButtonDescription = shouldResendApprovalMail
        ? "ISO commented and offer was updated. Send the updated offer email."
        : "Send the approval email to the linked ISO";

    // Get compliance checks from Redux
    const { data: complianceChecksData } = useSelector(
        (state: RootState) => state.complianceChecks
    );

    // Filter out checks answered "yes" to surface their questions and reasons
    const yesChecks = complianceChecksData && Array.isArray(complianceChecksData)
        ? complianceChecksData.filter((check) => check.answer === "yes")
        : [];

    // Calculate counts from API data
    const yesCount = yesChecks.length;
    
    const noCount = complianceChecksData && Array.isArray(complianceChecksData)
        ? complianceChecksData.filter(check => check.answer === 'no').length
        : 0;

    const [isYesDetailsOpen, setIsYesDetailsOpen] = useState(false);
    const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
    const [isRequestDocumentsModalOpen, setIsRequestDocumentsModalOpen] = useState(false);
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);

    useEffect(() => {
        if (showIsoApprovalMailFlow && applicationUuid && isApprovalModalOpen) {
            dispatch(getApplicationActivityLogs(paramApplicationId ?? applicationUuid));
        }
    }, [showIsoApprovalMailFlow, applicationUuid, isApprovalModalOpen, paramApplicationId, dispatch]);
    return (
        <div className="space-y-6 w-full">
            {/* Checks Section */}
            <div className={`border border-[#FDFDFD] shadow-[0px_4px_20px_0px_#00000005] mb-6 flex flex-col gap-4 w-full  pt-0 rounded-lg overflow-hidden 
            ${isDark ? 'bg-card border-white' : 'bg-white'}`}
            >
                <h2 className={`text-base font-roboto w-full font-semibold ${isDark ? 'bg-card' : 'bg-[#F9FAFD]'} px-6 py-2 ${isDark ? 'text-gray-200' : 'text-[#374151]'}`}>Checks</h2>
                
                {/* Two Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-6 py-2">
                    {/* Answered "Yes" Card */}
                    <Card className={`${isDark ? 'bg-muted' : 'bg-white'} border border-[#D1D5DB] rounded-sm shadow-[0px_4px_20px_0px_#00000005] px-5 py-2 bg-transparent`}>
                        <CardContent className="p-0">
                            <div className="flex justify-between items-center">
                                <div className="flex-1">
                                    <p className={`text-sm font-inter font-semibold ${isDark ? 'text-gray-400' : 'text-[#898990]'} mb-2`}>Answered "Yes"</p>
                                    <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-black'} mb-2`}>{yesCount}</p>
                                    {yesChecks.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setIsYesDetailsOpen(true)}
                                            className="text-xs text-[#DC331D] font-inter font-[400] underline-offset-2 hover:underline cursor-pointer"
                                        >
                                            click to view details
                                        </button>
                                    )}
                             
                                </div>
                                <div
                                    className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${isDark ? 'bg-red-950/50 ring-1 ring-red-500/30' : 'bg-red-100 ring-1 ring-red-200/80'}`}
                                    aria-hidden
                                >
                                    <Check
                                        className={`h-8 w-8 stroke-[2.5] ${isDark ? 'text-red-400' : 'text-red-600'}`}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Answered "No" Card */}
                    <Card className={`${isDark ? 'bg-muted' : 'bg-white'} border border-[#D1D5DB] rounded-sm shadow-[0px_4px_20px_0px_#00000005] px-5 py-2`}>
                        <CardContent className="p-0">
                            <div className="flex justify-between items-center">
                                <div className="flex-1">
                                    <p className={`text-sm font-inter font-semibold ${isDark ? 'text-gray-400' : 'text-[#898990]'} mb-2`}>Answered "No"</p>
                                    <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-black'} mb-2`}>{noCount}</p>
                                    {/* <p className="text-xs text-[#16A34A] font-inter font-[400]">All Clear</p> */}
                                </div>
                                <div
                                    className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${isDark ? 'bg-green-950/50 ring-1 ring-green-500/30' : 'bg-green-100 ring-1 ring-green-200/80'}`}
                                    aria-hidden
                                >
                                    <X
                                        className={`h-8 w-8 stroke-[2.5] ${isDark ? 'text-green-400' : 'text-green-600'}`}
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>


                {/* Compliance Checks Progress Bar */}
                <div className="px-6 py-2">
                    {(() => {
                        // Calculate progress from API data
                        const totalQuestions = 6; // Default number of questions
                        const completedChecks = yesCount + noCount;
                        const progressPercentage = totalQuestions > 0 ? Math.round((completedChecks / totalQuestions) * 100) : 0;
                        
                        return (
                            <>
                                <div className="flex items-center justify-between mb-3">
                                    <p className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-[#374151]'}`}>Compliance Checks Progress</p>
                                    <p className={`text-base font-bold ${isDark ? 'text-gray-300' : 'text-[#374151]'}`}>{progressPercentage}%</p>
                                </div>
                                <div className="relative w-full mb-2">
                                    <div className={`w-full ${isDark ? 'bg-muted' : 'bg-gray-100'} rounded-full h-2.5`}>
                                        <div 
                                            className="h-full bg-[#276D9C] rounded-full transition-all duration-300"
                                            style={{ width: `${progressPercentage}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-xs text-red-600 mt-2 text-right font-semibold">
                                        {yesCount} Flag{yesCount !== 1 ? 's' : ''} Raised
                                    </p>
                                </div>
                            </>
                        );
                    })()}
                </div>

                {/* List of questions and reasons where the answer is "yes" */}
                {yesChecks.length > 0 && (
                    <div className="px-6 pb-4">
                        <p className={`text-sm font-medium mb-2 ${isDark ? 'text-gray-200' : 'text-[#374151]'}`}>
                            Questions answered &quot;Yes&quot;
                        </p>
                        <div className={`rounded-md border ${isDark ? 'border-[#374151] bg-[#111827]' : 'border-gray-200 bg-white'} max-h-40 overflow-y-auto`}>
                            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                                {yesChecks.map((check, idx) => (
                                    <li key={check._id ?? idx} className="px-3 py-2 text-sm">
                                        <p className={isDark ? 'text-gray-100' : 'text-gray-900'}>
                                            {check.question}
                                        </p>
                                        {check.reason && (
                                            <p className={`mt-1 text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                                Reason: {check.reason}
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}
            </div>

            {/* Make Underwriting Decision Section */}
            {showUnderwritingDecision && (
            <div className={`border border-[#FDFDFD] shadow-[0px_4px_20px_0px_#00000005] my-6 flex flex-col gap-4 w-full pt-0 rounded-lg overflow-hidden ${isDark ? 'bg-card border-white' : 'bg-white'}`}>
            <h2 className={`text-base font-roboto w-full font-semibold ${isDark ? 'bg-card' : 'bg-[#F9FAFD]'} px-6 py-2 ${isDark ? 'text-gray-200' : 'text-[#374151]'}`}>Make Underwriting Decision</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-6 pb-6">
                    {/* Approved Button */}
                    <Button
                        onClick={() => setIsApprovalModalOpen(true)}
                        disabled={showIsoApprovalMailFlow ? false : disablePrimaryDecisionButton}
                        className="rounded-sm bg-[#16A34A] hover:bg-green-700 text-white h-auto py-4 px-3 box-border cursor-pointer flex flex-col gap-1.5 items-center justify-center text-center w-full overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <span className="text-base font-roboto font-bold whitespace-normal break-words w-full px-1">
                            {showIsoApprovalMailFlow
                                ? isoApprovalMailButtonLabel
                                : "Send application to Final-underwriter"}
                        </span>
                        <span className="text-xs font-normal opacity-90 whitespace-normal break-words w-full leading-snug px-1">
                            {showIsoApprovalMailFlow
                                ? isoApprovalMailButtonDescription
                                : "Confirm terms and send for final underwriting review"}
                        </span>
                    </Button>

                    {/* Send back for documents Button */}
                    <Button
                        onClick={() => setIsRequestDocumentsModalOpen(true)}
                        className="rounded-sm bg-[#EAA95A] hover:bg-[#EAA95A]/90 text-white h-auto py-4 px-3 box-border cursor-pointer flex flex-col gap-1.5 items-center justify-center text-center w-full overflow-hidden"
                    >
                        <span className="text-base font-roboto font-bold whitespace-normal break-words w-full px-1">Send back for documents</span>
                        <span className="text-xs font-normal opacity-90 whitespace-normal break-words w-full leading-snug px-1">Request additional documents</span>
                    </Button>

                    {/* Decline Button */}
                    <Button
                        onClick={() => setIsRejectModalOpen(true)}
                        className="rounded-sm bg-[#DC331D] hover:bg-[#DC331D]/90 text-white h-auto py-4 px-3 box-border cursor-pointer flex flex-col gap-1.5 items-center justify-center text-center w-full overflow-hidden"
                    >
                        <span className="text-base font-roboto font-bold whitespace-normal break-words w-full px-1">Decline</span>
                        <span className="text-xs font-normal opacity-90 whitespace-normal break-words w-full leading-snug px-1">Decline this application</span>
                    </Button>
                </div>
            </div>
            )}

            {/* Yes details modal */}
            <Dialog open={isYesDetailsOpen} onOpenChange={setIsYesDetailsOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Checks answered &quot;Yes&quot;</DialogTitle>
                    </DialogHeader>
                    <div className="mt-2 max-h-64 overflow-y-auto space-y-3">
                        {yesChecks.map((check, idx) => (
                            <div key={check._id ?? idx} className="border-b border-gray-200 dark:border-gray-700 pb-2 last:border-b-0">
                                <p className={isDark ? "text-gray-100 text-sm" : "text-gray-900 text-sm"}>
                                    {check.question}
                                </p>
                                {check.reason && (
                                    <p className={isDark ? "text-gray-400 text-xs mt-1" : "text-gray-600 text-xs mt-1"}>
                                        Reason: {check.reason}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>

            {showUnderwritingDecision && (
                <>
            {/* Approved Application Modal */}
            <ApprovedApplicationModal
                open={isApprovalModalOpen}
                onOpenChange={setIsApprovalModalOpen}
                isFinalUnderwriter={showIsoApprovalMailFlow}
                showComplianceChecks={
                    canSendApprovalMailToIso && !isFinalUnderwriter
                        ? true
                        : undefined
                }
                onProceedToContract={onProceedToContract}
                resendApprovalEmail={shouldResendApprovalMail}
                onOfferUpdated={() => {
                    if (showIsoApprovalMailFlow && applicationUuid) {
                        dispatch(
                            getApplicationActivityLogs(
                                paramApplicationId ?? applicationUuid,
                            ),
                        );
                    }
                }}
            />

            {/* Request Missing Documents Modal */}
            <RequestMissingDocumentsModal
                open={isRequestDocumentsModalOpen}
                onOpenChange={setIsRequestDocumentsModalOpen}
            />

            {/* Reject Application Modal */}
            <RejectApplicationModal
                open={isRejectModalOpen}
                onOpenChange={setIsRejectModalOpen}
            />
                </>
            )}
        </div>
    );
};

export default ChecksAndDecision;

