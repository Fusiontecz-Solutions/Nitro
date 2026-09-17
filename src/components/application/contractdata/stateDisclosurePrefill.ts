import type { ContractPrefillField } from "./Contract";
import {
    getApplicationClientPrefillArgs,
    resolveAppendixUnderwritingFeesDollars,
    resolveBalanceTransferMerchantContext,
    resolveContractBusinessLegalNameForPrefill,
} from "./Contract";
import { buildDailyCaliforniaContractPrefillFields } from "./daily_california";
import {
    buildCaliforniaDisclosurePage3Amounts,
    buildCaliforniaRefinancePage3Amounts,
    resolveCaliforniaEstimatedTermDays,
} from "./california_disclosure";
import {
    buildNewYorkDisclosurePage3Amounts,
    resolveNewYorkPage1LineAmount,
} from "./new_york_disclosure";
import {
    buildDisclosureCalculatorInputsFromSources,
    calculateDisclosureMetrics,
    formatDisclosureUsd,
    applyDisclosurePlatformFee,
    formatDisclosurePaymentFrequencyLabel,
} from "./disclosureAprCalculator";
import {
    PLATFORM_DISCLOSURE_FUNDER_NAME,
    resolveDisclosureWireFeeUsd,
    resolveIncludeWireFee,
} from "./platformDocumentConfig";
import {
    calculateRefinanceDealMetrics,
    isRefinanceDeal,
    resolveRefiLabelName,
} from "./refinanceDealCalculations";
import { buildDailyConnecticutContractPrefillFields } from "./daily_connecticut";
import { buildDailyFloridaContractPrefillFields } from "./Daily_florida";
import { buildDailyLouisianaContractPrefillFields } from "./Daily_louisiana";
import { buildDailyTexasContractPrefillFields } from "./Daily_texas";
import { buildDailyGeorgiaContractPrefillFields } from "./Daily_georgia";
import { buildDailyKansasContractPrefillFields } from "./Daily_kansas";
import { buildDailyVirginiaContractPrefillFields } from "./daily_virginia";
import { buildDailyUtahContractPrefillFields } from "./daily_utah";
import { buildDisclosureCalculatorEditorFieldDefinitions } from "./disclosureEditorFields";

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
    /** Alias used by disclosure editor for amount financed. */
    amountBusinessFund?: string;
    /** Amount actually disbursed after fees (Contract.purchaseAmount - underwriting fees). */
    fundingDisbursed?: string;
    /**
     * CA REFI right-side “provided to you directly” after removing previous refi balance.
     * No-Refi: same as fundingProvided / fundingDisbursed as applicable.
     */
    fundingProvidedDirect?: string;
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
    /** Alias for payment terms / percent of business income on disclosure forms. */
    percentOfBusinessIncome?: string;
    /** Estimated term length (days/weeks/months) of the agreement. */
    estimatedTerm?: string;
    /** Estimated term in calendar/business days (California disclosure page 2). */
    estimatedTermDays?: string;
    /** Connecticut estimated term in business days (weekly = weeks × 5). */
    estimatedTermBusinessDays?: string;
    /** Payment frequency (Daily / Weekly / …). */
    frequency?: string;
    /** Alias for payment frequency on some disclosure editor mappings. */
    paymentFrequency?: string;
    /** Estimated total number of payments. */
    estimatedNumberOfPayments?: string;
    /** Prepayment description / amount text. */
    prepayment?: string;
    /** Merchant business / legal name (never owner person name). */
    recipientName?: string;
    /** Owner / merchant person name (addendum Print Name). */
    merchantName?: string;
    /** Funder / provider legal name on the disclosure. */
    funderName?: string;
    /** Selected funder street/city/state/zip (Connecticut disclosures). */
    funderAddress?: string;
    /** Selected funder phone (Connecticut disclosures). */
    funderPhone?: string;
    /** Selected funder email (Connecticut disclosures). */
    funderEmail?: string;
    /** Selected funder deal ID prefix (Connecticut / Texas disclosures). */
    dealIdPrefix?: string;
    /** Broker fee paid to broker (Utah disclosure). */
    brokerFeePaidToBroker?: string;
    /** Estimated monthly cost of financing. */
    estimatedMonthlyCost?: string;
    /** Recipient business address (single line). */
    recipientAddress?: string;
    /** Disclosure / signature date — usually the agreement date. */
    signatureDate?: string;
    /** Date by which prepayment amount must be received to qualify for discount. */
    prepaymentReceivedByDate?: string;
    /** Amount required to trigger prepayment discount. */
    prepaymentDiscountAmount?: string;
    /** Optional page 3 line amounts (default 0.00 when empty). */
    page3Line1?: string;
    page3Line2?: string;
    /** True when offer has a positive refinance / previous-deal balance. */
    isRefinance?: boolean;
    /** Net contracted funding after origination (before subtracting REFI balance). */
    netContractedFunding?: string;
    /** Previous deal / REFI payoff balance. */
    previousRefiBalance?: string;
    /** Actual merchant disbursement after fees and REFI balance. */
    actualDisbursement?: string;
    /** Previous deal date (REFI “agreement dated”). */
    previousDealDate?: string;
    /** CT renewal: outstanding sales-based financing = REFI balance; leave other renewal fields blank. */
    outstandingSalesBasedFinancing?: string;
}

