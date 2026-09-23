/**
 * Acceptance tests for sharing a funder's SignNow addendum / disclosure
 * templates with another funder.
 *
 * The server owns the write (POST /integration-settings/funders/:id/share-templates
 * and its jest suite in the backend repo). These helpers mirror the server's
 * identity and merge rules so the share dialog can preview a share accurately:
 *  - the same SignNow template id counts as one template whatever link form it
 *    was pasted in, so "already has this one" is never a false negative;
 *  - a template the target already holds is never counted as an addition.
 *
 * Run: npx --yes tsx src/pages/settings/funderTemplateSharing.acceptance.test.ts
 */
import assert from "node:assert/strict";

import {
  funderTemplateField,
  funderTemplateIdentity,
  funderTemplatesForKind,
  mergeFunderTemplates,
} from "./funderTemplateSharing";
import type { FunderProfile } from "@/types/integrationSettingsTypes";

const PAYOFF_ID = "3aa4e0ff1ab04ef2b1ba6de3a4d5f3b0c2f1a8d7";
const EXHIBIT_C_ID = "9f2b1c0d4e5a6b7c8d9e0f1a2b3c4d5e6f708192";

function funder(partial: Partial<FunderProfile> & { id: string; name: string }): FunderProfile {
  return {
    assignsDealId: false,
    mainContractLayoutKey: "contract",
    allowedStates: [],
    excludedStates: [],
    sortOrder: 0,
    isActive: true,
    ...partial,
  } as FunderProfile;
}

function run(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    throw err;
  }
}

console.log("Funder template sharing");

run("identity keys off the SignNow template id, not the link wrapper", () => {
  const pasted = {
    name: "PayOff Addendum",
    link: `https://app.signnow.com/webapp/document/${PAYOFF_ID}?route=fieldinvite`,
  };
  const bareId = { name: "Payoff", link: PAYOFF_ID.toUpperCase() };
  assert.equal(funderTemplateIdentity(pasted), `signnow:${PAYOFF_ID}`);
  assert.equal(funderTemplateIdentity(bareId), `signnow:${PAYOFF_ID}`);
});

run("merge appends new templates and keeps the target's existing rows", () => {
  const result = mergeFunderTemplates(
    [{ name: "Exhibit C", link: EXHIBIT_C_ID }],
    [{ name: "PayOff Addendum", link: PAYOFF_ID }],
  );
  assert.deepEqual(result.merged, [
    { name: "Exhibit C", link: EXHIBIT_C_ID },
    { name: "PayOff Addendum", link: PAYOFF_ID },
  ]);
  assert.equal(result.added.length, 1);
  assert.equal(result.skipped.length, 0);
});

run("merge is idempotent for a template the target already has", () => {
  const existing = [{ name: "Payoff (theirs)", link: PAYOFF_ID }];
  const result = mergeFunderTemplates(existing, [
    {
      name: "PayOff Addendum",
      link: `https://app.signnow.com/webapp/document/${PAYOFF_ID}`,
    },
  ]);
  assert.deepEqual(result.merged, existing, "the target's own name must survive");
  assert.equal(result.added.length, 0);
  assert.equal(result.skipped.length, 1);
});

run("merge drops duplicates inside the shared selection itself", () => {
  const result = mergeFunderTemplates([], [
    { name: "PayOff Addendum", link: PAYOFF_ID },
    { name: "Payoff copy", link: `https://app.signnow.com/webapp/document/${PAYOFF_ID}` },
  ]);
  assert.equal(result.merged.length, 1);
  assert.equal(result.added.length, 1);
  assert.equal(result.skipped.length, 1);
});

run("merge ignores blank rows", () => {
  const result = mergeFunderTemplates([], [{ name: "  ", link: "  " }]);
  assert.deepEqual(result.merged, []);
  assert.equal(result.added.length, 0);
});

run("each kind reads and writes its own profile field", () => {
  assert.equal(funderTemplateField("addendum"), "signnowAddendumTemplates");
  assert.equal(funderTemplateField("disclosure"), "signnowDisclosureTemplates");

  const profile = funder({
    id: "a",
    name: "Obsidian Capital Group",
    signnowAddendumTemplates: [{ name: "PayOff Addendum", link: PAYOFF_ID }],
  });
  assert.deepEqual(funderTemplatesForKind(profile, "addendum"), [
    { name: "PayOff Addendum", link: PAYOFF_ID },
  ]);
  assert.deepEqual(funderTemplatesForKind(profile, "disclosure"), []);
});

run("the dialog's per-funder preview counts only what is missing", () => {
  const target = funder({
    id: "t",
    name: "Nitro Advance",
    signnowAddendumTemplates: [{ name: "Payoff", link: PAYOFF_ID }],
  });
  const selected = [
    { name: "PayOff Addendum", link: `https://app.signnow.com/webapp/document/${PAYOFF_ID}` },
    { name: "Exhibit C", link: EXHIBIT_C_ID },
  ];
  const { added } = mergeFunderTemplates(
    funderTemplatesForKind(target, "addendum"),
    selected,
  );
  assert.equal(added.length, 1, "only Exhibit C is new for this funder");
  assert.equal(added[0].name, "Exhibit C");
});

console.log("All funder template sharing tests passed.");
