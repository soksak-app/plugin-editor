// The language of a file from its name extension, and the CodeMirror support of each language.
import { css, go, html, javascript, json, markdown, python, rust, shell, StreamLanguage } from "./vendor/libraries.js";

/** The language of each lowercase file name extension. */
const LANGUAGES = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "jsx",
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  json: "json", css: "css", html: "html", htm: "html", svelte: "html", vue: "html",
  md: "markdown", markdown: "markdown", py: "python", rs: "rust", go: "go",
  sh: "shell", bash: "shell", zsh: "shell",
};

const SUPPORT = {
  javascript: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  json: () => json(),
  css: () => css(),
  html: () => html(),
  markdown: () => markdown(),
  python: () => python(),
  rust: () => rust(),
  go: () => go(),
  shell: () => StreamLanguage.define(shell),
};

/** The lowercase name extension of the last segment of path without the dot, or "" for a name without one. */
export function extensionOf(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The language of the file path, or null for a file that the editor shows as plain text. */
export function languageOf(path) {
  return Object.hasOwn(LANGUAGES, extensionOf(path)) ? LANGUAGES[extensionOf(path)] : null;
}

/** The CodeMirror extension that highlights and indents language, or an empty extension for null. */
export function languageSupport(language) {
  if (language === null) return [];
  if (!Object.hasOwn(SUPPORT, language)) throw new Error(`unknown language ${language}`);
  return SUPPORT[language]();
}
