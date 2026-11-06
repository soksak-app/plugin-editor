// The fakes of the consumer boundary: a files sidecar over an in-memory file system, and the SHA-256 of a text.
import { createHash } from "node:crypto";

/** The SHA-256 of a text, the version of a file state. */
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** A files sidecar of one surface over an in-memory file system: read, write with expect, and watch. */
function fakeFiles(files) {
  const listeners = new Set();
  const sent = [];
  const held = [];
  const reply = (body) => queueMicrotask(() => { for (const fn of listeners) fn(body); });
  const port = {
    sent,
    // Hold one reply after its operation has taken effect; received and release control the ordering without a timer.
    holdReply(operation) {
      const { promise: received, resolve } = Promise.withResolvers();
      let response;
      held.push({ operation, hold(body) { response = body; resolve(body); } });
      return { received, release() {
        if (response === undefined) throw new Error(`no ${operation} reply is held`);
        const body = response;
        response = undefined;
        reply(body);
      } };
    },
    on: async (surface, fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    onFailure: async () => () => {},
    async send(surface, body) {
      sent.push(body);
      const index = held.findIndex((entry) => entry.operation === body.operation);
      const respond = index < 0 ? reply : held.splice(index, 1)[0].hold;
      if (body.operation === "watch") return respond({ id: body.id });
      if (body.operation === "read") {
        if (!files.has(body.path)) return respond({ id: body.id, error: `no such file: ${body.path}` });
        const text = files.get(body.path);
        // A line feed without a carriage return before it makes the line breaks of the text mixed, as the files sidecar reports.
        const newline = /\r\n/.test(text) ? (/(^|[^\r])\n/.test(text) ? "mixed" : "crlf") : /\n/.test(text) ? "lf" : "none";
        return respond({ id: body.id, text, version: sha(text), newline, bom: false });
      }
      if (body.operation === "readBytes") {
        if (!files.has(body.path)) return respond({ id: body.id, error: `no such file: ${body.path}` });
        return respond({ id: body.id, data: Buffer.from(files.get(body.path)).toString("base64"), version: sha(files.get(body.path)) });
      }
      if (body.operation === "write" && body.expect === null) {
        if (files.has(body.path)) return respond({ id: body.id, error: `exists: ${body.path}` });
        files.set(body.path, body.text);
        return respond({ id: body.id, version: sha(body.text) });
      }
      if (body.operation === "write") {
        if (sha(files.get(body.path)) !== body.expect) return respond({ id: body.id, error: `changed on disk: ${body.path}` });
        files.set(body.path, body.text);
        return respond({ id: body.id, version: sha(body.text) });
      }
      throw new Error(`unexpected operation ${body.operation}`);
    },
    report: (body) => reply(body),
    change(path, text) {
      files.set(path, text);
      reply({ changed: path });
    },
  };
  return port;
}

export { fakeFiles };
export { sha };
