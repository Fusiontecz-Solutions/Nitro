import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { Button } from "@/components/ui/button";
import ApprovedApplicationModal from "./ApprovedApplicationModal";
import RequestMissingDocumentsModal from "./RequestMissingDocumentsModal";
import RejectApplicationModal from "./RejectApplicationModal";
import { useTheme } from "@/context/ThemeContext";
import { useSelector, useDispatch } from "react-redux";
import type { RootState, AppDispatch } from "@/redux/store";
import { getApplicationActivityLogs } from "@/redux/actions/applicationActivityLogActions";

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
    /** Narrow sidebar layout: stack decision buttons vertically for ~30% column width. */
    compactLayout?: boolean;
}

const ChecksAndDecision = ({
    isFinalUnderwriter,
    canSendApprovalMailToIso,
    onProceedToContract,
    hideUnderwritingDecision,
    previewMode,
    compactLayout,
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

    const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
    const [isRequestDocumentsModalOpen, setIsRequestDocumentsModalOpen] = useState(false);
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);

    useEffect(() => {
        if (showIsoApprovalMailFlow && applicationUuid && isApprovalModalOpen) {
            dispatch(getApplicationActivityLogs(paramApplicationId ?? applicationUuid));
        }
    }, [showIsoApprovalMailFlow, applicationUuid, isApprovalModalOpen, paramApplicationId, dispatch]);
    return (
        <div className={`w-full ${compactLayout ? "" : "space-y-6"}`}>
            {/* Make Underwriting Decision Section */}
            {showUnderwritingDecision && (
            <div className={`border border-[#FDFDFD] shadow-[0px_4px_20px_0px_#00000005] flex flex-col gap-4 w-full pt-0 rounded-lg overflow-hidden ${compactLayout ? "my-0 h-[420px]" : "my-6"} ${isDark ? 'bg-card border-white' : 'bg-white'}`}>
            <h2 className={`text-base font-roboto w-full font-semibold ${isDark ? 'bg-card' : 'bg-[#F9FAFD]'} px-6 py-2 ${isDark ? 'text-gray-200' : 'text-[#374151]'}`}>Make Underwriting Decision</h2>
                
                <div className={`${
                    compactLayout
                        ? "flex flex-1 flex-col justify-center gap-5 px-4 pb-4"
                        : "grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-4 px-6 pb-6"
                }`}>
                    {/* Approved Button */}
                    <Button
                        onClick={() => setIsApprovalModalOpen(true)}
                        disabled={showIsoApprovalMailFlow ? false : disablePrimaryDecisionButton}
                        variant={showIsoApprovalMailFlow ? "default" : undefined}
                        className={`rounded-md text-white h-auto py-4 px-3 box-border cursor-pointer flex flex-col gap-1.5 items-center justify-center text-center w-full overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed ${
                            showIsoApprovalMailFlow
                                ? ""
                                : "bg-[#16A34A] hover:bg-green-700 shadow-md shadow-green-700/25"
                        }`}
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
                        className="rounded-md bg-[#EAA95A] hover:bg-[#EAA95A]/90 text-white h-auto py-4 px-3 box-border cursor-pointer flex flex-col gap-1.5 items-center justify-center text-center w-full overflow-hidden"
                    >
                        <span className="text-base font-roboto font-bold whitespace-normal break-words w-full px-1">Send back for documents</span>
                        <span className="text-xs font-normal opacity-90 whitespace-normal break-words w-full leading-snug px-1">Request additional documents</span>
                    </Button>

                    {/* Decline Button */}
                    <Button
                        onClick={() => setIsRejectModalOpen(true)}
                        variant="destructive"
                        className="rounded-md h-auto py-4 px-3 box-border cursor-pointer flex flex-col gap-1.5 items-center justify-center text-center w-full overflow-hidden"
                    >
                        <span className="text-base font-roboto font-bold whitespace-normal break-words w-full px-1">Decline</span>
                        <span className="text-xs font-normal opacity-90 whitespace-normal break-words w-full leading-snug px-1">Decline this application</span>
                    </Button>
                </div>
            </div>
            )}

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

