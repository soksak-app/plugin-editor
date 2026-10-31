// The editor view page (core docs/spec/plugins.md#view-surfaces): the host serves it at soksak://editor/ui/index.html in the
// web view of the surface, and injects the view channel script and the theme script before this page runs. The page builds
// the surface context of its view over the view channel (@soksak/plugin-api/view) and mounts the editor module into a
// shadow root of the page. The tab reports are served calls tab.title, tab.modified, tab.error and tab.keep; event records use
// the SDK bridge's runtime.log and runtime.error (core docs/spec/native-surfaces.md#view-surfaces, view calls). The page reads
// the surface start values (tab, params and project) from window.sokSurface, which the host sets before the page runs.
import { createExpose } from "@soksak/plugin-api";
import { createViewBridge } from "@soksak/plugin-api/view";
import { mount } from "./editor.js";
import { createEmitter } from "./events.js";
import { loadDiagnostics } from "./view-diagnostics.js";
import { SIDECAR } from "./view-sidecar.js";

const CORE_ROOT = "soksak://core";

/**
 * The frozen start values of the surface, which the host of the view sets before the page runs (core
 * docs/spec/native-surfaces.md#view-surfaces, start values): declarations are the exposes of the plugin.
 */
export function startValues(windowRef = window) {
  const start = windowRef.sokSurface;
  if (start === null || typeof start !== "object" || typeof start.surface !== "string" || start.surface === ""
    || start.declarations === null || typeof start.declarations !== "object") {
    throw new Error(`the view of ${windowRef.location.host} has no start values: the host provides window.sokSurface {surface, params, origin, project, declarations, diagnostics} before the page runs`);
  }
  return start;
}

/** The reporter of this page: report(where, error) stores the error as the event plugin.editor.page.error. */
function createReporter(log) {
  const emitEvent = createEmitter({ log }, "editor");
  return (where, error) => emitEvent("error", "plugin.editor.page.error",
    { where, error: String(error?.message ?? error).slice(0, 1024) });
}

/**
 * The surface context of the view of one page, over the view bridge: the tab reports, the tab state, the sidecar, the
 * commands, the core commands, the event records, the theme and the exposure run through the view calls, events and
 * commands of core docs/spec/native-surfaces.md#view-surfaces.
 *
 *     bridge      createViewBridge() of @soksak/plugin-api/view over the sok-view handler, including runtime.log and runtime.error
 *     start       the frozen start values {surface, params, origin, project, declarations}
 *     report    report(text): stores one error of the context
 *
 * Returns {context}.
 */
