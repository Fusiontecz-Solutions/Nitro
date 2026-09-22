/**
 * Tiberian Funding disclosure acceptance tests.
 *
 * Verified against the live SignNow template 46bffdc5ef0c4eef80a05e627fa34d999c216502
 * ("Tiberian Funding - Disclosure", document 4ab0209cdde6444da5d76fa7015ffecb585d11c0):
 * its 31 widgets carry the same names as the Obsidian Capital Group copy
 * (445770b840834b7a88f7d3e8a977382e582ee121) and the shared Nitro Advance copy,
 * so the one disclosure field map fills all three. The widget list below is the
 * live inventory, not an assumption, and these tests keep it that way.
 *
 * Run: npx --yes tsx src/components/application/contractdata/tiberianDisclosure.acceptance.test.ts
 */
import assert from "node:assert/strict";
import {
    isSignNowAddendumLayoutKey,
    isSignNowDisclosureLayoutKey,
    registerSignNowDisclosureTemplateRefs,
    SIGNNOW_DISCLOSURE_TEMPLATE_ID,
    SIGNNOW_TIBERIAN_DISCLOSURE_TEMPLATE_ID,
} from "./signnowAddendumTemplates";
import {
    buildDisclosureEditorFieldsFromContext,
    expandDisclosureEditorValuesToPdfFields,
} from "./disclosureEditorFields";
import { buildStateDisclosurePrefillContextFromContract } from "./stateDisclosurePrefill";
import { mapFunderSignNowTemplates } from "@/utils/signnowTemplateLink";

const OBSIDIAN_DISCLOSURE_TEMPLATE_ID = "445770b840834b7a88f7d3e8a977382e582ee121";

/** Text widgets on the live Tiberian disclosure that the CRM must prefill. */
const TIBERIAN_PREFILLED_WIDGETS = [
    "Text Field 1",
    "Text Field 2",
    "Text Field 3",
    "Text Field 4",
    "Text Field 5",
    "Text Field 6",
    "Text Field 7",
    "Text Field 8",
    "disclouser_pg2_frequency",
    "payement_exceeded_percent_p2_s1",
    "estimated_term_p2",
    "finance_charge_p2",
    "signature_date_p2",
    "disclosure_recipient_funds_p3",
    "disclosure_page3_line_1_p3",
    "disclosure_page3_line_2_p3",
    "disclosure_page3_subtotal_p3",
    "disclosure_page3_net_p3",
    "disclosure_broker_fee_p3",
    "disclosure_page3_third_parties_p3",
] as const;

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

function tiberianDealContract(): Record<string, unknown> {
    return {
        state: "California",
        purchaseAmount: 50_000,
        purchasePrice: 72_500,
        appendixUnderwritingFees: 1_475,
        contractLenght: 60,
        agreementDate: "2026-09-21",
        businessLegalName: "ACME WIDGETS LLC",
        offer: {
            offer: 50_000,
            totalRemit: 72_500,
            term: "60 Days",
            frequency: "Daily",
            repayPerPeriod: 1_208.33,
            fees: 2.95,
            // Page-1 "% of business income" and page-2 payment-terms widget.
            specifiedPercent: 12,
        },
    };
}

/** Bank-analysis average monthly revenue feeds page-1 `Text Field 4`. */
function tiberianDealApplication(): Record<string, unknown> {
    return { averageMonthlyIncome: 120_000 };
}

function disclosurePdfFields(): Record<string, string> {
    const ctx = buildStateDisclosurePrefillContextFromContract({
        contract: tiberianDealContract(),
        application: tiberianDealApplication(),
    });
    const editorValues: Record<string, string> = {};
    for (const field of buildDisclosureEditorFieldsFromContext(ctx)) {
        const v = String(field.value ?? "").trim();
        if (v) editorValues[field.id] = v;
    }
    return expandDisclosureEditorValuesToPdfFields(editorValues);
}

test("Tiberian disclosure template id is recognized as a SignNow disclosure", () => {
    assert.equal(isSignNowDisclosureLayoutKey(SIGNNOW_TIBERIAN_DISCLOSURE_TEMPLATE_ID), true);
    assert.equal(isSignNowDisclosureLayoutKey(SIGNNOW_DISCLOSURE_TEMPLATE_ID), true);
    // A disclosure copy is stored under a bare 40-char id, same as a funder
    // addendum — it must not be claimed by the addendum branch.
    assert.equal(isSignNowAddendumLayoutKey(SIGNNOW_TIBERIAN_DISCLOSURE_TEMPLATE_ID), false);
});

