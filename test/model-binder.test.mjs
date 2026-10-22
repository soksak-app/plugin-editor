// Conformance of the binder model: each copied case of create-binder.json that the model covers is replayed step by
// step, and each case it does not cover is listed by name as a skipped test with its reason.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWindow } from "./dom.mjs";
import { createBinder } from "./models/binder.mjs";

const contract = JSON.parse(readFileSync(new URL("./fixtures/contract/create-binder.json", import.meta.url), "utf8"));
const DECLARED = new Set(["fixture.save", "fixture.set"]);

const COVERED = new Set([
  "binder.bind.runs-declared-command",
  "binder.bind.refuses-undeclared-command",
  "binder.bind.reports-failed-run",
  "binder.bind.keydown-when-selects-events",
  "binder.bind.reports-failed-keydown-run",
  "binder.bind.function-params-are-read-at-each-run",
  "binder.delegate.dispatches-declared-controls",
  "binder.run.runs-and-refuses",
  "binder.audit.reports-unbound-controls",
]);
const UNCOVERED = {};

/** The attributes of a control that the case observes. */
function observe(element) {
  const seen = {};
  if (element.hasAttribute("data-command")) seen.command = element.getAttribute("data-command");
  if (element.hasAttribute("data-params")) seen.params = element.getAttribute("data-params");
  if (element.hasAttribute("data-value")) seen.value = element.getAttribute("data-value");
  if (element.hasAttribute("data-live")) seen.live = "";
  return seen;
}

/** Replays the steps of one case and returns the observed output of each step. */
async function replay(testCase) {
  const { window } = createWindow("https://fixture.test/");
  const { document } = window;
  const elements = new Map();
  const calls = [];
  const failed = [];
  let changed = 0;
  const idOf = (element) => [...elements].find(([, value]) => value === element)?.[0] ?? null;
  const binder = createBinder((name, params, element) => {
    calls.push({ name, params, element: idOf(element) });
    if (params?.fail) throw new Error("command failed");
    return "accepted";
  }, {
    check: (name) => { if (!DECLARED.has(name)) throw new Error(`command ${name} is not declared`); },
    notify: () => { changed += 1; },
  });
  const outputs = [];
  for (const step of testCase.steps) {
    changed = 0;
    let result = null;
    let error = null;
    let element = null;
    let attempted = null;
    try {
      if (step.bind) {
        const control = document.createElement(step.bind.tag);
        attempted = control;
        elements.set(step.bind.id, control);
        // paramsFromValue binds a function that reads the value of the control at each run.
        const params = step.bind.paramsFromValue ? (event) => ({ value: event.currentTarget.value }) : step.bind.params;
        await binder.bind(control, step.bind.command, params, {
          event: step.bind.event, when: step.bind.when ?? null, failed: (message) => failed.push(message),
        });
        element = observe(control);
      } else if (step.event) {
        const control = elements.get(step.event.id);
        if (step.event.value !== undefined) control.value = step.event.value;
        const init = { bubbles: true };
        const event = step.event.key === undefined
          ? new window.Event(step.event.type, init)
          : new window.KeyboardEvent(step.event.type, { ...init, key: step.event.key });
        control.dispatchEvent(event);
        element = observe(control);
      } else if (step.element || step.mark) {
        const spec = step.element ?? step.mark;
        const control = document.createElement(spec.tag);
        elements.set(spec.id, control);
        if (spec.expose !== undefined) control.setAttribute("data-expose", spec.expose);
        if (spec.text !== undefined) control.textContent = spec.text;
        if (spec.command !== undefined) control.setAttribute("data-command", spec.command);
        if (spec.params !== undefined) control.setAttribute("data-params", JSON.stringify(spec.params));
        if (spec.valueName !== undefined) control.setAttribute("data-value", spec.valueName);
        if (spec.live) control.setAttribute("data-live", "");
        if (spec.parent !== undefined) elements.get(spec.parent).append(control);
        element = observe(control);
      } else if (step.delegate) {
        await binder.delegate(elements.get(step.delegate.id));
      } else if (step.dispose) {
        await binder.dispose();
      } else if (step.audit) {
        result = binder.audit(elements.get(step.audit.id));
      } else if (step.run) {
        result = await binder.run(step.run.command, step.run.params);
      } else {
        throw new Error(`the replay has no step for ${JSON.stringify(step)}`);
      }
    } catch (caught) {
      error = caught.message;
      if (attempted) element = observe(attempted);
    }
    outputs.push({ calls: calls.map((call) => ({ ...call })), changed, failed: [...failed], result, error, element });
  }
  return outputs;
}

for (const testCase of contract.cases) {
  if (UNCOVERED[testCase.id]) {
    test(testCase.id, { skip: `not covered by the binder model: ${UNCOVERED[testCase.id]}` }, () => {});
    continue;
  }
  assert.ok(COVERED.has(testCase.id), `${testCase.id} is neither covered nor listed as uncovered`);
  test(testCase.id, async () => {
    const actual = await replay(testCase);
    testCase.steps.forEach((step, index) => {
      const expected = step.output;
      const seen = actual[index];
      assert.deepEqual(
        { calls: seen.calls, changed: seen.changed, failed: seen.failed, result: seen.result, error: seen.error, element: seen.element },
        { calls: expected.calls, changed: expected.changed, failed: expected.failed, result: expected.result, error: expected.error, element: expected.element },
        `${testCase.id} step ${index + 1}`);
    });
  });
}

// The audit rows of the operable elements (core interactive contract): each case marks up a root and lists its rows.
const interactive = JSON.parse(readFileSync(new URL("./fixtures/contract/interactive.json", import.meta.url), "utf8"));
for (const testCase of interactive.cases) {
  test(testCase.id, () => {
    const { window } = createWindow("https://fixture.test/");
    const root = window.document.createElement("div");
    root.innerHTML = testCase.markup;
    const rows = createBinder(() => undefined).audit(root);
    assert.deepEqual(rows, testCase.output);
  });
}

test("the binder conformance lists every case of the contract", () => {
  assert.equal(contract.cases.length, COVERED.size + Object.keys(UNCOVERED).length);
  assert.equal(interactive.cases.length, 2);
});
