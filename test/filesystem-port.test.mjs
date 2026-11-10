// Fault coverage for the test adapter's own cleanup; this is separate from editor behavior mutation evidence.
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { filesystemPort } from "./filesystem-port.mjs";

for (const phase of ["before", "during"]) test(`a filesystem fixture terminated ${phase} close retains its exit cause and cancels every wait`, async (t) => {
  const cleanup = [];
  const port = await filesystemPort({ after(fn) { cleanup.push(fn); }, diagnostic: t.diagnostic.bind(t) });
  // The helper registers cleanup even for a failed assertion. This test deliberately expects the same SIGKILL cause there.
  t.after(async () => {
    for (const close of cleanup) {
      try { await close(); }
      catch (error) { assert.match(error.message, /SIGKILL/); }
    }
  });
  const ready = Promise.withResolvers();
  const stop = await port.on("editor-1", (body) => { if (body.id === "ready") ready.resolve(body); });
  await port.send("editor-1", { operation: "watch", id: "ready", paths: [] });
  assert.deepEqual(await ready.promise, { id: "ready" });
  stop();
  if (phase === "before") {
    process.kill(port.inspect().pid, "SIGKILL");
    assert.equal((await port.exited()).signal, "SIGKILL");
    await assert.rejects(port.close(), /SIGKILL/);
  } else {
    const rejected = assert.rejects(port.close(), /SIGKILL/);
    // Close registers its acknowledgement and watcher cleanup waits; the test awaits both registrations.
    await port.untilWaiting(2);
    assert.equal(port.inspect().waiting, 2, "both close acknowledgement and watcher cleanup must be pending");
    process.kill(port.inspect().pid, "SIGKILL");
    await rejected;
  }
  assert.equal(port.inspect().waiting, 0, "unexpected exit must cancel all close acknowledgement and watcher waits");
  assert.equal(port.inspect().listeners, 0);
  await assert.rejects(access(port.root), { code: "ENOENT" });
});
