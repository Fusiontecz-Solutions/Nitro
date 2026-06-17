import type { ContractPrefillField } from "./Contract";
import {
    getApplicationClientPrefillArgs,
    getApplicationPrimaryRecipientName,
    resolveAppendixUnderwritingFeesDollars,
} from "./Contract";
import { buildDailyCaliforniaContractPrefillFields } from "./daily_california";
import { buildDailyConnecticutContractPrefillFields, buildConnecticutOptionalReviewFieldDefinitions } from "./daily_connecticut";
import { buildDailyFloridaContractPrefillFields } from "./Daily_florida";
import { buildDisclosureCalculatorEditorFieldDefinitions } from "./disclosureEditorFields";
import { buildDisclosureCalculatorInputsFromSources } from "./disclosureAprCalculator";
import { buildDailyKansasContractPrefillFields } from "./Daily_kansas";
import { buildDailyNewYorkContractPrefillFields } from "./Daily_new_york";
import { buildDailyVirginiaContractPrefillFields, formatVirginiaDisclosureRecipientAddress } from "./daily_virginia";
import { buildDailyUtahContractPrefillFields } from "./daily_utah";
import { buildWeeklyCaliforniaContractPrefillFields } from "./Weekly_California";
import { PLATFORM_DISCLOSURE_FUNDER_NAME } from "./platformDocumentConfig";

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
    /** Offer amount minus underwriting/broker fees (Florida `total_amount_business_fund`). */
    amountBusinessFund?: string;
    /** Amount actually disbursed after fees (Contract.purchaseAmount - underwriting fees). */
    fundingDisbursed?: string;
    /** Fees deducted at disbursement (Contract.appendixUnderwritingFees). */
    feesDeducted?: string;
    /** Broker fee paid to broker (Utah `appendix_underwriting_fees` tab). */
    brokerFeePaidToBroker?: string;
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
    /** Prepayment — payment fallen below threshold (%). */
    paymentFallenBelowPercent?: string;
    /** Prepayment — consistent with threshold (%). */
    consistentWithPercent?: string;
    /** Payment terms — % of merchant daily income purchased (`purchasePercent` / offer % of gross). */
    percentOfBusinessIncome?: string;
    /** Estimated term length (days/weeks/months) of the agreement. */
    estimatedTerm?: string;
    /** Payment days for periodic-payment disclosure fields (daily business days, etc.). */
    estimatedPaymentDays?: string;
    /** Estimated total number of payments. */
    estimatedNumberOfPayments?: string;
    /** Prepayment description / amount text. */
    prepayment?: string;
    /** Recipient (legal client / business) name. */
    recipientName?: string;
    /** Funder / provider legal name on the disclosure (always Katan Capital on this platform). */
    funderName?: string;
    /** Recipient business address (single line). */
    recipientAddress?: string;
    /** Virginia page-2 address block (street/city line 1, state/ZIP line 2). */
    recipientAddressMultiline?: string;
    /** Disclosure / signature date — usually the agreement date. */
    signatureDate?: string;
    /** Date by which prepayment amount must be received to qualify for discount. */
    prepaymentReceivedByDate?: string;
    /** Amount required to trigger prepayment discount. */
    prepaymentDiscountAmount?: string;
    /** Offer payment frequency label (Daily, Weekly, etc.). */
    paymentFrequency?: string;
}

type StateDisclosureBuilder = (ctx: StateDisclosureContext) => ContractPrefillField[];

const buildDailyFlorida = (ctx: StateDisclosureContext) => {
    const disbursed =
        ctx.fundingDisbursed || ctx.amountBusinessFund || ctx.fundingProvided || "";

    return buildDailyFloridaContractPrefillFields({
        clientName: ctx.recipientName,
        funderName: ctx.funderName,
        totalAmountBusinessFund: ctx.amountBusinessFund ?? disbursed,
        totalAmountOfFundDisbursed: disbursed,
        totalAmountTobePaidToProvider: ctx.totalRepayment,
        totalDollarCost: ctx.totalDollarCost,
        estimatedPaymentAmount: ctx.estimatedPayment,
        paymentExceededPercent: ctx.paymentExceededPercent,
        percentOfBusinessIncome: ctx.percentOfBusinessIncome,
        paymentFallenBelowPercent: ctx.paymentFallenBelowPercent,
        consistentWithPercent: ctx.consistentWithPercent,
        amountRequiredToTriggerPrepaymentDiscount: ctx.prepaymentDiscountAmount,
        signatureDate: ctx.signatureDate,
    });
};

