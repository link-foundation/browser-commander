# Upstream reports filed for issue #128

Each body in this directory is the text that was filed. Every body includes a
reproduction, a workaround and a suggested fix.

| Project | Issue | Body | Applied here |
| --- | --- | --- | --- |
| command-stream | [#213](https://github.com/link-foundation/command-stream/issues/213): virtual `exit N` writes "Command failed with exit code N" to stderr; `exit 0` rejects under `set -e` | [command-stream-exit-stderr.md](command-stream-exit-stderr.md) | The test exits through `sh -c "exit 7"` (f1c4d1d) |
| rust template | [#185](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/185): doc tests run twice | [rust-template-double-doctest.md](rust-template-double-doctest.md) | The separate doc-test step was dropped from `rust.yml` |
| rust template | [#186](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/186): `min-confidence: medium` hides 12 findings; secretlint unpinned | [rust-template-zizmor-low-confidence.md](rust-template-zizmor-low-confidence.md) | `ci-policy.yml` runs at `low`; secretlint pinned |
| python template | [#95](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/95): `min-confidence: medium` hides 22 findings; secretlint unpinned | [python-template-zizmor-low-confidence.md](python-template-zizmor-low-confidence.md) | Same |
| js template | [#209](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/209): survivor list joined by a literal `\n`; busy-looping SIGTERM test child | [js-template-budget-survivors-and-busy-child.md](js-template-budget-survivors-and-busy-child.md) | `scripts/run-with-budget-warning.sh` prints `\n`; the test child sleeps |
| js template | [#210](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/210): zizmor 1.29.0 and 1.30.0 in one job; secretlint unpinned | [js-template-zizmor-split-and-secretlint-pin.md](js-template-zizmor-split-and-secretlint-pin.md) | zizmor-action v0.6.4 with 1.30.1 everywhere, held by `zizmor-version.test.js` |

The supporting logs are in `../reproductions/`:
`command-stream-exit-variants.log`, `zizmor-action-unknown-version.log`,
`js-template-group-members-literal-newline.log`,
`zizmor-low-confidence-{before,after}.log` and `secretlint-planted-secret.log`.
