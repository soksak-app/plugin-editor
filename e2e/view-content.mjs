// Reads the shown content of an editor view through the public value that holds it (editor.read), checks that the host presents the
// document that shows it, and declares the content case of a measurement: a text file of the project that the editor opens.
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { valueProof } from "@soksak/window-check/view-content.mjs";

/** The text of the content case of an editor measurement. */
export const EDITOR_TEXT = "SOKSAK EDITOR CONTENT";

/** The visible document region `document` of surface in host.window, or a failure that names what it holds. */
async function visibleDocument(s, surface, document) {
  const host = await s.get("host.window");
  const row = host.documents.find((item) => item.surface === surface && item.document === document);
  assert.ok(row?.visible && row.frame.width > 0 && row.frame.height > 0,
    `${surface} shows no document region ${JSON.stringify(document)}: ${JSON.stringify(row)}`);
  return row;
}

/**
 * The text that the editor view of surface holds as its shown content, the document text (editor.read), in its visible root document.
 * The caller waits for the presentation of the window (host.window.presented) after this read.
 */
export async function readEditorContent(s, surface) {
  await visibleDocument(s, surface, "");
  return s.run("editor.read", {}, surface);
}

/** Reads the content of surface (readEditorContent) and returns the proof that it holds expected (valueProof). */
export async function editorContentProof(s, surface, expected) {
  return valueProof(expected, await readEditorContent(s, surface), `editor ${surface}`);
}

/**
 * The content case of an editor measurement: a file of the project that holds EDITOR_TEXT, removed by the cleanups of the session,
 * as `{ params, ready }`. `ready(_, { tab })` waits until the tab read the file and shows its content region and returns the content
 * check, which reads the content after the display.
 */
export async function editorContentCase(s, diagnostic) {
  const { root } = await s.get("core.project");
  const folder = `view-content-${process.pid}`;
  mkdirSync(join(root, folder));
  s.cleanup(() => rmSync(join(root, folder), { recursive: true, force: true }));
  const path = `${folder}/content.txt`;
  writeFileSync(join(root, path), `${EDITOR_TEXT}\n`);
  return {
    params: { path },
    ready: async (_, { tab }) => {
      await s.until("core.surfaces", (all) => all.some((item) => item.surface === tab && item.exposes.includes("status editor.document")),
        `${tab} did not register editor.document`);
      await s.until("editor.document", (value) => value.path === path && value.length === EDITOR_TEXT.length + 1,
        `${tab} did not reach editor.document readiness`, { surface: tab });
      const rect = await s.rect("editor.content", undefined, tab);
      assert.ok(rect.width > 0 && rect.height > 0, `${tab}: editor.content has no visible area`);
      return async () => {
        await editorContentProof(s, tab, EDITOR_TEXT);
        diagnostic(`editor ${tab} shows ${JSON.stringify(EDITOR_TEXT)}`);
      };
    },
  };
}
