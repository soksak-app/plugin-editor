import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { openView } from "@soksak/plugin-api/testing";
import { installedOf, openEditor } from "./editor-view.mjs";
import { filesSidecar, sha, SIDECAR, SURFACE } from "./files-sidecar.mjs";

const { markdownView, projectImagePath, safeImageSource } = await import("../build/test/ui/markdown.js");
const { EditorView } = await import("../build/test/shared/@codemirror/view.js");
const { StateEffect } = await import("../build/test/shared/@codemirror/state.js");
const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const eventCatalog = JSON.parse(readFileSync(new URL("../events.json", import.meta.url), "utf8"));
const validateContentFrame = new Ajv2020({ allErrors: true }).compile(eventCatalog.events["plugin.editor.view.content_frame"].fields);
const declared = (kind, name) => manifest.exposes[kind].some((entry) => entry.name === name);
// The editor records the decision of a watch read when it has handled the read of a change on disk, and records a watch read
// that a newer file operation superseded when it drops that read: each record ends the handling of its read. The record is awaited
// from the point that the call marks, so it is the record of the handling that follows the call.
const decision = (editor) => editor.nextLog("disk.decision");
const superseded = (editor) => editor.nextLog("watch.superseded");
const decided = (editor) => editor.until(() => editor.logs.some((entry) => entry.event === "disk.decision"));
/** The events of the log with the name `event`. */
const eventsOf = (logs, event) => logs.filter((entry) => entry.event === event);
const isMicros = (value) => Number.isInteger(value) && value >= 0;
/**
 * Resolves when condition() holds after an update of view. An update listener of the view checks it at each update, so the
 * wait resolves in the update that completes it.
 */
function viewUpdate(view, condition) {
  if (condition()) return Promise.resolve();
  const done = Promise.withResolvers();
  let found = false;
  view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of(() => {
    if (found || !condition()) return;
    found = true;
    done.resolve();
  })) });
  return done.promise;
}

test("a diagnostic hidden-memory start skips the visible editor and creates one hidden view", async (t) => {
  const documentText = "const first = 1;\nconst second = 2;\n";
  assert.deepEqual(manifest.surface.params.properties.diagnosticMode.enum, ["hidden-memory"]);
  assert.equal(manifest.surface.params.properties.document.type, "string");
  const editor = await openEditor(t, { params: { diagnosticMode: "hidden-memory", document: documentText }, diagnostic: true });
  assert.equal(editor.root.querySelector("#view .cm-editor"), null, "hidden-memory mode does not construct the visible EditorView");
  assert.equal(editor.root.querySelector("#frame"), null, "hidden-memory mode does not build the ordinary editor UI");
  assert.equal(editor.root.querySelectorAll(".cm-editor").length, 1, "hidden-memory mode constructs exactly one CodeMirror view");
  assert.ok(editor.root.querySelector("[data-editor-diagnostic-hidden] .cm-editor"),
    "the sole CodeMirror view belongs to the hidden diagnostic container");
  const status = await editor.run("editor.memory.hidden", { action: "read" });
  assert.deepEqual(status, {
    mounted: true,
    documentLength: documentText.length,
    lines: 3,
    historyEntries: 1,
    regionHistoryEntries: 0,
  });
  const view = EditorView.findFromDOM(editor.root.querySelector(".cm-editor"));
  assert.equal(view.state.doc.toString(), documentText);
  assert.deepEqual(await editor.run("editor.memory.hidden", { action: "remove" }), {
    mounted: false,
    documentLength: 0,
    lines: 0,
    historyEntries: 1,
    regionHistoryEntries: 0,
  });
  assert.equal(editor.root.querySelector(".cm-editor"), null, "the diagnostic command removes the initial hidden view");
});

test("a hidden-memory start is refused without the diagnostic declaration", async (t) => {
  const editor = await openEditor(t, { params: { diagnosticMode: "hidden-memory", document: "const x = 1;" } });
  await editor.until(() => editor.logs.some((entry) => entry.event === "page.error"));
  const [failure] = editor.logs.filter((entry) => entry.event === "page.error");
  assert.equal(failure.fields.where, "mount");
  assert.match(failure.fields.error, /requires the editor diagnostic declaration/);
  assert.equal(editor.root.querySelectorAll(".cm-editor").length, 0, "refusal occurs before EditorView construction");
  const sidecarCalls = editor.view.calls.filter(({ command }) => command === "runtime.sidecar.on" || command === "runtime.sidecar.send");
  assert.deepEqual(sidecarCalls, [], "hidden-memory start must not connect the files sidecar");
});

test("a hidden-memory start removes its view when diagnostic attachment fails", async (t) => {
  // The start declares the diagnostic commands, but the exposure does not: the attachment cannot declare its command and refuses.
  const editor = await openEditor(t, { diagnostic: true, exposeDiagnostic: false,
    params: { diagnosticMode: "hidden-memory", document: "const x = 1;" } });
  await editor.until(() => editor.logs.some((entry) => entry.event === "page.error"));
  const [failure] = editor.logs.filter((entry) => entry.event === "page.error");
  assert.equal(failure.fields.where, "mount");
  assert.match(failure.fields.error, /editor\.memory\.hidden/);
  assert.equal(editor.root.querySelectorAll("[data-editor-diagnostic-hidden]").length, 0, "the hidden host is removed");
  assert.equal(editor.root.querySelectorAll(".cm-editor").length, 0, "the hidden view is destroyed");
  assert.deepEqual(editor.reports.error.filter((text) => text !== null), [], "the page reports the failure as a record, not as a tab error");
});

test("content frame diagnostics observe the view root and restore its card style", async (t) => {
  // The view opens without the page, so the frame measurement is the real attach of the editor diagnostics over the context of the
  // view. The window of the view provides the ResizeObserver that the SDK observer uses; the test delivers each resize to it.
  const diagnosticDeclaration = JSON.parse(readFileSync(new URL("../diagnostics.json", import.meta.url), "utf8"));
  const start = { surface: SURFACE, params: null, origin: { directory: null }, project: null, diagnostics: diagnosticDeclaration };
  const declarations = { status: manifest.exposes.status,
    commands: [...manifest.exposes.commands, ...diagnosticDeclaration.exposes.commands], element: manifest.exposes.element };
  const view = await openView("editor", { start, declarations, host: {
    surface: SURFACE, declarations, statuses: {}, contributions: installedOf([]), sidecars: [SIDECAR], project: null,
    state: { read: () => null, write() {} }, sidecar: {}, commands: {}, native: {}, faults: {},
  } });
  t.after(() => view.close());
  const { window } = view;
  const documentRoot = window.document.documentElement;
  // jsdom has no layout: the root of the view has the size of the view.
  documentRoot.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, right: 640, top: 0, bottom: 480, width: 640, height: 480 });
  const style = documentRoot.style;
  style.setProperty("--card", "rgb(9, 8, 7)", "important");
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const { createViewContext } = await import("../build/test/ui/view-context.js");
  const { attach } = await import("../build/test/ui/editor-diagnostics.js");
  const bridge = createViewBridge({ handler: window.webkit.messageHandlers["sok-view"], report: () => {} });
  const { context } = createViewContext({ bridge, start: window.sokSurface, report: () => {} });
  const dispose = await attach({ expose: context.exposure, root: window.document.body, document: window.document,
    runtime: context.runtime, readHistoryEntries: () => window.history.length });
  const trace = (action) => view.request("editor.diagnostics.content-trace", { action });
  const before = await trace("read");
  assert.deepEqual(before, { enabled: false, sequence: 0, width: 640, height: 480, historyEntries: window.history.length,
    regionHistoryEntries: 0 });
  const start1 = await trace("start");
  assert.deepEqual(start1.markerColor, [17, 193, 231], "the start result declares the exact paint marker RGB");
  assert.ok(start1.sourceClock && typeof start1.sourceClock === "object", "the start result includes a source clock anchor");
  const { sourceClock, markerColor, ...startState } = start1;
  assert.deepEqual(startState, { ...before, enabled: true });
  assert.deepEqual(Object.keys(sourceClock).sort(), ["documentTimeOriginMs", "sourceNowMs", "sourceResolutionMs"]);
  assert.equal(sourceClock.documentTimeOriginMs, window.performance.timeOrigin);
  assert.ok(Number.isFinite(sourceClock.sourceNowMs) && sourceClock.sourceNowMs >= 0);
  assert.ok(sourceClock.sourceNowMs <= window.performance.now());
  assert.equal(sourceClock.sourceResolutionMs, 1);
  assert.equal(style.getPropertyValue("--card"), "rgb(17, 193, 231)");
  assert.equal(style.getPropertyPriority("--card"), "");
  await assert.rejects(trace("start"), /already enabled/);
  const [observer] = view.observers;
  assert.equal(view.observers.length, 1, "the measurement observes the view with the ResizeObserver of its window");
  // The observer starts observing at the animation frame after the start, so the test awaits that frame.
  await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  assert.ok(observer.targets.includes(documentRoot), "the observer observes the view document root");
  // The record of the frame is written after the animation frame of the resize, so the test waits for the record.
  const frames = Promise.withResolvers();
  const frameRecords = () => view.events.filter((entry) => entry.event === "plugin.editor.view.content_frame");
  Object.defineProperty(view.events, "push", { value: (...items) => {
    const length = Array.prototype.push.apply(view.events, items);
    if (frameRecords().length > 0) frames.resolve();
    return length;
  } });
  observer.notify([{ target: documentRoot }]);
  await frames.promise;
  const [frame] = frameRecords();
  assert.equal(frame.level, "trace");
  // Exact values, as the probe gave them: the dimensions, the time origin, the sequence and the resize count of one resize.
  assert.equal(frame.fields.width, 640);
  assert.equal(frame.fields.height, 480);
  assert.equal(frame.fields.documentTimeOriginMs, window.performance.timeOrigin);
  assert.equal(frame.fields.sequence, 0);
  assert.equal(frame.fields.resizeCount, 1);
  // Value relations instead of the probe's exact clock values (firstResizeAtMs 0, resizeAtMs 0, frameTimeMs 1): the real observer
  // reads the window clock at the resize and at the animation frame, so the exact values are not known before the resize. For one
  // resize the first and the last resize time are the same, and the frame time follows the resize time.
  assert.equal(frame.fields.firstResizeAtMs, frame.fields.resizeAtMs);
  assert.ok(frame.fields.frameTimeMs >= frame.fields.resizeAtMs);
  assert.equal(validateContentFrame(frame.fields), true,
    `the context-scoped frame payload does not match events.json: ${JSON.stringify(validateContentFrame.errors)}`);
  assert.equal(validateContentFrame({ ...frame.fields, unexpected: true }), false,
    "the published frame schema accepted an unexpected field");
  assert.equal((await trace("read")).sequence, 1);
  const stopped = await trace("stop");
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.width, before.width);
  assert.equal(stopped.height, before.height);
  assert.equal(style.getPropertyValue("--card"), "rgb(9, 8, 7)");
  assert.equal(style.getPropertyPriority("--card"), "important");
  // The probe's option checks (document, ResizeObserver, requestAnimationFrame, now, timeOriginMs) are not observable on the real observer;
  // the observer's targets (above) and its disconnect (below) are the observable contract of the measurement.
  assert.equal(observer.disconnected, true, "the stop disconnects the observer");
  style.removeProperty("--card");
  await trace("start");
  const [, restarted] = view.observers;
  await dispose();
  assert.equal(Array.from({ length: style.length }, (_, index) => style.item(index)).includes("--card"), false);
  assert.equal(restarted.disconnected, true, "the disposal disconnects the observer of the restarted measurement");
});

