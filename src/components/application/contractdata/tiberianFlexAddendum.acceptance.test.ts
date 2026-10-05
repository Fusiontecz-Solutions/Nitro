/**
 * Tiberian Funding Flex Addendum acceptance tests.
 *
 * Note: the template's widget names are swapped against its printed headers —
 * `net_funds_provided_N` prints under "Payment Amount" and `payment_amount_N`
 * under "Net Funds Provided" — so the editor binds by position.
 *
 * Verified against the live SignNow document group template
 * 18be4342d4514c3b96b0d9f4852f0af1790fd04d ("FLEX TIBERIAN FUNDING (1)",
 * document ebff2427d00e46fc8b3cac79be9689dd0bf59fc6). Its installment table
 * has 24 rows and four columns — Payment Date | Net Funds Provided | Payment
 * Amount | Receivables Purchased — and none of its widget names match the Nitro
 * Flex copy (b5c267f0…), so the Nitro map must stay untouched.
 *
 * Run: npx --yes tsx src/components/application/contractdata/tiberianFlexAddendum.acceptance.test.ts
 */
import assert from "node:assert/strict";
import {
    isSignNowAddendumLayoutKey,
    isSignNowDisclosureLayoutKey,
    isTiberianFlexAddendumRef,
    SIGNNOW_FLEX_ADDENDUM_TEMPLATE_ID,
    SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID,
} from "./signnowAddendumTemplates";
import {
    buildFlexAddendumContractPrefillFields,
    buildTiberianFlexAddendumContractPrefillFields,
} from "./FLEX_ADDENDUM";
import {
    splitFlexInstallmentRows,
    TIBERIAN_FLEX_INSTALLMENT_COLUMNS,
} from "./flexAddendumInstallmentRows";
import { getDocumentTemplatePrefillFieldRowsForEditor } from "./documentTemplateMappingPrefill";
import { mapFunderSignNowTemplates } from "@/utils/signnowTemplateLink";

/** Owner-filled text widgets on the live Tiberian Flex Addendum. */
const TIBERIAN_PREFILLED_WIDGETS = [
    ...Array.from({ length: 24 }, (_, i) => [
        `payment_date_${i + 1}`,
        `net_funds_provided_${i + 1}`,
        `payment_amount_${i + 1}`,
        `receivables_purchased_${i + 1}`,
    ]).flat(),
    "owner_guarantor_1_name",
    "owner_guarantor_1_ssn",
    "owner_guarantor_2_name",
    "owner_guarantor_2_ssn",
];

/** Signer widgets on the live template — never prefilled. */
const TIBERIAN_NON_PREFILL_WIDGETS = ["owner_guarantor_1_signature", "owner_guarantor_2_signature"];

const tests: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
    tests.push([name, fn]);
}

test("Tiberian field map covers exactly the live template's owner widgets", () => {
    const ids = buildTiberianFlexAddendumContractPrefillFields({}).map((f) => f.id);
    assert.deepEqual([...ids].sort(), [...TIBERIAN_PREFILLED_WIDGETS].sort());
    for (const widget of TIBERIAN_NON_PREFILL_WIDGETS) {
        assert.equal(ids.includes(widget), false, `${widget} must not be prefilled`);
    }
});

test("Nitro Flex Addendum map is unchanged", () => {
    const ids = buildFlexAddendumContractPrefillFields({}).map((f) => f.id);
    assert.equal(ids.length, 10 * 3 + 4);
    assert.equal(ids[0], "installment_day_1_p1");
    assert.equal(ids.includes("net_funds_provided_1"), false);
});

test("every installment column, including Net Funds Provided, goes to the grid", () => {
    const rows = buildTiberianFlexAddendumContractPrefillFields({});
    const { installmentRows, otherRows } = splitFlexInstallmentRows(rows);
    assert.equal(installmentRows.length, 24 * 4);
    assert.deepEqual(
        otherRows.map((r) => r.id),
        [
            "owner_guarantor_1_name",
            "owner_guarantor_1_ssn",
            "owner_guarantor_2_name",
            "owner_guarantor_2_ssn",
        ],
    );
});

test("the template id alone is recognised as a flex addendum, not a disclosure", () => {
    assert.equal(isTiberianFlexAddendumRef(SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID), true);
    assert.equal(isTiberianFlexAddendumRef(SIGNNOW_FLEX_ADDENDUM_TEMPLATE_ID), false);
    assert.equal(isSignNowAddendumLayoutKey(SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID), true);
    assert.equal(isSignNowDisclosureLayoutKey(SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID), false);
});

test("Settings → Funders keeps Tiberian's copy under its own SignNow id", () => {
    for (const name of ["Flex Addendum", "FLEX TIBERIAN FUNDING"]) {
        const options = mapFunderSignNowTemplates(
            [{ name, link: SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID }],
            "addendum",
        );
        assert.equal(options.length, 1);
        assert.equal(options[0].templateId, SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID);
        assert.equal(options[0].knownLayoutKey, "flex_addendum", name);
    }
});

test("the editor rows for Tiberian's mapping use the Tiberian widget names", () => {
    const rows = getDocumentTemplatePrefillFieldRowsForEditor({
        templateId: SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID,
        templateName: "Flex Addendum",
        templateLayoutKey: SIGNNOW_TIBERIAN_FLEX_ADDENDUM_TEMPLATE_ID,
        documentType: "addendum",
        contract: {
            clientLegalName: "ACME WIDGETS LLC",
            clientName: "JANE OWNER",
            funderName: "TIBERIAN FUNDING",
        },
        application: null,
    } as Parameters<typeof getDocumentTemplatePrefillFieldRowsForEditor>[0]);
    const ids = rows.map((r) => r.id);
    for (const widget of TIBERIAN_PREFILLED_WIDGETS) {
        assert.equal(ids.includes(widget), true, `missing ${widget}`);
    }
    assert.equal(ids.includes("installment_day_1_p1"), false);
});

test("columns follow the PDF headers and land on the widget printed beneath each", () => {
    // Date | Payment Amount | Net Funds Provided | Receivables Purchased
    assert.deepEqual(
        TIBERIAN_FLEX_INSTALLMENT_COLUMNS.map((c) => c.title),
        ["Date", "Payment Amount", "Net Funds Provided", "Receivables Purchased"],
    );
    const rows = buildTiberianFlexAddendumContractPrefillFields({
        paymentDates: ["10/05/2026"],
        paymentAmounts: ["8000"],
        netFundsProvided: ["8100"],
        receivablesPurchased: ["8200"],
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    // x=188 is under "Payment Amount", x=323 under "Net Funds Provided".
    assert.equal(byId.get("net_funds_provided_1")?.value, "8000");
    assert.equal(byId.get("net_funds_provided_1")?.label, "Installment 1 — Payment Amount");
    assert.equal(byId.get("payment_amount_1")?.value, "8100");
    assert.equal(byId.get("payment_amount_1")?.label, "Installment 1 — Net Funds Provided");
    assert.equal(byId.get("receivables_purchased_1")?.value, "8200");
});

let failed = 0;
for (const [name, fn] of tests) {
    try {
        fn();
        console.log(`  ok  ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  FAIL  ${name}`);
        console.error(err);
    }
}
console.log(failed ? `\n${failed} failing` : `\n${tests.length} passing`);
if (failed) process.exit(1);
