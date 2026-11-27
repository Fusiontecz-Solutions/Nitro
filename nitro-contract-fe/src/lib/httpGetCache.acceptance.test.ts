/**
 * A GET that started before a save must never be cached or shared after it.
 * Regression: the 4s status poll's contract read finished after the save had
 * cleared the cache, wrote the PRE-save contract back for 90s, and Review then
 * sent SignNow the old values.
 * Run: npx --yes tsx src/lib/httpGetCache.acceptance.test.ts
 */
import assert from "node:assert/strict";
import {
    getInFlightGet,
    httpGetCacheEpoch,
    invalidateHttpGetCacheByUrl,
    setInFlightGet,
    clearInFlightGet,
} from "./httpGetCache";

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

test("a save bumps the epoch, so a read started before it is not cached", () => {
    const startedAt = httpGetCacheEpoch();
    invalidateHttpGetCacheByUrl("/contract/update_contract/7");
    assert.notEqual(httpGetCacheEpoch(), startedAt);
});

test("a save forgets in-flight reads, so a later read never joins a pre-save one", () => {
    const pending = new Promise<never>(() => undefined);
    setInFlightGet("get:/contract/get_contract_by_application/x?", pending as never);
    assert.ok(getInFlightGet("get:/contract/get_contract_by_application/x?"));
    invalidateHttpGetCacheByUrl("/contract/update_contract/7");
    assert.equal(getInFlightGet("get:/contract/get_contract_by_application/x?"), undefined);
});

test("an old read finishing does not remove a newer in-flight read for the same URL", () => {
    const key = "get:/contract/get_contract_by_id/7?";
    const older = Promise.resolve() as never;
    const newer = new Promise<never>(() => undefined) as never;
    setInFlightGet(key, newer);
    clearInFlightGet(key, older);
    assert.equal(getInFlightGet(key), newer);
    clearInFlightGet(key, newer);
    assert.equal(getInFlightGet(key), undefined);
});

console.log(`\n${passed} tests passed`);
