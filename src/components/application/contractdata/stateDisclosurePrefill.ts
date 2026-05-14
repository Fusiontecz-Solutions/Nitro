import type { ContractPrefillField } from "./Contract";
import { buildDailyCaliforniaContractPrefillFields } from "./daily_california";
import { buildDailyConnecticutContractPrefillFields } from "./daily_connecticut";
import { buildDailyFloridaContractPrefillFields } from "./Daily_florida";
import { buildDailyGeorgiaContractPrefillFields } from "./Daily_georgia";
import { buildDailyKansasContractPrefillFields } from "./Daily_kansas";
import { buildDailyNewYorkContractPrefillFields } from "./Daily_new_york";
import { buildDailyVirginiaContractPrefillFields } from "./daily_virginia";
import { buildWeeklyCaliforniaContractPrefillFields } from "./Weekly_California";

/**
 * Unified, concept-level inputs derived from CRM contract / offer / application data.
 * Each per-state builder picks the slots it needs and maps them to its template field ids.
 *
 * All values should be pre-formatted strings (USD numbers with 2 decimals, dates as MM/DD/YYYY)
 * because individual state builders only trim/passthrough.
 */
export interface StateDisclosureContext {
    /** Total amount of financing/funding provided (Contract.purchaseAmount). */
    fundingProvided?: string;
    /** Amount actually disbursed after fees (Contract.purchaseAmount - underwriting fees). */
    fundingDisbursed?: string;
    /** Fees deducted at disbursement (Contract.appendixUnderwritingFees). */
    feesDeducted?: string;
    /** Total amount client repays (Contract.purchasePrice). */
    totalRepayment?: string;
    /** Total dollar cost of financing (totalRepayment - fundingProvided). */
    totalDollarCost?: string;
    /** Same as totalDollarCost in many state forms ("finance charge"). */
    financeCharge?: string;
    /** Per-period payment (daily / weekly remittance). */
    estimatedPayment?: string;
    /** Estimated APR percent. */
    estimatedAnnualPercentageRate?: string;
    /** Average monthly business income / revenue. */
    averageMonthlyIncome?: string;
    /** Percent that the payment may exceed of business income. */
    paymentExceededPercent?: string;
    /** Estimated term length (days/weeks/months) of the agreement. */
    estimatedTerm?: string;
    /** Estimated total number of payments. */
    estimatedNumberOfPayments?: string;
    /** Prepayment description / amount text. */
    prepayment?: string;
    /** Recipient (legal client / business) name. */
    recipientName?: string;
    /** Recipient business address (single line). */
    recipientAddress?: string;
    /** Disclosure / signature date — usually the agreement date. */
    signatureDate?: string;
    /** Date by which prepayment amount must be received to qualify for discount. */
    prepaymentReceivedByDate?: string;
    /** Amount required to trigger prepayment discount. */
    prepaymentDiscountAmount?: string;
}

type StateDisclosureBuilder = (ctx: StateDisclosureContext) => ContractPrefillField[];

/**
 * Dispatch key matches `BoldSignTemplate.name` (lowercased) and falls back to
 * `${frequency}_${state}` so callers can resolve from either source.
 */
