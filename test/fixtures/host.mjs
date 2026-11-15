// The host of the view surface for the tests of this repository: a jsdom window on soksak://<plugin id>/ that answers the sok-view
// message handler of the page by the view wire of docs/spec/native-surfaces.md (view surfaces, view call, view channel, view events).
// The host is this fixture; the page modules of ui/ and the view bridge of @soksak/plugin-api/view run unchanged over it.
//
// The page posts each call as {sok: 1, id, command, params, cids?} and the host replies with a host message {id, result} or
// {id, error: {code, message}}. The host sends a command request {id, command, params} and the page answers {sok: 1, reply: id,
// result|error}. Host events reach the page as {sok: 1, event, data} for each native event that the page subscribed to.
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";

// The error code of a failed call of the view wire (docs/spec/native-surfaces.md, view call, item 3).
const FAILURE_CODE = -32000;
// The entries that the host declares for every surface, before the entries of the plugin (docs/spec/native-surfaces.md, start values).
const HOST_DECLARATIONS = {
  status: ["document", "input"].map((name) => ({ name: `core.surface.${name}`, description: name, schema: {} })),
  commands: [
    { name: "core.surface.hit", description: "Hits the document.", params: { type: "object" }, result: { type: "boolean" } },
    { name: "core.surface.clock", description: "Reads the document clock.", params: { type: "object" }, result: { type: "object" } },
  ],
  element: [],
};
// The calls of the page that the host answers with null: the reports of the tab, the subscriptions and the error record of the page.
const NULL_ROUTES = ["tab.title", "tab.footer", "tab.directory", "tab.notify", "tab.modified", "tab.error", "tab.keep", "tab.focus",
  "runtime.error", "runtime.command.register", "runtime.textSize.on", "runtime.settings.on", "runtime.log.levels.on", "runtime.data.on",
  "runtime.status.unwatch"];
const NATIVE_ROUTES = ["registered", "changed", "exposureReply"];
// The page loads of this process: each load gets a URL that no earlier load has, so Node imports the page module anew.
let pageLoads = 0;
// The module URLs of the contributed items of the open view, each mapped to its file. The page imports these URLs, which Node cannot load
// without this resolve hook (the loader supports the file and data schemes only); a URL that is not mapped resolves as usual.
const contributedFiles = new Map();
registerHooks({
  resolve(specifier, context, nextResolve) {
    const target = contributedFiles.get(specifier);
    if (target === undefined) return nextResolve(specifier, context);
    return { url: target, shortCircuit: true };
  },
});
// The windows of the open views, the last opened last. The globals of the page read the last window, as a page of a browser reads the window
// of its own document; a test that opens a second view reads the second window from the globals.
const openWindows = [];
let unbindGlobals = null;

const TURN = () => new Promise((resolve) => setImmediate(resolve));

/** The names of the window that the process does not define, which the page reads as globals of its window. */
const windowGlobals = (window) => {
  const names = new Set();
  for (let object = window; Object.getPrototypeOf(object) !== null; object = Object.getPrototypeOf(object)) {
    for (const name of Object.getOwnPropertyNames(object)) names.add(name);
  }
  return [...names].filter((name) => !(name in globalThis));
};

/** Binds the window names to the process globals while a view is open: a function without a prototype is bound to the window, as a page calls it. */
function bindGlobals(window) {
  openWindows.push(window);
  if (unbindGlobals !== null) return;
  const saved = new Map();
  for (const name of new Set([...windowGlobals(window), "window", "self", "document"])) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        const current = openWindows.at(-1);
        const value = current[name];
        return typeof value === "function" && !("prototype" in value) ? value.bind(current) : value;
      },
      set(value) { openWindows.at(-1)[name] = value; },
    });
  }
  unbindGlobals = () => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  };
}

/** Ends the binding of one window; the process globals are restored when no view is open. */
function releaseGlobals(window) {
  openWindows.splice(openWindows.indexOf(window), 1);
  if (openWindows.length === 0) {
    unbindGlobals();
    unbindGlobals = null;
  }
}

/** The page's stylesheets are a list on the document; jsdom has no adoptedStyleSheets, so the list is kept on the document. */
function adoptStyleSheets(document, CSSStyleSheet) {
  let sheets = [];
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    get: () => sheets,
    set(value) {
      if (!Array.isArray(value) || !value.every((sheet) => sheet instanceof CSSStyleSheet)) {
        throw new TypeError("adoptedStyleSheets takes an array of CSSStyleSheet");
      }
      sheets = [...value];
    },
  });
}

