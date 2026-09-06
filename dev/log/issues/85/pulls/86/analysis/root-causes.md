# Root causes

Every claim below is traceable to a file in this evidence folder. Where a
claim rests on behaviour rather than a log line, there is a script in
`experiments/` that reproduces it.

---

## RC-1 — Serialised writers, unserialised working trees

**Symptom.** The Python and Rust release jobs failed at `67c003c`; the JS one
succeeded (`../ci-logs/run-*.json`).

**What is *not* the cause.** It is tempting to read two failures out of three
as a missing lock. The lock is there and it worked. All three main-writing
jobs share the concurrency group `main-writer-${{ github.repository }}-main`,
and the job timings show no overlap at all:

```
JS   Release      23:29:27 → 23:30:01   (pushed ab1c5aa 0.17.1 at 23:29:44)
Py   Auto Release 23:30:09 → 23:30:25   (failed)
Rust Auto Release 23:31:00 → 23:31:28   (failed)
```

**The actual cause.** `actions/checkout@v6` checks out `github.sha` — the
commit that *triggered* the run — not the branch tip at the moment the job
starts. Serialisation decides the *order* in which the writers run. It does
not re-point their working trees. So once the first writer lands a commit,
every writer after it is holding a tree one commit behind `main`, and its
push is rejected:

```
run-33998729934.log:3307   ! [rejected]        HEAD -> main (non-fast-forward)
run-33998729958.log:8203   ! [rejected]        main -> main (non-fast-forward)
```

Not one push site in this repository rebased and retried after a rejection.

**Why it stayed hidden.** The JS job succeeded, so a reader skimming the run
list sees "one language works, two are broken" and looks for three separate
defects. There is one defect, and which language it spares is decided purely
by which release job the lock admits first.

**Reproduction.** `experiments/ci-repro/repro-release-push-race.sh`, case 1:
two clones at the same trigger SHA, first pushes, second is rejected,
`git pull --rebase` plus a retry recovers it. No network, bare repos only.

**Damage.** Larger than "two red ticks", and none of it is visible from the
run list.

*Rust.* `../metadata/crates-io.json` shows crates.io carrying
`browser-commander` up to 0.10.11 (published 2026-09-05T15:27:08Z) while
`rust/Cargo.toml` on `main` still says 0.9.0. `git ls-remote --tags` returns 37
tags, all `v*` — no `rust-v*` and no `python-v*` at all. The Rust release commit
has never landed, so the published crate corresponds to no commit in the
history.

*Python.* `../metadata/pypi-browser-commander.txt`: `GET
https://pypi.org/pypi/browser-commander/json` → **404**. The Python package has
never been published at all. The log shows why, and it is worth reading in
order (`run-33998729934.log:3290-3313`):

```
Collecting into CHANGELOG.md under version 0.5.3
[main a8a3943] python: changelog for 0.5.3
 13 files changed, 53 insertions(+), 56 deletions(-)
 create mode 100644 python/CHANGELOG.md
 delete mode 100644 python/changelog.d/21.added.md
 ... 11 more fragments deleted ...
 ! [rejected]        HEAD -> main (non-fast-forward)
##[error]Process completed with exit code 1.
```

The changelog was assembled correctly, committed correctly, and then thrown
away with the runner. The job died at that push, which sits *before* "Publish
to PyPI" in the job — deliberately, so that a lost changelog cannot ship as a
release with no notes. The ordering is right; what was missing was the
recovery. Two artefacts of this survive in the working tree and can be checked
without any log: `python/changelog.d/` still holds all 12 fragments (issues 21
through 83), and `python/CHANGELOG.md` does not exist, because the run that
would have created it is the run that failed.

That is the shape of the damage this defect does. It does not merely fail; it
fails after doing the work, discards the work, and leaves a repository that
looks like nobody ever tried.

**Fix.** `scripts/push-failure-classifier.mjs` +
`scripts/push-with-rebase-retry.mjs`, and their Python counterpart
`python/scripts/git_push.py`, wired into all four push sites:
`js/scripts/version-and-commit.mjs`, `rust/scripts/version-and-commit.mjs`,
`python/scripts/version_and_commit.py`, and the inline push in
`.github/workflows/python.yml`.

