// Rules of the test sources of this repository: no test names an SDK package, the UI runs from the build tree only, no
// resolver hook is loaded, the shared modules come from the build tree, and the view host reads no SDK file.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The needle is built from parts so that this file names no SDK package.
const NEEDLE = ["@", "soksak/"].join("");
const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TEST_ROOT);

function sourcesOf(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourcesOf(file);
    return /\.(?:mjs|js)$/.test(entry.name) ? [file] : [];
  });
}

const relative = (file) => path.relative(ROOT, file);
const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("no test source names an SDK package (F238-c-13, F238-c-28)", () => {
  const named = sourcesOf(TEST_ROOT).filter((file) => readFileSync(file, "utf8").includes(NEEDLE)).map(relative);
  assert.deepEqual(named, []);
});

test("the tests import the UI from the build tree and the models, never from ui/ (F238-c-13)", () => {
  const direct = sourcesOf(TEST_ROOT).filter((file) => /(?:from|import\()\s*["'](?:\.\.\/)+ui\//.test(readFileSync(file, "utf8")))
    .map(relative);
  assert.deepEqual(direct, []);
});

test("the test script loads no resolver hook (F238-c-15)", () => {
  assert.equal(existsSync(path.join(TEST_ROOT, "shared-modules.mjs")), false);
  assert.equal(packageJson.scripts.test.includes("--import"), false, packageJson.scripts.test);
});

test("the shared modules are imported from the build tree (F238-c-16)", () => {
  const imported = sourcesOf(TEST_ROOT).filter((file) => /(?:from|import\()\s*["'](?:\.\.\/)+build\/test\/shared\//.test(readFileSync(file, "utf8")))
    .map(relative);
  assert.ok(imported.length >= 2, `shared modules imported from build/test/shared/ in ${imported.join(", ") || "no file"}`);
});

test("the view host reads no SDK file and runs no SDK script (F238-c-17)", () => {
  const host = readFileSync(path.join(TEST_ROOT, "view-host.mjs"), "utf8");
  assert.equal(host.includes("require.resolve"), false, "view-host.mjs resolves an SDK package");
  assert.equal(/readFileSync\(new URL\(["']\.\/view-start/.test(host), false, "view-host.mjs reads the view script of the SDK");
});
