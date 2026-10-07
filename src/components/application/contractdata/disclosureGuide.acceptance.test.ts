/**
 * Disclosure / REFI PDF guide acceptance tests.
 * Run: npx --yes tsx src/components/application/contractdata/disclosureGuide.acceptance.test.ts
 */
import assert from "node:assert/strict";
import {
    calculateRefinanceDealMetrics,
    computePdfEstimatedMonthlyCost,
    isRefinanceDeal,
} from "./refinanceDealCalculations";
import {
    buildDisclosureCalculatorInputsFromSources,
    computeDisclosureApr,
    calculateDisclosureMetrics,
    formatDisclosureDocumentFrequencyLabel,
    formatDisclosurePaymentFrequencyLabel,
} from "./disclosureAprCalculator";
import {
    buildDisclosureEditorFieldsFromContext,
    expandDisclosureEditorValuesToPdfFields,
} from "./disclosureEditorFields";
import { resolveWantedAddendumKinds } from "./disclosureDocumentRules";
import {
    buildCaliforniaRefinancePage3Amounts,
    resolveCaliforniaEstimatedTermDays,
} from "./california_disclosure";
import {
    buildStateDisclosurePrefillContextFromContract,
    getStateDisclosurePrefillFieldsByName,
} from "./stateDisclosurePrefill";

function fieldMap(fields: { id: string; value: string }[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) out[f.id] = f.value;
    return out;
}

let passed = 0;
function test(name: string, fn: () => void) {
    try {
        fn();
        passed += 1;
        console.log(`PASS  ${name}`);
    } catch (err) {
        console.error(`FAIL  ${name}`);
        console.error(err);
        process.exitCode = 1;
    }
}

// --- TEST 1: No Refi + Daily ---
test("TEST 1 No Refi + Daily core money", () => {
    const m = calculateRefinanceDealMetrics({
        state: "California",
        label: "CLEAR",
        paymentFrequency: "Daily",
        contractAmount: 100_000,
        originationFee: 10_000,
        originationFeePercent: 10,
        factorRate: 1.5,
        paymentAmount: 1_500,
        previousRefiBalance: 0,
        numberOfPayments: 12,
        numberOfPaymentDays: 60,
        merchantName: "Owner",
        businessName: "Biz LLC",
        businessAddress: "1 Main St",
    });
    assert.equal(m.dealType, "NO_REFI");
    assert.equal(m.originationFee, 10_025);
    assert.equal(m.netContractedFunding, 89_975);
    assert.equal(m.totalPayback, 150_000);
    assert.equal(m.financeCharge, 50_000);
    assert.equal(m.estimatedMonthlyCost, 30_000);
    assert.equal(isRefinanceDeal(0), false);
});

// --- TEST 2: No Refi + Weekly ---
test("TEST 2 No Refi + Weekly monthly cost", () => {
    const m = calculateRefinanceDealMetrics({
        state: "California",
        label: "CLEAR",
        paymentFrequency: "Weekly",
        contractAmount: 100_000,
        originationFee: 10_000,
        factorRate: 1.5,
        paymentAmount: 7_500,
        previousRefiBalance: 0,
        numberOfPayments: 20,
        merchantName: "Owner",
        businessName: "Biz LLC",
        businessAddress: "1 Main St",
    });
    assert.equal(m.netContractedFunding, 89_975);
    assert.equal(m.totalPayback, 150_000);
    assert.equal(m.financeCharge, 50_000);
    assert.equal(m.estimatedMonthlyCost, 30_000);
    assert.equal(computePdfEstimatedMonthlyCost(7_500, "Weekly"), 30_000);
});

