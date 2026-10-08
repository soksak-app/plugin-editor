// Requests to the files sidecar session of a surface (core docs/spec/sidecars.md#files): each request carries an id,
// and the reply with the same id resolves it or rejects it with its error.

/**
 * Connects to the sidecar of surfaceId. onEvent receives every message without an id: a change {changed} or a watch
 * failure {error}. Returns {request(body), dispose()}.
 */
export async function connect(sidecar, surfaceId, onEvent) {
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
  });
  const request = (body) => new Promise((resolve, reject) => {
    const id = `${body.operation}-${++next}`;
    pending.set(id, { resolve, reject });
    sidecar.send(surfaceId, { ...body, id }).catch((failure) => {
      pending.delete(id);
      reject(failure);
    });
  });
  const dispose = () => {
    stop();
    for (const { reject } of pending.values()) reject(new Error("the editor closed before the files sidecar replied"));
    pending.clear();
  };
  return { request, dispose };
}
