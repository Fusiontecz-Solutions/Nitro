"use client";

import { useMemo, memo } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
} from "recharts";
import { formatNumberUS } from "./utils/dateUtils";
import { parseMonthLabelToYYYYMM } from "./utils/calculateMonthlyNetCredit";

const MONTH_ORDER = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseNum(str) {
  if (str == null || str === "") return NaN;
  if (typeof str === "number") return Number.isFinite(str) ? str : NaN;
  if (typeof str === "object") {
    if (str.$numberDecimal != null) return parseNum(str.$numberDecimal);
    if (typeof str.toJSON === "function") {
      try {
        return parseNum(str.toJSON());
      } catch {
        /* ignore */
      }
    }
  }
  const asText = String(str).trim();
  if (!asText || asText === "[object Object]") return NaN;
  return Number(asText.replace(/[^0-9.-]+/g, ""));
}

function monthNameToIndex(name) {
  if (!name) return -1;
  const n = String(name).trim().toLowerCase();
  const idx = MONTH_ORDER.indexOf(n);
  if (idx >= 0) return idx;
  const short = n.slice(0, 3);
  for (let i = 0; i < MONTH_ORDER.length; i++) {
    if (MONTH_ORDER[i].startsWith(short)) return i;
  }
  return -1;
}

function isSummaryMonthRow(row) {
  const t = String(row?.month ?? "").trim().toLowerCase();
  if (!t) return true;
  if (t === "average" || t === "total") return true;
  if (t.includes("average")) return true;
  if (t === "bank total" || t.startsWith("total ")) return true;
  return false;
}

