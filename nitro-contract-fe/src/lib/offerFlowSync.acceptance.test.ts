/**
 * Offer → Overview → Prefill amount precedence acceptance tests.
 * Run: npx --yes tsx src/lib/offerFlowSync.acceptance.test.ts
 */
import assert from "node:assert/strict";
import { getApplicationApprovedAmount } from "./applicationOfferAmount";
import { resolveApplicationOfferAmount } from "./applicationLoanAmount";
import type { Application } from "@/types/applicationTypes";

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

test("OfferDecision wins over stale TermsOffer in list amount helper", () => {
  const app = {
    OfferDecision: { decision: "approved", offer: 55000 },
    termsOffers: [{ approvedAmount: 40000 }],
  } as unknown as Application;
  assert.equal(getApplicationApprovedAmount(app), 55000);
});

test("resolveApplicationOfferAmount matches list helper precedence", () => {
  const od = { decision: "approved", offer: 72000 };
  const terms = { approvedAmount: 50000 };
  assert.equal(resolveApplicationOfferAmount(od, terms), 72000);
  assert.equal(
    getApplicationApprovedAmount({
      OfferDecision: od,
      termsOffers: [terms],
    } as unknown as Application),
    72000,
  );
});

test("Declined OfferDecision falls back to TermsOffer", () => {
  const app = {
    OfferDecision: { decision: "declined", offer: 55000 },
    termsOffers: [{ approvedAmount: 40000 }],
  } as unknown as Application;
  assert.equal(getApplicationApprovedAmount(app), 40000);
  assert.equal(
    resolveApplicationOfferAmount(app.OfferDecision, app.termsOffers[0]),
    40000,
  );
});

test("Missing OfferDecision uses TermsOffer", () => {
  const app = {
    termsOffers: [{ approvedAmount: 33000 }],
  } as unknown as Application;
  assert.equal(getApplicationApprovedAmount(app), 33000);
});

if (!process.exitCode) {
  console.log(`\n${passed} tests passed`);
}
