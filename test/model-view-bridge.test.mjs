// Conformance of the view bridge model: the cases of view-bridge.json, view-native.json and view-commands.json are replayed
// step by step over the view wire model. A case the model does not cover is listed by name as a skipped test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createWindow, useWindow } from "./dom.mjs";
import { installViewWire } from "./models/view-wire.mjs";
import { createViewBridge } from "./models/view-bridge.mjs";

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/contract/${name}`, import.meta.url), "utf8"));
const UNCOVERED = {
  "view.bridge.runtime-log-without-level-query": "the view page writes runtime.log as a plain call, and the model has no runtime.log",
};
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The window of a view page of the plugin probe, with the sok-view handler that records each posted message. */
function page(url = "soksak://probe/") {
  const { window } = createWindow(url);
  const posted = [];
  window.webkit = { messageHandlers: { "sok-view": { postMessage: (message) => posted.push(message) } } };
  useWindow(window);
  return { window, posted };
}

/** Dispatches one host message to the window as the host posts it. */
const dispatch = (window, data) => window.dispatchEvent(new window.MessageEvent("message", { source: window, origin: "", data }));

/** Replays one step of a view-bridge case, or a native or command step; returns the observed output. */
async function step(context, item) {
  const { window, posted, delivered, state } = context;
  const mark = posted.length;
  const deliveredMark = delivered.length;
  let result = null;
  let throws = null;
  let promise = null;
  const replyTo = (id, body) => dispatch(window, { sok: 1, id, ...body });
  const lastId = () => posted.at(-1).id;
  if (item.action === "create") {
    const url = item.input?.url ?? "soksak://probe/";
    const created = page(url);
    Object.assign(context, { window: created.window, posted: created.posted, state: { ...state, plugin: null } });
    try {
      installViewWire(created.window, { host: "probe" });
      context.bridge = createViewBridge({ handler: created.window.webkit.messageHandlers["sok-view"], report: (event) => context.reports.push(event) });
      context.state.plugin = context.bridge.plugin;
    } catch (error) {
      throws = error.message;
    }
    if (throws !== null) return { throws };
    return { ready: created.posted.some((message) => message.event === "view.ready"), plugin: context.bridge.plugin };
  }
  const bridge = context.bridge;
  if (item.action === "request") {
    promise = bridge.calls.request(item.input.command, item.input.params);
    context.last = promise;
    await settle();
    return posted.slice(mark)[0];
  }
  if (item.action === "host-reply") {
    const body = item.input.error !== undefined ? { error: item.input.error } : { result: item.input.result };
    replyTo(item.input.id, body);
    await settle();
    if (item.output === undefined) return undefined;
    return context.last ? await context.last : null;
  }
  if (item.action === "host-malformed") {
    dispatch(window, item.input);
    await settle();
    return posted.slice(mark)[0];
  }
  if (item.action === "sidecar-send") {
    context.last = bridge.runtime.sidecar(item.input.sidecar).send(item.input.id, item.input.body, item.input.cids);
    await settle();
    return posted.slice(mark)[0];
  }
  if (item.action === "sidecar-subscribe") {
    const sidecar = bridge.runtime.sidecar(item.input.sidecar);
    const fn = item.input.kind === "message" ? (body) => context.messages.push(body) : (reason) => context.failures.push(reason);
    context.last = item.input.kind === "message" ? sidecar.on(item.input.id, fn) : sidecar.onFailure(item.input.id, fn);
    await settle();
    return posted.slice(mark)[0];
  }
  if (item.action === "host-event") {
    dispatch(window, { sok: 1, event: item.input.event, data: item.input.data });
    await settle();
    if (item.input.event === "sidecar.message" || item.input.event === "sidecar.failure") {
      return { messages: [...context.messages], failures: [...context.failures] };
    }
    return delivered.at(-1);
  }
  if (item.action === "subscribe") {
    bridge.runtime.theme((data) => delivered.push(data));
    return undefined;
  }
  if (item.on) {
    const listener = item.on.listener;
    const pending = bridge.runtime.native.on(item.on.name, (data) => context.natives.push({ listener, data }));
    if (item.answer) {
      replyTo(lastId(), item.answer);
    }
    try {
      const remove = await pending;
      context.removers.set(listener, remove);
      result = typeof remove === "function" ? "function" : remove;
    } catch (error) {
      throws = error.message;
    }
    await settle();
    return { posted: posted.slice(mark), delivered: context.natives.splice(0), result, throws };
  }
  if (item.off) {
    context.removers.get(item.off)();
    return { posted: [], delivered: [], result: null, throws: null };
  }
  if (item.event) {
    dispatch(window, { sok: 1, event: item.event.event, data: item.event.data });
    await settle();
    return { posted: posted.slice(mark), delivered: context.natives.splice(0), result: null, throws: null };
  }
  if (item.register) {
    const run = { echo: (params) => params, fail: () => { throw new Error("save failed"); }, none: () => undefined, text: "text",
      context: (params, context) => context }[item.register.run];
    const pending = bridge.commands.register(item.register.name, run);
    if (item.answer) replyTo(lastId(), item.answer);
    try {
      await pending;
    } catch (error) {
      throws = error.message;
    }
    await settle();
    return { posted: posted.slice(mark), delivered: [], result: null, throws };
  }
  if (item.request) {
    dispatch(window, { sok: 1, id: item.request.id, command: item.request.command, params: item.request.params,
      ...(item.request.cids === undefined ? {} : { cids: item.request.cids }) });
    await settle();
    return { posted: posted.slice(mark), delivered: [], result: null, throws: null };
  }
  if (item.exposureRegister) {
    const pending = bridge.exposure.register(item.exposureRegister.kind, item.exposureRegister.name);
    if (item.answer) replyTo(lastId(), item.answer);
    try {
      await pending;
    } catch (error) {
      throws = error.message;
    }
    await settle();
    return { posted: posted.slice(mark), delivered: [], result: null, throws };
  }
  if (item.exposureReply) {
    const pending = bridge.exposure.reply(item.exposureReply.id, item.exposureReply.payload);
    if (item.answer) replyTo(lastId(), item.answer);
    await pending;
    await settle();
    return { posted: posted.slice(mark), delivered: [], result: null, throws: null };
  }
  throw new Error(`the replay has no step for ${JSON.stringify(item)}`);
}

/** Replays one case; a case without a create step starts on the page that the case names. */
async function replay(testCase) {
  const context = { posted: [], delivered: [], messages: [], failures: [], natives: [], removers: new Map(), reports: [], state: {} };
  if (testCase.steps[0].action !== "create") {
    const created = page();
    Object.assign(context, { window: created.window, posted: created.posted });
    installViewWire(created.window, { host: "probe" });
    context.bridge = createViewBridge({ handler: created.window.webkit.messageHandlers["sok-view"], report: (event) => context.reports.push(event) });
    created.posted.length = 0;
  }
  const outputs = [];
  for (const item of testCase.steps) {
    outputs.push(await step(context, item));
  }
  return outputs;
}

const cases = [...load("view-bridge.json").cases, ...load("view-native.json").cases, ...load("view-commands.json").cases];
/** The steps whose case output is the message that the page posts, compared whole. */
const MESSAGE_ACTIONS = new Set(["request", "host-malformed", "sidecar-send", "sidecar-subscribe"]);

/** The fields of actual that expected names, so that a step compares the fields that its case states. */
function pick(actual, expected) {
  return Object.fromEntries(Object.keys(expected).map((key) => [key, actual[key]]));
}

for (const testCase of cases) {
  if (UNCOVERED[testCase.id]) {
    test(testCase.id, { skip: `not covered by the view bridge model: ${UNCOVERED[testCase.id]}` }, () => {});
    continue;
  }
  test(testCase.id, async () => {
    const actual = await replay(testCase);
    testCase.steps.forEach((item, index) => {
      const label = `${testCase.id} step ${index + 1}`;
      const expected = item.output;
      if (expected === undefined) return;
      const seen = actual[index];
      if (MESSAGE_ACTIONS.has(item.action) || expected === null || typeof expected !== "object" || Array.isArray(expected)) {
        assert.deepEqual(seen, expected, label);
        return;
      }
      assert.deepEqual(pick(seen, expected), expected, label);
    });
  });
}

test("the bridge conformance covers every case of its contracts but the listed one", () => {
  assert.equal(cases.length, 15);
  assert.equal(Object.keys(UNCOVERED).length, 1);
});

// F238-c-13.4: a sidecar call names its sidecar, and the bridge refuses a call that names none (core
// docs/spec/native-surfaces.md#view-surfaces, view calls: runtime.sidecar.send carries {id, sidecar, body, cids}).
test("runtime.sidecar() refuses a call without a sidecar name", () => {
  const created = page();
  installViewWire(created.window, { host: "probe" });
  const bridge = createViewBridge({ handler: created.window.webkit.messageHandlers["sok-view"] });
  assert.throws(() => bridge.runtime.sidecar(), /sidecar name/);
  assert.deepEqual(created.posted.filter((message) => String(message.command).startsWith("runtime.sidecar")), []);
});

// The page's calls keep the time limit of core calls.json: a call without a host reply is rejected at its limit.
test("a page call without a host reply is rejected at its limit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const created = page();
  installViewWire(created.window, { host: "probe" });
  const bridge = createViewBridge({ handler: created.window.webkit.messageHandlers["sok-view"] });
  let failure = null;
  bridge.calls.request("demo.open", {}).catch((error) => { failure = error; });
  const microtasks = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
  t.mock.timers.tick(9999);
  await microtasks();
  assert.equal(failure, null, "the call is open before its limit");
  t.mock.timers.tick(1);
  await microtasks();
  assert.equal(failure?.message, "command demo.open did not reply within 10000ms");
  assert.equal(failure?.code, -32000);
});
