import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Loader2 } from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DecisionLogicInfo from "@/components/client/decision-logic/decision-logic-info-section";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import {
  fetchDecisionLogicReport,
  initiateDecisionLogic,
} from "@/redux/actions/decision-logic-actions";
import type { AppDispatch, RootState } from "@/redux/store";
import type { BankDetail } from "@/types/bankDetailTypes";

type OwnerRow = { id: number; label: string };
type BankRow = { id: number; label: string };

function normalizeOwners(applicationData: any): OwnerRow[] {
  const client = applicationData?.client;
  const owner = client?.owner;
  const ownerId = Number(client?.clientId ?? applicationData?.applicationId ?? 0);
  if (!owner) return [];
  const fullName = `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim();
  return [{ id: ownerId, label: fullName || "Owner" }];
}

function pickBestReportRow(raw: unknown): Record<string, unknown> | null {
  const rows = Array.isArray(raw) ? raw : [];
  if (!rows.length) return null;
  const checking = rows.find(
    (r: unknown) =>
      r != null &&
      typeof r === "object" &&
      String((r as { accountType?: string }).accountType ?? "").toUpperCase() ===
        "CHECKING",
  );
  if (checking && typeof checking === "object") {
    return checking as Record<string, unknown>;
  }
  const first = rows[0];
  return first != null && typeof first === "object"
    ? (first as Record<string, unknown>)
    : null;
}

function normalizeBanks(rawBanks: BankDetail[]): BankRow[] {
  if (!Array.isArray(rawBanks)) return [];
  return rawBanks.map((bank: any, index: number) => {
    // Decision Logic backend currently expects numeric bankAccountId.
    // BankDetail PK is UUID, so we pass stable 1-based row order.
    const id = index + 1;
    const bankName = bank?.bankName ?? "Bank";
    const routing = bank?.routingNumber ?? "—";
    const account = bank?.accountNumber ?? "—";
    return { id, label: `${bankName} (${routing}/${account})` };
  });
}

export default function EligibilityAnalysis() {
  const dispatch = useDispatch<AppDispatch>();
  const applicationData = useSelector((state: RootState) => state.applicationDetail.data as any);
  const bankDetailRows = useSelector(
    (state: RootState) => (state.bankDetails.data ?? []) as BankDetail[]
  );
  const [isDecisionLogicModalOpen, setIsDecisionLogicModalOpen] = useState(false);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>("");
  const [isSubmittingDecisionLogic, setIsSubmittingDecisionLogic] = useState(false);
  const [dlReportLoading, setDlReportLoading] = useState(false);
  const [dlReportError, setDlReportError] = useState("");
  const [dlReportRow, setDlReportRow] = useState<Record<string, unknown> | null>(null);
  const [dlReportFetched, setDlReportFetched] = useState(false);
  const [reportFetchNonce, setReportFetchNonce] = useState(0);

  const owners = useMemo(() => normalizeOwners(applicationData), [applicationData]);
  const applicationRecordId = useMemo(
    () =>
      String(
        applicationData?._id ??
        applicationData?.id ??
        applicationData?.application?._id ??
        ""
      ),
    [applicationData]
  );
  const clientOwnerId = useMemo(
    () => Number(applicationData?.client?.clientId ?? 0),
    [applicationData]
  );
  const banks = useMemo(() => normalizeBanks(bankDetailRows), [bankDetailRows]);
  const bankOptions = useMemo(
    () =>
      banks.length
        ? banks
        : [{ id: 0, label: "Demo Bank Account (No bank account added yet)" }],
    [banks]
  );
  const bankAccountsOptions = useMemo(
    () =>
      bankOptions.map((bank) => ({
        value: String(bank.id),
        label: bank.label,
      })),
    [bankOptions]
  );

  useEffect(() => {
    if (!applicationRecordId) return;
    void dispatch(getBankDetails({ application: applicationRecordId }));
  }, [dispatch, applicationRecordId]);

  useEffect(() => {
    if (!Number.isFinite(clientOwnerId) || clientOwnerId <= 0) {
      setDlReportRow(null);
      setDlReportError("");
      setDlReportLoading(false);
      setDlReportFetched(false);
      return;
    }
    let cancelled = false;
    setDlReportLoading(true);
    setDlReportError("");
    void (async () => {
      const response = await fetchDecisionLogicReport(0, clientOwnerId);
      if (cancelled) return;
      if ((response as { error?: string })?.error) {
        setDlReportError(
          String(
            (response as { error?: string }).error ||
              "Failed to fetch Decision Logic report.",
          ),
        );
        setDlReportRow(null);
        setDlReportLoading(false);
        setDlReportFetched(true);
        return;
      }
      const rows = (response as { data?: unknown })?.data;
      setDlReportRow(pickBestReportRow(rows));
      setDlReportLoading(false);
      setDlReportFetched(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientOwnerId, reportFetchNonce]);

  const onInitiateDecisionLogic = () => {
    if (!owners.length) {
      toast.error("Owner profile is missing for this application.");
      return;
    }
    setSelectedBankAccountId(String(bankOptions[0]?.id ?? ""));
    setIsDecisionLogicModalOpen(true);
  };

  const processDecisionLogicRequest = async (bankAccountId: string) => {
    const parsedBankId = parseInt(bankAccountId, 10);
    if (!Number.isFinite(parsedBankId)) {
      toast.error("Please select a valid bank account.");
      return;
    }
    setIsDecisionLogicModalOpen(false);
    if (parsedBankId === 0) {
      toast.info("Using demo bank account for now.");
      return;
    }

    try {
      setIsSubmittingDecisionLogic(true);
      const ownerId = clientOwnerId || owners[0]?.id || 0;
      if (!ownerId) {
        toast.error("Client id is missing for this application.");
        return;
      }
      const response: any = await initiateDecisionLogic(ownerId, ownerId, parsedBankId);
      if (response?.error) {
        toast.error(response.error);
        return;
      }

      toast.success(response?.message || "Decision Logic initiated successfully.");
      setReportFetchNonce((n) => n + 1);
    } finally {
      setIsSubmittingDecisionLogic(false);
    }
  };

  return (
    <section >
      <div className="space-y-5">
        <div className="rounded-md border border-[#E5E7EB] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#111827]">Decision Logic</h3>
            <Button
              size="sm"
              variant="default"
              onClick={onInitiateDecisionLogic}
            >
              Initiate Decision Logic
            </Button>
          </div>
          {owners.map((owner) => (
            <details key={`decision-${owner.id}`} className="rounded-md border border-[#E5E7EB]">
              <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase text-[#111827]">
                {owner.label}
              </summary>
            </details>
          ))}

          {Number.isFinite(clientOwnerId) && clientOwnerId > 0 ? (
            <div className="border-t border-[#E5E7EB] pt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <span className="text-xs font-medium text-[#374151]">
                  Decision Logic report (client #{clientOwnerId})
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={dlReportLoading}
                  onClick={() => setReportFetchNonce((n) => n + 1)}
                >
                  {dlReportLoading ? (
                    <>
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />
                      Loading…
                    </>
                  ) : (
                    "Refresh report"
                  )}
                </Button>
              </div>

              {dlReportLoading && !dlReportRow ? (
                <div className="flex items-center gap-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-4 text-xs text-[#6B7280]">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--brand)]" aria-hidden />
                  Loading Decision Logic report…
                </div>
              ) : null}

              {dlReportError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {dlReportError}
                </div>
              ) : null}

              {!dlReportLoading && !dlReportError && dlReportRow ? (
                <>
                  <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
                    <p className="text-xs font-semibold text-green-800">
                      Bank verification completed
                    </p>
                    <p className="mt-0.5 text-xs text-green-800">
                      Decision Logic finished processing. Report data is shown below.
                    </p>
                  </div>
                  <DecisionLogicInfo data={dlReportRow} />
                </>
              ) : null}

              {dlReportFetched && !dlReportLoading && !dlReportError && !dlReportRow ? (
                <p className="px-1 text-xs text-[#6B7280]">
                  No saved Decision Logic report for this client yet. Initiate verification and
                  complete the email link; then use &quot;Refresh report&quot;.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="border-t border-[#E5E7EB] pt-3 px-1 text-xs text-[#6B7280]">
              Link this application to a client to load a Decision Logic report.
            </p>
          )}
        </div>
      </div>
      <Dialog open={isDecisionLogicModalOpen} onOpenChange={setIsDecisionLogicModalOpen}>
        <DialogContent className="max-w-[440px] px-0 py-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-[#E5E7EB]">
            <DialogTitle className="text-sm font-semibold text-[#111827]">
              Decision Logic Request
            </DialogTitle>
          </DialogHeader>
          <div className="px-4 py-3 space-y-2">
            <label className="text-xs text-[#374151]">Selected Bank Account</label>
            <Select value={selectedBankAccountId} onValueChange={setSelectedBankAccountId}>
              <SelectTrigger className="w-full h-8 text-xs">
                <SelectValue placeholder="Select Bank Account" />
              </SelectTrigger>
              <SelectContent>
                {bankAccountsOptions.map((bank) => (
                  <SelectItem key={bank.value} value={bank.value} className="text-xs">
                    {bank.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="px-4 py-3 border-t border-[#E5E7EB] flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsDecisionLogicModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => processDecisionLogicRequest(selectedBankAccountId)}
              disabled={isSubmittingDecisionLogic || !selectedBankAccountId}
            >
              {isSubmittingDecisionLogic ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
