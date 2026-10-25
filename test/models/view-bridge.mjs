import { createCalls } from "./calls.mjs";

// Behavior model of createViewBridge for the view page: the requests of the page (calls.request), the host requests that
// the page answers from its registered commands, the host events and the native subscriptions, the sidecar subscriptions,
// the theme subscription, and the exposure calls. It runs over window.sokView of the view wire (view-wire.mjs) and posts
// through handler.postMessage. The conformance test replays test/fixtures/contract/view-bridge.json, view-native.json and
// view-commands.json. The page's runtime.log has no level query: it sends each record through the call layer, and its field
// builder runs for each record (core packages/plugin-api/view.js). The page's calls keep the time limit of calls.json
// (test/models/calls.mjs).

const NOT_REGISTERED = 1002;
const FAILED = -32000;
const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"];
const LOG_EVENT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const LOG_CID = /^[^"\\\u0000-\u001f\u007f]+$/;

/**
 * Creates the bridge of the view page of window. report(event) stores a message that the bridge cannot route.
 * Returns {calls, commands, runtime, exposure}.
 */
export function createViewBridge({ handler, report = () => {} }) {
  const location = globalThis.window.location;
  if (location.protocol !== "soksak:") {
    throw new Error(`view channel requires a view page on soksak://<plugin id>, got ${location.href}`);
  }
  const plugin = location.host;
  const sokView = globalThis.window.sokView;
  if (sokView === undefined) throw new Error(`view channel of ${plugin} has no window.sokView`);

  const commands = new Map();
  const events = new Map();
  const natives = new Map();

  const post = (message) => handler.postMessage(message);
  // The page's calls keep the limit of the call layer (core calls.json); the reports of the layer reach report.
  const layer = createCalls({ plugin, send: (message) => post({ sok: 1, ...message }), report });
  const request = (command, params, timeout) => layer.request(command, params, timeout);
  const answer = (id, payload) => post({ sok: 1, reply: id, ...payload });

  /** The host requests answered from the registered commands; a command that is not registered is refused. */
  const serve = (message) => {
    const run = commands.get(message.command);
    if (!run) {
      answer(message.id, { error: { code: NOT_REGISTERED, message: `view command ${message.command} is not registered` } });
      return;
    }
    // The handler receives the cids of the cause of the request, and an empty context when the request has none (core view.js).
    const context = message.cids === undefined ? {} : { cids: message.cids };
    Promise.resolve().then(() => run(message.params, context)).then(
      (result) => answer(message.id, { result: result ?? null }),
      (error) => answer(message.id, { error: { code: FAILED, message: error?.message ?? String(error) } }));
  };

  // A host event reaches only the listeners subscribed when it arrives; an event with no listener is dropped (core
  // view-native.json, view.native.event-before-subscription-is-dropped).
  const deliver = (name, data) => {
    for (const listener of [...(events.get(name) ?? [])]) listener(data);
  };

  sokView.attach((message) => {
    if (message.event !== undefined) {
      deliver(message.event, message.data);
      return;
    }
    if (message.command !== undefined && message.id !== undefined) {
      serve(message);
      return;
    }
    if (message.id !== undefined && message.command === undefined && (message.result !== undefined || message.error !== undefined)) {
      layer.reply(message.id, message.error !== undefined ? { error: message.error } : { result: message.result });
      return;
    }
    report({ kind: "unroutable", message });
  });

  const on = (name, listener) => {
    if (!events.has(name)) events.set(name, []);
    events.get(name).push(listener);
    return () => {
      const list = events.get(name);
      list.splice(list.indexOf(listener), 1);
    };
  };

  const calls = { request };

  const commandsApi = {
    async register(name, run) {
      if (typeof name !== "string" || name === "") throw new Error("commands.register requires a non-empty name");
      if (typeof run !== "function") throw new Error(`commands.register requires a function for ${name}`);
      await request("runtime.command.register", { name });
      commands.set(name, run);
    },
  };

  const log = Object.freeze(Object.fromEntries(LOG_LEVELS.map((level) => [
    level,
    (event, fields = {}, options) => {
      if (typeof event !== "string" || !LOG_EVENT.test(event)) {
        throw new TypeError("log requires an event name of lowercase words separated by dots");
      }
      if (options !== undefined && (options === null || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).some((key) => key !== "cids"))) {
        throw new TypeError("log options may only hold cids");
      }
      const cids = options?.cids;
      if (cids !== undefined && (!Array.isArray(cids) || !cids.every((cid) => typeof cid === "string" && LOG_CID.test(cid)))) {
        throw new TypeError("log cids must be an array of non-empty strings without a quote, a backslash or a control character");
      }
      const built = typeof fields === "function" ? fields() : fields;
      if (built === null || typeof built !== "object" || Array.isArray(built)) throw new TypeError("log requires fields as an object");
      if ("surface" in built) throw new TypeError("log fields must not name the surface; the context adds it");
      const params = { level, event, fields: { ...built }, ...(cids === undefined || cids.length === 0 ? {} : { cids }) };
      request("runtime.log", params).catch((error) => {
        const where = `log plugin.${plugin}.${event}`;
        const text = String(error?.message ?? error);
        request("runtime.error", { where, text }).catch((failure) => report({ where, text, error: failure }));
      });
    },
  ])));

  const runtime = {
    log,
    native: {
      /** Subscribes listener to the host event name; the first listener of a name posts the subscription. */
      async on(name, listener) {
        if (typeof name !== "string" || name === "") throw new Error("runtime.native.on requires a non-empty name");
        const remove = on(name, listener);
        if (!natives.has(name)) {
          natives.set(name, request("runtime.native.on", { name }).catch((error) => {
            natives.delete(name);
            remove();
            throw error;
          }));
        }
        await natives.get(name);
        return remove;
      },
    },
    sidecar(sidecar) {
      if (typeof sidecar !== "string" || sidecar === "") throw new Error("runtime.sidecar requires a sidecar name declared in plugin.json");
      return {
        send: (id, body, cids) => request("runtime.sidecar.send", { id, sidecar, body, cids }),
        on: async (id, fn) => {
          on("sidecar.message", (data) => { if (data.id === id) fn(data.body); });
          await request("runtime.sidecar.on", { id, sidecar });
        },
        onFailure: async (id, fn) => {
          on("sidecar.failure", (data) => { if (data.id === id) fn(data.reason); });
          await request("runtime.sidecar.onFailure", { id, sidecar });
        },
      };
    },
    /** Subscribes fn to the theme event of the host. */
    theme(fn) {
      const remove = on("theme", fn);
      return { ready: Promise.resolve(), dispose: async () => remove() };
    },
  };

  const exposure = {
    register: (kind, name) => request("runtime.native.call", { name: "registered", payload: { kind, name } }),
    reply: (id, payload) => request("runtime.native.call", { name: "exposureReply", payload: { id, ...payload } }),
  };

  const contributions = (point) => request("runtime.contributions", { point }).then((items) => items.map((entry) => ({
    ...entry,
    fail: (reason) => request("runtime.contributions.fail", {
      point, plugin: entry.plugin, index: entry.index, reason: reason instanceof Error ? reason.message : String(reason),
    }),
  })));

  return { calls, commands: commandsApi, runtime, exposure, contributions, plugin };
}
