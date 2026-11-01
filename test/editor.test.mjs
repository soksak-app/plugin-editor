import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import test from "node:test";
import { window } from "./dom.mjs";
import { fakeFiles, sha } from "./fakes.mjs";
import { createBinder } from "./models/binder.mjs";
import { emitViewFrameProbe, inspectViewFrameProbe, resetViewFrameProbe } from "./models/diagnostic-view-frames.mjs";

const { mount } = await import("../build/test/ui/editor.js");
const { markdownView, projectImagePath, safeImageSource } = await import("../build/test/ui/markdown.js");
const { EditorView } = await import("../build/test/shared/@codemirror/view.js");
const { attach: attachDiagnostics } = await import("../build/test/ui/editor-diagnostics.js");
const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const eventCatalog = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));
const validateContentFrame = new Ajv2020({ allErrors: true }).compile(eventCatalog.events["plugin.editor.view.content_frame"].fields);
const declared = (kind, name) => manifest.exposes[kind].some((entry) => entry.name === name);

async function setup(t, { path = "src/main.js", params = { path }, files = new Map([["src/main.js", "let a = 1;\n// TODO: b\n"]]), contributions = {}, scheme = "dark", log = [], stored = null,
  diagnostics = null, scopeSurface = null, place = () => { throw new Error("the test runs no core command"); } } = {}) {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const commands = new Map();
  const statuses = new Map();
  const reports = { modified: [], error: [], title: [], commands: [], state: [], keep: [] };
  const logs = log;
  const binder = createBinder((name, params) => commands.get(name)(params), {
    check(name) { assert.ok(declared("commands", name), `undeclared command ${name}`); },
  });
  const sidecar = fakeFiles(files);
  const controller = await mount(root, {
    surfaceId: "editor-1",
    project: { root: "/project" },
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
      status(name, read) { assert.ok(declared("status", name), `undeclared status ${name}`); statuses.set(name, read); },
      command(name, run) {
        assert.ok(declared("commands", name) || ((name === "editor.memory.hidden" || name === "editor.diagnostics.content-trace") && diagnostics),
          `undeclared command ${name}`);
        commands.set(name, run);
      },
      dom(name) { assert.ok(declared("dom", name), `undeclared dom ${name}`); },
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
  return { root, run, status, reports, sidecar, files, binder, controller, logs, dispose };
}

test("a diagnostic hidden-memory start skips the visible editor and creates one hidden view", { timeout: 5000 }, async (t) => {
  const documentText = "const first = 1;\nconst second = 2;\n";
  assert.deepEqual(manifest.surface.params.properties.diagnosticMode.enum, ["hidden-memory"]);
  assert.equal(manifest.surface.params.properties.document.type, "string");
  const editor = await setup(t, {
    params: { diagnosticMode: "hidden-memory", document: documentText },
    diagnostics: { attach: attachDiagnostics },
  });
  assert.equal(editor.root.querySelector("#view .cm-editor"), null, "hidden-memory mode does not construct the visible EditorView");
  assert.equal(editor.root.querySelector("#frame"), null, "hidden-memory mode does not build the ordinary editor UI");
  assert.equal(editor.root.querySelectorAll(".cm-editor").length, 1, "hidden-memory mode constructs exactly one CodeMirror view");
  assert.ok(editor.root.querySelector("[data-editor-diagnostic-hidden] .cm-editor"),
    "the sole CodeMirror view belongs to the hidden diagnostic container");
  const status = await editor.run("editor.memory.hidden", { action: "read" });
  assert.deepEqual(status, {
    mounted: true,
    documentLength: documentText.length,
    lines: 3,
    historyEntries: 1,
    regionHistoryEntries: 0,
  });
  const view = EditorView.findFromDOM(editor.root.querySelector(".cm-editor"));
  assert.equal(view.state.doc.toString(), documentText);
  assert.deepEqual(await editor.run("editor.memory.hidden", { action: "remove" }), {
    mounted: false,
    documentLength: 0,
    lines: 0,
    historyEntries: 1,
    regionHistoryEntries: 0,
  });
  assert.equal(editor.root.querySelector(".cm-editor"), null, "the diagnostic command removes the initial hidden view");
});

test("a hidden-memory start is refused without the diagnostic declaration", { timeout: 5000 }, async (t) => {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  t.after(() => host.remove());
  await assert.rejects(mount(root, {
    surfaceId: "editor-1",
    project: { root: "/project" },
    tab: { params: { diagnosticMode: "hidden-memory", document: "const x = 1;" },
      state: { read: async () => null, write() {} }, title() {}, modified() {}, error() {} },
    runtime: { sidecar() { throw new Error("hidden-memory start must not connect the files sidecar"); } },
    contributions() { return []; },
    exposure: {},
  }), /requires the editor diagnostic declaration/);
  assert.equal(root.querySelectorAll(".cm-editor").length, 0, "refusal occurs before EditorView construction");
});

test("a hidden-memory start removes its view when diagnostic attachment fails", { timeout: 5000 }, async (t) => {
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  t.after(() => host.remove());
  await assert.rejects(mount(root, {
    surfaceId: "editor-1",
    project: { root: "/project" },
    tab: { params: { diagnosticMode: "hidden-memory", document: "const x = 1;" } },
    diagnostics: { attach: async () => { throw new Error("diagnostic attach failed"); } },
    exposure: { dispose: async () => {} },
  }), /diagnostic attach failed/);
  assert.equal(root.querySelector(".cm-editor"), null, "a failed diagnostic attach destroys the constructed view");
  assert.equal(root.querySelector("[data-editor-diagnostic-hidden]"), null, "a failed diagnostic attach removes its host");
});

test("content frame diagnostics observe the view root and restore its card style", { timeout: 5000 }, async (t) => {
  resetViewFrameProbe();
  t.after(resetViewFrameProbe);
  const documentRoot = window.document.documentElement;
  const originalRect = documentRoot.getBoundingClientRect;
  documentRoot.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, right: 640, top: 0, bottom: 480, width: 640, height: 480 });
  t.after(() => { documentRoot.getBoundingClientRect = originalRect; });
  const style = documentRoot.style;
  const hadCard = Array.from({ length: style.length }, (_, index) => style.item(index)).includes("--card");
  const priorCard = style.getPropertyValue("--card");
  const priorPriority = style.getPropertyPriority("--card");
  style.setProperty("--card", "rgb(9, 8, 7)", "important");
  const originalResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class ResizeObserverProbe {};
  t.after(() => {
    window.ResizeObserver = originalResizeObserver;
    if (hadCard) style.setProperty("--card", priorCard, priorPriority);
    else style.removeProperty("--card");
  });
  const editor = await setup(t, { diagnostics: { attach: attachDiagnostics }, scopeSurface: "editor-1" });
  const run = editor.run;
  const before = await run("editor.diagnostics.content-trace", { action: "read" });
  assert.deepEqual(before, { enabled: false, sequence: 0, width: 640, height: 480,
    historyEntries: 1, regionHistoryEntries: 0 });
  const start = await run("editor.diagnostics.content-trace", { action: "start" });
  assert.deepEqual(start.markerColor, [17, 193, 231], "the start result declares the exact paint marker RGB");
  assert.ok(start.sourceClock && typeof start.sourceClock === "object", "the start result includes a source clock anchor");
  const { sourceClock, markerColor, ...startState } = start;
  assert.deepEqual(startState, { ...before, enabled: true });
  assert.deepEqual(Object.keys(sourceClock).sort(), ["documentTimeOriginMs", "sourceNowMs", "sourceResolutionMs"]);
  assert.equal(sourceClock.documentTimeOriginMs, window.performance.timeOrigin);
  assert.ok(Number.isFinite(sourceClock.sourceNowMs) && sourceClock.sourceNowMs >= 0);
  assert.ok(sourceClock.sourceNowMs <= window.performance.now());
  assert.equal(sourceClock.sourceResolutionMs, 1);
  assert.equal(style.getPropertyValue("--card"), "rgb(17, 193, 231)");
  assert.equal(style.getPropertyPriority("--card"), "");
  await assert.rejects(run("editor.diagnostics.content-trace", { action: "start" }), /already enabled/);
  const probe = inspectViewFrameProbe();
  assert.equal(probe.options.document, editor.root.ownerDocument);
  assert.equal(probe.options.document.documentElement, documentRoot);
  assert.equal(probe.options.ResizeObserver, window.ResizeObserver);
  assert.equal(typeof probe.options.requestAnimationFrame, "function");
  assert.equal(typeof probe.options.cancelAnimationFrame, "function");
  assert.equal(typeof probe.options.now, "function");
  assert.equal(probe.options.timeOriginMs, window.performance.timeOrigin);
  assert.equal(typeof probe.options.log.trace, "function");
  emitViewFrameProbe();
  const frameRecord = editor.logs.at(-1);
  assert.deepEqual(frameRecord, { level: "trace", event: "view.content_frame", fields: {
    sequence: 0, width: 640, height: 480,
    documentTimeOriginMs: window.performance.timeOrigin, firstResizeAtMs: 0, resizeAtMs: 0, resizeCount: 1,
    frameTimeMs: 1, surface: "editor-1",
  } });
  assert.equal(validateContentFrame(frameRecord.fields), true,
    `the context-scoped frame payload does not match events.json: ${JSON.stringify(validateContentFrame.errors)}`);
  assert.equal(validateContentFrame({ ...frameRecord.fields, unexpected: true }), false,
    "the published frame schema accepted an unexpected field");
  assert.equal((await run("editor.diagnostics.content-trace", { action: "read" })).sequence, 1);
  const sharedTrace = inspectViewFrameProbe().options.log.trace;
  const validSource = {
    sequence: 1, width: 640, height: 480, documentTimeOriginMs: window.performance.timeOrigin,
    firstResizeAtMs: 10, resizeAtMs: 12, resizeCount: 2, frameTimeMs: 13,
  };
  const invalidSource = [
    { ...validSource, resizeAtMs: 9 },
    { ...validSource, frameTimeMs: 11 },
    { ...validSource, resizeCount: 0 },
    { ...validSource, resizeCount: 1.5 },
    { ...validSource, resizeCount: 1 },
    { ...validSource, unexpected: true },
    Object.fromEntries(Object.entries(validSource).filter(([name]) => name !== "firstResizeAtMs")),
  ];
  for (const fields of invalidSource) assert.throws(() => sharedTrace("view.content_frame", fields));
  sharedTrace("view.content_frame", validSource);
  assert.deepEqual(editor.logs.at(-1).fields, { ...validSource, surface: "editor-1" },
    "the editor forwards every source coalescing field and keeps context surface identity");
  assert.equal((await run("editor.diagnostics.content-trace", { action: "read" })).sequence, 2);
  const stopped = await run("editor.diagnostics.content-trace", { action: "stop" });
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.width, before.width);
  assert.equal(stopped.height, before.height);
  assert.equal(style.getPropertyValue("--card"), "rgb(9, 8, 7)");
  assert.equal(style.getPropertyPriority("--card"), "important");
  assert.equal(inspectViewFrameProbe().stopCount, 1);
  style.removeProperty("--card");
  await run("editor.diagnostics.content-trace", { action: "start" });
  await editor.dispose();
  assert.equal(Array.from({ length: style.length }, (_, index) => style.item(index)).includes("--card"), false);
  assert.equal(inspectViewFrameProbe().stopCount, 2);
});

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

