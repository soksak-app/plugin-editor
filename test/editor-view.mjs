// The editor view of the tests: the page module of ui/ (built into build/test/ui/view.js) opened in the view test host of the SDK
// release that package.json pins (openView, host mode). The page builds its own bridge, surface context and editor, so the tests
// call its commands through the command requests of the host and read its exposed statuses through the exposure requests that
// the host forwards. The fixtures are the parts that lie outside the plugin: the files sidecar, the core commands and the tab state.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openView } from "@soksak/plugin-api/testing";
import { filesSidecar, SIDECAR, SURFACE } from "./files-sidecar.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const diagnosticDeclaration = JSON.parse(readFileSync(new URL("../diagnostics.json", import.meta.url), "utf8"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const PAGE = new URL("../build/test/ui/view.js", import.meta.url);
const PREFIX = "plugin.editor.";

// The request ids of the exposure requests of the views of this process.
let nextRequest = 0;

/** The installed plugins of the window: the editor itself, which declares its extension points, and the plugins of the test. */
export const installedOf = (contributions) => [{ id: manifest.id, package: pkg.name, version: pkg.version, manifest }, ...contributions];

/** The exposure declarations of the view: the plugin's entries, and the diagnostic entries when the start declares them. */
const declarationsOf = (exposeDiagnostic) => ({
  status: manifest.exposes.status,
  commands: [...manifest.exposes.commands, ...(exposeDiagnostic ? diagnosticDeclaration.exposes.commands : [])],
  element: manifest.exposes.element,
});

/**
 * Opens the editor view of one tab and loads its page. The options are the start values of the tab (params, project, diagnostic),
 * the files of the project (the files sidecar; sidecarFor replaces its route), the tab state, the core commands (commands: {name: fn}),
 * the statuses of the window, the settings, the native calls of the surface, the installed plugins that contribute to the editor
 * (contributions), the faults of the routes (faults), the color scheme of the window (scheme) and beforeLoad(view), which runs before the
 * page module loads.
 *
 * Returns the editor: view (the openView result), files, sidecar, root (the shadow root of the editor), run, status, watch, changes,
 * push, settle, until, nextLog, reports, logs and close. close ends the view once; the test cleanup ends it too when the test fails.
 */
