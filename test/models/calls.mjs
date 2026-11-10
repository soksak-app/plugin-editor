// Behavior model of the call layer of a view page (core packages/plugin-api/calls.js). A call has no time limit: its reply, its
// cancel or the end of its peer ends it, and the model starts no timer. A reply resolves the call, and an error reply rejects it
// with the message and the code of the error. A request with an abort signal sends {id, cancel: true} when the signal aborts,
// and the call is rejected with cancelled; a reply that arrives after the cancel is reported as a late reply and is not passed
// to the call. The end of the peer rejects each open call with "command <name> ended: <reason>" and reports peer-lost for each
// of them. Each change of the open calls is reported as open-calls. The conformance test replays
// test/fixtures/contract/calls.json with a fixed clock.

/** The reasons that end a call when its peer is lost. */
export const PEER_LOST_REASONS = ["process-ended", "surface-closed", "sidecar-ended"];

/** A rejection of a call, with the fields of the call layer. */
function callError(message, fields) {
  return Object.assign(new Error(message), fields);
}

/**
 * Creates the call layer of plugin: send({id, command, params}) posts a request or a cancel, report(event) stores a report of
 * the layer, and now() is the clock of the start of a call and of the delay of a late reply. request(command, params, options)
 * returns a promise of the result, options.signal is an AbortSignal; reply(id, {result} | {error}) delivers a reply, and
 * peerLost(reason) ends every open call because its peer is gone.
 */
export function createCalls({ plugin, send, report, now = Date.now }) {
  let nextId = 0;
  // Open calls by id, in the order of their start, so the first entry is the oldest call.
  const open = new Map();
  // Calls that their cancel ended, by id, for the late replies.
  const ended = new Map();

  const changed = () => {
    const oldest = open.values().next().value;
    report({ kind: "open-calls", plugin, count: open.size, oldestStartedAt: oldest ? oldest.startedAt : null });
  };

  /** Removes a call from the open calls and its abort listener; the caller settles its promise. */
  const end = (id) => {
    const entry = open.get(id);
    open.delete(id);
    entry.detach();
    return entry;
  };

  const cancel = (id) => {
    const entry = end(id);
    ended.set(id, entry);
    changed();
    send({ id, cancel: true });
    entry.reject(callError("cancelled", { reason: "cancelled" }));
  };

  return {
    request(command, params, options = {}) {
      if (Object.hasOwn(options, "timeout")) throw new TypeError("timeout is not an option of a call: a call ends by its reply, its cancel or the end of its peer");
      const { signal } = options;
      if (signal?.aborted) return Promise.reject(callError("cancelled", { reason: "cancelled" }));
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const entry = { command, startedAt: now(), resolve, reject, detach: () => {} };
        open.set(id, entry);
        if (signal) {
          const onAbort = () => cancel(id);
          signal.addEventListener("abort", onAbort, { once: true });
          entry.detach = () => signal.removeEventListener("abort", onAbort);
        }
        send({ id, command, params });
        changed();
      });
    },

    reply(id, body) {
      if (open.has(id)) {
        const entry = end(id);
        changed();
        if (body.error !== undefined) entry.reject(callError(body.error.message, { code: body.error.code }));
        else entry.resolve(body.result ?? null);
        return;
      }
      if (ended.has(id)) {
        const entry = ended.get(id);
        report({ kind: "late-reply", plugin, command: entry.command, delay: now() - entry.startedAt });
        return;
      }
      report({ kind: "unknown-reply", plugin, id });
    },

    /** Ends every open call because its peer is gone; reason is one of PEER_LOST_REASONS. */
    peerLost(reason) {
      if (!PEER_LOST_REASONS.includes(reason)) throw new RangeError(`peer lost reason must be one of ${PEER_LOST_REASONS.join(", ")}, got ${reason}`);
      const entries = [...open.keys()].map((id) => end(id));
      for (const entry of entries) {
        report({ kind: "peer-lost", plugin, command: entry.command, reason });
        entry.reject(callError(`command ${entry.command} ended: ${reason}`, { reason }));
      }
      changed();
    },
  };
}