const buildDailyUtah = (ctx: StateDisclosureContext) =>
    buildDailyUtahContractPrefillFields({
        purchaseAmount: ctx.fundingProvided,
        netToMerchant: ctx.fundingDisbursed,
        purchasePrice: ctx.totalRepayment,
        financeCharge: ctx.financeCharge || ctx.totalDollarCost,
        remittance: ctx.estimatedPayment,
        monthlyIncome: ctx.averageMonthlyIncome,
        // Utah `appendix_underwriting_fees` = broker fee paid to broker — not origination / underwriting fees.
        appendixUnderwritingFees: ctx.brokerFeePaidToBroker ?? "0.00",
        paymentTermsPercent: ctx.percentOfBusinessIncome || ctx.paymentExceededPercent,
    });

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
            estimatedTimePeriodicPaymement:
                ctx.estimatedPaymentDays || ctx.estimatedNumberOfPayments || "",
            disclosureDate: ctx.signatureDate,
            recipientName: ctx.recipientName,
            recipientAddress: ctx.recipientAddress,
            recipientName2: ctx.recipientName,
            disclosureDate2: ctx.signatureDate,
            recipientAddress2: ctx.recipientAddress || "",
            signature1Date: ctx.signatureDate,
            signature2Date: ctx.signatureDate,
            connecticutReviewField1: "",
            connecticutReviewField2: "",
            connecticutReviewField3: "",
            connecticutReviewField4: "",
        }),
    weekly_connecticut: (ctx) =>
        buildDailyConnecticutContractPrefillFields({
            totalCommericalFinancing: ctx.totalRepayment,
            deductedAtDisbursement: ctx.feesDeducted,
            totalAmountCommercialFinancing: ctx.fundingProvided,
            financeCharge: ctx.financeCharge,
            totalRepaymentAmount: ctx.totalRepayment,
            estimatedTimePeriodicPaymement:
                ctx.estimatedPaymentDays || ctx.estimatedNumberOfPayments || "",
            disclosureDate: ctx.signatureDate,
            recipientName: ctx.recipientName,
            recipientAddress: ctx.recipientAddress,
            recipientName2: ctx.recipientName,
            disclosureDate2: ctx.signatureDate,
            recipientAddress2: ctx.recipientAddress || "",
            signature1Date: ctx.signatureDate,
            signature2Date: ctx.signatureDate,
            connecticutReviewField1: "",
            connecticutReviewField2: "",
            connecticutReviewField3: "",
            connecticutReviewField4: "",
        }),

    daily_florida: buildDailyFlorida,
    weekly_florida: buildDailyFlorida,
    daily_missouri: buildDailyFlorida,
    weekly_missouri: buildDailyFlorida,

    daily_georgia: buildDailyFlorida,
    weekly_georgia: buildDailyFlorida,

    daily_kansas: (ctx) =>
        buildDailyKansasContractPrefillFields({
            totalAmountOfFundProvided: ctx.fundingProvided,
            totalAmountFundDisbursed: ctx.fundingDisbursed,
            totalOfPayments: ctx.totalRepayment,
            totalDollarCostOfFrinancing: ctx.totalDollarCost,
            estimatedPayment: ctx.estimatedPayment,
            signatureDate: ctx.signatureDate,
        }),
    weekly_kansas: (ctx) =>
        buildDailyKansasContractPrefillFields({
            totalAmountOfFundProvided: ctx.fundingProvided,
            totalAmountFundDisbursed: ctx.fundingDisbursed,
            totalOfPayments: ctx.totalRepayment,
            totalDollarCostOfFrinancing: ctx.totalDollarCost,
            estimatedPayment: ctx.estimatedPayment,
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
    weekly_new_york: (ctx) =>
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
            signatureDate: ctx.signatureDate,
            recipientName2: ctx.recipientName,
            disclosureDate2: ctx.signatureDate,
            recipientAddress1:
                ctx.recipientAddressMultiline || ctx.recipientAddress || "",
            fordailypayments: ctx.estimatedPayment,
        }),
    weekly_virginia: (ctx) =>
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
            signatureDate: ctx.signatureDate,
            recipientName2: ctx.recipientName,
            disclosureDate2: ctx.signatureDate,
            recipientAddress1:
                ctx.recipientAddressMultiline || ctx.recipientAddress || "",
            weeklyPayments: ctx.estimatedPayment,
        }),

    daily_utah: buildDailyUtah,
    weekly_utah: buildDailyUtah,

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

