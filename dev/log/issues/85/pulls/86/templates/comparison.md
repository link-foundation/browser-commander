# Template comparison

The issue asks to "compare all files" against the three pipeline templates and
reuse the best practices. The raw material is in this folder:

- `filetree-browser-commander.txt` and `filetree-{js,python,rust}-template.txt`
  — every tracked path in this repository and in each template.
- `missing-from-{js,python,rust}-template.txt` — the mechanical difference:
  paths present in the template with no counterpart here.

The mechanical difference is large and almost entirely uninteresting: 331 paths
for the JS template, 63 for Python, 127 for Rust. Handing that list over as a
finding would be worse than useless, so every entry was classified. The
breakdown by directory explains most of it at a glance:

| Template | Total | `docs/case-studies` | `tests` | `scripts` | `.github/workflows` | other |
| --- | --- | --- | --- | --- | --- | --- |
| js | 331 | 222 | 43 | 22 | 3 | 41 |
| python | 63 | — | 11 | 8 | 2 | 42 (31 are `changelog.d`) |
| rust | 127 | 59 | 22 | 25 | 3 | 18 |

## Classification

**Not comparable — a template's own content (≈ 320 paths).**
`docs/case-studies/**`, `changelog.d/**`, `docs/screenshots/**`,
`examples/universal-app/**`, `src/my_package/**`, `experiments/**`. These are
the templates' own histories, fragments, demo apps and placeholder sources.
Copying them here would mean importing another project's changelog.

**Language-idiom difference — same job, different file (≈ 25 paths).**
The Rust template writes its CI scripts as `.rs` files run through
`rust-script`; this repository writes them as `.mjs` and runs them on Node,
which is already installed for the JS side of the monorepo. So
`scripts/version-and-commit.rs` ↔ `rust/scripts/version-and-commit.mjs`,
`scripts/get-version.rs` ↔ `rust/scripts/rust-paths.mjs` + `read-manifest.mjs`,
`scripts/detect-code-changes.rs` ↔ `scripts/detect-code-changes.mjs`, and so on
for `bump-version`, `collect-changelog`, `create-github-release`,
`publish-crate`, `release-naming`, `check-file-size`, `git-config`,
`check-version-modification`, `check-changelog-fragment`.
Likewise the templates each ship one `release.yml`; this repository splits the
same jobs across `js.yml`, `python.yml` and `rust.yml`, which is what a monorepo
with three release cadences needs. `workflows.yml` ↔ `ci-policy.yml`.

**Structural difference — monorepo vs. single language (≈ 15 paths).**
The templates keep shared helpers under one `scripts/`; here the shared ones
live in the root `scripts/` and the language-specific ones under
`js/scripts/`, `python/scripts/`, `rust/scripts/`. A path-level diff reports
every one of these as missing.

**Not applicable (≈ 8 paths).**
`.github/actions/publish-dockerhub`, `.github/actions/setup-buildx-resilient`,
`scripts/check-docker-build.mjs`, `scripts/check-docker-publish.mjs`,
`scripts/package-desktop.sh`, `scripts/desktop-release-resolve.sh`,
`.github/workflows/desktop-release.yml`, `docs/download/index.html`. This
repository publishes libraries to npm, PyPI and crates.io; it builds no
container image and ships no desktop binary. Recorded as N/A rather than as a
gap — see also best-practice #13 in `../analysis/best-practices-audit.md`.

**Adopted in this pull request (1).**
`scripts/push-failure-classifier.mjs`, from the JS template. It is the piece
that makes the RC-1 fix correct rather than merely present: without it a
GH006/GH013 rejection gets retried as though it were a lost race, which burns
the retry and files a log blaming a race that never happened. Ported to the
root `scripts/` so all three languages classify identically, plus a Python
transliteration in `python/scripts/git_push.py`. A unit test
(`test_python_and_node_classifiers_agree`) parses the pattern lists out of the
`.mjs` and compares them to the Python tuples, so the two cannot drift.

**Genuine gaps, assessed and deliberately not adopted here (6).**

