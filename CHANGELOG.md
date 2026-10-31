# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- F336-editor: Version 0.0.10 requires core 0.0.25 and files sidecar 0.0.9.
- F326-editor: Version 0.0.9 requires core `^0.0.24` and uses the plugin API release file and the `sok` of core `v0.0.24`.
- F324-editor: Version 0.0.8 requires core `^0.0.23`, uses the plugin API release file of core `v0.0.23`, and packs its release with the `sok` inside the core `v0.0.23` application zip of the Tauri host.
- F272-editor: A push to `main` releases the declared version through `soksak-release-gate` when its tag is absent, with the `sok` of the core release `v0.0.21`, and the dependency on `@soksak/plugin-api` is the packed release file of that release; no workflow checks out core.
- F275-editor: `make install` installs the locked dependencies; the tests, checks and builds no longer install.
- E42: `@soksak/plugin-api` is pinned to the core commit whose published contracts the copied cases match.
- F274-editor: The pre-push hook checks only the commit messages that a push publishes; CI runs the tests and checks.
- E41: Follow the view-wire contract whose page identity is a UUID: the view-wire replay model takes the page identity from `window.crypto.randomUUID()` and posts the time origin as `time_origin`, and the copied contract matches core. The Red replay failed 8 of 8 cases; the Editor tests pass 155/155 and the current-SDK check passes.

- E40: Pin `@soksak/plugin-api` to the public core commit for API 0.0.21 and regenerate the lockfile with pnpm. Align the two copied view contracts and the view-wire replay model with the declared page clock. The current-SDK check passes all 10 contract copies and SDK checks; focused bridge and wire models pass 17/17 and 9/9, and the Editor view owner passes 16/16. Keep the engines range, plugin version and public release unchanged.

- E39: Route Editor view event records through the SDK bridge logger and its error reporter. Remove the direct single-record `runtime.log` sender and duplicate refusal handler. The consumer fake-bridge Red showed that the view context exposed `undefined` instead of the bridge logger; the view owner now passes 16/16, including refused-record error routing, and the record check passes 86 files.

- E38: Restore the Editor documentation contract by removing checklist IDs from specifications, adding implementation/validation/release status fields, and aligning changelog identifiers and code spans in both languages. Preserve the historical model skip and its completed F252 follow-up.

- E37: Expose markerColor in successful content-trace START replies from the same RGB definition as the diagnostic CSS paint. Keep read, stop and cleanup behavior unchanged. The missing-field owner Red becomes Green 1/1; current-SDK checks and diagnostic packaging pass. Captured-pixel acceptance remains with core F239-233.

- E36: Return the editor document's performance clock anchor from a successful content-trace start. The tracked content-frame owner fails when the start response omits it and passes after the response includes the document time origin, current view time and fixed 1 ms resolution bound. The diagnostic declaration owner and current plugin API checks pass; application measurements remain separate.

- E35: Consume the current shared view-frame event contract. Require the
  first and latest ResizeObserver timestamps, a positive resize count, equal
  timestamps for count one, and a frame timestamp no earlier than the latest
  resize. Red: the current SDK payload was refused as unexpected fields, and
  the adapter accepted a mismatched count-one interval. Green: the Editor
  content-frame owner passes 1/1 with current-field forwarding and invalid
  time, count and field cases; current-core `make check` passes the catalog
  and package checks.

- E34: Add a diagnostic-only hidden-memory view start. Red: tracked editor tests showed that hidden-memory params initialized the normal editor UI and files sidecar, and were not refused without diagnostics. Green: the hidden start creates one maintained CodeMirror view from the supplied document, reports its readiness and history through `editor.memory.hidden`, and removes it on command or disposal. The editor owner tests pass 51/51, diagnostics tests pass 6/6, and the content-frame regression and current-core SDK checks pass. Normal editor starts are unchanged.

- E33: Apply `CORE_PLUGIN_API_DIR` to each SDK validator CLI. Red: the tracked dry-run test showed that an override still selected the installed engines CLI. Green: the public checker files run from the declared API directory when present; installed CLI binaries remain the default without an override. The Makefile owner tests pass 6/6. This changes development tool selection only and does not alter the SDK pin, engines range or public release gate.

