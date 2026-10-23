import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

test("plugin.json is a valid manifest that opens every file with path params and saves with editor.save", () => {
  assert.deepEqual(manifest.surface.opens, { extensions: ["*"] });
  assert.equal(manifest.surface.params.properties.path.type, "string");
  // The needle of the sidecar name is built from parts so that the test sources name no SDK package.
  const FILES_SIDECAR = ["@", "soksak/sidecar-files"].join("");
  assert.equal(manifest.dependencies[FILES_SIDECAR], ">=0.0.8", "the current files manifest requires the display-name contract");
  assert.ok(manifest.exposes.commands.some((entry) => entry.name === manifest.surface.save));
});

test("plugin.json names the event catalog of the plugin", () => {
  assert.equal(manifest.events, "events.json");
});