test("a file with mixed line breaks opens editable and saves its text unchanged", async (t) => {
  const { run, files, reports } = await setup(t, { path: "a.txt", files: new Map([["a.txt", "one\r\ntwo\nthree\rfour"]]) });
  assert.equal(run("editor.read"), "one\r\ntwo\nthree\rfour");
  run("editor.edit", { changes: [{ from: 3, to: 3, insert: "!" }] });
  await run("editor.save");
  assert.equal(files.get("a.txt"), "one!\r\ntwo\nthree\rfour");
  assert.deepEqual(reports.error.filter((text) => text !== null), []);
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

test("the tab is named after its file", async (t) => {
  const { reports } = await setup(t);
  assert.deepEqual(reports.title, ["main.js"]);
});

test("the editor colors come from a CodeMirror theme of the theme tokens and follow the scheme", async (t) => {
  const { EditorView } = await import("../build/test/shared/@codemirror/view.js");
  const { root } = await setup(t, { scheme: "light" });
  const view = EditorView.findFromDOM(root.querySelector(".cm-editor"));
  assert.equal(view.state.facet(EditorView.darkTheme), false);
  const css = [...root.querySelectorAll("style")].map((style) => style.textContent).join("\n");
  assert.match(css, /\.ͼ[0-9a-z]+ \.cm-gutters \{[^}]*background-color: var\(--card\)/);
  const { root: dark } = await setup(t, { scheme: "dark" });
  assert.equal(EditorView.findFromDOM(dark.querySelector(".cm-editor")).state.facet(EditorView.darkTheme), true);
});

test("every shared package is imported from a URL that ends in .js", () => {
  const vendor = new URL("../ui/vendor/", import.meta.url);
  const sources = ["codemirror-view.js", "codemirror-language.js", "libraries.js"].map((file) => readFileSync(new URL(file, vendor), "utf8"))
    .concat(readFileSync(new URL("../ui/editor.js", import.meta.url), "utf8"));
  const specifiers = sources.flatMap((source) => [...source.matchAll(/from "(@soksak\/shared\/[^"]+)"/g)].map((match) => match[1]));
  assert.ok(specifiers.length > 0);
  assert.deepEqual(specifiers.filter((specifier) => !specifier.endsWith(".js")), []);
});

/** The events of the log with the name `event`. */
const eventsOf = (logs, event) => logs.filter((entry) => entry.event === event);
const isMicros = (value) => Number.isInteger(value) && value >= 0;

test("the open records the file, its size and the watch with their results", async (t) => {
  const { logs } = await setup(t);
  const [open] = eventsOf(logs, "open");
  assert.equal(open.level, "info");
  assert.deepEqual({ ...open.fields, micros: isMicros(open.fields.micros) }, { path: "src/main.js", bytes: 22, lines: 3, newline: "lf",
    micros: true, ok: true });
  const [watch] = eventsOf(logs, "watch.start");
  assert.deepEqual({ ...watch.fields, micros: isMicros(watch.fields.micros) }, { path: "src/main.js", micros: true, ok: true });
  assert.deepEqual(eventsOf(logs, "request").map((entry) => [entry.level, entry.fields.operation, entry.fields.ok]),
    [["debug", "read", true], ["debug", "watch", true]]);
});

test("an open of a missing file records the failure and still fails", async (t) => {
  const logs = [];
  await assert.rejects(setup(t, { path: "gone.js", files: new Map(), log: logs }), /no such file: gone.js/);
  const [open] = eventsOf(logs, "open");
  assert.equal(open.level, "warn");
  assert.equal(open.fields.ok, false);
  assert.equal(open.fields.error, "-32603: no such file: gone.js");
});

test("a save records its bytes, overwrite and result, and a refused save records the error", async (t) => {
  const { run, logs, sidecar } = await setup(t);
  run("editor.edit", { changes: [{ from: 8, to: 9, insert: "2" }] });
  await run("editor.save");
  const [saved] = eventsOf(logs, "save");
  assert.equal(saved.level, "info");
  assert.deepEqual({ ...saved.fields, micros: isMicros(saved.fields.micros) }, { path: "src/main.js", bytes: 22, overwrite: false, micros: true, ok: true });
  run("editor.edit", { changes: [{ from: 0, to: 0, insert: "x" }] });
  sidecar.change("src/main.js", "elsewhere\n");
  await settle();
  await settle();
  await assert.rejects(run("editor.save"), /changed on disk/);
  const refused = eventsOf(logs, "save").at(-1);
  assert.equal(refused.level, "warn");
  assert.equal(refused.fields.ok, false);
  assert.equal(refused.fields.error, "-32603: changed on disk: src/main.js");
});

test("a change on disk records the change, the read and the decision", async (t) => {
  const { run, logs, sidecar } = await setup(t);
  sidecar.change("src/main.js", "new text\n");
  await settle();
  await settle();
  assert.deepEqual(eventsOf(logs, "watch.change").map((entry) => entry.fields), [{ path: "src/main.js" }]);
  const [read] = eventsOf(logs, "read");
  assert.equal(read.fields.reason, "watch");
  assert.equal(read.fields.bytes, 9);
  assert.equal(read.fields.ok, true);
  assert.deepEqual(eventsOf(logs, "disk.decision").map((entry) => entry.fields), [{ path: "src/main.js", decision: "loaded", modified: false }]);
  sidecar.change("src/main.js", "new text\n");
  await settle();
  await settle();
  assert.equal(eventsOf(logs, "disk.decision").at(-1).fields.decision, "same");
  run("editor.edit", { changes: [{ from: 0, to: 0, insert: "mine " }] });
  sidecar.change("src/main.js", "other\n");
  await settle();
  await settle();
  assert.deepEqual(eventsOf(logs, "disk.decision").at(-1).fields, { path: "src/main.js", decision: "conflict", modified: true });
});

test("a read of the reload command and a failed read are recorded", async (t) => {
  const { run, logs, files } = await setup(t);
  await run("editor.reload");
  assert.equal(eventsOf(logs, "read").at(-1).fields.reason, "reload");
  files.delete("src/main.js");
  await assert.rejects(run("editor.reload"), /no such file/);
  const failed = eventsOf(logs, "read").at(-1);
  assert.equal(failed.level, "warn");
  assert.equal(failed.fields.error, "-32603: no such file: src/main.js");
});

test("the stop of the watch is recorded as an error event", async (t) => {
  const { logs, sidecar } = await setup(t);
  sidecar.report({ error: "the watch ended" });
  await settle();
  assert.deepEqual(eventsOf(logs, "watch.error"), [{ level: "error", event: "watch.error", fields: { path: "src/main.js", error: "the watch ended" } }]);
});

test("every command result is recorded with its time, and a refused command records its error", async (t) => {
  const { run, logs } = await setup(t);
  run("editor.select", { anchor: 0 });
  assert.throws(() => run("editor.read", { from: 5, to: 1 }), RangeError);
  const [ok, failed] = eventsOf(logs, "command");
  assert.equal(ok.level, "debug");
  assert.deepEqual({ ...ok.fields, micros: isMicros(ok.fields.micros) }, { name: "editor.select", micros: true, ok: true });
  assert.equal(failed.level, "warn");
  assert.equal(failed.fields.name, "editor.read");
  assert.equal(failed.fields.ok, false);
  assert.match(failed.fields.error, /^-32000: editor.read requires/);
  await run("editor.reload");
  assert.equal(eventsOf(logs, "command").at(-1).fields.name, "editor.reload");
});

test("a failed contribution and a format are recorded", async (t) => {
  const formatter = new URL("./fixtures/trim-formatter.mjs", import.meta.url).href;
  const { run, logs } = await setup(t, { contributions: {
    extension: [{ plugin: "broken", item: { range: "^1.0.0", module: "ui/y.js" }, module: formatter, fail() {} }],
    formatter: [{ plugin: "probe", item: { range: "^1.0.0", module: "ui/z.js", extensions: ["js"] }, module: formatter, fail() {} }],
  } });
  assert.deepEqual(eventsOf(logs, "contribution.failed").map((entry) => [entry.level, entry.fields.point, entry.fields.plugin, entry.fields.error]),
    [["warn", "extension", "broken", "the module does not export extension(file)"]]);
  await run("editor.format");
  const [format] = eventsOf(logs, "format");
  assert.equal(format.level, "info");
  assert.deepEqual({ ...format.fields, micros: isMicros(format.fields.micros) }, { path: "src/main.js", formatter: "probe", changed: true, micros: true, ok: true });
});

test("the end of the surface records the close", async (t) => {
  const { controller, logs } = await setup(t);
  await controller.dispose();
  assert.deepEqual(eventsOf(logs, "close").map((entry) => entry.fields), [{ path: "src/main.js", pending: 0 }]);
});

test("a tab without a path opens a blank document named as a new document", async (t) => {
  const { run, status, reports, sidecar } = await setup(t, { params: {}, files: new Map() });
  assert.equal(run("editor.read"), "");
  assert.deepEqual(reports.title, ["새 문서"]);
  const document = status("editor.document");
  assert.equal(document.path, null);
  assert.equal(document.version, null);
  assert.equal(document.modified, false);
  assert.deepEqual(sidecar.sent, [], "a blank document reads and watches no file");
});

test("the first save of a blank document asks for the file through core.file.place, writes it and watches it", async (t) => {
  const { run, status, reports, sidecar, files } = await setup(t, { params: {}, files: new Map(), place: () => ({ path: "notes/plan.md" }) });
  run("editor.edit", { changes: [{ from: 0, to: 0, insert: "# plan\n" }] });
  assert.equal(status("editor.document").modified, true);
  const { version } = await run("editor.save");
  assert.deepEqual(reports.commands, [["core.file.place", { name: "새 문서.txt" }]]);
  assert.equal(files.get("notes/plan.md"), "# plan\n");
  assert.equal(version, sha("# plan\n"));
  assert.deepEqual(sidecar.sent.map((body) => [body.operation, body.operation === "write" ? body.expect : body.paths]), [["write", null], ["watch", ["notes/plan.md"]]]);
  const document = status("editor.document");
  assert.equal(document.path, "notes/plan.md");
  assert.equal(document.language, "markdown");
  assert.equal(document.modified, false);
  assert.deepEqual(reports.title, ["새 문서", "plan.md"]);
  // The next save writes the named file in place.
  run("editor.edit", { changes: [{ from: 7, to: 7, insert: "- a\n" }] });
  await run("editor.save");
  assert.equal(files.get("notes/plan.md"), "# plan\n- a\n");
  assert.equal(reports.commands.length, 1, "a named document does not ask for its place again");
});

test("a cancelled place keeps the blank document modified and writes nothing", async (t) => {
  const { run, status, sidecar } = await setup(t, { params: {}, files: new Map(), place: () => ({ path: null }) });
  run("editor.edit", { changes: [{ from: 0, to: 0, insert: "draft" }] });
  assert.deepEqual(await run("editor.save"), { version: null });
  assert.equal(status("editor.document").path, null);
  assert.equal(status("editor.document").modified, true);
  assert.deepEqual(sidecar.sent, []);
});

test("a place whose file exists overwrites it, because the save panel asked to replace it", async (t) => {
  const files = new Map([["old.txt", "before"]]);
  const { run, status } = await setup(t, { params: {}, files, place: () => ({ path: "old.txt" }) });
  run("editor.edit", { changes: [{ from: 0, to: 0, insert: "after" }] });
  await run("editor.save");
  assert.equal(files.get("old.txt"), "after");
  assert.equal(status("editor.document").path, "old.txt");
});

test("a refused place shows the tab error and keeps the blank document", async (t) => {
  const { run, status, reports } = await setup(t, { params: {}, files: new Map(),
    place: () => { throw new Error("file place: /elsewhere/a.txt is outside the project /project"); } });
  run("editor.edit", { changes: [{ from: 0, to: 0, insert: "x" }] });
  await assert.rejects(run("editor.save"), /outside the project/);
  assert.equal(status("editor.document").path, null);
  assert.match(reports.error.at(-1), /outside the project/);
});

test("the editor writes its file and cursor as the tab state and restores them", async (t) => {
  const { run, reports } = await setup(t);
  run("editor.select", { anchor: 4, head: 5 });
  assert.deepEqual(reports.state.at(-1), { path: "src/main.js", selection: { anchor: 4, head: 5 }, scroll: { top: 0, left: 0 } });
  const count = reports.state.length;
  run("editor.select", { anchor: 4, head: 5 });
  assert.equal(reports.state.length, count, "a selection that keeps the state writes nothing");
  // The stored path wins over params, because the first save of a blank document changes the file and not the params.
  const restored = await setup(t, { params: {}, stored: { path: "src/main.js", selection: { anchor: 6, head: 99 }, scroll: { top: 0, left: 0 } } });
  assert.equal(restored.status("editor.document").path, "src/main.js");
  assert.deepEqual(restored.status("editor.document").selection, { anchor: 6, head: 22 });
});

test("a tab state of another form is refused", async (t) => {
  await assert.rejects(setup(t, { stored: { path: "", selection: { anchor: 0, head: 0 }, scroll: { top: 0, left: 0 } } }),
    /the tab state of editor tab editor-1 is not \{path, selection, scroll\}: \{"path":""/);
});

test("the tab stays loaded while a formatter runs", async (t) => {
  let finish;
  const formatter = { plugin: "fmt", item: {}, module: `data:text/javascript,${encodeURIComponent("export const format = (text) => globalThis.__editorFormat(text);")}`, fail() {} };
  globalThis.__editorFormat = (text) => new Promise((resolve) => { finish = () => resolve(text.toUpperCase()); });
  t.after(() => { delete globalThis.__editorFormat; });
  const { run, reports } = await setup(t, { contributions: { formatter: [formatter] } });
  const formatted = run("editor.format");
  await settle();
  assert.deepEqual(reports.keep, [["busy", true]]);
  finish();
  await formatted;
  assert.deepEqual(reports.keep, [["busy", true], ["busy", false]]);
});

test("Markdown renders in place and toggles without changing the document", async (t) => {
  const text = "# Heading\n\n**bold** and *italic* [link](https://example.test)\n\n- item\n\n`code`\n\n```js\nconst value = 1\n```\n\n![alt text](https://example.test/image.png)\n";
  const { root, run } = await setup(t, { path: "notes.md", files: new Map([["notes.md", text]]) });
  assert.equal(declared("commands", "editor.markdown.toggle"), true);
  assert.deepEqual(await run("editor.markdown.toggle"), { rendered: true });
  assert.ok(root.querySelector(".cm-md-heading-1"));
  assert.ok(root.querySelector(".cm-md-strong"));
  assert.ok(root.querySelector(".cm-md-emphasis"));
  assert.ok(root.querySelector(".cm-md-link"));
  assert.ok(root.querySelector(".cm-md-list"));
  assert.ok(root.querySelector(".cm-md-inline-code"));
  assert.ok(root.querySelector(".cm-md-fenced-code"));
  assert.equal(root.querySelector("img.cm-md-image")?.getAttribute("src"), "https://example.test/image.png");
  assert.doesNotMatch(root.querySelector(".cm-content").textContent, /# Heading|\*\*bold\*\*|\*italic\*|\[link\]|`code`|```|!\[/);
  assert.equal(run("editor.read"), text, "rendering must not replace the Markdown document");
  run("editor.edit", { changes: [{ from: 2, to: 9, insert: "Changed" }] });
  const changed = text.replace("Heading", "Changed");
  assert.equal(root.querySelector(".cm-md-heading-1").textContent, "Changed", "decorations follow edits in rendered mode");
  assert.equal(run("editor.read"), changed);
  assert.deepEqual(await run("editor.markdown.toggle"), { rendered: false });
  assert.match(root.querySelector(".cm-content").textContent, /# Changed/);
  assert.equal(run("editor.read"), changed);
});

test("the Markdown toggle is hidden and refuses non-Markdown files", async (t) => {
  const { root, run } = await setup(t);
  assert.equal(root.querySelector("#markdown-toolbar").hidden, true);
  await assert.rejects(run("editor.markdown.toggle"), /only for Markdown files/);
});

test("Markdown image URLs reject obfuscated schemes and resolve project-relative paths", () => {
  assert.equal(safeImageSource("javascript:alert(1)"), null);
  assert.equal(safeImageSource("java script:alert(1)"), null);
  assert.equal(safeImageSource("java\u0000script:alert(1)"), null);
  assert.deepEqual(safeImageSource("https://example.test/image.png"), { kind: "remote", source: "https://example.test/image.png" });
  assert.equal(projectImagePath("docs/nested/readme.md", "../images/diagram%20one.png?size=small#top"), "docs/images/diagram one.png");
  assert.throws(() => projectImagePath("docs/nested/readme.md", "../../../outside.png"), /leaves the project root/);
});

test("unsafe Markdown image schemes are refused visibly", async (t) => {
  const { root, run, reports } = await setup(t, { path: "unsafe.md", files: new Map([["unsafe.md", "![unsafe](javascript:alert(1))"]]) });
  await assert.rejects(run("editor.markdown.toggle"), /unsafe or malformed Markdown image URL/);
  assert.match(reports.error.at(-1), /이미지를 불러오지 못했습니다.*unsafe or malformed/);
  assert.equal(root.querySelector("img.cm-md-image"), null);
});




test("Markdown decorations cover headings near the end of a large document", async (t) => {
  const text = "paragraph\n".repeat(20000) + "# Final heading\n";
  const { root, run } = await setup(t, { path: "large.md", files: new Map([["large.md", text]]) });
  await run("editor.markdown.toggle");
  const view = EditorView.findFromDOM(root.querySelector(".cm-editor"));
  const headings = [];
  view.state.field(markdownView).decorations.between(0, view.state.doc.length, (from, to, value) => {
    if (value.spec.class?.includes("cm-md-heading-1")) headings.push({ from, to });
  });
  assert.equal(headings.length, 1);
  const headingStart = text.lastIndexOf("# Final heading");
  assert.equal(headings[0].from, headingStart);
  run("editor.edit", { changes: [{ from: headingStart + 2, to: headingStart + "# Final heading".length, insert: "Updated heading" }] });
  // The decorations of the edited heading appear when the parse of the large document completes in its 50 ms slices.
  // No event reports that completion to the test, so the test waits for the refreshed decorations within a bound.
  const headingLines = () => {
    const ranges = [];
    view.state.field(markdownView).decorations.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.class?.includes("cm-md-heading-1")) ranges.push({ from, to });
    });
    return ranges;
  };
  let updated = headingLines();
  for (let turn = 0; turn < 5000 && !(updated.length === 1 && view.state.sliceDoc(updated[0].from, updated[0].to) === "# Updated heading"); turn += 1) {
    await settle();
    updated = headingLines();
  }
  assert.equal(updated.length, 1, "the completed parse refreshes decorations after an edit");
  assert.equal(view.state.sliceDoc(updated[0].from, updated[0].to), "# Updated heading");
});

test("relative Markdown images read project files and release Blob URLs", async (t) => {
  const text = "![diagram](images/diagram.png)\n";
  const bytes = Uint8Array.of(137, 80, 78, 71, 1, 2, 3);
  const files = new Map([["docs/nested/readme.md", text], ["docs/nested/images/diagram.png", bytes]]);
  const { root, run, sidecar, dispose } = await setup(t, { path: "docs/nested/readme.md", files });
  await run("editor.markdown.toggle");
  assert.deepEqual(sidecar.sent.filter((body) => body.operation === "readBytes").map((body) => body.path), ["docs/nested/images/diagram.png"]);
  const image = root.querySelector("img.cm-md-image");
  assert.ok(image);
  const objectUrl = image.getAttribute("src");
  assert.match(objectUrl, /^blob:/);
  const response = await fetch(objectUrl);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(run("editor.read"), text);
  await run("editor.markdown.toggle");
  assert.equal(root.querySelector("img.cm-md-image"), null);
  await assert.rejects(fetch(objectUrl));
  await run("editor.markdown.toggle");
  const secondUrl = root.querySelector("img.cm-md-image").getAttribute("src");
  await dispose();
  await assert.rejects(fetch(secondUrl));
});



test("Markdown image URLs refresh after edits and reloads", async (t) => {
  const text = "![diagram](images/first.png)\n";
  const first = Uint8Array.of(1, 2, 3, 4);
  const second = Uint8Array.of(5, 6, 7, 8);
  const reloaded = Uint8Array.of(9, 10, 11, 12);
  const files = new Map([["docs/nested/readme.md", text], ["docs/nested/images/first.png", first], ["docs/nested/images/second.png", second]]);
  const { root, run, sidecar, dispose } = await setup(t, { path: "docs/nested/readme.md", files });
  await run("editor.markdown.toggle");
  const firstUrl = root.querySelector("img.cm-md-image").getAttribute("src");
  const from = text.indexOf("images/first.png");
  run("editor.edit", { changes: [{ from, to: from + "images/first.png".length, insert: "images/second.png" }] });
  await settle();
  const secondUrl = root.querySelector("img.cm-md-image").getAttribute("src");
  assert.notEqual(secondUrl, firstUrl);
  assert.deepEqual(new Uint8Array(await (await fetch(secondUrl)).arrayBuffer()), second);
  await assert.rejects(fetch(firstUrl));
  assert.equal(run("editor.read"), text.replace("images/first.png", "images/second.png"));
  await run("editor.save");
  files.set("docs/nested/images/second.png", reloaded);
  await run("editor.reload");
  await settle();
  const reloadedUrl = root.querySelector("img.cm-md-image").getAttribute("src");
  assert.notEqual(reloadedUrl, secondUrl);
  assert.deepEqual(new Uint8Array(await (await fetch(reloadedUrl)).arrayBuffer()), reloaded);
  await assert.rejects(fetch(secondUrl));
  await dispose();
  await assert.rejects(fetch(reloadedUrl));
  assert.deepEqual(sidecar.sent.filter((body) => body.operation === "readBytes").map((body) => body.path), [
    "docs/nested/images/first.png", "docs/nested/images/second.png", "docs/nested/images/second.png",
  ]);
});

test("missing relative Markdown images fail the toggle visibly without changing source", async (t) => {
  const text = "![missing](assets/missing.png)\n";
  const { run, reports, sidecar, files } = await setup(t, { path: "docs/readme.md", files: new Map([["docs/readme.md", text]]) });
  await assert.rejects(run("editor.markdown.toggle"), /no such file: docs\/assets\/missing\.png/);
  assert.deepEqual(sidecar.sent.filter((body) => body.operation === "readBytes").map((body) => body.path), ["docs/assets/missing.png"]);
  assert.match(reports.error.at(-1), /이미지를 불러오지 못했습니다.*missing\.png/);
  assert.equal(run("editor.read"), text);
  assert.equal(files.get("docs/readme.md"), text);
});



test("a partial Markdown image read failure revokes earlier Blob URLs", async (t) => {
  const created = [];
  const revoked = [];
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { const url = create.call(URL, blob); created.push(url); return url; };
  URL.revokeObjectURL = (url) => { revoked.push(url); revoke.call(URL, url); };
  t.after(() => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
  const text = "![available](images/first.png) ![missing](images/missing.png)";
  const files = new Map([["docs/readme.md", text], ["docs/images/first.png", Uint8Array.of(1, 2, 3)]]);
  const { root, run } = await setup(t, { path: "docs/readme.md", files });
  await assert.rejects(run("editor.markdown.toggle"), /no such file: docs\/images\/missing\.png/);
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, created);
  assert.equal(root.querySelector("img.cm-md-image"), null);
  await assert.rejects(fetch(created[0]));
});





test("malformed readBytes base64 is surfaced instead of silently omitting an image", async (t) => {
  const text = "![diagram](assets/diagram.png)\n";
  const { run, reports, sidecar } = await setup(t, { path: "docs/readme.md", files: new Map([["docs/readme.md", text]]) });
  const send = sidecar.send.bind(sidecar);
  sidecar.send = async (surface, body) => {
    if (body.operation === "readBytes") return sidecar.report({ id: body.id, data: "%%%", version: "bad" });
    return send(surface, body);
  };
  await assert.rejects(run("editor.markdown.toggle"), /invalid base64/);
  assert.match(reports.error.at(-1), /이미지를 불러오지 못했습니다.*invalid base64/);
  assert.equal(run("editor.read"), text);
});

test("a denied relative Markdown image read is surfaced", async (t) => {
  const text = "![private](assets/private.png)\n";
  const { run, reports, sidecar } = await setup(t, { path: "docs/readme.md", files: new Map([["docs/readme.md", text]]) });
  const send = sidecar.send.bind(sidecar);
  sidecar.send = async (surface, body) => {
    if (body.operation === "readBytes") return sidecar.report({ id: body.id, error: "permission denied: docs/assets/private.png" });
    return send(surface, body);
  };
  await assert.rejects(run("editor.markdown.toggle"), /permission denied/);
  assert.match(reports.error.at(-1), /이미지를 불러오지 못했습니다.*permission denied/);
  assert.equal(run("editor.read"), text);
});

test("relative Markdown image paths cannot escape the project root", async (t) => {
  const text = "![escape](../../../outside.png)";
  const { run, sidecar } = await setup(t, { path: "docs/nested/readme.md", files: new Map([["docs/nested/readme.md", text]]) });
  await assert.rejects(run("editor.markdown.toggle"), /leaves the project root/);
  assert.equal(sidecar.sent.some((body) => body.operation === "readBytes"), false);
});


test("a format without a connected formatter shows the refusal as the tab error", async (t) => {
  const { run, reports } = await setup(t);
  await assert.rejects(run("editor.format"), /no formatter is connected/);
  assert.match(reports.error.at(-1), /^서식을 맞추지 못했습니다 · no formatter is connected/);
});

test("a formatter that throws a value without a message shows the value as the tab error", async (t) => {
  const formatter = { plugin: "fmt", item: {}, module: `data:text/javascript,${encodeURIComponent("export const format = () => { throw 'formatter broke'; };")}`, fail() {} };
  const { run, reports } = await setup(t, { contributions: { formatter: [formatter] } });
  await assert.rejects(run("editor.format"), (error) => error === "formatter broke");
  assert.equal(reports.error.at(-1), "서식을 맞추지 못했습니다 · formatter broke");
});

test("an invalid regular expression shows its message in the find bar and records it", async (t) => {
  const { run, root, logs } = await setup(t);
  run("editor.find", { query: "(", regexp: true });
  assert.match(root.querySelector("#count").textContent, /Invalid regular expression/);
  const invalid = eventsOf(logs, "find.invalid");
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].fields.error, /Invalid regular expression/);
});

test("a Markdown image failure after the tab is disposed is recorded as an event", async (t) => {
  const text = "![gone](assets/gone.png)\n";
  const { run, logs, sidecar, dispose } = await setup(t, { path: "docs/readme.md", files: new Map([["docs/readme.md", text]]) });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const send = sidecar.send.bind(sidecar);
  sidecar.send = async (surface, body) => {
    if (body.operation !== "readBytes") return send(surface, body);
    await held;
    return sidecar.report({ id: body.id, error: "missing: docs/assets/gone.png" });
  };
  const toggled = run("editor.markdown.toggle").catch((error) => error);
  await dispose();
  release();
  await toggled;
  assert.deepEqual(eventsOf(logs, "markdown.image").map((entry) => [entry.level, entry.fields]),
    [["warn", { path: "docs/readme.md", reason: "disposed", error: "-32603: the editor closed before the files sidecar replied" }]]);
});
