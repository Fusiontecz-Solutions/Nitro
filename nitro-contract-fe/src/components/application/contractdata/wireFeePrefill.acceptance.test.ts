/**
 * "$25 wire fee" (includeWireFee) acceptance tests — Refi and non-Refi.
 * Run: npx --yes tsx src/components/application/contractdata/wireFeePrefill.acceptance.test.ts
 *
 * Regression: unchecking "Include $25 wire fee" and correcting Recipient funds was
 * silently reverted. The live-OfferDecision overlay recomputed net from a contract copy
 * with `contractPrefillOverrides` stripped, so it never saw `includeWireFee`, always
 * re-added $25, and the resulting $25 gap made the saved value look "stale" — so it was
 * deleted and overwritten on every reload and contract build.
 */
import assert from "node:assert/strict";
import {
    applyLiveOfferSyncToPrefillPartial,
    buildContractPrefillFieldsFromApplication,
    computeNetToMerchantDollars,
    contractPrefillFieldsToPartial,
    stripStaleOfferOverridesFromPersisted,
    type BuildContractPrefillFieldsArgs,
} from "./Contract";
import { calculateRefinanceDealMetrics } from "./refinanceDealCalculations";

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

/** Refi deal: $50,000 advance, $2,000 fees, $10,000 refinance. */
const OFFER: Record<string, unknown> = {
    offer: 50000,
    totalRemit: 70000,
    fees: 2000,
    rate: 1.4,
    refinanceAmount: 10000,
    frequency: "Daily",
    repayPerPeriod: 500,
    term: 140,
};

const APPLICATION: Record<string, unknown> = {
    uuid: "app-refi-1",
    customerName: "Refi Merchant LLC",
    offerDecision: OFFER,
};

/** net with wire fee = 50000 − (2000 + 25) − 10000; without = 25 more. */
const NET_WITH_WIRE = 37975;
const NET_WITHOUT_WIRE = 38000;

function contractRow(overrides: Record<string, unknown>): Record<string, unknown> {
    return {
        id: 7,
        customerName: "Refi Merchant LLC",
        legalName: "Refi Merchant LLC",
        offer: OFFER,
        approvedAmount: 50000,
        totalAmount: 70000,
        appendixUnderwritingFees: "2000.00",
        contractPrefillOverrides: overrides,
    };
}

/** Overlay output is sometimes grouped ("38,000.00"), sometimes raw — compare as money. */
const money = (v: unknown) => String(v ?? "").replace(/,/g, "");

const fieldValue = (fields: Array<{ id: string; value: string }>, id: string) =>
    fields.find((f) => f.id === id)?.value ?? "";

test("Refi: net excludes the $25 wire fee when includeWireFee is false", () => {
    const withFee = computeNetToMerchantDollars({
        application: APPLICATION,
        offerDecision: OFFER,
        prefill: { includeWireFee: "true" },
    });
    const withoutFee = computeNetToMerchantDollars({
        application: APPLICATION,
        offerDecision: OFFER,
        prefill: { includeWireFee: "false" },
    });
    assert.equal(withFee, NET_WITH_WIRE);
    assert.equal(withoutFee, NET_WITHOUT_WIRE);
});

test("Refi: live-offer sync keeps the corrected net instead of re-adding $25", () => {
    const saved: Partial<BuildContractPrefillFieldsArgs> = {
        purchaseAmount: "50000.00",
        purchasePrice: "70000.00",
        refinanceAmount: "10000.00",
        appendixUnderwritingFees: "2000.00",
        includeWireFee: "false",
        netToMerchant: "38000.00",
    };
    const synced = applyLiveOfferSyncToPrefillPartial(saved, APPLICATION, OFFER, {
        contract: contractRow({ ...saved, _manualNetToMerchant: true }),
    });
    assert.equal(money(synced.netToMerchant), "38000.00");
});

test("Refi: a saved net without the wire fee is not treated as stale money", () => {
    const saved: Partial<BuildContractPrefillFieldsArgs> = {
        purchaseAmount: "50000.00",
        purchasePrice: "70000.00",
        refinanceAmount: "10000.00",
        appendixUnderwritingFees: "2000.00",
        includeWireFee: "false",
        netToMerchant: "38000.00",
    };
    const kept = stripStaleOfferOverridesFromPersisted(
        saved,
        OFFER,
        APPLICATION,
        contractRow(saved as Record<string, unknown>),
    );
    assert.equal(kept.netToMerchant, "38000.00", "saved recipient funds must survive reload");
    assert.equal(kept.includeWireFee, "false");
});

test("Refi: generated contract has no $25 wire fee in origination or net", () => {
    const saved: Record<string, unknown> = {
        purchaseAmount: "50000.00",
        purchasePrice: "70000.00",
        refinanceAmount: "10000.00",
        appendixUnderwritingFees: "2000.00",
        includeWireFee: "false",
        netToMerchant: "38000.00",
        _manualNetToMerchant: true,
    };
    const fields = buildContractPrefillFieldsFromApplication(APPLICATION, {
        contractRecords: { contract: contractRow(saved) },
        overrides: saved as Partial<BuildContractPrefillFieldsArgs>,
        offerDecision: OFFER,
    });
    assert.equal(fieldValue(fields, "net_to_merchant"), "38,000.00");
    assert.equal(
        fieldValue(fields, "underwriter_fee"),
        "2,000.00",
        "origination must be the applicable fee only, with no $25 added",
    );
});

