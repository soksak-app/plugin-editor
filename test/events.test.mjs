import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { createEmitter } = await import("../build/test/ui/events.js");
const pack = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const LEVELS = ["error", "warn", "info", "debug", "trace"];
const CLASSES = ["lifecycle", "input", "call", "io", "frame"];
const TYPES = ["string", "number", "boolean", "array", "object", "null"];

/** A runtime whose log functions record the calls. */
function fakeRuntime() {
  const calls = [];
  return { calls, log: Object.fromEntries(LEVELS.map((level) => [level, (event, fields) => calls.push({ level, event, fields: typeof fields === "function" ? fields() : fields })])) };
}

test("the emitter strips the plugin prefix and calls the log function of the level", () => {
  const runtime = fakeRuntime();
  const emitEvent = createEmitter(runtime, "editor");
  emitEvent("warn", "plugin.editor.save", { path: "a.js", ok: false });
  assert.deepEqual(runtime.calls, [{ level: "warn", event: "save", fields: { path: "a.js", ok: false } }]);
});

test("the emitter refuses a name outside the plugin and a level that does not exist", () => {
  const emitEvent = createEmitter(fakeRuntime(), "editor");
  assert.throws(() => emitEvent("info", "plugin.hwp.save", {}), /plugin\.editor\./);
  assert.throws(() => emitEvent("loud", "plugin.editor.save", {}), /level/);
});

test("the release holds the catalog, and every entry follows the catalog form", () => {
  assert.ok(pack.files.includes("events.json"));
  const catalog = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));
  assert.equal(catalog.schema, 2);
  assert.deepEqual(catalog.layers, ["plugin"]);
  assert.ok(Object.keys(catalog.events).length > 0);
  for (const [name, entry] of Object.entries(catalog.events)) {
    assert.match(name, /^plugin\.editor\.[a-z_]+(\.[a-z_]+)*$/, name);
    assert.equal(entry.layer, "plugin", name);
    assert.ok(CLASSES.includes(entry.class), `${name}: class ${entry.class}`);
    for (const level of [entry.level].flat()) assert.ok(LEVELS.includes(level), `${name}: level ${level}`);
    assert.ok(entry.description.length > 0, name);
    for (const [field, type] of Object.entries(entry.fields)) {
      assert.ok(type.split("|").every((part) => TYPES.includes(part)), `${name}.${field}: type ${type}`);
    }
  }
});
