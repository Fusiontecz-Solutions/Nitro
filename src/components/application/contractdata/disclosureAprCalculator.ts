import {
    computePerPeriodPayment,
    normalizeFrequency,
    parseTerm,
    resolveOfferFactorRate,
    resolveOfferPayback,
    roundMoney,
} from "@/lib/offerRepaymentCalculations";
import { resolveAppendixUnderwritingFeesDollars, getApplicationClientPrefillArgs } from "./Contract";
import {
    DISCLOSURE_PLATFORM_FEE_USD,
    resolveDisclosureWireFeeUsd,
    resolveIncludeWireFee,
} from "./platformDocumentConfig";

export { DISCLOSURE_PLATFORM_FEE_USD };

export type DisclosureCalculatorFrequency = "Daily" | "Weekly" | "Bi-Weekly" | "Monthly";

/** Origination fee shown on disclosures = applicable fee + optional $25 wire fee. */
export function applyDisclosurePlatformFee(
    applicableFee: number,
    includeWireFee = true,
): number {
    return roundMoney(
        Math.max(0, applicableFee) + resolveDisclosureWireFeeUsd(includeWireFee),
    );
}

/**
 * Disclosure payment frequency labels: Daily / Weekly / Monthly.
 * Written long-form so PDF placeholders like "Weekly" are fully covered.
 */
