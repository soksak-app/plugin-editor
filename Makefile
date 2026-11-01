# Tests, checks and packs the editor plugin (docs/features.md). pack writes the release with pnpm pack.
.PHONY: install test check pack push-check hooks

# The tests use no SDK package: pnpm test builds the test tree (scripts/build-test.mjs) and runs the plugin tests.
# The installation stage (core docs/spec/plugins.md#repositories): it installs the locked dependencies; the tests, checks and packs consume them without installing.
install:
	pnpm install --frozen-lockfile

test:
	pnpm test

# check runs the SDK checks against the @soksak/plugin-api that package.json names. CORE_PLUGIN_API_DIR selects its source
# and the public checker files in that directory; without it, the installed package and its CLI tools are used.
SDK_EXPOSURE = $(if $(CORE_PLUGIN_API_DIR),node "$(CORE_PLUGIN_API_DIR)/exposure-check.js",pnpm exec soksak-exposure)
SDK_ENGINES = $(if $(CORE_PLUGIN_API_DIR),node "$(CORE_PLUGIN_API_DIR)/engines-check.js",pnpm exec soksak-engines)
SDK_EVENTS = $(if $(CORE_PLUGIN_API_DIR),node "$(CORE_PLUGIN_API_DIR)/events-check.js",pnpm exec soksak-events)
SDK_RECORDS = $(if $(CORE_PLUGIN_API_DIR),node "$(CORE_PLUGIN_API_DIR)/records-check.js",pnpm exec soksak-records)
check:
	CORE_PLUGIN_API_DIR="$(CORE_PLUGIN_API_DIR)" node scripts/check-plugin.mjs
	$(SDK_EXPOSURE)
	$(SDK_ENGINES)
	$(SDK_EVENTS) --census census.json --catalog events.json
	$(SDK_RECORDS)

pack:
	@test -n "$(OUT)" || { echo "make pack OUT=<folder>" >&2; exit 2; }
	pnpm pack --pack-destination $(OUT)

# The check that a push needs: the commit messages of the pushed range, because a published commit message is kept; CI runs
# the tests and checks on the pushed commits.
# RANGE holds the commits of the pushed refs; the pre-push hook sets it, and it defaults to origin/main..HEAD.
push-check:
	pnpm exec soksak-commits "$(or $(RANGE),origin/main..HEAD)"

# Sets this repository to use .githooks, which checks commit messages and records at commit time.
hooks:
	@git config core.hooksPath .githooks
