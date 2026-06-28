import { useMemo, useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/redux/store";

import BankAnalysisTable from "./BankAnalysisTable";
import OfferDecisionToggle from "./OfferDecisionToggle";
import PositionTableCalculator from "./PositionTableCalculator";

export type DecisionTabSectionContext = {
  /** True when offer is approved/saved and user has not clicked Edit. */
  componentsReadOnly: boolean;
  /** Bulk-save hook for bank cards — wired to Approve & Save. */
  onRegisterBankSaveAll?: (saveAll: () => Promise<boolean>) => void;
};

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
  betweenOfferAndPositions?:
    | ReactNode
    | ((ctx: DecisionTabSectionContext) => ReactNode);
  /** Rendered directly above the OFFER card (e.g. Super Admin assign-to-underwriter). */
  aboveOffer?: ReactNode;
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

function positionsHaveMeaningfulData(arr: unknown): boolean {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.some((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    for (const key of [
      "lender",
      "installment",
      "amountFunded",
      "totalRepayments",
      "monthlyMcaPmts",
      "mcaRemit",
      "startingDate",
    ]) {
      const v = r[key];
      if (v != null && String(v).trim() !== "") return true;
    }
    const status = String(r.status ?? "").trim().toUpperCase();
    if (status && status !== "SELECT") return true;
    const frequency = String(r.frequency ?? "").trim();
    if (frequency && frequency !== "Select") return true;
    return false;
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
  aboveOffer,
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
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [livePositions, setLivePositions] = useState<any[]>([]);
  const livePositionsRef = useRef<any[]>([]);
  const lastPositionsSeedSigRef = useRef("");
  const lastSeededAppRef = useRef<string | null>(null);

  const saveAllPositionsRef = useRef<(() => Promise<boolean>) | null>(null);
  const saveAllBanksRef = useRef<(() => Promise<boolean>) | null>(null);

  const handleRegisterSaveAllPositions = useCallback(
    (saveAll: () => Promise<boolean>) => {
      saveAllPositionsRef.current = saveAll;
    },
    [],
  );

  const handleRegisterSaveAllBanks = useCallback(
    (saveAll: () => Promise<boolean>) => {
      saveAllBanksRef.current = saveAll;
    },
    [],
  );

  const useDeferredSave = allowOfferEdit || allowPositionsEdit;

  const handleApproveSaveAll = useCallback(async (): Promise<boolean> => {
    if (!useDeferredSave) return true;

    try {
      const banksOk = (await saveAllBanksRef.current?.()) ?? true;
      if (!banksOk) return false;
    } catch (err) {
      console.error("Failed to save bank analysis on approve:", err);
      return false;
    }

    try {
      const positionsOk = (await saveAllPositionsRef.current?.()) ?? true;
      if (!positionsOk) return false;
    } catch (err) {
      console.error("Failed to save positions on approve:", err);
      return false;
    }

    return true;
  }, [useDeferredSave]);

  const componentsReadOnly = isPreviewMode || !allowPositionsEdit;

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

  const positionsForCalculator = useMemo(() => {
    if (positionsHaveMeaningfulData(livePositions)) {
      return livePositions;
    }
    return calculatorPositions;
  }, [livePositions, calculatorPositions]);

  useEffect(() => {
    livePositionsRef.current = livePositions;
  }, [livePositions]);

  useEffect(() => {
    if (!effectiveApplicationId) {
      setLivePositions([]);
      lastSeededAppRef.current = null;
      lastPositionsSeedSigRef.current = "";
      return;
    }
    const appKey = String(effectiveApplicationId);
    const sig = JSON.stringify(
      (calculatorPositions || []).map((p: any) => ({
        _id: String(p._id ?? ""),
        lender: String(p.lender ?? ""),
        amountFunded: String(p.amountFunded ?? ""),
      })),
    );

    if (lastSeededAppRef.current !== appKey) {
      lastSeededAppRef.current = appKey;
      lastPositionsSeedSigRef.current = sig;
      setLivePositions(calculatorPositions);
      return;
    }

    if (sig === lastPositionsSeedSigRef.current) return;
    lastPositionsSeedSigRef.current = sig;

    if (
      !positionsHaveMeaningfulData(calculatorPositions) &&
      positionsHaveMeaningfulData(livePositionsRef.current)
    ) {
      return;
    }

    setLivePositions(calculatorPositions);
  }, [effectiveApplicationId, calculatorPositions]);

  const handleRowsChange = useCallback((nextRows: any[]) => {
    setLivePositions((prev) => (prev === nextRows ? prev : nextRows || []));
  }, []);

  const sectionContext: DecisionTabSectionContext = {
    componentsReadOnly,
    onRegisterBankSaveAll: useDeferredSave
      ? handleRegisterSaveAllBanks
      : undefined,
  };

  const betweenSection =
    typeof betweenOfferAndPositions === "function"
      ? betweenOfferAndPositions(sectionContext)
      : betweenOfferAndPositions;

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
          positions={positionsForCalculator as any}
        />
      </div>

      <OfferDecisionToggle
        positions={positionsForCalculator as any}
        bankTables={undefined}
        bankTotalAvgNetCredit={bankNetCreditAvg ?? undefined}
        applicationId={effectiveApplicationId || undefined}
        disabled={!allowOfferEdit}
        showFooterActions={allowOfferEdit}
        actionsAtTop
        showPreviewBadge
        onPreviewModeChange={setIsPreviewMode}
        showLeverageTable
        onSummaryMetricsChange={onSummaryMetricsChange}
        onApprove={useDeferredSave ? handleApproveSaveAll : undefined}
        aboveOffer={aboveOffer}
      />

      {betweenSection}

      <PositionTableCalculator
        applicationId={effectiveApplicationId || undefined}
        positions={positionsForCalculator as any}
        avgBankNetCredit={bankNetCreditAvg ?? undefined}
        onRowsChange={handleRowsChange}
        readOnly={componentsReadOnly}
        disableDelete={allowPositionsEdit && positionsDisableDelete}
        disableCreate={allowPositionsEdit && positionsDisableCreate}
        onRegisterSaveAll={
          useDeferredSave ? handleRegisterSaveAllPositions : undefined
        }
      />
    </div>
  );
}
