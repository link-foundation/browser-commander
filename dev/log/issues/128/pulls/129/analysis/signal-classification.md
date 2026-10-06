# CI/CD signal classification — main @ b24e4c5 (issue #128)

Sources: `../ci-logs/*.log` (11 runs, all on commit b24e4c5 except
`parity-37308596612`, which is the most recent scheduled parity run) and
`../github/annotations-<runid>.json` (check-run annotations for every job of
every run). Line numbers refer to the raw log files. Every root cause was
checked against `.github/workflows/`, `scripts/`, or the source under test
unless it is marked **unverified**.

Classification legend:

- **real error**: CI failed for a real defect.
- **false negative**: CI is green but something is broken or not tested.
- **false positive**: a check passes while doing nothing, or reports success it did not earn.
- **warning**: a legitimate signal that needs action.
- **noise**: output that looks alarming but is harmless.
- **expected**: correct and documented behaviour.

## Summary table

| # | Workflow / job / step | Log:line | Quoted signal | Class | Root cause (verified?) | Fix |
|---|---|---|---|---|---|---|
| 1 | Safari / smoke / JS Safari smoke | safari:192-206, 1924 | `ℹ cancelled 1` … `##[error]Process completed with exit code 1.` | real error (known) | Node 24 `server.close()` waits for Safari's idle preconnect socket | in progress (f2988a3): `closeIdleConnections()`/`closeAllConnections()` in test servers |
| 2 | Rust / Test (windows-latest) / Run doc tests | rust:8789-8791 | `Rust doc tests did not finish within its 180s budget and was terminated` | real error (known) + duplication | `cargo test --all-features` (rust.yml:269-270) **already runs Doc-tests** (rust:4001/4026, 6658/6687, 8748/8773: `20 passed`); rust.yml:272-276 runs them a second time | delete the `Run doc tests` step, or change line 270 to `cargo test --all-features --lib --bins --tests` and keep the doc step |
| 3 | Python / Auto Release / pypi-publish | python:5264, 5311 | `Trusted publishing exchange failure` / `invalid-publisher` | real error (known) | PyPI has no trusted publisher for this repo/workflow/environment | register the publisher on PyPI (owner link-foundation, repo browser-commander, workflow python.yml, environment as declared) |
| 4 | Python / Auto Release / collect changelog | python:5050 | `CHANGELOG.md already contains version 0.5.3; leaving 17 newer fragment(s) for the next version` | false negative (consequence of #3) | python/CHANGELOG.md top entry is `0.5.3 — 2026-09-06`; because 0.5.3 never reached PyPI, every push retries 0.5.3 and 17 fragments (python/changelog.d) pile up unreleased | fixed by #3; optionally make the auto-release fail loudly when fragments exist but the version was not bumped |
| 5 | JS / Test (all 3 OS) / unit | js:3602, 6277, 8950 | `﹣ come from the installed puppeteer-core … # puppeteer-core 25.12.0 is installed, the manifest is 25.10.0` | **false negative** | js/tests/unit/puppeteer-bindings-coverage.test.js:126-149 skips on version mismatch; rust/protocol/puppeteer/api.json is `25.10.0`, the lockfile pins puppeteer-core 25.12.0, so the drift check never runs | regenerate with `node scripts/generate-puppeteer-bindings.mjs --update-api`; make the mismatch `assert.fail` when `process.env.CI` is set (or always) |
| 6 | Python / Test (all 3 OS) / pytest | python:1504, 3194, 4023 (summary `1 warning` at 1700, 3391, 4225) | `ResourceWarning: unclosed database in <sqlite3.Connection object …>` | warning (real leak) | `with sqlite3.connect(...)` only commits and does **not** close. Likely leak: tests/unit/browser/test_cookie_sources.py:46 (warning surfaces in that file on Linux and macOS); the same pattern is in tests/unit/browser/migration/test_firefox_history.py:22,37,64,88,112. src/browser_commander/browser/browser_cookies.py:83 `_open_cookie_database` returns a bare connection that callers must close. **Leak site unverified** (pytest is not available locally) | wrap in `contextlib.closing(...)`; add `filterwarnings = ["error::ResourceWarning"]` to `[tool.pytest.ini_options]` in python/pyproject.toml so the leak cannot come back |
| 7 | Python / Test / Upload coverage | annotation (python run), python.yml:280-296 | `Skipping Codecov upload because CODECOV_TOKEN is not configured` | false positive | python.yml gates the codecov step on `env.CODECOV_TOKEN != ''`; the secret is absent, so coverage is never uploaded but the job is green | add the `CODECOV_TOKEN` secret, or drop the Codecov steps (and the badge, if any) |
| 8 | Parity, JS, Python, Rust (all) | n/a, workflow grep | e2e/ignored suites not referenced by any workflow | **false negative** | not run anywhere: JS e2e playwright, puppeteer, click-readiness, downloads, traces; Python e2e test_portable_storage_state.py, test_real_browser_webdriver.py; Rust `#[ignore]` connect_smoke, launch_smoke (4 tests), real_browser_smoke (2 tests). parity.yml runs only snapshot, parity, webdriver, playwright_driver, puppeteer_bridge, trace_record_real_browser, storage_state_smoke | add them to parity.yml (scheduled/real-browser job) with the same "fail on `# SKIP` / 0 tests" guard, or document them as manual-only |
| 9 | JS / Test (ubuntu, macOS) / unit | js:4207, 9555 | `Command failed with exit code 7` | noise | js/tests/unit/scripts/command-stream-errexit.test.js:96 runs `` $`exit 7` ``; command-stream's virtual `exit` (`$.process-runner-virtual.mjs`, `handleVirtualError`) echoes `error.message` to stderr | run with output capture or mirror off (for example `$({ mirror: false })\`exit 7\``), or use `sh -c "exit 7"` with stdio captured |
| 10 | JS / Test / unit | js:2275-3579 (for example 3387) | `⚠️ Navigation detected…`, `Temporary error while checking URL… (retrying)` | noise | library console output from unit tests that exercise those paths | inject a silent logger in those tests (optional) |
| 11 | JS / Lint and Format Check / check:duplication | js:~1420-1500 | `Clone found …` (many) | noise | js/package.json `check:duplication` = `jscpd . --baseline .jscpd-baseline.json --fail-on-new-clones`; js/.jscpd.json uses the `console` reporter, which prints baselined clones too | switch the CI reporter to one that prints only new clones (or `--silent`), keeping the baseline gate |
| 12 | Python / Auto Release / download-artifact@v8 | python:5077-5078 | `(node:2457) [DEP0005] DeprecationWarning: Buffer() is deprecated…` | warning (upstream) | python.yml:427 uses `actions/download-artifact@v8`; scripts/check-ci-workflows.mjs:37 already bans v1-v7 for the same warning, so v8 still emits it | track upstream; bump when a fixed release exists (policy check already in place) |
| 13 | all workflows | annotations | `The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026` | warning | every job uses `runs-on: ubuntu-latest` | pin `ubuntu-24.04` (and validate on `ubuntu-26.04`) or accept the migration knowingly |
| 14 | CI Policy / zizmor | ci-policy log | zizmor action with `version: latest` | warning (supply chain) | ci-policy.yml: `zizmorcore/zizmor-action@v0.6.2` with `version: latest` | pin a zizmor version |
| 15 | Quality / secretlint | quality.yml:43 | `npx --yes -p secretlint -p @secretlint/secretlint-rule-preset-recommend …` | warning (supply chain) | unpinned npx packages. The silent pass itself is legitimate: a local probe with the repo's `.secretlintrc.json` detected a planted `ghp_` token, including in dotfiles and `.github/` | pin versions (`secretlint@x.y.z`, `@secretlint/…@x.y.z`) |
| 16 | Links / lychee | links.yml | `lycheeverse/lychee-action@v2` with `--cache --max-cache-age 1d` | warning | action is referenced by a tag, not a SHA; `--cache` without `actions/cache` restores nothing between runs | pin to a SHA; add `actions/cache` for `.lycheecache` or drop `--cache` |
| 17 | Links / lychee | links:264-267, summary | `🔀 Redirected 1`: `docs.github.com/actions/security-guides/using-secrets-in-github-actions --[302]-->` …; `⛔ Unsupported 3` (`edge://welcome-edge`, `edge://welcome-new-profile`, `chrome://version`) | warning / noise | stale URL in docs/case-studies/issue-33/README.md; browser-internal schemes cannot be checked | update the URL to `https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets`; add `^(edge|chrome)://` to `.lycheeignore` |
| 18 | Security / Audit Python dependencies | security:677 | `browser-commander Dependency not found on PyPI and could not be audited: browser-commander (0.5.3)` | expected | the local package is not on PyPI (see #3) | optional: exclude the local package (pip-audit `--skip-editable`, or audit the requirements only) |
| 19 | Docs / Build Combined Docs | docs:1022 | `GitHub Pages deployment is disabled. Set repository variable DEPLOY_GITHUB_PAGES=true…` | expected (silent) | docs.yml:115-137 gated on `vars.DEPLOY_GITHUB_PAGES`; Pages is not configured (API 404) | enable Pages and set the variable, or emit `::notice::` so the skip is visible |
| 20 | JS / Test (windows) | js:4569, 5635, 6399-6402, 6567 | `# SKIP use-m cannot import absolute paths on Windows`, POSIX-mode skips (8 total) | expected | documented platform limitations | none |
| 21 | Python / Test | pytest summaries | 13 / 14 / 19 skipped (ubuntu / macOS / windows) | expected | RUN_E2E-gated e2e tests, Safari-only, /proc-only, and POSIX-only tests | none (e2e coverage gap is #8) |
| 22 | Security / CodeQL python | security:1753 | `/bin/sh: 1: python2: not found` | noise | CodeQL extractor probing for a python2 interpreter | none |
| 23 | Security / Cargo audit, parity, rust OpenSSL-free build | security:151; parity:1072, 1424; rust:1432 | `::error::` text | noise | the string appears inside echoed script source (`##[group]Run …`), not as emitted annotations | none |
| 24 | runner annotations | annotations | macOS arm64 capacity notice; Links `Summary report available` | noise | GitHub-hosted runner and lychee notices | none |
| 25 | Quality / Version Modification Check | quality log | step skipped on push | expected | PR-only check by design | none |
| 26 | Feature parity / `--check` scripts, CI Policy | feature-parity, ci-policy logs | pass silently; `CI workflow policy passed for 11 workflow(s).` | expected (**not verified** non-trivial for feature-parity) | n/a | optional: print the number of items checked |
| 27 | Security / npm audit, cargo audit, CodeQL | security:9171, 211, 2534, 7129, 8959 | `found 0 vulnerabilities`; 328 crates scanned; CodeQL scanned 327/327 Python, 442/442 JS, 286/286 Rust files | expected | n/a | none |

## Narrative per actionable finding

**1. Safari JS smoke cancelled (known).** One test was cancelled because the
test HTTP server's `close()` never resolved: Safari keeps an idle preconnect
socket open and Node 24's `server.close()` waits for it. The Pipeline Status
gate correctly reported `Failing jobs: smoke` (safari:1924-1925). The fix in
progress is commit f2988a3.

**2. Rust Windows doc-test timeout (known) plus duplicated doc tests.**
`cargo test --all-features` without target filters already builds and runs
doc tests. The log shows `Doc-tests browser_commander … 20 passed` inside the
"Rust test suite" step on all three OSes. The separate "Run doc tests" step
(rust.yml:272-276) repeats them. On Windows the second run hung until the 180s
budget killed it (exit 124), even though the same doc tests had passed 19.46s
earlier in the same job (rust:8773). Removing the duplicate step removes the
failure point and saves about 30 to 90 seconds per OS. If a separate doc-test
signal is wanted, restrict the main step with `--lib --bins --tests` instead.

**3/4. PyPI trusted publishing (known) and the changelog backlog.** The
`invalid-publisher` rejection means 0.5.3 was never published. As a result, the
auto-release sees `CHANGELOG.md already contains version 0.5.3`, skips
collecting, and leaves 17 fragments unreleased on every push. Registering the
trusted publisher fixes both problems.

**5. Puppeteer manifest drift test always skipped.** This is the clearest false
negative. The test exists to catch drift between the vendored Puppeteer API
manifest and the installed `puppeteer-core`, but it skips exactly when that
drift exists. CI is green on three OSes while the manifest is two minor
versions behind. Regenerate the manifest and turn the skip into a failure.

**6. Unclosed sqlite connection.** Each Python test job reports `1 warning`. In
`sqlite3`, `with connect(...) as db` manages a transaction and does not close
the connection. The warning is raised at garbage collection in the test that
runs next, which is why its location differs by OS. Fix the `with` blocks in
the tests (and audit callers of `_open_cookie_database`), then promote
`ResourceWarning` to an error.

**7. Codecov never uploads.** The skip shows up only as a notice, so the job
is green. Either configure the token or remove the step.

**8. Untested e2e and ignored suites.** Several suites exist only on disk.
Because no workflow invokes them, they can rot without any signal. Wire them
into parity.yml, which already has a skip-detection guard, or explicitly mark
them as manual.

**9-11. Log noise.** `Command failed with exit code 7` is printed after the
JS test summary and looks like a failure, but it is the expected rejection
under test, echoed by command-stream's virtual `exit`. jscpd prints every
baselined clone, which makes the lint log look broken. Both should be
silenced so that real errors stand out.

**12-17. Supply chain and hygiene warnings.** These are the DEP0005 warning
from download-artifact@v8 (upstream; the policy is already in place), the
`ubuntu-latest` label migration to Ubuntu 26 on 2026-10-19, unpinned zizmor
and secretlint versions, the tag-pinned lychee action with a cache that is
never persisted, one redirected docs link, and three browser-internal URLs
that lychee cannot check.

**18-27. Expected or noise.** No action is required beyond the optional
improvements noted in the table.