const REGISTRY: Record<string, StateDisclosureBuilder> = {
    daily_california: (ctx) =>
        buildDailyCaliforniaContractPrefillFields({
            fundingProvided: ctx.fundingProvided,
            estimatedAnnualPercentageRate: ctx.estimatedAnnualPercentageRate,
            estimatedPayment: ctx.estimatedPayment,
            dailyPayment: ctx.estimatedPayment,
            estimatedPercent: ctx.paymentExceededPercent,
            avarageMonthlyIncome: ctx.averageMonthlyIncome,
            payementExceededPercent: ctx.paymentExceededPercent,
            monthlyIncome: ctx.averageMonthlyIncome,
            financeCharge: ctx.financeCharge,
            signatureDate: ctx.signatureDate,
        }),

    daily_connecticut: (ctx) =>
        buildDailyConnecticutContractPrefillFields({
            totalCommericalFinancing: ctx.totalRepayment,
            deductedAtDisbursement: ctx.feesDeducted,
            totalAmountCommercialFinancing: ctx.fundingProvided,
            financeCharge: ctx.financeCharge,
            totalRepaymentAmount: ctx.totalRepayment,
            estimatedTimePeriodicPaymement: ctx.estimatedTerm,
            disclosureDate: ctx.signatureDate,
            recipientName: ctx.recipientName,
            recipientAddress: ctx.recipientAddress,
            amountTriggerPrepayment: ctx.prepaymentDiscountAmount,
            dateWhichAmountReceived: ctx.prepaymentReceivedByDate,
            recipientName2: ctx.recipientName,
            disclosureDate2: ctx.signatureDate,
            recipientAddress2: ctx.recipientAddress,
            theestimatedpayment: ctx.estimatedPayment,
            paymentExceedPercent: ctx.paymentExceededPercent,
            signature1Date: ctx.signatureDate,
            signature2Date: ctx.signatureDate,
        }),

    daily_florida: (ctx) =>
        buildDailyFloridaContractPrefillFields({
            totalAmountBusinessFund: ctx.fundingProvided,
            totalAmountOfFundDisbursed: ctx.fundingDisbursed,
            totalAmountTobePaidToProvider: ctx.totalRepayment,
            totalDollarCost: ctx.totalDollarCost,
            estimatedPaymentAmount: ctx.estimatedPayment,
            paymentExceededPercent: ctx.paymentExceededPercent,
            percentOfBusinessIncome: ctx.paymentExceededPercent,
            paymentFallenBelowPercent: ctx.paymentExceededPercent,
            consistentWithPercent: ctx.paymentExceededPercent,
            amountRequiredToTriggerPrepaymentDiscount: ctx.prepaymentDiscountAmount,
            dateByWhichAmountMustbeReceived: ctx.prepaymentReceivedByDate,
            signatureDate: ctx.signatureDate,
        }),

    daily_georgia: (ctx) =>
        buildDailyGeorgiaContractPrefillFields({
            totalAmountBusinessFund: ctx.fundingProvided,
            totalAmountOfFundDisbursed: ctx.fundingDisbursed,
            totalAmountToBePaid: ctx.totalRepayment,
            totalDollarCost: ctx.totalDollarCost,
            estimatedPaymentAmount: ctx.estimatedPayment,
            exceededPercent: ctx.paymentExceededPercent,
            consistentWith: ctx.paymentExceededPercent,
            paymentsFallenBelowPercent: ctx.paymentExceededPercent,
            percentOfBusinessIncome: ctx.paymentExceededPercent,
            amountTriggerPrepayment: ctx.prepaymentDiscountAmount,
            amountReceivedByWhichDate: ctx.prepaymentReceivedByDate,
            signature1Date: ctx.signatureDate,
        }),

    daily_kansas: (ctx) =>
        buildDailyKansasContractPrefillFields({
            totalAmountOfFundProvided: ctx.fundingProvided,
            totalAmountFundDisbursed: ctx.fundingDisbursed,
            totalOfPayments: ctx.totalRepayment,
            totalDollarCostOfFrinancing: ctx.totalDollarCost,
            estimatedPayment: ctx.estimatedPayment,
            exceededPayment: ctx.paymentExceededPercent,
            agreementDuration: ctx.estimatedTerm,
            paymentFallen: ctx.paymentExceededPercent,
            consistentWithBusiness: ctx.paymentExceededPercent,
            signatureDate: ctx.signatureDate,
        }),

    daily_new_york: (ctx) =>
        buildDailyNewYorkContractPrefillFields({
            fundingProvided: ctx.fundingProvided,
            estimatedAnnualPercentageRate: ctx.estimatedAnnualPercentageRate,
            estimatedPayment: ctx.estimatedPayment,
            dailyPayment: ctx.estimatedPayment,
            etimatedAverageIncome: ctx.averageMonthlyIncome,
            monthlyIncome: ctx.averageMonthlyIncome,
            paymentExceeded: ctx.paymentExceededPercent,
            estimatedTerm: ctx.estimatedTerm,
            prepayment: ctx.prepayment,
            signatureDate: ctx.signatureDate,
        }),

    daily_virginia: (ctx) =>
        buildDailyVirginiaContractPrefillFields({
            totalAmountSalesBasedFinancing: ctx.fundingProvided,
            feesDeducted: ctx.feesDeducted,
            disbursementAmount: ctx.fundingDisbursed,
            financeCharge: ctx.financeCharge,
            totalRepaymentAmount: ctx.totalRepayment,
            estimatedNumberOfPayement: ctx.estimatedNumberOfPayments,
            disclosureDate: ctx.signatureDate,
            disclosureName: ctx.recipientName,
            recipientAddress: ctx.recipientAddress,
            prepaymentDiscount: ctx.prepaymentDiscountAmount,
            dateOfAmountReceived: ctx.prepaymentReceivedByDate,
            signatureDate: ctx.signatureDate,
            recipientName2: ctx.recipientName,
            disclosureDate2: ctx.signatureDate,
            recipientAddress1: ctx.recipientAddress,
            fordailypayments: ctx.estimatedPayment,
            exceededPayment: ctx.paymentExceededPercent,
            weeklyPayments: ctx.estimatedPayment,
            paymentExceededPercent: ctx.paymentExceededPercent,
            signatureDate2: ctx.signatureDate,
        }),

    weekly_california: (ctx) =>
        buildWeeklyCaliforniaContractPrefillFields({
            fundingProvided: ctx.fundingProvided,
            estimatedAnnualPercentageRate: ctx.estimatedAnnualPercentageRate,
            estimatedPayment: ctx.estimatedPayment,
            presentWeeklyPayment: ctx.estimatedPayment,
            outEstimatedPercent: ctx.paymentExceededPercent,
            averageMonthlyIncome: ctx.averageMonthlyIncome,
            paymentExceededPercent: ctx.paymentExceededPercent,
            estimatedTerm: ctx.estimatedTerm,
            prepayment: ctx.prepayment,
            date: ctx.signatureDate,
        }),
};

