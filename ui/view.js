// The editor view page (core docs/spec/plugins.md#view-surfaces): the host serves it at soksak://editor/ui/index.html in the
// web view of the surface, and injects the view channel script and the theme script before this page runs. The page builds
// the surface context of its view over the view channel (@soksak/plugin-api/view) and mounts the editor module into a
// shadow root of the page. The tab reports are served calls tab.title, tab.modified, tab.error and tab.keep; event records use
// the SDK bridge's runtime.log and runtime.error (core docs/spec/native-surfaces.md#view-surfaces, view calls). The page reads
// the surface start values (tab, params and project) from window.sokSurface, which the host sets before the page runs.
import { createViewBridge } from "@soksak/plugin-api/view";
import { mount } from "./editor.js";
import { createEmitter } from "./events.js";
import { loadDiagnostics } from "./view-diagnostics.js";
import { createViewContext } from "./view-context.js";

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
// The reports of the bridge: each loss of a call or a snapshot (late-reply, peer-lost, skipped, stalled) is stored as
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
let editor = null;
try {
  editor = await mount(host.attachShadow({ mode: "open" }), context);
} catch (error) {
  report("mount", error);
}
// The view ends with its page: the editor disposes on pagehide, so its close is recorded and its sidecar requests end.
addEventListener("pagehide", () => {
  editor?.dispose().catch((error) => report("dispose", error));
}, { once: true });
