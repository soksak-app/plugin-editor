// Conformance of the resolveContributions model: each case of contributions.json is replayed, and the output of the model
// equals the items of the case in order.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveContributions } from "./models/contributions.mjs";

const contract = JSON.parse(readFileSync(new URL("./fixtures/contract/contributions.json", import.meta.url), "utf8"));

for (const testCase of contract.cases) {
  test(testCase.id, () => {
    assert.deepEqual(resolveContributions(testCase.installed), testCase.output);
  });
}

test("the contributions conformance covers every case of the contract", () => {
  assert.equal(contract.cases.length, 8);
});
