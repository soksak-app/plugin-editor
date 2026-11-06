// Exercise the actual test builder in isolated consumer fixtures, including its SDK boundary rejection.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdk = ["@", "soksak/fixture-api"].join("");
const namedImport = (specifier) => `import { value } from ${JSON.stringify(specifier)};\n`;
const dynamicImport = (specifier) => `import(${JSON.stringify(specifier)});\n`;

function fixture(t, testSource, { declared = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "editor-build-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ["scripts", "test/models", "ui", "node_modules"]) fs.mkdirSync(path.join(directory, name), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(root, "node_modules/acorn")), path.join(directory, "node_modules/acorn"), "junction");
  fs.copyFileSync(path.join(root, "scripts/build-test.mjs"), path.join(directory, "scripts/build-test.mjs"));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
  fs.writeFileSync(path.join(directory, "plugin.json"), JSON.stringify({ extends: { extension: { modules: {} } } }));
  fs.writeFileSync(path.join(directory, "scripts/test-sdk.json"), JSON.stringify({ modules: declared
    ? [{ specifier: sdk, exports: { value: { model: "test/models/api.mjs" } } }] : [] }));
  fs.writeFileSync(path.join(directory, "test/models/api.mjs"), "export const value = 1;\n");
  fs.writeFileSync(path.join(directory, "ui/entry.js"), namedImport(sdk) + "export { value };\n");
  fs.writeFileSync(path.join(directory, "test/entry.test.mjs"), testSource);
  return directory;
}

function build(directory) {
  const result = spawnSync(process.execPath, [path.join(directory, "scripts/build-test.mjs")], {
    cwd: directory, encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

test("the test build accepts declared UI models and consumer imports of the built UI", { timeout: 15000 }, async (t) => {
  const directory = fixture(t, namedImport("../build/test/ui/entry.js"));
  const result = build(directory);
  assert.equal(result.status, 0, result.stderr);
  const built = await import(pathToFileURL(path.join(directory, "build/test/ui/entry.js")).href);
  assert.equal(built.value, 1, "the emitted UI resolves the declared local model");
});

for (const [kind, source] of [
  ["scoped static", namedImport(sdk)],
  ["scoped dynamic", dynamicImport(sdk)],
  ["legacy static", namedImport("soksak")],
  ["legacy dynamic", dynamicImport("soksak")],
]) test(`the test build rejects a ${kind} SDK import in a consumer test`, { timeout: 15000 }, (t) => {
  const result = build(fixture(t, source));
  assert.notEqual(result.status, 0, "the build accepted a prohibited SDK import");
  assert.match(result.stderr, /test source names an SDK package: test[/\\]entry\.test\.mjs/);
});

test("the test build rejects a UI import without a declared SDK model", { timeout: 15000 }, (t) => {
  const result = build(fixture(t, namedImport("../build/test/ui/entry.js"), { declared: false }));
  assert.notEqual(result.status, 0, "the build accepted an undeclared UI dependency");
  assert.match(result.stderr, /unlisted SDK import/);
});