function periodKeyFromMonthLabel(monthRaw) {
  const raw = String(monthRaw || "").trim();
  const lower = raw.toLowerCase();
  const isMtd = lower.includes("mtd");
  const withoutMtd = raw.replace(/mtd/ig, " ").replace(/\s+/g, " ").trim();
  const firstWord = withoutMtd.split(/\s+/)[0] || "";
  const idx = monthNameToIndex(firstWord);
  const yearMatch = raw.match(/\b(20\d{2}|19\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : "";
  if (idx >= 0) return `${MONTH_ORDER[idx]}|${year}|${isMtd ? "mtd" : "full"}`;
  return lower;
}

function displayLabelFromMonth(monthRaw) {
  const raw = String(monthRaw || "").trim();
  const isMtd = raw.toLowerCase().includes("mtd");
  const withoutMtd = raw.replace(/mtd/ig, " ").replace(/\s+/g, " ").trim();
  const firstWord = withoutMtd.split(/\s+/)[0] || "";
  const idx = monthNameToIndex(firstWord);
  const yearMatch = raw.match(/\b(20\d{2}|19\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : "";
  if (idx >= 0) {
    const short = SHORT_MONTHS[idx];
    if (isMtd) return year ? `${short} ${year} MTD` : `${short} MTD`;
    return year ? `${short} ${year}` : short;
  }
  return raw;
}

function isBankAnalysisDataRow(row) {
  if (!row || typeof row !== "object") return false;
  if (isSummaryMonthRow(row)) return false;
  const monthRaw = row.month != null ? String(row.month).trim() : "";
  if (!monthRaw) return false;
  if (Object.prototype.hasOwnProperty.call(row, "lender") && !Object.prototype.hasOwnProperty.call(row, "totalCredits")) {
    return false;
  }
  return true;
}

function fundingAmtFromBankRow(row, bankIndex, allocByBankAndMonth, privateRoleFundingLoanRule) {
  const stored = parseNum(row?.loan);
  const baseSafe = Number.isNaN(stored) ? 0 : stored;
  if (!allocByBankAndMonth || typeof allocByBankAndMonth !== "object") return baseSafe;
  const perBank = allocByBankAndMonth[bankIndex];
  if (!perBank || typeof perBank !== "object") return baseSafe;
  const label = row?.month != null ? String(row.month).trim() : "";
  if (!label || !Object.prototype.hasOwnProperty.call(perBank, label)) return baseSafe;
  const extraRaw = perBank[label];
  const extraSafe = Array.isArray(extraRaw)
    ? extraRaw.reduce((sum, n) => sum + (Number(n) || 0), 0)
    : (Number.isNaN(parseNum(extraRaw)) ? 0 : parseNum(extraRaw));
  if (privateRoleFundingLoanRule) return Math.max(baseSafe, extraSafe);
  return baseSafe > 0 ? baseSafe : extraSafe > 0 ? extraSafe : baseSafe;
}

/**
 * Same Net Credit value as the Bank Analysis table cell:
 * Total Credit − (Funding Amt + Transfers + Unverified Deposit + Other).
 * Never reads amountFunded, positions, or stored row.netCredit (which can still
 * be the pre-funding total).
 */
function bankAnalysisTableNetCredit(row, bankIndex, allocByBankAndMonth, privateRoleFundingLoanRule) {
  const totalCredits = parseNum(row?.totalCredits);
  if (Number.isNaN(totalCredits)) return NaN;
  const loan = fundingAmtFromBankRow(row, bankIndex, allocByBankAndMonth, privateRoleFundingLoanRule);
  const transfer = Number.isNaN(parseNum(row?.transfer)) ? 0 : parseNum(row.transfer);
  const deposite = Number.isNaN(parseNum(row?.deposite)) ? 0 : parseNum(row.deposite);
  const other = Number.isNaN(parseNum(row?.other)) ? 0 : parseNum(row.other);
  return totalCredits - (loan + transfer + deposite + other);
}

function accumulateMonthValue(byMonth, monthRaw, amount) {
  if (Number.isNaN(amount)) return;
  const key = periodKeyFromMonthLabel(monthRaw);
  if (!byMonth.has(key)) {
    byMonth.set(key, {
      key,
      label: displayLabelFromMonth(monthRaw),
      value: 0,
      yyyyMm: parseMonthLabelToYYYYMM(monthRaw),
      isMtd: String(monthRaw).toLowerCase().includes("mtd"),
    });
  }
  byMonth.get(key).value += amount;
}

function seriesFromMonthMap(byMonth) {
  return Array.from(byMonth.values())
    .filter((d) => typeof d.value === "number" && !Number.isNaN(d.value))
    .sort(compareChartPeriodsChronologically)
    .map(({ key, label, value, yyyyMm, isMtd }) => ({
      key,
      label,
      value,
      yyyyMm,
      isMtd,
    }));
}

/** Sum Bank Analysis Net Credit across all bank tables for each real month/period. */
export function totalNetCreditByMonth(
  bankTables = [],
  allocByBankAndMonth = null,
  privateRoleFundingLoanRule = false
) {
  const byMonth = new Map();
  (Array.isArray(bankTables) ? bankTables : []).forEach((table, bankIndex) => {
    (Array.isArray(table) ? table : []).forEach((row) => {
      if (!isBankAnalysisDataRow(row)) return;
      const monthRaw = String(row.month).trim();
      const net = bankAnalysisTableNetCredit(
        row,
        bankIndex,
        allocByBankAndMonth,
        privateRoleFundingLoanRule
      );
      accumulateMonthValue(byMonth, monthRaw, net);
    });
  });
  return seriesFromMonthMap(byMonth);
}

/**
 * Sum Bank Analysis / Bank Total "Total Credit" (`row.totalCredits`) across all
 * bank tables for each real month/period. Never reads positions, amount funded,
 * net credit, or other numeric fallbacks.
 */
export function totalCreditByMonth(bankTables = []) {
  const byMonth = new Map();
  (Array.isArray(bankTables) ? bankTables : []).forEach((table) => {
    (Array.isArray(table) ? table : []).forEach((row) => {
      if (!isBankAnalysisDataRow(row)) return;
      const monthRaw = String(row.month).trim();
      accumulateMonthValue(byMonth, monthRaw, parseNum(row?.totalCredits));
    });
  });
  return seriesFromMonthMap(byMonth);
}

function mergeCreditTrendSeries(netRows = [], creditRows = []) {
  const byKey = new Map();
  const ensure = (row) => {
    const key = row?.key || row?.label;
    if (!key) return null;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        label: row.label,
        netCredit: null,
        totalCredit: null,
        yyyyMm: row.yyyyMm,
        isMtd: row.isMtd,
      });
    }
    return byKey.get(key);
  };
  netRows.forEach((row) => {
    const entry = ensure(row);
    if (!entry) return;
    if (typeof row.value === "number" && !Number.isNaN(row.value)) {
      entry.netCredit = row.value;
    }
  });
  creditRows.forEach((row) => {
    const entry = ensure(row);
    if (!entry) return;
    if (typeof row.value === "number" && !Number.isNaN(row.value)) {
      entry.totalCredit = row.value;
    }
  });
  return Array.from(byKey.values())
    .filter((d) => d.netCredit != null || d.totalCredit != null)
    .sort(compareChartPeriodsChronologically)
    .map(({ label, netCredit, totalCredit }) => ({
      label,
      netCredit,
      totalCredit,
    }));
}

function compareChartPeriodsChronologically(a, b) {
  const ka = a?.yyyyMm || "";
  const kb = b?.yyyyMm || "";
  if (ka && kb && ka !== kb) return ka < kb ? -1 : 1;
  if (ka && !kb) return -1;
  if (!ka && kb) return 1;
  const aMtd = a?.isMtd ? 1 : 0;
  const bMtd = b?.isMtd ? 1 : 0;
  if (aMtd !== bMtd) return aMtd - bMtd;
  return 0;
}

const BAR_CHART_HEIGHT = 224;
const NET_CREDIT_BAR_COLOR = "#3b82f6";
const TOTAL_CREDIT_BAR_COLOR = "#0d9488";

function formatChartCurrency(value) {
  if (value == null || (typeof value === "number" && Number.isNaN(value))) return "—";
  return `$ ${formatNumberUS(value)}`;
}

function CreditTrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const net = payload.find((p) => p.dataKey === "netCredit")?.value ?? row.netCredit;
  const credit = payload.find((p) => p.dataKey === "totalCredit")?.value ?? row.totalCredit;
  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 14,
        color: "#0f172a",
        boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div>Net Credit: {formatChartCurrency(net)}</div>
      <div>Total Credit: {formatChartCurrency(credit)}</div>
    </div>
  );
}

