import { useState, useEffect } from "react";
import { useParams } from "react-router";
import ApprovedApplicationModal from "./ApprovedApplicationModal";
import { isFinalUnderwriterWorkflowQueue, isApplicationInFinalApprovalStage, resolveApplicationWorkflowQueueAndStates } from "@/lib/applicationWorkflowState";
import RequestMissingDocumentsModal from "./RequestMissingDocumentsModal";
import RejectApplicationModal from "./RejectApplicationModal";
import { useTheme } from "@/context/ThemeContext";
import { useSelector, useDispatch } from "react-redux";
import { toast } from "react-toastify";
import type { RootState, AppDispatch } from "@/redux/store";
import { getApplicationActivityLogs } from "@/redux/actions/applicationActivityLogActions";
import { updateApplicationQueue, getApplicationById } from "@/redux/actions/applicationActions";
import { isUnderwriterApprovedApplication, resolveApprovingUnderwriter } from "@/lib/underwriterApprovalLabel";
import { normalizeRoleKey, resolveEffectiveRole } from "@/lib/sessionRole";
import ApprovedByUnderwriterBadge from "./ApprovedByUnderwriterBadge";

interface ChecksAndDecisionProps {
    /** Plain SCRUBBING (scrubbing) — primary CTA is "Recommend for approval", not send-to-FU wording. */
    isPlainUnderwriter?: boolean;
    /** When true, Approved modal shows "Proceed to Generate Contract" (UNDERWRITER only) */
    isFinalUnderwriter?: boolean;
    /** Super Admin on Decision Making — same ISO approval-mail CTA as Underwriter. */
    canSendApprovalMailToIso?: boolean;
    /** Called when UNDERWRITER clicks Proceed to Generate Contract */
    onProceedToContract?: () => void;
    /** When true, hides the "Make Underwriting Decision" action buttons (e.g. deal pipeline read-only view). */
    hideUnderwritingDecision?: boolean;
    /** When true, hides decision actions while browsing a past workflow stage. */
    previewMode?: boolean;
    /** Narrow sidebar layout: stack decision buttons vertically for ~30% column width. */
    compactLayout?: boolean;
}

/** Legacy decision CTAs — solid colors, not the app-wide brand-gradient Button theme. */
const decisionButtonBase =
    "rounded-md text-white h-auto py-4 px-3 box-border cursor-pointer flex flex-col gap-1.5 items-center justify-center text-center w-full overflow-hidden transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#276D9C] disabled:opacity-50 disabled:cursor-not-allowed";

const UNDERWRITER_RECOMMEND_LABEL = "Recommend for approval";
const UNDERWRITER_RECOMMEND_DESCRIPTION =
    "Send this application to the Underwriter queue for review";
const CONTRACT_PENDING_STAGE = "Contract Pending";
const FINAL_APPROVAL_LABEL = "Final Approval";
const FINAL_APPROVAL_DESCRIPTION =
    "Grant final approval and automate the deal for contract";

