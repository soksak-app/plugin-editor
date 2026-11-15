// The plugin API fixture of this repository (test/fixtures/plugin-api): the resolve hook maps the three specifiers that the pages import,
// and the fixture answers as the test arranges, records each call and refuses what is not arranged or declared.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { openSession } from "./fixtures/plugin-api/session.mjs";

const fixture = (name) => fileURLToPath(new URL(`./fixtures/plugin-api/${name}`, import.meta.url));
const declarations = () => ({ status: [{ name: "x.state" }], commands: [{ name: "x.run" }], element: [{ name: "x.button" }] });
const deps = () => ({ register: async () => {}, onRequest: () => {}, reply: () => {}, changed: () => {}, report: () => {} });

test("the resolve hook maps the plugin API specifiers to the fixture modules", async () => {
  for (const [specifier, file] of [["@soksak/plugin-api", "index.mjs"], ["@soksak/plugin-api/view", "view.mjs"],
    ["@soksak/plugin-api/diagnostic-view-frames", "diagnostic-view-frames.mjs"]]) {
    assert.equal(import.meta.resolve(specifier), new URL(`file://${fixture(file)}`).href, specifier);
  }
  assert.throws(() => import.meta.resolve("@soksak/plugin-api/other"), "a specifier outside the mapping resolves as usual and fails");
});

test("a call of the page without an open session is refused", async () => {
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  assert.throws(() => createViewBridge({ handler: { postMessage() {} }, report() {} }), /no plugin API session is open/);
});

test("calls.request answers as arranged, records the call and refuses an unarranged call", async (t) => {
  const session = openSession({ calls: { "tab.title": (params) => ({ echoed: params }) } });
  t.after(() => session.close());
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const bridge = createViewBridge({ handler: { postMessage() {} }, report() {} });
  assert.deepEqual(await bridge.calls.request("tab.title", "a"), { echoed: "a" });
  await assert.rejects(bridge.calls.request("tab.footer", "b"), /no answer is arranged for the call tab\.footer/);
  assert.deepEqual(session.requests, [{ command: "tab.title", params: "a" }, { command: "tab.footer", params: "b" }]);
});

test("a registered command runs when the test runs it, and an unregistered one is refused", async (t) => {
  const session = openSession();
  t.after(() => session.close());
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const bridge = createViewBridge({ handler: { postMessage() {} }, report() {} });
  await bridge.commands.register("x.run", (params) => ({ got: params }));
  assert.deepEqual(await session.run("x.run", { a: 1 }), { got: { a: 1 } });
  await assert.rejects(session.run("x.other"), /registered no command x\.other/);
});

test("the exposure runs the bound command on its event and reads a registered status", async (t) => {
  const session = openSession();
  t.after(() => session.close());
  const { createExpose } = await import("@soksak/plugin-api");
  const { window } = new JSDOM("<button></button>");
  const button = window.document.querySelector("button");
  const expose = createExpose(deps(), declarations);
  const runs = [];
  await expose.command("x.run", (params) => { runs.push(params); });
  await expose.status("x.state", () => ({ ok: true }), () => () => {});
  await expose.element("x.button", button);
  await expose.bind(button, "x.run", { fixed: 1 });
  button.dispatchEvent(new window.Event("click"));
  await session.settled();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runs, [{ fixed: 1 }]);
  assert.deepEqual(session.read("x.state"), { ok: true });
  assert.deepEqual(expose.audit(window.document.body), []);
  await assert.rejects(async () => expose.command("x.undeclared", () => {}), /exposure commands x\.undeclared is not declared/);
});

test("the sidecar is refused unless the plugin declares it, and a message reaches only a subscribed route", async (t) => {
  const session = openSession({ sidecars: ["s"], sidecar: { s: () => null } });
  t.after(() => session.close());
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const bridge = createViewBridge({ handler: { postMessage() {} }, report() {} });
  assert.throws(() => bridge.runtime.sidecar("other"), /declares no sidecar other/);
  const channel = bridge.runtime.sidecar("s");
  assert.throws(() => session.sidecarMessage("s", "surface", { body: {} }), /no subscription for it/);
  const received = [];
  const stop = await channel.on("surface", (body) => received.push(body));
  session.sidecarMessage("s", "surface", { body: { n: 1 } });
  stop();
  assert.deepEqual(received, [{ n: 1 }]);
  await channel.send("surface", { operation: "read" }, ["c1"]);
  assert.deepEqual(session.sidecarSends, [{ sidecar: "s", surface: "surface", body: { operation: "read" }, cids: ["c1"] }]);
});
