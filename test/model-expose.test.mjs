// Conformance of the exposure model: each case of expose.json is replayed step by step against the model, and each step
// compares its registrations, replies, effects, result and error with the case.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWindow } from "./dom.mjs";
import { createExpose } from "./models/expose.mjs";

const contract = JSON.parse(readFileSync(new URL("./fixtures/contract/expose.json", import.meta.url), "utf8"));

/** Replays one case and returns the observed output of each step, in the shape of the case. */
async function replay(testCase) {
  const { window } = createWindow("https://fixture.test/");
  const { document } = window;
  const registered = [];
  const replies = [];
  const effects = [];
  let answer = null;
  let changed = null;
  let current = testCase.initial ?? null;
  const port = {
    register: async (kind, name) => { registered.push({ kind, name }); },
    onRequest: (fn) => { answer = fn; },
    reply: (id, payload) => { replies.push({ id, payload }); },
    report: () => {},
  };
  const exposure = createExpose(port, () => testCase.declarations ?? {});
  let markup = null;
  const outputs = [];
  for (const step of testCase.steps) {
    registered.length = 0;
    replies.length = 0;
    effects.length = 0;
    let result = null;
    let throws = null;
    try {
      if (step.status) {
        result = await exposure.status(step.status.name, () => current, (notify) => { changed = notify; });
      } else if (step.set !== undefined) {
        current = step.set;
        changed();
      } else if (step.request) {
        answer(step.request);
      } else if (step.dom) {
        if (markup === null) {
          markup = document.createElement("div");
          markup.innerHTML = testCase.markup;
          document.body.append(markup);
          for (const [id, box] of Object.entries(testCase.rects ?? {})) {
            const element = markup.querySelector(`#${id}`);
            element.getBoundingClientRect = () => ({ left: box.left, top: box.top, width: box.width, height: box.height,
              right: box.left + box.width, bottom: box.top + box.height });
            element.addEventListener("click", () => effects.push(`click ${id}`));
          }
        }
        result = await exposure.dom(step.dom.name, markup.querySelector(step.dom.selector));
      } else {
        throw new Error(`the replay has no step for ${JSON.stringify(step)}`);
      }
    } catch (error) {
      throws = error.message;
    }
    outputs.push({ registered: [...registered], replies: [...replies], effects: [...effects], result, throws });
  }
  return outputs;
}

for (const testCase of contract.cases) {
  test(testCase.id, async () => {
    const actual = await replay(testCase);
    testCase.steps.forEach((step, index) => {
      assert.deepEqual(actual[index], step.output, `${testCase.id} step ${index + 1}`);
    });
  });
}

test("the exposure conformance covers every case of the contract", () => {
  assert.equal(contract.cases.length, 3);
});
