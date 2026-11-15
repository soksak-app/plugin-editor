// The session of the plugin API fixture: the state that the three fixture modules (index.mjs, view.mjs, diagnostic-view-frames.mjs)
// share with the test that opens it. A test arranges the answers of the plugin API (the reply of a call, the sidecar, the
// contributions, the theme), the page calls the plugin API, and the session records each call in order and lets the test push what the
// host pushes (a native event, a sidecar message, a theme). A call that the test arranged no answer for is refused with an explicit
// error, and so is a use of the plugin API that this plugin does not declare.
//
// The session implements no helper of core. Where the page depends on what a result of the plugin API does, the session does only what
// core docs/spec/exposure.md and docs/spec/plugins.md#view-surfaces state: a bound element runs the command that the page registered
// when its event fires, and a registered status provider is read when the test reads the status.

const TURN = () => new Promise((resolve) => setImmediate(resolve));
const LEVELS = ["error", "warn", "info", "debug", "trace"];
// The native events that a view page may subscribe to (core docs/spec/native-surfaces.md#view-surfaces, plugin host calls).
const NATIVE_EVENTS = ["exposure-request"];
const INTERACTIVE = 'button, input, select, textarea, [role="button"], [contenteditable]:not([contenteditable="false"])';
const IMPLICIT_ROLES = { button: "button", input: "textbox", select: "combobox", textarea: "textbox" };

// The sessions that are open, the last opened last: the page modules call the plugin API of the last session, as a page reads the
// plugin API of its own window.
const open = [];

/** The session that the page modules of this plugin call; a call before a test opened one is refused. */
export function currentSession() {
  const session = open.at(-1);
  if (session === undefined) throw new Error("no plugin API session is open: a test opens one with openSession before the page calls the plugin API");
  return session;
}

/**
 * Opens a session. The arrangement of the test:
 *
 *     sidecars      the sidecar names that plugin.json declares; runtime.sidecar(name) refuses another name
 *     calls         {command: fn(params)} answers calls.request(command, params); the answer is the result of fn
 *     sidecar       {name: fn(body, surface, cids)} answers runtime.sidecar(name).send; the reply of the sidecar is a message that the
 *                   test delivers with sidecarMessage
 *     contributions {point: [{plugin, index, item, module}]} answers contributions(point)
 *     theme         the value {scheme, tokens} that runtime.theme gives a listener when it subscribes
 *     frameStop     runs when the page calls the stop function of a view-frame observer; it may throw
 *
 * The returned session records and drives:
 *
 *     api           each call of the page on the plugin API, in order: {name, args}
 *     requests      each calls.request: {command, params}
 *     events        each record of runtime.log: {level, event, fields}
 *     sidecarSends  each runtime.sidecar(name).send: {sidecar, surface, body, cids}
 *     failed        each fail(reason) of a contribution: {plugin, point, index, reason}
 *     exposureRequests  each exposure request that the page handed to its exposure: {id, method, params}
 *     frameObservers    each observeViewDocumentFrames call: {options, stopped}
 *     watched       each value of a watched status: {name, value}
 *     run(name, params)  runs the command that the page registered with commands.register
 *     read(name)    reads the status that the page registered with the exposure
 *     watch(name)   subscribes to the status as the page registered it; each value is recorded in watched
 *     push(event, data)  delivers a native event to the page, which must have subscribed to it
 *     sidecarMessage(name, surface, {body, cids})  delivers a message of the sidecar to the page's route
 *     sidecarFailure(name, surface, error)  delivers the failure of the sidecar session to the page's route
 *     setTheme(theme)    delivers a theme to the theme listeners
 *     loss(event)   delivers a report of the bridge to the report function of the page
 *     settled()     resolves when the answers of the page's calls have replied
 *     until(condition)  resolves in the turn of the record that makes condition() true
 *     close()       ends the session; the answers that were not given are not delivered
 */