export function formatDisclosurePaymentFrequencyLabel(raw: unknown): string {
    const text = String(raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
    if (!text) return "";
    if (text === "day" || text === "daily") return "Daily";
    if (text === "week" || text === "weekly") return "Weekly";
    if (text === "bi weekly" || text === "biweekly") return "Bi-Weekly";
    if (text === "month" || text === "monthly") return "Monthly";
    return text.toUpperCase();
}

export interface DisclosureCalculatorInputs {
    state: string;
    frequency: DisclosureCalculatorFrequency;
    merchantName?: string;
    purchasePrice: number;
    factorRate: number;
    originationFee: number;
    brokerFeePaidByMerchant?: number;
    brokerFeePaidByFunder?: number;
    isRefinance?: boolean;
    /** Previous deal payoff / REFI balance (dollars). Used only when isRefinance. */
    refinanceAmount?: number;
    /** Previous deal / agreement date (MM/DD/YYYY or ISO). */
    previousDealDate?: string;
    numberOfPayments: number;
    numberOfPaymentDays: number;
    disbursementDate: string;
    firstPaymentDate: string;
    /** Monthly net-credit / revenue figures from bank analysis (historical method). */
    monthlyRevenues: number[];
    /** Daily / weekly remittance. When set, estimated payment uses this instead of payback ÷ days. */
    paymentAmount?: number;
    /** When false, skip the $25 wire fee on origination / net. Default true. */
    includeWireFee?: boolean;
}

export interface DisclosureCalculatorResult {
    purchasePrice: number;
    revenuePurchased: number;
    amountFinanced: number;
    recipientFunds: number;
    financeCharge: number;
    estimatedTotalPayment: number;
    paymentTotal: number;
    estimatedAnnualPercentageRate: number;
    estimatedMerchantAverageMonthlyRevenue: number;
    estimatedPayment: number;
    estimatedMonthlyCost: number;
    /** % of merchant daily income purchased (disclosure payment terms). */
    percentOfDailyIncomePurchased: number;
    estimatedTermDays: number;
    checkValue: number;
    /** Present when isRefinance — keep separate from recipientFunds / amountFinanced. */
    isRefinance?: boolean;
    netContractedFunding?: number;
    previousRefiBalance?: number;
    actualDisbursement?: number;
    previousDealDate?: string;
}

const WEEKS_PER_MONTH = 4.3;
const BUSINESS_DAYS_PER_WEEK = 5;
/** Business days treated as one month for APR term (50 days → 3 months). */
const APR_BUSINESS_DAYS_PER_MONTH = 20;

function parseMoney(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value == null) return 0;
    const cleaned = String(value).trim().replace(/[$,\s]/g, "").replace(/%$/, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
}

function averagePositive(values: number[]): number {
    const valid = values.filter((v) => Number.isFinite(v) && v > 0);
    if (!valid.length) return 0;
    return roundMoney(valid.reduce((sum, v) => sum + v, 0) / valid.length);
}

/**
 * Daily Estimated Term is remittance days — never weeks (days ÷ 5).
 * (2, 10) = weeks + remittance days → 10. (20, 100) = term days + business days → 20.
 */
export function resolveDailyEstimatedTermDays(args: {
    numberOfPayments?: number;
    numberOfPaymentDays?: number;
    totalPayback?: number;
    paymentAmount?: number;
}): number {
    const payments = Math.max(0, Math.trunc(Number(args.numberOfPayments) || 0));
    const days = Math.max(0, Math.trunc(Number(args.numberOfPaymentDays) || 0));
    const payback = Number(args.totalPayback) || 0;
    const payment = Number(args.paymentAmount) || 0;
    const implied =
        payback > 0 && payment > 0 ? Math.max(1, Math.round(payback / payment)) : 0;

    if (!(payments > 0) && !(days > 0) && !(implied > 0)) return 0;

    if (days > 0 && payments > 0 && days === payments * BUSINESS_DAYS_PER_WEEK) {
        if (payments < 10) return days;
        return payments;
    }

    if (implied > 0) {
        if (payments > 0 && implied === payments * BUSINESS_DAYS_PER_WEEK && payments >= 10) {
            return payments;
        }
        return implied;
    }

    return Math.max(1, days || payments);
}

function resolveDisclosurePaymentSchedule(input: DisclosureCalculatorInputs): {
    /** Weeks in term ("Number of payments in weeks" for daily). */
    numberOfWeeks: number;
    /** Actual count of remittances over the term. */
    actualPaymentCount: number;
} {
    const weeksField = Math.max(1, Math.trunc(input.numberOfPayments) || 1);
    const paymentDays = Math.max(1, Math.trunc(input.numberOfPaymentDays) || 1);

    if (input.frequency === "Daily") {
        const numberOfWeeks =
            weeksField > 0
                ? weeksField
                : Math.max(1, Math.round(paymentDays / BUSINESS_DAYS_PER_WEEK));
        return {
            numberOfWeeks,
            actualPaymentCount: paymentDays,
        };
    }

    if (input.frequency === "Weekly") {
        return { numberOfWeeks: weeksField, actualPaymentCount: weeksField };
    }

    if (input.frequency === "Bi-Weekly") {
        return { numberOfWeeks: weeksField * 2, actualPaymentCount: weeksField };
    }

    return { numberOfWeeks: weeksField * 4, actualPaymentCount: weeksField };
}

/**
 * Percent of merchant's daily income purchased (payment terms).
 * Daily: payment ÷ (avg monthly revenue ÷ payment-days-per-month).
 */
export function computePercentOfMerchantDailyIncomePurchased(args: {
    estimatedPayment: number;
    averageMonthlyRevenue: number;
    frequency: DisclosureCalculatorFrequency;
    numberOfWeeks: number;
    numberOfPaymentDays: number;
}): number {
    const {
        estimatedPayment,
        averageMonthlyRevenue,
        frequency,
        numberOfWeeks,
        numberOfPaymentDays,
    } = args;
    if (!(averageMonthlyRevenue > 0) || !(estimatedPayment > 0)) return 0;

    if (frequency === "Daily") {
        const businessDaysPerWeek = numberOfPaymentDays / Math.max(numberOfWeeks, 1);
        const paymentDaysPerMonth = businessDaysPerWeek * WEEKS_PER_MONTH;
        const avgDailyIncome = averageMonthlyRevenue / Math.max(paymentDaysPerMonth, 1);
        return roundMoney((estimatedPayment / avgDailyIncome) * 100);
    }

    if (frequency === "Weekly") {
        const avgWeeklyIncome = averageMonthlyRevenue / WEEKS_PER_MONTH;
        return roundMoney((estimatedPayment / avgWeeklyIncome) * 100);
    }

    if (frequency === "Bi-Weekly") {
        const avgBiWeeklyIncome = averageMonthlyRevenue / (WEEKS_PER_MONTH / 2);
        return roundMoney((estimatedPayment / avgBiWeeklyIncome) * 100);
    }

    return roundMoney((estimatedPayment / averageMonthlyRevenue) * 100);
}

/** PDF / APR term: 50 business days = 2.5 months → round up to 3. */
export function computeAprTermMonthsFromBusinessDays(businessDays: number): number {
    const days = Math.max(0, businessDays);
    if (!(days > 0)) return 0;
    return Math.max(1, Math.ceil(days / APR_BUSINESS_DAYS_PER_MONTH));
}

/**
 * Estimated term in months for simple APR annualization.
 * Monthly uses payment-period count; daily/weekly use business-days ÷ 20.
 */
export function computeDisclosureTermMonths(args: {
    frequency: DisclosureCalculatorFrequency;
    numberOfPayments: number;
    numberOfPaymentDays: number;
    numberOfWeeks: number;
}): number {
    const { frequency, numberOfPayments, numberOfPaymentDays, numberOfWeeks } = args;
    const periods = Math.max(1, Math.trunc(numberOfPayments) || 1);

    if (frequency === "Monthly") {
        return periods;
    }
    if (frequency === "Bi-Weekly") {
        return Math.max(1, Math.ceil(periods / 2));
    }
    if (frequency === "Weekly") {
        return computeAprTermMonthsFromBusinessDays(periods * BUSINESS_DAYS_PER_WEEK);
    }

    const businessDays =
        numberOfPaymentDays > 0
            ? numberOfPaymentDays
            : Math.max(1, numberOfWeeks) * BUSINESS_DAYS_PER_WEEK;
    return computeAprTermMonthsFromBusinessDays(businessDays);
}

/**
 * Approximate disclosure APR using the MCA APR Calculator inputs from the Guide:
 *   Amount Borrowed → Contract Amount (purchasePrice)
 *   Amount to Pay Back → Total Payback
 *   Estimated Term in Months → deal term in months (business days ÷ 20, rounded up)
 *
 * Calculator annualization (same as the MCA APR tool UI):
 *   Cost Rate = (Payback − Borrowed) / Borrowed = financeCharge / purchasePrice
 *   APR = (Cost Rate / TermMonths) × 12 × 100
 *
 * Example: $10k borrowed, $15k payback, 12 months → cost rate 0.5 → APR 50%.
 */
export function computeDisclosureApr(args: {
    financeCharge: number;
    purchasePrice: number;
    termMonths: number;
}): number {
    const { financeCharge, purchasePrice, termMonths } = args;
    if (!(purchasePrice > 0) || !(financeCharge > 0) || !(termMonths > 0)) return 0;

    const costRate = financeCharge / purchasePrice;
    const apr = (costRate / termMonths) * 12 * 100;
    return roundMoney(apr);
}

export function calculateDisclosureMetrics(
    input: DisclosureCalculatorInputs,
): DisclosureCalculatorResult {
    /** Calculator input `purchasePrice` = funding / contract amount (not payback). */
    const purchasePrice = Math.max(0, input.purchasePrice);
    const factorRate = input.factorRate > 0 ? input.factorRate : 1;
    /** Applicable fee from offer/CRM; disclosures add the optional $25 wire fee. */
    const applicableOriginationFee = Math.max(0, input.originationFee);
    const originationFee = applyDisclosurePlatformFee(
        applicableOriginationFee,
        input.includeWireFee,
    );
    const brokerMerchant = Math.max(0, input.brokerFeePaidByMerchant ?? 0);
    const brokerFunder = Math.max(0, input.brokerFeePaidByFunder ?? 0);
    const isRefinance = Boolean(input.isRefinance);
    const previousRefiBalance = Math.max(0, input.refinanceAmount ?? 0);

    /** Receivables / repayment amount the merchant must repay. */
    const revenuePurchased = roundMoney(purchasePrice * factorRate);
    /**
     * Net Funds Provided = Funding − (applicable fee + optional wire) − broker-by-merchant.
     * Same stack as displayed Origination Fee (applicable + wire).
     */
    const amountFinanced = roundMoney(
        Math.max(0, purchasePrice - originationFee - brokerMerchant),
    );

    /**
     * PDF money layer:
     * - Net Contracted Funding = Contract − Origination (− broker paid by merchant)
     * - Actual Disbursement (REFI) = Net Contracted − Previous Refi Balance
     * - Finance Charge = Total Payback − Contract Amount (same REFI / NO-REFI)
     * Keep Net Contracted and Actual Disbursement as separate values.
     */
    const netContractedFunding = amountFinanced;
    const actualDisbursement = isRefinance
        ? roundMoney(Math.max(0, netContractedFunding - previousRefiBalance))
        : netContractedFunding;
    const checkValue = isRefinance ? previousRefiBalance : 0;
    /** Disclosure “recipient funds” / page-3 top: net after fees; REFI uses actual disbursement. */
    const recipientFunds = isRefinance
        ? actualDisbursement
        : netContractedFunding;
    const financeCharge = roundMoney(
        Math.max(0, revenuePurchased - purchasePrice - brokerFunder),
    );
    const estimatedTotalPayment = revenuePurchased;

    const { numberOfWeeks, actualPaymentCount } = resolveDisclosurePaymentSchedule(input);
    const remittancePayment = Math.max(0, input.paymentAmount ?? 0);
    const estimatedPayment = roundMoney(
        remittancePayment > 0
            ? remittancePayment
            : estimatedTotalPayment / actualPaymentCount,
    );
    const paymentTotal = estimatedTotalPayment;

    /** PDF: Daily × 20, Weekly × 4 (do not use 4.3 conversion for disclosure monthly cost). */
    const estimatedMonthlyCost = roundMoney(
        estimatedPayment *
            (input.frequency === "Weekly"
                ? 4
                : input.frequency === "Bi-Weekly"
                  ? 2
                  : input.frequency === "Monthly"
                    ? 1
                    : 20),
    );

    const estimatedMerchantAverageMonthlyRevenue = averagePositive(input.monthlyRevenues);
    const percentOfDailyIncomePurchased = computePercentOfMerchantDailyIncomePurchased({
        estimatedPayment,
        averageMonthlyRevenue: estimatedMerchantAverageMonthlyRevenue,
        frequency: input.frequency,
        numberOfWeeks,
        numberOfPaymentDays: input.numberOfPaymentDays,
    });

    const termMonths = computeDisclosureTermMonths({
        frequency: input.frequency,
        numberOfPayments: input.numberOfPayments,
        numberOfPaymentDays: input.numberOfPaymentDays,
        numberOfWeeks,
    });
    const estimatedAnnualPercentageRate = computeDisclosureApr({
        financeCharge,
        purchasePrice,
        termMonths,
    });

    /** Daily = remittance days (not weeks). Weekly = weeks × 7. */
    const estimatedTermCalendarDays =
        input.frequency === "Weekly"
            ? Math.max(1, numberOfWeeks * 7)
            : input.frequency === "Daily"
              ? Math.max(
                    1,
                    resolveDailyEstimatedTermDays({
                        numberOfPayments: input.numberOfPayments,
                        numberOfPaymentDays: actualPaymentCount,
                        totalPayback: estimatedTotalPayment,
                        paymentAmount: remittancePayment || estimatedPayment,
                    }),
                )
              : Math.max(0, Math.trunc(input.numberOfPaymentDays));

    return {
        purchasePrice,
        revenuePurchased,
        amountFinanced,
        recipientFunds,
        financeCharge,
        estimatedTotalPayment,
        paymentTotal,
        estimatedAnnualPercentageRate,
        estimatedMerchantAverageMonthlyRevenue,
        estimatedPayment,
        estimatedMonthlyCost,
        percentOfDailyIncomePurchased,
        estimatedTermDays: estimatedTermCalendarDays,
        checkValue,
        isRefinance,
        netContractedFunding,
        previousRefiBalance: isRefinance ? previousRefiBalance : 0,
        actualDisbursement,
        previousDealDate: isRefinance
            ? formatDisclosureUsDate(input.previousDealDate ?? "")
            : undefined,
    };
}

export function stateDisclosureRequiresApr(
    state?: string | null,
    frequency?: string | null,
): boolean {
    const st = String(state ?? "")
        .trim()
        .toLowerCase();
    if (!st) return false;
    const isCa = st === "california" || st === "ca";
    const isNy = st === "new york" || st === "ny";
    return isCa || isNy;
}

export function formatDisclosureUsd(value: number): string {
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(roundMoney(value));
}

export function formatDisclosurePercent(value: number, suffix = "%"): string {
    return `${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(roundMoney(value))}${suffix}`;
}

/** ISO or US date string → MM/DD/YYYY for disclosure PDF fields. */
export function formatDisclosureUsDate(value: unknown): string {
    if (value == null) return "";
    const t = String(value).trim();
    if (!t) return "";
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return t;
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
        return `${t.slice(5, 7)}/${t.slice(8, 10)}/${t.slice(0, 4)}`;
    }
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return t;
    return new Intl.DateTimeFormat("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        timeZone: "UTC",
    }).format(d);
}

