# Root causes and fixes

One row per defect. "Class" separates the four things the issue asks about: an
**error** fails a job, a **false negative** is a green check that proved
nothing, a **false positive** would fail a job for something that is not a
defect, and a **warning** is noise that hides the other three.

| # | Class | Defect | Where |
| --- | --- | --- | --- |
| RC-A | error | PyPI trusted publishing has no registered publisher; the Python release has never succeeded | `.github/workflows/python.yml` |
| RC-B | false negative | `command-stream`'s `$` resolves on non-zero exit, so every `try/catch` around it is dead code | `scripts/use-module.mjs` |
| RC-C | false negative | The Rust release publishes to crates.io without ever committing the bump or the changelog | `rust/scripts/version-and-commit.mjs` |
| RC-D | error | JS and Rust write into one `v<version>` tag namespace and overwrite each other | `*/scripts/create-github-release.mjs` |
| RC-E | false negative | The release commit is pushed with `GITHUB_TOKEN`, so it is never tested | all three release workflows |
| RC-G | false negative | `changeset version` crashes on a missing `deno` binary after bumping but before deleting the changeset | `js/deno.json`, `js/.changeset/config.json` |
| RC-H | error | `findNextAvailableVersion` hard-fails after 20 registry probes | `rust/scripts/version-and-commit.mjs:171` |

RC-F was investigated and **dropped**: Dependency Review reporting `skipped` on
a push run is correct behaviour, not a regression. See the note at the end.

---

## RC-A — a release step that has never once worked

```
##[error]Trusted publishing exchange failure:
Token request failed: the server refused the request for the following reasons:
  * `invalid-publisher`: valid token, but no corresponding publisher
```
— `../ci-logs/run-33974450000.log`, job "Auto Release", step "Publish to PyPI"

This is the only red X in the issue's table, and it is the only signal of the
eight that is telling the truth. Two independent checks confirm the release has
never succeeded:

* `https://pypi.org/pypi/browser-commander/json` returns **404** — the project
  does not exist on PyPI.
* `git tag -l 'python-v*'` is empty — the `Create GitHub Release` step has
  never run either.

`pypa/gh-action-pypi-publish` mints an OIDC token from GitHub and exchanges it
at PyPI for a short-lived API token. PyPI can only complete that exchange if a
*pending publisher* has been registered ahead of time, matching the repository
owner, repository name, workflow filename and environment. Nothing in this
repository can create that registration — it is a one-time action in the PyPI
web UI by an account owner.

So the code fix here is not "make it publish". It is: **fail early and say what
a human has to do**, instead of failing 4 minutes in with a message that reads
like a bug in the workflow.

**Fix.** Add a pre-flight step to `python.yml`'s `auto-release` that probes
whether the project is claimable and, if not, fails with the exact registration
parameters (owner, repo, workflow file, environment) spelled out in the error.
Record the maintainer action in the PR description. Separately, `python.yml`'s
`auto-release` job has **no version-bump and no changelog-collection step at
all** — `manual-release` has both (`scriv collect`, `Version and commit`) but
`auto-release` only checks whether the tag already exists. Even with the
publisher registered, the automatic path would publish the same version
forever. Both halves need fixing for the Python pipeline to work.

---

## RC-B — the `try/catch` that can never catch

Measured directly against the version the CI scripts load:

```
shell.settings() → { errexit: false, verbose: false, xtrace: false, ... }
```

`command-stream`'s `` $`…` `` **resolves** with a result object carrying the
exit code; it does not reject. Thirteen scripts in this repository are written
as though it does:

```js
try {
  await $`npx changeset version`;
} catch (error) {
  console.error('Error during version bump:', error.message);
  process.exit(1);
}
```
— `js/scripts/changeset-version.mjs`

That `catch` is unreachable. `changeset version` crashed on run 33974450016
(RC-G) and this script reported success. This one defect is the reason RC-C and
RC-G both survived: it converts every failure inside a release script into a
green check.

It also cuts the other way. `rust/scripts/version-and-commit.mjs:311-320` uses
the *inverted* idiom — it relies on `$` throwing to detect that there ARE
changes:

```js
try {
  await $`git diff --cached --quiet`.run({ capture: true });
  console.log('No changes to commit');   // ← always taken
  setOutput('version_committed', 'false');
  return;
} catch {
  // There are changes to commit
}
```

`git diff --cached --quiet` exits `1` when there are staged changes. Because
`$` never rejects, the `catch` never runs, and the script returns "No changes
to commit" **even when it has just staged two modified files**. That is RC-C.

Verified with `experiments/ci-repro/repro-command-stream-exit-code.mjs`: the
plain-shell control reports `exits with 1`, while the `` $ `` call resolves.

**Fix.** Turn on `shell.errexit(true)` inside `loadCommandStream()` in
`scripts/use-module.mjs` — the single choke point every consumer goes through —
so a non-zero exit rejects with `Command failed with exit code N` and `e.code`
set. Proven working for all three invocation forms. Then audit all thirteen
consumers for sites that legitimately depended on resolve-on-failure (the
inverted `git diff` idiom above is one; it must be rewritten to test
`git status --porcelain` output rather than an exit code). While in that file,
wire the existing `CI_SCRIPTS_DEBUG=1` switch to `shell.verbose()` and
`shell.xtrace()`, default off, so the next failure is diagnosable from the log.

