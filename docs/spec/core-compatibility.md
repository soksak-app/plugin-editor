# Core compatibility

[한국어](core-compatibility.ko.md)

The editor package uses the view manifest contract of core release candidate `0.0.21`. Its `plugin.json` declares a view composition without `surface.module`, which the published core `v0.0.20` reader refuses. `package.json` therefore declares `engines.soksak: "^0.0.21"`, which admits the current candidate and does not claim compatibility with `0.0.20` or later unverified versions. The package release remains gated on a published core release that carries this contract (E26-1).
