import { formatNumberUS } from "@/lib/utils";

/** SPA denominator: average net credit / revenue from the last N full months (MTD excluded). */
export const SPA_AVG_REVENUE_MONTH_WINDOW = 3;

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
] as const;

function parseNum(value: unknown): number {
    const raw = String(value ?? "").trim();
    if (!raw) return NaN;
    const n = Number.parseFloat(raw.replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : NaN;
}

function normalizeMonthLabelKey(month: string | undefined | null): string {
    return month != null ? String(month).trim().toLowerCase() : "";
}

function parseMonthLabelToDate(label: string): Date | null {
    const raw = String(label ?? "").trim();
    if (!raw) return null;
    const m = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
        const idx = MONTH_NAMES.findIndex(
            (name) => name.toLowerCase() === m[1].toLowerCase(),
        );
        if (idx >= 0) return new Date(Number(m[2]), idx, 1);
    }
    const iso = raw.match(/^(\d{4})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, 1);
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function monthLabelSortKey(label: string): number {
    const d = parseMonthLabelToDate(label);
    return d != null && !Number.isNaN(d.getTime())
        ? d.getTime()
        : Number.NEGATIVE_INFINITY;
}

function sortMonthsDesc(months: string[]): string[] {
    return [...months].sort((a, b) => {
        const diff = monthLabelSortKey(b) - monthLabelSortKey(a);
        if (diff !== 0) return diff;
        return String(a).localeCompare(String(b));
    });
}

function hasEnteredNumericValue(raw: string | undefined | null): boolean {
    if (raw == null) return false;
    const s = String(raw).trim();
    if (!s || /^e\.?\s*g\.?/i.test(s)) return false;
    const cleaned = s.replace(/[^0-9.-]+/g, "");
    if (!cleaned) return false;
    return !Number.isNaN(Number.parseFloat(cleaned));
}

function parseCurrency(value: string | undefined | null): number {
    if (!value) return 0;
    const cleaned = String(value).replace(/[^0-9.-]+/g, "");
    if (!cleaned) return 0;
    const num = Number.parseFloat(cleaned);
    return Number.isNaN(num) ? 0 : num;
}

type BankMonthRow = {
    month?: string;
    monthLabel?: string;
    totalCredit?: string | number | null;
    loanTransfer?: string | number | null;
    deposit?: string | number | null;
    other?: string | number | null;
    avgDailyBlc?: string | number | null;
};

function rowMonthLabel(row: BankMonthRow): string {
    const raw = row.month ?? row.monthLabel;
    return raw != null ? String(raw).trim() : "";
}

type BankTableLike = { rows?: BankMonthRow[] | null };

function rowNetCredit(row: BankMonthRow): number | null {
    // SPA revenue denominator should follow the Scrubbing tab logic:
    // use the Bank Analysis "Credits" column directly (no netting against transfers/deposits/other).
    const totalCredit = parseCurrency(String(row.totalCredit ?? ""));
    const hasCredits = hasEnteredNumericValue(String(row.totalCredit ?? ""));
    if (!hasCredits) return null;
    return totalCredit;
}

/**
 * Average net credit across bank months.
 * @param monthWindow When set, uses only the newest N non-MTD months; otherwise all active months.
 */
export function computeAvgNetCreditFromBankTables(
    banks: BankTableLike[] | null | undefined,
    monthWindow?: number,
): number | null {
    if (!Array.isArray(banks) || banks.length === 0) return null;

    const activeMonthSet = new Set<string>();
    for (const table of banks) {
        for (const row of table.rows ?? []) {
            const monthLabel = normalizeMonthLabelKey(rowMonthLabel(row));
            if (!monthLabel || monthLabel.includes("mtd")) continue;
            const nc = rowNetCredit(row);
            if (nc !== null) activeMonthSet.add(monthLabel);
        }
    }

    const firstRows = banks[0]?.rows ?? [];
    const orderedMonths = sortMonthsDesc(
        firstRows
            .map((r) => String(rowMonthLabel(r) || "").trim())
            .filter((m) => {
                const ml = normalizeMonthLabelKey(m);
                return ml && !ml.includes("mtd") && activeMonthSet.has(ml);
            }),
    );
    const monthsForAvg =
        monthWindow != null && monthWindow > 0
            ? orderedMonths.slice(0, monthWindow)
            : orderedMonths;

    if (!monthsForAvg.length) return null;

    let sum = 0;
    let count = 0;
    for (const month of monthsForAvg) {
        let monthSum = 0;
        let bankCount = 0;
        for (const table of banks) {
            const row = (table.rows ?? []).find(
                (r) =>
                    normalizeMonthLabelKey(rowMonthLabel(r)) ===
                    normalizeMonthLabelKey(month),
            );
            if (!row) continue;
            const nc = rowNetCredit(row);
            if (nc === null) continue;
            monthSum += nc;
            bankCount += 1;
        }
        if (bankCount > 0) {
            sum += monthSum;
            count += 1;
        }
    }
    if (count === 0) return null;
    return sum / count;
}

const ACTIVE_POSITION_STATUSES = new Set([
    "ACTIVE",
    "CURRENT",
    "OPEN",
    "OUTSTANDING",
    "SELECT",
]);

function getMonthlyMcaPmtsForPosition(row: Record<string, unknown>): number {
    const manual = String(row.monthlyMcaPmts ?? "").trim();
    if (manual) {
        const p = parseNum(manual);
        if (!Number.isNaN(p) && p >= 0) return p;
    }
    // For SPA we now align with Scrubbing tab guidance:
    // the Positions "Repayment" column total is treated as the monthly payment.
    const installment = parseNum(row.installment);
    if (Number.isNaN(installment) || installment <= 0) return 0;
    return installment;
}

function isActivePositionForTotals(row: Record<string, unknown>): boolean {
    const status = String(row.status ?? "")
        .trim()
        .toUpperCase();
    if (status && ACTIVE_POSITION_STATUSES.has(status)) return true;
    const keys = ["amountFunded", "installment", "monthlyMcaPmts", "mcaRemit"] as const;
    return keys.some((key) => {
        const v = row[key];
        return v != null && String(v).trim() !== "" && !Number.isNaN(parseNum(v));
    });
}

/** Sum of monthly MCA payments from active stack positions plus optional new-offer monthly payment. */
export function computeTotalMonthlyPayments(
    positions: Array<Record<string, unknown>> | null | undefined,
    offerMonthlyPayment?: number | null,
): number {
    let sum = 0;
    for (const row of positions ?? []) {
        if (!isActivePositionForTotals(row)) continue;
        const monthly = getMonthlyMcaPmtsForPosition(row);
        if (!Number.isNaN(monthly) && monthly > 0) sum += monthly;
    }
    const offerMonthly = offerMonthlyPayment ?? 0;
    if (Number.isFinite(offerMonthly) && offerMonthly > 0) sum += offerMonthly;
    return sum;
}

/**
 * SPA (Specified Percentage) = (total monthly payments / average revenue of last 3 months) × 100
 */
export function computeSpecifiedPurchasePercent(
    totalMonthlyPayments: number,
    avgRevenueLast3Months: number,
): string | null {
    if (!(totalMonthlyPayments > 0) || !(avgRevenueLast3Months > 0)) return null;
    const pct = (totalMonthlyPayments / avgRevenueLast3Months) * 100;
    if (!Number.isFinite(pct) || pct <= 0) return null;
    return formatNumberUS(pct.toFixed(2));
}

export function resolveSpecifiedPurchasePercentFromScrubbing(args: {
    banks?: BankTableLike[] | null;
    positions?: Array<Record<string, unknown>> | null;
    offerMonthlyPayment?: number | null;
}): string | null {
    const breakdown = buildSpaCalculationBreakdown(args);
    return breakdown.spa;
}

export type SpaBankMonthContribution = {
    bankBackendId: string;
    rowBackendId?: string;
    netCredit: number;
    totalCredit: number;
    loanTransfer: number;
    deposit: number;
    other: number;
};

export type SpaMonthlyRevenueRow = {
    month: string;
    netCredit: number;
    includedInSpaAverage: boolean;
    bankContributions?: SpaBankMonthContribution[];
};

export type SpaMonthlyPaymentRow = {
    label: string;
    amount: number;
    source: "position" | "offer";
    positionId?: string;
};

export type SpaCalculationBreakdown = {
    monthlyRevenues: SpaMonthlyRevenueRow[];
    monthlyPayments: SpaMonthlyPaymentRow[];
    totalMonthlyPayments: number;
    avgRevenueLast3Months: number | null;
    monthsUsedForAverage: string[];
    spa: string | null;
};

function positionPaymentLabel(row: Record<string, unknown>, index: number): string {
    const lender = String(row.lender ?? row.funder ?? row.fundingCompany ?? "").trim();
    return lender || `Position ${index + 1}`;
}

/** Per-month net credit across all banks; flags last N months used for SPA average. */
export function buildSpaMonthlyRevenueRows(
    banks: BankTableLike[] | null | undefined,
    monthWindow: number = SPA_AVG_REVENUE_MONTH_WINDOW,
): { rows: SpaMonthlyRevenueRow[]; monthsUsedForAverage: string[] } {
    if (!Array.isArray(banks) || banks.length === 0) {
        return { rows: [], monthsUsedForAverage: [] };
    }

    const activeMonthSet = new Set<string>();
    for (const table of banks) {
        for (const row of table.rows ?? []) {
            const monthLabel = normalizeMonthLabelKey(rowMonthLabel(row));
            if (!monthLabel || monthLabel.includes("mtd")) continue;
            const nc = rowNetCredit(row);
            if (nc !== null) activeMonthSet.add(monthLabel);
        }
    }

    const firstRows = banks[0]?.rows ?? [];
    const orderedMonths = sortMonthsDesc(
        firstRows
            .map((r) => String(rowMonthLabel(r) || "").trim())
            .filter((m) => {
                const ml = normalizeMonthLabelKey(m);
                return ml && !ml.includes("mtd") && activeMonthSet.has(ml);
            }),
    );
    const monthsForAvg =
        monthWindow > 0 ? orderedMonths.slice(0, monthWindow) : orderedMonths;
    const avgMonthKeys = new Set(
        monthsForAvg.map((m) => normalizeMonthLabelKey(m)),
    );

    const rows: SpaMonthlyRevenueRow[] = [];
    for (const month of orderedMonths) {
        let monthSum = 0;
        let bankCount = 0;
        const bankContributions: SpaBankMonthContribution[] = [];
        for (const table of banks) {
            const bankBackendId = String(
                (table as { _id?: string; id?: string })._id ??
                    (table as { _id?: string; id?: string }).id ??
                    "",
            ).trim();
            const row = (table.rows ?? []).find(
                (r) =>
                    normalizeMonthLabelKey(rowMonthLabel(r)) ===
                    normalizeMonthLabelKey(month),
            );
            if (!row) continue;
            const nc = rowNetCredit(row);
            if (nc === null) continue;
            const totalCredit = parseCurrency(String(row.totalCredit ?? ""));
            const loanTransfer = parseCurrency(String(row.loanTransfer ?? ""));
            const deposit = parseCurrency(String(row.deposit ?? ""));
            const other = parseCurrency(String(row.other ?? ""));
            const rowBackendId = String(
                (row as { _id?: string; id?: string })._id ??
                    (row as { _id?: string; id?: string }).id ??
                    "",
            ).trim();
            bankContributions.push({
                bankBackendId,
                rowBackendId: rowBackendId || undefined,
                netCredit: nc,
                totalCredit,
                loanTransfer,
                deposit,
                other,
            });
            monthSum += nc;
            bankCount += 1;
        }
        if (bankCount === 0) continue;
        rows.push({
            month,
            netCredit: monthSum,
            includedInSpaAverage: avgMonthKeys.has(normalizeMonthLabelKey(month)),
            bankContributions,
        });
    }

    return { rows, monthsUsedForAverage: monthsForAvg };
}

/** Active position MCA payments plus optional new-offer monthly payment. */
export function buildSpaMonthlyPaymentRows(
    positions: Array<Record<string, unknown>> | null | undefined,
    offerMonthlyPayment?: number | null,
): SpaMonthlyPaymentRow[] {
    const rows: SpaMonthlyPaymentRow[] = [];
    let positionIndex = 0;
    for (const row of positions ?? []) {
        if (!isActivePositionForTotals(row)) continue;
        const monthly = getMonthlyMcaPmtsForPosition(row);
        const positionId = String(row._id ?? row.id ?? "").trim() || undefined;
        rows.push({
            label: positionPaymentLabel(row, positionIndex),
            amount: Number.isNaN(monthly) || monthly < 0 ? 0 : monthly,
            source: "position",
            positionId,
        });
        positionIndex += 1;
    }
    const offerMonthly = offerMonthlyPayment ?? 0;
    if (Number.isFinite(offerMonthly) && offerMonthly > 0) {
        rows.push({
            label: "New offer monthly payment",
            amount: offerMonthly,
            source: "offer",
        });
    }
    return rows;
}

export function buildSpaCalculationBreakdown(args: {
    banks?: BankTableLike[] | null;
    positions?: Array<Record<string, unknown>> | null;
    offerMonthlyPayment?: number | null;
}): SpaCalculationBreakdown {
    const { rows: monthlyRevenues, monthsUsedForAverage } = buildSpaMonthlyRevenueRows(
        args.banks,
        SPA_AVG_REVENUE_MONTH_WINDOW,
    );
    const monthlyPayments = buildSpaMonthlyPaymentRows(
        args.positions,
        args.offerMonthlyPayment,
    );
    return computeSpaBreakdownFromRows(monthlyPayments, monthlyRevenues, monthsUsedForAverage);
}

/** Recompute SPA totals from editable payment/revenue rows (e.g. SPA modal). */
export function computeSpaBreakdownFromRows(
    monthlyPayments: SpaMonthlyPaymentRow[],
    monthlyRevenues: SpaMonthlyRevenueRow[],
    monthsUsedForAverage?: string[],
): SpaCalculationBreakdown {
    const totalMonthlyPayments = monthlyPayments.reduce(
        (sum, row) => sum + (Number.isFinite(row.amount) && row.amount > 0 ? row.amount : 0),
        0,
    );
    const includedRevenues = monthlyRevenues.filter((row) => row.includedInSpaAverage);
    const avgRevenueLast3Months =
        includedRevenues.length > 0
            ? includedRevenues.reduce((sum, row) => sum + row.netCredit, 0) /
              includedRevenues.length
            : null;
    const spa =
        avgRevenueLast3Months != null && avgRevenueLast3Months > 0
            ? computeSpecifiedPurchasePercent(totalMonthlyPayments, avgRevenueLast3Months)
            : null;

    return {
        monthlyPayments,
        monthlyRevenues,
        totalMonthlyPayments,
        avgRevenueLast3Months,
        monthsUsedForAverage:
            monthsUsedForAverage ??
            includedRevenues.map((row) => row.month),
        spa,
    };
}
