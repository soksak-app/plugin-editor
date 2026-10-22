// The workflows run make check after make test (F238-c-24): each workflow runs make test first, then make check.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The make targets that the run steps of a workflow file invoke, in order. */
function makeTargets(file) {
  return readFileSync(path.join(ROOT, ".github", "workflows", file), "utf8").split("\n")
    .map((line) => /^\s*-?\s*run:\s*(.*)$/.exec(line)?.[1] ?? "")
    .filter((command) => /^make(\s|$)/.test(command))
    .map((command) => command.split(/\s+/)[1]);
}

for (const file of ["ci.yml", "release.yml"]) {
  test(`${file} runs make check after make test`, () => {
    const targets = makeTargets(file);
    const test = targets.indexOf("test");
    const check = targets.indexOf("check");
    assert.ok(test !== -1, `${file} runs make test (targets: ${targets.join(", ") || "none"})`);
    assert.ok(check > test, `${file} runs make check after make test (targets: ${targets.join(", ") || "none"})`);
  });
}