export async function openEditor(t, { params = { path: "src/main.js" }, files = new Map([["src/main.js", "let a = 1;\n// TODO: b\n"]]),
  project = { id: "project", root: "/project" }, diagnostic = false, exposeDiagnostic = diagnostic, stored = null, settings = {}, textSize = 1, statuses = {},
  commands = {}, native = {}, contributions = [], faults = {}, shortcuts = [], sidecarFor = null, scheme = "dark",
  beforeLoad = () => {}, hold = null } = {}) {
  const sidecar = filesSidecar(files);
  // hold names the operation whose first reply is held: the page does not finish its mount until the test releases it, so the
  // load is not awaited and the held reply is returned as held.
  const held = hold === null ? null : sidecar.holdReply(hold);
  const declarations = declarationsOf(exposeDiagnostic);
  let stateValue = stored;
  const start = { surface: SURFACE, params, origin: { directory: null }, project,
    diagnostics: diagnostic ? diagnosticDeclaration : null };
  const view = await openView("editor", {
    start,
    declarations,
    host: {
      surface: SURFACE,
      declarations,
      statuses,
      settings,
      textSize,
      contributions: installedOf(contributions),
      sidecars: [SIDECAR],
      shortcuts,
      faults,
      project,
      state: { read: () => stateValue, write: (value) => { stateValue = value; } },
      commands,
      sidecar: { [SIDECAR]: sidecarFor === null ? (body) => sidecar.send(body) : (body) => sidecarFor(body, sidecar) },
      native: {
        exposureReply: () => null,
        changed: () => null,
        registered: () => null,
        ...native,
      },
    },
  });
  // CodeMirror measures text through these; jsdom has no layout, so every rectangle is empty.
  const empty = () => ({ x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  view.window.Range.prototype.getClientRects = () => [];
  view.window.Range.prototype.getBoundingClientRect = empty;
  view.window.Element.prototype.getClientRects = () => [];
  sidecar.attach(view);
  // The waits of the test on the records of the view: each call, sent message and log batch checks them, so a wait resolves in the
  // turn of the record that completes it.
  const waits = new Set();
  const recorded = () => {
    for (const wait of [...waits]) {
      if (!wait.condition()) continue;
      waits.delete(wait);
      wait.resolve();
    }
  };
  const until = (condition) => {
    if (condition()) return Promise.resolve();
    const wait = { condition, ...Promise.withResolvers() };
    waits.add(wait);
    return wait.promise;
  };
  for (const list of [view.sent, view.calls, view.events]) {
    Object.defineProperty(list, "push", { value: (...items) => {
      const length = Array.prototype.push.apply(list, items);
      recorded();
      return length;
    } });
  }
  beforeLoad(view);
  const mounted = view.load(PAGE);
  // A held load ends with its page: a rejected load is reported to the awaiting test, so the rejection is not left unhandled here.
  mounted.catch(() => {});
  const shadowRootOf = () => view.window.document.body.lastElementChild?.shadowRoot ?? null;
  if (held === null) {
    await mounted;
    await view.settled();
  } else {
    // The page creates the shadow root of the editor before its first call, so the first call of the page ends the wait.
    await until(() => shadowRootOf() !== null);
  }
  const root = shadowRootOf();
  // The start script of the window reads the dark theme; another scheme is a theme message of the host, as the window posts it.
  if (scheme !== "dark") {
    view.window.dispatchEvent(new view.window.MessageEvent("message", { source: view.window,
      data: { sok: 1, event: "theme", data: { scheme, tokens: {} } } }));
    await view.settled();
  }
  // An exposure request of the view: the host forwards it as the exposure-request event of the surface, and the answer is the
  // exposureReply that the page sends for its id.
  const exposed = async (method, requestParams) => {
    const id = `request-${++nextRequest}`;
    await view.push("exposure-request", { id, surface: SURFACE, method, params: requestParams });
    await view.settled();
    const reply = view.observed.document.findLast((entry) => entry.name === "exposureReply" && entry.payload.id === id);
    assert.ok(reply, `the page did not answer the exposure request ${method}`);
    if (reply.payload.error !== undefined) throw new Error(reply.payload.error.message);
    return reply.payload.result;
  };
  const calls = (command) => view.calls.filter((call) => call.command === command).map((call) => call.params);
  // The writer stores each event of the plugin under its catalog name plugin.editor.<event>; the records keep the name that the emitter
  // of the plugin gives, as the events of the plugin do (ui/events.js).
  const records = () => view.events.map(({ level, event, fields }) => ({
    level, event: event.startsWith(PREFIX) ? event.slice(PREFIX.length) : event, fields,
  }));
  let closing = null;
  const editor = {
    view,
    files,
    sidecar,
    root,
    /** The held first reply of the operation named by hold, or null; mounted settles when the page module has loaded. */
    held,
    mounted,
    /** Runs a command of the editor, and resolves with its result or rejects with its error. */
    run: (name, commandParams = {}) => view.request(name, commandParams),
    /** The value of an exposed status of the editor. */
    status: (name) => exposed("status.get", { name }),
    /** Watches a status of the editor; each later value is a changed call (reports.changed). */
    watch: (name) => exposed("status.watch", { name }),
    /** The values that the watch of the status `name` sent to the main page, in order. */
    changes: (name) => editor.reports.changed.filter((payload) => payload.name === name).map((payload) => payload.value),
    /** Delivers a host event of the surface to the page through the subscriptions that the page holds. */
    push: (event, data) => view.push(event, data),
    settle: () => view.settled(),
    until,
    /** Resolves with the first record of event after the call that predicate accepts: the record of the handling that the test awaits. */
    nextLog(event, predicate = () => true) {
      const mark = view.events.length;
      const found = () => records().slice(mark).find((entry) => entry.event === event && predicate(entry.fields));
      return until(() => found() !== undefined).then(found);
    },
    /** The tab reports, in order: the values of each report call of the page, the core commands and the watch changes of the view. */
    get reports() {
      return {
        title: calls("tab.title"),
        modified: calls("tab.modified"),
        error: calls("tab.error"),
        keep: calls("tab.keep").map(({ reason, on }) => [reason, on]),
        state: calls("tab.state.write"),
        commands: view.calls.filter((call) => call.command.startsWith("core."))
          .map(({ command, params }) => [command, params]),
        changed: view.calls.filter((call) => call.command === "runtime.native.call" && call.params.name === "changed")
          .map((call) => call.params.payload),
      };
    },
    /** The records that the writer of the page has sent, in order: {level, event, fields}. */
    get logs() { return records(); },
    /** Ends the view as the page ends: the pagehide of the window, then the close of the test host. */
    close() {
      closing ??= view.close();
      return closing;
    },
  };
  t.after(() => editor.close());
  return editor;
}