/**
 * Opens the view of the plugin `name` on its window and returns the view.
 *
 *     start         the start values of the surface {surface, params, origin, project, diagnostics}, or null for a view without
 *                   window.sokSurface (a page that reads it refuses to load)
 *     declarations  the entries of the plugin: {status, commands, element}; the host entries are added before them
 *     scheme        the color scheme of the theme that the window starts with (docs/spec/native-surfaces.md, theme)
 *     host          the answers of the host:
 *         installed     the installed plugins, each {id, package, version, manifest, modules}; modules maps a path of its manifest to a file URL
 *         sidecars      the sidecar names that the plugin declares
 *         statuses      the values of the statuses, by name
 *         settings      the settings of the plugin
 *         textSize      the text scale of the surface
 *         state         {read(), write(value)} of the tab state
 *         unload        the surface.unload declaration, or null; the tab state is written within its maxBytes
 *         commands      {name: fn(params)} of the core commands; the reply is the result of fn
 *         sidecar       {name: fn(body, name)} of the sidecars; the reply of a sidecar reaches the page as a sidecar message
 *         native        {name: fn(payload)} of the host calls of the surface
 *         faults        {"command.<name>": message} refuses each call of that route with the message
 *
 * The returned view has these members:
 *     window        the jsdom window of the page
 *     sent          each message that the page posted to the handler, in order
 *     calls         each call of the page: {command, params} and cids when the call carries them
 *     events        each record of the page writer, as the batch items of runtime.log
 *     observed      the host records: contributions (each refused item {plugin, point, index, reason}) and canceled (each call that the
 *                   close left unanswered, {command})
 *     observers     each ResizeObserver of the window, with its callback, targets and notify(entries)
 *     load(url)     imports the page module into the window; a view loads one page module
 *     request(command, params)  runs a command of the page; resolves with its result or rejects with its error
 *     push(event, data)         delivers a host event to the page; the page must have subscribed to the event
 *     sidecarMessage(name, id, {body, cids})  delivers a sidecar message of the session id to the page's route
 *     settled()     resolves when the calls of the page have replied
 *     close()       ends the view as the page ends: the pagehide of the window, then the close of the host
 */
