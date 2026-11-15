// The view page of the tests of this repository: a jsdom window on soksak://<plugin id>/ with the globals of a page, and the session of
// the plugin API fixture (plugin-api/session.mjs) that answers the plugin API calls of the page modules of ui/. The page modules run
// unchanged in the test process; their imports of @soksak/plugin-api resolve to the fixture (plugin-api/register.mjs).
import { JSDOM } from "jsdom";
import { openSession } from "./plugin-api/session.mjs";

// The page loads of this process: each load gets a URL that no earlier load has, so Node imports the page module anew.
let pageLoads = 0;
// The windows of the open views, the last opened last. The globals of the page read the last window, as a page of a browser reads the window
// of its own document; a test that opens a second view reads the second window from the globals.
const openWindows = [];
let unbindGlobals = null;

/** The names of the window that the process does not define, which the page reads as globals of its window. */
const windowGlobals = (window) => {
  const names = new Set();
  for (let object = window; Object.getPrototypeOf(object) !== null; object = Object.getPrototypeOf(object)) {
    for (const name of Object.getOwnPropertyNames(object)) names.add(name);
  }
  return [...names].filter((name) => !(name in globalThis));
};

/** Binds the window names to the process globals while a view is open: a function without a prototype is bound to the window, as a page calls it. */
function bindGlobals(window) {
  openWindows.push(window);
  if (unbindGlobals !== null) return;
  const saved = new Map();
  for (const name of new Set([...windowGlobals(window), "window", "self", "document"])) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        const current = openWindows.at(-1);
        const value = current[name];
        return typeof value === "function" && !("prototype" in value) ? value.bind(current) : value;
      },
      set(value) { openWindows.at(-1)[name] = value; },
    });
  }
  unbindGlobals = () => {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  };
}

/** Ends the binding of one window; the process globals are restored when no view is open. */
function releaseGlobals(window) {
  openWindows.splice(openWindows.indexOf(window), 1);
  if (openWindows.length === 0) {
    unbindGlobals();
    unbindGlobals = null;
  }
}

/** The page's stylesheets are a list on the document; jsdom has no adoptedStyleSheets, so the list is kept on the document. */
function adoptStyleSheets(document, CSSStyleSheet) {
  let sheets = [];
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    get: () => sheets,
    set(value) {
      if (!Array.isArray(value) || !value.every((sheet) => sheet instanceof CSSStyleSheet)) {
        throw new TypeError("adoptedStyleSheets takes an array of CSSStyleSheet");
      }
      sheets = [...value];
    },
  });
}

/**
 * Opens the view of the plugin `name` on its window and returns the view.
 *
 *     start         the start values of the surface {surface, params, origin, project, diagnostics}, or null for a view without
 *                   window.sokSurface (a page that reads it refuses to load)
 *     declarations  the entries of the plugin: {status, commands, element}
 *     scheme        the color scheme of the theme that the window starts with
 *     sidecars, calls, sidecar, contributions   the arrangement of the plugin API session (plugin-api/session.mjs)
 *
 * The returned view has the members of the session (api, requests, events, run, read, watch, push, sidecarMessage, until, settled,
 * failed, exposureRequests, frameObservers, watched) and these:
 *     window        the jsdom window of the page
 *     load(url)     imports the page module into the window; a view loads one page module
 *     close()       ends the view as the page ends: the pagehide of the window, then the end of the session
 */
export async function openPageView(name, { start, declarations = {}, scheme = "dark", sidecars = [], calls = {}, sidecar = {}, contributions = {}, frameStop }) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: `soksak://${name}/`, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  adoptStyleSheets(window.document, window.CSSStyleSheet);
  // The visual viewport of the window is an event target whose size is the size of the window; jsdom has none.
  const viewport = new window.EventTarget();
  Object.defineProperties(viewport, { width: { get: () => window.innerWidth }, height: { get: () => window.innerHeight } });
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  // The window has no layout, so its ResizeObserver, which CodeMirror constructs, never delivers an entry.
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // The theme and the start values are set before the page runs, as the start scripts of the host do.
  window.sokTheme = Object.freeze({ scheme, tokens: Object.freeze({}) });
  if (start !== null) {
    const merged = Object.fromEntries(["status", "commands", "element"].map((kind) => [kind, declarations[kind] ?? []]));
    window.sokSurface = Object.freeze({ section: null, ...start, declarations: merged, levels: {} });
  }
  // The sok-view handler of the window: the page hands it to createViewBridge, whose fixture answers the page without it, so a post of
  // the page itself is refused.
  window.webkit = { messageHandlers: { "sok-view": { postMessage(message) {
    throw new Error(`the page posted ${JSON.stringify(message)} to the sok-view handler: the plugin API fixture answers the page`);
  } } } };
  const session = openSession({ sidecars, calls, sidecar, contributions, frameStop, theme: { scheme, tokens: {} } });
  bindGlobals(window);
  const endSession = session.close;
  let loaded = false;
  let ending = null;
  const endView = async () => {
    // The page ends its work at pagehide: the calls that it starts then are answered before the end of the session.
    await session.endWith(() => window.dispatchEvent(new window.Event("pagehide")));
    endSession();
    window.close();
    releaseGlobals(window);
  };
  return Object.assign(session, {
    name,
    window,
    async load(url) {
      if (!(url instanceof URL)) throw new TypeError(`view.load requires the URL of the page module, found ${String(url)}`);
      if (loaded) throw new Error(`view ${name} already has a page loaded: a view loads one page module`);
      loaded = true;
      const target = new URL(url);
      target.searchParams.set("view", String(++pageLoads));
      return import(target.href);
    },
    // The view ends once; a later close resolves with the first one.
    close() {
      ending ??= endView();
      return ending;
    },
  });
}
