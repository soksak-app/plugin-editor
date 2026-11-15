// The fixture of `@soksak/plugin-api/view`: createViewBridge, which the editor view page creates over the sok-view handler of its
// window. The handler is not used: the bridge answers as the test of the open session arranges (session.mjs).
import { currentSession } from "./session.mjs";

export function createViewBridge(options) {
  return currentSession().createViewBridge(options);
}
