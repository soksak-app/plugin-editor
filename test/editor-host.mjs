// Shared editor consumer host: declared commands, statuses and tab reports over a supplied files port.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { window } from "./dom.mjs";
import { fakeFiles } from "./fakes.mjs";
import { createBinder } from "./models/binder.mjs";

const { mount } = await import("../build/test/ui/editor.js");
const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const declared = (kind, name) => manifest.exposes[kind].some((entry) => entry.name === name);

export async function setup(t, { path = "src/main.js", params = { path }, files = new Map([["src/main.js", "let a = 1;\n// TODO: b\n"]]), contributions = {}, scheme = "dark", log = [], stored = null,
  diagnostics = null, scopeSurface = null, filesPort = null, projectRoot = "/project", place = () => { throw new Error("the test runs no core command"); } } = {}) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const commands = new Map();
  const statuses = new Map();
  const subscriptions = new Map();
  const reports = { modified: [], error: [], title: [], commands: [], state: [], keep: [] };
  const logs = log;
  const binder = createBinder((name, params) => commands.get(name)(params), {
    check(name) { assert.ok(declared("commands", name), `undeclared command ${name}`); },
  });
  const sidecar = filesPort ?? fakeFiles(files);
  const controller = await mount(root, {
    surfaceId: "editor-1",
    project: { root: projectRoot },
    tab: { params, title: (text) => reports.title.push(text), footer() {}, directory() {}, notify() {},
      modified: (value) => reports.modified.push(value), error: (text) => reports.error.push(text),
      state: { read: async () => stored, write: (value) => reports.state.push(value) }, keep: (reason, on) => reports.keep.push([reason, on]) },
    runtime: { sidecar: () => sidecar,
      command: async (name, commandParams) => { reports.commands.push([name, commandParams]); return place(name, commandParams); },
      log: Object.fromEntries(["error", "warn", "info", "debug", "trace"].map((level) => [level, (event, fields) => {
        const values = typeof fields === "function" ? fields() : fields;
        logs.push({ level, event, fields: scopeSurface === null ? values : { ...values, surface: scopeSurface } });
      }])),
      theme: (fn) => ({ ready: Promise.resolve(fn({ scheme, tokens: {} })), dispose: Promise.resolve(() => {}) }) },
    // default: a test without contributions connects none to either point.
    contributions: (point) => contributions[point] ?? [],
    diagnostics,
    exposure: {
      status(name, read, subscribe) {
        assert.ok(declared("status", name), `undeclared status ${name}`);
        statuses.set(name, read);
        subscriptions.set(name, subscribe);
      },
      command(name, run) {
        assert.ok(declared("commands", name) || ((name === "editor.memory.hidden" || name === "editor.diagnostics.content-trace") && diagnostics),
          `undeclared command ${name}`);
        commands.set(name, run);
      },
      element(name) { assert.ok(declared("element", name), `undeclared element ${name}`); },
      bind: binder.bind, delegate: binder.delegate, dispose: binder.dispose,
    },
  });
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await controller.dispose();
    host.remove();
  };
  t.after(dispose);
  const run = (name, params = {}) => commands.get(name)(params);
  const status = (name) => statuses.get(name)();
  const watchStatus = (name, listener) => subscriptions.get(name)(listener);
  return { root, run, status, watchStatus, reports, sidecar, files, binder, controller, logs, dispose };
}
