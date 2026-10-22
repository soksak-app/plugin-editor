// The view page at the consumer boundary (E24): the page of the view carries the import map of the view, builds its
// surface context over the view channel, and mounts the editor module into the page. The host side of the channel is
// test/view-host.mjs, which serves the call route of a view as the core workbench answers it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sha } from "./fakes.mjs";
import { createViewPage } from "./view-host.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

const PAGE = new URL("../ui/index.html", import.meta.url);

test("the view page carries the import map of the view and the page script", () => {
  const html = readFileSync(PAGE, "utf8");
  // The entries of the map equal the view imports of the SDK; the check of make check compares them (scripts/check-plugin.mjs).
  const map = JSON.parse(html.match(/<script type="importmap">([^<]+)<\/script>/)[1]);
  assert.equal(Object.keys(map.imports).length, 4);
  assert.ok(Object.values(map.imports).every((target) => target.startsWith("sok://core/")));
  assert.match(html, /<script type="module" src="\.\/view\.js"><\/script>/);
});

test("the view page refuses to mount without the start values of the surface", async (t) => {
  const host = createViewPage(t, "no-start");
  host.window.sokSurface = null;
  await assert.rejects(import("../build/test/ui/view.js?case=no-start"),
    /the view of editor has no start values: the host provides window\.sokSurface/);
});

test("the view page refuses to mount without the declarations of the start values", async (t) => {
  const host = createViewPage(t, "no-declarations");
  host.window.sokSurface = Object.freeze({ surface: "editor-1", params: null, origin: null, project: null });
  await assert.rejects(import("../build/test/ui/view.js?case=no-declarations"),
    /window\.sokSurface \{surface, params, origin, project, declarations\}/);
});

test("the view page registers its exposure from the declarations of the start values", async (t) => {
  const { reports, settle } = createViewPage(t, "declarations");
  await import("../build/test/ui/view.js?case=declarations");
  await settle();
  const statuses = reports.native.filter(([name, payload]) => name === "registered" && payload.kind === "status")
    .map(([, payload]) => payload.name);
  assert.deepEqual(statuses.toSorted(), manifest.exposes.status.map((entry) => entry.name).toSorted());
});

test("the view page opens the file of its tab through the view channel", async (t) => {
  const { reports, logs, run, settle, sidecar } = createViewPage(t, "open");
  await import("../build/test/ui/view.js?case=open");
  assert.deepEqual(sidecar.sent.map((body) => body.operation), ["read", "watch"]);
  assert.equal(await run("editor.read"), "let a = 1;\n// TODO: b\n");
  // Every declared command of the plugin is registered through the channel, and the registrations of the statuses and
  // the dom names are the native calls of the surface.
  assert.deepEqual(reports.registered.toSorted(), manifest.exposes.commands.map((entry) => entry.name).toSorted());
  const kinds = reports.native.filter(([name]) => name === "registered").map(([, payload]) => payload.kind);
  assert.deepEqual([...new Set(kinds)].toSorted(), ["dom", "status"]);
  assert.deepEqual(reports.title, ["main.js"]);
  const open = logs.find((entry) => entry.event === "open");
  assert.equal(open.level, "info");
  assert.equal(open.fields.path, "src/main.js");
  assert.equal(open.fields.ok, true);
  await settle();
});

test("the view page answers a forwarded exposure request from its own values", async (t) => {
  const { reports, expose, settle } = createViewPage(t, "exposure");
  await import("../build/test/ui/view.js?case=exposure");
  await settle();
  const id = expose("status.get", { name: "editor.document" });
  await settle();
  const replies = reports.native.filter(([name, payload]) => name === "exposureReply" && payload.id === id);
  assert.equal(replies.length, 1, `the page answered the exposure request ${id} once`);
  assert.equal(replies[0][1].result.path, "src/main.js");
});

test("an uncaught error of the view page is an error event of the plugin", async (t) => {
  const { window, logs, settle } = createViewPage(t, "page-error");
  await import("../build/test/ui/view.js?case=page-error");
  await settle();
  window.dispatchEvent(new window.ErrorEvent("error", { error: new Error("boom"), message: "boom" }));
  await settle();
  assert.deepEqual(logs.filter((entry) => entry.event === "page.error"),
    [{ level: "error", event: "page.error", fields: { where: "page", error: "boom" } }]);
});