test("each content frame record carries the surface of the view, as the event catalog requires", async (t) => {
  const view = await openView("editor", { start: { surface: SURFACE, params: null, origin: { directory: null }, project: null },
    declarations: { status: manifest.exposes.status, commands: manifest.exposes.commands, element: manifest.exposes.element }, host: {
      surface: SURFACE, declarations: { status: manifest.exposes.status, commands: manifest.exposes.commands, element: manifest.exposes.element },
      statuses: {}, contributions: installedOf([]), sidecars: [SIDECAR], project: null,
      state: { read: () => null, write() {} }, sidecar: {}, commands: {}, native: {}, faults: {},
    } });
  t.after(() => view.close());
  const { window } = view;
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const { createViewContext } = await import("../build/test/ui/view-context.js");
  const { createViewFrameMeasurement } = await import("../build/test/ui/editor-diagnostics.js");
  const bridge = createViewBridge({ handler: window.webkit.messageHandlers["sok-view"], report: () => {} });
  const { context } = createViewContext({ bridge, start: window.sokSurface, report: () => {} });
  const observed = [];
  const measurement = createViewFrameMeasurement({ document: window.document, runtime: context.runtime,
    readHistoryEntries: () => window.history.length, observeFrames: (options) => { observed.push(options); return () => {}; } });
  measurement.start();
  const recorded = Promise.withResolvers();
  Object.defineProperty(view.events, "push", { value: (...items) => {
    const length = Array.prototype.push.apply(view.events, items);
    if (view.events.some((entry) => entry.event === "plugin.editor.view.content_frame")) recorded.resolve();
    return length;
  } });
  observed[0].log.trace("view.content_frame", {
    sequence: 0, width: 640, height: 480, documentTimeOriginMs: window.performance.timeOrigin,
    firstResizeAtMs: 10, resizeAtMs: 10, resizeCount: 1, frameTimeMs: 13,
  });
  await recorded.promise;
  const [record] = view.events.filter((entry) => entry.event === "plugin.editor.view.content_frame");
  assert.equal(record.fields.surface, SURFACE);
  measurement.stop();
});

test("the content frame trace refuses invalid fields and forwards each valid frame", async (t) => {
  // The shared observer reports through the trace of the measurement; the test takes that trace from the observer seam of the
  // measurement and calls it with each field set, as the observer does with the values of a resize. The real observer cannot
  // produce the invalid combinations, so these checks use the seam. The valid frame is the first frame of this measurement, so its
  // sequence is 0 and the read after it reports 1; the probe run reported 1 and 2 after one real frame.
  const view = await openView("editor", { start: { surface: SURFACE, params: null, origin: { directory: null }, project: null },
    declarations: { status: manifest.exposes.status, commands: manifest.exposes.commands, element: manifest.exposes.element }, host: {
      surface: SURFACE, declarations: { status: manifest.exposes.status, commands: manifest.exposes.commands, element: manifest.exposes.element },
      statuses: {}, contributions: installedOf([]), sidecars: [SIDECAR], project: null,
      state: { read: () => null, write() {} }, sidecar: {}, commands: {}, native: {}, faults: {},
    } });
  t.after(() => view.close());
  const { window } = view;
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const { createViewContext } = await import("../build/test/ui/view-context.js");
  const { createViewFrameMeasurement } = await import("../build/test/ui/editor-diagnostics.js");
  const bridge = createViewBridge({ handler: window.webkit.messageHandlers["sok-view"], report: () => {} });
  const { context } = createViewContext({ bridge, start: window.sokSurface, report: () => {} });
  const observed = [];
  const measurement = createViewFrameMeasurement({ document: window.document, runtime: context.runtime,
    readHistoryEntries: () => window.history.length, observeFrames: (options) => { observed.push(options); return () => {}; } });
  measurement.start();
  const { log } = observed[0];
  const validSource = {
    sequence: 0, width: 640, height: 480, documentTimeOriginMs: window.performance.timeOrigin,
    firstResizeAtMs: 10, resizeAtMs: 12, resizeCount: 2, frameTimeMs: 13,
  };
  const invalidSource = [
    { ...validSource, resizeAtMs: 9 },
    { ...validSource, frameTimeMs: 11 },
    { ...validSource, resizeCount: 0 },
    { ...validSource, resizeCount: 1.5 },
    { ...validSource, resizeCount: 1 },
    { ...validSource, unexpected: true },
    Object.fromEntries(Object.entries(validSource).filter(([name]) => name !== "firstResizeAtMs")),
  ];
  for (const fields of invalidSource) assert.throws(() => log.trace("view.content_frame", fields));
  const recorded = Promise.withResolvers();
  Object.defineProperty(view.events, "push", { value: (...items) => {
    const length = Array.prototype.push.apply(view.events, items);
    if (view.events.some((entry) => entry.event === "plugin.editor.view.content_frame")) recorded.resolve();
    return length;
  } });
  log.trace("view.content_frame", validSource);
  await recorded.promise;
  const [record] = view.events.filter((entry) => entry.event === "plugin.editor.view.content_frame");
  assert.deepEqual(record.fields, { ...validSource, surface: SURFACE }, "the editor forwards every source coalescing field and the surface of the view");
  assert.equal(measurement.read().sequence, 1);
  measurement.stop();
});

for (const event of ["error", "changed"]) test(`a sidecar ${event} while the editor loads is handled before the editor is ready`, async (t) => {
  const files = new Map([["src/main.js", "initial\n"]]);
  const editor = await openEditor(t, { files, hold: "read" });
  await editor.held.received;
  if (event === "changed") files.set("src/main.js", "latest\n");
  await editor.sidecar.report(event === "error" ? { error: "watch unavailable" } : { changed: "src/main.js" });
  editor.held.release();
  await editor.mounted;
  // The error is shown before the editor is ready; the change is read after it, and its decision ends its handling.
  if (event === "changed") await decided(editor);
  if (event === "error") assert.match(editor.reports.error.at(-1), /watch unavailable/);
  else assert.equal(await editor.run("editor.read"), "latest\n");
});

test("a watch during the initial read refreshes the opened document", async (t) => {
  const files = new Map([["src/main.js", "initial\n"]]);
  const editor = await openEditor(t, { files, hold: "read" });
  await editor.held.received;
  // The change reaches the editor before the held read reply: each reply reaches it in the order of its delivery.
  await editor.sidecar.change("src/main.js", "latest\n");
  editor.held.release();
  await editor.mounted;
  await decided(editor);
  assert.equal(await editor.run("editor.read"), "latest\n");
  assert.equal((await editor.status("editor.document")).version, sha("latest\n"));
});

test("the editor opens the file of its tab and watches it", async (t) => {
  const editor = await openEditor(t);
  assert.equal(await editor.run("editor.read"), "let a = 1;\n// TODO: b\n");
  const document = await editor.status("editor.document");
  assert.equal(document.path, "src/main.js");
  assert.equal(document.language, "javascript");
  assert.equal(document.newline, "lf");
  assert.equal(document.modified, false);
  assert.deepEqual(editor.sidecar.sent.map((body) => body.operation), ["read", "watch"]);
  assert.deepEqual(editor.sidecar.sent[1].paths, ["src/main.js"]);
});

