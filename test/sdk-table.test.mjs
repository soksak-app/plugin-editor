// The case lists of scripts/test-sdk.json: each SDK export lists the copied case files of test/fixtures/contract/ that its
// model replays. Each listed file exists, its surface names that export, and the replay tests replay exactly the listed files.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const table = JSON.parse(readFileSync(new URL("../scripts/test-sdk.json", import.meta.url), "utf8"));
const contract = (file) => new URL(`./fixtures/contract/${file}`, import.meta.url);
const entries = table.modules.flatMap(({ specifier, exports }) =>
  Object.entries(exports).map(([name, entry]) => ({ specifier, name, key: `${specifier}#${name}`, ...entry })));

/** The module of the plugin API that a specifier names: the package root is index.js, and a subpath is its file. */
const moduleOf = (specifier) => {
  const subpath = specifier.split("/").slice(2);
  return subpath.length === 0 ? "index.js" : `${subpath.join("/")}.js`;
};

test("each case file that the table lists is a copy in test/fixtures/contract", () => {
  assert.equal(new Set(entries.map(({ name }) => name)).size, entries.length, "each export name is listed once");
  for (const { key, cases } of entries) {
    for (const file of cases) assert.ok(existsSync(contract(file)), `${key}: test/fixtures/contract/${file} is missing`);
  }
});

test("the surface of each listed case file names its export", () => {
  const wrong = [];
  for (const { specifier, name, key, cases } of entries) {
    for (const file of cases) {
      // A surface is <module path>, or <module path>#<export> with the member it covers after a space.
      const { surface } = JSON.parse(readFileSync(contract(file), "utf8"));
      const [, path, symbol] = /^packages\/plugin-api\/(\S+?\.js)(?:#(\S+))?/.exec(surface) ?? [];
      const names = symbol === undefined ? path === moduleOf(specifier) : symbol === name;
      if (!names) wrong.push(`${key}: ${file} has the surface ${surface}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("the replay tests of the models replay exactly the listed case files, through the table", () => {
  const models = new Set(entries.filter((entry) => entry.model).map((entry) => entry.model.replace(/^test\//, "./")));
  const replayed = new Map(entries.map(({ name }) => [name, new Set()]));
  const wrong = [];
  const directory = new URL("./", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".test.mjs")).sort()) {
    const source = readFileSync(new URL(file, directory), "utf8");
    for (const [, name] of source.matchAll(/(?:casesOf|contractsOf)\("([^"]+)"\)/g)) {
      if (replayed.has(name)) for (const listed of entries.find((entry) => entry.name === name).cases) replayed.get(name).add(listed);
      else wrong.push(`${file} replays ${name}, which the table does not list`);
    }
    const importsModel = [...source.matchAll(/from "(\.\/models\/[^"]+)"/g)].some(([, path]) => models.has(path));
    for (const [read] of importsModel ? source.matchAll(/fixtures\/contract\/[^"`'\s)]*/g) : []) {
      wrong.push(`${file} reads ${read} without the table`);
    }
  }
  for (const { name, key, cases } of entries) {
    const files = [...replayed.get(name)].toSorted().join(", ");
    if (files !== [...cases].toSorted().join(", ")) wrong.push(`${key} lists [${cases.join(", ")}] and is replayed with [${files}]`);
  }
  assert.deepEqual(wrong, []);
});
