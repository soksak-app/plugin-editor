// Conformance of the view wire model: each case of view-wire.json is replayed step by step in a fresh window, and each step
// compares the messages the page posts, the listener deliveries, and the error text with the case.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWindow } from "./dom.mjs";
import { installViewWire } from "./models/view-wire.mjs";

const contract = JSON.parse(readFileSync(new URL("./fixtures/contract/view-wire.json", import.meta.url), "utf8"));

/** Replays one case and returns the observed output of each step. */
function replay(testCase) {
  let window = null;
  const posted = [];
  const delivered = [];
  const outputs = [];
  const handler = { postMessage: (message) => posted.push(message) };
  for (const step of testCase.steps) {
    const mark = posted.length;
    const deliveredMark = delivered.length;
    let throws = null;
    if (step.load) {
      ({ window } = createWindow(`soksak://${step.load.host}/`));
      window.webkit = { messageHandlers: { "sok-view": handler } };
      installViewWire(window, { host: step.load.host, document: step.load.document });
    } else if (step.attach) {
      const listener = step.attach.listener === "record" ? (data) => delivered.push(data) : 42;
      try {
        window.sokView.attach(listener);
      } catch (error) {
        throws = error.message;
      }
    } else if (step.message) {
      for (let i = 0; i < (step.repeat ?? 1); i += 1) {
        window.dispatchEvent(new window.MessageEvent("message", {
          source: step.message.source === "window" ? window : null,
          data: step.message.data,
        }));
      }
    } else {
      throw new Error(`the replay has no step for ${JSON.stringify(step)}`);
    }
    const seen = { posted: posted.slice(mark), throws };
    if (step.output.deliveredCount !== undefined) seen.deliveredCount = delivered.length - deliveredMark;
    else seen.delivered = delivered.slice(deliveredMark);
    outputs.push(seen);
  }
  return outputs;
}

for (const testCase of contract.cases) {
  test(testCase.id, () => {
    const actual = replay(testCase);
    testCase.steps.forEach((step, index) => {
      assert.deepEqual(actual[index], step.output, `${testCase.id} step ${index + 1}`);
    });
  });
}

test("the wire conformance covers every case of the contract", () => {
  assert.equal(contract.cases.length, 8);
});
