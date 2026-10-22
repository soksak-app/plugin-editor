// The Makefile separates the plugin tests (make test) from the SDK checks (make check), so that make test runs no SDK tool.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const makefile = readFileSync(path.join(ROOT, "Makefile"), "utf8");

/** The recipe lines of a target: the lines after its header that start with a tab. */
function recipe(name) {
  const lines = makefile.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${name}:`));
  assert.notEqual(start, -1, `the Makefile has no ${name} target`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("\t")) break;
    body.push(line);
  }
  return body.join("\n");
}

test("make test runs the plugin tests and no SDK tool (F238-c-23)", () => {
  const body = recipe("test");
  assert.equal(body.includes("soksak-"), false, body);
  assert.match(body, /pnpm test/);
});

test("make check runs the pinned SDK tools (F238-c-23)", () => {
  const body = recipe("check");
  assert.match(body, /soksak-exposure/);
  assert.match(body, /soksak-engines/);
  assert.match(body, /soksak-events/);
  assert.match(body, /soksak-records/);
  assert.match(body, /scripts\/check-plugin\.mjs/);
});