export type BankAnalysisRevenueRowTarget = {
    bankAnalysisId: string;
    rowId?: string;
    monthLabel: string;
    monthDate?: string;
    netCredit: number;
    loanTransfer: number;
    deposit: number;
    other: number;
    nsfNegDays: number;
    lowBlcDays: number;
    avgDailyBlc: number;
};

function resolveBankAnalysisId(analysis: unknown): string | null {
    const a = analysis as { _id?: string; id?: string };
    const id = a._id ?? a.id;
    return id != null && String(id).trim() ? String(id) : null;
}

function resolveBankAnalysisRowId(row: unknown): string | undefined {
    const r = row as { _id?: string; id?: string };
    const id = r._id ?? r.id;
    return id != null && String(id).trim() ? String(id) : undefined;
}

export function computeBankAnalysisRowNetCredit(row: unknown): number {
    const totalCredit = parseMoney((row as { totalCredit?: unknown })?.totalCredit);
    const loanTransfer = parseMoney((row as { loanTransfer?: unknown })?.loanTransfer);
    const deposit = parseMoney((row as { deposit?: unknown })?.deposit);
    const other = parseMoney((row as { other?: unknown })?.other);
    const netFromRow = parseMoney((row as { netCredit?: unknown })?.netCredit);
    if (netFromRow > 0) return netFromRow;
    if (totalCredit > 0) return Math.max(0, totalCredit - (loanTransfer + deposit + other));
    return 0;
}

