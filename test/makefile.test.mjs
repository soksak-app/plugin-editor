// The Makefile separates the plugin tests (make test) from the SDK checks (make check), so that make test runs no SDK tool.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

test("make check runs its selected SDK tools (F238-c-23)", () => {
  const body = recipe("check");
  for (const checker of ["EXPOSURE", "ENGINES", "EVENTS", "RECORDS"]) assert.match(body, new RegExp(`\\$\\(SDK_${checker}\\)`));
  for (const checker of ["exposure", "engines", "events", "records"]) {
    assert.match(makefile, new RegExp(`pnpm exec soksak-${checker}`));
  }
  assert.match(body, /scripts\/check-plugin\.mjs/);
});

test("make check uses the declared SDK override for every validator", { timeout: 5000 }, () => {
  const apiDir = "/tmp/core api/packages/plugin-api";
  const output = execFileSync("make", ["-n", "-C", ROOT, "check", `CORE_PLUGIN_API_DIR=${apiDir}`], { encoding: "utf8" });
  for (const checker of ["engines", "exposure", "events", "records"]) {
    assert.ok(output.includes(`node "${apiDir}/${checker}-check.js"`),
      `make check did not select the declared SDK ${checker} CLI:\n${output}`);
    assert.equal(output.includes(`pnpm exec soksak-${checker}`), false,
      `make check selected the installed SDK ${checker} CLI despite CORE_PLUGIN_API_DIR`);
  }
  assert.ok(output.includes(`CORE_PLUGIN_API_DIR="${apiDir}" node scripts/check-plugin.mjs`),
    `make check did not pass the declared SDK path to its manifest and contract checker:\n${output}`);
});

test("make check keeps installed SDK CLIs when no override is declared", { timeout: 5000 }, () => {
  const output = execFileSync("make", ["-n", "-C", ROOT, "check"], { encoding: "utf8" });
  for (const checker of ["exposure", "engines", "events", "records"]) {
    assert.ok(output.includes(`pnpm exec soksak-${checker}`),
      `make check no longer selects the installed SDK ${checker} CLI:\n${output}`);
  }
});

test("make push-check runs make test, make check and the commit message check of the pushed range (F238-c-25)", () => {
  const header = makefile.split("\n").find((line) => line.startsWith("push-check:")) ?? "";
  assert.match(header, /\btest\b/, header);
  assert.match(header, /\bcheck\b/, header);
  assert.match(recipe("push-check"), /pnpm exec soksak-commits "\$\(or \$\(RANGE\),origin\/main\.\.HEAD\)"/);
});

test("the pre-push hook runs make push-check on the pushed range (F238-c-25)", () => {
  const hook = readFileSync(path.join(ROOT, ".githooks", "pre-push"), "utf8");
  assert.match(hook, /make -C "\$root" push-check RANGE="\$base\.\.\$local_sha"/);
});
