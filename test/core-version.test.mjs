import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the core compatibility documents state the engines.soksak that the package declares", { timeout: 1000 }, () => {
  const statements = (file) => [...readFileSync(new URL(`../docs/spec/${file}`, import.meta.url), "utf8").matchAll(/`engines\.soksak: "([^"]*)"`/g)]
    .map((match) => match[1]);
  assert.deepEqual(
    { english: statements("core-compatibility.md"), korean: statements("core-compatibility.ko.md") },
    { english: [pkg.engines.soksak], korean: [pkg.engines.soksak] },
  );
});

// Core 0.0.39 and earlier accept only the exposes kinds status, commands and dom, so they refuse the exposes.element of
// plugin.json; 0.0.40 is the core release of F502-13 (F502-13-1), the next version that no core tag holds (E47).
test("the package requires core 0.0.40, the first core release that accepts exposes.element (E47)", { timeout: 1000 }, () => {
  assert.equal(pkg.engines.soksak, "^0.0.40");
});