type StateDisclosureBuilder = (ctx: StateDisclosureContext) => ContractPrefillField[];

function buildCaliforniaDisclosurePrefill(ctx: StateDisclosureContext): ContractPrefillField[] {
    const isRefi = Boolean(ctx.isRefinance);
    /**
     * PDF CA:
     * - NO REFI funding L/R = Net Funding (Contract − Fee)
     * - REFI left = Net Contracted Funding; right = Actual Disbursement
     * - Page-3 top (Net Amount): NO REFI = net funding; REFI = actual disbursement
     */
    const netFunding =
        ctx.netContractedFunding || ctx.fundingDisbursed || ctx.fundingProvided;
    const page3TopLine = isRefi
        ? ctx.actualDisbursement || ctx.fundingDisbursed || netFunding
        : netFunding;
    const originationFee =
        coerceFiniteNumber(ctx.feesDeducted) ??
        coerceFiniteNumber(ctx.brokerFeePaidToBroker) ??
        0;
    const page3 = isRefi
        ? buildCaliforniaRefinancePage3Amounts({
              actualDisbursement: coerceFiniteNumber(ctx.actualDisbursement) ?? 0,
              originationFee,
              previousRefiBalance: coerceFiniteNumber(ctx.previousRefiBalance) ?? 0,
          })
        : (() => {
              const line1 =
                  ctx.page3Line1?.trim() ||
                  (originationFee > 0 ? formatDisclosureUsd(originationFee) : "0.00");
              const line2 = ctx.page3Line2?.trim() || "0.00";
              const broker =
                  ctx.brokerFeePaidToBroker?.trim() ||
                  (originationFee > 0 ? formatDisclosureUsd(originationFee) : "0.00");
              const amounts = buildCaliforniaDisclosurePage3Amounts({
                  recipientFunds: page3TopLine,
                  page3Line1: line1,
                  page3Line2: line2,
                  brokerFee: broker,
              });
              return {
                  ...amounts,
                  recipientFunds: page3TopLine ?? "",
                  page3Line1: line1,
                  page3Line2: line2,
                  brokerFee: broker,
              };
          })();

    /** Main box = contract / purchase price. Adjacent “directly” = net (REFI: actual disbursement). */
    const fundingLeft = ctx.fundingProvided || ctx.amountBusinessFund || netFunding;
    const fundingRight = isRefi
        ? ctx.actualDisbursement || ctx.fundingDisbursed || netFunding
        : netFunding;

    return buildDailyCaliforniaContractPrefillFields({
        fundingProvided: fundingLeft,
        fundingProvidedDirect: fundingRight,
        previousAgreementDate: isRefi ? ctx.previousDealDate : "",
        estimatedAnnualPercentageRate: ctx.estimatedAnnualPercentageRate,
        estimatedPayment: ctx.estimatedPayment,
        estimatedMonthlyCost: ctx.estimatedMonthlyCost,
        paymentTotal: ctx.totalRepayment,
        estimatedTerm: resolveCaliforniaEstimatedTermDays({
            estimatedTermDays: ctx.estimatedTermDays,
            estimatedNumberOfPayments: ctx.estimatedNumberOfPayments,
            frequency: ctx.frequency,
        }),
        avarageMonthlyIncome: ctx.averageMonthlyIncome,
        payementExceededPercent: ctx.paymentExceededPercent,
        monthlyIncome: ctx.averageMonthlyIncome,
        financeCharge: ctx.financeCharge,
        funderName: ctx.funderName?.toUpperCase() ?? PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
        recipientName: ctx.recipientName?.toUpperCase(),
        recipientFunds: page3.recipientFunds || page3TopLine,
        brokerFee: page3.brokerFee || ctx.brokerFeePaidToBroker,
        page3Line1: page3.page3Line1 || ctx.page3Line1,
        page3Line2: page3.page3Line2 || ctx.page3Line2,
        page3Subtotal: page3.page3Subtotal,
        page3Net: page3.page3Net,
        signatureDate: ctx.signatureDate,
    });
}

