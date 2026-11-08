// Start state of the window checks of this plugin (core docs/spec/plugins.md#window-checks-of-a-plugin). The run installs this plugin
// from its own packed release into each published application (scripts/test-app.mjs), with the fixture plugins of e2e/fixtures and no
// other real plugin. prepareFixture of @soksak/window-check opens the new-space layout that the environment of the application declares
// (workspace.grid); its tabs that name a plugin that the configuration does not load open as placeholders, and the preparation replaces
// each by a tab of START_PLUGIN in the same card, so the start tab is the active tab of the focused card.
import { keepCommonSettings, prepareFixture, TRACE } from "@soksak/window-check/app.mjs";
import { recordCatalog } from "@soksak/window-check/catalog.mjs";

/**
 * The plugin of the start tab: the start probe of e2e/fixtures/start-probe. A view measurement opens the views of the plugin under check
 * from a card that holds a tab of another plugin and counts the views of that plugin, so no start tab is a tab of it.
 */
export const START_PLUGIN = "startprobe";

/** The entries that a start tab has registered when it is ready for a check. */
export const START_ENTRIES = Object.freeze(["status startprobe.view"]);

/** The declaration `{ catalog, records }` of a wait on the records that a predicate reads. */
export const reading = (app, records) => ({ catalog: recordCatalog(app.configDir), records });

/**
 * The tabs of the layout `grid` (core.grid) that `surfaces` (core.surfaces) report as placeholders, as `{card, tab, plugin}` in the
 * order of the cards and their tabs.
 */
export function placeholderTabs(grid, surfaces) {
  const placeholders = new Set(surfaces.filter((row) => row.kind === "tab" && row.placeholder != null).map((row) => row.surface));
  return (grid?.cards ?? []).flatMap((card) => (card.tabs ?? []).filter((tab) => placeholders.has(tab.id))
    .map((tab) => ({ card: card.id, tab: tab.id, plugin: tab.plugin })));
}

/** Replaces every placeholder tab of the start layout by a tab of START_PLUGIN in its card; the new tab is added before the close. */
export async function replacePlaceholders(s) {
  for (const { card, tab } of placeholderTabs(await s.get("core.grid"), await s.get("core.surfaces"))) {
    await s.run("core.card.add-tab", { card, plugin: START_PLUGIN });
    await s.run("core.tab.close", { tab });
  }
}

/** Waits until the active tab of the focused card is a ready START_PLUGIN tab that registered START_ENTRIES and returns it. */
export async function startTab(s) {
  const grid = await s.get("core.grid");
  const focused = grid?.cards.find((card) => card.focused);
  const active = focused?.tabs?.find((tab) => tab.id === focused.active);
  if (active?.plugin !== START_PLUGIN) {
    throw new Error(`the focused card of the start layout holds no active ${START_PLUGIN} tab: ${JSON.stringify(grid?.cards ?? null)}`);
  }
  await s.until("core.surfaces", (surfaces) => surfaces.some((row) => row.surface === active.id && row.visible && row.status?.phase === "ready"),
    `the start tab ${active.id} did not become ready`);
  await s.registered(active.id, START_ENTRIES);
  return { surface: active.id, plugin: START_PLUGIN };
}

/**
 * Puts a card-left sidebar on the focused card. With `sections` it first stores a common list set `check-sections` of those sections;
 * without, it links `set`. keepCommonSettings restores the sets and the links when the check ends. Returns the id of the sidebar.
 */
export async function cardSidebar(s, { set, sections } = {}) {
  const id = set ?? "check-sections";
  await keepCommonSettings(s);
  if (sections !== undefined) {
    const sets = (await s.get("core.settings")).values.sets;
    await s.run("core.settings.set", { patch: { sets: [...sets, { id, title: "검사", sections, layout: "list" }] }, scope: "common" });
  }
  await s.run("core.settings.link", { place: "card-left", plugin: START_PLUGIN, set: id, scope: "common" });
  const card = (await s.get("core.grid")).cards.find((item) => item.focused);
  const sidebar = `${card.id}:left`;
  await s.until("core.sidebars", (value) => value.some((item) => item.sidebar === sidebar && item.set === id),
    `the card sidebar ${sidebar} did not show the set ${id}`);
  return sidebar;
}

/**
 * Puts the window in the start state of a check and returns the start tab `{surface, plugin}`. `log` is the log policy that the check
 * declares and `reads` the records below `error` that it reads (prepareFixture).
 */
export async function fresh(s, { performanceTrace = TRACE, settings = {}, log = {}, reads = [] } = {}) {
  await prepareFixture(s, { settings, performanceTrace, log, reads, catalog: reads.length ? recordCatalog(s.app.configDir) : undefined });
  await replacePlaceholders(s);
  const tab = await startTab(s);
  await s.presented();
  return tab;
}