export async function openPageView(name, { start, declarations = {}, scheme = "dark", host = {} }) {
  const {
    installed = [], sidecars = [], statuses = {}, settings = {}, textSize = 1, state = { read: () => null, write() {} }, unload = null,
    commands = {}, sidecar = {}, native = {}, faults = {},
  } = host;
  const self = installed.find((plugin) => plugin.id === name);
  if (self === undefined) throw new Error(`view ${name} is not an installed plugin`);
  const dom = new JSDOM("<!doctype html><body></body>", { url: `soksak://${name}/`, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  adoptStyleSheets(window.document, window.CSSStyleSheet);
  // The visual viewport of the window is an event target whose size is the size of the window; jsdom has none.
  const viewport = new window.EventTarget();
  Object.defineProperties(viewport, { width: { get: () => window.innerWidth }, height: { get: () => window.innerHeight } });
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  // The window of the page: the theme and the start values are set before the page runs, as the start scripts of the host do.
  window.sokTheme = Object.freeze({ scheme, tokens: Object.freeze({}) });
  if (start !== null) {
    const merged = Object.fromEntries(["status", "commands", "element"].map((kind) => [kind,
      [...HOST_DECLARATIONS[kind], ...(declarations[kind] ?? [])]]));
    // The start values of a surface of a tab have no section (docs/spec/native-surfaces.md, start values).
    window.sokSurface = Object.freeze({ section: null, ...start, declarations: merged, levels: {} });
  }
  // The channel of the page: the host messages of the window are queued until the page attaches its listener, then delivered in order.
  // The page identity is a UUID that the document draws once; the ready message and window.sokView carry the same identity.
  const page = randomUUID();
  const queue = [];
  let listener = null;
  window.sokView = Object.freeze({ page, timeOrigin: window.performance.timeOrigin, attach(next) {
    if (typeof next !== "function") throw new TypeError("attach requires a listener function");
    if (listener !== null) throw new Error(`view channel for ${name} already has a message listener`);
    listener = next;
    for (const message of queue.splice(0)) next(message);
  } });
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.sok !== 1) return;
    if (listener === null) queue.push(event.data);
    else listener(event.data);
  });
  const resizeObservers = [];
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; this.disconnected = false; resizeObservers.push(this); }
    observe(target) { this.targets.push(target); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
    notify(entries) { this.callback(entries, this); }
  };

  const sent = [];
  const calls = [];
  const events = [];
  const observed = { contributions: [], canceled: [] };
  // The native events that the page subscribed to, the sidecar sessions it routes, and the command requests awaiting a reply.
  const subscriptions = new Set();
  const routes = new Set();
  const replies = new Map();
  // The calls of the page that the host has not answered, by their index; a call that the close leaves unanswered is canceled.
  const pending = new Map();
  let callIndex = 0;
  const failures = [];
  let requestId = 0;
  let closed = false;
  let loaded = false;

  // The message of the host to the page: a window message with the sok marker, as the host posts it.
  const post = (message) => {
    if (closed) throw new Error(`view ${name} is closed: no message reaches its page`);
    window.dispatchEvent(new window.MessageEvent("message", { data: { sok: 1, ...message }, source: window }));
  };

  // The connected items of a point the view declares: each installed plugin contributes under the point name `<view plugin>.<point>`, and
  // each item's module is the URL on the core root (soksak://core/modules/<plugin>/<path>) that maps to the file of the module.
  const registeredFiles = new Set();
  const contributedItems = (point) => {
    if (!Object.hasOwn(self.manifest.extends ?? {}, point)) throw new Error(`view call runtime.contributions: ${name} declares no point ${point}`);
    return installed.flatMap((plugin) => (plugin.manifest.contributes?.[`${name}.${point}`] ?? []).map((item, index) => {
      const module = `soksak://core/modules/${plugin.id}/${item.module}`;
      const file = plugin.modules?.[item.module];
      if (file !== undefined) {
        contributedFiles.set(module, file);
        registeredFiles.add(module);
      }
      return { plugin: plugin.id, index, item, module };
    }));
  };

  // A call of the page: the answer of the host, or a refusal that the page receives as the error of the call.
  const answer = async (call) => {
    const { command, params } = call;
    if (faults[`command.${command}`] !== undefined) throw new Error(faults[`command.${command}`]);
    if (command === "runtime.log") {
      if (params?.action === "clock") return { ts_us: Math.round(Date.now() * 1000), mono_ns: Math.round(Number(process.hrtime.bigint())) };
      if (params?.action !== "batch") throw new TypeError(`runtime.log action ${JSON.stringify(params?.action)} is not served`);
      if (!Array.isArray(params.events)) throw new TypeError("runtime.log batch requires the array events");
      events.push(...params.events);
      return null;
    }
    if (command === "runtime.native.call") {
      const { name: hostCall, payload } = params;
      if (Object.hasOwn(native, hostCall)) return (await native[hostCall](payload)) ?? null;
      if (NATIVE_ROUTES.includes(hostCall)) return null;
      throw new Error(`host call ${hostCall} is not served by the fixture`);
    }
    if (command === "runtime.native.on") {
      subscriptions.add(params.name);
      return null;
    }
    if (command === "runtime.sidecar.on" || command === "runtime.sidecar.onFailure" || command === "runtime.sidecar.send") {
      if (!sidecars.includes(params.sidecar)) throw new Error(`${command}: ${name} declares no sidecar ${params.sidecar}`);
      if (command === "runtime.sidecar.on") {
        routes.add(`${params.sidecar}\n${params.id}`);
        return null;
      }
      if (command === "runtime.sidecar.onFailure") return null;
      if (!Object.hasOwn(sidecar, params.sidecar)) throw new Error(`no fixture answers sidecar ${params.sidecar}`);
      await sidecar[params.sidecar](params.body, params.sidecar);
      return null;
    }
    if (command === "runtime.status.watch") {
      // The first value of the watch is sent to the page before the reply, as the value of the status is current at the watch.
      const value = statuses[params.name] ?? null;
      post({ event: "status", data: params.surface === undefined ? { name: params.name, value } : { name: params.name, surface: params.surface, value } });
      return null;
    }
    if (command === "runtime.textSize.read") return textSize;
    if (command === "runtime.settings.read") return settings;
    if (command === "runtime.contributions") return contributedItems(params.point);
    if (command === "runtime.contributions.fail") {
      const connected = contributedItems(params.point).find((entry) => entry.plugin === params.plugin && entry.index === params.index);
      if (connected === undefined) throw new Error(`view call runtime.contributions.fail: ${params.point} has no connected item ${params.index} of ${params.plugin}`);
      observed.contributions.push({ plugin: params.plugin, point: params.point, index: params.index, reason: params.reason });
      return null;
    }
    if (command === "tab.state.read") return state.read();
    if (command === "tab.state.write") {
      if (unload === null) throw new Error("view call tab.state.write requires the surface.unload declaration");
      const size = Buffer.byteLength(JSON.stringify(params ?? null));
      if (size > unload.maxBytes) throw new Error(`view call tab.state.write exceeds ${unload.maxBytes} bytes: ${size}`);
      state.write(params);
      return null;
    }
    if (NULL_ROUTES.includes(command)) return null;
    if (command.startsWith("core.")) {
      if (!Object.hasOwn(commands, command)) throw new Error(`no fixture answers core command ${command}`);
      return (await commands[command](params)) ?? null;
    }
    throw new Error(`view call ${command} is not served by the fixture`);
  };

  // The messages that the page posts to the sok-view handler. A call is answered in a later turn with its reply; a reply to a command
  // request settles the request; a cancel and the ready message are recorded.
  const deliverFromView = (message) => {
    sent.push(structuredClone(message));
    if (message.reply !== undefined) {
      const request = replies.get(message.reply);
      if (request === undefined) {
        failures.push(new Error(`reply ${message.reply} answers no command request`));
        return;
      }
      replies.delete(message.reply);
      if ("error" in message) request.reject(new Error(message.error.message));
      else request.resolve(message.result ?? null);
      return;
    }
    // The ready message is the identity of the document; the host records it for the view, which posts its messages to that document.
    if (message.event === "view.ready") return;
    if (message.cancel === true) return;
    if (typeof message.command !== "string") {
      failures.push(new Error(`the page posted an unknown message ${JSON.stringify(message)}`));
      return;
    }
    const call = { command: message.command, params: structuredClone(message.params) };
    if (message.cids !== undefined) call.cids = structuredClone(message.cids);
    calls.push(call);
    const index = ++callIndex;
    const work = answer(call).then(
      // A reply that arrives after the close cannot reach the closed page; the close recorded the call as canceled.
      (result) => { if (!closed) post({ id: message.id, result: result ?? null }); },
      (error) => { if (!closed) post({ id: message.id, error: { code: FAILURE_CODE, message: error?.message ?? String(error) } }); },
    ).catch((error) => failures.push(error));
    pending.set(index, { command: call.command, index, done: work });
    work.finally(() => pending.delete(index));
  };
  window.webkit = { messageHandlers: { "sok-view": { postMessage: deliverFromView } } };
  // The ready message of the start script: the page identity of the document, a UUID, and the time origin of the window.
  deliverFromView({ event: "view.ready", plugin: name, document: page, time_origin: window.performance.timeOrigin });
  // The host sends the current theme after each ready message (docs/spec/native-surfaces.md, theme). The page attaches its listener
  // later, so the message waits in the queue of the channel until then.
  post({ event: "theme", data: { scheme, tokens: {} } });

  // Resolves when each call that started at or after the index `since` has been answered, and each call that those answers start too.
  const drain = async (since) => {
    const waiting = () => [...pending.values()].filter((entry) => entry.index > since);
    do {
      await Promise.allSettled(waiting().map((entry) => entry.done));
      await TURN();
    } while (waiting().length > 0);
  };
  const settled = () => drain(0);

  bindGlobals(window);
  const endView = async () => {
    // The page ends its work at pagehide: the calls that it starts then are answered before the close; the calls that were started
    // before it and are still unanswered cannot be answered after the close, so the close records them as canceled.
    const since = callIndex;
    window.dispatchEvent(new window.Event("pagehide"));
    await drain(since);
    closed = true;
    for (const entry of pending.values()) observed.canceled.push({ command: entry.command });
    routes.clear();
    window.close();
    releaseGlobals(window);
    for (const module of registeredFiles) contributedFiles.delete(module);
    if (failures.length > 0) throw new Error(failures.map((error) => error.message).join("\n"));
  };
  let ending = null;
  const view = {
    name,
    window,
    sent,
    calls,
    events,
    observed,
    observers: resizeObservers,
    async load(url) {
      if (!(url instanceof URL)) throw new TypeError(`view.load requires the URL of the page module, found ${String(url)}`);
      if (loaded) throw new Error(`view ${name} already has a page loaded: a view loads one page module`);
      loaded = true;
      const target = new URL(url);
      target.searchParams.set("view", String(++pageLoads));
      return import(target.href);
    },
    request(command, params) {
      const id = ++requestId;
      return new Promise((resolve, reject) => {
        replies.set(id, { resolve, reject });
        post({ id, command, params: structuredClone(params ?? null) });
      });
    },
    async push(event, data) {
      if (!subscriptions.has(event)) throw new Error(`view ${name} has no subscription to the host event ${event}`);
      // A host event reaches the page in a later turn than the call that sends it, as a message of the window does.
      await TURN();
      post({ event, data });
      await settled();
    },
    sidecarMessage(sidecarName, id, { body, cids }) {
      // A session the page did not subscribe to, or one that ended with the view, has no route, so the host refuses its message.
      if (!routes.has(`${sidecarName}\n${id}`)) throw new Error(`no subscription for it: view ${name} is not subscribed to ${sidecarName} session ${id}`);
      post({ event: "sidecar.message", data: { id, cids: cids ?? [], body: structuredClone(body) } });
    },
    settled,
    // The view ends once: the pagehide of the window, then the close of the host, which ends the routes of its sidecar sessions;
    // a later close resolves with the first one.
    close() {
      ending ??= endView();
      return ending;
    },
  };
  return view;
}