function buildNewYorkDisclosurePrefill(ctx: StateDisclosureContext): ContractPrefillField[] {
    const isRefi = Boolean(ctx.isRefinance);
    /**
     * Funding Provided (main box) = contract / purchase price.
     * Adjacent “directly” = net after fees. Page-3 REFI line 1 = actual disbursement.
     */
    const fundingNet =
        ctx.netContractedFunding || ctx.fundingDisbursed || ctx.fundingProvided;
    const fundingProvidedPrimary = ctx.fundingProvided || ctx.amountBusinessFund || fundingNet;
    const page3TopLine = isRefi
        ? ctx.actualDisbursement || ctx.fundingDisbursed || fundingNet
        : fundingNet;
    const page3 = isRefi
        ? buildCaliforniaRefinancePage3Amounts({
              actualDisbursement: coerceFiniteNumber(ctx.actualDisbursement) ?? 0,
              originationFee: coerceFiniteNumber(ctx.feesDeducted) ?? 0,
              previousRefiBalance: coerceFiniteNumber(ctx.previousRefiBalance) ?? 0,
          })
        : {
              ...buildCaliforniaDisclosurePage3Amounts({
                  recipientFunds: page3TopLine,
                  page3Line1: ctx.page3Line1,
                  page3Line2: ctx.page3Line2,
                  brokerFee: ctx.brokerFeePaidToBroker,
              }),
              recipientFunds: page3TopLine ?? "",
              page3Line1: ctx.page3Line1 ?? "",
              page3Line2: ctx.page3Line2 ?? "",
              brokerFee: ctx.brokerFeePaidToBroker ?? "",
          };
    const nyLines = isRefi
        ? {
              page3Line1: page3.page3Line1,
              page3Line2: page3.page3Line2,
          }
        : buildNewYorkDisclosurePage3Amounts({
              recipientFunds: page3TopLine,
              brokerFee: ctx.brokerFeePaidToBroker,
              page3Line1: ctx.page3Line1,
              page3Line2: ctx.page3Line2,
          });
    return [
        ...buildDailyCaliforniaContractPrefillFields({
            fundingProvided: fundingProvidedPrimary,
            fundingProvidedDirect: fundingNet,
            previousAgreementDate: isRefi ? ctx.previousDealDate : "",
            estimatedAnnualPercentageRate: ctx.estimatedAnnualPercentageRate,
            estimatedPayment: ctx.estimatedPayment,
            estimatedMonthlyCost: ctx.estimatedMonthlyCost,
            paymentTotal: ctx.totalRepayment,
            estimatedTerm: ctx.estimatedTermDays ?? "",
            avarageMonthlyIncome: ctx.averageMonthlyIncome,
            payementExceededPercent: ctx.paymentExceededPercent,
            monthlyIncome: ctx.averageMonthlyIncome,
            financeCharge: ctx.financeCharge,
            funderName: ctx.funderName?.toUpperCase() ?? PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
            recipientName: ctx.recipientName?.toUpperCase(),
            recipientFunds: page3.recipientFunds || page3TopLine,
            brokerFee: page3.brokerFee || ctx.brokerFeePaidToBroker,
            page3Line1: nyLines.page3Line1,
            page3Line2: nyLines.page3Line2,
            page3Subtotal: page3.page3Subtotal,
            page3Net: page3.page3Net,
            signatureDate: ctx.signatureDate,
        }),
        {
            id: "disclosure_page1_line_1",
            label: "Page 1 line 1 amount",
            value: resolveNewYorkPage1LineAmount(undefined),
        },
    ];
}

function buildConnecticutDisclosurePrefill(ctx: StateDisclosureContext): ContractPrefillField[] {
    const isRefi = Boolean(ctx.isRefinance);
    /** Guide: REFI disbursement = net after fees minus previous REFI balance. */
    const disbursementAmount = isRefi
        ? ctx.actualDisbursement || ctx.fundingDisbursed
        : ctx.fundingDisbursed;
    return buildDailyConnecticutContractPrefillFields({
        totalCommericalFinancing: disbursementAmount,
        deductedAtDisbursement: ctx.feesDeducted,
        totalAmountCommercialFinancing: ctx.fundingProvided,
        financeCharge: ctx.financeCharge,
        totalRepaymentAmount: ctx.totalRepayment,
        estimatedTimePeriodicPaymement:
            ctx.estimatedTermBusinessDays ?? ctx.estimatedTermDays ?? ctx.estimatedTerm,
        disclosureBrokerFee: ctx.brokerFeePaidToBroker,
        disclosureDate: ctx.signatureDate,
        recipientName: ctx.recipientName,
        recipientAddress: ctx.recipientAddress,
        funderName: ctx.funderName,
        funderAddress: ctx.funderAddress,
        funderPhone: ctx.funderPhone,
        funderEmail: ctx.funderEmail,
        dealIdPrefix: ctx.dealIdPrefix,
        amountTriggerPrepayment: ctx.prepaymentDiscountAmount,
        dateWhichAmountReceived: ctx.prepaymentReceivedByDate,
        recipientName2: ctx.recipientName,
        disclosureDate2: ctx.signatureDate,
        recipientAddress2: ctx.recipientAddress,
        theestimatedpayment: ctx.estimatedPayment,
        paymentExceedPercent: ctx.paymentExceededPercent,
        signature1Date: ctx.signatureDate,
        signature2Date: ctx.signatureDate,
        outstandingSalesBasedFinancing: isRefi ? ctx.previousRefiBalance : "",
        totalAmountNewFinancing: "",
        unpaidFinanceCharges: "",
    });
}

