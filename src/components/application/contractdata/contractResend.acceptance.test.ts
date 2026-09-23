/**
 * "Resend New Contract" acceptance tests.
 * Run: npx --yes tsx src/components/application/contractdata/contractResend.acceptance.test.ts
 *
 * Resending archives the contract that is already out and clears every cached prefill value
 * so the replacement package is built from the current offer / application / owner details.
 * Two things must survive that reset: the prior send has to stay visible in Contracts
 * Generated, and it has to keep the terms it was actually sent under rather than adopting
 * the new ones.
 */
import assert from "node:assert/strict";
import {
    buildContractSendTableRows,
    hasEverSentMainContract,
} from "./contractSendHistory";

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

/** The contract row as the backend leaves it right after a resend reset. */
const CONTRACT_AFTER_RESEND: Record<string, unknown> = {
    id: 42,
    status: "DRAFT",
    funderName: "NITRO ADVANCE",
    // The Document row for the prior envelope is deleted on resend.
    application: { document: null },
    contractPrefillOverrides: {
        contractSendHistory: [
            {
                envelopeId: "grp-first-send",
                status: "sent",
                sentAt: "2026-09-22T12:01:00.000Z",
                archivedAt: "2026-09-22T15:00:00.000Z",
                termsSnapshot: {
                    approvedAmount: 50000,
                    paybackAmount: 75000,
                    paymentAmount: 5000,
                    buyRate: 1.5,
                    factorRate: 1.5,
                    position: "1",
                    term: "15",
                },
                package: { includeMainContract: true },
            },
        ],
        // Cached document values are gone — the new package re-derives them.
        includeWireFee: "false",
    },
};

test("the contract sent before the resend still appears in Contracts Generated", () => {
    const rows = buildContractSendTableRows(CONTRACT_AFTER_RESEND);
    const prior = rows.find((row) => row.envelopeId === "grp-first-send");
    assert.ok(prior, "prior send row is missing from the table");
    assert.equal(prior!.isCurrent, false);
    assert.equal(prior!.documentKind, "contract");
});

test("the archived row keeps the terms it was sent under, not the new ones", () => {
    const rows = buildContractSendTableRows(CONTRACT_AFTER_RESEND);
    const prior = rows.find((row) => row.envelopeId === "grp-first-send");
    assert.equal(prior!.termsSnapshot?.approvedAmount, 50000);
    assert.equal(prior!.termsSnapshot?.paybackAmount, 75000);
    assert.equal(prior!.termsSnapshot?.paymentAmount, 5000);
});

test("no current contract row exists until the replacement is sent", () => {
    const rows = buildContractSendTableRows(CONTRACT_AFTER_RESEND);
    assert.equal(
        rows.some((row) => row.isCurrent && row.documentKind === "contract"),
        false,
    );
});

test("both sends are listed once the replacement goes out", () => {
    const afterSecondSend: Record<string, unknown> = {
        ...CONTRACT_AFTER_RESEND,
        status: "SENT",
        application: {
            document: {
                envelopeId: "grp-second-send",
                status: "sent",
                sentAt: "2026-09-23T09:00:00.000Z",
            },
        },
        documents: [
            {
                envelopeId: "grp-second-send",
                status: "sent",
                sentAt: "2026-09-23T09:00:00.000Z",
            },
        ],
    };
    const rows = buildContractSendTableRows(afterSecondSend);
    const envelopeIds = rows.map((row) => row.envelopeId);
    assert.ok(
        envelopeIds.includes("grp-first-send"),
        `first send missing: ${envelopeIds.join(", ")}`,
    );
    assert.ok(
        envelopeIds.includes("grp-second-send"),
        `second send missing: ${envelopeIds.join(", ")}`,
    );
});

/** A deal resent twice: two archived sends, no current envelope, and a draft in progress. */
const CONTRACT_AFTER_SECOND_RESEND: Record<string, unknown> = {
    id: 42,
    status: "DRAFT",
    funderName: "TIBERIAN FUNDING",
    application: { document: null },
    contractPrefillOverrides: {
        contractSendHistory: [
            {
                envelopeId: "grp-first-send",
                status: "sent",
                sentAt: "2026-09-22T12:01:00.000Z",
                archivedAt: "2026-09-22T15:00:00.000Z",
                package: { includeMainContract: true },
            },
            {
                envelopeId: "grp-second-send",
                status: "sent",
                sentAt: "2026-09-23T06:59:00.000Z",
                archivedAt: "2026-09-23T11:30:00.000Z",
                package: { includeMainContract: true },
            },
        ],
    },
};

test("Resend stays available once the sent contract has been archived", () => {
    // The row reads "(prior send)" at this point — the button used to disappear with it.
    assert.equal(hasEverSentMainContract(CONTRACT_AFTER_RESEND), true);
});

test("Resend stays available after resending more than once", () => {
    assert.equal(hasEverSentMainContract(CONTRACT_AFTER_SECOND_RESEND), true);
    const rows = buildContractSendTableRows(CONTRACT_AFTER_SECOND_RESEND);
    const ids = rows.map((row) => row.envelopeId);
    assert.ok(ids.includes("grp-first-send"), `first send missing: ${ids.join(", ")}`);
    assert.ok(ids.includes("grp-second-send"), `second send missing: ${ids.join(", ")}`);
});

test("a deal that has never been sent does not offer Resend", () => {
    assert.equal(
        hasEverSentMainContract({
            id: 42,
            status: "DRAFT",
            application: { document: null },
            contractPrefillOverrides: {},
        }),
        false,
    );
});

console.log(`\n${passed} passed`);