/** Rows with positive net credit, in the same order as {@link extractMonthlyRevenuesFromBankAnalyses}. */
export function listBankAnalysisRevenueRowTargets(analyses: unknown): BankAnalysisRevenueRowTarget[] {
    if (!Array.isArray(analyses)) return [];
    const targets: BankAnalysisRevenueRowTarget[] = [];
    for (const analysis of analyses) {
        const bankAnalysisId = resolveBankAnalysisId(analysis);
        if (!bankAnalysisId) continue;
        const rows = (analysis as { rows?: unknown })?.rows;
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
            const netCredit = computeBankAnalysisRowNetCredit(row);
            if (netCredit <= 0) continue;
            const monthLabel = String((row as { monthLabel?: unknown })?.monthLabel ?? "").trim();
            targets.push({
                bankAnalysisId,
                rowId: resolveBankAnalysisRowId(row),
                monthLabel,
                monthDate:
                    (row as { monthDate?: string })?.monthDate != null
                        ? String((row as { monthDate?: string }).monthDate)
                        : undefined,
                netCredit,
                loanTransfer: parseMoney((row as { loanTransfer?: unknown })?.loanTransfer),
                deposit: parseMoney((row as { deposit?: unknown })?.deposit),
                other: parseMoney((row as { other?: unknown })?.other),
                nsfNegDays: parseMoney((row as { nsfNegDays?: unknown })?.nsfNegDays),
                lowBlcDays: parseMoney((row as { lowBlcDays?: unknown })?.lowBlcDays),
                avgDailyBlc: parseMoney((row as { avgDailyBlc?: unknown })?.avgDailyBlc),
            });
        }
    }
    return targets;
}

