# Core compatibility

[한국어](core-compatibility.ko.md)

The editor package declares `engines.soksak: "^0.0.39"`, which admits core release `0.0.39` under the core version-range rules and does not claim compatibility with earlier versions or later unverified versions. 0.0.35 is the version of the core release of F502-13, the first core release that accepts `exposes.element`, which `plugin.json` declares; core 0.0.34 refuses it. Its `plugin.json` also declares a view composition without `surface.module`, which core releases from `0.0.24` accept.

The diagnostic `plugin.editor.view.content_frame` event records one sample for each animation frame scheduled by the shared view-document observer. If multiple root ResizeObserver deliveries arrive before that frame, the sample reports the first delivery as `firstResizeAtMs`, the latest as `resizeAtMs`, and their number as `resizeCount`. Require `firstResizeAtMs <= resizeAtMs <= frameTimeMs`; a count of one requires equal first and latest timestamps, while coarser clocks may make a multi-delivery interval equal too. The plugin validates and forwards all these source fields unchanged; the event is a size observation, not proof of physical presentation.

Starting `editor.diagnostics.content-trace` returns a `sourceClock` anchor from the editor view document: `documentTimeOriginMs` is `performance.timeOrigin`, `sourceNowMs` is an immediate `performance.now()` reading, and `sourceResolutionMs` is the fixed 1 ms WebKit resolution bound. The anchor is returned only by a successful start and lets the consumer correlate view-document frame times with native exposure request and reply times.

The successful start reply also returns `markerColor` as the RGB integer triplet used by the existing `--card` paint marker. The consumer uses this declared color to classify captured pixels; it does not infer the marker from Editor-private implementation details. Read and stop replies do not add this field.
