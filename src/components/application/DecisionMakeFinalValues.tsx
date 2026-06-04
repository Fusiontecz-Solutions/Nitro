import { useMemo, useState, type ReactNode } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/redux/store";

import BankAnalysisTable from "./BankAnalysisTable";
import OfferDecisionToggle from "./OfferDecisionToggle";
import PositionTableCalculator from "./PositionTableCalculator";

type DecisionMakeFinalValuesProps = {
  applicationId?: string | null;
  allowOfferEdit?: boolean;
  /** When true, the Positions table is editable (lock/unlock + field edits). */
  allowPositionsEdit?: boolean;
  /** When true (and positions are editable), hide the per-row delete action. */
  positionsDisableDelete?: boolean;
  /** When true (and positions are editable), hide Create Position. */
  positionsDisableCreate?: boolean;
  onSummaryMetricsChange?: (payload: {
    activePositions: number;
    existingLeveragePct: number;
    totalLeveragePct: number;
    loading: boolean;
  }) => void;
  /** e.g. bank totals table — shown after offer, before positions (Decision Making layout). */
  betweenOfferAndPositions?: ReactNode;
};

function toISODateOrEmpty(input: unknown): string {
  if (typeof input === "string") {
    if (input.length >= 10) return input.slice(0, 10);
    return input;
  }
  if (!input) return "";
  const d = new Date(input as any);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// PositionTableCalculator and OfferDecisionToggle both expect a "calculator row" shape.
function mapPositionsForCalculator(positions: any[]): any[] {
  return positions.map((p: any) => {
    const fundingDateIso = toISODateOrEmpty(p.fundingDate);
    const closeDateIso = toISODateOrEmpty(p.closeDate);

    return {
      _id: p._id,
      lender: p.funder ?? "",
      frequency: p.frequency ?? "",
      installment: p.ach != null ? String(p.ach) : "",
      status: p.status ?? (p.activeStatus ? "ACTIVE" : "SELECT"),
      startingDate: fundingDateIso,
      amountFunded: p.fundedAmount != null ? String(p.fundedAmount) : "",
      loanAmount: p.loanAmount != null ? String(p.loanAmount) : "",
      totalRepayments: p.paybackAmount != null ? String(p.paybackAmount) : "",
      paymentTerm: p.paymentTerm != null ? String(p.paymentTerm) : "",
      mcaEstBalance: p.mcaEstBalance != null ? String(p.mcaEstBalance) : "",
      mcaPercentPaid: p.mcaPercentPaid != null ? String(p.mcaPercentPaid) : "",
      pmtsLeft: p.pmtsLeft != null ? String(p.pmtsLeft) : "",
      estEndDate: closeDateIso,
      mcaRemit:
        p.mcaRemit != null || p.percentOfGross != null
          ? String(p.mcaRemit ?? p.percentOfGross ?? "")
          : "",
      monthlyMcaPmts:
        p.monthlyMcaPmts != null ? String(p.monthlyMcaPmts) : "",
      carryForward: p.carryForward != null ? String(p.carryForward) : "",
      allocatedBankAnalysisId:
        Number.isInteger((p as any).allocatedBankAnalysisId) &&
        Number((p as any).allocatedBankAnalysisId) > 0
          ? Number((p as any).allocatedBankAnalysisId)
          : undefined,
      isLocked: true,
    };
  });
}

export default function DecisionMakeFinalValues({
  applicationId,
  allowOfferEdit = false,
  allowPositionsEdit = false,
  positionsDisableDelete = false,
  positionsDisableCreate = false,
  onSummaryMetricsChange,
  betweenOfferAndPositions,
}: DecisionMakeFinalValuesProps) {
  const { data: applicationData } = useSelector(
    (state: RootState) => state.applicationDetail,
  );
  const positionsState = useSelector((state: RootState) => state.positions);



  const fromRedux =
    (applicationData as any)?.applicationId ??
    (applicationData as any)?._id ??
    (applicationData as any)?.id ??
    null;
  const propId =
    applicationId != null && String(applicationId).trim() !== ""
      ? String(applicationId).trim()
      : null;
  /** Prefer explicit prop (e.g. preview sheet) so we never show another deal's offer when Redux detail is stale. */
  const effectiveApplicationId = propId ?? fromRedux;

  const [bankNetCreditAvg, setBankNetCreditAvg] = useState<number | null>(
    null,
  );

  const scopedPositions = useMemo(() => {
    if (!effectiveApplicationId) return [];
    const currentScopeId = positionsState.currentApplicationId
      ? String(positionsState.currentApplicationId)
      : "";
    const allowedIds = [
      effectiveApplicationId,
      (applicationData as any)?._id,
      (applicationData as any)?.applicationId,
      (applicationData as any)?.id,
      applicationId,
    ]
      .filter(Boolean)
      .map((id) => String(id));
    if (currentScopeId && !allowedIds.includes(currentScopeId)) return [];
    return Array.isArray(positionsState.data) ? positionsState.data : [];
  }, [
    effectiveApplicationId,
    applicationData,
    applicationId,
    positionsState.currentApplicationId,
    positionsState.data,
  ]);

  const calculatorPositions = useMemo(() => {
    if (!Array.isArray(scopedPositions)) return [];
    return mapPositionsForCalculator(scopedPositions);
  }, [scopedPositions]);

  return (
    <div className="space-y-6 w-full">
      {/* Mount bank totals off-screen so we can reuse avgNetCredit for remit calculations */}
      <div
        className="hidden"
        aria-hidden="true"
        style={{ position: "absolute", left: -9999, top: 0 }}
      >
        <BankAnalysisTable
          showOnlyTotals
          onNetCreditAverageChange={(avg) => setBankNetCreditAvg(avg)}
          applicationId={effectiveApplicationId || undefined}
          positions={calculatorPositions as any}
        />
      </div>

      <OfferDecisionToggle
        positions={calculatorPositions as any}
        bankTables={undefined}
        bankTotalAvgNetCredit={bankNetCreditAvg ?? undefined}
        applicationId={effectiveApplicationId || undefined}
        disabled={!allowOfferEdit}
        showFooterActions={allowOfferEdit}
        showLeverageTable
        onSummaryMetricsChange={onSummaryMetricsChange}
      />

      {betweenOfferAndPositions}

      <PositionTableCalculator
        applicationId={effectiveApplicationId || undefined}
        positions={calculatorPositions as any}
        avgBankNetCredit={bankNetCreditAvg ?? undefined}
        readOnly={!allowPositionsEdit}
        disableDelete={allowPositionsEdit && positionsDisableDelete}
        disableCreate={allowPositionsEdit && positionsDisableCreate}
      />
    </div>
  );
}

