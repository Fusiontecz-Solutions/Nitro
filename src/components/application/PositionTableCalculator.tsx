import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import { Check, Trash2, Pencil, Loader2 } from "lucide-react";
import type { AppDispatch, RootState } from "@/redux/store";
import { createPosition, getPositions, updatePosition, deletePosition } from "@/redux/actions/positionActions";
import { POSITIONS_CACHE_TTL_MS } from "@/redux/slices/positionSlice";
import type { CreatePositionPayload, UpdatePositionPayload } from "@/types/positionTypes";
import { toast } from "react-toastify";
import {
  formatNumberUS,
  formatNumberUSForInput,
  formatPercentUS,
  normalizeApiDateToYyyyMmDd,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface IPosition {
  /** Optional backend ID when saved to the API. */
  _id?: string;
  lender?: string;
  frequency?: string;
  installment?: string;
  status?: string;
  monthlyMcaPmts?: string;
  startingDate?: string;
  amountFunded?: string;
  loanAmount?: string;
  paymentTerm?: string;
  mcaEstBalance?: string;
  totalRepayments?: string;
  mcaPercentPaid?: string;
  pmtsLeft?: string;
  estEndDate?: string;
  lastPaymentDate?: string;
  mcaRemit?: string;
  isLocked?: boolean;
  /** Optional carry-forward amount from earlier same-lender deals (CF). */
  carryForward?: string;
  /** When true, EST. Lvg (mcaRemit) is not overwritten by auto-calculation. */
  _manual_mcaRemit?: boolean;
  /** When true, Monthly MCA Pmts is user-entered and used as remit numerator (not overwritten by auto). */
  _manual_monthlyMcaPmts?: boolean;
  /** When true, payment term is user-entered and should not be auto-overwritten. */
  _manual_paymentTerm?: boolean;
  /** 1-based Bank Analysis index used for funding allocation. */
  allocatedBankAnalysisId?: number;
}

interface PositionTableMetrics {
  activeCount: number;
  existingRemit: number;
  totalMonthlyFromPositions: number;
  totalDailyFromPositions: number;
}

interface PositionsTableProps {
  positions?: IPosition[];
  frequencyOptions?: string[];
  statusOptions?: string[];
  /** Bank Total average net credit (same as Bank Analysis AVERAGE row); number or formatted string. */
  avgBankNetCredit?: number | string;
  /** Current application MongoDB ObjectId used when saving positions. */
  applicationId?: string;
  /** Optional callback to expose stack-level metrics derived from the table. */
  onMetricsChange?: (metrics: PositionTableMetrics) => void;
  /** When true, the table becomes read-only (no create/update/delete/lock actions). */
  readOnly?: boolean;
  /** When true, edits are still allowed but row removal (Trash) is hidden/disabled. */
  disableDelete?: boolean;
  /** When true, hide "Create Position" (no adding rows via UI). */
  disableCreate?: boolean;
  bankAllocationOptions?: Array<{ id: number; label: string }>;
  onRowsChange?: (rows: IPosition[]) => void;
  /**
   * Hide the per-row "save & lock" (check) control. Used when an external
   * action (e.g. Offer "Approve & Save") persists every row at once.
   */
  hideRowSave?: boolean;
  /**
   * Parent receives the bulk-save function so it can persist all rows from
   * Offer "Approve & Save" without per-row save buttons.
   */
  onRegisterSaveAll?: (saveAll: () => Promise<boolean>) => void;
  /** When true, debounce-save unlocked rows after edits (Scrubbing tab). */
  autoSave?: boolean;
  /** Debounce delay for {@link autoSave} (ms). */
  autoSaveDelayMs?: number;
}

const ACTIVE_STATUSES = ["ACTIVE", "REFI", "PIF", "REVERSE"] as const;
const ACTIVE_COUNT_NUMERIC_KEYS: (keyof IPosition)[] = [
  "amountFunded",
  "installment",
  "paymentTerm",
  "totalRepayments",
  "monthlyMcaPmts",
  "mcaEstBalance",
  "mcaPercentPaid",
  "pmtsLeft",
  "mcaRemit",
  "loanAmount",
];
const TOTALS_DATA_KEYS: (keyof IPosition)[] = [
  "installment",
  "totalRepayments",
  "amountFunded",
  "monthlyMcaPmts",
  "mcaRemit",
];

/** Single empty row shown before data loads or when an application has no saved positions; use "Create Position" for more. */
const DEFAULT_PLACEHOLDER_ROW_COUNT = 1;
const createPlaceholderRows = (): IPosition[] =>
  Array.from({ length: DEFAULT_PLACEHOLDER_ROW_COUNT }, () => ({}));

/** Read-only snapshot cells: plain text like Bank Total / footer row (no input borders). */
function formatRoCurrency(raw: unknown): string {
  if (raw == null) return "-";
  const s = String(raw).trim();
  if (s === "") return "-";
  const n = parseNum(raw);
  if (Number.isNaN(n)) return "-";
  return `$ ${formatNumberUS(n)}`;
}

function formatRoInteger(raw: unknown): string {
  if (raw == null) return "-";
  const s = String(raw).trim();
  if (s === "") return "-";
  const n = parseNum(raw);
  if (Number.isNaN(n)) return "-";
  return String(Math.round(n));
}

function parseNum(str: unknown): number {
  if (str == null || String(str).trim() === "") return NaN;
  const cleaned = String(str).replace(/[^0-9.-]+/g, "");
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Commit display for currency inputs: always two fraction digits (matches read-only cells). */
function formatMoneyInputCommit(raw: unknown): string {
  const n = parseNum(raw);
  if (Number.isNaN(n)) return raw != null ? String(raw).trim() : "";
  return formatNumberUS(n);
}

/** Bank Total avg net credit (denominator for EST. Lvg); strips grouping/currency like page.js. */
function parseAvgNetCredit(avg: unknown): number {
  if (avg == null || avg === "") return NaN;
  const n = Number(String(avg).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** Same payload as parent `onRowsChange` — used to skip redundant state updates. */
function buildRowsEmitSignature(rows: IPosition[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      _id: r._id || "",
      lender: r.lender || "",
      frequency: r.frequency || "",
      installment: r.installment || "",
      status: r.status || "",
      monthlyMcaPmts: r.monthlyMcaPmts || "",
      startingDate: r.startingDate || "",
      amountFunded: r.amountFunded || "",
      loanAmount: r.loanAmount || "",
      paymentTerm: r.paymentTerm || "",
      mcaEstBalance: r.mcaEstBalance || "",
      totalRepayments: r.totalRepayments || "",
      mcaPercentPaid: r.mcaPercentPaid || "",
      pmtsLeft: r.pmtsLeft || "",
      estEndDate: r.estEndDate || "",
      lastPaymentDate: r.lastPaymentDate || "",
      mcaRemit: r.mcaRemit || "",
      carryForward: r.carryForward || "",
      allocatedBankAnalysisId: r.allocatedBankAnalysisId ?? null,
      isLocked: !!r.isLocked,
    })),
  );
}

/** True when a row has any user-entered data (so empty placeholder rows are skipped on bulk save). */
function rowHasMeaningfulData(row: IPosition | undefined | null): boolean {
  if (!row) return false;
  const valueKeys: (keyof IPosition)[] = [
    "lender",
    "installment",
    "amountFunded",
    "totalRepayments",
    "monthlyMcaPmts",
    "mcaRemit",
    "loanAmount",
    "paymentTerm",
    "startingDate",
  ];
  for (const key of valueKeys) {
    const v = row[key];
    if (v != null && String(v).trim() !== "") return true;
  }
  const status = String(row.status || "").trim().toUpperCase();
  if (status && status !== "SELECT") return true;
  const frequency = String(row.frequency || "").trim();
  if (frequency && frequency !== "Select") return true;
  return false;
}

/**
 * Monthly MCA $ for EST. Lvg: non-empty Monthly Pmts cell that parses and is ≥ 0 wins; else installment × frequency multiplier.
 */
function getMonthlyMcaPmtsForRemit(row: IPosition): number {
  const trimmed =
    row.monthlyMcaPmts != null ? String(row.monthlyMcaPmts).trim() : "";
  if (trimmed !== "") {
    const p = parseNum(row.monthlyMcaPmts);
    if (!Number.isNaN(p) && p >= 0) return p;
  }
  const inst = parseNum(row.installment);
  const ppm = getPaymentsPerMonth(row.frequency);
  if (!Number.isNaN(inst) && inst > 0 && ppm > 0) return inst * ppm;
  return NaN;
}

/** Allow only digits, one decimal point, optional leading minus (so typing "123.45" or "123." works) */
function sanitizeDecimalInput(str: unknown): string {
  if (str == null) return "";
  let s = String(str).replace(/[^0-9.-]/g, "");
  const parts = s.split(".");
  if (parts.length > 2) s = parts[0] + "." + parts.slice(1).join("");
  if (s.indexOf("-", 1) !== -1) s = s.replace(/-/g, "");
  return s;
}

/** Canonical frequency label for dropdown + API (handles legacy "Bi-weekly" casing). */
function normalizeFrequencyOption(freq?: string): string {
  const f = (freq || "").trim();
  if (!f || f === "Select") return "";
  const key = f.toLowerCase().replace(/\s+/g, "");
  if (key === "daily") return "Daily";
  if (key === "weekly") return "Weekly";
  if (key === "bi-weekly" || key === "biweekly") return "Bi-Weekly";
  if (key === "monthly") return "Monthly";
  return f;
}

/** FREQUENCY_MULTIPLIER: payments per month (Daily=22, Weekly=4.2, Bi-weekly=2, Monthly=1). */
function getPaymentsPerMonth(freq?: string): number {
  const f = (freq || "").toLowerCase().replace(/\s+/g, "");
  if (f === "daily") return 22;
  if (f === "weekly") return 4.2;
  if (f === "bi-weekly" || f === "biweekly") return 2;
  if (f === "monthly") return 1;
  return 0;
}

/** Days per payment period for end-date calculation. */
function getDaysPerPayment(freq?: string): number {
  const f = (freq || "").toLowerCase().replace(/\s+/g, "");
  if (f === "daily") return 1;
  if (f === "weekly") return 7;
  if (f === "bi-weekly" || f === "biweekly" || f === "biweekly") return 14;
  if (f === "monthly") return 0; // handled separately (calendar months)
  return 0;
}

/** Estimated end date: DAILY = +term days, WEEKLY = +term*7 days, BIWEEKLY = +term*14 days, MONTHLY = +term months. */
function computeEstEndDate(
  startDateStr?: string,
  paymentTermStr?: string,
  freq?: string,
): string {
  const isoStart = toDateInputValue(startDateStr || "");
  if (!isoStart) return "";

  const term = parseNum(paymentTermStr);
  if (Number.isNaN(term) || term <= 0) return "";

  const start = new Date(isoStart + "T00:00:00");
  if (Number.isNaN(start.getTime())) return "";

  const f = (freq || "").toLowerCase().replace(/\s+/g, "");
  let end: Date;

  if (f === "monthly") {
    end = new Date(start);
    end.setMonth(end.getMonth() + Math.round(term));
  } else {
    const daysPerPayment = getDaysPerPayment(freq);
    if (!daysPerPayment) return "";
    const totalDays = Math.round(term) * daysPerPayment;
    end = new Date(start.getTime() + totalDays * 24 * 60 * 60 * 1000);
  }

  const yyyy = end.getFullYear();
  const mm = String(end.getMonth() + 1).padStart(2, "0");
  const dd = String(end.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Alias for API/close-date usage. */
function computeCloseDate(
  startDateStr?: string,
  paymentTermStr?: string,
  freq?: string,
): string {
  return computeEstEndDate(startDateStr, paymentTermStr, freq);
}

/** Result of MCA calculations for one row (all computed from obligation + date-based Pmts Made). */
interface MCAValues {
  loanAmount: string;
  totalRepayments: string; // obligation = Amount Funded × 1.49
  monthlyMcaPmts: string;
  mcaEstBalance: string;
  pmtsLeft: string;
  mcaPercentPaid: string;
  estEndDate: string;
}

/*
 * ─── Column calculations (Position table) ─────────────────────────────────────
 *
 * 1) TOTAL REPAYMENTS = Total obligation = Amount Funded × 1.49 (computed, read-only).
 * 2) EST. BALANCE = Obligation − (Repayment × Pmts Made); Pmts Made from Start Date to effective end (today or next same-lender PIF/REFI) by frequency.
 * 3) EST. PMTS TERM = round(Total Obligation ÷ Repayment). Obligation = Amount Funded × 1.49 [ + carry for PIF/REFI ]. Repayment = 0 or missing → don't compute. Amount Funded = 0 → term = 0. Status = SELECT → no auto.
 * 4) EST. PMTS LEFT = max(0, EST. PMTS TERM − Pmts Made). Pmts Made = periods from Start to Effective End (ACTIVE/REFI/REVERSE: today; PIF: next same-lender PIF/REFI start or today). Daily = weekdays; Weekly = floor(days/7); Bi-weekly = floor(days/14); Monthly = calendar months.
 * 5) EST. MCA % PAID = (Amount paid to date / Obligation) × 100; Amount paid to date = Repayment × Pmts Made.
 * 6) EST. Lvg: auto from Monthly Pmts / Avg Net Credit; PIF: "-".
 */

/** Obligation = Amount Funded × 1.49. */
function getObligation(row: IPosition): number {
  const af = parseNum(row.amountFunded);
  if (Number.isNaN(af) || af < 0) return NaN;
  return af * 1.49;
}

/** EST. BALANCE = Obligation − (Repayment × Pmts Made); Pmts Made from date math. Used when context (allRows, index) available. */
function computedEstBalanceWithPmtsMade(
  obligation: number,
  installment: number,
  pmtsMade: number,
): number {
  if (Number.isNaN(obligation) || obligation < 0) return NaN;
  const amountPaidToDate = installment * pmtsMade;
  const balance = obligation - amountPaidToDate;
  return balance < 0 ? 0 : balance;
}

/** EST. BALANCE fallback (no date context): obligation − 0 = obligation, capped at 0. */
function computedEstBalance(row: IPosition): number {
  const obligation = getObligation(row);
  if (Number.isNaN(obligation)) return NaN;
  return obligation >= 0 ? obligation : 0;
}

/** EST. PMTS LEFT = max(0, EST. PMTS TERM − Pmts Made). Used when we have date-based pmtsMade. */
function computedPmtsLeftFromTermAndMade(term: number, pmtsMade: number): number {
  if (Number.isNaN(term) || term < 0) return NaN;
  const left = Math.round(term) - pmtsMade;
  return left < 0 ? 0 : left;
}

/** EST. PMTS LEFT fallback (ratio-based when no date context). */
function computedPmtsLeft(row: IPosition): number {
  const paymentTerm = parseNum(row.paymentTerm);
  const installment = parseNum(row.installment);
  if (Number.isNaN(paymentTerm) || paymentTerm < 0) return NaN;
  if (Number.isNaN(installment) || installment <= 0) return Math.round(paymentTerm);
  const obligation = getObligation(row);
  if (Number.isNaN(obligation)) return Math.round(paymentTerm);
  const term = Math.round(obligation / installment);
  const totalRepayments = parseNum(row.totalRepayments);
  const repaid = Number.isNaN(totalRepayments) || totalRepayments < 0 ? 0 : totalRepayments;
  const paymentsMade = repaid / installment;
  const left = term - (Number.isNaN(paymentsMade) ? 0 : Math.round(paymentsMade));
  return left < 0 ? 0 : Math.round(left);
}

/** EST. MCA % PAID = (Amount paid to date / Obligation) × 100; amount paid = Repayment × Pmts Made. */
function computedMcaPercentPaidFromObligation(
  obligation: number,
  installment: number,
  pmtsMade: number,
): number {
  if (Number.isNaN(obligation) || obligation <= 0) return NaN;
  const amountPaidToDate = installment * pmtsMade;
  const pct = (amountPaidToDate / obligation) * 100;
  return pct > 100 ? 100 : pct;
}

/** EST. MCA % PAID fallback. */
function computedMcaPercentPaid(row: IPosition): number {
  const obligation = getObligation(row);
  const totalRepayments = parseNum(row.totalRepayments);
  if (Number.isNaN(obligation) || obligation <= 0) return NaN;
  const repaid = Number.isNaN(totalRepayments) || totalRepayments < 0 ? 0 : totalRepayments;
  const pct = (repaid / obligation) * 100;
  return pct > 100 ? 100 : pct;
}

/** Incoming carry-forward for REFI: last same-lender PIF's outgoing carry = obligation − (Repayment × Pmts Made). */
function getCarryForwardForRow(rows: IPosition[], index: number): number {
  const row = rows[index];
  const status = String(row?.status || "").trim().toUpperCase();
  const lender = (row?.lender || "").trim().toLowerCase();
  if (!lender || status !== "REFI") return 0;
  const carryByLender: Record<string, number> = {};
  for (let i = 0; i < index; i++) {
    const r = rows[i];
    const l = (r?.lender || "").trim().toLowerCase();
    if (!l) continue;
    const st = String(r?.status || "").trim().toUpperCase();
    if (st === "PIF") {
      const af = parseNum(r.amountFunded);
      const inst = parseNum(r.installment);
      const incoming = carryByLender[l] ?? 0;
      if (!Number.isNaN(af) && af > 0) {
        const obligation = af * 1.49 + incoming;
        const pmtsMade = getPmtsMadeForRow(rows, i);
        const amountPaidToDate = (Number.isNaN(inst) ? 0 : inst) * pmtsMade;
        const outgoing = Math.max(0, obligation - amountPaidToDate);
        carryByLender[l] = outgoing;
      }
    }
  }
  return carryByLender[lender] ?? 0;
}

type CalculateMCAOptions = { allRows?: IPosition[]; index?: number };

function calculateMCAValues(row: IPosition, options?: CalculateMCAOptions): MCAValues {
  const out: MCAValues = {
    loanAmount: "",
    totalRepayments: "",
    monthlyMcaPmts: "",
    mcaEstBalance: "",
    pmtsLeft: "",
    mcaPercentPaid: "",
    estEndDate: "",
  };

  const amountFunded = parseNum(row.amountFunded);
  const installment = parseNum(row.installment);
  const status = String(row.status || "").trim().toUpperCase();
  const baseObligation = getObligation(row);
  const hasContext =
    options?.allRows != null &&
    options?.index != null &&
    (options.allRows?.length ?? 0) > 0;
  const carryForward = hasContext ? getCarryForwardForRow(options!.allRows!, options!.index!) : 0;
  const totalObligation =
    status === "REFI" || status === "PIF"
      ? (Number.isNaN(baseObligation) ? NaN : baseObligation + carryForward)
      : baseObligation;
  const pmtsMade = hasContext ? getPmtsMadeForRow(options.allRows!, options.index!) : 0;

  // Loan Amount = Amount Funded / 0.9 (gross-up from 90% advance)
  if (!Number.isNaN(amountFunded) && amountFunded > 0) {
    out.loanAmount = formatNumberUS(amountFunded / 0.9);
  }
  // SELECT is a neutral/default state: do not auto-derive MCA fields yet.
  if (!status || status === "SELECT") return out;

  // TOTAL REPAYMENTS = obligation (Amount Funded × 1.49), REFI/PIF include carry chain.
  if (!Number.isNaN(totalObligation) && totalObligation >= 0) {
    out.totalRepayments = formatNumberUS(totalObligation);
  }

  // Monthly MCA Payments by frequency (for display)
  const perMonth = getPaymentsPerMonth(row.frequency);
  if (!Number.isNaN(installment) && installment > 0 && perMonth > 0) {
    out.monthlyMcaPmts = formatNumberUS(installment * perMonth);
  }

  // EST. BALANCE = Obligation − (Repayment × Pmts Made)
  if (hasContext && !Number.isNaN(totalObligation) && totalObligation >= 0) {
    const inst = Number.isNaN(installment) || installment <= 0 ? 0 : installment;
    const estBal = computedEstBalanceWithPmtsMade(totalObligation, inst, pmtsMade);
    if (!Number.isNaN(estBal) && estBal >= 0) {
      out.mcaEstBalance = formatNumberUS(estBal);
    }
  } else {
    const estBal = !Number.isNaN(totalObligation) && totalObligation >= 0 ? totalObligation : computedEstBalance(row);
    if (!Number.isNaN(estBal) && estBal >= 0) {
      out.mcaEstBalance = formatNumberUS(estBal);
    }
  }

  // EST. PMTS TERM = round(Obligation ÷ Repayment); term already set in recalcRow for PIF/ACTIVE/REVERSE
  const termNum = parseNum(row.paymentTerm);
  const term =
    !Number.isNaN(termNum) && termNum >= 0
      ? Math.round(termNum)
      : !Number.isNaN(totalObligation) &&
          totalObligation > 0 &&
          !Number.isNaN(installment) &&
          installment > 0
        ? Math.round(totalObligation / installment)
        : NaN;

  // EST. PMTS LEFT = max(0, TERM − Pmts Made)
  if (hasContext && !Number.isNaN(term) && term >= 0) {
    const left = computedPmtsLeftFromTermAndMade(term, pmtsMade);
    if (!Number.isNaN(left) && left >= 0) {
      out.pmtsLeft = String(Math.round(left));
    }
  } else {
    const pmtsLeftVal = computedPmtsLeft(row);
    if (!Number.isNaN(pmtsLeftVal) && pmtsLeftVal >= 0) {
      out.pmtsLeft = String(Math.round(pmtsLeftVal));
    }
  }

  // EST. MCA % PAID = (Amount paid to date / Obligation) × 100
  if (hasContext && !Number.isNaN(totalObligation) && totalObligation > 0) {
    const inst = Number.isNaN(installment) ? 0 : installment;
    const pctPaid = computedMcaPercentPaidFromObligation(totalObligation, inst, pmtsMade);
    if (!Number.isNaN(pctPaid) && pctPaid >= 0) {
      out.mcaPercentPaid = formatNumberUS(pctPaid);
    }
  } else {
    const pctPaid = computedMcaPercentPaid(row);
    if (!Number.isNaN(pctPaid) && pctPaid >= 0) {
      out.mcaPercentPaid = formatNumberUS(pctPaid);
    }
  }

  // Estimated End Date from startDate + paymentTerm by frequency
  const estEnd = computeEstEndDate(row.startingDate, row.paymentTerm, row.frequency);
  if (estEnd) out.estEndDate = estEnd;

  // REFI guard: if core inputs are missing, keep safe defaults while still allowing monthly/remit calc.
  if (
    status === "REFI" &&
    (Number.isNaN(amountFunded) ||
      amountFunded <= 0 ||
      Number.isNaN(installment) ||
      installment <= 0 ||
      !row.frequency)
  ) {
    out.pmtsLeft = "0";
    out.mcaEstBalance = "0";
    out.mcaPercentPaid = "0.00";
    out.estEndDate = "";
  }

  if (status === "ONE TIME") {
    out.pmtsLeft = "0";
    out.mcaEstBalance = "0";
    out.mcaPercentPaid = "0.00";
  }

  if (status === "PIF") {
    out.mcaEstBalance = "0";
    out.mcaPercentPaid = "0.00";
  }

  if (status === "STOP") {
    out.mcaEstBalance = "";
    out.pmtsLeft = "0";
    out.mcaPercentPaid = "0.00";
    out.estEndDate = "";
  }

  return out;
}

type RecalcOptions = {
  index?: number;
  allRows?: IPosition[];
  avgBankNetCredit?: number | string;
};

function recalcRow(row: IPosition, options?: RecalcOptions): IPosition {
  const next: IPosition = { ...row };
  const { index, allRows, avgBankNetCredit } = options ?? {};
  const hasContext = allRows != null && typeof index === "number";

  // Normalize status casing for consistency (without changing semantics)
  if (typeof next.status === "string") {
    const trimmed = next.status.trim();
    next.status = trimmed ? trimmed.toUpperCase() : trimmed;
  }

  // Normalize starting date to ISO if user typed a US date
  if (typeof next.startingDate === "string") {
    const iso = toDateInputValue(next.startingDate);
    if (iso) next.startingDate = iso;
  }

  // EST. PMTS TERM = round(Total Obligation ÷ Repayment). Always recompute from formula when we have valid inputs so we never show obligation (e.g. 1341) instead of term (e.g. 13). Status = SELECT → no auto. Repayment = 0 or missing → don't compute. Amount Funded = 0 → term = 0.
  if (hasContext && allRows && allRows.length > 0 && index != null) {
    const status = String(next.status || "").trim().toUpperCase();
    if (
      status &&
      status !== "SELECT" &&
      !next._manual_paymentTerm &&
      ["PIF", "ACTIVE", "REVERSE", "REFI", "RECOVERY", "LOWER"].includes(status)
    ) {
      const af = parseNum(next.amountFunded);
      const inst = parseNum(next.installment);
      if (Number.isNaN(af) || af < 0) {
        // leave term as-is
      } else if (af === 0) {
        next.paymentTerm = "0";
      } else if (Number.isNaN(inst) || inst <= 0) {
        // Repayment = 0 or missing → do not compute term (leave as-is)
      } else {
        const obligation = af * 1.49;
        const carry = (status === "PIF" || status === "REFI") ? getCarryForwardForRow(allRows, index) : 0;
        const totalObligation = obligation + carry;
        next.paymentTerm = String(Math.round(totalObligation / inst));
      }
    }
  }

  // Apply computed fields: TOTAL REPAYMENTS (obligation), Loan Amount, Monthly Pmts, EST. BALANCE, EST. PMTS LEFT, EST. MCA % PAID, Est. End-Date
  const calc = calculateMCAValues(next, hasContext && allRows && index != null ? { allRows, index } : undefined);

  next.loanAmount = calc.loanAmount;
  next.totalRepayments = calc.totalRepayments;
  if (!next._manual_monthlyMcaPmts) {
    next.monthlyMcaPmts = calc.monthlyMcaPmts;
  }
  next.mcaEstBalance = calc.mcaEstBalance;
  next.pmtsLeft = calc.pmtsLeft;
  next.mcaPercentPaid = calc.mcaPercentPaid;
  next.estEndDate = calc.estEndDate;

  const monthlyNum = parseNum(next.monthlyMcaPmts);
  if (!Number.isNaN(monthlyNum) && monthlyNum < 0) next.monthlyMcaPmts = "";

  // EST. Lvg (mcaRemit): (Monthly MCA Pmts / Bank Total Avg Net Credit) × 100, .toFixed(2); matches bank-analysis page.js
  const status = String(next.status || "").trim().toUpperCase();
  const avgNetCreditNum = parseAvgNetCredit(avgBankNetCredit);
  const hasValidAvg = !Number.isNaN(avgNetCreditNum) && avgNetCreditNum > 0;
  const monthlyForRemit = getMonthlyMcaPmtsForRemit(next);

  if (!["PIF", "ONE TIME", "STOP"].includes(status)) {
    if (!status || status === "SELECT" || status === "REFI") {
      next.mcaRemit = "";
    } else if (next._manual_mcaRemit) {
      // keep user / backend string from spread
    } else if (
      hasValidAvg &&
      !Number.isNaN(monthlyForRemit) &&
      monthlyForRemit >= 0
    ) {
      next.mcaRemit = ((monthlyForRemit / avgNetCreditNum) * 100).toFixed(2);
    } else {
      next.mcaRemit = "";
    }
  } else {
    next.mcaRemit = "0.00";
  }

  // Final force rules for completed/frozen statuses
  if (status === "PIF" || status === "ONE TIME") {
    next.mcaEstBalance = "0";
    next.pmtsLeft = "0";
    next.mcaPercentPaid = "0.00";
    next.mcaRemit = "0.00";
  }
  if (status === "STOP") {
    next.mcaEstBalance = "";
    next.pmtsLeft = "0";
    next.mcaPercentPaid = "0.00";
    next.mcaRemit = "0.00";
  }

  return next;
}

/** Convert US date (MM/DD/YYYY or MM-DD-YYYY) to ISO (YYYY-MM-DD). */
function parseUSDateToISO(dateStr: string): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  const trimmed = dateStr.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return "";
  const [, mStr, dStr, yStr] = match;
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const yearNum = parseInt(yStr, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yearNum}-${mm}-${dd}`;
}

/** Convert stored date to YYYY-MM-DD for native date input */
function toDateInputValue(val?: string): string {
  if (!val || typeof val !== "string") return "";
  const trimmed = val.trim();
  if (!trimmed) return "";
  const iso = parseUSDateToISO(trimmed);
  if (iso) return iso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return "";
}

/** Convert ISO date (YYYY-MM-DD) to US display format (MM/DD/YYYY). */
function toUSFormat(dateStr: string): string {
  if (!dateStr || typeof dateStr !== "string") return "";
  const trimmed = dateStr.trim();
  if (!trimmed) return "";
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) return "";
  const [, y, m, d] = isoMatch;
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${m}/${d}/${y}`;
}

/**
 * Effective end date for "Pmts Made":
 * - ACTIVE/REFI/REVERSE: today.
 * - PIF: earliest of next same-lender PIF start or REFI start; if none, today.
 * - No start date or start in future → returns such that Pmts Made = 0.
 */
function getEffectiveEndDate(rows: IPosition[], index: number): string {
  const row = rows[index];
  const today = new Date();
  const todayStr =
    today.getFullYear() +
    "-" +
    String(today.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(today.getDate()).padStart(2, "0");
  const startIso = toDateInputValue(row?.startingDate || "") || todayStr;
  const status = String(row?.status || "").trim().toUpperCase();

  let effectiveEnd: string;
  if (["ACTIVE", "REFI", "REVERSE"].includes(status)) {
    effectiveEnd = todayStr;
  } else if (status === "PIF") {
    const lender = (row?.lender || "").trim().toLowerCase();
    if (!lender) {
      effectiveEnd = todayStr;
    } else {
      effectiveEnd = todayStr;
      for (let i = index + 1; i < rows.length; i++) {
        const r = rows[i];
        const l = (r?.lender || "").trim().toLowerCase();
        const st = String(r?.status || "").trim().toUpperCase();
        if (l !== lender || !["PIF", "REFI"].includes(st)) continue;
        const nextStart = toDateInputValue(r.startingDate || "");
        if (!nextStart) continue;
        if (nextStart < effectiveEnd) effectiveEnd = nextStart;
        break;
      }
    }
  } else {
    effectiveEnd = todayStr;
  }

  const startDate = new Date(startIso + "T00:00:00");
  const endDate = new Date(effectiveEnd + "T00:00:00");
  if (startDate.getTime() > endDate.getTime()) return todayStr; // start in future → pmts made = 0
  return effectiveEnd;
}

/** Count weekdays (Mon–Fri) between two dates, inclusive of start, inclusive of end. */
function countWeekdaysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  if (start.getTime() > end.getTime()) return 0;
  let count = 0;
  const d = new Date(start);
  while (d.getTime() <= end.getTime()) {
    const day = d.getDay();
    if (day >= 1 && day <= 5) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/** Payment periods between start and end by frequency. Daily = weekdays; Weekly = full 7-day periods; Bi-weekly = 14-day periods; Monthly = calendar months. */
function getPmtsMadeFromDateMath(
  startIso: string,
  endIso: string,
  freq?: string,
): number {
  if (!startIso || !endIso) return 0;
  const start = new Date(startIso + "T00:00:00");
  const end = new Date(endIso + "T00:00:00");
  if (start.getTime() > end.getTime()) return 0;
  const f = (freq || "").toLowerCase().replace(/\s+/g, "");
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (f === "daily") return countWeekdaysBetween(startIso, endIso);
  if (f === "weekly") return Math.floor(diffDays / 7);
  if (f === "bi-weekly" || f === "biweekly") return Math.floor(diffDays / 14);
  if (f === "monthly") {
    const months =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    return Math.max(0, months);
  }
  return 0;
}

/** Pmts Made for row: from Start Date to effective end (today or next same-lender PIF/REFI), by frequency. */
function getPmtsMadeForRow(rows: IPosition[], index: number): number {
  const row = rows[index];
  const startIso = toDateInputValue(row?.startingDate || "");
  const today = new Date();
  const todayIso =
    today.getFullYear() +
    "-" +
    String(today.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(today.getDate()).padStart(2, "0");
  const effectiveStartIso = startIso || todayIso;
  const endIso = getEffectiveEndDate(rows, index);
  if (!endIso) return 0;
  return getPmtsMadeFromDateMath(effectiveStartIso, endIso, row?.frequency);
}

type FootCurrencyEditVariant = "amount" | "repay" | "widePx";

/**
 * TOTAL row currency: same visual pattern as body read-only cells (`formatRoCurrency`: `$ 1,234.56`).
 * Single line — no flex split that shifts figures vs data rows.
 */
function FootCurrencyEditCell({
  numberText,
}: {
  variant: FootCurrencyEditVariant;
  numberText: string;
}) {
  const trimmed = (numberText ?? "").trim();
  const isDash =
    trimmed === "" || trimmed === "-";
  const line = isDash ? "-" : `$ ${trimmed}`;
  return (
    <div className="flex w-full min-w-0 items-center justify-start text-left text-sm font-medium tabular-nums text-slate-700 dark:text-slate-100">
      {line}
    </div>
  );
}

/** Same as locked body percent cells: one string (`55.37%`), no gap before `%`. */
function FootPercentEditCell({ valueText }: { valueText: string }) {
  const trimmed = valueText.trim();
  const isDash = trimmed === "" || trimmed === "-";
  return (
    <div className="flex w-full min-w-0 items-center justify-start text-left text-sm font-medium tabular-nums text-slate-700 dark:text-slate-100">
      {isDash ? "-" : trimmed}
    </div>
  );
}

/** Aligns with body read-only numeric/text cells (no extra horizontal inset vs `roCellInner`). */
function FootPlainEditCell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-center justify-start text-left text-sm font-medium tabular-nums text-slate-700 dark:text-slate-100">
      {children}
    </div>
  );
}

export default function PositionTableCalculator({
  positions: positionsProp,
  frequencyOptions = ["Select", "Daily", "Weekly", "Bi-Weekly", "Monthly"],
  statusOptions = ["Select", "ACTIVE", "REVERSE", "REFI", "PIF", "ONE TIME", "STOP", "RECOVERY", "LOWER"],
  avgBankNetCredit,
  applicationId,
  onMetricsChange,
  readOnly,
  disableDelete,
  disableCreate,
  bankAllocationOptions = [],
  onRowsChange,
  hideRowSave,
  onRegisterSaveAll,
  autoSave = false,
  autoSaveDelayMs = 1500,
}: PositionsTableProps) {
  /** Stable: do not default to `createPlaceholderRows()` here — a new array every render breaks effects. */
  const positions = positionsProp;

  const dispatch = useDispatch<AppDispatch>();
  const { data: applicationData } = useSelector(
    (state: RootState) => state.applicationDetail,
  );
  const isReadOnly = !!readOnly;
  const isDeleteDisabled = !!disableDelete;
  const isCreateDisabled = !!disableCreate;
  const effectiveHideRowSave = hideRowSave || Boolean(onRegisterSaveAll);
  const positionsState = useSelector((state: RootState) => state.positions);
  const effectiveApplicationId =
    applicationId ??
    ((applicationData as any)?._id ??
      (applicationData as any)?.id ??
      undefined);
  const normalizedEffectiveApplicationId = effectiveApplicationId
    ? String(effectiveApplicationId)
    : "";
  const normalizedCurrentScopeId = positionsState.currentApplicationId
    ? String(positionsState.currentApplicationId)
    : "";
  const isScopedToThisApp =
    !!normalizedEffectiveApplicationId &&
    (!normalizedCurrentScopeId ||
      normalizedCurrentScopeId === normalizedEffectiveApplicationId);

  const [rows, setRows] = useState<IPosition[]>(() =>
    Array.isArray(positions) && positions.length > 0
      ? positions
      : createPlaceholderRows(),
  );
  /** Tracks whether this table has ever shown real position data for the current application. */
  const hadMeaningfulRowsRef = useRef(false);
  const rowsApplicationRef = useRef("");
  const [isSavingRowIndex, setIsSavingRowIndex] = useState<number | null>(null);
  const [isDeletingRowIndex, setIsDeletingRowIndex] = useState<number | null>(null);
  const [hasUserAddedRow, setHasUserAddedRow] = useState(false);
  const lastKeyWasEnterRef = useRef(false);
  const lastRowsEmitSignatureRef = useRef<string>("");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutoSavedRowsSigRef = useRef<string>("");
  const rowsAutoSaveBootstrappedRef = useRef(false);
  const lastPositionsFetchAttemptRef = useRef<{
    key: string;
    at: number;
  } | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [allocationModal, setAllocationModal] = useState<{
    open: boolean;
    rowIndex: number;
    selectedBankId: number | null;
  }>({ open: false, rowIndex: -1, selectedBankId: null });

  // Reset the "user added" guard when we switch to a different application.
  useEffect(() => {
    setHasUserAddedRow(false);
    if (rowsApplicationRef.current !== normalizedEffectiveApplicationId) {
      rowsApplicationRef.current = normalizedEffectiveApplicationId;
      hadMeaningfulRowsRef.current = false;
    }
  }, [normalizedEffectiveApplicationId]);

  useEffect(() => {
    if (rows.some(rowHasMeaningfulData)) {
      hadMeaningfulRowsRef.current = true;
    }
  }, [rows]);

  // Derive scoped positions from Redux when an application id is provided
  const positionsFromStore: IPosition[] = useMemo(() => {
    if (!effectiveApplicationId) return [];
    if (!isScopedToThisApp) return [];
    const scoped = Array.isArray(positionsState.data)
      ? positionsState.data
      : [];

    return scoped.map((p: any) => {
      const fundingDateIso = normalizeApiDateToYyyyMmDd(p.fundingDate);
      const closeDateIso = normalizeApiDateToYyyyMmDd(p.closeDate);
      const lastPaymentDateIso = normalizeApiDateToYyyyMmDd(p.lastPaymentDate);

      return {
        _id: p._id,
        lender: p.funder ?? "",
        frequency: normalizeFrequencyOption(p.frequency ?? ""),
        installment:
          p.ach != null ? formatMoneyInputCommit(p.ach) : "",
        status: p.status ?? (p.activeStatus ? "ACTIVE" : "SELECT"),
        startingDate: fundingDateIso,
        amountFunded:
          p.fundedAmount != null ? formatMoneyInputCommit(p.fundedAmount) : "",
        loanAmount: p.loanAmount != null ? String(p.loanAmount) : "",
        totalRepayments:
          p.paybackAmount != null ? String(p.paybackAmount) : "",
        paymentTerm: p.paymentTerm != null ? String(p.paymentTerm) : "",
        mcaEstBalance:
          p.mcaEstBalance != null ? String(p.mcaEstBalance) : "",
        mcaPercentPaid:
          p.mcaPercentPaid != null ? String(p.mcaPercentPaid) : "",
        pmtsLeft: p.pmtsLeft != null ? String(p.pmtsLeft) : "",
        estEndDate: closeDateIso,
        lastPaymentDate: lastPaymentDateIso,
        mcaRemit:
          p.mcaRemit != null || p.percentOfGross != null
            ? String(p.mcaRemit ?? p.percentOfGross ?? "")
            : "",
        monthlyMcaPmts:
          p.monthlyMcaPmts != null
            ? formatMoneyInputCommit(p.monthlyMcaPmts)
            : "",
        carryForward:
          p.carryForward != null
            ? formatMoneyInputCommit(p.carryForward)
            : "",
        allocatedBankAnalysisId:
          Number.isInteger((p as any).allocatedBankAnalysisId) &&
          Number((p as any).allocatedBankAnalysisId) > 0
            ? Number((p as any).allocatedBankAnalysisId)
            : undefined,
        isLocked: true,
      };
    });
  }, [effectiveApplicationId, isScopedToThisApp, positionsState.data]);

  const hasProvidedPositions = Array.isArray(positions);
  const hasFreshStoreResult =
    normalizedCurrentScopeId === normalizedEffectiveApplicationId &&
    positionsState.lastFetchedAt != null &&
    Date.now() - positionsState.lastFetchedAt < POSITIONS_CACHE_TTL_MS;

  // Fallback fetch for consumers that do not preload positions. A successful empty response is
  // still a loaded result; otherwise replacing [] in Redux retriggers this effect indefinitely.
  useEffect(() => {
    if (!effectiveApplicationId) return;
    const lastAttempt = lastPositionsFetchAttemptRef.current;
    const recentlyRequested =
      lastAttempt?.key === normalizedEffectiveApplicationId &&
      Date.now() - lastAttempt.at < POSITIONS_CACHE_TTL_MS;
    if (
      hasProvidedPositions ||
      hasFreshStoreResult ||
      positionsState.loading ||
      recentlyRequested
    ) {
      return;
    }

    lastPositionsFetchAttemptRef.current = {
      key: normalizedEffectiveApplicationId,
      at: Date.now(),
    };
    void dispatch(getPositions({ application: effectiveApplicationId }));
  }, [
    effectiveApplicationId,
    normalizedEffectiveApplicationId,
    hasProvidedPositions,
    hasFreshStoreResult,
    positionsState.loading,
    dispatch,
  ]);

  // When positions (prop or store) are loaded/updated from API, seed or refresh local rows.
  // Note: we intentionally exclude avgBankNetCredit from deps to avoid an update loop,
  // since avgBankNetCredit is derived from rows that are set inside this effect.
  useEffect(() => {
    const source =
      Array.isArray(positions) && positions.length > 0
        ? positions
        : positionsFromStore;

    if (Array.isArray(source) && source.length > 0) {
      // When real positions are coming from the server, treat it as "not user-created placeholders".
      setHasUserAddedRow(false);
      setRows((prev) => {
        const prevHasRealData = prev.some(rowHasMeaningfulData);
        if (!prevHasRealData) {
          return source.map((p, i) =>
            recalcRow(p, { index: i, allRows: source, avgBankNetCredit }),
          );
        }

        // After Approve & Save / refetch: refresh locked rows from the server without blanking first.
        const meaningful = prev.filter(rowHasMeaningfulData);
        const allLockedSaved =
          meaningful.length > 0 &&
          meaningful.every((row) => row.isLocked && row._id);
        if (allLockedSaved) {
          return source.map((p, i) =>
            recalcRow(p, { index: i, allRows: source, avgBankNetCredit }),
          );
        }

        return prev;
      });
    }
  }, [positions, positionsFromStore]);

  // If we have finished loading scoped positions for this application and none exist,
  // keep one placeholder row visible by default.
  useEffect(() => {
    if (!effectiveApplicationId) return;

    const hasPropPositions =
      Array.isArray(positions) && positions.length > 0;
    const hasStorePositions =
      Array.isArray(positionsFromStore) && positionsFromStore.length > 0;

    if (!isScopedToThisApp || hasPropPositions || hasStorePositions) return;

    // Don't override rows if the user is actively adding data or has typed into any row
    // (hasUserAddedRow is only set by "Create Position", not by editing default placeholders).
    if (positionsState.loading && hadMeaningfulRowsRef.current) return;

    if (!positionsState.loading && !hasUserAddedRow) {
      setRows((prev) => {
        const hasRealData =
          prev.some(rowHasMeaningfulData) || hadMeaningfulRowsRef.current;
        if (hasRealData) return prev;
        return createPlaceholderRows();
      });
    }
  }, [
    effectiveApplicationId,
    isScopedToThisApp,
    positions,
    positionsFromStore,
    positionsState.loading,
    hasUserAddedRow,
  ]);

  const todayMax = (() => {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  })();

  /* EST. BALANCE, EST. PMTS TERM, EST. PMTS LEFT, EST. MCA % PAID — table cells commented in thead/tbody/tfoot (search "HIDDEN EST COLUMNS"). Underlying row data / recalc unchanged. */

  const col = {
    lender: "min-w-[132px]",
    startingDate: "min-w-[124px]",
    amountFunded: "min-w-[148px]",
    status: "min-w-[108px]",
    frequency: "min-w-[112px]",
    repayment: "min-w-[120px]",
    monthlyMcaPmts: "min-w-[128px]",
    totalRepayments: "min-w-[168px]",
    mcaEstBalance: "min-w-[140px]",
    paymentTerm: "min-w-[132px]",
    pmtsLeft: "min-w-[132px]",
    mcaPercentPaid: "min-w-[148px]",
    mcaRemit: "min-w-[100px]",
    lastPaymentDate: "min-w-[176px]",
    action: "min-w-[92px]",
  };

  /** Sticky header: solid bg + nowrap so labels stay on one line while body scrolls. */
  const thBase = `sticky top-0 z-10 whitespace-nowrap px-3 py-2.5 text-left ${
    isReadOnly
      ? "bg-slate-50 text-[#475569] dark:bg-slate-800/80 dark:text-slate-300"
      : "bg-white text-slate-500 dark:bg-[#141517] dark:text-slate-300"
  }`;

  const cellClass = isReadOnly
    ? "px-3 py-2.5 align-middle text-left"
    : "px-2 py-2 align-middle text-left";
  /** Same horizontal padding as body cells so TOTAL row lines up with data above. */
  const footTdClass = isReadOnly
    ? "px-3 py-3 align-middle text-left"
    : "px-2 py-3 align-middle text-left";
  // Keep a soft, consistent border tone for all field-like controls.
  const borderStyle = { borderColor: "rgb(186 230 253)" };
  /** Footer cells align with column headers (left-aligned). */
  const footCellCenter = "flex w-full min-w-0 justify-start items-center";
  /** Plain text body cells when `readOnly` (Decision tab snapshot). Keep left alignment matching footer totals (no inner box). */
  const roCellInner =
    "flex w-full min-w-0 items-center justify-start text-left text-sm font-medium tabular-nums text-slate-700 dark:text-slate-100";
  /** Same as roCellInner but without tabular-nums (e.g. LENDER name). */
  const roCellInnerText =
    "flex w-full min-w-0 items-center justify-start text-left text-sm font-medium text-slate-700 dark:text-slate-100";

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    if (e.key === "Enter") {
      lastKeyWasEnterRef.current = true;
      e.preventDefault();
      e.stopPropagation();
      const current = e.target as HTMLElement;
      if (!current) return;
      const tableEl = current.closest("table");
      if (!tableEl) return;
      const focusables = Array.from(
        tableEl.querySelectorAll<HTMLElement>("tbody input, tbody select"),
      ).filter((el) => !(el as HTMLInputElement | HTMLSelectElement).disabled);
      const idx = focusables.indexOf(current);
      if (idx === -1) return;
      const next = focusables[idx + 1];
      if (next && typeof next.focus === "function") next.focus();
    } else {
      lastKeyWasEnterRef.current = false;
    }
  }

  const handleUpdateRow = (
    index: number,
    field: keyof IPosition,
    value: string,
  ) => {
    if (isReadOnly) return;
    setRows((prev) => {
      const next = [...prev];
      let updated: IPosition = { ...next[index], [field]: value };
      if (field === "mcaRemit") {
        updated._manual_mcaRemit = value.trim() !== "";
      } else if (
        field === "installment" ||
        field === "frequency" ||
        field === "amountFunded" ||
        field === "status"
      ) {
        updated._manual_mcaRemit = false;
      }
      if (field === "installment" || field === "frequency") {
        updated._manual_monthlyMcaPmts = false;
      }
      if (field === "monthlyMcaPmts") {
        updated._manual_monthlyMcaPmts = value.trim() !== "";
        updated._manual_mcaRemit = false;
      }
      if (field === "paymentTerm") updated._manual_paymentTerm = true;

      // When AMOUNT FUNDED is entered: auto-fill START DATE (if missing and not REFI)
      if (field === "amountFunded") {
        const amountNum = parseNum(value);
        const hasStartDate = !!toDateInputValue(updated.startingDate);
        const status = String(updated.status || "")
          .trim()
          .toUpperCase();
        if (
          !hasStartDate &&
          !Number.isNaN(amountNum) &&
          amountNum > 0 &&
          status !== "REFI"
        ) {
          updated = { ...updated, startingDate: todayMax };
        }
      }

      if (field === "startingDate") {
        const startIso = toDateInputValue(value);
        const lastIso = toDateInputValue(updated.lastPaymentDate || "");
        if (startIso && lastIso && lastIso < startIso) {
          updated = { ...updated, lastPaymentDate: startIso };
        }
      }

      // Always run full row recalc so Loan Amount, Total Repayments, Est. Balance, PMTS LEFT, etc. reflect automatically.
      // Pass an array with the updated row at index so date-based Pmts Made uses the new start date (and other fields).
      const nextWithUpdated = [...next];
      nextWithUpdated[index] = updated;
      next[index] = recalcRow(updated, { index, allRows: nextWithUpdated, avgBankNetCredit });
      return next;
    });
  };

  const handleRemoveRow = async (index: number) => {
    if (isReadOnly) return;
    const row = rows[index];
    if (!row) return;

    // If row was never saved to the backend, just remove locally
    if (!row._id) {
      setRows((prev) => prev.filter((_, i) => i !== index));
      toast.success("Position removed.");
      return;
    }

    if (!effectiveApplicationId) {
      // Safety: row has id but no scoped application – still delete on server
      // but we don't try to refetch scoped positions.
    }

    setIsDeletingRowIndex(index);
    try {
      await dispatch(deletePosition(row._id)).unwrap();
      toast.success("Position deleted successfully.");

      // Remove from local rows immediately for snappy UX
      setRows((prev) => prev.filter((_, i) => i !== index));

      // Refresh scoped positions in store so future mounts stay in sync
      if (effectiveApplicationId) {
        dispatch(getPositions({ application: effectiveApplicationId }));
      }
    } catch (error: any) {
      console.error("Delete position error:", error);
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to delete position. Please try again.";
      toast.error(message);
    } finally {
      setIsDeletingRowIndex(null);
    }
  };

  /**
   * Validate and persist a single row (create or update). Returns a status so
   * the bulk {@link saveAll} flow can keep going and report overall success.
   * When `silent`, success toasts are suppressed (errors are always surfaced).
   */
  const persistRow = async (
    index: number,
    row: IPosition,
    opts?: { silent?: boolean; lockAfterSave?: boolean },
  ): Promise<"saved" | "invalid" | "error"> => {
    if (!row) return "invalid";
    const silent = !!opts?.silent;
    const lockAfterSave = opts?.lockAfterSave !== false;
    const fail = (msg: string) => {
      if (!silent) toast.error(msg);
    };

    // If we don't have an application to attach to, just lock locally
    if (!effectiveApplicationId) {
      setRows((prev) => {
        const next = [...prev];
        if (!next[index]) return next;
        next[index] = { ...next[index], isLocked: true };
        return next;
      });
      fail("No application selected. Unable to save position to the server.");
      return "error";
    }

    const amountFundedNum = parseNum(row.amountFunded);
    const totalRepaymentsNum = parseNum(row.totalRepayments);
    const installmentNum = parseNum(row.installment);
    const remitPercentNum = parseNum(row.mcaRemit);
    const loanAmountNum = parseNum(row.loanAmount);
    const mcaEstBalanceNum = parseNum(row.mcaEstBalance);
    const mcaPercentPaidNum = parseNum(row.mcaPercentPaid);
    const pmtsLeftNum = parseNum(row.pmtsLeft);
    const monthlyMcaPmtsNum = parseNum(row.monthlyMcaPmts);
    const carryForwardNum = parseNum(row.carryForward);
    const paymentTermNum = parseNum(row.paymentTerm);

    if (Number.isNaN(amountFundedNum) || amountFundedNum <= 0) {
      fail("Please enter a valid Amount Funded before saving this position.");
      return "invalid";
    }

    const lender = row.lender?.trim() || "";
    const status = String(row.status || "").trim().toUpperCase();
    const frequency = row.frequency || "";

    if (!lender) {
      fail("Please enter the LENDER name before saving this position.");
      return "invalid";
    }

    if (!frequency || frequency === "Select") {
      fail("Please select a FREQUENCY before saving this position.");
      return "invalid";
    }

    if (Number.isNaN(installmentNum) || installmentNum <= 0) {
      fail("Please enter a valid REPAYMENT amount before saving this position.");
      return "invalid";
    }

    // PIF / REFI / etc.: EST. Lvg not shown or blank; persist 0. Others require valid EST. Lvg %.
    const effectiveRemit = ["PIF", "ONE TIME", "STOP", "REFI"].includes(status)
      ? 0
      : remitPercentNum;
    if (
      !["PIF", "ONE TIME", "STOP", "REFI"].includes(status) &&
      (Number.isNaN(effectiveRemit) || effectiveRemit <= 0)
    ) {
      fail("Please enter or compute a valid EST. Lvg % before saving this position.");
      return "invalid";
    }

    const fundingDate = toDateInputValue(row.startingDate || "") || todayMax;
    const closeDate =
      computeCloseDate(row.startingDate, row.paymentTerm, row.frequency) || fundingDate;
    const lastPaymentDate = toDateInputValue(row.lastPaymentDate || "");

    const basePayload: CreatePositionPayload = {
      position: `Position ${index + 1}`,
      factorRate: "1.49",
      ach: String(installmentNum),
      percentOfGross: String(effectiveRemit),
      funder: lender,
      paybackAmount: !Number.isNaN(totalRepaymentsNum)
        ? totalRepaymentsNum
        : amountFundedNum * 1.49,
      fundingDate,
      activeStatus: status === "ACTIVE",
      fundedAmount: amountFundedNum,
      frequency,
      closeDate,
      notes: undefined,
      application: effectiveApplicationId,
      status: status || undefined,
      loanAmount: !Number.isNaN(loanAmountNum) ? loanAmountNum : undefined,
      paymentTerm: !Number.isNaN(paymentTermNum) ? paymentTermNum : undefined,
      mcaEstBalance: !Number.isNaN(mcaEstBalanceNum) ? mcaEstBalanceNum : undefined,
      mcaPercentPaid: !Number.isNaN(mcaPercentPaidNum) ? mcaPercentPaidNum : undefined,
      pmtsLeft: !Number.isNaN(pmtsLeftNum) ? pmtsLeftNum : undefined,
      monthlyMcaPmts: !Number.isNaN(monthlyMcaPmtsNum) ? monthlyMcaPmtsNum : undefined,
      mcaRemit: !Number.isNaN(effectiveRemit) ? effectiveRemit : undefined,
      carryForward: !Number.isNaN(carryForwardNum) ? carryForwardNum : undefined,
      lastPaymentDate: lastPaymentDate || undefined,
      allocatedBankAnalysisId: Number.isInteger(Number(row.allocatedBankAnalysisId))
        ? Number(row.allocatedBankAnalysisId)
        : undefined,
    };

    // All validations passed: now mark this row as saving
    setIsSavingRowIndex(index);

    try {
      let savedId = row._id;

      if (row._id) {
        const updatePayload: UpdatePositionPayload = { ...basePayload };
        await dispatch(
          updatePosition({
            id: row._id,
            data: updatePayload,
          }),
        ).unwrap();
        if (!silent) toast.success("Position updated successfully.");
      } else {
        const result = await dispatch(createPosition(basePayload)).unwrap();
        const created = (result as any).data || result;
        if (created && typeof created === "object" && created._id) {
          savedId = String(created._id);
        }
        if (!silent) toast.success("Position saved successfully.");
      }

      setRows((prev) => {
        const next = [...prev];
        if (!next[index]) return next;
        const cur = next[index];
        const withIds: IPosition = {
          ...cur,
          isLocked: lockAfterSave,
          _id: savedId,
          amountFunded: formatMoneyInputCommit(cur.amountFunded),
          installment: formatMoneyInputCommit(cur.installment),
          monthlyMcaPmts:
            cur.monthlyMcaPmts != null &&
            String(cur.monthlyMcaPmts).trim() !== ""
              ? formatMoneyInputCommit(cur.monthlyMcaPmts)
              : cur.monthlyMcaPmts ?? "",
          carryForward:
            cur.carryForward != null && String(cur.carryForward).trim() !== ""
              ? formatMoneyInputCommit(cur.carryForward)
              : cur.carryForward ?? "",
        };
        const nextForRecalc = [...next];
        nextForRecalc[index] = withIds;
        next[index] = recalcRow(withIds, {
          index,
          allRows: nextForRecalc,
          avgBankNetCredit,
        });
        return next;
      });
      return "saved";
    } catch (error: any) {
      console.error("Save position error:", error);
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to save position. Please try again.";
      toast.error(message);
      return "error";
    } finally {
      setIsSavingRowIndex(null);
    }
  };

  /**
   * Persist every row that contains data in one pass. Already-saved (locked)
   * rows are skipped; empty placeholder rows are ignored. Registered with the
   * parent via {@link onRegisterSaveAll} for Offer "Approve & Save".
   */
  const saveAll = useCallback(async (): Promise<boolean> => {
    const current = rows;
    let allOk = true;
    for (let i = 0; i < current.length; i++) {
      const row = current[i];
      if (!rowHasMeaningfulData(row)) continue;
      if (row?.isLocked && row?._id) continue;
      const result = await persistRow(i, row, { silent: false });
      if (result !== "saved") allOk = false;
    }
    return allOk;
  }, [rows, persistRow]);

  const persistRowRef = useRef(persistRow);
  persistRowRef.current = persistRow;

  useEffect(() => {
    onRegisterSaveAll?.(saveAll);
  }, [onRegisterSaveAll, saveAll]);

  useEffect(() => {
    rowsAutoSaveBootstrappedRef.current = false;
    lastAutoSavedRowsSigRef.current = "";
  }, [normalizedEffectiveApplicationId]);

  /** Debounced auto-save for Scrubbing — persists unlocked rows without re-locking. */
  useEffect(() => {
    if (!autoSave || isReadOnly || !normalizedEffectiveApplicationId) return;

    const sig = buildRowsEmitSignature(rows);
    if (!rowsAutoSaveBootstrappedRef.current) {
      rowsAutoSaveBootstrappedRef.current = true;
      lastAutoSavedRowsSigRef.current = sig;
      return;
    }
    if (sig === lastAutoSavedRowsSigRef.current) return;

    const hasUnlockedEditable = rows.some(
      (row) => !row.isLocked && rowHasMeaningfulData(row),
    );
    if (!hasUnlockedEditable) return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void (async () => {
        let savedAny = false;
        const snapshot = rowsRef.current;
        for (let i = 0; i < snapshot.length; i++) {
          const row = snapshot[i];
          if (!row || row.isLocked || !rowHasMeaningfulData(row)) continue;
          const result = await persistRowRef.current(i, row, {
            silent: true,
            lockAfterSave: false,
          });
          if (result === "saved") savedAny = true;
        }
        if (savedAny) {
          lastAutoSavedRowsSigRef.current = sig;
        }
      })();
    }, autoSaveDelayMs);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    rows,
    autoSave,
    autoSaveDelayMs,
    isReadOnly,
    normalizedEffectiveApplicationId,
  ]);

  const handleUnlockRow = (index: number) => {
    if (isReadOnly) return;
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], isLocked: false };
      return next;
    });
  };

  const handleAddRow = () => {
    if (isReadOnly) return;
    setHasUserAddedRow(true);
    setRows((prev) => [...prev, {}]);
  };

  // Recalculate all rows whenever avgBankNetCredit changes (affects EST. Lvg)
  useEffect(() => {
    setRows((prev) => {
      const next = prev.map((r, i) =>
        recalcRow(r, { index: i, allRows: prev, avgBankNetCredit }),
      );
      if (buildRowsEmitSignature(prev) === buildRowsEmitSignature(next)) return prev;
      return next;
    });
  }, [avgBankNetCredit]);

  useEffect(() => {
    if (!onRowsChange) return;
    // Prevent parent update loops caused by equal-content/new-reference row arrays.
    const signature = buildRowsEmitSignature(rows);
    if (signature === lastRowsEmitSignatureRef.current) return;
    lastRowsEmitSignatureRef.current = signature;
    onRowsChange(rows);
  }, [rows, onRowsChange]);

  useEffect(() => {
    if (bankAllocationOptions.length <= 0) return;
    setRows((prev) =>
      prev.map((row) => {
        const allocated = Number(row.allocatedBankAnalysisId);
        if (
          Number.isInteger(allocated) &&
          allocated >= 1 &&
          allocated <= bankAllocationOptions.length
        ) {
          return row;
        }
        if (row.allocatedBankAnalysisId == null) return row;
        return { ...row, allocatedBankAnalysisId: undefined };
      }),
    );
  }, [bankAllocationOptions]);

  // Memoize all row-derived aggregates so they only recalculate when rows change.
  const {
    activeCount,
    existingRemit,
    totalMonthlyFromPositions,
    totalDailyFromPositions,
    positionsForTotalsCount,
    repaymentSum,
    totalRepaymentsSum,
    paymentTermSum,
    amountFundedSum,
    mcaEstBalanceSum,
    mcaPercentPaidSum,
    pmtsLeftSum,
    mcaRemitSum,
    monthlyMcaPmtsSum,
  } = useMemo(() => {
    const rowsActiveForCount = rows.filter((row) => {
      const status = String(row.status || "").trim().toUpperCase();
      const lender = (row.lender || "").trim();
      const hasNumeric = ACTIVE_COUNT_NUMERIC_KEYS.some((key) => {
        const v = row[key];
        return !Number.isNaN(parseNum(v));
      });

      if (status && status !== "SELECT") return true;
      if (lender) return true;
      return hasNumeric;
    });

    const rowsForExistingRemitAndMonthly = rows.filter((row) => {
      const status = String(row.status || "").trim().toUpperCase();
      const amountFundedNum = parseNum(row.amountFunded);
      const remitNum = parseNum(row.mcaRemit);
      const monthlyNum = parseNum(row.monthlyMcaPmts);

      const hasAmountFunded = !Number.isNaN(amountFundedNum) && amountFundedNum > 0;
      const hasRemitOrMonthly =
        (!Number.isNaN(remitNum) && remitNum > 0) ||
        (!Number.isNaN(monthlyNum) && monthlyNum > 0);

      if (ACTIVE_STATUSES.includes(status as (typeof ACTIVE_STATUSES)[number])) {
        return hasAmountFunded || hasRemitOrMonthly;
      }
      if (!status || status === "SELECT") return hasRemitOrMonthly;
      return false;
    });

    const totalMonthlyFromPositions = rowsForExistingRemitAndMonthly.reduce(
      (sum, row) => {
        const monthlyNum = getMonthlyMcaPmtsForRemit(row);
        return sum + (Number.isNaN(monthlyNum) ? 0 : monthlyNum);
      },
      0,
    );
    const totalDailyFromPositions =
      totalMonthlyFromPositions > 0 ? totalMonthlyFromPositions / 22 : 0;

    const avgNetCreditNum = parseAvgNetCredit(avgBankNetCredit);
    const hasValidAvg =
      !Number.isNaN(avgNetCreditNum) && avgNetCreditNum > 0;

    const existingRemitFromRows = rowsForExistingRemitAndMonthly.reduce(
      (sum, row) => {
        const remitNum = parseNum(row.mcaRemit);
        return sum + (Number.isNaN(remitNum) ? 0 : remitNum);
      },
      0,
    );
    const existingRemit =
      hasValidAvg && totalMonthlyFromPositions > 0
        ? (totalMonthlyFromPositions / avgNetCreditNum) * 100
        : existingRemitFromRows;

    const positionsForTotals = rows.filter((row) => {
      const status = String(row.status || "")
        .trim()
        .toUpperCase();
      if (
        status &&
        status !== "SELECT" &&
        ACTIVE_STATUSES.includes(status as (typeof ACTIVE_STATUSES)[number])
      ) {
        return true;
      }
      return TOTALS_DATA_KEYS.some((key) => {
        const v = row[key];
        return v != null && String(v).trim() !== "" && !Number.isNaN(parseNum(v));
      });
    });

    const repaymentSum = positionsForTotals.reduce(
      (sum, row) => sum + (parseNum(row.installment) || 0),
      0,
    );
    const totalRepaymentsSum = positionsForTotals.reduce(
      (sum, row) => sum + (parseNum(row.totalRepayments) || 0),
      0,
    );
    const paymentTermSum = positionsForTotals.reduce(
      (sum, row) => sum + (parseNum(row.paymentTerm) || 0),
      0,
    );
    const amountFundedSum = positionsForTotals.reduce(
      (sum, row) => sum + (parseNum(row.amountFunded) || 0),
      0,
    );
    const mcaEstBalanceSum = positionsForTotals.reduce(
      (sum, row) => sum + (parseNum(row.mcaEstBalance) || 0),
      0,
    );
    const mcaPercentPaidSum = positionsForTotals.reduce(
      (sum, row) => sum + (parseNum(row.mcaPercentPaid) || 0),
      0,
    );
    const pmtsLeftSum = positionsForTotals.reduce(
      (sum, row) => sum + (parseNum(row.pmtsLeft) || 0),
      0,
    );
    const monthlyMcaPmtsSum = positionsForTotals.reduce((sum, row) => {
      const monthlyNum = getMonthlyMcaPmtsForRemit(row);
      return sum + (Number.isNaN(monthlyNum) ? 0 : monthlyNum);
    }, 0);
    const mcaRemitSum =
      hasValidAvg && monthlyMcaPmtsSum > 0
        ? (monthlyMcaPmtsSum / avgNetCreditNum) * 100
        : positionsForTotals.reduce(
            (sum, row) => sum + (parseNum(row.mcaRemit) || 0),
            0,
          );

    return {
      activeCount: rowsActiveForCount.length,
      existingRemit,
      totalMonthlyFromPositions,
      totalDailyFromPositions,
      positionsForTotalsCount: positionsForTotals.length,
      repaymentSum,
      totalRepaymentsSum,
      paymentTermSum,
      amountFundedSum,
      mcaEstBalanceSum,
      mcaPercentPaidSum,
      pmtsLeftSum,
      mcaRemitSum,
      monthlyMcaPmtsSum,
    };
  }, [rows, avgBankNetCredit]);

  // Surface metrics to parent if requested, but only when they actually change
  const lastMetricsRef = useRef<PositionTableMetrics | null>(null);
  useEffect(() => {
    if (!onMetricsChange) return;
    const nextMetrics: PositionTableMetrics = {
      activeCount,
      existingRemit,
      totalMonthlyFromPositions,
      totalDailyFromPositions,
    };
    const prev = lastMetricsRef.current;
    const changed =
      !prev ||
      prev.activeCount !== nextMetrics.activeCount ||
      prev.existingRemit !== nextMetrics.existingRemit ||
      prev.totalMonthlyFromPositions !== nextMetrics.totalMonthlyFromPositions ||
      prev.totalDailyFromPositions !== nextMetrics.totalDailyFromPositions;
    if (!changed) return;
    lastMetricsRef.current = nextMetrics;
    onMetricsChange(nextMetrics);
  }, [
    onMetricsChange,
    activeCount,
    existingRemit,
    totalMonthlyFromPositions,
    totalDailyFromPositions,
  ]);

  return (
    <div className="w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm dark:border-slate-700 dark:bg-[#141517]">
      {/* Header Section */}
      <div className="flex shrink-0 items-center justify-between bg-[#D9E9F6] px-5 py-3 dark:bg-[#2A2B2F]">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold uppercase tracking-wide text-[#334155] dark:text-slate-100">Positions</h2>
        </div>
        {!isReadOnly && !isCreateDisabled && (
          <Button
            type="button"
            variant="default"
            onClick={handleAddRow}
            className="font-semibold"
          >
            Create Position
          </Button>
        )}
      </div>
      <div className="min-w-0 w-full max-h-[min(70vh,560px)] overflow-auto rounded-b-xl overscroll-x-contain">
        <table
          className={`w-full min-w-[1430px] table-auto border-separate border-spacing-0 dark:text-slate-100 [&_input]:rounded-md [&_input]:ring-0 [&_input]:focus:outline-none [&_input]:focus:ring-0 [&_input]:focus-visible:outline-none [&_input]:focus-visible:ring-0 [&_input]:dark:text-slate-100 [&_input]:dark:placeholder:text-slate-500 [&_select]:rounded-md [&_select]:ring-0 [&_select]:focus:outline-none [&_select]:focus:ring-0 [&_select]:focus-visible:outline-none [&_select]:focus-visible:ring-0 [&_select]:dark:text-slate-100 [&_tbody_div.border]:rounded-md [&_tbody_div.border]:border [&_tbody_div.border]:border-transparent [&_tbody_div.border]:bg-white [&_tbody_div.border]:shadow-none dark:[&_tbody_div.border]:border-transparent dark:[&_tbody_div.border]:bg-slate-900/70 ${isReadOnly ? "text-sm" : "text-[13px] [&_input]:text-[14px] [&_select]:text-[14px]"}`}
        >
          <thead>
            <tr
              className="font-semibold uppercase tracking-wide text-xs"
              style={borderStyle}
            >
              <th className={`${thBase} ${col.lender}`}>LENDER</th>
              <th className={`${thBase} ${col.startingDate}`}>START DATE</th>
              <th className={`${thBase} ${col.amountFunded}`}>
                AMOUNT FUNDED
              </th>
              <th className={`${thBase} ${col.status}`}>STATUS</th>
              <th className={`${thBase} ${col.frequency}`}>FREQUENCY</th>
              <th className={`${thBase} ${col.repayment}`}>REPAYMENT</th>
              <th className={`${thBase} ${col.lastPaymentDate}`}>
                DATE OF LAST PYMT
              </th>
              <th className={`${thBase} ${col.monthlyMcaPmts}`}>
                MONTHLY PMTS
              </th>
              <th className={`${thBase} ${col.totalRepayments}`}>
                TOTAL REPAYMENTS
              </th>
              {/* HIDDEN EST COLUMNS — uncomment to show EST. BALANCE, EST. PMTS TERM, EST. PMTS LEFT, EST. MCA % PAID
              <th className={`${thBase} ${col.mcaEstBalance}`}>
                EST. BALANCE
              </th>
              <th className={`${thBase} ${col.paymentTerm}`}>
                EST. PMTS TERM
              </th>
              <th className={`${thBase} ${col.pmtsLeft}`}>
                EST. PMTS LEFT
              </th>
              <th className={`${thBase} ${col.mcaPercentPaid}`}>
                EST. MCA % PAID
              </th>
              */}
              <th className={`${thBase} ${col.mcaRemit}`}>EST. REMIT</th>
              {!isReadOnly && (
                <th className={`${thBase} ${col.action}`}>ACTION</th>
              )}
            </tr>
          </thead>
          <tbody>
            {!Array.isArray(rows) || rows.length === 0 ? (
              <tr>
                <td
                  colSpan={isReadOnly ? 10 : 11}
                  className="px-4 py-6 text-left text-sm text-slate-500 dark:text-slate-300"
                  style={borderStyle}
                >
                  {isReadOnly || isCreateDisabled
                    ? "No positions to display."
                    : 'No positions yet. Click "Create Position" to add one.'}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const locked = !!row.isLocked;
                const readMode = isReadOnly || locked;
                const isoStart = toDateInputValue(row.startingDate);
                const isoLastPymt = toDateInputValue(row.lastPaymentDate);
                const status = String(row.status || "").trim().toUpperCase();
                const isSaving = isSavingRowIndex === index;
                const isDeleting = isDeletingRowIndex === index;
                const isBusy = isSaving || isDeleting;
                const lenderDisplay = (row.lender || "").trim();

                const isPifLike = status === "PIF" || status === "ONE TIME";
                const isAlertRow = ["STOP", "RECOVERY", "LOWER"].includes(status);
                return (
                  <tr
                    key={index}
                    className={
                      isPifLike
                        ? "bg-emerald-50 dark:bg-emerald-900/20"
                        : isAlertRow
                          ? "bg-rose-50 dark:bg-rose-900/20"
                          : "bg-white dark:bg-[#141517]"
                    }
                  >
                    {/* LENDER */}
                    <td
                      className={`${cellClass} ${col.lender}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInnerText}>
                          {lenderDisplay || "-"}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={row.lender || ""}
                          readOnly={locked}
                          onChange={(e) =>
                            handleUpdateRow(index, "lender", e.target.value)
                          }
                          onKeyDown={handleCellKeyDown}
                            className={`w-full min-w-[6ch] rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 text-left placeholder-slate-400 shadow-sm focus:outline-none dark:border-slate-600 dark:text-slate-100 dark:placeholder:text-slate-500 ${
                            locked
                              ? "bg-slate-50 dark:bg-slate-800/80"
                              : "bg-white dark:bg-slate-900"
                          }`}
                          style={borderStyle}
                        />
                      )}
                    </td>

                    {/* START DATE */}
                    <td
                      className={`${cellClass} ${col.startingDate}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {isoStart ? toUSFormat(isoStart) : "-"}
                        </div>
                      ) : (
                        <div
                          className={`relative w-full min-w-0 min-h-[34px] ${
                            locked
                              ? "cursor-default pointer-events-none"
                              : "cursor-pointer"
                          }`}
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            const dateInput =
                              e.currentTarget.querySelector<HTMLInputElement>(
                                'input[type="date"]',
                              );
                            if (dateInput) {
                              if (
                                typeof (dateInput as any).showPicker ===
                                "function"
                              ) {
                                (dateInput as any).showPicker();
                              } else {
                                dateInput.click();
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              const dateInput = (
                                e.currentTarget as HTMLElement
                              ).querySelector<HTMLInputElement>(
                                'input[type="date"]',
                              );
                              if (dateInput) {
                                if (
                                  typeof (dateInput as any).showPicker ===
                                  "function"
                                ) {
                                  (dateInput as any).showPicker();
                                } else {
                                  dateInput.click();
                                }
                              }
                            }
                          }}
                        >
                          <input
                            type="text"
                            readOnly
                            value={isoStart ? toUSFormat(isoStart) : ""}
                            placeholder="MM/DD/YYYY"
                            className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 placeholder-slate-400 shadow-sm pointer-events-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                            style={borderStyle}
                          />
                          <input
                            type="date"
                            value={isoStart}
                            max={todayMax}
                            disabled={locked}
                            onChange={(e) => {
                              const raw = e.target.value;
                              handleUpdateRow(index, "startingDate", raw || "");
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              handleCellKeyDown(e);
                            }}
                            className="absolute inset-0 w-full h-full border-0 rounded min-h-0 opacity-0 z-10 cursor-pointer"
                            style={{
                              border: "none",
                              padding: 0,
                              fontSize: "inherit",
                            }}
                            title="Select date"
                          />
                        </div>
                      )}
                    </td>

                    {/* AMOUNT FUNDED */}
                    <td
                      className={`${cellClass} ${col.amountFunded}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {formatRoCurrency(row.amountFunded)}
                        </div>
                      ) : (
                        <div
                          className={`flex min-w-0 items-center rounded border ${
                            locked ? "bg-slate-50 dark:bg-slate-800/80" : "bg-white dark:bg-slate-900"
                          }`}
                          style={borderStyle}
                        >
                          <span className="shrink-0 pl-2 text-xs text-slate-400 dark:text-slate-500">
                            $
                          </span>
                          <input
                            type="text"
                            readOnly={locked}
                            value={row.amountFunded ?? ""}
                            onFocus={() => {
                              if (locked) return;
                              if (allocationModal.open) return;
                              const bankCount = bankAllocationOptions.length;
                              if (bankCount <= 1) return;
                              const existingAllocation = Number(row.allocatedBankAnalysisId);
                              const hasExistingAllocation =
                                Number.isInteger(existingAllocation) &&
                                existingAllocation >= 1 &&
                                existingAllocation <= bankCount;
                              if (hasExistingAllocation) return;
                              setAllocationModal({
                                open: true,
                                rowIndex: index,
                                selectedBankId: null,
                              });
                            }}
                            onChange={(e) => {
                              const raw = sanitizeDecimalInput(e.target.value);
                              handleUpdateRow(
                                index,
                                "amountFunded",
                                formatNumberUSForInput(raw),
                              );
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              lastKeyWasEnterRef.current = false;
                              if (raw === "") {
                                handleUpdateRow(index, "amountFunded", "");
                                handleUpdateRow(index, "allocatedBankAnalysisId", "" as any);
                                return;
                              }

                              const clean = sanitizeDecimalInput(raw);
                              const num = parseNum(clean);
                              if (clean === "" || Number.isNaN(num)) {
                                handleUpdateRow(index, "amountFunded", "");
                                handleUpdateRow(index, "allocatedBankAnalysisId", "" as any);
                                return;
                              }

                              handleUpdateRow(index, "amountFunded", formatNumberUS(num));
                              const bankCount = bankAllocationOptions.length;

                              if (num <= 0 || bankCount <= 0) {
                                handleUpdateRow(index, "allocatedBankAnalysisId", "" as any);
                                return;
                              }

                              if (bankCount === 1) {
                                handleUpdateRow(
                                  index,
                                  "allocatedBankAnalysisId",
                                  String(bankAllocationOptions[0].id) as any,
                                );
                                return;
                              }
                            }}
                            onKeyDown={handleCellKeyDown}
                            className="flex-1 min-w-[7ch] max-w-[70%] border-0 bg-transparent py-1.5 pl-1 pr-2 text-left text-xs text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                          {!locked &&
                            bankAllocationOptions.length > 1 &&
                            Number.isInteger(Number(row.allocatedBankAnalysisId)) && (
                              <button
                                type="button"
                                className="pr-2  cursor-pointer text-slate-500 hover:text-slate-700"
                                title="Edit allocated bank"
                                onClick={() =>
                                  setAllocationModal({
                                    open: true,
                                    rowIndex: index,
                                    selectedBankId: Number(row.allocatedBankAnalysisId) || null,
                                  })
                                }
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                        </div>
                      )}
                    </td>

                    {/* STATUS */}
                    <td
                      className={`${cellClass} ${col.status}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {(row.status || statusOptions[0] || "").trim() || "-"}
                        </div>
                      ) : (
                        <select
                          value={row.status || statusOptions[0] || ""}
                          disabled={locked}
                          onChange={(e) =>
                            handleUpdateRow(index, "status", e.target.value)
                          }
                          onKeyDown={handleCellKeyDown}
                          className="w-full min-w-0 cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          style={borderStyle}
                        >
                          {statusOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* FREQUENCY */}
                    <td
                      className={`${cellClass} ${col.frequency}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {(row.frequency && row.frequency !== "Select"
                            ? row.frequency
                            : ""
                          ).trim() || "-"}
                        </div>
                      ) : (
                        <select
                          value={row.frequency || "Select"}
                          disabled={locked}
                          onChange={(e) =>
                            handleUpdateRow(index, "frequency", e.target.value)
                          }
                          onKeyDown={handleCellKeyDown}
                          className="w-full min-w-0 cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          style={borderStyle}
                        >
                          {frequencyOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* REPAYMENT */}
                    <td
                      className={`${cellClass} ${col.repayment}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {formatRoCurrency(row.installment)}
                        </div>
                      ) : (
                        <div
                          className={`flex min-w-0 items-center rounded border ${
                            locked ? "bg-slate-50 dark:bg-slate-800/80" : "bg-white dark:bg-slate-900"
                          }`}
                          style={borderStyle}
                        >
                          <span className="shrink-0 pl-2 text-xs text-slate-400 dark:text-slate-500">
                            $
                          </span>
                          <input
                            type="text"
                            readOnly={locked}
                            value={row.installment ?? ""}
                            onChange={(e) => {
                              const raw = sanitizeDecimalInput(e.target.value);
                              handleUpdateRow(
                                index,
                                "installment",
                                formatNumberUSForInput(raw),
                              );
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") {
                                handleUpdateRow(index, "installment", "");
                                lastKeyWasEnterRef.current = false;
                                return;
                              }
                              const wasEnter = lastKeyWasEnterRef.current;
                              lastKeyWasEnterRef.current = false;
                              if (!wasEnter) {
                                const clean = sanitizeDecimalInput(raw);
                                if (clean === "") {
                                  handleUpdateRow(index, "installment", "");
                                } else {
                                  const n = parseNum(clean);
                                  handleUpdateRow(
                                    index,
                                    "installment",
                                    Number.isNaN(n)
                                      ? formatNumberUSForInput(clean)
                                      : formatNumberUS(n),
                                  );
                                }
                                return;
                              }
                              const num = parseNum(raw);
                              if (!Number.isNaN(num)) {
                                handleUpdateRow(
                                  index,
                                  "installment",
                                  formatNumberUS(num),
                                );
                              }
                            }}
                            onKeyDown={handleCellKeyDown}
                            placeholder="0"
                            className="flex-1 min-w-[7ch] max-w-[10ch] border-0 bg-transparent py-1.5 pl-1 pr-2 text-left text-xs text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                        </div>
                      )}
                    </td>

                    {/* DATE OF LAST PYMT */}
                    <td
                      className={`${cellClass} ${col.lastPaymentDate}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {isoLastPymt ? toUSFormat(isoLastPymt) : "-"}
                        </div>
                      ) : (
                        <div
                          className={`relative w-full min-w-0 min-h-[34px] ${
                            locked
                              ? "cursor-default pointer-events-none"
                              : "cursor-pointer"
                          }`}
                          role="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            const dateInput =
                              e.currentTarget.querySelector<HTMLInputElement>(
                                'input[type="date"]',
                              );
                            if (dateInput) {
                              if (
                                typeof (dateInput as any).showPicker ===
                                "function"
                              ) {
                                (dateInput as any).showPicker();
                              } else {
                                dateInput.click();
                              }
                            }
                          }}
                        >
                          <input
                            type="text"
                            readOnly
                            value={isoLastPymt ? toUSFormat(isoLastPymt) : ""}
                            placeholder="MM/DD/YYYY"
                            className="w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 placeholder-slate-400 shadow-sm pointer-events-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                            style={borderStyle}
                          />
                          <input
                            type="date"
                            value={isoLastPymt}
                            min={isoStart || undefined}
                            disabled={locked}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (!raw) {
                                handleUpdateRow(index, "lastPaymentDate", "");
                                return;
                              }
                              if (isoStart && raw < isoStart) {
                                handleUpdateRow(index, "lastPaymentDate", isoStart);
                                return;
                              }
                              handleUpdateRow(index, "lastPaymentDate", raw);
                            }}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              handleCellKeyDown(e);
                            }}
                            className="absolute inset-0 w-full h-full border-0 rounded min-h-0 opacity-0 z-10 cursor-pointer"
                            style={{
                              border: "none",
                              padding: 0,
                              fontSize: "inherit",
                            }}
                            title={
                              isoStart
                                ? "Select date (on or after start date; future dates allowed)"
                                : "Select date (set start date first to enforce minimum)"
                            }
                          />
                        </div>
                      )}
                    </td>

                    {/* MONTHLY PMTS */}
                    <td
                      className={`${cellClass} ${col.monthlyMcaPmts}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {formatRoCurrency(row.monthlyMcaPmts)}
                        </div>
                      ) : (
                        <div
                          className={`flex min-w-0 items-center rounded border ${
                            locked ? "bg-slate-50 dark:bg-slate-800/80" : "bg-white dark:bg-slate-900"
                          }`}
                          style={borderStyle}
                        >
                          <span className="shrink-0 pl-2 text-xs text-slate-400 dark:text-slate-500">
                            $
                          </span>
                          <input
                            type="text"
                            readOnly={locked}
                            value={row.monthlyMcaPmts ?? ""}
                            onChange={(e) => {
                              const raw = sanitizeDecimalInput(e.target.value);
                              handleUpdateRow(
                                index,
                                "monthlyMcaPmts",
                                formatNumberUSForInput(raw),
                              );
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") {
                                handleUpdateRow(index, "monthlyMcaPmts", "");
                                lastKeyWasEnterRef.current = false;
                                return;
                              }
                              const wasEnter = lastKeyWasEnterRef.current;
                              lastKeyWasEnterRef.current = false;
                              if (!wasEnter) {
                                const clean = sanitizeDecimalInput(raw);
                                if (clean === "") {
                                  handleUpdateRow(index, "monthlyMcaPmts", "");
                                } else {
                                  const n = parseNum(clean);
                                  handleUpdateRow(
                                    index,
                                    "monthlyMcaPmts",
                                    Number.isNaN(n)
                                      ? formatNumberUSForInput(clean)
                                      : formatNumberUS(n),
                                  );
                                }
                                return;
                              }
                              const num = parseNum(raw);
                              if (!Number.isNaN(num)) {
                                handleUpdateRow(
                                  index,
                                  "monthlyMcaPmts",
                                  formatNumberUS(num),
                                );
                              }
                            }}
                            onKeyDown={handleCellKeyDown}
                            placeholder="0"
                            className="flex-1 min-w-[7ch] max-w-[70%] border-0 bg-transparent px-2 py-1.5 text-left text-xs text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                        </div>
                      )}
                    </td>

                    {/* TOTAL REPAYMENTS = obligation (Amount Funded × 1.49); computed, read-only */}
                    <td
                      className={`${cellClass} ${col.totalRepayments}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {formatRoCurrency(
                            row.totalRepayments ??
                              (() => {
                                const ob = getObligation(row);
                                return Number.isNaN(ob) || ob < 0
                                  ? ""
                                  : formatNumberUS(ob);
                              })(),
                          )}
                        </div>
                      ) : (
                        <div
                          className="flex min-w-0 items-center rounded border bg-slate-50 dark:bg-slate-800/80"
                          style={borderStyle}
                        >
                          <span className="shrink-0 pl-2 text-xs text-slate-400 dark:text-slate-500">
                            $
                          </span>
                          <input
                            type="text"
                            readOnly
                            value={
                              row.totalRepayments ??
                              (() => {
                                const ob = getObligation(row);
                                return Number.isNaN(ob) || ob < 0 ? "" : formatNumberUS(ob);
                              })()
                            }
                            onKeyDown={handleCellKeyDown}
                            placeholder="-"
                            className="flex-1 min-w-[7ch] max-w-[70%] border-0 bg-transparent px-2 py-1.5 text-left text-xs text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                        </div>
                      )}
                    </td>

                    {/* HIDDEN EST COLUMNS (body rows): columns commented out — change false to true to restore EST. BALANCE, TERM, LEFT, MCA % */}
                    {false && (
                      <>
                    {/* EST. BALANCE: (Amount Funded × 1.49) − Amount paid to date; read-only */}
                    <td
                      className={`${cellClass} ${col.mcaEstBalance}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        (() => {
                          const balNum = parseNum(row.mcaEstBalance);
                          const hideForPif =
                            (status === "PIF" || status === "ONE TIME" || status === "STOP") &&
                            (Number.isNaN(balNum) || balNum === 0);
                          if (hideForPif) {
                            return <div className={roCellInner}>-</div>;
                          }
                          const displayBalance =
                            row.mcaEstBalance ??
                            (() => {
                              const b = computedEstBalance(row);
                              return Number.isNaN(b) ? "" : formatNumberUS(b);
                            })();
                          return (
                            <div className={roCellInner}>
                              {formatRoCurrency(displayBalance)}
                            </div>
                          );
                        })()
                      ) : (
                        (() => {
                          const balNum = parseNum(row.mcaEstBalance);
                          const hideForPif =
                            (status === "PIF" || status === "ONE TIME" || status === "STOP") &&
                            (Number.isNaN(balNum) || balNum === 0);

                          if (hideForPif) {
                            return (
                              <div className="flex min-w-0 items-center rounded border bg-slate-50 dark:bg-slate-800/80" style={borderStyle}>
                                <span className="shrink-0 pl-2 text-xs text-slate-400 dark:text-slate-500">
                                  $
                                </span>
                                <span className="flex-1 min-w-[7ch] max-w-[70%] px-2 py-1.5 text-xs text-slate-400 dark:text-slate-500">
                                  -
                                </span>
                              </div>
                            );
                          }

                          const displayBalance =
                            row.mcaEstBalance ??
                            (() => {
                              const b = computedEstBalance(row);
                              return Number.isNaN(b) ? "" : formatNumberUS(b);
                            })();
                          return (
                            <div
                              className="flex min-w-0 items-center rounded border bg-slate-50 dark:bg-slate-800/80"
                              style={borderStyle}
                            >
                              <span className="shrink-0 pl-2 text-xs text-slate-400 dark:text-slate-500">
                                $
                              </span>
                              <input
                                type="text"
                                readOnly
                                value={displayBalance}
                                onKeyDown={handleCellKeyDown}
                                placeholder="-"
                                className="flex-1 min-w-[7ch] max-w-[70%] border-0 bg-transparent px-2 py-1.5 text-left text-xs text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                              />
                            </div>
                          );
                        })()
                      )}
                    </td>

                    {/* EST. PMTS TERM */}
                    <td
                      className={`${cellClass} ${col.paymentTerm}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {formatRoInteger(row.paymentTerm)}
                        </div>
                      ) : (
                        <input
                          type="text"
                          readOnly={locked}
                          value={row.paymentTerm ?? ""}
                          onChange={(e) => {
                            const raw = sanitizeDecimalInput(e.target.value);
                            handleUpdateRow(index, "paymentTerm", formatNumberUSForInput(raw));
                          }}
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            if (raw === "") {
                              handleUpdateRow(index, "paymentTerm", "");
                              return;
                            }
                            const num = parseNum(raw);
                            if (!Number.isNaN(num) && num >= 0) {
                              handleUpdateRow(index, "paymentTerm", String(Math.round(num)));
                            }
                          }}
                          onKeyDown={handleCellKeyDown}
                          placeholder="e.g. 90"
                          className={`w-full min-w-[6ch] rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 text-left shadow-sm focus:outline-none dark:border-slate-600 dark:text-slate-100 ${
                            locked ? "bg-slate-50 dark:bg-slate-800/80" : "bg-white dark:bg-slate-900"
                          }`}
                          style={borderStyle}
                        />
                      )}
                    </td>

                    {/* EST. PMTS LEFT (computed: EST. PMTS TERM − Payments Made; 0 or uncalculated → "-") */}
                    <td
                      className={`${cellClass} ${col.pmtsLeft}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {(() => {
                            const p = row.pmtsLeft != null && row.pmtsLeft !== ""
                              ? parseNum(row.pmtsLeft)
                              : computedPmtsLeft(row);
                            if (Number.isNaN(p) || p < 0) return "-";
                            const n = Math.round(p);
                            return n === 0 ? "-" : String(n);
                          })()}
                        </div>
                      ) : (
                        <input
                          type="text"
                          readOnly
                          value={(() => {
                            const p = row.pmtsLeft != null && row.pmtsLeft !== ""
                              ? parseNum(row.pmtsLeft)
                              : computedPmtsLeft(row);
                            if (Number.isNaN(p) || p < 0) return "-";
                            const n = Math.round(p);
                            return n === 0 ? "-" : String(n);
                          })()}
                          onKeyDown={handleCellKeyDown}
                          placeholder="-"
                          className="w-full min-w-[5ch] rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm focus:outline-none dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100"
                          style={borderStyle}
                        />
                      )}
                    </td>

                    {/* EST. MCA % PAID (computed; PIF or 0/uncalculated → "-") */}
                    <td
                      className={`${cellClass} ${col.mcaPercentPaid}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {status === "PIF" || status === "ONE TIME" || status === "STOP"
                            ? "-"
                            : (() => {
                                const p =
                                  row.mcaPercentPaid != null && row.mcaPercentPaid !== ""
                                    ? parseNum(row.mcaPercentPaid)
                                    : computedMcaPercentPaid(row);
                                if (Number.isNaN(p) || p < 0 || p === 0) return "-";
                                return formatPercentUS(p);
                              })()}
                        </div>
                      ) : status === "PIF" || status === "ONE TIME" || status === "STOP" ? (
                        <div
                          className="flex min-w-0 items-center rounded border bg-slate-50 dark:bg-slate-800/80"
                          style={borderStyle}
                        >
                          <span className="flex-1 min-w-[6ch] max-w-[10ch] px-2 py-1.5 text-xs text-slate-400 dark:text-slate-500">
                            -
                          </span>
                          <span className="shrink-0 pr-2 text-xs text-slate-400 dark:text-slate-500">
                            %
                          </span>
                        </div>
                      ) : (
                        <div
                          className="flex min-w-0 items-center rounded border bg-slate-50 dark:bg-slate-800/80"
                          style={borderStyle}
                        >
                          <input
                            type="text"
                            readOnly
                            value={(() => {
                              const p = row.mcaPercentPaid != null && row.mcaPercentPaid !== ""
                                ? parseNum(row.mcaPercentPaid)
                                : computedMcaPercentPaid(row);
                              if (Number.isNaN(p) || p < 0) return "-";
                              return p === 0 ? "-" : formatNumberUS(p);
                            })()}
                            onKeyDown={handleCellKeyDown}
                            placeholder="-"
                            className="flex-1 min-w-[6ch] max-w-[10ch] border-0 bg-transparent px-2 py-1.5 text-left text-xs text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                          <span className="shrink-0 pr-2 text-xs text-slate-400 dark:text-slate-500">
                            %
                          </span>
                        </div>
                      )}
                    </td>

                      </>
                    )}

                    {/* EST. Lvg: auto from Monthly Pmts / Avg Net Credit; PIF: "-" */}
                    <td
                      className={`${cellClass} ${col.mcaRemit}`}
                      style={borderStyle}
                    >
                      {readMode ? (
                        <div className={roCellInner}>
                          {status === "PIF" ||
                          status === "ONE TIME" ||
                          status === "STOP" ||
                          status === "REFI"
                            ? "-"
                            : (() => {
                                const raw = row.mcaRemit ?? "";
                                const n = parseNum(raw);
                                if (String(raw).trim() === "" || Number.isNaN(n)) return "-";
                                return formatPercentUS(n);
                              })()}
                        </div>
                      ) : status === "PIF" ||
                        status === "ONE TIME" ||
                        status === "STOP" ||
                        status === "REFI" ? (
                        <div
                          className="flex min-w-0 items-center rounded border bg-slate-50 dark:bg-slate-800/80"
                          style={borderStyle}
                        >
                          <span className="flex-1 min-w-[6ch] max-w-[10ch] px-2 py-1.5 text-xs text-slate-400 dark:text-slate-500">
                            -
                          </span>
                          <span className="shrink-0 pr-2 text-xs text-slate-400 dark:text-slate-500">
                            %
                          </span>
                        </div>
                      ) : (
                        <div
                          className={`flex min-w-0 items-center rounded border ${
                            locked ? "bg-slate-50 dark:bg-slate-800/80" : "bg-white dark:bg-slate-900"
                          }`}
                          style={borderStyle}
                        >
                          <input
                            type="text"
                            readOnly={locked}
                            value={row.mcaRemit ?? ""}
                            onChange={(e) => {
                              const raw = sanitizeDecimalInput(e.target.value);
                              handleUpdateRow(index, "mcaRemit", formatNumberUSForInput(raw));
                            }}
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "") {
                                handleUpdateRow(index, "mcaRemit", "");
                                return;
                              }
                              const num = parseNum(raw);
                              if (!Number.isNaN(num)) {
                                handleUpdateRow(index, "mcaRemit", num.toFixed(2));
                              }
                            }}
                            onKeyDown={handleCellKeyDown}
                            placeholder="0"
                            className="flex-1 min-w-[6ch] max-w-[10ch] border-0 bg-transparent px-2 py-1.5 text-left text-xs text-slate-800 placeholder-slate-400 focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                          <span className="shrink-0 pr-2 text-xs text-slate-400 dark:text-slate-500">
                            %
                          </span>
                        </div>
                      )}
                    </td>

                    {!isReadOnly && (
                      <td
                        className={`${cellClass} ${col.action}`}
                        style={borderStyle}
                      >
                        <div className="flex items-center gap-1 justify-center">
                          {locked ? (
                            <button
                              type="button"
                              onClick={() => handleUnlockRow(index)}
                              disabled={isBusy}
                              className="cursor-pointer text-slate-600 hover:text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none p-1 inline-flex items-center justify-center"
                              title="Edit position"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          ) : effectiveHideRowSave ? (
                            isSaving ? (
                              <span className="text-emerald-600 p-1 inline-flex items-center justify-center">
                                <Loader2 className="w-4 h-4 animate-spin" />
                              </span>
                            ) : null
                          ) : (
                            <button
                              type="button"
                              onClick={() => void persistRow(index, rows[index])}
                              disabled={isBusy}
                              className="text-emerald-600 cursor-pointer hover:text-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none p-1 inline-flex items-center justify-center"
                              title="Save and lock"
                            >
                              {isSaving ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                            </button>
                          )}
                          {!isDeleteDisabled && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(index)}
                              disabled={isBusy}
                              className="text-red-600 cursor-pointer hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none p-1 inline-flex items-center justify-center"
                              title="Remove position"
                            >
                              {isDeleting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr
              className="text-sm text-slate-800 dark:text-slate-100 [&_td]:tabular-nums [&>td]:bg-slate-100/80 dark:[&>td]:bg-slate-800/80 [&>td:first-child]:rounded-bl-xl [&>td:last-child]:rounded-br-xl"
              style={borderStyle}
            >
              <td
                className={`${footTdClass} ${col.lender}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    <span className="font-semibold uppercase tracking-wide">TOTAL</span>
                  </div>
                ) : (
                  <div className="flex w-full min-w-0 items-center justify-start">
                    <span className="text-left text-sm font-semibold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                      TOTAL
                    </span>
                  </div>
                )}
              </td>
              <td
                className={`${footTdClass} ${col.startingDate}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>-</div>
                ) : (
                  <FootPlainEditCell>-</FootPlainEditCell>
                )}
              </td>
              <td
                className={`${footTdClass} ${col.amountFunded}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {amountFundedSum > 0
                      ? `$ ${formatNumberUS(amountFundedSum)}`
                      : "-"}
                  </div>
                ) : (
                  <FootCurrencyEditCell
                    variant="amount"
                    numberText={
                      amountFundedSum > 0
                        ? formatNumberUS(amountFundedSum)
                        : "-"
                    }
                  />
                )}
              </td>
              <td
                className={`${footTdClass} ${col.status}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>-</div>
                ) : (
                  <FootPlainEditCell>-</FootPlainEditCell>
                )}
              </td>
              <td
                className={`${footTdClass} ${col.frequency}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>-</div>
                ) : (
                  <FootPlainEditCell>-</FootPlainEditCell>
                )}
              </td>
              <td
                className={`${footTdClass} ${col.repayment}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {repaymentSum > 0
                      ? `$ ${formatNumberUS(repaymentSum)}`
                      : "-"}
                  </div>
                ) : (
                  <FootCurrencyEditCell
                    variant="repay"
                    numberText={
                      repaymentSum > 0 ? formatNumberUS(repaymentSum) : "-"
                    }
                  />
                )}
              </td>
              <td
                className={`${footTdClass} ${col.lastPaymentDate}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>-</div>
                ) : (
                  <FootPlainEditCell>-</FootPlainEditCell>
                )}
              </td>
              <td
                className={`${footTdClass} ${col.monthlyMcaPmts}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {monthlyMcaPmtsSum > 0
                      ? `$ ${formatNumberUS(monthlyMcaPmtsSum)}`
                      : "-"}
                  </div>
                ) : (
                  <FootCurrencyEditCell
                    variant="widePx"
                    numberText={
                      monthlyMcaPmtsSum > 0
                        ? formatNumberUS(monthlyMcaPmtsSum)
                        : "-"
                    }
                  />
                )}
              </td>
              <td
                className={`${footTdClass} ${col.totalRepayments}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {totalRepaymentsSum > 0
                      ? `$ ${formatNumberUS(totalRepaymentsSum)}`
                      : "-"}
                  </div>
                ) : (
                  <FootCurrencyEditCell
                    variant="widePx"
                    numberText={
                      totalRepaymentsSum > 0
                        ? formatNumberUS(totalRepaymentsSum)
                        : "-"
                    }
                  />
                )}
              </td>
              {/* HIDDEN EST COLUMNS (footer): change false to true to restore */}
              {false && (
                <>
              <td
                className={`${footTdClass} ${col.mcaEstBalance}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {positionsForTotalsCount > 0
                      ? `$ ${formatNumberUS(mcaEstBalanceSum)}`
                      : "-"}
                  </div>
                ) : (
                  <FootCurrencyEditCell
                    variant="widePx"
                    numberText={
                      positionsForTotalsCount > 0
                        ? formatNumberUS(mcaEstBalanceSum)
                        : "-"
                    }
                  />
                )}
              </td>
              <td
                className={`${footTdClass} ${col.paymentTerm}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {paymentTermSum > 0 ? String(Math.round(paymentTermSum)) : "-"}
                  </div>
                ) : (
                  <FootPlainEditCell>
                    {paymentTermSum > 0
                      ? String(Math.round(paymentTermSum))
                      : "-"}
                  </FootPlainEditCell>
                )}
              </td>
              <td
                className={`${footTdClass} ${col.pmtsLeft}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {positionsForTotalsCount > 0
                      ? String(Math.round(pmtsLeftSum))
                      : "-"}
                  </div>
                ) : (
                  <FootPlainEditCell>
                    {positionsForTotalsCount > 0
                      ? String(Math.round(pmtsLeftSum))
                      : "-"}
                  </FootPlainEditCell>
                )}
              </td>
              <td
                className={`${footTdClass} ${col.mcaPercentPaid}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {positionsForTotalsCount > 0
                      ? formatPercentUS(mcaPercentPaidSum || 0)
                      : "-"}
                  </div>
                ) : (
                  <FootPercentEditCell
                    valueText={
                      positionsForTotalsCount > 0
                        ? formatPercentUS(mcaPercentPaidSum || 0)
                        : "-"
                    }
                  />
                )}
              </td>
                </>
              )}
              <td
                className={`${footTdClass} ${col.mcaRemit}`}
                style={borderStyle}
              >
                {isReadOnly ? (
                  <div className={footCellCenter}>
                    {positionsForTotalsCount > 0
                      ? formatPercentUS(mcaRemitSum || 0)
                      : "-"}
                  </div>
                ) : (
                  <FootPercentEditCell
                    valueText={
                      positionsForTotalsCount > 0
                        ? formatPercentUS(mcaRemitSum || 0)
                        : "-"
                    }
                  />
                )}
              </td>
              {!isReadOnly && (
                <td
                  className={`${footTdClass} ${col.action}`}
                  style={borderStyle}
                >
                  <div className={footCellCenter}>{/* empty */}</div>
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      {allocationModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-[#141517]">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Allocate Amount Funded to Bank Analysis
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              This case has multiple bank analyses. Select where this Amount Funded should be allocated for the matching month.
            </p>
            <div className="mt-4 space-y-2">
              {bankAllocationOptions.map((opt) => (
                <label key={opt.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="radio"
                    name="allocated-bank-analysis"
                    checked={allocationModal.selectedBankId === opt.id}
                    onChange={() =>
                      setAllocationModal((prev) => ({ ...prev, selectedBankId: opt.id }))
                    }
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="cursor-pointer rounded border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() =>
                  setAllocationModal({ open: false, rowIndex: -1, selectedBankId: null })
                }
              >
                Cancel
              </button>
              <Button
                type="button"
                variant="default"
                disabled={!allocationModal.selectedBankId}
                className="px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  if (allocationModal.rowIndex >= 0 && allocationModal.selectedBankId) {
                    handleUpdateRow(
                      allocationModal.rowIndex,
                      "allocatedBankAnalysisId",
                      String(allocationModal.selectedBankId) as any,
                    );
                  }
                  setAllocationModal({ open: false, rowIndex: -1, selectedBankId: null });
                }}
              >
                Allocate
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
