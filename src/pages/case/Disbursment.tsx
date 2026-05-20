"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import {
  getApplicationByApplicationId,
  updateApplication,
  sendFundedEmail,
} from "@/redux/actions/applicationActions";
import { getByApplicationIdContract } from "@/redux/actions/contractActions";
import { clearBankDetails } from "@/redux/slices/bankDetailSlice";
import { toast } from "react-toastify";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronRight, CreditCard } from "lucide-react";
import ApplicationSummary from "@/components/application/ApplicationSummary";

const normalizeWorkflowQueueKey = (queue: string | null | undefined) =>
  String(queue ?? "")
    .trim()
    .replace(/[\s_-]+/g, "")
    .toLowerCase();

const QUEUES_THAT_CAN_MOVE_TO_DISBURSEMENT = new Set([
  "final",
  "fundingcall",
  "contractsigned",
  "signedcontracts",
]);

const isContractFullySigned = (
  contractStatus: unknown,
  documentStatus?: unknown,
) => {
  const cs = String(contractStatus ?? "").trim().toUpperCase();
  const ds = String(documentStatus ?? "").trim().toLowerCase();
  if (cs === "COMPLETED" || cs === "SIGNED") return true;
  if (ds === "completed") return true;
  return false;
};

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
  const [showPaymentProcessDialog, setShowPaymentProcessDialog] =
    useState(false);
  const [queueUpdatePending, setQueueUpdatePending] = useState(false);
  const [markFundedPending, setMarkFundedPending] = useState(false);
  const [contractStatus, setContractStatus] = useState<string | null>(null);
  const [documentStatus, setDocumentStatus] = useState<string | null>(null);
  const [contractStatusLoading, setContractStatusLoading] = useState(false);

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
  const contractFullySigned = isContractFullySigned(contractStatus, documentStatus);
  const isContractSignedQueue =
    effectiveQueueKey === "contractsigned" || effectiveQueueKey === "signedcontracts";
  const canProceedWithFunding =
    contractFullySigned &&
    (effectiveQueueKey === "disbursement" ||
      effectiveQueueKey === "funded" ||
      shouldSetApplicationQueueToDisbursement(effectiveQueue));

  useEffect(() => {
    const lookupId =
      applicationRecordId ?? applicationId ?? summaryApplicationId;
    if (!lookupId) {
      setContractStatus(null);
      setDocumentStatus(null);
      return;
    }
    let cancelled = false;
    setContractStatusLoading(true);
    void dispatch(getByApplicationIdContract(String(lookupId)))
      .unwrap()
      .then((res) => {
        if (cancelled) return;
        const contract = (res as { data?: Record<string, unknown> })?.data ?? res;
        const c = contract as {
          status?: unknown;
          application?: { document?: { status?: unknown } };
        };
        setContractStatus(String(c?.status ?? ""));
        setDocumentStatus(
          String(c?.application?.document?.status ?? ""),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setContractStatus(null);
          setDocumentStatus(null);
        }
      })
      .finally(() => {
        if (!cancelled) setContractStatusLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, summaryApplicationId, applicationRecordId, dispatch]);

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

  const handleConfirmDisbursement = async () => {
    const qKey = normalizeWorkflowQueueKey(effectiveQueue);

    if (!contractFullySigned) {
      toast.error(
        "The contract must be fully signed in DocuSign before disbursement or funding.",
      );
      return;
    }

    if (effectiveRecordId) {
      try {
        setQueueUpdatePending(true);
        if (qKey === "disbursement") {
          await dispatch(
            updateApplication({
              id: effectiveRecordId,
              data: { currentQueue: "Funded", currentState: "Funded" },
            })
          ).unwrap();
        } else if (shouldSetApplicationQueueToDisbursement(effectiveQueue)) {
          await dispatch(
            updateApplication({
              id: effectiveRecordId,
              data: {
                currentQueue: "Disbursement",
                currentState: "Disbursement",
              },
            })
          ).unwrap();
        }
        const refetchAppId = summaryApplicationId ?? applicationId;
        if (refetchAppId) {
          void dispatch(getApplicationByApplicationId(String(refetchAppId)));
        }
      } catch {
        toast.error("Could not update application queue. Please try again.");
        return;
      } finally {
        setQueueUpdatePending(false);
      }
    }

    const appIdForEmail = summaryApplicationId ?? applicationId;
    if (appIdForEmail && qKey === "disbursement") {
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

    setShowPaymentProcessDialog(true);
  };

  const handleMarkAsFunded = async () => {
    if (!effectiveRecordId) {
      toast.error("Application record is not loaded.");
      return;
    }
    if (!contractFullySigned) {
      toast.error(
        "The contract must be fully signed in DocuSign before marking this deal as funded.",
      );
      return;
    }
    try {
      setMarkFundedPending(true);
      const updated = await dispatch(
        updateApplication({
          id: effectiveRecordId,
          data: { currentQueue: "Funded", currentState: "Funded" },
        })
      ).unwrap();
      const updatedQueue = normalizeWorkflowQueueKey(
        (updated as { data?: { currentQueue?: string } })?.data?.currentQueue ??
          (updated as { currentQueue?: string })?.currentQueue,
      );
      if (updatedQueue !== "funded") {
        toast.error(
          "Funded status was not saved. Confirm disbursement first or refresh and try again.",
        );
        return;
      }
      const refetchAppId = summaryApplicationId ?? applicationId;
      if (refetchAppId) {
        await dispatch(getApplicationByApplicationId(String(refetchAppId))).unwrap();
      }
      const appIdForEmail = summaryApplicationId ?? applicationId;
      if (appIdForEmail) {
        try {
          await dispatch(sendFundedEmail(String(appIdForEmail))).unwrap();
        } catch (e) {
          toast.error(
            typeof e === "string"
              ? e
              : "Deal marked funded, but the funded notification email could not be sent.",
          );
        }
      }
      toast.success("Application marked as funded.");
      navigate("/payments");
    } catch (err: unknown) {
      const msg =
        typeof err === "string"
          ? err
          : (err as { message?: string })?.message ??
            "Could not mark application as funded. Please try again.";
      toast.error(msg);
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

          {!contractStatusLoading && !contractFullySigned ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              {isContractSignedQueue
                ? "This deal is in Contract Signed, but DocuSign has not synced a completed signature yet. Open the contract modal on the Sent step and click Refresh status, or wait for DocuSign to finish syncing."
                : "This deal cannot be funded until the contract is fully signed in DocuSign. It should appear under Contract Out until signing completes, then move to Contract Signed automatically."}
            </div>
          ) : null}

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
                markFundedPending ||
                queueUpdatePending ||
                isApplicationFunded ||
                contractStatusLoading ||
                !canProceedWithFunding
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
                contractStatusLoading ||
                !canProceedWithFunding
              }
              onClick={() => void handleConfirmDisbursement()}
            >
              {queueUpdatePending ? "Updating…" : "Confirm Disbursement"}
            </button>
          </div>
        </div>
      </div>

      <Dialog
      open={showPaymentProcessDialog}
      onOpenChange={setShowPaymentProcessDialog}
    >
      <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden border-none bg-white shadow-2xl dark:bg-[#141517]">
        {/* Subtle decorative top bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-blue-400 via-blue-600 to-indigo-600" />
        
        <div className="p-8 dark:bg-transparent">
          <DialogHeader className="flex flex-col items-center text-center space-y-4">
            {/* Animated Icon Container */}
            <div className="relative flex items-center justify-center w-16 h-16 bg-blue-50 rounded-full mb-2 dark:bg-blue-950">
              <CreditCard className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              <div className="absolute inset-0 rounded-full border-2 border-blue-600 border-t-transparent animate-spin dark:border-blue-400" />
            </div>

            <DialogTitle className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Processing Payment
            </DialogTitle>
            
            <DialogDescription className="text-slate-500 text-balance leading-relaxed dark:text-slate-400">
              We are currently finalizing your transaction for <span className="font-semibold text-slate-800 dark:text-slate-200">"Actum"</span>. 
              Please do not refresh the page.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-8 space-y-3">
            <Button
              type="button"
              className="w-full bg-[#1e60a3] hover:bg-[#1e60a3] cursor-pointer text-white font-bold py-6 rounded-xl shadow-lg shadow-blue-200/50 transition-all active:scale-[0.98] flex items-center justify-center gap-2 dark:shadow-blue-950/40"
              onClick={() => {
                setShowPaymentProcessDialog(false);
                navigate("/payments");
              }}
            >
              Continue to Payment Dashboard
              <ChevronRight size={18} />
            </Button>
            
            <p className="text-[11px] text-center text-slate-400 font-medium uppercase tracking-widest dark:text-slate-500">
              Secure Encrypted Transaction
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </div>
  );
};