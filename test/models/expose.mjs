// Behavior model of createExpose for the tests of the view page: the statuses and dom names that the page registers,
// the requests that the host forwards (status.*, dom.*), the replies that the page sends, and the changed calls of watched
// statuses. The binder of the model runs the commands registered through command(). The conformance test replays
// test/fixtures/contract/expose.json.
import { createBinder } from "./binder.mjs";

/**
 * The effective CSS zoom of the element, as elementRect of the plugin API reads it: the product of the computed zoom of the
 * element and of each ancestor of the flat tree (a slotted element continues at its slot, a shadow root at its host).
 */
function effectiveZoom(element) {
  const view = element.ownerDocument.defaultView;
  let zoom = 1;
  // default: each step takes the next flat-tree parent: the slot of a slotted element, else the parent element, else the host
  // of a shadow root; the document element has none of them, so null ends the walk at the root of the flat tree.
  for (let node = element; node; node = node.assignedSlot ?? node.parentElement ?? node.getRootNode().host ?? null) {
    const computed = view.getComputedStyle(node).zoom;
    const value = Number(computed);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`computed zoom ${computed} is not a positive number`);
    zoom *= value;
  }
  return zoom;
}

const UNKNOWN_STATUS = 1001;
const UNKNOWN_TARGET = 1002;
const INVALID_PARAMS = -32602;
const UNKNOWN_METHOD = -32601;

/** The error of a request answer: a code and the message the page sends to the host. */
class ReplyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Creates the exposure of one page. port is {register(kind, name), onRequest(answer), reply(id, payload), changed(name, value, version),
 * report(text)} and may hold unregister(), which a port that publishes removal provides. changed is required: a watched status
 * sends its value through it. declarations() returns the declared {status, dom, commands} entries of the plugin. After dispose,
 * the page refuses each registration with "exposure is disposed", answers no request, and ends its bindings. The view port holds
 * no unregister: the view channel publishes no removal of a registration while the view is open (core expose.json, expose.dispose.*),
 * so dispose ends the local listeners only.
 */
export function createExpose(port, declarations) {
  if (typeof port.changed !== "function") throw new TypeError("createExpose requires the port changed function");
  const declared = (kind, name) => (declarations()[kind] ?? []).some((entry) => entry.name === name);
  const statuses = new Map();
  const DISPOSED = "exposure is disposed";
  const commands = new Map();
  const doms = new Map();
  let disposed = false;

  const binder = createBinder((name, params, element) => {
    const run = commands.get(name);
    if (!run) throw new Error(`command ${name} is not registered`);
    return run(params, element);
  }, {
    check: (name) => { if (!declared("commands", name)) throw new Error(`command ${name} is not declared`); },
  });

  /** Sends a value of a watched status through changed with its next version, when the value differs from the last one sent. */
  const update = (status, value) => {
    if (!status.watching) return;
    const text = JSON.stringify(value);
    if (text === status.text) return;
    status.text = text;
    status.value = value;
    status.version += 1;
    port.changed(status.name, value, status.version);
  };

  /** A status request answered from the current value; a watch sends the current value through changed. */
  const answerStatus = (method, params) => {
    const status = statuses.get(params?.name);
    if (!status) throw new ReplyError(UNKNOWN_STATUS, `unknown status ${params?.name}`);
    if (method === "status.get") return { result: status.read() };
    if (method === "status.watch") {
      // A repeated watch sends the last value again with its version, so a new subscriber of the watch receives it.
      if (status.watching) {
        if (status.version > 0) port.changed(status.name, status.value, status.version);
        return { result: null };
      }
      status.watching = true;
      update(status, status.read());
      return { result: null };
    }
    if (method === "status.unwatch") {
      status.watching = false;
      // The next watch sends the value it reads, also when that value equals the last value of the earlier watch.
      status.text = undefined;
      return { result: null };
    }
    throw new ReplyError(UNKNOWN_METHOD, `unknown method ${method}`);
  };

  const answerDom = (method, params) => {
    const dom = doms.get(params?.name);
    if (!dom) throw new ReplyError(UNKNOWN_TARGET, `unknown dom ${params?.name}`);
    if (method === "dom.rect") {
      if (params.index !== undefined && params.index !== 0) {
        throw new ReplyError(UNKNOWN_TARGET, `dom ${params.name} has no element at index ${params.index}`);
      }
      const box = dom.element.getBoundingClientRect();
      return { result: { x: box.left, y: box.top, width: box.width, height: box.height, zoom: effectiveZoom(dom.element) } };
    }
    if (method === "dom.act") {
      if (params.address !== undefined) throw new ReplyError(INVALID_PARAMS, `dom ${params.name} takes no address`);
      if (params.action !== "click") throw new ReplyError(INVALID_PARAMS, `unknown action ${params.action}`);
      if (params.index !== undefined && (!Number.isInteger(params.index) || params.index < 0)) {
        throw new ReplyError(INVALID_PARAMS, "index must be a non-negative integer");
      }
      if (params.index !== undefined && params.index !== 0) {
        throw new ReplyError(UNKNOWN_TARGET, `dom ${params.name} has no element at index ${params.index}`);
      }
      dom.element.click();
      return { result: null };
    }
    throw new ReplyError(UNKNOWN_METHOD, `unknown method ${method}`);
  };

  const answer = ({ id, method, params }) => {
    if (disposed) return;
    let payload;
    try {
      if (method.startsWith("status.")) payload = answerStatus(method, params);
      else if (method.startsWith("dom.")) payload = answerDom(method, params);
      else throw new ReplyError(UNKNOWN_METHOD, `unknown method ${method}`);
    } catch (error) {
      payload = { error: { code: error.code ?? -32000, message: error.message } };
    }
    if (payload !== null) port.reply(id, payload);
  };
  port.onRequest(answer);

  return {
    /** Registers a status: read() returns its value and subscribe(fn) calls fn(value) when the value changes. */
    async status(name, read, subscribe) {
      if (disposed) throw new Error(DISPOSED);
      if (!declared("status", name)) throw new Error(`status ${name} is not declared`);
      if (statuses.has(name)) throw new Error(`status ${name} is already registered`);
      // The declarations load asynchronously, so a dispose during the load ends the registration.
      await Promise.resolve();
      if (disposed) throw new Error(DISPOSED);
      const status = { name, read, watching: false, text: undefined, value: null, version: 0 };
      statuses.set(name, status);
      subscribe((value) => update(status, value));
      await port.register("status", name);
      return null;
    },

    async command(name, run) {
      if (disposed) throw new Error(DISPOSED);
      if (!declared("commands", name)) throw new Error(`command ${name} is not declared`);
      commands.set(name, run);
      await port.register("command", name);
      return null;
    },

    /** Registers a dom name for the element it names; the element is the one that the requests act on. */
    async dom(name, element) {
      if (disposed) throw new Error(DISPOSED);
      if (!declared("dom", name)) throw new Error(`dom ${name} is not declared`);
      if (doms.has(name)) throw new Error(`dom ${name} is already registered`);
      doms.set(name, { element });
      await port.register("dom", name);
      return null;
    },

    bind: binder.bind,
    delegate: binder.delegate,
    audit: binder.audit,
    async dispose() {
      disposed = true;
      for (const status of statuses.values()) status.watching = false;
      await binder.dispose();
      if (port.unregister) await port.unregister();
      return null;
    },
  };
}
