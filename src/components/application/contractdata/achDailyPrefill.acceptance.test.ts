/**
 * ACH Daily / ACH Weekly / Exhibit C prefill isolation acceptance tests.
 * Run: npx --yes tsx src/components/application/contractdata/achDailyPrefill.acceptance.test.ts
 *
 * ACH Daily shares SignNow widget NAMES with Exhibit C (both use the `*_p1` ACH
 * Authorization widgets). It must not share Exhibit C's DATA. These tests pin
 * that separation in both directions.
 */
import assert from "node:assert/strict";
import {
    getDocumentTemplatePrefillFieldRowsForEditor,
    omitMappingBlobIds,
    resolveSharedDbaValue,
} from "./documentTemplateMappingPrefill";
import {
    applySharedBankDetailsToMappingBlob,
    type SharedBankDetails,
} from "./sharedBankDetails";

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

/** A deal whose Exhibit C entity holds values that must never reach ACH Daily. */
const CONTRACT: Record<string, unknown> = {
    id: 1,
    clientName: "Monika HRACHYAYI Sarafyan",
    legalName: "Erbar Consulting INC",
    bankName: "CHASE",
    accountNumber: "725307998",
    routingNumber: "322271627",
    contractPrefillOverrides: {
        exhibitCEntities: JSON.stringify([
            {
                clientName: "EXHIBIT C PERSON",
                accountHolderName: "EXHIBIT C HOLDER",
                accountHolderDba: "EXHIBIT C DBA",
                bankName: "EXHIBIT C BANK",
                bankAccount: "999999999",
                bankRouting: "123456789",
            },
        ]),
    },
};

function rowsFor(layoutKey: string, name: string): Record<string, string> {
    const rows = getDocumentTemplatePrefillFieldRowsForEditor({
        templateId: layoutKey,
        templateLayoutKey: layoutKey,
        templateName: name,
        documentType: "addendum",
        contract: CONTRACT,
        application: null,
        agreementDate: "09/15/2026",
    });
    const out: Record<string, string> = {};
    for (const row of rows) out[row.id] = String(row.value ?? "");
    return out;
}

test("ACH Daily does not inherit Exhibit C's account holder", () => {
    const daily = rowsFor("ach_daily", "ACH Daily");
    assert.notEqual(daily.ach_account_holder_name_p1, "EXHIBIT C HOLDER");
    assert.notEqual(daily.ach_account_holder_dba_p1, "EXHIBIT C DBA");
});

test("ACH Daily uses the deal's own account holder and bank", () => {
    const daily = rowsFor("ach_daily", "ACH Daily");
    assert.equal(daily.ach_account_holder_name_p1, "ERBAR CONSULTING INC");
    assert.equal(daily.ach_bank_name_p1, "CHASE");
    assert.equal(daily.ach_bank_account_p1, "725307998");
    assert.equal(daily.ach_bank_routing_p1, "322271627");
});

test("ACH Daily still renders its own field map (non-empty)", () => {
    const daily = rowsFor("ach_daily", "ACH Daily");
    assert.ok(Object.keys(daily).length > 0, "ACH Daily must produce editor rows");
    assert.ok(daily.ach_bank_name_p1 !== undefined, "ACH Daily keeps the *_p1 widget names");
});

test("Exhibit C keeps its own entity values (unchanged behavior)", () => {
    const exhibit = rowsFor("exhibit_c", "Exhibit C");
    assert.equal(exhibit.ach_account_holder_name_p1, "EXHIBIT C HOLDER");
    assert.equal(exhibit.ach_account_holder_dba_p1, "EXHIBIT C DBA");
});

test("ACH Weekly is unaffected and uses its own widget ids", () => {
    const weekly = rowsFor("ach_weekly", "ACH Weekly");
    assert.equal(weekly.ach_bank_name_p1_ach, "CHASE");
    assert.equal(weekly.ach_bank_routing_p1_ach, "322271627");
    assert.equal(weekly.ach_bank_account_p1_ach, "725307998");
    // Weekly must not pick up Exhibit C's entity either.
    for (const value of Object.values(weekly)) {
        assert.notEqual(value, "EXHIBIT C HOLDER");
        assert.notEqual(value, "EXHIBIT C BANK");
    }
});

test("ACH Daily and Exhibit C do not produce identical account-holder data", () => {
    const daily = rowsFor("ach_daily", "ACH Daily");
    const exhibit = rowsFor("exhibit_c", "Exhibit C");
    assert.notEqual(
        daily.ach_account_holder_name_p1,
        exhibit.ach_account_holder_name_p1,
        "ACH Daily must not mirror Exhibit C's account holder",
    );
});