// --- TEST 3: California + REFI + Daily ---
test("TEST 3 California REFI Daily funding L/R", () => {
    const m = calculateRefinanceDealMetrics({
        state: "California",
        label: "CLEAR",
        paymentFrequency: "Daily",
        contractAmount: 100_000,
        originationFee: 10_000,
        factorRate: 1.5,
        paymentAmount: 1_500,
        previousRefiBalance: 25_000,
        previousDealDate: "01/15/2026",
        numberOfPayments: 12,
        numberOfPaymentDays: 60,
        merchantName: "Owner",
        businessName: "Biz LLC",
        businessAddress: "1 Main St",
        averageMonthlyRevenue: 80_000,
    });
    assert.equal(m.dealType, "REFI");
    assert.equal(m.netContractedFunding, 89_975);
    assert.equal(m.actualDisbursement, 64_975);
    assert.equal(m.totalPayback, 150_000);
    assert.equal(m.financeCharge, 50_000);
    assert.equal(m.estimatedMonthlyCost, 30_000);

    const fields = getStateDisclosurePrefillFieldsByName("daily_california", {
        fundingProvided: "100000.00",
        fundingDisbursed: "90000.00",
        netContractedFunding: "90000.00",
        actualDisbursement: "65000.00",
        previousRefiBalance: "25000.00",
        previousDealDate: "01/15/2026",
        feesDeducted: "10000.00",
        totalRepayment: "150000.00",
        financeCharge: "50000.00",
        estimatedPayment: "1500.00",
        estimatedMonthlyCost: "30000.00",
        estimatedAnnualPercentageRate: "199.60",
        averageMonthlyIncome: "80000.00",
        estimatedTermDays: "60",
        frequency: "Daily",
        isRefinance: true,
        recipientName: "BIZ LLC",
        funderName: "Clear Capital",
        signatureDate: "08/11/2026",
    });
    const map = fieldMap(fields);
    assert.equal(map.funding_provided, "100000.00");
    assert.equal(map.funding_provided_direct, "65000.00");
});

// --- TEST 4: Connecticut + REFI ---
test("TEST 4 Connecticut REFI disbursement", () => {
    const m = calculateRefinanceDealMetrics({
        state: "Connecticut",
        label: "CLEAR",
        paymentFrequency: "Daily",
        contractAmount: 100_000,
        originationFee: 10_000,
        factorRate: 1.5,
        paymentAmount: 1_500,
        previousRefiBalance: 50_000,
        previousDealDate: "01/15/2026",
        numberOfPaymentDays: 100,
        numberOfPayments: 20,
        merchantName: "Owner",
        businessName: "Biz LLC",
        businessAddress: "1 Main St",
    });
    assert.equal(m.netContractedFunding, 89_975);
    assert.equal(m.actualDisbursement, 39_975);
    assert.equal(m.totalPayback, 150_000);
    assert.equal(m.financeCharge, 50_000);

    const fields = getStateDisclosurePrefillFieldsByName("daily_connecticut", {
        fundingProvided: "100000.00",
        fundingDisbursed: "40000.00",
        actualDisbursement: "40000.00",
        previousRefiBalance: "50000.00",
        feesDeducted: "10000.00",
        totalRepayment: "150000.00",
        financeCharge: "50000.00",
        estimatedPayment: "1500.00",
        estimatedTermBusinessDays: "100",
        isRefinance: true,
        recipientName: "Biz LLC",
        recipientAddress: "1 Main St",
        signatureDate: "08/11/2026",
    });
    const map = fieldMap(fields);
    assert.equal(map.total_commerical_financing, "40000.00");
    assert.equal(map.total_amount_commercial_financing, "100000.00");
});

