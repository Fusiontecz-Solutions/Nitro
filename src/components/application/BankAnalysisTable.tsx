import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Check,
  Trash2,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Pencil,
} from "lucide-react";
import { useSelector } from "react-redux";
import type { RootState } from "@/redux/store";
import { axiosGet, axiosPost, axiosPut, axiosDelete } from "@/redux/axios";
import type { BankAnalysis } from "@/types/bankAnalysisTypes";
import { toast } from "react-toastify";
import { formatNumberUS, normalizeApiDateToYyyyMmDd } from "@/lib/utils";
import BankTotalTable from "@/components/application/BankTotalTable";
import type {
  BankTotalTableAverageCells,
  BankTotalTableRow,
} from "@/components/application/BankTotalTable";

interface MonthlyData {
  month: string;
  totalCredit: string;
  loanTransfer: string;
  deposit: string;
  other: string;
  nsfNegDays: string;
  lowBlcDays: string;
  avgDailyBlc: string;
  /** Backend row id; set when loaded or after save. Used to permanently delete row via API. */
  rowBackendId?: string;
  /** When true, cells are read-only until user uses “Edit rows” for this bank. */
  isLocked?: boolean;
}

interface BankAnalysisInstance {
  id: number;
  backendId?: string;
  accountNumber: string;
  rows: MonthlyData[];
  /** After header Save (or load from API with an account), show "Saved" until user clicks Edit. */
  accountHeaderLocked?: boolean;
}

type MonthSummaryBucket = {
  totalCredit: number;
  loanTransfer: number;
  deposit: number;
  other: number;
  avgDailyBlcSum: number;
  avgDailyBlcPositiveCount: number;
  nsfNegDays: number;
  lowBlcDays: number;
};

type BankTotalMonth = {
  totalCredit: number;
  loanTransfer: number;
  deposit: number;
  other: number;
  netCredit: number | null;
  avgDailyBlc: number | null;
  nsfNegDays: number;
  lowBlcDays: number;
};

interface BankAnalysisTableProps {
  /** When true, only render the bottom "Bank Total" summary table (no editable bank cards) */
  showOnlyTotals?: boolean;
  /** When true, no add/edit/save/delete on bank cards (e.g. OPERATIONS view-only pipeline). */
  readOnly?: boolean;
  /** When true, edits are still allowed but bank- and row-level delete actions are hidden. */
  disableDelete?: boolean;
  /** When true, hide Add Bank and Add Month while keeping row editing. */
  disableCreate?: boolean;
  /** Callback with the average Net Credit across months (used for leverage/remit calculations). */
  onNetCreditAverageChange?: (avg: number | null) => void;
  /** Optional explicit application id (fallback when applicationDetail is not mounted). */
  applicationId?: string;
  positions?: Array<{
    amountFunded?: string | number;
    startingDate?: string;
    allocatedBankAnalysisId?: number;
  }>;
  onBanksMetaChange?: (banks: Array<{ id: number; accountNumber: string }>) => void;
  /** When true, hide per-bank Save rows / account Save — bulk save runs on Approve & Save. */
  hideToolbarSave?: boolean;
  /** Registers a bulk-save hook for the parent Approve & Save flow. */
  onRegisterSaveAll?: (saveAll: () => Promise<boolean>) => void;
}

const parseCurrency = (value: string): number => {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]+/g, "");
  if (!cleaned) return 0;
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? 0 : num;
};

/** True if the user entered a numeric value (excludes empty and placeholder like "e.g. 0"). */
const hasEnteredNumericValue = (raw: string | undefined | null): boolean => {
  if (raw == null) return false;
  const s = String(raw).trim();
  if (!s) return false;
  if (/^e\.?\s*g\.?/i.test(s)) return false;
  const cleaned = s.replace(/[^0-9.-]+/g, "");
  if (!cleaned) return false;
  const num = parseFloat(cleaned);
  return !Number.isNaN(num);
};

const normalizeMonthLabelKey = (month: string | undefined | null): string =>
  month != null ? String(month).trim().toLowerCase() : "";

const hasAnyValue = (row: MonthlyData): boolean => {
  return (
    !!row.totalCredit ||
    !!row.loanTransfer ||
    !!row.deposit ||
    !!row.other ||
    !!row.nsfNegDays ||
    !!row.lowBlcDays ||
    !!row.avgDailyBlc
  );
};

/** After save/load: show currency inputs with two fraction digits (e.g. 900.00). */
const formatMoneyRowDisplay = (row: MonthlyData): MonthlyData => ({
  ...row,
  totalCredit: hasEnteredNumericValue(row.totalCredit)
    ? formatNumberUS(parseCurrency(row.totalCredit))
    : row.totalCredit,
  loanTransfer: hasEnteredNumericValue(row.loanTransfer)
    ? formatNumberUS(parseCurrency(row.loanTransfer))
    : row.loanTransfer,
  deposit: hasEnteredNumericValue(row.deposit)
    ? formatNumberUS(parseCurrency(row.deposit))
    : row.deposit,
  other: hasEnteredNumericValue(row.other)
    ? formatNumberUS(parseCurrency(row.other))
    : row.other,
  avgDailyBlc: hasEnteredNumericValue(row.avgDailyBlc)
    ? formatNumberUS(parseCurrency(row.avgDailyBlc))
    : row.avgDailyBlc,
});

const computeBankTotalForMonth = (bucket: MonthSummaryBucket): BankTotalMonth => {
  const totalCredit = bucket.totalCredit;
  const loanTransfer = bucket.loanTransfer;
  const deposit = bucket.deposit;
  const other = bucket.other;

  let netCredit: number | null = null;
  if (totalCredit > 0) {
    const rawNet = totalCredit - (loanTransfer + deposit + other);
    netCredit = Math.max(0, rawNet);
  }

  let avgDailyBlc: number | null = null;
  if (bucket.avgDailyBlcPositiveCount > 0 && bucket.avgDailyBlcSum > 0) {
    avgDailyBlc = bucket.avgDailyBlcSum;
  } else if (netCredit !== null && netCredit > 0) {
    avgDailyBlc = netCredit / 30;
  }

  return {
    totalCredit,
    loanTransfer,
    deposit,
    other,
    netCredit,
    avgDailyBlc,
    nsfNegDays: bucket.nsfNegDays,
    lowBlcDays: bucket.lowBlcDays,
  };
};

const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const createDefaultRows = (): MonthlyData[] => {

  const rows: MonthlyData[] = [];
  const now = new Date();

  // Generate the current month (MTD) + previous 5 full months
  for (let i = 0; i < 6; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const name = MONTH_NAMES[d.getMonth()];
    const year = d.getFullYear();

    const label = i === 0 ? `${name} MTD` : `${name} ${year}`;

    rows.push({
      month: label,
      totalCredit: "",
      loanTransfer: "",
      deposit: "",
      other: "",
      nsfNegDays: "",
      lowBlcDays: "",
      avgDailyBlc: "",
    });
  }

  return rows;
};

/** Parse "April MTD" or "March 2026" to the first day of that month (MTD uses the current calendar year). */
function parseMonthLabelToDate(label: string): Date | null {
  const trimmed = String(label || "").trim();
  if (!trimmed) return null;
  const mtd = trimmed.match(/^([A-Za-z]+)\s+MTD$/i);
  if (mtd) {
    const monthIdx = MONTH_NAMES.findIndex(
      (m) => m.toLowerCase() === mtd[1].toLowerCase(),
    );
    if (monthIdx < 0) return null;
    const now = new Date();
    return new Date(now.getFullYear(), monthIdx, 1);
  }
  const full = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/i);
  if (!full) return null;
  const monthIdx = MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === full[1].toLowerCase(),
  );
  if (monthIdx < 0) return null;
  const year = parseInt(full[2], 10);
  if (!Number.isFinite(year)) return null;
  return new Date(year, monthIdx, 1);
}

function monthLabelSortKey(label: string): number {
  const d = parseMonthLabelToDate(label);
  return d != null && !Number.isNaN(d.getTime())
    ? d.getTime()
    : Number.NEGATIVE_INFINITY;
}

