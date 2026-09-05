# Template file-tree comparison

Issue #81 asks, verbatim: *"Use all the best practices from CI/CD templates (check full
file tree to compare for all GitHub workflow and CI/CD scripts file)"* and *"We should
compare all files, so we don't have more CI/CD errors in the future and reuse all the
best practices from these templates."* This file is that comparison, with a decision
recorded for every CI/CD-relevant path the templates have and this repository does not.

| Tree | Revision | Committed |
| --- | --- | --- |
| browser-commander (this repository) | `f482314` | this pull request |
| link-foundation/js-ai-driven-development-pipeline-template | `338fafa` | 2026-09-05 09:54:55 +0000 |
| link-foundation/python-ai-driven-development-pipeline-template | `81c9786` | 2026-09-04 02:55:52 +0700 |
| link-foundation/rust-ai-driven-development-pipeline-template | `4d444d9` | 2026-09-05 09:52:40 +0000 |

The first revision of this file compared `b06c5ad` against js `7ae16b0` and rust
`eb7e6c3`; both templates have moved since, so the lists below were regenerated against
their current heads.

## How the comparison is done

The templates are single-language repositories: the package sits at the root, so their
release helper is `scripts/version-and-commit.mjs`. This repository is a monorepo with
`js/`, `python/` and `rust/` side by side, so the same helper is
`js/scripts/version-and-commit.mjs`. A template path `p` therefore counts as **present**
when this repository has either `p` or `<language>/p`:

```python
for p in template_paths:
    if p in ours or f'{lang}/{p}' in ours:
        continue          # present
    absent.append(p)
```

