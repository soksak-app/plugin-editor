// Marks the words TODO, FIXME and XXX with the class cm-todo in every file.
import { Decoration, MatchDecorator, ViewPlugin } from "@soksak/shared/editor.extension/@codemirror/view";

const mark = Decoration.mark({ class: "cm-todo" });
const decorator = new MatchDecorator({ regexp: /\b(?:TODO|FIXME|XXX)\b/g, decoration: () => mark });

export const todoMarks = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = decorator.createDeco(view);
  }

  update(update) {
    this.decorations = decorator.updateDeco(update, this.decorations);
  }
}, { decorations: (plugin) => plugin.decorations });
