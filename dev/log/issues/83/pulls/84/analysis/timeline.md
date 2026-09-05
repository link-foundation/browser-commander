# Timeline

All eight runs in the issue's table are the same push: `4f7af54`
("Merge pull request #82 from link-foundation/issue-81-9d4c346eb143"), queued
at `2026-09-05T15:19:32Z`. Seven are green and one is red, which is why the
issue asks about false positives and false negatives rather than just about the
red one — the interesting failures are inside the green runs.

## The push that the issue is about

| Run | Workflow | Conclusion | What actually happened |
| --- | --- | --- | --- |
| 33974450000 | Python CI/CD Pipeline | **failure** | PyPI trusted publishing rejected the OIDC token (RC-A) |
| 33974450013 | Documentation | success | genuinely green |
| 33974450016 | JS CI/CD Pipeline | success | released npm 0.17.0, but `changeset version` had already crashed (RC-G) |
| 33974450017 | Repository Quality Gates | success | genuinely green |
| 33974450018 | Broken Link Checker | success | genuinely green |
| 33974450021 | Security | success | `dependency-review` skipped — correct, this is a push |
| 33974450025 | CI Workflow Policy | success | genuinely green |
| 33974450069 | Rust CI/CD Pipeline | **success** | published crates.io 0.10.11 without committing a single file (RC-C) |

## Sequence of events inside the push

```
15:19:32  push 4f7af54 to main; eight workflows queued
15:22:xx  js.yml    → changeset version → @changesets/format detect() picks `deno`
                      because js/deno.json exists → spawn deno ENOENT → crash
                      AFTER the version bump, BEFORE the changeset is deleted
15:22:19  js.yml    → npm publish 0.17.0 succeeds anyway; the leftover
                      .changeset/merged-loud-river.md is committed back to main
15:22:51  rust.yml  → Cargo.toml reads 0.9.0, walks crates.io 0.10.0..0.10.10,
                      lands on 0.10.11
15:22:53  rust.yml  → "No changes to commit"; version_committed=false
15:27:08  rust.yml  → publishes crates.io 0.10.11 anyway, tags v0.10.11
15:2x:xx  python.yml→ Publish to PyPI → invalid-publisher → the only red X
```

## The longer arc

The two silent defects are older than this push.

* **crates.io** holds `0.10.0` … `0.10.11`, twelve releases, while
  `origin/main:rust/Cargo.toml` still says `0.9.0` and `rust/CHANGELOG.md`
  still ends at the hand-written `## [0.1.0]` entry.
  Every one of those twelve releases went out without a commit. The version
  number only advances because `findNextAvailableVersion()` re-derives it from
  the registry on each run (`rust/scripts/version-and-commit.mjs:170-191`).
* **PyPI** has no `browser-commander` project at all —
  `https://pypi.org/pypi/browser-commander/json` returns `404` — and the
  repository has zero `python-v*` tags. The Python release has never once
  succeeded.
* **The release commits are never tested.** `8f5f4bb` ("0.17.0", authored by
  `github-actions[bot]`) has no CI runs, because a push made with
  `GITHUB_TOKEN` does not trigger workflows. That commit left
  `js/CHANGELOG.md` in a state that fails `prettier --check`, so the failure
  surfaces on the *next* contributor's pull request instead.

## Why this push was the first to show a red X

`4f7af54` merged PR #82, which fixed the Python release path far enough for it
to reach the `Publish to PyPI` step for the first time. The step then failed on
the trusted-publisher exchange. Previous pushes died earlier and never got
there. The red X is therefore progress, not a regression — but it is the only
one of the eight signals that is telling the truth.
