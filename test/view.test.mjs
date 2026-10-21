// The view page at the consumer boundary (E24): the page of the view carries the import map of the view, builds its
// surface context over the view channel, and mounts the editor module into the page. The host side of the channel is
// test/view-host.mjs, which serves the call route of a view as the core workbench answers it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VIEW_IMPORTS, checkViewPage } from "@soksak/plugin-api";
import { sha } from "./fakes.mjs";
import { createViewPage } from "./view-host.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

const PAGE = new URL("../ui/index.html", import.meta.url);

test("the view page carries the import map of the view and the page script", () => {
  const html = readFileSync(PAGE, "utf8");
  assert.equal(checkViewPage(html), undefined);
  const map = JSON.parse(html.match(/<script type="importmap">([^<]+)<\/script>/)[1]);
  assert.deepEqual(map, { imports: VIEW_IMPORTS });
  assert.match(html, /<script type="module" src="\.\/view\.js"><\/script>/);
});

test("the view page refuses to mount without the start values of the surface", async (t) => {
  const host = createViewPage(t, "no-start");
  host.window.sokSurface = null;
  await assert.rejects(import("../ui/view.js?case=no-start"),
    /the view of editor has no start values: the host provides window\.sokSurface/);
});

test("the view page opens the file of its tab through the view channel", async (t) => {
  const { reports, logs, run, settle, sidecar } = createViewPage(t, "open");
  await import("../ui/view.js?case=open");
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

test("an edit of the view saves through the sidecar and reports the tab state", async (t) => {
  const { reports, run, settle, sidecar } = createViewPage(t, "save");
  await import("../ui/view.js?case=save");
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
  await import("../ui/view.js?case=blank");
  await run("editor.edit", { changes: [{ from: 0, to: 0, insert: "# plan\n" }] });
  await run("editor.save");
  assert.equal(files.get("notes/plan.md"), "# plan\n");
  assert.deepEqual(reports.placed, [["core.file.place", { name: "새 문서.txt" }]]);
  assert.deepEqual(sidecar.sent.map((body) => [body.operation, body.operation === "write" ? body.expect : body.paths]),
    [["write", null], ["watch", ["notes/plan.md"]]]);
  assert.deepEqual(reports.title, ["새 문서", "plan.md"]);
  await settle();
});

test("the theme of the view reaches the page through the queue and follows a change", async (t) => {
  const { window, post, settle } = createViewPage(t, "theme", { scheme: "light" });
  await import("../ui/view.js?case=theme");
  await settle();
  assert.equal(window.document.documentElement.style.colorScheme, "light");
  post({ sok: 1, event: "theme", data: { scheme: "dark", tokens: {} } });
  await settle();
  assert.equal(window.document.documentElement.style.colorScheme, "dark");
});