test("an edit marks the tab modified and a save writes the text in place", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.edit", { changes: [{ from: 8, to: 9, insert: "2" }] });
  assert.equal((await editor.status("editor.document")).modified, true);
  assert.deepEqual(editor.reports.modified, [false, true]);
  const { version } = await editor.run("editor.save");
  assert.equal(editor.files.get("src/main.js"), "let a = 2;\n// TODO: b\n");
  assert.equal(version, sha("let a = 2;\n// TODO: b\n"));
  assert.equal((await editor.status("editor.document")).modified, false);
  assert.deepEqual(editor.reports.modified, [false, true, false]);
  assert.deepEqual(editor.reports.error, [null]);
});

for (const firstSave of [false, true]) test(`a delayed ${firstSave ? "first" : "existing file"} save keeps later edits reported as modified`, async (t) => {
  const path = "src/main.js";
  const editor = await openEditor(t, firstSave ? { params: {}, files: new Map(), commands: { "core.file.place": () => ({ path }) } } : {});
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "saved-" }] });
  const written = await editor.run("editor.read");
  const reply = editor.sidecar.holdReply("write");
  const saving = editor.run("editor.save");
  await reply.received;
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "unsaved-" }] });
  reply.release();
  assert.deepEqual(await saving, { version: sha(written) });
  assert.equal(editor.files.get(path), written);
  assert.equal(await editor.run("editor.read"), `unsaved-${written}`);
  assert.equal((await editor.status("editor.document")).modified, true, "the newer document has not been written");
  assert.equal(editor.reports.modified.at(-1), true, "the close boundary must still receive the unsaved state");
  assert.equal((await editor.status("editor.document")).version, sha(written));
  await editor.run("editor.save");
  assert.equal(editor.files.get(path), `unsaved-${written}`);
  assert.equal((await editor.status("editor.document")).modified, false);
  assert.equal(editor.reports.modified.at(-1), false);
});

test("an older watch reply cannot replace the document written by a completed save", async (t) => {
  const editor = await openEditor(t);
  const oldRead = editor.sidecar.holdReply("read");
  editor.sidecar.change("src/main.js", "old disk text\n");
  await oldRead.received;
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "local-" }] });
  // Restore the expected base before the save; the held read still carries the older observation.
  editor.files.set("src/main.js", "let a = 1;\n// TODO: b\n");
  const written = await editor.run("editor.read");
  await editor.run("editor.save");
  const older = superseded(editor);
  oldRead.release();
  await older;
  assert.equal(await editor.run("editor.read"), written);
  assert.equal((await editor.status("editor.document")).version, sha(written));
  assert.equal((await editor.status("editor.document")).disk, "same");
  assert.equal((await editor.status("editor.document")).modified, false);
});

test("an older watch reply cannot replace a newer disk change", async (t) => {
  const editor = await openEditor(t);
  const oldRead = editor.sidecar.holdReply("read");
  editor.sidecar.change("src/main.js", "older\n");
  await oldRead.received;
  const newer = decision(editor);
  editor.sidecar.change("src/main.js", "newer\n");
  await newer;
  const older = superseded(editor);
  oldRead.release();
  await older;
  assert.equal(await editor.run("editor.read"), "newer\n");
  assert.equal((await editor.status("editor.document")).version, sha("newer\n"));
  assert.equal((await editor.status("editor.document")).disk, "same");
});

test("an older watch reply cannot replace an explicitly reloaded document", async (t) => {
  const editor = await openEditor(t);
  const oldRead = editor.sidecar.holdReply("read");
  editor.sidecar.change("src/main.js", "older\n");
  await oldRead.received;
  editor.files.set("src/main.js", "reloaded\n");
  await editor.run("editor.reload");
  const older = superseded(editor);
  oldRead.release();
  await older;
  assert.equal(await editor.run("editor.read"), "reloaded\n");
  assert.equal((await editor.status("editor.document")).version, sha("reloaded\n"));
  assert.equal((await editor.status("editor.document")).modified, false);
});

for (const later of ["save", "reload"]) test(`an older reload is refused after a newer ${later} completes`, async (t) => {
  const editor = await openEditor(t);
  const oldRead = editor.sidecar.holdReply("read");
  const reloading = editor.run("editor.reload");
  const rejected = assert.rejects(reloading, /superseded the reload/);
  await oldRead.received;
  if (later === "save") {
    await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "saved-" }] });
    await editor.run("editor.save");
  } else {
    editor.files.set("src/main.js", "reloaded\n");
    await editor.run("editor.reload");
  }
  const current = await editor.run("editor.read");
  const errors = [...editor.reports.error];
  oldRead.release();
  await rejected;
  assert.equal(await editor.run("editor.read"), current);
  assert.equal((await editor.status("editor.document")).version, sha(current));
  assert.equal((await editor.status("editor.document")).modified, false);
  assert.deepEqual(editor.reports.error, errors, "the superseded operation must not replace the newer error display");
});

test("a delayed save reply preserves the newer watched disk version for overwrite", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "local-" }] });
  const written = await editor.run("editor.read");
  const saveReply = editor.sidecar.holdReply("write");
  const saving = editor.run("editor.save");
  await saveReply.received;
  const watchReply = editor.sidecar.holdReply("read");
  editor.sidecar.change("src/main.js", "external\n");
  await watchReply.received;
  const conflict = decision(editor);
  watchReply.release();
  await conflict;
  assert.equal((await editor.status("editor.document")).disk, "changed");
  saveReply.release();
  await saving;
  assert.equal(await editor.run("editor.read"), written);
  assert.equal((await editor.status("editor.document")).version, sha(written));
  assert.equal((await editor.status("editor.document")).disk, "changed", "the save reply predates the external write");
  await editor.run("editor.save", { overwrite: true });
  assert.equal(editor.files.get("src/main.js"), written);
  assert.equal(editor.sidecar.sent.filter((body) => body.operation === "write").at(-1).expect, sha("external\n"));
  assert.equal((await editor.status("editor.document")).disk, "same");
});

test("a watch restoring the saved disk version clears the conflict but keeps local edits", async (t) => {
  const editor = await openEditor(t);
  const original = await editor.run("editor.read");
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "local-" }] });
  for (const text of ["external\n", original]) {
    const reply = editor.sidecar.holdReply("read");
    editor.sidecar.change("src/main.js", text);
    await reply.received;
    const handled = decision(editor);
    reply.release();
    await handled;
    assert.equal((await editor.status("editor.document")).disk, text === original ? "same" : "changed");
  }
  assert.equal(await editor.run("editor.read"), `local-${original}`);
  assert.equal((await editor.status("editor.document")).modified, true);
  assert.equal(editor.root.querySelector("#banner").hidden, true);
});

test("a delayed save reply cannot replace a newer document loaded by watch", async (t) => {
  const editor = await openEditor(t);
  const saveReply = editor.sidecar.holdReply("write");
  const saving = editor.run("editor.save");
  await saveReply.received;
  const loaded = decision(editor);
  editor.sidecar.change("src/main.js", "newer\n");
  await loaded;
  assert.equal(await editor.run("editor.read"), "newer\n");
  saveReply.release();
  await saving;
  assert.equal((await editor.status("editor.document")).version, sha("newer\n"));
  assert.equal((await editor.status("editor.document")).modified, false);
});

for (const first of ["save", "watch"]) test(`a refused save preserves the pending watch conflict when ${first} replies first`, async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "local-" }] });
  const readReply = editor.sidecar.holdReply("read");
  editor.sidecar.change("src/main.js", "external\n");
  await readReply.received;
  const saveReply = editor.sidecar.holdReply("write");
  const rejected = assert.rejects(editor.run("editor.save"), /changed on disk/);
  await saveReply.received;
  // A watch read that replies while the save is pending is superseded by the save and ends with its superseded record. When the
  // save replies first, its refusal reads the file again, and the conflict decision of that read ends the handling.
  if (first === "watch") {
    const read = superseded(editor);
    readReply.release();
    await read;
  }
  const conflict = decision(editor);
  saveReply.release();
  await rejected;
  if (first === "save") readReply.release();
  await conflict;
  assert.equal((await editor.status("editor.document")).disk, "changed");
  assert.equal((await editor.status("editor.document")).modified, true);
  assert.match(editor.reports.error.at(-1), /changed on disk/);
  await editor.run("editor.save", { overwrite: true });
  assert.equal(editor.sidecar.sent.filter((body) => body.operation === "write").at(-1).expect, sha("external\n"));
});

test("an older save reply cannot replace a newer completed save", async (t) => {
  const editor = await openEditor(t);
  const firstReply = editor.sidecar.holdReply("write");
  const firstSave = editor.run("editor.save");
  await firstReply.received;
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "newer-" }] });
  const written = await editor.run("editor.read");
  await editor.run("editor.save");
  firstReply.release();
  await firstSave;
  assert.equal(editor.files.get("src/main.js"), written);
  assert.equal((await editor.status("editor.document")).version, sha(written));
  assert.equal((await editor.status("editor.document")).modified, false);
});