// --- TEST 5: FL REFI disbursed = net (not CA cash-out) ---
test("TEST 5 FL/GA/KS/LA/MO REFI disbursed = net", () => {
    for (const key of ["daily_florida", "daily_georgia", "daily_kansas", "daily_louisiana", "daily_missouri"]) {
        const fields = getStateDisclosurePrefillFieldsByName(key, {
            fundingProvided: "100000.00",
            fundingDisbursed: "90000.00",
            netContractedFunding: "90000.00",
            actualDisbursement: "65000.00",
            previousRefiBalance: "25000.00",
            feesDeducted: "10000.00",
            totalRepayment: "150000.00",
            financeCharge: "50000.00",
            totalDollarCost: "50000.00",
            estimatedPayment: "1500.00",
            isRefinance: true,
            recipientName: "Biz LLC",
            funderName: "Clear Capital",
            paymentExceededPercent: "10",
        });
        const map = fieldMap(fields);
        const provided =
            map.total_amount_business_fund ??
            map.total_amount_of_fund_provided ??
            map.total_amount_of_funds_provided;
        const disbursed =
            map.total_amount_of_fund_disbursed ??
            map.total_amount_fund_disbursed ??
            map.total_amount_of_funds_disbursed ??
            map.total_net_amount;
        assert.equal(provided, "100000.00", `${key} provided`);
        assert.equal(disbursed, "90000.00", `${key} disbursed must be net not 65000`);
    }
});

// --- TEST 6: CA Weekly term + monthly ---
test("TEST 6 California Weekly term calendar days", () => {
    const m = calculateRefinanceDealMetrics({
        state: "California",
        label: "CLEAR",
        paymentFrequency: "Weekly",
        contractAmount: 100_000,
        originationFee: 10_000,
        factorRate: 1.5,
        paymentAmount: 7_500,
        previousRefiBalance: 0,
        numberOfPayments: 20,
        merchantName: "Owner",
        businessName: "Biz LLC",
        businessAddress: "1 Main St",
    });
    assert.equal(m.estimatedMonthlyCost, 30_000);
    assert.equal(m.estimatedTermDays, 140);
    assert.equal(
        resolveCaliforniaEstimatedTermDays({
            estimatedNumberOfPayments: "20",
            frequency: "Weekly",
        }),
        "140",
    );
});

// --- TEST 7: NY Weekly ---
test("TEST 7 New York Weekly term calendar days", () => {
    const m = calculateRefinanceDealMetrics({
        state: "New York",
        label: "CLEAR",
        paymentFrequency: "Weekly",
        contractAmount: 100_000,
        originationFee: 10_000,
        factorRate: 1.5,
        paymentAmount: 7_500,
        previousRefiBalance: 0,
        numberOfPayments: 20,
        merchantName: "Owner",
        businessName: "Biz LLC",
        businessAddress: "1 Main St",
    });
    assert.equal(m.estimatedMonthlyCost, 30_000);
    assert.equal(m.estimatedTermDays, 140);
});

// --- TEST 8: CT Weekly term weeks × 5 ---
test("TEST 8 Connecticut Weekly term business days", () => {
    const m = calculateRefinanceDealMetrics({
        state: "Connecticut",
        label: "CLEAR",
        paymentFrequency: "Weekly",
        contractAmount: 100_000,
        originationFee: 10_000,
        factorRate: 1.5,
        paymentAmount: 7_500,
        previousRefiBalance: 0,
        numberOfPayments: 20,
        merchantName: "Owner",
        businessName: "Biz LLC",
        businessAddress: "1 Main St",
    });
    assert.equal(m.estimatedTermBusinessDays, 100);
});

// --- TEST 9: Virginia weeks remain weeks ---
test("TEST 9 Virginia keeps weeks as weeks", () => {
    const fields = getStateDisclosurePrefillFieldsByName("weekly_virginia", {
        fundingProvided: "100000.00",
        fundingDisbursed: "90000.00",
        feesDeducted: "10000.00",
        totalRepayment: "150000.00",
        financeCharge: "50000.00",
        estimatedPayment: "7500.00",
        estimatedNumberOfPayments: "20",
        estimatedTerm: "20",
        frequency: "Weekly",
        recipientName: "Biz LLC",
        recipientAddress: "1 Main St",
        signatureDate: "08/11/2026",
        paymentExceededPercent: "10",
    });
    const map = fieldMap(fields);
    const term =
        map.estimated_number_of_payement ??
        map.estimated_number_of_payments ??
        map.estimated_term;
    assert.equal(term, "20");
});

