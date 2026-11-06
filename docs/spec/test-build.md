# Test build

[한국어](test-build.ko.md)

`scripts/build-test.mjs` owns the prohibition on SDK package names in test sources. The test command runs this build before executing the tests. `test/build-test.test.mjs` runs the unchanged builder in temporary fixtures: declared UI imports resolve to local models, consumer tests import the built UI, prohibited scoped and legacy SDK imports fail, and an undeclared UI dependency fails. Fixture files and outputs are removed after each case.

The source rules in `test/sources.test.mjs` retain their independent checks: direct UI imports (including dynamic imports), resolver hooks, shared-module use and the view host's SDK-file boundary. They do not repeat the builder's SDK-name scan.
