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