---

## RC-C — twelve releases, zero commits

Run 33974450069 concluded **success**. Its release job printed:

```
Current version 0.9.0 is NOT published on crates.io
Version 0.10.0 already published on crates.io, trying next...
   … ten more probes …
Next available version: 0.10.11
Updated Cargo.toml to version 0.10.11
Collected 12 changelog fragment(s)
No changes to commit
Output: version_committed=false
Output: new_version=0.10.11
```
— `../ci-logs/run-33974450069.log:8159-8176`

and then published `browser-commander v0.10.11` to crates.io and created GitHub
release `v0.10.11`. On `origin/main` today:

* `rust/Cargo.toml` still says `0.9.0`
* `rust/CHANGELOG.md` contains nothing newer than the hand-written
  `## [0.1.0]` entry — none of the twelve published releases appear in it
* the same twelve fragments are still sitting in `rust/changelog.d/`

Three separate defects stack up here:

1. **The commit gate is inverted** (RC-B). The script stages `Cargo.toml` and
   `CHANGELOG.md`, then takes the "no changes" branch unconditionally.
2. **`collectChangelog()` never deletes what it consumed**
   (`rust/scripts/version-and-commit.mjs:212-268`). It reads every fragment,
   splices them into `CHANGELOG.md`, and leaves the files in place. Even once
   the commit works, the same twelve entries would be re-published in every
   future release.
3. **Publishing is not gated on the commit.** The `Publish to Crates.io` step
   in `.github/workflows/rust.yml` runs regardless of
   `version_committed`. A release that could not record itself still ships.

The job conclusion was `success`. This is the textbook false negative the issue
is asking about.

**Fix.** Rewrite the commit gate to branch on `git status --porcelain` *output*
rather than an exit code (the JS script already does it this way — reuse that
shape). Delete consumed fragments in `collectChangelog()` and stage the
deletions. Gate `Publish to Crates.io` on `version_committed == 'true'` so an
unrecordable release fails loudly instead of shipping.

---

## RC-H — the mask has a hard deadline

The reason nobody noticed RC-C is that the version number kept going up anyway.
`findNextAvailableVersion()` re-derives it from the registry on every run:

```js
const MAX_ATTEMPTS = 20;
let version = calculateNewVersion(current, bumpType);
while (await checkVersionOnCratesIo(crateName, version)) {
  attempts++;
  if (attempts >= MAX_ATTEMPTS) {
    throw new Error(`Could not find an available version after ${MAX_ATTEMPTS} attempts (last tried: ${version})`);
  }
  ...
}
```
— `rust/scripts/version-and-commit.mjs:170-191`

Because `Cargo.toml` is never committed, every run restarts from `0.9.0`, walks
`0.10.0 … 0.10.N`, and lands on the first free slot. The walk grew by one
probe per release: run 33974450069 needed eleven. At twenty it throws, and the
Rust release stops working outright — currently about nine releases away.

This is worth calling out separately from RC-C because it changes the priority.
RC-C is not a latent tidiness problem; it is a countdown.

**Fix.** Fixing RC-C fixes this by construction — once `Cargo.toml` is
committed, the walk starts from the real current version and terminates on the
first probe. Keep the loop as a guard against races between concurrent runs,
but it should no longer be load-bearing.

---

## RC-G — `changeset version` aborts between the bump and the cleanup

`js/deno.json` exists:

```json
{ "nodeModulesDir": "auto", "test": { "include": ["tests/"], "exclude": ["examples/", "node_modules/"] } }
```

`grep -rn "deno" .github/workflows/` returns nothing. No workflow uses Deno.
This file is orphaned configuration — and it is the entire cause of the defect.

`@changesets/cli` v3 formats the files it rewrites. `@changesets/format`'s
`detect()` walks `defaultDetectOrder = ["dprint", "deno", "oxfmt", "biome",
"prettier"]` and picks the first formatter whose config file is present.
`deno.json` is present, `deno` is second in the order — so it wins, ahead of
`prettier`. `ubuntu-latest` has no `deno` binary, so the format call dies with
`spawn deno ENOENT`.

The order of operations inside `applyReleasePlan` is what makes this expensive:
it writes the version bump, writes the changelog, **formats**, and only then
deletes the consumed changeset. The crash lands in the middle. The bump is on
disk, the changeset is still there, and `js/scripts/changeset-version.mjs`
swallows the non-zero exit (RC-B) and reports success.

The consequence is visible on main right now:
`js/.changeset/merged-loud-river.md` is still present, and its content is
already published in `js/CHANGELOG.md` under `## 0.17.0`. The next push to main
will consume it again and cut a duplicate `0.18.0`.

Reproduced deterministically in
`experiments/ci-repro/repro-changeset-deno-formatter.mjs`: two temp fixtures,
identical except for the presence of `deno.json`, `deno` scrubbed from `PATH`.
The deno fixture exits 1 with `spawn deno ENOENT`, version bumped, changeset
surviving; the control exits 0 with the changeset deleted.

