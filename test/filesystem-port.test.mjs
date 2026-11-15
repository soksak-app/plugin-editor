// Fault coverage for the test adapter's own cleanup; this is separate from editor behavior mutation evidence.
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { filesystemPort } from "./filesystem-port.mjs";

for (const phase of ["before", "during"]) test(`a filesystem fixture terminated ${phase} close retains its exit cause and cancels every wait`, async (t) => {
  const port = await filesystemPort(t);
  // The fixture's acknowledgement of a control message proves that it runs before it is killed.
  await port.acknowledged();
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
  await assert.rejects(access(port.root), { code: "ENOENT" });
});
