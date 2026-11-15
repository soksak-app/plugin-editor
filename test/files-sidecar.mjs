// The files sidecar of the editor surface for the view test host: an in-memory file system. The sidecar lies outside core, so its
// replies and watch messages are the fixtures of the tests, and each one reaches the page through the sidecar route that the
// page registered (sidecarMessage of openView).
import { createHash } from "node:crypto";

export const SIDECAR = "@soksak/sidecar-files";
export const SURFACE = "editor-1";

/** The SHA-256 of a text, the version of a file state. */
export const sha = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Creates the files sidecar over the Map `files` (path to text). attach(view) connects it to the view that openView returned,
 * before the page is loaded.
 *
 * send(body) runs the operation of a request at once. Its reply reaches the page as a sidecar message of the surface in a later
 * microtask. holdReply(operation) holds the reply of the next operation of that name: received resolves when the operation has
 * taken effect, and release() delivers the held reply. change(path, text) writes the file and delivers its watch message.
 */
export function filesSidecar(files) {
  let view = null;
  const sent = [];
  const held = [];
  // Delivers one message of the sidecar to the page; the returned promise resolves after the delivery, or rejects with its refusal.
  // A message that the view host refuses, such as a message after the view closed, rejects the returned promise with the refusal.
  const deliver = (body) => new Promise((resolve, reject) => queueMicrotask(() => {
    try {
      view.sidecarMessage(SIDECAR, SURFACE, { body });
      resolve();
    } catch (error) {
      reject(error);
    }
  }));
  // A reply goes to the held entry of its request's operation, or is delivered at once; the request names the operation.
  const respond = (request, reply) => {
    const index = held.findIndex((entry) => entry.operation === request.operation);
    return index < 0 ? deliver(reply) : held.splice(index, 1)[0].hold(reply);
  };
  return {
    sent,
    attach(target) {
      view = target;
    },
    holdReply(operation) {
      const { promise: received, resolve } = Promise.withResolvers();
      let response;
      held.push({ operation, hold(body) { response = body; resolve(body); } });
      return { received, release() {
        if (response === undefined) throw new Error(`no ${operation} reply is held`);
        const body = response;
        response = undefined;
        return deliver(body);
      } };
    },
    /** The send route of the sidecar: the operation runs here, and its reply goes to respond. */
    send(body) {
      sent.push(body);
      if (body.operation === "watch") return respond(body, { id: body.id });
      if (body.operation === "read") {
        if (!files.has(body.path)) return respond(body, { id: body.id, error: `no such file: ${body.path}` });
        const text = files.get(body.path);
        // A line feed without a carriage return before it makes the line breaks of the text mixed, as the files sidecar reports.
        const newline = /\r\n/.test(text) ? (/(^|[^\r])\n/.test(text) ? "mixed" : "crlf") : /\n/.test(text) ? "lf" : "none";
        return respond(body, { id: body.id, text, version: sha(text), newline, bom: false });
      }
      if (body.operation === "readBytes") {
        if (!files.has(body.path)) return respond(body, { id: body.id, error: `no such file: ${body.path}` });
        return respond(body, { id: body.id, data: Buffer.from(files.get(body.path)).toString("base64"), version: sha(files.get(body.path)) });
      }
      if (body.operation === "write" && body.expect === null) {
        if (files.has(body.path)) return respond(body, { id: body.id, error: `exists: ${body.path}` });
        files.set(body.path, body.text);
        return respond(body, { id: body.id, version: sha(body.text) });
      }
      if (body.operation === "write") {
        if (sha(files.get(body.path)) !== body.expect) return respond(body, { id: body.id, error: `changed on disk: ${body.path}` });
        files.set(body.path, body.text);
        return respond(body, { id: body.id, version: sha(body.text) });
      }
      throw new Error(`unexpected operation ${body.operation}`);
    },
    change(path, text) {
      files.set(path, text);
      return deliver({ changed: path });
    },
    /** Delivers the message body as the reply of the sidecar: a reply of a request by its id, or a failure without an id. */
    report(body) {
      return deliver(body);
    },
  };
}
