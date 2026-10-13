# Tests and packs the editor plugin (docs/features.md). pack uses the sok of core.
.PHONY: test pack hooks

SOK ?= sok
# DIAGNOSTICS=1 packs a diagnostics package that holds diagnostics.json.
PACK_FLAGS = $(if $(DIAGNOSTICS),--diagnostics,)

# The tests use the @soksak/plugin-api of the core release that package.json names.
node_modules: package.json
	pnpm install
	touch node_modules

# soksak-exposure checks the exposure names of the page against plugin.json and the core declarations, and
# soksak-engines checks that engines.soksak admits the core release of that @soksak/plugin-api, and soksak-events checks
# that every source of occurrences records an event or states a reason, and that the emit sites match events.json.
test: node_modules
	pnpm test
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