/** Parse percent fields that may include a trailing `%` (e.g. contract specified percentage). */
function coercePercentNumber(value: unknown): number | undefined {
    if (typeof value === "string") {
        const cleaned = value.trim().replace(/%/g, "").replace(/,/g, "");
        return coerceFiniteNumber(cleaned);
    }
    return coerceFiniteNumber(value);
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
    /** Payback — prefer explicit remit; else derive from offer amount × factor rate. */
    let paybackAmount = coerceFiniteNumber(
        offer?.totalRemit ?? offer?.paybackAmount ?? contract.totalAmount,
    );
    if (paybackAmount === undefined && purchaseAmount !== undefined) {
        const factorRate = coerceFiniteNumber(offer?.rate ?? offer?.factorRate);
        if (factorRate !== undefined && factorRate > 0) {
            paybackAmount = purchaseAmount * factorRate;
        }
    }
    if (paybackAmount === undefined) {
        paybackAmount = coerceFiniteNumber(contract.purchasePrice);
    }
    const purchasePrice = paybackAmount;
    const purchasePercent = coercePercentNumber(
        contract.purchasePercent ??
            contract.purchase_percent ??
            contract.specified_percentage ??
            contract.purchased_percent,
    );
    const underwritingFees =
        resolveAppendixUnderwritingFeesDollars(
            contract.appendixUnderwritingFees ?? offer?.fees,
            purchaseAmount,
        ) ?? coerceFiniteNumber(contract.appendixUnderwritingFees);

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

    const fundingProvided = formatUsd(purchaseAmount);
    const totalRepayment = formatUsd(purchasePrice);

    let fundingDisbursed = "";
    let amountBusinessFund = "";
    let netFundedNum: number | undefined;
    if (purchaseAmount !== undefined) {
        const disbursed =
            underwritingFees !== undefined
                ? Math.max(0, purchaseAmount - underwritingFees)
                : purchaseAmount;
        netFundedNum = disbursed;
        fundingDisbursed = formatUsd(disbursed);
        amountBusinessFund = fundingDisbursed;
    }

    const totalDollarCostNum =
        purchasePrice !== undefined && netFundedNum !== undefined
            ? Math.max(0, purchasePrice - netFundedNum)
            : purchasePrice !== undefined && purchaseAmount !== undefined
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
        /** User-entered specified percentage on the contract prefill form only. */
        estimatedAnnualPercentageRate = formatPercent(purchasePercent);
    } else {
        const factorOnly = coerceFiniteNumber(offer?.rate ?? offer?.factorRate);
        if (factorOnly !== undefined) {
            estimatedAnnualPercentageRate = formatPercent(factorOnly);
        }
    }

    const appPrefill = getApplicationClientPrefillArgs(args.application);
    const linkedClient = (contract.client ?? null) as Record<string, unknown> | null;
    const customerName =
        str(contract.legalName) ||
        str(contract.clientLegalName) ||
        str((contract as Record<string, unknown>).client_legal_name) ||
        str(contract.customerName) ||
        str(contract.clientName) ||
        str(appPrefill.customerName) ||
        getApplicationPrimaryRecipientName(args.application) ||
        str(linkedClient?.businessName);

    const businessAddressParts = {
        street:
            str(contract.businessAddress) ||
            str(appPrefill.businessAddress) ||
            "",
        city:
            str(contract.businessAddressCity) ||
            str(appPrefill.businessAddressCity) ||
            "",
        state:
            str(contract.businessAddressState) ||
            str(appPrefill.businessAddressState) ||
            "",
        zip:
            str(contract.businessAddressZip) ||
            str(appPrefill.businessAddressZip) ||
            "",
    };

    const businessAddressLine = [
        businessAddressParts.street,
        businessAddressParts.city,
        businessAddressParts.state,
        businessAddressParts.zip,
    ]
        .filter(Boolean)
        .join(", ");

    const virginiaRecipientAddressMultiline =
        formatVirginiaDisclosureRecipientAddress(businessAddressParts);

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

    /** Payment Terms — contract `purchasePercent` / specified % only (not % of gross). */
    const percentOfBusinessIncome =
        purchasePercent !== undefined ? formatPercent(purchasePercent) : "";

    const paymentFrequency = String(
        offer?.frequency ??
            (contract as Record<string, unknown>).disclosureFrequency ??
            (contract as Record<string, unknown>).remittance ??
            "",
    ).trim();

    return {
        fundingProvided,
        amountBusinessFund,
        fundingDisbursed,
        feesDeducted: formatUsd(underwritingFees),
        totalRepayment,
        totalDollarCost,
        financeCharge: totalDollarCost,
        estimatedPayment,
        estimatedAnnualPercentageRate,
        paymentExceededPercent: "",
        paymentFallenBelowPercent: "",
        consistentWithPercent: "",
        percentOfBusinessIncome,
        averageMonthlyIncome,
        estimatedTerm: termLength !== undefined ? String(Math.trunc(termLength)) : "",
        estimatedNumberOfPayments:
            numberOfPayments !== undefined ? String(Math.trunc(numberOfPayments)) : "",
        estimatedPaymentDays: (() => {
            try {
                const days = buildDisclosureCalculatorInputsFromSources({
                    contract,
                    application: args.application ?? null,
                }).numberOfPaymentDays;
                return days > 0 ? String(Math.trunc(days)) : "";
            } catch {
                return "";
            }
        })(),
        prepayment: "",
        recipientName: customerName,
        funderName: PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        recipientAddress: businessAddressLine,
        recipientAddressMultiline: virginiaRecipientAddressMultiline,
        signatureDate,
        prepaymentReceivedByDate: signatureDate,
        prepaymentDiscountAmount: "",
        paymentFrequency,
        brokerFeePaidToBroker: "0.00",
    };
}