const ChecksAndDecision = ({
    isPlainUnderwriter,
    isFinalUnderwriter,
    canSendApprovalMailToIso,
    onProceedToContract,
    hideUnderwritingDecision,
    previewMode,
    compactLayout,
}: ChecksAndDecisionProps = {}) => {
    const loginUserRole = useSelector(
        (state: RootState) => state.login.data?.user?.role,
    );
    const viewerRoleKey = normalizeRoleKey(
        resolveEffectiveRole({ role: loginUserRole }),
    );
    const isUnderwriterRole = viewerRoleKey === "UNDERWRITER";
    // UNDERWRITER role: approve directly (update DB to Approved) — no ISO approval mail.
    const showUnderwriterApproveFlow = Boolean(
        (isFinalUnderwriter || isUnderwriterRole) && !canSendApprovalMailToIso,
    );
    // Super Admin keeps the ISO approval-mail CTA.
    const showIsoApprovalMailFlow = Boolean(canSendApprovalMailToIso);
    const showUnderwriterRecommendFlow = Boolean(
        isPlainUnderwriter && !showIsoApprovalMailFlow && !showUnderwriterApproveFlow,
    );
    const showUnderwritingDecision = !hideUnderwritingDecision && !previewMode;
    const { applicationId: paramApplicationId } = useParams<{ applicationId: string }>();
    const dispatch = useDispatch<AppDispatch>();
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    const applicationData = useSelector((state: RootState) => state.applicationDetail.data);
    const currentUserId = useSelector(
        (state: RootState) => state.login.data?.user?._id ?? "",
    );
    const applicationUuid =
        (applicationData as { _id?: string; id?: string })?._id ??
        (applicationData as { id?: string })?.id ??
        null;
    const approvedByUnderwriterId =
        resolveApprovingUnderwriter(
            (applicationData ?? {}) as Parameters<typeof resolveApprovingUnderwriter>[0],
        )?.id ??
        (applicationData as { approvedByUnderwriterId?: string | null })?.approvedByUnderwriterId ??
        (applicationData as { approvedByUnderwriter?: { id?: string; _id?: string } | null })
            ?.approvedByUnderwriter?.id ??
        (applicationData as { approvedByUnderwriter?: { id?: string; _id?: string } | null })
            ?.approvedByUnderwriter?._id ??
        null;
    const assignedUnderwriterId =
        (applicationData as { assignedUnderwriterId?: string | null })?.assignedUnderwriterId ??
        (applicationData as { assignedUnderwriter?: { id?: string; _id?: string } | null })
            ?.assignedUnderwriter?.id ??
        (applicationData as { assignedUnderwriter?: { id?: string; _id?: string } | null })
            ?.assignedUnderwriter?._id ??
        null;
    const workflowFields = resolveApplicationWorkflowQueueAndStates(
        (applicationData ?? null) as Parameters<
            typeof resolveApplicationWorkflowQueueAndStates
        >[0],
    );
    // Derive application status/queue to control decision button availability
    const status = (applicationData as any)?.currentState || (applicationData as any)?.status;
    const queue = workflowFields.queue || (applicationData as any)?.queue;
    const explicitStatus = (applicationData as any)?.status;
    const currentStateRaw =
        workflowFields.rawState ||
        workflowFields.mappedState ||
        (applicationData as any)?.currentState;
    const statusNorm = typeof status === "string" ? status.trim().toLowerCase() : "";
    const queueNorm = typeof queue === "string" ? queue.trim().toLowerCase() : "";
    const currentStateNorm =
        typeof currentStateRaw === "string" ? currentStateRaw.trim().toLowerCase() : "";
    const explicitStatusNorm =
        typeof explicitStatus === "string" ? explicitStatus.trim().toLowerCase() : "";

    const isCompletedStatus = statusNorm === "completed";
    const isApprovedStatus = explicitStatusNorm === "approved";
    const isApprovedQueue = queueNorm === "approved";
    const isUnderwriterApprovedStage = isUnderwriterApprovedApplication(
        applicationData as Record<string, unknown> | null,
    );
    const isLegacyUwApprovedStage =
        queueNorm === "approved" &&
        (statusNorm === "approved" || currentStateNorm === "approved");
    const isUnderwriterQueue = isFinalUnderwriterWorkflowQueue(queue);
    const isFinalApprovalStage = isApplicationInFinalApprovalStage(
        (applicationData ?? null) as Parameters<
            typeof isApplicationInFinalApprovalStage
        >[0],
    );
    const isContractPendingStage =
        queueNorm === "contract pending" ||
        queueNorm === "contract_pending" ||
        currentStateNorm === "contract pending" ||
        currentStateNorm === "contract_pending";

    /** Underwriter queue → first approval; Final Approval queue → final approval CTA. */
    const showUnderwriterApprovalButton =
        showUnderwriterApproveFlow && isUnderwriterQueue;
    const showFinalApprovalButton =
        showUnderwriterApproveFlow && isFinalApprovalStage;

    const isApprovingUnderwriterForDeal =
        !approvedByUnderwriterId ||
        !currentUserId ||
        String(approvedByUnderwriterId) === String(currentUserId);
    const isAssignedUnderwriterForDeal =
        !assignedUnderwriterId ||
        !currentUserId ||
        String(assignedUnderwriterId) === String(currentUserId);
    const canActOnFinalApprovalStage =
        isFinalApprovalStage &&
        (isApprovingUnderwriterForDeal || isAssignedUnderwriterForDeal);
    /** Underwriter role: show decision panel when the deal is in an actionable UW queue. */
    const showUnderwriterDecisionActions =
        showUnderwriterApprovalButton ||
        showFinalApprovalButton ||
        isUnderwriterApprovedStage;
    const showDecisionPanel =
        showUnderwritingDecision &&
        (!showUnderwriterApproveFlow || showUnderwriterDecisionActions);
    const canExecuteUnderwriterDecisions =
        !showUnderwriterApproveFlow ||
        isUnderwriterApprovedStage ||
        showUnderwriterApprovalButton ||
        (showFinalApprovalButton && canActOnFinalApprovalStage);
    const isContractedQueue =
        queueNorm === "contracted" ||
        queueNorm === "contract out" ||
        queueNorm === "contracts out" ||
        isContractPendingStage;

    // Once sent to Underwriter or approved/contracted/completed, lock the primary decision button
    const disablePrimaryDecisionButton =
        isUnderwriterQueue ||
        isUnderwriterApprovedStage ||
        isLegacyUwApprovedStage ||
        isApprovedStatus ||
        isApprovedQueue ||
        isCompletedStatus ||
        isContractedQueue;

    // Underwriter direct-approve flow: lock the button once the application is approved,
    // except when the deal is back in Final Approval for the second sign-off.
    const isApplicationApproved =
        !isFinalApprovalStage &&
        (isUnderwriterApprovedStage ||
        isLegacyUwApprovedStage ||
        isApprovedStatus ||
        isApprovedQueue ||
        statusNorm === "approved" ||
        isCompletedStatus ||
        isContractedQueue);

    // The underwriter's approval credit must survive later stage changes. When a
    // Super Admin sends the ISO approval mail the deal moves to "Approval Sent",
    // which previously dropped this badge and made it look like the recorded
    // "Approved by Underwriter" was overwritten. Keep crediting the underwriter
    // once an approver is recorded and the deal has reached or advanced past
    // Underwriter Approved — except during the Final Approval second sign-off,
    // where it is intentionally hidden.
    const hasRecordedApprovingUnderwriter = Boolean(approvedByUnderwriterId);
    const isApprovalSentStage =
        queueNorm === "approval sent" ||
        queueNorm === "approval_sent" ||
        currentStateNorm === "approval sent" ||
        currentStateNorm === "approval_sent";
    const isIsoApprovedStage =
        queueNorm === "iso approved" ||
        queueNorm === "iso_approved" ||
        currentStateNorm === "iso approved" ||
        currentStateNorm === "iso_approved" ||
        (queueNorm === "approved" && currentStateNorm === "approved");
    const isAtOrPastUnderwriterApproval =
        isUnderwriterApprovedStage ||
        isLegacyUwApprovedStage ||
        isApprovedStatus ||
        isApprovedQueue ||
        isCompletedStatus ||
        isContractedQueue ||
        isApprovalSentStage ||
        isIsoApprovedStage;
    const showApprovedByUnderwriterBadge =
        !isFinalApprovalStage &&
        (isUnderwriterApprovedStage ||
            (hasRecordedApprovingUnderwriter && isAtOrPastUnderwriterApproval));

    // Underwriter view: load the saved offer decision so we can detect whether
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

    const showUnderwriterApprovalModal =
        showUnderwriterApprovalButton ||
        (showUnderwriterApproveFlow && !showFinalApprovalButton && !isApplicationApproved);

    const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
    const [isRequestDocumentsModalOpen, setIsRequestDocumentsModalOpen] = useState(false);
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
    const [isApproving, setIsApproving] = useState(false);

    const handleFinalApproveApplication = async () => {
        if (!applicationUuid) {
            toast.error("Missing application id. Please reload and try again.");
            return;
        }
        setIsApproving(true);
        const toastId = toast.loading("Sending application to contract...");
        try {
            await dispatch(
                updateApplicationQueue({
                    id: applicationUuid,
                    data: { currentQueue: CONTRACT_PENDING_STAGE },
                }),
            ).unwrap();
            await dispatch(getApplicationById(paramApplicationId ?? applicationUuid));
            toast.update(toastId, {
                render: "Application moved to Contract Pending.",
                type: "success",
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err) {
            console.error("Failed to final-approve application:", err);
            toast.update(toastId, {
                render: "Failed to approve application. Please try again.",
                type: "error",
                isLoading: false,
                autoClose: 4000,
            });
        } finally {
            setIsApproving(false);
        }
    };

    useEffect(() => {
        if (showIsoApprovalMailFlow && applicationUuid && isApprovalModalOpen) {
            dispatch(getApplicationActivityLogs(paramApplicationId ?? applicationUuid));
        }
    }, [showIsoApprovalMailFlow, applicationUuid, isApprovalModalOpen, paramApplicationId, dispatch]);
    return (
        <div className={`w-full ${compactLayout ? "" : "space-y-6"}`}>
            {showApprovedByUnderwriterBadge ? (
                <ApprovedByUnderwriterBadge
                    app={
                        (applicationData ?? {}) as Parameters<
                            typeof ApprovedByUnderwriterBadge
                        >[0]["app"]
                    }
                    fallback="an underwriter"
                />
            ) : null}
            {/* Make Underwriting Decision Section */}
            {showDecisionPanel && (
            <div className={`border border-[#FDFDFD] shadow-[0px_4px_20px_0px_#00000005] flex flex-col gap-4 w-full pt-0 rounded-lg overflow-hidden ${compactLayout ? "my-0 h-[420px]" : "my-6"} ${isDark ? 'bg-card border-white' : 'bg-white'}`}>
            <h2 className={`text-base font-roboto w-full font-semibold ${isDark ? 'bg-card' : 'bg-[#F9FAFD]'} px-6 py-2 ${isDark ? 'text-gray-200' : 'text-[#374151]'}`}>Make Underwriting Decision</h2>
                
                <div className={`${
                    compactLayout
                        ? "flex flex-1 flex-col justify-center gap-5 px-4 pb-4"
                        : "grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-4 px-6 pb-6"
                }`}>
                    {/* Approved Button */}
                    <button
                        type="button"
                        onClick={() =>
                            showFinalApprovalButton
                                ? void handleFinalApproveApplication()
                                : setIsApprovalModalOpen(true)
                        }
                        disabled={
                            !canExecuteUnderwriterDecisions ||
                            (showFinalApprovalButton
                                ? isApproving || isContractPendingStage
                                : showUnderwriterApprovalButton
                                  ? isApproving || isApplicationApproved
                                  : showUnderwriterApproveFlow
                                    ? isApproving || isApplicationApproved
                                    : showIsoApprovalMailFlow
                                      ? false
                                      : disablePrimaryDecisionButton)
                        }
                        className={`${decisionButtonBase} bg-[#16A34A] hover:bg-green-700 shadow-md shadow-green-700/25`}
                    >
                        <span className="text-base font-roboto font-bold whitespace-normal break-words w-full px-1">
                            {showFinalApprovalButton
                                ? isApproving
                                    ? "Approving…"
                                    : FINAL_APPROVAL_LABEL
                                : showUnderwriterApprovalButton || showUnderwriterApproveFlow
                                  ? isApproving
                                      ? "Approving…"
                                      : isApplicationApproved
                                        ? "Underwriter Approved"
                                        : "Approve Application"
                                  : showIsoApprovalMailFlow
                                    ? isoApprovalMailButtonLabel
                                    : showUnderwriterRecommendFlow
                                      ? UNDERWRITER_RECOMMEND_LABEL
                                      : "Send application to Final-scrubbing"}
                        </span>
                        <span className="text-xs font-normal opacity-90 whitespace-normal break-words w-full leading-snug px-1">
                            {showFinalApprovalButton
                                ? FINAL_APPROVAL_DESCRIPTION
                                : showUnderwriterApprovalButton || showUnderwriterApproveFlow
                                  ? "Mark this application as Underwriter Approved"
                                  : showIsoApprovalMailFlow
                                    ? isoApprovalMailButtonDescription
                                    : showUnderwriterRecommendFlow
                                      ? UNDERWRITER_RECOMMEND_DESCRIPTION
                                      : "Confirm terms and send for final underwriting review"}
                        </span>
                    </button>

                    {/* Send back for documents Button */}
                    <button
                        type="button"
                        onClick={() => setIsRequestDocumentsModalOpen(true)}
                        disabled={!canExecuteUnderwriterDecisions}
                        className={`${decisionButtonBase} bg-[#EAA95A] hover:bg-[#EAA95A]/90`}
                    >
                        <span className="text-base font-roboto font-bold whitespace-normal break-words w-full px-1">Send back for documents</span>
                        <span className="text-xs font-normal opacity-90 whitespace-normal break-words w-full leading-snug px-1">Request additional documents</span>
                    </button>

                    {/* Decline Button */}
                    <button
                        type="button"
                        onClick={() => setIsRejectModalOpen(true)}
                        disabled={!canExecuteUnderwriterDecisions}
                        className={`${decisionButtonBase} bg-[#DC331D] hover:bg-[#DC331D]/90`}
                    >
                        <span className="text-base font-roboto font-bold whitespace-normal break-words w-full px-1">Decline</span>
                        <span className="text-xs font-normal opacity-90 whitespace-normal break-words w-full leading-snug px-1">Decline this application</span>
                    </button>
                </div>
            </div>
            )}

            {showDecisionPanel && (
                <>
            {/* Approved Application Modal */}
            <ApprovedApplicationModal
                open={isApprovalModalOpen}
                onOpenChange={setIsApprovalModalOpen}
                isPlainUnderwriter={showUnderwriterRecommendFlow}
                isFinalUnderwriter={showIsoApprovalMailFlow}
                isUnderwriterDirectApprove={showUnderwriterApprovalModal}
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