export function extractMonthlyRevenuesFromBankAnalyses(
    analyses: unknown,
): number[] {
    return listBankAnalysisRevenueRowTargets(analyses).map((target) => target.netCredit);
}

export function buildDisclosureCalculatorInputsFromSources(args: {
    state?: string | null;
    application?: Record<string, unknown> | null;
    contract?: Record<string, unknown> | null;
    offerDecision?: Record<string, unknown> | null;
    bankAnalyses?: unknown;
    disbursementDate?: string;
    firstPaymentDate?: string;
}): DisclosureCalculatorInputs {
    const contract = args.contract ?? {};
    const offer =
        (contract.offer as Record<string, unknown> | null) ??
        args.offerDecision ??
        null;

    const purchasePrice =
        parseMoney(contract.purchaseAmount) ||
        parseMoney(offer?.offer) ||
        parseMoney(offer?.approvedAmount) ||
        parseMoney(contract.approvedAmount);

    const factorRate = resolveOfferFactorRate({
        offerDecisionRate: parseMoney(offer?.rate),
        offerDecisionFactorRate: parseMoney(offer?.factorRate),
        termsFactorRate: parseMoney(offer?.factorRate),
        fallback: 1.5,
    });

    const payback = resolveOfferPayback(purchasePrice, factorRate, {
        termsPaybackAmount: parseMoney(offer?.paybackAmount),
        offerPaybackAmount: parseMoney(offer?.paybackAmount),
        totalRemit: parseMoney(offer?.totalRemit),
    });

    const termRaw = String(offer?.term ?? offer?.termLength ?? contract.contractLenght ?? "");
    const termNum = parseTerm(termRaw);
    const frequency = normalizeFrequency(
        String(offer?.frequency ?? contract.remittance ?? "Daily"),
    ) as DisclosureCalculatorFrequency;

    let numberOfPayments =
        parseMoney(offer?.numberOfPayments) ||
        (termNum > 0 ? Math.trunc(termNum) : 0);
    let numberOfPaymentDays = numberOfPayments;

    if (frequency === "Daily") {
        const explicitCount = numberOfPayments > 0 ? Math.trunc(numberOfPayments) : 0;
        const term = termNum > 0 ? Math.trunc(termNum) : 0;
        const perPeriod = parseMoney(
            offer?.paymentAmount ?? offer?.repayPerPeriod ?? offer?.daysWeeks,
        );
        const impliedDays =
            payback > 0 && perPeriod > 0 ? Math.max(1, Math.round(payback / perPeriod)) : 0;
        const remittanceDays = resolveDailyEstimatedTermDays({
            numberOfPayments: explicitCount || term,
            numberOfPaymentDays: impliedDays || (term >= 40 ? term : 0),
            totalPayback: payback,
            paymentAmount: perPeriod,
        });
        numberOfPayments = Math.max(1, remittanceDays || impliedDays || term || explicitCount || 1);
        numberOfPaymentDays = numberOfPayments;
    } else if (frequency === "Weekly") {
        numberOfPaymentDays =
            numberOfPayments > 0 ? numberOfPayments * 7 : termNum > 0 ? termNum * 7 : 0;
    } else if (frequency === "Bi-Weekly") {
        numberOfPaymentDays =
            numberOfPayments > 0 ? numberOfPayments * 14 : termNum > 0 ? termNum * 14 : 0;
    } else {
        numberOfPaymentDays =
            numberOfPayments > 0 ? numberOfPayments * 30 : termNum > 0 ? termNum * 30 : 0;
    }

    if (!(numberOfPayments > 0) && payback > 0) {
        const perPeriod = computePerPeriodPayment({ payback, term: termRaw || "1" });
        if (perPeriod > 0) {
            numberOfPayments = Math.max(1, Math.round(payback / perPeriod));
        }
    }

    const originationFee =
        resolveAppendixUnderwritingFeesDollars(
            contract.appendixUnderwritingFees ?? offer?.fees,
            purchasePrice,
        ) ?? parseMoney(contract.appendixUnderwritingFees ?? offer?.fees);

    const app = args.application ?? {};
    const client = (app.client as Record<string, unknown> | null) ?? null;
    const business = (client?.business as Record<string, unknown> | null) ?? null;
    const appPrefill = getApplicationClientPrefillArgs(args.application);
    const merchantName =
        String(
            contract.legalName ??
                contract.clientLegalName ??
                contract.securityBusinessName ??
                appPrefill.legalName ??
                client?.businessName ??
                (business as Record<string, unknown> | null)?.name ??
                "",
        ).trim() || undefined;

    const bankRevenues = extractMonthlyRevenuesFromBankAnalyses(args.bankAnalyses);
    const fallbackRevenue =
        parseMoney(business?.monthlyRevenue) ||
        parseMoney(app.averageMonthlyIncome) ||
        parseMoney(app.averageMonthlyDeposit) ||
        parseMoney(app.avgMonthlyDeposit) ||
        parseMoney((client as Record<string, unknown> | null)?.monthlyRevenue) ||
        parseMoney((business as Record<string, unknown> | null)?.avgMonthlyRevenue);
    const monthlyRevenues =
        bankRevenues.length > 0
            ? bankRevenues
            : fallbackRevenue > 0
              ? [fallbackRevenue]
              : [];

    const today = new Date();
    const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const resolvedPaymentDays = Math.max(1, numberOfPaymentDays || 1);

    const refinanceAmount =
        parseMoney(offer?.refinanceAmount) ||
        parseMoney(contract.refinanceAmount) ||
        parseMoney(
            (contract.contractPrefillOverrides as Record<string, unknown> | null)
                ?.refinanceAmount,
        );
    const isRefinance = refinanceAmount > 0;
    const previousDealDate = formatDisclosureUsDate(
        offer?.previousDealDate ??
            contract.previousDealDate ??
            (contract.contractPrefillOverrides as Record<string, unknown> | null)
                ?.previousDealDate ??
            "",
    );

    const overrides =
        (contract.contractPrefillOverrides as Record<string, unknown> | null) ?? {};
    const includeWireFee = resolveIncludeWireFee(
        overrides.includeWireFee ?? args.contract?.includeWireFee,
    );
    const paymentAmount =
        parseMoney(offer?.paymentAmount ?? offer?.repayPerPeriod ?? offer?.daysWeeks) ||
        parseMoney(contract.remittance);

    return {
        state: String(args.state ?? contract.state ?? "").trim(),
        frequency,
        merchantName,
        purchasePrice,
        factorRate,
        originationFee,
        brokerFeePaidByMerchant: 0,
        brokerFeePaidByFunder: 0,
        isRefinance,
        refinanceAmount: isRefinance ? refinanceAmount : 0,
        previousDealDate: isRefinance ? previousDealDate : undefined,
        numberOfPayments: Math.max(1, numberOfPayments || 1),
        numberOfPaymentDays: resolvedPaymentDays,
        disbursementDate: args.disbursementDate || defaultDate,
        firstPaymentDate: args.firstPaymentDate || args.disbursementDate || defaultDate,
        monthlyRevenues,
        paymentAmount: paymentAmount > 0 ? paymentAmount : undefined,
        includeWireFee,
    };
}