/* ------------------------------ dispatch API ------------------------------ */

function normalizeKey(value: string | null | undefined): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

const US_STATE_ABBR_TO_KEY: Record<string, string> = {
    al: "alabama",
    ak: "alaska",
    az: "arizona",
    ar: "arkansas",
    ca: "california",
    co: "colorado",
    ct: "connecticut",
    de: "delaware",
    fl: "florida",
    ga: "georgia",
    hi: "hawaii",
    id: "idaho",
    il: "illinois",
    in: "indiana",
    ia: "iowa",
    ks: "kansas",
    ky: "kentucky",
    la: "louisiana",
    me: "maine",
    md: "maryland",
    ma: "massachusetts",
    mi: "michigan",
    mn: "minnesota",
    ms: "mississippi",
    mo: "missouri",
    mt: "montana",
    ne: "nebraska",
    nv: "nevada",
    nh: "new_hampshire",
    nj: "new_jersey",
    nm: "new_mexico",
    ny: "new_york",
    nc: "north_carolina",
    nd: "north_dakota",
    oh: "ohio",
    ok: "oklahoma",
    or: "oregon",
    pa: "pennsylvania",
    ri: "rhode_island",
    sc: "south_carolina",
    sd: "south_dakota",
    tn: "tennessee",
    tx: "texas",
    ut: "utah",
    vt: "vermont",
    va: "virginia",
    wa: "washington",
    wv: "west_virginia",
    wi: "wisconsin",
    wy: "wyoming",
};

