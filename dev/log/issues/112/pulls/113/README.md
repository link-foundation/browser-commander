# Issue #112 / PR #113 — CI/CD signal audit

Evidence: `issue.json`, and `ci-logs/run-<id>.{json,log}` for all 10 runs listed in the issue
(commit `6764d1f` on `main`, plus Browser Parity `25b7191`).

## Timeline

1. 2026-10-01 ~19:00Z — PR #111 merged as `6764d1f`; nine workflows start.
2. 19:03Z — JS pipeline releases `0.21.1` (`b52749c`). Lint step passes with one ESLint warning.
3. 19:04Z — Python Auto Release builds the wheel, PyPI OIDC exchange fails with `invalid-publisher`; Pipeline Status fails.
4. 19:20Z — Rust Auto Release: push rejected once (main advanced from the JS release), rebases, publishes `0.14.0` (`863eeca`) with a cargo `--token` deprecation warning.
5. Issue #112 opened listing one failing run.

## Requirements

| # | Requirement | Status |
|---|---|---|
| R1 | Find and fix every error in CI/CD | Only error: PyPI trusted publisher (F1) — account-side, not fixable in code |
| R2 | Find and fix every warning | F2–F4 fixed; F5–F7 external/intentional (below) |
| R3 | Find false positives / negatives | F2 (lint passes with warnings) was a false negative; fixed |
| R4 | Compare with the JS/Rust/Python templates; report shared problems upstream | F4 also in the Rust template → reported |
| R5 | Follow hive-mind CI-CD-BEST-PRACTICES | Zero-warning gates, no secrets in argv, explicit script allowlists |

## Findings, root causes, and fixes

| ID | Signal (log) | Root cause | Resolution |
|---|---|---|---|
| F1 | `run-36911106264.log:4365` `invalid-publisher` | `browser-commander` is not on PyPI and no *pending* trusted publisher is registered for `link-foundation/browser-commander`, `python.yml`, no environment. Same finding as issues #83/#99; `scripts/explain_pypi_failure.py` already prints the exact form values. | **Maintainer action**: register the pending publisher at https://pypi.org/manage/account/publishing/ and re-run. Kept as a hard failure (correct positive). |
| F2 | `run-36911106131.log` `530:8 warning Async function 'launchAndConnectRealBrowserWithDependencies' has a complexity of 31` | Function grew past the limit; `npm run lint` was `eslint .`, which exits 0 on warnings, so CI stayed green (false negative). | Extracted `removingTemporaryProfileOnError()` in `js/src/browser/real-browser.js`; lint is now `eslint . --max-warnings 0`. Verified: old code → exit 1, new code → exit 0. |
| F3 | `run-36911106131.log:10042` `npm warn install-scripts ... node-pty@1.2.0-beta.15 (install: node-gyp rebuild)` | npm's `allowScripts` gate; `node-pty` comes transitively from `command-stream` and was not listed. | Added `"node-pty": false` to `allowScripts` (explicitly blocked, like `puppeteer`). Verified locally: 4 warning lines without the entry, 0 with it. |
| F4 | `run-36911106321.log:14604` ``cargo publish --token` is deprecated`` | `rust/scripts/publish-crate.mjs` passed the token as a flag. | Token now exported as `CARGO_REGISTRY_TOKEN` (also keeps it out of argv). Upstream: https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/177. Check: `experiments/issue-112-no-cargo-token-flag.mjs`. |
| F5 | `run-36911106264.log:4180` `[DEP0005] Buffer() is deprecated` | Inside `actions/download-artifact@v8` (latest is v8.0.1). | Already reported upstream: https://github.com/actions/download-artifact/issues/484. No local action. |
| F6 | Rust `Push to origin/main was rejected ... retrying (attempt 2/3)` | JS and Rust releases race on `main`; the retry logic handled it. | Intentional informational warning; no change. |
| F7 | Links: chromium.googlesource.com answered 503 twice | Remote host outage; checker deliberately does not fail on 429/5xx. | Intentional; no change. |

Security (CodeQL), Docs, Quality, Feature Parity, CI Policy, Browser Parity: 0 warnings, 0 errors.

## Existing tools
- PyPI trusted publishing docs: https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/
- ESLint `--max-warnings`: https://eslint.org/docs/latest/use/command-line-interface#--max-warnings
- Cargo registry token env: https://doc.rust-lang.org/cargo/reference/config.html#registrytoken
