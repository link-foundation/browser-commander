# Requirements

Every requirement stated or implied by issue #90 and its three sub-issues
(#87, #88, #89), with the chosen solution and where it is satisfied.
"Verified by" names something executable or a file in this repository — not an
assertion. Status is one of **done**, **partial** (with what is missing named
explicitly) or **n/a** (with why).

None of the four issues has any comments, so the issue bodies are the complete
specification.

Each requirement records a **Solution** (the design chosen) and a **Status**.
`planned` means the design below is the agreed approach and the code is landing
in this pull request; `done` means it is merged into this branch and the named
verification runs green.

## R0 — Meta requirements (#90)

| # | Requirement | Solution | Status |
| --- | --- | --- | --- |
| R0.1 | Read every listed issue including comments | All four bodies and (empty) comment lists archived under `../issue/` | done |
| R0.2 | One pull request, nothing deferred | PR #91 carries #87, #88 and #89 | done |
| R0.3 | PR description closes #90 and every sub-issue | `Fixes #87` / `Fixes #88` / `Fixes #89` / `Fixes #90`, one keyword per issue, verbatim block | done |
| R0.4 | Say so explicitly if an issue is already resolved | None of the three was already resolved. All three reproduced against `main` at `90a53ff`; see R3.1, R3.2 and R3.3 for the reproductions | done |

---

# Issue #89 — Truthful readiness and click results

The three reproductions in #89 are independent defects that share one root
cause: **the code converts "I could not observe anything" into "it worked."**
Each is fixed by making the unobserved case a distinct, reportable outcome.

## R3.1 — `waitForPageReady()` must honor one end-to-end deadline

> computes the network timeout with `Math.max(60000, timeout - elapsed)`, so a
> 10 ms deadline becomes 60 seconds

**Root cause.** Each stage of the wait computed its own budget from
`Date.now()`, and the network stage had a hard 60 s floor that ignored the
caller entirely.

**Solution.** `js/src/core/readiness.js` introduces `createDeadline({timeout})`
built on `performance.now()`, so a wall-clock jump cannot extend a budget.
Every check receives `deadline.remainingMs()` and nothing else; a check whose
remaining budget is `0` reports `{satisfied: false, detail: {reason: 'no
remaining budget'}}` instead of running.

**Verified by** `js/tests/unit/core/readiness.test.js` (hand-advanced fake
clock, exact assertions on `remainingMs`) and
`js/tests/unit/core/navigation-manager.test.js` →
`'should never grant a later check more than the remaining budget'`.

## R3.2 — Timeout/failure paths must not log success or emit `onPageReady`

> `onPageReady` can also be emitted after the failed wait because
> `completeNavigation()` owns both state cleanup and the ready event.

**Root cause.** One function owned two unrelated facts: "the navigation stopped
being in flight" and "the page is usable."

**Solution.** `completeNavigation()` is split into
`finishNavigationTracking({ready})` (bookkeeping, always runs) and
`emitPageReady()` (the announcement, only runs when the checks passed).
`abandonNavigation(reason)` is the path for giving up. `onNavigationComplete`
listeners now receive `ready` so they can tell the two apart.

**Verified by** `js/tests/unit/core/navigation-manager.test.js` →
`'should not emit onPageReady when the readiness wait failed'` and
`'should report ready=false to onNavigationComplete listeners'`.

## R3.3 — Readiness results must name satisfied, failed, skipped and pending checks

**Solution.** `runReadinessChecks()` returns
`{status, ready, checks: {satisfied, failed, skipped, pending}, evidence,
elapsedMs, timeoutMs}`. `pending` is populated only when the deadline expired
before a check was reached, which is the difference between "we chose not to
run this" and "we ran out of time." `status` is `ready` / `timed_out` /
`failed`, exposed as `READINESS_STATUS`.

`waitForPageReady()` keeps its boolean shape (callers test truthiness, so
returning an object would itself be a new false positive) and is now honest;
the structured result is `waitForReady()`.

**Verified by** `js/tests/unit/core/readiness.test.js` → the `runReadinessChecks`
suite.

## R3.4 — Composable SPA readiness instead of "network idle only"

**Solution.** `urlStableFor`, `networkIdleFor`, `domStableFor`,
`visibleImages` and `predicate`, all built on one `stableCheck` primitive that
requires consecutive stable samples across a caller-chosen window. Callers pass
`checks: [...]` to `waitForReady()`; the navigation manager's default is
`[urlStableFor({stableForMs: config.redirectStabilizationTime}),
networkIdleFor()]`, which is the previous behavior expressed in the new
vocabulary.

**Verified by** `js/tests/unit/core/readiness.test.js` (one suite per check).

## R3.5 — Ignore configurable long-lived request classes

**Solution.** `LONG_LIVED_REQUEST_PATTERNS` and `isLongLivedRequest()` classify
websockets, EventSource, analytics beacons and pollers so a page that keeps one
open is not permanently "not idle." Both are exported so callers can extend or
replace the list rather than disabling network tracking wholesale.

## R3.6 — A no-op click must be `unverified`, not success

> `defaultClickVerification()` returns `verified: true` when a target remains
> connected and unchanged (`element still connected (assumed success)`)

**Solution.** The "assumed success" branch is gone. An element that is still
connected and unchanged returns `{verified: false, effect: 'not-observed',
reason: 'no observable change to the target element after the click'}`. Having
captured no pre-click state at all is reported separately (`'no pre-click state
captured'`) because it is a different fact.

**Verified by** `js/tests/unit/interactions/click.test.js` →
`'should NOT claim success when nothing about the element changed'` and
`'should report not-observed when no pre-click state was captured'`.

## R3.7 — Navigation evidence must be correlated with this click

**Solution.** A destroyed execution context now yields
`effect: 'not-observed'` with `navigationError: true` and the reason
`'verification unavailable: execution context was destroyed during
verification'`. Every click carries an `actionId`; `clickButton()` records the
URL and navigation session ID before dispatching and only reports
`navigated: true` when the observed navigation belongs to that action.

**Verified by** `js/tests/unit/interactions/click.test.js` →
`'should not treat a destroyed execution context as proof of effect'` and
`'should report interrupted, not verified, when navigation cuts in'`.

## R3.8 — The result model

**Solution.** `js/src/interactions/click-result.js` defines `CLICK_STATUS`
(`succeeded` / `failed` / `timed_out` / `interrupted` / `unverified`),
`CLICK_EFFECT` (`confirmed` / `not-observed` / `contradicted`), typed
`evidence()` records and `makeClickResult()`, which derives the legacy booleans
conservatively: `verified` only from `effect === 'confirmed'`, `clicked` only
from `dispatched`.

**Verified by** `js/tests/unit/interactions/click-result.test.js`.

## R3.9 — `scroll`, `activation` and `actionability` must be orthogonal

> `force` disables actionability checks; it does not disable Playwright's
> scroll-into-view step.

**Solution.** `js/src/interactions/click-activation.js` splits the three axes.
`scroll: 'none'` no longer maps to `{force: true}`; it measures the element's
click point, hit-tests it with `document.elementFromPoint`, and dispatches
`page.mouse.click(x, y)` — an operation that cannot scroll. `scroll: 'preserve'`
allows the engine to scroll and then restores the position. `actionability:
'force'` is the only thing that now sends `{force: true}` to the engine.

**Verified by** `js/tests/unit/interactions/click-activation.test.js` and
`js/tests/unit/interactions/click.test.js` →
`'should not route noAutoScroll through Playwright force, which still scrolls'`
and `'should pass force to the engine only for actionability: force'`.

## R3.10 — `scroll: 'none'` must fail clearly when it cannot be honored

**Solution.** `ScrollConstraintError`, raised when the target is outside the
viewport or covered at its click point. The message names the three
alternatives (`scroll: 'preserve'`, `scroll: 'auto'`, `activation: 'dom'`) and
carries the measured geometry as `error.detail`. `clickElement()` converts it
into `status: 'failed'`, `dispatched: false` — the click is not attempted.

**Verified by** `js/tests/unit/interactions/click.test.js` →
`'should fail clearly when scroll: none cannot be honored'`.

## R3.11 — Custom verifiers must keep working

**Solution.** `verifyClick()` normalizes a custom verifier's result, deriving
`effect` from its boolean when it does not supply one, so verifiers written
against the old contract keep working and gain the new vocabulary for free.

## R3.12 — Compatibility and deprecations documented

**Solution.** `noAutoScroll` still works, maps to `scroll: 'none'` /
`scroll: 'auto'`, loses to an explicit `scroll`, and logs a deprecation notice.
Documented in the README and in `docs/feature-parity.md`.

## R3.13 — Real-browser integration tests

> Integration tests use real pages for invariants that mocks cannot validate
> (scroll position, no-op effects, navigation correlation, and deadline bounds).

**Solution.** A real-page suite covering exactly those four invariants, with
the #89 reproduction fixture (a button at `top: 4200px` in a 600 px viewport).

## R3.14 — Parity across Playwright, Puppeteer, Python and Rust

**Solution.** The Python and Rust click verifiers carry the same "assumed
success" defect and are corrected identically; the readiness split is applied to
`python/src/browser_commander/core/navigation_manager.py` and
`rust/src/core/navigation.rs`. Engine-level limitations are stated in
`docs/feature-parity.md` rather than silently ignored.

---

# Issue #88 — Managed persistent downloads

_Design for the work landing in this pull request._

## R2.1 — One manager shape across `launchBrowser`, `connectBrowser`, `launchRealBrowser`

**Solution.** The manager is built from the browser/context, not from the way
the browser was obtained, so all three entry points accept the same `downloads`
option and return the same `downloads` handle. `configureDownloads()` and
`commander.downloads` attach the same object to an existing commander.

## R2.2 — Destination: absolute path, `user-downloads`, `temporary`

**Solution.** `resolveDownloadDirectory()` maps the presets — `user-downloads`
resolves the platform Downloads folder (XDG `user-dirs.dirs` on Linux,
`~/Downloads` elsewhere), `temporary` uses an engine-managed directory. The
directory is created and probed for writability **before** the first download,
so a permission failure is reported at configuration time rather than as a
mysteriously missing file later.

## R2.3 — Persistence beyond context/browser close

**Solution.** Playwright deletes engine-managed downloads when their context
closes, so with `persist: true` the manager calls `saveAs()` into the
configured root as soon as the download completes, which takes the file out of
the engine's lifecycle.

## R2.4 — CDP download behavior for attached Chromium

**Solution.** For attached Chromium the manager sends
`Browser.setDownloadBehavior` with `{behavior: 'allowAndName', downloadPath,
eventsEnabled: true}` and consumes `Browser.downloadWillBegin` /
`Browser.downloadProgress`. This is the only way to observe a *manual*
download, and it does not touch the profile, so the dedicated-profile
guarantees of `launchRealBrowser()` are unaffected.

## R2.5 — Automated and manual downloads on one lifecycle

**Solution.** One internal event stream fed by whichever source the engine
provides (Playwright `download` event, Puppeteer/CDP `Browser.downloadWillBegin`),
emitting `started` / `completed` / `failed` / `cancelled` with stable IDs.

## R2.6 — Capture must be armed before the triggering action

**Solution.** `downloads.capture({action})` registers its waiter, *then* runs
`action()`. A download that starts in the same tick as the click is already
covered.

## R2.7 — No duplicate save or emit

**Solution.** Downloads are keyed by engine GUID in a registry; a `capture()`
waiter and a global `on('completed')` listener resolve from the same record, so
the file is saved once and each listener sees one event.

## R2.8 — Safe naming

**Solution.** `sanitizeDownloadName()` strips path separators and control
characters, rejects `..` segments and absolute paths supplied by the page, and
the resolved path is asserted to stay inside the configured root before any
write. A caller naming callback runs before sanitization, never instead of it.

## R2.9 — Extension-less and UUID-like names

**Solution.** When the suggested name has no extension, one is derived from the
declared or sniffed MIME type.

## R2.10 — Deterministic collision resolution

**Solution.** `conflict: 'rename' | 'overwrite' | 'error'`; `rename` produces
`name (2).pdf`, `name (3).pdf`, … deterministically.

## R2.11 — Atomic rename after validation

**Solution.** Bytes land in a `.partial` file; validation runs; only then is the
file renamed into place. A failed validation or timeout removes the partial file
and returns a failure — never a half-written artifact under the final name.

## R2.12 — Metadata

**Solution.** Each artifact carries `id`, `path`, `suggestedFilename`, `url`
(redactable), `mimeType`, `bytes`, `checksum` (SHA-256), `startedAt`,
`completedAt` and `failure`.

## R2.13 — Privacy and security

**Solution.** No response body is ever logged; URLs pass through the same
redaction policy as traces (#87); files are written with owner-only
permissions (`0o600`, directories `0o700`).

## R2.14 — Tests-layer artifact retention

**Solution.** `browser-commander/tests` retains downloads in its artifact
directory and the session trace references them by path and checksum, without
embedding contents.

## R2.15 — Acceptance-criteria test matrix

Browser-click, JavaScript/blob and navigation downloads on both engines; manual
CDP download; persistence after close; UUID → `.pdf` with validation; race-free
arming; no duplicate save/emit; collision, traversal, invalid content,
unwritable directory, timeout and partial-file cleanup.

---

# Issue #87 — Privacy-aware portable traces

_Design for the work landing in this pull request._

## R1.1 — Public recorder API

**Solution.** `commander.startTrace(options)` → `{checkpoint(name, {actor}),
stop()}`, with `mode`, `screenshots`, `dom`, `events` and `privacy` exactly as
the issue proposes. No raw Playwright/Puppeteer page access is required.

## R1.2 — Checkpoint content

**Solution.** A checkpoint captures, from one logical moment: full serialized
HTML, semantic live control state (`value`, `checked`, `selected`, focus,
scroll, open shadow roots) as a separate document, URL/frame metadata and —
when enabled — a screenshot. Semantic state is deliberately *not* folded into
the HTML, because serialized markup does not carry it.

## R1.3 — Continuous mode: ordered mutation batches

**Solution.** A full base snapshot followed by ordered mutation batches
(`MutationObserver`, re-armed across navigations), with later full checkpoints
for recovery — the two-phase design rrweb established.

## R1.4 — One ordered timeline

**Solution.** `events.ndjson` with a monotonic sequence number, wall-clock and
monotonic timestamps, and context/page/navigation/frame/action IDs on every
record, so navigation, interactions, console, page errors, dialogs, request
failures and downloads interleave correctly.

## R1.5 — Portable versioned bundle

**Solution.** A zip-compatible directory with `manifest.json` (schema version,
Browser Commander version, engine/browser/platform), `events.ndjson`,
`checkpoints/NNNN.{html,state.json,png}`, `mutations/NNNN.ndjson` and
content-addressed `artifacts/`. Writes are deterministically ordered so traces
diff cleanly in CI.

## R1.6 — Explicit failure records

**Solution.** Dropped events, size limits, timeouts and partial termination are
recorded as first-class events. Recording is best-effort: a failed artifact
write is recorded and the automation continues, unless `strict: true`.

## R1.7 — Offline viewer

**Solution.** A static viewer opened from the filesystem — no server — that
scrubs the timeline, jumps between checkpoints, shows before/after DOM and state
diffs, animates mutation batches, and correlates screenshots, interactions,
console, page errors, failed requests, dialogs and downloads. Captured HTML
renders in a sandboxed iframe with scripts disabled and network blocked by
default. Snapshot-only traces fall back to checkpoint stepping.

## R1.8 — Redaction before bytes reach disk

**Solution.** Password controls and `authorization` / `cookie` headers are
masked by default; cookies, storage, request/response bodies, upload bytes and
cross-origin resources are not recorded unless explicitly enabled. Selector,
attribute, URL, header and callback redaction all run in the page or on the
record **before** serialization, so a secret never exists on disk to be cleaned
up afterwards.

## R1.9 — Limits, retention, `off`

**Solution.** Maximum bundle size, per-resource limits, retention helpers and an
`off` mode. Bundles are written with owner-only permissions. The documented
residual risk: enabling HTML or form-value capture can still record sensitive
data that no selector list anticipated.

## R1.10 — Cross-language readability

**Solution.** The format is plain JSON/NDJSON precisely so that a reader is a
small amount of code in each language; parity gaps are stated in
`docs/feature-parity.md`.

## R1.11 — `browser-commander/tests` uses this format

**Solution.** `browserTest(name, fn, {trace: 'retain-on-failure', screenshots:
'only-on-failure'})`. `writeFailureArtifacts()` — currently an error JSON plus
one screenshot — is replaced by a trace bundle, so there is one artifact
mechanism rather than two.
