// A contribution to editor.extension that marks the first word of the file with the class probe-mark.
import { Decoration, EditorView } from "@soksak/shared/editor.extension/@codemirror/view.js";

export function extension() {
  return EditorView.decorations.of((view) => view.state.doc.length < 3
    ? Decoration.none
    : Decoration.set([Decoration.mark({ class: "probe-mark" }).range(0, 3)]));
}