// --- TEST 10: Addendum rules ---
test("TEST 10 Addendum composable rules", () => {
    assert.deepEqual(resolveWantedAddendumKinds("California", true), [
        "addendum_p",
        "addendum_ca",
    ]);
    assert.deepEqual(resolveWantedAddendumKinds("New York", true), [
        "addendum_p",
        "addendum_ny",
    ]);
    assert.deepEqual(resolveWantedAddendumKinds("Virginia", true), [
        "addendum_p",
        "addendum_va",
    ]);
    assert.deepEqual(resolveWantedAddendumKinds("California", false), ["addendum_ca"]);
    assert.ok(!resolveWantedAddendumKinds("Florida", false).includes("addendum_p"));
    assert.ok(!resolveWantedAddendumKinds("Florida", true).includes("addendum_ca"));
    assert.deepEqual(resolveWantedAddendumKinds("Florida", true), ["addendum_p"]);
});

// --- APR MCA calculator inputs ---
test("APR MCA calculator formula (image)", () => {
    // $10k / $15k / 12 months → 50%
    assert.equal(computeDisclosureApr({ financeCharge: 5_000, purchasePrice: 10_000, termMonths: 12 }), 50);
    // Central example: $100k / 1.50 / 3 months term
    assert.equal(
        computeDisclosureApr({ financeCharge: 50_000, purchasePrice: 100_000, termMonths: 3 }),
        200,
    );
});

test("Disclosure metrics finance charge = payback - contract", () => {
    const m = calculateDisclosureMetrics({
        state: "California",
        frequency: "Daily",
        purchasePrice: 100_000,
        factorRate: 1.5,
        originationFee: 10_000,
        numberOfPayments: 20,
        numberOfPaymentDays: 100,
        disbursementDate: "",
        firstPaymentDate: "",
        monthlyRevenues: [80_000],
    });
    assert.equal(m.financeCharge, 50_000);
    assert.equal(m.estimatedPayment, 1_500);
    assert.equal(m.estimatedMonthlyCost, 30_000);
    assert.equal(m.netContractedFunding, 89_975);
    assert.equal(m.recipientFunds, 89_975);
});

test("CA REFI page-3 itemization", () => {
    const p3 = buildCaliforniaRefinancePage3Amounts({
        actualDisbursement: 65_000,
        originationFee: 10_000,
        previousRefiBalance: 25_000,
    });
    assert.equal(p3.recipientFunds, "65,000.00");
    assert.equal(p3.page3Line1, "10,000.00");
    assert.equal(p3.page3Line2, "25,000.00");
    assert.equal(p3.page3Subtotal, "100,000.00");
    assert.equal(p3.page3Net, "90,000.00");
});

// --- Guide: CA/NY daily estimated term = calendar days (weeks × 7) ---
test("Guide CA daily estimated term is calendar days", () => {
    const m = calculateRefinanceDealMetrics({
        state: "California",
        label: "CLEAR",
        paymentFrequency: "Daily",
        contractAmount: 100_000,
        originationFee: 10_000,
        factorRate: 1.5,
        paymentAmount: 1_500,
        previousRefiBalance: 0,
        numberOfPayments: 20,
        numberOfPaymentDays: 100,
        merchantName: "Owner",
        businessName: "Biz LLC",
        businessAddress: "1 Main St",
    });
    assert.equal(m.estimatedTermDays, 20);
    assert.equal(m.estimatedTermBusinessDays, 100);
    assert.equal(
        resolveCaliforniaEstimatedTermDays({
            estimatedNumberOfPayments: "20",
            frequency: "Daily",
        }),
        "20",
    );
});