test("an older first-save reply cannot mark edits clean after a newer save", async (t) => {
  const editor = await openEditor(t, { params: {}, files: new Map(), commands: { "core.file.place": () => ({ path: "new.txt" }) } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "A" }] });
  const firstReply = editor.sidecar.holdReply("write");
  const firstSave = editor.run("editor.save");
  await firstReply.received;
  await editor.run("editor.edit", { changes: [{ from: 0, to: 1, insert: "B" }] });
  await editor.run("editor.save");
  await editor.run("editor.edit", { changes: [{ from: 0, to: 1, insert: "A" }] });
  firstReply.release();
  await firstSave;
  assert.equal(editor.files.get("new.txt"), "B");
  assert.equal(await editor.run("editor.read"), "A");
  assert.equal((await editor.status("editor.document")).modified, true, "A is not the content written by the newer save");
  assert.equal((await editor.status("editor.document")).version, sha("B"));
  assert.equal(editor.reports.modified.at(-1), true);
});

for (const heldOperation of ["write", "readBytes"]) test(`a superseded first save cannot overwrite a newer save after its ${heldOperation} reply`, async (t) => {
  const editor = await openEditor(t, {
    params: {}, files: new Map([["new.txt", "B"]]), commands: { "core.file.place": () => ({ path: "new.txt" }) },
  });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "A" }] });
  const firstReply = editor.sidecar.holdReply(heldOperation);
  const firstSave = editor.run("editor.save").then((value) => ({ value }), (error) => ({ error }));
  await firstReply.received;
  await editor.run("editor.edit", { changes: [{ from: 0, to: 1, insert: "B" }] });
  await editor.run("editor.save");
  const sends = editor.sidecar.sent.length;
  firstReply.release();
  const result = await firstSave;
  assert.equal(editor.files.get("new.txt"), "B", "the superseded save must not overwrite the later stored content");
  assert.match(result.error?.message ?? "", /superseded the first save/);
  assert.equal(editor.sidecar.sent.length, sends, "neither a read nor a write may start for the superseded save");
  assert.equal((await editor.status("editor.document")).version, sha("B"));
  assert.equal((await editor.status("editor.document")).modified, false);
});

test("an older save failure cannot replace the error display of a newer successful save", async (t) => {
  const editor = await openEditor(t);
  const original = await editor.run("editor.read");
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "local-" }] });
  editor.files.set("src/main.js", "external\n");
  const firstReply = editor.sidecar.holdReply("write");
  const rejected = assert.rejects(editor.run("editor.save"), /changed on disk/);
  await firstReply.received;
  editor.files.set("src/main.js", original);
  await editor.run("editor.save");
  const errors = [...editor.reports.error];
  firstReply.release();
  await rejected;
  assert.deepEqual(editor.reports.error, errors);
});

for (const refused of [false, true]) test(`an older save-place ${refused ? "failure" : "reply"} cannot affect a newer completed save`, async (t) => {
  const chosen = Promise.withResolvers();
  const requested = Promise.withResolvers();
  let calls = 0;
  const editor = await openEditor(t, { params: {}, files: new Map(), commands: { "core.file.place": () => {
    if (calls++ > 0) return { path: "current.txt" };
    requested.resolve();
    return chosen.promise;
  } } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "current" }] });
  const rejected = assert.rejects(editor.run("editor.save"), refused ? /place failed/ : /superseded the first save/);
  await requested.promise;
  await editor.run("editor.save");
  const before = structuredClone(editor.reports);
  const sends = editor.sidecar.sent.length;
  if (refused) chosen.reject(new Error("place failed"));
  else chosen.resolve({ path: "obsolete.txt" });
  // The refusal of the superseded save ends its handling.
  await rejected;
  assert.equal(editor.sidecar.sent.length, sends, "the superseded place must not start a write");
  assert.deepEqual(editor.reports, before);
  assert.equal((await editor.status("editor.document")).path, "current.txt");
});

test("an older first-save reply cannot change the newly named file", async (t) => {
  // The first save names its file only when its place reply arrives, and the contribution load of that name follows it. The held
  // reply is the first place reply; the second save names newer.txt first, so the older name must not reach the document.
  const extension = new URL("./fixtures/upper-gutter.mjs", import.meta.url).href;
  const older = Promise.withResolvers();
  let placeCalls = 0;
  const editor = await openEditor(t, { params: {}, files: new Map(), contributions: [
    { id: "probe", package: "@soksak/plugin-probe", version: "1.0.0", manifest: { id: "probe", contributes: {
      "editor.extension": [{ range: "^1.0.0", module: "ui/x.js", extensions: ["js"] }],
    } }, modules: { "ui/x.js": extension } },
  ], commands: { "core.file.place": () => ++placeCalls === 1 ? older.promise : { path: "newer.txt" } } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "text" }] });
  const firstSave = editor.run("editor.save").then(() => "saved", (error) => error.message);
  await editor.run("editor.save");
  // The held reply keeps a call pending, so the exposed status is read only after its release.
  assert.equal(editor.reports.title.at(-1), "newer.txt");
  const before = structuredClone(editor.reports);
  const sends = editor.sidecar.sent.length;
  older.resolve({ path: "older.js" });
  assert.equal(await firstSave, "a newer save superseded the first save");
  assert.equal(editor.root.querySelector(".probe-mark"), null, "the older file's extension must not enter the newer document");
  assert.equal((await editor.status("editor.document")).path, "newer.txt");
  assert.deepEqual(editor.reports, before);
  assert.equal(editor.sidecar.sent.length, sends, "the older naming must not start another watch");
});

for (const operation of ["save", "watch", "reload"]) test(`disposing with a pending ${operation} prevents late tab updates`, async (t) => {
  const editor = await openEditor(t);
  const reply = editor.sidecar.holdReply(operation === "save" ? "write" : "read");
  let rejected;
  if (operation === "save") {
    await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "local-" }] });
    rejected = assert.rejects(editor.run("editor.save"), /editor closed/);
  } else if (operation === "reload") rejected = assert.rejects(editor.run("editor.reload"), /editor closed/);
  else editor.sidecar.change("src/main.js", "external\n");
  await reply.received;
  const before = structuredClone(editor.reports);
  await editor.close();
  await rejected;
  // The disposed editor has no sidecar subscription left, so the host refuses the released reply and the page receives nothing.
  await assert.rejects(reply.release(), /no subscription for it/);
  assert.deepEqual(editor.reports, before, "a disposed tab receives no modified, error, title or state report");
  assert.equal(editor.root.childNodes.length, 0);
  assert.equal(eventsOf(editor.logs, "close").at(-1).fields.pending, 1);
  assert.equal(eventsOf(editor.logs, "request").at(-1).fields.ok, false);
});

for (const refused of [false, true]) test(`disposing while the first save ${refused ? "refuses" : "chooses"} a path prevents a late update`, async (t) => {
  // The first save waits on its held core.file.place reply; the editor closes first, then the reply settles.
  const place = Promise.withResolvers();
  const editor = await openEditor(t, { params: {}, files: new Map(), commands: { "core.file.place": () => place.promise } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "unsaved" }] });
  const saving = assert.rejects(editor.run("editor.save"), /editor closed/);
  await editor.until(() => editor.view.calls.some((call) => call.command === "core.file.place"));
  const before = structuredClone(editor.reports);
  const sent = editor.sidecar.sent.length;
  await editor.close();
  // The pending save ends with the close, so the caller does not wait for a reply that the closed view cannot receive.
  await saving;
  const logged = editor.logs.length;
  if (refused) place.reject(new Error("place failed"));
  else place.resolve({ path: "new.txt" });
  await editor.settle();
  assert.equal(editor.sidecar.sent.length, sent, "the closed editor writes no file after its path reply");
  assert.deepEqual(editor.reports, before, "a closed tab receives no tab report after its path reply");
  assert.deepEqual(editor.logs.slice(logged), [], "a closed editor records nothing after its path reply");
});

test("a save after the file changed on disk fails, shows the tab error and keeps the changes", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "// head\n" }] });
  const conflict = decision(editor);
  editor.sidecar.change("src/main.js", "changed elsewhere\n");
  await conflict;
  assert.equal((await editor.status("editor.document")).disk, "changed");
  await assert.rejects(editor.run("editor.save"), /changed on disk: src\/main.js/);
  assert.equal(editor.reports.error.at(-1), "저장하지 못했습니다 · changed on disk: src/main.js");
  assert.equal((await editor.status("editor.document")).modified, true);
  await editor.run("editor.save", { overwrite: true });
  assert.equal(editor.reports.error.at(-1), null);
  assert.equal((await editor.status("editor.document")).disk, "same");
});

test("a change on disk replaces an unmodified text and is ignored when it is the editor's own write", async (t) => {
  const editor = await openEditor(t);
  const loaded = decision(editor);
  editor.sidecar.change("src/main.js", "new text\n");
  await loaded;
  assert.equal(await editor.run("editor.read"), "new text\n");
  await editor.run("editor.edit", { changes: [{ from: 0, to: 3, insert: "old" }] });
  await editor.run("editor.save");
  const same = decision(editor);
  editor.sidecar.change("src/main.js", "old text\n");
  await same;
  assert.equal((await editor.status("editor.document")).disk, "same");
});

