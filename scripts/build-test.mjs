// Builds the test tree build/test/: a copy of ui/ whose SDK imports point to the test models of test/models/, whose
// shared extension imports point to the bundles that plugin.json declares, and whose vendored bundles import each other
// by the same relative paths. The table scripts/test-sdk.json lists each SDK export the UI imports and the model or value
// that stands in for it. Test sources may import only build/test/, never ui/ and never an SDK name.
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "build", "test");
const outputUI = path.join(outputRoot, "ui");
const outputFakes = path.join(outputRoot, "fakes");
const outputShared = path.join(outputRoot, "shared");
const POINT = "@soksak/shared/editor.extension/";
const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
const sharedModules = plugin.extends.extension.modules;
const table = JSON.parse(fs.readFileSync(path.join(root, "scripts", "test-sdk.json"), "utf8"));
const rel = (from, to) => {
  const value = path.relative(path.dirname(from), to).split(path.sep).join("/");
  return value.startsWith(".") ? value : "./" + value;
};
const relative = (file) => path.relative(root, file);

function walk(directory, filter) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file, filter) : filter(file) ? [file] : [];
  });
}

function parseModule(source, file) {
  try {
    return parse(source, { ecmaVersion: "latest", sourceType: "module" });
  } catch (error) {
    throw new Error(`test build cannot parse ${relative(file)}: ${error.message}`);
  }
}

/** Every import, export-from and dynamic import of a module: its specifier literal range, the names it takes and whether it is dynamic. */
function specifiersOf(source, file) {
  const found = [];
  const add = (literal, names, dynamic = false) => {
    if (literal === null || literal === undefined) return;
    if (literal.type !== "Literal" || typeof literal.value !== "string") {
      if (dynamic) { found.push({ dynamic: true }); return; }
      throw new Error(`test build cannot resolve a non-literal module specifier in ${relative(file)}`);
    }
    found.push({ specifier: literal.value, names, start: literal.start + 1, end: literal.end - 1, dynamic });
  };
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    if (node.type === "ImportDeclaration") {
      add(node.source, node.specifiers.map((specifier) => specifier.type === "ImportSpecifier"
        ? String(specifier.imported.name ?? specifier.imported.value)
        : specifier.type === "ImportDefaultSpecifier" ? "default" : "*"));
    } else if (node.type === "ExportNamedDeclaration" && node.source) {
      add(node.source, node.specifiers.map((specifier) => String(specifier.local.name ?? specifier.local.value)));
    } else if (node.type === "ExportAllDeclaration") {
      add(node.source, ["*"]);
    } else if (node.type === "ImportExpression") {
      add(node.source, [], true);
    }
    for (const [key, value] of Object.entries(node)) if (key !== "start" && key !== "end") visit(value);
  };
  visit(parseModule(source, file));
  return found.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

/** The names a module exports, for the table check of the models. */
function exportedNames(file) {
  const names = new Set();
  for (const statement of parseModule(fs.readFileSync(file, "utf8"), file).body) {
    if (statement.type === "ExportNamedDeclaration") {
      if (statement.declaration?.id) names.add(statement.declaration.id.name);
      if (statement.declaration?.declarations) for (const d of statement.declaration.declarations) names.add(d.id.name);
      for (const specifier of statement.specifiers) names.add(specifier.exported.name ?? specifier.exported.value);
    } else if (statement.type === "ExportDefaultDeclaration") {
      names.add("default");
    }
  }
  return names;
}

// The copied UI tree, rewritten below.
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
fs.cpSync(path.join(root, "ui"), outputUI, { recursive: true });