| Template script | What it does | Why not now |
| --- | --- | --- |
| `land-via-pull-request.mjs` | When a ruleset blocks direct pushes, opens a PR and merges it | `main` here accepts direct `GITHUB_TOKEN` pushes — proved by the JS release landing `ab1c5aa` at 23:29:44. So a rule rejection would mean the repository's configuration changed, and a human should see that, not have it routed around. The classifier makes that failure explicit and loud. This reasoning is recorded in the module header of `scripts/push-with-rebase-retry.mjs` so the next reader does not have to re-derive it. |
| `wait-for-npm.mjs`, `wait-for-crate.rs` | Poll the registry until the new version is visible | Real gap, unrelated to any of the 8 runs. |
| `smoke-test-package.mjs`, `smoke_test_published_package.py`, `smoke-test-published-crate.rs` | Install the published artifact in a clean environment and import it | Real gap, and the most valuable of the six. Note it would *not* have caught RC-1: the artifacts published fine; it was the commit that never landed. |
| `check-release-needed.mjs` / `.rs` | Skip the release when nothing releasable changed | Real gap; costs runner minutes, not correctness. |
| `check-cargo-lock.rs`, `check-crate-size.rs` | Assert `Cargo.lock` is in sync; warn before the crates.io size limit | Partly covered — `rust/scripts/version-and-commit.mjs` already runs `cargo update --workspace` so the lockfile cannot drift at release time. |
| `lint-changed-lines.mjs`, `bootstrap-dependencies.mjs`, `sanitize-npm-userconfig.mjs`, `check-mjs-syntax.sh` | Developer-experience helpers | No defect in the 8 runs points at any of them. |

Each of these is a feature addition rather than a fix for anything issue #85
observed. Adding six of them alongside a release-path change would make the
release-path change harder to review and harder to revert, which is the wrong
trade for a pull request whose job is to get releases landing again. They are
listed here by name so the decision is visible and the follow-up is cheap.

## Upstream

The issue asks that a defect also present in a template be reported there. Two
are, and one is a gap in the shared guidance rather than in any template.

**1. python template — `scripts/version_and_commit.py:236` pushes with no
retry at all.**

```python
# Push to main
run_command(["git", "push", "origin", "main"])
```

This is RC-1 in its purest form, upstream and unfixed: no rebase, no retry, no
classification. Its `release.yml` also uses no `main-writer` concurrency group,
so nothing serialises it either. Reported with a reproduction, a workaround and
the code fix: **link-foundation/python-ai-driven-development-pipeline-template#73**.

**2. rust template — `scripts/version-and-commit.rs:884-906` retries *every*
push failure as a lost race.**

```rust
match exec("git", &["push"]) {
    Ok(_) => break,
    Err(e) => {
        if attempt < max_push_attempts {
            eprintln!("Pulling with rebase and retrying...");
```

A GH006/GH013 rejection is not a lost race and cannot be rebased away, so this
loop rebases three times, fails three times, and prints a cause that is wrong.
The JS template already fixed exactly this in its own #143 — the rust template
has not caught up. Reported as
**link-foundation/rust-ai-driven-development-pipeline-template#162**, along with
the smaller point that `git push --tags` at line 925 pushes every local tag
rather than the release tag.

**3. hive-mind `CI-CD-BEST-PRACTICES.md` — principle 10 stops one step short.**

It prescribes the repository-scoped `main-writer` group. This repository
implemented it exactly, and two of three releases still failed, because a
queued writer starts with the tree it was *triggered* with. Serialisation buys
ordering, not freshness. Reported as **link-assistant/hive-mind#2220**;
reasoning in `../analysis/best-practices-audit.md`.

**Not reported: RC-3.** The rust template already tags after the push
(`version-and-commit.rs:910`, "so that a `pull --rebase` retry above can never
leave the tag on an orphaned pre-rebase commit (see issue #94)"). The defect
here was that the fix existed upstream and had never been ported. Worth stating
plainly rather than filing: this is the second time in this comparison that the
template was ahead, which is an argument for a periodic diff rather than for
another issue.