test("a file with mixed line breaks opens editable and saves its text unchanged", async (t) => {
  const editor = await openEditor(t, { params: { path: "a.txt" }, files: new Map([["a.txt", "one\r\ntwo\nthree\rfour"]]) });
  assert.equal(await editor.run("editor.read"), "one\r\ntwo\nthree\rfour");
  await editor.run("editor.edit", { changes: [{ from: 3, to: 3, insert: "!" }] });
  await editor.run("editor.save");
  assert.equal(editor.files.get("a.txt"), "one!\r\ntwo\nthree\rfour");
  assert.deepEqual(editor.reports.error.filter((text) => text !== null), []);
});

test("a file with CRLF line breaks keeps them when it is saved", async (t) => {
  const editor = await openEditor(t, { params: { path: "a.txt" }, files: new Map([["a.txt", "one\r\ntwo\r\n"]]) });
  assert.equal(await editor.run("editor.read"), "one\r\ntwo\r\n");
  await editor.run("editor.edit", { changes: [{ from: 3, to: 3, insert: "!" }] });
  await editor.run("editor.save");
  assert.equal(editor.files.get("a.txt"), "one!\r\ntwo\r\n");
});

test("find selects matches, replaces them, and reports an invalid regular expression as state", async (t) => {
  const editor = await openEditor(t, { params: { path: "a.txt" }, files: new Map([["a.txt", "cat cat Cat\n"]]) });
  await editor.run("editor.find.open", { replace: true });
  assert.deepEqual(await editor.run("editor.find", { query: "cat" }), { matches: 3 });
  assert.deepEqual(await editor.run("editor.find", { caseSensitive: true }), { matches: 2 });
  assert.deepEqual(await editor.run("editor.find.next"), { current: 0 });
  assert.deepEqual(await editor.run("editor.find.next"), { current: 1 });
  assert.deepEqual(await editor.run("editor.find.next"), { current: 0 });
  await editor.run("editor.find", { replacement: "dog" });
  assert.deepEqual(await editor.run("editor.replace.all"), { replaced: 2 });
  assert.equal(await editor.run("editor.read"), "dog dog Cat\n");
  await editor.run("editor.find", { query: "(", regexp: true });
  assert.equal((await editor.status("editor.find")).matches, 0);
  assert.match((await editor.status("editor.find")).error, /Invalid regular expression/);
  await editor.run("editor.find", { query: "(C)at", replacement: "$1ow" });
  assert.deepEqual(await editor.run("editor.replace.all"), { replaced: 1 });
  assert.equal(await editor.run("editor.read"), "dog dog Cow\n");
});

test("every interactive element of the editor is bound to a declared command and has an element name", async (t) => {
  // The page bridge owns the message listener of the view channel, so the editor mounts through a view without the page: the SDK
  // bridge, the context module and the editor module are the real ones, and the audit is the audit of the context that bound them.
  const sidecar = filesSidecar(new Map([["src/main.js", "let a = 1;\n"]]));
  const declarations = { status: manifest.exposes.status, commands: manifest.exposes.commands, element: manifest.exposes.element };
  const start = { surface: SURFACE, params: { path: "src/main.js" }, origin: { directory: null }, project: { id: "project", root: "/project" } };
  const view = await openView("editor", { start, declarations, host: {
    surface: SURFACE, declarations, statuses: {}, settings: {}, textSize: 1, contributions: installedOf([]), sidecars: [SIDECAR],
    shortcuts: [], faults: {}, project: start.project, state: { read: () => null, write() {} }, commands: {},
    sidecar: { [SIDECAR]: (body) => sidecar.send(body) },
    native: { exposureReply: () => null, changed: () => null, registered: () => null },
  } });
  t.after(() => view.close());
  sidecar.attach(view);
  const { createViewBridge } = await import("@soksak/plugin-api/view");
  const { createViewContext } = await import("../build/test/ui/view-context.js");
  const { mount } = await import("../build/test/ui/editor.js");
  const bridge = createViewBridge({ handler: view.window.webkit.messageHandlers["sok-view"], report: () => {} });
  const { context } = createViewContext({ bridge, start: view.window.sokSurface, report: () => {} });
  const host = view.window.document.body.appendChild(view.window.document.createElement("div"));
  const root = host.attachShadow({ mode: "open" });
  await mount(root, context);
  assert.ok(root.querySelector("button, [role], input, [contenteditable]"), "the editor has interactive elements");
  assert.deepEqual(context.exposure.audit(root), []);
});

test("the shortcut Command-S saves and Command-F opens the find bar", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "x" }] });
  const content = editor.root.querySelector(".cm-content");
  const { KeyboardEvent } = editor.view.window;
  const key = (code, options = {}) => new KeyboardEvent("keydown", { code, metaKey: true, bubbles: true, cancelable: true, ...options });
  const save = key("KeyS");
  const saved = editor.nextLog("save");
  content.dispatchEvent(save);
  assert.equal(save.defaultPrevented, true);
  await saved;
  assert.equal(editor.files.get("src/main.js").startsWith("xlet"), true);
  content.dispatchEvent(key("KeyF", { altKey: true }));
  assert.equal((await editor.status("editor.find")).open, true);
  assert.equal((await editor.status("editor.find")).replace, true);
});

test("a contributed extension applies to its name extensions and a failing module is reported", async (t) => {
  const extension = new URL("./fixtures/upper-gutter.mjs", import.meta.url).href;
  const formatter = new URL("./fixtures/trim-formatter.mjs", import.meta.url).href;
  const editor = await openEditor(t, { contributions: [
    { id: "probe", package: "@soksak/plugin-probe", version: "1.0.0", manifest: { id: "probe", contributes: {
      "editor.extension": [{ range: "^1.0.0", module: "ui/x.js", extensions: ["js"] }],
      "editor.formatter": [{ range: "^1.0.0", module: "ui/z.js", extensions: ["js"] }],
    } }, modules: { "ui/x.js": extension, "ui/z.js": formatter } },
    { id: "broken", package: "@soksak/plugin-broken", version: "1.0.0", manifest: { id: "broken", contributes: {
      "editor.extension": [{ range: "^1.0.0", module: "ui/y.js" }],
    } }, modules: { "ui/y.js": formatter } },
  ] });
  assert.ok(editor.root.querySelector(".probe-mark"), "the contributed extension did not apply");
  assert.deepEqual(editor.view.observed.contributions.map(({ plugin, reason }) => [plugin, reason]),
    [["broken", "broken: the module does not export extension(file)"]]);
  assert.deepEqual(await editor.run("editor.format"), { changed: true });
  assert.equal(await editor.run("editor.read"), "let a = 1;\n// TODO: b");
  assert.deepEqual(editor.reports.error.at(-1), null);
});

test("TODO, FIXME and XXX are marked in every file", async (t) => {
  const editor = await openEditor(t, { params: { path: "notes" }, files: new Map([["notes", "TODO one FIXME two XXX TODOLIST\n"]]) });
  assert.deepEqual([...editor.root.querySelectorAll(".cm-todo")].map((element) => element.textContent), ["TODO", "FIXME", "XXX"]);
});

test("the tab is named after its file", async (t) => {
  const editor = await openEditor(t);
  assert.deepEqual(editor.reports.title, ["main.js"]);
});

test("the editor colors come from a CodeMirror theme of the theme tokens and follow the scheme", async (t) => {
  const light = await openEditor(t, { scheme: "light" });
  const view = EditorView.findFromDOM(light.root.querySelector(".cm-editor"));
  assert.equal(view.state.facet(EditorView.darkTheme), false);
  const css = [...light.root.querySelectorAll("style")].map((style) => style.textContent).join("\n");
  assert.match(css, /\.ͼ[0-9a-z]+ \.cm-gutters \{[^}]*background-color: var\(--card\)/);
  const dark = await openEditor(t, { scheme: "dark" });
  assert.equal(EditorView.findFromDOM(dark.root.querySelector(".cm-editor")).state.facet(EditorView.darkTheme), true);
});

