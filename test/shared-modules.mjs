// Resolves @soksak/shared/editor.extension/<package> in tests to the file that plugin.json names for the package in
// the modules of the extension point editor.extension, as the page import map and the host do in the application
// (core docs/spec/plugins.md#extension-points).
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

const POINT = "@soksak/shared/editor.extension/";
const MODULES = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8")).extends.extension.modules;

registerHooks({
  resolve(specifier, context, next) {
    if (!specifier.startsWith(POINT)) return next(specifier, context);
    const name = specifier.slice(POINT.length);
    if (!Object.hasOwn(MODULES, name)) throw new Error(`${specifier}: plugin.json shares no module ${name}`);
    return { url: new URL(`../${MODULES[name]}`, import.meta.url).href, shortCircuit: true };
  },
});