/** Newest month first (same convention as default rows: current MTD, then prior full months). */
function sortMonthlyRowsByMonthDesc(rows: MonthlyData[]): MonthlyData[] {
  return [...rows].sort((a, b) => {
    const diff = monthLabelSortKey(b.month) - monthLabelSortKey(a.month);
    if (diff !== 0) return diff;
    return String(a.month).localeCompare(String(b.month));
  });
}

/** Next older calendar month label after the chronologically oldest row (for Add Month). */
function labelForMonthBeforeOldest(sortedRowsDesc: MonthlyData[]): string {
  const now = new Date();
  const oldest = sortedRowsDesc[sortedRowsDesc.length - 1];
  if (oldest) {
    const od = parseMonthLabelToDate(oldest.month);
    if (od && !Number.isNaN(od.getTime())) {
      const d = new Date(od.getFullYear(), od.getMonth() - 1, 1);
      return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    }
  }
  const d = new Date(now.getFullYear(), now.getMonth() - sortedRowsDesc.length, 1);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** First cell for average footer rows: bold “AVERAGE” with blue “(MTD not counted)” subtitle. */
function BankAnalysisAverageFooterLabelCell() {
  return (
    <td className="px-4 py-3 align-middle bg-inherit">
      <div className="flex flex-col leading-snug">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
          Average
        </span>
        <span className="mt-0.5 text-[11px] font-medium text-[#1d5f8a] dark:text-sky-300">
          (MTD not counted)
        </span>
      </div>
    </td>
  );
}

const BankAnalysisTable = ({
  showOnlyTotals = false,
  readOnly = false,
  disableDelete = false,
  disableCreate = false,
  onNetCreditAverageChange,
  applicationId: applicationIdProp,
  positions = [],
  onBanksMetaChange,
  hideToolbarSave = false,
  onRegisterSaveAll,
}: BankAnalysisTableProps) => {
  const isReadOnly = !!readOnly;
  /** Hide per-bank Save when bulk save is wired (e.g. Offer "Approve & Save"). */
  const deferToolbarSave = hideToolbarSave || Boolean(onRegisterSaveAll);
  const isDeleteDisabled = !!disableDelete;
  const isCreateDisabled = !!disableCreate;
  const [fundingBreakdownModal, setFundingBreakdownModal] = useState<{
    bankId: number;
    rowIndex: number;
    month: string;
    allocated: number;
  } | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [savingHeaderBankId, setSavingHeaderBankId] = useState<number | null>(null);
  const [bulkSavingBankId, setBulkSavingBankId] = useState<number | null>(null);
  const [deletingBankId, setDeletingBankId] = useState<number | null>(null);
  const [deletingRow, setDeletingRow] = useState<{ bankId: number; rowIndex: number } | null>(null);
  /** Blocks duplicate API saves when save is triggered faster than React re-renders. */
  const saveBankInFlightRef = useRef<Set<number>>(new Set());

  const { data: applicationData } = useSelector(
    (state: RootState) => state.applicationDetail,
  );
  const applicationId = (applicationIdProp || (applicationData?._id as string | undefined));

  const [banks, setBanks] = useState<BankAnalysisInstance[]>([
    {
      id: 1,
      accountNumber: "",
      rows: createDefaultRows(),
      accountHeaderLocked: false,
    },
  ]);

  const baseMonths = useMemo(() => {
    const r0 = banks[0]?.rows;
    if (!r0?.length) return createDefaultRows().map((row) => row.month);
    return sortMonthlyRowsByMonthDesc(r0).map((row) => row.month);
  }, [banks]);

  useEffect(() => {
    if (!onBanksMetaChange) return;
    onBanksMetaChange(
      banks.map((b) => ({ id: b.id, accountNumber: b.accountNumber || "" })),
    );
  }, [banks, onBanksMetaChange]);

  const toYearMonthFromLabel = (label: string): string => {
    const now = new Date();
    const mtd = label.match(/^([A-Za-z]+)\s+MTD$/);
    if (mtd) {
      const monthIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === mtd[1].toLowerCase());
      if (monthIdx < 0) return "";
      return `${now.getFullYear()}-${String(monthIdx + 1).padStart(2, "0")}`;
    }
    const full = label.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!full) return "";
    const monthIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === full[1].toLowerCase());
    if (monthIdx < 0) return "";
    return `${full[2]}-${String(monthIdx + 1).padStart(2, "0")}`;
  };

  const loanTransferAllocatedByBankAndMonth = useMemo(() => {
    const map: Record<string, number> = {};
    const bankCount = banks.length;
    if (!bankCount || !Array.isArray(positions)) return map;

    positions.forEach((p) => {
      const amount = parseCurrency(String(p?.amountFunded ?? ""));
      if (!Number.isFinite(amount) || amount <= 0) return;
      const date = normalizeApiDateToYyyyMmDd(p?.startingDate ?? "");
      const ymMatch = date.match(/^(\d{4}-\d{2})/);
      if (!ymMatch) return;
      const ym = ymMatch[1];

      if (bankCount === 1) {
        const key = `1|${ym}`;
        map[key] = (map[key] || 0) + amount;
        return;
      }

      const idxRaw = p?.allocatedBankAnalysisId;
      const idx = Number(idxRaw);
      if (!Number.isInteger(idx) || idx < 1 || idx > bankCount) return;
      const key = `${idx}|${ym}`;
      map[key] = (map[key] || 0) + amount;
    });

    return map;
  }, [banks.length, positions]);

  const calculateNetCredit = (row: MonthlyData, bankId: number) => {
    const credit = parseCurrency(row.totalCredit);
    const loan =
      parseCurrency(row.loanTransfer) +
      (loanTransferAllocatedByBankAndMonth[
        `${bankId}|${toYearMonthFromLabel(row.month)}`
      ] || 0);
    const deposit = parseCurrency(row.deposit);
    const other = parseCurrency(row.other);
    return credit - (loan + deposit + other);
  };

  // Load existing bank analysis data for this application
  useEffect(() => {
    const load = async () => {
      if (!applicationId) {
        setIsInitialLoading(false);
        return;
      }
      try {
        const resp = await axiosGet(
          `/bank-analysis?${new URLSearchParams({ application: applicationId }).toString()}`,
        );
        const payload = resp.data;
        const list: BankAnalysis[] = payload?.data ?? payload ?? [];
        if (!Array.isArray(list) || list.length === 0) {
          setIsInitialLoading(false);
          return;
        }

        setBanks(
          list.map((item, index) => ({
            id: index + 1,
            backendId: item._id,
            accountNumber: item.accountNumber || "",
            accountHeaderLocked: Boolean(item.accountNumber?.trim()),
            rows:
              item.rows && item.rows.length > 0
                ? sortMonthlyRowsByMonthDesc(
                    item.rows.map((r) => {
                      const backendNetCredit =
                        (r.totalCredit || 0) -
                        ((r.loanTransfer || 0) +
                          (r.deposit || 0) +
                          (r.other || 0));
                      const autoAvgDailyBlc =
                        backendNetCredit > 0 ? backendNetCredit / 30 : 0;

                      const mr: MonthlyData = {
                        month: r.monthLabel,
                        totalCredit: r.totalCredit ? String(r.totalCredit) : "",
                        loanTransfer: r.loanTransfer
                          ? String(r.loanTransfer)
                          : "",
                        deposit: r.deposit ? String(r.deposit) : "",
                        other: r.other ? String(r.other) : "",
                        nsfNegDays: r.nsfNegDays ? String(r.nsfNegDays) : "",
                        lowBlcDays: r.lowBlcDays ? String(r.lowBlcDays) : "",
                        avgDailyBlc: r.avgDailyBlc
                          ? String(r.avgDailyBlc)
                          : autoAvgDailyBlc > 0
                            ? formatNumberUS(autoAvgDailyBlc)
                            : "",
                        rowBackendId: (r as { _id?: string; id?: string })._id ?? (r as { _id?: string; id?: string }).id,
                      };
                      const locked = { ...mr, isLocked: hasAnyValue(mr) };
                      return formatMoneyRowDisplay(locked);
                    }),
                  )
                : createDefaultRows(),
          })),
        );
      } catch (error) {
        console.error("Failed to load bank analysis", error);
      } finally {
        setIsInitialLoading(false);
      }
    };

    void load();
  }, [applicationId]);

  const monthSummary = useMemo(() => {
    const summary: Record<string, MonthSummaryBucket> = {};

    banks.forEach((bank) => {
      bank.rows.forEach((row) => {
        const allocatedForRow =
          loanTransferAllocatedByBankAndMonth[
            `${bank.id}|${toYearMonthFromLabel(row.month)}`
          ] || 0;
        if (!hasAnyValue(row) && allocatedForRow <= 0) return;
        if (!summary[row.month]) {
          summary[row.month] = {
            totalCredit: 0,
            loanTransfer: 0,
            deposit: 0,
            other: 0,
            avgDailyBlcSum: 0,
            avgDailyBlcPositiveCount: 0,
            nsfNegDays: 0,
            lowBlcDays: 0,
          };
        }
        const bucket = summary[row.month];

        const totalCredit = parseCurrency(row.totalCredit);
        const loanTransfer = parseCurrency(row.loanTransfer) + allocatedForRow;
        const deposit = parseCurrency(row.deposit);
        const other = parseCurrency(row.other);
        const avgDailyBlc = parseCurrency(row.avgDailyBlc);
        const nsfNegDays = parseCurrency(row.nsfNegDays);
        const lowBlcDays = parseCurrency(row.lowBlcDays);

        if (totalCredit > 0) bucket.totalCredit += totalCredit;
        if (loanTransfer > 0) bucket.loanTransfer += loanTransfer;
        if (deposit > 0) bucket.deposit += deposit;
        if (other > 0) bucket.other += other;

        if (avgDailyBlc > 0) {
          bucket.avgDailyBlcSum += avgDailyBlc;
          bucket.avgDailyBlcPositiveCount += 1;
        }

        if (nsfNegDays > 0) bucket.nsfNegDays += nsfNegDays;
        if (lowBlcDays > 0) bucket.lowBlcDays += lowBlcDays;
      });
    });

    return summary;
  }, [banks, loanTransferAllocatedByBankAndMonth]);

  /** Bank Total footer: MTD excluded; divisor = non-MTD months that have core data in at least one bank (positions-only months omitted). */
  const bankTotalAverages = useMemo(() => {
    const activeMonthSet = new Set<string>();
    banks.forEach((table) => {
      (table.rows || []).forEach((row) => {
        const monthLabel = normalizeMonthLabelKey(row.month);
        if (!monthLabel || monthLabel.includes("mtd")) return;
        const hasCoreValue =
          hasEnteredNumericValue(row.totalCredit) ||
          hasEnteredNumericValue(row.loanTransfer) ||
          hasEnteredNumericValue(row.deposit) ||
          hasEnteredNumericValue(row.other) ||
          hasEnteredNumericValue(row.avgDailyBlc);
        if (hasCoreValue) activeMonthSet.add(monthLabel);
      });
    });

    const firstBankMonths = banks[0]?.rows.length
      ? sortMonthlyRowsByMonthDesc(banks[0].rows).map((r) => r.month)
      : [];
    const activeBankTotalMonths = firstBankMonths.filter((m) => {
      const ml = normalizeMonthLabelKey(m);
      if (!ml || ml.includes("mtd")) return false;
      return activeMonthSet.has(ml);
    });

    const n = activeBankTotalMonths.length;
    const acc = {
      totalCredit: { sum: 0, any: false },
      loanTransfer: { sum: 0, any: false },
      deposit: { sum: 0, any: false },
      other: { sum: 0, any: false },
      netCredit: { sum: 0, any: false },
      avgDailyBlc: { sum: 0, any: false },
      nsfNegDays: { sum: 0, any: false },
      lowBlcDays: { sum: 0, any: false },
    };

    const bankTotalRowHasData = (totals: BankTotalMonth | null) =>
      !!totals &&
      (totals.totalCredit > 0 ||
        totals.loanTransfer > 0 ||
        totals.deposit > 0 ||
        totals.other > 0 ||
        (totals.netCredit ?? 0) > 0 ||
        (totals.avgDailyBlc ?? 0) > 0 ||
        totals.nsfNegDays > 0 ||
        totals.lowBlcDays > 0);

    for (const month of activeBankTotalMonths) {
      const bucket = monthSummary[month];
      const totals = bucket ? computeBankTotalForMonth(bucket) : null;
      const rowHasData = bankTotalRowHasData(totals);

      acc.totalCredit.sum += totals?.totalCredit ?? 0;
      if (rowHasData) acc.totalCredit.any = true;

      acc.loanTransfer.sum += totals?.loanTransfer ?? 0;
      if (rowHasData) acc.loanTransfer.any = true;

      acc.deposit.sum += totals?.deposit ?? 0;
      if (rowHasData) acc.deposit.any = true;

      acc.other.sum += totals?.other ?? 0;
      if (rowHasData) acc.other.any = true;

      const netVal = totals?.netCredit;
      acc.netCredit.sum += netVal ?? 0;
      if (rowHasData && netVal !== null) acc.netCredit.any = true;

      const advVal = totals?.avgDailyBlc;
      acc.avgDailyBlc.sum += advVal ?? 0;
      if (rowHasData && advVal !== null) acc.avgDailyBlc.any = true;

      acc.nsfNegDays.sum += totals?.nsfNegDays ?? 0;
      if (rowHasData) acc.nsfNegDays.any = true;

      acc.lowBlcDays.sum += totals?.lowBlcDays ?? 0;
      if (rowHasData) acc.lowBlcDays.any = true;
    }

    const finish = (x: { sum: number; any: boolean }) =>
      n > 0 && x.any ? x.sum / n : null;

    return {
      totalCredit: finish(acc.totalCredit),
      loanTransfer: finish(acc.loanTransfer),
      deposit: finish(acc.deposit),
      other: finish(acc.other),
      netCredit: finish(acc.netCredit),
      avgDailyBlc: finish(acc.avgDailyBlc),
      nsfNegDays: finish(acc.nsfNegDays),
      lowBlcDays: finish(acc.lowBlcDays),
      divisorMonths: n,
    };
  }, [banks, monthSummary]);

  const hasBankTotalAverageRow = bankTotalAverages.divisorMonths > 0;

  const bankTotalTablePayload = useMemo((): {
    rows: BankTotalTableRow[];
    average: BankTotalTableAverageCells;
  } => {
    const L = isInitialLoading;
    const H = hasBankTotalAverageRow;

    const rows: BankTotalTableRow[] = baseMonths.map((month) => {
      const summary = monthSummary[month];
      const totals = summary ? computeBankTotalForMonth(summary) : undefined;
      const hasData =
        totals &&
        (totals.totalCredit > 0 ||
          totals.loanTransfer > 0 ||
          totals.deposit > 0 ||
          totals.other > 0 ||
          (totals.netCredit ?? 0) > 0 ||
          (totals.avgDailyBlc ?? 0) > 0 ||
          totals.nsfNegDays > 0 ||
          totals.lowBlcDays > 0);

      return {
        month,
        totalCredit: L ? "Loading..." : hasData && totals ? `$ ${formatNumberUS(totals.totalCredit)}` : "-",
        loanTransfer: L ? "Loading..." : hasData && totals ? `$ ${formatNumberUS(totals.loanTransfer)}` : "-",
        deposit: L ? "Loading..." : hasData && totals ? `$ ${formatNumberUS(totals.deposit)}` : "-",
        other: L ? "Loading..." : hasData && totals ? `$ ${formatNumberUS(totals.other)}` : "-",
        netCredit: L
          ? "Loading..."
          : hasData && totals && totals.netCredit !== null
            ? `$ ${formatNumberUS(totals.netCredit)}`
            : "-",
        avgDailyBal: L
          ? "Loading..."
          : hasData && totals && totals.avgDailyBlc !== null
            ? `$ ${formatNumberUS(totals.avgDailyBlc)}`
            : "-",
        nsfNegDays: L ? "Loading..." : hasData && totals ? String(totals.nsfNegDays) : "-",
        lowBalDays: L ? "Loading..." : hasData && totals ? String(totals.lowBlcDays) : "-",
      };
    });

    const {
      totalCredit: totalCreditAvg,
      loanTransfer: loanTransferAvg,
      deposit: depositAvg,
      other: otherAvg,
      netCredit: netCreditAvgRow,
      avgDailyBlc: avgDailyBlcAvgBase,
      nsfNegDays: nsfAvg,
      lowBlcDays: lowBlcAvg,
    } = bankTotalAverages;

    let avgDailyBlcAvg = avgDailyBlcAvgBase;
    if (
      (avgDailyBlcAvg === null || Number.isNaN(avgDailyBlcAvg)) &&
      netCreditAvgRow !== null &&
      netCreditAvgRow > 0
    ) {
      avgDailyBlcAvg = netCreditAvgRow / 30;
    }

    const average: BankTotalTableAverageCells = {
      totalCredit: L ? "Loading..." : H && totalCreditAvg !== null ? `$ ${formatNumberUS(totalCreditAvg)}` : "-",
      loanTransfer: L ? "Loading..." : H && loanTransferAvg !== null ? `$ ${formatNumberUS(loanTransferAvg)}` : "-",
      deposit: L ? "Loading..." : H && depositAvg !== null ? `$ ${formatNumberUS(depositAvg)}` : "-",
      other: L ? "Loading..." : H && otherAvg !== null ? `$ ${formatNumberUS(otherAvg)}` : "-",
      netCredit: L ? "Loading..." : H && netCreditAvgRow !== null ? `$ ${formatNumberUS(netCreditAvgRow)}` : "-",
      avgDailyBal: L
        ? "Loading..."
        : H &&
            avgDailyBlcAvg !== null &&
            typeof avgDailyBlcAvg === "number" &&
            !Number.isNaN(avgDailyBlcAvg)
          ? `$ ${formatNumberUS(avgDailyBlcAvg)}`
          : "-",
      nsfNegDays: L ? "Loading..." : H && nsfAvg !== null ? String(Math.round(nsfAvg)) : "-",
      lowBalDays: L ? "Loading..." : H && lowBlcAvg !== null ? String(Math.round(lowBlcAvg)) : "-",
    };

    return { rows, average };
  }, [baseMonths, monthSummary, isInitialLoading, bankTotalAverages, hasBankTotalAverageRow]);

  const netCreditAvg = bankTotalAverages.netCredit;

  const lastEmittedNetCreditAvgRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (!onNetCreditAverageChange) return;
    const raw = netCreditAvg ?? null;
    const stabilized =
      raw != null && Number.isFinite(raw) ? Math.round(raw * 100) / 100 : raw;
    if (Object.is(lastEmittedNetCreditAvgRef.current, stabilized)) return;
    lastEmittedNetCreditAvgRef.current = stabilized;
    onNetCreditAverageChange(stabilized);
  }, [onNetCreditAverageChange, netCreditAvg]);

  const handleAddBank = () => {
    setBanks((prev) => {
      const nextId = prev.length + 1;
      return [
        ...prev,
        {
          id: nextId,
          accountNumber: "",
          rows: createDefaultRows(),
          accountHeaderLocked: false,
        },
      ];
    });
  };

  const handleDeleteBank = async (bankId: number) => {
    // Find the bank instance so we know if it exists in the backend
    const bankToDelete = banks.find((b) => b.id === bankId);

    setDeletingBankId(bankId);
    try {
      // If it has a backendId, delete from API first
      if (bankToDelete?.backendId) {
        try {
          await axiosDelete(`/bank-analysis/${bankToDelete.backendId}`);
        } catch (error: any) {
          console.error("Failed to delete bank analysis", error);
          const errMsg =
            error?.response?.data?.message ||
            error?.message ||
            "Failed to delete bank analysis. Please try again.";
          toast.error(errMsg);
          return;
        }
      }

      // Remove from local state
      setBanks((prev) => prev.filter((bank) => bank.id !== bankId));
      toast.success("Bank analysis deleted successfully.");
    } finally {
      setDeletingBankId(null);
    }
  };

  const handleAccountChange = (bankId: number, value: string) => {
    setBanks((prev) =>
      prev.map((bank) =>
        bank.id === bankId ? { ...bank, accountNumber: value } : bank,
      ),
    );
  };

  const handleRowChange = (
    bankId: number,
    rowIndex: number,
    field: keyof MonthlyData,
    value: string,
  ) => {
    setBanks((prev) =>
      prev.map((bank) => {
        if (bank.id !== bankId) return bank;
        const rows = bank.rows.map((row, idx) => {
          if (idx !== rowIndex) return row;
          if (row.isLocked) return row;

          if (
            field === "totalCredit" ||
            field === "loanTransfer" ||
            field === "deposit" ||
            field === "other"
          ) {
            const updatedRow: MonthlyData = { ...row, [field]: value };
            const netCredit = calculateNetCredit(updatedRow, bankId);
            const autoAvg = netCredit > 0 ? netCredit / 30 : 0;

            return {
              ...updatedRow,
              avgDailyBlc: autoAvg > 0 ? formatNumberUS(autoAvg) : "",
            };
          }

          return { ...row, [field]: value };
        });
        return { ...bank, rows };
      }),
    );
  };

  const handleUnlockAllBankRows = (bankId: number) => {
    setBanks((prev) =>
      prev.map((bank) =>
        bank.id !== bankId
          ? bank
          : {
              ...bank,
              rows: bank.rows.map((row) => ({ ...row, isLocked: false })),
            },
      ),
    );
  };

  const handleDeleteRow = async (bankId: number, rowIndex: number) => {
    const bank = banks.find((b) => b.id === bankId);
    if (!bank || bank.rows.length <= 1) return;

    setDeletingRow({ bankId, rowIndex });
    try {
      const row = bank.rows[rowIndex];
      const rowBackendId = row?.rowBackendId;
      const hasBackendRow = Boolean(bank.backendId && rowBackendId);

      if (hasBackendRow) {
        try {
          await axiosDelete(
            `/bank-analysis/${bank.backendId}/rows/${rowBackendId}`,
          );
        } catch (error: unknown) {
          const err = error as { response?: { data?: { message?: string } }; message?: string };
          const errMsg =
            err?.response?.data?.message ?? err?.message ?? "Failed to delete row.";
          toast.error(errMsg);
          return;
        }
      }

      setBanks((prev) =>
        prev.map((b) => {
          if (b.id !== bankId) return b;
          const rows = sortMonthlyRowsByMonthDesc(
            b.rows.filter((_, idx) => idx !== rowIndex),
          );
          return { ...b, rows };
        }),
      );
      toast.success("Row deleted successfully.");
    } finally {
      setDeletingRow(null);
    }
  };

  const handleAddMonth = (bankId: number) => {
    setBanks((prev) =>
      prev.map((bank) => {
        if (bank.id !== bankId) return bank;
        const sorted = sortMonthlyRowsByMonthDesc(bank.rows);
        const label = labelForMonthBeforeOldest(sorted);

        const newRow: MonthlyData = {
          month: label,
          totalCredit: "",
          loanTransfer: "",
          deposit: "",
          other: "",
          nsfNegDays: "",
          lowBlcDays: "",
          avgDailyBlc: "",
          isLocked: false,
        };
        return {
          ...bank,
          rows: sortMonthlyRowsByMonthDesc([...bank.rows, newRow]),
        };
      }),
    );
  };

  const selectedBreakdownRow = useMemo(() => {
    if (!fundingBreakdownModal) return null;
    const bank = banks.find((b) => b.id === fundingBreakdownModal.bankId);
    if (!bank) return null;
    const row = bank.rows[fundingBreakdownModal.rowIndex];
    if (!row) return null;
    return { bank, row };
  }, [fundingBreakdownModal, banks]);

  const saveBank = async (
    bank: BankAnalysisInstance,
  ): Promise<"saved" | "failed" | "skipped"> => {
    if (!applicationId) {
      console.error("Cannot save bank analysis without applicationId");
      return "failed";
    }

    if (saveBankInFlightRef.current.has(bank.id)) {
      return "skipped";
    }
    saveBankInFlightRef.current.add(bank.id);

    // Only persist rows that have at least one meaningful value
    const nonEmptyRows = bank.rows.filter((row) => hasAnyValue(row));

    const rowsPayload = nonEmptyRows.map((row) => ({
      // include identifiers so backend can update existing rows instead of duplicating
      _id: row.rowBackendId,
      id: row.rowBackendId,
      monthLabel: row.month,
      monthDate: new Date().toISOString(),
      totalCredit: parseCurrency(row.totalCredit),
      loanTransfer: parseCurrency(row.loanTransfer),
      deposit: parseCurrency(row.deposit),
      other: parseCurrency(row.other),
      nsfNegDays: parseCurrency(row.nsfNegDays),
      lowBlcDays: parseCurrency(row.lowBlcDays),
      avgDailyBlc: parseCurrency(row.avgDailyBlc),
    }));

    try {
      let resp;
      if (bank.backendId) {
        resp = await axiosPut(`/bank-analysis/${bank.backendId}`, {
          accountNumber: bank.accountNumber,
          rows: rowsPayload,
        });
      } else {
        resp = await axiosPost("/bank-analysis", {
          application: applicationId,
          accountNumber: bank.accountNumber,
          rows: rowsPayload,
        });
      }

      const payload = resp.data;
      const updated: BankAnalysis = payload?.data ?? payload;
      const updatedRows = updated?.rows ?? [];

      setBanks((prev) =>
        prev.map((b) => {
          if (b.id !== bank.id) return b;
          const rowsWithIds = b.rows.map((r) => {
            const fromApi = updatedRows.find(
              (ur: any) =>
                ur?.monthLabel === r.month ||
                ur?._id === r.rowBackendId ||
                ur?.id === r.rowBackendId,
            ) as { _id?: string; id?: string } | undefined;
            const rowBackendId = fromApi?._id ?? fromApi?.id ?? r.rowBackendId;
            return formatMoneyRowDisplay({
              ...r,
              rowBackendId: rowBackendId ?? r.rowBackendId,
              isLocked: hasAnyValue(r),
            });
          });
          return {
            ...b,
            backendId: updated._id,
            accountNumber: updated.accountNumber || b.accountNumber,
            rows: sortMonthlyRowsByMonthDesc(rowsWithIds),
          };
        }),
      );
      return "saved";
    } catch (error) {
      console.error("Failed to save bank analysis", error);
      toast.error("Failed to save bank analysis. Please try again.");
      return "failed";
    } finally {
      saveBankInFlightRef.current.delete(bank.id);
    }
  };

  const handleBulkSaveBank = async (bank: BankAnalysisInstance) => {
    setBulkSavingBankId(bank.id);
    try {
      const result = await saveBank(bank);
      if (result === "saved") {
        toast.success("Bank analysis saved.");
      }
    } finally {
      setBulkSavingBankId(null);
    }
  };

  const bankNeedsPersist = (bank: BankAnalysisInstance): boolean =>
    Boolean(bank.accountNumber?.trim()) ||
    bank.rows.some((row) => hasAnyValue(row));

  /**
   * Persist every bank card (account number + month rows) in one pass.
   * Registered with the parent for Offer "Approve & Save".
   */
  const saveAll = useCallback(async (): Promise<boolean> => {
    if (!applicationId) return true;
    let allOk = true;
    for (const bank of banks) {
      if (!bankNeedsPersist(bank)) continue;
      const result = await saveBank(bank);
      if (result === "failed") {
        allOk = false;
      } else if (result === "saved") {
        setBanks((prev) =>
          prev.map((b) =>
            b.id === bank.id
              ? {
                  ...b,
                  accountHeaderLocked: Boolean(bank.accountNumber?.trim()),
                }
              : b,
          ),
        );
      }
    }
    return allOk;
  }, [applicationId, banks]);

  useEffect(() => {
    onRegisterSaveAll?.(saveAll);
  }, [onRegisterSaveAll, saveAll]);

  /** Persist account number only. Backend update skips rows when `rows` is omitted, so row edits stay local until full save. */
  const saveAccountHeaderOnly = async (
    bank: BankAnalysisInstance,
  ): Promise<"saved" | "failed"> => {
    if (!applicationId) {
      console.error("Cannot save bank analysis without applicationId");
      return "failed";
    }
    if (saveBankInFlightRef.current.has(bank.id)) {
      return "failed";
    }
    saveBankInFlightRef.current.add(bank.id);

    try {
      let resp;
      if (bank.backendId) {
        resp = await axiosPut(`/bank-analysis/${bank.backendId}`, {
          accountNumber: bank.accountNumber,
        });
      } else {
        resp = await axiosPost("/bank-analysis", {
          application: applicationId,
          accountNumber: bank.accountNumber,
        });
      }

      const payload = resp.data;
      const updated: BankAnalysis = payload?.data ?? payload;

      setBanks((prev) =>
        prev.map((b) => {
          if (b.id !== bank.id) return b;
          return {
            ...b,
            backendId: updated._id ?? b.backendId,
            accountNumber: updated.accountNumber || b.accountNumber,
          };
        }),
      );
      return "saved";
    } catch (error) {
      console.error("Failed to save account header", error);
      toast.error("Failed to save account number. Please try again.");
      return "failed";
    } finally {
      saveBankInFlightRef.current.delete(bank.id);
    }
  };

  return (
    <div className="w-full space-y-4">
      {!showOnlyTotals && banks.map((bank, bankIndex) => (
        <div
          key={bank.id}
          className="w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm dark:border-slate-700 dark:bg-[#141517]"
        >
          {/* Header Section — single horizontal toolbar */}
          <div className="flex items-center gap-3 overflow-x-auto bg-[#D9E9F6] px-5 py-3 dark:bg-[#2A2B2F] [scrollbar-width:thin]">
            <h2 className="shrink-0 text-lg font-bold uppercase tracking-wide text-[#334155] dark:text-slate-100">
              Bank Analysis {bankIndex + 1}
            </h2>

            <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-2">
              {!isReadOnly && bank.rows.length > 0 && (
                <>
                  {deferToolbarSave ? (
                    bank.rows.every((r) => r.isLocked) ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-slate-300 px-3 text-xs font-medium dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        disabled={
                          isInitialLoading ||
                          bulkSavingBankId === bank.id ||
                          deletingBankId === bank.id ||
                          savingHeaderBankId === bank.id
                        }
                        onClick={() => handleUnlockAllBankRows(bank.id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit rows
                      </Button>
                    ) : null
                  ) : bank.rows.every((r) => r.isLocked) ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-slate-300 px-3 text-xs font-medium dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      disabled={
                        isInitialLoading ||
                        bulkSavingBankId === bank.id ||
                        deletingBankId === bank.id ||
                        savingHeaderBankId === bank.id
                      }
                      onClick={() => handleUnlockAllBankRows(bank.id)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit rows
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-xs font-medium text-white hover:bg-[var(--brand-hover)]"
                      disabled={
                        isInitialLoading ||
                        bulkSavingBankId === bank.id ||
                        deletingBankId === bank.id ||
                        savingHeaderBankId === bank.id
                      }
                      onClick={() => void handleBulkSaveBank(bank)}
                    >
                      {bulkSavingBankId === bank.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {bulkSavingBankId === bank.id ? "Saving…" : "Save rows"}
                    </Button>
                  )}
                  <span
                    className="mx-1 hidden h-6 w-px shrink-0 bg-slate-300/80 dark:bg-slate-600/80 sm:block"
                    aria-hidden
                  />
                </>
              )}

              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium uppercase tracking-wider text-[#556987] dark:text-slate-300">
                Account Number
              </span>
              <Input
                className={`h-9 w-36 shrink-0 rounded-md border border-[#E2E8F0] text-xs dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-400 ${
                  (!deferToolbarSave && bank.accountHeaderLocked) || isReadOnly
                    ? "bg-slate-50 dark:bg-slate-800/70"
                    : "bg-white dark:bg-slate-900"
                }`}
                placeholder={isInitialLoading ? "Loading..." : "Enter account number"}
                readOnly={
                  isReadOnly || (!deferToolbarSave && !!bank.accountHeaderLocked)
                }
                value={bank.accountNumber}
                onChange={(e) =>
                  handleAccountChange(bank.id, e.target.value)
                }
              />
              {!isReadOnly && !deferToolbarSave && bank.accountHeaderLocked ? (
                <>
                  <span
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/40 dark:text-emerald-300"
                    aria-live="polite"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    Saved
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0 cursor-pointer border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    aria-label="Edit account number"
                    onClick={() =>
                      setBanks((prev) =>
                        prev.map((b) =>
                          b.id === bank.id
                            ? { ...b, accountHeaderLocked: false }
                            : b,
                        ),
                      )
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : !isReadOnly && !deferToolbarSave ? (
                <Button
                  type="button"
                  className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-xs font-medium text-white hover:bg-[var(--brand-hover)]"
                  disabled={isInitialLoading || savingHeaderBankId === bank.id}
                  onClick={async () => {
                    setSavingHeaderBankId(bank.id);
                    try {
                      const result = await saveAccountHeaderOnly(bank);
                      if (result === "saved") {
                        toast.success("Account number saved.");
                        setBanks((prev) =>
                          prev.map((b) =>
                            b.id === bank.id
                              ? { ...b, accountHeaderLocked: true }
                              : b,
                          ),
                        );
                      } else if (result === "failed") {
                        toast.error("Failed to save account number.");
                      }
                    } finally {
                      if (!saveBankInFlightRef.current.has(bank.id)) {
                        setSavingHeaderBankId(null);
                      }
                    }
                  }}
                >
                  {savingHeaderBankId === bank.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {savingHeaderBankId === bank.id ? "Saving…" : "Save"}
                </Button>
              ) : null}

              {!isReadOnly && (
                <>
                  <span
                    className="mx-1 hidden h-6 w-px shrink-0 bg-slate-300/80 dark:bg-slate-600/80 sm:block"
                    aria-hidden
                  />
                  {!isCreateDisabled && bankIndex === 0 && (
                    <Button
                      type="button"
                      className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-xs font-medium text-white hover:bg-[var(--brand-hover)]"
                      disabled={isInitialLoading}
                      onClick={handleAddBank}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Bank
                    </Button>
                  )}
                  {!isDeleteDisabled && (
                    <Button
                      variant="outline"
                      type="button"
                      className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800/50 dark:text-red-400 dark:hover:bg-red-900/20"
                      disabled={isInitialLoading || deletingBankId === bank.id}
                      onClick={() => handleDeleteBank(bank.id)}
                    >
                      {deletingBankId === bank.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      {deletingBankId === bank.id ? "Deleting…" : "Delete"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Table Section */}
          <div
            className={`overflow-x-auto rounded-b-xl${!isReadOnly && isCreateDisabled ? " pb-3" : ""}`}
          >
            <table className="w-full min-w-[1100px] text-left border-separate border-spacing-0 text-[11px]">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-slate-50 text-[12px] font-semibold uppercase tracking-wide text-[#475569] dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
                  <th className="px-4 py-3 min-w-[140px]">Month</th>
                  <th className="px-4 py-3 text-left min-w-[140px]">Total Credit</th>
                  <th className="px-4 py-3 text-left min-w-[140px]">Funding Amt</th>
                  <th className="px-4 py-3 text-left min-w-[140px]">Transfers & other deductions</th>
                  <th className="px-4 py-3 text-left min-w-[140px]">Unverified Deposit</th>
                  <th className="px-4 py-3 text-left min-w-[140px]">Net Credit</th>
                  <th className="px-4 py-3 text-left min-w-[140px]">NSF/Neg Days</th>
                  <th className="px-4 py-3 text-left min-w-[140px]">Low Blc. Days</th>
                  <th className="px-4 py-3 text-left min-w-[140px]">Avg Daily Blc</th>
                  {!isReadOnly && !isDeleteDisabled && (
                    <th className="px-2 py-3 text-center w-[56px] min-w-[56px]">Delete</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(() => {
                  const ordered = baseMonths.map((month) => {
                    const idx = bank.rows.findIndex((r) => r.month === month);
                    if (idx === -1) return null;
                    return { row: bank.rows[idx], rowIndex: idx };
                  }).filter((x): x is { row: MonthlyData; rowIndex: number } => x !== null);

                  // Fallback: if for some reason baseMonths don't cover this bank, use its own order
                  const rowsToRender = ordered.length > 0
                    ? ordered
                    : bank.rows.map((row, idx) => ({ row, rowIndex: idx }));

                  return rowsToRender.map(({ row, rowIndex }, displayIndex) => {
                    const rowLocked = !!row.isLocked || isReadOnly;
                    const rowBusy =
                      deletingRow?.bankId === bank.id &&
                      deletingRow?.rowIndex === rowIndex;
                    const cellLockedClass = rowLocked
                      ? "bg-slate-50 pointer-events-none cursor-not-allowed select-none dark:bg-slate-800/80 dark:text-slate-400"
                      : "bg-white dark:bg-slate-900 dark:text-slate-100";
                    const currentNetCredit = calculateNetCredit(row, bank.id);
                    const nextEntry = rowsToRender[displayIndex + 1];
                    const previousNetCredit = nextEntry
                      ? calculateNetCredit(nextEntry.row, bank.id)
                      : null;
                    const diff =
                      previousNetCredit != null
                        ? currentNetCredit - previousNetCredit
                        : 0;
                    const trend =
                      displayIndex === rowsToRender.length - 1 || diff === 0
                        ? "none"
                        : diff > 0
                          ? "up"
                          : "down";

                    return (
                      <tr
                        key={row.month + rowIndex}
                        className={`${displayIndex % 2 === 0 ? "bg-white dark:bg-[#141517]" : "bg-slate-50/40 dark:bg-slate-900/35"} ${rowLocked ? "" : "hover:bg-sky-50/50 dark:hover:bg-slate-800/70"} transition-colors`}
                      >
                        <td className="min-w-[140px] whitespace-nowrap px-4 py-2 text-[12px] font-medium text-slate-700 dark:text-slate-200">
                          {row.month}
                        </td>

                        {/* Input fields with icons like the image */}
                        <td className="px-2 py-2 min-w-[140px]">
                          {rowLocked ? (
                            <div className="flex h-9 w-full items-center px-3 text-[13px] text-slate-700 dark:text-slate-200">
                              {isInitialLoading
                                ? "Loading..."
                                : hasEnteredNumericValue(row.totalCredit)
                                  ? `$ ${row.totalCredit}`
                                  : "-"}
                            </div>
                          ) : (
                            <div className="relative w-full">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500">
                                $
                              </span>
                              <Input
                                className={`h-9 w-full border-slate-200 pl-6 text-left text-[13px] focus-visible:ring-1 focus-visible:ring-sky-400 dark:border-slate-700 dark:placeholder:text-slate-500 ${cellLockedClass}`}
                                placeholder={isInitialLoading ? "Loading..." : "Credits"}
                                readOnly={rowLocked}
                                tabIndex={rowLocked ? -1 : undefined}
                                value={row.totalCredit}
                                onChange={(e) =>
                                  handleRowChange(
                                    bank.id,
                                    rowIndex,
                                    "totalCredit",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 min-w-[140px]">
                          {(() => {
                            const allocated =
                              loanTransferAllocatedByBankAndMonth[
                                `${bank.id}|${toYearMonthFromLabel(row.month)}`
                              ] || 0;
                            const baseLoan = parseCurrency(row.loanTransfer);
                            const displayLoan = baseLoan + allocated;
                            const lockedDisplayValue =
                              allocated > 0
                                ? formatNumberUS(displayLoan)
                                : hasEnteredNumericValue(row.loanTransfer)
                                  ? row.loanTransfer
                                  : "";

                            if (rowLocked) {
                              const clickableForBreakdown = allocated > 0;
                              return (
                                <div
                                  className={`flex h-9 w-full items-center px-3 text-[13px] text-slate-700 dark:text-slate-200 ${
                                    clickableForBreakdown
                                      ? "cursor-pointer font-medium hover:underline"
                                      : ""
                                  }`}
                                  onClick={() => {
                                    if (!clickableForBreakdown) return;
                                    setFundingBreakdownModal({
                                      bankId: bank.id,
                                      rowIndex,
                                      month: row.month,
                                      allocated,
                                    });
                                  }}
                                >
                                  {isInitialLoading
                                    ? "Loading..."
                                    : lockedDisplayValue
                                      ? `$ ${lockedDisplayValue}`
                                      : "-"}
                                </div>
                              );
                            }

                            return (
                              <div className="relative w-full">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500">
                                  $
                                </span>
                                <Input
                                  className={`w-full pl-6 h-9 text-[13px] border-slate-200 text-left ${
                                    allocated > 0
                                      ? "cursor-pointer bg-slate-50 font-medium dark:bg-slate-800/70"
                                      : "bg-white dark:bg-slate-900"
                                  }`}
                                  placeholder={isInitialLoading ? "Loading..." : "Loan/Transfer"}
                                  value={allocated > 0 ? formatNumberUS(displayLoan) : row.loanTransfer}
                                  readOnly={allocated > 0}
                                  onClick={() => {
                                    if (allocated <= 0) return;
                                    setFundingBreakdownModal({
                                      bankId: bank.id,
                                      rowIndex,
                                      month: row.month,
                                      allocated,
                                    });
                                  }}
                                  onChange={(e) =>
                                    handleRowChange(
                                      bank.id,
                                      rowIndex,
                                      "loanTransfer",
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-2 min-w-[140px]">
                          {rowLocked ? (
                            <div className="flex h-9 w-full items-center px-3 text-[13px] text-slate-700 dark:text-slate-200">
                              {isInitialLoading
                                ? "Loading..."
                                : hasEnteredNumericValue(row.deposit)
                                  ? `$ ${row.deposit}`
                                  : "-"}
                            </div>
                          ) : (
                            <div className="relative w-full">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500">
                                $
                              </span>
                              <Input
                                className={`h-9 w-full border-slate-200 pl-6 text-left text-[13px] focus-visible:ring-1 focus-visible:ring-sky-400 dark:border-slate-700 dark:placeholder:text-slate-500 ${cellLockedClass}`}
                                placeholder={isInitialLoading ? "Loading..." : "Deposit"}
                                readOnly={rowLocked}
                                tabIndex={rowLocked ? -1 : undefined}
                                value={row.deposit}
                                onChange={(e) =>
                                  handleRowChange(
                                    bank.id,
                                    rowIndex,
                                    "deposit",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 min-w-[140px]">
                          {rowLocked ? (
                            <div className="flex h-9 w-full items-center px-3 text-[13px] text-slate-700 dark:text-slate-200">
                              {isInitialLoading
                                ? "Loading..."
                                : hasEnteredNumericValue(row.other)
                                  ? `$ ${row.other}`
                                  : "-"}
                            </div>
                          ) : (
                            <div className="relative w-full">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500">
                                $
                              </span>
                              <Input
                                className={`h-9 w-full border-slate-200 pl-6 text-left text-[13px] focus-visible:ring-1 focus-visible:ring-sky-400 dark:border-slate-700 dark:placeholder:text-slate-500 ${cellLockedClass}`}
                                placeholder={isInitialLoading ? "Loading..." : "Other amount"}
                                readOnly={rowLocked}
                                tabIndex={rowLocked ? -1 : undefined}
                                value={row.other}
                                onChange={(e) =>
                                  handleRowChange(
                                    bank.id,
                                    rowIndex,
                                    "other",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                          )}
                        </td>

                        {/* Net Credit (calculated) with trend arrow */}
                        <td className="px-2 py-2 text-left min-w-[140px]">
                          <div className="flex items-center justify-start gap-1 w-full">
                            <div
                              className={
                                rowLocked
                                  ? "flex h-9 w-full items-center justify-start px-3 text-[13px] text-slate-700 select-none dark:text-slate-200"
                                  : "flex h-9 w-full items-center justify-start rounded-md border border-slate-200 bg-slate-50 px-3 text-[13px] text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
                              }
                            >
                              {isInitialLoading ? "Loading..." : `$ ${formatNumberUS(currentNetCredit)}`}
                            </div>
                            {trend !== "none" && (
                              <span className="inline-flex items-center justify-center">
                                {trend === "up" ? (
                                  <ArrowUpRight className="h-3 w-3 text-emerald-500" />
                                ) : (
                                  <ArrowDownRight className="h-3 w-3 text-red-500" />
                                )}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-2 py-2 min-w-[140px]">
                          {rowLocked ? (
                            <div className="flex h-9 w-full items-center px-3 text-[13px] text-slate-700 dark:text-slate-200">
                              {isInitialLoading
                                ? "Loading..."
                                : hasEnteredNumericValue(row.nsfNegDays)
                                  ? row.nsfNegDays
                                  : "-"}
                            </div>
                          ) : (
                            <Input
                              className={`h-9 w-full border-slate-200 text-left text-[13px] focus-visible:ring-1 focus-visible:ring-sky-400 dark:border-slate-700 dark:placeholder:text-slate-500 ${cellLockedClass}`}
                              placeholder={isInitialLoading ? "Loading..." : "e.g. 0"}
                              readOnly={rowLocked}
                              tabIndex={rowLocked ? -1 : undefined}
                              value={row.nsfNegDays}
                              onChange={(e) =>
                                handleRowChange(
                                  bank.id,
                                  rowIndex,
                                  "nsfNegDays",
                                  e.target.value,
                                )
                              }
                            />
                          )}
                        </td>
                        <td className="px-2 py-2 min-w-[140px]">
                          {rowLocked ? (
                            <div className="flex h-9 w-full items-center px-3 text-[13px] text-slate-700 dark:text-slate-200">
                              {isInitialLoading
                                ? "Loading..."
                                : hasEnteredNumericValue(row.lowBlcDays)
                                  ? row.lowBlcDays
                                  : "-"}
                            </div>
                          ) : (
                            <Input
                              className={`h-9 w-full border-slate-200 text-left text-[13px] focus-visible:ring-1 focus-visible:ring-sky-400 dark:border-slate-700 dark:placeholder:text-slate-500 ${cellLockedClass}`}
                              placeholder={isInitialLoading ? "Loading..." : "e.g. 0"}
                              readOnly={rowLocked}
                              tabIndex={rowLocked ? -1 : undefined}
                              value={row.lowBlcDays}
                              onChange={(e) =>
                                handleRowChange(
                                  bank.id,
                                  rowIndex,
                                  "lowBlcDays",
                                  e.target.value,
                                )
                              }
                            />
                          )}
                        </td>
                        <td className="px-2 py-2 min-w-[140px]">
                          {rowLocked ? (
                            <div className="flex h-9 w-full items-center px-3 text-[13px] text-slate-700 dark:text-slate-200">
                              {isInitialLoading
                                ? "Loading..."
                                : hasEnteredNumericValue(row.avgDailyBlc)
                                  ? `$ ${row.avgDailyBlc}`
                                  : "-"}
                            </div>
                          ) : (
                            <div className="relative w-full">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 dark:text-slate-500">
                                $
                              </span>
                              <Input
                                className={`h-9 w-full border-slate-200 pl-6 text-left text-[13px] focus-visible:ring-1 focus-visible:ring-sky-400 dark:border-slate-700 dark:placeholder:text-slate-500 ${cellLockedClass}`}
                                readOnly={rowLocked}
                                tabIndex={rowLocked ? -1 : undefined}
                                value={row.avgDailyBlc}
                                placeholder={isInitialLoading ? "Loading..." : ""}
                                onChange={(e) =>
                                  handleRowChange(
                                    bank.id,
                                    rowIndex,
                                    "avgDailyBlc",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                          )}
                        </td>

                        {!isReadOnly && !isDeleteDisabled && (
                          <td className="w-[56px] min-w-[56px] px-2 py-2 text-center align-middle whitespace-nowrap">
                            <button
                              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-900/20"
                              type="button"
                              title="Delete row"
                              disabled={rowBusy || bulkSavingBankId === bank.id}
                              onClick={() => handleDeleteRow(bank.id, rowIndex)}
                            >
                              {deletingRow?.bankId === bank.id &&
                              deletingRow?.rowIndex === rowIndex ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 size={18} />
                              )}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  });
                })()}
              </tbody>
              {/* Footer Totals */}
              <tfoot className="bg-[#F8FAFC] dark:bg-slate-900/60">
                {(() => {
                  const isActiveNonMtdRow = (row: MonthlyData) => {
                    const monthLabel = normalizeMonthLabelKey(row.month);
                    if (!monthLabel || monthLabel.includes("mtd")) return false;
                    const allocated =
                      loanTransferAllocatedByBankAndMonth[
                        `${bank.id}|${toYearMonthFromLabel(row.month)}`
                      ] || 0;
                    const hasLoanFromPositions = allocated > 0;
                    return (
                      hasLoanFromPositions ||
                      hasEnteredNumericValue(row.totalCredit) ||
                      hasEnteredNumericValue(row.loanTransfer) ||
                      hasEnteredNumericValue(row.deposit) ||
                      hasEnteredNumericValue(row.other) ||
                      hasEnteredNumericValue(row.avgDailyBlc)
                    );
                  };
                  const R = bank.rows.filter(isActiveNonMtdRow);
                  const n = R.length;

                  const acc = {
                    totalCredit: { sum: 0, any: false },
                    loanTransfer: { sum: 0, any: false },
                    deposit: { sum: 0, any: false },
                    other: { sum: 0, any: false },
                    netCredit: { sum: 0, any: false },
                    nsfNegDays: { sum: 0, any: false },
                    lowBlcDays: { sum: 0, any: false },
                    avgDailyBlc: { sum: 0, any: false },
                  };

                  for (const row of R) {
                    const allocated =
                      loanTransferAllocatedByBankAndMonth[
                        `${bank.id}|${toYearMonthFromLabel(row.month)}`
                      ] || 0;
                    const displayLoan = parseCurrency(row.loanTransfer) + allocated;
                    const ncRow = calculateNetCredit(row, bank.id);

                    if (hasEnteredNumericValue(row.totalCredit)) acc.totalCredit.any = true;
                    acc.totalCredit.sum += parseCurrency(row.totalCredit);

                    if (hasEnteredNumericValue(row.loanTransfer) || allocated > 0) {
                      acc.loanTransfer.any = true;
                    }
                    acc.loanTransfer.sum += displayLoan;

                    if (hasEnteredNumericValue(row.deposit)) acc.deposit.any = true;
                    acc.deposit.sum += parseCurrency(row.deposit);

                    if (hasEnteredNumericValue(row.other)) acc.other.any = true;
                    acc.other.sum += parseCurrency(row.other);

                    const netHas =
                      hasEnteredNumericValue(row.totalCredit) ||
                      hasEnteredNumericValue(row.loanTransfer) ||
                      allocated > 0 ||
                      hasEnteredNumericValue(row.deposit) ||
                      hasEnteredNumericValue(row.other);
                    if (netHas) acc.netCredit.any = true;
                    acc.netCredit.sum += ncRow;

                    if (hasEnteredNumericValue(row.nsfNegDays)) acc.nsfNegDays.any = true;
                    acc.nsfNegDays.sum += parseCurrency(row.nsfNegDays);

                    if (hasEnteredNumericValue(row.lowBlcDays)) acc.lowBlcDays.any = true;
                    acc.lowBlcDays.sum += parseCurrency(row.lowBlcDays);

                    let adv = parseCurrency(row.avgDailyBlc);
                    if (!hasEnteredNumericValue(row.avgDailyBlc)) {
                      adv = ncRow > 0 ? ncRow / 30 : 0;
                    }
                    if (hasEnteredNumericValue(row.avgDailyBlc) || ncRow > 0) {
                      acc.avgDailyBlc.any = true;
                    }
                    acc.avgDailyBlc.sum += adv;
                  }

                  const finish = (x: { sum: number; any: boolean }) =>
                    n > 0 && x.any ? x.sum / n : null;

                  const totalCreditAvg = finish(acc.totalCredit);
                  const loanAvg = finish(acc.loanTransfer);
                  const depositAvg = finish(acc.deposit);
                  const otherAvg = finish(acc.other);
                  const netAvg = finish(acc.netCredit);
                  const nsfAvg = finish(acc.nsfNegDays);
                  const lowAvg = finish(acc.lowBlcDays);
                  let avgDailyAvg = finish(acc.avgDailyBlc);
                  if (
                    (avgDailyAvg === null || Number.isNaN(avgDailyAvg)) &&
                    netAvg !== null &&
                    netAvg > 0
                  ) {
                    avgDailyAvg = netAvg / 30;
                  }

                  const hasData = n > 0;

                  return (
                    <tr className="bg-slate-100/80 text-sm font-semibold text-slate-800 dark:bg-slate-800/80 dark:text-slate-100">
                      <BankAnalysisAverageFooterLabelCell />
                      <td className="px-4 py-3 text-left">
                        {isInitialLoading
                          ? "Loading..."
                          : hasData && totalCreditAvg !== null
                          ? `$ ${formatNumberUS(totalCreditAvg)}`
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-left">
                        {isInitialLoading
                          ? "Loading..."
                          : hasData && loanAvg !== null
                            ? `$ ${formatNumberUS(loanAvg)}`
                            : "-"}
                      </td>
                      <td className="px-4 py-3 text-left">
                        {isInitialLoading
                          ? "Loading..."
                          : hasData && depositAvg !== null
                          ? `$ ${formatNumberUS(depositAvg)}`
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-left">
                        {isInitialLoading
                          ? "Loading..."
                          : hasData && otherAvg !== null
                            ? `$ ${formatNumberUS(otherAvg)}`
                            : "-"}
                      </td>
                      <td className="px-4 py-3 text-left">
                        {isInitialLoading
                          ? "Loading..."
                          : hasData && netAvg !== null
                            ? `$ ${formatNumberUS(netAvg)}`
                            : "-"}
                      </td>
                      <td className="px-4 py-3 text-left">
                        {isInitialLoading
                          ? "Loading..."
                          : hasData && nsfAvg !== null
                            ? Math.round(nsfAvg)
                            : "-"}
                      </td>
                      <td className="px-4 py-3 text-left">
                        {isInitialLoading
                          ? "Loading..."
                          : hasData && lowAvg !== null
                            ? Math.round(lowAvg)
                            : "-"}
                      </td>
                      <td className="px-4 py-3 text-left">
                        {isInitialLoading
                          ? "Loading..."
                          : hasData && avgDailyAvg !== null
                          ? `$ ${formatNumberUS(avgDailyAvg)}`
                          : "-"}
                      </td>
                      {!isReadOnly && !isDeleteDisabled && <td></td>}
                    </tr>
                  );
                })()}
              </tfoot>
            </table>
          </div>
          {!isReadOnly && !isCreateDisabled && (
          <div className="flex justify-end border-t border-slate-200 bg-[#F9FAFB] px-4 py-2 dark:border-slate-700 dark:bg-slate-900/70">
            <Button
              type="button"
              variant="outline"
              className="h-8 px-3 text-[11px] flex items-center gap-1 cursor-pointer"
              onClick={() => handleAddMonth(bank.id)}
            >
              <Plus className="h-3 w-3" />
              Add Month
            </Button>
          </div>
          )}
        </div>
      ))}

      <BankTotalTable rows={bankTotalTablePayload.rows} average={bankTotalTablePayload.average} />
      {fundingBreakdownModal && selectedBreakdownRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => {
            setFundingBreakdownModal(null);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-[#141517]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span>Funding Breakdown</span>
              <span>{fundingBreakdownModal.month}</span>
            </div>
            <div className="flex items-center justify-between py-1 text-sm text-slate-700 dark:text-slate-200">
              <span>Manual Loan</span>
              <span className="font-medium">
                $ {formatNumberUS(parseCurrency(selectedBreakdownRow.row.loanTransfer))}
              </span>
            </div>
            <div className="mt-2">
              <Input
                className="h-9 border-slate-200 bg-white text-left text-sm focus-visible:ring-1 focus-visible:ring-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                value={selectedBreakdownRow.row.loanTransfer}
                placeholder="Edit manual loan"
                onChange={(e) =>
                  handleRowChange(
                    fundingBreakdownModal.bankId,
                    fundingBreakdownModal.rowIndex,
                    "loanTransfer",
                    e.target.value,
                  )
                }
              />
            </div>
            <div className="mt-2 flex items-center justify-between py-1 text-sm text-emerald-700 dark:text-emerald-400">
              <span>From Positions</span>
              <span className="font-medium">$ {formatNumberUS(fundingBreakdownModal.allocated)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
              <span>Total</span>
              <span>
                $ {formatNumberUS(parseCurrency(selectedBreakdownRow.row.loanTransfer) + fundingBreakdownModal.allocated)}
              </span>
            </div>
            <div className="mt-4 flex  justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-8 px-3  cursor-pointer text-xs"
                onClick={() => {
                  setFundingBreakdownModal(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BankAnalysisTable;