/* ----------------------------- formatting helpers ----------------------------- */

function coerceFiniteNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean" || value == null) return undefined;
    if (typeof value === "bigint") return Number(value);
    if (typeof value === "object") {
        const o = value as { toNumber?: unknown; valueOf?: unknown };
        if (typeof o.toNumber === "function") {
            const n = Number((o as { toNumber(): unknown }).toNumber());
            return Number.isFinite(n) ? n : undefined;
        }
        if (typeof o.valueOf === "function") {
            const n = Number((o as { valueOf(): unknown }).valueOf());
            if (Number.isFinite(n)) return n;
        }
    }
    const s =
        typeof value === "string"
            ? value.trim().replace(/,/g, "").replace(/^[$€£¥]\s*/, "")
            : String(value ?? "").trim();
    if (!s) return undefined;
    const parsed = Number(s);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function formatUsd(value: unknown): string {
    const n = coerceFiniteNumber(value);
    if (n === undefined) return "";
    const truncated = Math.trunc(n * 100) / 100;
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(truncated);
}

function formatPercent(value: unknown, suffix = "%"): string {
    const n = coerceFiniteNumber(value);
    if (n === undefined) return "";
    const truncated = Math.trunc(n * 100) / 100;
    return `${new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(truncated)}${suffix}`;
}

