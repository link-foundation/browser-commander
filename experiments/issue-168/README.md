# Shared Links Notation dependency and trace compatibility

Issue [#168](https://github.com/link-foundation/browser-commander/issues/168)
reports dependency duplication: a consumer installs Links Notation 0.25.2 while
Browser Commander 0.31.0 requires `^0.23.0`. This is a range compatibility request;
the consumer's browser navigation, privacy and recording controls already pass.

Run from the repository root:

```sh
bash experiments/issue-168/check-consumer.sh
```

The check packs the local package and installs it beside a direct 0.25.2
dependency into a temporary consumer, independently of the repository lockfile.
Lifecycle scripts, dev dependencies and optional native builds are disabled.
It checks the actual resolved lock, module path and `Link` class identity,
then exports the existing conformance bundle through public Browser Commander
APIs and imports the result with both `Parser` and chunked `StreamParser`.
It also checks the file export against the committed cross-language golden
trace. The temporary consumer is removed on success or failure. Security CI
runs this check under its existing ten-minute job budget.

Before the fix, the check exits 1 with two resolved copies: a nested 0.23.0
under Browser Commander and the consumer's root 0.25.2. After changing the
range to `^0.25.2` and updating the lock, it resolves a single root 0.25.2,
and the shared class, golden export, file export and streaming import checks pass.

The focused compatibility tests run from `js/`:

```sh
node scripts/run-tests.mjs --reporter tap \
  tests/unit/traces/links.test.js \
  tests/unit/traces/links-compatibility.test.js \
  tests/unit/traces/conformance.test.js
```

The old dependency fails the updated supported-version assertion. Upgrading
alone passes the existing exporter/conformance tests but fails the new scalar
test with `Reference must be well-formed Unicode text` on a lone surrogate.
Encoding lone surrogates in the existing reversible trace codec fixes that
regression while preserving valid emoji pairs and literal escape sequences.
The scalar corpus also includes empty strings, comment markers, reserved literal
prefixes, both quote types, backticks, backslashes, line endings, tabs, controls,
Unicode whitespace and multilingual text. The streaming test reads the old
golden trace in one-character, 17-character and whole-document chunks.

## Upstream assessment and migration

The npm latest tag was 0.25.2 on 2026-10-11. Compare the maintained
[0.23.0 and 0.25.2 releases](https://github.com/link-foundation/links-notation/compare/js_0.23.0...js_0.25.2).
The APIs used by Browser Commander remain available. The formatter now preserves
exact Unicode references, emits versioned literals for empty/control text and
protects literal-looking references from reinterpretation. The trace codec keeps
its existing quote, backslash and line-ending escapes; only lone surrogate
encoding is added. The existing golden output stays byte-for-byte identical.

Refresh a consumer's lockfile and use `npm dedupe` if it retains an old nested
copy. Upgrade older external Links Notation readers to 0.25.2 for new exports;
empty/control values can now use `~1{UTF-8 hex}`. Existing exports remain readable,
and the bundle schema, trace link fields and `decodeLinkText` calling convention
stay the same. This change updates the JavaScript grammar dependency; Python and
Rust export implementations are unchanged. Their committed conformance fixture
is verified by the JavaScript unit suite.