const cardStyle = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  padding: "14px",
  border: "1px solid #e2e8f0",
  borderRadius: "12px",
  backgroundColor: "#ffffff",
  boxSizing: "border-box",
  display: "block",
};

const titleStyle = {
  fontWeight: "bold",
  fontSize: "16px",
  marginBottom: "12px",
  textAlign: "left",
  color: "#0f172a",
};

const legendRowStyle = {
  display: "flex",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 12,
  flex: "0 0 auto",
  fontSize: 13,
  lineHeight: "14px",
  color: "#475569",
  marginBottom: 4,
};

const legendSwatchStyle = (color) => ({
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  backgroundColor: color,
  marginRight: 5,
  verticalAlign: "middle",
});

const MonthlyBarChart = memo(function MonthlyBarChart({ data }) {
  if (!data || data.length === 0) return null;

  return (
    <div
      data-chart-kind="bar"
      style={{
        width: "100%",
        height: BAR_CHART_HEIGHT,
        minWidth: 0,
        overflow: "visible",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        [data-chart-kind="bar"] .recharts-wrapper,
        [data-chart-kind="bar"] .recharts-surface {
          overflow: visible !important;
        }
      `}</style>
      <div style={legendRowStyle}>
        <span>
          <span style={legendSwatchStyle(NET_CREDIT_BAR_COLOR)} />
          Net Credit
        </span>
        <span>
          <span style={legendSwatchStyle(TOTAL_CREDIT_BAR_COLOR)} />
          Total Credit
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: 10, bottom: 4 }}
            barGap={3}
            barCategoryGap="28%"
            barSize={22}
          >
            <XAxis dataKey="label" tick={{ fontSize: 13, fill: "#64748b" }} axisLine tickLine={false} />
            <YAxis
              width={84}
              tickFormatter={formatNumberUS}
              tick={{ fontSize: 13, fill: "#94a3b8" }}
              axisLine
              tickLine={false}
            />
            <Tooltip content={<CreditTrendTooltip />} />
            <Bar
              dataKey="netCredit"
              name="Total Net Credit"
              fill={NET_CREDIT_BAR_COLOR}
              isAnimationActive={false}
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="totalCredit"
              name="Total Credit"
              fill={TOTAL_CREDIT_BAR_COLOR}
              isAnimationActive={false}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export default memo(function CreditsTrendChart({
  bankTables = [],
  loanTransferAllocatedByBankAndMonth = null,
  privateRoleFundingLoanRule = false,
}) {
  const monthlyData = useMemo(() => {
    const netSeries = totalNetCreditByMonth(
      bankTables,
      loanTransferAllocatedByBankAndMonth,
      privateRoleFundingLoanRule
    );
    const creditSeries = totalCreditByMonth(bankTables);
    return mergeCreditTrendSeries(netSeries, creditSeries);
  }, [bankTables, loanTransferAllocatedByBankAndMonth, privateRoleFundingLoanRule]);

  if (!monthlyData.length) return null;

  return (
    <div
      className="chart-capture-area"
      style={{
        display: "block",
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
      }}
    >
      <div className="chart-cell" style={cardStyle}>
        <div style={titleStyle}>Credits Trend</div>
        <MonthlyBarChart data={monthlyData} />
      </div>
    </div>
  );
});
