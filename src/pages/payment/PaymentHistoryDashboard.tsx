import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import {
  fetchPaymentFailedSummary,
  fetchPaymentFinancialOverviewSummary,
} from "@/redux/actions/paymentDashboardActions";
import { fetchPaymentDashboardFundedDeals } from "@/redux/actions/paymentDashboardCohortActions";
import { fetchPaymentDashboardMoney } from "@/redux/actions/paymentDashboardMoneyActions";
import { axiosPost, axiosPostFormData } from "@/redux/axios";
import type { FundedDealBalanceApiRow } from "@/lib/collectionPaymentDashboardApi";
import type { Application } from "@/types/applicationTypes";
import { buildPaymentFundedCohortParams } from "@/lib/paymentDashboardFunded";
import type { MoneyFlowPoint, PaymentDashboardData } from "@/types/paymentDashboardTypes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrencyFull } from "@/lib/utils";
import { calculateFinancialsFromCollectionPayments } from "@/utils/collectionPaymentRepaid";
import { DataTableContent, DataTablePagination } from "@/components/DataTable";
import {
  type ColumnDef,
  type PaginationState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useTheme } from "@/context/ThemeContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import CreditDebitTrendChart from "./CreditDebitTrendChart";

import {
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  LayoutGrid,
  LayoutList,
  Search,
  Loader2,
  Eye,
  Upload,
  Check,
  Undo2,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { toast } from "react-toastify";

type StatCardProps = {
  title: string;
  value: string;
  /** Small bold line under the title (e.g. deal count). */
  titleMeta?: string;
  subtext?: string;
  subValue?: string;
  trend?: string;
  trendType?: "up" | "down" | "neutral";
  className?: string;
  /** Avoid misleading $0.00 while the first API request is still in flight (no cached snapshot). */
  valuePending?: boolean;
  /** Click handler — when provided the card renders as an interactive button. */
  onClick?: () => void;
  /** Accessibility label for the interactive card; falls back to the title. */
  ariaLabel?: string;
};

type MoneyFlowView = "monthly" | "weekly" | "monthlyInYear" | "yearly";

type PaymentTransactionRow = {
  id: string;
  displayId: string;
  client: string;
  date: string;
  dueDate: string;
  amount: number;
  paybackAmount: number;
  method: string;
  category?: string;
  balanceDue: number;
  status: string;
};

type TransactionPreviewRow = {
  rowNumber: number;
  description: string;
  dealId: string | null;
  isValid: boolean;
  validationStatus: "valid" | "invalid";
  isDuplicate?: boolean;
  rowData?: Record<string, string>;
};

type TransactionPreviewResponse = {
  success?: boolean;
  data?: {
    regex?: string;
    excelHeaders?: string[];
    totalRows?: number;
    validRows?: number;
    invalidRows?: number;
    duplicateDealIds?: string[];
    previewRows?: TransactionPreviewRow[];
  };
  message?: string;
};

type PreviewCommitPayloadRow = {
  rowNumber: number;
  dealId: string;
  description: string;
  rowData: Record<string, string>;
};

type PreviewCommitResponse = {
  success?: boolean;
  message?: string;
  data?: {
    savedCount?: number;
    failedCount?: number;
    failedRows?: Array<{ rowNumber: number; dealId: string; reason: string }>;
  };
};

type PreviewDealOption = { dealId: string; dealName: string; label: string; token: string };

/** Only persist rows whose deal exists in CRM — avoids saving to unknown / stale tokens. */
function buildStrictPreviewCommitPayloadRows(
  rows: Array<{
    rowNumber: number;
    effectiveDealToken: string;
    description?: string;
    rowData?: Record<string, string>;
  }>,
  previewDealOptionById: Map<string, PreviewDealOption>,
  mappedDealTokens: Set<string>,
): PreviewCommitPayloadRow[] {
  const out: PreviewCommitPayloadRow[] = [];
  for (const row of rows) {
    const token = normalizeDealToken(row.effectiveDealToken);
    if (!token || !mappedDealTokens.has(token)) continue;
    const canon = previewDealOptionById.get(token)?.dealId?.trim();
    if (!canon) continue;
    out.push({
      rowNumber: row.rowNumber,
      dealId: canon,
      description: String(row.description ?? "").trim(),
      rowData: row.rowData ?? {},
    });
  }
  return out;
}

/** Chunk size for Verify All — keeps each request under typical body/timeout limits. */
const PREVIEW_VERIFY_ALL_CHUNK_SIZE = 200;
/** Parallel commit requests — bounded so we do not overwhelm the server or the browser. */
const PREVIEW_VERIFY_ALL_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}
const PREVIEW_COMMIT_REQUEST_TIMEOUT_MS = 120_000;
const UNMAPPED_PREVIEW_GROUP_KEY = "__UNMAPPED_PREVIEW_GROUP__";

/**
 * Tab + badge counts: Mapped = the row's best deal-id candidate matches a funded CRM deal.
 * Uses the multi-source picker so a row whose description happens to mention an unrelated BA
 * code first still counts as mapped if it ALSO references a CRM-funded deal — keeping all
 * sibling rows for the same deal together (was previously splitting 3-row groups into 1 + 2).
 * Manual dropdown choice does not move a row to Mapped until they click Verify (row stays on Unmapped).
 */
function countPreviewTabBucketsBySheetDeal(params: {
  previewRows: TransactionPreviewRow[];
  mappedDealTokens: Set<string>;
  removedGroups: Record<string, true>;
}): { mapped: number; unmapped: number } {
  let mapped = 0;
  let unmapped = 0;
  for (const row of params.previewRows) {
    const sheetDealToken = pickBestPreviewRowDealToken(row, params.mappedDealTokens);
    const groupKey = sheetDealToken || UNMAPPED_PREVIEW_GROUP_KEY;
    const rowKey = `ROW_${row.rowNumber}`;
    if (params.removedGroups[rowKey] || params.removedGroups[groupKey]) continue;
    const matchedFromSheet =
      sheetDealToken.length > 0 && params.mappedDealTokens.has(sheetDealToken);
    if (matchedFromSheet) mapped += 1;
    else unmapped += 1;
  }
  return { mapped, unmapped };
}

/** First tab after preview opens: prefer Mapped whenever the sheet has any CRM-matched deals. */
function previewInitialTabFromBuckets(mapped: number, unmapped: number): "mapped" | "unmapped" {
  if (mapped === 0 && unmapped === 0) return "mapped";
  if (mapped > 0) return "mapped";
  return "unmapped";
}

const PAID_STATUS_KEYWORDS = ["paid", "manual", "completed", "success", "settled", "received"];
const INACTIVE_STATUS_KEYWORDS = [
  "completed",
  "cancelled",
  "declined",
  "rejected",
  "closed",
  "paid off",
  "paid_off",
  "paidoff",
];

const defaultDashboardData: PaymentDashboardData = {
  cards: {
    dueToday: 0,
    dueNext7Days: 0,
    totalPayback: 0,
    totalDues: 0,
    recovered: 0,
    defaults: 0,
    totalDeals: 0,
    activeDeals: 0,
    collectionEfficiency: 0,
  },
  moneyFlow: {
    monthly: [],
    weekly: [],
    yearly: [],
  },
};

const PAYMENT_DASHBOARD_PAGINATION_STORAGE_KEY = "paymentHistoryDashboard.pagination";

function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const n = Number(String(value).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(n) ? n : null;
}

type ApplicationOfferEconomicsExtras = Application & {
  type?: unknown;
  commissionAmount?: unknown;
  refinanceAmount?: unknown;
  RefinanceAmount?: unknown;
  /** Same as GET /applications funded embed — must match portfolio gross repaid, not strict pairing sum. */
  collectionGrossRepaidDealEconomics?: unknown;
  termsOffers?: { paybackAmount?: unknown; commissionAmount?: unknown; approvedAmount?: unknown; factorRate?: unknown }[];
  OfferDecision?: {
    fees?: unknown;
    offer?: unknown;
    rate?: unknown;
    paybackAmount?: unknown;
    totalRepayments?: unknown;
    totalRepayment?: unknown;
    totalRemit?: unknown;
    refinanceAmount?: unknown;
    RefinanceAmount?: unknown;
    decision?: unknown;
    approvedAmount?: unknown;
  } | null;
};

