// The editor surface: opens the file tab.params.path of the project through the files sidecar in CodeMirror, saves it
// in place, and follows changes on disk. A tab without a path opens a blank document, whose first save asks for its file
// through core.file.place. The contributions to editor.extension add CodeMirror extensions and the
// contributions to editor.formatter format the text (docs/features.md).
import { Compartment, EditorState, StateEffect, StateField } from "@soksak/shared/editor.extension/@codemirror/state.js";
import {
  Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap,
  lineNumbers,
} from "@soksak/shared/editor.extension/@codemirror/view.js";
import { bracketMatching, forceParsing, indentOnInput, syntaxHighlighting } from "@soksak/shared/editor.extension/@codemirror/language.js";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@soksak/shared/editor.extension/@codemirror/commands.js";
import { classHighlighter } from "@soksak/shared/editor.extension/@lezer/highlight.js";
import { createEmitter, errorText, failure, microsSince } from "./events.js";
import { createQuery, findMatches, replacementOf } from "./find.js";
import { extensionOf, languageOf, languageSupport } from "./languages.js";
import { connect } from "./requests.js";
import { invalidMarkdownImageSources, markdownImagesChanged, markdownImageSources, markdownRendered as markdownRenderedEffect, markdownSyntaxChanged, markdownView, projectImagePath } from "./markdown.js";
import { todoMarks } from "./todo.js";

const css = `:host{display:block;height:100%}
#frame{display:flex;height:100%;flex-direction:column;background:var(--card);color:var(--fg);font:var(--text-control)/1.4 var(--ui-font)}
#banner{display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--rule);color:var(--fg)}
#markdown-toolbar{display:flex;justify-content:flex-end;padding:2px 8px;border-bottom:1px solid var(--rule)}
#markdown-toggle[aria-pressed="true"]{color:var(--fg)}
#banner span{flex:1;min-width:0}
#find{display:flex;flex-direction:column;gap:4px;padding:4px 6px;border-bottom:1px solid var(--rule)}
#find form{display:flex;align-items:center;gap:4px;margin:0}
#find input{flex:1;min-width:0;background:transparent;color:inherit;border:1px solid var(--edge);border-radius:5px;padding:2px 6px;font:inherit}
#find input:focus{outline:none;border-color:var(--focus)}
#find output{min-width:56px;color:var(--muted);text-align:right}
button{padding:2px 6px;border:0;border-radius:var(--r-xs);background:transparent;color:var(--muted);font:inherit;cursor:pointer}
button:hover{background:var(--inset);color:var(--fg)}
button[aria-pressed="true"]{background:var(--chip-on);color:var(--fg)}
#view{flex:1;min-height:0}
.cm-md-heading{font-weight:700}.cm-md-heading-1{font-size:1.5em}.cm-md-heading-2{font-size:1.3em}.cm-md-heading-3{font-size:1.15em}
.cm-md-strong{font-weight:700}.cm-md-emphasis{font-style:italic}.cm-md-link{color:var(--focus);text-decoration:underline}
.cm-md-list-marker{display:inline-block;min-width:1.5em;color:var(--muted)}.cm-md-inline-code,.cm-md-code-text{font-family:var(--code-font,monospace);background:var(--inset);border-radius:3px}
.cm-md-fenced-code{background:var(--inset)}.cm-md-image{max-width:min(100%,48rem);max-height:60vh;object-fit:contain;vertical-align:middle}
.cm-md-image-source{color:var(--muted)}
.cm-todo{background:color-mix(in srgb,var(--focus) 25%,transparent);outline:1px solid color-mix(in srgb,var(--focus) 60%,transparent);border-radius:2px}
.cm-found{background:color-mix(in srgb,var(--rail) 30%,transparent)}
.cm-found-current{background:color-mix(in srgb,var(--focus) 45%,transparent)}
[hidden]{display:none!important}
#frame[data-scheme="dark"]{--tok-keyword:#c3a6ff;--tok-string:#a8d98a;--tok-number:#f2b07b;--tok-comment:#7f8496;--tok-name:#82c4ff;--tok-type:#ffd479;--tok-meta:#ff9ab3}
#frame[data-scheme="light"]{--tok-keyword:#7a3eb8;--tok-string:#2f7d32;--tok-number:#b35c00;--tok-comment:#7a7f8c;--tok-name:#1f63b5;--tok-type:#8a6100;--tok-meta:#b8325a}
.tok-keyword,.tok-operatorKeyword,.tok-modifier{color:var(--tok-keyword)}
.tok-string,.tok-string2,.tok-regexp{color:var(--tok-string)}
.tok-number,.tok-bool,.tok-atom,.tok-literal{color:var(--tok-number)}
.tok-comment,.tok-lineComment,.tok-blockComment{color:var(--tok-comment);font-style:italic}
.tok-variableName.tok-definition,.tok-function,.tok-propertyName.tok-definition,.tok-labelName{color:var(--tok-name)}
.tok-typeName,.tok-className,.tok-namespace,.tok-tagName{color:var(--tok-type)}
.tok-meta,.tok-attributeName,.tok-processingInstruction{color:var(--tok-meta)}
.tok-heading{font-weight:bold;color:var(--tok-name)}
.tok-emphasis{font-style:italic}.tok-strong{font-weight:bold}.tok-link,.tok-url{text-decoration:underline}
.tok-invalid{color:var(--no)}`;

