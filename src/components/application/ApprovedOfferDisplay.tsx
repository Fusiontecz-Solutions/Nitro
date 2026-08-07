import React, { useMemo } from "react";
import {
  formatCurrency,
  formatPercentUS,
  parseNumberUS,
} from "@/lib/utils";

interface MetricCellProps {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  className?: string;
}

const MetricCell = ({
  label,
  value,
  valueClassName = "",
  className = "",
}: MetricCellProps) => (
  <div
    className={`flex min-h-[56px] flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-r border-[#d8dde3] bg-white px-4 py-4 dark:border-slate-700 dark:bg-[#141517] ${className}`}
  >
    <span className="text-[14px] font-semibold leading-snug text-[#4a5568] dark:text-slate-300">
      {label}
    </span>
    <span className={`text-[16px] font-semibold leading-tight ${valueClassName}`}>
      {value}
    </span>
  </div>
);

type Frequency = "Daily" | "Weekly" | "Bi-Weekly" | "Monthly" | "";

const WEEKLY_TO_MONTHLY_FACTOR = 4.2;
const BIWEEKLY_TO_MONTHLY_FACTOR = 2.1;

function computeFallbackAvgNetCredit(
  bankTables?: Array<{ rows?: Array<{ netCredit?: number | string | null }> }>,
): number | null {
  if (!Array.isArray(bankTables) || bankTables.length === 0) return null;
  let sum = 0;
  let count = 0;
  for (const table of bankTables) {
    if (!Array.isArray(table?.rows)) continue;
    for (const row of table.rows) {
      const n = parseNumberUS(row?.netCredit);
      if (!Number.isNaN(n) && n > 0) {
        sum += n;
        count += 1;
      }
    }
  }
  if (count === 0) return null;
  return sum / count;
}

export interface ApprovedOfferDisplayProps {
  offer?: string | number;
  rate?: string | number;
  term?: string | number;
  frequency?: Frequency | string;
  monthlyPayment?: string | number;
  bankTotalAvgNetCredit?: number | string;
  bankTables?: Array<{ rows?: Array<{ netCredit?: number | string | null }> }>;
  activeCount?: number;
  existingRemit?: number;
  totalMonthlyFromPositions?: number;
  totalDailyFromPositions?: number;
  showLeverageTable?: boolean;
}