// The fake of each SDK module: the model of each export, or the declared value.
const fakeFiles = new Map();
table.modules.forEach((module, index) => {
  const file = path.join(outputFakes, `sdk-${index}.mjs`);
  const lines = [];
  for (const [name, entry] of Object.entries(module.exports)) {
    if (typeof entry.value === "string") {
      lines.push(`export const ${name} = ${JSON.stringify(entry.value)};`);
      continue;
    }
    const model = path.join(root, entry.model);
    if (!fs.existsSync(model)) throw new Error(`test build: model ${entry.model} for ${module.specifier}#${name} is missing`);
    if (!exportedNames(model).has(name)) throw new Error(`test build: model ${entry.model} does not export ${name}`);
    lines.push(`export { ${name} } from ${JSON.stringify(rel(file, model))};`);
  }
  fakeFiles.set(module.specifier, { file, exports: new Set(Object.keys(module.exports)) });
  fs.mkdirSync(outputFakes, { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n");
});

// Each declared shared module is served from the vendored bundle that plugin.json names for it.
const shared = new Map(Object.entries(sharedModules).map(([name, file]) => [name, path.join(root, file.replace("ui/", "build/test/ui/"))]));
for (const [name, file] of shared) {
  const target = path.join(outputShared, `${name}.js`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const names = exportedNames(file);
  const lines = [`export * from ${JSON.stringify(rel(target, file))};`];
  if (names.has("default")) lines.push(`export { default } from ${JSON.stringify(rel(target, file))};`);
  fs.writeFileSync(target, lines.join("\n") + "\n");
}

let rewritten = 0;
let dynamicImports = 0;
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => "node:" + name)]);
for (const file of walk(outputUI, (name) => name.endsWith(".js"))) {
  const source = fs.readFileSync(file, "utf8");
  const replacements = [];
  for (const item of specifiersOf(source, file)) {
    if (item.dynamic && item.specifier === undefined) { dynamicImports += 1; continue; }
    if (item.dynamic) { dynamicImports += 1; continue; }
    const specifier = item.specifier;
    if (specifier.startsWith(POINT)) {
      const name = specifier.slice(POINT.length, -".js".length);
      const target = shared.get(name);
      if (!specifier.endsWith(".js") || !target) throw new Error(`unlisted shared module ${specifier} in ${relative(file)}`);
      replacements.push({ ...item, value: rel(file, target) });
      continue;
    }
    if (specifier === "soksak" || specifier.startsWith("@soksak/")) {
      const module = fakeFiles.get(specifier);
      if (!module) throw new Error(`unlisted SDK import ${specifier} in ${relative(file)}`);
      for (const name of item.names) {
        if (!module.exports.has(name)) throw new Error(`unlisted SDK export ${specifier}#${name} in ${relative(file)}`);
      }
      replacements.push({ ...item, value: rel(file, module.file) });
      continue;
    }
    if (specifier.startsWith(".") || builtins.has(specifier)) continue;
    throw new Error(`UI imports an unlisted package ${specifier} in ${relative(file)}`);
  }
  if (replacements.length === 0) continue;
  let next = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, replacement.start) + replacement.value + next.slice(replacement.end);
  }
  fs.writeFileSync(file, next);
  rewritten += replacements.length;
}

// Test sources import only the build tree; no test names an SDK package.
for (const file of walk(path.join(root, "test"), (name) => /\.(?:mjs|js)$/.test(name))) {
  const source = fs.readFileSync(file, "utf8");
  if (source.includes("@soksak/") || /(?:from|import\()\s*["']soksak["']/.test(source)) {
    throw new Error(`test source names an SDK package: ${relative(file)}`);
  }
  for (const item of specifiersOf(source, file)) {
    if (item.dynamic || item.specifier === undefined) continue;
    if (!item.specifier.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), item.specifier.split(/[?#]/, 1)[0]);
    if (target.startsWith(path.join(root, "ui") + path.sep) || target === path.join(root, "ui")) {
      throw new Error(`test imports UI source instead of build/test/ui: ${item.specifier} in ${relative(file)}`);
    }
  }
}

console.log(`Built test UI tree: ${walk(outputUI, () => true).length} files, ${rewritten} rewritten imports, ${shared.size} shared modules, ${table.modules.reduce((n, m) => n + Object.keys(m.exports).length, 0)} SDK exports, ${dynamicImports} runtime imports`);
