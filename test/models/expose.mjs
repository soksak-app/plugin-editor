// Behavior model of createExpose for the tests of the view page: the statuses and dom names that the page registers,
// the requests that the host forwards (status.*, dom.*), and the replies that the page sends. The binder of the model
// runs the commands registered through command(). The conformance test replays test/fixtures/contract/expose.json.
import { createBinder } from "./binder.mjs";

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
 * Creates the exposure of one page. port is {register(kind, name), unregister(), onRequest(answer), reply(id, payload), report(text)}
 * and declarations() returns the declared {status, dom, commands} entries of the plugin. After dispose, the page answers no request
 * and records the unregister of the port (core expose.json, expose.dispose.ends-registrations-and-requests).
 */
export function createExpose(port, declarations) {
  const declared = (kind, name) => (declarations()[kind] ?? []).some((entry) => entry.name === name);
  const statuses = new Map();
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

  /** A status request answered from the current value, its version and the waiting requests of the status. */
  const answerStatus = (method, params, id) => {
    const status = statuses.get(params?.name);
    if (!status) throw new ReplyError(UNKNOWN_STATUS, `unknown status ${params?.name}`);
    if (method === "status.get") return { result: status.read() };
    if (method === "status.watch") { status.watching = true; return { result: null }; }
    if (method === "status.unwatch") { status.watching = false; return { result: null }; }
    if (method === "status.next") {
      if (!status.watching) return { result: { closed: true } };
      if (params.version < status.version) return { result: { version: status.version, value: status.read() } };
      status.waiting.push(id);
      return null;
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
      return { result: { x: box.left, y: box.top, width: box.width, height: box.height } };
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
      if (method.startsWith("status.")) payload = answerStatus(method, params, id);
      else if (method.startsWith("dom.")) payload = answerDom(method, params);
      else throw new ReplyError(UNKNOWN_METHOD, `unknown method ${method}`);
    } catch (error) {
      payload = { error: { code: error.code ?? -32000, message: error.message } };
    }
    if (payload !== null) port.reply(id, payload);
  };
  port.onRequest(answer);

  return {
    /** Registers a status: read() returns its value and subscribe(changed) calls changed() when the value changes. */
    async status(name, read, subscribe) {
      if (!declared("status", name)) throw new Error(`status ${name} is not declared`);
      if (statuses.has(name)) throw new Error(`status ${name} is already registered`);
      const status = { read, version: 1, watching: false, waiting: [] };
      statuses.set(name, status);
      subscribe(() => {
        status.version += 1;
        const value = status.read();
        for (const id of status.waiting.splice(0)) port.reply(id, { result: { version: status.version, value } });
      });
      await port.register("status", name);
      return null;
    },

    async command(name, run) {
      if (!declared("commands", name)) throw new Error(`command ${name} is not declared`);
      commands.set(name, run);
      await port.register("command", name);
      return null;
    },

    /** Registers a dom name for the element it names; the element is the one that the requests act on. */
    async dom(name, element) {
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
      await port.unregister();
      return null;
    },
  };
}
