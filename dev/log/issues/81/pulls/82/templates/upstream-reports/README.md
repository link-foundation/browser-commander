# Upstream reports filed against the pipeline templates

Issue #81 asks that a defect found in the templates be reported there too. This
directory holds the body of every report that was filed, so the reasoning stays
in this repository even if an upstream issue is edited or closed.

Every claim in these bodies was executed before it was written: the
reproduction was run, and the suggested fix was run at least once. The clones
used were `js` at `338fafa`, `python` at `81c9786` and `rust` at `4d444d9`.

## Filed

| File | Issue | Defect |
| --- | --- | --- |
| `python-version-scrape.md` | [python#67](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/67) | The line-anchored `version` grep matches that key in *every* TOML table, so a `pyproject.toml` with a `[tool.*]` version publishes the wrong number |
| `rust-manifest-scrape.md` | [rust#155](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/155) | `find_manifest_value` (`scripts/rust-paths.rs:253`) has the same table-blindness, and fails silently with a wrong version rather than loudly |
| `python-audit-dependencies.md` | [python#68](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/68) | `venv` seeds pip into the audited environment, so `pip-audit --path` reports pip's own advisories as project vulnerabilities; `check=True` with a captured stdout then throws away the advisory table on exactly the failing run |
| `js-husky-hooks.md` | [js#166](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/166) | husky 9.1.7 returns its errors as text and exits 0, so `"prepare": "husky"` reports success after installing no hooks at all |
| `js-pipeline-status-gate.md` | [js#167](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/167) | `check-pipeline-status.sh` is wired into one workflow (false negative), and cannot tell a `timeout-minutes` overrun from a `cancel-in-progress` supersede (false positive if copied as-is) |
| `python-pipeline-status-gate.md` | [python#69](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/69) | the same two gaps, with that repo's workflow list and line numbers |
| `rust-pipeline-status-gate.md` | [rust#156](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/156) | the same two gaps, plus a missing success echo |

## Reported outside the templates

RC-2 is not a template defect — it is a `use-m` one, and it was already open as
[link-foundation/use-m#72](https://github.com/link-foundation/use-m/issues/72)
with the exact code location and the one-line fix. Rather than restate that, we
[added the fact the existing report got wrong](https://github.com/link-foundation/use-m/issues/72#issuecomment-5552037466):
the boundary is Node **23**, not "Node ≥ 22.12", so a regression test pinned at
22.12 would pass and still miss this. Measured on the published `use-m`
(v20.20.2 and v22.23.2 fine, v23.11.1 and v24.20.0 broken) and, independently of
`use-m` and `command-stream`, on Node itself:

```
$ npx --yes node@22 probe.mjs   →  v22.23.2 ["default"]
$ npx --yes node@23 probe.mjs   →  v23.11.1 ["default","module.exports"]
```

`experiments/ci-repro/node-module-exports-namespace-boundary.mjs` is that
probe.

## Withdrawn before filing

Two further drafts were dropped. Filing them would have added the false
positives this issue exists to remove.

- **jscpd `"format": "console"` in the js template.** Real, but already open as
  [js#157](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/157)
  (and previously js#126). Caught by listing every issue in all three repos
  before filing.
- **"The templates hide zizmor findings."** Triage showed the hidden findings
  are not defects: python's 23 `template-injection` hits are all
  `steps.python_layout.outputs.root`, whose only values are the literals `.`
  and `python`; rust's 2 `artipacked` hits are release-writer checkouts that
  must hold the token because they push; js's 25 are already
  [js#160](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/160).
  See `../../analysis/existing-solutions.md` §3b.