const buildDailyUtah = (ctx: StateDisclosureContext) =>
    buildDailyUtahContractPrefillFields({
        /** Guide: Total Amount of Funds = Total Net (all fund amount slots). */
        purchaseAmount: ctx.fundingDisbursed || ctx.netContractedFunding || ctx.fundingProvided,
        netToMerchant: ctx.fundingDisbursed || ctx.netContractedFunding,
        purchasePrice: ctx.totalRepayment,
        financeCharge: ctx.financeCharge || ctx.totalDollarCost,
        remittance: ctx.estimatedPayment,
        monthlyIncome: ctx.averageMonthlyIncome,
        /** Guide: “Amount that the Provider Pays…” — leave blank. */
        appendixUnderwritingFees: "",
        paymentTermsPercent: ctx.paymentExceededPercent,
    });

/**
 * Dispatch key matches `BoldSignTemplate.name` (lowercased) and falls back to
 * `${frequency}_${state}` so callers can resolve from either source.
 */
const REGISTRY: Record<string, StateDisclosureBuilder> = {
    daily_california: buildCaliforniaDisclosurePrefill,

    daily_connecticut: buildConnecticutDisclosurePrefill,

    weekly_connecticut: buildConnecticutDisclosurePrefill,

    daily_florida: (ctx) =>
        buildDailyFloridaContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
            /** PDF: Funds Provided = contracted amount; Funds Disbursed = net after fees. */
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

    weekly_florida: (ctx) =>
        buildDailyFloridaContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
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

    /** Missouri uses the same field map / PDF tab labels as Florida. */
    daily_missouri: (ctx) =>
        buildDailyFloridaContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
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

    weekly_missouri: (ctx) =>
        buildDailyFloridaContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
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

    daily_louisiana: (ctx) =>
        buildDailyLouisianaContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
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

    weekly_louisiana: (ctx) =>
        buildDailyLouisianaContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
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

    daily_texas: (ctx) =>
        buildDailyTexasContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
            dealIdPrefix: ctx.dealIdPrefix,
            totalAmountBusinessFund: ctx.fundingProvided,
            totalAmountOfFundDisbursed: ctx.fundingDisbursed,
            totalAmountTobePaidToProvider: ctx.totalRepayment,
            totalDollarCost: ctx.totalDollarCost,
            estimatedTerm: ctx.estimatedTermDays ?? ctx.estimatedTerm,
            estimatedPaymentAmount: ctx.estimatedPayment,
            estimatedMonthlyCost: ctx.estimatedMonthlyCost,
            disclosureBrokerFee: ctx.brokerFeePaidToBroker,
            signatureDate: ctx.signatureDate,
        }),

    weekly_texas: (ctx) =>
        buildDailyTexasContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
            dealIdPrefix: ctx.dealIdPrefix,
            totalAmountBusinessFund: ctx.fundingProvided,
            totalAmountOfFundDisbursed: ctx.fundingDisbursed,
            totalAmountTobePaidToProvider: ctx.totalRepayment,
            totalDollarCost: ctx.totalDollarCost,
            estimatedTerm: ctx.estimatedTermDays ?? ctx.estimatedTerm,
            estimatedPaymentAmount: ctx.estimatedPayment,
            estimatedMonthlyCost: ctx.estimatedMonthlyCost,
            disclosureBrokerFee: ctx.brokerFeePaidToBroker,
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

    weekly_georgia: (ctx) =>
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
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
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

    weekly_kansas: (ctx) =>
        buildDailyKansasContractPrefillFields({
            clientName: ctx.recipientName,
            funderName: ctx.funderName,
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

    daily_new_york: buildNewYorkDisclosurePrefill,

    weekly_new_york: buildNewYorkDisclosurePrefill,

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
            exceededPayment: ctx.paymentExceededPercent,
            weeklyPayments: ctx.estimatedPayment,
            paymentExceededPercent: ctx.paymentExceededPercent,
            signatureDate2: ctx.signatureDate,
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
            prepaymentDiscount: ctx.prepaymentDiscountAmount,
            dateOfAmountReceived: ctx.prepaymentReceivedByDate,
            signatureDate: ctx.signatureDate,
            recipientName2: ctx.recipientName,
            disclosureDate2: ctx.signatureDate,
            recipientAddress1: ctx.recipientAddress,
            exceededPayment: ctx.paymentExceededPercent,
            weeklyPayments: ctx.estimatedPayment,
            paymentExceededPercent: ctx.paymentExceededPercent,
            signatureDate2: ctx.signatureDate,
        }),

    daily_utah: buildDailyUtah,
    weekly_utah: buildDailyUtah,

    weekly_california: buildCaliforniaDisclosurePrefill,
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

/** First argument that is a non-empty string once trimmed. */
function firstNonEmpty(...values: unknown[]): string {
    for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) return text;
    }
    return "";
}

