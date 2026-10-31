# Core compatibility

[한국어](core-compatibility.ko.md)

The editor package uses the view manifest contract of core release `0.0.23`. Its `plugin.json` declares a view composition without `surface.module`, which the published core `v0.0.20` reader refuses. `package.json` therefore declares `engines.soksak: "^0.0.23"`, which admits core `0.0.23` and does not claim compatibility with earlier versions or later unverified versions. A package release must use a core release that carries this contract.

The diagnostic `plugin.editor.view.content_frame` event records one sample for each animation frame scheduled by the shared view-document observer. If multiple root ResizeObserver deliveries arrive before that frame, the sample reports the first delivery as `firstResizeAtMs`, the latest as `resizeAtMs`, and their number as `resizeCount`. Require `firstResizeAtMs <= resizeAtMs <= frameTimeMs`; a count of one requires equal first and latest timestamps, while coarser clocks may make a multi-delivery interval equal too. The plugin validates and forwards all these source fields unchanged; the event is a size observation, not proof of physical presentation.

Starting `editor.diagnostics.content-trace` returns a `sourceClock` anchor from the editor view document: `documentTimeOriginMs` is `performance.timeOrigin`, `sourceNowMs` is an immediate `performance.now()` reading, and `sourceResolutionMs` is the fixed 1 ms WebKit resolution bound. The anchor is returned only by a successful start and lets the consumer correlate view-document frame times with native exposure request and reply times.

The successful start reply also returns `markerColor` as the RGB integer triplet used by the existing `--card` paint marker. The consumer uses this declared color to classify captured pixels; it does not infer the marker from Editor-private implementation details. Read and stop replies do not add this field.
