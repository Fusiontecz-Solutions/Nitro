/**
 * Merchant / business address acceptance tests.
 * Run: npx --yes tsx src/components/application/contractdata/merchantAddressPrefill.acceptance.test.ts
 *
 * Every funder's addendums print the merchant (or account holder) address in a
 * single SignNow widget with no City / State / Zip boxes beside it. These tests
 * pin that the prefill rows carry the whole address — street, city, state and
 * zip — on each addendum that has such a widget, for whichever funder's copy of
 * the layout is being sent.
 */
import assert from "node:assert/strict";
import { getDocumentTemplatePrefillFieldRowsForEditor } from "./documentTemplateMappingPrefill";
import {
    composeMerchantFullAddress,
    resolveMerchantFullAddress,
} from "./merchantAddress";

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

const FULL = "218 LAUREL WOODS, WARNER ROBINS, GA 31088";

/** A deal whose business address is on file as four separate CRM entries. */
const CONTRACT: Record<string, unknown> = {
    id: 1,
    clientName: "Monika Sarafyan",
    legalName: "Erbar Consulting INC",
    bankName: "CHASE",
    accountNumber: "725307998",
    routingNumber: "322271627",
    business_address: "218 LAUREL WOODS",
    business_address_city: "WARNER ROBINS",
    business_address_state: "GA",
    business_address_zip: "31088",
};

function rowsFor(
    layoutKey: string,
    name: string,
    contract: Record<string, unknown> = CONTRACT,
): Record<string, string> {
    const rows = getDocumentTemplatePrefillFieldRowsForEditor({
        templateId: layoutKey,
        templateLayoutKey: layoutKey,
        templateName: name,
        documentType: "addendum",
        contract,
        application: null,
        agreementDate: "09/15/2026",
    });
    const out: Record<string, string> = {};
    for (const row of rows) out[row.id] = String(row.value ?? "");
    return out;
}

test("ACH Daily prints the full merchant address", () => {
    assert.equal(rowsFor("ach_daily", "ACH Daily").ach_account_holder_address_p1, FULL);
});

test("ACH Weekly prints the full billing address", () => {
    assert.equal(rowsFor("ach_weekly", "ACH Weekly").business_address_p1_ach, FULL);
});

test("Exhibit C prints the full account holder address", () => {
    assert.equal(rowsFor("exhibit_c", "Exhibit C").ach_account_holder_address_p1, FULL);
});

test("Monthly Fee prints the full business and account holder address", () => {
    const monthly = rowsFor("monthly_fee", "Monthly Fee");
    assert.equal(monthly.business_address_p1, FULL);
    assert.equal(monthly.ach_account_holder_address_p1, FULL);
});

/**
 * Exhibit C and the ACH authorization print "Account Holder Business Address",
 * which is the business on every funder — a deal whose owner lives somewhere
 * else must still print the business there. The Monthly Fee's holder block sits
 * under a business line of its own and prints the owner's home address.
 */
const GUARANTOR_CONTRACT: Record<string, unknown> = {
    ...CONTRACT,
    guarantor_address: "9 OAK ST",
    guarantor_address_city: "MACON",
    guarantor_address_state: "GA",
    guarantor_address_zip: "31201",
};
const GUARANTOR_FULL = "9 OAK ST, MACON, GA 31201";

test("ACH Daily prints the BUSINESS address as the account holder business address", () => {
    const rows = rowsFor("ach_daily", "ACH Daily", {
        ...GUARANTOR_CONTRACT,
        ach_authorization_account_holder_address: "9 OAK ST",
    });
    assert.equal(rows.ach_account_holder_address_p1, FULL);
});

test("Exhibit C prints the BUSINESS address as the account holder business address", () => {
    const rows = rowsFor("exhibit_c", "Exhibit C", {
        ...GUARANTOR_CONTRACT,
        ach_authorization_account_holder_address: "9 OAK ST",
    });
    assert.equal(rows.ach_account_holder_address_p1, FULL);
});

test("Exhibit C ignores the guarantor address mirrored onto its first entity", () => {
    const rows = rowsFor("exhibit_c", "Exhibit C", {
        ...GUARANTOR_CONTRACT,
        exhibitCEntities: JSON.stringify([
            { id: "e1", accountHolderName: "Erbar Consulting INC", accountHolderAddress: "9 OAK ST" },
        ]),
    });
    assert.equal(rows.ach_account_holder_address_p1, FULL);
});

test("Monthly Fee prints the GUARANTOR address as the account holder address", () => {
    const monthly = rowsFor("monthly_fee", "Monthly Fee", GUARANTOR_CONTRACT);
    // The business line above it still shows the business location.
    assert.equal(monthly.business_address_p1, FULL);
    assert.equal(monthly.ach_account_holder_address_p1, GUARANTOR_FULL);
});

test("ACH Weekly keeps the BUSINESS address on its billing line", () => {
    const rows = rowsFor("ach_weekly", "ACH Weekly", GUARANTOR_CONTRACT);
    assert.equal(rows.business_address_p1_ach, FULL);
});

test("an account holder address falls back to the business address", () => {
    // No guarantor address on file — the widget must not be left blank.
    assert.equal(rowsFor("ach_daily", "ACH Daily").ach_account_holder_address_p1, FULL);
    assert.equal(rowsFor("exhibit_c", "Exhibit C").ach_account_holder_address_p1, FULL);
    assert.equal(rowsFor("monthly_fee", "Monthly Fee").ach_account_holder_address_p1, FULL);
});

test("an address already carrying its city/state/zip is left alone", () => {
    const values: Record<string, string> = {
        ach_account_holder_address: "9 OAK ST, MACON, GA 31201",
        business_address_city: "WARNER ROBINS",
        business_address_state: "GA",
        business_address_zip: "31088",
    };
    const get = (...ids: string[]) => ids.map((id) => values[id] ?? "").find(Boolean) ?? "";
    assert.equal(
        resolveMerchantFullAddress(get, ["ach_account_holder_address", "business_address"]),
        "9 OAK ST, MACON, GA 31201",
    );
});

test("missing parts are skipped rather than printed as empty commas", () => {
    assert.equal(composeMerchantFullAddress("218 LAUREL WOODS", "", "", ""), "218 LAUREL WOODS");
    assert.equal(
        composeMerchantFullAddress("218 LAUREL WOODS", "WARNER ROBINS", "", "31088"),
        "218 LAUREL WOODS, WARNER ROBINS, 31088",
    );
    assert.equal(composeMerchantFullAddress("", "WARNER ROBINS", "GA", "31088"), "WARNER ROBINS, GA 31088");
});

console.log(`\n${passed} passed`);
