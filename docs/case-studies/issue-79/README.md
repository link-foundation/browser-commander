# Issue 79 Browser Fingerprint Parity Case Study

## Scope

Issue: https://github.com/link-foundation/browser-commander/issues/79

Prepared PR: https://github.com/link-foundation/browser-commander/pull/80

Investigation date: 2026-09-04 UTC.

The issue asked for four things: tests proving *exactly 0 difference* between a
real browser and one driven by this library, full configurability of the user
environment, a clear statement of the limitations that cannot be configured but
still affect privacy, and all of it compiled into this directory with a
requirement-by-requirement plan and a survey of comparable projects.

The measurable claim is the first one, so it was settled first, by measurement
rather than by argument. **It holds for Chrome, through both Playwright and
Puppeteer, headful and headless: 0 differing fields against a hand-started
Chrome of the same mode.** Everything else in this case study is either the
evidence for that sentence or the scope it does not yet cover.

## Documents

| Document | Contents |
| --- | --- |
| [`measurements.md`](./measurements.md) | Eight measurements, every number traced to an artifact in `analysis-artifacts/`. |
| [`requirements.md`](./requirements.md) | R1-R8: each requirement from the issue, its status, its solution, and its plan. |
| [`prior-art.md`](./prior-art.md) | Nine comparable projects, what each does, and what was taken or rejected. |

## Evidence Collected

All artifacts are regenerable: each is written by a named script in
[`experiments/fingerprint-parity`](../../../experiments/fingerprint-parity/README.md).

- `analysis-artifacts/parity-headful.json`, `analysis-artifacts/parity-headless.json`:
  ten captures per mode -- a hand-started Chrome, a second hand-started Chrome
  as the harness control, both engines plain, both engines with the
  `--enable-automation` flag inverted, a raw CDP attach, both engines with
  parity arguments, and both engines through the shipped `launchBrowser`.
  Written by `run-baseline.mjs`.
- `analysis-artifacts/remote-debugging-isolation.json`: `navigator.webdriver`
  under each launch switch in isolation, which is what identifies the debugging
  transport rather than `--enable-automation` as the cause. Written by
  `run-remote-debugging.mjs`.
- `analysis-artifacts/cdp-override-coverage.json`: which fingerprint fields the
  CDP `Emulation` domain can set and which have no command at all. Written by
  `run-override-coverage.mjs`.
- `analysis-artifacts/ua-hints-detail.json`: high-entropy client hint values,
  including the `uaFullVersion` case where the real Chrome version leaks
  through a spoofed one. Written by `run-ua-hints-detail.mjs`.
- `analysis-artifacts/profile-application.json`: every profile field compared
  against what the page actually reads, with property descriptors and
  `Function.prototype.toString` output. Written by `run-profile-application.mjs`.
- `analysis-artifacts/worker-visibility.json`: the same fields read from a
  dedicated worker, which is where page-session overrides stop. Written by
  `run-worker-visibility.mjs`.
- `analysis-artifacts/runtime-enable-leak.json`: the `rebrowser` console
  serialisation detector plus a positive control that counts
  `Runtime.consoleAPICalled` events. Written by `run-runtime-enable.mjs`.

Environment for every capture: Google Chrome 149.0.7827.155, Linux x86_64,
headful runs under `Xvfb` at 1920x1080x24.

## Timeline

- 2026-09-04: issue 79 opened, requesting zero measurable difference, full
  configurability, documented limitations, all three languages, and this case
  study.
- 2026-09-04: `probe.js` and the reference harness built; the harness validated
  by diffing two independently started Chrome processes, which agree in 0
  fields.
- 2026-09-04: first baseline captured. Playwright and Puppeteer each differ from
  a real Chrome in `navigator.webdriver` and its iframe counterpart; Playwright
  headless differs in four more fields, the hover and pointer media queries.
- 2026-09-04: `--enable-automation` eliminated as the cause -- inverting the
  flag on either engine changes no field.
