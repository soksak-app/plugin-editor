# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- E12.1: Require files sidecar 0.0.5+ for project-relative Markdown images, use `readBytes` to create bounded MIME-typed Blob URLs, and revoke them with the view lifecycle.
- E12.2: The large-document Markdown test waits for the refreshed heading decoration within a bounded number of turns instead of one macrotask, which failed intermittently.
- E12: Markdown files render headings, emphasis, links, lists, code and safe-scheme images in place through CodeMirror decorations; `editor.markdown.toggle` switches views without replacing the document.
- E24.7: The errors of the view page and the losses of its calls are stored as the error event `plugin.editor.page.error` through `runtime.log`, instead of a host call that no surface serves.
- E24.4: The view page answers the exposure requests that core forwards to its surface (`status.get`, `status.watch`, `command.run` and the others) from its own values through `exposureReply`.
- E24.3: The view page takes the declarations of its exposure from the start values `window.sokSurface` that the host injects, and refuses start values without them.
- E24.6, E24.2: `@soksak/plugin-api` comes from core main, which holds the view mechanism; core serves the tab reports and the event log of a view in the forms that the page sends, and the level gate applies at delivery in the main page.
- E24.5: The record check of the dependency applies the census exclude (core F224); the lockfile pins `@soksak/plugin-api` to the branch commit that carries it, and `make test` passes whole with the vendor files committed.
- E24: The surface moves to a view: `plugin.json` declares the composition `{kind: "view", page: "ui/index.html"}`, the view page builds its surface context over the view bridge of `@soksak/plugin-api/view`, and `ui/editor.js` keeps its behavior. `@soksak/plugin-api` comes from the core branch `feat/view-kind-F212.7`; the release follows the core release. The tab reports, the event log, the start values and the status route of a view wait for the core routes (E24.2 to E24.4).
- E23: new commits are authored as `min-0-max <max@blue.tools>`; `.mailmap` maps the former name `min-median-max`, and published commits are not rewritten.

## 0.0.4 (2026-10-19)

- E22: Release version 0.0.4 with the memory saver declaration (E21); the tag `v0.0.4` publishes `editor-0.0.4.tgz` built with `sok` of core v0.0.18.
- E21: The surface declares `surface.unload` `{format: 1, maxBytes: 8192}`, writes `{path, selection, scroll}` as the core tab state, restores the file, the cursor and the scroll position at mount, and holds `keep("busy")` while a formatter runs; `@soksak/plugin-api` and `CORE_RELEASE` come from core 0.0.18, which `engines.soksak` requires. Red: the tab state case (`actual: undefined`), the refusal and the formatter case; Green: `make test` passes 35 of 35.

## 0.0.3 (2026-10-14)

- E18: Release version 0.0.3 with the event contract (E15) and the blank document (E16); the tag `v0.0.3` publishes `editor-0.0.3.tgz`.
- E20: `@soksak/plugin-api` comes from the core release 0.0.12, `engines.soksak` is `>=0.0.12`, and the release workflow builds `sok` from `CORE_RELEASE: v0.0.12`.
- E19: `make hooks` sets `.githooks` as the hook folder, so a commit whose message breaks the commit form or the term rules, or whose records break the record rules, is refused when it is made.
- E16.1: a tab without `params.path` opens a blank document, whose first save asks for its file through `core.file.place` and then writes and watches that file.
- E17: `make test` runs the record check `soksak-records`, and CI checks the form of each pushed commit message with `soksak-commits`.
- E15.4: `@soksak/plugin-api` comes from the core release 0.0.11, `engines.soksak` is `>=0.0.11`, and `plugin.json` names the event catalog `events.json`.
- E15.6, E15.5: the events of the plugin build costly fields only while their level is stored, and the plugin has no input that carries `cids`.
- E15: the forwarder `ui/events.js` marks the event name it passes with `events: forwarded`, so the catalog check of core reads the names at the calls of `emitEvent`.
- E15: the plugin declares the event catalog `events.json` and stores the open, read, save, watch, disk decision, format, failed contribution, close, every request to the files sidecar and the result of every command as events through `context.runtime.log`; `make test` runs `soksak-events`. Tests: `test/events.test.mjs` (3) and nine event cases in `test/editor.test.mjs`; `pnpm test` passes 26 cases. The member `events` of `plugin.json` and the run of the guard through `pnpm exec` wait for the core release of E15.4.
- E13: the documents and comments call plugins, sidecars and releases by those words.
- F238-c-13: The tests run on a test tree that `scripts/build-test.mjs` builds from `ui/`. The SDK imports of the UI resolve to test models (`test/models/`) and the shared modules to their vendored bundles, and the test sources name no SDK package. The copied contract cases of `test/fixtures/contract/` are replayed against each model. Green: 96 tests pass and 2 are skipped.
- F238-c-15: The resolver hook `test/shared-modules.mjs` and its `--import` are removed; the build tree resolves the shared modules.
- F238-c-16: The tests import the shared CodeMirror modules from `build/test/shared/`, not through the package specifier.
- F238-c-17: The view host installs the view wire model and reads no SDK file.
- F238-c-23: `make test` runs the plugin tests only; `make check` runs `scripts/check-plugin.mjs` (the manifest, the view page, the copied contract cases and the test SDK table) and the SDK tools `soksak-exposure`, `soksak-engines`, `soksak-events` and `soksak-records`. `make check` is not yet green: the installed release publishes no `contract/`, and the `resolveContributions` gap (F238-c-13.1) remains.
- F238-c-13.4: The view page names its declared sidecar (`@soksak/sidecar-files`, the one dependency of `plugin.json`) in each sidecar call, and the view bridge model refuses a `runtime.sidecar()` call without a sidecar name.
- F238-c-6: `@soksak/plugin-api` is pinned to the core release tag `v0.0.20` instead of core `main`. `make test` passes; `make check` fails against that tag until a core release publishes `view.js` and `contract/`.
- F238-c-24: `ci.yml` runs `make check` after `make test`; `release.yml` runs `make test` and `make check` before packing.
