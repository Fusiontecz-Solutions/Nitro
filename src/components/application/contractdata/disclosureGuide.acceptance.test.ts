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
    computeDisclosureApr,
    calculateDisclosureMetrics,
} from "./disclosureAprCalculator";
import { resolveWantedAddendumKinds } from "./disclosureDocumentRules";
import {
    buildCaliforniaRefinancePage3Amounts,
    resolveCaliforniaEstimatedTermDays,
} from "./california_disclosure";
import { getStateDisclosurePrefillFieldsByName } from "./stateDisclosurePrefill";

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
    assert.equal(m.originationFee, 10_050);
    assert.equal(m.netContractedFunding, 89_950);
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
    assert.equal(m.netContractedFunding, 89_950);
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
    assert.equal(m.netContractedFunding, 89_950);
    assert.equal(m.actualDisbursement, 64_950);
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
    assert.equal(map.funding_provided, "90000.00");
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
    assert.equal(m.netContractedFunding, 89_950);
    assert.equal(m.actualDisbursement, 39_950);
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
    assert.equal(m.netContractedFunding, 89_950);
    assert.equal(m.recipientFunds, 89_950);
});

test("CA REFI page-3 itemization", () => {
    const p3 = buildCaliforniaRefinancePage3Amounts({
        actualDisbursement: 65_000,
        originationFee: 10_000,
        previousRefiBalance: 25_000,
    });
    assert.equal(p3.recipientFunds, "65000.00");
    assert.equal(p3.page3Line1, "10000.00");
    assert.equal(p3.page3Line2, "25000.00");
    assert.equal(p3.page3Subtotal, "100000.00");
    assert.equal(p3.page3Net, "90000.00");
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
    assert.equal(m.estimatedTermDays, 140);
    assert.equal(m.estimatedTermBusinessDays, 100);
    assert.equal(
        resolveCaliforniaEstimatedTermDays({
            estimatedNumberOfPayments: "20",
            frequency: "Daily",
        }),
        "140",
    );
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

console.log(`\n${passed} tests passed`);
