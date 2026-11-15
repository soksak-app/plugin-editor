// The view page at the consumer boundary (E24): the page of the view builds its surface context over the view bridge of the plugin API
// and mounts the editor module into the page. The page runs on the plugin API fixture of this repository (test/fixtures/plugin-api),
// and the editor view helper (test/editor-view.mjs) opens it with the files sidecar of the test. The tests judge the calls that the
// page makes on the plugin API and what it does with the answers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openPageView } from "./fixtures/page-view.mjs";
import { openEditor } from "./editor-view.mjs";
import { SIDECAR, SURFACE } from "./files-sidecar.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

const PAGE = new URL("../ui/index.html", import.meta.url);

test("the view page begins with its doctype, holds no import map, and carries the page script", () => {
  // The host inserts the view import map after the doctype (core docs/spec/plugin-processes.md, rule 4), so the page holds none.
  const html = readFileSync(PAGE, "utf8");
  assert.match(html, /^<!doctype html>/i);
  assert.doesNotMatch(html, /<script type="importmap">/);
  assert.match(html, /<script type="module" src="\.\/view\.js"><\/script>/);
});

test("the view page refuses to mount without the start values of the surface", async (t) => {
  const view = await openPageView("editor", { start: null, sidecars: [SIDECAR] });
  t.after(() => view.close());
  await assert.rejects(view.load(new URL("../build/test/ui/view.js", import.meta.url)),
    /the view of editor has no start values: the host provides window\.sokSurface/);
});

test("the view page refuses to mount without the declarations of the start values", async (t) => {
  // The host merges declarations into the start values it sets, so the window of this view gets its start values from the test before load.
  const view = await openPageView("editor", { start: null, sidecars: [SIDECAR] });
  t.after(() => view.close());
  view.window.sokSurface = Object.freeze({ surface: SURFACE, params: null, origin: null, project: null });
  await assert.rejects(view.load(new URL("../build/test/ui/view.js", import.meta.url)),
    /window\.sokSurface \{surface, params, origin, project, declarations, diagnostics\}/);
});

test("the view page registers its exposure from the declarations of the start values", async (t) => {
  const editor = await openEditor(t);
  const registered = (kind) => editor.view.api.filter(({ name, args }) => name === "exposure.register" && args[0] === kind)
    .map(({ args }) => args[1]);
  assert.deepEqual(registered("status").toSorted(), manifest.exposes.status.map((entry) => entry.name).toSorted());
});

test("the view context uses the logger supplied by its SDK bridge", async (t) => {
  // This view opens without loading the page: the bridge of the plugin API and the context module are created over the same window and handler.
  const start = { surface: SURFACE, params: null, origin: null, project: null };
  const view = await openPageView("editor", { start, declarations: { status: manifest.exposes.status, commands: manifest.exposes.commands,
    element: manifest.exposes.element }, sidecars: [SIDECAR] });
  t.after(() => view.close());
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const { createViewContext } = await import("../build/test/ui/view-context.js");
  const bridge = createViewBridge({ handler: view.window.webkit.messageHandlers["sok-view"], report: () => {} });
  const { context } = createViewContext({ bridge, start: view.window.sokSurface, report: () => {} });
  assert.strictEqual(context.runtime.log, bridge.runtime.log);
});

test("the view page opens the file of its tab through the view channel", async (t) => {
  const editor = await openEditor(t);
  assert.deepEqual(editor.sidecar.sent.map((body) => body.operation), ["read", "watch"]);
  assert.equal(await editor.run("editor.read"), "let a = 1;\n// TODO: b\n");
  // Every declared command of the plugin is registered with the view bridge, and the statuses and the element names are registered
  // with the exposure relay of the bridge.
  const registeredCommands = editor.view.api.filter(({ name }) => name === "commands.register").map(({ args }) => args[0]);
  assert.deepEqual(registeredCommands.toSorted(), manifest.exposes.commands.map((entry) => entry.name).toSorted());
  const kinds = editor.view.api.filter(({ name }) => name === "exposure.register").map(({ args }) => args[0]);
  assert.deepEqual([...new Set(kinds)].toSorted(), ["element", "status"]);
  assert.deepEqual(editor.reports.title, ["main.js"]);
  const open = editor.logs.find((entry) => entry.event === "open");
  assert.equal(open.level, "info");
  assert.equal(open.fields.path, "src/main.js");
  assert.equal(open.fields.ok, true);
});

test("the view page resolves extension points through the view bridge", async (t) => {
  const fetches = [];
  const fetchOf = globalThis.fetch;
  globalThis.fetch = (input, init) => { fetches.push(String(input)); return fetchOf(input, init); };
  t.after(() => { globalThis.fetch = fetchOf; });
  const editor = await openEditor(t);
  await editor.settle();
  assert.deepEqual(editor.view.api.filter(({ name }) => name === "contributions").map(({ args }) => args[0]), ["extension", "formatter"]);
  assert.deepEqual(fetches, [],
    `the view fetched ${fetches.join(", ")}; its start values carry its diagnostic declaration, and it reads no plugin list`);
});

test("the view page hands an exposure request of its surface to its exposure and answers a status from its own value", async (t) => {
  const editor = await openEditor(t);
  const id = "exposure-request-1";
  const request = { id, method: "status.get", params: { name: "editor.document" } };
  await editor.push("exposure-request", { ...request, surface: SURFACE });
  assert.deepEqual(editor.view.exposureRequests, [request]);
  assert.equal((await editor.status("editor.document")).path, "src/main.js");
});

