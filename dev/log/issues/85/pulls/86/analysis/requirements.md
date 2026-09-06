# Requirements

Every requirement stated or implied by issue #85, with where it is satisfied
and how that can be checked. "Verified by" names something executable or a
file in this folder — not an assertion.

## R1 — Fix the two failing workflows

> Python CI/CD Pipeline … failure … `67c003c`
> Rust CI/CD Pipeline … failure … `67c003c`

Both failed for the same reason (RC-1). Fixed at all four sites that push to
`main`:

| Site | Change |
| --- | --- |
| `rust/scripts/version-and-commit.mjs` | `pushWithRebaseRetry`, and tag after the push (RC-3) |
| `python/scripts/version_and_commit.py` | `push_with_rebase_retry(branch="main")` |
| `js/scripts/version-and-commit.mjs` | `pushWithRebaseRetry` (was already succeeding — only because it wins the lock first) |
| `.github/workflows/python.yml` | inline `git push origin HEAD:main` → `python scripts/git_push.py --branch main` |

**Verified by** `js/tests/unit/scripts/push-with-rebase-retry.test.js` and
`python/tests/unit/scripts/test_git_push.py`, each of which includes a
"no raw push left behind" guard that greps the release scripts, so a fifth
push site added later fails the suite rather than silently reintroducing RC-1.
Behaviour verified end-to-end by
`experiments/ci-repro/repro-release-push-race.sh`.

## R2 — Find every false positive, false negative, warning and error across the 8 runs

Logs for all 8 runs: `../ci-logs/`. Annotations pulled from the check-runs API
rather than grepped out of logs: `../annotations/`.

| Run | Workflow | Annotations |
| --- | --- | --- |
| 33998729880 | Security | 0 |
| 33998729892 | CI Workflow Policy | 0 |
| 33998729917 | JS CI/CD Pipeline | 0 |
| 33998729934 | Python CI/CD Pipeline | 4 |
| 33998729936 | Repository Quality Gates | 0 |
| 33998729942 | Documentation | 0 |
| 33998729944 | Broken Link Checker | 1 |
| 33998729958 | Rust CI/CD Pipeline | 14 |

The API was necessary, not a nicety: grepping the logs for `::error::` finds
`install-action` and `openssl-sys` lines in runs whose annotation count is
**0**. Those are shell scripts being echoed by the runner, not annotations —
a false positive that the log-grep approach produces and the API rules out.

Warnings: 12 of the Rust run's 14 were one fact repeated (RC-2), now one.
Everything examined and found *not* to be a defect is listed with its reasoning
in `root-causes.md` § "Assessed and found not to be defects", so those
questions do not have to be reopened.

**False negatives** are the harder half of this requirement, since by
definition nothing in the log points at them. Two searches were run: every
green job was checked for whether it actually asserted anything (test counts:
Python 459 × 3 OSes, Rust 283 — no silent skips), and every non-blocking
`continue-on-error` / `|| true` in the workflows was reviewed. The
`::notice::Skipping Codecov upload…` path is the one place where a failure
degrades quietly, and it announces itself in the log by design; coverage is
still computed and still gates.

## R3 — Compare the full file tree against the three templates

`../templates/` holds the file tree of this repository and of all three
templates, plus the mechanical "in the template, no counterpart here" lists.
`../templates/comparison.md` classifies every gap as *present here under
another name*, *language-idiom difference*, or *genuine gap*, and records what
was adopted and what was assessed and rejected, with reasons.

Adopted: `push-failure-classifier.mjs` from the JS template, ported so that all
three languages classify a rejection identically.

## R4 — Report the same issue upstream when it exists in a template

Three filed, each with a reproduction, a workaround and the code fix:

- `link-foundation/python-ai-driven-development-pipeline-template#73` — the
  python template's release push has no retry at all: RC-1, upstream.
- `link-foundation/rust-ai-driven-development-pipeline-template#162` — the rust
  template retries a GH006/GH013 ruleset rejection as if it were a lost race.
- `link-assistant/hive-mind#2220` — principle 10 of the best-practices document
  stops one step short of the defect it is meant to prevent.

RC-3 is deliberately **not** filed: the rust template already fixed it (its
issue #94) and this repository had simply never ported the fix. Reasoning in
`../templates/comparison.md` § Upstream.

## R5 — Follow the hive-mind CI/CD best practices

The document is archived at `../best-practices/CI-CD-BEST-PRACTICES.md` (URLs
move; the evidence should not). Principle-by-principle audit of this pipeline
in `best-practices-audit.md`.

## R6 — Add debug output and a verbose mode where evidence was insufficient

Required by the task, and independently earned: RC-2's per-version detail is
worth having but not worth 12 annotations. `scripts/debug-print.mjs` and the
Python `debug()` in `python/scripts/git_push.py` gate output behind
`CI_SCRIPTS_DEBUG`, `RUNNER_DEBUG` and `ACTIONS_STEP_DEBUG` — the last two
being GitHub's own switches, so re-running a job with debug logging enabled
turns this on with no code change. **Default off**, verified by unit test.

## R7 — Apply each fix everywhere it applies

The point of R7 is that RC-1 was present in four places and fixing one would
have looked like a fix. Beyond fixing all four, the two "no raw push left
behind" guards make the requirement enforceable rather than remembered.

## R8 — Trigger a release

Per the repository's own conventions: changeset for JS, `changelog.d`
fragments for Python and Rust. Without this the fix ships but no release
exercises it, and RC-1 stays unproven in production.
