# Investigation and implementation of issues 170, 171, and 172

PR: https://github.com/link-foundation/browser-commander/pull/173

Baseline: browser-commander 0.31.1, repository main `403a7fd`, prepared branch
`issue-172-a9f96de6a00d` initially at `4d49e7c`. The complete parent issue,
both sub-issues, all issue comments, and all three PR comment/review endpoints
were read. No inline comments, conversation comments, or reviews requested
additional changes at the start of this investigation.

## Complete requirement inventory and implementation plan

Each row records a separate requirement, its selected solution, and its check.

| Source                          | Requirement                                                                                             | Selected solution and plan                                                                                                                                                                  | Evidence / validation                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| #172, requirement 1             | Read both issues and their comments; implement their requests.                                          | Trace selectors and launch ownership through every engine and language, reproduce confirmed defects before fixing, and distinguish the unconfirmed observation from a reproducible defect.  | The findings and tests below cover both issues; the final #171 comment is explicitly included.                                                     |
| #172, requirement 2             | Do all work in one PR, with no deferred sub-issue.                                                      | Keep selectors, diagnostics, ownership tests, macOS CI coverage, and release fragments on the prepared branch in PR 173.                                                                    | One PR includes both issue scopes.                                                                                                                 |
| #172, requirements 3–4          | Close the parent and every listed issue with a keyword for each.                                        | Include three separate lines in the PR body: `Fixes #170`, `Fixes #171`, `Fixes #172`.                                                                                                      | Check the final PR body, not a comma-separated reference.                                                                                          |
| #172, requirement 5             | Explicitly describe an already resolved or unreproducible issue, retaining its closing reference.       | State that the original intermittent macOS failure remains unreproduced and its root cause unconfirmed.                                                                                     | #171's later unchanged full-suite success is recorded below and in the PR.                                                                         |
| #170, problem                   | A scoped text selector must target the matched element, rather than a button elsewhere in the document. | Preserve Playwright strings; resolve nonnative text objects to a unique ancestor path. Remove both JS and Python rewrites of CSS sibling positions into global locator indexes.             | Two containers with the same button tag and sibling position; additional duplicate attributes and nested containers.                               |
| #170, preferred fix 1           | Use Playwright's native `:has-text()` and `:text-is()` support.                                         | Pass the entire selector directly to `page.locator`, preserving the engine's text semantics and lazy resolution.                                                                            | Unit tests forbid eager DOM evaluation; real-browser tests exercise exact and substring matching.                                                  |
| #170, preferred fix 2           | Make nonnative matches unique across the document.                                                      | Use escaped tag names and sibling `:nth-of-type` at every ancestor level. Avoid assuming an `id` or `data-qa` is unique; do not mutate the application DOM.                                 | Puppeteer, JS Selenium, and Python Selenium integration tests assert that the intended button is selected despite duplicated attributes.           |
| #170, preferred fix 3           | Add the two-container regression.                                                                       | Add minimum unit reproductions first, then real-browser tests for every affected native engine.                                                                                             | JS tests also exercise attributes, content, visibility, enabled state, clicking, filling, and CSS query enumeration.                               |
| #171, request 1                 | Investigate a timeout after DevTools is announced.                                                      | Trace stderr ownership, HTTP readiness, connection options, page selection, and storage restore. Preserve the engine cause beside incidental stderr; add optional attachment stage timings. | Readiness retries are tested; engine-connect and page-selection failures are distinguished; JS/Python/Rust diagnostic tests failed before the fix. |
| #171, request 2                 | Confirm failure cleans up only its own process and profile.                                             | Test both temporary and supplied profiles, first with injected processes and then with a real failed Chrome alongside a healthy sibling Chrome.                                             | Failed child exits; owned temporary profile is removed; supplied marker survives; sibling page still evaluates.                                    |
| #171, context and final comment | Do not assume the display warnings caused the timeout or that there is a confirmed process leak.        | Retain warnings as evidence, preserve the actual attachment exception, and document the successful unchanged acceptance rerun.                                                              | No platform-specific causal claim or fabricated deterministic reproduction.                                                                        |
| User research request           | Search online for facts, existing components, and plans for each requirement.                           | Consult primary engine/CDP documentation, upstream reports, and selector-generation libraries; compare the alternatives below.                                                              | Direct source links accompany research findings.                                                                                                   |
| User completeness request       | Apply repeated defects throughout the codebase.                                                         | Audit JS, Python, and Rust selectors and diagnostics, including all shared consumers.                                                                                                       | The cross-language inventory below identifies affected and unaffected paths.                                                                       |
| User release/workflow request   | Preserve history, run checks, prepare release triggers, and finish the existing PR.                     | Use patch changesets / changelog fragments rather than manual version bumps; run local checks and latest-head CI; update and mark PR 173 ready.                                             | Repository release workflows collect these fragments automatically.                                                                                |