test("the view page stores an exposure request of another surface as an error and hands it to no exposure", async (t) => {
  const editor = await openEditor(t);
  await editor.push("exposure-request", { id: "exposure-request-2", surface: "other-1", method: "status.get", params: { name: "editor.document" } });
  assert.deepEqual(editor.view.exposureRequests, []);
  assert.deepEqual(editor.logs.filter((entry) => entry.event === "page.error"), [{ level: "error", event: "page.error", fields: {
    where: "context", error: `view editor: exposure request exposure-request-2 names surface other-1, not ${SURFACE}` } }]);
});

test("a watched status delivers its current value to the watcher", async (t) => {
  const editor = await openEditor(t);
  await editor.watch("editor.document");
  const changes = editor.reports.changed.filter((payload) => payload.name === "editor.document");
  assert.equal(changes.length, 1, `the page delivered ${changes.length} values for the watch, expected 1`);
  assert.equal(changes[0].value.path, "src/main.js");
});

test("an uncaught error of the view page is an error event of the plugin", async (t) => {
  const editor = await openEditor(t);
  const { window } = editor.view;
  window.dispatchEvent(new window.ErrorEvent("error", { error: new Error("boom"), message: "boom" }));
  await editor.until(() => editor.logs.some((entry) => entry.event === "page.error"));
  assert.deepEqual(editor.logs.filter((entry) => entry.event === "page.error"),
    [{ level: "error", event: "page.error", fields: { where: "page", error: "boom" } }]);
});

test("an edit of the view saves through the sidecar and reports the tab state", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.edit", { changes: [{ from: 8, to: 9, insert: "2" }] });
  assert.deepEqual(editor.reports.modified, [false, true]);
  await editor.run("editor.save");
  assert.deepEqual(editor.sidecar.sent.map((body) => body.operation), ["read", "watch", "write"]);
  assert.deepEqual(editor.reports.modified, [false, true, false]);
  assert.deepEqual(editor.reports.error, [null]);
  assert.ok(editor.reports.state.length > 0, "the page wrote the tab state of the view");
});

test("the first save of a blank document asks for its file through core.file.place", async (t) => {
  const files = new Map();
  const editor = await openEditor(t, { params: {}, files, commands: { "core.file.place": () => ({ path: "notes/plan.md" }) } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "# plan\n" }] });
  await editor.run("editor.save");
  assert.equal(files.get("notes/plan.md"), "# plan\n");
  assert.deepEqual(editor.reports.commands, [["core.file.place", { name: "새 문서.txt" }]]);
  assert.deepEqual(editor.sidecar.sent.map((body) => [body.operation, body.operation === "write" ? body.expect : body.paths]),
    [["write", null], ["watch", ["notes/plan.md"]]]);
  assert.deepEqual(editor.reports.title, ["새 문서", "plan.md"]);
});

test("the theme of the view starts from the theme script and follows a change", async (t) => {
  const editor = await openEditor(t, { scheme: "light" });
  const { window } = editor.view;
  assert.equal(window.document.documentElement.style.colorScheme, "light");
  editor.view.setTheme({ scheme: "dark", tokens: {} });
  assert.equal(window.document.documentElement.style.colorScheme, "dark");
});

// F238-c-13.4: each sidecar call of the view page names the sidecar that plugin.json declares.
test("the view page names its declared sidecar in each sidecar call", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.read");
  const declared = Object.keys(manifest.dependencies);
  assert.equal(declared.length, 1);
  const sidecarNames = editor.view.sidecarSends.map((send) => send.sidecar);
  assert.ok(sidecarNames.length >= 2, "the page sent its sidecar calls");
  assert.deepEqual(sidecarNames, sidecarNames.map(() => declared[0]));
});

// E14: the page records its trace as the events of its catalog, and each sidecar send carries its correlation identifiers.
test("the view page records the open, save and watch trace as declared events", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.edit", { changes: [{ from: 8, to: 9, insert: "2" }] });
  await editor.run("editor.save");
  const changed = editor.nextLog("watch.change");
  editor.sidecar.change("src/main.js", "changed on disk\n");
  await changed;
  const catalog = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8")).events;
  const events = editor.logs.map((entry) => entry.event);
  for (const event of ["open", "save", "watch.start", "watch.change"]) {
    assert.ok(events.includes(event), `the page recorded ${event}; recorded ${events.join(", ")}`);
    assert.ok(Object.hasOwn(catalog, `plugin.editor.${event}`), `plugin.editor.${event} is declared`);
  }
});

test("each sidecar send of the view page carries its correlation identifiers", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.read");
  await editor.run("editor.save");
  const cids = editor.view.sidecarSends.map((send) => send.cids);
  assert.ok(cids.length >= 2, "the page sent its sidecar calls");
  for (const value of cids) assert.ok(Array.isArray(value), `cids ${JSON.stringify(value)} is a list`);
});

test("the view page stores a loss that its bridge reports as an error event, and no count of open calls", async (t) => {
  const editor = await openEditor(t);
  editor.view.loss({ kind: "open-calls", plugin: "editor", count: 3 });
  editor.view.loss({ kind: "late-reply", plugin: "editor", id: 7 });
  await editor.until(() => editor.logs.some((entry) => entry.event === "page.error"));
  assert.deepEqual(editor.logs.filter((entry) => entry.event === "page.error").map((entry) => entry.fields),
    [{ where: "calls", error: 'late-reply {"id":7}' }]);
});

// E62-1: the view page disposes the editor on pagehide, so the close is recorded and the editor ends its watch with the view.
test("the view page disposes the editor on pagehide, so the close is recorded", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.read");
  await editor.close();
  assert.deepEqual(editor.logs.filter((entry) => entry.event === "close").map((entry) => entry.fields), [{ path: "src/main.js", pending: 0 }]);
});
