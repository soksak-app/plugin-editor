// Behavior model of the call layer of a view page: each request is sent with an id and a time limit (10000 milliseconds
// unless the request declares one). A call that its limit ends is rejected with code -32000 and the message
// "command <name> did not reply within <ms>ms", and a reply that arrives later is reported as a late reply and is not passed
// to the call. Each change of the open calls is reported as open-calls. The conformance test replays
// test/fixtures/contract/calls.json on a fake clock.

const DEFAULT_LIMIT = 10000;

/** A rejection of a call, with the code of the call layer. */
function callError(message, code) {
  return Object.assign(new Error(message), { code });
}

/**
 * Creates the call layer of plugin: send({id, command, params}) posts a request, and report(event) stores a report of the
 * layer. request(command, params, timeout) returns a promise of the result; reply(id, {result} | {error}) delivers a reply.
 */
export function createCalls({ plugin, send, report }) {
  let nextId = 0;
  const open = new Map();
  const closed = new Map();

  const openReport = () => {
    const starts = [...open.values()].map((entry) => entry.startedAt);
    report({ kind: "open-calls", plugin, count: open.size, oldestStartedAt: starts.length === 0 ? null : Math.min(...starts) });
  };

  const expire = (id) => {
    const entry = open.get(id);
    open.delete(id);
    closed.set(id, entry);
    report({ kind: "timeout", plugin, command: entry.command, timeout: entry.limit });
    openReport();
    entry.reject(callError(`command ${entry.command} did not reply within ${entry.limit}ms`, -32000));
  };

  return {
    request(command, params, timeout = DEFAULT_LIMIT) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => expire(id), timeout);
        open.set(id, { command, limit: timeout, startedAt: Date.now(), timer, resolve, reject });
        send({ id, command, params });
        openReport();
      });
    },

    reply(id, body) {
      if (open.has(id)) {
        const entry = open.get(id);
        clearTimeout(entry.timer);
        open.delete(id);
        openReport();
        if (body.error !== undefined) entry.reject(callError(body.error.message, body.error.code));
        else entry.resolve(body.result ?? null);
        return;
      }
      if (closed.has(id)) {
        const entry = closed.get(id);
        closed.delete(id);
        report({ kind: "late-reply", plugin, command: entry.command, delay: Date.now() - entry.startedAt });
        return;
      }
      report({ kind: "unknown-reply", plugin, id });
    },
  };
}