const HTML = `<style>${css}</style><div id="frame" data-expose="editor.frame">
<div id="banner" data-expose="editor.banner" hidden><span></span><button data-expose="editor.reload">다시 읽기</button><button data-expose="editor.overwrite">덮어쓰기</button></div>
<div id="markdown-toolbar"><button type="button" id="markdown-toggle" data-expose="editor.markdown.toggle" aria-label="Markdown 미리 보기" aria-pressed="false">미리 보기</button></div>
<div id="find" data-expose="editor.find.bar" hidden>
<form id="find-form" data-expose="editor.find.form"><input id="query" data-expose="editor.find.query" aria-label="찾기" placeholder="찾기"><button type="button" id="case" data-expose="editor.find.case" aria-label="대소문자 구분" aria-pressed="false">Aa</button><button type="button" id="regexp" data-expose="editor.find.regexp" aria-label="정규식" aria-pressed="false">.*</button><output id="count"></output><button type="button" data-command="editor.find.previous" data-expose="editor.find.previous" aria-label="이전">↑</button><button type="button" data-command="editor.find.next" data-expose="editor.find.next" aria-label="다음">↓</button><button type="button" data-command="editor.find.close" data-expose="editor.find.close" aria-label="닫기">×</button></form>
<form id="replace-form" data-expose="editor.replace.form" hidden><input id="replacement" data-expose="editor.find.replacement" aria-label="바꿀 글" placeholder="바꿀 글"><button type="button" data-command="editor.replace" data-expose="editor.replace">바꾸기</button><button type="button" data-command="editor.replace.all" data-expose="editor.replace.all">모두 바꾸기</button></form>
</div>
<div id="view" data-expose="editor.view"></div></div>`;

const LINE_SEPARATORS = { lf: "\n", crlf: "\r\n", cr: "\r" };
/** The tab title of a blank document and the file name that its first save proposes. */
const NEW_TITLE = "새 문서";
const NEW_NAME = "새 문서.txt";

const MAX_MARKDOWN_IMAGE_BYTES = 33554432;
const MAX_MARKDOWN_PREVIEW_BYTES = 67108864;
const MAX_MARKDOWN_IMAGE_BASE64 = Math.ceil(MAX_MARKDOWN_IMAGE_BYTES / 3) * 4;
const MARKDOWN_IMAGE_TYPES = Object.freeze({
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon",
  jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", webp: "image/webp",
});
const markdownImageType = (path) => {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const type = MARKDOWN_IMAGE_TYPES[extension];
  if (!type) throw new Error("unsupported Markdown image type: " + path);
  return type;
};
function markdownImageBytes(data, path) {
  if (typeof data !== "string" || data.length === 0 || data.length > MAX_MARKDOWN_IMAGE_BASE64
    || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error("files sidecar readBytes returned invalid base64: " + path);
  }
  let binary;
  try { binary = atob(data); } catch { throw new Error("files sidecar readBytes returned invalid base64: " + path); }
  if (binary.length === 0 || binary.length > MAX_MARKDOWN_IMAGE_BYTES) {
    throw new Error("files sidecar image exceeds the 33554432-byte limit: " + path);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Reads project-local Markdown images with the files sidecar contract and creates bounded, typed Blob URLs. */
async function readMarkdownImageUrls(files, markdownPath, sources) {
  const urls = new Map();
  const paths = new Map();
  let total = 0;
  try {
    for (const source of sources) {
      const path = projectImagePath(markdownPath, source);
      let url = paths.get(path);
      if (url === undefined) {
        const reply = await files.request({ operation: "readBytes", path });
        const bytes = markdownImageBytes(reply.data, path);
        if (total + bytes.byteLength > MAX_MARKDOWN_PREVIEW_BYTES) {
          throw new Error("Markdown images exceed the 67108864-byte preview limit");
        }
        const blob = new Blob([bytes], { type: markdownImageType(path) });
        url = URL.createObjectURL(blob);
        paths.set(path, url);
        total += bytes.byteLength;
      }
      urls.set(source, url);
    }
    return urls;
  } catch (error) {
    for (const url of new Set([...urls.values(), ...paths.values()])) URL.revokeObjectURL(url);
    throw error;
  }
}

function revokeMarkdownImageUrls(urls) {
  for (const url of new Set(urls.values())) URL.revokeObjectURL(url);
}

/** Whether event is the shortcut of key with the command key, and with Option when alt is true. */
const shortcut = (event, key, { alt = false, shift = false } = {}) => event.metaKey && !event.ctrlKey
  && event.altKey === alt && event.shiftKey === shift && event.code === `Key${key.toUpperCase()}`;

/** A keydown condition that runs the command for the shortcut and keeps the default action of the key from running. */
const onShortcut = (key, modifiers) => (event) => {
  if (!shortcut(event, key, modifiers)) return false;
  event.preventDefault();
  return true;
};

// The colors of the editor come from the theme tokens of the application. A CodeMirror theme outranks the base theme of
// CodeMirror, whose light colors a plain stylesheet rule of the page does not override.
const frameTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "var(--card)", color: "var(--fg)", font: "var(--size)/1.5 var(--font)" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { caretColor: "var(--fg)" },
  ".cm-gutters": { backgroundColor: "var(--card)", color: "var(--muted)", borderRight: "1px solid var(--rule)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--fg) 5%, transparent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { backgroundColor: "color-mix(in srgb, var(--rail) 35%, transparent)" },
  ".cm-matchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--muted)" },
});