"CI/CD-relevant" narrows the absent list to `.github/`, `scripts/`, `docs/` outside the
case studies, and root dotfiles - the files the issue asks about. Everything else
(sources, tests, changelogs, the templates' own README) is in the raw lists at the end.

| Template | Paths upstream | Absent here | Of those, CI/CD-relevant |
| --- | ---: | ---: | ---: |
| js | 377 | 334 | 38 |
| python | 83 | 65 | 18 |
| rust | 149 | 129 | 36 |

## Gaps closed by this pull request

Measured with the same rule against `b06c5ad` (the branch point) and the template heads
above, so upstream drift cannot be mistaken for work done here:

| Path | Template(s) | Closed by |
| --- | --- | --- |
| `.github/workflows/security.yml` | js, python, rust | dependency audits + CodeQL (best practice #7) |
| `.github/zizmor.yml` | js, python, rust | workflow security audit (best practice #14) |
| `.pre-commit-config.yaml` | python, rust | local gates that mirror CI (best practice #8) |
| `scripts/audit_dependencies.py` | python | `python-audit` job in `security.yml` |
| `scripts/debug-print.mjs` | js | verbose tracing, off by default |
| `scripts/use-module.mjs` | js | bounded use-m CDN loader |

One path moved the other way. `.husky/pre-commit` is present in the js template and was
present here at `b06c5ad`; this pull request deleted it. In the template husky works,
because the package *is* the repository root and `.git` is right there. In this monorepo
the package is `js/`, npm runs `prepare` with the package directory as the working
directory, and husky refuses both ways out of it. Its `bin.js` returns the string
`.. not allowed` for a path that climbs out of the package directory, and
`.git can't be found` when the directory it is pointed at has no repository beside it,
so the hook was never installed and `husky || true` hid the failure. See RC-14 in
`../analysis/root-causes.md`. The replacement is `.pre-commit-config.yaml`, which the
python and rust templates already use and which can also gate Python and Rust.

## Decisions for the CI/CD-relevant paths still absent

### Already covered here under a different path (no action)

| Template path(s) | Equivalent in this repository |
| --- | --- |
| `.github/workflows/release.yml` (js, python, rust) | `.github/workflows/js.yml`, `python.yml`, `rust.yml` - one per language, each carrying the same detect-changes / lint / test / release jobs |
| `.github/workflows/workflows.yml` (js, python, rust) | `.github/workflows/ci-policy.yml`, which runs the same `docker://rhysd/actionlint:1.7.7` and `zizmorcore/zizmor-action@v0.6.2` jobs plus this repository's own `check-ci-workflows.mjs` policy |
| `scripts/check-version.mjs` (js), `scripts/check-version-modification.rs` (rust) | `scripts/check-version-modification.mjs`, wired into `quality.yml` for all three languages at once |
| `scripts/check-release-needed.mjs` (js), `.rs` (rust), `scripts/detect-code-changes.rs` (rust) | `scripts/detect-code-changes.mjs` + the `detect-changes` job in each language workflow |
| `scripts/check-file-size.rs` (rust), `scripts/check-crate-size.rs` (rust) | `scripts/check-file-line-limits.sh` (repository-wide), `rust/scripts/check-file-size.mjs`, `python/scripts/check_file_size.py` |
| `scripts/check-web-archive.test.mjs` + `scripts/fixtures/lychee-report.md` (rust) | `js/tests/unit/scripts/check-web-archive.test.js`, which pins the same behaviour against the report from run 33959793880 |
| `scripts/check_web_archive.py` (python) | `scripts/check-web-archive.mjs`, used by `links.yml` for the whole repository |
| `scripts/bump-version.rs`, `get-version.rs`, `get-bump-type.rs`, `version-and-commit.rs`, `collect-changelog.rs`, `create-github-release.rs`, `publish-crate.rs`, `rust-paths.rs`, `git-config.rs` | `rust/scripts/*.mjs` - the same steps, written in Node rather than `rust-script`, so no toolchain install is needed to run them |
| `scripts/install-rust-script.sh`, `scripts/test-scripts.sh` (rust) | not needed: the rust helpers here are `.mjs`, covered by `repo-scripts-lint` and by the js unit tests |
| `scripts/bump_version.py`, `format_release_notes.py`, `validate_changeset.py`, `create_manual_changeset.py`, `release_naming.py`, `publish_to_pypi.py` (python) | `python/scripts/version_and_commit.py`, `create_github_release.py`, `read_manifest.py` and the `auto-release` / `manual-release` jobs in `python.yml` |
| `scripts/check-changesets.mjs`, `format-release-notes-helpers.mjs`, `release-naming.mjs` (and `release-naming.rs` in the rust template), `package-info.mjs`, `js-paths.mjs`, `sanitize-npm-userconfig.mjs`, `publish-retry.mjs`, `publish-failure-classifier.mjs` (js) | `js/scripts/validate-changeset.mjs`, `format-release-notes.mjs`, `format-github-release.mjs`, `read-manifest.mjs`, `clean-npm-config.mjs`, and the retry loop inside `js/scripts/publish-to-npm.mjs` (`MAX_RETRIES`, `RETRY_DELAY`) |
| `.ruff.toml` (python) | `[tool.ruff]` in `python/pyproject.toml` - same settings, one manifest |
| `.prettierignore` at the root (js) | `js/.prettierignore`; `.prettierrc` was moved to the root by this pull request so the root files are formatted by the same configuration |
| `docs/CONTRIBUTING.md`, `docs/BEST-PRACTICES.md` (js) | `README.md` (the new "Local Quality Gates" section) and `dev/log/issues/81/pulls/82/research/CI-CD-BEST-PRACTICES.md` |
| `docs/api.md`, `docs/index.md`, `docs/conf.py`, `docs/requirements.txt` (python) | `docs.yml` validates the documentation this repository actually publishes; there is no Sphinx site here |
| `scripts/check-mjs-syntax.sh` (js) | superseded: `repo-scripts-lint` runs ESLint over `scripts/`, `experiments/` and `rust/scripts/`, and parsing every file is a strict superset of `node --check` |

### Not applicable to this repository

| Template path(s) | Why |
| --- | --- |
| `.github/actions/publish-dockerhub/action.yml`, `.github/actions/setup-buildx-resilient/action.yml`, `scripts/check-docker-build.mjs`, `scripts/check-docker-publish.mjs` | no Dockerfile and no image is published here, so best practice #13 has nothing to apply to |
| `.github/workflows/example-app.yml`, `scripts/update-preview-images.mjs`, `docs/screenshots/example-app/*.png` (5 files) | the template ships a demo application; this repository's examples are exercised by `js/examples` and the parity suite |
| `.github/workflows/desktop-release.yml`, `scripts/package-desktop.sh`, `scripts/desktop-release-resolve.sh`, `docs/download/index.html`, `docs/screenshots/desktop-download-page.png` (rust) | there is no desktop artifact to package |
| `.github/actionlint.yaml` (rust) | it exists to silence "unknown runner label" reports for `macos-15-intel` and `windows-11-arm`. This repository uses only `ubuntu-latest`, `macos-latest` and `windows-latest`, all of which actionlint 1.7.7 knows, and the actionlint job is green without it. Adding it would suppress nothing and could hide a future typo |
| `scripts/check-cargo-lock.rs`, `check-changelog-fragment.rs`, `create-changelog-fragment.rs` (rust) | the changelog here is produced by the `changelog` job in `rust.yml` from commit messages, not from fragment files |
| `scripts/bootstrap-dependencies.mjs`, `scripts/run-command.mjs` (js) | both exist to make the templates' seven use-m-loading release scripts fail loudly; this repository loads use-m in one place, `scripts/use-module.mjs`, which already bounds and reports the load |
| `docs/ci-cd/troubleshooting.md` (rust) | the same ground is covered here by the case studies under `docs/case-studies/` and by `dev/log/issues/81/pulls/82/analysis/root-causes.md`, which record the failures this repository actually had |
| `docs/preview-regeneration.md` (python) | documents the preview-image flow that is not applicable here |

### Genuine gaps, adopted by this pull request

| Template path(s) | What it fixes |
| --- | --- |
| `scripts/run-with-budget-warning.sh` (js, python, rust) | a step that owns its deadline. A job killed by `timeout-minutes` is reported by GitHub as **cancelled**, not failed, so an overrun does not read as a failure and cannot name the budget it blew |
| `scripts/check-pipeline-status.sh` (js, python, rust) | turns a cancelled required job into a failure on the default branch, where nothing else would surface it |
| `docs/CI-TIMEOUT-BUDGETS.md` (js) | records which step owns which budget, so the numbers are reviewable rather than folklore |

Both scripts exist to remove a false negative, which is what issue #81 is about, so they
are in scope for this pull request. The follow-up commit adopts them; see
`../analysis/root-causes.md` (RC-16) for the failure mode and the reproduction.

### Genuine gaps, deliberately not adopted here

| Template path(s) | Decision |
| --- | --- |
| `scripts/smoke-test-package.mjs`, `scripts/wait-for-npm.mjs` (js), `scripts/smoke_test_published_package.py` (python), `scripts/smoke-test-published-crate.rs`, `scripts/wait-for-crate.rs` (rust) | a post-publish smoke test is a real gate this repository lacks, but it can only be exercised by an actual release to npm, PyPI and crates.io. Adding three jobs that cannot be run before merge would put unverified red jobs into the pipeline this pull request exists to make trustworthy. Recorded as a follow-up rather than guessed at |
| `scripts/land-via-pull-request.mjs`, `scripts/push-main-with-rebase-retry.mjs`, `scripts/push-failure-classifier.mjs` (js) | the release jobs here push the version commit to `main` after a `git fetch` + `git rebase` (`js/scripts/version-and-commit.mjs:180`, `python/scripts/version_and_commit.py:166`) with no retry, and `rust/scripts/version-and-commit.mjs:337` pushes without rebasing. Losing the race, or a ruleset that rejects direct pushes, fails the job **loudly** - it is a flake, not a false positive or a false negative, so it is outside the scope of this issue |
| `scripts/lint-changed-lines.mjs`, `scripts/lint.mjs` (js) | annotates warnings only on lines the branch changed. Useful noise control (this repository currently has 10 ESLint warnings in `scripts/`), but it narrows what a run reports, which is the opposite direction from "find every warning" - deliberately left for a separate change |

## Raw lists

Every template path absent here, including the non-CI/CD ones, so the comparison can be
re-run and diffed later.

### js template: paths present upstream, absent here (334)

```
.github/actions/publish-dockerhub/action.yml
.github/actions/setup-buildx-resilient/action.yml
.github/workflows/example-app.yml
.github/workflows/release.yml
.github/workflows/workflows.yml
.husky/pre-commit
bin/example-package-name.js
deno.lock
docs/BEST-PRACTICES.md
docs/CI-TIMEOUT-BUDGETS.md
docs/CONTRIBUTING.md
docs/case-studies/issue-13/hive-mind-issue-960.json
docs/case-studies/issue-13/hive-mind-pr-961-diff.txt
docs/case-studies/issue-13/hive-mind-pr-961.json
docs/case-studies/issue-21/README.md
docs/case-studies/issue-21/ci-logs/run-20803315337.txt
docs/case-studies/issue-21/ci-logs/run-20885464993.txt
docs/case-studies/issue-21/issue-111-data.txt
docs/case-studies/issue-21/issue-113-data.txt
docs/case-studies/issue-21/pr-112-data.json
docs/case-studies/issue-21/pr-112-diff.patch
docs/case-studies/issue-21/pr-114-data.json
docs/case-studies/issue-21/pr-114-diff.patch
docs/case-studies/issue-23/README.md
docs/case-studies/issue-23/data/hive-mind-check-version.mjs
docs/case-studies/issue-23/data/hive-mind-ci.yml
docs/case-studies/issue-23/data/hive-mind-eslint.config.mjs
docs/case-studies/issue-23/data/hive-mind-release.yml
docs/case-studies/issue-23/data/issue-1126-details.txt
docs/case-studies/issue-23/data/issue-1141-comments.json
docs/case-studies/issue-23/data/issue-1141-details.txt
docs/case-studies/issue-23/data/pr-1127-conversation-comments.json
docs/case-studies/issue-23/data/pr-1127-diff.txt
docs/case-studies/issue-23/data/pr-1127-review-comments.json
docs/case-studies/issue-23/data/pr-1142-conversation-comments.json
docs/case-studies/issue-23/data/pr-1142-diff.txt
docs/case-studies/issue-23/data/pr-1142-review-comments.json
docs/case-studies/issue-25/DETAILED-COMPARISON.md
docs/case-studies/issue-25/README.md
docs/case-studies/issue-25/data/hive-mind-file-tree.txt
docs/case-studies/issue-25/data/issue-1274-case-study.md
docs/case-studies/issue-25/data/issue-1278-case-study.md
docs/case-studies/issue-25/data/template-file-tree.txt
docs/case-studies/issue-3/README.md
docs/case-studies/issue-3/created-issues.md
docs/case-studies/issue-3/issue-data.json
docs/case-studies/issue-3/original-format-release-notes.mjs
docs/case-studies/issue-3/reference-pr-59-diff.txt
docs/case-studies/issue-3/reference-pr-59.json
docs/case-studies/issue-3/release-v0.1.0.json
docs/case-studies/issue-3/repositories-with-same-script.json
docs/case-studies/issue-3/research-notes.md
docs/case-studies/issue-31/web-capture-pr49-commits.json
docs/case-studies/issue-33/ci-logs/release-24395209194.txt
docs/case-studies/issue-33/ci-logs/upstream-nodejs-62430.json
docs/case-studies/issue-33/ci-logs/upstream-npm-cli-9151.json
docs/case-studies/issue-33/ci-logs/upstream-runner-images-13883.json
docs/case-studies/issue-36/README.md
docs/case-studies/issue-36/ci-logs/release-24399965550.txt
docs/case-studies/issue-38/CASE-STUDY.md
docs/case-studies/issue-40/CICD-COMPARISON.md
docs/case-studies/issue-40/README.md
docs/case-studies/issue-40/data/ci-run-25212337438.json
docs/case-studies/issue-40/data/ci-runs-branch.json
docs/case-studies/issue-40/data/downstream-web-capture-issue-98.json
docs/case-studies/issue-40/data/downstream-web-capture-pr-99.diff
docs/case-studies/issue-40/data/downstream-web-capture-pr-99.json
docs/case-studies/issue-40/data/issue-40.json
docs/case-studies/issue-40/data/js-cicd-files.txt
docs/case-studies/issue-40/data/js-template-file-tree.txt
docs/case-studies/issue-40/data/pr-43.json
docs/case-studies/issue-40/data/related-js-merged-prs.json
docs/case-studies/issue-40/data/rust-cicd-files.txt
docs/case-studies/issue-40/data/rust-template-file-tree.txt
docs/case-studies/issue-40/data/rust-template-head.txt
docs/case-studies/issue-40/data/shields-broken-prefixed-badge.svg
docs/case-studies/issue-40/data/shields-broken-prefixed-prerelease-badge.svg
docs/case-studies/issue-40/data/shields-working-normalized-badge.svg
docs/case-studies/issue-40/data/shields-working-prerelease-badge.svg
docs/case-studies/issue-40/rust-template/create-github-release.rs
docs/case-studies/issue-40/rust-template/release.yml
docs/case-studies/issue-41/README.md
docs/case-studies/issue-41/data/hive-mind-check-file-line-limits.sh
docs/case-studies/issue-41/data/hive-mind-file-tree.txt
docs/case-studies/issue-41/data/hive-mind-issue-1593-case-study.md
docs/case-studies/issue-41/data/hive-mind-issue-1593-comments.json
docs/case-studies/issue-41/data/hive-mind-issue-1593.json
docs/case-studies/issue-41/data/hive-mind-issue-1730-case-study.md
docs/case-studies/issue-41/data/hive-mind-issue-1730-comments.json
docs/case-studies/issue-41/data/hive-mind-issue-1730.json
docs/case-studies/issue-41/data/js-template-check-file-line-limits-before.sh
docs/case-studies/issue-41/data/js-template-eslint.config.js
docs/case-studies/issue-41/data/js-template-file-tree.txt
docs/case-studies/issue-41/data/js-template-issue-41-comments.json
docs/case-studies/issue-41/data/js-template-issue-41.json
docs/case-studies/issue-41/data/js-template-release.yml
docs/case-studies/issue-41/data/js-template-warn-threshold-search-before.json
docs/case-studies/issue-41/data/rust-template-check-file-size.rs
docs/case-studies/issue-41/data/rust-template-created-issue-url.txt
docs/case-studies/issue-41/data/rust-template-file-tree.txt
docs/case-studies/issue-41/data/rust-template-issue-40.json
docs/case-studies/issue-41/data/rust-template-issues.json
docs/case-studies/issue-41/data/rust-template-max-lines-search.json
docs/case-studies/issue-41/data/rust-template-release.yml
docs/case-studies/issue-42/README.md
docs/case-studies/issue-42/data/ci-runs-branch.json
docs/case-studies/issue-42/data/issue-42-comments.json
docs/case-studies/issue-42/data/issue-42.json
docs/case-studies/issue-42/data/js-template-file-tree.txt
docs/case-studies/issue-42/data/js-template-pre-fix-head.txt
docs/case-studies/issue-42/data/link-foundation-my-package-search.txt
docs/case-studies/issue-42/data/link-foundation-package-name-search.txt
docs/case-studies/issue-42/data/pr-45-conversation-comments.json
docs/case-studies/issue-42/data/pr-45-review-comments.json
docs/case-studies/issue-42/data/pr-45-reviews.json
docs/case-studies/issue-42/data/pr-45.json
docs/case-studies/issue-42/data/related-merged-prs-check-release-needed.json
docs/case-studies/issue-42/data/related-merged-prs-publish-to-npm.json
docs/case-studies/issue-42/data/rust-template-ci-cd-findings.txt
docs/case-studies/issue-42/data/rust-template-file-tree.txt
docs/case-studies/issue-42/data/rust-template-head.txt
docs/case-studies/issue-56/README.md
docs/case-studies/issue-56/artifacts/universal-app-mobile.png
docs/case-studies/issue-56/artifacts/universal-app-web.png
docs/case-studies/issue-56/data/actions-checkout-release.json
docs/case-studies/issue-56/data/actions-configure-pages-release.json
docs/case-studies/issue-56/data/actions-deploy-pages-release.json
docs/case-studies/issue-56/data/actions-setup-node-release.json
docs/case-studies/issue-56/data/actions-upload-artifact-release.json
docs/case-studies/issue-56/data/actions-upload-pages-artifact-release.json
docs/case-studies/issue-56/data/bun-test-final.log
docs/case-studies/issue-56/data/changeset-status-after-stage.log
docs/case-studies/issue-56/data/check-file-line-limits-final-2.log
docs/case-studies/issue-56/data/check-mjs-syntax-final-2.log
docs/case-studies/issue-56/data/deep-sdk-capacitor.config.ts
docs/case-studies/issue-56/data/deep-sdk-electron-package.json
docs/case-studies/issue-56/data/deep-sdk-file-tree.txt
docs/case-studies/issue-56/data/deep-sdk-gh-pages.yml
docs/case-studies/issue-56/data/deep-sdk-package.json
docs/case-studies/issue-56/data/deep-sdk-repo.json
docs/case-studies/issue-56/data/deno-test-final.log
docs/case-studies/issue-56/data/example-desktop-package-final-2.log
docs/case-studies/issue-56/data/example-mobile-sync-final-2.log
docs/case-studies/issue-56/data/example-web-build-final-2.log
docs/case-studies/issue-56/data/issue-56-comments.json
docs/case-studies/issue-56/data/issue-56.json
docs/case-studies/issue-56/data/link-foundation-code-search.json
docs/case-studies/issue-56/data/npm-capacitor-cli.json
docs/case-studies/issue-56/data/npm-capacitor-core.json
docs/case-studies/issue-56/data/npm-check-final-4.log
docs/case-studies/issue-56/data/npm-electron-forge-cli.json
docs/case-studies/issue-56/data/npm-install-root.log
docs/case-studies/issue-56/data/npm-install-universal-app-node20-compatible.log
docs/case-studies/issue-56/data/npm-test-final-3.log
docs/case-studies/issue-56/data/npm-vite.json
docs/case-studies/issue-56/data/pr-57.json
docs/case-studies/issue-56/data/recent-merged-prs.json
docs/case-studies/issue-56/data/universal-app-test-before.log
docs/case-studies/issue-56/data/universal-app-test-final-2.log
docs/case-studies/issue-56/data/validate-changeset-final.log
docs/case-studies/issue-56/data/vk-bot-desktop-build-renderer.mjs
docs/case-studies/issue-56/data/vk-bot-desktop-electron-main.cjs
docs/case-studies/issue-56/data/vk-bot-desktop-file-tree.txt
docs/case-studies/issue-56/data/vk-bot-desktop-js-workflow.yml
docs/case-studies/issue-56/data/vk-bot-desktop-package.json
docs/case-studies/issue-56/data/vk-bot-desktop-repo.json
docs/case-studies/issue-58/README.md
docs/case-studies/issue-58/data/actions-configure-pages-release.json
docs/case-studies/issue-58/data/actions-deploy-pages-release.json
docs/case-studies/issue-58/data/actions-upload-artifact-release.json
docs/case-studies/issue-58/data/actions-upload-pages-artifact-release.json
docs/case-studies/issue-58/data/bun-test.log
docs/case-studies/issue-58/data/check-file-line-limits.log
docs/case-studies/issue-58/data/check-mjs-syntax.log
docs/case-studies/issue-58/data/checks-and-release-25733140225.json
docs/case-studies/issue-58/data/checks-and-release-25733140225.log
docs/case-studies/issue-58/data/checks-and-release-25743983223.log
docs/case-studies/issue-58/data/ci-run-25743983223.json
docs/case-studies/issue-58/data/csharp-template-file-tree.txt
docs/case-studies/issue-58/data/csharp-template-release.yml
docs/case-studies/issue-58/data/deno-test.log
docs/case-studies/issue-58/data/example-app-25733140224.json
docs/case-studies/issue-58/data/example-app-25733140224.log
docs/case-studies/issue-58/data/example-desktop-package.log
docs/case-studies/issue-58/data/example-mobile-sync.log
docs/case-studies/issue-58/data/example-web-build.log
docs/case-studies/issue-58/data/issue-58-comments.json
docs/case-studies/issue-58/data/issue-58.json
docs/case-studies/issue-58/data/js-template-file-tree.txt
docs/case-studies/issue-58/data/link-foundation-example-package-name-search.json
docs/case-studies/issue-58/data/main-ci-runs.json
docs/case-studies/issue-58/data/npm-check-final.log
docs/case-studies/issue-58/data/npm-example-package-name-view.json
docs/case-studies/issue-58/data/npm-global-install.log
docs/case-studies/issue-58/data/npm-install-after-metadata.log
docs/case-studies/issue-58/data/npm-install-universal-app.log
docs/case-studies/issue-58/data/npm-install.log
docs/case-studies/issue-58/data/npm-pack-dry-run-final.json
docs/case-studies/issue-58/data/npm-test-2.log
docs/case-studies/issue-58/data/npm-whoami.log
docs/case-studies/issue-58/data/pages-enable-result.json
docs/case-studies/issue-58/data/pages-status-after-enable.json
docs/case-studies/issue-58/data/pr-57.diff
docs/case-studies/issue-58/data/pr-57.json
docs/case-studies/issue-58/data/pr-59-conversation-comments.json
docs/case-studies/issue-58/data/pr-59-review-comments.json
docs/case-studies/issue-58/data/pr-59-reviews.json
docs/case-studies/issue-58/data/pr-59.json
docs/case-studies/issue-58/data/python-template-file-tree.txt
docs/case-studies/issue-58/data/python-template-release.yml
docs/case-studies/issue-58/data/regression-after-2.log
docs/case-studies/issue-58/data/regression-after-3.log
docs/case-studies/issue-58/data/regression-after.log
docs/case-studies/issue-58/data/regression-before.log
docs/case-studies/issue-58/data/rust-template-file-tree.txt
docs/case-studies/issue-58/data/rust-template-release.yml
docs/case-studies/issue-58/data/secretlint.log
docs/case-studies/issue-58/data/validate-changeset.log
docs/case-studies/issue-7/BEST-PRACTICES-COMPARISON.md
docs/case-studies/issue-7/FORMATTER-COMPARISON.md
docs/case-studies/issue-7/current-repository-analysis.json
docs/case-studies/issue-7/effect-template-analysis.json
docs/case-studies/issue-75/CASE-STUDY.md
docs/case-studies/issue-93/README.md
docs/case-studies/issue-93/data/ci-runs-issue-93.json
docs/case-studies/issue-93/data/issue-93-comments.json
docs/case-studies/issue-93/data/issue-93.json
docs/case-studies/issue-93/data/link-foundation-eslint-rules-search.json
docs/case-studies/issue-93/data/link-foundation-no-changelog-comments-search.json
docs/case-studies/issue-93/data/merged-prs-case-study.json
docs/case-studies/issue-93/data/merged-prs-eslint.json
docs/case-studies/issue-93/data/npm-search-eslint-changelog-comments.json
docs/case-studies/issue-93/data/pr-94.json
docs/screenshots/example-app/example-app-en-dark.png
docs/screenshots/example-app/example-app-en-light.png
docs/screenshots/example-app/example-app-ru-dark.png
docs/screenshots/example-app/example-app-ru-light.png
docs/screenshots/example-app/example-app.png
eslint-rules/no-changelog-comments.js
examples/basic-usage.js
examples/universal-app/README.md
examples/universal-app/capacitor.config.json
examples/universal-app/electron/main.cjs
examples/universal-app/electron/preload.cjs
examples/universal-app/index.html
examples/universal-app/package-lock.json
examples/universal-app/package.json
examples/universal-app/public/favicon.svg
examples/universal-app/src/App.js
examples/universal-app/src/main.js
examples/universal-app/src/styles.css
examples/universal-app/vite.config.js
experiments/budget-runner-demo.sh
experiments/issue-141-multilang-ignore-list.sh
experiments/test-changeset-scripts.mjs
experiments/test-check-release-needed.mjs
experiments/test-detect-changes.mjs
experiments/test-failure-detection.mjs
experiments/test-format-major-changes.mjs
experiments/test-format-minor-changes.mjs
experiments/test-format-no-hash.mjs
experiments/test-format-patch-changes.mjs
experiments/test-issue75-buildx-mirror-fallback.sh
experiments/use-m-cdn-unreachable.mjs
scripts/bootstrap-dependencies.mjs
scripts/check-changesets.mjs
scripts/check-docker-build.mjs
scripts/check-docker-publish.mjs
scripts/check-mjs-syntax.sh
scripts/check-pipeline-status.sh
scripts/check-release-needed.mjs
scripts/check-version.mjs
scripts/format-release-notes-helpers.mjs
scripts/js-paths.mjs
scripts/land-via-pull-request.mjs
scripts/lint-changed-lines.mjs
scripts/lint.mjs
scripts/package-info.mjs
scripts/publish-failure-classifier.mjs
scripts/publish-retry.mjs
scripts/push-failure-classifier.mjs
scripts/push-main-with-rebase-retry.mjs
scripts/release-naming.mjs
scripts/run-command.mjs
scripts/run-with-budget-warning.sh
scripts/sanitize-npm-userconfig.mjs
scripts/smoke-test-package.mjs
scripts/update-preview-images.mjs
scripts/wait-for-npm.mjs
src/index.d.ts
tests/bootstrap-dependencies.test.js
tests/bot-commit-attribution.test.js
tests/check-changesets.test.js
tests/check-file-line-limits.test.js
tests/check-web-archive.test.js
tests/ci-timeouts.test.js
tests/create-github-release.test.js
tests/debug-print.test.js
tests/detect-code-changes.test.js
tests/docker-build.test.js
tests/docker-publish.test.js
tests/fixtures/lychee-report.md
tests/index.test.js
tests/land-via-pull-request.test.js
tests/links-workflow.test.js
tests/lint-changed-lines.test.js
tests/merge-changesets.test.js
tests/no-changelog-comments.test.js
tests/npm-registry.test.js
tests/package-info.test.js
tests/package-metadata.test.js
tests/pipeline-status.test.js
tests/publish-failure-classifier.test.js
tests/publish-retry.test.js
tests/push-failure-classifier.test.js
tests/push-main-with-rebase-retry.test.js
tests/release-badge.test.js
tests/release-naming.test.js
tests/run-with-budget-warning.test.js
tests/sanitize-npm-userconfig.test.js
tests/scripts-use-module-adoption.test.js
tests/security-workflow.test.js
tests/setup-buildx-resilient.test.js
tests/setup-npm.test.js
tests/simulate-fresh-merge.test.js
tests/smoke-test-package.test.js
tests/tag-prefix.test.js
tests/universal-app.test.js
tests/use-module-integration.test.js
tests/use-module.test.js
tests/wait-for-npm.test.js
tests/workflow-permissions.test.js
tests/workflow-reliability.test.js
tests/workflows-lint.test.js
```

### python template: paths present upstream, absent here (65)

```
.github/workflows/release.yml
.github/workflows/workflows.yml
.ruff.toml
CHANGELOG.md
CONTRIBUTING.md
changelog.d/20251218_133759_drakonard_issue_1_3b50e2f12be6.md
changelog.d/20260509_204000_issue_6_release_metadata.md
changelog.d/20260515_000000_issue_8_docs_pages.md
changelog.d/20260529_222900_issue_9_preview_regeneration.md
changelog.d/20260604_170000_issue_16_release_notes_limit.md
changelog.d/20260609_000000_issue_18_manual_release_skip.md
changelog.d/20260614_000000_issue_20_published_package_smoke_test.md
changelog.d/20260614_issue_21_python_monorepo_releases.md
changelog.d/20260628_issue_24_file_size_warnings.md
changelog.d/20260703_issue_26_docs_pages_opt_in.md
changelog.d/20260703_issue_27_codecov_token_gate.md
changelog.d/20260703_issue_28_git_default_branch_env.md
changelog.d/20260722_issue_32_node24_actions.md
changelog.d/20260722_issue_33_release_permissions.md
changelog.d/20260722_issue_34_codecov_v7_input.md
changelog.d/20260722_issue_35_ci_release_guards.md
changelog.d/20260727_issue_40_change_detection.md
changelog.d/20260801_issue_42_workflow_hardening.md
changelog.d/20260802_issue_44_mypy_python_39.md
changelog.d/20260802_issue_45_changelog_check.md
changelog.d/20260809_issue_48_security_scanning.md
changelog.d/20260809_issue_49_broken_links.md
changelog.d/20260809_issue_50_pipeline_timeout_status.md
changelog.d/20260812_issue_54_archived_broken_links.md
changelog.d/20260812_issue_55_multi_arch_docker.md
changelog.d/20260816_issue_58_dependency_audit.md
changelog.d/20260820_issue_60_step_execution_budgets.md
changelog.d/20260828_issue_62_workflow_lint.md
changelog.d/20260903_issue_64_workflow_audit.md
changelog.d/README.md
changelog.d/fragment_template.md.j2
docs/api.md
docs/conf.py
docs/index.md
docs/preview-regeneration.md
docs/requirements.txt
examples/basic_usage.py
scripts/bump_version.py
scripts/check-pipeline-status.sh
scripts/check_web_archive.py
scripts/create_manual_changeset.py
scripts/format_release_notes.py
scripts/publish_to_pypi.py
scripts/release_naming.py
scripts/run-with-budget-warning.sh
scripts/smoke_test_published_package.py
scripts/validate_changeset.py
src/my_package/__init__.py
src/my_package/py.typed
tests/test_check_file_size.py
tests/test_check_web_archive.py
tests/test_create_github_release.py
tests/test_detect_code_changes.py
tests/test_my_package.py
tests/test_preview_regeneration_docs.py
tests/test_project_metadata.py
tests/test_run_with_budget_warning.py
tests/test_simulate_fresh_merge.py
tests/test_smoke_test_published_package.py
tests/test_workflows.py
```

### rust template: paths present upstream, absent here (129)

```
.github/actionlint.yaml
.github/actions/setup-buildx-resilient/action.yml
.github/workflows/desktop-release.yml
.github/workflows/release.yml
.github/workflows/workflows.yml
CONTRIBUTING.md
docs/case-studies/issue-11/README.md
docs/case-studies/issue-11/analysis-crates-io.md
docs/case-studies/issue-11/analysis-set-output.md
docs/case-studies/issue-11/analysis-workflow-dispatch.md
docs/case-studies/issue-11/online-research.md
docs/case-studies/issue-17/README.md
docs/case-studies/issue-19/README.md
docs/case-studies/issue-19/ci-logs/ci-run-20885464993.log.gz
docs/case-studies/issue-19/pr-114-data/issue-113-details.txt
docs/case-studies/issue-19/pr-114-data/pr-commits.json
docs/case-studies/issue-19/pr-114-data/pr-conversation-comments.json
docs/case-studies/issue-19/pr-114-data/pr-details.json
docs/case-studies/issue-19/pr-114-data/pr-diff.patch
docs/case-studies/issue-19/pr-114-data/pr-review-comments.json
docs/case-studies/issue-19/pr-114-data/pr-reviews.json
docs/case-studies/issue-19/pr-114-data/solution-draft-log-1.txt.gz
docs/case-studies/issue-19/pr-114-data/solution-draft-log-2.txt.gz
docs/case-studies/issue-21/README.md
docs/case-studies/issue-21/browser-commander-issue-27.md
docs/case-studies/issue-21/browser-commander-issue-29.md
docs/case-studies/issue-21/browser-commander-issue-31.md
docs/case-studies/issue-21/browser-commander-issue-33.md
docs/case-studies/issue-21/browser-commander-rust.yml
docs/case-studies/issue-25/README.md
docs/case-studies/issue-32/README.md
docs/case-studies/issue-34/README.md
docs/case-studies/issue-38/raw-data/downstream-meta-after-run-24985948212.json
docs/case-studies/issue-38/raw-data/downstream-meta-after-run-24985948212.log.gz
docs/case-studies/issue-38/raw-data/downstream-meta-before-run-24983875003.json
docs/case-studies/issue-38/raw-data/downstream-meta-before-run-24983875003.log.gz
docs/case-studies/issue-38/raw-data/downstream-meta-ontology-issue-3.json
docs/case-studies/issue-38/raw-data/downstream-meta-ontology-pr-4.json
docs/case-studies/issue-38/raw-data/issue-38-comments.json
docs/case-studies/issue-38/raw-data/issue-38.json
docs/case-studies/issue-38/raw-data/js-template-issue-search.json
docs/case-studies/issue-38/raw-data/main-run-24465255225.json
docs/case-studies/issue-38/raw-data/main-run-24465255225.log.gz
docs/case-studies/issue-38/raw-data/main-runs.json
docs/case-studies/issue-38/raw-data/pr-39-conversation-comments.json
docs/case-studies/issue-38/raw-data/pr-39-review-comments.json
docs/case-studies/issue-38/raw-data/pr-39-reviews.json
docs/case-studies/issue-38/raw-data/pr-39.json
docs/case-studies/issue-38/raw-data/pr-branch-runs.json
docs/case-studies/issue-38/raw-data/pr-run-25212295127.json
docs/case-studies/issue-38/raw-data/pr-run-25212295127.log.gz
docs/case-studies/issue-38/raw-data/rust-template-issue-search.json
docs/case-studies/issue-38/template-data/js-template-ci-tree.txt
docs/case-studies/issue-38/template-data/js-template-links.yml
docs/case-studies/issue-38/template-data/js-template-release.yml
docs/case-studies/issue-38/template-data/rust-template-ci-tree.txt
docs/case-studies/issue-38/template-data/rust-template-release-after.yml
docs/case-studies/issue-38/template-data/rust-template-release-before.yml
docs/case-studies/issue-52/README.md
docs/case-studies/issue-52/raw-data/issue-52-comments.json
docs/case-studies/issue-52/raw-data/issue-52.json
docs/case-studies/issue-52/raw-data/js-issue-62.json
docs/case-studies/issue-52/raw-data/vk-bot-desktop-issue-51.json
docs/case-studies/issue-52/raw-data/vk-bot-desktop-pr-52.json
docs/case-studies/issue-69/README.md
docs/ci-cd/troubleshooting.md
docs/download/index.html
docs/screenshots/desktop-download-page.png
examples/basic_usage.rs
experiments/issue-139-multi-language-detect-code-changes.sh
experiments/test-changelog-parsing.rs
experiments/test-crates-io-check.rs
experiments/test-detect-code-changes.sh
experiments/test-issue141-manifest-printf-quoting.sh
experiments/test-issue143-throttled-crates-io-probe.rs
experiments/test-issue69-buildx-mirror-fallback.sh
experiments/test-version-check-dependencies.sh
experiments/test-version-check.sh
scripts/bump-version.rs
scripts/check-cargo-lock.rs
scripts/check-changelog-fragment.rs
scripts/check-crate-size.rs
scripts/check-file-size.rs
scripts/check-pipeline-status.sh
scripts/check-release-needed.rs
scripts/check-version-modification.rs
scripts/check-web-archive.test.mjs
scripts/collect-changelog.rs
scripts/create-changelog-fragment.rs
scripts/create-github-release.rs
scripts/desktop-release-resolve.sh
scripts/detect-code-changes.rs
scripts/fixtures/lychee-report.md
scripts/get-bump-type.rs
scripts/get-version.rs
scripts/git-config.rs
scripts/install-rust-script.sh
scripts/package-desktop.sh
scripts/publish-crate.rs
scripts/release-naming.rs
scripts/run-with-budget-warning.sh
scripts/rust-paths.rs
scripts/smoke-test-published-crate.rs
scripts/test-scripts.sh
scripts/version-and-commit.rs
scripts/wait-for-crate.rs
src/sum.rs
tests/integration/mod.rs
tests/integration/sum.rs
tests/unit/ci-cd/changelog_parsing.rs
tests/unit/ci-cd/desktop_release_resolve.rs
tests/unit/ci-cd/issue_119.rs
tests/unit/ci-cd/issue_127.rs
tests/unit/ci-cd/issue_135.rs
tests/unit/ci-cd/issue_141.rs
tests/unit/ci-cd/issue_143.rs
tests/unit/ci-cd/issue_147.rs
tests/unit/ci-cd/issue_149.rs
tests/unit/ci-cd/issue_150.rs
tests/unit/ci-cd/mod.rs
tests/unit/ci-cd/release_naming_tests.rs
tests/unit/ci-cd/version_and_commit_behind_check.rs
tests/unit/ci-cd/version_and_commit_tag_order.rs
tests/unit/ci-cd/workflow_desktop_release.rs
tests/unit/ci-cd/workflow_release.rs
tests/unit/ci-cd/workflow_security.rs
tests/unit/ci-cd/workspace_manifest_resolution.rs
tests/unit/mod.rs
tests/unit/sum.rs
```