/** Matches BE `parseMoneyForDealBalance` — Prisma Decimal / string-safe. */
function parseMoneyDealBalance(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toString" in value) {
    const n = Number((value as { toString(): string }).toString());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Matches BE `offerDecisionEffectiveRecord` (`collectionPaymentFinancials.ts`). */
function offerDecisionEffectiveRecord(
  odRoot: ApplicationOfferEconomicsExtras["OfferDecision"],
): Record<string, unknown> | null {
  if (!odRoot || typeof odRoot !== "object") return null;
  const root = odRoot as Record<string, unknown>;
  const inner = root.offer;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return root;
}

function offerDecisionRateFromRoot(odRoot: unknown): number | null {
  if (!odRoot || typeof odRoot !== "object") return null;
  return parseMoneyDealBalance((odRoot as Record<string, unknown>).rate);
}

/** Matches BE `getApprovedOfferAmountForDealBalance`. */
function getApprovedOfferAmountForDealBalanceAligned(app: ApplicationOfferEconomicsExtras): number {
  const loanAmount = parseMoneyDealBalance(app.loanAmount);
  const latestTerms = app.termsOffers?.[0];
  const fromTerms = latestTerms ? parseMoneyDealBalance(latestTerms.approvedAmount) : null;
  const decisionNorm = String(app.OfferDecision?.decision ?? "").toLowerCase();
  const odEff = offerDecisionEffectiveRecord(app.OfferDecision);
  const fromOfferDecision =
    decisionNorm !== "declined"
      ? parseMoneyDealBalance(odEff?.offer) ?? parseMoneyDealBalance(odEff?.approvedAmount)
      : null;
  return fromTerms ?? fromOfferDecision ?? loanAmount ?? 0;
}

/** Matches BE `getPaybackAmountForDealBalance` — per-deal payback when balances API omits payback. */
function getPaybackAmountForDealBalanceAligned(
  app: ApplicationOfferEconomicsExtras,
  offerAmount: number,
): number {
  const latestTermsOffer = app.termsOffers?.[0];
  const odRoot = app.OfferDecision;
  const odEff = offerDecisionEffectiveRecord(odRoot);
  const decisionRate = offerDecisionRateFromRoot(odRoot);
  const termsFactor = parseMoneyDealBalance(latestTermsOffer?.factorRate);
  const factorRate = decisionRate ?? termsFactor;
  const fallbackPayback =
    parseMoneyDealBalance(latestTermsOffer?.paybackAmount) ??
    parseMoneyDealBalance(odEff?.paybackAmount) ??
    parseMoneyDealBalance(odEff?.totalRemit) ??
    parseMoneyDealBalance(odEff?.totalRepayments) ??
    parseMoneyDealBalance(odEff?.totalRepayment);

  const advance =
    offerAmount > 0
      ? offerAmount
      : parseMoneyDealBalance(odEff?.offer) ??
        parseMoneyDealBalance(odEff?.approvedAmount) ??
        parseMoneyDealBalance(latestTermsOffer?.approvedAmount) ??
        0;

  if (advance <= 0) return 0;
  if (factorRate != null) return Math.max(advance * factorRate, 0);
  if (fallbackPayback != null && fallbackPayback > 0) return Math.max(fallbackPayback, 0);
  return 0;
}

function getApplicationClientName(client: Application["client"]): string {
  if (typeof client === "string") return client;
  if (client?.business?.name) return client.business.name;
  if (client?.owner?.firstName || client?.owner?.lastName) {
    return `${client.owner.firstName || ""} ${client.owner.lastName || ""}`.trim();
  }
  return "—";
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function normalizeDealToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const PREVIEW_ROW_DATE_HEADER_KEYS = new Set([
  "date",
  "paymentdate",
  "transactiondate",
  "valuedate",
  "postingdate",
  "effectivedate",
  "settlementdate",
  "cleareddate",
  "scheduleddate",
  "processeddate",
  "returndate",
]);

function normalizePreviewRowDataKey(key: string): string {
  return key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

const PREVIEW_ROW_DEAL_ID_HEADER_KEYS = new Set([
  "dealid",
  "deal",
  "dealcode",
  "dealnumber",
  "applicationdealid",
]);

function getPreviewRowSheetDealId(row: TransactionPreviewRow): string {
  const direct = String(row.dealId ?? "").trim();
  if (direct) return direct;
  const entries = Object.entries(row.rowData ?? {});
  const dealEntry = entries.find(([key]) =>
    PREVIEW_ROW_DEAL_ID_HEADER_KEYS.has(normalizePreviewRowDataKey(key)),
  );
  return String(dealEntry?.[1] ?? "").trim();
}

/**
 * Permissive deal-token scanner.
 * Catches BA12345, BA-12345, BA 12345, BA_12345, ba.12345 etc. — many real-world bank statements
 * insert separators inside the code, which broke the original `\b(BA\d+)\b` regex and split rows
 * for the same deal across different groups. `matchAll` returns every candidate so we can prefer
 * the CRM-funded one rather than just the first occurrence.
 */
const PREVIEW_DEAL_TOKEN_LOOSE_REGEX = /\b[A-Z]{1,4}[\s._\-]{0,3}\d{2,}\b/gi;

function extractAllDealTokenCandidatesFromText(text: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return out;
  const matches = trimmed.matchAll(PREVIEW_DEAL_TOKEN_LOOSE_REGEX);
  for (const m of matches) {
    const token = normalizeDealToken(m[0]);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Every plausible deal-id candidate for one preview row, in priority order:
 *   1. Explicit "Deal ID" column from the sheet (highest — user stated it directly)
 *   2. Backend's `row.dealId` (extracted via the strict description regex)
 *   3. Every loose match in the description (catches BA-1234, BA 1234, multi-deal descriptions)
 *   4. Loose matches in any other rowData cell (last-resort recovery)
 * De-duplicated, normalized to A–Z/0–9 uppercase tokens.
 */
function getPreviewRowDealCandidatesNormalized(row: TransactionPreviewRow): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushIfNew = (raw: unknown) => {
    const token = normalizeDealToken(raw);
    if (!token || seen.has(token)) return;
    seen.add(token);
    candidates.push(token);
  };

  const entries = Object.entries(row.rowData ?? {});

  for (const [key, value] of entries) {
    if (PREVIEW_ROW_DEAL_ID_HEADER_KEYS.has(normalizePreviewRowDataKey(key))) {
      pushIfNew(value);
    }
  }

  pushIfNew(row.dealId);

  for (const tok of extractAllDealTokenCandidatesFromText(row.description)) {
    pushIfNew(tok);
  }

  for (const [key, value] of entries) {
    if (PREVIEW_ROW_DEAL_ID_HEADER_KEYS.has(normalizePreviewRowDataKey(key))) continue;
    for (const tok of extractAllDealTokenCandidatesFromText(value)) {
      pushIfNew(tok);
    }
  }

  return candidates;
}

/**
 * Picks the deal token to use for grouping/mapping. Prefers a candidate that matches a CRM-funded
 * deal so that, e.g., a description "Refund BA99999 → BA12345" pairs with BA12345 (in CRM) instead
 * of BA99999 (not in CRM). Without this, rows like that would land in the unmapped tab while their
 * sibling transactions for the same deal stayed mapped, splitting a 3-row group into 1 + 2.
 */
function pickBestPreviewRowDealToken(
  row: TransactionPreviewRow,
  mappedDealTokens: Set<string>,
): string {
  const candidates = getPreviewRowDealCandidatesNormalized(row);
  if (candidates.length === 0) return "";
  const matched = candidates.find((tok) => mappedDealTokens.has(tok));
  return matched ?? candidates[0]!;
}

/** Aligns with BE `parseExcelDate` / preview date columns — avoids Excel serials and UTC-only ISO pitfalls. */
function parsePreviewRowDateFromRaw(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const y = Number.parseInt(iso[1], 10);
    const m = Number.parseInt(iso[2], 10) - 1;
    const day = Number.parseInt(iso[3], 10);
    const dt = new Date(y, m, day, 12, 0, 0, 0);
    if (!Number.isNaN(dt.getTime())) return dt.getTime();
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (Number.isFinite(serial) && serial >= 25569 && serial < 600000) {
      const epoch = new Date(1899, 11, 30, 12, 0, 0, 0);
      const dt = new Date(epoch.getTime() + Math.round(serial * 86400000));
      if (!Number.isNaN(dt.getTime())) return dt.getTime();
    }
  }

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (slash) {
    const first = Number.parseInt(slash[1], 10);
    const second = Number.parseInt(slash[2], 10);
    const yearRaw = Number.parseInt(slash[3], 10);
    if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(yearRaw)) return null;
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    let month0: number;
    let day: number;
    if (first > 12) {
      day = first;
      month0 = second - 1;
    } else if (second > 12) {
      month0 = first - 1;
      day = second;
    } else {
      month0 = first - 1;
      day = second;
    }
    const dt = new Date(year, month0, day, 12, 0, 0, 0);
    if (!Number.isNaN(dt.getTime())) return dt.getTime();
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function parsePreviewRowDate(row: TransactionPreviewRow): number | null {
  const entries = Object.entries(row.rowData ?? {});
  const dateEntry = entries.find(([key]) => PREVIEW_ROW_DATE_HEADER_KEYS.has(normalizePreviewRowDataKey(key)));
  const rawValue = dateEntry?.[1];
  if (!rawValue) return null;
  return parsePreviewRowDateFromRaw(String(rawValue));
}

/** Queue/state cues aligned with funded deals list (Funded / Disbursement). */
function isFundedStatusLabel(value: unknown): boolean {
  const s = normalizeStatus(value);
  if (s === "funded") return true;
  if (s === "disbursement" || s === "disbursment") return true;
  return false;
}

/** Delegates to BE-aligned `getApprovedOfferAmountForDealBalance` (nested OfferDecision.offer, Prisma decimals). */
function getApprovedOfferAmount(app: Application): number {
  return Math.max(0, getApprovedOfferAmountForDealBalanceAligned(app as ApplicationOfferEconomicsExtras));
}

/** Delegates to BE-aligned `getPaybackAmountForDealBalance` so per-deal above principal matches `/balances`. */
function getPaybackAmount(app: Application, offerAmount: number): number {
  return getPaybackAmountForDealBalanceAligned(app as ApplicationOfferEconomicsExtras, offerAmount);
}

function getPaidTransactionsTotal(app: Application): number {
  const appAny = app as Application & {
    totalPaid?: unknown;
    amountPaid?: unknown;
    paidAmount?: unknown;
    paid?: unknown;
    transactions?: unknown[];
    payments?: unknown[];
    paidTransactions?: unknown[];
    collectionPayments?: unknown[];
    paymentHistory?: unknown[];
  };

  const summaryPaid =
    parseMoney(appAny.totalPaid) ??
    parseMoney(appAny.amountPaid) ??
    parseMoney(appAny.paidAmount) ??
    parseMoney(appAny.paid);
  if (summaryPaid != null) return Math.max(summaryPaid, 0);

  const candidateLists: unknown[][] = [
    Array.isArray(appAny.transactions) ? appAny.transactions : [],
    Array.isArray(appAny.payments) ? appAny.payments : [],
    Array.isArray(appAny.paidTransactions) ? appAny.paidTransactions : [],
    Array.isArray(appAny.collectionPayments) ? appAny.collectionPayments : [],
    Array.isArray(appAny.paymentHistory) ? appAny.paymentHistory : [], 
  ];

  return candidateLists.flat().reduce<number>((sum, item) => {
    if (!item || typeof item !== "object") return sum;
    const tx = item as Record<string, unknown>;
    const status = normalizeStatus(tx.status ?? tx.paymentStatus ?? tx.state);
    const hasStatus = status.length > 0;
    const isPaid = PAID_STATUS_KEYWORDS.some((keyword) => status.includes(keyword));
    if (hasStatus && !isPaid) return sum;

    const amount =
      parseMoney(tx.amount) ??
      parseMoney(tx.paidAmount) ??
      parseMoney(tx.paymentAmount) ??
      parseMoney(tx.receivedAmount) ??
      parseMoney(tx.collectedAmount) ??
      parseMoney(tx.transactionAmount);

    return sum + (amount ?? 0);
  }, 0);
}

function paymentDealPath(applicationId: string): string {
  return `/payments/${encodeURIComponent(applicationId)}`;
}

/** Uses fresh `/collection-payments/balances` when passed; else funded-list embed; else client rollup from collection rows. */
function mapDisbursementApplicationToRow(
  app: Application,
  collectionRows: unknown[],
  applicationDealId: string,
  freshBalance?: { paybackAmount: number; balanceDue: number } | null,
): PaymentTransactionRow {
  const id = String(app._id ?? (app as { id?: string }).id ?? "");
  const appId = id;
  const numericFallbackFromMongoId = id.replace(/\D+/g, "").slice(-6);
  const dealIdTrim = app.dealId?.trim();
  const displayId =
    dealIdTrim && dealIdTrim.length > 0
      ? dealIdTrim
      : app.applicationId != null && Number.isFinite(Number(app.applicationId))
        ? String(app.applicationId)
        : numericFallbackFromMongoId || "—";
  const client = getApplicationClientName(app.client);
  const updatedRaw = app.updatedAt;
  const date =
    updatedRaw && !Number.isNaN(Date.parse(updatedRaw))
      ? new Date(updatedRaw).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  const offerApproved = getApprovedOfferAmount(app);
  let paybackAmount = getPaybackAmount(app, offerApproved);
  let balanceDue = paybackAmount - getPaidTransactionsTotal(app);

  const hasEmbedded =
    app.collectionBalanceDue != null &&
    app.collectionPaybackAmount != null &&
    app.collectionSumOfRepaid != null;

  if (
    freshBalance != null &&
    Number.isFinite(freshBalance.paybackAmount) &&
    Number.isFinite(freshBalance.balanceDue)
  ) {
    paybackAmount = freshBalance.paybackAmount;
    balanceDue = freshBalance.balanceDue;
  } else if (hasEmbedded) {
    paybackAmount = Number(app.collectionPaybackAmount);
    balanceDue = Number(app.collectionBalanceDue);
  } else {
    const financials = calculateFinancialsFromCollectionPayments(
      collectionRows,
      paybackAmount,
      applicationDealId,
      appId,
    );
    balanceDue = paybackAmount - financials.sumOfRepaid;
  }

  const status = String(app.currentQueue || app.queue || app.currentState || "—");

  return {
    id,
    displayId,
    client,
    date,
    dueDate: date,
    amount: offerApproved,
    paybackAmount,
    method: "—",
    category: app.type ?? undefined,
    balanceDue,
    status,
  };
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  titleMeta,
  subtext,
  subValue,
  trend,
  trendType,
  className,
  valuePending,
  onClick,
  ariaLabel,
}) => {
  const accent =
    "from-[#276D9C]/10 via-sky-400/5 to-transparent dark:from-[#276D9C]/20 dark:via-sky-300/10 dark:to-transparent";
  const footerValueTone =
    trendType === "up"
      ? "text-emerald-500"
      : trendType === "down"
        ? "text-red-500"
        : "text-foreground";

  const hasFooter = Boolean((subtext != null && subtext.trim() !== "") || subValue);
  const hasTitleMeta = titleMeta != null && titleMeta.trim() !== "";
  const isInteractive = typeof onClick === "function";

  return (
    <div
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-label={isInteractive ? (ariaLabel ?? title) : undefined}
      onClick={onClick}
      onKeyDown={
        isInteractive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`group relative ${hasFooter ? "min-h-[146px]" : hasTitleMeta ? "min-h-[124px]" : "min-h-[112px]"} overflow-hidden rounded-2xl border border-border/70 bg-card/90 p-5 shadow-xl ring-1 ring-inset ring-border/40 transition-all duration-200 hover:border-border dark:border-white/10 dark:bg-white/[0.04] dark:ring-white/10 ${
        isInteractive
          ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-2xl hover:ring-2 hover:ring-[#276D9C]/30 focus-visible:-translate-y-0.5 focus-visible:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#276D9C]/50 dark:hover:ring-sky-300/30 dark:focus-visible:ring-sky-300/50"
          : ""
      } ${className ?? ""}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.12),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.08),transparent_55%)]" />
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent}`}
      />
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl dark:bg-white/5" />
      <div className="pointer-events-none absolute left-0 top-0 h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent dark:via-white/10" />

      <div className="relative mb-3 flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h3>
        {trend && (
          <div className="flex items-center gap-1 rounded-full border border-sky-300/40 bg-sky-300/15 px-2.5 py-1 text-[11px] font-semibold text-sky-700 dark:text-sky-200">
            {trendType === "up" ? (
              <ArrowUpRight size={12} />
            ) : trendType === "down" ? (
              <ArrowDownRight size={12} />
            ) : null}
            {trend}
          </div>
        )}
      </div>

      <div className="relative flex min-h-[2.25rem] items-baseline gap-2">
        {valuePending ? (
          <span
            className="inline-block h-8 min-w-[7.5rem] max-w-full animate-pulse rounded-lg bg-muted"
            aria-label="Loading value"
          />
        ) : (
          <p className="whitespace-nowrap text-xl font-bold tabular-nums leading-tight tracking-tight text-foreground drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)] dark:drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
            {value}
          </p>
        )}
      </div>

      {hasTitleMeta ? (
        <p className="relative mt-2 text-right text-[11px] font-bold tabular-nums leading-tight tracking-tight text-foreground">
          {titleMeta}
        </p>
      ) : null}

      {hasFooter ? (
        <div className="relative mt-3 flex items-center gap-1.5 border-t border-border/50 pt-2 dark:border-white/10">
          {subtext != null && subtext.trim() !== "" ? (
            <span className="text-xs text-muted-foreground">{subtext}</span>
          ) : null}
          {subValue ? (
            <span className={`text-xs font-semibold ${footerValueTone}`}>{subValue}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const PaymentHistoryDashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch<AppDispatch>();
  const { data: loginData } = useSelector((state: RootState) => state.login);
  const userRole = loginData?.user?.role || localStorage.getItem("role") || "";
  const isSuperAdmin = userRole === "SUPER_ADMIN" || userRole === "SUPERADMIN";
  const {
    data: cohortApplications,
    loading: cohortLoading,
    isRefreshing: cohortRefreshing,
    error: cohortError,
    fetched: cohortFetched,
    pagination: cohortPagination,
  } = useSelector((state: RootState) => state.paymentDashboardCohort);
  const {
    error: dashboardMoneyError,
    balancesByAppId,
    paymentsByApp: dashboardPaymentsByApp,
  } = useSelector((state: RootState) => state.paymentDashboardMoney);
  const {
    data: dashboardData,
    loading: paymentDashboardApiLoading,
    isRefreshing: paymentDashboardRefreshing,
    error: paymentDashboardError,
  } = useSelector((state: RootState) => state.paymentDashboard);
  const dashboard = dashboardData ?? defaultDashboardData;
  /** First load with no session snapshot — show placeholders instead of zeros. */
  const statsValuePending = paymentDashboardApiLoading && dashboardData == null;

  const dashboardBalancesByApp = useMemo(() => {
    const m = new Map<string, FundedDealBalanceApiRow>();
    Object.entries(balancesByAppId).forEach(([k, v]) =>
      m.set(k, v as FundedDealBalanceApiRow),
    );
    return m;
  }, [balancesByAppId]);

  /** Click-to-view: cleared when the deal route is active so the eye icon does not spin until navigation fully settles. */
  const [pendingViewDealId, setPendingViewDealId] = useState<string | null>(null);

  const overviewFetchParamsRef = useRef({
    pageIndex: 0,
    pageSize: 10,
    search: "",
    chartYear: new Date().getFullYear(),
    chartMonth: new Date().getMonth() as number | "all",
  });

  /** Parallel refresh after transaction writes (summary + table + failed KPI). */
  const refreshDashboardAfterTransactionWrites = useCallback(async () => {
    const { pageIndex, pageSize, search, chartYear, chartMonth } =
      overviewFetchParamsRef.current;
    await Promise.all([
      dispatch(
        fetchPaymentFinancialOverviewSummary({ chartYear, chartMonth }),
      ).unwrap(),
      dispatch(
        fetchPaymentDashboardFundedDeals(
          buildPaymentFundedCohortParams({ pageIndex, pageSize, search }),
        ),
      ).unwrap(),
      dispatch(fetchPaymentFailedSummary()).unwrap(),
    ]);
  }, [dispatch]);

  const lastMoneyErrorToastRef = useRef<string | null>(null);
  useEffect(() => {
    if (!dashboardMoneyError) {
      lastMoneyErrorToastRef.current = null;
      return;
    }
    if (lastMoneyErrorToastRef.current === dashboardMoneyError) return;
    lastMoneyErrorToastRef.current = dashboardMoneyError;
    toast.error(dashboardMoneyError);
  }, [dashboardMoneyError]);

  useEffect(() => {
    if (!pendingViewDealId) return;
    if (location.pathname === paymentDealPath(pendingViewDealId)) {
      setPendingViewDealId(null);
    }
  }, [location.pathname, pendingViewDealId]);

  useEffect(() => {
    if (!pendingViewDealId) return;
    const t = window.setTimeout(() => setPendingViewDealId(null), 12_000);
    return () => window.clearTimeout(t);
  }, [pendingViewDealId]);

  const showProminentMoneySync =
    paymentDashboardApiLoading && !dashboard.creditDebitTrend;
  const showQuietMoneySync = paymentDashboardRefreshing || cohortRefreshing;
  const [moneyFlowView, setMoneyFlowView] = useState<MoneyFlowView>("monthly");
  const [moneyFlowFilterYear, setMoneyFlowFilterYear] = useState<number>(new Date().getFullYear());
  const [moneyFlowFilterMonth, setMoneyFlowFilterMonth] = useState<number | "all">(new Date().getMonth());
  const debouncedChartYear = useDebouncedValue(moneyFlowFilterYear, 400);
  const debouncedChartMonth = useDebouncedValue(moneyFlowFilterMonth, 400);
  const [uploadingTransactions, setUploadingTransactions] = useState(false);
  const [transactionPreviewRows, setTransactionPreviewRows] = useState<TransactionPreviewRow[]>([]);
  const [transactionPreviewSummary, setTransactionPreviewSummary] = useState<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateDealIds: string[];
    regex: string;
  } | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [previewExcelHeaders, setPreviewExcelHeaders] = useState<string[]>([]);
  const [previewApplicationSearch, setPreviewApplicationSearch] = useState("");
  const debouncedPreviewApplicationSearch = useDebouncedValue(previewApplicationSearch, 400);
  const [previewViewMode, setPreviewViewMode] = useState<"mapped" | "unmapped">("mapped");
  const [previewDealSelectionByGroup, setPreviewDealSelectionByGroup] = useState<Record<string, string>>({});
  const [previewDealInputTextByGroup, setPreviewDealInputTextByGroup] = useState<Record<string, string>>({});
  const [previewRemovedGroups, setPreviewRemovedGroups] = useState<Record<string, true>>({});
  const [previewVerifiedGroups, setPreviewVerifiedGroups] = useState<Record<string, true>>({});
  const [previewSavingGroups, setPreviewSavingGroups] = useState<Record<string, true>>({});
  const [previewSavedGroups, setPreviewSavedGroups] = useState<Record<string, true>>({});
  const [previewBulkVerifyInProgress, setPreviewBulkVerifyInProgress] = useState(false);
  const previewBulkVerifyLockRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewTableScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const moneyFlowYearOptions = useMemo(() => {
    const fromApi = dashboard.chartYearOptions;
    if (fromApi && fromApi.length > 0) return fromApi;
    const currentYear = new Date().getFullYear();
    return Array.from({ length: currentYear - 2023 + 1 }, (_, idx) => 2023 + idx);
  }, [dashboard.chartYearOptions, moneyFlowFilterYear]);

  const creditDebitTrendByView = dashboard.creditDebitTrend ?? {
    monthly: [],
    weekly: [],
    monthlyInYear: [],
    yearly: [],
  };

  useEffect(() => {
    if (moneyFlowYearOptions.length === 0) return;
    if (!moneyFlowYearOptions.includes(moneyFlowFilterYear)) {
      const currentYear = new Date().getFullYear();
      setMoneyFlowFilterYear(
        moneyFlowYearOptions.includes(currentYear)
          ? currentYear
          : moneyFlowYearOptions[moneyFlowYearOptions.length - 1],
      );
    }
  }, [moneyFlowYearOptions, moneyFlowFilterYear]);

  const moneyFlowCalendarAnchor = useMemo(() => {
    const today = new Date();
    const anchorDate = today;
    const anchorMonth = moneyFlowFilterMonth === "all" ? anchorDate.getMonth() : moneyFlowFilterMonth;
    const monthTitle = new Date(moneyFlowFilterYear, anchorMonth, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    return {
      date: anchorDate,
      monthTitle,
      year: moneyFlowFilterYear,
      month: anchorMonth,
    };
  }, [moneyFlowFilterMonth, moneyFlowFilterYear]);

  useEffect(() => {
    if (
      moneyFlowFilterMonth === "all" &&
      (moneyFlowView === "monthly" || moneyFlowView === "weekly")
    ) {
      setMoneyFlowView("monthlyInYear");
      return;
    }
    if (
      moneyFlowFilterMonth !== "all" &&
      (moneyFlowView === "monthlyInYear" || moneyFlowView === "yearly")
    ) {
      setMoneyFlowView("monthly");
    }
  }, [moneyFlowFilterMonth, moneyFlowView]);

  const chartMoneyFlowData = useMemo(() => {
    const sourceData =
      moneyFlowView === "weekly"
        ? creditDebitTrendByView.weekly
        : moneyFlowView === "monthlyInYear"
          ? creditDebitTrendByView.monthlyInYear
        : moneyFlowView === "yearly"
          ? creditDebitTrendByView.yearly
          : creditDebitTrendByView.monthly;
    return sourceData.map((point: MoneyFlowPoint) => ({
      ...point,
      inflow: Number(point?.inflow ?? 0),
      outflow: Number(point?.outflow ?? 0),
    }));
  }, [moneyFlowView, creditDebitTrendByView]);

  const moneyFlowSubtitle =
    moneyFlowView === "monthly"
      ? `${moneyFlowCalendarAnchor.monthTitle} — daily debit vs credit transaction amounts`
      : moneyFlowView === "weekly"
        ? moneyFlowFilterMonth === "all"
          ? `Weeks in ${moneyFlowCalendarAnchor.year} — five rolling Sun-Sat periods of debit vs credit transaction totals`
          : `${moneyFlowCalendarAnchor.monthTitle} — weekly debit vs credit transaction totals`
        : moneyFlowView === "monthlyInYear"
          ? `${moneyFlowCalendarAnchor.year} — monthly debit vs credit transaction totals`
        : moneyFlowFilterMonth === "all"
          ? `${moneyFlowYearOptions[0]} - ${moneyFlowYearOptions[moneyFlowYearOptions.length - 1]} — yearly debit vs credit transaction totals`
          : `${moneyFlowCalendarAnchor.year} — monthly debit vs credit transaction totals`;

  const moneyFlowXAxisTitle =
    moneyFlowView === "monthly"
      ? "Day of month"
      : moneyFlowView === "weekly"
        ? moneyFlowFilterMonth === "all"
          ? "Weeks"
          : "Weeks in month"
        : moneyFlowView === "monthlyInYear"
          ? "Month"
        : moneyFlowFilterMonth === "all"
          ? "Year"
          : "Month";

  const handleUploadButtonClick = () => {
    if (uploadingTransactions) return;
    fileInputRef.current?.click();
  };

  const handleTransactionSheetUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    const filename = selectedFile.name.toLowerCase();
    const supportedExtensions = [".xlsx", ".xls", ".csv"];
    const hasSupportedExtension = supportedExtensions.some((extension) =>
      filename.endsWith(extension),
    );

    if (!hasSupportedExtension) {
      toast.error("Please upload a .xlsx, .xls, or .csv file.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingTransactions(true);
      setIsPreviewModalOpen(false);
      setTransactionPreviewRows([]);
      setTransactionPreviewSummary(null);
      setPreviewExcelHeaders([]);
      setPreviewApplicationSearch("");
      setPreviewDealSelectionByGroup({});
      setPreviewDealInputTextByGroup({});
      setPreviewRemovedGroups({});
      setPreviewVerifiedGroups({});
      setPreviewSavingGroups({});
      setPreviewSavedGroups({});

      const formData = new FormData();
      formData.append("file", selectedFile);
      const response = await axiosPostFormData("/transactions/upload/preview", formData, {
        timeout: 0,
      });
      const previewPayload = (response?.data ?? {}) as TransactionPreviewResponse;
      const previewData = previewPayload?.data;
      if (!previewData) {
        throw new Error("Preview could not be generated.");
      }
      const totalRows = Number(previewData.totalRows ?? 0);
      const validRows = Number(previewData.validRows ?? 0);
      const invalidRows = Number(previewData.invalidRows ?? 0);
      const excelHeaders = Array.isArray(previewData.excelHeaders) ? previewData.excelHeaders : [];
      const duplicateDealIds = Array.isArray(previewData.duplicateDealIds)
        ? previewData.duplicateDealIds
        : [];
      const previewRows = Array.isArray(previewData.previewRows) ? previewData.previewRows : [];
      setPreviewDealSelectionByGroup({});
      setPreviewDealInputTextByGroup({});
      setPreviewRemovedGroups({});
      setPreviewVerifiedGroups({});
      setPreviewSavingGroups({});
      setPreviewSavedGroups({});
      setTransactionPreviewRows(previewRows);
      setPreviewExcelHeaders(excelHeaders);

      const { mapped: cm, unmapped: cu } = countPreviewTabBucketsBySheetDeal({
        previewRows,
        mappedDealTokens,
        removedGroups: {},
      });
      setPreviewViewMode(previewInitialTabFromBuckets(cm, cu));

      setIsPreviewModalOpen(true);
      setTransactionPreviewSummary({
        totalRows,
        validRows,
        invalidRows,
        duplicateDealIds,
        regex: String(previewData.regex ?? "\\b(BA\\d+)\\b"),
      });
      toast.success(
        `Preview ready — Matched from sheet (CRM funded): ${cm}; needs deal link/review: ${cu}. Rows in preview: ${previewRows.length}.${totalRows !== previewRows.length ? ` Rows in sheet: ${totalRows}.` : ""}`,
      );
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to Upload transaction sheet.";
      toast.error(message);
    } finally {
      setUploadingTransactions(false);
      event.target.value = "";
    }
  };

  const previewDealOptions = useMemo(
    () =>
      (cohortApplications ?? [])
        .map((app) => {
          const dealId = String(app.dealId ?? "").trim();
          if (!dealId) return null;
          const clientBusinessName =
            typeof app.client === "string"
              ? app.client
              : String(app.client?.business?.name ?? "").trim();
          const dealName = String(
            app.dealDisplayName ??
              clientBusinessName ??
              "",
          ).trim();
          return {
            dealId,
            dealName,
            label: dealName ? `${dealId} - ${dealName}` : dealId,
            token: `${dealId} ${dealName}`.toLowerCase(),
          };
        })
        .filter((item): item is { dealId: string; dealName: string; label: string; token: string } => !!item),
    [cohortApplications],
  );

  const previewDealOptionById = useMemo(() => {
    const byId = new Map<string, { dealId: string; dealName: string; label: string; token: string }>();
    previewDealOptions.forEach((option) => {
      byId.set(normalizeDealToken(option.dealId), option);
    });
    return byId;
  }, [previewDealOptions]);

  const mappedDealTokens = useMemo(
    () => new Set(previewDealOptions.map((option) => normalizeDealToken(option.dealId)).filter(Boolean)),
    [previewDealOptions],
  );

  const normalizedPreviewDealSelectionByGroup = useMemo(() => {
    const normalized: Record<string, string> = {};
    Object.entries(previewDealSelectionByGroup).forEach(([groupKey, dealId]) => {
      const token = normalizeDealToken(dealId);
      if (!token) return;
      normalized[groupKey] = token;
    });
    return normalized;
  }, [previewDealSelectionByGroup]);

  /** Full rows for current view mode — used for Verify / grouping so search never hides rows from save. */
  const previewRowsBaseSorted = useMemo(() => {
    if (!isPreviewModalOpen) return [];
    /**
     * Use the multi-source CRM-aware picker so 3+ transactions for the same deal stay grouped
     * together even when their descriptions mention different BA codes / use separators / are
     * blank (we then fall back to the explicit Deal ID column / other rowData fields).
     */
    const adjustedRows = transactionPreviewRows
      .filter((row): row is TransactionPreviewRow => row != null && typeof row === "object")
      .map((row, idx) => {
        const sheetDealToken = pickBestPreviewRowDealToken(row, mappedDealTokens);
        const fallbackDealId = getPreviewRowSheetDealId(row);
        const sheetDealId =
          previewDealOptionById.get(sheetDealToken)?.dealId ?? fallbackDealId ?? sheetDealToken;
        const groupKey = sheetDealToken || UNMAPPED_PREVIEW_GROUP_KEY;
        const safeRowNumber =
          typeof row.rowNumber === "number" && Number.isFinite(row.rowNumber)
            ? row.rowNumber
            : idx + 2;
        const rowKey = `ROW_${safeRowNumber}`;
        const sourceIsMapped = sheetDealToken.length > 0 && mappedDealTokens.has(sheetDealToken);
        const isRemoved = Boolean(previewRemovedGroups[rowKey] || previewRemovedGroups[groupKey]);
        const effectiveDealToken =
          normalizedPreviewDealSelectionByGroup[rowKey] ??
          normalizedPreviewDealSelectionByGroup[groupKey] ??
          sheetDealToken;
        const effectiveDealId = previewDealOptionById.get(effectiveDealToken)?.dealId ?? sheetDealId;
        return {
          ...row,
          rowNumber: safeRowNumber,
          groupKey,
          rowKey,
          sourceIsMapped,
          isRemoved,
          effectiveDealToken,
          effectiveDealId,
        };
      });

    /** Mapped = sheet Deal ID matched CRM; Unmapped = needs dropdown + Verify — selection stays here until saved. */
    const filteredByMode = adjustedRows.filter((row) =>
      previewViewMode === "mapped" ? row.sourceIsMapped : !row.sourceIsMapped,
    );

    return [...filteredByMode].sort((a, b) => {
      const byGroup = a.groupKey.localeCompare(b.groupKey);
      if (byGroup !== 0) return byGroup;
      const aTime = parsePreviewRowDate(a);
      const bTime = parsePreviewRowDate(b);
      if (aTime != null && bTime != null) return aTime - bTime;
      if (aTime != null) return -1;
      if (bTime != null) return 1;
      return a.rowNumber - b.rowNumber;
    });
  }, [
    isPreviewModalOpen,
    mappedDealTokens,
    normalizedPreviewDealSelectionByGroup,
    previewDealOptionById,
    previewRemovedGroups,
    previewViewMode,
    transactionPreviewRows,
  ]);

  const previewRowsForTable = useMemo(() => {
    const term = debouncedPreviewApplicationSearch.trim().toLowerCase();
    if (!term) return previewRowsBaseSorted;
    return previewRowsBaseSorted.filter((row) => {
      const dealId = String(row.effectiveDealId ?? "").toLowerCase();
      const description = String(row.description ?? "").toLowerCase();
      const dealLabel = previewDealOptionById.get(row.effectiveDealToken)?.label.toLowerCase() ?? "";
      return dealId.includes(term) || description.includes(term) || dealLabel.includes(term);
    });
  }, [debouncedPreviewApplicationSearch, previewDealOptionById, previewRowsBaseSorted]);

  const previewModeCounts = useMemo(() => {
    if (!isPreviewModalOpen) return { mapped: 0, unmapped: 0 };
    return countPreviewTabBucketsBySheetDeal({
      previewRows: transactionPreviewRows,
      mappedDealTokens,
      removedGroups: previewRemovedGroups,
    });
  }, [isPreviewModalOpen, mappedDealTokens, previewRemovedGroups, transactionPreviewRows]);

  /** Single source for “Mapped / Unmapped / Total” in preview UI vs sheet upload banner — CRM fundability only. */
  const previewRowsCrmTotalActive = previewModeCounts.mapped + previewModeCounts.unmapped;
  const previewTruncationFootnote =
    transactionPreviewSummary != null &&
    transactionPreviewSummary.totalRows > transactionPreviewRows.length
      ? `Preview loads ${transactionPreviewRows.length} of ${transactionPreviewSummary.totalRows} sheet rows — counts are for loaded rows only.`
      : null;

  const dealIdRowSpanInPage = useMemo(() => {
    const counts = new Map<string, number>();
    previewRowsForTable.forEach((row) => {
      const key = previewViewMode === "unmapped" ? row.rowKey : row.groupKey;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [previewRowsForTable, previewViewMode]);

  const firstIndexByDealIdInPage = useMemo(() => {
    const firstIndex = new Map<string, number>();
    previewRowsForTable.forEach((row, index) => {
      const key = previewViewMode === "unmapped" ? row.rowKey : row.groupKey;
      if (!firstIndex.has(key)) firstIndex.set(key, index);
    });
    return firstIndex;
  }, [previewRowsForTable, previewViewMode]);

  const dealGroupToneByKey = useMemo(() => {
    const toneByKey = new Map<string, number>();
    let tone = 0;
    for (const row of previewRowsForTable) {
      const key = previewViewMode === "unmapped" ? row.rowKey : row.groupKey;
      if (toneByKey.has(key)) continue;
      toneByKey.set(key, tone % 2);
      tone += 1;
    }
    return toneByKey;
  }, [previewRowsForTable, previewViewMode]);

  const previewRowsByActionKey = useMemo(() => {
    const grouped = new Map<string, Array<(typeof previewRowsBaseSorted)[number]>>();
    previewRowsBaseSorted.forEach((row) => {
      const actionKey = previewViewMode === "unmapped" ? row.rowKey : row.groupKey;
      const list = grouped.get(actionKey) ?? [];
      list.push(row);
      grouped.set(actionKey, list);
    });
    return grouped;
  }, [previewRowsBaseSorted, previewViewMode]);

  const handlePreviewSelectDeal = useCallback((groupKey: string, dealId: string) => {
    const scroller = previewTableScrollContainerRef.current;
    const previousScrollTop = scroller?.scrollTop ?? 0;
    const previousScrollLeft = scroller?.scrollLeft ?? 0;
    setPreviewDealSelectionByGroup((prev) => ({
      ...prev,
      [groupKey]: dealId,
    }));
    setPreviewVerifiedGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
    setPreviewDealInputTextByGroup((prev) => ({
      ...prev,
      [groupKey]: "",
    }));
    requestAnimationFrame(() => {
      const nextScroller = previewTableScrollContainerRef.current;
      if (!nextScroller) return;
      nextScroller.scrollTop = previousScrollTop;
      nextScroller.scrollLeft = previousScrollLeft;
    });
  }, []);

  const handlePreviewPersistActionKey = useCallback(
    async (actionKey: string) => {
      if (previewSavingGroups[actionKey] || previewSavedGroups[actionKey] || previewRemovedGroups[actionKey]) {
        return;
      }
      const rows = previewRowsByActionKey.get(actionKey) ?? [];
      const payloadRows = buildStrictPreviewCommitPayloadRows(
        rows.map((row) => ({
          rowNumber: row.rowNumber,
          effectiveDealToken: row.effectiveDealToken,
          description: row.description,
          rowData: row.rowData,
        })),
        previewDealOptionById,
        mappedDealTokens,
      );
      if (!payloadRows.length) {
        toast.error(
          previewViewMode === "unmapped"
            ? "Select a CRM deal from the dropdown, then click Verify to save."
            : "No CRM-mapped deal rows to save for this group.",
        );
        return;
      }

      /** Mapped tab grouped by sheet deal: all rows saved together must target one CRM deal ID. */
      if (previewViewMode === "mapped") {
        const uniqueTargetDeals = new Set(payloadRows.map((r) => r.dealId.trim()).filter(Boolean));
        if (uniqueTargetDeals.size > 1) {
          toast.error(
            "Verify saves one CRM Deal at a time. This group maps rows to different Deal IDs — align the dropdown so every row uses the same deal.",
          );
          return;
        }
      }

      setPreviewSavingGroups((prev) => ({ ...prev, [actionKey]: true }));
      try {
        const response = await axiosPost(
          "/transactions/upload/preview/commit",
          { transactions: payloadRows },
          { timeout: PREVIEW_COMMIT_REQUEST_TIMEOUT_MS },
        );
        const commitPayload = (response?.data ?? {}) as PreviewCommitResponse;
        const savedCount = Number(commitPayload.data?.savedCount ?? 0);
        const failedCount = Number(commitPayload.data?.failedCount ?? 0);

        if (savedCount > 0) {
          setPreviewVerifiedGroups((prev) => ({ ...prev, [actionKey]: true }));
          setPreviewSavedGroups((prev) => ({ ...prev, [actionKey]: true }));
          setPreviewRemovedGroups((prev) => ({ ...prev, [actionKey]: true }));
          toast.success(
            savedCount === 1
              ? "Transaction has been saved successfully."
              : `${savedCount} transactions have been saved successfully.`,
          );
          /** DB commit is fast; full dashboard refetch can take minutes — run in background so “Saving…” clears immediately. */
          void refreshDashboardAfterTransactionWrites().catch((err: unknown) => {
            console.error("[PaymentHistoryDashboard] background dashboard refresh failed:", err);
          });
        }
        if (failedCount > 0) {
          toast.error(`${failedCount} transaction(s) failed to save. Please review and retry.`);
        }
      } catch (error: any) {
        const message =
          error?.response?.data?.message || error?.message || "Failed to save verified transaction(s).";
        toast.error(message);
      } finally {
        setPreviewSavingGroups((prev) => {
          if (!prev[actionKey]) return prev;
          const next = { ...prev };
          delete next[actionKey];
          return next;
        });
      }
    },
    [
      mappedDealTokens,
      previewDealOptionById,
      previewRemovedGroups,
      previewRowsByActionKey,
      previewSavedGroups,
      previewSavingGroups,
      previewViewMode,
      refreshDashboardAfterTransactionWrites,
    ],
  );

  /** Bulk path: each row keeps its own mapped CRM dealId (many deals in one run). */
  const handlePreviewVerifyAllMapped = useCallback(async () => {
    if (previewViewMode !== "mapped") return;
    if (previewBulkVerifyLockRef.current) return;
    previewBulkVerifyLockRef.current = true;

    const grouped = previewRowsByActionKey;
    const eligibleGroupKeys = [...grouped.keys()].filter(
      (key) =>
        !previewRemovedGroups[key] && !previewSavedGroups[key] && !previewSavingGroups[key],
    );

    const allPayload: PreviewCommitPayloadRow[] = [];
    const contributingGroupKeys = new Set<string>();

    for (const groupKey of eligibleGroupKeys) {
      const rows = grouped.get(groupKey) ?? [];
      const payloadRows = buildStrictPreviewCommitPayloadRows(
        rows.map((row) => ({
          rowNumber: row.rowNumber,
          effectiveDealToken: row.effectiveDealToken,
          description: row.description,
          rowData: row.rowData,
        })),
        previewDealOptionById,
        mappedDealTokens,
      );
      if (payloadRows.length === 0) continue;
      contributingGroupKeys.add(groupKey);
      allPayload.push(...payloadRows);
    }

    if (allPayload.length === 0) {
      toast.info("No CRM-mapped transaction rows left to verify.");
      previewBulkVerifyLockRef.current = false;
      return;
    }

    setPreviewBulkVerifyInProgress(true);
    const touchedKeys = contributingGroupKeys;
    setPreviewSavingGroups((prev) => {
      const next = { ...prev };
      touchedKeys.forEach((k) => {
        next[k] = true;
      });
      return next;
    });

    const failedRowNumbers = new Set<number>();
    const dealIdsForRefetch = new Set<string>();

    try {
      const chunks: PreviewCommitPayloadRow[][] = [];
      for (let i = 0; i < allPayload.length; i += PREVIEW_VERIFY_ALL_CHUNK_SIZE) {
        chunks.push(allPayload.slice(i, i + PREVIEW_VERIFY_ALL_CHUNK_SIZE));
      }

      const chunkResults = await mapWithConcurrency(chunks, PREVIEW_VERIFY_ALL_CONCURRENCY, async (transactions) => {
        const response = await axiosPost(
          "/transactions/upload/preview/commit",
          { transactions },
          { timeout: PREVIEW_COMMIT_REQUEST_TIMEOUT_MS },
        );
        return {
          transactions,
          commitPayload: (response?.data ?? {}) as PreviewCommitResponse,
        };
      });

      for (const { commitPayload } of chunkResults) {
        (commitPayload.data?.failedRows ?? []).forEach((fr) => failedRowNumbers.add(fr.rowNumber));
      }
      for (const { transactions, commitPayload } of chunkResults) {
        const saved = Number(commitPayload.data?.savedCount ?? 0);
        if (saved <= 0) continue;
        transactions.forEach((row) => {
          if (!failedRowNumbers.has(row.rowNumber)) dealIdsForRefetch.add(row.dealId);
        });
      }

      const groupsFullySaved = new Set<string>();
      for (const groupKey of eligibleGroupKeys) {
        const rows = grouped.get(groupKey) ?? [];
        const expected = buildStrictPreviewCommitPayloadRows(
          rows.map((row) => ({
            rowNumber: row.rowNumber,
            effectiveDealToken: row.effectiveDealToken,
            description: row.description,
            rowData: row.rowData,
          })),
          previewDealOptionById,
          mappedDealTokens,
        );
        if (expected.length === 0) continue;
        const anyFailed = expected.some((p) => failedRowNumbers.has(p.rowNumber));
        if (!anyFailed) groupsFullySaved.add(groupKey);
      }

      if (groupsFullySaved.size > 0) {
        setPreviewVerifiedGroups((prev) => {
          const next = { ...prev };
          groupsFullySaved.forEach((k) => {
            next[k] = true;
          });
          return next;
        });
        setPreviewSavedGroups((prev) => {
          const next = { ...prev };
          groupsFullySaved.forEach((k) => {
            next[k] = true;
          });
          return next;
        });
        setPreviewRemovedGroups((prev) => {
          const next = { ...prev };
          groupsFullySaved.forEach((k) => {
            next[k] = true;
          });
          return next;
        });
      }

      const failCount = failedRowNumbers.size;
      const savedGroupCount = groupsFullySaved.size;
      const totalAttempted = allPayload.length;
      if (failCount === 0) {
        toast.success(
          `Verified all ${totalAttempted} transaction(s) across ${savedGroupCount} deal group(s).`,
        );
      } else {
        toast.warning(
          `${totalAttempted - failCount} row(s) saved; ${failCount} failed — fix issues and retry those rows.`,
        );
      }

      if (groupsFullySaved.size > 0 || dealIdsForRefetch.size > 0) {
        void refreshDashboardAfterTransactionWrites().catch((err: unknown) => {
          console.error("[PaymentHistoryDashboard] background dashboard refresh failed:", err);
        });
      }
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (error as Error)?.message ||
        "Bulk verify failed — no data was discarded; you can retry.";
      toast.error(message);
    } finally {
      setPreviewSavingGroups((prev) => {
        const next = { ...prev };
        touchedKeys.forEach((k) => delete next[k]);
        return next;
      });
      setPreviewBulkVerifyInProgress(false);
      previewBulkVerifyLockRef.current = false;
    }
  }, [
    mappedDealTokens,
    previewDealOptionById,
    previewRemovedGroups,
    previewRowsByActionKey,
    previewSavedGroups,
    previewSavingGroups,
    previewViewMode,
    refreshDashboardAfterTransactionWrites,
  ]);

  const handlePreviewRemoveGroup = useCallback((groupKey: string) => {
    setPreviewRemovedGroups((prev) => ({ ...prev, [groupKey]: true }));
    setPreviewVerifiedGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
    setPreviewSavingGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
  }, []);

  const handlePreviewUndoGroup = useCallback((groupKey: string) => {
    setPreviewRemovedGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
    setPreviewSavedGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
  }, []);

  const handlePreviewRevertDealSelection = useCallback((groupKey: string) => {
    setPreviewDealSelectionByGroup((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
    setPreviewDealInputTextByGroup((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
    setPreviewVerifiedGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
    setPreviewSavedGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
  }, []);

  const fundedDealsFinancials = useMemo(() => {
    const list = cohortApplications ?? [];
    const rows: PaymentTransactionRow[] = [];

    list.forEach((app) => {
        const appId = String(app._id ?? (app as { id?: string }).id ?? "");
        const collectionRows = dashboardPaymentsByApp[appId] ?? [];
        const dealId = String(app.dealId ?? "").trim();
        const bal = dashboardBalancesByApp.get(appId);
        const freshBal =
          bal != null
            ? { paybackAmount: bal.paybackAmount, balanceDue: bal.balanceDue }
            : null;
        const row = mapDisbursementApplicationToRow(
          app,
          collectionRows,
          dealId,
          freshBal,
        );
        if (row.id.length === 0) return;
        rows.push(row);
      });

    return {
      rows,
    };
  }, [cohortApplications, dashboardPaymentsByApp, dashboardBalancesByApp]);

  /**
   * Failed Payment KPI — fetch every CollectionPayment row whose `status === DEBIT`
   * and return their sum + count. The backend exposes this aggregation on
   * `cards.failedPayment` (Prisma `aggregate({ where: { status: DEBIT }, _sum: amount, _count: _all })`),
   * so the StatCard reads it directly instead of mixing in the post-pairing FAILED
   * summary which uses different semantics and would distort the total.
   */
  const failedPaymentsSummary = useMemo(() => {
    const debit = dashboard.cards.failedPayment;
    return {
      totalAmount: debit?.totalAmount ?? 0,
      failedTxnCount: debit?.count ?? 0,
    };
  }, [dashboard.cards.failedPayment]);

  const transactions: PaymentTransactionRow[] = fundedDealsFinancials.rows;

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 400);
  /** Rows for the current server page (search is applied via `GET /applications?search=`). */
  const filteredTransactions = transactions;

  /** Payment deals table — server returns one page; show loader until cohort data is ready. */
  const paymentDealsTableLoading =
    !cohortError &&
    (cohortLoading || !cohortFetched || (cohortRefreshing && filteredTransactions.length === 0));

  const cohortListTotal = cohortPagination?.total ?? filteredTransactions.length;

  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [pagination, setPagination] = useState<PaginationState>(() => {
    if (typeof window === "undefined") {
      return { pageIndex: 0, pageSize: 10 };
    }
    try {
      const raw = window.sessionStorage.getItem(PAYMENT_DASHBOARD_PAGINATION_STORAGE_KEY);
      if (!raw) return { pageIndex: 0, pageSize: 10 };
      const parsed = JSON.parse(raw) as Partial<PaginationState>;
      const pageIndex =
        typeof parsed.pageIndex === "number" && Number.isFinite(parsed.pageIndex)
          ? Math.max(0, Math.floor(parsed.pageIndex))
          : 0;
      const pageSize =
        typeof parsed.pageSize === "number" && Number.isFinite(parsed.pageSize) && parsed.pageSize > 0
          ? Math.floor(parsed.pageSize)
          : 10;
      return { pageIndex, pageSize };
    } catch {
      return { pageIndex: 0, pageSize: 10 };
    }
  });

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const totalDeals = dashboard.cards.totalDeals || transactions.length;
  const kpiDealCountLabel = `${totalDeals} ${totalDeals === 1 ? "deal" : "deals"}`;
  const activeDeals =
    dashboard.cards.activeDeals ||
    transactions.filter(
      (tx) => !INACTIVE_STATUS_KEYWORDS.some((keyword) => normalizeStatus(tx.status).includes(keyword)),
    ).length;

  const paymentDealColumns = useMemo<ColumnDef<PaymentTransactionRow>[]>(() => {
    return [
      {
        id: "dealId",
        accessorFn: (row) => row.displayId,
        header: () => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              DEAL ID
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <span className="font-medium text-foreground">{row.original.displayId}</span>
        ),
      },
      {
        id: "businessName",
        accessorFn: (row) => row.client,
        header: () => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              BUSINESS NAME
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-foreground">{row.original.client}</span>
            <span className="mt-0.5 text-xs text-muted-foreground">
              {row.original.category || "Business"}
            </span>
          </div>
        ),
      },
      {
        id: "fundedAmt",
        accessorFn: (row) => row.amount,
        header: () => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              FUNDED AMT
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {formatCurrencyFull(row.original.amount ?? 0)}
          </span>
        ),
      },
      {
        id: "payback",
        accessorFn: (row) => row.paybackAmount,
        header: () => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              PAYBACK
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <span className="text-foreground">
            {formatCurrencyFull(row.original.paybackAmount ?? 0)}
          </span>
        ),
      },
      {
        id: "balanceDue",
        accessorFn: (row) => row.balanceDue,
        header: () => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              BALANCE DUE
            </span>
          </div>
        ),
        cell: ({ row }) => (
          <span className="text-foreground">{formatCurrencyFull(row.original.balanceDue ?? 0)}</span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: () => (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground uppercase tracking-wide">
              CURRENT STATE
            </span>
          </div>
        ),
        cell: ({ row }) => {
          const label = row.original.status;
          const funded = isFundedStatusLabel(label);
          return (
            <span
              className={
                funded
                  ? "inline-flex items-center rounded-full bg-[#E6F9F0] px-3 py-1 text-xs font-semibold text-[#2D8A5B] dark:bg-emerald-950/35 dark:text-emerald-300"
                  : "inline-flex items-center rounded-full border border-[#FDE68A] bg-[#FEF9C3] px-2 py-0.5 text-xs font-medium text-[#A16207] dark:border-amber-300/20 dark:bg-amber-400/15 dark:text-amber-300"
              }
            >
              {label}
            </span>
          );
        },
      },
      {
        id: "view",
        header: () => (
          <span className="font-medium text-foreground uppercase tracking-wide">VIEW</span>
        ),
        cell: ({ row }) => {
          const dealPath = paymentDealPath(row.original.id);
          const isOpeningThisDeal = pendingViewDealId === row.original.id;
          return (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPendingViewDealId(row.original.id);
                navigate(dealPath);
              }}
              className="flex items-center justify-center text-[#276D9C] hover:text-[#1b4e6f] cursor-pointer"
              disabled={isOpeningThisDeal}
              aria-label={`View deal ${row.original.displayId}`}
              aria-busy={isOpeningThisDeal}
            >
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-current">
                {isOpeningThisDeal ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </span>
            </button>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    ];
  }, [navigate, pendingViewDealId]);

  const cohortPageCount =
    cohortPagination?.totalPages ??
    (Math.ceil(cohortListTotal / pagination.pageSize) || 1);

  const paymentDealsTable = useReactTable({
    data: filteredTransactions,
    columns: paymentDealColumns,
    pageCount: cohortPageCount,
    getCoreRowModel: getCoreRowModel(),
    onPaginationChange: setPagination,
    manualPagination: true,
    state: { pagination },
    getRowId: (row) => row.id,
    autoResetPageIndex: false,
  });

  const lastFailedSummaryRouteKeyRef = useRef<string | null>(null);

  /** KPI cards + portfolio chart (cached). Debounced chart filters avoid refetching the deals table. */
  useEffect(() => {
    if (location.pathname !== "/payments") return;
    void dispatch(
      fetchPaymentFinancialOverviewSummary({
        chartYear: debouncedChartYear,
        chartMonth: debouncedChartMonth,
      }),
    );
  }, [dispatch, location.pathname, debouncedChartYear, debouncedChartMonth]);

  useEffect(() => {
    if (location.pathname !== "/payments") return;
    if (lastFailedSummaryRouteKeyRef.current === location.key) return;
    lastFailedSummaryRouteKeyRef.current = location.key;
    void dispatch(fetchPaymentFailedSummary());
  }, [dispatch, location.pathname, location.key]);

  /** Funded deals table only — fast paginated list. */
  useEffect(() => {
    if (location.pathname !== "/payments") return;
    overviewFetchParamsRef.current = {
      pageIndex: pagination.pageIndex,
      pageSize: pagination.pageSize,
      search: debouncedSearchTerm,
      chartYear: moneyFlowFilterYear,
      chartMonth: moneyFlowFilterMonth,
    };
    void dispatch(
      fetchPaymentDashboardFundedDeals(
        buildPaymentFundedCohortParams({
          pageIndex: pagination.pageIndex,
          pageSize: pagination.pageSize,
          search: debouncedSearchTerm,
        }),
      ),
    );
  }, [
    dispatch,
    location.pathname,
    pagination.pageIndex,
    pagination.pageSize,
    debouncedSearchTerm,
  ]);

  /** Balances + collection rows for the current funded-deals page. */
  useEffect(() => {
    if (location.pathname !== "/payments") return;
    if (!cohortFetched) return;
    void dispatch(fetchPaymentDashboardMoney());
  }, [dispatch, location.pathname, cohortFetched, cohortApplications]);

  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [debouncedSearchTerm]);

  useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [viewMode]);

  useEffect(() => {
    const maxPageIndex = Math.max(cohortPageCount - 1, 0);
    setPagination((prev) => {
      if (prev.pageIndex <= maxPageIndex) return prev;
      return { ...prev, pageIndex: maxPageIndex };
    });
  }, [cohortPageCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(
      PAYMENT_DASHBOARD_PAGINATION_STORAGE_KEY,
      JSON.stringify(pagination),
    );
  }, [pagination]);

  return (
    <div className="min-h-screen bg-background p-6 lg:p-10">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Financial Overview
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor your incoming payments and recovery rates.
          </p>
          {paymentDashboardError || cohortError ? (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {paymentDashboardError || cohortError}
            </p>
          ) : null}
          {paymentDashboardRefreshing || cohortRefreshing ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
              {paymentDashboardRefreshing && cohortRefreshing
                ? "Updating payment metrics and deals…"
                : paymentDashboardRefreshing
                  ? "Updating payment metrics…"
                  : "Updating deals list…"}
            </p>
          ) : null}
        </div>
        {isSuperAdmin && (
          <div className="flex w-full shrink-0 flex-col items-stretch gap-3 md:mt-0 md:w-auto md:items-end">
            <div className="flex flex-wrap items-center justify-end gap-2 md:justify-end">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleTransactionSheetUpload}
            />
            <Button
              type="button"
              className="h-9 cursor-pointer rounded-md px-4 text-sm font-semibold"
              onClick={handleUploadButtonClick}
              disabled={uploadingTransactions}
            >
              {uploadingTransactions ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Uploading...
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Upload className="size-4" aria-hidden />
                  Upload Transaction Sheet
                </span>
              )}
            </Button>
            </div>
          </div>
        )}
      </div>

      {transactionPreviewSummary && isPreviewModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 p-4 pt-6">
          <div className="h-[94vh] w-[98vw] max-w-[98vw] overflow-hidden rounded-2xl border border-border/60 bg-background shadow-[0_20px_60px_rgba(15,23,42,0.25)]">
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-5 py-3">
              <h3 className="text-base font-semibold tracking-tight">Transaction Upload Preview</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="cursor-pointer"
                onClick={() => {
                  setIsPreviewModalOpen(false);
                }}
              >
                Close
              </Button>
            </div>
            <div className="h-[calc(94vh-58px)] overflow-auto p-5">
              <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-md bg-muted px-2.5 py-1 font-semibold text-foreground">
                  Total (active preview): {previewRowsCrmTotalActive}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewViewMode("mapped")}
                  className={`cursor-pointer rounded-md px-2.5 py-1 font-semibold ${
                    previewViewMode === "mapped"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted text-foreground/80"
                  }`}
                >
                  Mapped Transactions: {previewModeCounts.mapped}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewViewMode("unmapped")}
                  className={`cursor-pointer rounded-md px-2.5 py-1 font-semibold ${
                    previewViewMode === "unmapped"
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : "bg-muted text-foreground/80"
                  }`}
                >
                  Unmapped Transactions: {previewModeCounts.unmapped}
                </button>
                {previewTruncationFootnote ? (
                  <p className="w-full basis-full text-xs text-amber-800/95 dark:text-amber-300/95">
                    {previewTruncationFootnote}
                  </p>
                ) : null}
                {previewViewMode === "mapped" ? (
                  <button
                    type="button"
                    disabled={previewBulkVerifyInProgress}
                    title="Save every mapped row to its own CRM Deal ID (batched requests). Per-row Verify uses one deal per group only."
                    onClick={() => void handlePreviewVerifyAllMapped()}
                    className={`rounded-md border px-2.5 py-1 font-semibold ${
                      previewBulkVerifyInProgress
                        ? "cursor-not-allowed border-border/60 bg-muted text-muted-foreground opacity-70"
                        : "cursor-pointer border-emerald-600/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/50 dark:bg-emerald-500/15 dark:text-emerald-300"
                    }`}
                  >
                    {previewBulkVerifyInProgress ? "Verifying…" : "Verify All"}
                  </button>
                ) : null}
                {/* <span className="text-muted-foreground">
                  Regex: <code>{transactionPreviewSummary.regex}</code>
                </span> */}
              </div>
              <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                <div className="flex items-center justify-between border-b border-border/60 p-3">
                  <Input
                    value={previewApplicationSearch}
                    onChange={(e) => setPreviewApplicationSearch(e.target.value)}
                    placeholder="Search by Deal ID / Description"
                    className="h-9 w-full max-w-sm text-sm"
                  />
                  <p className="text-xs font-semibold text-muted-foreground">
                    {previewViewMode === "mapped" ? "Mapped Transactions" : "Unmapped Transactions"} — showing{" "}
                    {previewRowsForTable.length} of {previewRowsBaseSorted.length}
                  </p>
                </div>
                <div className="p-4">
                  <div
                    ref={previewTableScrollContainerRef}
                    className="max-h-[62vh] overflow-y-auto overflow-x-auto rounded-lg border-2 border-slate-700/80 dark:border-slate-300/70"
                  >
                    <table className="w-full min-w-[1450px] border-collapse text-left text-sm">
                      <thead className="sticky top-0 z-20 bg-slate-200/95 shadow-[0_1px_0_0_rgba(51,65,85,0.35)] dark:bg-slate-800/95">
                        <tr>
                          <th className="w-44 border border-slate-700/80 px-3 py-2.5 font-semibold dark:border-slate-300/70">Action</th>
                          <th className="border border-slate-700/80 px-3 py-2.5 font-semibold dark:border-slate-300/70">Deal ID</th>
                          {previewExcelHeaders.map((header) => (
                            <th
                              key={`preview-header-${header}`}
                              className="border border-slate-700/80 px-3 py-2.5 font-semibold dark:border-slate-300/70"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRowsForTable.map((row, index) => {
                          const actionKey = previewViewMode === "unmapped" ? row.rowKey : row.groupKey;
                          const isFirstForActionKey = firstIndexByDealIdInPage.get(actionKey) === index;
                          const hasManualDealMapping = Boolean(
                            normalizedPreviewDealSelectionByGroup[actionKey],
                          );
                          return (
                          /**
                           * Key combines rowNumber, rowKey, and visible index so duplicate rowNumbers
                           * (defensive — backend should not emit them, but malformed sheets sometimes do)
                           * never collapse multiple `<tr>` into one. Fixes "3 transactions on one deal
                           * but only 2 (or 1) show up" — every row in the array now gets its own React row.
                           */
                          <tr
                            key={`preview-${row.rowNumber}-${row.rowKey}-${index}`}
                            className={`${
                              (dealGroupToneByKey.get(actionKey) ?? 0) === 0
                                ? "bg-slate-50/70 dark:bg-white/[0.03]"
                                : "bg-blue-50/45 dark:bg-sky-500/[0.08]"
                            } ${
                              previewRemovedGroups[actionKey] ? "opacity-50" : ""
                            } hover:bg-slate-100/70 dark:hover:bg-white/[0.08]`}
                          >
                            {isFirstForActionKey ? (
                              <td
                                rowSpan={dealIdRowSpanInPage.get(actionKey) ?? 1}
                                className="border border-slate-700/80 px-3 py-2.5 align-top dark:border-slate-300/70"
                              >
                                <div className="flex min-w-[220px] flex-col gap-2">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className="flex h-8 w-full cursor-pointer items-center justify-between rounded-md border border-slate-300 bg-white px-2.5 text-left text-xs text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                      >
                                        <span className="truncate">
                                          {previewDealOptionById.get(row.effectiveDealToken)?.label ?? "Select deal"}
                                        </span>
                                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align="start"
                                      className="w-[320px] p-2"
                                      onCloseAutoFocus={(event: Event) => event.preventDefault()}
                                    >
                                      <Input
                                        value={previewDealInputTextByGroup[actionKey] ?? ""}
                                        onChange={(event) =>
                                          setPreviewDealInputTextByGroup((prev) => ({
                                            ...prev,
                                            [actionKey]: event.target.value,
                                          }))
                                        }
                                        placeholder="Search by Deal ID or Name"
                                        className="mb-2 h-8 text-xs"
                                      />
                                      <div className="max-h-56 overflow-y-auto">
                                        {previewDealOptions
                                          .filter((option) => {
                                            const term = (previewDealInputTextByGroup[actionKey] ?? "")
                                              .trim()
                                              .toLowerCase();
                                            if (!term) return true;
                                            return option.token.includes(term);
                                          })
                                          .slice(0, 120)
                                          .map((option) => (
                                            <DropdownMenuItem
                                              key={`preview-deal-option-${actionKey}-${option.dealId}`}
                                              className="cursor-pointer text-xs"
                                              onClick={() => handlePreviewSelectDeal(actionKey, option.dealId)}
                                            >
                                              {option.label}
                                            </DropdownMenuItem>
                                          ))}
                                      </div>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={
                                        previewRemovedGroups[actionKey] ||
                                        previewSavingGroups[actionKey] ||
                                        previewSavedGroups[actionKey]
                                      }
                                      className={`cursor-pointer rounded-md border px-2 py-1 text-xs font-semibold ${
                                        previewSavedGroups[actionKey] || previewVerifiedGroups[actionKey]
                                          ? "border-emerald-700/60 bg-emerald-100 text-emerald-800"
                                          : "border-emerald-600/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                      } ${
                                        previewRemovedGroups[actionKey] ||
                                        previewSavingGroups[actionKey] ||
                                        previewSavedGroups[actionKey]
                                          ? "cursor-not-allowed opacity-60"
                                          : ""
                                      }`}
                                      title={
                                        previewViewMode === "unmapped"
                                          ? "Selections are temporary until Verify — commits this row with the chosen CRM deal."
                                          : "Save every row under this Deal ID column to ONE CRM Deal ID."
                                      }
                                      onClick={() => void handlePreviewPersistActionKey(actionKey)}
                                    >
                                      <span className="inline-flex items-center gap-1">
                                        <Check className="h-3.5 w-3.5" />
                                        {previewSavingGroups[actionKey]
                                          ? "Saving..."
                                          : previewSavedGroups[actionKey]
                                            ? "Saved"
                                            : previewVerifiedGroups[actionKey]
                                              ? "Verified"
                                              : "Verify"}
                                      </span>
                                    </button>
                                    {previewRemovedGroups[actionKey] ? (
                                      <button
                                        type="button"
                                        className="cursor-pointer rounded-md border border-sky-600/50 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                                        title="Undo remove"
                                        onClick={() => handlePreviewUndoGroup(actionKey)}
                                      >
                                        <span className="inline-flex items-center gap-1">
                                          <Undo2 className="h-3.5 w-3.5" />
                                          Undo
                                        </span>
                                      </button>
                                    ) : (
                                      <>
                                        {hasManualDealMapping ? (
                                          <button
                                            type="button"
                                            className="cursor-pointer rounded-md border border-indigo-600/45 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                                            title="Restore original deal mapping"
                                            onClick={() => handlePreviewRevertDealSelection(actionKey)}
                                          >
                                            <span className="inline-flex items-center gap-1">
                                              <RotateCcw className="h-3.5 w-3.5" />
                                              Revert
                                            </span>
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          className="cursor-pointer rounded-md border border-red-600/40 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                                          title="Remove deal group from preview"
                                          onClick={() => handlePreviewRemoveGroup(actionKey)}
                                        >
                                          <span className="inline-flex items-center gap-1">
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Remove
                                          </span>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </td>
                            ) : null}
                            {isFirstForActionKey ? (
                              <td
                                rowSpan={dealIdRowSpanInPage.get(actionKey) ?? 1}
                                className="border border-slate-700/80 px-3 py-2.5 align-middle text-left font-semibold dark:border-slate-300/70"
                              >
                                {row.effectiveDealId ?? "UNMAPPED"}
                              </td>
                            ) : null}
                            {previewExcelHeaders.map((header, headerIdx) => {
                              const cellValue = row.rowData?.[header] ?? "";
                              return (
                                <td
                                  key={`preview-cell-${row.rowNumber}-${index}-${headerIdx}-${header}`}
                                  className="max-w-[320px] truncate border border-slate-700/80 px-3 py-2.5 dark:border-slate-300/70"
                                  title={cellValue}
                                >
                                  {cellValue || "—"}
                                </td>
                              );
                            })}
                          </tr>
                        );
                        })}
                        {previewRowsForTable.length === 0 ? (
                          <tr>
                            <td
                              colSpan={Math.max(1, previewExcelHeaders.length + 2)}
                              className="border border-slate-700/80 px-3 py-6 text-center text-muted-foreground dark:border-slate-300/70"
                            >
                              No transactions found.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          title="Funded Amount"
          titleMeta={kpiDealCountLabel}
          value={formatCurrencyFull(dashboard.cards.fundedTotal ?? 0)}
          trendType="neutral"
          className="min-h-0 min-w-0"
          valuePending={statsValuePending}
        />
        <StatCard
          title="Net Funding Amount"
          titleMeta={kpiDealCountLabel}
          value={formatCurrencyFull(dashboard.cards.netFundingTotal ?? 0)}
          trendType="neutral"
          className="min-h-0 min-w-0"
          valuePending={statsValuePending}
        />
        <StatCard
          title="Above principal Amount"
          titleMeta={kpiDealCountLabel}
          value={formatCurrencyFull(dashboard.cards.abovePrincipalTotal ?? 0)}
          trendType="neutral"
          className="min-h-0 min-w-0"
          valuePending={statsValuePending}
        />
        <StatCard
          title="Recovered Amount"
          titleMeta={kpiDealCountLabel}
          value={formatCurrencyFull(dashboard.cards.recovered)}
          trendType="neutral"
          className="min-h-0 min-w-0"
          valuePending={statsValuePending}
        />
        <StatCard
          title="Failed Payment"
          titleMeta={
            failedPaymentsSummary.failedTxnCount > 0
              ? `${failedPaymentsSummary.failedTxnCount} failed ${failedPaymentsSummary.failedTxnCount === 1 ? "transaction" : "transactions"}`
              : "No failed transactions"
          }
          value={formatCurrencyFull(failedPaymentsSummary.totalAmount)}
          trendType={failedPaymentsSummary.totalAmount > 0 ? "down" : "neutral"}
          className="min-h-0 min-w-0"
          valuePending={statsValuePending}
          onClick={() => navigate("/payments/failed-transactions")}
          ariaLabel="View all failed payment transactions"
        />

        {/* <div className="group relative min-h-[146px] overflow-hidden rounded-2xl border border-border/70 bg-card/90 p-4 shadow-xl ring-1 ring-inset ring-border/40 dark:border-white/10 dark:bg-white/[0.04] dark:ring-white/10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.1),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.06),transparent_55%)]" />
          <div className="relative mb-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Payment Efficiency
            </h3>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Real-time yield
            </p>
          </div>

          <div className="relative mx-auto mt-1 flex h-[96px] w-[96px] items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                innerRadius="80%"
                outerRadius="100%"
                data={chartData}
                startAngle={225}
                endAngle={-45}
                barSize={9}
              >
                <defs>
                  <linearGradient id="gradientColor" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#276D9C" />
                    <stop offset="100%" stopColor="#22d3ee" />
                  </linearGradient>
                </defs>
                <PolarAngleAxis type="number" domain={POLAR_ANGLE_DOMAIN} angleAxisId={0} tick={false} />
                <RadialBar
                  background={RADIAL_BAR_BACKGROUND}
                  dataKey="value"
                  cornerRadius={10}
                  fill="url(#gradientColor)"
                  isAnimationActive={false}
                />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="flex items-baseline">
                <span className="text-3xl font-black tracking-tighter text-foreground">
                  {collectionEfficiency}
                </span>
                <span className="text-base font-bold text-muted-foreground">%</span>
              </div>
            </div>
          </div>
          <div className="relative mt-2 border-t border-border/50 pt-2 text-xs text-muted-foreground dark:border-white/10">
            Collection performance
          </div>
        </div> */}
      </div>


      <CreditDebitTrendChart
        moneyFlowView={moneyFlowView}
        onMoneyFlowViewChange={setMoneyFlowView}
        yearOptions={moneyFlowYearOptions}
        selectedYear={moneyFlowFilterYear}
        onYearChange={setMoneyFlowFilterYear}
        selectedMonth={moneyFlowFilterMonth}
        onMonthChange={setMoneyFlowFilterMonth}
        moneyFlowSubtitle={moneyFlowSubtitle}
        moneyFlowXAxisTitle={moneyFlowXAxisTitle}
        chartMoneyFlowData={chartMoneyFlowData}
        calendarYear={moneyFlowCalendarAnchor.year}
        calendarMonth={moneyFlowCalendarAnchor.month}
        chartDataLoading={showProminentMoneySync}
      />
   

      {cohortError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400">
          {cohortError}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col items-stretch justify-between gap-3 lg:flex-row lg:items-center">
          <div className="relative w-full flex-1 lg:max-w-[520px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              placeholder="Search by Business Name, Deal ID..."
              className="h-10 bg-card pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label="Payment deals display layout"
            >
              <span className="hidden text-xs text-muted-foreground sm:inline">View</span>
              <div className="flex overflow-hidden rounded-md border border-border bg-card">
                <Button
                  type="button"
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-10 cursor-pointer gap-1.5 rounded-none px-3 shadow-none sm:h-9"
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                  title="List view"
                >
                  <LayoutList className="size-4 shrink-0" />
                  <span className="text-xs font-medium">List</span>
                </Button>
                <Button
                  type="button"
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-10 cursor-pointer gap-1.5 rounded-none border-l border-border px-3 shadow-none sm:h-9"
                  onClick={() => setViewMode("grid")}
                  aria-pressed={viewMode === "grid"}
                  title="Grid view"
                >
                  <LayoutGrid className="size-4 shrink-0" />
                  <span className="text-xs font-medium">Grid</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`mt-5 rounded-[5px] border shadow-[0px_4px_20px_0px_#00000005] transition-all duration-300 ${
          isDark ? "border-[#374151] bg-[#141517]" : "border-[#FDFDFD] bg-card"
        }`}
      >
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-t-[5px] px-4 py-2 md:px-5 ${
            isDark ? "bg-[#2A2B2F]" : "bg-[#F9FAFD]"
          }`}
        >
          <span className="inline-flex items-center gap-2 font-roboto text-[1rem] font-semibold uppercase tracking-wide text-foreground">
            Payment deals
          </span>
          <span className="text-xs text-muted-foreground">
            {paymentDealsTableLoading
              ? "Loading…"
              : showProminentMoneySync
                ? "Syncing balances & transactions…"
                : showQuietMoneySync
                  ? "Updating figures in the background…"
                  : `${totalDeals} total in queue · ${activeDeals} active · Funded applications`}
          </span>
        </div>

        <div
          className={`p-1 transition-opacity duration-300 ${
            cohortRefreshing ? "opacity-85" : "opacity-100"
          }`}
        >
          {paymentDealsTableLoading && viewMode === "grid" ? (
            <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-[#276D9C]" aria-hidden />
              Loading payment deals…
            </div>
          ) : viewMode === "list" ? (
            <div className="max-lg:min-h-[min(24rem,55vh)] min-h-[min(32rem,65vh)] overflow-x-auto overflow-y-auto rounded-xl [scrollbar-gutter:stable]">
              <DataTableContent
                table={paymentDealsTable}
                loading={paymentDealsTableLoading}
                loadingMessage="Loading payment deals…"
                emptyMessage={
                  (transactions?.length ?? 0) > 0 && !filteredTransactions.length && debouncedSearchTerm.trim()
                    ? "No matching deals"
                    : "No deals found"
                }
                emptySubMessage={
                  (transactions?.length ?? 0) > 0 && !filteredTransactions.length && debouncedSearchTerm.trim()
                    ? "Try a different search term"
                    : "No applications are currently in the Funded stage."
                }
                onRowClick={(row) => navigate(paymentDealPath(row.original.id))}
              />
            </div>
          ) : !filteredTransactions.length ? (
            <div className="flex flex-col items-center justify-center rounded-xl px-4 py-16 text-center">
              <p className="font-medium text-[#687182]">
                {(transactions?.length ?? 0) > 0 && debouncedSearchTerm.trim()
                  ? "No matching deals"
                  : "No deals found"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(transactions?.length ?? 0) > 0 && debouncedSearchTerm.trim()
                  ? "Try a different search term"
                  : "No applications are currently in the Funded stage."}
              </p>
            </div>
          ) : (
            <div className="max-lg:min-h-[min(24rem,55vh)] min-h-[min(32rem,65vh)] p-3 md:p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {paymentDealsTable.getRowModel().rows.map((row) => {
                  const tx = row.original;
                  return (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(paymentDealPath(tx.id))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate(paymentDealPath(tx.id));
                        }
                      }}
                      aria-label={`Open deal ${tx.displayId}`}
                      className={`flex cursor-pointer flex-col gap-3 rounded-lg border p-4 text-left shadow-sm transition hover:ring-2 hover:ring-[#276D9C]/20 ${
                        isDark
                          ? "border-[#374151] bg-[#1a1b1e]"
                          : "border-[#F0F0F0] bg-card"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-foreground">{tx.client}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Deal ID{" "}
                            <span className="font-medium text-sky-600">{tx.displayId}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {tx.category || "Business"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(paymentDealPath(tx.id));
                          }}
                          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[#276D9C] text-[#276D9C] hover:bg-[#276D9C]/10"
                          aria-label="View deal"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>
                          <span className="text-foreground/80">Funded: </span>
                          {formatCurrencyFull(tx.amount ?? 0)}
                        </p>
                        <p>
                          <span className="text-foreground/80">Balance due: </span>
                          {formatCurrencyFull(tx.balanceDue ?? 0)}
                        </p>
                      </div>
                      <div className="border-t border-border/60 pt-1 dark:border-white/10">
                        <span className="inline-flex   rounded-full border border-[#FDE68A] bg-[#FEF9C3] px-2 py-1 text-xs font-medium text-[#A16207] dark:border-amber-300/20 dark:bg-amber-400/15 dark:text-amber-300">
                          {tx.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!paymentDealsTableLoading && filteredTransactions.length > 0 && (
          <DataTablePagination
            table={paymentDealsTable}
            totalItems={cohortListTotal}
            showSelectedCount={false}
          />
        )}
      </div>
    </div>
  );
};