## Selector root cause and alternatives

The original JS Playwright branch evaluated the text query and returned an
unqualified tag and sibling position. Its Puppeteer branch also trusted an
unchecked attribute or returned that same unqualified position. Python had
the corresponding Playwright/Selenium implementations. These outputs did not
identify the matched node. The native locator helpers additionally interpreted
trailing CSS `:nth-of-type(n)` as a global `.nth(n-1)`, which changes CSS semantics
when several containers or different sibling tags are present.

The baseline regressions fail before the production change. A button intended
inside `.parent` is confused with navigation elsewhere. The exact original
issue fixture and before/after screenshots are reproduced by
`selector-screenshots.mjs`; baseline normalization returns
`button:nth-of-type(2)` and clicks `nav-2`, while the preserved native selector
clicks `B`.

| Approach                      | Advantages                                                                                        | Limits                                                                                                       | Decision                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Native Playwright locators    | Preserve ancestry, lazy resolution, shadow handling, and engine text semantics.                   | Available only in Playwright.                                                                                | Selected for JS and Python Playwright.                                                   |
| Full escaped ancestor path    | Unique in the current document, works with existing CSS consumers, no DOM mutation or dependency. | Sibling changes after normalization can make the path stale; callers should resolve again after DOM changes. | Selected for Puppeteer and Selenium, following the existing trace-capture path approach. |
| Temporary generated attribute | Can identify a node through unrelated sibling changes.                                            | Mutates application DOM, requires collision policy and cleanup, and may affect observers or snapshots.       | Unnecessary for the reported defect.                                                     |
| Existing selector generators  | Can generate shorter selectors with configurable fallbacks.                                       | Additional dependency/injection and policy; uniqueness still depends on the DOM at resolution.               | Considered, but the small path algorithm already meets this requirement.                 |

