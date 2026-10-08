// Bundles CodeMirror into ui/vendor/ (core docs/spec/plugins.md#third-party-libraries).
// Each package that plugin.json lists in the modules of the extension point editor.extension becomes the file
// that plugin.json names for it, so the editor and its contributors load one instance of each from
// @soksak/shared/editor.extension/<package>. libraries.js holds the packages that only the editor imports:
// the language packages and @codemirror/search. A bundle imports every shared package as that external URL.
// --check fails when a new build differs from the committed files.
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

const ROOT = new URL("../", import.meta.url).pathname;
const VENDOR = join(ROOT, "ui/vendor");
const POINT = "@soksak/shared/editor.extension/";

/** The packages that the editor shares with its contributors and their files, from plugin.json. */
const MODULES = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")).extends.extension.modules;
const SHARED = Object.keys(MODULES);
for (const path of Object.values(MODULES)) {
  if (!path.startsWith("ui/vendor/")) throw new Error(`plugin.json: shared module ${path} is not in ui/vendor/`);
}

/** Every shared package import becomes the external URL of the extension point, except the package being built. */
const externals = (own) => ({
  name: "shared",
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "entry-point" || !SHARED.includes(args.path) || args.path === own) return undefined;
      return { path: `${POINT}${args.path}`, external: true };
    });
  },
});

const LIBRARY_ENTRY = `export { SearchQuery } from "@codemirror/search";
export { css } from "@codemirror/lang-css";
export { go } from "@codemirror/lang-go";
export { html } from "@codemirror/lang-html";
export { javascript } from "@codemirror/lang-javascript";
export { json } from "@codemirror/lang-json";
export { markdown } from "@codemirror/lang-markdown";
export { python } from "@codemirror/lang-python";
export { rust } from "@codemirror/lang-rust";
export { StreamLanguage } from "@codemirror/language";
export { shell } from "@codemirror/legacy-modes/mode/shell";
`;

/** The source of the entry of a shared package: its named exports and, when it has one, its default export. */
async function sharedEntry(name) {
  const exported = await import(name);
  return `export * from "${name}";\n${"default" in exported ? `export { default } from "${name}";\n` : ""}`;
}

/** The bundled packages: the package folder of each input of the bundles, by package name. */
const bundled = new Map();

/** Records the package folder of each input file of a bundle. */
function record(metafile) {
  for (const input of Object.keys(metafile.inputs)) {
    const match = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input);
    if (!match) continue;
    const dir = realpathSync(join(ROOT, match[1]));
    if (bundled.has(match[2]) && bundled.get(match[2]) !== dir) throw new Error(`${match[2]}: bundled from two folders`);
    bundled.set(match[2], dir);
  }
}

async function bundle(contents, own) {
  const result = await build({
    stdin: { contents, resolveDir: ROOT, loader: "js" },
    bundle: true,
    format: "esm",
    target: "safari17",
    legalComments: "none",
    write: false,
    logLevel: "silent",
    metafile: true,
    plugins: [externals(own)],
  });
  record(result.metafile);
  return result.outputFiles[0].text;
}

/** The license texts of every bundled package, from the license file of its folder. */
function notices() {
  return [...bundled].sort(([a], [b]) => a.localeCompare(b)).map(([name, dir]) => {
    const { version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const file = readdirSync(dir).find((entry) => /^licen[cs]e/i.test(entry));
    if (!file) throw new Error(`${name} ${version}: no license file`);
    return `# ${name} ${version} (${license})\n\n${readFileSync(join(dir, file), "utf8").trim()}\n`;
  }).join("\n");
}

const outputs = new Map();
for (const name of SHARED) outputs.set(MODULES[name].slice("ui/vendor/".length), await bundle(await sharedEntry(name), name));
outputs.set("libraries.js", await bundle(LIBRARY_ENTRY, null));
outputs.set("LICENSE.txt", notices());

if (process.argv.includes("--check")) {
  const committed = readdirSync(VENDOR).sort();
  const built = [...outputs.keys()].sort();
  if (JSON.stringify(committed) !== JSON.stringify(built)) {
    console.error(`ui/vendor holds ${committed.join(", ")}, but a build writes ${built.join(", ")}; run pnpm build`);
    process.exit(1);
  }
  for (const [file, text] of outputs) {
    if (readFileSync(join(VENDOR, file), "utf8") !== text) {
      console.error(`ui/vendor/${file} differs from a new build; run pnpm build`);
      process.exit(1);
    }
  }
} else {
  for (const [file, text] of outputs) writeFileSync(join(VENDOR, file), text);
}
