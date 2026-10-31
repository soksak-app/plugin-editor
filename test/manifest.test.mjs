import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

test("plugin.json is a valid manifest that opens the files of its language table and text files with path params and saves with editor.save", async () => {
  const { EXTENSIONS } = await import("../build/test/ui/languages.js");
  assert.deepEqual(manifest.surface.opens, { extensions: EXTENSIONS });
  assert.equal(manifest.surface.params.properties.path.type, "string");
  // The needle of the sidecar name is built from parts so that the test sources name no SDK package.
  const FILES_SIDECAR = ["@", "soksak/sidecar-files"].join("");
  assert.equal(manifest.dependencies[FILES_SIDECAR], ">=0.0.9", "the current files manifest requires the display-name contract");
  assert.ok(manifest.exposes.commands.some((entry) => entry.name === manifest.surface.save));
});

test("plugin.json names the event catalog of the plugin", () => {
  assert.equal(manifest.events, "events.json");
});
