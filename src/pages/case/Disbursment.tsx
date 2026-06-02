"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import {
  getApplicationByApplicationId,
  saveSchedulePaymentTracking,
  updateApplication,
  sendFundedEmail,
} from "@/redux/actions/applicationActions";
import { clearBankDetails } from "@/redux/slices/bankDetailSlice";
import { toast } from "react-toastify";
import ApplicationSummary from "@/components/application/ApplicationSummary";
import DealReviewDialog, {
  type DealReviewConfirmContext,
} from "./DealReviewDialog";

const normalizeWorkflowQueueKey = (queue: string | null | undefined) =>
  String(queue ?? "")
    .trim()
    .replace(/[\s_-]+/g, "")
    .toLowerCase();

const QUEUES_THAT_CAN_MOVE_TO_DISBURSEMENT = new Set([
  "agent",
  "underwriter",
  "finalunderwriter",
  "contracted",
  "final",
  "fundingcall",
]);

const shouldSetApplicationQueueToDisbursement = (
  currentQueue: string | null | undefined
) => QUEUES_THAT_CAN_MOVE_TO_DISBURSEMENT.has(normalizeWorkflowQueueKey(currentQueue));

type DisbursementProps = {
  /** Application id used for bank-details API (often resolved from loaded detail). */
  applicationId?: string;
  /** Id passed to ApplicationSummary — use route param so it matches Redux application detail. */
  summaryApplicationId?: string | null;
  /** MongoDB document id for PUT `/applications/:id`. */
  applicationRecordId?: string | null;
  /** Current workflow queue; used to decide if we may set queue to Disbursement. */
  currentQueue?: string | null;
  onBack?: () => void;
};

function maskAccountNumber(accountNumber: string) {
  const last4 = accountNumber?.slice(-4) ?? "";
  if (!last4) return "-";
  return `•••• ${last4}`;
}

