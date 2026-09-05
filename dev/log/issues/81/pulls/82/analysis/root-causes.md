# Root causes and fixes

One row per defect. "Class" separates the four things the issue asks about: an
**error** fails a job, a **false negative** is a green check that proved
nothing, a **false positive** would fail a job for something that is not a
defect, and a **warning** is noise that hides the other three.

| # | Class | Defect | Commit |
| --- | --- | --- | --- |
| RC-1 | error | Version scraped out of `pyproject.toml` with a table-blind `grep` | `a120542` |
| RC-2 | error | `use('command-stream')` returns a CommonJS namespace; `{ $ }` is `undefined` | `e69dec4` |
| RC-3 | error | Unscoped `re.sub` in `version_and_commit.py` rewrote the wrong `version` | `a120542` |
| RC-4 | false negative | The duplication gate analysed 0 files and exited 0 | `aef985b` |
| RC-5 | warning | 9 unquoted `>> $GITHUB_OUTPUT` redirects (SC2086) | `a120542` |
| RC-6 | false negative | No workflow-level `permissions:`, 39 zizmor findings, no workflow linting at all | `8fb54a9`, `94fbacc` |
| RC-7 | false negative | `|| true` masked a Prettier failure in the release job | `846afe5` |
| RC-8 | false negative | No dependency audit and no static analysis anywhere | `a9a4064` |
| RC-9 | false positive | The adopted Python audit failed on an advisory against `pip` itself | `a9a4064` |
| RC-10 | false positive | zizmor audited frozen case-study snapshots of upstream templates | `eec0f3b` |
| RC-11 | error | Dependency Review ran against a repository with the dependency graph off | `eec0f3b` |
| RC-12 | false positive | A Windows-only `ENOENT` from the duplication test's `node_modules/.bin` shim | `eec0f3b` |
| RC-13 | false positive | The link checker read URLs out of lychee's *redirects* section, and failed on a `502` | `60c2940` |
| RC-14 | false negative | The pre-commit hooks were never installed: husky failed and `\|\| true` hid it | `d2c4819` |
| RC-15 | false negative | `scripts/`, `experiments/` and `rust/scripts/` had no linter at all | `d2c4819` |
| RC-16 | false negative | A job killed by `timeout-minutes` is reported *cancelled*, and nothing failed the run | `d0ff981` |
| RC-17 | false positive | A test matched `run: <command>\n` against a repository checked out with CRLF | `70b5054` |

---

## RC-1 — a line-oriented read of a structured file

```
##[error]Unable to process file command 'output' successfully.
##[error]Invalid format 'literal: pyproject.toml: project.version'
```
— `../ci-logs/failed-33920348247.log:340`

The step ran

```sh
CURRENT_VERSION=$(grep -Po '(?<=^version = ")[^"]*' pyproject.toml | head -1)
```

`pyproject.toml` declares `version` twice: under `[project]` (the package
version) and under `[tool.scriv]` (the literal `"literal: pyproject.toml:
project.version"`). The regex is anchored to the start of a line but knows
nothing about TOML tables, so it matched both. `$GITHUB_OUTPUT` rejects a
multi-line value, and the step died before the release could start.

`head -1` does not fix this — it only makes the result depend on which table
happens to come first in the file. `Cargo.toml` has the same shape: `name`
appears under `[package]`, `[lib]` and `[[bin]]`.

**Fix.** `scripts/read-manifest.mjs` and `python/scripts/read_manifest.py` parse
the manifest and address a field by its table path (`project.version`,
`package.name`), and write to `$GITHUB_OUTPUT` through `--output` so the value
is written once, quoted. `python/scripts/version_and_commit.py` uses the same
reader for the write path. Both readers have unit tests that first reproduce the
duplicate-key manifest and assert the old `grep` returned two matches.

**Prevention.** `scripts/check-ci-workflows.mjs` now fails any workflow whose
`run:` body mentions `pyproject.toml` or `Cargo.toml` together with
`grep`/`sed`/`awk`/`cut` and `version`/`name`.

