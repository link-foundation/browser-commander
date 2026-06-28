# Issue 53 Case Study: `browser-commander/tests`

## Request

Issue 53 asks for a new `browser-commander/tests` layer that is built on top of
[`test-anywhere`](https://github.com/link-foundation/test-anywhere), supports
both Playwright and Puppeteer, learns test durations, starts historically slow
tests first, keeps smaller tests parallelizable, studies Playwright Test feature
parity, and addresses common negative feedback before users hit it.

Issue URL: <https://github.com/link-foundation/browser-commander/issues/53>

## Requirements Inventory

| Requirement                                                       | Status in this PR        | Notes                                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add case-study research under `docs/case-studies/issue-53`        | Done                     | This file records issue data, sources, requirements, implemented solution, and follow-up plans.                                                                                                   |
| Build on `test-anywhere`                                          | Done                     | `test-anywhere` is a JS runtime dependency and is re-exported from `browser-commander/tests`.                                                                                                     |
| Expose `browser-commander/tests`                                  | Done                     | `js/package.json` now exports `./tests` to `js/src/tests/index.js`.                                                                                                                               |
| Support Playwright and Puppeteer with the same test extension API | Done                     | `browserTest()` and `defineBrowserTests()` run the same scenario across both engines by default.                                                                                                  |
| Automatically track average test duration                         | Done                     | `recordTestDuration()` writes cumulative averages to `.browser-commander-test-timings.json`; default location is `tests/.browser-commander-test-timings.json` when a `tests` folder exists.       |
| Start longest tests first                                         | Done                     | `orderTestsByHistoricalDuration()` registers historically slow tests first.                                                                                                                       |
| Keep parallel execution efficient for smaller tests               | Done                     | `planTestShards()` uses longest-processing-time-first greedy balancing, and `BROWSER_COMMANDER_TEST_SHARD=1/3` selects a shard. Runtime-level parallelism still comes from the underlying runner. |
| Reproduce Playwright Test features                                | Started                  | This PR covers core definition API, fixtures, engine matrix, retries, timeouts, artifacts, ordering, and sharding. Full parity items are listed below as staged follow-ups.                       |
| Review negative Playwright Test feedback and address it early     | Done for initial surface | The first implementation directly addresses scheduling, cleanup, retries, timeout clarity, artifacts, and Playwright/Puppeteer lock-in.                                                           |
| Add tests                                                         | Done                     | Unit coverage added for timing data, ordering, sharding, fixtures, retries, timeouts, artifacts, and registration metadata.                                                                       |
| Add examples and docs                                             | Done                     | `js/README.md` documents the new export and `js/examples/browser-commander-tests.example.js` shows usage.                                                                                         |

## Implemented Test API

The new module exports:

- `browserTest(name, fn, options)` for one scenario across one or more engines.
- `defineBrowserTests(scenarios, options)` for a duration-ordered scenario list.
- `createBrowserFixture()` and `withBrowserCommander()` for direct fixture use.
- `loadTimingData()`, `saveTimingData()`, `updateTimingData()`, and
  `recordTestDuration()` for historical averages.
- `orderTestsByHistoricalDuration()`, `planTestShards()`, `parseShard()`, and
  `selectTestsForShard()` for scheduling.
- `runWithRetries()` and `runWithTimeout()` for predictable retry/timeout
  behavior across runtimes.
- `writeFailureArtifacts()` for error metadata and screenshots.
- Re-exported `test-anywhere` functions: `test`, `it`, `describe`, hooks,
  `assert`, `expect`, and related assertions.

The existing commander also gained Playwright-like `commander.click()` and
`commander.fill()` aliases for the already-supported `clickButton()` and
`fillTextArea()` operations. `createCommander` is exported as an alias for
`makeBrowserCommander` so older E2E examples can run.

## Online Research

Primary sources used:

- `test-anywhere` repository and package: <https://github.com/link-foundation/test-anywhere>, <https://www.npmjs.com/package/test-anywhere>
- Playwright Test configuration: <https://playwright.dev/docs/test-configuration>
- Playwright Test fixtures: <https://playwright.dev/docs/test-fixtures>
- Playwright Test parallelism: <https://playwright.dev/docs/test-parallel>
- Playwright Test sharding: <https://playwright.dev/docs/test-sharding>
- Playwright Test retries: <https://playwright.dev/docs/test-retries>
- Playwright Test reporters: <https://playwright.dev/docs/test-reporters>
- Playwright trace viewer: <https://playwright.dev/docs/trace-viewer-intro>
- Playwright annotations and `test.step`: <https://playwright.dev/docs/api/class-test>
- Puppeteer documentation: <https://pptr.dev/>
- Node.js test runner: <https://nodejs.org/api/test.html>

## Playwright Test Feature-Parity Plan

| Playwright Test capability                  | Current `browser-commander/tests` state                          | Proposed next step                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `test`, `it`, `describe`, hooks, assertions | Re-exported from `test-anywhere`                                 | Keep tracking `test-anywhere` API growth rather than duplicating it here.                         |
| Browser/page fixtures                       | Implemented for Playwright and Puppeteer                         | Add reusable fixture extension hooks once repeated user fixtures appear.                          |
| Engine/browser matrix                       | Implemented for Playwright and Puppeteer                         | Add browser channel/device metadata after the core launch API supports it consistently.           |
| Retries                                     | Implemented with `runWithRetries()`                              | Persist per-attempt metadata in timing data.                                                      |
| Test timeout                                | Implemented with `runWithTimeout()`                              | Add separate setup, action, and teardown timeout buckets if needed.                               |
| Failure artifacts                           | Implemented for error JSON and screenshots                       | Add trace/video integration where the selected engine supports it.                                |
| Ordering                                    | Implemented with historical longest-first order                  | Add optional priority tags for smoke/blocker tests.                                               |
| Sharding                                    | Implemented with balanced duration-aware planning                | Add CLI helper to print shard plans and total estimated duration.                                 |
| Reporters                                   | Not implemented                                                  | Start with JSON/JUnit serializers for timing and artifact metadata.                               |
| HTML/UI mode                                | Not implemented                                                  | Consider a lightweight static HTML report before a live UI.                                       |
| `test.step`                                 | Not implemented                                                  | Add a runtime-independent `step(name, fn)` helper that records nested timing and source metadata. |
| Annotations                                 | Basic `testInfo` only                                            | Persist annotations per attempt and include them in reporters.                                    |
| Project dependencies/global setup           | Not implemented                                                  | Model setup scenarios as first-class nodes in the scheduler graph.                                |
| `grep`, tags, filtering                     | Tags are passed through in `testInfo`; filtering not implemented | Add include/exclude tag filtering before registration.                                            |
| Max failures / bail                         | Not implemented                                                  | Add a shared bail state file for process/shard coordination.                                      |
| Snapshot assertions                         | Not implemented                                                  | Prefer existing engine screenshots first, then add comparison helpers.                            |
| Trace viewer                                | Not implemented                                                  | Add Playwright trace capture where available and a Puppeteer-compatible CDP trace option.         |
| Watch mode                                  | Delegated to runtime                                             | Avoid custom watch mode until the core API is stable.                                             |

## Negative Feedback Studied

| Feedback theme                                                      | Primary source                                                                  | Design response in this PR                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Users want control over file/test order rather than opaque sorting. | Playwright issue #35743: <https://github.com/microsoft/playwright/issues/35743> | Duration ordering is explicit and data-driven; callers can set `order: false`.                     |
| Shards and reports can become difficult at large test counts.       | Playwright issue #40983: <https://github.com/microsoft/playwright/issues/40983> | Shards are planned from compact timing data; failure artifacts are separate small files.           |
| Runner hangs after final tests are hard to diagnose.                | Playwright issue #38276: <https://github.com/microsoft/playwright/issues/38276> | Fixture cleanup is centralized and per-test timeout errors name the affected test.                 |
| Teardown can consume the test timeout and obscure failures.         | Playwright issue #24430: <https://github.com/microsoft/playwright/issues/24430> | `withBrowserCommander()` always destroys commander state and closes the browser.                   |
| Browser setup timeouts need better evidence.                        | Playwright issue #41347: <https://github.com/microsoft/playwright/issues/41347> | Failed scenarios write error metadata and screenshots before teardown when possible.               |
| CI-only flakiness needs repeatable evidence.                        | Playwright issue #28705: <https://github.com/microsoft/playwright/issues/28705> | Retries and artifacts are built into the first browser test API.                                   |
| Parallel tests with shared state are fragile.                       | Playwright issue #29428: <https://github.com/microsoft/playwright/issues/29428> | Each scenario attempt receives a fresh browser fixture by default.                                 |
| Dynamic global setup often leads to large project lists.            | Playwright issue #28257: <https://github.com/microsoft/playwright/issues/28257> | Scenario arrays keep generated matrices in ordinary JavaScript data.                               |
| Project dependencies do not solve critical-section style workloads. | Playwright issue #21229: <https://github.com/microsoft/playwright/issues/21229> | Duration-aware sharding is separate from dependency modeling; dependency graph support is planned. |
| Project parallelism semantics can be surprising.                    | Playwright issue #26367: <https://github.com/microsoft/playwright/issues/26367> | Engine expansion is visible in registered test names: `name [playwright]`, `name [puppeteer]`.     |
| Max-failure behavior can lead to confusing pipeline status.         | Playwright issue #30118: <https://github.com/microsoft/playwright/issues/30118> | Bail support is listed as a reporter/scheduler follow-up.                                          |
| Merged HTML report trace paths can conflict with blob directories.  | Playwright issue #37691: <https://github.com/microsoft/playwright/issues/37691> | Artifacts default to a dedicated `test-results/browser-commander` directory.                       |
| CI systems may not surface attachments consistently.                | Playwright issue #30608: <https://github.com/microsoft/playwright/issues/30608> | Artifacts are plain files with stable names; JUnit attachment reporting is a next step.            |
| Retry annotations and per-attempt metadata are hard to preserve.    | Playwright issue #35215: <https://github.com/microsoft/playwright/issues/35215> | `testInfo` includes engine, attempt, id, and tags; persisted annotations are planned.              |
| Step source/logging metadata can be confusing.                      | Playwright issue #37919: <https://github.com/microsoft/playwright/issues/37919> | A runtime-independent `step()` helper is planned instead of relying on Playwright-only internals.  |
| Network idle semantics differ across Playwright and Puppeteer.      | Playwright issue #37080: <https://github.com/microsoft/playwright/issues/37080> | Browser Commander already owns navigation readiness logic above each engine.                       |
| Teams want cross-tool browser automation portability.               | Playwright issue #22345: <https://github.com/microsoft/playwright/issues/22345> | The first API runs the same test body with Playwright and Puppeteer.                               |

## Components and Libraries Considered

| Component                | Use                                                 | Decision                                                            |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------- |
| `test-anywhere`          | Runtime-neutral JS test API                         | Adopted as the foundation and re-exported.                          |
| Playwright               | Browser automation engine                           | Supported through existing `launchBrowser()` and commander factory. |
| Puppeteer                | Browser automation engine                           | Supported through the same fixture path as Playwright.              |
| Node.js `node:test`      | Native test runner under `test-anywhere` on Node.js | Used indirectly; no direct lock-in.                                 |
| Custom reporter packages | JSON/JUnit/HTML output                              | Deferred; first PR keeps artifacts simple and dependency-light.     |
| `discoveryjs/json-ext`   | Streaming large JSON reports                        | Not added yet; useful if a future reporter needs streaming JSON.    |

## Reproduction and Verification

The core issue was the absence of a `browser-commander/tests` export and the
absence of duration-aware browser test scheduling. The new unit test
`js/tests/unit/tests/index.test.js` reproduces those missing behaviors as
assertions over the new API:

- Engine normalization rejects unsupported engines.
- Timing data records cumulative averages.
- Longest-first ordering uses historical durations.
- Shard planning balances known long tests.
- Browser fixtures destroy commanders and close browsers.
- Retries and timeouts produce predictable errors.
- Failure artifacts are written before browser cleanup.
- Registration metadata expands a scenario across both engines.

Focused verification command:

```bash
cd js
node --test --test-reporter spec tests/unit/tests/index.test.js tests/unit/factory.test.js tests/unit/bindings.test.js
```

Broader verification command:

```bash
cd js
npm run test:unit
```

## Remaining Follow-Ups

- Add JSON and JUnit reporters for timing, retry, shard, and artifact metadata.
- Add `step()` and annotation persistence that work under Node.js, Bun, and Deno.
- Add trace/video capture adapters for Playwright and Puppeteer.
- Add scheduler dependency graph support for global setup/teardown scenarios.
- Add tag/grep filtering and max-failures/bail support before registration.