test("every shared package is imported from a URL that ends in .js", () => {
  const vendor = new URL("../ui/vendor/", import.meta.url);
  const sources = ["codemirror-view.js", "codemirror-language.js", "libraries.js"].map((file) => readFileSync(new URL(file, vendor), "utf8"))
    .concat(readFileSync(new URL("../ui/editor.js", import.meta.url), "utf8"));
  const specifiers = sources.flatMap((source) => [...source.matchAll(/from "(@soksak\/shared\/[^"]+)"/g)].map((match) => match[1]));
  assert.ok(specifiers.length > 0);
  assert.deepEqual(specifiers.filter((specifier) => !specifier.endsWith(".js")), []);
});

test("the open records the file, its size and the watch with their results", async (t) => {
  const editor = await openEditor(t);
  const [open] = eventsOf(editor.logs, "open");
  assert.equal(open.level, "info");
  assert.deepEqual({ ...open.fields, micros: isMicros(open.fields.micros) }, { path: "src/main.js", bytes: 22, lines: 3, newline: "lf",
    micros: true, ok: true, surface: SURFACE });
  const [watch] = eventsOf(editor.logs, "watch.start");
  assert.deepEqual({ ...watch.fields, micros: isMicros(watch.fields.micros) }, { path: "src/main.js", micros: true, ok: true, surface: SURFACE });
  assert.deepEqual(eventsOf(editor.logs, "request").map((entry) => [entry.level, entry.fields.operation, entry.fields.ok]),
    [["debug", "read", true], ["debug", "watch", true]]);
});

test("an open of a missing file records the failure and still fails", async (t) => {
  const editor = await openEditor(t, { params: { path: "gone.js" }, files: new Map() });
  await editor.until(() => editor.logs.some((entry) => entry.event === "page.error"));
  const [open] = eventsOf(editor.logs, "open");
  assert.equal(open.level, "warn");
  assert.equal(open.fields.ok, false);
  assert.equal(open.fields.error, "-32603: no such file: gone.js");
  const [failure] = eventsOf(editor.logs, "page.error");
  assert.equal(failure.fields.where, "mount");
  assert.match(failure.fields.error, /no such file: gone.js/);
});

test("a save records its bytes, overwrite and result, and a refused save records the error", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.edit", { changes: [{ from: 8, to: 9, insert: "2" }] });
  await editor.run("editor.save");
  await editor.until(() => editor.logs.some((entry) => entry.event === "save" && entry.level === "info"));
  const [saved] = eventsOf(editor.logs, "save");
  assert.equal(saved.level, "info");
  assert.deepEqual({ ...saved.fields, micros: isMicros(saved.fields.micros) }, { path: "src/main.js", bytes: 22, overwrite: false, micros: true, ok: true, surface: SURFACE });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "x" }] });
  const conflict = decision(editor);
  editor.sidecar.change("src/main.js", "elsewhere\n");
  await conflict;
  await assert.rejects(editor.run("editor.save"), /changed on disk/);
  await editor.until(() => editor.logs.some((entry) => entry.event === "save" && entry.level === "warn"));
  const refused = eventsOf(editor.logs, "save").at(-1);
  assert.equal(refused.level, "warn");
  assert.equal(refused.fields.ok, false);
  assert.equal(refused.fields.error, "-32603: changed on disk: src/main.js");
});

test("a change on disk records the change, the read and the decision", async (t) => {
  const editor = await openEditor(t);
  const loaded = decision(editor);
  editor.sidecar.change("src/main.js", "new text\n");
  await loaded;
  assert.deepEqual(eventsOf(editor.logs, "watch.change").map((entry) => entry.fields), [{ path: "src/main.js", surface: SURFACE }]);
  const [read] = eventsOf(editor.logs, "read");
  assert.equal(read.fields.reason, "watch");
  assert.equal(read.fields.bytes, 9);
  assert.equal(read.fields.ok, true);
  assert.deepEqual(eventsOf(editor.logs, "disk.decision").map((entry) => entry.fields), [{ path: "src/main.js", decision: "loaded", modified: false, surface: SURFACE }]);
  const same = decision(editor);
  editor.sidecar.change("src/main.js", "new text\n");
  await same;
  assert.equal(eventsOf(editor.logs, "disk.decision").at(-1).fields.decision, "same");
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "mine " }] });
  const conflict = decision(editor);
  editor.sidecar.change("src/main.js", "other\n");
  await conflict;
  assert.deepEqual(eventsOf(editor.logs, "disk.decision").at(-1).fields, { path: "src/main.js", decision: "conflict", modified: true, surface: SURFACE });
});

test("a read of the reload command and a failed read are recorded", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.reload");
  await editor.until(() => editor.logs.some((entry) => entry.event === "read" && entry.fields.reason === "reload"));
  assert.equal(eventsOf(editor.logs, "read").at(-1).fields.reason, "reload");
  editor.files.delete("src/main.js");
  await assert.rejects(editor.run("editor.reload"), /no such file/);
  await editor.until(() => editor.logs.some((entry) => entry.event === "read" && entry.level === "warn"));
  const failed = eventsOf(editor.logs, "read").at(-1);
  assert.equal(failed.level, "warn");
  assert.equal(failed.fields.error, "-32603: no such file: src/main.js");
});

test("the stop of the watch is recorded as an error event", async (t) => {
  const editor = await openEditor(t);
  const stopped = editor.nextLog("watch.error");
  await editor.sidecar.report({ error: "the watch ended" });
  await stopped;
  assert.deepEqual(eventsOf(editor.logs, "watch.error"), [{ level: "error", event: "watch.error", fields: { path: "src/main.js", error: "the watch ended", surface: SURFACE } }]);
});

test("every command result is recorded with its time, and a refused command records its error", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.select", { anchor: 0 });
  // The host carries the failure to the caller as its message; the class of the thrown error is recorded by the page before that.
  await assert.rejects(editor.run("editor.read", { from: 5, to: 1 }), /editor\.read requires/);
  const [ok, failed] = eventsOf(editor.logs, "command");
  assert.equal(ok.level, "debug");
  assert.deepEqual({ ...ok.fields, micros: isMicros(ok.fields.micros) }, { name: "editor.select", micros: true, ok: true, surface: SURFACE });
  assert.equal(failed.level, "warn");
  assert.equal(failed.fields.name, "editor.read");
  assert.equal(failed.fields.ok, false);
  assert.match(failed.fields.error, /^-32000: editor\.read requires/);
  assert.equal(failed.fields.class, "RangeError");
  await editor.run("editor.reload");
  assert.equal((await editor.nextLog("command", (fields) => fields.name === "editor.reload")).fields.ok, true);
});

test("a failed contribution and a format are recorded", async (t) => {
  const formatter = new URL("./fixtures/trim-formatter.mjs", import.meta.url).href;
  const editor = await openEditor(t, { contributions: [
    { id: "probe", package: "@soksak/plugin-probe", version: "1.0.0", manifest: { id: "probe", contributes: {
      "editor.formatter": [{ range: "^1.0.0", module: "ui/z.js", extensions: ["js"] }],
    } }, modules: { "ui/z.js": formatter } },
    { id: "broken", package: "@soksak/plugin-broken", version: "1.0.0", manifest: { id: "broken", contributes: {
      "editor.extension": [{ range: "^1.0.0", module: "ui/y.js" }],
    } }, modules: { "ui/y.js": formatter } },
  ] });
  assert.deepEqual(eventsOf(editor.logs, "contribution.failed").map((entry) => [entry.level, entry.fields.point, entry.fields.plugin, entry.fields.error]),
    [["warn", "extension", "broken", "the module does not export extension(file)"]]);
  await editor.run("editor.format");
  await editor.until(() => editor.logs.some((entry) => entry.event === "format"));
  const [format] = eventsOf(editor.logs, "format");
  assert.equal(format.level, "info");
  assert.deepEqual({ ...format.fields, micros: isMicros(format.fields.micros) }, { path: "src/main.js", formatter: "probe", changed: true, micros: true, ok: true, surface: SURFACE });
});

test("the end of the surface records the close", async (t) => {
  const editor = await openEditor(t);
  await editor.close();
  assert.deepEqual(eventsOf(editor.logs, "close").map((entry) => entry.fields), [{ path: "src/main.js", pending: 0, surface: SURFACE }]);
});

test("a tab without a path opens a blank document named as a new document", async (t) => {
  const editor = await openEditor(t, { params: {}, files: new Map() });
  assert.equal(await editor.run("editor.read"), "");
  assert.deepEqual(editor.reports.title, ["새 문서"]);
  const document = await editor.status("editor.document");
  assert.equal(document.path, null);
  assert.equal(document.version, null);
  assert.equal(document.modified, false);
  assert.deepEqual(editor.sidecar.sent, [], "a blank document reads and watches no file");
});

test("the first save of a blank document asks for the file through core.file.place, writes it and watches it", async (t) => {
  const editor = await openEditor(t, { params: {}, files: new Map(), commands: { "core.file.place": () => ({ path: "notes/plan.md" }) } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "# plan\n" }] });
  assert.equal((await editor.status("editor.document")).modified, true);
  const { version } = await editor.run("editor.save");
  assert.deepEqual(editor.reports.commands, [["core.file.place", { name: "새 문서.txt" }]]);
  assert.equal(editor.files.get("notes/plan.md"), "# plan\n");
  assert.equal(version, sha("# plan\n"));
  assert.deepEqual(editor.sidecar.sent.map((body) => [body.operation, body.operation === "write" ? body.expect : body.paths]), [["write", null], ["watch", ["notes/plan.md"]]]);
  const document = await editor.status("editor.document");
  assert.equal(document.path, "notes/plan.md");
  assert.equal(document.language, "markdown");
  assert.equal(document.modified, false);
  assert.deepEqual(editor.reports.title, ["새 문서", "plan.md"]);
  // The next save writes the named file in place.
  await editor.run("editor.edit", { changes: [{ from: 7, to: 7, insert: "- a\n" }] });
  await editor.run("editor.save");
  assert.equal(editor.files.get("notes/plan.md"), "# plan\n- a\n");
  assert.equal(editor.reports.commands.length, 1, "a named document does not ask for its place again");
});

test("a cancelled place keeps the blank document modified and writes nothing", async (t) => {
  const editor = await openEditor(t, { params: {}, files: new Map(), commands: { "core.file.place": () => ({ path: null }) } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "draft" }] });
  assert.deepEqual(await editor.run("editor.save"), { version: null });
  assert.equal((await editor.status("editor.document")).path, null);
  assert.equal((await editor.status("editor.document")).modified, true);
  assert.deepEqual(editor.sidecar.sent, []);
});

