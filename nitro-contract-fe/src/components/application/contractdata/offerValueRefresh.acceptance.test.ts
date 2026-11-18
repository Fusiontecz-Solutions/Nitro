/**
 * Re-scrubbed offer acceptance tests.
 * Run: npx --yes tsx src/components/application/contractdata/offerValueRefresh.acceptance.test.ts
 *
 * A deal first written at $1,000 @ 1.499 and later re-scrubbed to $2,000 @ 1.499 kept
 * showing the original advance and payment in the ACH addendum's prefill editor, because
 * the per-mapping blob saved against the old offer outranked every recomputed value.
 * The disclosure moved on, so the two documents disagreed about the same deal.
 */
import assert from "node:assert/strict";
import { getDocumentTemplatePrefillFieldRowsForEditor } from "./documentTemplateMappingPrefill";

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

/** Live offer: $2,000 advance, $2,998 payback, $299.80 daily over 10 days. */
const CONTRACT: Record<string, unknown> = {
    id: 1,
    clientName: "MARY IRVIN",
    legalName: "RE-NEW-IT RENOVATIONS, LLC",
    state: "Alaska",
    offer: {
        offer: 2000,
        totalRemit: 2998,
        term: "10",
        frequency: "Daily",
        repayPerPeriod: 299.8,
        rate: 1.499,
        fees: 10,
    },
    approvedAmount: 2000,
    totalAmount: 2998,
    purchaseAmount: "2000",
    purchasePrice: "2998",
    remittance: "299.8",
};

/** What the editor saved while the deal was still $1,000 @ 1.499. */
const SAVED_AGAINST_OLD_OFFER: Record<string, string> = {
    client_name_p1_ach: "MARY IRVIN",
    remittance_p1_ach: "149.90",
    purchase_amount_p1_ach: "1,000.00",
    ach_bank_name_p1_ach: "JP Morgan",
    ach_bank_routing_p1_ach: "123456789",
};

function rowsFor(
    layoutKey: string,
    name: string,
    saved: Record<string, string> | null,
): Record<string, string> {
    const rows = getDocumentTemplatePrefillFieldRowsForEditor({
        templateId: layoutKey,
        templateLayoutKey: layoutKey,
        templateName: name,
        documentType: "addendum",
        contract: CONTRACT,
        application: null,
        agreementDate: "09/17/2026",
        savedOverridesForMapping: saved,
    });
    const out: Record<string, string> = {};
    for (const row of rows) out[row.id] = String(row.value ?? "");
    return out;
}

function money(value: string): number {
    return Number(String(value).replace(/[$,]/g, ""));
}

test("ACH Weekly drops an advance saved against a superseded offer", () => {
    const weekly = rowsFor("ach_weekly", "ACH Weekly", SAVED_AGAINST_OLD_OFFER);
    assert.notEqual(money(weekly.purchase_amount_p1_ach), 1000);
    assert.equal(money(weekly.purchase_amount_p1_ach), 2000);
});

test("ACH Weekly drops a per-period payment saved against a superseded offer", () => {
    const weekly = rowsFor("ach_weekly", "ACH Weekly", SAVED_AGAINST_OLD_OFFER);
    assert.notEqual(money(weekly.remittance_p1_ach), 149.9);
    assert.equal(money(weekly.remittance_p1_ach), 299.8);
});

test("hand-edited non-offer fields still survive a reload", () => {
    const weekly = rowsFor("ach_weekly", "ACH Weekly", SAVED_AGAINST_OLD_OFFER);
    assert.equal(weekly.ach_bank_name_p1_ach, "JP Morgan");
    assert.equal(weekly.ach_bank_routing_p1_ach, "123456789");
});

test("the start date is not treated as an offer amount", () => {
    const weekly = rowsFor("ach_weekly", "ACH Weekly", {
        ...SAVED_AGAINST_OLD_OFFER,
        remittance_start_date_p1_ach: "01/05/2026",
    });
    assert.equal(weekly.remittance_start_date_p1_ach, "01/05/2026");
});

test("with no saved blob the live offer is still used", () => {
    const weekly = rowsFor("ach_weekly", "ACH Weekly", null);
    assert.equal(money(weekly.purchase_amount_p1_ach), 2000);
    assert.equal(money(weekly.remittance_p1_ach), 299.8);
});

console.log(`\n${passed} passed`);
