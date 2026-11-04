// The copies of test/fixtures/contract are the declared contract copies: contract-copies.json names each copy with its
// SHA-256, and the release carries that declaration. The registry check compares each declared digest with the
// contract file of the same name in the plugin API release of each listed core; this test compares the declaration
// with the copies, so a copy changes only together with its digest.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const declaration = () => JSON.parse(readFileSync(new URL("contract-copies.json", root), "utf8"));
const copies = new URL("test/fixtures/contract/", root);

test("the declaration names its copies in sorted order", () => {
  const names = Object.keys(declaration());
  assert.deepEqual(names, [...names].sort());
});

test("the copies are the declared copies", () => {
  assert.deepEqual(readdirSync(copies).sort(), Object.keys(declaration()).sort());
});

test("each copy has its declared SHA-256", () => {
  const declared = declaration();
  const names = Object.keys(declared);
  const digests = Object.fromEntries(names.map((name) => [name, createHash("sha256").update(readFileSync(new URL(name, copies))).digest("hex")]));
  assert.deepEqual(digests, declared);
});

test("the release carries the declaration", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.ok(pkg.files.includes("contract-copies.json"), "package.json files does not list contract-copies.json");
});