test("saving one document does not overwrite another document's bank account", () => {
    // Exhibit C deliberately holds a different account than the deal bank.
    const blob: Record<string, Record<string, string>> = {
        "mapping-exhibit-c": {
            ach_bank_name_p1: "EXHIBIT C BANK",
            ach_bank_account_p1: "999999999",
            ach_bank_routing_p1: "123456789",
        },
        "mapping-ach-daily": {
            ach_bank_name_p1: "",
            ach_bank_account_p1: "",
            ach_bank_routing_p1: "",
        },
    };
    const dealBank: SharedBankDetails = {
        bankName: "CHASE",
        routingNumber: "322271627",
        accountNumber: "725307998",
    };
    const next = applySharedBankDetailsToMappingBlob(blob, dealBank);
    // Exhibit C's deliberate values survive.
    assert.equal(next["mapping-exhibit-c"].ach_bank_account_p1, "999999999");
    assert.equal(next["mapping-exhibit-c"].ach_bank_name_p1, "EXHIBIT C BANK");
    // The empty document still auto-fills from the deal bank.
    assert.equal(next["mapping-ach-daily"].ach_bank_account_p1, "725307998");
    assert.equal(next["mapping-ach-daily"].ach_bank_name_p1, "CHASE");
});

/** Exhibit C (2) for a second entity, next to the deal's own Exhibit C. */
const MULTI_ENTITY_CONTRACT: Record<string, unknown> = {
    ...CONTRACT,
    contractPrefillOverrides: {
        exhibitCEntities: JSON.stringify([
            {},
            {
                clientLegalName: "ENTITY B LLC",
                accountHolderName: "ENTITY B LLC",
                accountHolderDba: "ENTITY B DBA",
                bankName: "WELLS FARGO",
                bankAccount: "2222222222",
                bankRouting: "121000248",
            },
        ]),
    },
};

function exhibitCCopyRows(
    contract: Record<string, unknown>,
    index: number,
): Record<string, string> {
    const rows = getDocumentTemplatePrefillFieldRowsForEditor({
        templateId: "exhibit_c",
        templateLayoutKey: "exhibit_c",
        templateName: "Exhibit C",
        documentType: "addendum",
        contract,
        application: null,
        agreementDate: "09/28/2026",
        exhibitCEntityIndex: index,
    });
    const out: Record<string, string> = {};
    for (const row of rows) out[row.id] = String(row.value ?? "");
    return out;
}

test("an Exhibit C copy names its own entity, not the application merchant", () => {
    const copy = exhibitCCopyRows(MULTI_ENTITY_CONTRACT, 1);
    assert.equal(copy.client_legal_name_p1, "ENTITY B LLC");
    assert.equal(copy.ach_account_holder_dba_p1, "ENTITY B DBA");
    assert.equal(copy.ach_bank_account_p1, "2222222222");
    // The original Exhibit C still carries the deal's merchant and bank.
    const original = exhibitCCopyRows(MULTI_ENTITY_CONTRACT, 0);
    assert.equal(original.client_legal_name_p1.toUpperCase(), "ERBAR CONSULTING INC");
    assert.equal(original.ach_bank_account_p1, "725307998");
});

test("a new Exhibit C copy starts empty instead of copying the application", () => {
    const copy = exhibitCCopyRows(MULTI_ENTITY_CONTRACT, 2);
    assert.equal(copy.client_legal_name_p1 ?? "", "");
    assert.equal(copy.ach_account_holder_dba_p1 ?? "", "");
    assert.equal(copy.ach_bank_account_p1 ?? "", "");
});

test("a copy's DBA and bank are never the application's shared values", () => {
    const blob: Record<string, Record<string, string>> = {
        "mapping-exhibit-c-2": {
            ach_account_holder_dba_p1: "ENTITY B DBA",
            ach_bank_account_p1: "2222222222",
        },
        "mapping-flex": { installment_day_1_p1: "10/01/2026" },
    };
    const withoutCopies = omitMappingBlobIds(blob, ["mapping-exhibit-c-2"]);
    assert.equal(
        resolveSharedDbaValue({ mainPrefill: {}, contract: {}, mappingBlobs: withoutCopies }),
        "",
    );
    const next = applySharedBankDetailsToMappingBlob(withoutCopies, {
        bankName: "CHASE",
        routingNumber: "322271627",
        accountNumber: "725307998",
    });
    assert.equal(next["mapping-exhibit-c-2"], undefined);
    assert.equal(blob["mapping-exhibit-c-2"].ach_bank_account_p1, "2222222222");
});

console.log(`\n${passed} tests passed`);
