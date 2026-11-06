// Conformance of the exposure model: each case of expose.json is replayed step by step against the model, and each step
// compares its registrations, replies, effects, result and error with the case.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createWindow } from "./dom.mjs";
import { roleOf } from "./models/binder.mjs";
import { createExpose } from "./models/expose.mjs";
import { casesOf } from "./sdk-cases.mjs";

const cases = casesOf("createExpose");

/** Replays one case and returns the observed output of each step, in the shape of the case. */
async function replay(testCase) {
  const { window } = createWindow("https://fixture.test/");
  const { document } = window;
  const registered = [];
  const replies = [];
  const changes = [];
  const effects = [];
  let answer = null;
  let notify = null;
  let current = testCase.initial ?? null;
  const port = {
    register: async (kind, name) => { registered.push({ kind, name }); },
    unregister: async () => { registered.push({ kind: "unregister" }); },
    onRequest: (fn) => { answer = fn; },
    reply: (id, payload) => { replies.push({ id, payload }); },
    changed: (name, value, version) => { changes.push({ name, value, version }); },
    report: () => {},
  };
  const exposure = createExpose(port, () => testCase.declarations ?? {});
  let markup = null;
  const ensureMarkup = () => {
    if (markup !== null) return;
    markup = document.createElement("div");
    markup.innerHTML = testCase.markup;
    document.body.append(markup);
    for (const element of markup.querySelectorAll("[id]")) {
      element.addEventListener("click", () => effects.push(`click ${element.id}`));
    }
    for (const [id, box] of Object.entries(testCase.rects ?? {})) {
      markup.querySelector(`#${id}`).getBoundingClientRect = () => ({ left: box.left, top: box.top, width: box.width, height: box.height,
        right: box.left + box.width, bottom: box.top + box.height });
    }
  };
  const outputs = [];
  for (const step of testCase.steps) {
    registered.length = 0;
    replies.length = 0;
    changes.length = 0;
    effects.length = 0;
    let result = null;
    let throws = null;
    try {
      if (step.status) {
        result = await exposure.status(step.status.name, () => current, (fn) => { notify = fn; });
      } else if (step.dispose) {
        result = await exposure.dispose();
      } else if (step.command) {
        result = await exposure.command(step.command.name, (params) => {
          effects.push(`run ${step.command.name} ${JSON.stringify(params)}`);
        });
      } else if (step.bind) {
        ensureMarkup();
        // paramsFromValue binds a function that reads the value of the element at each run.
        const params = step.bind.paramsFromValue ? (event) => ({ value: event.currentTarget.value }) : step.bind.params;
        result = (await exposure.bind(markup.querySelector(step.bind.selector), step.bind.command, params)) ?? null;
      } else if (step.inspect) {
        // inspect reads the bound element and changes nothing.
        ensureMarkup();
        markup.querySelector(step.inspect.selector);
      } else if (step.click) {
        ensureMarkup();
        const target = markup.querySelector(step.click.selector);
        if (step.click.value !== undefined) target.value = step.click.value;
        target.click();
      } else if (step.race) {
        const pending = exposure.status(step.race.name, () => current, () => {});
        await exposure.dispose();
        try {
          await pending;
        } catch (error) {
          throws = error.message;
        }
      } else if (step.set !== undefined) {
        current = step.set;
        notify(current);
      } else if (step.request) {
        answer(step.request);
      } else if (step.element) {
        ensureMarkup();
        result = await exposure.element(step.element.name, markup.querySelector(step.element.selector));
      } else {
        throw new Error(`the replay has no step for ${JSON.stringify(step)}`);
      }
    } catch (error) {
      throws = error.message;
    }
    outputs.push({ registered: [...registered], replies: [...replies], changed: [...changes], effects: [...effects], result, throws });
  }
  return outputs;
}

for (const testCase of cases) {
  test(testCase.id, async () => {
    const actual = await replay(testCase);
    testCase.steps.forEach((step, index) => {
      assert.deepEqual(actual[index], step.output, `${testCase.id} step ${index + 1}`);
    });
  });
}

test("the exposure conformance covers every case of the contract", () => {
  assert.equal(cases.length, 8);
});

// element.rect reports the ARIA role of the element by the rule of core's roleOf (expose.json): the first token of the role
// attribute, else the implicit role of the tag, and null for a group and for an element that only holds text.
test("the role of element.rect follows the role attribute and the tag, and a group or a plain element has none (E53)", () => {
  const { document } = new JSDOM("<div role='tab selected'></div><button></button><div></div><div role='group'><input></div>"
    + "<ul><li></li></ul><a href='#'></a><a></a><h2></h2><span contenteditable></span>").window;
  const roles = [...document.body.querySelectorAll("*")].map((element) => roleOf(element));
  assert.deepEqual(roles, ["tab", "button", null, null, "textbox", "list", "listitem", "link", null, "heading", "textbox"]);
});
