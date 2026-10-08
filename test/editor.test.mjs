import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { window } from "./dom.mjs";
import { createBinder } from "@soksak/plugin-api";

const { mount } = await import("../ui/editor.js");
const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const declared = (kind, name) => manifest.exposes[kind].some((entry) => entry.name === name);
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** A files sidecar of one surface over an in-memory file system: read, write with expect, and watch. */
function fakeFiles(files) {
  const listeners = new Set();
  const sent = [];
  const reply = (body) => queueMicrotask(() => { for (const fn of listeners) fn(body); });
  const port = {
    sent,
    on: async (surface, fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    onFailure: async () => () => {},
    async send(surface, body) {
      sent.push(body);
      if (body.operation === "watch") return reply({ id: body.id });
      if (body.operation === "read") {
        if (!files.has(body.path)) return reply({ id: body.id, error: `no such file: ${body.path}` });
        const text = files.get(body.path);
        const newline = /\r\n/.test(text) ? "crlf" : /\n/.test(text) ? "lf" : "none";
        return reply({ id: body.id, text, version: sha(text), newline, bom: false });
      }
      if (body.operation === "write") {
        if (sha(files.get(body.path)) !== body.expect) return reply({ id: body.id, error: `changed on disk: ${body.path}` });
        files.set(body.path, body.text);
        return reply({ id: body.id, version: sha(body.text) });
      }
      throw new Error(`unexpected operation ${body.operation}`);
    },
    change(path, text) {
      files.set(path, text);
      reply({ changed: path });
    },
  };
  return port;
}

async function setup(t, { path = "src/main.js", files = new Map([["src/main.js", "let a = 1;\n// TODO: b\n"]]), contributions = {} } = {}) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const commands = new Map();
  const statuses = new Map();
  const reports = { modified: [], error: [] };
  const binder = createBinder((name, params) => commands.get(name)(params), {
    check(name) { assert.ok(declared("commands", name), `undeclared command ${name}`); },
  });
  const sidecar = fakeFiles(files);
  const controller = await mount(root, {
    surfaceId: "editor-1",
    project: { root: "/project" },
    tab: { params: { path }, title() {}, footer() {}, directory() {}, notify() {},
      modified: (value) => reports.modified.push(value), error: (text) => reports.error.push(text) },
    runtime: { sidecar: () => sidecar },
    // default: a test without contributions connects none to either point.
    contributions: (point) => contributions[point] ?? [],
    exposure: {
      status(name, read) { assert.ok(declared("status", name), `undeclared status ${name}`); statuses.set(name, read); },
      command(name, run) { assert.ok(declared("commands", name), `undeclared command ${name}`); commands.set(name, run); },
      dom(name) { assert.ok(declared("dom", name), `undeclared dom ${name}`); },
      bind: binder.bind, delegate: binder.delegate, dispose: binder.dispose,
    },
    status: { report(phase) { assert.equal(phase, "ready"); } },
  });
  t.after(async () => { await controller.dispose(); host.remove(); });
  const run = (name, params = {}) => commands.get(name)(params);
  const status = (name) => statuses.get(name)();
  return { root, run, status, reports, sidecar, files, binder, controller };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the editor opens the file of its tab and watches it", async (t) => {
  const { run, status, sidecar } = await setup(t);
  assert.equal(run("editor.read"), "let a = 1;\n// TODO: b\n");
  const document = status("editor.document");
  assert.equal(document.path, "src/main.js");
  assert.equal(document.language, "javascript");
  assert.equal(document.newline, "lf");
  assert.equal(document.modified, false);
  assert.deepEqual(sidecar.sent.map((body) => body.operation), ["read", "watch"]);
  assert.deepEqual(sidecar.sent[1].paths, ["src/main.js"]);
});

test("an edit marks the tab modified and a save writes the text in place", async (t) => {
  const { run, status, reports, files } = await setup(t);
  run("editor.edit", { changes: [{ from: 8, to: 9, insert: "2" }] });
  assert.equal(status("editor.document").modified, true);
  assert.deepEqual(reports.modified, [false, true]);
  const { version } = await run("editor.save");
  assert.equal(files.get("src/main.js"), "let a = 2;\n// TODO: b\n");
  assert.equal(version, sha("let a = 2;\n// TODO: b\n"));
  assert.equal(status("editor.document").modified, false);
  assert.deepEqual(reports.modified, [false, true, false]);
  assert.deepEqual(reports.error, [null]);
});

test("a save after the file changed on disk fails, shows the tab error and keeps the changes", async (t) => {
  const { run, status, reports, sidecar } = await setup(t);
  run("editor.edit", { changes: [{ from: 0, to: 0, insert: "// head\n" }] });
  sidecar.change("src/main.js", "changed elsewhere\n");
  await settle();
  await settle();
  assert.equal(status("editor.document").disk, "changed");
  await assert.rejects(run("editor.save"), /changed on disk: src\/main.js/);
  assert.equal(reports.error.at(-1), "저장하지 못했습니다 · changed on disk: src/main.js");
  assert.equal(status("editor.document").modified, true);
  await run("editor.save", { overwrite: true });
  assert.equal(reports.error.at(-1), null);
  assert.equal(status("editor.document").disk, "same");
});