test("Daily $10K / term 10 uses payment days, not weeks", () => {
    const m = calculateDisclosureMetrics({
        state: "California",
        frequency: "Daily",
        purchasePrice: 10_000,
        factorRate: 1.499,
        originationFee: 1_000,
        numberOfPayments: 2,
        numberOfPaymentDays: 10,
        disbursementDate: "2026-09-08",
        firstPaymentDate: "2026-09-08",
        monthlyRevenues: [],
        paymentAmount: 1_499,
    });
    assert.equal(m.estimatedTermDays, 10);
    assert.equal(
        calculateRefinanceDealMetrics({
            state: "California",
            label: "NITRO",
            paymentFrequency: "Daily",
            contractAmount: 10_000,
            originationFee: 1_000,
            factorRate: 1.499,
            paymentAmount: 1_499,
            previousRefiBalance: 0,
            numberOfPayments: 2,
            numberOfPaymentDays: 10,
        }).estimatedTermDays,
        10,
    );
    assert.equal(
        resolveCaliforniaEstimatedTermDays({
            estimatedTermDays: "10",
            estimatedNumberOfPayments: "2",
            frequency: "Daily",
        }),
        "10",
    );
    assert.equal(
        resolveCaliforniaEstimatedTermDays({
            estimatedNumberOfPayments: "10",
            frequency: "Weekly",
        }),
        "70",
    );
});

test("Disclosure PDF frequency is day/week; CRM editor stays Daily/Weekly", () => {
    assert.equal(formatDisclosurePaymentFrequencyLabel("Daily"), "Daily");
    assert.equal(formatDisclosurePaymentFrequencyLabel("Weekly"), "Weekly");
    assert.equal(formatDisclosureDocumentFrequencyLabel("Daily"), "day");
    assert.equal(formatDisclosureDocumentFrequencyLabel("Weekly"), "week");
    const pdf = expandDisclosureEditorValuesToPdfFields({
        disclosure_payment_frequency: "Daily",
        payment_frequency: "Weekly",
        funder_name: "Nitro Advance",
    });
    assert.equal(pdf.disclosure_payment_frequency, "DAY");
    assert.equal(pdf.payment_frequency, "WEEK");
});

test("Guide Utah provider-pays field left blank", () => {
    const fields = getStateDisclosurePrefillFieldsByName("daily_utah", {
        fundingProvided: "100000.00",
        fundingDisbursed: "90000.00",
        netContractedFunding: "90000.00",
        totalRepayment: "150000.00",
        financeCharge: "50000.00",
        estimatedPayment: "1500.00",
        paymentExceededPercent: "10",
        averageMonthlyIncome: "80000.00",
        brokerFeePaidToBroker: "0.00",
    });
    const map = fieldMap(fields);
    assert.equal(map.purchase_amount, "90000.00");
    assert.equal(map.net_to_merchant, "90000.00");
    assert.ok(!map.appendix_underwriting_fees, "provider pays must be blank per Guide");
});

/**
 * The Offer Summary's first row is gross funding; the blank in the paragraph
 * beside it is what reaches the merchant after deductions. Both printed the
 * same net figure, so a disclosure never showed that anything was deducted.
 *
 * These cover `buildDisclosureEditorFieldsFromContext`, the builder every
 * registered state actually goes through. The per-state builders tested above
 * are only the fallback, which is how the bug survived them.
 */
test("Offer Summary funding provided is gross, funds provided directly is net", () => {
    const fields = buildDisclosureEditorFieldsFromContext({
        fundingProvided: "100000.00",
        fundingDisbursed: "90000.00",
        netContractedFunding: "90000.00",
        feesDeducted: "10000.00",
        totalRepayment: "150000.00",
        financeCharge: "50000.00",
        estimatedPayment: "1500.00",
        averageMonthlyIncome: "80000.00",
    });
    const map = fieldMap(fields);
    assert.equal(map.funding_provided, "100000.00");
    assert.equal(map.funding_provided_direct, "90000.00");
    // The two must differ whenever anything is deducted — that difference is
    // the whole point of the row and the blank beside it.
    assert.notEqual(map.funding_provided, map.funding_provided_direct);
});

