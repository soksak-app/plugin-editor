// The surface context of the editor view page (core docs/spec/plugins.md#view-surfaces): the context that the editor module receives,
// built over the view bridge. It is a module of its own, so that a test imports it without running the page (view.js mounts the page).
import { createExpose } from "@soksak/plugin-api";
import { SIDECAR } from "./view-sidecar.js";

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
    // Each value of a watched status goes to the main page as a changed call (core docs/spec/exposure.md#relay).
    changed: relay.changed,
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
        element: (name, element) => exposure.element(name, element),
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