test("Non-Refi / default: the $25 wire fee is still included when left checked", () => {
    const saved: Record<string, unknown> = {
        purchaseAmount: "50000.00",
        purchasePrice: "70000.00",
        refinanceAmount: "10000.00",
        appendixUnderwritingFees: "2000.00",
        includeWireFee: "true",
        netToMerchant: "37975.00",
        _manualNetToMerchant: true,
    };
    const fields = buildContractPrefillFieldsFromApplication(APPLICATION, {
        contractRecords: { contract: contractRow(saved) },
        overrides: saved as Partial<BuildContractPrefillFieldsArgs>,
        offerDecision: OFFER,
    });
    assert.equal(fieldValue(fields, "net_to_merchant"), "37,975.00");
    assert.equal(
        fieldValue(fields, "underwriter_fee"),
        "2,025.00",
        "origination = applicable fee + $25 wire fee when the box stays checked",
    );
});

test("Default (no includeWireFee saved) still behaves as fee-on", () => {
    const net = computeNetToMerchantDollars({
        application: APPLICATION,
        offerDecision: OFFER,
        contract: contractRow({ appendixUnderwritingFees: "2000.00" }),
    });
    assert.equal(net, NET_WITH_WIRE);
});

/**
 * Send path: ContractTab re-syncs money onto the payload built from the modal.
 * `prefillFields` carries document ids only, so the partial never has
 * `includeWireFee` — the preference has to be passed explicitly.
 */
test("Send path: an explicit wire-fee preference survives a stale contract row", () => {
    // The row ContractTab held before Verify Prefill was saved: no includeWireFee.
    const staleContract = contractRow({ appendixUnderwritingFees: "2000.00" });
    const fromModal: Partial<BuildContractPrefillFieldsArgs> = {
        purchaseAmount: "50000.00",
        purchasePrice: "70000.00",
        refinanceAmount: "10000.00",
        appendixUnderwritingFees: "2000.00",
        netToMerchant: "38000.00",
    };
    const withoutPreference = applyLiveOfferSyncToPrefillPartial(
        fromModal,
        APPLICATION,
        OFFER,
        { contract: staleContract },
    );
    assert.equal(
        money(withoutPreference.netToMerchant),
        "37975.00",
        "regression guard: with no preference the overlay re-adds the $25",
    );

    const withPreference = applyLiveOfferSyncToPrefillPartial(fromModal, APPLICATION, OFFER, {
        contract: staleContract,
        includeWireFee: "false",
    });
    assert.equal(
        money(withPreference.netToMerchant),
        "38000.00",
        "the live preference must win over the stale contract row",
    );
});

test("Send path: a refreshed contract row alone is enough to drop the $25", () => {
    const freshContract = contractRow({
        appendixUnderwritingFees: "2000.00",
        includeWireFee: "false",
        netToMerchant: "38000.00",
        _manualNetToMerchant: true,
    });
    const synced = applyLiveOfferSyncToPrefillPartial(
        { netToMerchant: "38000.00", appendixUnderwritingFees: "2000.00" },
        APPLICATION,
        OFFER,
        { contract: freshContract },
    );
    assert.equal(money(synced.netToMerchant), "38000.00");
});

test("Send path: wire fee left on still re-adds the $25", () => {
    const synced = applyLiveOfferSyncToPrefillPartial(
        { netToMerchant: "37975.00", appendixUnderwritingFees: "2000.00" },
        APPLICATION,
        OFFER,
        { contract: contractRow({ appendixUnderwritingFees: "2000.00" }), includeWireFee: "true" },
    );
    assert.equal(money(synced.netToMerchant), "37975.00");
});

/**
 * ContractTab converts the document payload back to a partial before persisting it.
 * With the box unchecked the origination field holds the applicable fee only, so
 * un-grossing it by $25 (the fee-on default) corrupted the saved fee on every send.
 */
test("Send path: round-tripping fields keeps the fee when the wire fee is off", () => {
    const off = contractPrefillFieldsToPartial(
        [
            { id: "underwriter_fee", value: "2,000.00" },
            { id: "net_to_merchant", value: "38,000.00" },
        ],
        { includeWireFee: "false" },
    );
    assert.equal(money(off.appendixUnderwritingFees), "2000.00");
    assert.equal(off.includeWireFee, "false");

    const on = contractPrefillFieldsToPartial([{ id: "underwriter_fee", value: "2,025.00" }], {
        includeWireFee: "true",
    });
    assert.equal(money(on.appendixUnderwritingFees), "2000.00");
});

test("Send path: round trip with no preference still assumes the fee is on", () => {
    const partial = contractPrefillFieldsToPartial([
        { id: "underwriter_fee", value: "2,025.00" },
    ]);
    assert.equal(money(partial.appendixUnderwritingFees), "2000.00");
    assert.equal(partial.includeWireFee, undefined);
});

/**
 * REFI money layer (calculateRefinanceDealMetrics) never received the box, so it
 * always added the $25. Numbers from a reported deal: $10,000 advance, $1,000 fee,
 * $4,500 refinance — printed TOTAL FEES 1,025.00 / NET 4,475.00 with the box unticked.
 */
test("REFI metrics: unticked box adds no $25 (10,000 / 1,000 fee / 4,500 refi)", () => {
    const base = {
        paymentFrequency: "Daily",
        contractAmount: 10000,
        originationFee: 1000,
        factorRate: 1.5,
        previousRefiBalance: 4500,
        numberOfPayments: 8,
    };
    const off = calculateRefinanceDealMetrics({ ...base, includeWireFee: false });
    assert.equal(off.originationFee, 1000);
    assert.equal(off.netContractedFunding, 9000);
    assert.equal(off.actualDisbursement, 4500);

    const on = calculateRefinanceDealMetrics({ ...base, includeWireFee: true });
    assert.equal(on.originationFee, 1025);
    assert.equal(on.actualDisbursement, 4475);
});

console.log(`\n${passed} tests passed`);
