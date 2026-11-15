// Builds the test tree build/test/: a copy of ui/ whose shared extension imports point to the bundles that plugin.json declares,
// and a re-export of each shared module under build/test/shared/. This is plugin functionality, not SDK functionality: the
// editor's extension modules (@codemirror/*, @lezer/*, ...) are listed in plugin.json extends, and the UI imports them through
// @soksak/shared/editor.extension/<package>.js, which the host serves from the vendored bundles. The SDK imports of ui/ (the
// @soksak/plugin-api package and its subpaths) are not rewritten: node resolves them to the SDK release that package.json pins,
// and the tests run the real page modules of ui/ through that release's view test host (openView).
// Test sources import the pages only from build/test/ui/, never from ui/.
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "build", "test");
const outputUI = path.join(outputRoot, "ui");
const outputShared = path.join(outputRoot, "shared");
const POINT = "@soksak/shared/editor.extension/";
const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
const sharedModules = plugin.extends.extension.modules;
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

/** Every import, export-from, export-all and dynamic import of a module: its specifier literal range and whether it is dynamic. */
function specifiersOf(source, file) {
  const found = [];
  const add = (literal, dynamic = false) => {
    if (literal === null || literal === undefined) return;
    if (literal.type !== "Literal" || typeof literal.value !== "string") {
      if (dynamic) return;
      throw new Error(`test build cannot resolve a non-literal module specifier in ${relative(file)}`);
    }
    found.push({ specifier: literal.value, start: literal.start + 1, end: literal.end - 1, dynamic });
  };
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    if (node.type === "ImportDeclaration" || (node.type === "ExportNamedDeclaration" && node.source) || node.type === "ExportAllDeclaration") {
      add(node.source);
    } else if (node.type === "ImportExpression") {
      add(node.source, true);
    }
    for (const [key, value] of Object.entries(node)) if (key !== "start" && key !== "end") visit(value);
  };
  visit(parseModule(source, file));
  return found.sort((a, b) => a.start - b.start);
}

/** The names a module exports, to check that a re-export names an export of its target. */
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
    const specifier = item.specifier;
    if (item.dynamic) dynamicImports += 1;
    if (specifier.startsWith(POINT)) {
      const name = specifier.slice(POINT.length, -".js".length);
      const target = shared.get(name);
      if (!specifier.endsWith(".js") || !target) throw new Error(`unlisted shared module ${specifier} in ${relative(file)}`);
      replacements.push({ ...item, value: rel(file, target) });
      continue;
    }
    if (specifier.startsWith(".") || builtins.has(specifier)) continue;
    // A package of the UI resolves only from a dependency that package.json declares; the SDK is one of them.
    const name = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
    if (!declared.has(name)) throw new Error(`UI imports an undeclared package ${specifier} in ${relative(file)}`);
  }
  if (replacements.length === 0) continue;
  let next = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, replacement.start) + replacement.value + next.slice(replacement.end);
  }
  fs.writeFileSync(file, next);
  rewritten += replacements.length;
}

// Test sources import the pages only from the build tree.
for (const file of walk(path.join(root, "test"), (name) => /\.(?:mjs|js)$/.test(name))) {
  const source = fs.readFileSync(file, "utf8");
  for (const item of specifiersOf(source, file)) {
    if (!item.specifier.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), item.specifier.split(/[?#]/, 1)[0]);
    if (target.startsWith(path.join(root, "ui") + path.sep) || target === path.join(root, "ui")) {
      throw new Error(`test imports UI source instead of build/test/ui: ${item.specifier} in ${relative(file)}`);
    }
  }
}

console.log(`Built test UI tree: ${walk(outputUI, () => true).length} files, ${rewritten} rewritten shared imports, ${shared.size} shared modules, ${dynamicImports} runtime imports`);
