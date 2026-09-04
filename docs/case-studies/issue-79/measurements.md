# Issue 79 Measurements

Every number on this page was produced by a script in
[`experiments/fingerprint-parity`](../../../experiments/fingerprint-parity/README.md)
on this machine, and the raw output is in `analysis-artifacts/`. Nothing here
is quoted from a blog post; where a third-party claim is discussed it is marked
as such and tested.

Environment: Google Chrome 149.0.7827.155 on Linux x86_64, headful captures
under `Xvfb` at 1920x1080x24.

## How a capture is made

The reference capture never speaks CDP. Chrome is started as an ordinary child
process pointed at a local page, the page runs `probe.js` and POSTs its report
back over HTTP. Every automated capture is delivered exactly the same way, so a
field that differs in the diff is a difference in the browser, not a difference
in how the probe was invoked.

That property is load-bearing. A probe injected with `page.evaluate` would be
comparing "a browser we are already driving" against itself.

The control for the harness itself is `referenceSecond`: a second hand-started
Chrome, diffed against the first. It reports **0 differences** in both modes,
so the probe is deterministic across processes and a non-empty diff means
something.

## 1. What each engine leaks, and what the library fixes

`run-baseline.mjs` -> `analysis-artifacts/parity-headful.json`,
`analysis-artifacts/parity-headless.json`.

| Capture | Headful diffs | Headless diffs |
| --- | --- | --- |
| `referenceSecond` (harness control) | 0 | 0 |
| `playwright` (plain, `--enable-automation` removed) | 2 | 6 |
| `playwrightWithAutomationFlag` (plain, flag kept) | 2 | 6 |
| `puppeteer` (plain) | 2 | 2 |
| `puppeteerWithoutAutomationFlag` | 2 | 2 |
| `cdpAttach` (plain Chrome + fixed debugging port) | 0 | 0 |
| `playwrightParity` (parity switch via `args`) | 0 | 4 |
| `puppeteerParity` (parity switch via `args`) | 0 | 0 |
| **`libraryPlaywright`** (`launchBrowser`) | **0** | **0** |
| **`libraryPuppeteer`** (`launchBrowser`) | **0** | **0** |

The differing fields:

- Headful, both engines: `navigator.webdriver` and `iframe.webdriver`. Nothing
  else. The entire headful gap between "a browser somebody is driving" and "a
  browser somebody started" is one boolean, visible in the top document and in
  a same-origin iframe.
- Headless, Playwright only, four more:
  `mediaQueries.(hover: hover)`, `mediaQueries.(any-hover: hover)`,
  `mediaQueries.(pointer: fine)`, `mediaQueries.(any-pointer: fine)`.

Three conclusions follow directly from the table.

**Removing `--enable-automation` changes nothing.** `playwright` and
`playwrightWithAutomationFlag` produce the same two differences, and so do
`puppeteer` and `puppeteerWithoutAutomationFlag`. The switch that most stealth
guides tell you to remove is not what sets `navigator.webdriver` here; the
debugging transport is. Removing it is still worth doing -- it is what shows
the "controlled by automated test software" infobar -- but on its own it is not
a parity fix.

**`playwrightParity` is still wrong headless.** Passing
`--disable-blink-features=AutomationControlled` through `args` fixes
`navigator.webdriver` but leaves the four media queries, because Playwright
appends its own pointer switch *after* the caller's arguments:

```
--blink-settings=primaryHoverType=2,availableHoverTypes=2,
                 primaryPointerType=4,availablePointerTypes=4
```

(`packages/playwright-core/src/server/chromium/chromium.ts`, in the
`options.headless` branch). A real headless Chrome has no pointing device and
answers `hover: none` / `pointer: none`; with that switch it answers
`hover: hover` / `pointer: fine`. No argument a caller adds can undo it --
only `ignoreDefaultArgs` keeps it off the command line, which is what
`launchBrowser` does. This is the reason the library scenarios exist in the
artifact at all: hand-passed arguments cannot reach parity headless, and a
measurement that only tested hand-passed arguments would have missed it.

