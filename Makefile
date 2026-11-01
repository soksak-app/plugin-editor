# Tests, checks and packs the editor plugin (docs/features.md). pack writes the release with pnpm pack.
.PHONY: install test check pack push-check hooks

# The tests use no SDK package or kit: pnpm test builds the test tree (scripts/build-test.mjs) and runs the plugin tests.
# The installation stage (core docs/spec/plugins.md#repositories): it installs the locked dependencies; the tests, checks and packs consume them without installing.
install:
	pnpm install --frozen-lockfile

test:
	pnpm test

# check runs the checks of the kit releases that package.json pins: soksak-events counts the records missing from the sources
# and matches events.json with the emit sites, and soksak-records checks the records. The application validates plugin.json
# when it installs the release, and the registry check compares the exposed names of the release with each listed core.
check:
	pnpm exec soksak-events --census census.json --catalog events.json
	pnpm exec soksak-records

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
