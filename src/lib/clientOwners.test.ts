/**
 * Owner contact isolation.
 * Run: npx --yes tsx src/lib/clientOwners.test.ts
 */
import assert from "node:assert/strict";
import { cloneOwnerDetail, mapOwnerContactFromClientRow } from "./clientOwners";

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

test("owner 2 does not inherit owner 1 phone/SSN/address from flat client fields", () => {
    const client = {
        ownerMobileNumber: "8284766423",
        ownerPhone: "8284766423",
        ownerSsn: "239-41-5047",
        ownerAddress1: "3205 COVE CREEK RD",
        ownerCity: "WAYNESVILLE",
        ownerState: "NC",
        ownerZipCode: "28785",
    };
    const owner2 = mapOwnerContactFromClientRow(
        { firstName: "PIYUSHKUMAR V", lastName: "PATEL", email: "subs@transparencyadvance.com" },
        client,
        1,
    );
    const owner1 = mapOwnerContactFromClientRow(
        { mobileNumber: "8284766423", ssn: "239-41-5047" },
        client,
        0,
    );
    assert.equal(owner1.mobileNumber, "8284766423");
    assert.equal(owner1.ssn, "239-41-5047");
    assert.equal(owner2.mobileNumber, "");
    assert.equal(owner2.ssn, "");
    assert.equal(owner2.address.address1, "");
    assert.equal(owner2.address.zipCode, "");
});

test("owner 2 keeps its own phone/SSN when present", () => {
    const contact = mapOwnerContactFromClientRow(
        {
            mobileNumber: "2222222222",
            ssn: "222-22-2222",
            address: { address1: "9 Oak St", zipCode: "78701" },
        },
        { ownerMobileNumber: "1111111111", ownerSsn: "111-11-1111" },
        1,
    );
    assert.equal(contact.mobileNumber, "2222222222");
    assert.equal(contact.ssn, "222-22-2222");
    assert.equal(contact.address.address1, "9 Oak St");
});

test("cloneOwnerDetail does not share nested address between owners", () => {
    const first = {
        firstName: "MARY",
        middleName: "",
        lastName: "IRVIN",
        email: "mary@example.com",
        mobileNumber: "111",
        dateOfBirth: "",
        ssn: "111-11-1111",
        ficoScore: "",
        ownershipStartDate: "",
        ownershipPercentage: "",
        address: { address1: "3205 COVE CREEK RD", address2: "", city: "WAYNESVILLE", state: "NC", zipCode: "28785" },
    };
    const cloned = cloneOwnerDetail(first);
    cloned.address.address1 = "9 OAK ST";
    assert.equal(first.address.address1, "3205 COVE CREEK RD");
});

if (process.exitCode) {
    console.error(`\n${passed} passed, failures above`);
} else {
    console.log(`\n${passed} passed`);
}
