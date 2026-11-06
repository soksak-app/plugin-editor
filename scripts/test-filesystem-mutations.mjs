// Runs the same healthy filesystem integration against the editor and two historical defects across save and reload scenarios.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mutations = [
  { name: "save-baseline", from: "saved = document;", to: "saved = view.state.doc;", occurrences: 2,
    test: "filesystem save keeps edits made while its real write is paused",
    assertion: "a later edit must remain modified after the real write" },
  { name: "stale-watch", from: "if (disposed || generation !== watchGeneration) return;", to: "if (disposed) return;", occurrences: 1,
    test: "filesystem held read cannot replace a later persisted save",
    assertion: "a stale filesystem read must not replace the persisted save" },
  { name: "stale-watch-reload", from: "if (disposed || generation !== watchGeneration) return;", to: "if (disposed) return;", occurrences: 1,
    test: "filesystem held read cannot replace a later explicit reload",
    assertion: "a stale filesystem read must not replace the explicit reload" },
];

async function run(directory, args) {
  const child = spawn(process.execPath, args, { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, output }));
  });
}

async function copyProject() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "editor-filesystem-mutation-"));
  try {
    for (const name of ["test", "ui"]) await fs.cp(path.join(root, name), path.join(directory, name), { recursive: true });
    await fs.mkdir(path.join(directory, "scripts"));
    for (const name of ["scripts/build-test.mjs", "scripts/test-sdk.json", "plugin.json", "package.json", "events.json"])
      await fs.copyFile(path.join(root, name), path.join(directory, name));
    await fs.symlink(await fs.realpath(path.join(root, "node_modules")), path.join(directory, "node_modules"), "junction");
    return directory;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

for (const mutation of [null, ...mutations]) {
  const name = mutation?.name ?? "baseline";
  const started = performance.now();
  process.stdout.write(`running filesystem integration ${name}\n`);
  const directory = await copyProject();
  try {
    if (mutation) {
      const file = path.join(directory, "ui/editor.js");
      const source = await fs.readFile(file, "utf8");
      assert.equal(source.split(mutation.from).length - 1, mutation.occurrences, `mutation target changed: ${name}`);
      await fs.writeFile(file, source.replaceAll(mutation.from, mutation.to));
    }
    const built = await run(directory, ["scripts/build-test.mjs"]);
    assert.equal(built.code, 0, `the ${name} build failed; this is not mutation evidence`);
    const args = ["--test", "--test-reporter=tap"];
    if (mutation) args.push(`--test-name-pattern=^${mutation.test}$`);
    args.push("test/editor-filesystem.test.mjs");
    const result = await run(directory, args);
    assert.equal(result.signal, null, `the ${name} test was terminated`);
    assert.match(result.output, /# cancelled 0\b/);
    assert.match(result.output, /# skipped 0\b/);
    const cleanups = [...result.output.matchAll(/# filesystem cleanup (\{[^\n]+\})/g)].map((match) => JSON.parse(match[1]));
    assert.equal(cleanups.length, mutation ? 1 : 5, "each integration case must confirm resource cleanup, including a failing case");
    for (const cleanup of cleanups) assert.deepEqual(cleanup, {
      watches: 0, listeners: 0, exitCode: 0, signal: null, temporaryDirectoryRemoved: true,
    });
    if (mutation) {
      assert.equal(result.code, 1, `mutation ${name} escaped the integration test`);
      assert.match(result.output, /# tests 1\b/);
      assert.match(result.output, /# fail 1\b/);
      assert.ok(result.output.includes(mutation.assertion), `mutation ${name} failed outside its behavior assertion`);
      assert.match(result.output, /code: 'ERR_ASSERTION'/);
      assert.match(result.output, /expected: true\s+actual: false/);
      assert.match(result.output, /failureType: 'testCodeFailure'/);
    } else {
      assert.equal(result.code, 0, "the unchanged editor did not pass the integration");
      assert.match(result.output, /# tests 5\b/);
      assert.match(result.output, /# pass 5\b/);
    }
    process.stdout.write(`passed filesystem integration ${name} (${Math.round(performance.now() - started)} ms)\n`);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
