// The workflows run make check after make test (F238-c-24): ci.yml runs make test first, then make check, and release.yml runs
// ci.yml as its checks before it runs make pack.
import assert from "node:assert/strict";
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

// The release starts on a push to main, runs ci.yml and the release gate, and packs with the sok inside the application zip of the declared core release and host;
// no workflow checks out another repository, and the dependency on core is the packed release file of that core release
// (core docs/spec/plugins.md). The test finds that dependency by its address, so no test source names an SDK package.
const RELEASE_TEXT = readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8");

/** The core release that release.yml declares in CORE_RELEASE. */
function coreRelease() {
  const value = /^\s*CORE_RELEASE:\s*(\S+)\s*$/m.exec(RELEASE_TEXT)?.[1];
  assert.match(value ?? "", /^v\d+\.\d+\.\d+$/, `CORE_RELEASE must name a core release tag, found ${JSON.stringify(value)}`);
  return value;
}

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

test("the release packs with the sok inside the application zip of the declared core release and host", { timeout: 1000 }, () => {
  const tag = coreRelease();
  const host = /^\s*CORE_HOST:\s*(\S+)\s*$/m.exec(RELEASE_TEXT)?.[1];
  assert.match(host ?? "", /^(tauriv2|wailsv3)$/, `CORE_HOST must name a core host, found ${JSON.stringify(host)}`);
  assert.match(RELEASE_TEXT, /gh release download "\$CORE_RELEASE" --repo soksak-app\/core --pattern "soksak-\$\{CORE_RELEASE#v\}-darwin-arm64-\$CORE_HOST\.zip"/,
    `release.yml must download the application zip of ${tag} for ${host}`);
  assert.match(RELEASE_TEXT, /make pack SOK="\$RUNNER_TEMP\/core\/soksak\.app\/Contents\/MacOS\/sok"/, "release.yml must pack with the sok of the bundle");
  assert.doesNotMatch(RELEASE_TEXT, /'sok-\*-darwin-arm64'/, "release.yml must not download a separate sok");
  assert.doesNotMatch(RELEASE_TEXT, /go build/, "release.yml must not build sok from source");
});

test("no workflow checks out another repository", { timeout: 1000 }, () => {
  const folder = path.join(ROOT, ".github", "workflows");
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".yml"))) {
    assert.doesNotMatch(readFileSync(path.join(folder, file), "utf8"), /^\s*repository:/m, `${file} checks out another repository`);
  }
});

test("the dependency on core is the packed release file of the declared core release", { timeout: 1000 }, () => {
  const tag = coreRelease();
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const core = Object.values({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter((source) => source.includes("soksak-app/core"));
  assert.deepEqual(core, [`https://github.com/soksak-app/core/releases/download/${tag}/soksak-plugin-api-${tag.slice(1)}.tgz`]);
});