- 2026-09-04: `content/child/runtime_features.cc` read; the property is a Blink
  runtime feature, and the debugging transport enables it.
  `run-remote-debugging.mjs` confirms switch by switch.
- 2026-09-04: parity arguments landed. Headful reaches 0 for both engines.
  Playwright headless stays at 4, because its pointer switch is appended after
  caller arguments and only `ignoreDefaultArgs` can remove it.
- 2026-09-04: `launchBrowser` wired to remove that default. Both engines reach
  0 in both modes; recorded as the `libraryPlaywright` and `libraryPuppeteer`
  captures.
- 2026-09-04: `Emulation.setAutomationOverride` tested as an alternative and
  found accepted but ineffective.
- 2026-09-04: fingerprint profiles measured field by field, including
  descriptors, native-function masking, workers, and the Accept-Language
  q-value ladder.
- 2026-09-04: the third-party `Runtime.enable` leak tested with a control and
  found not to reproduce on Chrome 149.
- 2026-09-04: end-to-end parity suite added, 12 tests across both engines and
  both modes, including negative controls that fail if parity is switched off.

## Root Causes

### 1. The Debugging Transport Sets `navigator.webdriver`, Not `--enable-automation`

The single field that separated a driven Chrome from a real one, in every
configuration measured, was `navigator.webdriver` -- in the document and in an
iframe.

The category's standard advice is to remove `--enable-automation`. Measurement
1 shows that advice is wrong: `playwright` and `playwrightWithAutomationFlag`
produce identical two-field diffs, as do `puppeteer` and
`puppeteerWithoutAutomationFlag`.

`content/child/runtime_features.cc` gives the actual rule. The
`AutomationControlled` Blink runtime feature is enabled by *any* of
`--enable-automation`, `--headless`, `--remote-debugging-pipe`, or
`--remote-debugging-port=0`. Playwright uses the pipe; Puppeteer uses an
ephemeral port. Both trip it regardless of the flag.

The exemption in that same file explains the `cdpAttach` result: a *fixed*
debugging port is deliberately not covered, on the reasoning that a human with
a debugger attached is not automation. Attaching to a plain Chrome over a fixed
port measures 0 differences with no parity work at all.

Fix: `--disable-blink-features=AutomationControlled`, applied at launch by
`applyAutomationParityArgs`. It turns the feature off at its source, so it
needs no init script, forges no property descriptor, and reaches workers and
iframes for free. The JavaScript getter is kept only for sessions attached to a
browser somebody else launched, and is documented as the weaker mechanism.

### 2. Playwright Forces a Coarse Pointer in Headless Mode

Playwright headless differed in four further fields: `(hover: hover)`,
`(any-hover: hover)`, `(pointer: fine)` and `(any-pointer: fine)` all reported
the touch-device answer, while a real headless Chrome reports the mouse answer.

`packages/playwright-core/src/server/chromium/chromium.ts` appends
`--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4`
*after* the caller's arguments. Passing a corrected `--blink-settings` therefore
cannot win: the later switch is the one Blink reads.

This is why the `playwrightParity` capture still measures 4 differences while
`libraryPlaywright` measures 0. The only mechanism that removes an argument the
engine appends is `ignoreDefaultArgs`, which is a launch option rather than an
argument, and it is what `parityIgnoredDefaultArgs` returns.

The practical lesson is the reason the `libraryPlaywright` and
`libraryPuppeteer` captures exist at all: testing hand-passed arguments would
have measured a configuration no caller of this library ever gets, and would
have reported a passing result for a shape that does not reach parity.

### 3. Headless Chrome Is Not Headful Chrome, With No Automation Involved

A real headless Chrome differs from a real headful Chrome in thirteen probe
fields before any automation exists: the user agent and `appVersion` say
`HeadlessChrome` in the document, in an iframe and in a worker; the screen is
800x600 with `availWidth` and `availHeight` following; the four hover and
pointer media queries report no hover and no fine pointer; and WebGL falls back
to SwiftShader.