- E32: Declare the runtime-added `surface` field in the editor view frame event schema. Red: the actual context-scoped frame payload was rejected as an additional property; the catalog test also rejected the valid JSON Schema type `integer`. Green: Ajv 2020 accepts the emitted payload and rejects unexpected fields, and the catalog test accepts `integer`; the focused frame test passes 1/1 and the related editor, diagnostic and event tests pass 58/58.

- E31: Add `editor.diagnostics.content-trace` using the shared core observer. Red: the owning diagnostics test found no explicit content-frame measurement lifecycle. Green: the editor command test verifies shared observer inputs, runtime trace routing, current dimensions, history counts, duplicate-start refusal and exact `--card` restoration; the editor, diagnostics and view tests pass. The palette is stable measurement setup: source records measure ResizeObserver-to-animation-frame cadence under that fixture, not physical paint or normal-theme latency.

- E30: Move the hidden CodeMirror fixture lifecycle into the diagnostic-only module and pass it the same state factory as the normal editor. Red: the owning diagnostics test found no hidden editor lifecycle export. Green: diagnostic module, editor integration and release staging tests pass; the editor module contains no hidden view creation or cleanup. The diagnostic result also reports the editor view's actual window history length. The normal package excludes `diagnostics.json` and its module. Core owns physical footprint measurement and threshold acceptance.

- F239-77-editor: Complete local schema-3 catalog acceptance with the matching installed diagnostic cohort. The current SDK checks 9 sources with zero pending rules and 17 events; both host installations contain the exact source catalog and pass application log audits. Public publication remains separate.

- F239-77-editor: Convert the Editor event catalog to schema 3 JSON Schema without changing event names, levels or required/optional field semantics. Red: current core's event checker rejected the schema-2 catalog and parsed compact field names as schema keywords. Green: current core's `events-check` accepts all 17 declarations and their source emits. The package test passes 142 tests with one skipped `view.bridge.runtime-log-without-level-query` case, an uncovered model case recorded by F252-contract-editor; the linked F252-contract-editor-1 follow-up adds plain `runtime.log` replay. Manifest, exposure, engines, records and contract-copy checks pass against current core source. Runtime acceptance remains separate.

- F252-contract-editor-1: The view bridge model now replays `view.bridge.runtime-log-without-level-query`. Red: after removing the exclusion, the case failed because the model had no `log` step. Green: `node --test test/model-view-bridge.test.mjs` passes 18/18 with no skips; runtime behavior is unchanged.

- E29: Editor `0.0.7` now declares `engines.soksak` `^0.0.21` because published core `v0.0.20` rejects its view composition without `surface.module`. Red: `test/core-version.test.mjs` failed with `">=0.0.18" !== "^0.0.21"`. Green: the same test passes 1/1, the candidate manifest and copied contract checks pass, and the candidate engines and events checks pass. `make check` reaches the pinned SDK engines check and fails because the pin is `v0.0.20`; the package release remains gated on a matching core release. No SDK pin, plugin version, archive or registry changed.

- E27-1: Remove the package-version assertion that duplicated package metadata; keep the manifest test focused on the declared files sidecar range.

- E27: Load the installed plugin record and shared contribution modules from `soksak://core`. Red: the owning view test recorded `sok://core/installed-plugins.json` and failed its canonical URL assertion. Green: the same test passes; the bridge model now installs the view wire for canonical URLs, all current source, test and fixture URLs use the canonical scheme, `make test` passes 141 tests with one listed skip, and `CORE_PLUGIN_API_DIR=<core>/packages/plugin-api make check` passes. Package 0.0.6 is packed locally and not published.
- E28: Resolve editor extension points through the declared view bridge instead of fetching the ungranted global installed-plugin record. Red: the owning view test failed because it observed no `extension` or `formatter` bridge calls. Green: the same test observes both calls and no global fetch; `make test` and `CORE_PLUGIN_API_DIR=<core>/packages/plugin-api make check` pass. Package 0.0.7 is packed locally and not published.

