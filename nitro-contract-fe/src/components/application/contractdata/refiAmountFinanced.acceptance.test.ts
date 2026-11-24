/**
 * REFI disclosure: Amount Financed = advance − fees − previous balance, on every
 * state's disclosure. Reported deal: 50,000 advance, 5,000 fee, 10,000 previous
 * balance — contract NET AMOUNT 35,000.00 but the disclosure printed 45,000.00.
 * Run: npx --yes tsx src/components/application/contractdata/refiAmountFinanced.acceptance.test.ts
 */
import assert from "node:assert/strict";
import {
    expandDisclosureEditorValuesToPdfFields,
    mapDisclosureMetricsToEditorFieldOverrides,
} from "./disclosureEditorFields";
import type { DisclosureCalculatorResult } from "./disclosureAprCalculator";

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

function metrics(refi: number): DisclosureCalculatorResult {
    const net = 50000 - 5000;
    return {
        purchasePrice: 50000,
        revenuePurchased: 75000,
        amountFinanced: net,
        recipientFunds: net - refi,
        financeCharge: 25000,
        estimatedTotalPayment: 75000,
        paymentTotal: 75000,
        estimatedAnnualPercentageRate: 50,
        estimatedMerchantAverageMonthlyRevenue: 0,
        estimatedPayment: 3750,
        estimatedMonthlyCost: 75000,
        percentOfDailyIncomePurchased: 10,
        estimatedTermDays: 20,
        checkValue: 0,
        isRefinance: refi > 0,
        netContractedFunding: net,
        previousRefiBalance: refi,
        actualDisbursement: net - refi,
    };
}

const options = (state: string) => ({
    state,
    inputs: { purchasePrice: 50000, originationFee: 5000, includeWireFee: false, state },
});

for (const state of ["California", "Florida", "Georgia", "Utah", "New York", "Connecticut", "Virginia"]) {
    test(`${state} REFI: Amount Financed 35,000.00, origination fee 5,000.00`, () => {
        const editor = mapDisclosureMetricsToEditorFieldOverrides(metrics(10000), options(state) as never);
        assert.equal(editor.disclosure_amount_financed, "35,000.00");
        assert.equal(editor.disclosure_origination_fee, "5,000.00");
        assert.equal(editor.disclosure_fees_deducted, "5,000.00");
    });
}

test("Non-REFI: Amount Financed stays advance − fee (45,000.00)", () => {
    const editor = mapDisclosureMetricsToEditorFieldOverrides(metrics(0), options("Florida") as never);
    assert.equal(editor.disclosure_amount_financed, "45,000.00");
});

test("PDF expansion on REFI: fees-deducted is the fee, not 0.00", () => {
    const pdf = expandDisclosureEditorValuesToPdfFields({
        disclosure_purchase_price: "50,000.00",
        disclosure_amount_financed: "35,000.00",
        disclosure_recipient_funds: "35,000.00",
        disclosure_page3_line_1: "5,000.00",
        disclosure_page3_line_2: "10,000.00",
    });
    assert.equal(pdf.disclosure_origination_fee, "5,000.00");
    assert.equal(pdf.deducted_at_disbursement, "5,000.00");
});

test("Connecticut REFI page 1: financing 35,000.00, deducted 5,000.00 (fee not derived as 15,000)", () => {
    const pdf = expandDisclosureEditorValuesToPdfFields({
        funding_provided: "50,000.00",
        disclosure_amount_financed: "35,000.00",
        disclosure_recipient_funds: "35,000.00",
        disclosure_page3_line_2: "10,000.00",
    });
    assert.equal(pdf.total_commerical_financing, "35,000.00");
    assert.equal(pdf.deducted_at_disbursement, "5,000.00");
});

console.log(`\n${passed} tests passed`);