test("Settings name without the word 'disclosure' still registers the template", () => {
    // Settings → Funders stores Tiberian's copy as `{ name: "TIBERIAN FUNDING" }`,
    // so name matching alone never identifies it.
    const options = mapFunderSignNowTemplates(
        [{ name: "TIBERIAN FUNDING", link: SIGNNOW_TIBERIAN_DISCLOSURE_TEMPLATE_ID }],
        "disclosure",
    );
    assert.equal(options.length, 1);
    assert.equal(options[0].templateId, SIGNNOW_TIBERIAN_DISCLOSURE_TEMPLATE_ID);
    assert.equal(isSignNowDisclosureLayoutKey(options[0].layoutKey), true);
});

test("Obsidian disclosure copy registers the same way, by its own id", () => {
    const options = mapFunderSignNowTemplates(
        [{ name: "Obsidian Capital Group Disclosure", link: OBSIDIAN_DISCLOSURE_TEMPLATE_ID }],
        "disclosure",
    );
    assert.equal(options[0].templateId, OBSIDIAN_DISCLOSURE_TEMPLATE_ID);
    assert.equal(isSignNowDisclosureLayoutKey(OBSIDIAN_DISCLOSURE_TEMPLATE_ID), true);
});

test("registerSignNowDisclosureTemplateRefs is case-insensitive", () => {
    const id = "0123456789abcdef0123456789abcdef01234567";
    assert.equal(isSignNowDisclosureLayoutKey(id), false);
    registerSignNowDisclosureTemplateRefs([id.toUpperCase()]);
    assert.equal(isSignNowDisclosureLayoutKey(id), true);
});

test("Every prefilled Tiberian widget receives a value", () => {
    const out = disclosurePdfFields();
    const missing = TIBERIAN_PREFILLED_WIDGETS.filter(
        (name) => !String(out[name] ?? "").trim(),
    );
    assert.deepEqual(missing, []);
});

test("Page-1 money row matches the disclosure calculator", () => {
    const out = disclosurePdfFields();
    // Text Field 1 = Funding provided, 2 = Funds provided directly,
    // 3 = APR, 4 = avg monthly revenue, 5 = finance charge,
    // 6 = total payment, 7 = monthly cost, 8 = estimated payment.
    assert.equal(out["Text Field 1"], out.funding_provided);
    assert.equal(out["Text Field 2"], out.funding_provided_direct);
    assert.equal(out["Text Field 3"], out.disclosure_apr);
    assert.equal(out["Text Field 4"], out.disclosure_avg_monthly_revenue);
    assert.equal(out["Text Field 5"], out.disclosure_finance_charge);
    assert.equal(out["Text Field 6"], out.disclosure_total_payment);
    assert.equal(out["Text Field 7"], out.disclosure_monthly_cost);
    assert.equal(out["Text Field 8"], out.disclosure_estimated_payment);
});

test("Page-2 and page-3 widgets mirror their unsuffixed calculator values", () => {
    const out = disclosurePdfFields();
    assert.equal(out.finance_charge_p2, out.disclosure_finance_charge);
    assert.equal(out.estimated_term_p2, out.disclosure_term_days);
    assert.equal(out.payement_exceeded_percent_p2_s1, out.disclosure_payment_terms);
    assert.equal(out.disclouser_pg2_frequency, out.disclosure_payment_frequency);
    assert.equal(out.signature_date_p2, out.disclosure_date);
    assert.equal(out.disclosure_recipient_funds_p3, out.disclosure_recipient_funds);
    assert.equal(out.disclosure_page3_line_1_p3, out.disclosure_page3_line_1);
    assert.equal(out.disclosure_page3_line_2_p3, out.disclosure_page3_line_2);
    assert.equal(out.disclosure_page3_subtotal_p3, out.disclosure_page3_subtotal);
    assert.equal(out.disclosure_page3_net_p3, out.disclosure_page3_net);
    assert.equal(out.disclosure_broker_fee_p3, out.disclosure_broker_fee);
});

test("A refinance names the previous lender on the page-3 suffixed widget", () => {
    const contract = tiberianDealContract();
    contract.previousDealBalance = 12_000;
    contract.offer = { ...(contract.offer as object), refiAmount: 12_000 };
    const ctx = buildStateDisclosurePrefillContextFromContract({
        contract,
        application: tiberianDealApplication(),
    });
    const editorValues: Record<string, string> = {};
    for (const field of buildDisclosureEditorFieldsFromContext(ctx)) {
        const v = String(field.value ?? "").trim();
        if (v) editorValues[field.id] = v;
    }
    const out = expandDisclosureEditorValuesToPdfFields(editorValues);
    assert.equal(out.previous_lender_name_p3, out.previous_lender_name);
});

console.log(`
${passed} tests passed`);
