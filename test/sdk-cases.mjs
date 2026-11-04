// The copied core contract cases that a model replays: scripts/test-sdk.json lists, for each SDK export, the case files of
// test/fixtures/contract/ that its model replays, and the replay tests read those files only through this table.
import { readFileSync } from "node:fs";

const table = JSON.parse(readFileSync(new URL("../scripts/test-sdk.json", import.meta.url), "utf8"));

/** The case files that the table lists for the export name, parsed, in the listed order. */
export function contractsOf(name) {
  const entries = table.modules.flatMap(({ exports }) => (Object.hasOwn(exports, name) ? [exports[name]] : []));
  if (entries.length !== 1) throw new Error(`scripts/test-sdk.json lists the export ${name} ${entries.length} times`);
  const [{ cases }] = entries;
  if (cases.length === 0) throw new Error(`scripts/test-sdk.json lists no case file for the export ${name}`);
  return cases.map((file) => JSON.parse(readFileSync(new URL(`./fixtures/contract/${file}`, import.meta.url), "utf8")));
}

/** The cases of the case files that the table lists for the export name, in the listed order. */
export const casesOf = (name) => contractsOf(name).flatMap((contract) => contract.cases);
