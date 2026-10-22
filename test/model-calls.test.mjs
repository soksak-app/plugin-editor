// Conformance of the call-limit model: each case of calls.json is replayed on a fake clock (node:test mock.timers). A request
// step sends a call, an advance step moves the clock, and a reply step delivers a reply from the peer. Each step compares the
// messages sent, the reports, and the settled outcome of the watched request with the case.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCalls } from "./models/calls.mjs";

const contract = JSON.parse(readFileSync(new URL("./fixtures/contract/calls.json", import.meta.url), "utf8"));
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

for (const testCase of contract.cases) {
  test(testCase.id, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
    const sent = [];
    const reports = [];
    const outcomes = new Map();
    const calls = createCalls({ plugin: "probe", send: (message) => sent.push(message), report: (event) => reports.push(event) });
    for (const step of testCase.steps) {
      const mark = { sent: sent.length, reports: reports.length };
      if (step.request) {
        const pending = calls.request(step.request.command, step.request.params, step.request.timeout);
        outcomes.set(step.watch, null);
        pending.then((resolved) => outcomes.set(step.watch, { resolved }), (error) => outcomes.set(step.watch, { rejected: error.message, code: error.code }));
      } else if (step.advance !== undefined) {
        t.mock.timers.tick(step.advance);
      } else if (step.reply) {
        calls.reply(step.reply.id, step.reply.error === undefined ? { result: step.reply.result } : { error: step.reply.error });
      } else {
        throw new Error(`the replay has no step for ${JSON.stringify(step)}`);
      }
      await settle();
      const actual = { sent: sent.slice(mark.sent), reports: reports.slice(mark.reports), outcome: outcomes.get(step.watch) ?? null };
      assert.deepEqual(actual, step.output, `${testCase.id}: ${JSON.stringify(step)}`);
    }
  });
}

test("the call-limit conformance covers every case of the contract", () => {
  assert.equal(contract.cases.length, 4);
});
