# js and rust templates: the release commit is the one commit no check ever sees

**Title:** The version commit the release job pushes to `main` is never linted, formatted or tested — a broken release lands on the default branch and fails on the next contributor's PR

## Summary

The release job pushes a commit it creates itself:

- js: `.github/workflows/release.yml`, job `release` → `node scripts/version-and-commit.mjs --mode changeset`, which writes `package.json`, `package-lock.json` and `CHANGELOG.md`, commits and pushes to `main`
- rust: `.github/workflows/release.yml`, job `auto-release` → `rust-script scripts/version-and-commit.rs`, which writes `Cargo.toml`, `Cargo.lock` and `CHANGELOG.md`, consumes the `changelog.d` fragments, commits and pushes to `main`

Nothing checks that commit. The `lint` and `test` jobs the release job `needs:` ran against its **parent** — the merge commit — and finished before the release job started. And the push itself cannot trigger a new run, because it is made with `GITHUB_TOKEN`, and [GitHub does not start workflow runs for events raised by that token](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow):

> When you use the repository's `GITHUB_TOKEN` to perform tasks, events triggered by the `GITHUB_TOKEN` … will not create a new workflow run.

So the release commit is the single commit on `main` that no check has ever run against — and it is the one written entirely by machine, from a code path that only executes on `main`.

## What that costs, concretely

In a downstream consumer of the js template, `link-foundation/browser-commander`, commit [`8f5f4bb`](https://github.com/link-foundation/browser-commander/commit/8f5f4bb) ("0.17.0", authored by `github-actions[bot]`):

```console
$ gh run list --commit 8f5f4bb
[]                                  # no workflow run, ever

$ git show 8f5f4bb --stat
 js/.changeset/ci-pipeline-recovery.md                         | 5 -----
 js/.changeset/{fingerprint-parity.md => merged-loud-river.md} | 2 ++
 js/CHANGELOG.md                                               | 8 ++++++++
 js/package-lock.json                                          | 4 ++--
 js/package.json                                               | 2 +-

$ git show 8f5f4bb:js/CHANGELOG.md > /tmp/c.md && npx prettier --check /tmp/c.md
[warn] /tmp/c.md
[warn] Code style issues found in the above file.
```

Two separate defects are visible in that one commit, and both were reported as a successful release:

1. `changeset version` crashed partway through (`spawn deno ENOENT`, from `@changesets/format`'s formatter auto-detection). It had already written `CHANGELOG.md` and had not yet deleted the changeset it consumed — which is why `merged-loud-river.md` is still there in a commit that also bumps the version and appends to the changelog. The crash was invisible because `command-stream`'s `$` resolves rather than rejects on a non-zero exit, so `changeset-version.mjs`'s `catch` never ran (reported separately).
2. Because the changelog was written but not formatted, `main` acquired a file that fails the repository's own `format:check`. The next contributor's pull request failed on `prettier --check js/CHANGELOG.md` — a red job, on a file they had never touched, with no connection to their change.

That second one is the shape worth emphasising: a false negative in the release job manufactures a **false positive** on somebody else's pull request, several hours later and in a different workflow. The person who has to debug it has no reason to look at a release commit.

## Reproducing it

No exotic setup is needed — the mechanism is a documented platform rule plus an ordering:

```console
$ gh run list --commit "$(git log --format='%H %an' origin/main | awk '$2=="github-actions[bot]"{print $1; exit}')"
[]
```

Any release commit in any repository built from these templates will print an empty list. To see the consequence, hand-write a formatting violation into the file the release job produces (`CHANGELOG.md` is the reliable one, since both templates generate it) and observe that the release is green and the next unrelated pull request is red.

## Suggestions for fixing this in code

**1. Validate the commit before pushing it, inside the release job.** This is the cheap fix and it closes the window entirely, because the check runs on exactly the tree that is about to be pushed. In `version-and-commit`, between staging and committing:

```js
// after the bump has been written, before `git commit`
const staged = await capture($`git diff --cached --name-only`);
const formattable = staged
  .split('\n')
  .filter((f) => /\.(m?js|json|md|ts)$/.test(f));
if (formattable.length) {
  await $`npx prettier --check ${formattable}`; // rejects -> the job fails loudly
}
```

for rust, the equivalent is `cargo fmt --all -- --check` plus a markdown formatter over the generated `CHANGELOG.md`. The important property is that it fails the **release** job rather than the next contributor's.

A repository that would rather auto-correct than fail can run `--write` instead of `--check` and re-stage; that is a policy choice, and either is better than shipping unvalidated.

**2. Fail loudly when the generator half-succeeds.** The formatting violation above was a symptom; the cause was a crashed generator whose failure was swallowed. Any release script that writes files should verify the write it intended — that the changeset it consumed is gone, that `CHANGELOG.md` gained the version being released, that `Cargo.lock` agrees with `Cargo.toml`. Each is a one-line assertion and each would have turned an invisible half-release into a red job.

**3. If a run on the release commit is genuinely wanted, it needs a different token.** Pushing with a PAT or a GitHub App installation token does trigger workflows. That is a heavier change — new credentials, and a release that can now be blocked by a flaky test after publishing — so option 1 is the one worth doing first. Worth a line in the docs either way, because "the release job pushed it, so CI checked it" is the natural and wrong assumption.

## Not applicable to the python template

Checked and it does not have this: `python-ai-driven-development-pipeline-template`'s `auto-release` job publishes when it detects that the version _already_ changed. The bump arrives through an ordinary pull request, so it goes through the same `lint` and `test` jobs as any other change. Recorded here so the difference is not read as an oversight.

## Context

Found while auditing CI/CD false positives, false negatives, warnings and errors in `link-foundation/browser-commander` ([issue #83](https://github.com/link-foundation/browser-commander/issues/83), [PR #84](https://github.com/link-foundation/browser-commander/pull/84)), which uses these repositories as its CI/CD templates. Filing here per that issue's instruction to report template-shared problems upstream.