Fix: this is a property of the browser, not a defect to patch, so it is
recorded in `FINGERPRINT_LIMITATIONS` and enforced in the method rather than
hidden. A headless browser is compared against a headless reference and a
headful browser against a headful one -- `defineParitySuite` is invoked twice
for exactly this reason. Claiming parity between the two modes would require
faking thirteen fields, which is the mistake catalogued in
[`prior-art.md`](./prior-art.md).

### 4. CDP Emulation Covers Less Than the Configurable Surface

`Emulation` has commands for the user agent, timezone, locale, hardware
concurrency, device metrics, touch, media and geolocation. It has no command
for `deviceMemory`, `navigator.vendor`, `doNotTrack`, `screen.availWidth` and
`availHeight`, `colorDepth` and `pixelDepth`, or the WebGL vendor and renderer
strings.

Fix: profiles state their mechanism per field in
`FINGERPRINT_FIELD_MECHANISMS`, so a caller can see which values are set by the
browser and which by an init script, and the limitations list names the fields
where a script is the only option and is therefore in principle detectable.
Two traps found while measuring this are documented rather than papered over:
Chrome builds the Accept-Language q-value ladder itself, so passing q-values
double-encodes them and pollutes `navigator.languages`; and
`getHighEntropyValues(['uaFullVersion'])` returns the real Chrome version
unless the deprecated `fullVersion` metadata field is also supplied.

### 5. Third-Party Claims Were Repeated Rather Than Tested

The `Runtime.enable` console-serialisation leak is treated as settled fact
across this literature, and is the reason `rebrowser-patches` and Patchright
exist.

`run-runtime-enable.mjs` reproduces the published detector and adds the control
the published version lacks: the driving CDP session counts
`Runtime.consoleAPICalled` events. On Chrome 149.0.7827.155 the control
receives 34 events -- the domain is on and forwarding -- and the
`Error.prototype.stack` getter never fires, in the reference, in Playwright or
in Puppeteer, before or after `page.evaluate`.

Fix: no code change, because there is nothing to fix on this build. The script
is kept so the question can be re-answered on a future Chrome instead of
re-argued.

### 6. Playwright Forces Software WebGL on Every Launch

Upgrading Playwright from 1.56 to 1.62 broke headful parity with no change to
this library's own code. The parity suite reported a single failing path,
`webgl.webgl1`, and a whole missing subtree means one side answered `null`.

`packages/playwright-core/src/server/chromium/chromium.ts` pushes
`--enable-unsafe-swiftshader` into every launch. In 1.56 the push was guarded
by `os.platform() === 'darwin'`; in 1.62 it is unconditional. The switch lets
Chrome fall back to the SwiftShader software renderer when no usable GPU is
present, which a hand-started Chrome refuses to do. On a machine without a GPU
-- a container, a VM, a CI runner -- the difference is total:
`canvas.getContext('webgl')` answers `null` in a real browser and a full
context under Playwright, complete with the ANGLE/SwiftShader vendor and
renderer strings. Measured in
[`analysis-artifacts/parity-webgl-swiftshader.json`](./analysis-artifacts/parity-webgl-swiftshader.json)
and reproduced by
[`experiments/fingerprint-parity/run-webgl-availability.mjs`](../../../experiments/fingerprint-parity/run-webgl-availability.mjs).

Fix: `PLAYWRIGHT_SOFTWARE_WEBGL_ARG` is added to the `always` exclusion list,
next to `--enable-automation`, in all three languages. It is listed under
`always` rather than `headless` deliberately: headless Chrome enables
SwiftShader on its own, so the exclusion is a no-op there, but restricting it
to the headless list would leave the headful launch broken -- which is the mode
that actually diverged.

The finding matters beyond the one switch. This is a difference the library
*acquired by upgrading a dependency*, invisible on a GPU-equipped laptop and
fatal on a GPU-less runner. It is the argument for asserting parity against a
real browser in CI rather than auditing engine switch lists by hand.
