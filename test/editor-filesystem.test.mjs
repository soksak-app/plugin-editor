// Editor integration with actual files, native file notifications and the declared wire in a separate process.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { setup } from "./editor-host.mjs";
import { filesystemPort, nextDocument } from "./filesystem-port.mjs";

const version = (text) => createHash("sha256").update(text).digest("hex");
const filePath = "src/main.js";

async function project(t, text = "initial\r\n") {
  let editor;
  const port = await filesystemPort(t, () => editor?.dispose());
  await mkdir(path.join(port.root, "src"));
  const file = path.join(port.root, filePath);
  await writeFile(file, text);
  editor = await setup(t, { path: filePath, filesPort: port, projectRoot: port.root });
  return { editor, port, file };
}

test("filesystem save keeps edits made while its real write is paused", async (t) => {
  const { editor, port, file } = await project(t);
  editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "saved-" }] });
  const submitted = editor.run("editor.read");
  const pause = await port.pauseWrite();
  const saving = editor.run("editor.save");
  await pause.entered;
  assert.equal(await readFile(file, "utf8"), "initial\r\n", "the real write has not started");
  editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "later-" }] });
  const nativeChange = port.nextNativeChange(filePath);
  await pause.release();
  await saving;
  await nativeChange;
  assert.equal(await readFile(file, "utf8"), submitted);
  assert.equal(editor.run("editor.read"), `later-${submitted}`);
  assert.equal(editor.status("editor.document").modified, true, "a later edit must remain modified after the real write");
  assert.equal(editor.reports.modified.at(-1), true, "the close consumer must receive the unsaved state");
  await editor.run("editor.save");
  assert.equal(await readFile(file, "utf8"), `later-${submitted}`);
  assert.equal(editor.reports.modified.at(-1), false);
  assert.deepEqual(editor.reports.error.filter((error) => error !== null), []);
  await editor.dispose();
  await port.close();
  assert.deepEqual(port.inspect().exit, { code: 0, signal: null });
});

test("filesystem notifications preserve dirty text until an explicit reload", async (t) => {
  const { editor, port, file } = await project(t);
  editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "local-" }] });
  const local = editor.run("editor.read");
  const changed = nextDocument(t, editor, (state) => state.disk === "changed");
  const notifications = port.holdChanges();
  const nativeChange = port.nextNativeChange(filePath);
  await writeFile(file, "external\r\n");
  await nativeChange;
  await notifications.received;
  notifications.releaseOne();
  await changed;
  assert.equal(editor.run("editor.read"), local);
  assert.equal(editor.reports.modified.at(-1), true);
  await assert.rejects(editor.run("editor.save"), /changed on disk/);
  assert.equal(await readFile(file, "utf8"), "external\r\n");
  assert.match(editor.reports.error.at(-1), /changed on disk/);
  await editor.run("editor.reload");
  assert.equal(editor.run("editor.read"), "external\r\n");
  assert.equal(editor.status("editor.document").version, version("external\r\n"));
  assert.equal(editor.reports.modified.at(-1), false);
  assert.equal(editor.reports.error.at(-1), null);
  assert.equal(editor.reports.error.filter((error) => error !== null).length, 1, "only the deliberate save conflict may report an error");
  assert.ok(port.inspect().nativeChanges > 0);
  notifications.release();
  await editor.dispose();
  await port.close();
});

test("filesystem held read cannot replace a later persisted save", async (t) => {
  const { editor, port, file } = await project(t);
  const older = port.holdReply("read");
  const nativeChange = port.nextNativeChange(filePath);
  // A real write of the same bytes triggers the OS watcher, whose read snapshot is then held unchanged.
  await writeFile(file, "initial\r\n", { flag: "r+" });
  await nativeChange;
  assert.equal((await older.received).version, version("initial\r\n"));
  editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "persisted-" }] });
  const submitted = editor.run("editor.read");
  await editor.run("editor.save");
  assert.equal(await readFile(file, "utf8"), submitted);
  const observed = [];
  const stop = editor.watchStatus("editor.document", (state) => observed.push(state.version));
  t.after(stop);
  // The editor drops the held read, which a newer file operation superseded, and records that drop.
  const dropped = editor.nextLog("watch.superseded");
  older.release();
  await dropped;
  assert.ok(observed.every((value) => value === version(submitted)), "a stale filesystem read must not replace the persisted save");
  assert.equal(editor.run("editor.read"), submitted);
  assert.equal(editor.status("editor.document").version, version(submitted));
  assert.equal(editor.reports.modified.at(-1), false);
  assert.deepEqual(editor.reports.error.filter((error) => error !== null), []);
  await editor.dispose();
  await port.close();
});

test("filesystem held read cannot replace a later explicit reload", async (t) => {
  const { editor, port, file } = await project(t);
  const older = port.holdReply("read");
  await writeFile(file, "initial\r\n", { flag: "r+" });
  assert.equal((await older.received).version, version("initial\r\n"));
  const notifications = port.holdChanges();
  await writeFile(file, "reloaded\r\n");
  await notifications.received;
  await editor.run("editor.reload");
  const observed = [];
  const stop = editor.watchStatus("editor.document", (state) => observed.push(state.version));
  t.after(stop);
  // The editor drops the held read, which a newer file operation superseded, and records that drop.
  const dropped = editor.nextLog("watch.superseded");
  older.release();
  await dropped;
  assert.ok(observed.every((value) => value === version("reloaded\r\n")), "a stale filesystem read must not replace the explicit reload");
  assert.equal(editor.run("editor.read"), "reloaded\r\n");
  assert.equal(editor.reports.modified.at(-1), false);
  assert.deepEqual(editor.reports.error.filter((error) => error !== null), []);
  notifications.release();
  await editor.dispose();
  await port.close();
});

test("filesystem disposal rejects the pending save before the host releases the process and watchers", async (t) => {
  const { editor, port } = await project(t);
  editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "pending-" }] });
  const pause = await port.pauseWrite();
  const rejected = assert.rejects(editor.run("editor.save"), /editor closed/);
  await pause.entered;
  const reports = structuredClone(editor.reports);
  await editor.dispose();
  await rejected;
  assert.equal(port.inspect().listeners, 0);
  await pause.release();
  await port.close();
  assert.deepEqual(editor.reports, reports, "a closed tab must not receive the late real write or watch result");
  assert.deepEqual(port.inspect().exit, { code: 0, signal: null });
});
