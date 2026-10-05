# Issue #124 verification

`dependency-audit.py` queries npm, PyPI, and crates.io for every direct
dependency, including development extras and the example/harness manifests.
`dependency-versions.json` records the stable releases available on
2026-10-05. The Python entries also record the latest compatible releases for
3.9, 3.10, and 3.11. Run the audit with Python 3.11 or newer.

`upgrade-dependencies.py` applies the snapshot and resolves Python interpreter
markers; it requires `packaging`. `typescript-api.mjs` is the minimal experiment
for TypeScript 7's virtual-file declaration parser used by the binding generator.

The regression tests and complete engine matrix are listed in
[engine support](../../docs/engine-support.md). The JavaScript tests initially
failed because the shared launcher/dispatcher rejected Selenium and could not
construct engine classes. Python's real Selenium input test initially failed
because an arrow-function readiness probe returned `None`, causing click
verification to call `.get()` on `None`. The fixed tests exercise both callable
probes and legacy WebDriver script bodies.

The jscpd 5 upgrade changes baseline fingerprints: running the new detector on
an isolated copy of the unchanged branch reported 272 clones, including 45
newly recognized fingerprints. The baseline was regenerated against that copy.
Removing the app tests' swallowed startup errors then changed two existing
clone boundaries; those were inspected before refreshing their fingerprints.
The final scan still reports 272 clones and no new clones. Generated app
bundles are excluded from linting, just as they are from duplication checks.

The local Rust compile check and Clippy passed with one build job and debug
information disabled. Full code generation for Chromiumoxide requires more
memory than metadata checking; run browser tests separately from compilation
on a memory-constrained machine. CI runs the full Rust suite and native browser
integrations on dedicated runners.