Playwright documents its native text pseudo-classes, including case handling
and whitespace normalization. Forwarding the string also preserves those
semantics rather than partially emulating them.
[Playwright other locators](https://playwright.dev/docs/other-locators).

Known reusable components include
[css-selector-generator](https://github.com/fczbkk/css-selector-generator) and
[finder](https://github.com/antonmedv/finder), both maintained as CSS selector
generators. Puppeteer also has native locator and selector facilities, but
switching this library's existing CSS-returning contract would require changing
its downstream consumers.
[Puppeteer page interactions](https://pptr.dev/guides/page-interactions).

## Launch investigation and alternatives

The reporter observed a 30.9-second initial launch failure with a fresh profile,
cookie persistence, headless system Chrome, macOS 15.7.7, Node 22.23.0, and Chrome
155.0.8059.39. An isolated retry passed in 4.3 seconds. The
[latest issue comment](https://github.com/link-foundation/browser-commander/issues/171#issuecomment-6113911534)
reports a later unchanged acceptance suite passing all 64 tests with zero skips
in 400.2 seconds; the affected test took 4.1 seconds and the original child PID
was gone. There is no confirmed leak or deterministic cause of that macOS
failure. Linux verification and CI's current macOS runner do not recreate that
exact historical environment.

The launcher already checks more than a stderr line. It requires the launched
process's advertised browser WebSocket identity to match `/json/version`,
retries transient HTTP readiness failures within a finite startup deadline,
and detects port ownership races. Only a port race qualifies for the existing
bounded relaunch. Endpoint emission, HTTP readiness, engine attachment, and
subsequent page selection are separate stages.

The verified diagnostic defect was shared by all three packages: nonempty
Chrome stderr replaced the engine exception in the displayed launch error.
Allocator/display warnings therefore hid the connection timeout and engine
call log. New failing tests establish that defect independently of macOS;
messages now retain both sanitized pieces of evidence. JavaScript's optional
stage tracing distinguishes `engine-connect`, `page-selection`, and
`storage-restore`, records elapsed milliseconds only with `verbose: true`, and
adds `attachmentStage` to errors. The default remains silent.

| Approach                                                 | Plan / tradeoff                                                                                                                               | Decision                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Retain engine cause and stderr                           | Reproduce the diagnostic loss, fix JS/Python/Rust formatting, preserve existing redaction and bounded fields.                                 | Implemented.                                                   |
| Trace attachment stages                                  | Tag errors and optionally log stage transitions without adding endpoint/credential text.                                                      | Implemented in the JS CDP connectors implicated by the report. |
| Add readiness and ownership regression tests             | Test transient readiness, timeout option forwarding, temporary versus supplied profiles, a live sibling browser, and repeated fresh launches. | Implemented; real startup tests also run on macOS CI.          |
| Increase all timeouts                                    | Makes failures slower without identifying whether HTTP, WebSocket, target initialization, or page selection stalled.                          | No evidence justifies changing defaults.                       |
| Retry every unsuccessful attachment                      | Can conceal the original failure, repeat profile writes, and complicate ownership.                                                            | No unconditional relaunch added.                               |
| Replace readiness with raw WebSocket or extra CDP probes | Adds a second connection and does not prove the engine completed its initialization.                                                          | Existing identity and HTTP check retained.                     |

Playwright's CDP connection accepts HTTP or WebSocket endpoints and has its own
30-second default connection timeout. Puppeteer's protocol timeout applies to
individual protocol calls, so it must not be treated as the same launch budget.
[Playwright connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp),
[Puppeteer ConnectOptions](https://pptr.dev/api/puppeteer.connectoptions).

Chrome's DevTools documentation describes the browser WebSocket endpoint and
`/json/version`. `DevToolsActivePort` is an alternative when launching with
port zero; the current launcher reserves a port and verifies process ownership.
[Chrome DevTools protocol](https://chromedevtools.github.io/devtools-protocol/).

Upstream reports show that CDP connection timeouts can occur after a WebSocket
connection, including browser initialization/context-management problems.
These are related evidence, not proof of this report's cause:
[Playwright #35115](https://github.com/microsoft/playwright/issues/35115),
[Playwright #35928](https://github.com/microsoft/playwright/issues/35928),
[Playwright #32388](https://github.com/microsoft/playwright/issues/32388).

## Audit across packages and consumers

| Area                                                                                              | Audit result / application                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JS Playwright                                                                                     | Preserve native strings in normalization and wrappers; direct `page.locator(selector)` keeps CSS sibling semantics.                                                                                       |
| JS Puppeteer / Selenium                                                                           | Both use the text-object normalization path; replace unchecked attribute/tag-only outputs with the shared unique-path function.                                                                           |
| Python Playwright / Selenium                                                                      | Apply the corresponding native locator and nonnative path fixes. Public selector parsing helpers remain available for compatibility.                                                                      |
| Rust selectors                                                                                    | Normalize syntax into typed CSS/text/XPath variants; CSS strings retain ancestry. Its nth parser is not used to rewrite native adapter CSS queries. No corresponding tag-only normalization defect found. |
| Element content, attributes, state, queries, waiting, clicks, typing, scrolling, reusable helpers | Shared wrappers and locator helpers carry the corrected identity; native evaluation operates on locators/handles rather than feeding Playwright pseudo-classes to DOM `querySelector`.                    |
| JS/Python/Rust launch errors                                                                      | All displayed stderr instead of the engine cause when stderr was nonempty; all now retain both.                                                                                                           |
| Launch ownership                                                                                  | Existing failure paths dispose managed children, delete only owned temporary profiles, and retain supplied profiles; tests strengthen verification without changing that policy.                          |
| Release automation                                                                                | One JS patch changeset for both fixes, Python fixed fragments, Rust patch fragment; no manual manifest version bump.                                                                                      |

## Reproduction and validation commands

Run commands from the indicated package directory; Chrome and native engine
dependencies must be installed. In this controlled root container the explicit
`CHROME_NO_SANDBOX=true` choice is required; it is not a new library default.

```sh
# js: unit suite, selectors in all three engines, readiness / cleanup
node --test --test-concurrency=1 tests/unit
CHROME_NO_SANDBOX=true RUN_E2E=true node --test --test-concurrency=1 tests/e2e/selector-identity.e2e.test.js tests/e2e/startup-readiness.e2e.test.js
npm run check

# python: unit/integration suite, then native browser identity tests
python -m pytest tests
CHROME_NO_SANDBOX=true RUN_E2E=true python -m pytest tests/e2e/test_selector_identity.py -v
ruff check .
ruff format --check .
mypy src

# rust: low-memory compiler settings and peak RSS recorded by the helper
python3 ../experiments/issue-172/run-rust-check.py test --lib
python3 ../experiments/issue-172/run-rust-check.py test --all-features
python3 ../experiments/issue-172/run-rust-check.py clippy --all-targets --all-features
cargo fmt --all -- --check

# repository root: original issue fixture screenshots using the actual library
CHROME_NO_SANDBOX=true node experiments/issue-172/selector-screenshots.mjs
```

Logs are retained locally in this directory (ignored by Git). Focused tests
failed before production edits for native selector preservation, CSS sibling
semantics, attachment-stage evidence, and engine-cause visibility in all three
languages. Rust's first compile used one job without incremental/debug data,
completed without OOM, and measured peak child RSS at 2,446,720 KiB. Browser
tests use finite inputs and test deadlines; no stack or memory stress probe is
needed. CI runs and any failed logs are checked against the final commit SHA.

The first published CI run at `412fd4f` found two added JS changesets, while
`js/scripts/validate-changeset.mjs` requires exactly one per PR. Its downloaded
log (`ci-logs/javascript-38210707824.log`, line 930) identifies this release
policy failure. Both release notes are combined into one patch changeset; the
same validation script verifies the correction locally before pushing.