test("a change on disk replaces an unmodified text and is ignored when it is the editor's own write", async (t) => {
  const { run, status, sidecar } = await setup(t);
  sidecar.change("src/main.js", "new text\n");
  await settle();
  await settle();
  assert.equal(run("editor.read"), "new text\n");
  run("editor.edit", { changes: [{ from: 0, to: 3, insert: "old" }] });
  await run("editor.save");
  sidecar.change("src/main.js", "old text\n");
  await settle();
  await settle();
  assert.equal(status("editor.document").disk, "same");
});

test("a file with CRLF line breaks keeps them when it is saved", async (t) => {
  const { run, files } = await setup(t, { path: "a.txt", files: new Map([["a.txt", "one\r\ntwo\r\n"]]) });
  assert.equal(run("editor.read"), "one\r\ntwo\r\n");
  run("editor.edit", { changes: [{ from: 3, to: 3, insert: "!" }] });
  await run("editor.save");
  assert.equal(files.get("a.txt"), "one!\r\ntwo\r\n");
});

test("find selects matches, replaces them, and reports an invalid regular expression as state", async (t) => {
  const { run, status } = await setup(t, { path: "a.txt", files: new Map([["a.txt", "cat cat Cat\n"]]) });
  run("editor.find.open", { replace: true });
  assert.deepEqual(run("editor.find", { query: "cat" }), { matches: 3 });
  assert.deepEqual(run("editor.find", { caseSensitive: true }), { matches: 2 });
  assert.deepEqual(run("editor.find.next"), { current: 0 });
  assert.deepEqual(run("editor.find.next"), { current: 1 });
  assert.deepEqual(run("editor.find.next"), { current: 0 });
  run("editor.find", { replacement: "dog" });
  assert.deepEqual(run("editor.replace.all"), { replaced: 2 });
  assert.equal(run("editor.read"), "dog dog Cat\n");
  run("editor.find", { query: "(", regexp: true });
  assert.equal(status("editor.find").matches, 0);
  assert.match(status("editor.find").error, /Invalid regular expression/);
  run("editor.find", { query: "(C)at", replacement: "$1ow" });
  assert.deepEqual(run("editor.replace.all"), { replaced: 1 });
  assert.equal(run("editor.read"), "dog dog Cow\n");
});

test("every interactive element of the editor is bound to a declared command and has a dom name", async (t) => {
  const { root, run, binder } = await setup(t);
  run("editor.find.open", { replace: true });
  assert.deepEqual(binder.audit(root), []);
});

test("the shortcut Command-S saves and Command-F opens the find bar", async (t) => {
  const { root, status, run, files } = await setup(t);
  run("editor.edit", { changes: [{ from: 0, to: 0, insert: "x" }] });
  const content = root.querySelector(".cm-content");
  const key = (code, options = {}) => new window.KeyboardEvent("keydown", { code, metaKey: true, bubbles: true, cancelable: true, ...options });
  const save = key("KeyS");
  content.dispatchEvent(save);
  assert.equal(save.defaultPrevented, true);
  await settle();
  await settle();
  assert.equal(files.get("src/main.js").startsWith("xlet"), true);
  content.dispatchEvent(key("KeyF", { altKey: true }));
  assert.equal(status("editor.find").open, true);
  assert.equal(status("editor.find").replace, true);
});

test("a contributed extension applies to its name extensions and a failing module is reported", async (t) => {
  const failed = [];
  const extension = new URL("./fixtures/upper-gutter.mjs", import.meta.url).href;
  const formatter = new URL("./fixtures/trim-formatter.mjs", import.meta.url).href;
  const { root, run, reports } = await setup(t, { contributions: {
    extension: [
      { plugin: "probe", item: { range: "^1.0.0", module: "ui/x.js", extensions: ["js"] }, module: extension, fail: (reason) => failed.push(reason) },
      { plugin: "broken", item: { range: "^1.0.0", module: "ui/y.js" }, module: formatter, fail: (reason) => failed.push(reason) },
    ],
    formatter: [{ plugin: "probe", item: { range: "^1.0.0", module: "ui/z.js", extensions: ["js"] }, module: formatter, fail: (reason) => failed.push(reason) }],
  } });
  assert.ok(root.querySelector(".probe-mark"), "the contributed extension did not apply");
  assert.deepEqual(failed, ["broken: the module does not export extension(file)"]);
  assert.deepEqual(await run("editor.format"), { changed: true });
  assert.equal(run("editor.read"), "let a = 1;\n// TODO: b");
  assert.deepEqual(reports.error.at(-1), null);
});

test("TODO, FIXME and XXX are marked in every file", async (t) => {
  const { root } = await setup(t, { path: "notes", files: new Map([["notes", "TODO one FIXME two XXX TODOLIST\n"]]) });
  assert.deepEqual([...root.querySelectorAll(".cm-todo")].map((element) => element.textContent), ["TODO", "FIXME", "XXX"]);
});
