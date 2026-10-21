import { syntaxTree } from "@soksak/shared/editor.extension/@codemirror/language.js";
import { Decoration, EditorView, WidgetType } from "@soksak/shared/editor.extension/@codemirror/view.js";
import { StateEffect, StateField } from "@soksak/shared/editor.extension/@codemirror/state.js";

/** Enables or disables the rendered Markdown view without changing the document. */
export const markdownRendered = StateEffect.define();

class Marker extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(other) { return other.text === this.text; }
  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-md-list-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = this.text;
    return marker;
  }
}

class Image extends WidgetType {
  constructor(src, alt) { super(); this.src = src; this.alt = alt; }
  eq(other) { return other.src === this.src && other.alt === this.alt; }
  toDOM() {
    const image = document.createElement("img");
    image.className = "cm-md-image";
    image.setAttribute("src", this.src);
    image.setAttribute("alt", this.alt);
    image.setAttribute("referrerpolicy", "no-referrer");
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
    return image;
  }
}

const hidden = Decoration.replace({});
const markdownMark = (name) => Decoration.mark({ class: name });
const headingNames = new Map([["ATXHeading1", 1], ["ATXHeading2", 2], ["ATXHeading3", 3], ["ATXHeading4", 4], ["ATXHeading5", 5], ["ATXHeading6", 6], ["SetextHeading1", 1], ["SetextHeading2", 2]]);

function safeImageSource(source) {
  if (!source || source.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^https?:\/\//i.test(source)) return null;
  return source;
}

function imageData(state, node) {
  let altEnd = node.from;
  let altStart = node.to;
  let source = null;
  for (let child = node.node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LinkMark") {
      if (altEnd === node.from) altEnd = child.to;
      else if (altStart === node.to) altStart = child.from;
    } else if (child.name === "URL") source = state.sliceDoc(child.from, child.to);
  }
  return { source: safeImageSource(source), alt: altStart >= altEnd ? state.sliceDoc(altEnd, altStart) : "" };
}

function renderedDecorations(state) {
  const ranges = [];
  const addMark = (from, to, cls) => { if (to > from) ranges.push(markdownMark(cls).range(from, to)); };
  const addHidden = (from, to) => { if (to > from) ranges.push(hidden.range(from, to)); };
  const tree = syntaxTree(state);
  tree.iterate({ enter(node) {
    const heading = headingNames.get(node.name);
    if (heading) addMark(node.from, node.to, "cm-md-heading cm-md-heading-" + heading);
    if (node.name === "StrongEmphasis") addMark(node.from, node.to, "cm-md-strong");
    if (node.name === "Emphasis") addMark(node.from, node.to, "cm-md-emphasis");
    if (node.name === "Link") addMark(node.from, node.to, "cm-md-link");
    if (node.name === "BulletList" || node.name === "OrderedList") addMark(node.from, node.to, "cm-md-list");
    if (node.name === "ListMark") {
      const raw = state.sliceDoc(node.from, node.to);
      const marker = /^\d/.test(raw) ? raw : "•";
      const line = state.doc.lineAt(node.to);
      const spaces = state.sliceDoc(node.to, line.to).match(/^[ \t]+/)?.[0].length ?? 0;
      ranges.push(Decoration.replace({ widget: new Marker(marker), inclusive: false }).range(node.from, node.to + spaces));
    }
    if (node.name === "InlineCode") addMark(node.from, node.to, "cm-md-inline-code");
    if (node.name === "FencedCode") addMark(node.from, node.to, "cm-md-fenced-code");
    if (node.name === "CodeText") addMark(node.from, node.to, "cm-md-code-text");
    if (node.name === "HeaderMark") {
      const line = state.doc.lineAt(node.to);
      const spaces = state.sliceDoc(node.to, line.to).match(/^[ \t]+/)?.[0].length ?? 0;
      addHidden(node.from, node.to + spaces);
    }
    if (node.name === "EmphasisMark" || node.name === "CodeMark" || node.name === "CodeInfo") addHidden(node.from, node.to);
    if (node.name === "LinkMark" || node.name === "URL") addHidden(node.from, node.to);
    if (node.name === "Image") {
      const data = imageData(state, node);
      if (data.source !== null) ranges.push(Decoration.replace({ widget: new Image(data.source, data.alt), inclusive: false }).range(node.from, node.to));
      else addMark(node.from, node.to, "cm-md-image-source");
      return false;
    }
    return undefined;
  } });
  return Decoration.set(ranges, true);
}

const markdownField = StateField.define({
  create: () => ({ rendered: false, decorations: Decoration.none }),
  update(value, transaction) {
    let rendered = value.rendered;
    for (const effect of transaction.effects) if (effect.is(markdownRendered)) rendered = effect.value;
    if (!rendered) return rendered === value.rendered ? value : { rendered, decorations: Decoration.none };
    if (!value.rendered || transaction.docChanged) return { rendered, decorations: renderedDecorations(transaction.state) };
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export const markdownView = markdownField;