**Fix.** Add `"format": "prettier"` to `js/.changeset/config.json` — the key is
part of `@changesets/config@4.0.0/schema.json`, which the file already
references, and it pins the formatter instead of letting `detect()` guess.
Verified against the reproduction. Then delete the stale
`js/.changeset/merged-loud-river.md`, and run prettier over `js/CHANGELOG.md`
to repair the format gate it currently breaks (RC-E). `js/deno.json` itself
should go too, since nothing uses it.

This is also an upstream bug. `link-foundation/js-ai-driven-development-pipeline-template`
ships both `deno.json` and `deno.lock` and is not yet affected only because it
pins `@changesets/cli: ^2.29.7`, which predates the auto-detect. It will break
on the next major upgrade. That warrants a report with the reproduction
attached.

---

## RC-D — two languages, one tag namespace

`rust/scripts/create-github-release.mjs` builds `` const tag = `v${version}` ``.
`js/scripts/create-github-release.mjs` builds the same string. Python already
namespaces its tags as `python-v<version>`; the other two do not.

The collision is not hypothetical. Tag `v0.10.11` — created by the Rust release
— points at `8f5f4bb`, which is the **JS** 0.17.0 version-bump commit. Registry
history shows the version numbers have genuinely overlapped at `0.4.0`, `0.9.1`
and `0.10.0`, each existing on both npm and crates.io.

**Fix.** Namespace the Rust tags as `rust-v<version>`, matching the Python
convention, in both `create-github-release.mjs` and the `git tag -a` call in
`version-and-commit.mjs`. Leave the JS tags as bare `v<version>` (npm is the
primary artifact and existing tags stay valid).

---

## RC-E — the release commit is the one commit nobody tests

`8f5f4bb` ("0.17.0", author `github-actions[bot]`) has **zero** CI runs.
This is documented GitHub Actions behaviour: a push made with the default
`GITHUB_TOKEN` does not trigger further workflow runs, specifically to prevent
recursion.

The practical consequence is already on main. `js/CHANGELOG.md` as written by
`changeset version` **fails `prettier --check`**, and `.github/workflows/js.yml:188`
runs `npm run format:check` with `CHANGELOG.md` not listed in `.prettierignore`.
Nobody saw it, because the commit that introduced it was never checked — the
next contributor's pull request will fail for a reason that has nothing to do
with their change. That is a false positive waiting to happen, manufactured by
a false negative.

**Fix.** Validate the release commit's content before pushing it: at minimum run
`format:check` over the files the release step touched, inside the release job,
after the bump and before the commit. This keeps the fast feedback in the job
that caused the problem rather than deferring it to an unrelated PR.

---

## RC-F — investigated and dropped

The Security workflow reports `dependency-review` as `skipped`, which initially
looked like the regression fixed in issue #81 coming back. It is not. The job
carries `if: github.event_name == 'pull_request'`, and run 33974450021 is a
**push**. `skipped` is the correct conclusion. The `Check whether the
dependency graph is enabled` probe step and its `::warning title=Dependency
review skipped::` annotation behave as designed. No change needed.

Recording it here because "checked and found clean" is a result too, and the
issue asks for false positives — a fix applied here would have been one.

---

## The systemic cause behind RC-B, RC-C and RC-G

The repository does have a CI-script test suite — `js/tests/unit/scripts/`
holds sixteen test files, including ones for `use-module.mjs`,
`read-manifest.mjs` and `check-ci-workflows.mjs`. The coverage is not absent;
it is split along exactly the wrong line:

| Tested | Untested |
| --- | --- |
| `scripts/use-module.mjs`, `read-manifest.mjs`, `debug-print.mjs`, `check-ci-workflows.mjs`, `check-version-modification.mjs`, `check-web-archive.mjs`, `js/scripts/npm-registry.mjs`, `clean-npm-config.mjs`, `run-tests.mjs` | `rust/scripts/version-and-commit.mjs`, `bump-version.mjs`, `collect-changelog.mjs`, `create-github-release.mjs`, `publish-crate.mjs`, `get-bump-type.mjs`, `js/scripts/changeset-version.mjs`, `version-and-commit.mjs`, `create-github-release.mjs`, `publish-to-npm.mjs`, `merge-changesets.mjs`, `validate-changeset.mjs` |

Every shared *helper* is tested. **Every script that actually performs a
release is not** — and that is precisely the set in which RC-B, RC-C and RC-G
all live. `.github/workflows/quality.yml`'s `repo-scripts-lint` job runs ESLint
over `scripts experiments rust/scripts`, which is lint only and cannot see an
inverted exit-code test. The rust template
(`link-foundation/rust-ai-driven-development-pipeline-template`) has a
`script-tests` job running `bash scripts/test-scripts.sh`; this repository does
not.

**Fix.** Add a test suite for the CI/release scripts and a CI job that runs it,
matching the template's `script-tests`. The reproductions in
`experiments/ci-repro/` are the starting point: each one already fails against
the current code and passes against the fix.
