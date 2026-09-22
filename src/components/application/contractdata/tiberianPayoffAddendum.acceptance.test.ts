/**
 * Tiberian Funding PayOff Addendum acceptance tests.
 *
 * Verified against the live SignNow template
 * 1a242e0fb07c41d08fd0f3d25662d61a86642a36 ("PAYOFF ADDENDUM TIBERIAN
 * FUNDING.docx", document fc25ba656e7b458fa4859f0c9cd2981ca720d806). The widget
 * list below is that template's real inventory, read off the API, not an
 * assumption. The Nitro / Obsidian copy (f43506d2…) carries two widgets this one
 * does not — the creditor label and the DBA half-line — so the two field maps
 * differ and these tests keep the Nitro copy's map untouched.
 *
 * Run: npx --yes tsx src/components/application/contractdata/tiberianPayoffAddendum.acceptance.test.ts
 */
import assert from "node:assert/strict";
import {
    isSignNowAddendumLayoutKey,
    isSignNowDisclosureLayoutKey,
    isTiberianPayoffAddendumRef,
    SIGNNOW_PAYOFF_ADDENDUM_TEMPLATE_ID,
    SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID,
} from "./signnowAddendumTemplates";
import {
    buildPayoffAddendumContractPrefillFields,
    buildTiberianPayoffAddendumContractPrefillFields,
} from "./PAYOFF_ADDENDUM";
import { getDocumentTemplatePrefillFieldRowsForEditor } from "./documentTemplateMappingPrefill";
import { mapFunderSignNowTemplates } from "@/utils/signnowTemplateLink";

/** Owner-filled text widgets on the live Tiberian PayOff Addendum. */
const TIBERIAN_PREFILLED_WIDGETS = [
    "addendum_p_addendum_dated_p1",
    "addendum_p_funder_and_business_namefull_p1",
    "addendum_p_pay_up_to_amount_p1",
    "net_to_merchant_p1",
    "addendum_p_print_name_p1 T",
    "signature_date_p1",
    "addendum_p_print_title_p1",
];

/** On the live template these are the signer / static glyph widgets — never prefilled. */
const TIBERIAN_NON_PREFILL_WIDGETS = ["Signature 1", "Text Field 5"];

/** Widgets the Nitro / Obsidian copy has and the Tiberian copy does not. */
const NITRO_ONLY_WIDGETS = [
    "addendum_p_agreement_to_label_name_p1",
    "addendum_p_funder_and_business_namehalf_p1",
];

const tests: Array<[string, () => void]> = [];
function test(name: string, fn: () => void) {
    tests.push([name, fn]);
}

test("Tiberian field map covers exactly the live template's owner widgets", () => {
    const ids = buildTiberianPayoffAddendumContractPrefillFields({}).map((f) => f.id);
    assert.deepEqual([...ids].sort(), [...TIBERIAN_PREFILLED_WIDGETS].sort());
    for (const widget of [...TIBERIAN_NON_PREFILL_WIDGETS, ...NITRO_ONLY_WIDGETS]) {
        assert.equal(ids.includes(widget), false, `${widget} must not be prefilled`);
    }
});

test("Nitro / Obsidian PayOff Addendum map is unchanged", () => {
    const ids = buildPayoffAddendumContractPrefillFields({}).map((f) => f.id);
    assert.deepEqual(ids, [
        "addendum_p_addendum_dated_p1",
        "addendum_p_funder_and_business_namefull_p1",
        "addendum_p_funder_and_business_namehalf_p1",
        "addendum_p_agreement_to_label_name_p1",
        "addendum_p_pay_up_to_amount_p1",
        "net_to_merchant_p1",
        "addendum_p_print_name_p1",
        "addendum_p_print_title_p1",
    ]);
});

test("values land on the Tiberian widget names, including the trailing-space print name", () => {
    const rows = buildTiberianPayoffAddendumContractPrefillFields({
        addendumDated: "09/22/2026",
        funderAndBusinessName: "ACME WIDGETS LLC",
        payUpToAmount: "12,500.00",
        netToMerchant: "48,500.00",
        printName: "JANE OWNER",
        printTitle: "OWNER",
        signatureDate: "09/22/2026",
    });
    const byId = new Map(rows.map((r) => [r.id, r.value]));
    assert.equal(byId.get("addendum_p_print_name_p1 T"), "JANE OWNER");
    assert.equal(byId.get("addendum_p_pay_up_to_amount_p1"), "12,500.00");
    assert.equal(byId.get("net_to_merchant_p1"), "48,500.00");
    assert.equal(byId.get("signature_date_p1"), "09/22/2026");
});

test("the template id alone is recognised as a payoff addendum, not a disclosure", () => {
    assert.equal(isTiberianPayoffAddendumRef(SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID), true);
    assert.equal(isTiberianPayoffAddendumRef(SIGNNOW_PAYOFF_ADDENDUM_TEMPLATE_ID), false);
    assert.equal(isSignNowAddendumLayoutKey(SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID), true);
    assert.equal(isSignNowDisclosureLayoutKey(SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID), false);
});

test("Settings → Funders keeps Tiberian's copy under its own SignNow id", () => {
    const options = mapFunderSignNowTemplates(
        [{ name: "Payoff Addendum", link: SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID }],
        "addendum",
    );
    assert.equal(options.length, 1);
    assert.equal(options[0].templateId, SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID);
    assert.equal(options[0].knownLayoutKey, "payoff_addendum");
});

test("the editor rows for Tiberian's mapping use the Tiberian widget names", () => {
    const rows = getDocumentTemplatePrefillFieldRowsForEditor({
        templateId: SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID,
        templateName: "Payoff Addendum",
        templateLayoutKey: SIGNNOW_TIBERIAN_PAYOFF_ADDENDUM_TEMPLATE_ID,
        documentType: "addendum",
        contract: {
            clientLegalName: "ACME WIDGETS LLC",
            clientName: "JANE OWNER",
            refinanceAmount: "12,500.00",
            netToMerchant: "48,500.00",
            funderName: "TIBERIAN FUNDING",
        },
        application: null,
    } as Parameters<typeof getDocumentTemplatePrefillFieldRowsForEditor>[0]);
    const ids = rows.map((r) => r.id);
    for (const widget of TIBERIAN_PREFILLED_WIDGETS) {
        assert.equal(ids.includes(widget), true, `missing ${widget}`);
    }
    for (const widget of NITRO_ONLY_WIDGETS) {
        assert.equal(ids.includes(widget), false, `${widget} is not on Tiberian's copy`);
    }
    const byId = new Map(rows.map((r) => [r.id, r.value]));
    assert.equal(byId.get("addendum_p_print_title_p1"), "OWNER");
    assert.ok(String(byId.get("addendum_p_addendum_dated_p1") || "").length > 0);
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
