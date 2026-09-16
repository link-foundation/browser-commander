# Requirements

Every requirement stated or implied by issue #95 and its three sub-issues
(#92, #93, #94), with the chosen solution and where it is satisfied.
"Verified by" names something executable or a file in this repository — not an
assertion. Status is one of **done**, **partial** (with what is missing named
explicitly) or **n/a** (with why).

None of the four issues has any comments (`gh api
repos/link-foundation/browser-commander/issues/{92,93,94,95}/comments` returns
`[]` for each), so the issue bodies are the complete specification.

## R0 — Meta requirements (#95)

| #    | Requirement                                             | Solution                                                                                                                   | Status |
| ---- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| R0.1 | Read every listed issue including its comments          | All four bodies archived under `../issue/`; comment lists fetched and empty                                                | done   |
| R0.2 | One pull request, nothing deferred                      | PR #96 carries #92, #93 and #94                                                                                            | done   |
| R0.3 | PR description closes this issue and every listed issue | `Fixes #92` / `Fixes #93` / `Fixes #94` / `Fixes #95`, one keyword per issue, the block quoted verbatim                    | done   |
| R0.4 | Say so explicitly if an issue is already resolved       | #92's race does not reproduce on Linux (see R1.0); the defect it describes is real and is fixed, and the note is in the PR | done   |

---

# Issue #92 — CDP managed downloads can fail with ENOENT after completion

## R1.0 — Reproduction

The failure is a race between Chromium publishing
`Browser.downloadProgress {state: "completed"}` and the GUID-named staging file
becoming readable. It was reported on macOS arm64. On this Linux runner the
completion event never arrived before the file was visible, so the reported
`ENOENT` could not be reproduced end to end — which is a property of the
filesystem's timing, not evidence that the code was correct.

The defect is in the code regardless of whether one machine happens to lose the
race: `attachCdpSource()` called `sink.finished()` with a path it had never
opened. The deterministic reproduction is therefore at the seam rather than
through a browser — `js/tests/unit/downloads/manager.test.js` drives the CDP
source with a completion event whose file lands late, and three of its tests
fail with exactly the reported `ENOENT` when the fix is reverted.

| #    | Requirement                                                                          | Solution                                                                                                                                                                                                                                                          | Status |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R1.1 | A CDP completion must not be published until the staging file is readable            | `waitForStagedFile()` (`js/src/downloads/staging.js`) opens the file and requires its size to be unchanged across two readings before the sink is finished                                                                                                        | done   |
| R1.2 | The wait must be bounded                                                             | `DEFAULT_STAGING_TIMEOUT` (10 s) budget, polled every `DEFAULT_STAGING_POLL_INTERVAL`, with the budget carried into the failure                                                                                                                                   | done   |
| R1.3 | Timeout and missing-file outcomes stay explicit failures                             | Exhausting the budget raises a failure naming the path, the budget and the last observation; it never degrades into a success                                                                                                                                     | done   |
| R1.4 | A `.crdownload`/`.partial` sibling must not be mistaken for a finished file          | The wait refuses to claim bytes while a partial sibling exists                                                                                                                                                                                                    | done   |
| R1.5 | `idle()`/`dispose()` must not race past an announced-but-unplaced download           | The wait is handed to `sink.track()` before it is awaited, so it is part of the download's lifecycle                                                                                                                                                              | done   |
| R1.6 | Real-Chromium regression test with a page-created `Blob` download                    | `js/tests/e2e/downloads.e2e.test.js` — "should not publish a completed download before its bytes are readable"                                                                                                                                                    | done   |
| R1.7 | …asserting capture resolves, the bytes are right, one artifact, no staging leftovers | The same test asserts all four, including that no GUID or `.partial` file remains in the staging directory                                                                                                                                                        | done   |
| R1.8 | Apply the fix everywhere the bug exists                                              | JavaScript and Python CDP sources both fixed (`js/src/downloads/staging.js`, `python/src/browser_commander/downloads/staging.py`). Rust is unaffected: it uses `behavior: "allow"` with a size-stability directory watcher rather than `allowAndName` plus events | done   |

**Verified by:** `js/tests/unit/downloads/staging.test.js` (6 tests),
`js/tests/unit/downloads/manager.test.js` (3 added tests),
`python/tests/unit/downloads/test_staging.py`,
`python/tests/unit/downloads/test_manager.py`, and the E2E test above on both
Playwright and Puppeteer.

---

# Issue #93 — Continuous trace replay is incomplete across navigation and live state

Five confirmed gaps, each with its own requirement and its own regression test.

| #    | Requirement (issue wording)                                                                         | Solution                                                                                                                                                                                                                                               | Status |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| R2.1 | "Create or require an explicit base checkpoint… an `initialCheckpoint` option with a safe default"  | `startTrace({initialCheckpoint})` defaults to a base checkpoint in continuous mode, named by the caller or `initial`, and can be refused explicitly; `TRACE_CHECKPOINT_REASON.INITIAL` records why it exists                                           | done   |
| R2.2 | "Reinstall document observers from navigation lifecycle/init-script hooks, before application code" | `js/src/traces/init-script.js` registers the in-page recorder through `addInitScript`/`evaluateOnNewDocument`, so a new document is observed before its own scripts run; `framenavigated` reinstalls on engines that need it                           | done   |
| R2.3 | "Record semantic live-state events for controls, focus, and scroll, and apply them in the viewer"   | `TRACE_MUTATION_KIND.LIVE_STATE` with `TRACE_LIVE_STATE` = value/checked/selected/focus/scroll, recorded from `input`/`change`/`focusin`/`scroll` and applied by the viewer; a repeat of what an element last reported is dropped where it is recorded | done   |
| R2.4 | "Encode enough child-list position/removal information for deterministic replay"                    | Child-list records carry the sibling path a node was inserted before and the path it was removed from; the viewer applies removals and insertions at position rather than appending                                                                    | done   |
| R2.5 | "Add stable context/page/navigation/frame/action identities to all relevant records"                | `js/src/traces/identity.js` mints trace, browser-context, page, navigation, frame and action ids; every record carries its owner                                                                                                                       | done   |
| R2.6 | "Label the current viewer as partial diagnostic replay"                                             | The viewer header says so, and the manifest carries a `replay` block (`checkpoints`, `mutations`, `childListPositions`, `liveState`, `identifiers`) so a reader never guesses what a bundle can do                                                     | done   |
| R2.7 | Every frame of a page, not only the main one                                                        | The drain walks all frames; each batch names the frame it came from                                                                                                                                                                                    | done   |
| R2.8 | The three readers must accept what the recorder writes                                              | `TRACE_SCHEMA_VERSION` is 2 in JavaScript, Python and Rust, with the new kinds, live-state properties, checkpoint reasons and replay flags mirrored in all three                                                                                       | done   |

**Regression tests the issue asks for, all in `js/tests/e2e/traces.e2e.test.js`
and run on both engines:**

| Issue's test                                                   | Test name                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1. Navigate without a checkpoint, mutate during initialization | "should record what a new document did while it was still loading"        |
| 2. Type, toggle, select, focus, scroll between checkpoints     | "should record live control state as it changes, not only at checkpoints" |
| 3. Insert before a sibling, move, remove, replace a subtree    | "should replay an insertion, a move, a removal and a replacement exactly" |
| 4. Two pages and an iframe concurrently, unambiguous owner     | "should resolve every record to one unambiguous page and frame"           |

**Verified by:** the 20 tests of the trace E2E suite passing on Playwright and
Puppeteer, plus 13 added unit tests in `js/tests/unit/traces/recorder.test.js`.

---

# Issue #94 — A supported Links Notation export/stream for portable traces

| #     | Requirement                                                                                              | Solution                                                                                                                                                                                                  | Status |
| ----- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R3.1  | `writeTraceLinks(trace, output, {include})` exported from the package                                    | `js/src/traces/links.js`, re-exported from `js/src/exports.js` beside `readTrace`                                                                                                                         | done   |
| R3.2  | An incremental sink: `startTrace({output, links: {output}})`                                             | `openTraceLinks()` is wired into the recorder through a new `onEvent` hook on the bundle, so a link is written when the record is written                                                                 | done   |
| R3.3  | One link per ordered timeline event with sequence, time, kind, owner ids, actor, action, target, outcome | `(timeline: ...)`, in that field order, followed by every remaining field of the record under its own name                                                                                                | done   |
| R3.4  | One link per checkpoint referencing its HTML/state/screenshot members                                    | `(checkpoint: ...)` naming `html`, `state` and `screenshot` by their bundle-relative path                                                                                                                 | done   |
| R3.5  | Semantic control diffs as `{path, before, after, actor}` links                                           | `(control-diff: ...)` built from `diffControlState()` between consecutive checkpoints, with the actor of the later checkpoint                                                                             | done   |
| R3.6  | Dropped/partial records represented explicitly                                                           | `outcome` is one of `recorded`, `ok`, `failed`, `partial`, `dropped`; the closing `(result: ...)` link repeats the manifest's outcome and its dropped count                                               | done   |
| R3.7  | Bundle-relative artifact references, never duplicated binary content                                     | Members are written as paths; a test asserts the screenshot's bytes and the captured markup are absent from the export                                                                                    | done   |
| R3.8  | The same privacy/redaction result as the authoritative bundle                                            | The export reads only what the bundle wrote, so redaction cannot differ; a test writes a password field and asserts the secret is in neither file's bytes                                                 | done   |
| R3.9  | The JSON bundle stays authoritative — an adapter, not a replacement                                      | Nothing is written to the export that was not written to the bundle first; a failed export is recorded as a problem and never takes the run down                                                          | done   |
| R3.10 | Use a current compatible Links Notation version                                                          | `links-notation@^0.20.0`, the current release in all three ecosystems                                                                                                                                     | done   |
| R3.11 | Pin/schema-test the emitted representation                                                               | A golden test pins one formatted link byte for byte, and a second asserts the dependency range and the installed version it was proved against                                                            | done   |
| R3.12 | Large traces consumable incrementally                                                                    | The export is one link per line, so a reader can stream it (and follow a run that is still being written); `experiments/trace-links-export.mjs` parses one in 4 KiB chunks with the Python `StreamParser` | done   |

**A defect found in the notation library, and worked around here.** Links
Notation 0.20 quotes a value with whichever quote character the value does not
contain, and its parser processes no escapes. A value containing **both** `'`
and `"` therefore cannot survive a format/parse round trip (`both'and"` formats
as `'both\'and"'` and parses back as `both\`), and a real newline in a value
breaks the one-link-per-line property the export depends on.
`encodeLinkText`/`decodeLinkText` encode exactly those cases — backslash,
newline, carriage return, tab, and `"` only when `'` is also present — so the
export loses nothing the bundle holds. This is recorded in
`existing-solutions.md` as the one place the library could not be used as-is.

**Verified by:** `js/tests/unit/traces/links.test.js` (14 tests), including
streamed-versus-batch export equality, and `experiments/trace-links-export.mjs`,
which records a real browser run and parses the export it wrote with the Python
implementation of the same notation.

---

## Applied everywhere the requirement applies

| Requirement               | JavaScript                                  | Python                                                                         | Rust                                                                   |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| #92 staged-bytes wait     | `src/downloads/staging.js`, `sources.js`    | `downloads/staging.py`, `sources.py`                                           | n/a — no `allowAndName` event path; already watches for size stability |
| #93 trace schema 2        | `src/traces/schema.js` (+ recorder, viewer) | `traces/schema.py`                                                             | `src/traces/schema.rs`                                                 |
| #93 continuous recording  | recorder-side, JavaScript only              | n/a — reader only                                                              | n/a — reader only                                                      |
| #94 Links Notation export | `src/traces/links.js`                       | n/a — reader only; the emitted file is readable by `links-notation` for Python | n/a — same                                                             |

`docs/feature-parity.md` states each of these, so the gaps are documented
rather than implied.
