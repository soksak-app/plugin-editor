// Exercises the test builder (scripts/build-test.mjs) in isolated fixtures: the UI imports it accepts and rewrites, and the imports it
// rejects with the reason of each rule. The plugin API specifiers of the UI are not rewritten: the build keeps them as written.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sdk = "@soksak/fixture-api";
const pluginApi = "@soksak/plugin-api/view";

/**
 * Creates a plugin folder with the build script, the manifest, the package file and the given sources. `ui` and `test` map each
 * file of the folder (relative path) to its source; `modules` is the extension modules of plugin.json, and `dependencies` the
 * packages that package.json declares.
 */
function fixture(t, { ui = {}, test: tests = {}, modules = {}, dependencies = {} }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "editor-build-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ["scripts", "test", "ui", "node_modules"]) fs.mkdirSync(path.join(directory, name), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(root, "node_modules/acorn")), path.join(directory, "node_modules/acorn"), "junction");
  fs.copyFileSync(path.join(root, "scripts/build-test.mjs"), path.join(directory, "scripts/build-test.mjs"));
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ type: "module", devDependencies: dependencies }));
  fs.writeFileSync(path.join(directory, "plugin.json"), JSON.stringify({ extends: { extension: { modules } } }));
  for (const [base, files] of [["ui", ui], ["test", tests]]) {
    for (const [name, source] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, base, name)), { recursive: true });
      fs.writeFileSync(path.join(directory, base, name), source);
    }
  }
  return directory;
}

function build(directory) {
  const result = spawnSync(process.execPath, [path.join(directory, "scripts/build-test.mjs")], { cwd: directory, encoding: "utf8" });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

test("the test build keeps the plugin API import of a UI source as written, because the import map of the application resolves it", (t) => {
  const directory = fixture(t, {
    ui: { "entry.js": `import { value } from ${JSON.stringify(pluginApi)};\nexport { value };\n` },
  });
  const result = build(directory);
  assert.equal(result.status, 0, result.stderr);
  const built = fs.readFileSync(path.join(directory, "build/test/ui/entry.js"), "utf8");
  assert.ok(built.includes(`from ${JSON.stringify(pluginApi)};`), "the built UI imports the plugin API specifier unchanged");
});

test("the test build resolves a shared extension module to its built bundle", async (t) => {
  const directory = fixture(t, {
    modules: { "@codemirror/state": "ui/vendor/state.js" },
    ui: {
      "vendor/state.js": "export const value = 1;\n",
      "entry.js": 'import { value } from "@soksak/shared/editor.extension/@codemirror/state.js";\nexport { value };\n',
    },
    test: { "entry.test.mjs": 'import { value } from "../build/test/ui/entry.js";\nexport { value };\n' },
  });
  const result = build(directory);
  assert.equal(result.status, 0, result.stderr);
  const built = await import(pathToFileURL(path.join(directory, "build/test/ui/entry.js")).href);
  assert.equal(built.value, 1, "the built UI resolves the shared module to its bundle");
});

test("the test build rejects a UI import of a package that package.json does not declare", (t) => {
  const directory = fixture(t, { ui: { "entry.js": `import { value } from ${JSON.stringify(sdk)};\nexport { value };\n` } });
  const result = spawnSync(process.execPath, [path.join(directory, "scripts/build-test.mjs")], { cwd: directory, encoding: "utf8" });
  assert.notEqual(result.status, 0, "the build accepted an undeclared UI dependency");
  assert.match(result.stderr, /UI imports an undeclared package @soksak\/fixture-api in build\/test\/ui\/entry\.js/);
});

test("the test build rejects a shared module import that plugin.json does not list", (t) => {
  const directory = fixture(t, { ui: { "entry.js": 'import "@soksak/shared/editor.extension/@codemirror/unlisted.js";\n' } });
  const result = spawnSync(process.execPath, [path.join(directory, "scripts/build-test.mjs")], { cwd: directory, encoding: "utf8" });
  assert.notEqual(result.status, 0, "the build accepted an unlisted shared module");
  assert.match(result.stderr, /unlisted shared module @soksak\/shared\/editor\.extension\/@codemirror\/unlisted\.js/);
});

test("the test build rejects a test source that imports UI source instead of the built UI", (t) => {
  const directory = fixture(t, {
    ui: { "entry.js": "export const value = 1;\n" },
    // The UI path is joined here, so that this source names no UI import of its own.
    test: { "entry.test.mjs": `import { value } from "${["..", "ui", "entry.js"].join("/")}";\nexport { value };\n` },
  });
  const result = spawnSync(process.execPath, [path.join(directory, "scripts/build-test.mjs")], { cwd: directory, encoding: "utf8" });
  assert.notEqual(result.status, 0, "the build accepted a test import of UI source");
  assert.match(result.stderr, /test imports UI source instead of build\/test\/ui: \.\.\/ui\/entry\.js in test[/\\]entry\.test\.mjs/);
});
