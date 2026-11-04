// Conformance of the resolveContributions model: each case of contributions.json is replayed, and the output of the model
// equals the items of the case in order.
import assert from "node:assert/strict";
import test from "node:test";
import { resolveContributions } from "./models/contributions.mjs";
import { casesOf } from "./sdk-cases.mjs";

const cases = casesOf("resolveContributions");

for (const testCase of cases) {
  test(testCase.id, () => {
    assert.deepEqual(resolveContributions(testCase.installed), testCase.output);
  });
}

test("the contributions conformance covers every case of the contract", () => {
  assert.equal(cases.length, 8);
});