export function openSession({ sidecars = [], calls = {}, sidecar = {}, contributions = {}, theme = null, frameStop = () => {} } = {}) {
  const api = [];
  const requests = [];
  const events = [];
  const sidecarSends = [];
  const failed = [];
  const exposureRequests = [];
  const frameObservers = [];
  const watched = [];
  const registered = new Map();
  const nativeHandlers = new Map();
  const routes = new Map();
  const themeListeners = new Set();
  const status = new Map();
  const commands = new Map();
  const elements = new Map();
  const bound = new WeakSet();
  const named = new WeakSet();
  const delegated = new Set();
  const listeners = [];
  const waits = new Set();
  let currentTheme = theme;
  let reportLoss = null;
  // The answers of the calls that the test has not given yet, by their index. A call that the close leaves unanswered is canceled.
  const pending = new Map();
  let callIndex = 0;
  let closed = false;

  const changed = () => {
    for (const wait of [...waits]) {
      if (!wait.condition()) continue;
      waits.delete(wait);
      wait.resolve();
    }
  };
  const record = (name, args) => {
    api.push({ name, args });
    changed();
  };
  const refuse = (text) => new Error(`plugin API fixture: ${text}`);
  const session = { api, requests, events, sidecarSends, failed, exposureRequests, frameObservers, watched };

  // The answer of a call: delivered to the page in a later turn, unless the session closed before it; a call that the close leaves
  // unanswered stays unanswered, as the page that ended cannot receive it.
  const answered = (produce) => {
    const index = ++callIndex;
    const work = Promise.resolve().then(produce);
    const entry = { index, done: work.then(() => {}, () => {}) };
    pending.set(index, entry);
    entry.done.finally(() => pending.delete(index));
    return new Promise((resolve, reject) => {
      work.then((value) => { if (!closed) resolve(value ?? null); }, (error) => { if (!closed) reject(error); });
    });
  };
  const drain = async (since) => {
    const waiting = () => [...pending.values()].filter((entry) => entry.index > since);
    do {
      await Promise.all(waiting().map((entry) => entry.done));
      await TURN();
    } while (waiting().length > 0);
  };

  const requestCall = (command, params) => {
    if (typeof command !== "string") throw new TypeError(`calls.request requires the command name, found ${String(command)}`);
    requests.push({ command, params: structuredClone(params) });
    record("calls.request", [command, params]);
    if (!Object.hasOwn(calls, command)) return Promise.reject(refuse(`no answer is arranged for the call ${command}`));
    return answered(() => calls[command](structuredClone(params)));
  };

  const log = Object.fromEntries(LEVELS.map((level) => [level, (event, fields) => {
    events.push({ level, event, fields: structuredClone(typeof fields === "function" ? fields() : fields) });
    record(`runtime.log.${level}`, [event, fields]);
  }]));

  const sidecarOf = (name) => {
    record("runtime.sidecar", [name]);
    if (!sidecars.includes(name)) throw refuse(`the plugin declares no sidecar ${name}`);
    const routeOf = (kind, surface) => `${kind}\n${name}\n${surface}`;
    const subscribe = (kind, surface, fn) => {
      record(`runtime.sidecar.${kind}`, [name, surface]);
      if (typeof fn !== "function") throw new TypeError(`runtime.sidecar.${kind} requires a function`);
      const key = routeOf(kind, surface);
      if (routes.has(key)) throw refuse(`${name} session ${surface} already has a ${kind} listener`);
      routes.set(key, fn);
      return Promise.resolve(() => { if (routes.get(key) === fn) routes.delete(key); });
    };
    return {
      send(surface, body, cids = []) {
        sidecarSends.push({ sidecar: name, surface, body: structuredClone(body), cids: structuredClone(cids) });
        record("runtime.sidecar.send", [name, surface, body, cids]);
        if (!Object.hasOwn(sidecar, name)) return Promise.reject(refuse(`no answer is arranged for the sidecar ${name}`));
        return answered(() => sidecar[name](structuredClone(body), surface, structuredClone(cids)));
      },
      on: (surface, fn) => subscribe("on", surface, fn),
      onFailure: (surface, fn) => subscribe("onFailure", surface, fn),
    };
  };

  const subscribeTheme = (listener) => {
    record("runtime.theme", [listener]);
    if (typeof listener !== "function") throw new TypeError("runtime.theme requires a listener function");
    themeListeners.add(listener);
    // A listener that subscribes receives the last theme at once (core docs/spec/native-surfaces.md#view-surfaces, theme).
    if (currentTheme !== null) listener(currentTheme);
    // The subscription is {ready, dispose}: ready settles when the listener is subscribed, and dispose settles with the function that ends it.
    return { ready: Promise.resolve(), dispose: Promise.resolve(() => { themeListeners.delete(listener); }) };
  };

  const relay = {
    register: (kind, name) => {
      record("exposure.register", [kind, name]);
      return Promise.resolve();
    },
    reply: (...args) => { record("exposure.reply", args); },
    changed: (...args) => { record("exposure.changed", args); },
  };

  const declaredName = (declarations, kind, name) => {
    if (!(declarations()[kind] ?? []).some((entry) => entry.name === name)) throw refuse(`exposure ${kind} ${name} is not declared`);
  };

  session.createViewBridge = (options) => {
    record("createViewBridge", [options]);
    if (typeof options?.report !== "function") throw new TypeError("createViewBridge requires the report function");
    if (typeof options?.handler?.postMessage !== "function") throw new TypeError("createViewBridge requires the sok-view handler");
    reportLoss = options.report;
    return {
      calls: { request: requestCall },
      commands: {
        register(name, run) {
          record("commands.register", [name, run]);
          if (registered.has(name)) throw refuse(`the command ${name} is registered twice`);
          registered.set(name, run);
          return Promise.resolve();
        },
      },
      runtime: {
        log,
        native: {
          on(name, fn) {
            record("runtime.native.on", [name, fn]);
            if (!NATIVE_EVENTS.includes(name)) throw refuse(`the native event ${name} is not served to a plugin page`);
            nativeHandlers.set(name, fn);
            return () => { if (nativeHandlers.get(name) === fn) nativeHandlers.delete(name); };
          },
        },
        sidecar: sidecarOf,
        theme: subscribeTheme,
      },
      contributions(point) {
        record("contributions", [point]);
        if (!Object.hasOwn(contributions, point)) return Promise.reject(refuse(`no contributions are arranged for the point ${point}`));
        return Promise.resolve(contributions[point].map((entry, position) => ({
          ...entry,
          fail(reason) {
            failed.push({ plugin: entry.plugin, point, index: entry.index ?? position, reason });
            record("contributions.fail", [point, entry.plugin, entry.index ?? position, reason]);
            return Promise.resolve();
          },
        })));
      },
      exposure: relay,
    };
  };

  session.createExpose = (deps, declarations) => {
    record("createExpose", [deps, declarations]);
    for (const name of ["register", "onRequest", "reply", "changed", "report"]) {
      if (typeof deps?.[name] !== "function") throw new TypeError(`createExpose requires deps.${name}`);
    }
    session.exposeDeps = deps;
    deps.onRequest((request) => { exposureRequests.push(structuredClone(request)); changed(); });
    const run = (name, params, failedFn) => {
      const command = commands.get(name);
      if (command === undefined) throw refuse(`the command ${name} is not registered with the exposure`);
      // The command starts when the event fires, and a failure of its start or of its result reaches failed, or the report of the page.
      const reject = (failure) => (failedFn ?? ((error) => deps.report(String(error?.message ?? error))))(failure);
      try {
        Promise.resolve(command(params)).catch(reject);
      } catch (failure) {
        reject(failure);
      }
    };
    return {
      status(name, read, subscribe) {
        record("exposure.status", [name, read, subscribe]);
        declaredName(declarations, "status", name);
        status.set(name, { read, subscribe });
        return deps.register("status", name);
      },
      command(name, command) {
        record("exposure.command", [name, command]);
        declaredName(declarations, "commands", name);
        commands.set(name, command);
        return deps.register("command", name);
      },
      element(name, element) {
        record("exposure.element", [name, element]);
        declaredName(declarations, "element", name);
        elements.set(name, element);
        named.add(element);
        return deps.register("element", name);
      },
      async bind(element, name, params = {}, options = {}) {
        record("exposure.bind", [element, name, params, options]);
        declaredName(declarations, "commands", name);
        for (const option of Object.keys(options)) {
          if (!["event", "when", "failed"].includes(option)) throw refuse(`the bind option ${option} is not served`);
        }
        const listener = (event) => {
          if (options.when !== undefined && !options.when(event)) return;
          run(name, typeof params === "function" ? params(event) : params, options.failed);
        };
        const type = options.event ?? "click";
        element.addEventListener(type, listener);
        listeners.push(() => element.removeEventListener(type, listener));
        bound.add(element);
      },
      async delegate(root) {
        record("exposure.delegate", [root]);
        const listener = (event) => {
          const element = event.target.closest?.("[data-command]");
          if (element === null || element === undefined || bound.has(element) || !root.contains(element)) return;
          const params = element.dataset.params === undefined ? {} : JSON.parse(element.dataset.params);
          if (event.type === "change") params[element.dataset.value ?? "value"] = element.value;
          run(element.dataset.command, params);
        };
        for (const type of ["click", "change"]) {
          root.addEventListener(type, listener);
          listeners.push(() => root.removeEventListener(type, listener));
        }
        delegated.add(root);
      },
      audit(root) {
        record("exposure.audit", [root]);
        return [...root.querySelectorAll(INTERACTIVE)].filter((element) => {
          const connected = bound.has(element) || (element.dataset.command !== undefined && [...delegated].some((base) => base.contains(element)));
          return !connected || !named.has(element);
        }).map((element) => ({
          role: element.getAttribute("role")?.split(/\s+/)[0] ?? IMPLICIT_ROLES[element.localName] ?? (element.isContentEditable ? "textbox" : null),
          expose: element.dataset.expose ?? null,
          command: element.dataset.command ?? null,
          text: element.textContent.trim(),
        }));
      },
      async dispose() {
        record("exposure.dispose", []);
        for (const remove of listeners.splice(0)) remove();
        status.clear();
        commands.clear();
        elements.clear();
        delegated.clear();
      },
    };
  };

  session.observeViewDocumentFrames = (options) => {
    record("observeViewDocumentFrames", [options]);
    for (const name of ["ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame", "now"]) {
      if (typeof options?.[name] !== "function") throw new TypeError(`observeViewDocumentFrames requires options.${name}`);
    }
    if (typeof options.log?.trace !== "function") throw new TypeError("observeViewDocumentFrames requires options.log.trace");
    if (options.document === null || typeof options.document !== "object") throw new TypeError("observeViewDocumentFrames requires options.document");
    if (!Number.isFinite(options.timeOriginMs)) throw new TypeError("observeViewDocumentFrames requires options.timeOriginMs");
    const observer = { options, stopped: 0 };
    frameObservers.push(observer);
    return () => { observer.stopped += 1; changed(); frameStop(); };
  };

  Object.assign(session, {
    run(name, params) {
      const command = registered.get(name);
      if (command === undefined) return Promise.reject(refuse(`the page registered no command ${name}`));
      return Promise.resolve().then(() => command(structuredClone(params ?? null))).then((value) => value ?? null);
    },
    read(name) {
      const entry = status.get(name);
      if (entry === undefined) throw refuse(`the page registered no status ${name}`);
      return entry.read();
    },
    watch(name) {
      const entry = status.get(name);
      if (entry === undefined) throw refuse(`the page registered no status ${name}`);
      return entry.subscribe((value) => { watched.push({ name, value: structuredClone(value) }); changed(); });
    },
    async push(event, data) {
      const handler = nativeHandlers.get(event);
      if (handler === undefined) throw refuse(`the page has no subscription to the native event ${event}`);
      // A native event reaches the page in a later turn than the call that sends it, as a message of the window does.
      await TURN();
      handler(structuredClone(data));
      await session.settled();
    },
    sidecarMessage(name, surface, { body, cids }) {
      const route = routes.get(`on\n${name}\n${surface}`);
      // A session that the page did not subscribe to, or one that ended with the page, has no route.
      if (route === undefined) throw refuse(`no subscription for it: the page is not subscribed to ${name} session ${surface}`);
      route(structuredClone(body), cids ?? []);
    },
    sidecarFailure(name, surface, error) {
      const route = routes.get(`onFailure\n${name}\n${surface}`);
      if (route === undefined) throw refuse(`no failure listener: the page has none for ${name} session ${surface}`);
      route(error);
    },
    setTheme(value) {
      currentTheme = value;
      for (const listener of [...themeListeners]) listener(value);
    },
    loss(event) {
      if (reportLoss === null) throw refuse("the page created no bridge, so no report function receives a loss");
      reportLoss(event);
    },
    settled: () => drain(0),
    until(condition) {
      if (condition()) return Promise.resolve();
      const wait = { condition, ...Promise.withResolvers() };
      waits.add(wait);
      return wait.promise;
    },
    /** Runs fn, which ends the work of the page (the pagehide of its window); the answers of the calls that fn starts are delivered. */
    async endWith(fn) {
      const since = callIndex;
      fn();
      await drain(since);
    },
    close() {
      if (closed) return;
      closed = true;
      routes.clear();
      open.splice(open.indexOf(session), 1);
    },
  });
  open.push(session);
  return session;
}
