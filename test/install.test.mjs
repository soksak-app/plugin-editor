// The installation stage is make install (core docs/spec/plugins.md#repositories): it installs the locked dependencies, and the
// tests, checks and packs consume what it installed without installing (F275-editor).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const makefile = readFileSync(new URL("../Makefile", import.meta.url), "utf8");

test("make install installs the locked dependencies, and no other target installs (F275-editor)", () => {
  const target = /^install:([^\n]*)\n((?:\t[^\n]*\n)+)/m.exec(makefile);
  assert.ok(target, "the Makefile has no install target");
  assert.deepEqual(target[2].trim().split("\n").map((line) => line.trim()), ["pnpm install --frozen-lockfile"]);
  assert.deepEqual(makefile.split("\n").filter((line) => /^[^\t#][^:=]*:(?!=).*\bnode_modules\b/.test(line)), [], "a target depends on node_modules");
});