export const ApprovedOfferDisplay: React.FC<ApprovedOfferDisplayProps> = ({
  offer,
  rate,
  term,
  frequency,
  monthlyPayment,
  bankTotalAvgNetCredit,
  bankTables,
  activeCount = 0,
  existingRemit = 0,
  totalMonthlyFromPositions = 0,
  totalDailyFromPositions = 0,
  showLeverageTable = true,
}) => {
  if (!showLeverageTable) return null;

  const avgNetCredit = useMemo(() => {
    const direct = parseNumberUS(bankTotalAvgNetCredit);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return computeFallbackAvgNetCredit(bankTables) ?? NaN;
  }, [bankTotalAvgNetCredit, bankTables]);

  const leverage = useMemo(() => {
    const monthlyRepayNum = parseNumberUS(monthlyPayment);
    const termNumForDisplay = parseNumberUS(term);
    const offerNumForDisplay = parseNumberUS(offer);
    const rateNumForDisplay = parseNumberUS(rate);

    const totalRepaymentNum =
      Number.isFinite(offerNumForDisplay) &&
      offerNumForDisplay > 0 &&
      Number.isFinite(rateNumForDisplay) &&
      rateNumForDisplay > 0
        ? offerNumForDisplay * rateNumForDisplay
        : NaN;

    const freqForDisplay: Frequency =
      frequency === "Weekly"
        ? "Weekly"
        : frequency === "Bi-Weekly"
          ? "Bi-Weekly"
          : frequency === "Monthly"
            ? "Monthly"
            : "Daily";

    const derivedPerPeriodFromOffer =
      Number.isFinite(totalRepaymentNum) &&
      totalRepaymentNum > 0 &&
      Number.isFinite(termNumForDisplay) &&
      termNumForDisplay > 0
        ? totalRepaymentNum / termNumForDisplay
        : 0;
    const derivedMonthlyFromOffer =
      freqForDisplay === "Daily"
        ? termNumForDisplay > 0 && termNumForDisplay < 22
          ? derivedPerPeriodFromOffer * termNumForDisplay
          : derivedPerPeriodFromOffer * 22
        : freqForDisplay === "Weekly"
          ? derivedPerPeriodFromOffer * WEEKLY_TO_MONTHLY_FACTOR
          : freqForDisplay === "Bi-Weekly"
            ? derivedPerPeriodFromOffer * BIWEEKLY_TO_MONTHLY_FACTOR
            : derivedPerPeriodFromOffer;

    const derivedOurMonthlyRepay =
      Number.isFinite(monthlyRepayNum) && monthlyRepayNum > 0
        ? monthlyRepayNum
        : derivedMonthlyFromOffer;

    const totalMonthly =
      (totalMonthlyFromPositions || 0) +
      (Number.isFinite(derivedOurMonthlyRepay) ? derivedOurMonthlyRepay : 0);

    const ourRepay = Number.isFinite(derivedOurMonthlyRepay)
      ? derivedOurMonthlyRepay
      : 0;
    const existingRepay = Number.isFinite(totalMonthlyFromPositions)
      ? totalMonthlyFromPositions
      : 0;
    const totalRepay = Number.isFinite(totalMonthly) ? totalMonthly : 0;

    const existingDailyRepay = Number.isFinite(totalDailyFromPositions)
      ? totalDailyFromPositions
      : Number.isFinite(existingRepay) && existingRepay > 0
        ? existingRepay / 22
        : 0;
    // Match OfferDecisionToggle: for Daily + term < 22, monthlyPayment is total repayment
    // (daily × term), so new daily = monthly / term — not monthly / 22.
    let ourDailyRepay = 0;
    if (Number.isFinite(ourRepay) && ourRepay > 0) {
      if (
        freqForDisplay === "Daily" &&
        Number.isFinite(termNumForDisplay) &&
        termNumForDisplay > 0
      ) {
        ourDailyRepay =
          termNumForDisplay < 22
            ? ourRepay / termNumForDisplay
            : ourRepay / 22;
      } else {
        ourDailyRepay = ourRepay / 22;
      }
    }
    const totalDailyRepay = existingDailyRepay + ourDailyRepay;

    const existingHoldPct = Number.isFinite(existingRemit) ? existingRemit : 0;
    const ourHoldPct =
      Number.isFinite(ourRepay) &&
      ourRepay > 0 &&
      Number.isFinite(avgNetCredit) &&
      avgNetCredit > 0
        ? (ourRepay / avgNetCredit) * 100
        : 0;
    const totalHoldPct = existingHoldPct + ourHoldPct;

    return {
      ourHoldPct,
      ourRepay,
      existingHoldPct,
      existingRepay,
      totalHoldPct,
      totalRepay,
      existingDailyRepay,
      totalDailyRepay,
    };
  }, [
    offer,
    rate,
    term,
    frequency,
    monthlyPayment,
    avgNetCredit,
    existingRemit,
    totalMonthlyFromPositions,
    totalDailyFromPositions,
  ]);

  const {
    ourHoldPct,
    ourRepay,
    existingHoldPct,
    existingRepay,
    totalHoldPct,
    totalRepay,
    existingDailyRepay,
    totalDailyRepay,
  } = leverage;

  const existingHoldDisplay =
    existingHoldPct > 0 ? formatPercentUS(existingHoldPct) : formatPercentUS(0);

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-[10px] border border-[#d8dde3] bg-white dark:border-slate-700 dark:bg-[#141517]">
        <div className="flex h-10 w-full items-center border-b border-[#d8dde3] bg-[#d1e9f6] px-4 dark:border-slate-700 dark:bg-[#2A2B2F]">
          <span className="text-lg font-bold tracking-wide uppercase text-[#1e3a8a] dark:text-slate-100">
            Leverage
          </span>
        </div>

        <div className="grid grid-cols-1 border-b border-[#d8dde3] dark:border-slate-700 lg:grid-cols-3">
          <MetricCell
            label="Our Levg / Repay"
            value={`${formatPercentUS(ourHoldPct)} / ${formatCurrency(ourRepay)}`}
            valueClassName="text-[#10b981]"
            className="lg:border-b-0"
          />
          <MetricCell
            label="Existing Levg / Repay"
            value={`${existingHoldDisplay} / ${formatCurrency(existingRepay)}`}
            valueClassName="text-[#1e3a8a] dark:text-white"
            className="lg:border-b-0"
          />
          <MetricCell
            label="Total Levg / Repay"
            value={`${formatPercentUS(totalHoldPct)} / ${formatCurrency(totalRepay)}`}
            valueClassName={
              totalHoldPct > 60 ? "text-[#c73636]" : "text-[#b45309]"
            }
            className="lg:border-r-0 lg:border-b-0"
          />
        </div>

        <div className="grid grid-cols-1 border-b border-[#d8dde3] dark:border-slate-700 lg:grid-cols-3">
          <MetricCell
            label="Existing Monthly / Daily Repay"
            value={`${formatCurrency(existingRepay)} / ${formatCurrency(existingDailyRepay)}`}
            valueClassName="text-[#1e3a8a] dark:text-white"
            className="lg:border-b-0"
          />
          <MetricCell
            label="Total Monthly / Daily Repay"
            value={`${formatCurrency(totalRepay)} / ${formatCurrency(totalDailyRepay)}`}
            valueClassName="text-[#1e3a8a] dark:text-white"
            className="lg:border-b-0 lg:border-r-0"
          />
          <div className="hidden min-h-[56px] border-b border-[#d8dde3] bg-white dark:border-slate-700 dark:bg-[#141517] lg:block lg:border-b-0" />
        </div>

        <div className="flex min-h-[52px] flex-wrap items-center justify-start gap-x-2.5 gap-y-1 bg-white px-4 py-3 dark:bg-[#141517]">
          <span className="text-[14px] font-semibold text-[#4a5568] dark:text-slate-300">
            Existing Active Positions
          </span>
          <span className="text-[16px] font-semibold text-[var(--brand)] dark:text-white">
            {activeCount}
          </span>
        </div>
      </div>
    </div>
  );
};
