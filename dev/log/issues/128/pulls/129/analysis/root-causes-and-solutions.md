# Issue #128: root causes and solutions

There is one row for each signal in `signal-classification.md`, then one for
each gap in `template-comparison.md`. "Test" names the check that fails if the
problem comes back. Each `*-before.log` in `../reproductions/` records that
test, or the experiment, failing before the fix.

## CI signals on `main` @ `b24e4c5`

| # | Signal | Root cause | Solution | Commit | Test |
|---|---|---|---|---|---|
| 1 | Safari smoke: one test cancelled, run fails | Node 24's `server.close()` waits for idle keep-alive sockets, and Safari leaves a preconnect socket open, so a test server's close never resolves. | Close idle connections, then all connections, before `close()` (`closeIdleConnections()`, `closeAllConnections()`) in every test server. | `f2988a3` | Safari smoke on CI; `experiments/issue-128/server-close-preconnect.mjs` |
| 2 | Rust Windows "Run doc tests" exceeds its 180s budget (exit 124) | `cargo test --all-features` already runs the doc tests. The extra `cargo test --doc` ran without `--all-features`, so it recompiled the crate with another feature set, which took more than 180s on Windows. | Drop the extra step. Doc tests run once, in the main suite. | `d54fef5`; upstream rust template #185 | `ci-timeout-budgets.test.js` |
| 3 | PyPI `invalid-publisher` | PyPI has no trusted publisher registered for this repository and workflow. This is configuration outside the repository. | **Maintainer action:** register a trusted publisher on PyPI for project `browser-commander`, owner `link-foundation`, repository `browser-commander`, workflow `python.yml`, no environment. `f2fbb6d` adds a release preflight that proves each registry accepts the publish before anything is built, so the problem now fails early and says what to do. | `f2fbb6d` | `release-preflight` jobs |
| 4 | 17 Python changelog fragments left unreleased | Consequence of 3: 0.5.3 never reached PyPI, so every push retries 0.5.3. | Resolved by 3. | — | — |
| 5 | Puppeteer manifest drift test always skipped | The test skipped exactly when the installed `puppeteer-core` (25.12.0) and the manifest (25.10.0) differed, which is the drift it exists to catch. | Regenerate the manifest and fail on a mismatch. Making the test run exposed a Windows-only bug: TypeScript 7's virtual file system matches exact keys and the compiler asks for `/` paths, but `path.join` built `\` keys, so the project was `undefined`. `c0ce820` builds the virtual paths with `/`. | `5925ee5`, `c0ce820` | `puppeteer-bindings-coverage.test.js`; `reproductions/puppeteer-manifest-drift.log`, `reproductions/puppeteer-api-windows-paths-before.log`, `experiments/ts-virtual-fs-windows-keys.mjs` |
| 6 | Python `ResourceWarning: unclosed database` | `with sqlite3.connect(...)` commits but does not close the connection (Python docs: "The context manager neither implicitly opens a new transaction nor closes the connection"). | Wrap connections in `contextlib.closing`, and turn `ResourceWarning` into an error in pytest. | `2b159b4` | `reproductions/python-resourcewarning-{before,after}.log` |
| 7 | Codecov upload skipped | No `CODECOV_TOKEN` secret. The skip is already visible as a `::notice::` in both `python.yml` and `rust.yml`. | **Maintainer action:** add `CODECOV_TOKEN`, or remove the upload steps. No code change: the notice already makes the skip visible. | — | — |
| 8 | Ten real-browser suites never run | They skip without `RUN_E2E` or are `#[ignore]`d, and no workflow set the flag or passed `--ignored`. | Run nine of them in `parity.yml`, each followed by a check that fails on a skip or on zero passes. The Google sign-in probe stays manual because it drives a third-party site. | `481f01e` | `e2e-suite-coverage.test.js`; `reproductions/unrun-e2e-suites-before.log` |
| 9 | `Command failed with exit code 7` after the JS test summary | command-stream's virtual `exit` writes the error to stderr even when the caller handles the rejection. | The test exits through a real `sh -c "exit 7"`. Reported upstream as command-stream#213. | `f1c4d1d` | `reproductions/command-stream-exit-variants.log` |
| 10 | Library warnings printed by unit tests | Tests exercise code paths that log on purpose. | No change: these are expected messages from the code under test. | — | — |
| 11 | jscpd prints 272 accepted clones | The console reporter lists every clone, baselined or not. | `js/scripts/check-duplication.mjs` runs jscpd with the JSON reporter and prints only new clones, as `::error` annotations in Actions. | `2617221` | `check-duplication.test.js`; `reproductions/jscpd-*.log` |
| 12 | `DEP0005 Buffer()` from `actions/download-artifact@v8` | Inside the action (upstream). v8 is the latest major, and `check-ci-workflows.mjs` already bans older majors. | Track upstream. | — | `check-ci-workflows.mjs` |
| 13 | "ubuntu-latest will migrate to Ubuntu 26" | Every Linux job used the moving `ubuntu-latest` label. | Pin `ubuntu-24.04`. The policy check rejects `ubuntu-latest`. | `1786f5a` | `ci-workflow-policy.test.js` |
| 14 | zizmor version floats | `zizmor-action` had no `version:` input. | Pin zizmor 1.30.1 with zizmor-action v0.6.4 (the first release that can install it), and audit at `min-confidence: low`, which surfaced the artipacked findings that `persist-credentials: false` now fixes. | `e99bdd2`, `317e76a` | `zizmor-version.test.js`; `reproductions/zizmor-*.log` |
| 15 | secretlint unpinned | `npx --yes -p secretlint …` without a version. | Pin both packages. A planted token is still detected. | `ec49a5a` | `reproductions/secretlint-planted-secret.log` |
| 16 | lychee `--cache` without a cache | `.lycheecache` is written in the workspace, and nothing persisted it between runs. | Add `actions/cache` for `.lycheecache`, as lychee-action's README shows. The tag ref is allowed by `.github/zizmor.yml` (`lycheeverse/*: ref-pin`). | `38f8c10` | `links-workflow.test.js` |
| 17 | Redirected docs URL and three browser-internal URLs | A stale GitHub docs link; `edge://` and `chrome://` cannot be fetched. | Update the link and ignore browser-internal schemes in `.lycheeignore`. | `d52079b` | links workflow |
| 18 | pip-audit "Dependency not found on PyPI" for `browser-commander` | The local package is not on PyPI (see 3). | No change: expected until the first PyPI release. | — | — |
| 19 | Pages deployment skipped silently | `DEPLOY_GITHUB_PAGES` is not set. | Emit a `::notice::` so the skip shows in the run summary. **Maintainer action:** configure Pages and set the variable to publish. | `404d183` | — |
| 20 to 27 | Platform skips, CodeQL's `python2` probe, `::error::` text inside echoed script source, runner notices, PR-only steps, silent passes, audit successes | Expected, or noise from outside the repository. | No change. | — | — |