function formatUsDate(value: unknown): string {
    if (value == null) return "";
    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? ""
            : new Intl.DateTimeFormat("en-US", {
                  month: "2-digit",
                  day: "2-digit",
                  year: "numeric",
                  timeZone: "UTC",
              }).format(value);
    }
    const t = String(value || "").trim();
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

function str(v: unknown): string {
    return String(v ?? "").trim();
}

/* --------------------------- context extraction --------------------------- */

/**
 * Pull state-disclosure prefill values out of the latest contract row + offer + application.
 * Returns formatted strings (USD numbers, MM/DD/YYYY dates, "x.xx%" percentages).
 */
export function buildStateDisclosurePrefillContextFromContract(args: {
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    /** Optional override for the signature/disclosure date (e.g., today). */
    agreementDate?: string;
}): StateDisclosureContext {
    const contract = (args.contract ?? {}) as Record<string, unknown>;
    const offer = (contract.offer ?? null) as Record<string, unknown> | null;

    const purchaseAmount = coerceFiniteNumber(
        contract.purchaseAmount ?? offer?.offer ?? offer?.approvedAmount ?? contract.approvedAmount,
    );
    const purchasePrice = coerceFiniteNumber(
        contract.purchasePrice ?? offer?.totalRemit ?? offer?.paybackAmount ?? contract.totalAmount,
    );
    const purchasePercent = coerceFiniteNumber(
        contract.purchasePercent ?? offer?.rate ?? offer?.factorRate,
    );
    const underwritingFees = coerceFiniteNumber(contract.appendixUnderwritingFees);

    /** Per-period payment lives on the TermsOffer / OfferDecision row. */
    const periodicPayment = coerceFiniteNumber(
        offer?.paymentAmount ??
            (contract as Record<string, unknown>).paymentAmount ??
            offer?.dailyPayment ??
            offer?.weeklyPayment,
    );
    const numberOfPayments = coerceFiniteNumber(
        offer?.numberOfPayments ?? (contract as Record<string, unknown>).numberOfPayments,
    );
    const termLength = coerceFiniteNumber(
        offer?.termLength ??
            (contract as Record<string, unknown>).contractLenght ??
            (contract as Record<string, unknown>).termLength,
    );
    const percentOfGross = coerceFiniteNumber(offer?.percentOfGross);

    const fundingProvided = formatUsd(purchaseAmount);
    const totalRepayment = formatUsd(purchasePrice);

    let fundingDisbursed = "";
    if (purchaseAmount !== undefined) {
        const disbursed =
            underwritingFees !== undefined
                ? Math.max(0, purchaseAmount - underwritingFees)
                : purchaseAmount;
        fundingDisbursed = formatUsd(disbursed);
    }

    const totalDollarCostNum =
        purchasePrice !== undefined && purchaseAmount !== undefined
            ? Math.max(0, purchasePrice - purchaseAmount)
            : undefined;
    const totalDollarCost = formatUsd(totalDollarCostNum);

    /** Fall back to derived per-period payment when not stored explicitly. */
    let estimatedPayment = formatUsd(periodicPayment);
    if (!estimatedPayment && purchasePrice !== undefined && numberOfPayments && numberOfPayments > 0) {
        estimatedPayment = formatUsd(purchasePrice / numberOfPayments);
    }

    /** APR percentage: prefer explicit annual rate; otherwise approximate from factor rate (purchasePercent in CRM). */
    let estimatedAnnualPercentageRate = "";
    const explicitApr = coerceFiniteNumber(
        (contract as Record<string, unknown>).estimatedAnnualPercentageRate ??
            offer?.annualPercentageRate ??
            offer?.apr,
    );
    if (explicitApr !== undefined) {
        estimatedAnnualPercentageRate = formatPercent(explicitApr);
    } else if (purchasePercent !== undefined) {
        /** CRM stores `purchasePercent` as a factor (e.g. 1.49 = 149%) — display as-is for templates that show factor. */
        estimatedAnnualPercentageRate = formatPercent(purchasePercent);
    }

    const customerName =
        str(contract.customerName) ||
        str(contract.legalName) ||
        str(contract.clientName);

    const businessAddressLine = [
        str(contract.businessAddress),
        str(contract.businessAddressCity),
        str(contract.businessAddressState),
        str(contract.businessAddressZip),
    ]
        .filter(Boolean)
        .join(", ");

    const signatureDate =
        formatUsDate(args.agreementDate) ||
        formatUsDate(contract.agreementDate) ||
        formatUsDate(contract.contractDate);

    /** Average monthly income is sourced from the application/business analysis, not the contract row. */
    const application = (args.application ?? {}) as Record<string, unknown>;
    const averageMonthlyIncome = formatUsd(
        application.averageMonthlyIncome ??
            application.averageMonthlyDeposit ??
            (application as Record<string, unknown>).avgMonthlyDeposit ??
            "",
    );

    return {
        fundingProvided,
        fundingDisbursed,
        feesDeducted: formatUsd(underwritingFees),
        totalRepayment,
        totalDollarCost,
        financeCharge: totalDollarCost,
        estimatedPayment,
        estimatedAnnualPercentageRate,
        paymentExceededPercent: percentOfGross !== undefined ? formatPercent(percentOfGross) : "",
        averageMonthlyIncome,
        estimatedTerm: termLength !== undefined ? String(Math.trunc(termLength)) : "",
        estimatedNumberOfPayments:
            numberOfPayments !== undefined ? String(Math.trunc(numberOfPayments)) : "",
        prepayment: "",
        recipientName: customerName,
        recipientAddress: businessAddressLine,
        signatureDate,
        prepaymentReceivedByDate: signatureDate,
        prepaymentDiscountAmount: "",
    };
}

