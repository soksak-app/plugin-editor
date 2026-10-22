// The SDK checks of this plugin (make check): the manifest validator, the view page against the view imports of the SDK,
// the copied contract cases of test/fixtures/contract against the published contract of the SDK, and the table of the test
// SDK surfaces (scripts/test-sdk.json). The SDK is read here, never by the tests. CORE_PLUGIN_API_DIR names the
// packages/plugin-api source of core when the installed release does not publish contract/ or view.js.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest, checkViewPage, VIEW_IMPORTS, INSTALLED_PLUGINS } from "@soksak/plugin-api";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.resolve(process.env.CORE_PLUGIN_API_DIR || path.join(root, "node_modules", "@soksak", "plugin-api"));
const manifest = JSON.parse(readFileSync(path.join(root, "plugin.json"), "utf8"));
const table = JSON.parse(readFileSync(path.join(root, "scripts", "test-sdk.json"), "utf8"));
const fixtures = path.join(root, "test", "fixtures", "contract");

assert.equal(validateManifest(manifest), manifest, "plugin.json is not a valid manifest");
console.log("Manifest check passed: plugin.json");

const html = readFileSync(path.join(root, "ui", "index.html"), "utf8");
assert.equal(checkViewPage(html), undefined, "ui/index.html is not a view page");
const map = JSON.parse(html.match(/<script type="importmap">([^<]+)<\/script>/)[1]);
assert.deepEqual(map, { imports: VIEW_IMPORTS }, "the import map of ui/index.html differs from the view imports of the SDK");
console.log("View page check passed: ui/index.html");

let copies = 0;
for (const file of readdirSync(fixtures).filter((name) => name.endsWith(".json"))) {
  const published = path.join(apiDir, "contract", file);
  if (!existsSync(published)) {
    throw new Error(`the API package at ${apiDir} does not publish contract/${file}; set CORE_PLUGIN_API_DIR to the packages/plugin-api source of core`);
  }
  assert.deepEqual(JSON.parse(readFileSync(path.join(fixtures, file), "utf8")), JSON.parse(readFileSync(published, "utf8")),
    `test/fixtures/contract/${file} differs from the published contract/${file}`);
  copies += 1;
}
console.log(`Contract copy check passed: ${copies} copied files match the published contract`);

const gaps = [];
for (const module of table.modules) {
  for (const [name, entry] of Object.entries(module.exports)) {
    if (typeof entry.value === "string") {
      const sdkValue = module.specifier === "@soksak/plugin-api" && name === "INSTALLED_PLUGINS" ? INSTALLED_PLUGINS : undefined;
      assert.equal(entry.value, sdkValue, `${module.specifier}#${name} differs from the SDK`);
      continue;
    }
    if (entry.cases.length === 0) gaps.push(`${module.specifier}#${name}: ${entry.gap ?? "no published case"}`);
    for (const file of entry.cases) {
      assert.ok(existsSync(path.join(fixtures, file)), `${module.specifier}#${name} names the missing copy ${file}`);
    }
  }
}
if (gaps.length > 0) {
  throw new Error(`test SDK surfaces without a published case: ${gaps.join("; ")}`);
}
console.log(`Test SDK table check passed: ${table.modules.reduce((n, m) => n + Object.keys(m.exports).length, 0)} exports`);
