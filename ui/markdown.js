import { syntaxTree } from "@soksak/shared/editor.extension/@codemirror/language.js";
import { Decoration, EditorView, WidgetType } from "@soksak/shared/editor.extension/@codemirror/view.js";
import { StateEffect, StateField } from "@soksak/shared/editor.extension/@codemirror/state.js";

/** Enables or disables the rendered Markdown view without changing the document. */
export const markdownRendered = StateEffect.define();
export const markdownImagesChanged = StateEffect.define();
export const markdownSyntaxChanged = StateEffect.define();

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

export function safeImageSource(source) {
  if (typeof source !== "string" || source === "" || source.startsWith("//") || /[\u0000-\u001f\u007f-\u009f]/.test(source)) return null;
  const colon = source.indexOf(":");
  if (colon >= 0) {
    const prefix = source.slice(0, colon);
    const normalized = prefix.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, "");
    if (/^[a-z][a-z0-9+.-]*$/i.test(normalized)) {
      if (prefix !== normalized || !/^(https?)$/i.test(normalized) || !/^https?:\/\//i.test(source)) return null;
      try {
        const url = new URL(source);
        if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
        return { kind: "remote", source: url.href };
      } catch { return null; }
    }
  }
  return { kind: "relative", source };
}

/** Resolves an image path relative to a project Markdown file, rejecting absolute and root-escaping paths. */
export function projectImagePath(markdownPath, source) {
  const rawPath = source.split(/[?#]/, 1)[0];
  if (!rawPath || rawPath.startsWith("/") || rawPath.startsWith("\\") || rawPath.includes("\\")) {
    throw new Error(`image path is not project-relative: ${source}`);
  }
  const stack = markdownPath.split("/").slice(0, -1);
  if (!markdownPath || markdownPath.startsWith("/") || stack.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Markdown path is not project-relative: ${markdownPath}`);
  }
  for (const part of rawPath.split("/")) {
    if (part === "" || part === ".") continue;
    let decoded;
    try { decoded = decodeURIComponent(part); } catch { throw new Error(`image path is not valid URI encoding: ${source}`); }
    if (decoded === "..") {
      if (stack.length === 0) throw new Error(`image path leaves the project root: ${source}`);
      stack.pop();
    } else {
      if (!decoded || decoded.includes("/") || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded) || decoded === ".") {
        throw new Error(`image path has an invalid component: ${source}`);
      }
      stack.push(decoded);
    }
  }
  if (stack.length === 0) throw new Error(`image path does not name a file: ${source}`);
  return stack.join("/");
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
  return { source: safeImageSource(source), rawSource: source, alt: altStart >= altEnd ? state.sliceDoc(altEnd, altStart) : "" };
}

/** Unsafe or malformed image references in the current Markdown syntax tree. */
export function invalidMarkdownImageSources(state) {
  const invalid = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== "Image") return undefined;
    const data = imageData(state, node);
    if (data.source === null) invalid.push(data.rawSource ?? state.sliceDoc(node.from, node.to));
    return false;
  } });
  return invalid;
}

/** The unique project-relative image sources in the current Markdown syntax tree. */
export function markdownImageSources(state) {
  const sources = new Set();
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== "Image") return undefined;
    const source = imageData(state, node).source;
    if (source?.kind === "relative") sources.add(source.source);
    return false;
  } });
  return [...sources];
}

function renderedDecorations(state, imageUrls) {
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
      const source = data.source?.kind === "remote" ? data.source.source : imageUrls.get(data.source?.source);
      if (source !== undefined && source !== null) ranges.push(Decoration.replace({ widget: new Image(source, data.alt), inclusive: false }).range(node.from, node.to));
      else addMark(node.from, node.to, "cm-md-image-source");
      return false;
    }
    return undefined;
  } });
  return Decoration.set(ranges, true);
}

const markdownField = StateField.define({
  create: () => ({ rendered: false, imageUrls: new Map(), decorations: Decoration.none }),
  update(value, transaction) {
    let rendered = value.rendered;
    let imageUrls = value.imageUrls;
    let imagesChanged = false;
    let syntaxChanged = false;
    for (const effect of transaction.effects) {
      if (effect.is(markdownRendered)) rendered = effect.value;
      if (effect.is(markdownImagesChanged)) { imageUrls = effect.value; imagesChanged = true; }
      if (effect.is(markdownSyntaxChanged)) syntaxChanged = true;
    }
    if (!rendered) return rendered === value.rendered && !imagesChanged ? value : { rendered, imageUrls, decorations: Decoration.none };
    if (!value.rendered || transaction.docChanged || imagesChanged || syntaxChanged) return { rendered, imageUrls, decorations: renderedDecorations(transaction.state, imageUrls) };
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export const markdownView = markdownField;
