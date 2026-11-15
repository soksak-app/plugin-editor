// The editor view of the tests: the page module of ui/ (built into build/test/ui/view.js) opened on the plugin API fixture of this
// repository (test/fixtures/plugin-api). The page builds its own bridge, surface context and editor over that fixture, so the tests
// run its commands through the commands that the page registered and read its statuses through the providers that it registered. The
// fixtures are the parts that lie outside the plugin: the files sidecar, the core commands and the tab state.
import { readFileSync } from "node:fs";
import { openPageView } from "./fixtures/page-view.mjs";
import { filesSidecar, SIDECAR, SURFACE } from "./files-sidecar.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const diagnosticDeclaration = JSON.parse(readFileSync(new URL("../diagnostics.json", import.meta.url), "utf8"));
const PAGE = new URL("../build/test/ui/view.js", import.meta.url);
// The calls of the page that report to the tab and are answered with null.
const TAB_REPORTS = ["tab.title", "tab.footer", "tab.directory", "tab.notify", "tab.modified", "tab.error", "tab.keep"];

/**
 * The contributions that the test arranges for the points of the editor: each plugin {id, manifest, modules} contributes the items of
 * `editor.<point>`, and modules maps the module path of an item to the URL that the page imports.
 */
export const contributionsOf = (plugins) => Object.fromEntries(["extension", "formatter"].map((point) => [point,
  plugins.flatMap((plugin) => (plugin.manifest.contributes?.[`editor.${point}`] ?? []).map((item, index) => ({
    plugin: plugin.id, index, item, module: plugin.modules[item.module],
  })))]));

/** The exposure declarations of the view: the plugin's entries, and the diagnostic entries when the start declares them. */
const declarationsOf = (exposeDiagnostic) => ({
  status: manifest.exposes.status,
  commands: [...manifest.exposes.commands, ...(exposeDiagnostic ? diagnosticDeclaration.exposes.commands : [])],
  element: manifest.exposes.element,
});

/**
 * Opens the editor view of one tab and loads its page. The options are the start values of the tab (params, project, diagnostic),
 * the files of the project (the files sidecar; sidecarFor replaces its route), the tab state, the core commands (commands: {name: fn}),
 * the installed plugins that contribute to the editor (contributions), the color scheme of the window (scheme) and beforeLoad(view), which
 * runs before the page module loads.
 *
 * Returns the editor: view (the view of the fixture), files, sidecar, root (the shadow root of the editor), run, status, watch, changes,
 * push, settle, until, nextLog, reports, logs and close. close ends the view once; the test cleanup ends it too when the test fails.
 */
export async function openEditor(t, { params = { path: "src/main.js" }, files = new Map([["src/main.js", "let a = 1;\n// TODO: b\n"]]),
  project = { id: "project", root: "/project" }, diagnostic = false, exposeDiagnostic = diagnostic, stored = null,
  commands = {}, contributions = [], frameStop = undefined, sidecarFor = null, scheme = "dark", beforeLoad = () => {}, hold = null } = {}) {
  const sidecar = filesSidecar(files);
  // hold names the operation whose first reply is held: the page does not finish its mount until the test releases it, so the
  // load is not awaited and the held reply is returned as held.
  const held = hold === null ? null : sidecar.holdReply(hold);
  const declarations = declarationsOf(exposeDiagnostic);
  let stateValue = stored;
  const start = { surface: SURFACE, params, origin: { directory: null }, project,
    diagnostics: diagnostic ? diagnosticDeclaration : null };
  const view = await openPageView("editor", {
    start,
    declarations,
    scheme,
    sidecars: [SIDECAR],
    calls: {
      ...Object.fromEntries(TAB_REPORTS.map((name) => [name, () => null])),
      "tab.state.read": () => stateValue,
      "tab.state.write": (value) => { stateValue = value; return null; },
      ...commands,
    },
    contributions: contributionsOf(contributions),
    frameStop,
    sidecar: { [SIDECAR]: sidecarFor === null ? (body) => sidecar.send(body) : (body) => sidecarFor(body, sidecar) },
  });
  // The view ends with the test, also when its page fails to load, so a failed test does not leave the view open.
  t.after(() => view.close());
  // CodeMirror measures text through these; jsdom has no layout, so every rectangle is empty.
  const empty = () => ({ x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  view.window.Range.prototype.getClientRects = () => [];
  view.window.Range.prototype.getBoundingClientRect = empty;
  view.window.Element.prototype.getClientRects = () => [];
  sidecar.attach(view);
  const { until } = view;
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
  const calls = (command) => view.requests.filter((call) => call.command === command).map((call) => call.params);
  let closing = null;
  const editor = {
    view,
    files,
    sidecar,
    root,
    /** The held first reply of the operation named by hold, or null; mounted settles when the page module has loaded. */
    held,
    mounted,
    /** Runs a command that the page registered, and resolves with its result or rejects with its error. */
    run: (name, commandParams = {}) => view.run(name, commandParams),
    /** The value of a status that the page registered. */
    status: async (name) => view.read(name),
    /** Watches a status of the editor; each later value is a watched record (reports.changed). */
    watch: async (name) => { view.watch(name); },
    /** The values that the watch of the status `name` received, in order. */
    changes: (name) => editor.reports.changed.filter((payload) => payload.name === name).map((payload) => payload.value),
    /** Delivers a native event to the page through the subscription that the page holds. */
    push: (event, data) => view.push(event, data),
    settle: () => view.settled(),
    until,
    /** Resolves with the first record of event after the call that predicate accepts: the record of the handling that the test awaits. */
    nextLog(event, predicate = () => true) {
      const mark = view.events.length;
      const found = () => view.events.slice(mark).find((entry) => entry.event === event && predicate(entry.fields));
      return until(() => found() !== undefined).then(found);
    },
    /** The tab reports, in order: the values of each report call of the page, the core commands and the watch values of the view. */
    get reports() {
      return {
        title: calls("tab.title"),
        modified: calls("tab.modified"),
        error: calls("tab.error"),
        keep: calls("tab.keep").map(({ reason, on }) => [reason, on]),
        state: calls("tab.state.write"),
        commands: view.requests.filter((call) => call.command.startsWith("core."))
          .map(({ command, params: commandParams }) => [command, commandParams]),
        changed: view.watched,
      };
    },
    /** The records that the writer of the page has sent, in order: {level, event, fields}. */
    get logs() { return view.events; },
    /** Ends the view as the page ends: the pagehide of the window, then the end of the session. */
    close() {
      closing ??= view.close();
      return closing;
    },
  };
  return editor;
}
