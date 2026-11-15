import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("the core compatibility documents state the engines.soksak that the package declares", () => {
  const statements = (file) => [...readFileSync(new URL(`../docs/spec/${file}`, import.meta.url), "utf8").matchAll(/`engines\.soksak: "([^"]*)"`/g)]
    .map((match) => match[1]);
  assert.deepEqual(
    { english: statements("core-compatibility.md"), korean: statements("core-compatibility.ko.md") },
    { english: [pkg.engines.soksak], korean: [pkg.engines.soksak] },
  );
});

// Core 0.0.41 is the core release that adds the surface of the view to each log record, which the content_frame event
// (plugin.editor.view.content_frame) requires (E62-3); earlier releases omit it, so the frame payload fails the event catalog.
// The package pins the plugin API of core 0.0.41 and runs its view bridge against that release (E62).
test("the package requires core 0.0.41, the core release that adds the view surface to each content frame record (E62-3)", () => {
  assert.equal(pkg.engines.soksak, "^0.0.41");
});

// A range ^0.0.z admits core 0.0.z and every later 0.0 release (core docs/spec/installation.md#versions-and-ranges), so the
// documents state the later releases and name no exclusion of them (E54).
test("the core compatibility documents state that the range admits every later 0.0 core release (E54)", () => {
  const first = /^\^(0\.0\.\d+)$/.exec(pkg.engines.soksak)?.[1];
  assert.ok(first, `engines.soksak ${pkg.engines.soksak} is not a range ^0.0.z`);
  const text = (file) => readFileSync(new URL(`../docs/spec/${file}`, import.meta.url), "utf8").replace(/\s+/g, " ");
  assert.ok(text("core-compatibility.md").includes(`admits core ${first} and every later 0.0 release`), "core-compatibility.md");
  assert.ok(text("core-compatibility.ko.md").includes(`core ${first}부터 그 뒤의 모든 0.0 release를 허용한다`), "core-compatibility.ko.md");
  for (const file of ["core-compatibility.md", "core-compatibility.ko.md"]) {
    assert.doesNotMatch(text(file), /unverified|검증하지 않은/, `${file} excludes the later releases`);
  }
});
