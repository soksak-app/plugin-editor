import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { loadDiagnostics } = await import("../build/test/ui/view-diagnostics.js");
const editorDiagnostics = await import("../build/test/ui/editor-diagnostics.js");
const declaration = JSON.parse(readFileSync(new URL("../diagnostics.json", import.meta.url), "utf8"));
const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const events = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));

test("diagnostic declaration and module stay out of the published editor package", { timeout: 5000 }, () => {
  assert.ok(packageManifest.files.includes("ui/view-diagnostics.js"));
  assert.ok(!packageManifest.files.includes("diagnostics.json"));
  assert.ok(!packageManifest.files.includes(declaration.module));
  assert.equal(declaration.exposes.commands[0].name, "editor.memory.hidden");
  assert.deepEqual(declaration.exposes.commands[0].params.properties.action.enum, ["read", "remove"]);
  assert.equal(declaration.exposes.commands[0].result.properties.historyEntries.type, "integer");
  assert.equal(declaration.exposes.commands[0].result.properties.regionHistoryEntries.type, "integer");
  assert.equal(declaration.exposes.commands[1].name, "editor.diagnostics.content-trace");
  assert.deepEqual(declaration.exposes.commands[1].params.properties.action.enum, ["start", "stop", "read"]);
  assert.equal(declaration.exposes.commands[1].result.properties.sequence.type, "integer");
  assert.equal(declaration.exposes.commands[1].result.properties.regionHistoryEntries.type, "integer");
  assert.deepEqual(declaration.exposes.commands[1].result.properties.sourceClock, {
    type: "object",
    properties: {
      documentTimeOriginMs: { type: "number" },
      sourceNowMs: { type: "number" },
      sourceResolutionMs: { type: "number" },
    },
  });
  assert.equal(events.events["plugin.editor.view.content_frame"].class, "frame");
  assert.equal(events.events["plugin.editor.view.content_frame"].level, "trace");
});

test("the diagnostic module owns the initial hidden editor lifecycle", () => {
  assert.equal(typeof editorDiagnostics.createHiddenEditorView, "function");
});

test("the diagnostic module owns an explicit content-frame measurement lifecycle", () => {
  assert.equal(typeof editorDiagnostics.createViewFrameMeasurement, "function");
});

test("a release editor view loads without a diagnostic declaration", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  t.after(() => { globalThis.fetch = originalFetch; });
  assert.equal(await loadDiagnostics("soksak://editor/ui/index.html"), null);
});

test("an installed diagnostic editor view loads its declaration and attach function", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => declaration });
  t.after(() => { globalThis.fetch = originalFetch; });
  const diagnostics = await loadDiagnostics("soksak://editor/ui/index.html");
  assert.deepEqual(diagnostics.declaration, declaration);
  assert.equal(typeof diagnostics.attach, "function");
});

test("an unreadable diagnostic declaration fails with its response status", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(loadDiagnostics("soksak://editor/ui/index.html"), /answered 503/);
});