/* ------------------------------ dispatch API ------------------------------ */

function normalizeKey(value: string | null | undefined): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

/** Resolve per-state prefill rows by `BoldSignTemplate.name` (e.g., "daily_kansas"). */
export function getStateDisclosurePrefillFieldsByName(
    name: string | null | undefined,
    context: StateDisclosureContext,
): ContractPrefillField[] {
    const key = normalizeKey(name);
    if (!key) return [];
    const builder = REGISTRY[key];
    return builder ? builder(context) : [];
}

/** Resolve per-state prefill rows by `frequency` + `state` (DB lowercase columns). */
export function getStateDisclosurePrefillFieldsByStateFrequency(args: {
    state?: string | null;
    frequency?: string | null;
    context: StateDisclosureContext;
}): ContractPrefillField[] {
    const state = normalizeKey(args.state);
    const frequency = normalizeKey(args.frequency);
    if (!state || !frequency) return [];
    return getStateDisclosurePrefillFieldsByName(`${frequency}_${state}`, args.context);
}

/**
 * Compute prefill rows for every BoldSignTemplate row that has a registered builder.
 * Dispatches by `name` first; falls back to `frequency_state`. Deduplicates by id
 * so the same field id from two templates only gets one (last) value.
 */
export function getStateDisclosurePrefillFieldsForTemplates(args: {
    templates: Array<{ name?: string | null; state?: string | null; frequency?: string | null }>;
    context: StateDisclosureContext;
}): ContractPrefillField[] {
    const collected = new Map<string, ContractPrefillField>();
    for (const tpl of args.templates ?? []) {
        const rows = (() => {
            const byName = getStateDisclosurePrefillFieldsByName(tpl?.name, args.context);
            if (byName.length > 0) return byName;
            return getStateDisclosurePrefillFieldsByStateFrequency({
                state: tpl?.state,
                frequency: tpl?.frequency,
                context: args.context,
            });
        })();
        for (const row of rows) {
            if (!row?.id) continue;
            const value = String(row.value ?? "").trim();
            if (!value) continue;
            collected.set(row.id, { id: row.id, label: row.label, value });
        }
    }
    return Array.from(collected.values());
}
