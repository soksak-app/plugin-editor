// Behavior model of createViewBridge for the view page: the requests of the page (calls.request), the host requests that
// the page answers from its registered commands, the host events and the native subscriptions, the sidecar subscriptions,
// the theme subscription, and the exposure calls. It runs over window.sokView of the view wire (view-wire.mjs) and posts
// through handler.postMessage. The conformance test replays test/fixtures/contract/view-bridge.json, view-native.json and
// view-commands.json. Untraced: the level gate of runtime.log, which the view page does not use (core
// view-bridge.json case view.bridge.runtime-log-level-gate is not covered). Untraced: a host event that arrives before
// its first listener is held and delivered to that listener on subscription, so that the theme sent with the ready
// message reaches the page that subscribes after the queue of the view script is flushed.

const NOT_REGISTERED = 1002;
const FAILED = -32000;

/**
 * Creates the bridge of the view page of window. report(event) stores a message that the bridge cannot route.
 * Returns {calls, commands, runtime, exposure}.
 */
export function createViewBridge({ handler, report = () => {} }) {
  const location = globalThis.window.location;
  if (location.protocol !== "sok:") {
    throw new Error(`view channel requires a view page on sok://<plugin id>, got ${location.href}`);
  }
  const plugin = location.host;
  const sokView = globalThis.window.sokView;
  if (sokView === undefined) throw new Error(`view channel of ${plugin} has no window.sokView`);

  let nextId = 0;
  const pending = new Map();
  const commands = new Map();
  const events = new Map();
  // The host events that arrive before the first listener of their name; the first listener receives them in order.
  const early = new Map();
  const natives = new Map();

  const post = (message) => handler.postMessage(message);
  const request = (command, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    post({ sok: 1, id, command, params });
  });
  const answer = (id, payload) => post({ sok: 1, reply: id, ...payload });

  /** The host requests answered from the registered commands; a command that is not registered is refused. */
  const serve = (message) => {
    const run = commands.get(message.command);
    if (!run) {
      answer(message.id, { error: { code: NOT_REGISTERED, message: `view command ${message.command} is not registered` } });
      return;
    }
    Promise.resolve().then(() => run(message.params)).then(
      (result) => answer(message.id, { result: result ?? null }),
      (error) => answer(message.id, { error: { code: FAILED, message: error?.message ?? String(error) } }));
  };

  const deliver = (name, data) => {
    const listeners = events.get(name) ?? [];
    if (listeners.length === 0) {
      if (!early.has(name)) early.set(name, []);
      early.get(name).push(data);
      return;
    }
    for (const listener of [...listeners]) listener(data);
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
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error !== undefined) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result ?? null);
      return;
    }
    report({ kind: "unroutable", message });
  });

  const on = (name, listener) => {
    if (!events.has(name)) events.set(name, []);
    events.get(name).push(listener);
    for (const data of early.get(name)?.splice(0) ?? []) listener(data);
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

  const runtime = {
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

  return { calls, commands: commandsApi, runtime, exposure, plugin };
}