test("a place whose file exists overwrites it, because the save panel asked to replace it", async (t) => {
  const files = new Map([["old.txt", "before"]]);
  const editor = await openEditor(t, { params: {}, files, commands: { "core.file.place": () => ({ path: "old.txt" }) } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "after" }] });
  await editor.run("editor.save");
  assert.equal(files.get("old.txt"), "after");
  assert.equal((await editor.status("editor.document")).path, "old.txt");
});

test("a refused place shows the tab error and keeps the blank document", async (t) => {
  const editor = await openEditor(t, { params: {}, files: new Map(), commands: { "core.file.place": () => {
    throw new Error("file place: /elsewhere/a.txt is outside the project /project");
  } } });
  await editor.run("editor.edit", { changes: [{ from: 0, to: 0, insert: "x" }] });
  await assert.rejects(editor.run("editor.save"), /outside the project/);
  assert.equal((await editor.status("editor.document")).path, null);
  assert.match(editor.reports.error.at(-1), /outside the project/);
});

test("the editor writes its file and cursor as the tab state and restores them", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.select", { anchor: 4, head: 5 });
  assert.deepEqual(editor.reports.state.at(-1), { path: "src/main.js", selection: { anchor: 4, head: 5 }, scroll: { top: 0, left: 0 } });
  const count = editor.reports.state.length;
  await editor.run("editor.select", { anchor: 4, head: 5 });
  assert.equal(editor.reports.state.length, count, "a selection that keeps the state writes nothing");
  // The stored path wins over params, because the first save of a blank document changes the file and not the params.
  const restored = await openEditor(t, { params: {}, stored: { path: "src/main.js", selection: { anchor: 6, head: 99 }, scroll: { top: 0, left: 0 } } });
  assert.equal((await restored.status("editor.document")).path, "src/main.js");
  assert.deepEqual((await restored.status("editor.document")).selection, { anchor: 6, head: 22 });
});

test("a tab state of another form is refused", async (t) => {
  const editor = await openEditor(t, { stored: { path: "", selection: { anchor: 0, head: 0 }, scroll: { top: 0, left: 0 } } });
  await editor.until(() => editor.logs.some((entry) => entry.event === "page.error"));
  const [failure] = eventsOf(editor.logs, "page.error");
  assert.equal(failure.fields.where, "mount");
  assert.match(failure.fields.error, /the tab state of editor tab editor-1 is not \{path, selection, scroll\}: \{"path":""/);
});

test("the tab stays loaded while a formatter runs", async (t) => {
  let finish;
  globalThis.__editorFormat = (text) => new Promise((resolve) => { finish = () => resolve(text.toUpperCase()); });
  t.after(() => { delete globalThis.__editorFormat; });
  const formatter = `data:text/javascript,${encodeURIComponent("export const format = (text) => globalThis.__editorFormat(text);")}`;
  const editor = await openEditor(t, { contributions: [
    { id: "fmt", package: "@soksak/plugin-fmt", version: "1.0.0", manifest: { id: "fmt", contributes: { "editor.formatter": [{ range: "^1.0.0", module: "ui/fmt.js" }] } },
      modules: { "ui/fmt.js": formatter } },
  ] });
  const formatted = editor.run("editor.format");
  await editor.until(() => editor.reports.keep.length > 0);
  assert.deepEqual(editor.reports.keep, [["busy", true]]);
  finish();
  await formatted;
  assert.deepEqual(editor.reports.keep, [["busy", true], ["busy", false]]);
});

test("a format without a connected formatter shows the refusal as the tab error", async (t) => {
  const editor = await openEditor(t);
  await assert.rejects(editor.run("editor.format"), /no formatter is connected/);
  assert.match(editor.reports.error.at(-1), /^서식을 맞추지 못했습니다 · no formatter is connected/);
});

test("a formatter that throws a value without a message shows the value as the tab error", async (t) => {
  const formatter = `data:text/javascript,${encodeURIComponent("export const format = () => { throw 'formatter broke'; };")}`;
  const editor = await openEditor(t, { contributions: [
    { id: "fmt", package: "@soksak/plugin-fmt", version: "1.0.0", manifest: { id: "fmt", contributes: {
      "editor.formatter": [{ range: "^1.0.0", module: "ui/fmt.js", extensions: ["js"] }],
    } }, modules: { "ui/fmt.js": formatter } },
  ] });
  // The host carries the failure to the caller as an Error with the value's text; the thrown value itself is recorded by the page.
  await assert.rejects(editor.run("editor.format"), (error) => error instanceof Error && error.message === "formatter broke");
  assert.deepEqual(eventsOf(editor.logs, "format").filter((entry) => entry.level === "warn").map((entry) => entry.fields.error),
    ["-32603: formatter broke"]);
  assert.equal(editor.reports.error.at(-1), "서식을 맞추지 못했습니다 · formatter broke");
});

test("an invalid regular expression shows its message in the find bar and records it", async (t) => {
  const editor = await openEditor(t);
  await editor.run("editor.find", { query: "(", regexp: true });
  assert.match(editor.root.querySelector("#count").textContent, /Invalid regular expression/);
  await editor.until(() => editor.logs.some((entry) => entry.event === "find.invalid"));
  const invalid = eventsOf(editor.logs, "find.invalid");
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].fields.error, /Invalid regular expression/);
});

test("a Markdown image failure after the tab is disposed is recorded as an event", async (t) => {
  const text = "![gone](assets/gone.png)\n";
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const editor = await openEditor(t, { params: { path: "docs/readme.md" }, files: new Map([["docs/readme.md", text]]),
    sidecarFor: async (body, sidecar) => {
      if (body.operation !== "readBytes") return sidecar.send(body);
      await held;
      return sidecar.report({ id: body.id, error: "missing: docs/assets/gone.png" });
    } });
  const toggled = editor.run("editor.markdown.toggle").catch((error) => error);
  await editor.until(() => editor.view.calls.some((call) => call.command === "runtime.sidecar.send" && call.params.body.operation === "readBytes"));
  await editor.close();
  release();
  await toggled;
  assert.deepEqual(eventsOf(editor.logs, "markdown.image").map((entry) => [entry.level, entry.fields]),
    [["warn", { path: "docs/readme.md", reason: "disposed", error: "-32603: the editor closed before the files sidecar replied", surface: SURFACE }]]);
});