function normalizeStateKey(value: string | null | undefined): string {
    const key = normalizeKey(value);
    if (!key) return "";
    if (US_STATE_ABBR_TO_KEY[key]) return US_STATE_ABBR_TO_KEY[key];
    return key;
}

function normalizeFrequencyKey(value: string | null | undefined): string {
    const key = normalizeKey(value);
    if (!key) return "";
    if (key.startsWith("week")) return "weekly";
    if (key.startsWith("day")) return "daily";
    return key;
}

/** Placeholder context so the editor lists every field id with a non-empty stub value. */
export function stateDisclosureEditorPlaceholderContext(): StateDisclosureContext {
    const d = (): string => ".";
    return {
        fundingProvided: d(),
        amountBusinessFund: d(),
        fundingDisbursed: d(),
        feesDeducted: d(),
        totalRepayment: d(),
        totalDollarCost: d(),
        financeCharge: d(),
        estimatedPayment: d(),
        estimatedAnnualPercentageRate: d(),
        averageMonthlyIncome: d(),
        paymentExceededPercent: d(),
        paymentFallenBelowPercent: d(),
        consistentWithPercent: d(),
        percentOfBusinessIncome: d(),
        estimatedTerm: d(),
        estimatedNumberOfPayments: d(),
        prepayment: d(),
        recipientName: d(),
        funderName: PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        recipientAddress: d(),
        signatureDate: d(),
        prepaymentReceivedByDate: d(),
        prepaymentDiscountAmount: d(),
    };
}

/** Resolve registry key from template name and/or CRM state + frequency. */
export function resolveStateDisclosureRegistryKey(
    name?: string | null,
    state?: string | null,
    frequency?: string | null,
): string | null {
    const nameKey = normalizeKey(name);
    if (nameKey && REGISTRY[nameKey]) return nameKey;

    const stateKey = normalizeStateKey(state);
    const freqKey = normalizeFrequencyKey(frequency);
    if (stateKey && freqKey) {
        const composite = `${freqKey}_${stateKey}`;
        if (REGISTRY[composite]) return composite;
    }

    if (nameKey && stateKey) {
        for (const registryKey of Object.keys(REGISTRY)) {
            if (!registryKey.includes(stateKey)) continue;
            if (freqKey && !registryKey.startsWith(`${freqKey}_`)) continue;
            return registryKey;
        }
    }

    return null;
}

export function hasStateDisclosurePrefillRegistry(
    name?: string | null,
    state?: string | null,
    frequency?: string | null,
): boolean {
    return resolveStateDisclosureRegistryKey(name, state, frequency) != null;
}

function isConnecticutDisclosureRegistryKey(key: string | null | undefined): boolean {
    return key === "daily_connecticut" || key === "weekly_connecticut";
}

export function getStateDisclosureEditorFieldDefinitions(
    name?: string | null,
    state?: string | null,
    frequency?: string | null,
): ContractPrefillField[] {
    const key = resolveStateDisclosureRegistryKey(name, state, frequency);
    if (!key) return [];
    const base = buildDisclosureCalculatorEditorFieldDefinitions();
    if (isConnecticutDisclosureRegistryKey(key)) {
        return [...base, ...buildConnecticutOptionalReviewFieldDefinitions()];
    }
    return base;
}

/** Resolve per-state prefill rows by `BoldSignTemplate.name` (e.g., "daily_kansas"). */
export function getStateDisclosurePrefillFieldsByName(
    name: string | null | undefined,
    context: StateDisclosureContext,
): ContractPrefillField[] {
    const key = resolveStateDisclosureRegistryKey(name, null, null) ?? normalizeKey(name);
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
    const state = normalizeStateKey(args.state);
    const frequency = normalizeFrequencyKey(args.frequency);
    if (!state || !frequency) return [];
    const key = resolveStateDisclosureRegistryKey(null, state, frequency) ?? `${frequency}_${state}`;
    const builder = REGISTRY[key];
    return builder ? builder(args.context) : [];
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