## RC-2 — an unpinned dependency changed its module system

```
Error updating npm: $ is not a function          (JS, failed-33920348338.log:247)
Error: $ is not a function                       (Rust, failed-33920348349.log:540)
```

`js/scripts/setup-npm.mjs` and 13 other release scripts did

```js
const { $ } = await use('command-stream');
```

`use-m` resolves a package with `createRequire(...).resolve` and imports the
resolved file. `command-stream@0.19.0`, published 2026-08-11T11:28:40Z, moved
its `require` entry from `./src/$.mjs` to `./src/$.cjs`
(`raw-repro-evidence.txt` §2). From that release on, use-m imports a **CommonJS**
file, and the namespace of a CommonJS module carries only the names
`cjs-module-lexer` can infer.

Measured with `experiments/ci-repro/repro-command-stream-dollar.mjs`:

```
v20.20.2   32 keys                          typeof module.$ : function   OK
v22.21.1   32 keys                          typeof module.$ : function   OK
v24.20.0   2 keys [default, module.exports] typeof module.$ : undefined  REPRODUCED
```

Node 23+ adds a synthetic `'module.exports'` named export to such namespaces
(<https://nodejs.org/api/esm.html#commonjs-namespaces>). use-m unwraps a
namespace only when every key is a known metadata key, and `'module.exports'` is
not in that set, so on Node 24 — which every workflow here requests — it hands
back the un-unwrapped namespace. The upstream release and the Node version had
to line up for the failure to appear, which is why it arrived without any change
to this repository.

**Fix.** `scripts/use-module.mjs` normalises the namespace (`ns`, `ns.default`,
`ns['module.exports']`, `ns.default.default`), and when nothing callable is
found raises an error naming the keys it did see instead of the opaque `$ is not
a function`. All 14 call sites in `js/scripts` and `rust/scripts` use it.

**Coverage.** `use-module.test.js` pins each namespace shape,
`use-module-adoption.test.js` fails if a script goes back to calling `use()`
directly, and `use-module-integration.test.js` loads the real package through
the real use-m on the running Node version, so the next upstream change of this
kind fails a pull request rather than a release.

**Upstream.** Tracked at <https://github.com/link-foundation/use-m/issues/72>.

## RC-3 — the mirror image, on the write path

`version_and_commit.py` bumped the version with an unscoped
`re.sub(r'^version = ".*"', ...)`, which rewrites *every* `version` line —
including the scriv literal. The release that RC-1 stopped would have corrupted
`pyproject.toml` had it proceeded. Same fix, same tests.

## RC-4 — a gate that never read any code

`.jscpd.json` set `"format": "console"`. In jscpd, `format` selects the *file
formats to scan*, not the reporter. No file has the extension `console`, so
`npm run check:duplication` analysed 0 files, found 0 clones and exited 0 on
every commit. `"skipComments": true` was not a jscpd key either.

**Fix.** `reporters: ["console"]`, `mode: "weak"`, and the formats left to
jscpd's defaults; `js/.jscpd-baseline.json` ratchets the clones that exist today
so the gate fails only on *new* duplication.
`js/tests/unit/scripts/jscpd-config.test.js` asserts the config keys and then
runs jscpd over a one-file fixture, asserting `statistics.total.sources > 0` —
reverting the config fails three of its four tests.

## RC-5 — SC2086

Nine `echo "..." >> $GITHUB_OUTPUT` redirects were unquoted. Word-splitting on
`$GITHUB_OUTPUT` is only latent today, but shellcheck flags it and nothing was
running shellcheck. Quoted in `a120542`; `actionlint` (which bundles shellcheck)
now runs in CI, so it cannot come back.

## RC-6 — the workflows themselves were never linted

No workflow declared a top-level `permissions:` block, so every job ran with the
repository's default token scopes. `zizmor 1.30.0` reported **39** findings
across the pipeline workflows (`excessive-permissions`, `unpinned-uses`,
`template-injection`).

**Fix.** `contents: read` at the top of each workflow with the release jobs
opting into what they need; every third-party action hash-pinned (13 sites, with
`toolchain:` and `tool:` inputs added where the action's behaviour came from the
ref name); `${{ github.event.inputs.* }}` moved out of `run:` bodies into `env:`
at 5 sites. `.github/zizmor.yml` records the pinning policy.

**Prevention.** `ci-policy.yml` gained `actionlint` and `zizmor` jobs, and
`check-ci-workflows.mjs` gained a rule that rejects free-form workflow inputs
interpolated into shell bodies.

## RC-7 — a mask on a real failure

The changeset job ran `npx prettier --write ".changeset/*.md" || true`. The
mask did not prevent the failure, it only moved it: the malformed changeset
went into a pull request, where the format check failed instead — with the
cause one job removed from the symptom. The `|| true` is gone.

## RC-8 — nothing audited anything

`npm audit` ran only as an advisory line inside the JS release job; `cargo
audit` and any Python audit ran nowhere; no static analysis was configured.
Three npm advisories were sitting in the committed lock file (cleared by `npm
audit fix --package-lock-only`, which touched only `@humanfs`, `linkify-it` and
`markdown-it`). `.github/workflows/security.yml` now runs a lock-file audit per
language directory, CodeQL over `javascript-typescript`, `python`, `rust` and
`actions`, and a dependency review on pull requests — weekly as well as on push,
because a new advisory against an unchanged lock file produces no push.

## RC-9 — the audit's own false positive

The Python audit adopted from the template resolved the project into a venv
built by `python -m venv`, which installs `pip`. `pip-audit` then reported
**PYSEC-2026-3721 against pip itself** and failed the job for a package this
repository neither declares nor ships — precisely the false positive the issue
asks to eliminate. The target environment is now built `--without-pip` and
filled through `pip --python`, so the audited surface is exactly the declared
dependency closure. A second defect in the same script hid the evidence:
`run()` captured stdout, and `subprocess.run(check=True)` raises before captured
text is printed, so the failing run logged an exit status and no advisory table.
Output is streamed now. Both are covered by
`python/tests/unit/scripts/test_audit_dependencies.py`.

## RC-10 — an audit pointed at evidence it was never allowed to change

`ci-policy.yml` ran `zizmorcore/zizmor-action` with its default `inputs: .`,
which walks the whole checkout. Under
`docs/case-studies/issue-55/template-snapshots/` this repository keeps frozen
copies of the four upstream pipeline templates' workflows, committed as evidence
for a case study. They never run. zizmor audited them anyway:

```
30 warning[excessive-permissions]
29 error[unpinned-uses]
19 error[template-injection]
 4 error[excessive-permissions]
```

— `../templates/zizmor-template-snapshot-findings.txt`, by file:

| snapshot | findings |
| --- | --- |
| `rust/.github/workflows/release.yml` | 30 |
| `csharp/.github/workflows/release.yml` | 22 |
| `js/.github/workflows/release.yml` | 19 |
| `python/.github/workflows/release.yml` | 13 |
| `python/.github/workflows/docs.yml` | 2 |
| `csharp/.github/workflows/docs.yml` | 2 |

The job was unfixable by construction: editing a snapshot to satisfy the audit
destroys the thing the snapshot records, and not editing it leaves the job red
forever. Local runs were clean the whole time, because they were run against
`.github/workflows` — the divergence between the local command and the CI
command is what let this ship.

**Fix.** `inputs: .github/workflows`, with the reason and the reproducing
command written next to it in `ci-policy.yml`. The repository's own workflows
are still audited at `--min-confidence medium`.

**Where the findings belong.** Upstream. They are real defects in the templates
the issue asks this repository to adopt from, so the catalogue above is the
evidence for the template issue reports; see `requirements.md`.

## RC-11 — a check that this repository cannot satisfy

```
Dependency review is not supported on this repository.
Please ensure Dependency graph is enabled
```

`actions/dependency-review-action` needs the repository's Dependency graph
feature, which is off for `link-foundation/browser-commander`. Measured with the
same token: the SBOM endpoint answers 404 here and 200 for a sibling public
repository in the same organisation, and `dependency-graph/compare` answers 403.
No change inside the repository can turn it on — it is a settings toggle — so
the job was a permanent red check.

**Fix.** The job probes for the feature first (`gh api --silent` exits 0 only on
a 2xx) and, when it is unavailable, emits a `::warning::` naming the setting to
enable and stays green. The npm, cargo and `pip-audit` jobs in the same workflow
still cover published advisories, so nothing is silently lost: the warning says
so, and turning the setting on makes the review run with no further edit.

## RC-12 — a test that only worked on the operating system it was written on

`jscpd-config.test.js` (added for RC-4) ran the duplication tool through
`execFileSync(node_modules/.bin/jscpd)`. npm writes three shims on Windows —
`jscpd`, `jscpd.cmd` and `jscpd.ps1` — and the extensionless one is a Bourne
script that `CreateProcess` cannot execute, so the JS matrix failed on
`windows-latest` with `spawnSync ...\node_modules\.bin\jscpd ENOENT` while
passing on Linux and macOS. A gate against false negatives that is itself a
false positive on a third of the matrix.

**Fix.** The test reads `bin.jscpd` out of `node_modules/jscpd/package.json` and
runs that file with `process.execPath`, which is the same entry point npm links
to on every platform and survives an upstream rename. It skips with a message
when jscpd is not installed rather than failing.

## RC-13 — a link checker that could not tell a redirect from a corpse

Run 33959793880 failed with two "Broken link detected" errors. lychee had
reported exactly one problem:

```
* [502] <https://github.com/microsoft/playwright/issues/35743> (at 94:99) | Rejected status code: 502 Bad Gateway
```

The second URL,
`https://docs.github.com/actions/security-guides/using-secrets-in-github-actions`,
appears in the report under `## Redirects per input` as a healthy `--[302]-->`.
Both URLs answer 200 today.

Two defects in `scripts/check-web-archive.mjs`:

1. The report was scraped with a bullet-line regular expression that carried no
   notion of which `## ` section it was in, so a link lychee had listed as
   *working* was reported as broken.
2. `[502]` was handled like `[404]`. A 5xx is the server reporting its own
   problem, not a statement about the resource.

The Wayback fallback could not mask either mistake: both pages are live and
neither has ever been archived, so `archived_snapshots` came back `{}` and the
script concluded "no archived version found" and exited 1.

**Fix.** Parsing is section-aware; every rejected URL is re-checked from the
script before a verdict; a 429 or 5xx that repeats is a `::warning::`, not a
failure. Only a link a second request agrees is gone, with no Wayback snapshot,
fails the job. `js/tests/unit/scripts/check-web-archive.test.js` pins all of it
against the verbatim report from run 33959793880, and
`experiments/ci-repro/repro-link-checker-false-positive.mjs` prints the old
parser's two "broken" URLs next to the new parser's one.


---

## RC-14 — a hook manager that could never see `.git`

Best practice #8 asks for local quality gates. The repository claimed them:
`js/package.json` carried `husky` and `lint-staged` as dev dependencies, ran

```json
"prepare": "husky || true",
```

and `js/.husky/pre-commit` contained `npx lint-staged`. None of it ever ran.

```
$ git config --get core.hooksPath
$ cd js && npx husky
.git can't be found
$ cd js && npx husky ../.husky
.. not allowed
```

Both refusals are husky's own, from `js/node_modules/husky/index.js` (9.1.7):

```js
if (d.includes('..')) return '.. not allowed'
if (!f.existsSync('.git')) return `.git can't be found`
```

npm runs `prepare` with the working directory set to the package, so husky looks
for `.git` in `js/` and does not find it; and it refuses any hook directory
above itself, so there is no argument that would let a package in a subdirectory
manage the hooks of the repository that contains it. The installer therefore
exited non-zero on every `npm install`, and `|| true` threw the message away.
`core.hooksPath` stayed unset, `js/.husky/pre-commit` stayed a file nobody read,
and the failures the hook existed to catch — including the two duplication
regressions this pull request hit — went to CI instead.

This is RC-7 again: a real failure turned into a green step by `|| true`.

**Fix.** One hook manager for the whole repository, at the root where `.git` is:
`.pre-commit-config.yaml`. Its `repo: local` hooks run the exact commands the
workflows run — `npm run lint`, `ruff check .`, `cargo fmt --all -- --check`,
`node scripts/check-ci-workflows.mjs` and the rest — each scoped by a `files:`
pattern so editing Python never waits for Clippy. Upstream
`pre-commit/pre-commit-hooks` adds the five gates no job had: trailing
whitespace, missing final newlines, unparseable YAML/JSON/TOML, oversized files
and committed private keys.

husky and lint-staged are removed rather than repaired: two hook managers cannot
share `core.hooksPath`, and only one of them can cover Python and Rust.

`js/tests/unit/scripts/pre-commit-config.test.js` is the regression test. It
fails against the previous wiring on both counts — the masked installer and the
husky dependencies — and it pins every local hook to the workflow step it
mirrors, so a lint command that changes in `js.yml` but not in the hook (or the
other way round) fails the build.

---

## RC-15 — the linter could not see half the JavaScript in the repository

`npm run lint` is `eslint .`, run with the working directory set to `js/`. Every
`.mjs` file outside that directory — `scripts/` (10 files the workflows shell
out to), `experiments/` and `rust/scripts/` (8 release helpers) — was checked by
nothing. Neither Prettier: `prettier --check .` runs from `js/` too.

Pointing the existing configuration at them does not work:

```
$ cd js && npx eslint ../scripts --config eslint.config.js
You are linting "../scripts", but all of the files matching the glob pattern
"../scripts" are ignored.
  * If the file is ignored because it is located outside of the base path,
    change the location of your config file to be in a parent directory.
```

ESLint takes the project's base path from the directory of the config file it
loads, and silently skips everything above it. The command exits 2 having
checked nothing — a linter that reports success for files it never opened.

The first run over those directories found **298 problems (286 errors)**, in the
scripts every release and every policy check depends on.

**Fix.** A repository-root `eslint.config.js` that re-exports
`js/eslint.config.js`:

```js
import jsPackageRules from './js/eslint.config.js';
```

Node resolves that module's own `@eslint/js` and Prettier plugin imports
relative to `js/`, so the root config needs no dependencies and the repository
needs no second lockfile — and the rules cannot drift from the package's,
because they are the same array. `js/.prettierrc` moved to the root for the same
reason: Prettier searches upward from the file it is formatting, so one file now
configures both.

Nearest-config-wins means `cd js && npm run lint` is unaffected: it still loads
`js/eslint.config.js`.

The 286 errors are fixed — 198 by `--fix`, the rest by hand — and the
`repo-scripts-lint` job in `quality.yml` keeps them fixed. The browser globals
the page scripts under `experiments/fingerprint-parity/` use (`navigator`,
`screen`, `Notification`, `HTMLCanvasElement`, …) were added to the shared
config's globals list, next to the `document` and `window` entries that were
already there for the same reason.

---

## RC-16 — the timeout that was not a failure

`timeout-minutes` is the only deadline any job in this repository had, and it
does not fail anything. GitHub reports a job it kills as **cancelled**, not as
failed — the behaviour is documented by omission and discussed at length in
[community discussion 38004](https://github.com/orgs/community/discussions/38004),
"timing out github action without 'failure' status". A run whose only casualty
is a cancelled job carries the conclusion `cancelled` too, and a `cancelled` run
is not a failing run: no red check, no notification, and `gh run list` shows it
next to the genuine supersedes.

The repository already contains one run of that shape. Run 24045269874 (Rust
CI/CD Pipeline, push to `main`) has `Auto Release`, `Build Package` and two
`Test` jobs all `cancelled` and a run conclusion of `cancelled`:

```
$ gh run view 24045269874 --repo link-foundation/browser-commander \
    --json conclusion,jobs --jq '.conclusion, (.jobs[] | "\(.conclusion)\t\(.name)")'
cancelled
success         Detect Changes
success         Lint and Format Check
skipped         Changelog Fragment Check
cancelled       Test (windows-latest)
cancelled       Test (ubuntu-latest)
success         Test (macos-latest)
cancelled       Build Package
cancelled       Auto Release
cancelled       Manual Release
```

That one was a legitimate supersede — a second push arrived 38 seconds later —
but nothing in the repository could have told the two apart, and a genuine
overrun would have read exactly the same.

**Reproduction.** A job whose step outlives its backstop:

```yaml
jobs:
  overrun:
    runs-on: ubuntu-latest
    timeout-minutes: 1
    steps:
      - run: sleep 120
```

The step is killed at 60s; the job's conclusion is `cancelled`; the run's
conclusion is `cancelled`; the pull request shows no failing check.

**Fix, part one: the step owns its deadline.** `scripts/run-with-budget-warning.sh`
runs a command with an explicit budget, warns at 70% of it, and on an overrun
sends `SIGTERM` to the whole process group, then `SIGKILL` after a grace period,
and exits **124** — the same status `timeout(1)` uses. 124 is a failure, so the
step turns the check red and the annotation names the budget that was blown:

```
::error title=Rust test suite exceeded its execution budget::Rust test suite did
not finish within its 480s budget and was terminated.
```

Two details in the script are load-bearing and were both found by mutating it
and watching a test fail. `set -m` puts the command in its own process group,
because `npm test` and `cargo test` spawn workers and signalling only the direct
child leaves orphans holding the runner's stdout — that is also why `timeout(1)`
alone is not enough here. And completion is detected through a status file
rather than `kill -0`, because a finished child stays visible as a zombie until
it is reaped, so process liveness never reports it as done.

Budgets are set from measured durations, with room for the checkout, toolchain
and dependency installs that share the job clock:

| Workflow | Step | Budget | Measured |
| --- | --- | --- | --- |
| `js.yml` | Node.js test suite | 300s | 1–5s |
| `python.yml` | pytest suite | 300s | 5–10s |
| `rust.yml` | Rust test suite | 480s | 23–86s |
| `rust.yml` | Rust doc tests | 180s | 6–11s |
| `rust.yml` | Rust code coverage | 480s | 10s |
| `docs.yml` | Rust API docs | 480s | 58s |
| `parity.yml` | Fingerprint parity suite | 1200s | 26s |

`rust.yml`'s `no-openssl` job is the one long step left unwrapped: it runs in a
`rust:slim-bookworm` container that has no bash to wrap it with.

**Fix, part two: something has to read the results.** A budget only covers steps
somebody thought to budget. Every workflow therefore ends in a `pipeline-status`
job that `needs:` every other job, reads `toJSON(needs)`, and fails when any of
them failed or was cancelled. It is guarded by `if: !cancelled()` rather than
the implicit "all dependencies succeeded", or it would be skipped in exactly the
runs it exists to report — and `!` is the YAML tag indicator, so the condition
has to be written as a block scalar:

```yaml
    if: >-
      !cancelled()
```

**The false positive this could have introduced.** The templates' version of the
gate fails any run with a cancelled job on the default branch. This repository's
check jobs cancel *each other* through `${{ github.workflow }}-${{ github.ref }}-*`
concurrency groups — that is how run 24045269874 came to be cancelled — so
adopting the gate unchanged would have reddened every superseded push to `main`:
a new false positive in exchange for the old false negative. Before failing,
`check-pipeline-status.sh` therefore asks whether the commit it is testing is
still the head of the branch:

```bash
head="$(git ls-remote "${GIT_REMOTE:-origin}" "refs/heads/${branch}" | awk 'NR == 1 { print $1 }')"
[ "$head" != "$RUN_SHA" ]
```

An unresolvable head is treated as *not* superseded: a missed supersede costs
one noisy warning, a missed overrun costs a silent failure on `main`.

**Keeping it true.** Three test files, all runnable locally:

* `js/tests/unit/scripts/run-with-budget-warning.test.js` — exit-status
  pass-through, 124 and the annotation on overrun, and the process-group kill
  (asserted by watching a worker stop appending to a file; `kill -0` cannot see
  the difference, because the killed worker is a zombie).
* `js/tests/unit/scripts/check-pipeline-status.test.js` — the four readings
  (failure, cancellation off `main`, cancellation at the branch head, supersede)
  and the refusal to run without `NEEDS_JSON`.
* `js/tests/unit/scripts/ci-timeout-budgets.test.js` — no budget, individually
  or summed per job, exceeds 70% of its job's backstop; every wrapped step
  declares `shell: bash`; every workflow has the gate and the gate needs every
  other job.

`scripts/check-ci-workflows.mjs` enforces the last of those at workflow-policy
level too, so a job added later cannot escape the gate:

```
Job pipeline-status does not need coverage; a job the gate does not watch can
be cancelled without failing the run.
```

**Verification.** Both scripts are clean under
`docker run --rm -v "$PWD:/mnt" koalaman/shellcheck:stable scripts/*.sh`.
Adding a workflow job that lints standalone `.sh` files is a reasonable
follow-up — neither this repository nor the three templates do it today — but it
is outside this issue.

**Upstream.** The gate and the wrapper come from the link-foundation pipeline
templates, where the gate has no supersede lookup; that gap is reported back to
them (see `templates/`).

---

## RC-17 — twelve failures that were about the runner, not the repository

The `Test (Node.js on windows-latest)` job of run
[33963736349](https://github.com/link-foundation/browser-commander/actions/runs/33963736349)
reported twelve failures, all of this shape:

```
✖ js-eslint runs `npm run lint`, the same as js.yml
  AssertionError [ERR_ASSERTION]: js.yml no longer has a step running
  `npm run lint`; the hook and the workflow have drifted apart
```

Nothing had drifted. `js/tests/unit/scripts/pre-commit-config.test.js` — added
by this pull request for RC-14 — asserts that each pre-commit hook runs the same
command as the workflow step it mirrors, and it looks for the command with:

```js
workflow(file).includes(`run: ${command}\n`)
```

A Windows runner checks the repository out with CRLF line endings, so the file
contains `run: npm run lint\r\n` and the match fails on every one of the twelve
commands, on Windows only. The same class as RC-12: a test that was really
testing the operating system it was written on.

**Fix.** Reads go through `readRepoText()` in `js/tests/helpers/repo.js`, which
normalizes `\r\n` to `\n` at the read, so an assertion written with `\n` is an
assertion about this repository. The regression test reproduces the Windows
checkout rather than waiting for a Windows runner to find it again:

```js
const crlfWorkflow = normalizeNewlines(
  workflow('js.yml').replaceAll('\n', '\r\n')
);

assert.ok(crlfWorkflow.includes('run: npm run lint\n'));
```

Turning `normalizeNewlines` into the identity function fails that test and the
twelve it protects, which is the check that it is load-bearing.

**Why the gate caught it and the previous run did not report it as such.** Run
33963736349 failed and so did its successor, 33965488498 — the second one is the
first run with the RC-16 `pipeline-status` gate, and it shows the gate doing its
job: `Test (Node.js on windows-latest)` failed and `Pipeline Status` failed with
it, naming the job.