const setFound = StateEffect.define();
const foundMark = Decoration.mark({ class: "cm-found" });
const currentMark = Decoration.mark({ class: "cm-found-current" });
/** The decorations of the matches of the find bar; the effect setFound replaces them. */
const found = StateField.define({
  create: () => Decoration.none,
  update: (value, transaction) => {
    for (const effect of transaction.effects) if (effect.is(setFound)) return effect.value;
    return value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export async function mount(root, context) {
  // The tab state {path, selection, scroll} restores the file, the cursor and the scroll position of a restored or restarted
  // tab (core docs/spec/plugins.md#memory-saver); its path follows the first save of a blank document, which params do not.
  // default: a new tab has no tab state and reads null.
  const stored = await context.tab.state.read();
  if (stored !== null) checkTabState(stored, context.surfaceId);
  // default: a tab without params.path holds a blank document; core.file.open always passes {path}.
  let path = stored !== null ? stored.path : context.tab.params?.path ?? null;
  if (path !== null && (typeof path !== "string" || path === "")) throw new Error("the editor tab params.path must be a non-empty string");
  if (context.project === null) throw new Error("this window shows no project");
  const emitEvent = createEmitter(context.runtime, "editor");
  root.innerHTML = HTML;
  const frame = root.querySelector("#frame");
  const banner = root.querySelector("#banner");
  const bar = root.querySelector("#find");
  const findForm = root.querySelector("#find-form");
  const replaceForm = root.querySelector("#replace-form");
  const queryInput = root.querySelector("#query");
  const replacementInput = root.querySelector("#replacement");
  const caseButton = root.querySelector("#case");
  const regexpButton = root.querySelector("#regexp");
  const count = root.querySelector("#count");
  const host = root.querySelector("#view");
  const markdownToolbar = root.querySelector("#markdown-toolbar");
  const markdownButton = root.querySelector("#markdown-toggle");
  let language = path === null ? null : languageOf(path);
  let markdownRendered = false;
  markdownToolbar.hidden = language !== "markdown";
  let extension = path === null ? "" : extensionOf(path);
  let file = Object.freeze({ path, extension, language });
  const name = () => (path === null ? NEW_TITLE : path.slice(path.lastIndexOf("/") + 1));
  context.tab.title(name());

  // The document as the editor read or last wrote it, and the state of the file on disk.
  let saved = null;
  let fileState = { path, version: null, modified: false, length: 0, lines: 0, language, newline: null, bom: false,
    readOnly: false, reason: null, disk: "same", selection: { anchor: 0, head: 0 } };
  let diskVersion = null;
  const fileListeners = new Set();
  let find = { open: false, replace: false, query: "", replacement: "", caseSensitive: false, regexp: false,
    matches: 0, current: null, error: null };
  const findListeners = new Set();
  const publishFile = () => { for (const fn of fileListeners) fn(fileState); };
  const publishFind = () => { for (const fn of findListeners) fn(find); };

  // The banner states a fact about the file that the person decides on; errors go to tab.error.
  const showBanner = (text, { reload = false, overwrite = false } = {}) => {
    banner.hidden = text === null;
    banner.querySelector("span").textContent = text ?? "";
    banner.querySelector('[data-expose="editor.reload"]').hidden = !reload;
    banner.querySelector('[data-expose="editor.overwrite"]').hidden = !overwrite;
  };

  const files = await connect(context.runtime.sidecar(), context.surfaceId, (body) => {
    if (body.changed !== undefined) {
      emitEvent("debug", "plugin.editor.watch.change", { path: body.changed });
      diskChanged().catch((error) => context.tab.error(`다시 읽지 못했습니다 · ${errorText(error)}`));
      return;
    }
    emitEvent("error", "plugin.editor.watch.error", { path, error: String(body.error) });
    context.tab.error(`파일 감시가 멈췄습니다 · ${body.error}`);
  }, emitEvent);
  const read = () => files.request({ operation: "read", path });
  const watch = () => files.request({ operation: "watch", paths: [path] });
  const bytesOf = (text) => new TextEncoder().encode(text).length;
  // A refusal before the work starts shows its text as the tab error and is thrown to the caller, so each control reports it.
  const refused = (text) => {
    context.tab.error(text);
    return new Error(text);
  };
  // A read after the open: the result of the read is an event, and the caller still receives the failure.
  const readAgain = async (reason) => {
    const start = performance.now();
    try {
      const body = await read();
      emitEvent("debug", "plugin.editor.read", () => ({ path, reason, bytes: bytesOf(body.text), micros: microsSince(start), ok: true }));
      return body;
    } catch (error) {
      emitEvent("warn", "plugin.editor.read", { path, reason, bytes: 0, micros: microsSince(start), ok: false, error: failure(error, "-32603") });
      throw error;
    }
  };

  let contributions = await loadContributions(context, file, emitEvent);
  const languageSlot = new Compartment();
  const contributed = new Compartment();
  const editable = new Compartment();
  const separator = new Compartment();
  const scheme = new Compartment();
  const label = new Compartment();

  let view = null;
  let markdownImageUrls = new Map();
  let markdownImageGeneration = 0;
  let disposed = false;
  const resetMarkdownPreview = () => {
    markdownImageGeneration += 1;
    markdownRendered = false;
    const previous = markdownImageUrls;
    markdownImageUrls = new Map();
    if (view) view.dispatch({ effects: [markdownRenderedEffect.of(false), markdownImagesChanged.of(markdownImageUrls)] });
    revokeMarkdownImageUrls(previous);
    markdownButton.setAttribute("aria-pressed", "false");
    markdownButton.textContent = "미리 보기";
    markdownButton.setAttribute("aria-label", "Markdown 미리 보기");
  };
  const markdownImageFailure = (error) => {
    if (!disposed) context.tab.error(`이미지를 불러오지 못했습니다 · ${errorText(error)}`);
  };
  const completeMarkdownSyntax = async (document, isCurrent) => {
    while (!disposed && isCurrent() && view.state.doc === document) {
      if (forceParsing(view, document.length, 50)) {
        view.dispatch({ effects: markdownSyntaxChanged.of(null) });
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return false;
  };
  const refreshMarkdownImages = async () => {
    if (!markdownRendered || path === null || !view || disposed) return;
    const generation = ++markdownImageGeneration;
    const documentPath = path;
    const document = view.state.doc;
    const previous = markdownImageUrls;
    markdownImageUrls = new Map();
    view.dispatch({ effects: markdownImagesChanged.of(markdownImageUrls) });
    revokeMarkdownImageUrls(previous);
    try {
      const complete = await completeMarkdownSyntax(document, () => generation === markdownImageGeneration && markdownRendered && path === documentPath);
      if (!complete) return;
      const invalidImages = invalidMarkdownImageSources(view.state);
      if (invalidImages.length) throw new Error("unsafe or malformed Markdown image URL: " + invalidImages[0]);
      const sources = markdownImageSources(view.state);
      const next = await readMarkdownImageUrls(files, documentPath, sources);
      if (disposed || generation !== markdownImageGeneration || !markdownRendered || path !== documentPath || view.state.doc !== document) {
        revokeMarkdownImageUrls(next);
        return;
      }
      markdownImageUrls = next;
      view.dispatch({ effects: markdownImagesChanged.of(next) });
      context.tab.error(null);
    } catch (error) {
      if (!disposed && generation === markdownImageGeneration && markdownRendered && path === documentPath) markdownImageFailure(error);
    }
  };
  // The tab state last written; a change that keeps it writes nothing.
  let written = JSON.stringify(stored);
  const writeTabState = () => {
    const { anchor, head } = view.state.selection.main;
    const value = { path, selection: { anchor, head }, scroll: { top: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft } };
    const text = JSON.stringify(value);
    if (text === written) return;
    written = text;
    context.tab.state.write(value);
  };
  const modified = () => saved !== null && !view.state.doc.eq(saved);
  const describe = () => {
    const { anchor, head } = view.state.selection.main;
    fileState = { ...fileState, modified: modified(), length: view.state.doc.length, lines: view.state.doc.lines,
      selection: { anchor, head } };
  };

  // Applies a read of the file: its text becomes the document and the saved state.
  const load = (body) => {
    if (!view) throw new Error("the editor view is not ready");
    const readOnly = body.newline === "mixed";
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: body.text },
      effects: [
        separator.reconfigure(readOnly || body.newline === "none" ? [] : EditorState.lineSeparator.of(LINE_SEPARATORS[body.newline])),
        editable.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      ],
      selection: { anchor: Math.min(view.state.selection.main.anchor, body.text.length) },
    });
    saved = view.state.doc;
    diskVersion = body.version;
    fileState = { ...fileState, version: body.version, newline: body.newline, bom: body.bom, readOnly, disk: "same",
      reason: readOnly ? "줄바꿈이 섞여 있어 읽기 전용으로 엽니다" : null };
    showBanner(fileState.reason);
    describe();
    context.tab.modified(fileState.modified);
    publishFile();
    refreshFind();
  };

  async function diskChanged() {
    const body = await readAgain("watch");
    if (body.version === fileState.version) {
      emitEvent("info", "plugin.editor.disk.decision", { path, decision: "same", modified: modified() });
      return;
    }
    if (!modified()) {
      emitEvent("info", "plugin.editor.disk.decision", { path, decision: "loaded", modified: false });
      load(body);
      return;
    }
    emitEvent("info", "plugin.editor.disk.decision", { path, decision: "conflict", modified: true });
    diskVersion = body.version;
    fileState = { ...fileState, disk: "changed" };
    showBanner("디스크의 파일이 바뀌었습니다", { reload: true, overwrite: true });
    publishFile();
  }

  // Asks for the file of a blank document through core.file.place; null when the person cancelled the save panel.
  const place = async () => {
    const start = performance.now();
    let chosen;
    try {
      ({ path: chosen } = await context.runtime.command("core.file.place", { name: NEW_NAME }));
    } catch (error) {
      emitEvent("warn", "plugin.editor.place", { name: NEW_NAME, path: null, micros: microsSince(start), ok: false, error: failure(error, "-32603") });
      context.tab.error(`저장하지 못했습니다 · ${errorText(error)}`);
      throw error;
    }
    emitEvent("info", "plugin.editor.place", { name: NEW_NAME, path: chosen, micros: microsSince(start), ok: true });
    return chosen;
  };
  // Names the blank document after the file that its first save wrote: the language, the contributions of its extension
  // and the tab title follow the file, and the editor watches it.
  const named = async (chosen) => {
    path = chosen;
    language = languageOf(path);
    extension = extensionOf(path);
    file = Object.freeze({ path, extension, language });
    contributions = await loadContributions(context, file, emitEvent);
    if (markdownRendered || markdownImageUrls.size > 0) resetMarkdownPreview();
    markdownToolbar.hidden = language !== "markdown";
    markdownButton.setAttribute("aria-pressed", "false");
    markdownButton.textContent = "미리 보기";
    view.dispatch({ effects: [languageSlot.reconfigure(languageSupport(language)), contributed.reconfigure(contributions.extensions),
      label.reconfigure(EditorView.contentAttributes.of({ "aria-label": path }))] });
    fileState = { ...fileState, path, language };
    context.tab.title(name());
    writeTabState();
    await startWatch();
  };

  const save = async ({ overwrite = false } = {}) => {
    if (typeof overwrite !== "boolean") throw new TypeError("editor.save requires overwrite as true or false");
    if (fileState.readOnly) throw refused(`저장하지 못했습니다 · ${path} is open read-only: ${fileState.reason}`);
    if (path === null) return saveNew();
    const start = performance.now();
    const text = view.state.sliceDoc();
    try {
      const reply = await files.request({ operation: "write", path, text,
        expect: overwrite ? diskVersion : fileState.version, bom: fileState.bom });
      emitEvent("info", "plugin.editor.save", { path, bytes: bytesOf(text), overwrite, micros: microsSince(start), ok: true });
      saved = view.state.doc;
      diskVersion = reply.version;
      fileState = { ...fileState, version: reply.version, disk: "same" };
      describe();
      showBanner(fileState.reason);
      context.tab.modified(fileState.modified);
      context.tab.error(null);
      publishFile();
      return { version: reply.version };
    } catch (error) {
      emitEvent("warn", "plugin.editor.save", { path, bytes: bytesOf(text), overwrite, micros: microsSince(start), ok: false,
        error: failure(error, "-32603") });
      context.tab.error(`저장하지 못했습니다 · ${errorText(error)}`);
      throw error;
    }
  };

  // The first save of a blank document: the file that core.file.place answers is created; a file that exists there is
  // written over, because the save panel asked the person to replace it.
  const saveNew = async () => {
    const chosen = await place();
    if (chosen === null) return { version: null };
    const start = performance.now();
    const text = view.state.sliceDoc();
    const write = (expect) => files.request({ operation: "write", path: chosen, text, expect, bom: false });
    let reply;
    try {
      try {
        reply = await write(null);
      } catch (error) {
        if (!errorText(error).startsWith("exists")) throw error;
        reply = await write((await files.request({ operation: "readBytes", path: chosen })).version);
      }
    } catch (error) {
      emitEvent("warn", "plugin.editor.save", { path: chosen, bytes: bytesOf(text), overwrite: false, micros: microsSince(start), ok: false,
        error: failure(error, "-32603") });
      context.tab.error(`저장하지 못했습니다 · ${errorText(error)}`);
      throw error;
    }
    emitEvent("info", "plugin.editor.save", { path: chosen, bytes: bytesOf(text), overwrite: false, micros: microsSince(start), ok: true });
    saved = view.state.doc;
    diskVersion = reply.version;
    fileState = { ...fileState, version: reply.version, disk: "same" };
    describe();
    context.tab.modified(fileState.modified);
    context.tab.error(null);
    await named(chosen);
    publishFile();
    return { version: reply.version };
  };

  const reload = async () => {
    if (path === null) throw new Error("a blank document has no file to read");
    let body;
    try {
      body = await readAgain("reload");
    } catch (error) {
      context.tab.error(`다시 읽지 못했습니다 · ${errorText(error)}`);
      throw error;
    }
    const previousDocument = view.state.doc;
    load(body);
    context.tab.error(null);
    if (markdownRendered && view.state.doc === previousDocument) await refreshMarkdownImages();
    return { version: body.version };
  };

  // Find: the query of the bar, its matches and the current match.
  let query = createQuery(find);
  let matches = [];
  function refreshFind() {
    matches = find.open ? findMatches(view.state, query) : [];
    const head = view.state.selection.main;
    const current = matches.findIndex((match) => match.from === head.from && match.to === head.to);
    find = { ...find, matches: matches.length, current: current < 0 ? null : current };
    view.dispatch({ effects: setFound.of(Decoration.set(matches.map((match, index) =>
      (index === current ? currentMark : foundMark).range(match.from, match.to)))) });
    count.textContent = find.error !== null ? `잘못된 정규식 · ${find.error}` : find.query === "" ? ""
      : find.current === null ? `${find.matches}개` : `${find.current + 1}/${find.matches}`;
    publishFind();
  }
  // An invalid regular expression is a state of the query that the person is typing: the bar shows it, and the query
  // has no matches until it is valid.
  const setQuery = (fields) => {
    const next = { ...find, ...fields };
    try {
      query = createQuery(next);
      find = { ...next, error: null };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      query = createQuery({ ...next, query: "" });
      find = { ...next, error: errorText(error) };
      emitEvent("warn", "plugin.editor.find.invalid", { error: find.error });
    }
    queryInput.value = find.query;
    replacementInput.value = find.replacement;
    caseButton.setAttribute("aria-pressed", String(find.caseSensitive));
    regexpButton.setAttribute("aria-pressed", String(find.regexp));
    refreshFind();
    return { matches: find.matches };
  };
  const select = (index) => {
    const match = matches[index];
    view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
    refreshFind();
    return { current: find.current };
  };
  const step = (direction) => {
    if (!matches.length) return { current: null };
    const at = direction > 0 ? view.state.selection.main.to : view.state.selection.main.from;
    const index = direction > 0
      ? matches.findIndex((match) => match.from >= at)
      : matches.findLastIndex((match) => match.to <= at);
    return select(index >= 0 ? index : direction > 0 ? 0 : matches.length - 1);
  };
  const openFind = ({ replace = false } = {}) => {
    if (typeof replace !== "boolean") throw new TypeError("editor.find.open requires replace as true or false");
    const selected = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    bar.hidden = false;
    replaceForm.hidden = !replace;
    find = { ...find, open: true, replace };
    if (selected !== "" && !selected.includes("\n")) setQuery({ query: selected });
    else refreshFind();
    queryInput.focus();
    queryInput.select();
    return null;
  };
  const closeFind = () => {
    bar.hidden = true;
    find = { ...find, open: false, replace: false };
    refreshFind();
    view.focus();
    return null;
  };
  const replaceCurrent = () => {
    if (find.current === null) {
      step(1);
      return { matches: find.matches };
    }
    const match = matches[find.current];
    view.dispatch({ changes: { from: match.from, to: match.to, insert: replacementOf(query, match) }, userEvent: "input.replace" });
    refreshFind();
    step(1);
    return { matches: find.matches };
  };
  const replaceAll = () => {
    const replaced = matches.length;
    if (replaced) {
      view.dispatch({ changes: matches.map((match) => ({ from: match.from, to: match.to, insert: replacementOf(query, match) })),
        userEvent: "input.replace.all" });
    }
    refreshFind();
    return { replaced };
  };

  const format = async () => {
    const formatter = contributions.formatters.find((item) => item.applies);
    if (!formatter) throw refused(`서식을 맞추지 못했습니다 · no formatter is connected for ${extension === "" ? "files without an extension" : `.${extension}`}`);
    const text = view.state.sliceDoc();
    const start = performance.now();
    const failed = (error) => {
      emitEvent("warn", "plugin.editor.format", { path, formatter: formatter.plugin, changed: false, micros: microsSince(start), ok: false,
        error: failure(error, "-32603") });
      context.tab.error(`서식을 맞추지 못했습니다 · ${errorText(error)}`);
      return error;
    };
    let result;
    // The formatter runs while the document may be clean, so the tab stays loaded until its result is applied.
    context.tab.keep("busy", true);
    try {
      result = await formatter.format(text, file);
    } catch (error) {
      throw failed(error);
    } finally {
      context.tab.keep("busy", false);
    }
    if (typeof result !== "string") throw failed(new Error(`${formatter.plugin} formatter returned ${typeof result}, not text`));
    context.tab.error(null);
    emitEvent("info", "plugin.editor.format", { path, formatter: formatter.plugin, changed: result !== text, micros: microsSince(start), ok: true });
    if (result === text) return { changed: false };
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result }, userEvent: "input.format" });
    return { changed: true };
  };

  const toggleMarkdown = async () => {
    if (language !== "markdown") throw new Error("Markdown rendering is available only for Markdown files");
    if (markdownRendered) {
      resetMarkdownPreview();
      return { rendered: false };
    }
    const generation = ++markdownImageGeneration;
    const documentPath = path;
    const document = view.state.doc;
    let urls;
    try {
      const complete = await completeMarkdownSyntax(document, () => generation === markdownImageGeneration && !disposed && path === documentPath);
      if (!complete) return { rendered: markdownRendered };
      const invalidImages = invalidMarkdownImageSources(view.state);
      if (invalidImages.length) throw new Error("unsafe or malformed Markdown image URL: " + invalidImages[0]);
      urls = await readMarkdownImageUrls(files, documentPath, markdownImageSources(view.state));
    } catch (error) {
      if (!disposed && generation === markdownImageGeneration) markdownImageFailure(error);
      else emitEvent("warn", "plugin.editor.markdown.image", { path: documentPath, reason: disposed ? "disposed" : "superseded",
        error: failure(error, "-32603") });
      throw error;
    }
    if (disposed || generation !== markdownImageGeneration || path !== documentPath || view.state.doc !== document) {
      revokeMarkdownImageUrls(urls);
      return { rendered: markdownRendered };
    }
    markdownImageUrls = urls;
    markdownRendered = true;
    view.dispatch({ effects: [markdownImagesChanged.of(urls), markdownRenderedEffect.of(true)] });
    context.tab.error(null);
    markdownButton.setAttribute("aria-pressed", "true");
    markdownButton.textContent = "편집";
    markdownButton.setAttribute("aria-label", "Markdown 편집 보기");
    return { rendered: true };
  };

  const edit = ({ changes } = {}) => {
    if (!Array.isArray(changes) || changes.some((change) => !Number.isInteger(change?.from) || !Number.isInteger(change?.to)
      || typeof change.insert !== "string")) {
      throw new TypeError("editor.edit requires changes as a list of {from, to, insert}");
    }
    if (fileState.readOnly) throw new Error(`${path} is open read-only: ${fileState.reason}`);
    view.dispatch({ changes, userEvent: "input" });
    return { length: view.state.doc.length };
  };
  const readText = ({ from = 0, to = view.state.doc.length } = {}) => {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > view.state.doc.length || from > to) {
      throw new RangeError(`editor.read requires 0 <= from <= to <= ${view.state.doc.length}`);
    }
    return view.state.sliceDoc(from, to);
  };
  const selectRange = ({ anchor, head = anchor } = {}) => {
    const length = view.state.doc.length;
    if (!Number.isInteger(anchor) || !Number.isInteger(head) || anchor < 0 || head < 0 || anchor > length || head > length) {
      throw new RangeError(`editor.select requires anchor and head from 0 to ${length}`);
    }
    view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
    return null;
  };

  const updateEditorState = (update) => {
    if (!update.docChanged && !update.selectionSet) return;
    const before = fileState.modified;
    describe();
    if (fileState.modified !== before) context.tab.modified(fileState.modified);
    if (update.docChanged && find.open) refreshFind();
    if (update.docChanged && markdownRendered) queueMicrotask(() => { void refreshMarkdownImages(); });
    publishFile();
    writeTabState();
  };
  const createEditorState = (doc, { onUpdate = updateEditorState,
    contentAttributes = { "data-expose": "editor.content" } } = {}) => EditorState.create({
    doc,
    extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(),
      indentOnInput(), bracketMatching(), highlightActiveLine(), syntaxHighlighting(classHighlighter), todoMarks, found,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      languageSlot.of(languageSupport(fileState.language)), contributed.of(contributions.extensions), markdownView,
      editable.of(fileState.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      separator.of(fileState.readOnly || fileState.newline === "none" || fileState.newline === null
        ? [] : EditorState.lineSeparator.of(LINE_SEPARATORS[fileState.newline])),
      frameTheme, scheme.of(EditorView.darkTheme.of(frame.dataset.scheme !== "light")),
      EditorView.contentAttributes.of(contentAttributes),
      label.of(EditorView.contentAttributes.of({ "aria-label": name() })),
      EditorView.updateListener.of(onUpdate),
    ],
  });

  view = new EditorView({
    parent: host,
    root,
    state: createEditorState(""),
  });
  const content = view.contentDOM;
  view.scrollDOM.addEventListener("scroll", writeTabState);

  // The scheme of the application theme selects the token colors; the frame takes the other colors from the theme tokens.
  frame.dataset.scheme = "dark";
  const subscription = context.runtime.theme((value) => {
    if (value?.scheme !== "dark" && value?.scheme !== "light") throw new Error("the theme must have scheme dark or light");
    frame.dataset.scheme = value.scheme;
    view.dispatch({ effects: scheme.reconfigure(EditorView.darkTheme.of(value.scheme === "dark")) });
  });
  await subscription.ready;

  const expose = context.exposure;
  // Every declared command stores its result with its time, and a failure still reaches the caller.
  const recorded = (name, run) => (params) => {
    const start = performance.now();
    const done = (error) => emitEvent(error === undefined ? "debug" : "warn", "plugin.editor.command", { name, micros: microsSince(start),
      ok: error === undefined, ...(error === undefined ? {} : { error: failure(error, "-32000") }) });
    let result;
    try {
      result = run(params);
    } catch (error) {
      done(error);
      throw error;
    }
    if (!(result instanceof Promise)) {
      done();
      return result;
    }
    return result.then((value) => { done(); return value; }, (error) => { done(error); throw error; });
  };
  expose.status("editor.document", () => fileState, (fn) => { fileListeners.add(fn); fn(fileState); return () => fileListeners.delete(fn); });
  expose.status("editor.find", () => find, (fn) => { findListeners.add(fn); fn(find); return () => findListeners.delete(fn); });
  expose.command("editor.save", recorded("editor.save", save));
  expose.command("editor.reload", recorded("editor.reload", reload));
  expose.command("editor.focus", recorded("editor.focus", () => { view.focus(); return null; }));
  expose.command("editor.edit", recorded("editor.edit", edit));
  expose.command("editor.read", recorded("editor.read", readText));
  expose.command("editor.select", recorded("editor.select", selectRange));
  expose.command("editor.format", recorded("editor.format", format));
  expose.command("editor.markdown.toggle", recorded("editor.markdown.toggle", toggleMarkdown));
  expose.command("editor.find", recorded("editor.find", (fields = {}) => setQuery(fields)));
  expose.command("editor.find.open", recorded("editor.find.open", openFind));
  expose.command("editor.find.close", recorded("editor.find.close", closeFind));
  expose.command("editor.find.next", recorded("editor.find.next", () => step(1)));
  expose.command("editor.find.previous", recorded("editor.find.previous", () => step(-1)));
  expose.command("editor.replace", recorded("editor.replace", replaceCurrent));
  expose.command("editor.replace.all", recorded("editor.replace.all", replaceAll));
  let disposeDiagnostics = null;
  if (context.diagnostics != null) {
    if (typeof context.diagnostics.attach !== "function") throw new TypeError("the editor diagnostics declaration has no attach function");
    disposeDiagnostics = await context.diagnostics.attach({ expose, root, document: root.ownerDocument, runtime: context.runtime, EditorView,
      createState: () => createEditorState(view.state.doc.toString(), { onUpdate: () => {}, contentAttributes: {} }),
      readHistoryEntries: () => root.ownerDocument.defaultView.history.length });
    if (typeof disposeDiagnostics !== "function") throw new TypeError("the editor diagnostics attach function must return its disposer");
  }
  for (const element of root.querySelectorAll("[data-expose]")) {
    if (element !== content) expose.dom(element.dataset.expose, element);
  }
  expose.dom("editor.content", content);
  await expose.delegate(frame);
  await expose.bind(content, "editor.focus", {}, { event: "focus" });
  await expose.bind(frame, "editor.find.open", (event) => ({ replace: event.altKey }), {
    event: "keydown", when: (event) => onShortcut("f")(event) || onShortcut("f", { alt: true })(event) });
  // save, reload and format show their failures as the tab error, so a control that runs them does not report them again.
  const shown = () => {};
  await expose.bind(markdownButton, "editor.markdown.toggle", {}, { failed: shown });
  await expose.bind(host, "editor.save", {}, { event: "keydown", when: onShortcut("s"), failed: shown });
  await expose.bind(view.scrollDOM, "editor.format", {}, { event: "keydown", when: onShortcut("f", { alt: true, shift: true }), failed: shown });
  await expose.bind(banner.querySelector('[data-expose="editor.reload"]'), "editor.reload", {}, { failed: shown });
  await expose.bind(banner.querySelector('[data-expose="editor.overwrite"]'), "editor.save", { overwrite: true }, { failed: shown });
  await expose.bind(bar, "editor.find.close", {}, { event: "keydown", when: (event) => event.key === "Escape" });
  await expose.bind(findForm, "editor.find.next", {}, { event: "submit", when: (event) => { event.preventDefault(); return true; } });
  await expose.bind(replaceForm, "editor.replace", {}, { event: "submit", when: (event) => { event.preventDefault(); return true; } });
  await expose.bind(queryInput, "editor.find", () => ({ ...fields(), query: queryInput.value }), { event: "input" });
  await expose.bind(replacementInput, "editor.find", () => ({ ...fields(), replacement: replacementInput.value }), { event: "input" });
  await expose.bind(caseButton, "editor.find", () => ({ ...fields(), caseSensitive: !find.caseSensitive }));
  await expose.bind(regexpButton, "editor.find", () => ({ ...fields(), regexp: !find.regexp }));
  function fields() {
    return { query: find.query, replacement: find.replacement, caseSensitive: find.caseSensitive, regexp: find.regexp };
  }

  async function startWatch() {
    const watchStart = performance.now();
    try {
      await watch();
    } catch (error) {
      emitEvent("warn", "plugin.editor.watch.start", { path, micros: microsSince(watchStart), ok: false, error: failure(error, "-32603") });
      throw error;
    }
    emitEvent("info", "plugin.editor.watch.start", { path, micros: microsSince(watchStart), ok: true });
  }

  if (path === null) {
    saved = view.state.doc;
    describe();
    context.tab.modified(fileState.modified);
    publishFile();
    emitEvent("info", "plugin.editor.new", { name: NEW_NAME });
  } else {
    const openStart = performance.now();
    let opened;
    try {
      opened = await read();
    } catch (error) {
      emitEvent("warn", "plugin.editor.open", { path, bytes: 0, lines: 0, newline: null, read_only: false, micros: microsSince(openStart),
        ok: false, error: failure(error, "-32603") });
      throw error;
    }
    load(opened);
    emitEvent("info", "plugin.editor.open", { path, bytes: bytesOf(opened.text), lines: view.state.doc.lines, newline: opened.newline,
      read_only: fileState.readOnly, micros: microsSince(openStart), ok: true });
    await startWatch();
  }
  if (stored !== null) {
    // The stored cursor applies to the current text of the file, so a position past its end moves to the end.
    const end = view.state.doc.length;
    view.dispatch({ selection: { anchor: Math.min(stored.selection.anchor, end), head: Math.min(stored.selection.head, end) } });
    view.scrollDOM.scrollTop = stored.scroll.top;
    view.scrollDOM.scrollLeft = stored.scroll.left;
  }
  return {
    focus: () => view.focus(),
    async dispose() {
      disposed = true;
      markdownImageGeneration += 1;
      revokeMarkdownImageUrls(markdownImageUrls);
      markdownImageUrls = new Map();
      view.scrollDOM.removeEventListener("scroll", writeTabState);
      await disposeDiagnostics?.();
      (await subscription.dispose)();
      fileListeners.clear();
      findListeners.clear();
      emitEvent("info", "plugin.editor.close", { path, pending: files.pending() });
      files.dispose();
      view.destroy();
      await expose.dispose();
      root.replaceChildren();
    },
  };
}

