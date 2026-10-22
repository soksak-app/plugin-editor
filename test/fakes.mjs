// The fakes of the consumer boundary: a files sidecar over an in-memory file system, and the SHA-256 of a text.
import { createHash } from "node:crypto";

/** The SHA-256 of a text, the version of a file state. */
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** A files sidecar of one surface over an in-memory file system: read, write with expect, and watch. */
function fakeFiles(files) {
  const listeners = new Set();
  const sent = [];
  const reply = (body) => queueMicrotask(() => { for (const fn of listeners) fn(body); });
  const port = {
    sent,
    on: async (surface, fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    onFailure: async () => () => {},
    async send(surface, body) {
      sent.push(body);
      if (body.operation === "watch") return reply({ id: body.id });
      if (body.operation === "read") {
        if (!files.has(body.path)) return reply({ id: body.id, error: `no such file: ${body.path}` });
        const text = files.get(body.path);
        // A line feed without a carriage return before it makes the line breaks of the text mixed, as the files sidecar reports.
        const newline = /\r\n/.test(text) ? (/(^|[^\r])\n/.test(text) ? "mixed" : "crlf") : /\n/.test(text) ? "lf" : "none";
        return reply({ id: body.id, text, version: sha(text), newline, bom: false });
      }
      if (body.operation === "readBytes") {
        if (!files.has(body.path)) return reply({ id: body.id, error: `no such file: ${body.path}` });
        return reply({ id: body.id, data: Buffer.from(files.get(body.path)).toString("base64"), version: sha(files.get(body.path)) });
      }
      if (body.operation === "write" && body.expect === null) {
        if (files.has(body.path)) return reply({ id: body.id, error: `exists: ${body.path}` });
        files.set(body.path, body.text);
        return reply({ id: body.id, version: sha(body.text) });
      }
      if (body.operation === "write") {
        if (sha(files.get(body.path)) !== body.expect) return reply({ id: body.id, error: `changed on disk: ${body.path}` });
        files.set(body.path, body.text);
        return reply({ id: body.id, version: sha(body.text) });
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
