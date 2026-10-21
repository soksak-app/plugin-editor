import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateManifest } from "@soksak/plugin-api";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

test("plugin.json is a valid manifest that opens every file with path params and saves with editor.save", () => {
  assert.equal(validateManifest(manifest), manifest);
  assert.deepEqual(manifest.surface.opens, { extensions: ["*"] });
  assert.equal(manifest.surface.params.properties.path.type, "string");
  assert.equal(manifest.dependencies["@soksak/sidecar-files"], ">=0.0.5", "readBytes requires files sidecar 0.0.5 or later");
  assert.ok(manifest.exposes.commands.some((entry) => entry.name === manifest.surface.save));
});

test("plugin.json names the event catalog of the plugin", () => {
  assert.equal(manifest.events, "events.json");
});