/** Refuses a tab state that is not {path, selection: {anchor, head}, scroll: {top, left}}, naming the tab and the value. */
function checkTabState(value, tab) {
  const position = (n) => Number.isInteger(n) && n >= 0;
  const offset = (n) => Number.isFinite(n) && n >= 0;
  const valid = value !== null && typeof value === "object" && (value.path === null || (typeof value.path === "string" && value.path !== ""))
    && position(value.selection?.anchor) && position(value.selection?.head) && offset(value.scroll?.top) && offset(value.scroll?.left);
  if (!valid) throw new Error(`the tab state of editor tab ${tab} is not {path, selection, scroll}: ${JSON.stringify(value)}`);
}

/**
 * The connected contributions of this editor's extension points for file. An item whose module fails to load, lacks
 * its export or fails to build is reported invalid through fail(reason) and left out.
 */
async function loadContributions(context, file, emitEvent) {
  const applies = (item) => item.extensions === undefined || item.extensions.includes(file.extension);
  const extensions = [];
  for (const { plugin, item, module, fail } of await context.contributions("extension")) {
    if (!applies(item)) continue;
    try {
      const exported = await import(module);
      if (typeof exported.extension !== "function") throw new Error("the module does not export extension(file)");
      extensions.push(exported.extension(file));
    } catch (error) {
      emitEvent("warn", "plugin.editor.contribution.failed", { point: "extension", plugin, error: errorText(error) });
      fail(`${plugin}: ${errorText(error)}`);
    }
  }
  const formatters = [];
  for (const { plugin, item, module, fail } of await context.contributions("formatter")) {
    try {
      const exported = await import(module);
      if (typeof exported.format !== "function") throw new Error("the module does not export format(text, file)");
      formatters.push({ plugin, applies: applies(item), format: exported.format });
    } catch (error) {
      emitEvent("warn", "plugin.editor.contribution.failed", { point: "formatter", plugin, error: errorText(error) });
      fail(`${plugin}: ${errorText(error)}`);
    }
  }
  return { extensions, formatters };
}
