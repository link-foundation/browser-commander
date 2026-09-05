# Existing components that solve these problems

Requirement R-19 of the issue is to "check online for known existing
components/libraries that solve a similar problem or can help". This file is
the answer, organised the way the decision actually has to be made: for each
root cause in `root-causes.md`, what already exists, whether this repository
uses it, and — where it does not — the specific reason, so the next person does
not have to rediscover it.

The short version: **thirteen of the seventeen root causes have an off-the-shelf
component, and twelve of those are now wired into the pipeline.** The four that
do not (RC-1, RC-3, RC-16, RC-17) are not gaps in the ecosystem; they are places
where the generic tool cannot know a repository-specific fact.

---

## 1. Adopted, and what each one catches

| Need | Component | Where it runs | What it caught here |
| --- | --- | --- | --- |
| Lint the workflows themselves | [`actionlint`](https://github.com/rhysd/actionlint) 1.7.7, via `docker://rhysd/actionlint:1.7.7` | `ci-policy.yml` | RC-6, RC-5. The Docker image bundles **shellcheck** and **pyflakes**, so it also lints every `run:` block — that is what surfaced the unquoted expansions of RC-5 (SC2086). |
| Audit the workflows for security | [`zizmor`](https://docs.zizmor.sh) via `zizmorcore/zizmor-action@v0.6.2` | `ci-policy.yml` | RC-6, RC-10. 41 audits; the ones that fired here were template injection, `unpinned-uses` and `artipacked` (`persist-credentials`). |
| Static analysis of the code | [CodeQL](https://codeql.github.com) `github/codeql-action@v4` | `security.yml` | RC-8 — nothing audited anything before. |
| Published advisories | `npm audit`, [`cargo-audit`](https://github.com/rustsec/rustsec) 0.22.2 via `taiki-e/install-action`, `pip-audit` | `security.yml` | RC-8. `cargo audit` and the Python audit ran nowhere at all. |
| Dependency review on pull requests | `actions/dependency-review-action@v5` | `security.yml` | RC-11 — it *cannot* run here (the dependency graph is disabled for the repository), which is why the step now emits an explicit `::warning` instead of a silent skip. |
| Secret detection | [`secretlint`](https://github.com/secretlint/secretlint) with `@secretlint/secretlint-rule-preset-recommend` | `quality.yml` | Best practice #11; no finding, but the gate exists now. |
| Link checking | [`lychee`](https://github.com/lycheeverse/lychee) via `lycheeverse/lychee-action@v2` | `links.yml` | RC-13 — lychee was already there; the false positive was in *our* parsing of its Markdown report, not in lychee. |
| Copy-paste detection | [`jscpd`](https://jscpd.dev) 5.1.2 with a 252-fingerprint baseline | `js.yml`, pre-commit | RC-4. See §3 for the claim about `--fail-on-new-clones` that turned out to be wrong. |
| Local gates before push | [`pre-commit`](https://pre-commit.com) | `.pre-commit-config.yaml` | RC-14. Replaces the husky install that could never see `.git` from `js/`. |
| Release notes / versioning (JS) | [Changesets](https://github.com/changesets/changesets) | `js/.changeset` | Best practice #6. |
| Release notes / versioning (Python) | [`scriv`](https://scriv.readthedocs.io) | `python/pyproject.toml` | Best practice #6 — and the `[tool.scriv]` table it adds is exactly what broke the version scrape of RC-1. |
| Lint everything, not just `js/` | ESLint flat config at the repository root re-exporting `js/eslint.config.js` | `quality.yml` `repo-scripts-lint` | RC-15. |

## 2. Considered and not adopted

### `re-actors/alls-green` — the closest thing to `check-pipeline-status.sh`

[`re-actors/alls-green`](https://github.com/re-actors/alls-green) exists for
precisely the shape of RC-16's *first half*: it takes a JSON-serialised `needs`
context and fails the gate job when a dependency did not succeed, instead of
letting the gate inherit "skipped" and leave branch protection satisfied. Its
README describes the problem in the same terms this repository hit it.

It is not adopted, for two reasons that are specific to what RC-16 turned out to
be:

1. **The interesting case here is `cancelled`, not `failure`.** A job killed by
   `timeout-minutes` is reported *cancelled*, and a run whose only casualty is a
   cancelled job is itself filed under `cancelled` — run `24045269874` of this
   repository is one. `alls-green` votes on success; treating every
   cancellation as a failure would turn every user-pressed *Cancel workflow*
   and every `concurrency` supersede on a branch into a red check.
2. **Telling an overrun from a supersede needs a fact `needs` does not carry.**
   `check-pipeline-status.sh` resolves it with
   `git ls-remote origin refs/heads/main`: a cancellation on the default branch
   is an error *unless* the branch head has already moved past `RUN_SHA`, in
   which case a newer run took over and the cancellation was correct. No action
   that reads only the `needs` context can make that distinction, because the
   distinguishing evidence is outside the run.

The seven cases in `js/tests/unit/scripts/check-pipeline-status.test.js` pin
the four readings that follow from that, including the deliberate choice that an
*unresolvable* branch head fails loudly rather than guessing.

### `technote-space/workflow-conclusion-action`

Reads the whole workflow conclusion into `env.WORKFLOW_CONCLUSION` and does
distinguish `cancelled` and `timed_out` from `failure`, which is more than
`alls-green` offers. Not adopted: it was **archived by its owner on 16 November
2023** and is read-only, so adopting it would add an unmaintained third-party
action to the one job whose whole purpose is to be trustworthy. It also needs a
token and an API round-trip for information the `needs` context already has.

### `osv-scanner`

Would overlap `npm audit` + `cargo audit` + `pip-audit` with a single scanner
across all three lockfiles. Not adopted in this pull request because the three
native auditors were the ones the templates already carried and the ones whose
absence was the actual defect (RC-8); replacing three working gates with one new
one is a separate change with its own failure modes. Worth revisiting — it would
collapse three jobs into one and give SARIF output for free.

### `timeout(1)` for the step budgets

The obvious component for "give a step a deadline" is GNU coreutils `timeout`,
and `scripts/run-with-budget-warning.sh` deliberately mimics its interface (exit
124 on expiry). It is not used directly because it kills only the direct child:
a test runner's workers survive and keep holding the runner. The wrapper uses
`set -m` to put the command in its own process group and signals the group, and
the test *"kills the whole process group, not just the direct child"* in
`js/tests/unit/scripts/run-with-budget-warning.test.js` is the regression guard
for that difference. `timeout --foreground --kill-after` still does not solve
it, because the process group is the unit that has to die.

`timeout` also cannot warn. `BUDGET_WARN_PERCENT` (70%) exists so a step that is
*approaching* its budget says so while it is still green — the alternative is
learning about it from a red check weeks later.

### GitHub's own `timeout-minutes`

It *is* the backstop, and every long job has one. It cannot be the deadline,
because the thing it produces — a cancelled job — is what RC-16 is about. The
invariant in `js/tests/unit/scripts/ci-timeout-budgets.test.js` is that no step
budget may exceed 70% of its job's backstop, so the budget (which fails red)
always fires first and the backstop (which cancels) stays a last resort.

### `actionlint` for the policies in `scripts/check-ci-workflows.mjs`

Asked directly: actionlint's [checks](https://github.com/rhysd/actionlint/blob/main/docs/checks.md)
cover syntax, expression typing, `needs` cycles, event/cron/glob validity,
runner labels, permissions, deprecated commands and script injection — but *not*
`timeout-minutes` values, not job-result gating through `needs`/`if`, and not
concurrency scope. Those three are the repository's own policies, so they live
in `scripts/check-ci-workflows.mjs` (10 rule groups, each now its own function)
and in the two unit test files above. This is the intended division: actionlint
and zizmor for what is true of all workflows, the local checker for what is true
of *these* workflows.

## 3. One claim that did not survive testing

The draft upstream report list included a fifth entry against **jscpd**: that
`--fail-on-new-clones` reports a count of new clones and never names them, so
the only way to act on it is to diff the JSON report.

That is false. `experiments/ci-repro/check-jscpd-new-clone-reporting.mjs` builds
a baseline from two duplicated files, adds a third-and-fourth that duplicate
each other, and runs the gate:

```
exit status: 1 (expected 1)
clones marked [NEW]: 1 (expected 1)
Clone found (javascript) [NEW]
 - src/c.js [1:1 - 10:2] (10 lines, 71 tokens)
   src/d.js [1:1 - 10:2]
PASS: the failing clone is named, not only counted
```

The same marking is in this repository's own failing run, at
`ci-logs/js-33962524078-failed.log:746`. The `ERROR: jscpd found 2 new clones`
line is a summary of a listing printed above it, not a replacement for one. The
report was withdrawn. The experiment is kept, because the listing comes from the
`console` reporter configured in `js/.jscpd.json`: dropping it from `reporters`
would leave only the count, and the script would say so.

## 4. Root causes with no off-the-shelf answer

| Root cause | Why no component fits |
| --- | --- |
| RC-1 / RC-3 — reading and writing a version in a manifest | The defect is `grep -Po '(?<=^version = ")[^"]*'` matching `version` in *every* TOML table, including `[tool.scriv]`. A TOML library fixes it, and `python/scripts/read_manifest.py` uses `tomllib` where it can — but the release job reads the version *before* installing anything, and has to run on Python 3.9 where `tomllib` does not exist. `scripts/read-manifest.mjs` and its Python twin therefore implement the table-tracking subset the manifests actually use, and fail loudly on anything else rather than emitting a wrong version. |
| RC-16 — the timeout that was not a failure | §2: the supersede lookup needs evidence outside the run. |
| RC-17 — CRLF on `windows-latest` | `actions/checkout` honours `core.autocrlf` on Windows, so tests that assert on file *content* see `\r\n`. The fix is a repository-local reader (`readRepoText()` / `normalizeNewlines()` in `js/tests/helpers/repo.js`); `.gitattributes` would fix the checkout but silently change what contributors on Windows have in their working trees. |

## 5. Sources

- [re-actors/alls-green](https://github.com/re-actors/alls-green)
- [technote-space/workflow-conclusion-action](https://github.com/technote-space/workflow-conclusion-action) (archived 16 November 2023)
- [actionlint checks](https://github.com/rhysd/actionlint/blob/main/docs/checks.md)
- [zizmor audits](https://docs.zizmor.sh/audits/)
- [jscpd](https://jscpd.dev)
- [lychee](https://github.com/lycheeverse/lychee)
- [secretlint](https://github.com/secretlint/secretlint)
- [pre-commit](https://pre-commit.com)
- [Changesets](https://github.com/changesets/changesets), [scriv](https://scriv.readthedocs.io)
- [RustSec `cargo-audit`](https://github.com/rustsec/rustsec)
