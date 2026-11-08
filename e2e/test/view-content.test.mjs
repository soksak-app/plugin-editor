// Unit checks of the content reader of the editor view (e2e/view-content.mjs) over a fake session.
import assert from "node:assert/strict";
import test from "node:test";
import { editorContentProof } from "../view-content.mjs";

/** A session whose host.window shows the root document of the surface `probe`; `runs` answers each command by name. */
function session(runs, { visible = true } = {}) {
  const host = { documents: [{ surface: "probe", document: "", visible, frame: { x: 0, y: 0, width: 100, height: 50 } }] };
  return {
    get: async (name) => { assert.equal(name, "host.window"); return host; },
    run: async (name, params, surface) => {
      assert.equal(surface, "probe");
      assert.ok(name in runs, `unexpected command ${name}`);
      return runs[name](params);
    },
  };
}

test("editor content reads the document text that the view holds", { timeout: 5000 }, async () => {
  assert.deepEqual(await editorContentProof(session({ "editor.read": () => "SOKSAK EDITOR CONTENT\n" }), "probe", "SOKSAK EDITOR CONTENT"),
    { method: "value", expected: "SOKSAK EDITOR CONTENT", actual: "SOKSAK EDITOR CONTENT\n" });
});

test("editor content refuses other text, a value that is not text and a hidden root document", { timeout: 5000 }, async () => {
  await assert.rejects(editorContentProof(session({ "editor.read": () => "OTHER\n" }), "probe", "SOKSAK EDITOR CONTENT"),
    /does not show "SOKSAK EDITOR CONTENT": "OTHER\\n"/);
  await assert.rejects(editorContentProof(session({ "editor.read": () => null }), "probe", "SOKSAK EDITOR CONTENT"), /content is not text/);
  await assert.rejects(editorContentProof(session({ "editor.read": () => "SOKSAK EDITOR CONTENT\n" }, { visible: false }), "probe",
    "SOKSAK EDITOR CONTENT"), /shows no document region ""/);
});
