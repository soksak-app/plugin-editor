// The fixture of `@soksak/plugin-api/diagnostic-view-frames`: observeViewDocumentFrames, which the editor diagnostics start for the
// content frame measurement. It records the options of the call and its stop; the test delivers the frames through options.log.
import { currentSession } from "./session.mjs";

export function observeViewDocumentFrames(options) {
  return currentSession().observeViewDocumentFrames(options);
}