test("REFI keeps funding provided gross and disburses the post-payoff amount", () => {
    const fields = buildDisclosureEditorFieldsFromContext({
        isRefinance: true,
        fundingProvided: "100000.00",
        fundingDisbursed: "90000.00",
        netContractedFunding: "90000.00",
        actualDisbursement: "65000.00",
        previousRefiBalance: "25000.00",
        feesDeducted: "10000.00",
        totalRepayment: "150000.00",
        financeCharge: "50000.00",
        estimatedPayment: "1500.00",
        averageMonthlyIncome: "80000.00",
    });
    const map = fieldMap(fields);
    assert.equal(map.funding_provided, "100000.00");
    assert.equal(map.funding_provided_direct, "65000.00");
});

/**
 * The contract row carries no cadence of its own, and the API returns the PaymentTerms
 * relation as an array — reading that array as the cadence left the disclosure cadence
 * empty, so the calculators fell through to their "Daily" default and a weekly offer
 * disclosed Daily with a 10-week term shown as 10 days.
 */
function weeklyDealContract(): Record<string, unknown> {
    return {
        id: 1,
        state: "California",
        // As the contract API returns it: relation arrays, and no `frequency` column.
        paymentTerms: [] as unknown[],
        achs: [] as unknown[],
        contractLenght: 10,
        purchaseAmount: "10000",
        appendixUnderwritingFees: "1000",
        offer: {
            offer: 10000,
            totalRemit: 14990,
            term: "10 Weeks",
            frequency: "Weekly",
            repayPerPeriod: 1499,
            fees: 10,
        },
    };
}

test("Weekly offer discloses Weekly, not the Daily default", () => {
    const ctx = buildStateDisclosurePrefillContextFromContract({
        contract: weeklyDealContract(),
        application: {},
    });
    assert.equal(ctx.frequency, "Weekly");
    const map = fieldMap(buildDisclosureEditorFieldsFromContext(ctx));
    assert.equal(map.disclosure_payment_frequency, "Weekly");
});

test("Weekly estimated term is stated in calendar days (weeks x 7)", () => {
    const ctx = buildStateDisclosurePrefillContextFromContract({
        contract: weeklyDealContract(),
        application: {},
    });
    assert.equal(ctx.estimatedTermDays, "70");
    assert.equal(
        fieldMap(buildDisclosureEditorFieldsFromContext(ctx)).disclosure_term_days,
        "70",
    );
});

test("Daily offer keeps its term in days and its Daily cadence", () => {
    const contract = weeklyDealContract();
    contract.contractLenght = 20;
    contract.offer = {
        offer: 10000,
        totalRemit: 14990,
        term: "20 Days",
        frequency: "Daily",
        repayPerPeriod: 749.5,
        fees: 10,
    };
    const ctx = buildStateDisclosurePrefillContextFromContract({ contract, application: {} });
    assert.equal(ctx.frequency, "Daily");
    assert.equal(ctx.estimatedTermDays, "20");
});

test("Saved disclosure monthly revenues outrank the bank analysis", () => {
    const bankAnalyses = [
        {
            _id: "ba-1",
            rows: [
                { _id: "r1", monthLabel: "August 2026", totalCredit: 50000 },
                { _id: "r2", monthLabel: "July 2026", totalCredit: 60000 },
            ],
        },
    ];
    const saved = buildDisclosureCalculatorInputsFromSources({
        contract: { contractPrefillOverrides: { disclosureMonthlyRevenues: [85000, 92000.5] } },
        bankAnalyses,
    });
    assert.deepEqual(saved.monthlyRevenues, [85000, 92000.5]);

    // Nothing saved yet: the calculator still starts from the bank analysis.
    const fresh = buildDisclosureCalculatorInputsFromSources({
        contract: { contractPrefillOverrides: {} },
        bankAnalyses,
    });
    assert.deepEqual(fresh.monthlyRevenues, [50000, 60000]);
});

console.log(`\n${passed} tests passed`);