export const Disbursement = ({
  applicationId,
  summaryApplicationId,
  applicationRecordId,
  currentQueue,
  onBack,
}: DisbursementProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { data: bankDetails, loading, error } = useSelector(
    (state: RootState) => state.bankDetails
  );

  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [fetchingBankDetails, setFetchingBankDetails] =
    useState<boolean>(false);
  const [showDealReviewDialog, setShowDealReviewDialog] = useState(false);
  const [queueUpdatePending, setQueueUpdatePending] = useState(false);
  const [markFundedPending, setMarkFundedPending] = useState(false);

  const { data: applicationDetailData } = useSelector(
    (state: RootState) => state.applicationDetail
  );

  const effectiveQueue =
    currentQueue ??
    ((applicationDetailData as { currentQueue?: string; queue?: string } | null)
      ?.currentQueue ||
      (applicationDetailData as { queue?: string } | null)?.queue ||
      null);

  const effectiveRecordId =
    applicationRecordId ??
    (applicationDetailData as { _id?: string } | null)?._id ??
    null;

  const effectiveQueueKey = useMemo(
    () => normalizeWorkflowQueueKey(effectiveQueue),
    [effectiveQueue]
  );
  const isApplicationFunded = effectiveQueueKey === "funded";
  const isAtDisbursementQueue =
    effectiveQueueKey === "disbursement" || effectiveQueueKey === "disbursment";

  useEffect(() => {
    if (isApplicationFunded) {
      navigate("/payments", { replace: true });
    }
  }, [isApplicationFunded, navigate]);

  const [form, setForm] = useState({
    bankName: "",
    accountNumber: "",
    routingNumber: "",
  });

  // Fetch all saved account details for this application on page load.
  useEffect(() => {
    if (!applicationId) return;

    let isActive = true;
    setFetchingBankDetails(true);
    dispatch(clearBankDetails());
    dispatch(getBankDetails({ application: applicationId })).finally(() => {
      if (isActive) setFetchingBankDetails(false);
    });

    return () => {
      isActive = false;
    };
  }, [applicationId, dispatch]);

  // Pick the first account by default once fetched.
  useEffect(() => {
    if (!bankDetails?.length) {
      setSelectedBankId("");
      return;
    }

    setSelectedBankId((prev) => prev || bankDetails[0]._id);
  }, [bankDetails]);

  const selectedBank = useMemo(() => {
    if (!selectedBankId) return null;
    return bankDetails?.find((b) => b._id === selectedBankId) ?? null;
  }, [bankDetails, selectedBankId]);

  // Pre-fill the disbursement fields from the selected saved account.
  useEffect(() => {
    if (!selectedBank) return;

    setForm({
      bankName: selectedBank.bankName || "",
      accountNumber: selectedBank.accountNumber || "",
      routingNumber: selectedBank.routingNumber || "",
    });
  }, [selectedBank]);

  const hasBankAccounts = bankDetails?.length > 0;
  const showLoading = loading || fetchingBankDetails;

  const handleOpenConfirmDisbursement = () => {
    setShowDealReviewDialog(true);
  };

  const handleConfirmDisbursement = async (
    schedule?: DealReviewConfirmContext,
  ) => {
    if (isAtDisbursementQueue) {
      setShowDealReviewDialog(false);
      toast.info("Disbursement is already confirmed. Use Mark as funded to continue.");
      return;
    }

    if (!effectiveRecordId) {
      toast.error("Application record is not loaded.");
      return;
    }

    if (!schedule?.paymentSchedule?.length) {
      toast.error("Payment schedule is missing. Set a start date and term in the offer.");
      return;
    }

    if (!shouldSetApplicationQueueToDisbursement(effectiveQueue)) {
      toast.error("This application cannot be moved to disbursement from its current stage.");
      return;
    }

    const dealId =
      (applicationDetailData as { dealId?: string | null } | null)?.dealId ??
      null;

    try {
      setQueueUpdatePending(true);
      await dispatch(
        saveSchedulePaymentTracking({
          id: effectiveRecordId,
          data: {
            paymentStartDate: schedule.paymentStartDate,
            effectiveStartDate: schedule.effectiveStartDate,
            dealId,
            paymentSchedule: schedule.paymentSchedule,
          },
        }),
      ).unwrap();
      await dispatch(
        updateApplication({
          id: effectiveRecordId,
          data: {
            currentQueue: "Disbursement",
            currentState: "Disbursement",
          },
        })
      ).unwrap();
      const refetchAppId = summaryApplicationId ?? applicationId;
      if (refetchAppId) {
        void dispatch(getApplicationByApplicationId(String(refetchAppId)));
      }
      setShowDealReviewDialog(false);
      toast.success("Disbursement confirmed. You can now mark the application as funded.");
    } catch (err: unknown) {
      const message =
        typeof err === "string"
          ? err
          : (err as { message?: string })?.message;
      toast.error(
        message || "Could not confirm disbursement. Please try again.",
      );
    } finally {
      setQueueUpdatePending(false);
    }
  };

  const handleMarkAsFunded = async () => {
    if (!effectiveRecordId) {
      toast.error("Application record is not loaded.");
      return;
    }
    if (!isAtDisbursementQueue) {
      toast.error("Please confirm disbursement before marking as funded.");
      return;
    }
    if (isApplicationFunded) {
      navigate("/payments", { replace: true });
      return;
    }

    try {
      setMarkFundedPending(true);
      await dispatch(
        updateApplication({
          id: effectiveRecordId,
          data: { currentQueue: "Funded", currentState: "Funded" },
        })
      ).unwrap();

      const appIdForEmail = summaryApplicationId ?? applicationId;
      if (appIdForEmail) {
        try {
          await dispatch(sendFundedEmail(appIdForEmail)).unwrap();
        } catch (e) {
          toast.error(
            typeof e === "string"
              ? e
              : "Could not queue funded notification email."
          );
        }
      }

      const refetchAppId = summaryApplicationId ?? applicationId;
      if (refetchAppId) {
        void dispatch(getApplicationByApplicationId(String(refetchAppId)));
      }
      toast.success("Application marked as funded.");
      navigate("/payments", { replace: true });
    } catch {
      toast.error("Could not mark application as funded. Please try again.");
    } finally {
      setMarkFundedPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-4 md:px-6 md:py-6 text-slate-700 dark:bg-transparent dark:text-slate-200">
      <div className="w-full mx-auto flex flex-col gap-5">
        <ApplicationSummary
          applicationId={summaryApplicationId ?? applicationId ?? null}
          onBack={onBack}
        />
        <p className="text-xs md:text-sm text-slate-600 -mt-2 px-1 dark:text-slate-400">
          Funds will be disbursed to the bank account below after final approval.
        </p>

        {/* Main white card */}
        <div className="bg-white px-4 py-5 md:px-6 md:py-6 rounded-lg shadow-md border border-slate-100 dark:border-slate-700 dark:bg-[#141517] dark:shadow-lg dark:shadow-black/20">
          {/* Section Sub-header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-6 pb-3 border-b border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide dark:text-slate-100">
                Bank Information
              </h3>
              <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter dark:bg-blue-950 dark:text-blue-300">
                Verified Source
              </span>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Please confirm the destination account for disbursement.
            </p>
          </div>

          {showLoading ? (
            <div className="flex items-center justify-center py-14">
              <div className="text-slate-600 text-sm md:text-base font-semibold dark:text-slate-300">
                Loading bank details...
              </div>
            </div>
          ) : (
            <>
              {/* If no bank accounts exist yet */}
              {!hasBankAccounts ? (
                <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {error ? "Failed to load bank details." : "No bank details added yet."}
                </div>
              ) : (
                <>
                  {/* Destination account selector (covers multiple saved accounts) */}
                  <div className="space-y-1.5 mb-6">
                    <label className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300">
                      Destination Account
                    </label>
                    <select
                      value={selectedBankId}
                      onChange={(e) => setSelectedBankId(e.target.value)}
                      className="w-full border border-slate-200 rounded-md py-2.5 px-3 text-sm font-medium bg-white outline-none focus:border-[#1e60a3] focus:ring-2 focus:ring-[#1e60a3]/20 transition-all dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-500/30"
                    >
                      {bankDetails.map((b) => (
                        <option key={b._id} value={b._id}>
                          {b.bankName ? b.bankName : "Bank"} ({maskAccountNumber(b.accountNumber)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Form Grid (read-only, pre-filled from fetched values) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                    {/* Bank Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300">
                        Bank Name
                      </label>
                      <input
                        type="text"
                        name="bankName"
                        value={form.bankName}
                        disabled
                        placeholder="e.g. Chase Bank"
                        className="w-full border border-slate-200 rounded-md py-2.5 px-3 text-sm font-medium bg-white outline-none focus:border-[#1e60a3] focus:ring-2 focus:ring-[#1e60a3]/20 transition-all placeholder:text-slate-300 disabled:opacity-100 dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-200 dark:placeholder:text-slate-500"
                      />
                    </div>

                    {/* Account Number */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300">
                        Account Number
                      </label>
                      <input
                        type="password"
                        name="accountNumber"
                        value={form.accountNumber}
                        disabled
                        placeholder="••••••••••••"
                        className="w-full border border-slate-200 rounded-md py-2.5 px-3 text-sm font-medium bg-white outline-none focus:border-[#1e60a3] focus:ring-2 focus:ring-[#1e60a3]/20 transition-all tracking-widest placeholder:tracking-normal placeholder:text-slate-300 disabled:opacity-100 dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-200 dark:placeholder:text-slate-500"
                      />
                      <div className="text-[11px] text-slate-400 mt-1 dark:text-slate-500">
                        {form.accountNumber
                          ? maskAccountNumber(form.accountNumber)
                          : ""}
                      </div>
                    </div>

                    {/* Routing Number */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300">
                        Routing Number
                      </label>
                      <input
                        type="text"
                        name="routingNumber"
                        value={form.routingNumber}
                        disabled
                        placeholder="000000000"
                        className="w-full border border-slate-200 rounded-md py-2.5 px-3 text-sm font-medium bg-white outline-none focus:border-[#1e60a3] focus:ring-2 focus:ring-[#1e60a3]/20 transition-all placeholder:text-slate-300 disabled:opacity-100 dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-200 dark:placeholder:text-slate-500"
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Security Note */}
          <div className="mt-6 flex items-center gap-2 text-slate-400 dark:text-slate-500">
            <div className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
            <p className="text-[11px] font-medium">
              Funds will typically be disbursed within 24–48 business hours after final approval.
            </p>
          </div>

          {/* Actions */}
          <div className="mt-8 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              className="px-4 py-2.5 text-xs font-semibold text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2.5 text-xs cursor-pointer md:text-sm font-semibold text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-md hover:bg-emerald-100 transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/50 dark:disabled:hover:bg-emerald-950/40"
              disabled={
                !effectiveRecordId ||
                !isAtDisbursementQueue ||
                markFundedPending ||
                queueUpdatePending ||
                isApplicationFunded
              }
              title={
                !isAtDisbursementQueue
                  ? "Confirm disbursement first"
                  : undefined
              }
              onClick={() => void handleMarkAsFunded()}
            >
              {markFundedPending ? "Marking…" : "Mark as funded"}
            </button>
            <button
              type="button"
              className="px-6 md:px-8 py-2.5 bg-[#1e60a3] text-white cursor-pointer rounded-md text-xs md:text-sm font-semibold shadow-sm hover:bg-[#184c80] transition-colors disabled:cursor-not-allowed disabled:opacity-60 dark:shadow-black/30"
              disabled={
                !hasBankAccounts ||
                showLoading ||
                queueUpdatePending ||
                markFundedPending ||
                isApplicationFunded ||
                isAtDisbursementQueue
              }
              title={
                isAtDisbursementQueue
                  ? "Disbursement already confirmed"
                  : undefined
              }
              onClick={handleOpenConfirmDisbursement}
            >
              {queueUpdatePending ? "Updating…" : "Confirm Disbursement"}
            </button>
          </div>
        </div>
      </div>

      <DealReviewDialog
        open={showDealReviewDialog}
        onOpenChange={setShowDealReviewDialog}
        applicationId={summaryApplicationId ?? applicationId ?? null}
        applicationRecordId={effectiveRecordId}
        confirming={queueUpdatePending}
        onConfirm={handleConfirmDisbursement}
        preload
      />
    </div>
  );
};
