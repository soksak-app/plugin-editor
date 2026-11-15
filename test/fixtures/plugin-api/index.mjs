// The fixture of `@soksak/plugin-api`: the exports that the page modules of this plugin import (createExpose). It answers as the test
// of the open session arranges (session.mjs), records each call, and refuses what the plugin declares no use of.
import { currentSession } from "./session.mjs";

export function createExpose(deps, declarations) {
  return currentSession().createExpose(deps, declarations);
}
