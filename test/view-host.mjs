// The host side of the view channel for the tests of the view page: it runs the injected view-start script (the file the
// host stages from @soksak/plugin-api into each view configuration) in a fresh window, serves the call route of a view
// (the view calls of core docs/spec/native-surfaces.md#view-surfaces), and sends the
// requests of core to the commands of the view. The page imports with a distinct query per case, so each case mounts a
// fresh page into its own window.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createWindow, useWindow } from "./dom.mjs";
import { fakeFiles } from "./fakes.mjs";

const require = createRequire(import.meta.url);
// The host injects the text of this file into each view configuration before any page script runs; the test runs the
// same file from the installed @soksak/plugin-api.
const VIEW_START = readFileSync(new URL("./view-start.js", new URL(`file://${require.resolve("@soksak/plugin-api")}`)), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const declared = (kind, name) => (MANIFEST.exposes[kind] ?? []).some((entry) => entry.name === name);

const settle = (rounds = 6) => {
  let done = Promise.resolve();
  for (let i = 0; i < rounds; i += 1) done = done.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  return done;
};

/**
 * Creates one window with the view page of one case mounted: the start values, the injected view-start script, the host
 * side of the sok-view channel, and the fetch of the core root files. The globals of the test process serve the window.
 *
 * Returns { window, sidecar, reports, logs, run, post, settle }. reports holds the tab reports, the state writes, the
 * registrations and the native calls that the page sent; logs holds the runtime.log records; run(name, params) sends one
 * command request of core to the page; post(message) posts one host message to the page.
 */
export function createViewPage(t, caseId, { params = { path: "src/main.js" }, stored = null,
  files = new Map([["src/main.js", "let a = 1;\n// TODO: b\n"]]), scheme = "dark",
  place = () => { throw new Error("the test runs no core command"); } } = {}) {
  const { window } = createWindow(`sok://editor/ui/index.html?case=${caseId}`);
  useWindow(window);
  const sidecar = fakeFiles(files);
  const reports = { title: [], modified: [], error: [], keep: [], state: [], registered: [], native: [], placed: [] };
  const logs = [];
  const received = [];
  const pending = new Map();
  // jsdom posts from the test process as another realm, so the message event carries no source of the window; the test
  // dispatches the message event itself with the window as the source, as the host posts into the page world.
  const post = (message) => window.dispatchEvent(new window.MessageEvent("message", { source: window, origin: "", data: message }));
  // The host of the view: it receives the ready message, the calls and the replies of the page through the sok-view
  // handler, and it posts each host message through the window of the page (docs/spec/native-surfaces.md#view-surfaces).
  const handler = { postMessage: (message) => { received.push(message); deliver(message); } };
  window.webkit = { messageHandlers: { "sok-view": handler } };

  const reply = (id, payload) => post({ sok: 1, id, ...payload });
  const deliver = (message) => {
    if (message?.event !== undefined) return;
    if (message?.reply !== undefined) {
      const request = pending.get(message.reply);
      if (!request) throw new Error(`the page replied to unknown host request ${message.reply}`);
      pending.delete(message.reply);
      if (message.error !== undefined) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    if (Number.isInteger(message?.id) && typeof message?.command === "string") {
      serve(message.id, message.command, message.params);
      return;
    }
    throw new Error(`the page sent an unexpected message ${JSON.stringify(message)}`);
  };
  const serve = (id, command, params) => {
    Promise.resolve().then(async () => {
      switch (command) {
        case "tab.state.read": return stored;
        case "tab.state.write": reports.state.push(params); return null;
        case "tab.title": reports.title.push(params); return null;
        case "tab.footer": case "tab.directory": case "tab.notify": return null;
        case "tab.modified": reports.modified.push(params); return null;
        case "tab.error": reports.error.push(params); return null;
        case "tab.keep": reports.keep.push(params); return null;
        case "runtime.log": logs.push(params); return null;
        case "runtime.sidecar.send":
          return sidecar.send(params.id, params.body, params.cids ?? []);
        case "runtime.sidecar.on":
          await sidecar.on(params.id, (body) => post({ sok: 1, event: "sidecar.message", data: { id: params.id, body } }));
          return null;
        case "runtime.sidecar.onFailure":
          await sidecar.onFailure(params.id, (reason) => post({ sok: 1, event: "sidecar.failure", data: { id: params.id, reason } }));
          return null;
        case "runtime.command.register":
          if (!declared("commands", params.name)) throw new Error(`command ${params.name} is not declared`);
          reports.registered.push(params.name);
          return null;
        case "runtime.native.call": {
          const { name, payload } = params;
          if (name === "registered") {
            if (!declared(payload.kind, payload.name)) throw new Error(`${payload.kind} ${payload.name} is not declared`);
            reports.native.push(["registered", payload]);
            return null;
          }
          if (name === "exposureReply" || name === "report") {
            reports.native.push([name, payload]);
            return null;
          }
          throw new Error(`the page called the native ${name}`);
        }
        default:
          if (command.startsWith("core.")) {
            reports.placed.push([command, params]);
            return place(command, params);
          }
          throw new Error(`the page called ${command}, which is served by no route of the test host`);
      }
    }).then((result) => reply(id, { result: result ?? null }), (error) => reply(id, { error: { code: -32000, message: String(error?.message ?? error) } }));
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("installed-plugins.json")) return { ok: true, status: 200, json: async () => ({ plugins: [] }) };
    if (url === "/plugin.json" || url.endsWith("sok://editor/plugin.json")) {
      return { ok: true, status: 200, json: async () => MANIFEST };
    }
    throw new Error(`the page fetched ${url}, which the test host serves no document for`);
  };
  t.after(() => { globalThis.fetch = realFetch; });

  window.sokSurface = Object.freeze({ surface: "editor-1", params, origin: { directory: null }, project: { root: "/project" } });
  window.eval(VIEW_START);
  // The theme script of the view ran before the page, and the host sends the current theme after the ready message; the
  // test posts it before the page attaches, so it arrives through the queue of the injected script (the first messages).
  post({ sok: 1, event: "theme", data: { scheme, tokens: {} } });

  // Sends one command request of core to the page, as the workbench sends each request of a command of the view.
  let nextId = 1000;
  const run = (name, paramsOfRun = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    post({ sok: 1, id, command: name, params: paramsOfRun });
  });
  return { window, sidecar, files, reports, logs, received, run, post, settle };
}
