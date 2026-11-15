// The resolve hook of the plugin API fixture: it maps exactly the specifiers that the import map of the application maps for a page of
// this plugin (core docs/spec/plugins.md#view-surfaces) to the fixture modules. Every other specifier resolves as usual.
const FIXTURES = new Map([
  ["@soksak/plugin-api", "./index.mjs"],
  ["@soksak/plugin-api/view", "./view.mjs"],
  ["@soksak/plugin-api/diagnostic-view-frames", "./diagnostic-view-frames.mjs"],
]);

export function resolve(specifier, context, nextResolve) {
  const fixture = FIXTURES.get(specifier);
  if (fixture === undefined) return nextResolve(specifier, context);
  return { url: new URL(fixture, import.meta.url).href, shortCircuit: true };
}
