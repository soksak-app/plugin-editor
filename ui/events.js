// The entrance of the events of this plugin (core docs/spec/plugins.md#logging): the call sites write the full name
// `plugin.editor.<event>` that the catalog events.json declares, and the entrance stores it through context.runtime.log.

const LEVELS = ["error", "warn", "info", "debug", "trace"];

/** The function emitEvent(level, name, fields) of the plugin `pluginId`, which stores its events through `runtime.log`. */
export function createEmitter(runtime, pluginId) {
  const prefix = `plugin.${pluginId}.`;
  return function emitEvent(level, name, fields) {
    if (!LEVELS.includes(level)) throw new TypeError(`emitEvent requires a level of ${LEVELS.join(", ")}`);
    if (typeof name !== "string" || !name.startsWith(prefix)) throw new TypeError(`emitEvent requires a name that starts with ${prefix}`);
    runtime.log[level](name.slice(prefix.length), fields);
  };
}

/** The whole microseconds since `start`, a value of performance.now(). */
export const microsSince = (start) => Math.max(0, Math.round((performance.now() - start) * 1000));

/** The failure in the result form `<code>: <text>` (core docs/spec/logging.md#result-form); `code` is the code of an error that has none. */
export function failure(error, code) {
  const text = error instanceof Error ? error.message : String(error);
  return `${error?.code ?? code}: ${text}`.slice(0, 1024);
}
