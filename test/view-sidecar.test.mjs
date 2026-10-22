// The sidecar that the view page names in its sidecar calls is the one dependency that plugin.json declares (F238-c-13.4).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SIDECAR } from "../build/test/ui/view-sidecar.js";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));

test("the view page names the one sidecar dependency of plugin.json", () => {
  assert.deepEqual(Object.keys(manifest.dependencies), [SIDECAR]);
});
