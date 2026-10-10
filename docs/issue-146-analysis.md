# Issues 140–146: requirements, research and implementation

Issue [146](https://github.com/link-foundation/browser-commander/issues/146) is an
umbrella for six issues. All seven descriptions and all their comments were read;
none had comments at the initial investigation on 2026-10-10. A final reread
found [the later stable-viewport report](https://github.com/link-foundation/browser-commander/issues/142#issuecomment-6097318324), which is included below. This document records each
requirement, plausible alternatives, the chosen implementation and its validation.
All changes belong to PR [147](https://github.com/link-foundation/browser-commander/pull/147).

## Repository and component research

Existing trace bundles, Links Notation exporters, mutation observers, engine
adapters, browser restrictions, profile seeding and the shared CLI were extended.
Related merged work includes PRs 96 (traces), 111 (preferences), 125/127
(WebDriver/Safari), and 139 (navigation/session APIs). Python and Rust continue
to delegate the shared CLI to the companion npm package.

The following primary sources informed the alternatives:

| Component or protocol                                                                                                                                                                                       | Relevant capability                                                                  | Decision                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Playwright Page](https://playwright.dev/docs/api/class-page)                                                                                                                                               | Typed screenshot options; independent DOMContentLoaded, load and network-idle states | Use native screenshot options and lifecycle events; preserve the existing network-idle trigger default.                                                             |
| [Playwright videos](https://playwright.dev/docs/videos)                                                                                                                                                     | Context-configured recording, flushed when the context closes                        | A context-only recorder cannot start and stop arbitrarily on an existing attached page. Use bounded frame sampling and browser encoding for session recording.      |
| [CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/)                                                                                                                                    | Screenshot and screencast commands                                                   | Native screenshots are supported; sampling offers the same start/stop contract across engines. Screencast alone does not provide portable video container encoding. |
| [CDP Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/)                                                                                                                          | Focus emulation changes page visibility/focus reporting                              | Disable focus emulation before sampling; prefer explicit or remembered targets.                                                                                     |
| [CDP Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/)                                                                                                                                | Target identities without an active-tab field                                        | Never infer activation from `/json/list` ordering. An explicit target is reliable even when foreground identity is unavailable.                                     |
| [Chromium tracked preferences](https://chromium.googlesource.com/chromium/src/+/fb473a87fb9a0cb77a70811505929ba08c580e74/chrome/browser/prefs/chrome_pref_service_factory.cc)                               | Sensitive preferences are integrity checked                                          | Warn or reject protected writes; do not manufacture Secure Preferences MACs.                                                                                        |
| [Chromium SessionRestoreInfobar](https://chromium.googlesource.com/chromium/src/+/7e55b90cb06c5d388283411090cc4514fc2c7485/chrome/browser/ui/views/session_restore_infobar/session_restore_infobar_model.h) | Restore promotion has a separate startup decision                                    | Disable this feature in `no-crash-restore`.                                                                                                                         |
| [gifenc](https://github.com/mattdesl/gifenc)                                                                                                                                                                | JavaScript GIF palette quantisation and encoding                                     | Use gifenc with bounded frames, transparency and optional dithering.                                                                                                |
| [UPNG.js](https://github.com/photopea/UPNG.js)                                                                                                                                                              | PNG decoding and APNG encoding                                                       | Reuse decoding; write APNG chunks directly because its encoder truncated tiny frames in the minimum reproducer.                                                     |
| [webp-wasm](https://github.com/jhuckaby/webp-wasm)                                                                                                                                                          | WASM/libwebp static encoding                                                         | Encode each frame and assemble the official animation container; no installed binary required.                                                                      |
| [WebP RIFF specification](https://developers.google.com/speed/webp/docs/riff_container)                                                                                                                     | VP8X, ANIM and ANMF animation chunks                                                 | Preserve dimensions, duration, looping and alpha in animated WebP.                                                                                                  |
| [Pillow image formats](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html)                                                                                                            | GIF, APNG and animated WebP                                                          | Use Pillow in Python, including multiframe decode tests.                                                                                                            |
| [Rust image WebPEncoder](https://docs.rs/image/latest/image/codecs/webp/struct.WebPEncoder.html), [png](https://docs.rs/png/latest/png/), [gif](https://docs.rs/gif/latest/gif/)                            | Native Rust image codecs                                                             | Use native codecs and animation containers. Rust's image WebP encoder is lossless; a lossy quality request gets an explicit capability error.                       |
| [Rust webp](https://docs.rs/webp/latest/webp/struct.Encoder.html)                                                                                                                                           | libwebp lossy encoding                                                               | A possible alternative when native build dependencies are acceptable; native image encoding avoids that requirement here.                                           |
| [ffmpeg.wasm installation](https://ffmpegwasm.netlify.app/docs/getting-started/installation/)                                                                                                               | Browser-only WASM distribution                                                       | It is not a Node replacement for a system encoder. Browser MediaRecorder is the default movie encoder; an explicitly selected ffmpeg executable is optional.        |

## Complete requirement inventory and solution plans

Each row describes the implemented plan. Capability errors below are intentional
where issue 142 explicitly permits an unsupported result; format names never
silently label output with a different codec. See the [API and capability guide](capture-and-debugging.md).

### Issue 140: full traces and reusable sessions

| Requirement                                                                             | Alternatives considered and chosen plan                                                                                                                                               | Verification                                                                            |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Optional DOM snapshots in Links Notation                                                | New trace format versus extending the current exporter: add `links.dom` levels to existing JS/Python/Rust sinks and offline exports.                                                  | Shared trace conformance and Links Notation tests.                                      |
| Optional mutation records in Links Notation                                             | App-side NDJSON decoding versus exporter-owned records: export target path, kind, before/after and added/removed nodes.                                                               | Mutation fixtures and recorder integration tests in all languages.                      |
| Text-only export with added/removed visible text, changed attributes and selector paths | Whole HTML versus filtered text records: `dom: 'text'` filters descriptions while keeping selectors.                                                                                  | Text export assertions, including redacted values.                                      |
| Request/response metadata: method, URL, status, resource type, content type and timing  | Separate network file versus shared timeline: record `network.request` and `network.response` in the bundle and links.                                                                | JS network tests, Python real HTTP experiment and native Rust HAR test.                 |
| Resource-type and URL-pattern filtering                                                 | Capture everything then filter versus filtering before capture: engine listeners apply filters before retaining request state.                                                        | Filtered mocked requests and responses.                                                 |
| Opt-in document/xhr/fetch bodies with a size limit                                      | Unbounded engine responses versus bounded allowed bodies: default off, byte cap, pending-work cap and body deadlines.                                                                 | Truncation, opt-in and body failure tests; Python real HTTP experiment.                 |
| Redact cookie, authorization and set-cookie headers by default                          | Body-wide heuristic scrubbing versus specified credential-header rules: redact these and proxy-authorization consistently in trace, links and HAR.                                    | Network redaction assertions and real HTTP fixtures.                                    |
| HAR of the same data                                                                    | Independent HAR recorder versus deriving entries from trace events: derive HAR after pending bodies drain.                                                                            | HAR entries match recorded request IDs and payloads.                                    |
| Trusted Types-safe checkpoints                                                          | Trusted Types policy/DOMParser versus DOM APIs: clone nodes without assigning innerHTML, including live controls and recursively redacted open shadow roots.                          | Retained Trusted Types experiment reproduces the previous failure and verifies the fix. |
| Connect-or-launch on a fixed port with the same dedicated userDataDir                   | Engine-owned launch versus detached Chrome: detached process, profile/port/browser identity, atomic metadata and a lease prevent duplicate launches.                                  | Real Chromium JS and Python detach/reconnect experiments.                               |
| Browser survives controller exit and closes after idle timeout                          | Controller timer versus detached watchdog: watchdog verifies ownership and fresh activity under the lease before CDP Browser.close.                                                   | JS real-browser idle expiry test.                                                       |
| Distinct close and detach; keepOpen                                                     | Alias both operations versus explicit lifecycle: detach disconnects the controller; close terminates only the owned browser. CLI keep-open exits after launch/detach.                 | Session ownership, idempotence and reconnect tests.                                     |
| Return/reuse the automation page, including commander.reusePage                         | Arbitrary foreground guess versus saved target: persist target ID and rebind commander helpers when the page changes.                                                                 | Remembered-target reconnect and explicit tab-selection tests.                           |
| One-flag debugging or BROWSER_COMMANDER_TRACE                                           | App composition versus managed trace: JS/Python commander debug records interactions, navigation, errors, network, text and navigation checkpoints; Rust has TraceOptions::debug.     | Commander lifecycle/unit suites and real trace recording.                               |
| Automatic links and HAR from debugging                                                  | Separate caller exporters versus trace stop lifecycle: close links and HAR with the managed recorder.                                                                                 | Debug configuration and network export tests.                                           |
| trace summarize with from/to/grep and merged timeline                                   | Bespoke scripts versus shared offline reader: merge ordered interaction, network and DOM mutation records, respecting retained segments and filters.                                  | Filtered timeline/CLI tests.                                                            |
| Ignore-selector list for continuous capture                                             | Filter after writing versus before serialisation: exclude matching subtrees from snapshots and mutations in shared browser assets.                                                    | Shared snapshot/mutation fixtures.                                                      |
| Byte cap, rotation and gzip                                                             | A single eventually truncated bundle versus bounded complete segments: retain a capped number of readable bundles and compress NDJSON; readers also accept compressed/rolling traces. | Rotation, bounded retention, gzip and concurrent-stop tests in JS/Python/Rust.          |
| count with visible:true                                                                 | Looping isVisible calls versus page-side visibility count: filter by computed style and nonempty bounds.                                                                              | Visible-count unit tests and Rust count_visible API.                                    |
| Trigger concurrency skip/restart without simultaneous handlers                          | Repeated actions versus serialized completion: skip an in-flight action or signal its stop and await it before restarting.                                                            | Trigger readiness/concurrency tests; existing cleanup guarantees retained.              |
| Dismiss configured known overlays before interactions                                   | Broad popup heuristics versus caller-owned selectors: only click configured visible dismiss controls; integrate with JS/Python commander actions and expose an explicit Rust helper.  | Native real-browser overlay check; no unsolicited page changes.                         |

Rust has no commander/page-trigger factory in the existing API. Its native
counterpart is explicit trace/capture/session functions and typed adapter methods;
the shared CLI exposes the same commands as JavaScript and Python.

### Issue 141: Chrome panels and profile preferences

| Requirement                                                                                                                         | Alternatives considered and chosen plan                                                                                                                            | Verification                                              |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Hide SessionRestoreInfobar through a default restriction                                                                            | A new restriction versus repairing no-crash-restore: add SessionRestoreInfobar to its disabled features.                                                           | Restriction fixtures in all three languages.              |
| no-translate seeds translate.enabled=false                                                                                          | Feature-only switch versus switch plus profile preference: seed the preference alongside Translate disabling.                                                      | Profile restriction merge tests.                          |
| Extra disableFeatures on resolveRestrictions and launchBrowser                                                                      | Last switch wins versus one merged switch: combine defaults, restriction features, caller features and caller args, preserving first-seen order and deduplicating. | Launch/resolve tests including duplicate switches.        |
| Warn or throw for protected preferences and document alternatives                                                                   | Silently write or forge MACs versus detection: warn by default, optionally reject known protected paths, document settings/policy alternatives.                    | Protected-path tests and profile-migration documentation. |
| quiet-ui group: restore/crash, translation, default browser, passwords/cards, automation banner where applicable, promos/what's-new | Scattered flags versus a named preset: compose existing restrictions with new restore/translation handling in the shared catalogue.                                | Shared catalogue byte equality and preset tests.          |

### Issue 142: capture in every language and engine

The later comment reports a visible-window flash after raw full-page capture,
with 252 unchanged geometry samples; its cause is unconfirmed. The additional
requirements are a stable-viewport API, bounded engine fallbacks, displayed-pixel
regression coverage, and full-page visual-side-effect documentation. Alternatives
are native surface capture, engine viewport capture, or Chromium native-view
capture. `stableViewport`/`stable_viewport` selects native-view CDP capture with
`fromSurface:false` and `captureBeyondViewport:false`; headless view failure and
non-CDP engines fall back only to viewport capture. Explicit viewport emulation
also uses the engine viewport path: a real-browser probe at device scale 2 showed
that native-view capture returned 320×200 instead of the emulated 640×400; failing
regressions now guard the fallback and correct CSS/device dimensions. No automatic scrolling,
resizing, activation, or capture-time styling is used in this mode. Regions and
visual styling options are rejected. JS/Python/Rust and the shared CLI implement
the contract. Minimal regressions fail before implementation; the Xvfb fixture
samples displayed page pixels independently through Pillow/XCB as well as
in-page geometry. This verifies the Linux fixture, not the cause or absence of
every possible transient on macOS. Native Rust bypasses Chromiumoxide's
activating screenshot helper; its Node bridge also now forwards typed options.

| Later-comment requirement                                      | Alternatives and chosen plan                                                                                                                                                                        | Verification                                                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Documented stable viewport API across engines                  | Raw CDP helper versus a public option: expose `stableViewport`/`stable_viewport` and `--stable-viewport` through the existing capture facade.                                                       | JS/Python missing-mode regressions and Rust serialized-option validation.                                                                      |
| Capture the existing native view with bounded fallbacks        | Surface capture versus native-view CDP: use `fromSurface:false`, `captureBeyondViewport:false`; unsupported/headless/emulated modes use viewport-only engine capture.                               | Protocol option assertions, genuine-error and detachment controls, Firefox/BiDi mocks, real PNG/JPEG/WebP scaling and all three Rust adapters. |
| Avoid hidden scroll-to-top, viewport resize and tab activation | Temporary repositioning versus separate views: stable mode captures the already scrolled page and rejects region/full-page/style changes. Applications can scroll normally before the next capture. | Intermediate geometry stays unchanged after animated scrolling; native Rust bypasses the activating helper.                                    |
| Check watched-window/compositor behavior, not only geometry    | Engine screenshots versus independent displayed-pixel sampling: observe 120 Xvfb frames through Pillow/XCB during four captures.                                                                    | Zero changed displayed samples; before/after native-window evidence committed and the probe runs in CI.                                        |
| Document full-page visual effects and uncertainty              | Claim a reproduced DOM jump versus describe the evidence: document possible full-page compositor effects and separate-view usage, without attributing the reported macOS flash.                     | API guide links the report and distinguishes geometry from displayed pixels and Linux verification from macOS.                                 |

| Requirement                                                            | Alternatives considered and chosen plan                                                                                                                                          | Verification                                                                          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Unified screenshot name and semantics, bytes and optional path         | Raw page passthrough versus capture facade: public screenshot functions and JS/Python commander methods; private file writes return the same bytes.                              | Screenshot tests and real browser decode checks.                                      |
| fullPage, selector/element and clip                                    | Silent precedence versus mutually exclusive capture regions: validate conflicts; engine-native element capture or bounding-box clip for Rust.                                    | Option validation, clipping and real native Rust element screenshot.                  |
| PNG/JPEG/WebP, quality, CSS/device scale and alpha                     | Engine-specific options versus translate/encode/explicit error: use native options where available, library conversion elsewhere.                                                | Format signatures, decode dimensions and unsupported option tests.                    |
| animations disabled and caret hide                                     | Native caret mutation versus temporary capture styling: JS/Python avoid Playwright's residual inline style changes; unsupported native combinations are typed errors.            | Exact live body HTML before/after real capture.                                       |
| Typed Rust Engine options and Python API                               | Untyped kwargs versus typed option structures: add ScreenshotOptions and EngineAdapter.screenshot_with_options while preserving legacy screenshot calls.                         | Rust validation/default-adapter errors and Python option tests.                       |
| Recording start/stop, WebM/MP4/MOV, fps, size, quality                 | Context video/CDP/BiDi versus bounded sampling: sample frames sequentially and encode with MediaRecorder where supported; optional ffmpeg or a typed capability error otherwise. | Real JS WebM/MP4 decode, Python WebM and Rust recording tests.                        |
| Playwright, Puppeteer/Chromium, Firefox/BiDi and WebDriver             | Engine-only recording versus portable fallback: frame capture works without replacing an attached context; probe requested movie codecs before starting.                         | Adapter/unit tests, attached Chromium experiment; unsupported codecs fail explicitly. |
| GIF/APNG/animated WebP from recordings or screenshot sequences         | Installed ffmpeg requirement versus in-process codecs: JS gifenc/UPNG/WASM, Python Pillow, Rust native codecs.                                                                   | Two-frame decoding and alpha tests in all three languages.                            |
| fps, scale, palette/dither, loop and size optimisation                 | Implicit defaults versus validated controls: expose applicable options and reject controls a selected codec cannot honor.                                                        | Encoder options, palette, duration, size and transparency tests.                      |
| No external binaries by default; optional ffmpeg                       | Mandatory movie binary versus browser-native default: pure image codecs and MediaRecorder; caller explicitly opts into ffmpeg.                                                   | Default encoder tests and real-browser movies without ffmpeg.                         |
| trace render gif/apng/webp/mp4/webm/sheet with fps/from/to/scale       | DOM screen replay versus stored checkpoint frames: render offline screenshots, optionally record a movie with the trace.                                                         | Render/timeline tests and CLI output checks.                                          |
| startTrace video option                                                | Context relaunch versus same-session recorder: attach a bounded recording and store the final movie as a bundle member on stop.                                                  | Trace start/stop and failure cleanup tests.                                           |
| CLI screenshot selector/clip/format/quality/scale/omit-background      | Three independent CLIs versus existing shared dispatcher: extend CLI parsing and page.screenshot RPC; Python/Rust delegate unchanged.                                            | Full CLI contract/unit suites.                                                        |
| CLI record start/stop, gif and trace render                            | Per-language parsers versus shared commands: record until signal or output stop marker, encode sequences and render offline traces.                                              | Parser/record/render tests and bridge contract checks.                                |
| No injected live highlights/cursors/outlines; viewer outlines offline  | Live action markers versus no visual instrumentation: captures and detached encoder canvases do not add markers; replay viewer remains offline.                                  | Exact live DOM comparison and retained final capture artifacts.                       |
| Optional recording-only overlay                                        | Live markers versus no implicit overlay: no overlay is injected; the requested optional extension does not require enabling markers.                                             | Clean DOM verification.                                                               |
| Clean capture: hideScrollbars/hideCaret/disableAnimations/waitForFonts | Persistent page edits versus capture-time styles/font readiness: options apply only when requested, with cleanup or explicit unsupported errors.                                 | Clean preset tests and browser before/after comparison.                               |

### Issue 143: trigger readiness

| Requirement                                             | Alternatives considered and chosen plan                                                                                                            | Verification                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Per-trigger urlchange/domcontentloaded/load/networkidle | Globally skipping idle versus per-trigger policy: route lifecycle events to matching readyOn triggers, with networkidle as the compatible default. | Early readiness tests without waiting for the network-idle promise. |
| Configurable network-idle timeout                       | Larger fixed timeout versus caller policy: pass navigation-manager networkIdleTimeout/ network_idle_timeout.                                       | Navigation configuration tests.                                     |
| waitForPageReady accepts readyOn                        | Separate trigger-only policy versus shared vocabulary: readiness waits accept the same lifecycle names.                                            | Readiness unit tests.                                               |
| Remove lifecycle listeners and respect action cleanup   | Fire-and-forget callbacks versus managed subscriptions: detach on destroy and wait for current serialized action completion.                       | Existing trigger lifecycle tests plus new readiness tests.          |

### Issue 144: navigation during element waits

| Requirement                                                        | Alternatives considered and chosen plan                                                                                                                                                                | Verification                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| clickButton timeout after URL change returns interrupted/navigated | Treat every timeout as benign versus evidence-based classification: compare initial URL/navigation identity only when a wait times out before dispatch.                                                | Failing-before/passing-after JS/Python regression and Rust identity tests. |
| Same-URL document replacement detected by session identity         | URL-only comparison versus navigation session/document identity: use manager session ID or adapter document identity where available.                                                                  | Same-URL navigation regression.                                            |
| True timeouts remain errors                                        | Suppress all wait failures versus preserve original timeout: unchanged identity rethrows the original error and no click is claimed.                                                                   | Genuine timeout controls.                                                  |
| Apply rule to analogous wait/fill paths                            | Click-only handling versus shared locator/selector classification: shared JS/Python waits raise a navigation error or return null/false when suppression is requested; fill inherits locator behavior. | Additional failing-before/passing-after shared wait tests.                 |

### Issue 145: deterministic tab reuse

| Requirement                                                        | Alternatives considered and chosen plan                                                                                                                                            | Verification                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Do not trust Playwright-emulated visibility                        | Trust first visible tab versus disable focus emulation before sampling visibility: best-effort foreground detection, with explicit/remembered targets for reliable reconnects.     | All-visible mocked tab fixture and CDP cleanup tests.          |
| Select actual tab where possible without assuming /json/list order | Raw pre-attach probing versus explicit identity: disable focus emulation before sampling; explicit/remembered target wins. No active-tab flag or list-order guarantee is invented. | Target/URL selection tests.                                    |
| targetId / URL matcher                                             | Heuristic-only selection versus caller selectors: add target ID and URL match to JS/Python/Rust connectors and bridges.                                                            | Matching and absent-match tests across languages.              |
| Remember automation tab on reconnect                               | Always foreground versus session metadata: store last selected target, restore it on reconnect and update it on reusePage.                                                         | Real persistent reconnect experiments.                         |
| Explicit singleTab closes others                                   | Implicit tab deletion versus opt-in cleanup: close other tabs only with singleTab/single_tab.                                                                                      | Tab-selection tests verify closes and missing-target behavior. |

## Reproduction and validation artifacts

- `experiments/issue-146/trusted-types.mjs` reads the original main implementation
  and proves its TrustedHTML assignment fails before testing the replacement.
- `experiments/issue-146/browser-verification.mjs` checks image/movie decoding,
  exact live DOM stability, remembered persistent tabs and idle shutdown.
- `experiments/issue-146/python-verification.py` checks multiframe image decode,
  WebM, real HTTP HAR/body bounds/redaction and persistent reconnection.
- `rust/tests/trace_record_real_browser.rs` contains opt-in native CDP tests for
  trace recording, PNG/JPEG/WebP element screenshots and bounded recording.
- Unit regressions cover navigation interruption, quiet restrictions, trigger
  readiness/concurrency, tab selection, rotation/gzip, encoders and cleanup.
- Bundle regressions verify that repeated periodic drains append every mutation
  batch in a checkpoint interval; the previous implementation overwrote earlier
  batches, causing incomplete offline replay.
- Session shutdown regressions reject CDP errors, ignore unrelated events and
  await remote disconnection. The CLI browser test verifies that the debugging
  endpoint is gone after shutdown, rather than accepting an early acknowledgement.
- Dispatcher lifecycle regressions cover both engines with and without
  `keepOpen`. Normal launched sessions close their browser even when it offers
  `detach`; persistent sessions disconnect. The combined Node 24 CLI/API suite
  reproduces the former post-assertion process hang and verifies normal exit.
- `experiments/issue-146/ci-hang-diagnostics.mjs` is an optional, bounded preload
  for inspecting child-process and pipe resources left after a browser suite.

The final image artifacts in `docs/screenshots/issue-146*` demonstrate capture
output and the already scrolled browser window before/after stable viewport
capture. Regressions verify both unchanged live DOM content and independent
displayed pixels throughout capture.

The workflow edit also exposed 11 stale `dtolnay/rust-toolchain` action pins in
the [CI policy run](https://github.com/link-foundation/browser-commander/actions/runs/38055848960).
Its preserved log (`ci-logs/ci-policy-38055848960.log`, lines 662–674) reports
`ref-version-mismatch` and exit 13: the pinned commit no longer matches the `v1`
comment. The authenticated local zizmor 1.30.1 audit reproduces all 11 findings.
The upstream `v1` ref resolves to `e2a55d2ffb04f378e9626c28d38b36d230d1e12f`;
all references in docs, parity, Rust and Safari workflows now use that commit.
The [audit's documented remedy](https://docs.zizmor.sh/audits/#ref-version-mismatch)
is to make the pin and comment agree, preserving the existing security policy.

The next [browser-parity run](https://github.com/link-foundation/browser-commander/actions/runs/38056379381/job/114225646702)
found a readiness deadline race: the 1,500 ms never-idle test returned `failed`
instead of `timed_out` (`ci-logs/browser-parity-38056379381.log`, lines 5051–5083).
The bounded Node 24 experiment `experiments/issue-146/readiness-deadline.mjs`
reproduces this with `deadline reached` evidence and an elapsed time of 1,499 ms.
The readiness runner discarded the timer's expiry result and sampled its rounded
monotonic clock again. [Node timers do not promise exact callback timing](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args);
[asyncio callbacks may also run early](https://docs.python.org/3/library/asyncio-eventloop.html#asyncio.loop.call_later).
Deterministic JavaScript and Python regressions freeze the fractional remaining
budget while the real timer expires; both fail before the fix. Both runners now
retain the timeout outcome and leave subsequent checks pending. Early check
failures and cancellation keep their distinct statuses. The real-browser probe
then passes all 20 bounded attempts, and the original E2E assertion includes
structured evidence to make any future CI failure diagnosable. Rust's native
deadline path was checked separately: it uses unrounded `Duration` budgets and
explicit timeout enum variants, rather than these rounded-millisecond runners.