**Attaching over a fixed debugging port is already clean.** `cdpAttach` starts
plain Chrome with `--remote-debugging-port=<fixed>` and connects with
`connectOverCDP`; it shows 0 differences with no parity switches at all.

## 2. Which switch sets `navigator.webdriver`

`run-remote-debugging-isolation.mjs` ->
`analysis-artifacts/remote-debugging-isolation.json`.

| Chrome command line | `navigator.webdriver` |
| --- | --- |
| no debugging switches | `false` |
| `--remote-debugging-port=0` | `true` |
| `--remote-debugging-port=<fixed>` | `false` |
| `--remote-debugging-port=<fixed> --remote-debugging-address=127.0.0.1` | `false` |
| `--remote-debugging-port=0` (repeat) | `true` |
| `--remote-debugging-pipe` | `true` |

This matches `content/child/runtime_features.cc`, which maps
`--enable-automation`, `--headless` and `--remote-debugging-pipe` onto the
`AutomationControlled` Blink runtime feature and adds an explicit case for an
ephemeral debugging port, on the grounds that port 0 is how ChromeDriver
launches Chrome. A fixed port is deliberately left alone -- that is a human
attaching a debugger.

Playwright always passes `--remote-debugging-pipe`; Puppeteer defaults to
`--remote-debugging-port=0`. That is why both leak, and why neither is fixed by
touching `--enable-automation`.

## 3. `Emulation.setAutomationOverride` does not help

`run-automation-override.mjs`. The command is accepted -- CDP returns success --
and `navigator.webdriver` stays `true`, in the same document and after a
navigation. There is no protocol-side undo for the Blink feature; the only
remedy is the launch switch `--disable-blink-features=AutomationControlled`.

The practical consequence is a hard boundary in the API: a browser somebody
else already launched cannot be corrected. `applyFingerprint({ patchWebdriver:
true })` installs a JavaScript getter for that case, and it is strictly weaker.

## 4. What the CDP `Emulation` domain actually covers

`run-override-coverage.mjs` -> `analysis-artifacts/cdp-override-coverage.json`.
All eight commands returned `ok`; the question is what moved.

Covered by the browser, so consistent everywhere including the network layer:

`navigator.userAgent`, `navigator.platform`, `navigator.language`,
`navigator.languages`, `navigator.hardwareConcurrency`,
`navigator.maxTouchPoints`, `navigator.userAgentData` (all of it, including
`getHighEntropyValues`), `screen.width`, `screen.height`, the timezone seen by
`Intl` and by `Date`, the locale seen by `Intl.DateTimeFormat` and
`Intl.Collator`, the `prefers-color-scheme` / `prefers-reduced-motion` /
`forced-colors` media queries, and geolocation.

Not covered, and therefore JavaScript-patch-only:

| Field | Observed with the override applied |
| --- | --- |
| `navigator.deviceMemory` | `8` -- the host value; no Emulation command exists |
| `navigator.vendor` | `"Google Inc."` -- unchanged |
| `navigator.doNotTrack` | `null` -- unchanged |
| `screen.availWidth` / `availHeight` | `1920` / `1080` -- set equal to `width`/`height`, so no taskbar |
| `screen.colorDepth` / `pixelDepth` | `24` -- not emulated |
| WebGL vendor and renderer strings | host values -- not emulated |

`Emulation.setTouchEmulationEnabled` has a side effect worth knowing about: it
also reports `pointer: coarse` and removes `hover`. That is right for a phone
and wrong for a desktop with a touchscreen.

## 5. How Chrome turns a language list into headers

`run-ua-hints-detail.mjs` -> `analysis-artifacts/ua-hints-detail.json`.

