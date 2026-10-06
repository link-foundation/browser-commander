# Issue #128: timeline

All times are UTC. Sources: `../github/run-*.json`, `../github/recent-main-runs.json`,
`../github/issue.json`, `../github/pr.json`, the logs in `../ci-logs/`, and
`git log` on this branch.

| When | What happened | Evidence |
|---|---|---|
| 2026-10-05 12:18 | The scheduled parity run 37308596612 on `1693531` passes. It runs the snapshot, parity, WebDriver and driver suites. Ten other real-browser suites skip without `RUN_E2E` or are `#[ignore]`d, and no workflow runs them (signal 8). | `ci-logs/parity-37308596612.log` |
| 2026-10-06 17:49 | Rust run 37505100807 on the PR #127 branch. On Windows, the post-job cache save takes five minutes (17:55:38 to 18:00:55). | `ci-logs/history/rust-37505100807-windows.log` |
| 2026-10-06 18:11 | PR #127 is merged as `b24e4c5`, which starts 11 workflow runs on `main`. | `github/run-375093282*.json`, `github/run-375093283*.json`, `github/run-375093284*.json` |
| 18:11 to 18:22 | Three of the 11 runs fail. Safari: a test server's `close()` never resolves (signal 1). Rust: the repeated doc-test step on Windows exceeds its 180s budget and exits 124 (signal 2). Python: PyPI rejects trusted publishing with `invalid-publisher` (signal 3). The other eight runs pass, but their logs carry the false negatives, warnings and noise listed in `signal-classification.md`. | `ci-logs/*-375093282*.log`, `ci-logs/*-375093283*.log`, `ci-logs/*-375093284*.log`, `github/annotations-*.json` |
| 18:13:27 | The JS auto-release commits `9f8a552` ("0.26.0") on `main`. | `git log origin/main` |
| 19:39:41 | Issue #128 is opened: "Check for all false positives, false negatives, warnings and errors in CI/CD and fix them all". | `github/issue.json` |
| 19:40:56 | Draft PR #129 is opened from `issue-128-ae7261d9fb8b`. | `github/pr.json` |
| 19:55 to 20:28 | First fixes are committed: Safari server close (`f2988a3`), the budget wrapper (`545cf48`), a single doc-test run (`d54fef5`), fail-closed version and changeset checks (`e594680`, `2ba7e27`), the Puppeteer manifest drift test failing instead of skipping (`5925ee5`), the collected evidence (`1ef04c5`), links, command-stream noise, sqlite leaks, release preflight and `ubuntu-24.04` (`d52079b` to `1786f5a`). | `git log` (committer times) |
| ~20:13 | Pushed PR runs fail twice. The duplication gate fails on import blocks the fixes moved (fixed by `fc9cf66`), and the experiments lint fails (fixed by `68dda97`). | `ci-logs/pr/` |
| after 20:28 | Run 37526767522 on `1786f5a`: every workflow passes except JS on Windows. The manifest test that `5925ee5` stopped skipping fails there with `Cannot read properties of undefined (reading 'program')`. | `ci-logs/pr/failed-37526767522.log` |
| 20:43 to 20:59 | zizmor at low confidence and pinned to 1.30.1 (`e99bdd2`, `317e76a`); `cargo audit --deny warnings` and a pinned secretlint (`ec49a5a`); the Pages skip annotation (`404d183`). The upstream reports are filed and recorded (`681d274`): command-stream#213, rust template #185 and #186, python template #95, js template #209 and #210. | `git log`, `../upstream/README.md` |
| 21:01 to 21:19 | The bot e-mail (`c744aae`, documented in `4769aa6`); jscpd printing only new clones (`2617221`); the status gate failing on cancellations that no supersede explains (`fa75f97`); the lychee cache (`38f8c10`); forward-slash virtual paths for the Puppeteer parser on Windows (`c0ce820`); the nine unrun real-browser suites wired into `parity.yml` (`481f01e`). | `git log` |
| 21:23 to 21:38 | The runs on `481f01e` and `a3be93b`: 9 of 11 pass. Parity fails in the newly wired `real_browser_smoke` (signal 35), and the Safari JS smoke fails on a back-to-back launch (signal 36). | `ci-logs/pr/failed-37533920926.log`, `ci-logs/pr/failed-37533921118.log`, `ci-logs/pr/failed-37533483103.log`, `ci-logs/pr/failed-37525917388.log` |
| 21:30 to 21:47 | Fixes for the CodeQL alerts: the preflight test URL (`c760d16`), command-stream quoting of the release commit (`d6a0451`), linear-time text selectors in JS and Python (`ccc072c`), artifact names (`47a61cd`), the release-notes marker (`df2c54d`), and the Rust test names and cookie fixture (`dbfc075`, `3a31c23`). | `git log`; `github/codeql-open-alerts-main.json` |
| 21:49 to 21:57 | The `about:blank` smoke expectation (`7859214`), and the Safari launch retry in JS, Python and Rust (`7ac5cd3`, `9faa67b`, `03f27be`). | `git log` |
| 21:58 to 22:10 | On `03f27be`, the JS duplication gate fails (signal 37), and CodeQL opens PR alerts 63 and 64 (signal 38). Both are fixed in `14dfbc4` and `7978db9`. | `ci-logs/pr/failed-37537484417.log` |
