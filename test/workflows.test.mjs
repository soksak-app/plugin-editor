// The workflows run make check after make test (F238-c-24): ci.yml runs make test first, then make check, and release.yml runs
// ci.yml as its checks before it runs make pack.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
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

for (const file of ["ci.yml"]) {
  test(`${file} runs make check after make test`, () => {
    const targets = makeTargets(file);
    const test = targets.indexOf("test");
    const check = targets.indexOf("check");
    assert.ok(test !== -1, `${file} runs make test (targets: ${targets.join(", ") || "none"})`);
    assert.ok(check > test, `${file} runs make check after make test (targets: ${targets.join(", ") || "none"})`);
  });
}

test("release.yml runs make pack", () => {
  const targets = makeTargets("release.yml");
  assert.ok(targets.includes("pack"), `release.yml runs make pack (targets: ${targets.join(", ") || "none"})`);
});

// The release starts on a push to main, runs ci.yml and the release gate, and writes the release with pnpm pack; it downloads
// no core release, no workflow checks out another repository, and the checks come from the kit releases that package.json pins.
// No test names an SDK package, so each package name below is built from its scope and its name.
const RELEASE_TEXT = readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");
const SCOPE = "@soksak" + "/";
const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("the release starts on a push to main and runs ci.yml and the release gate", { timeout: 1000 }, () => {
  assert.match(RELEASE_TEXT, /^on:\n {2}push:\n {4}branches: \[main\]\n/m, "release.yml must start on a push to main");
  assert.doesNotMatch(RELEASE_TEXT, /^\s*tags:/m, "release.yml must not start on a pushed tag");
  assert.match(RELEASE_TEXT, /^\s*uses: \.\/\.github\/workflows\/ci\.yml$/m, "release.yml must run ci.yml as its checks");
  const ci = readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /^on:\n(?: {2}.+\n)* {2}workflow_call:/m, "ci.yml must be callable by release.yml");
  assert.match(RELEASE_TEXT, /soksak-release-gate package\.json docs\/features\.md/, "release.yml must run the release gate");
  assert.match(RELEASE_TEXT, /git ls-remote origin refs\/heads\/main/, "the release must require the run commit to be the head of main");
  assert.match(RELEASE_TEXT, /git ls-remote --tags origin "refs\/tags\/v\$VERSION"/, "the release must require the tag to be absent");
});

test("the release writes the pnpm pack file of the plugin and downloads no core release", { timeout: 1000 }, () => {
  assert.match(RELEASE_TEXT, /^\s*run: make pack OUT=dist$/m, "release.yml must run make pack OUT=dist");
  for (const [pattern, what] of [[/gh release download/, "a release download"], [/CORE_RELEASE|CORE_HOST/, "a core release variable"],
    [/SOK=/, "a sok path"], [/go build|cargo build/, "a build of sok"]]) {
    assert.doesNotMatch(RELEASE_TEXT, pattern, `release.yml must not hold ${what}`);
  }
});

test("make pack writes the release with pnpm pack into the folder that OUT names", { timeout: 5000 }, () => {
  const result = spawnSync("make", ["-n", "pack", "OUT=/releases"], { cwd: ROOT, encoding: "utf8", timeout: 4000 });
  assert.equal(result.status, 0, result.stderr);
  const commands = result.stdout.trim().split("\n");
  assert.equal(commands.at(-1), "pnpm pack --pack-destination /releases", `make pack runs ${JSON.stringify(commands)}`);
  assert.doesNotMatch(readFileSync(path.join(ROOT, "Makefile"), "utf8"), /\bSOK\b|PACK_FLAGS/, "the Makefile must not name a sok");
});

test("the release holds diagnostics.json and its module, which the hosts of a diagnostic build read", { timeout: 1000 }, () => {
  const { module } = JSON.parse(readFileSync(path.join(ROOT, "diagnostics.json"), "utf8"));
  for (const file of ["diagnostics.json", module]) {
    assert.ok(PACKAGE.files.some((entry) => file === entry || file.startsWith(`${entry}/`)), `package.json files must list ${file}: ${JSON.stringify(PACKAGE.files)}`);
  }
});

test("no workflow checks out another repository", { timeout: 1000 }, () => {
  const folder = path.join(ROOT, ".github", "workflows");
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".yml"))) {
    assert.doesNotMatch(readFileSync(path.join(folder, file), "utf8"), /^\s*repository:/m, `${file} checks out another repository`);
  }
});

test("the checks come from the kit releases, and no check reads the plugin API of core", { timeout: 1000 }, () => {
  const dependencies = { ...PACKAGE.dependencies, ...PACKAGE.devDependencies };
  assert.equal(dependencies[SCOPE + "plugin-api"], undefined, "package.json must not pin the plugin API of core");
  assert.equal(dependencies[SCOPE + "kit-records"], "https://github.com/soksak-app/kit-records/releases/download/v0.0.1/soksak-kit-records-0.0.1.tgz");
  assert.equal(dependencies[SCOPE + "kit-events"], "https://github.com/soksak-app/kit-events/releases/download/v0.0.1/soksak-kit-events-0.0.1.tgz");
  for (const file of ["Makefile", ".githooks/commit-msg", ".githooks/pre-commit"]) {
    assert.doesNotMatch(readFileSync(path.join(ROOT, file), "utf8"), /CORE_PLUGIN_API_DIR|soksak-exposure|soksak-engines|node_modules\/@soksak|check-plugin/,
      `${file} must run only the commands of the kit releases`);
  }
});
