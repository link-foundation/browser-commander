# Requirements

Every requirement in issue #83 and in the instruction that opened this pull
request, quoted, with what it means for this repository, its current status and
the evidence that settles it. `RC-x` refers to a section in
[`root-causes.md`](root-causes.md).

Status values: **done** — implemented and verified in CI; **open** — not yet
done, with a plan below; **needs a human** — blocked on an action no code in
this repository can take; **standing** — a rule that has to keep holding for
every later commit, enforced by a check rather than finished once.

## A. The runs named in the issue

All eight rows in the issue's table are the same push, `4f7af54`, queued at
`2026-09-05T15:19:32Z`. See [`timeline.md`](timeline.md).

| # | Requirement (verbatim) | Root cause | Status |
| --- | --- | --- | --- |
| R-1 | "Python CI/CD Pipeline … failure … [run 33974450000]" | RC-A — PyPI trusted publishing has no registered publisher; `invalid-publisher` | open + needs a human — code emits an actionable pre-flight error; the registration itself is a maintainer action |
| R-2 | The seven runs listed as `success` | the issue asks for false *negatives* too: two of the seven were lying — RC-G (JS: `changeset version` crashed and was reported green) and RC-C (Rust: twelve releases published with zero commits) | open — plan in §E |
| R-3 | Documentation 33974450013, Repository Quality Gates 33974450017, Broken Link Checker 33974450018, CI Workflow Policy 33974450025 | audited, genuinely green, no action | done — verified |
| R-4 | Security 33974450021 (`dependency-review` skipped) | RC-F — `if: github.event_name == 'pull_request'` on a push run; `skipped` is correct | done — investigated and dropped; a "fix" here would have been a false positive |

## B. The four classes in the title

> "Check for all false positives, false negatives, warnings and errors in CI/CD
> and fix them all"

| # | Class | Requirement | Status |
| --- | --- | --- | --- |
| R-5 | errors | every job that fails for a real defect is fixed | open — RC-A (needs a human), RC-D, RC-H |
| R-6 | false negatives | every check that passes without checking anything is made to check | open — RC-B, RC-C, RC-E, RC-G |
| R-7 | false positives | no check fails for something that is not a defect | open — RC-E has manufactured one that has not fired yet: `js/CHANGELOG.md` on main fails `prettier --check`, so the next contributor's PR fails for a reason unrelated to their change |
| R-8 | warnings | no warning is left to hide the other three | open — audit pending against the nine green runs |

The classes are not independent here, and that is the central finding of this
issue. **RC-B is a false negative that manufactures errors**: because
`command-stream`'s `$` resolves rather than rejects on a non-zero exit, every
`try { await $\`…\` } catch { process.exit(1) }` in thirteen release scripts is
dead code. That single defect is why RC-C and RC-G both shipped green. And
**RC-E is a false negative that manufactures a false positive**: the release
commit is pushed with `GITHUB_TOKEN`, which by design triggers no workflows, so
a formatting violation introduced by the release lands on main untested and
detonates on somebody else's pull request.

## C. The templates

> "Use all the best practices from CI/CD templates (check full file tree to
> compare for all GitHub workflow and CI/CD scripts file), if the same issue is
> found in template report issue also in templates"

> "We should compare all files, so we don't have more CI/CD errors in the
> future and reuse all the best practices from these templates."

| # | Requirement | Status |
| --- | --- | --- |
| R-9 | Full file-tree comparison against `js-ai-driven-development-pipeline-template` | open — snapshot collected, diff pending in `../templates/` |
| R-10 | Full file-tree comparison against `python-ai-driven-development-pipeline-template` | open — same |
| R-11 | Full file-tree comparison against `rust-ai-driven-development-pipeline-template` | open — same |
| R-12 | Adopt the practices the templates have and this repository lacks | open — three gaps already identified: rust's `script-tests` job (`bash scripts/test-scripts.sh`), rust's `cargo-lock` guard, js's `test-compilation`. The absence of `script-tests` is the systemic reason RC-B, RC-C and RC-G all survived |
| R-13 | "if the same issue is found in template report issue also in templates" | open — one confirmed upstream defect so far: the js template ships `deno.json` + `deno.lock` and pins `@changesets/cli: ^2.29.7`. It is not yet affected by RC-G only because that pin predates the v3 formatter auto-detect; it breaks on upgrade. Report to be filed with the reproduction attached |

## D. The best-practices document

> "Follow the CI/CD best practices collected in
> https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md"

The document is archived at `../best-practices/CI-CD-BEST-PRACTICES.md` (469
lines, 15 principles). A per-principle audit is pending. Principles already
known to be violated:

| # | Principle | Status |
| --- | --- | --- |
| R-14 | §6 changeset versioning | violated — RC-G leaves consumed changesets on disk, RC-C never commits the bump |
| R-15 | §7 fresh-merge validation | violated — RC-E, the release commit is never tested |
| R-16 | §9 release automation | violated — RC-A has never worked, RC-C ships without recording, RC-D collides tag namespaces |
| R-17 | The remaining twelve principles | open — audit pending in `../best-practices/` |

## E. The instruction that opened this pull request

| # | Requirement (verbatim) | Status |
| --- | --- | --- |
| R-18 | "Download all logs and collect data related about the issue to this repository, and compile that data into the `./dev/log/issues/83/pulls/84` folder" | done — `77a49ad`: 8 run logs + JSON (4.9 MB, ANSI-stripped), issue and PR JSON, annotations, run list; workflow snapshots pending commit |
| R-19 | "do a deep analysis … reconstruct the timeline/sequence of events" | done — [`timeline.md`](timeline.md) |
| R-20 | "list each and every requirement from the issue" | done — this file |
| R-21 | "find the root cause of each problem" | done — [`root-causes.md`](root-causes.md), seven confirmed causes plus one investigated and dropped |
| R-22 | "propose possible solutions and solution plans for each requirement" | done — a **Fix.** paragraph per root cause; the implementation plan is §F below |
| R-23 | "search online for additional facts and data" | done — PyPI JSON API (404), npm and crates.io release history, `@changesets/format` `defaultDetectOrder`, `@changesets/config@4.0.0` schema, GitHub's documented `GITHUB_TOKEN` no-recursion rule, PyPI trusted-publishing docs |
| R-24 | "check online for known existing components/libraries that solve a similar problem" | done — [`existing-solutions.md`](existing-solutions.md) |
| R-25 | "If there is not enough data to find the actual root cause, add debug output and a verbose mode … Keep the default state switched off" | open — `CI_SCRIPTS_DEBUG=1` already exists in `scripts/use-module.mjs`; it will be wired to `shell.verbose()` and `shell.xtrace()`, default off |
| R-26 | "report issues on GitHub for that project … reproducible examples, workarounds, and suggestions for fixing the issue in code" | open — R-13; the reproduction script is written and passing |
| R-27 | "Double-check that the requirements are fully applied to the entire codebase: if an issue exists in multiple places, apply it in all of them" | standing — RC-B touches thirteen scripts, RC-D touches two, RC-E touches three workflows. Each fix is applied at the shared choke point where one exists (`scripts/use-module.mjs` for RC-B) and per-site where it does not |
| R-28 | "plan and execute everything in this single pull request" | standing — PR #84 |

## F. Implementation plan

Ordered by dependency, not by severity. RC-B first: it is the reason the others
are invisible, and fixing it makes the rest testable.

| # | Fix | Addresses | Blast radius |
| --- | --- | --- | --- |
| F-1 | `shell.errexit(true)` in `loadCommandStream()`; wire `CI_SCRIPTS_DEBUG=1` to `shell.verbose()`/`shell.xtrace()`; audit all 13 consumers for sites that relied on resolve-on-failure | RC-B, R-25 | `scripts/use-module.mjs` + 13 consumers |
| F-2 | Commit gate on `git status --porcelain` output; delete consumed `changelog.d` fragments; gate `Publish to Crates.io` on `version_committed == 'true'` | RC-C, RC-H | `rust/scripts/version-and-commit.mjs`, `.github/workflows/rust.yml` |
| F-3 | `"format": "prettier"` in `js/.changeset/config.json`; delete the stale `merged-loud-river.md`; prettier over `js/CHANGELOG.md`; drop the orphaned `js/deno.json` | RC-G, R-7 | `js/` |
| F-4 | Namespace Rust tags as `rust-v<version>` | RC-D | `rust/scripts/{create-github-release,version-and-commit}.mjs` |
| F-5 | PyPI pre-flight check with an actionable error; add the missing bump + changelog-collection steps to `python.yml`'s `auto-release` | RC-A | `.github/workflows/python.yml` |
| F-6 | Validate the release commit before pushing (`format:check` on touched files, in the release job) | RC-E | all three release workflows |
| F-7 | Test suite for the CI/release scripts + a CI job that runs it; consider the `cargo-lock` guard | R-12, and the systemic cause of RC-B/C/G | new `scripts/` tests, `.github/workflows/quality.yml` |
| F-8 | Template file-tree diff and upstream reports | R-9–R-13, R-26 | `../templates/`, upstream repositories |
| F-9 | Per-principle best-practices audit | R-14–R-17 | `../best-practices/` |

Each fix lands with a reproducing test written first. Two already exist and
fail against the current code: `experiments/ci-repro/repro-command-stream-exit-code.mjs`
(RC-B) and `experiments/ci-repro/repro-changeset-deno-formatter.mjs` (RC-G).