The classification is not decoration. A repository-rule rejection
(GH006/GH013) also prints the word "rejected", and rebasing can never satisfy
a rule — retrying it burns the retry and leaves a log blaming a race that
never happened.

**Why not just fix the checkout?** Adding `ref: main` to the release job's
checkout looks simpler, and it is worse. It replaces a rejected push with a
silent one: the job would build, test and publish a tree that is not the tree
CI validated, and nothing would say so. The rejection is the honest outcome;
what was missing was the recovery.

---

## RC-2 — One fact reported twelve times

**Symptom.** Run 33998729958 emitted 12 `::warning::` annotations, one per
already-published version the release walked past
(`../ci-logs/run-33998729958.log`, 12 occurrences; the GitHub annotations API
returned only 10, `../annotations/run-33998729958.tsv`, because it caps
annotations per level per check run).

**Cause.** `findNextAvailableVersion()` in `rust/scripts/version-and-commit.mjs`
warned inside its loop. The loop is long precisely *because* of RC-1: with the
release commit never landing, `Cargo.toml` sits at 0.9.0 while the registry has
reached 0.10.11, so every run walks the whole gap again. The warning count is a
function of how long RC-1 has been unfixed, and grows with every failed release.

**Why it matters beyond noise.** GitHub caps the annotations it surfaces. A
storm of identical warnings does not merely clutter the run; it evicts the
warnings that *differ* — the ones a reader needs. Twelve annotations here said
one thing twelve times, and two of them were dropped on the floor.

**Fix.** The walk now collects what it skipped and reports the drift **once**,
naming the range and the actual cause ("an earlier release published the crate
without its version commit reaching main"). The per-version detail moved behind
`debug()`, so it is available under `CI_SCRIPTS_DEBUG=1` and silent otherwise.

---

## RC-3 — A retry would have orphaned the release tag

**Symptom.** Latent, not yet observed in CI — because the push it depends on
has never succeeded.

**Cause.** `rust/scripts/version-and-commit.mjs` created the annotated tag
*before* pushing. That is harmless as long as nothing rewrites the commit. The
RC-1 fix rewrites the commit: a rebase retry replays the release commit onto
the new remote head, producing a new SHA. A tag created beforehand keeps
pointing at the pre-rebase commit, which after the push is reachable from no
branch.

Fixing RC-1 without noticing this would have converted a loud failure into a
quiet one — a release that looks successful and whose tag points at a commit
that is not in the history.

**Reproduction.** `experiments/ci-repro/repro-release-push-race.sh`, case 2:
commit → tag → push rejected → rebase → push, and the tag is left orphaned.

**Fix.** Tagging happens after `pushWithRebaseRetry` resolves. The tag is
pushed by name (`git push origin <tag>`) rather than with `--tags`, which would
also push every unrelated local tag the runner happened to have fetched.
`js/tests/unit/scripts/push-with-rebase-retry.test.js` asserts the ordering by
source position, so it cannot silently regress.

---

## Assessed and found not to be defects

These were examined against the same 8 runs and are recorded here so the
question does not have to be reopened.

| Observation | Verdict |
| --- | --- |
| `Dependency Review` skipped in the Security run | Correct. The action only supports `pull_request`; on a `push` event there is no diff to review. Not a false negative — the job is skipped, not passed. |
| `::notice::Skipping Codecov upload because CODECOV_TOKEN is not configured` | Correct degradation, and it announces itself. Coverage is still *computed* and still gates; only the upload is skipped. Configuring the secret is a repository-settings decision, not a code defect. |
| CodeQL log containing the string "DEPRECATED" | The action's own help-text JSON, not a deprecation affecting this repository. |
| Security run reporting 0 vulnerabilities | Verified against the audit output, not inferred from the green tick. |
| `install-action: %s\n` and `openssl-sys is back in the dependency tree:` appearing in logs | Both are lines of the shell scripts being echoed by the runner, not emitted annotations. Confirmed against `../annotations/`, which lists neither. |
| Test counts (Python 459 passed × 3 OSes, Rust 283 passed) | Healthy; no silent skips. |
