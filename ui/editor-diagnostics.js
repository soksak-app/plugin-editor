// The editor footprint fixture is available only when diagnostics.json is staged.
import { observeViewDocumentFrames } from "@soksak/plugin-api/diagnostic-view-frames";

const FRAME_CARD = "rgb(17, 193, 231)";
const FRAME_FIELDS = Object.freeze(["sequence", "width", "height", "documentTimeOriginMs", "resizeAtMs", "frameTimeMs"]);

export function createHiddenEditorFixture({ root, EditorView, createState, readHistoryEntries }) {
  if (!root || typeof root.append !== "function" || typeof root.ownerDocument?.createElement !== "function") {
    throw new TypeError("the hidden editor fixture requires a view root");
  }
  if (typeof EditorView !== "function" || typeof createState !== "function" || typeof readHistoryEntries !== "function") {
    throw new TypeError("the hidden editor fixture requires the maintained editor view, state factory and history reader");
  }
  let host = null;
  let view = null;
  const read = () => {
    const historyEntries = readHistoryEntries();
    if (!Number.isInteger(historyEntries) || historyEntries < 0) {
      throw new TypeError("the editor view history length must be a non-negative integer");
    }
    // The editor view composition contains no native document regions.
    return view === null
      ? { mounted: false, documentLength: 0, lines: 0, historyEntries, regionHistoryEntries: 0 }
      : { mounted: true, documentLength: view.state.doc.length, lines: view.state.doc.lines, historyEntries,
        regionHistoryEntries: 0 };
  };
  const mount = () => {
    if (view !== null) throw new Error("the hidden editor is already mounted");
    host = root.ownerDocument.createElement("div");
    host.dataset.editorDiagnosticHidden = "";
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;visibility:hidden;overflow:hidden;contain:strict";
    root.append(host);
    try {
      view = new EditorView({ parent: host, root, state: createState() });
    } catch (error) {
      host.remove();
      host = null;
      throw error;
    }
    return read();
  };
  const remove = () => {
    try {
      view?.destroy();
    } finally {
      view = null;
      host?.remove();
      host = null;
    }
    return read();
  };
  return Object.freeze({ mount, read, remove, dispose: remove });
}

