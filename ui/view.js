// The editor view page (core docs/spec/plugins.md#view-surfaces): the host serves it at sok://editor/ui/index.html in the
// web view of the surface, and injects the view channel script and the theme script before this page runs. The page builds
// the surface context of its view over the view channel (@soksak/plugin-api/view) and mounts the editor module into a
// shadow root of the page. The context entries whose call route the core branch does not serve yet are the waiting items
// of E24 in docs/features.md: the page sends the tab reports as the calls tab.title, tab.modified, tab.error and tab.keep,
// the event records as the call runtime.log, and reads the start values of the surface (the tab, its params, its project)
// from window.sokSurface, which the host sets before the page runs.
import { INSTALLED_PLUGINS, MANIFEST, createExpose, resolveContributions } from "@soksak/plugin-api";
import { createViewBridge } from "@soksak/plugin-api/view";
import { mount } from "./editor.js";

const LOG_LEVELS = ["error", "warn", "info", "debug", "trace"];
const CORE_ROOT = "sok://core";

/** The frozen start values of the surface: the host of the view sets them before the page runs (E24.3). */
export function startValues(windowRef = window) {
  const start = windowRef.sokSurface;
  if (start === null || typeof start !== "object" || typeof start.surface !== "string" || start.surface === "") {
    throw new Error(`the view of ${windowRef.location.host} has no start values: the host provides window.sokSurface {surface, params, origin, project} before the page runs`);
  }
  return start;
}

/** The reporter of this page: each record is written to the application log through the host report of the surface. */
function createReporter(calls) {
  return (text) => calls.request("runtime.native.call", { name: "report", payload: text })
    .then(undefined, (error) => Promise.reject(new Error(`report of a page record failed: ${error?.message ?? error}`)))
    .catch((error) => console.error(error.message));
}

/** The connected items of the extension points of this plugin, from the installed record of the core root. */
export async function loadFiles() {
  const response = await fetch(`${CORE_ROOT}/${INSTALLED_PLUGINS}`);
  if (!response.ok) throw new Error(`failed to load ${CORE_ROOT}/${INSTALLED_PLUGINS}: ${response.status}`);
  const installed = await response.json();
  if (typeof installed.error === "string") throw new Error(installed.error);
  return resolveContributions(installed.plugins);
}

/**
 * The surface context of the view of one page, over the view bridge. The entries whose call route the core branch serves
 * run through it (tab state, sidecar, commands, core commands, theme); the entries of the waiting items of E24 travel in
 * the forms recorded there.
 *
 *     bridge    createViewBridge() of @soksak/plugin-api/view over the sok-view handler of the view
 *     start     the frozen start values {surface, params, origin, project}
 *     files     the resolved items of the installed record, from loadFiles()
 *     report    report(text): writes one record to the application log
 *
 * Returns {context, statuses}. statuses holds the read function of every status that the page registered, because the
 * route that carries the values of the statuses of a view to core serves no pull yet (E24.4).
 */
export function createViewContext({ bridge, start, files, report }) {
  if (typeof report !== "function") throw new TypeError("createViewContext requires the report function");
  const { calls, commands, runtime } = bridge;
  // The fire-and-forget calls of the context: a refusal of the route is a record, not a lost report.
  const send = (command, params) => calls.request(command, params)
    .then(undefined, (error) => report(`view call ${command}: ${error?.message ?? error}`));
  const statuses = new Map();
  // The connected items of the point `editor.<point>`: the module of each item is served from the core root (grant rule 4).
  const contributions = (point) => files
    .filter((entry) => entry.state === "connected" && entry.point === `editor.${point}`)
    .map(({ plugin, item, module }) => ({
      plugin, item, module: `${CORE_ROOT}${module}`,
      // Core marks an invalid item for the provider; the view of it has no route yet (E24.4), so the page records the reason.
      fail: (reason) => report(`contribution of ${plugin} to editor.${point} is invalid: ${reason}`),
    }));
  // The exposure of the page: the local entries answer the binds and the exposure requests, and each registration goes
  // through the channel. A command is declared by commands.register of the bridge, which registers the same handler for
  // the requests of core, so the local registration sends no declaration of its own.
  let answerRequest = null;
  const exposure = createExpose({
    register: (kind, name) => kind === "command"
      ? Promise.resolve()
      : calls.request("runtime.native.call", { name: "registered", payload: { kind, name } }).then(() => undefined),
    onRequest: (answer) => {
      // The exposure requests of the surface (status.get, status.watch, command.run) reach the view when core forwards
      // them (E24.4); the page keeps the answerer so that it can reply through exposureReply then.
      answerRequest = answer;
      return () => { answerRequest = null; };
    },
    reply: (id, payload) => send("runtime.native.call", { name: "exposureReply", payload: { id, ...payload } }),
    report,
  }, async () => {
    // The page of a view reads its own plugin.json from its origin (core docs/spec/plugins.md#view-surfaces, Page).
    const response = await fetch(`/${MANIFEST}`);
    if (!response.ok) throw new Error(`failed to load /${MANIFEST}: ${response.status}`);
    const manifest = await response.json();
    // default: exposes is an optional field of plugin.json; a plugin without it registers nothing.
    return manifest.exposes ?? {};
  });
  return {
    statuses,
    context: {
      surfaceId: start.surface,
      project: start.project,
      origin: start.origin,
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
          send: (surface, body, cids) => calls.request("runtime.sidecar.send", { id: surface, body, cids }),
          on: (surface, fn) => runtime.sidecar().on(surface, fn),
          onFailure: (surface, fn) => runtime.sidecar().onFailure(surface, fn),
        }),
        command: (name, params) => calls.request(name, params),
        // events: forwarded; the fields are built before the send, because a call carries values and not builders. The
        // level gate of the route does not exist yet (E24.2), so the fields are built while the level is off too.
        log: Object.fromEntries(LOG_LEVELS.map((level) => [level,
          (event, fields) => send("runtime.log", { level, event, fields: typeof fields === "function" ? fields() : fields })])),
        theme: runtime.theme,
      },
      exposure: {
        status: (name, read, subscribe) => {
          statuses.set(name, read);
          return exposure.status(name, read, subscribe);
        },
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

/** The errors and unhandled rejections of this page are written to the application log when they occur. */
function installPageErrors(report) {
  for (const [type, pick] of [["error", (event) => event.error], ["unhandledrejection", (event) => event.reason]]) {
    addEventListener(type, (event) => {
      const error = pick(event);
      report(`view editor: ${error?.message ?? String(error)}`);
    });
  }
}

// The page: the start values, the bridge over the injected channel, the theme of the document, and the mount into the
// shadow root of the page body.
const start = startValues();
const losses = [];
const bridge = createViewBridge({ handler: window.webkit.messageHandlers["sok-view"], report: (event) => losses.push(event) });
const report = createReporter(bridge.calls);
for (const event of losses.splice(0)) {
  report(`view calls of editor: ${event.kind} ${event.status}${event.reason === undefined ? "" : `: ${event.reason}`}`);
}
installPageErrors(report);
if (window.sokTheme) applyTheme(window.sokTheme);
bridge.runtime.theme(applyTheme);
const files = await loadFiles();
const { context } = createViewContext({ bridge, start, files, report });
const host = document.body.appendChild(document.createElement("div"));
host.style.cssText = "height:100%";
try {
  await mount(host.attachShadow({ mode: "open" }), context);
} catch (error) {
  report(`view editor: mount failed: ${error?.message ?? error}`);
}
