# Extension points

[한국어](extension-points.ko.md)

The editor declares two extension points in `plugin.json` (core `docs/spec/plugins.md#extension-points`). A contributor declares items in `contributes` with `range`, `module` and the optional field `extensions`, a list of lowercase file name extensions without the dot; an item without `extensions` applies to every file. The editor imports the module of each connected item when its tab opens, and an item whose module fails to load, lacks the export or throws while it builds is reported `invalid` through `core.contributions`.

## editor.extension 1.0.0

The module exports `extension(file)`, where `file` is `{path, extension, language}`: the path relative to the project root, the lowercase name extension or `""`, and the editor's language of the file or `null`. It returns a CodeMirror extension, which the editor adds to the editor of that file. Language support, decorations, key bindings and themes are such extensions.

The point shares the CodeMirror packages of the editor: `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@lezer/common`, `@lezer/highlight`, `@lezer/lr`, `@marijn/find-cluster-break`, `crelt`, `style-mod` and `w3c-keyname`. A contributor imports each of them as `@soksak/shared/editor.extension/<package>` and bundles it as that external import, so the contributor and the editor use one instance. A contributor bundles every other package itself; a language package that it bundles imports the shared packages in the same way.

| Point version | Packages |
| --- | --- |
| 1.0.0 | `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.14, `@codemirror/language` 6.13.1, `@codemirror/commands` 6.11.1, `@lezer/common` 1.5.3, `@lezer/highlight` 1.2.5, `@lezer/lr` 1.4.11, `@marijn/find-cluster-break` 1.0.4, `crelt` 1.0.7, `style-mod` 4.1.4, `w3c-keyname` 2.2.8 |

The point's version follows the shared packages: a minor version of a shared package raises the minor part, and a major version raises the major part.

## editor.formatter 1.0.0

The module exports `format(text, file)`, with `file` as above, which returns the formatted text or a promise of it. `editor.format` runs the first connected formatter whose `extensions` contain the file's name extension, or that has no `extensions`, and replaces the text with its result as one edit. A formatter that throws or returns a value that is not text fails the command, which shows the failure as the tab's error.
