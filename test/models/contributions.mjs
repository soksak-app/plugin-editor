// The stand-in of resolveContributions for the view page. core publishes no contract case for this function, so the model
// answers the empty installed record that the tests of the view page provide, and refuses every other record. The gap is
// listed in scripts/test-sdk.json.
export function resolveContributions(plugins) {
  if (!Array.isArray(plugins) || plugins.length !== 0) {
    throw new Error("resolveContributions: the test model answers the empty installed record only; core publishes no case for other records");
  }
  return [];
}