test("an edit of the view saves through the sidecar and reports the tab state", async (t) => {
  const { reports, run, settle, sidecar } = createViewPage(t, "save");
  await import("../build/test/ui/view.js?case=save");
  await run("editor.edit", { changes: [{ from: 8, to: 9, insert: "2" }] });
  assert.deepEqual(reports.modified, [false, true]);
  await run("editor.save");
  assert.deepEqual(sidecar.sent.map((body) => body.operation), ["read", "watch", "write"]);
  assert.deepEqual(reports.modified, [false, true, false]);
  assert.deepEqual(reports.error, [null]);
  assert.ok(reports.state.length > 0, "the page wrote the tab state of the view");
  await settle();
});

test("the first save of a blank document asks for its file through core.file.place", async (t) => {
  const files = new Map();
  const { reports, run, settle, sidecar } = createViewPage(t, "blank", { params: {}, files,
    place: () => ({ path: "notes/plan.md" }) });
  await import("../build/test/ui/view.js?case=blank");
  await run("editor.edit", { changes: [{ from: 0, to: 0, insert: "# plan\n" }] });
  await run("editor.save");
  assert.equal(files.get("notes/plan.md"), "# plan\n");
  assert.deepEqual(reports.placed, [["core.file.place", { name: "새 문서.txt" }]]);
  assert.deepEqual(sidecar.sent.map((body) => [body.operation, body.operation === "write" ? body.expect : body.paths]),
    [["write", null], ["watch", ["notes/plan.md"]]]);
  assert.deepEqual(reports.title, ["새 문서", "plan.md"]);
  await settle();
});

test("the theme of the view starts from the theme script and follows a change", async (t) => {
  const { window, post, settle } = createViewPage(t, "theme", { scheme: "light" });
  await import("../build/test/ui/view.js?case=theme");
  await settle();
  assert.equal(window.document.documentElement.style.colorScheme, "light");
  post({ sok: 1, event: "theme", data: { scheme: "dark", tokens: {} } });
  await settle();
  assert.equal(window.document.documentElement.style.colorScheme, "dark");
});

// F238-c-13.4: each sidecar call of the view page names the sidecar that plugin.json declares.
test("the view page names its declared sidecar in each sidecar call", async (t) => {
  const { reports, run, settle } = createViewPage(t, "sidecar-name");
  await import("../build/test/ui/view.js?case=sidecar-name");
  await run("editor.read");
  await settle();
  const declared = Object.keys(manifest.dependencies);
  assert.equal(declared.length, 1);
  assert.ok(reports.sidecarNames.length >= 2, "the page sent its sidecar calls");
  assert.deepEqual(reports.sidecarNames, reports.sidecarNames.map(() => declared[0]));
});

// E14: the page records its trace as the events of its catalog, and each sidecar send carries its correlation identifiers.
test("the view page records the open, save and watch trace as declared events", async (t) => {
  const { logs, run, sidecar, settle } = createViewPage(t, "trace");
  await import("../build/test/ui/view.js?case=trace");
  await run("editor.edit", { changes: [{ from: 8, to: 9, insert: "2" }] });
  await run("editor.save");
  sidecar.change("src/main.js", "changed on disk\n");
  await settle();
  const catalog = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8")).events;
  const events = logs.map((entry) => entry.event);
  for (const event of ["open", "save", "watch.start", "watch.change"]) {
    assert.ok(events.includes(event), `the page recorded ${event}; recorded ${events.join(", ")}`);
    assert.ok(Object.hasOwn(catalog, `plugin.editor.${event}`), `plugin.editor.${event} is declared`);
  }
});

test("each sidecar send of the view page carries its correlation identifiers", async (t) => {
  const { reports, run, settle } = createViewPage(t, "send-cids");
  await import("../build/test/ui/view.js?case=send-cids");
  await run("editor.read");
  await run("editor.save");
  await settle();
  assert.ok(reports.sendCids.length >= 2, "the page sent its sidecar calls");
  for (const cids of reports.sendCids) assert.ok(Array.isArray(cids), `cids ${JSON.stringify(cids)} is a list`);
});
