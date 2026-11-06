// A consumer wire fixture over real files. IPC controls scheduling; only JSONL on stdio is the files wire.
import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const root = path.resolve(process.argv[2]);
const watchers = new Map();
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let nextPause = null;
let paused = null;
let queue = Promise.resolve();
let closed = false;

const report = (body) => process.send?.(body);
const send = (surface, body, cids) => process.stdout.write(JSON.stringify({ surface, ...(cids ? { cids } : {}), body }) + "\n");
const target = (relative) => {
  const resolved = path.resolve(root, relative);
  if (path.isAbsolute(relative) || !resolved.startsWith(root + path.sep)) throw new Error(`path leaves root: ${relative}`);
  return resolved;
};
const bytesAt = async (relative) => {
  const file = target(relative);
  if (!(await stat(file)).isFile()) throw new Error(`not a regular file: ${relative}`);
  return readFile(file);
};
const textBody = (bytes) => {
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bom ? bytes.subarray(3) : bytes);
  const breaks = new Set(text.match(/\r\n|\r|\n/g) ?? []);
  const newline = breaks.size > 1 ? "mixed" : ({ "\r\n": "crlf", "\r": "cr", "\n": "lf" })[[...breaks][0]] ?? "none";
  return { text, version: hash(bytes), newline, bom };
};
const stopWatches = async () => {
  const stopped = [...watchers.values()].map((watcher) => new Promise((resolve) => {
    watcher.once("close", resolve);
    watcher.close();
  }));
  watchers.clear();
  await Promise.all(stopped);
};

process.on("message", (message) => {
  if (message.action === "pause-write") {
    if (nextPause !== null || paused !== null) throw new Error("a write pause is already armed");
    nextPause = message.id;
  } else if (message.action === "resume-write") {
    if (paused === null) throw new Error("no write is paused");
    paused.resolve();
    paused = null;
  } else throw new Error(`unsupported fixture control ${message.action}`);
  report({ control: message.id, ok: true });
});

async function handle(message) {
  if (message.root !== root) throw new Error("the wire root differs from the fixture root");
  if (message.closed === true) {
    await stopWatches();
    closed = true;
    process.stdout.write(JSON.stringify({ surface: message.surface, closed: true }) + "\n");
    report({ closed: true, watches: watchers.size });
    return;
  }
  const { surface, cids, body } = message;
  try {
    if (closed) throw new Error("the fixture surface is closed");
    if (body.operation === "watch") {
      await stopWatches();
      for (const relative of body.paths) {
        const watcher = watch(target(relative), () => {
          // Native notifications may be duplicated; the consumer rereads the actual bytes for every delivered change.
          report({ nativeChange: relative });
          send(surface, { changed: relative });
        });
        watcher.on("error", (error) => send(surface, { error: error.message }));
        watchers.set(relative, watcher);
      }
      send(surface, { id: body.id }, cids);
      return;
    }
    if (body.operation === "read" || body.operation === "readBytes") {
      const bytes = await bytesAt(body.path);
      send(surface, { id: body.id, ...(body.operation === "read" ? textBody(bytes)
        : { data: bytes.toString("base64"), version: hash(bytes) }) }, cids);
      return;
    }
    if (body.operation !== "write") throw new Error(`unsupported fixture operation ${body.operation}`);
    const bytes = Buffer.concat([body.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(body.text)]);
    let file;
    try { file = await open(target(body.path), body.expect === null ? "wx+" : "r+"); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error(`exists: ${body.path}`);
      throw error;
    }
    try {
      if (body.expect !== null && hash(await file.readFile()) !== body.expect) throw new Error(`changed on disk: ${body.path}`);
      if (nextPause !== null) {
        const token = nextPause;
        nextPause = null;
        paused = Promise.withResolvers();
        report({ paused: token, request: body.id });
        await paused.promise;
      }
      const result = await file.write(bytes, 0, bytes.length, 0);
      if (result.bytesWritten !== bytes.length) throw new Error(`short write: ${body.path}`);
      await file.truncate(bytes.length);
      await file.sync();
    } finally { await file.close(); }
    // The reply describes persisted bytes, independently read back after the file descriptor has closed.
    const actual = await bytesAt(body.path);
    if (!actual.equals(bytes)) throw new Error(`write readback differs: ${body.path}`);
    send(surface, { id: body.id, version: hash(actual) }, cids);
  } catch (error) { send(surface, { id: body.id, error: error.message }, cids); }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  queue = queue.then(() => handle(JSON.parse(line))).catch((error) => {
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
  });
});
input.on("close", async () => {
  if (paused) { paused.resolve(); paused = null; }
  await queue;
  await stopWatches();
  process.disconnect();
});
