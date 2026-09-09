/**
 * Multi-owner signer auto-create.
 * Run: npx --yes tsx src/components/application/contractdata/contractSignerOwnersSync.test.ts
 */
import assert from "node:assert/strict";
import {
    buildContractSignerRowsFromOwnerParties,
    ensureSignerRowsFromCrmOwners,
    reconcileSignerRowsWithFreshOwners,
} from "./contractSignerRows";
import {
    collapseDocuSignRolesToSignerSlots,
    resolveActiveOwnerCount,
    resolveSecondOwnerSignerName,
} from "./contractPartyCounts";
import { buildDocuSignRolesFromEditorRows } from "./templateRecipients";

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

test("two CRM owners become Signer + Owner 2 without Manage Signers", () => {
    const rows = buildContractSignerRowsFromOwnerParties([
        { ownerFirstName: "Craig", ownerLastName: "Linderr", ownerEmail: "craig@example.com" },
        { ownerFirstName: "Jordan", ownerLastName: "Second", ownerEmail: "jordan@example.com" },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.email, "craig@example.com");
    assert.equal(rows[1]?.email, "jordan@example.com");
    assert.match(String(rows[1]?.role || ""), /owner\s*2/i);
});

test("saved single signer is padded with live Owner 2", () => {
    const ensured = ensureSignerRowsFromCrmOwners(
        [{ role: "Signer", name: "Craig Linderr", email: "craig@example.com" }],
        [
            { ownerFirstName: "Craig", ownerLastName: "Linderr", ownerEmail: "craig@example.com" },
            { ownerFirstName: "Jordan", ownerLastName: "Second", ownerEmail: "jordan@example.com" },
        ],
    );
    assert.equal(ensured.length, 2);
    assert.equal(ensured[1]?.email, "jordan@example.com");
    assert.equal(ensured[1]?.name, "Jordan Second");
});

test("live owner 2 name/email wins over a stale saved blank slot", () => {
    const reconciled = reconcileSignerRowsWithFreshOwners(
        [
            { role: "Signer", name: "Craig", email: "craig@example.com" },
            { role: "Owner 2", name: "", email: "" },
        ],
        [
            { role: "Signer", name: "Craig Linderr", email: "craig@example.com" },
            { role: "Owner 2", name: "Jordan Second", email: "jordan@example.com" },
        ],
    );
    assert.equal(reconciled[1]?.email, "jordan@example.com");
    assert.equal(reconciled[1]?.name, "Jordan Second");
});

test("two application owners keep ownerCount=2 even with one saved invite", () => {
    const count = resolveActiveOwnerCount({
        owners: [
            { firstName: "Craig", lastName: "Linderr", email: "craig@example.com" },
            { firstName: "Jordan", lastName: "Second", email: "jordan@example.com" },
        ],
        signerRoles: [{ signerRole: "Signer", signerEmail: "craig@example.com" }],
    });
    assert.equal(count, 2);
});

test("collapse injects Owner 2 from CRM when roles only have signer 1", () => {
    const roles = buildDocuSignRolesFromEditorRows([
        { role: "Signer", name: "Craig Linderr", email: "craig@example.com" },
    ]);
    const collapsed = collapseDocuSignRolesToSignerSlots(roles, 2, [
        { firstName: "Craig", lastName: "Linderr", email: "craig@example.com" },
        { firstName: "Jordan", lastName: "Second", email: "jordan@example.com" },
    ]);
    assert.equal(collapsed.length, 2);
    assert.equal(collapsed[1]?.signerEmail, "jordan@example.com");
    assert.equal(collapsed[1]?.signerRole, "Owner 2");
});

test("second owner name falls back to CRM owner 2 for Signer 2 fields", () => {
    const name = resolveSecondOwnerSignerName(
        buildDocuSignRolesFromEditorRows([
            { role: "Signer", name: "Craig Linderr", email: "craig@example.com" },
        ]),
        2,
        [
            { firstName: "Craig", lastName: "Linderr", email: "craig@example.com" },
            { firstName: "Jordan", lastName: "Second", email: "jordan@example.com" },
        ],
    );
    assert.equal(name, "Jordan Second");
});

test("same-email owners still create two named slots (invite needs distinct email)", () => {
    const rows = ensureSignerRowsFromCrmOwners(null, [
        { ownerFirstName: "Craig", ownerLastName: "One", ownerEmail: "shared@example.com" },
        { ownerFirstName: "Jordan", ownerLastName: "Two", ownerEmail: "shared@example.com" },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.name, "Craig One");
    assert.equal(rows[1]?.name, "Jordan Two");
});

if (process.exitCode) {
    console.error(`\n${passed} passed, failures above`);
} else {
    console.log(`\n${passed} passed`);
}