function firstRecord(value: unknown): Record<string, unknown> | null {
    if (Array.isArray(value) && value[0] != null && typeof value[0] === "object") {
        return value[0] as Record<string, unknown>;
    }
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

/** Specified % of gross / income purchased. Ignore 0 — TermsOffer sync often stores 0. */
function firstPositivePercent(...values: unknown[]): number | undefined {
    for (const value of values) {
        const raw =
            typeof value === "string" ? value.trim().replace(/%/g, "") : value;
        const n = coerceFiniteNumber(raw);
        if (n !== undefined && n > 0) return n;
    }
    return undefined;
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
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) {
        const [month, day, year] = t.split("/");
        return `${month.padStart(2, "0")}/${day.padStart(2, "0")}/${year}`;
    }
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
    /** Bank-analysis rows used for average monthly income / lookback months. */
    bankAnalyses?: unknown;
}): StateDisclosureContext {
    const contract = (args.contract ?? {}) as Record<string, unknown>;
    const offer = (contract.offer ?? null) as Record<string, unknown> | null;

    // The offer leads: the contract columns and any snake_case copies merged in from the
    // application are a snapshot taken when the deal was prepared, so a re-scrubbed offer
    // has to win over them or every document keeps quoting the superseded advance.
    const purchaseAmount = coerceFiniteNumber(
        offer?.offer ??
            offer?.approvedAmount ??
            contract.purchase_price ??
            contract.purchaseAmount ??
            contract.purchase_amount ??
            contract.approvedAmount,
    );
    const purchasePrice = coerceFiniteNumber(
        offer?.totalRemit ??
            offer?.paybackAmount ??
            contract.purchased_amount ??
            contract.purchasePrice ??
            contract.totalAmount,
    );
    const purchasePercent = coerceFiniteNumber(
        contract.purchasePercent ??
            contract.purchase_percent ??
            offer?.rate ??
            offer?.factorRate,
    );
    const underwritingFeesApplicable =
        resolveAppendixUnderwritingFeesDollars(
            contract.appendixUnderwritingFees ??
                contract.appendix_underwriting_fees ??
                contract.underwriter_fee ??
                contract.total_fees ??
                offer?.fees,
            purchaseAmount,
        ) ??
        coerceFiniteNumber(
            contract.appendixUnderwritingFees ??
                contract.appendix_underwriting_fees ??
                contract.underwriter_fee ??
                contract.total_fees,
        );
    /** Display / net stack includes the optional $25 wire fee (calculators also apply it). */
    const includeWireFee = resolveIncludeWireFee(
        (contract.contractPrefillOverrides as Record<string, unknown> | null)?.includeWireFee ??
            contract.includeWireFee,
    );
    const underwritingFees =
        underwritingFeesApplicable !== undefined
            ? applyDisclosurePlatformFee(underwritingFeesApplicable, includeWireFee)
            : resolveDisclosureWireFeeUsd(includeWireFee);

    /** Per-period payment lives on the TermsOffer / OfferDecision row. */
    const periodicPayment = coerceFiniteNumber(
        // `repayPerPeriod` is the OfferDecision's own per-period field; without it the
        // context fell back to a stale contract copy of the payment.
        offer?.repayPerPeriod ??
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
    const application = (args.application ?? {}) as Record<string, unknown>;
    const termsOffer =
        firstRecord(application.termsOffers) ?? firstRecord(contract.termsOffers);
    const positionRow =
        firstRecord(application.positions) ?? firstRecord(contract.positions);
    const percentOfGross = firstPositivePercent(
        termsOffer?.percentOfGross,
        offer?.ourRemit,
        offer?.mcaRemit,
        offer?.specifiedPercent,
        offer?.percentOfGross,
        positionRow?.percentOfGross,
        positionRow?.mcaRemit,
    );
    /**
     * Payment cadence for the disclosure.
     *
     * The offer is what defines the cadence, so it is read first. The contract row has no
     * frequency column of its own, and `contract.paymentTerms` is the PaymentTerms
     * relation (an array) — so the old `??` chain stopped there and resolved to an empty
     * string, which left the disclosure to fall back on the calculator's "Daily" default
     * and print Daily for a weekly deal.
     */
    const frequency = String(
        firstNonEmpty(
            offer?.frequency,
            (contract as Record<string, unknown>).frequency,
            (contract as Record<string, unknown>).disclosureFrequency,
            firstRecord(contract.paymentTerms)?.paymentFrequency,
            firstRecord(contract.achs)?.frequency,
            termsOffer?.frequency,
        ),
    ).trim();

    const fundingProvided = formatUsd(purchaseAmount);
    const totalRepayment = formatUsd(purchasePrice);

    const prefillOverrides =
        (contract.contractPrefillOverrides as Record<string, unknown> | null) ?? null;
    const netFromPrefill = coerceFiniteNumber(
        contract.netToMerchant ?? contract.net_to_merchant,
    );
    const refinanceAmountRaw =
        coerceFiniteNumber(contract.refinanceAmount) ??
        coerceFiniteNumber(contract.refinance_amount) ??
        coerceFiniteNumber(prefillOverrides?.refinanceAmount) ??
        coerceFiniteNumber(offer?.refinanceAmount) ??
        0;
    const isRefi = isRefinanceDeal(refinanceAmountRaw);
    const previousDealDate = formatUsDate(
        offer?.previousDealDate ??
            contract.previousDealDate ??
            prefillOverrides?.previousDealDate ??
            prefillOverrides?.previous_agreement_date ??
            "",
    );

    let fundingDisbursed = "";
    let netContractedFunding = "";
    let actualDisbursement = "";
    let previousRefiBalance = "";
    if (purchaseAmount !== undefined) {
        const netAfterFees =
            underwritingFees !== undefined
                ? Math.max(0, purchaseAmount - underwritingFees)
                : purchaseAmount;
        netContractedFunding = formatUsd(netAfterFees);
        if (isRefi) {
            previousRefiBalance = formatUsd(refinanceAmountRaw);
            actualDisbursement = formatUsd(Math.max(0, netAfterFees - refinanceAmountRaw));
            /**
             * CT REFI: disbursement subtracts REFI balance.
             * FL/GA/KS/LA/MO/UT/VA (and CA left box via netContracted): PDF keeps
             * disbursed as net-after-fees only for shared templates — CT is the
             * exception that shows actual merchant cash.
             */
            const stateKey = normalizeStateKey(
                String(
                    contract.state ??
                        (contract as Record<string, unknown>).businessAddressState ??
                        "",
                ),
            );
            const disbursementSubtractsRefi =
                stateKey === "connecticut" || stateKey === "ct";
            fundingDisbursed = disbursementSubtractsRefi
                ? actualDisbursement
                : netContractedFunding;
        } else {
            fundingDisbursed = netContractedFunding;
            actualDisbursement = netContractedFunding;
        }
    }
    if (netFromPrefill !== undefined) {
        const netPrefillUsd = formatUsd(netFromPrefill);
        if (isRefi) {
            actualDisbursement = netPrefillUsd;
            const stateKey = normalizeStateKey(
                String(
                    contract.state ??
                        (contract as Record<string, unknown>).businessAddressState ??
                        "",
                ),
            );
            if (stateKey === "connecticut" || stateKey === "ct") {
                fundingDisbursed = netPrefillUsd;
            }
        } else {
            netContractedFunding = netPrefillUsd;
            fundingDisbursed = netPrefillUsd;
            actualDisbursement = netPrefillUsd;
        }
    }

    const totalDollarCostNum =
        purchasePrice !== undefined && purchaseAmount !== undefined
            ? Math.max(0, purchasePrice - purchaseAmount)
            : undefined;
    const totalDollarCost = formatUsd(totalDollarCostNum);

    /** Fall back to derived per-period payment when not stored explicitly. */
    const remittanceFromPrefill = coerceFiniteNumber(
        contract.remittance ?? offer?.paymentAmount,
    );
    let estimatedPayment = formatUsd(
        remittanceFromPrefill ?? periodicPayment,
    );
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

    const appPrefill = getApplicationClientPrefillArgs(args.application);
    const merchant = resolveBalanceTransferMerchantContext(contract, args.application);
    /** Disclosures always show merchant business/legal name — never owner/customer person name. */
    const customerName =
        resolveContractBusinessLegalNameForPrefill(contract, args.application) ||
        merchant.businessName ||
        merchant.clientLegalName ||
        str(contract.legalName) ||
        str(contract.clientLegalName) ||
        str((contract as Record<string, unknown>).client_legal_name) ||
        str(appPrefill.legalName);

    const businessAddressLine = [
        str(contract.businessAddress),
        str(contract.businessAddressCity),
        str(contract.businessAddressState),
        str(contract.businessAddressZip),
    ]
        .filter(Boolean)
        .join(", ") ||
        [
            str(appPrefill.businessAddress),
            str(appPrefill.businessAddressCity),
            str(appPrefill.businessAddressState),
            str(appPrefill.businessAddressZip),
        ]
            .filter(Boolean)
            .join(", ");

    const todayUs = new Intl.DateTimeFormat("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
    }).format(new Date());
    // Disclosures are issued on send day — never the stored contract/agreement date.
    const signatureDate = todayUs;

    /** Average monthly income is sourced from bank analysis, then application/business. */
    const client = (application.client as Record<string, unknown> | null) ?? null;
    const business = (client?.business as Record<string, unknown> | null) ?? null;
    const averageMonthlyIncome = formatUsd(
        application.averageMonthlyIncome ??
            application.averageMonthlyDeposit ??
            application.avgMonthlyDeposit ??
            business?.monthlyRevenue ??
            client?.monthlyRevenue ??
            "",
    );

    let estimatedTermDays = "";
    let estimatedTermBusinessDays = "";
    let estimatedMonthlyCost = "";
    let averageMonthlyIncomeFromCalculator = "";
    let estimatedPaymentFromCalculator = "";
    let estimatedAnnualPercentageRateFromCalculator = "";
    let percentFromCalculator: number | undefined;
    try {
        const calcInputs = buildDisclosureCalculatorInputsFromSources({
            contract: args.contract ?? null,
            application: args.application ?? null,
            offerDecision: offer,
            bankAnalyses: args.bankAnalyses,
            state: String(
                contract.state ??
                    (contract as Record<string, unknown>).businessAddressState ??
                    "",
            ),
        });
        const metrics = calculateDisclosureMetrics(calcInputs);
        if (
            metrics.percentOfDailyIncomePurchased > 0 &&
            metrics.percentOfDailyIncomePurchased <= 100
        ) {
            percentFromCalculator = metrics.percentOfDailyIncomePurchased;
        }
        if (metrics.estimatedTermDays > 0) {
            estimatedTermDays = String(metrics.estimatedTermDays);
        }
        if (metrics.estimatedMonthlyCost > 0) {
            estimatedMonthlyCost = formatUsd(metrics.estimatedMonthlyCost);
        }
        if (metrics.estimatedMerchantAverageMonthlyRevenue > 0) {
            averageMonthlyIncomeFromCalculator = formatUsd(
                metrics.estimatedMerchantAverageMonthlyRevenue,
            );
        }
        if (metrics.estimatedPayment > 0) {
            estimatedPaymentFromCalculator = formatUsd(metrics.estimatedPayment);
        }
        if (metrics.estimatedAnnualPercentageRate > 0) {
            estimatedAnnualPercentageRateFromCalculator = formatPercent(
                metrics.estimatedAnnualPercentageRate,
            );
        }

        if (isRefi && purchaseAmount !== undefined) {
            const refiMetrics = calculateRefinanceDealMetrics({
                state: String(
                    contract.state ??
                        (contract as Record<string, unknown>).businessAddressState ??
                        "",
                ),
                label:
                    str(contract.funderName) ||
                    str((contract as Record<string, unknown>).funder_name) ||
                    PLATFORM_DISCLOSURE_FUNDER_NAME,
                paymentFrequency: frequency || calcInputs.frequency,
                contractAmount: purchaseAmount,
                originationFee: underwritingFeesApplicable ?? 0,
                factorRate: purchasePercent ?? calcInputs.factorRate,
                paymentAmount: periodicPayment ?? metrics.estimatedPayment,
                previousRefiBalance: refinanceAmountRaw,
                previousDealDate,
                averageMonthlyRevenue: metrics.estimatedMerchantAverageMonthlyRevenue,
                numberOfPayments: calcInputs.numberOfPayments,
                numberOfPaymentDays: calcInputs.numberOfPaymentDays,
                specifiedPercent: percentOfGross ?? 0,
            });
            estimatedTermDays = String(refiMetrics.estimatedTermDays);
            estimatedTermBusinessDays = String(refiMetrics.estimatedTermBusinessDays);
            if (refiMetrics.estimatedMonthlyCost > 0) {
                estimatedMonthlyCost = formatUsd(refiMetrics.estimatedMonthlyCost);
            }
            if (refiMetrics.apr > 0) {
                estimatedAnnualPercentageRateFromCalculator = formatPercent(refiMetrics.apr);
            }
            if (refiMetrics.paymentAmount > 0 && !estimatedPayment) {
                estimatedPaymentFromCalculator = formatUsd(refiMetrics.paymentAmount);
            }
        } else if (purchaseAmount !== undefined) {
            /** NO-REFI: same PDF money / term / monthly-cost layer (refi balance = 0). */
            const noRefiMetrics = calculateRefinanceDealMetrics({
                state: String(
                    contract.state ??
                        (contract as Record<string, unknown>).businessAddressState ??
                        "",
                ),
                label:
                    str(contract.funderName) ||
                    str((contract as Record<string, unknown>).funder_name) ||
                    PLATFORM_DISCLOSURE_FUNDER_NAME,
                paymentFrequency: frequency || calcInputs.frequency,
                contractAmount: purchaseAmount,
                originationFee: underwritingFeesApplicable ?? 0,
                factorRate: purchasePercent ?? calcInputs.factorRate,
                paymentAmount: periodicPayment ?? metrics.estimatedPayment,
                previousRefiBalance: 0,
                averageMonthlyRevenue: metrics.estimatedMerchantAverageMonthlyRevenue,
                numberOfPayments: calcInputs.numberOfPayments,
                numberOfPaymentDays: calcInputs.numberOfPaymentDays,
                specifiedPercent: percentOfGross ?? 0,
            });
            estimatedTermDays = String(noRefiMetrics.estimatedTermDays);
            estimatedTermBusinessDays = String(noRefiMetrics.estimatedTermBusinessDays);
            if (noRefiMetrics.estimatedMonthlyCost > 0) {
                estimatedMonthlyCost = formatUsd(noRefiMetrics.estimatedMonthlyCost);
            }
            if (noRefiMetrics.apr > 0) {
                estimatedAnnualPercentageRateFromCalculator = formatPercent(noRefiMetrics.apr);
            }
        } else if (numberOfPayments && numberOfPayments > 0) {
            const freqLower = frequency.toLowerCase();
            if (freqLower.startsWith("week")) {
                estimatedTermBusinessDays = String(Math.trunc(numberOfPayments) * 5);
            } else if (estimatedTermDays) {
                estimatedTermBusinessDays = estimatedTermDays;
            }
        }
    } catch {
        estimatedTermDays = "";
    }

    /**
     * Last-resort estimated term when the calculators could not produce one: the offer
     * term read in the cadence's own unit. A weekly term is a number of weeks, and the
     * disclosure states the term in calendar days, so it is 7 days per payment.
     */
    if (!estimatedTermDays && termLength !== undefined && termLength > 0) {
        const freqKey = normalizeFrequencyKey(frequency);
        const perPayment = freqKey.startsWith("bi")
            ? 14
            : freqKey.startsWith("week")
              ? 7
              : freqKey.startsWith("month")
                ? 30
                : 1;
        estimatedTermDays = String(Math.trunc(termLength) * perPayment);
    }

    const resolvedAverageMonthlyIncome =
        averageMonthlyIncomeFromCalculator || averageMonthlyIncome;
    const resolvedEstimatedPayment = estimatedPayment || estimatedPaymentFromCalculator;
    const resolvedPaymentExceededPercent = formatPercent(
        percentOfGross ?? percentFromCalculator,
        "",
    );
    const resolvedEstimatedApr =
        estimatedAnnualPercentageRateFromCalculator || estimatedAnnualPercentageRate;

    const ownerPersonName =
        str(contract.clientName) ||
        str((appPrefill as Record<string, unknown>).clientName) ||
        str(merchant.clientName) ||
        str((application.client as Record<string, unknown> | null)?.name) ||
        "";

    return {
        /** Contracted amount (CT/FL “total amount of financing / funds provided”). */
        fundingProvided,
        fundingDisbursed,
        /**
         * CA/NY “provided to you directly” / right box.
         * NO REFI: net after fees. REFI: actual disbursement (CA) — state builders may remap.
         */
        fundingProvidedDirect: isRefi
            ? actualDisbursement || fundingDisbursed
            : fundingDisbursed || netContractedFunding || fundingProvided,
        feesDeducted: formatUsd(underwritingFees),
        totalRepayment,
        totalDollarCost,
        financeCharge: totalDollarCost,
        estimatedPayment: resolvedEstimatedPayment,
        estimatedAnnualPercentageRate: resolvedEstimatedApr,
        paymentExceededPercent: resolvedPaymentExceededPercent,
        percentOfBusinessIncome: resolvedPaymentExceededPercent,
        averageMonthlyIncome: resolvedAverageMonthlyIncome,
        estimatedTerm: termLength !== undefined ? String(Math.trunc(termLength)) : "",
        estimatedTermDays,
        estimatedTermBusinessDays: estimatedTermBusinessDays || estimatedTermDays,
        frequency: formatDisclosurePaymentFrequencyLabel(frequency) || frequency,
        estimatedNumberOfPayments:
            numberOfPayments !== undefined ? String(Math.trunc(numberOfPayments)) : "",
        prepayment: "",
        recipientName: customerName,
        merchantName: ownerPersonName || customerName,
        funderName:
            resolveRefiLabelName(
                str(contract.funderName) ||
                    str((contract as Record<string, unknown>).funder_name) ||
                    PLATFORM_DISCLOSURE_FUNDER_NAME,
            ),
        funderAddress: str((contract as Record<string, unknown>).funderAddress),
        funderPhone: str((contract as Record<string, unknown>).funderPhone),
        funderEmail: str((contract as Record<string, unknown>).funderEmail),
        dealIdPrefix: str((contract as Record<string, unknown>).dealIdPrefix),
        recipientAddress: businessAddressLine,
        signatureDate,
        prepaymentReceivedByDate: signatureDate,
        prepaymentDiscountAmount: "",
        brokerFeePaidToBroker: "0.00",
        estimatedMonthlyCost,
        isRefinance: isRefi,
        netContractedFunding: netContractedFunding || fundingDisbursed,
        previousRefiBalance: isRefi ? previousRefiBalance : "",
        actualDisbursement: isRefi ? actualDisbursement || fundingDisbursed : fundingDisbursed,
        previousDealDate: isRefi ? previousDealDate : "",
        outstandingSalesBasedFinancing: isRefi ? previousRefiBalance : "",
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
    ca: "california",
    fl: "florida",
    mo: "missouri",
    ga: "georgia",
    ks: "kansas",
    ut: "utah",
    va: "virginia",
    ct: "connecticut",
    ny: "new_york",
    la: "louisiana",
    tx: "texas",
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

/**
 * Canonical disclosure editor rows (empty values) when a state disclosure template applies.
 * Used by the template-mapping prefill editor before CRM values are merged in.
 */
export function getStateDisclosureEditorFieldDefinitions(
    name?: string | null,
    state?: string | null,
    frequency?: string | null,
): ContractPrefillField[] {
    if (!resolveStateDisclosureRegistryKey(name, state, frequency)) {
        return [];
    }
    return buildDisclosureCalculatorEditorFieldDefinitions();
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