- E26: Require files sidecar 0.0.8 or later, which declares the required process display identity. Raise the plugin version to 0.0.5. Red: the owning manifest test rejected the previous `>=0.0.5` range; Green: it passes with the new range and version.

- F238-c-28: The view page begins with its doctype and holds no import map, which the host inserts after the doctype. The page check of `scripts/check-plugin.mjs` no longer compares a copy of the map, for the core checklist item F212.12-1-10-6. Red: `make check` with CORE_PLUGIN_API_DIR failed with `view page has an import map`. Green: `make test` passes 140 of 141 with one skipped case, and `make check` with CORE_PLUGIN_API_DIR exits 0.
- F238-c-27: The contract copy `test/fixtures/contract/contributions.json` follows core main. The copy held the probe as a `hybrid` composition with a `module`; core main publishes the seven cases as a `view` composition with `page: ui/page.html`. Red: `make check` with CORE_PLUGIN_API_DIR failed at the contract copy check, which reported that the copy differs from the published `contract/contributions.json`. Green: the copy equals core main's file, the contributions model replay passes 9 of 9 without a model change, and `make check` with CORE_PLUGIN_API_DIR exits 0.
- F212.12-1-10-2: The view page map holds the screen-hash entry of core's view import map, which `checkViewPage` requires. The view test asserts five entries. Red: the test `the view page carries the import map of the view and the page script` failed with `actual: 4, expected: 5`, and the check of CORE_PLUGIN_API_DIR failed with the missing entry. Green: `make test` passes 140 of 141 with one skipped case, and the view page check of `make check` passes. The next check of `make check` differs in the fixture `test/fixtures/contract/contributions.json` from core's published contract, which is outside this change.
- F238-c-25: The pre-push hook runs `make push-check`, which runs `make test`, `make check` and the commit message check of the pushed range, as the ci workflow does. Red: the push-check header test and the pre-push hook test failed, and `.githooks/pre-push` did not exist. Green: `test/makefile.test.mjs` passes 4 of 4. `make check` fails at the pinned SDK, which F238-c-26 records.
- F252-contract-editor: The copied contract files follow core origin/main (`create-binder.json`, `expose.json`, `view-commands.json` changed). The replay models cover the new function-params binds and the command cids, and the exposure replay gained the `inspect` step.
- F252-editor: A refused save of a read-only file and a format without a connected formatter show their text as the tab error and are thrown to the caller. An invalid regular expression shows its message in the find bar and is recorded as `plugin.editor.find.invalid`. A Markdown image failure after the tab ended or was replaced is recorded as `plugin.editor.markdown.image`. A thrown value without a message is shown as its text. A refused `runtime.log` record is shown as `runtime.error {where: "log"}` and kept on the console.
- F238-b-10-2: `test/test-script.test.mjs` pins that the test command selects every test file under `test/`, so a later subdirectory of tests cannot be left out. `make test` runs 130 tests (129 before).
- F238-b-10-1: the core view bridge contract copy is refreshed to the current core case set; `view.bridge.runtime-log-without-level-query` replaces `view.bridge.runtime-log-level-gate`, and the view calls no level query. In this repository the model test (`test/model-view-bridge.test.mjs`) lists the case as uncovered under its new id, and `test/models/view-bridge.mjs` names it in its comment.
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
- F238-c-13.1, F238-c-13.2, F238-c-13.3: The models replay the published contributions, binder keydown and view event cases. The bridge drops an event that arrives before its subscription, and the page reads its initial theme from `window.sokTheme`. `make check` passes with `CORE_PLUGIN_API_DIR` set to core main.
- F238-c-23.1: `scripts/check-plugin.mjs` loads the SDK from `CORE_PLUGIN_API_DIR`.
- F238-c-13.5: The page's exposure port has no unregister, because the view channel publishes no removal of a registration; dispose ends the local listeners, bindings and declarations, and the model replays the copied dispose cases.
- F238-c-13.6: The page's calls keep the 10000 millisecond limit and late-reply reporting of core calls.json; the model replays the four cases on a fake clock.
- E14: The view page sends an explicit empty list of correlation identifiers with each sidecar send, because a view has no input chain; the trace events `open`, `save`, `watch.start` and `watch.change` were already declared and tested.
