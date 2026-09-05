# js template: every `try { await $`…` } catch` in the release scripts is dead code

**Title:** Release scripts print "✅ Version bump complete" after `changeset version` crashes: `command-stream`'s `$` resolves on a non-zero exit, so every `catch` in the release path is unreachable

## Summary

`scripts/use-module.mjs` hands every release script a `$` from `command-stream`:

```js
export function loadCommandStream(use) {
  return useModule('command-stream', '$', use);
}
```

`command-stream` **resolves** its promise when a command exits non-zero. It does not reject. That is the opposite of `zx` and `execa`, and it is the opposite of what all five release scripts in `scripts/` are written against. Each of them wraps its work in

```js
try { await $`some-command`; } catch (error) { …; process.exit(1); }
```

so the `catch` can never run. The failing command is skipped over, the script continues, prints its success line and exits 0, and the workflow step is green.

`scripts/run-command.mjs` already documents the hazard in its own header —

> Unlike command-stream's `$`, `runStrict` throws on a non-zero exit code, restoring `set -e` semantics.

— but `runStrict` is used only by `push-main-with-rebase-retry.mjs` and `land-via-pull-request.mjs`. The release scripts do not use it.

## Affected scripts (at `338fafa`)

| Script                                               | The command whose failure is swallowed    | What is printed instead                                                               |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `scripts/changeset-version.mjs:47,50`                | `npx changeset version`                   | `✅ Version bump complete with synchronized package-lock.json` (line 65), then exit 0 |
| `scripts/changeset-version.mjs:59,62`                | `npm install --package-lock-only`         | same                                                                                  |
| `scripts/version-and-commit.mjs:232,241,244,261,266` | the bump, `git add -A`, `git commit`      | the version outputs are set regardless                                                |
| `scripts/publish-to-npm.mjs:235`                     | `git pull origin main`                    | publish proceeds from a stale tree                                                    |
| `scripts/format-github-release.mjs:109`              | `node scripts/format-release-notes.mjs …` | exit 0 with the release notes unformatted                                             |
| `scripts/format-release-notes.mjs:221`               | `gh api … -X PATCH`                       | exit 0 with the release notes not written                                             |

`version-and-commit.mjs:254` is the one call site that is already safe, because it captures `git status --porcelain` and branches on its _output_ rather than on an exception.

## Reproducible example

Against a fresh clone of this repository, using this repository's own loader:

```js
// probe.mjs
import { loadCommandStream } from './scripts/use-module.mjs';
const { $ } = await loadCommandStream();
try {
  const result = await $`exit 7`;
  console.log('try branch ran; result.code =', result?.code);
} catch (error) {
  console.log('catch branch ran; error.code =', error?.code);
}
```

```console
$ node probe.mjs
Command failed with exit code 7try branch ran; result.code = 7
```

`command-stream` even prints its own `Command failed with exit code 7` — and then resolves. The exit code is right there on the resolved value; the promise simply never rejects.

End to end, with the actual script, on a clean clone of this repository at `338fafa`:

```console
$ npm ci --ignore-scripts
$ rm -f node_modules/.bin/changeset      # make `npx changeset version` fail
$ node scripts/changeset-version.mjs; echo "exit=$?"
Detected single-language repository (package.json in root)
Running changeset version...
npm error could not determine executable to run
npm error A complete log of this run can be found in: /home/box/.npm/_logs/…-debug-0.log

Synchronizing package-lock.json...
…
✅ Version bump complete with synchronized package-lock.json
exit=0
```

`npm error could not determine executable to run` is printed, the version is not bumped, and the script reports success.

## Why this matters more than a swallowed error

It is not only that failures are silent — it is that the _next_ step runs on the wreckage. A downstream consumer of this template hit both halves of that on 2026-09-05, in one push (`link-foundation/browser-commander`, run [33974450016](https://github.com/link-foundation/browser-commander/actions/runs/33974450016)):

- `changeset version` died partway through, after bumping `package.json` and writing `CHANGELOG.md` and **before** deleting the changeset it had just consumed. The job reported success, 0.17.0 shipped to npm, the consumed changeset stayed on disk to be released a second time, and the half-written `CHANGELOG.md` landed on the default branch with trailing whitespace that fails `prettier --check` — so the _next_ contributor's pull request failed for a reason that had nothing to do with their change.
- In the Rust sibling of the same pipeline, `git diff --cached --quiet` was being used in the inverted idiom (`try` = "nothing staged", `catch` = "commit it"). With a `$` that never rejects, twelve consecutive releases published to the registry without ever committing, tagging or pushing the version bump.

Neither job was ever red. That is the shape of the problem: this is a false negative that manufactures errors elsewhere.

## Suggested fix

`command-stream` exposes the switch already — `shell.errexit(true)` makes `$` reject on a non-zero exit. Setting it in `loadCommandStream()`, the single place every script obtains `$` from, gives all five scripts the semantics they are already written for, with no call-site changes:

```js
export async function loadCommandStream(use) {
  const commandStream = await useModule('command-stream', '$', use);
  const shell = commandStream.shell;
  if (shell && typeof shell.errexit === 'function') {
    shell.errexit(true);
  }
  return commandStream;
}
```

Two things are worth doing alongside it, both learned the hard way downstream:

1. **Audit for the inverted idiom before flipping the switch.** Any call site that used `catch` to mean "the command reported non-zero, which is the outcome I wanted" flips from always-wrong to always-wrong-the-other-way. `git diff --quiet`, `grep -q` and `gh api` 404 probes are the usual suspects. `version-and-commit.mjs:254`'s `git status --porcelain` capture is the pattern to move them to.
2. **The rejection's `message` does not carry the reason.** `command-stream` rejects with `message: "Command failed with exit code 1"`; the text a caller needs to branch on ("already published", "already exists") is in `stderr` or `stdout`. Call sites written as `error.message.includes('already published')` silently stop matching the moment the promise genuinely rejects — which would turn a harmless re-run over an already-published version into a failed release. Worth a helper that joins `message`, `stdout` and `stderr` before matching.

A regression test that costs nothing:

```js
it('rejects when a command exits non-zero', async () => {
  const { $ } = await loadCommandStream();
  await assert.rejects(
    () => $`exit 3`,
    (error) => error.code === 3
  );
});
```

## Context

Found while auditing CI/CD false positives, false negatives, warnings and errors in `link-foundation/browser-commander` ([issue #83](https://github.com/link-foundation/browser-commander/issues/83), [PR #84](https://github.com/link-foundation/browser-commander/pull/84)), which uses this repository as its CI/CD template. Filing here per that issue's instruction to report template-shared problems upstream.

The reproduction above is kept runnable downstream as `experiments/ci-repro/repro-template-dead-catch.mjs`.
