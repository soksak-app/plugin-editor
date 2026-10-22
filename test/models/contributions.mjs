// Behavior model of resolveContributions for the view page: the connected items of the installed plugins, one entry for each
// item that a plugin contributes. The states follow core's contributions.json: connected, provider-missing (the provider is
// not installed), invalid (the provider declares no such extension point, or the item does not match its schema) and
// version-mismatch (the range does not contain the version of the extension point). Items are sorted by plugin id, point
// and index. The conformance test replays test/fixtures/contract/contributions.json.
import Ajv from "ajv";
import { satisfies } from "semver";

const ajv = new Ajv();

/** The module URL of a connected item: the path of its module in the package on the core root. */
const moduleOf = (plugin, module) => `/modules/${plugin.package}/${module}`;

export function resolveContributions(installed) {
  if (!Array.isArray(installed)) throw new TypeError("resolveContributions requires the installed plugins as an array");
  const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
  const sorted = [...installed].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const output = [];
  for (const plugin of sorted) {
    const contributes = plugin.manifest.contributes ?? {};
    for (const point of Object.keys(contributes).sort()) {
      const [providerId, ...parts] = point.split(".");
      const name = parts.join(".");
      contributes[point].forEach((entry, index) => {
        const base = { plugin: plugin.id, point, index };
        const provider = byId.get(providerId);
        if (!provider) {
          output.push({ ...base, state: "provider-missing", reason: `plugin ${providerId} is not installed or not enabled` });
          return;
        }
        const declared = provider.manifest.extends?.[name];
        if (!declared) {
          output.push({ ...base, state: "invalid", reason: `${provider.id} ${provider.version} declares no extension point ${name}` });
          return;
        }
        if (!satisfies(declared.version, entry.range)) {
          output.push({ ...base, state: "version-mismatch",
            reason: `range ${entry.range} does not contain ${point} ${declared.version}` });
          return;
        }
        const { range: _range, module, ...fields } = entry;
        if (!ajv.validate(declared.schema, fields)) {
          output.push({ ...base, state: "invalid", reason: `item does not match the schema of ${point}` });
          return;
        }
        output.push({ ...base, state: "connected", reason: null, provider: provider.id, item: fields,
          module: moduleOf(plugin, module) });
      });
    }
  }
  return output;
}