export function createViewContext({ bridge, start, report, diagnostics = null }) {
  if (typeof report !== "function") throw new TypeError("createViewContext requires the report function");
  const { calls, commands, runtime, exposure: relay } = bridge;
  // The fire-and-forget calls of the context: a refusal of the route is a record, not a lost report.
  const send = (command, params) => calls.request(command, params)
    .then(undefined, (error) => report(`view call ${command}: ${error?.message ?? error}`));
  // The connected items of the point `editor.<point>`: the module of each item is served from the core root (grant rule 4).
  const contributions = (point) => bridge.contributions(point);
  // The exposure of the page: the local entries answer the binds and the exposure requests, and each registration goes
  // through the channel. A command is declared by commands.register of the bridge, which registers the same handler for
  // the requests of core, so the local registration sends no declaration of its own. Each forwarded exposure request of the
  // surface arrives as the host event exposure-request and is answered through exposureReply (core
  // docs/spec/native-surfaces.md#view-surfaces, view exposure).
  const exposure = createExpose({
    register: (kind, name) => kind === "command" ? Promise.resolve() : relay.register(kind, name).then(() => undefined),
    onRequest: (answer) => runtime.native.on("exposure-request", ({ id, surface, method, params }) => {
      if (surface !== start.surface) {
        report(`view editor: exposure request ${id} names surface ${surface}, not ${start.surface}`);
        return;
      }
      answer({ id, method, params });
    }),
    reply: relay.reply,
    report,
  }, () => start.declarations);
  return {
    context: {
      surfaceId: start.surface,
      project: start.project,
      origin: start.origin,
      diagnostics,
      tab: {
        params: start.params ?? null,
        title: (text) => send("tab.title", text),
        footer: (text) => send("tab.footer", text),
        directory: (path) => send("tab.directory", path),
        notify: (text, policy) => send("tab.notify", { text, policy }),
        modified: (value) => send("tab.modified", value),
        error: (text) => send("tab.error", text),
        keep: (reason, on) => send("tab.keep", { reason, on }),
        state: {
          read: () => calls.request("tab.state.read", null),
          write: (value) => send("tab.state.write", value),
        },
      },
      contributions,
      runtime: {
        sidecar: () => ({
          // A view has no input chain (core docs/spec/native-surfaces.md, view input), so a send carries no identifiers.
          send: (surface, body, cids = []) => runtime.sidecar(SIDECAR).send(surface, body, cids),
          on: (surface, fn) => runtime.sidecar(SIDECAR).on(surface, fn),
          onFailure: (surface, fn) => runtime.sidecar(SIDECAR).onFailure(surface, fn),
        }),
        command: (name, params) => calls.request(name, params),
        // The transport of the records: the emit sites of the plugin are the callers of ui/events.js.
        log: runtime.log,
        theme: runtime.theme,
      },
      exposure: {
        status: (name, read, subscribe) => exposure.status(name, read, subscribe),
        command: (name, run) => Promise.all([exposure.command(name, run), commands.register(name, run)]).then(() => undefined),
        dom: (name, element) => exposure.dom(name, element),
        bind: exposure.bind,
        delegate: exposure.delegate,
        audit: exposure.audit,
        dispose: async () => {
          await exposure.dispose();
        },
      },
      // The state of the surface is the state that the workbench keeps; the page of a view reports no phase.
      status: { report: () => {} },
    },
  };
}

/** Sets the theme on the root of the page, as the theme script of the view and each later theme message carry it. */
function applyTheme(theme) {
  if (theme?.scheme !== "dark" && theme?.scheme !== "light") throw new Error("the theme must have scheme dark or light");
  document.documentElement.style.colorScheme = theme.scheme;
  for (const [token, value] of Object.entries(theme.tokens ?? {})) {
    document.documentElement.style.setProperty(token, value);
  }
}

/** The errors and unhandled rejections of this page are stored when they occur, as where page and rejection. */
function installPageErrors(report) {
  for (const [type, where, pick] of [["error", "page", (event) => event.error], ["unhandledrejection", "rejection", (event) => event.reason]]) {
    addEventListener(type, (event) => report(where, pick(event)));
  }
}

// The page: the start values, the bridge over the injected channel, the theme of the document, and the mount into the
// shadow root of the page body.
const start = startValues();
// The reports of the bridge: each loss of a call or a snapshot (timeout, late-reply, peer-lost, skipped, stalled) is stored as
// an error of the calls. open-calls is the count of the open calls, a state that changes with every call and no loss, so the
// page stores none of it; storing it through a call would report a new count without end. The reporter needs the calls of
// the bridge, so a loss before it exists waits in losses.
const losses = [];
let reportLoss = (event) => losses.push(event);
const bridge = createViewBridge({ handler: window.webkit.messageHandlers["sok-view"],
  report: (event) => { if (event.kind !== "open-calls") reportLoss(event); } });
const log = bridge.runtime.log;
const report = createReporter(log);
reportLoss = ({ kind, plugin: _plugin, ...fields }) => report("calls", `${kind} ${JSON.stringify(fields)}`);
for (const event of losses.splice(0)) reportLoss(event);
installPageErrors(report);
if (window.sokTheme) applyTheme(window.sokTheme);
bridge.runtime.theme(applyTheme);
const diagnostics = await loadDiagnostics(start);
const { context } = createViewContext({ bridge, start, diagnostics, report: (text) => report("context", text) });
const host = document.body.appendChild(document.createElement("div"));
host.style.cssText = "height:100%";
try {
  await mount(host.attachShadow({ mode: "open" }), context);
} catch (error) {
  report("mount", error);
}
