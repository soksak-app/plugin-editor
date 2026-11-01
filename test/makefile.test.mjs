// The Makefile separates the plugin tests (make test) from the checks of the kit releases (make check), so that make test runs no kit tool.
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

test("make test runs the plugin tests and no kit tool (F238-c-23)", () => {
  const body = recipe("test");
  assert.equal(body.includes("soksak-"), false, body);
  assert.match(body, /pnpm test/);
});

test("make check runs the census check of the events kit and the record check of the records kit", () => {
  assert.equal(recipe("check"), [
    "\tpnpm exec soksak-events --census census.json --catalog events.json",
    "\tpnpm exec soksak-records",
  ].join("\n"));
});

// A published commit message is kept, so the push checks it; CI runs the tests and checks on the pushed commits.
test("make push-check runs only the commit message check of the pushed range (F274-editor)", () => {
  const header = makefile.split("\n").find((line) => line.startsWith("push-check:")) ?? "";
  assert.equal(header, "push-check:", header);
  assert.match(recipe("push-check"), /pnpm exec soksak-commits "\$\(or \$\(RANGE\),origin\/main\.\.HEAD\)"/);
});

test("the pre-push hook runs make push-check on the pushed range (F238-c-25)", () => {
  const hook = readFileSync(path.join(ROOT, ".githooks", "pre-push"), "utf8");
  assert.match(hook, /make -C "\$root" push-check RANGE="\$base\.\.\$local_sha"/);
});
