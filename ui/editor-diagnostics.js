// The editor footprint fixture is available only when diagnostics.json is staged.
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
    return view === null
      ? { mounted: false, documentLength: 0, lines: 0, historyEntries }
      : { mounted: true, documentLength: view.state.doc.length, lines: view.state.doc.lines, historyEntries };
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
    view?.destroy();
    view = null;
    host?.remove();
    host = null;
    return read();
  };
  return Object.freeze({ mount, read, remove, dispose: remove });
}

export async function attach({ expose, root, EditorView, createState, readHistoryEntries }) {
  if (typeof expose?.command !== "function") throw new TypeError("editor diagnostics require expose.command");
  const fixture = createHiddenEditorFixture({ root, EditorView, createState, readHistoryEntries });
  await expose.command("editor.memory.hidden", async ({ action } = {}) => {
    if (action === "mount") return fixture.mount();
    if (action === "read") return fixture.read();
    if (action === "remove") return fixture.remove();
    throw new TypeError("editor.memory.hidden action must be mount, read or remove");
  });
  return fixture.dispose;
}
