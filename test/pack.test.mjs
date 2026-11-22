// The release holds every module that a shipped module imports (E68): the release is the file list of pnpm pack, and each
// relative import of a shipped JavaScript module, static or dynamic, names a file of that list.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { simple } from "acorn-walk";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function shippedFiles() {
  const listing = JSON.parse(execFileSync("pnpm", ["pack", "--dry-run", "--json"], { cwd: ROOT, encoding: "utf8" }));
  return new Set(listing.files.map((file) => file.path));
}

function relativeImports(source) {
  const specifiers = [];
  const add = (node) => {
    if (node.source?.type === "Literal" && typeof node.source.value === "string") specifiers.push(node.source.value);
  };
  simple(parse(source, { ecmaVersion: "latest", sourceType: "module" }), {
    ImportDeclaration: add,
    ExportNamedDeclaration: add,
    ExportAllDeclaration: add,
    ImportExpression: add,
  });
  return specifiers.filter((specifier) => specifier.startsWith("./") || specifier.startsWith("../"));
}

test("every relative import of a shipped module names a file of the release (E68)", { timeout: 60000 }, () => {
  const shipped = shippedFiles();
  const missing = [];
  for (const file of [...shipped].filter((name) => name.endsWith(".js")).sort()) {
    for (const specifier of relativeImports(readFileSync(path.join(ROOT, file), "utf8"))) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!shipped.has(target)) missing.push(`${file} imports ${specifier}, which the release does not hold`);
    }
  }
  assert.deepEqual(missing, []);
});
