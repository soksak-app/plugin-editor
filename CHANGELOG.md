# Changelog

[한국어](CHANGELOG.ko.md)

## Unreleased

- E20: `@soksak/plugin-api` comes from the core release 0.0.12, `engines.soksak` is `>=0.0.12`, and the release workflow builds `sok` from `CORE_RELEASE: v0.0.12`.
- E19: `make hooks` sets `.githooks` as the hook folder, so a commit whose message breaks the commit form or the term rules, or whose records break the record rules, is refused when it is made.
- E16.1: a tab without `params.path` opens a blank document, whose first save asks for its file through `core.file.place` and then writes and watches that file.
- E17: `make test` runs the record check `soksak-records`, and CI checks the form of each pushed commit message with `soksak-commits`.
- E15.4: `@soksak/plugin-api` comes from the core release 0.0.11, `engines.soksak` is `>=0.0.11`, and `plugin.json` names the event catalog `events.json`.
- E15.6, E15.5: the events of the plugin build costly fields only while their level is stored, and the plugin has no input that carries `cids`.
- E15: the forwarder `ui/events.js` marks the event name it passes with `events: forwarded`, so the catalog check of core reads the names at the calls of `emitEvent`.
- E15: the plugin declares the event catalog `events.json` and stores the open, read, save, watch, disk decision, format, failed contribution, close, every request to the files sidecar and the result of every command as events through `context.runtime.log`; `make test` runs `soksak-events`. Tests: `test/events.test.mjs` (3) and nine event cases in `test/editor.test.mjs`; `pnpm test` passes 26 cases. The member `events` of `plugin.json` and the run of the guard through `pnpm exec` wait for the core release of E15.4.
- E13: the documents and comments call plugins, sidecars and releases by those words.
