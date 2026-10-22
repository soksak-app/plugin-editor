# Tests, checks and packs the editor plugin (docs/features.md). pack uses the sok of core.
.PHONY: test check pack hooks

SOK ?= sok
# DIAGNOSTICS=1 packs a diagnostics package that holds diagnostics.json.
PACK_FLAGS = $(if $(DIAGNOSTICS),--diagnostics,)

# The tests use no SDK package: pnpm test builds the test tree (scripts/build-test.mjs) and runs the plugin tests.
node_modules: package.json
	pnpm install
	touch node_modules

test: node_modules
	pnpm test

# check runs the SDK checks: the manifest, the view page and the copied contract cases against the @soksak/plugin-api that
# package.json names (CORE_PLUGIN_API_DIR overrides its packages/plugin-api source), then the SDK tools. soksak-exposure
# checks the exposure names of the page against plugin.json and the core declarations, soksak-engines checks that
# engines.soksak admits the core release of that @soksak/plugin-api, soksak-events checks that every source of occurrences
# records an event or states a reason, and soksak-records checks the records.
check: node_modules
	node scripts/check-plugin.mjs
	pnpm exec soksak-exposure
	pnpm exec soksak-engines
	pnpm exec soksak-events --census census.json --catalog events.json
	pnpm exec soksak-records

pack:
	@test -n "$(OUT)" || { echo "make pack OUT=<folder>" >&2; exit 2; }
	$(SOK) plugin pack . $(OUT) $(PACK_FLAGS)

# Sets this repository to use .githooks, which checks commit messages and records at commit time.
hooks:
	@git config core.hooksPath .githooks