export function createViewFrameMeasurement({ document, runtime, readHistoryEntries,
  observeFrames = observeViewDocumentFrames }) {
  const documentRoot = document?.documentElement;
  const viewWindow = document?.defaultView;
  if (!documentRoot?.style || typeof documentRoot.getBoundingClientRect !== "function") {
    throw new TypeError("content frame measurement requires the editor view document root");
  }
  if (typeof runtime?.log?.trace !== "function" || typeof readHistoryEntries !== "function"
    || typeof observeFrames !== "function") {
    throw new TypeError("content frame measurement requires runtime logging, view history and the shared frame observer");
  }
  let active = false;
  let sequence = 0;
  let stopObserver = null;
  let previousCard = null;
  const read = () => {
    const rect = documentRoot.getBoundingClientRect();
    const historyEntries = readHistoryEntries();
    if (!Number.isFinite(rect.width) || rect.width < 0 || !Number.isFinite(rect.height) || rect.height < 0) {
      throw new TypeError("editor view document root has invalid dimensions");
    }
    if (!Number.isInteger(historyEntries) || historyEntries < 0) {
      throw new TypeError("the editor view history length must be a non-negative integer");
    }
    // The editor view composition contains no native document regions.
    return { enabled: active, sequence, width: rect.width, height: rect.height, historyEntries, regionHistoryEntries: 0 };
  };
  const restoreCard = () => {
    if (previousCard === null) return;
    const { hadProperty, value, priority } = previousCard;
    if (hadProperty) documentRoot.style.setProperty("--card", value, priority);
    else documentRoot.style.removeProperty("--card");
    previousCard = null;
  };
  const start = () => {
    if (active) throw new Error("editor content frame measurement is already enabled");
    if (typeof viewWindow?.ResizeObserver !== "function" || typeof viewWindow.requestAnimationFrame !== "function"
      || typeof viewWindow.cancelAnimationFrame !== "function" || typeof viewWindow.performance?.now !== "function"
      || !Number.isFinite(viewWindow.performance.timeOrigin)) {
      throw new TypeError("content frame measurement requires view document resize, animation frame and performance APIs");
    }
    const style = documentRoot.style;
    const hadProperty = Array.from({ length: style.length }, (_, index) => style.item(index)).includes("--card");
    previousCard = { hadProperty, value: style.getPropertyValue("--card"), priority: style.getPropertyPriority("--card") };
    try {
      style.setProperty("--card", FRAME_CARD);
      active = true;
      sequence = 0;
      const stop = observeFrames({
        document,
        log: { trace: (event, fields) => {
          if (!active) throw new Error("shared view-frame observer emitted after stop");
          if (event !== "view.content_frame" || fields === null || typeof fields !== "object" || Array.isArray(fields)) {
            throw new TypeError("shared view-frame observer returned invalid event data");
          }
          if (Object.keys(fields).length !== FRAME_FIELDS.length || FRAME_FIELDS.some((name) => !Object.hasOwn(fields, name))) {
            throw new TypeError("shared view-frame observer returned unexpected event fields");
          }
          if (!Number.isSafeInteger(fields.sequence) || fields.sequence !== sequence ||
            !Number.isFinite(fields.documentTimeOriginMs) || fields.documentTimeOriginMs < 0 ||
            !Number.isFinite(fields.resizeAtMs) || fields.resizeAtMs < 0 ||
            !Number.isFinite(fields.frameTimeMs) || fields.frameTimeMs < fields.resizeAtMs ||
            !Number.isFinite(fields.width) || fields.width < 0 ||
            !Number.isFinite(fields.height) || fields.height < 0) {
            throw new TypeError("shared view-frame observer returned invalid sequence, clocks or dimensions");
          }
          sequence += 1;
          return runtime.log.trace("view.content_frame", {
            sequence: fields.sequence, width: fields.width, height: fields.height,
            documentTimeOriginMs: fields.documentTimeOriginMs, resizeAtMs: fields.resizeAtMs, frameTimeMs: fields.frameTimeMs,
          });
        } },
        ResizeObserver: viewWindow.ResizeObserver,
        requestAnimationFrame: viewWindow.requestAnimationFrame.bind(viewWindow),
        cancelAnimationFrame: viewWindow.cancelAnimationFrame.bind(viewWindow),
        now: viewWindow.performance.now.bind(viewWindow.performance),
        timeOriginMs: viewWindow.performance.timeOrigin,
      });
      if (typeof stop !== "function") throw new TypeError("the shared view frame observer must return its stop function");
      stopObserver = stop;
      return read();
    } catch (error) {
      const stop = stopObserver;
      active = false;
      stopObserver = null;
      let stopError;
      try {
        stop?.();
      } catch (failure) {
        stopError = failure;
      } finally {
        restoreCard();
      }
      if (stopError !== undefined) throw new AggregateError([error, stopError], "content frame measurement failed and its observer did not stop cleanly");
      throw error;
    }
  };
  const stop = () => {
    if (active) {
      const stop = stopObserver;
      active = false;
      stopObserver = null;
      try {
        stop?.();
      } finally {
        restoreCard();
      }
    }
    return read();
  };
  return Object.freeze({ start, stop, read, dispose: stop });
}

export async function attach({ expose, root, document, runtime, EditorView, createState, readHistoryEntries }) {
  if (typeof expose?.command !== "function") throw new TypeError("editor diagnostics require expose.command");
  const fixture = createHiddenEditorFixture({ root, EditorView, createState, readHistoryEntries });
  const contentTrace = createViewFrameMeasurement({ document, runtime, readHistoryEntries });
  await expose.command("editor.memory.hidden", async ({ action } = {}) => {
    if (action === "mount") return fixture.mount();
    if (action === "read") return fixture.read();
    if (action === "remove") return fixture.remove();
    throw new TypeError("editor.memory.hidden action must be mount, read or remove");
  });
  await expose.command("editor.diagnostics.content-trace", async ({ action } = {}) => {
    if (action === "start") return contentTrace.start();
    if (action === "stop") return contentTrace.stop();
    if (action === "read") return contentTrace.read();
    throw new TypeError("editor.diagnostics.content-trace action must be start, stop or read");
  });
  return () => {
    let firstError;
    try {
      contentTrace.dispose();
    } catch (error) {
      firstError = error;
    }
    try {
      fixture.dispose();
    } catch (error) {
      if (firstError !== undefined) throw new AggregateError([firstError, error], "editor diagnostic cleanup failed");
      throw error;
    }
    if (firstError !== undefined) throw firstError;
  };
}
