// Drives the real-file fixture through the declared files JSONL wire; IPC is reserved for test scheduling and cleanup evidence.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

function deadline(promise, description, millis = 5000) {
  let timer;
  const expired = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${description}`)), millis);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

export async function filesystemPort(t, beforeClose = async () => {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "editor-filesystem-"));
  const child = fork(fileURLToPath(new URL("./fixtures/filesystem-process.mjs", import.meta.url)), [root], {
    silent: true, execArgv: [],
  });
  const events = new EventEmitter();
  const listeners = new Set();
  const failures = [];
  const sent = [];
  const operations = new Map();
  const holds = [];
  const controls = new Map();
  let serial = 0;
  let stderr = "";
  let nativeChanges = 0;
  let paused = false;
  let stopping = null;
  let exitResult = null;
  let heldChanges = null;
  const ended = new Promise((resolve) => child.once("close", (code, signal) => {
    exitResult = { code, signal };
    resolve(exitResult);
  }));
  const deliver = (body) => { for (const listener of listeners) listener(body); };
  child.stderr.setEncoding("utf8").on("data", (text) => { stderr += text; });
  child.on("error", (error) => { failures.push(error.message); });
  child.on("message", (message) => {
    if (message.nativeChange !== undefined) nativeChanges += 1;
    if (message.control !== undefined) {
      const control = controls.get(message.control);
      if (!control) { failures.push(`unknown control ${message.control}`); return; }
      controls.delete(message.control);
      control.resolve(message);
    }
    if (message.paused !== undefined) paused = true;
    events.emit("control", message);
  });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  output.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); }
    catch (error) { failures.push(`invalid fixture output: ${error.message}`); return; }
    if (message.surface !== "editor-1") { failures.push(`unknown surface ${message.surface}`); return; }
    if (message.closed) { events.emit("closed", message); return; }
    const body = message.body;
    if (body.changed !== undefined && heldChanges !== null) {
      heldChanges.messages.push(body);
      heldChanges.received.resolve(body);
      return;
    }
    const operation = operations.get(body.id);
    operations.delete(body.id);
    const index = holds.findIndex((hold) => hold.operation === operation);
    if (index >= 0) holds.splice(index, 1)[0].receive(body);
    else deliver(body);
  });

  const waitEvent = (name, predicate, description, signal) => {
    const result = Promise.withResolvers();
    const listener = (value) => { if (predicate(value)) result.resolve(value); };
    const aborted = () => result.reject(signal.reason);
    events.on(name, listener);
    if (signal?.aborted) aborted();
    else signal?.addEventListener("abort", aborted, { once: true });
    return deadline(result.promise, description).finally(() => {
      events.off(name, listener);
      signal?.removeEventListener("abort", aborted);
    });
  };
  const control = (action) => {
    const id = ++serial;
    const result = Promise.withResolvers();
    controls.set(id, result);
    child.send({ action, id }, (error) => { if (error) result.reject(error); });
    return { id, done: deadline(result.promise, `fixture control ${action}`) };
  };
  const send = (message) => deadline(new Promise((resolve, reject) => {
    child.stdin.write(JSON.stringify(message) + "\n", (error) => error ? reject(error) : resolve());
  }), "files wire send");

  const port = {
    root, sent,
    on: async (surface, listener) => { assert.equal(surface, "editor-1"); listeners.add(listener); return () => listeners.delete(listener); },
    onFailure: async () => () => {},
    async send(surface, body) {
      sent.push(body);
      operations.set(body.id, body.operation);
      await send({ surface, root, cids: [], body });
    },
    async pauseWrite() {
      const armed = control("pause-write");
      const entered = waitEvent("control", (message) => message.paused === armed.id, "the real write pause");
      await armed.done;
      return { entered, async release() { await control("resume-write").done; paused = false; } };
    },
    holdReply(operation) {
      const result = Promise.withResolvers();
      let reply;
      holds.push({ operation, receive(body) { reply = body; result.resolve(body); } });
      return { received: deadline(result.promise, `held ${operation} reply`), release() {
        assert.notEqual(reply, undefined, `no ${operation} reply is held`);
        const body = reply;
        reply = undefined;
        deliver(body);
      } };
    },
    holdChanges() {
      assert.equal(heldChanges, null, "file notifications are already held");
      const held = { messages: [], received: Promise.withResolvers() };
      heldChanges = held;
      return { received: deadline(held.received.promise, "a held native file notification"), releaseOne() {
        assert.ok(held.messages.length > 0, "no native file notification is held");
        deliver(held.messages.shift());
      }, release() {
        assert.equal(heldChanges, held);
        heldChanges = null;
        for (const body of held.messages) deliver(body);
        held.messages.length = 0;
      } };
    },
    nextNativeChange(relative) {
      return waitEvent("control", (message) => message.nativeChange === relative, `native change of ${relative}`);
    },
    exited: () => deadline(ended, "fixture process exit"),
    inspect: () => ({ listeners: listeners.size, nativeChanges, pid: child.pid, exit: exitResult,
      waiting: events.listenerCount("closed") + events.listenerCount("control") }),
    async close() {
      if (stopping) return stopping;
      stopping = (async () => {
        const cancelClose = new AbortController();
        const closeWaits = [];
        const exitFailure = ({ code, signal }) => new Error(`filesystem fixture ended before close completed: ${signal ?? `exit ${code}`}`);
        try {
          await beforeClose();
          assert.equal(listeners.size, 0, "the editor did not remove its sidecar subscription");
          heldChanges = null;
          if (exitResult !== null) throw exitFailure(exitResult);
          if (paused) { await control("resume-write").done; paused = false; }
          const acknowledgement = waitEvent("closed", () => true, "files surface close", cancelClose.signal);
          const cleanup = waitEvent("control", (message) => message.closed === true, "watch cleanup", cancelClose.signal);
          closeWaits.push(acknowledgement, cleanup);
          const [, resources] = await Promise.race([
            Promise.all([acknowledgement, cleanup, send({ surface: "editor-1", root, closed: true })]),
            ended.then((result) => { throw exitFailure(result); }),
          ]);
          assert.equal(resources.watches, 0);
          child.stdin.end();
          const result = await deadline(ended, "fixture process exit");
          if (result.code !== 0 || result.signal !== null) throw exitFailure(result);
          assert.equal(stderr, "", "the fixture wrote an unexpected error");
          assert.deepEqual(failures, []);
        } finally {
          cancelClose.abort(new Error("the filesystem close operation ended"));
          await Promise.allSettled(closeWaits);
          if (exitResult === null) { child.kill("SIGKILL"); await deadline(ended, "fixture termination"); }
          output.close();
          await rm(root, { recursive: true, force: true });
        }
        await assert.rejects(access(root), { code: "ENOENT" });
        t.diagnostic("filesystem cleanup " + JSON.stringify({ watches: 0, listeners: listeners.size,
          exitCode: exitResult.code, signal: exitResult.signal, temporaryDirectoryRemoved: true }));
      })();
      return stopping;
    },
  };
  t.after(() => port.close());
  return port;
}

export function nextDocument(t, editor, predicate) {
  const result = Promise.withResolvers();
  const stop = editor.watchStatus("editor.document", (state) => { if (predicate(state)) result.resolve(state); });
  t.after(stop);
  return deadline(result.promise, "editor document status").finally(stop);
}
