#!/usr/bin/env node
// Runs the window checks of this plugin against the published core application (core docs/spec/plugins.md#window-checks-of-a-plugin):
//   node scripts/test-app.mjs
// The core version is the version of the installed @soksak/window-check, the release that package.json names. For each application of
// the run (`requiredApps` of @soksak/window-check/app.mjs, so SOKSAK_APP selects one), the run downloads the published application zip
// `soksak-<version>-darwin-arm64-<host>.zip` into build/app-cache/<version>/ once and extracts its bundle there. Each run makes a new
// configuration root under build/test-app/ and builds a registry folder in it: the pnpm pack release of this plugin (`make pack`), the
// pnpm pack release of each fixture plugin of e2e/fixtures (a folder that holds plugin.json), and the entry of each sidecar that these
// plugins name, read from the public registry index; `sok registry build` of the bundle writes its index.json. The `sok` of each bundle
// sets that index and installs every plugin of the folder into the configuration of its application, the run starts the applications,
// runs every check under e2e/ with node:test, one file at a time, and quits each application through the quit item of its application
// menu, the last one through the quit key, as a person does. It fails when an application ends with another status than 0 or a process
// of the root or of a bundle remains. A passed run removes its root; a failed run keeps it with the output of the applications.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync,
  writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requiredApps } from "@soksak/window-check/app.mjs";
import { untilFolderState } from "@soksak/window-check/folder-wait.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
/** The platform key of the published application zips that the run uses. */
const PLATFORM = "darwin-arm64";
/** The public registry index, which lists the sidecar releases that the plugins of the run name. */
const PUBLIC_INDEX = "https://soksak-app.github.io/registry/index.json";
const RELEASES = "https://github.com/soksak-app/core/releases/download";
/** The time that an application has to write endpoint.json, and to exit after its quit. */
const START_LIMIT_MS = 60_000;
const QUIT_LIMIT_MS = 60_000;
/** The quit item of the application menu has the key equivalent Command+Q, which host.menu writes as `cmd+q`. */
const QUIT_MENU_KEY = "cmd+q";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const log = (line) => process.stdout.write(`test-app: ${line}\n`);

/** The core version of the run: the version of the installed @soksak/window-check. */
export function coreVersion() {
  return createRequire(import.meta.url)("@soksak/window-check/package.json").version;
}

/** The published application zip of `host` for `version`, as core names its release files. */
export function applicationZip(version, host) {
  const name = `soksak-${version}-${PLATFORM}-${host}.zip`;
  return { name, url: `${RELEASES}/v${version}/${name}` };
}

/** The application executable and the `sok` of an extracted bundle, both in its Contents/MacOS. */
export function bundleExecutables(bundle, host) {
  const folder = join(bundle, "Contents", "MacOS");
  return { application: join(folder, `sok-${host}`), sok: join(folder, "sok") };
}

/** The file name of a sidecar release: `scope-name` for `@scope/name` (core docs/spec/installation.md#sidecar-release). */
export const sidecarFileName = (name) => (name.startsWith("@") ? name.slice(1).replace("/", "-") : name);

/** The pnpm pack file name of the package `name` at `version`. */
export const packFileName = (name, version) => `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;

/** The address of the package.json repository, a string or `{ url }`, without the git+ prefix and the .git suffix. */
export function repositoryAddress(repository) {
  const url = typeof repository === "string" ? repository : repository?.url;
  if (typeof url !== "string" || url === "") throw new Error("package.json repository has no url");
  return url.replace(/^git\+/, "").replace(/\.git$/, "");
}

/**
 * The registry entry of one plugin release (core docs/spec/installation.md#registry-index): `manifest` is its plugin.json, `pkg` its
 * package.json and `release` its pack file. `sidecars` holds the package names of the sidecars of the registry; the index lists only
 * the dependencies on sidecars.
 */
export function pluginEntry(manifest, pkg, release, sidecars) {
  return {
    id: manifest.id, package: pkg.name, name: manifest.name, description: pkg.description, license: pkg.license,
    repository: repositoryAddress(pkg.repository),
    versions: [{
      version: pkg.version, release: { url: pathToFileURL(release).href, sha256: sha256(release) },
      engines: { soksak: pkg.engines?.soksak },
      sidecars: Object.fromEntries(Object.entries(manifest.dependencies ?? {}).filter(([name]) => sidecars.has(name))),
    }],
  };
}

/** The plugin folders of the run: this repository and each folder under e2e/fixtures that holds plugin.json. */
export function pluginFolders(root = ROOT) {
  const folders = [root];
  const fixtures = join(root, "e2e", "fixtures");
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const folder = join(dir, entry.name);
      if (existsSync(join(folder, "plugin.json"))) folders.push(folder);
      else visit(folder);
    }
  };
  if (existsSync(fixtures)) visit(fixtures);
  return folders;
}

/** Runs a program to its end with its output on this output; another status than 0 rejects with the command. */
async function run(file, args, { cwd = ROOT, env, signal } = {}) {
  const child = spawn(file, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit", signal });
  const [code, end] = await once(child, "exit");
  if (code !== 0) throw new Error(`${[file, ...args].join(" ")} ended with ${code === null ? `signal ${end}` : `status ${code}`}`);
}

/** Runs a program to its end and resolves with its standard output; another status than 0 rejects with its standard error. */
async function output(file, args, { cwd = ROOT } = {}) {
  const child = spawn(file, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { err += chunk; });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${[file, ...args].join(" ")} ended with status ${code}: ${err.trim()}`);
  return out;
}