| `acceptLanguage` passed to CDP | `navigator.languages` | `Accept-Language` sent |
| --- | --- | --- |
| `de-DE,de;q=0.9,en;q=0.8` | `["de-DE", "de;q=0.9", "en;q=0.8"]` | `de-DE,de;q=0.9;q=0.9,en;q=0.8;q=0.8` |
| `de-DE,de,en` | `["de-DE", "de", "en"]` | `de-DE,de;q=0.9,en;q=0.8` |
| `de-DE` | `["de-DE"]` | `de-DE` |

Chrome builds the quality ladder itself. Handing it a ladder double-encodes the
header *and* puts `"de;q=0.9"` into `navigator.languages`, where a real browser
has a bare language tag. This is a trap that is easy to fall into, because the
CDP parameter is named after the header, so the profile layer rejects q-values
at validation time with a message that says who generates them.

Client hints have a second trap. With no `fullVersion` in the metadata,
`getHighEntropyValues(['uaFullVersion'])` returns the **real** browser version
(`149.0.7827.155`) while `fullVersionList` reports the claimed one (`140.0.0.0`)
-- a self-inconsistent answer no real browser gives. Setting the deprecated
`fullVersion` field makes both agree.

## 6. Workers see through page-level overrides

`run-worker-visibility.mjs` -> `analysis-artifacts/worker-visibility.json`.

A dedicated worker has its own `Navigator`, and `Page.addScriptToEvaluateOnNew
Document` runs in documents only.

| Scenario | Fields where the worker disagrees with its document |
| --- | --- |
| overrides on the page session only | `platform`, `languages`, `hardwareConcurrency` |
| + Emulation commands replayed on the worker session | `platform` |
| + init script evaluated during `waitForDebuggerOnStart` | none |

So full worker parity *is* reachable -- but only over a raw CDP connection.
Both engines refuse the necessary handle: Playwright's `newCDPSession` accepts a
`Page` or `Frame` and nothing else, and Puppeteer keeps worker sessions inside
its `TargetManager`. The measurement is what turns this from "workers are
probably a problem" into a documented limitation with a stated escape hatch.

## 7. The `Runtime.enable` leak does not reproduce on Chrome 149

`run-runtime-enable.mjs` -> `analysis-artifacts/runtime-enable-leak.json`.

The claim under test, and the reason `rebrowser-patches` exists: enabling the
Runtime domain makes the inspector serialise console arguments, which reads
`Error.prototype.stack`, so a page can install a getter and watch it fire. The
experiment reproduces the detector from `rebrowser-bot-detector` -- cumulative
counter, sampled on a later task so a deferred read is still caught.

| Scenario | stack getter fired |
| --- | --- |
| plain Chrome, nothing attached | no |
| `launchBrowser` playwright, before and after `page.evaluate` | no |
| `launchBrowser` puppeteer, before and after `page.evaluate` | no |
| **explicit `Runtime.enable` over a raw CDP session** | **no**, with 34 `Runtime.consoleAPICalled` events received |

The last row is the control, and it is the point of the experiment. Counting
the events proves the domain really was enabled and really was forwarding
console calls; the getter still never fired. On this Chrome build the
console-serialisation variant of the leak is closed.

This is a version-specific negative result, not a claim that the leak never
existed or cannot return. It is kept as a script rather than a sentence so the
next person can re-run it on a newer Chrome and get an answer rather than an
opinion.

## 8. An applied profile survives inspection

`run-profile-application.mjs` -> `analysis-artifacts/profile-application.json`.
With a full macOS profile applied to a Linux host: no value mismatches, no
property-descriptor differences against the reference browser, and every
patched accessor reports `[native code]` under `Function.prototype.toString`.

Descriptor shape is checked because it is cheaper to detect than the value
itself. A real `navigator.deviceMemory` is an accessor on `Navigator.prototype`
with `enumerable: true`, `configurable: true`, no setter, and a getter named
`get deviceMemory`. A patch that defines a plain data property on the instance
matches the value and fails every one of those.
