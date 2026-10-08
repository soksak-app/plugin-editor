// The editor surface: opens the file tab.params.path of the project through the files sidecar in CodeMirror, saves it
// in place, and follows changes on disk. The contributions to editor.extension add CodeMirror extensions and the
// contributions to editor.formatter format the text (docs/features.md).
import { Compartment, EditorState, StateEffect, StateField } from "@soksak/shared/editor.extension/@codemirror/state.js";
import {
  Decoration, EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap,
  lineNumbers,
} from "@soksak/shared/editor.extension/@codemirror/view.js";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@soksak/shared/editor.extension/@codemirror/language.js";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@soksak/shared/editor.extension/@codemirror/commands.js";
import { classHighlighter } from "@soksak/shared/editor.extension/@lezer/highlight.js";
import { createQuery, findMatches, replacementOf } from "./find.js";
import { extensionOf, languageOf, languageSupport } from "./languages.js";
import { connect } from "./requests.js";
import { todoMarks } from "./todo.js";

const css = `:host{display:block;height:100%}
#frame{display:flex;height:100%;flex-direction:column;background:var(--card);color:var(--fg);font:var(--text-control)/1.4 var(--ui-font)}
#banner{display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid var(--rule);color:var(--fg)}
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
<div id="find" data-expose="editor.find.bar" hidden>
<form id="find-form" data-expose="editor.find.form"><input id="query" data-expose="editor.find.query" aria-label="찾기" placeholder="찾기"><button type="button" id="case" data-expose="editor.find.case" aria-label="대소문자 구분" aria-pressed="false">Aa</button><button type="button" id="regexp" data-expose="editor.find.regexp" aria-label="정규식" aria-pressed="false">.*</button><output id="count"></output><button type="button" data-command="editor.find.previous" data-expose="editor.find.previous" aria-label="이전">↑</button><button type="button" data-command="editor.find.next" data-expose="editor.find.next" aria-label="다음">↓</button><button type="button" data-command="editor.find.close" data-expose="editor.find.close" aria-label="닫기">×</button></form>
<form id="replace-form" data-expose="editor.replace.form" hidden><input id="replacement" data-expose="editor.find.replacement" aria-label="바꿀 글" placeholder="바꿀 글"><button type="button" data-command="editor.replace" data-expose="editor.replace">바꾸기</button><button type="button" data-command="editor.replace.all" data-expose="editor.replace.all">모두 바꾸기</button></form>
</div>
<div id="view" data-expose="editor.view"></div></div>`;