/** Map calculator output to state disclosure DocuSign field ids. */
export function mapDisclosureMetricsToFieldOverrides(
    metrics: DisclosureCalculatorResult,
    options: {
        state?: string | null;
        frequency?: string | null;
        includeApr?: boolean;
    },
): Record<string, string> {
    const includeApr =
        options.includeApr ?? stateDisclosureRequiresApr(options.state, options.frequency);

    const isRefinance = Boolean(metrics.isRefinance);
    const netContracted =
        metrics.netContractedFunding ?? metrics.amountFinanced ?? metrics.recipientFunds;
    const actualDisbursement =
        metrics.actualDisbursement ?? metrics.recipientFunds;
    /**
     * Funding Provided (main box) = contract / purchase price.
     * "Provided to you directly" = net after fees (REFI: actual disbursement).
     */
    const fundingProvidedPrimary = metrics.purchasePrice;
    const fundingProvidedDirect = isRefinance ? actualDisbursement : netContracted;

    const overrides: Record<string, string> = {
        funding_provided: formatDisclosureUsd(fundingProvidedPrimary),
        funding_provided_direct: formatDisclosureUsd(fundingProvidedDirect),
        finance_charge: formatDisclosureUsd(metrics.financeCharge),
        estimated_payment: formatDisclosureUsd(metrics.estimatedPayment),
        daily_payment: formatDisclosureUsd(metrics.estimatedPayment),
        monthly_income: formatDisclosureUsd(metrics.estimatedMerchantAverageMonthlyRevenue),
        avarage_monthly_income: formatDisclosureUsd(
            metrics.estimatedMerchantAverageMonthlyRevenue,
        ),
        etimated_average_income: formatDisclosureUsd(
            metrics.estimatedMerchantAverageMonthlyRevenue,
        ),
        estimated_term: String(metrics.estimatedTermDays),
        percent_of_business_income: formatDisclosurePercent(
            metrics.percentOfDailyIncomePurchased,
            "",
        ),
        /** Purchase Price / funds provided amount = funding (contract) amount. */
        total_amount_business_fund: formatDisclosureUsd(metrics.purchasePrice),
        purchase_amount: formatDisclosureUsd(metrics.purchasePrice),
        disclosure_purchase_price: formatDisclosureUsd(metrics.purchasePrice),
        total_amount_of_fund_disbursed: formatDisclosureUsd(netContracted),
        NetFundProvided: formatDisclosureUsd(netContracted),
        /** Receivables = repayment amount. */
        total_amount_tobe_paid_to_provider: formatDisclosureUsd(metrics.estimatedTotalPayment),
        total_dollar_cost: formatDisclosureUsd(metrics.financeCharge),
        estimated_payment_amount: formatDisclosureUsd(metrics.estimatedPayment),
        estimated_monthly_cost: formatDisclosureUsd(metrics.estimatedMonthlyCost),
        payment_total: formatDisclosureUsd(metrics.estimatedTotalPayment),
        receivables: formatDisclosureUsd(metrics.estimatedTotalPayment),
        revenue_purchased: formatDisclosureUsd(metrics.estimatedTotalPayment),
        payement_exceeded_percent: formatDisclosurePercent(
            metrics.percentOfDailyIncomePurchased,
            "",
        ),
        ...(formatDisclosurePaymentFrequencyLabel(options.frequency)
            ? {
                  payment_frequency: formatDisclosurePaymentFrequencyLabel(options.frequency),
                  disclosure_payment_frequency: formatDisclosurePaymentFrequencyLabel(
                      options.frequency,
                  ),
              }
            : {}),
    };

    if (isRefinance && metrics.previousDealDate) {
        overrides.previous_agreement_date = metrics.previousDealDate;
        overrides.previous_deal_date = metrics.previousDealDate;
    }
    if (isRefinance && (metrics.previousRefiBalance ?? 0) > 0) {
        overrides.previous_refi_balance = formatDisclosureUsd(metrics.previousRefiBalance ?? 0);
        overrides.outstanding_sales_based_financing = formatDisclosureUsd(
            metrics.previousRefiBalance ?? 0,
        );
    }

    if (includeApr) {
        // PDF already prints "%"; do not append another suffix.
        overrides.estimated_annual_percentage_rate = formatDisclosurePercent(
            metrics.estimatedAnnualPercentageRate,
            "",
        );
    }

    return overrides;
}
