# Upstream reports filed for issue #83

Issue #83 asks that a defect found in the templates be reported there too:

> if the same issue is found in template report issue also in templates

and that each report carry

> reproducible examples, workarounds, and suggestions for fixing the issue in code

This directory holds the body of every report that was filed, so the reasoning stays in
this repository even if an upstream issue is edited or closed. Issue #81's reports are in
[`../../../81/pulls/82/templates/upstream-reports/`](../../../81/pulls/82/templates/upstream-reports/).

Every claim in these bodies was executed before it was written. The clones used were
`js` at `338fafa`, `python` at `81c9786` and `rust` at `4d444d9`; `@changesets/format` at
`0.1.2`, cross-checked against `main`.

## Filed

| File                                | Issue                                                                                                                                                                                                      | Defect                                                                                                                                                                                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js-command-stream-dead-catch.md`   | [js#170](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/170)                                                                                                         | `command-stream`'s `$` resolves on a non-zero exit, so every `try { await $\`…\` } catch { process.exit(1) }`in the five release scripts is unreachable.`changeset-version.mjs`prints`✅ Version bump complete`and exits 0 after`npx changeset version` fails (RC-B)                                    |
| `release-commit-never-validated.md` | [js#171](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/171), [rust#159](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/159) | the release job pushes a commit it wrote itself with `GITHUB_TOKEN`, which by design triggers no workflow run, and the `lint`/`test` jobs it `needs:` saw only the parent. A formatting violation introduced by a release lands on `main` untested and fails the next contributor's pull request (RC-E) |
| `changesets-format-deno-detect.md`  | [changesets/format#45](https://github.com/changesets/format/issues/45)                                                                                                                                     | `deno.configFiles` lists the bare `"deno.json"` before `{ file: "deno.json", key: "fmt" }`, so the key check is unreachable and any `deno.json` selects the deno formatter — the one formatter with no `packageName`, spawned straight off `PATH` (RC-G's true mechanism)                               |

## Added to an existing report

`js-154-comment.md` →
[js#154 (comment)](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/154#issuecomment-5555145046).

js#154 already predicted that `changeset version` would spawn a deno command after the
changesets 3.x upgrade, so a second issue would have been a duplicate. Two things in it
needed correcting, and both were measured before the comment was written:

- **The named mechanism is not the one that fires.** js#154 attributes it to
  `deno.lock` outranking `package-lock.json` in `package-manager-detector`, producing
  `deno x prettier`. The actual path is `@changesets/format`'s own `detect()`, which sees
  `deno.json`, selects the deno formatter, and runs `spawnProcess("deno", ["fmt", …])`
  directly. `detect({ cwd: '/tmp/templates/js' })` returns `deno` today.
- **The proposed workaround does not prevent it.** `devEngines.packageManager` is read
  only through `ctx.getPackageManager()`, which the deno formatter never calls. Adding it
  and stopping there would leave the release broken while looking fixed.

## Not filed, and why

| Candidate                                                           | Decision                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC-C — the version bump is never committed                          | **not a template defect.** `rust/scripts/version-and-commit.rs:855` in the template reads the real exit code (`if exec_check("git", &["diff", "--cached", "--quiet"])`). RC-C is a porting defect introduced here when those scripts were rewritten as `.mjs`, where the inverted `try`/`catch` idiom met a `$` that never rejects |
| RC-D — the three languages share one `v<version>` tag namespace     | **not applicable.** The templates are single-language, so there is nothing to collide with. The rust template already threads a `tag_prefix`                                                                                                                                                                                       |
| RC-H — `findNextAvailableVersion` gives up after 20 registry probes | **not present upstream**                                                                                                                                                                                                                                                                                                           |
| RC-A — PyPI trusted publishing has no registered publisher          | **not reportable.** The registration is per-repository and cannot be wrong in a template. `python/scripts/publish_to_pypi.py` has the same shape as ours                                                                                                                                                                           |
| RC-F — `dependency-review` reported `skipped`                       | **not a defect.** `if: github.event_name == 'pull_request'` on a push run; `skipped` is the correct outcome. Filing it would have added the false positive this issue exists to remove                                                                                                                                             |
