// Conformance of the call model: each case of calls.json is replayed against test/models/calls.mjs. A request step sends a
// call (signal true gives it an abort signal), a reply step delivers a reply from the peer, a cancel step aborts the signal of
// the named request, and a peer-lost step ends the peer. Each step compares the messages sent, the reports, and the outcome of
// the watched request with the case. No step moves a clock: the clock of the model is fixed at 0, so the start of a call and
// the delay of a late reply are 0, and each step finds that the model started no timer. A step whose case states a settled
// outcome awaits the settlement of the watched call, the event that the step asserts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCalls } from "./models/calls.mjs";

const contract = JSON.parse(readFileSync(new URL("./fixtures/contract/calls.json", import.meta.url), "utf8"));

for (const testCase of contract.cases) {
  test(testCase.id, async (t) => {
    const timers = t.mock.method(globalThis, "setTimeout");
    const sent = [];
    const reports = [];
    const settlements = new Map();
    const settled = new Map();
    const signals = new Map();
    const calls = createCalls({ plugin: "probe", now: () => 0, send: (message) => sent.push(message), report: (event) => reports.push(event) });
    for (const step of testCase.steps) {
      const mark = { sent: sent.length, reports: reports.length };
      if (step.request) {
        const { name, command, params, signal } = step.request;
        const options = {};
        if (signal) {
          const controller = new AbortController();
          signals.set(name, controller);
          options.signal = controller.signal;
        }
        settlements.set(name, calls.request(command, params, options).then(
          (resolved) => settled.set(name, { resolved }),
          (error) => settled.set(name, { rejected: error.message, code: error.code ?? null })));
      } else if (step.reply) {
        calls.reply(step.reply.id, step.reply.error === undefined ? { result: step.reply.result } : { error: step.reply.error });
      } else if (step.cancel !== undefined) {
        signals.get(step.cancel).abort();
      } else if (step.peerLost !== undefined) {
        calls.peerLost(step.peerLost);
      } else {
        throw new Error(`the replay has no step for ${JSON.stringify(step)}`);
      }
      assert.equal(timers.mock.callCount(), 0, `${testCase.id}: the call model started a timer at ${JSON.stringify(step)}`);
      if (step.output.outcome !== null) await settlements.get(step.watch);
      const actual = { sent: sent.slice(mark.sent), reports: reports.slice(mark.reports), outcome: settled.get(step.watch) ?? null };
      assert.deepEqual(actual, step.output, `${testCase.id}: ${JSON.stringify(step)}`);
    }
  });
}

test("the call conformance covers every case of the contract", () => {
  assert.deepEqual(contract.cases.map((entry) => entry.id), [
    "calls.end.reply-resolves-the-call",
    "calls.end.error-reply-rejects-with-its-code",
    "calls.end.cancel-ends-the-call-and-a-later-reply-is-late",
    "calls.end.peer-end-rejects-each-open-call",
  ]);
});
