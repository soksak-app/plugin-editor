// Requests to the files sidecar session of a surface (core docs/spec/sidecars.md#files): each request carries an id,
// and the reply with the same id resolves it or rejects it with its error.
import { failure, microsSince } from "./events.js";

/**
 * Connects to the sidecar of surfaceId. onEvent receives every message without an id: a change {changed} or a watch
 * failure {error}. emitEvent stores the event of each request with its result. Returns {request(body), dispose(), pending()}.
 */
export async function connect(sidecar, surfaceId, onEvent, emitEvent) {
  const pending = new Map();
  let next = 0;
  const stop = await sidecar.on(surfaceId, (body) => {
    if (body.id === undefined) {
      onEvent(body);
      return;
    }
    const request = pending.get(body.id);
    if (!request) throw new Error(`files sidecar replied to unknown request ${body.id}`);
    pending.delete(body.id);
    if (body.error !== undefined) request.reject(new Error(body.error));
    else request.resolve(body);
    request.done(body.error === undefined ? undefined : new Error(body.error));
  });
  const request = (body) => new Promise((resolve, reject) => {
    const id = `${body.operation}-${++next}`;
    const start = performance.now();
    const done = (error) => emitEvent(error === undefined ? "debug" : "warn", "plugin.editor.request", {
      operation: body.operation, id, micros: microsSince(start), ok: error === undefined,
      ...(error === undefined ? {} : { error: failure(error, "-32603") }) });
    pending.set(id, { resolve, reject, done });
    sidecar.send(surfaceId, { ...body, id }).catch((error) => {
      pending.delete(id);
      done(error);
      reject(error);
    });
  });
  const dispose = () => {
    stop();
    for (const { reject, done } of pending.values()) {
      const closed = new Error("the editor closed before the files sidecar replied");
      done(closed);
      reject(closed);
    }
    pending.clear();
  };
  return { request, dispose, pending: () => pending.size };
}