/** Downloads `url` into `file` through a temporary file beside it, so an interrupted download leaves no file. */
async function download(url, file) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  renameSync(partial, file);
}

/** The bundle of `host` for `version` in the cache: downloaded and extracted once, with ditto as the application update does. */
export async function cachedBundle(cache, version, host) {
  const folder = join(cache, version, host);
  const bundle = join(folder, "soksak.app");
  if (existsSync(bundle)) return bundle;
  const { name, url } = applicationZip(version, host);
  const zip = join(cache, version, name);
  if (!existsSync(zip)) {
    log(`downloading ${url}`);
    await download(url, zip);
  }
  const extracting = `${folder}.partial`;
  rmSync(extracting, { recursive: true, force: true });
  await run("ditto", ["-x", "-k", zip, extracting]);
  if (!existsSync(join(extracting, "soksak.app"))) throw new Error(`${zip} holds no soksak.app`);
  renameSync(extracting, folder);
  return bundle;
}

/**
 * Builds the registry folder `folder`: packs each plugin folder, writes its entry, writes the entry of each sidecar that a plugin
 * names from the public index, and runs `sok registry build`. Resolves with the index path and the plugin ids.
 */
async function buildRegistry(folder, sok) {
  const releases = join(folder, "releases");
  mkdirSync(releases, { recursive: true });
  const plugins = pluginFolders().map((dir) => ({ dir, manifest: readJson(join(dir, "plugin.json")), pkg: readJson(join(dir, "package.json")) }));
  for (const { dir } of plugins) {
    // This repository packs with its own pack target, which builds what its release holds.
    if (dir === ROOT) await run("make", ["pack", `OUT=${releases}`]);
    else await run("pnpm", ["pack", "--pack-destination", releases], { cwd: dir });
  }
  const named = new Set(plugins.flatMap(({ manifest }) => Object.keys(manifest.dependencies ?? {})));
  const packages = new Set(plugins.map(({ pkg }) => pkg.name));
  const index = await (await fetch(PUBLIC_INDEX)).json();
  const sidecars = index.sidecars.filter((entry) => named.has(entry.name) && !packages.has(entry.name));
  for (const entry of sidecars) writeJson(join(folder, "sidecars", `${sidecarFileName(entry.name)}.json`), entry);
  const sidecarNames = new Set(sidecars.map((entry) => entry.name));
  for (const { manifest, pkg } of plugins) {
    writeJson(join(folder, "plugins", `${manifest.id}.json`),
      pluginEntry(manifest, pkg, join(releases, packFileName(pkg.name, pkg.version)), sidecarNames));
  }
  writeJson(join(folder, "revoked.json"), { plugins: [], sidecars: [] });
  const built = JSON.parse(await output(sok, ["registry", "build", folder]));
  return { index: built.index, ids: plugins.map(({ manifest }) => manifest.id) };
}

/** Starts the application and resolves with its process once its configuration folder holds endpoint.json. */
async function start(application, configDir, out) {
  mkdirSync(configDir, { recursive: true });
  const stream = openSync(out, "a");
  const child = spawn(application, ["--config-dir", configDir], { cwd: ROOT, stdio: ["ignore", stream, stream] });
  const ended = new AbortController();
  child.once("error", (error) => ended.abort(new Error(`cannot start ${application}: ${error.message}`)));
  child.once("exit", (code, signal) => ended.abort(new Error(`${application} ended with ${code ?? signal} before it wrote endpoint.json`)));
  const endpoint = join(configDir, "endpoint.json");
  try {
    await untilFolderState(configDir, () => (existsSync(endpoint) ? true : undefined), START_LIMIT_MS,
      () => new Error(`${application} wrote no endpoint.json in ${START_LIMIT_MS / 1000}s`), ended.signal);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    throw error;
  }
  return child;
}

/**
 * Quits the application of `configDir` as a person does, with the `sok` of its bundle: `menu` selects the item of the application
 * menu whose key equivalent is Command+Q, `key` sends Command+Q down and up. Resolves when the process exited with status 0 and the
 * lock of the configuration folder is free.
 */
