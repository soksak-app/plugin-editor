// Consumer port probe for the diagnostic-only view frame API. The core package owns ResizeObserver and animation-frame behavior.
let options = null;
let stopCount = 0;

export function observeViewDocumentFrames(value) {
  options = value;
  return () => { stopCount += 1; };
}

export function resetViewFrameProbe() {
  options = null;
  stopCount = 0;
}

export function inspectViewFrameProbe() {
  return { options, stopCount };
}

export function emitViewFrameProbe() {
  if (options === null) throw new Error("view frame probe is not active");
  const rect = options.document.documentElement.getBoundingClientRect();
  options.log.trace("view.content_frame", {
    sequence: 0, width: rect.width, height: rect.height,
    documentTimeOriginMs: options.timeOriginMs, resizeAtMs: 0, frameTimeMs: 1,
  });
}