const LINE_SEPARATORS = { lf: "\n", crlf: "\r\n", cr: "\r" };

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
  // default: a tab without params cannot name a file; core.file.open always passes {path}.
  const path = context.tab.params?.path;
  if (typeof path !== "string" || path === "") throw new Error("the editor tab requires params.path");
  if (context.project === null) throw new Error("this window shows no project");
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
  const language = languageOf(path);
  const extension = extensionOf(path);
  const file = Object.freeze({ path, extension, language });
  context.tab.title(path.slice(path.lastIndexOf("/") + 1));

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
      diskChanged().catch((error) => context.tab.error(`다시 읽지 못했습니다 · ${error.message}`));
      return;
    }
    context.tab.error(`파일 감시가 멈췄습니다 · ${body.error}`);
  });
  const read = () => files.request({ operation: "read", path });
  const watch = () => files.request({ operation: "watch", paths: [path] });

  const contributions = await loadContributions(context, file);
  const languageSlot = new Compartment();
  const contributed = new Compartment();
  const editable = new Compartment();
  const separator = new Compartment();
  const scheme = new Compartment();

  let view = null;
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
    const body = await read();
    if (body.version === fileState.version) return;
    if (!modified()) {
      load(body);
      return;
    }
    diskVersion = body.version;
    fileState = { ...fileState, disk: "changed" };
    showBanner("디스크의 파일이 바뀌었습니다", { reload: true, overwrite: true });
    publishFile();
  }

  const save = async ({ overwrite = false } = {}) => {
    if (typeof overwrite !== "boolean") throw new TypeError("editor.save requires overwrite as true or false");
    if (fileState.readOnly) throw new Error(`${path} is open read-only: ${fileState.reason}`);
    try {
      const reply = await files.request({ operation: "write", path, text: view.state.sliceDoc(),
        expect: overwrite ? diskVersion : fileState.version, bom: fileState.bom });
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
      context.tab.error(`저장하지 못했습니다 · ${error.message}`);
      throw error;
    }
  };

  const reload = async () => {
    let body;
    try {
      body = await read();
    } catch (error) {
      context.tab.error(`다시 읽지 못했습니다 · ${error.message}`);
      throw error;
    }
    load(body);
    context.tab.error(null);
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
    count.textContent = find.error !== null ? "잘못된 정규식" : find.query === "" ? ""
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
      find = { ...next, error: error.message };
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
    if (!formatter) throw new Error(`no formatter is connected for ${extension === "" ? "files without an extension" : `.${extension}`}`);
    const text = view.state.sliceDoc();
    let result;
    try {
      result = await formatter.format(text, file);
    } catch (error) {
      context.tab.error(`서식을 맞추지 못했습니다 · ${formatter.plugin}: ${error.message}`);
      throw error;
    }
    if (typeof result !== "string") {
      const error = new Error(`${formatter.plugin} formatter returned ${typeof result}, not text`);
      context.tab.error(`서식을 맞추지 못했습니다 · ${error.message}`);
      throw error;
    }
    context.tab.error(null);
    if (result === text) return { changed: false };
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: result }, userEvent: "input.format" });
    return { changed: true };
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

  view = new EditorView({
    parent: host,
    root,
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), drawSelection(),
        indentOnInput(), bracketMatching(), highlightActiveLine(), syntaxHighlighting(classHighlighter), todoMarks, found,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        languageSlot.of(languageSupport(language)), contributed.of(contributions.extensions),
        editable.of([]), separator.of([]), frameTheme, scheme.of(EditorView.darkTheme.of(true)),
        EditorView.contentAttributes.of({ "data-expose": "editor.content", "aria-label": path }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.selectionSet) return;
          const before = fileState.modified;
          describe();
          if (fileState.modified !== before) context.tab.modified(fileState.modified);
          if (update.docChanged && find.open) refreshFind();
          publishFile();
        }),
      ],
    }),
  });
  const content = view.contentDOM;

  // The scheme of the application theme selects the token colors; the frame takes the other colors from the theme tokens.
  frame.dataset.scheme = "dark";
  // default: a runtime without a native host has no theme listener, and the editor keeps the dark token colors.
  const subscription = typeof context.runtime.theme === "function"
    ? context.runtime.theme((value) => {
      if (value?.scheme !== "dark" && value?.scheme !== "light") throw new Error("the theme must have scheme dark or light");
      frame.dataset.scheme = value.scheme;
      view.dispatch({ effects: scheme.reconfigure(EditorView.darkTheme.of(value.scheme === "dark")) });
    })
    : null;
  if (subscription) await subscription.ready;

  const expose = context.exposure;
  expose.status("editor.document", () => fileState, (fn) => { fileListeners.add(fn); fn(fileState); return () => fileListeners.delete(fn); });
  expose.status("editor.find", () => find, (fn) => { findListeners.add(fn); fn(find); return () => findListeners.delete(fn); });
  expose.command("editor.save", save);
  expose.command("editor.reload", reload);
  expose.command("editor.focus", () => { view.focus(); return null; });
  expose.command("editor.edit", edit);
  expose.command("editor.read", readText);
  expose.command("editor.select", selectRange);
  expose.command("editor.format", format);
  expose.command("editor.find", (fields = {}) => setQuery(fields));
  expose.command("editor.find.open", openFind);
  expose.command("editor.find.close", closeFind);
  expose.command("editor.find.next", () => step(1));
  expose.command("editor.find.previous", () => step(-1));
  expose.command("editor.replace", replaceCurrent);
  expose.command("editor.replace.all", replaceAll);
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

  load(await read());
  await watch();
  context.status.report("ready");
  return {
    focus: () => view.focus(),
    async dispose() {
      if (subscription) (await subscription.dispose)();
      fileListeners.clear();
      findListeners.clear();
      files.dispose();
      view.destroy();
      await expose.dispose();
      root.replaceChildren();
    },
  };
}

/**
 * The connected contributions of this editor's extension points for file. An item whose module fails to load, lacks
 * its export or fails to build is reported invalid through fail(reason) and left out.
 */
async function loadContributions(context, file) {
  const applies = (item) => item.extensions === undefined || item.extensions.includes(file.extension);
  const extensions = [];
  for (const { plugin, item, module, fail } of context.contributions("extension")) {
    if (!applies(item)) continue;
    try {
      const exported = await import(module);
      if (typeof exported.extension !== "function") throw new Error("the module does not export extension(file)");
      extensions.push(exported.extension(file));
    } catch (error) {
      fail(`${plugin}: ${error.message}`);
    }
  }
  const formatters = [];
  for (const { plugin, item, module, fail } of context.contributions("formatter")) {
    try {
      const exported = await import(module);
      if (typeof exported.format !== "function") throw new Error("the module does not export format(text, file)");
      formatters.push({ plugin, applies: applies(item), format: exported.format });
    } catch (error) {
      fail(`${plugin}: ${error.message}`);
    }
  }
  return { extensions, formatters };
}