test("Markdown renders in place and toggles without changing the document", async (t) => {
  const text = "# Heading\n\n**bold** and *italic* [link](https://example.test)\n\n- item\n\n`code`\n\n```js\nconst value = 1\n```\n\n![alt text](https://example.test/image.png)\n";
  const editor = await openEditor(t, { files: new Map([["notes.md", text]]), params: { path: "notes.md" } });
  const { root } = editor;
  assert.equal(declared("commands", "editor.markdown.toggle"), true);
  assert.deepEqual(await editor.run("editor.markdown.toggle"), { rendered: true });
  assert.ok(root.querySelector(".cm-md-heading-1"));
  assert.ok(root.querySelector(".cm-md-strong"));
  assert.ok(root.querySelector(".cm-md-emphasis"));
  assert.ok(root.querySelector(".cm-md-link"));
  assert.ok(root.querySelector(".cm-md-list"));
  assert.ok(root.querySelector(".cm-md-inline-code"));
  assert.ok(root.querySelector(".cm-md-fenced-code"));
  assert.equal(root.querySelector("img.cm-md-image")?.getAttribute("src"), "https://example.test/image.png");
  assert.doesNotMatch(root.querySelector(".cm-content").textContent, /# Heading|\*\*bold\*\*|\*italic\*|\[link\]|`code`|```|!\[/);
  assert.equal(await editor.run("editor.read"), text, "rendering must not replace the Markdown document");
  await editor.run("editor.edit", { changes: [{ from: 2, to: 9, insert: "Changed" }] });
  const changed = text.replace("Heading", "Changed");
  assert.equal(root.querySelector(".cm-md-heading-1").textContent, "Changed", "decorations follow edits in rendered mode");
  assert.equal(await editor.run("editor.read"), changed);
  assert.deepEqual(await editor.run("editor.markdown.toggle"), { rendered: false });
  assert.match(root.querySelector(".cm-content").textContent, /# Changed/);
  assert.equal(await editor.run("editor.read"), changed);
});

test("the Markdown toggle is hidden and refuses non-Markdown files", async (t) => {
  const editor = await openEditor(t);
  assert.equal(editor.root.querySelector("#markdown-toolbar").hidden, true);
  await assert.rejects(editor.run("editor.markdown.toggle"), /only for Markdown files/);
});

test("Markdown image URLs reject obfuscated schemes and resolve project-relative paths", () => {
  assert.equal(safeImageSource("javascript:alert(1)"), null);
  assert.equal(safeImageSource("java script:alert(1)"), null);
  assert.equal(safeImageSource("java\u0000script:alert(1)"), null);
  assert.deepEqual(safeImageSource("https://example.test/image.png"), { kind: "remote", source: "https://example.test/image.png" });
  assert.equal(projectImagePath("docs/nested/readme.md", "../images/diagram%20one.png?size=small#top"), "docs/images/diagram one.png");
  assert.throws(() => projectImagePath("docs/nested/readme.md", "../../../outside.png"), /leaves the project root/);
});

test("unsafe Markdown image schemes are refused visibly", async (t) => {
  const editor = await openEditor(t, { params: { path: "unsafe.md" }, files: new Map([["unsafe.md", "![unsafe](javascript:alert(1))"]]) });
  await assert.rejects(editor.run("editor.markdown.toggle"), /unsafe or malformed Markdown image URL/);
  assert.match(editor.reports.error.at(-1), /이미지를 불러오지 못했습니다.*unsafe or malformed/);
  assert.equal(editor.root.querySelector("img.cm-md-image"), null);
});

test("Markdown decorations cover headings near the end of a large document", async (t) => {
  const text = "paragraph\n".repeat(20000) + "# Final heading\n";
  const editor = await openEditor(t, { params: { path: "large.md" }, files: new Map([["large.md", text]]) });
  await editor.run("editor.markdown.toggle");
  const view = EditorView.findFromDOM(editor.root.querySelector(".cm-editor"));
  const headings = [];
  view.state.field(markdownView).decorations.between(0, view.state.doc.length, (from, to, value) => {
    if (value.spec.class?.includes("cm-md-heading-1")) headings.push({ from, to });
  });
  assert.equal(headings.length, 1);
  const headingStart = text.lastIndexOf("# Final heading");
  assert.equal(headings[0].from, headingStart);
  await editor.run("editor.edit", { changes: [{ from: headingStart + 2, to: headingStart + "# Final heading".length, insert: "Updated heading" }] });
  // The decorations of the edited heading appear when the parse of the large document completes; the view update that
  // carries them is the event that the test awaits.
  const headingLines = () => {
    const ranges = [];
    view.state.field(markdownView).decorations.between(0, view.state.doc.length, (from, to, value) => {
      if (value.spec.class?.includes("cm-md-heading-1")) ranges.push({ from, to });
    });
    return ranges;
  };
  const refreshed = () => {
    const lines = headingLines();
    return lines.length === 1 && view.state.sliceDoc(lines[0].from, lines[0].to) === "# Updated heading";
  };
  await viewUpdate(view, refreshed);
  const updated = headingLines();
  assert.equal(updated.length, 1, "the completed parse refreshes decorations after an edit");
  assert.equal(view.state.sliceDoc(updated[0].from, updated[0].to), "# Updated heading");
});

test("relative Markdown images read project files and release Blob URLs", async (t) => {
  const text = "![diagram](images/diagram.png)\n";
  const bytes = Uint8Array.of(137, 80, 78, 71, 1, 2, 3);
  const files = new Map([["docs/nested/readme.md", text], ["docs/nested/images/diagram.png", bytes]]);
  const editor = await openEditor(t, { params: { path: "docs/nested/readme.md" }, files });
  const { root } = editor;
  await editor.run("editor.markdown.toggle");
  assert.deepEqual(editor.sidecar.sent.filter((body) => body.operation === "readBytes").map((body) => body.path), ["docs/nested/images/diagram.png"]);
  const image = root.querySelector("img.cm-md-image");
  assert.ok(image);
  const objectUrl = image.getAttribute("src");
  assert.match(objectUrl, /^blob:/);
  const response = await fetch(objectUrl);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(await editor.run("editor.read"), text);
  await editor.run("editor.markdown.toggle");
  assert.equal(root.querySelector("img.cm-md-image"), null);
  await assert.rejects(fetch(objectUrl));
  await editor.run("editor.markdown.toggle");
  const secondUrl = root.querySelector("img.cm-md-image").getAttribute("src");
  await editor.close();
  await assert.rejects(fetch(secondUrl));
});

test("Markdown image URLs refresh after edits and reloads", async (t) => {
  const text = "![diagram](images/first.png)\n";
  const first = Uint8Array.of(1, 2, 3, 4);
  const second = Uint8Array.of(5, 6, 7, 8);
  const reloaded = Uint8Array.of(9, 10, 11, 12);
  const files = new Map([["docs/nested/readme.md", text], ["docs/nested/images/first.png", first], ["docs/nested/images/second.png", second]]);
  const editor = await openEditor(t, { params: { path: "docs/nested/readme.md" }, files });
  const { root } = editor;
  await editor.run("editor.markdown.toggle");
  const firstUrl = root.querySelector("img.cm-md-image").getAttribute("src");
  const view = EditorView.findFromDOM(root.querySelector(".cm-editor"));
  const imageUrl = () => root.querySelector("img.cm-md-image")?.getAttribute("src");
  const from = text.indexOf("images/first.png");
  await editor.run("editor.edit", { changes: [{ from, to: from + "images/first.png".length, insert: "images/second.png" }] });
  // The view update that draws the image of the edited source is the event that the test awaits.
  await viewUpdate(view, () => ![undefined, firstUrl].includes(imageUrl()));
  const secondUrl = root.querySelector("img.cm-md-image").getAttribute("src");
  assert.notEqual(secondUrl, firstUrl);
  assert.deepEqual(new Uint8Array(await (await fetch(secondUrl)).arrayBuffer()), second);
  await assert.rejects(fetch(firstUrl));
  assert.equal(await editor.run("editor.read"), text.replace("images/first.png", "images/second.png"));
  await editor.run("editor.save");
  files.set("docs/nested/images/second.png", reloaded);
  await editor.run("editor.reload");
  await viewUpdate(view, () => ![undefined, secondUrl].includes(imageUrl()));
  const reloadedUrl = root.querySelector("img.cm-md-image").getAttribute("src");
  assert.notEqual(reloadedUrl, secondUrl);
  assert.deepEqual(new Uint8Array(await (await fetch(reloadedUrl)).arrayBuffer()), reloaded);
  await assert.rejects(fetch(secondUrl));
  await editor.close();
  await assert.rejects(fetch(reloadedUrl));
  assert.deepEqual(editor.sidecar.sent.filter((body) => body.operation === "readBytes").map((body) => body.path), [
    "docs/nested/images/first.png", "docs/nested/images/second.png", "docs/nested/images/second.png",
  ]);
});

test("missing relative Markdown images fail the toggle visibly without changing source", async (t) => {
  const text = "![missing](assets/missing.png)\n";
  const files = new Map([["docs/readme.md", text]]);
  const editor = await openEditor(t, { params: { path: "docs/readme.md" }, files });
  await assert.rejects(editor.run("editor.markdown.toggle"), /no such file: docs\/assets\/missing\.png/);
  assert.deepEqual(editor.sidecar.sent.filter((body) => body.operation === "readBytes").map((body) => body.path), ["docs/assets/missing.png"]);
  assert.match(editor.reports.error.at(-1), /이미지를 불러오지 못했습니다.*missing\.png/);
  assert.equal(await editor.run("editor.read"), text);
  assert.equal(files.get("docs/readme.md"), text);
});

test("a partial Markdown image read failure revokes earlier Blob URLs", async (t) => {
  const created = [];
  const revoked = [];
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { const url = create.call(URL, blob); created.push(url); return url; };
  URL.revokeObjectURL = (url) => { revoked.push(url); revoke.call(URL, url); };
  t.after(() => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
  const text = "![available](images/first.png) ![missing](images/missing.png)";
  const files = new Map([["docs/readme.md", text], ["docs/images/first.png", Uint8Array.of(1, 2, 3)]]);
  const editor = await openEditor(t, { params: { path: "docs/readme.md" }, files });
  await assert.rejects(editor.run("editor.markdown.toggle"), /no such file: docs\/images\/missing\.png/);
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, created);
  assert.equal(editor.root.querySelector("img.cm-md-image"), null);
  await assert.rejects(fetch(created[0]));
});

test("malformed readBytes base64 is surfaced instead of silently omitting an image", async (t) => {
  const text = "![diagram](assets/diagram.png)\n";
  const editor = await openEditor(t, { params: { path: "docs/readme.md" }, files: new Map([["docs/readme.md", text]]),
    sidecarFor: (body, sidecar) => (body.operation === "readBytes"
      ? sidecar.report({ id: body.id, data: "%%%", version: "bad" }) : sidecar.send(body)) });
  await assert.rejects(editor.run("editor.markdown.toggle"), /invalid base64/);
  assert.match(editor.reports.error.at(-1), /이미지를 불러오지 못했습니다.*invalid base64/);
  assert.equal(await editor.run("editor.read"), text);
});

test("a denied relative Markdown image read is surfaced", async (t) => {
  const text = "![private](assets/private.png)\n";
  const editor = await openEditor(t, { params: { path: "docs/readme.md" }, files: new Map([["docs/readme.md", text]]),
    sidecarFor: (body, sidecar) => (body.operation === "readBytes"
      ? sidecar.report({ id: body.id, error: "permission denied: docs/assets/private.png" }) : sidecar.send(body)) });
  await assert.rejects(editor.run("editor.markdown.toggle"), /permission denied/);
  assert.match(editor.reports.error.at(-1), /이미지를 불러오지 못했습니다.*permission denied/);
  assert.equal(await editor.run("editor.read"), text);
});

test("relative Markdown image paths cannot escape the project root", async (t) => {
  const text = "![escape](../../../outside.png)";
  const editor = await openEditor(t, { params: { path: "docs/nested/readme.md" }, files: new Map([["docs/nested/readme.md", text]]) });
  await assert.rejects(editor.run("editor.markdown.toggle"), /leaves the project root/);
  assert.equal(editor.sidecar.sent.some((body) => body.operation === "readBytes"), false);
});
