// A jsdom document as the global document of a test, with the browser functions that CodeMirror calls and jsdom lacks.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<div id='mount'></div>", { url: "https://app.test/", pretendToBeVisual: true });
const { window } = dom;
for (const name of ["window", "document", "navigator", "MutationObserver", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "Node", "HTMLElement", "Element", "Range", "KeyboardEvent", "InputEvent", "Event", "CustomEvent",
  "SubmitEvent", "FocusEvent", "MouseEvent", "Window"]) {
  Object.defineProperty(globalThis, name, { value: name === "window" ? window : window[name], configurable: true, writable: true });
}
// CodeMirror measures text through these; jsdom has no layout, so every rectangle is empty.
const empty = () => ({ x: 0, y: 0, left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
window.Range.prototype.getClientRects = () => [];
window.Range.prototype.getBoundingClientRect = empty;
window.Element.prototype.getClientRects = () => [];

export { window };
