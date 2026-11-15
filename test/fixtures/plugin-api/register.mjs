// Registers the resolve hook that maps the plugin API specifiers to the fixture modules of this directory. The test command loads this
// module with --import, so a page module of ui/ that imports @soksak/plugin-api reaches the fixture, as the import map of the
// application resolves the same specifiers for the page.
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);
