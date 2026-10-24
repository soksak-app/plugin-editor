import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the editor package requires only core candidate 0.0.21", { timeout: 1000 }, () => {
  assert.equal(pkg.engines.soksak, "^0.0.21");
});
