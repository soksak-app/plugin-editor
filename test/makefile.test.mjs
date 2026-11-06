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

test("make check runs the event source check of the kit and the document check of the kit", () => {
  assert.equal(recipe("check"), [
    "\tpnpm exec sok-check events --config event-sources.json --catalog events.json",
    "\tpnpm exec sok-check docs",
    "\tpnpm exec sok-check commands",
  ].join("\n"));
});

// A published commit is kept, so the push checks its message and the checklist history it carries (F274-editor, E52); CI runs
// the tests and checks on the pushed commits and the same push check on the range of its event.
test("make check-push runs only the commit message check and the checklist history check of the pushed range (F274-editor, E52)", () => {
  const header = makefile.split("\n").find((line) => line.startsWith("check-push:")) ?? "";
  assert.equal(header, "check-push:", header);
  assert.equal(recipe("check-push"), [
    '\tpnpm exec sok-check commits "$(or $(RANGE),origin/main..HEAD)"',
    '\tpnpm exec sok-check docs --range "$(or $(RANGE),origin/main..HEAD)"',
  ].join("\n"));
});

test("CI runs make check-push on the range of its event and no kit command of its own (E52)", () => {
  const ci = readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /^ {10}fetch-depth: 0$/m, "the checkout of ci.yml must fetch every commit of the pushed range");
  const step = /^ {6}- name: Pushed range\n {8}if: ([^\n]*)\n {8}run: ([^\n]*)$/m.exec(ci);
  assert.ok(step, "ci.yml has no Pushed range step");
  assert.equal(step[1], "github.event_name == 'pull_request' || github.event.before != '0000000000000000000000000000000000000000'");
  assert.equal(step[2], "make check-push RANGE=${{ github.event_name == 'pull_request' && format('{0}..{1}', github.event.pull_request.base.sha, github.event.pull_request.head.sha) || format('{0}..{1}', github.event.before, github.sha) }}");
  assert.doesNotMatch(ci, /sok-check/, "ci.yml must run the kit commands through the Makefile");
});

test("the pre-push hook runs make check-push on the pushed range (F238-c-25)", () => {
  const hook = readFileSync(path.join(ROOT, ".githooks", "pre-push"), "utf8");
  assert.match(hook, /make -C "\$root" check-push RANGE="\$base\.\.\$local_sha"/);
});