async function quit(child, sok, configDir, by) {
  const config = ["--config-dir", configDir];
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve([child.exitCode, child.signalCode]) : once(child, "exit");
  if (by === "menu") {
    const { menus } = JSON.parse(await output(sok, ["status", "host.menu", ...config]));
    const menu = menus.find((entry) => entry.items.some((item) => item.key === QUIT_MENU_KEY));
    if (menu === undefined) throw new Error(`the application menu has no item with the key equivalent ${QUIT_MENU_KEY}`);
    const { title } = menu.items.find((item) => item.key === QUIT_MENU_KEY);
    await output(sok, ["host.menu.select", "--menu", menu.title, "--title", title, ...config]);
  } else {
    for (const phase of ["down", "up"]) {
      await output(sok, ["input", "key", "--key", "q", "--text", "q", "--modifiers", "command", "--phase", phase, ...config]);
    }
  }
  let timer;
  const [code, signal] = await Promise.race([exited, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the application did not exit in ${QUIT_LIMIT_MS / 1000}s after its quit`)), QUIT_LIMIT_MS);
  })]).finally(() => clearTimeout(timer));
  if (code !== 0) throw new Error(`the application ended with ${code === null ? `signal ${signal}` : `status ${code}`}`);
  const lock = join(configDir, "process.lock");
  if (existsSync(lock)) await run("lockf", ["-s", "-t", String(QUIT_LIMIT_MS / 1000), lock, "true"]);
}

/** The processes other than this one whose command line names one of the paths, as `<pid> <command>`. */
async function remaining(paths) {
  const lines = (await output("ps", ["-axo", "pid=,command="])).split("\n");
  return lines.map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith(`${process.pid} `)
    && paths.some((path) => line.includes(path)));
}

async function main() {
  if (`${process.platform}-${process.arch}` !== PLATFORM) {
    throw new Error(`the published applications of the run are ${PLATFORM} bundles; this computer is ${process.platform}-${process.arch}`);
  }
  const version = coreVersion();
  const hosts = requiredApps(process.env);
  const cache = join(ROOT, "build", "app-cache");
  const base = join(ROOT, "build", "test-app");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-`));
  log(`core ${version}, applications ${hosts.join(", ")}, root ${relative(ROOT, root)}`);
  const failures = [];
  const children = new Map();
  const bundles = new Map();
  const interrupted = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => interrupted.abort(signal));
  try {
    for (const host of hosts) bundles.set(host, await cachedBundle(cache, version, host));
    const executables = new Map(hosts.map((host) => [host, bundleExecutables(bundles.get(host), host)]));
    const { index, ids } = await buildRegistry(join(root, "registry"), executables.get(hosts[0]).sok);
    const configDir = (host) => join(root, `soksak-check-${host}`);
    for (const host of hosts) {
      const { sok } = executables.get(host);
      const config = ["--config-dir", configDir(host)];
      await run(sok, ["registry", "use", index, ...config]);
      for (const id of ids) await run(sok, ["plugin", "install", id, ...config]);
    }
    for (const host of hosts) {
      log(`starting ${host}`);
      children.set(host, await start(executables.get(host).application, configDir(host), join(root, `${host}.out`)));
    }
    try {
      await run(process.execPath, ["--test", "--test-concurrency=1", "--test-timeout=600000", "e2e/"], {
        signal: interrupted.signal,
        env: {
          SOKSAK_CONFIG_ROOT: root,
          SOKSAK_RUN_FOLDER: join(root, "run"),
          ...Object.fromEntries(hosts.map((host) => [`SOKSAK_BINARY_${host.toUpperCase()}`, executables.get(host).application])),
        },
      });
    } catch (error) {
      failures.push(`window checks: ${error.message}`);
    }
  } catch (error) {
    failures.push(`preparation: ${error.message}`);
  } finally {
    const started = [...children.keys()];
    for (const [index, host] of started.entries()) {
      try {
        await quit(children.get(host), bundleExecutables(bundles.get(host), host).sok, join(root, `soksak-check-${host}`),
          index === started.length - 1 ? "key" : "menu");
      } catch (error) {
        failures.push(`quit ${host}: ${error.message}`);
        children.get(host).kill("SIGKILL");
      }
    }
    const left = await remaining([root, ...bundles.values()]);
    if (left.length > 0) failures.push(`${left.length} processes remain: ${left.join("; ")}`);
  }
  if (failures.length > 0) {
    for (const failure of failures) log(`failed ${failure}`);
    log(`the root ${relative(ROOT, root)} is kept`);
    process.exitCode = 1;
    return;
  }
  rmSync(root, { recursive: true, force: true });
  log("passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