## Signals found while working on this PR

CodeQL's open alerts on `main` (`../github/codeql-open-alerts-main.json`) are
CI signals too, and the PR's own runs exposed two more once the unrun suites
started running.

| # | Signal | Root cause | Fix | Commit | Guard |
|---|---|---|---|---|---|
| 28 | CodeQL `js/polynomial-redos` #3, #4 (`js/src/elements/selectors.js`), and the same pattern in Python | `/^(.+?):has-text\("(.+?)"\)$/` backtracks quadratically on a long selector that does not match: 16s for 550,000 characters in JS, 48s for 220,000 in Python. | Split the selector with `indexOf`/`find` and `endsWith` (`splitTextPseudo`, `_split_text_pseudo`). | `ccc072c` | linear-time tests in `selectors.test.js` and `test_selectors.py`; `reproductions/text-selector-redos-*.log` |
| 29 | CodeQL `js/polynomial-redos` #5 (`js/src/tests/index.js`) | `/^-+\|-+$/g` is quadratic on a long run of inner dashes (4s for 50,000). | Trim the dashes by index. | `47a61cd` | `index.test.js`; `reproductions/artifact-name-redos-*.log` |
| 30 | CodeQL `js/incomplete-sanitization` #7 (`js/scripts/version-and-commit.mjs`) | The script escaped `"` by hand inside `"${…}"`, but command-stream already quotes interpolations, so the escapes became literal backslashes in the commit message. A real bug, not just a lint. | Pass the bare interpolation. A test bans `.replace(/"/g` in every release script. | `d6a0451` | `command-stream-errexit.test.js`; `reproductions/commit-message-hand-escaping-*.log` |
| 31 | CodeQL `js/incomplete-url-substring-sanitization` #6 (`js/scripts/format-release-notes.mjs`) | `includes('img.shields.io')` was used as a "notes already formatted" marker and read as a URL host check. | Look for the badge's markdown prefix, which the script itself writes. The old and new checks agree on all 60 releases. | `df2c54d` | `reproductions/release-notes-badge-marker.log` |
| 32 | CodeQL `js/incomplete-url-substring-sanitization` (PR alert #62, a test) | The preflight test asserted the registration URL with `includes`. | Extract the URL and compare it whole. | `c760d16` | `preflight-credentials.test.js` |
| 33 | CodeQL `rust/cleartext-logging` #8, #9 (`rust/src/fingerprint/profile.rs`, a test) | Name-based false positive: the rule treats variables named after latitude and longitude as private data. | Name the variables for what they hold (range errors). | `dbfc075` | — |
| 34 | CodeQL `rust/hard-coded-cryptographic-value` #14, #15 (`rust/tests/browser_cookies.rs`) | The fixture built Chrome's PBKDF2 key into a zeroed buffer and wrote the fixed IV inline. Both are public Chrome constants, but they read as secrets. | Derive the key with `pbkdf2_hmac_array` and name `CHROME_CBC_IV`. The ciphertext is byte-identical. | `3a31c23` | `experiments/issue-128/cookie-fixture-equivalence/`; `reproductions/cookie-fixture-equivalence.log` |
| 35 | Parity "snapshots" job fails in `real_browser_smoke` (run 37533920926) | A false negative made visible by `481f01e`: `4dc6743` added the `about:blank` start URL to the launch arguments, but this `#[ignore]`d smoke kept the old list because no workflow ran it. | Expect `about:blank`, as the unit and API tests already do. | `7859214` | the parity job itself |
| 36 | Safari JS smoke fails in 3 of the last 7 PR runs: `WebDriver server exited with code 1 before it was ready` (run 37533483103), or `ECONNREFUSED` from selenium (runs 37525917388, 37533921118) | Each failure is a launch less than 1.3s after the previous Safari session closed. safaridriver serves one automation session at a time, and a new driver can exit, or answer `/status` and then refuse the new session, while the previous session is still winding down. **Partly unverified:** safaridriver printed nothing, so Safari's side of the race is inferred from the timing. WebKit bug 240524 (fixed in 2022) describes the same kind of race. | Safari launches retry those start-up failures with a fresh driver, up to three attempts, in JS, Python and Rust. Authorization errors are not retried. A refused connection now names the driver server and whether it had exited. `VERBOSE=1` logs each retry. | `7ac5cd3`, `9faa67b`, `03f27be` | `webdriver.test.js` ("Safari launch right after a previous session"), `test_safari_webdriver.py`, `safari.rs` unit tests; `reproductions/safari-launch-retry-*.log` |
| 37 | JS duplication gate fails on `03f27be` (run 37537484417): new clone between `command-stream-errexit.test.js` and `use-module-integration.test.js` | The imports added in `d6a0451` moved jscpd's 9-line window onto the `hasNetwork()` helper the two tests had always duplicated. | `isUseMReachable()` in `scripts/use-module.mjs` holds the probe once. | `14dfbc4` | the duplication gate; `use-module.test.js` |
| 38 | CodeQL `js/incomplete-sanitization` PR alerts 63, 64 (the test and experiment for signal 30) | To show the bug, they re-created the old `"`-only escaping with `.replace`. | Write the hand-escaped value as a literal fixture. | `7978db9` | CodeQL on the PR |
| 39 | CodeQL `rust/hard-coded-cryptographic-value` PR alerts 65, 66 (`experiments/issue-128/cookie-fixture-equivalence`) | The experiment for signal 34 rebuilt the old fixture (zeroed key buffer, inline IV) to compare it with the new one. | Compare against the old fixture's ciphertext as recorded in `reproductions/cookie-fixture-equivalence.log`. The output is unchanged. | `de129e6` | CodeQL on the PR |

## Gaps against the pipeline templates

| # | Gap | Outcome |
|---|---|---|
| P1-1 | Redundant doc-test step | Same as signal 2 (`d54fef5`). |
| P1-2 | Windows caches `rust/target` | Kept, based on the measurements: with the cache, one or two crates are recompiled and the suite takes 178–198s. The restore costs 47–87s, and a fresh save about five minutes of post-job time, which happens only when the cache key changes. A cold Windows build would take most of the 480s budget. `Swatinem/rust-cache` is the alternative if this changes. Recorded in `docs/CI-TIMEOUT-BUDGETS.md`. |
| P1-3 | Budget wrapper with surviving children | Ported (`545cf48`), plus an opt-in `BUDGET_VERBOSE` trace for debugging. Upstream js template #209. |
| P1-4 | Status gate excused any cancellation on a superseded run | `fa75f97`: a cancellation is excused only when the branch head moved **and** the job's effective `cancel-in-progress` is `true`, read by `scripts/read-job-cancel-in-progress.mjs`. `PIPELINE_STATUS_VERBOSE=1` traces each decision. Test: `check-pipeline-status.test.js`. |
| P1-5 | Untrusted text could inject workflow commands | `2ba7e27`: `scripts/github-actions-log.mjs` brackets the text with `::stop-commands::<random token>`. |
| P1-6 | Version check failed open | `e594680` |
| P1-7 | Changeset check fell back to all changesets | `2ba7e27` |
| P2-1 | Unpinned runner labels | `1786f5a` |
| P2-2 | No release preflight | `f2fbb6d` |
| P2-3 | No link recheck pass | No change. `scripts/check-web-archive.mjs` already decides each failure, and `--max-retries 3` covers transient errors. The policy differs from the template on purpose: a dead link with an archived copy passes here, and the template fails on it. |
| P2-4 | Persisted checkout credentials | `e99bdd2` and `481f01e`: every `actions/checkout` in all 11 workflows sets `persist-credentials: false`. |
| P2-5 | zizmor and actionlint pinning | actionlint is pinned by digest; zizmor by version (`e99bdd2`, `317e76a`). |
| P2-6 | `cargo audit` ignored warnings | `ec49a5a` (`--deny warnings`) |
| P2-7 | Bot e-mail without the user-id prefix | `c744aae` uses the documented `41898282+github-actions[bot]@users.noreply.github.com` form. `4769aa6` records that GitHub already attributed the old form correctly, so this is consistency, not a fix for missing attribution. |
| P3-1 | "No secrets scan" | The comparison was wrong: `quality.yml` already runs secretlint. Only the pin was missing (signal 15). |
| P3-2 | No `dependabot.yml` | Optional, and none of the templates has one. Not adopted. |

## Debug output added (off by default)

- `PIPELINE_STATUS_VERBOSE=1`: `scripts/check-pipeline-status.sh` prints how it classified each job (superseded or not, and the effective `cancel-in-progress`).
- `BUDGET_VERBOSE=1` (defaults to GitHub's `RUNNER_DEBUG`, so a debug re-run turns it on): `scripts/run-with-budget-warning.sh` traces its liveness and signalling decisions and lists what is still running when a step overruns its budget.
- `CI_SCRIPTS_DEBUG`: already present before this work.
- `VERBOSE=1` (the libraries' existing switch): the JS, Python and Rust Safari launchers log each start-up retry (signal 36). A launch that still fails reports the driver server, its exit state and its last output in the error.

## What remains for the maintainers

1. Register the PyPI trusted publisher (signal 3). This also releases the backlog in signal 4.
2. Add `CODECOV_TOKEN`, or remove the Codecov steps (signal 7).
3. Configure GitHub Pages and set `DEPLOY_GITHUB_PAGES=true` (signal 19), if the docs should be published.
